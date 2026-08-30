/* @kiligzzz/dsh-session-nav — browser half (hand-written bundle, no build step).
 *
 * Contract (client-modules): window.__ModuleLoader__.load({ id, factory }).
 * Mount: additive 'shell.overlay' slot (frame-wide floating layer, list slot,
 *        click-through layer — only the key strip opts back into pointer events).
 * Data:  ctx.sessions.binding(currentId).session → ConversationSnapshot
 *        (getSnapshot/subscribe — React useSyncExternalStore compatible).
 * Anchors: one key per user message (chat node kind 'user'/'steering'); message
 *        rows in the [data-conversation-scroll] scrollport carry
 *        [data-chat-anchor-key].
 *
 * Visual spec (aligned with the reference plugin's pixel measurements):
 *   - vertical piano-key strip hugging the left edge of the conversation area
 *   - 2px visual bars, 6px base length, 26px hovered (≈4.3×), fixed 10px pitch
 *   - hover ladder: hovered 26px, neighbors 20/14/10px (offset 1..3), ≥4 → base
 *   - cluster is vertically centered in the strip; pitch compresses (min 6px)
 *     only when the cluster would overflow the strip height
 *   - non-hover: the key of the user message currently in view is highlighted
 *     (color-only change, length unchanged), re-evaluated live on scroll
 *   - tooltip: user message single-line ellipsis + model reply up to 3 lines
 *     (JS width-model truncation + -webkit-line-clamp double insurance)
 *   - dark/light theme via data-ds-dark-theme + prefers-color-scheme fallback
 *
 * Performance: event-driven geometry (scroll capture / resize / ResizeObserver
 * lazily attached to the scrollport), rAF-merged recomputes, no document-wide
 * MutationObserver and no perpetual timers. Anchor rows go through an
 * isConnected-validated cache so virtualized list recycling stays cheap.
 */
;(function () {
  if (typeof window === 'undefined' || !window.__ModuleLoader__) return
  window.__ModuleLoader__.load({
    id: '@kiligzzz/dsh-session-nav',
    factory: (require) => {
      const React = require('react')
      const { useState, useEffect, useMemo, useRef, useSyncExternalStore } = React
      // Shared pure helpers (text extraction, truncation, key identity) live
      // in lib/shared.js and are exercised by the unit tests. Fall back to
      // inline copies when the module loader cannot resolve the sibling path
      // (e.g. CDP-injected contexts without a module graph).
      let shared = null
      try {
        shared = require('./shared.js')
      } catch (err) {
        shared = null
      }
      const textOfBlocks = shared && shared.textOfBlocks ? shared.textOfBlocks : (blocks) => {
        if (!Array.isArray(blocks)) return ''
        const parts = []
        for (const b of blocks) {
          if (!b || typeof b !== 'object') continue
          if (b.kind === 'text' || b.type === 'text') {
            const t = b.text !== undefined ? b.text : b.content
            if (typeof t === 'string' && t.trim()) parts.push(t)
          } else if (b.type === 'image' || b.kind === 'image') {
            parts.push('[图片]')
          } else if (typeof b.text === 'string' && b.text.trim()) {
            parts.push(b.text)
          }
        }
        return parts.join(' ').replace(/\s+/g, ' ').trim()
      }
      const clampModelText = shared && shared.clampModelText ? shared.clampModelText : (text) => {
        if (!text) return ''
        let units = 0
        let idx = 0
        for (; idx < text.length; idx++) {
          const code = text.charCodeAt(idx)
          const w = code > 0x2E7F ? 1 : 0.5
          if (units + w > 55) break
          units += w
        }
        if (idx >= text.length) return text
        return text.slice(0, Math.max(0, idx - 1)) + '…'
      }
      const keyIdentity = shared && shared.keyIdentity ? shared.keyIdentity : (key) => {
        if (typeof key !== 'string' || key.length === 0) return null
        const m = key.match(/input-message([0-9a-fA-F-]{8,})/)
        if (m) return m[1]
        return key
      }
      const computeCluster = shared && shared.computeCluster ? shared.computeCluster : (entryCount, stripTop, stripHeight) => {
        if (!Number.isFinite(entryCount) || entryCount <= 0) return { pitch: PITCH, ys: [] }
        const n = Math.floor(entryCount)
        const avail = Math.max(1, stripHeight - 2 * PAD)
        const p = n * PITCH <= avail ? PITCH : Math.max(MIN_PITCH, avail / n)
        const clusterH = n * p
        const startY = stripTop + (stripHeight - clusterH) / 2 + p / 2
        const ys = new Array(n)
        for (let i = 0; i < n; i++) ys[i] = startY + p * i
        return { pitch: p, ys }
      }
      const sameLayout = shared && shared.sameLayout ? shared.sameLayout : (a, b) => {
        if (!a || !b) return false
        if (a.hidden !== b.hidden || a.left !== b.left || a.top !== b.top || a.height !== b.height || a.active !== b.active) return false
        if (!Array.isArray(a.ys) || !Array.isArray(b.ys) || a.ys.length !== b.ys.length) return false
        for (let i = 0; i < a.ys.length; i++) if (a.ys[i] !== b.ys[i]) return false
        return true
      }

      const PLUGIN_ID = '@kiligzzz/dsh-session-nav'
      const CSS_VERSION = '0.3.0'

      // Geometry — pixel measurements from the reference visual spec:
      // 2px bars, 6px base, 26px hovered, fixed 10px pitch, vertically
      // centered cluster. Hover ladder 26/20/14/10 (77%/54%/38%).
      const KEY_MAX = 26   // hovered key length
      const KEY_BASE = 6   // shortest key length
      const KEY_HIT = 10   // slot pitch = hit area height (visual bar is 2px)
      const BAR_LEFT_OFFSET = 6
      const PAD = 10
      const PITCH = 10     // fixed center-to-center spacing between keys
      const MIN_PITCH = 6  // densest pitch when the cluster overflows the strip
      const TIP_GAP = 4    // tooltip hugs the key strip
      const TIP_WIDTH = 280
      const LADDER = [KEY_MAX, 20, 14, 10] // offsets 0..3; >=4 uses base

      let ctxRef = null

      // ── self-injected styles (versioned, self-healing) ──
      const CSS_LINES = [
        '.dssn-root{position:absolute;inset:0;pointer-events:none;z-index:30;',
        '--dssn-key-base:#8A8C90;--dssn-key-active:#5A5C60;--dssn-key-hover:#1A1C1F;',
        '--dssn-glow:0 1px 4px rgba(0,0,0,.28);',
        '--dssn-tip-bg:#FFFFFF;--dssn-tip-border:#E5E7EB;--dssn-tip-shadow:0 2px 10px rgba(0,0,0,.12);',
        '--dssn-tip-user:#111827;--dssn-tip-model:#6B7280}',
        '.dssn-root[data-theme="dark"]{',
        '--dssn-key-base:#78797D;--dssn-key-active:#C0C1C4;--dssn-key-hover:#FFFFFF;',
        '--dssn-glow:0 1px 6px rgba(0,0,0,.5);',
        '--dssn-tip-bg:#2C2C2C;--dssn-tip-border:rgba(255,255,255,.10);--dssn-tip-shadow:0 4px 16px rgba(0,0,0,.35);',
        '--dssn-tip-user:#D8D8E8;--dssn-tip-model:#9898A8}',
        '.dssn-keys{position:absolute;pointer-events:auto;width:' + (KEY_MAX + 8) + 'px;overflow:visible}',
        '.dssn-key{position:absolute;left:0;width:' + (KEY_MAX + 8) + 'px;height:' + KEY_HIT + 'px;padding:0;margin:0;border:0;background:transparent;cursor:pointer;display:block;transform:translateY(-' + (KEY_HIT / 2) + 'px);outline:none}',
        '.dssn-key-bar{position:absolute;left:0;top:50%;margin-top:-1px;height:2px;border-radius:2px;background:var(--dssn-key-base);width:' + KEY_BASE + 'px;transition:width .25s ease-out,background-color .2s ease-out,box-shadow .2s ease-out}',
        '.dssn-key[data-offset="0"] .dssn-key-bar{width:' + LADDER[0] + 'px;background:var(--dssn-key-hover);box-shadow:var(--dssn-glow)}',
        '.dssn-key[data-offset="1"] .dssn-key-bar{width:' + LADDER[1] + 'px}',
        '.dssn-key[data-offset="2"] .dssn-key-bar{width:' + LADDER[2] + 'px}',
        '.dssn-key[data-offset="3"] .dssn-key-bar{width:' + LADDER[3] + 'px}',
        '.dssn-key-active .dssn-key-bar{background:var(--dssn-key-active)}',
        '.dssn-tip{position:absolute;transform:translateY(-50%);width:' + TIP_WIDTH + 'px;max-width:' + TIP_WIDTH + 'px;box-sizing:border-box;background:var(--dssn-tip-bg);border:1px solid var(--dssn-tip-border);border-radius:10px;box-shadow:var(--dssn-tip-shadow);padding:10px 12px;pointer-events:none;font-family:var(--dsw-font-family,inherit);animation:dssn-tip-in .2s cubic-bezier(.22,1,.36,1)}',
        // Guard: never let the tooltip (or notice) overflow the viewport's
        // right edge on narrow windows (e.g. a collapsed details column).
        '@media (max-width:640px){.dssn-tip{max-width:calc(100vw - 56px)}.dssn-notice{max-width:calc(100vw - 56px)}}',
        '.dssn-tip-turn{display:inline-block;font-size:11px;line-height:16px;font-weight:700;color:var(--dssn-key-active);background:var(--dssn-tip-border);border-radius:8px;padding:0 8px;margin-bottom:6px;letter-spacing:.02em}',
        '.dssn-tip-user{font-size:13px;line-height:18px;font-weight:600;color:var(--dssn-tip-user);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dssn-tip-model{margin-top:4px;font-size:12px;line-height:18px;font-weight:400;color:var(--dssn-tip-model);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;overflow:hidden;overflow-wrap:anywhere}',
        '@keyframes dssn-tip-in{from{opacity:0;transform:translateY(-50%) translateX(-6px) scale(.98)}to{opacity:1;transform:translateY(-50%) translateX(0) scale(1)}}',
        '@keyframes dssn-tip-out{from{opacity:1;transform:translateY(-50%) translateX(0) scale(1)}to{opacity:0;transform:translateY(-50%) translateX(-6px) scale(.98)}}',
        '.dssn-tip-leave{animation:dssn-tip-out .18s ease-in forwards}',
        '.dssn-notice{position:absolute;transform:translateY(-100%);margin-top:-8px;max-width:260px;box-sizing:border-box;background:var(--dssn-tip-bg);border:1px solid var(--dssn-tip-border);border-radius:8px;box-shadow:var(--dssn-tip-shadow);padding:6px 10px;pointer-events:none;font-size:12px;line-height:16px;color:var(--dssn-tip-user);animation:dssn-tip-in .18s ease-out}',
        '@media (prefers-reduced-motion:reduce){.dssn-key-bar{transition:none}.dssn-tip{animation:none}.dssn-tip-leave{animation:none}.dssn-notice{animation:none}}',
        // 隐藏官方紧凑回合导航：本插件的钢琴键已是会话内导航的同位替代。
        // 0.1.2 官方右侧竖排"跳转到第 N 轮"小按钮（容器类名带 _marks 哈希后缀，
        // 跨版本可能变；aria-label "跳转到第" 是稳定中文文案，优先用它锁定）。
        'div[class*="_marks"]{display:none!important}',
        'button[aria-label^="跳转到第"]{display:none!important}',
      ]
      const PLUGIN_CSS = CSS_LINES.join('\n')

      const ensureCss = () => {
        if (typeof document === 'undefined') return
        let tag = document.querySelector('style[data-plugin-css="dsh-session-nav/styles"]')
        if (!tag) {
          tag = document.createElement('style')
          tag.dataset.pluginCss = 'dsh-session-nav/styles'
          document.head.appendChild(tag)
        }
        if (tag.dataset.pluginVersion !== CSS_VERSION) {
          tag.textContent = PLUGIN_CSS
          tag.dataset.pluginVersion = CSS_VERSION
        }
      }

      // ── theme ──
      const readDark = () => {
        if (typeof document === 'undefined') return false
        if (document.body && document.body.hasAttribute('data-ds-dark-theme')) return true
        if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches) return true
        return false
      }

      // ── helpers ──
      const findScrollport = () => {
        if (typeof document === 'undefined') return null
        const list = document.querySelectorAll('[data-conversation-scroll]')
        for (const el of list) {
          if (typeof el.getClientRects === 'function' && el.getClientRects().length > 0) return el
        }
        return null
      }

      /** True when the「对话」conversation view is the active one.
       *  DSH 的 conversation.view 是单页多 view 共存：切到轨迹/Agent 调度/
       *  记忆系统时 chat 容器完全不隐藏（DOM 保留、尺寸不变），只是 tab 的
       *  aria-selected 翻转——所以不能靠容器可见性判断，必须读激活 tab。 */
      const isChatViewActive = () => {
        if (typeof document === 'undefined') return true
        const active = document.querySelector('[role="tab"][aria-selected="true"], [role="tab"][data-state="active"], [role="tab"][aria-current="page"]')
        if (!active) return true
        const txt = (active.textContent || '').trim()
        // 激活 tab 不是「对话」→ 非 chat 视图
        if (txt && txt !== '对话' && txt.indexOf('对话') === -1) return false
        return true
      }

      /** True when the scrollport center is occluded by something other than
       *  its own subtree (e.g. settings panel, command palette, modal dialog).
       *  Uses the TOPMOST hit only: elementsFromPoint returns the full stack
       *  top→bottom (including the scrollport's own ancestors — body, app
       *  root — which would wrongly count as "covering"), so we must compare
       *  against stack[0] and stop there. */
      const isScrollportOccluded = (sp) => {
        if (!sp || typeof document === 'undefined') return false
        const rect = sp.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        if (cx <= 0 || cy <= 0 || cx >= window.innerWidth || cy >= window.innerHeight) return true
        const stack = typeof document.elementsFromPoint === 'function'
          ? document.elementsFromPoint(cx, cy)
          : [document.elementFromPoint(cx, cy)].filter(Boolean)
        const top = stack[0]
        if (!top) return false
        return !sp.contains(top) && top !== sp
      }

      /** True when any visible modal/dialog-like panel overlaps the scrollport.
       *  DSH mounts every modal — settings panel, command palette, marketplace
       *  — as an overlay sibling of the conversation scrollport. role=dialog /
       *  aria-modal are the structural markers DSH's own modals (MarketOverlay
       *  etc.) use; class-name heuristics are too broad and matched the
       *  conversation page's own panels. The bounding-box overlap check filters
       *  out dialogs that are open but in a different area of the window. */
      const hasModalOverlapping = (sp) => {
        if (!sp || typeof document === 'undefined') return false
        const rect = sp.getBoundingClientRect()
        const candidates = document.querySelectorAll('[role="dialog"], [aria-modal="true"]')
        for (const m of candidates) {
          if (!(m instanceof HTMLElement)) continue
          if (m === sp || sp.contains(m)) continue
          const r = m.getBoundingClientRect()
          if (r.width < 1 || r.height < 1) continue
          const overlapW = Math.min(rect.right, r.right) - Math.max(rect.left, r.left)
          const overlapH = Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top)
          if (overlapW > 1 && overlapH > 1) return true
        }
        return false
      }

      /** One piano entry per user message (steering included); the tooltip shows
       *  that user message (1 line) plus the model reply of the same turn
       *  (max 3 lines). Model messages never occupy a key of their own. */
      const buildEntries = (snapshot) => {
        if (!snapshot || typeof snapshot !== 'object') return []
        // 0.1.2+ 优先路径：官方 snapshot.navigation.items() 是 TurnNavigator 的
        // 现成投影 [{turn, anchorKey, prompt, response}]，回复文本已由官方
        // responseText() 提取好（chat.order 只含 visible 节点，自己遍历会丢
        // hidden assistant-step 的回复）。此路径存在即用之。
        if (snapshot.navigation && typeof snapshot.navigation.items === 'function') {
          const navItems = snapshot.navigation.items()
          if (Array.isArray(navItems) && navItems.length > 0) {
            const out = []
            for (const item of navItems) {
              if (!item || item.anchorKey === undefined && item.prompt === undefined) continue
              out.push({
                key: item.anchorKey !== undefined ? String(item.anchorKey) : ('turn-' + item.turn),
                userText: (item.prompt || '').trim() || '…',
                modelText: (item.response || '').trim(),
              })
            }
            for (const e of out) e.modelText = clampModelText(e.modelText)
            return out
          }
        }
        const entries = []
        const nodes = []
        const chat = snapshot.chat
        if (chat && Array.isArray(chat.order) && chat.nodes && typeof chat.nodes.get === 'function') {
          for (const key of chat.order) {
            const node = chat.nodes.get(key)
            if (node) nodes.push(node)
          }
        }
        const source = nodes.length > 0 ? nodes : (Array.isArray(snapshot.nodes) ? snapshot.nodes : [])
        let cur = null
        const byTurn = new Map()
        const appendModelText = (entry, blocks) => {
          if (!entry || !Array.isArray(blocks)) return
          for (const b of blocks) {
            if (b && b.kind === 'text' && typeof b.text === 'string' && b.text.trim()) {
              entry.modelText = (entry.modelText ? entry.modelText + ' ' : '') + b.text.replace(/\s+/g, ' ').trim()
            }
          }
        }
        for (const node of source) {
          if (!node || typeof node !== 'object') continue
          const kind = node.kind
          if (kind === 'user' || kind === 'steering') {
            const data = node.data && typeof node.data === 'object' && (node.data.kind === 'user' || node.data.kind === 'steering') ? node.data : node
            const userText = textOfBlocks(data.content)
            cur = {
              key: typeof node.key === 'string' ? node.key : ('u' + (data.seq !== undefined ? data.seq : entries.length)),
              userText: userText || (data.content && data.content.length ? '[附件消息]' : '…'),
              modelText: '',
            }
            entries.push(cur)
            const turn = node.location && node.location.kind === 'turn' && node.location.turn ? node.location.turn.turn : null
            if (turn !== null && turn !== undefined) byTurn.set(turn, cur)
          } else if (kind === 'assistant-step') {
            const data = node.data && typeof node.data === 'object' ? node.data : node
            const entry = (data.turn !== undefined && byTurn.get(data.turn)) || cur
            appendModelText(entry, data.blocks)
          } else if (kind === 'assistant' && cur) {
            // legacy snapshot.nodes path: assistant node directly after its user node
            const data = node.data && typeof node.data === 'object' ? node.data : node
            appendModelText(cur, data.blocks)
          }
        }
        for (const e of entries) e.modelText = clampModelText(e.modelText)
        return entries
      }

      const noopSub = () => () => {}
      const noopSnap = () => null

      // dev diagnostics (harmless; keyed off for production assertions)
      try {
        window.__dssnNavDebug__ = {
          buildEntries,
          findScrollport,
          readDark,
          version: CSS_VERSION,
          /** Live snapshot stats: expose how many chat nodes / user nodes the
           *  conversation view currently holds, so the "only latest messages"
           *  question can be answered from the real data. */
          statsOf: (snapshot) => {
            if (!snapshot || typeof snapshot !== 'object') return { empty: true }
            const chat = snapshot.chat
            const orderLen = chat && Array.isArray(chat.order) ? chat.order.length : 0
            let userNodes = 0
            let steeringNodes = 0
            const kinds = {}
            if (chat && chat.nodes && typeof chat.nodes.values === 'function') {
              for (const node of chat.nodes.values()) {
                if (!node || typeof node !== 'object') continue
                kinds[node.kind] = (kinds[node.kind] || 0) + 1
                if (node.kind === 'user') userNodes++
                else if (node.kind === 'steering') steeringNodes++
              }
            }
            const legacy = snapshot.nodes
            const legacySample = Array.isArray(legacy)
              ? legacy.slice(0, 3).map((n) => ({
                  kind: n && n.kind,
                  keys: n && typeof n === 'object' ? Object.keys(n).slice(0, 12) : null,
                }))
              : null
            const legacyUser = Array.isArray(legacy)
              ? legacy.filter((n) => n && (n.kind === 'user' || n.kind === 'steering')).slice(0, 2).map((n) => ({
                  kind: n.kind,
                  seq: n.seq,
                  keys: Object.keys(n).slice(0, 12),
                  contentKeys: n.content && typeof n.content === 'object' && !Array.isArray(n.content)
                    ? Object.keys(n.content).slice(0, 8)
                    : (Array.isArray(n.content) ? 'array[' + n.content.length + ']' : typeof n.content),
                }))
              : null
            const legacyCounts = Array.isArray(legacy)
              ? legacy.reduce((acc, n) => { if (n && n.kind) acc[n.kind] = (acc[n.kind] || 0) + 1; return acc }, {})
              : null
            // navigation 诊断：items() 返回什么（0.1.2 回复提取排查用）
            let navDiag = null
            try {
              if (snapshot.navigation && typeof snapshot.navigation.items === 'function') {
                const nav = snapshot.navigation.items()
                navDiag = {
                  type: typeof nav,
                  isArray: Array.isArray(nav),
                  len: Array.isArray(nav) ? nav.length : null,
                  sample: Array.isArray(nav) ? nav.slice(0, 2).map((i) => ({
                    turn: i && i.turn,
                    promptLen: i && i.prompt ? i.prompt.length : null,
                    respLen: i && i.response ? i.response.length : null,
                    respHead: i && i.response ? String(i.response).slice(0, 40) : null,
                  })) : null,
                }
              } else {
                navDiag = { type: snapshot.navigation ? typeof snapshot.navigation : 'no-navigation' }
              }
            } catch (e) { navDiag = { err: String(e && e.message || e) } }
            return {
              orderLen,
              userNodes,
              steeringNodes,
              kinds,
              legacyNodes: Array.isArray(legacy) ? legacy.length : 0,
              legacySample,
              legacyUser,
              legacyCounts,
              navDiag,
            }
          },
        }
      } catch (err) { /* ignore */ }

      // ── the overlay component ──
      function PianoNavOverlay(props) {
        try {
          return PianoNavOverlayInner(props)
        } catch (err) {
          console.error('[dsh-session-nav] render error:', err)
          return React.createElement('div', {
            className: 'dssn-root dssn-panic',
            'data-state': 'error',
            style: {
              position: 'absolute', top: 8, left: 8, zIndex: 2147483000,
              background: '#c62828', color: '#fff', font: '11px/15px monospace',
              padding: '6px 10px', borderRadius: 6, maxWidth: 420,
              whiteSpace: 'pre-wrap', pointerEvents: 'auto',
            },
          }, 'dsh-session-nav error: ' + String((err && err.message) || err))
        }
      }

      function PianoNavOverlayInner(props) {
        const useSessions = props.useSessions
        const currentId = useSessions ? useSessions((s) => (s && s.current) || undefined) : undefined

        // snapshot 来源：优先 uiConversation 的 chat view（0.1.2+ 含
        // navigation 投影，官方 TurnNavigator 同源，回复文本可用）；
        // fallback 到 session.getSnapshot()（0.1.2 前 / 无 uiConversation）。
        let snapshot = null
        let subscribeSnap = noopSub
        let getSnap = noopSnap
        const snapDiag = { hasCtx: !!ctxRef, hasCurrent: !!currentId }
        try {
          if (currentId && ctxRef) {
            snapDiag.hasUiConv = !!(ctxRef.uiConversation && typeof ctxRef.uiConversation.binding === 'function')
            let convBinding = null
            try {
              if (ctxRef.uiConversation && typeof ctxRef.uiConversation.binding === 'function') {
                convBinding = ctxRef.uiConversation.binding(currentId)
              }
            } catch (err) { convBinding = null; snapDiag.bindErr = String(err && err.message || err) }
            snapDiag.hasConvBinding = !!convBinding
            if (convBinding) {
              snapDiag.convKeys = Object.keys(convBinding).slice(0, 15)
              snapDiag.hasTarget = typeof convBinding.target === 'function'
              snapDiag.hasViews = !!(convBinding.views && typeof convBinding.views.get === 'function')
            }
            if (convBinding && typeof convBinding.target === 'function' && convBinding.viewStore && typeof convBinding.viewStore.get === 'function') {
              // viewStore.get('chat') 直接返回 chat 完整 snapshot（实测 keys:
              // order/nodes/locations/navigation/timeline/legacy），非 view 条目。
              const chatView = convBinding.viewStore.get('chat')
              snapDiag.chatViewFound = !!chatView
              if (chatView) {
                snapDiag.chatViewKeys = Object.keys(chatView).slice(0, 15)
                snapDiag.snapHasNav = !!(chatView.navigation && typeof chatView.navigation.items === 'function')
                const chatTarget = convBinding.target('chat')
                snapDiag.hasTargetSub = !!(chatTarget && typeof chatTarget.subscribe === 'function')
                if (chatTarget && typeof chatTarget.subscribe === 'function' && snapDiag.snapHasNav) {
                  subscribeSnap = chatTarget.subscribe.bind(chatTarget)
                  getSnap = () => chatView
                }
              }
            }
            if (getSnap === noopSnap && ctxRef.sessions) {
              const binding = ctxRef.sessions.binding(currentId)
              const session = binding ? binding.session : null
              if (session && typeof session.subscribe === 'function' && typeof session.getSnapshot === 'function') {
                subscribeSnap = session.subscribe.bind(session)
                getSnap = session.getSnapshot.bind(session)
              }
            }
          }
        } catch (err) {
          snapshot = null
        }
        const liveSnapshot = useSyncExternalStore(subscribeSnap, getSnap, getSnap)
        snapshot = liveSnapshot
        const windowEntries = useMemo(() => buildEntries(snapshot), [snapshot])

        // ── full-history navigation keys ──
        // The browser snapshot is a LOADED WINDOW (virtualized history): for a
        // long session it holds only the recent slice. The host half reads the
        // complete on-disk log (one entry per REAL user question) through
        // ── chat-view 可见性：只在「对话」视图渲染钢琴键。
        // 官方 conversation.view 是 list slot（对话/轨迹/Agent 调度/记忆系统），
        // /_dsh/session-nav/questions; we merge those with the live window so
        // the bar shows every user question of the session, not just the tail.
        const [allQuestions, setAllQuestions] = useState(null)
        const questionsVersion = useRef(0)
        useEffect(() => {
          let cancelled = false
          const version = ++questionsVersion.current
          if (!currentId) {
            if (!cancelled) setAllQuestions(null)
            return
          }
          setAllQuestions((prev) => (prev && prev.sessionId === currentId ? prev : null))
          let retryTimer = 0
          let attempts = 0
          const doFetch = () => {
            fetch('/_dsh/session-nav/questions?sessionId=' + encodeURIComponent(currentId), { headers: { accept: 'application/json' } })
              .then((res) => (res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status))))
              .then((body) => {
                if (cancelled || version !== questionsVersion.current) return
                const list = body && Array.isArray(body.questions) ? body.questions : []
                // keep id+seq+text; text capped for the tooltip budget later
                setAllQuestions({ sessionId: currentId, list })
              })
              .catch((err) => {
                if (cancelled || version !== questionsVersion.current) return
                // 启动瞬间会话文件可能尚未落盘（readFrom 抛 "session not found"），
                // 延时重试而非一次性放弃：文件落盘后即可读到完整历史。
                if (attempts < 2) {
                  attempts += 1
                  retryTimer = setTimeout(doFetch, 500 * attempts)
                  return
                }
                console.warn('[dsh-session-nav] questions fetch failed:', err && err.message ? err.message : err)
                setAllQuestions(null)
              })
          }
          doFetch()
          return () => { cancelled = true; clearTimeout(retryTimer) }
        }, [currentId])

        // Merge: full-history questions (authoritative, ordered by seq) with
        // the live window. Live entries not present in the full list (new
        // messages since the log read) append at the end. Dedup uses the
        // normalized message identity so `13:input-message<uuid>` live keys
        // collapse onto the full-list raw-uuid keys.
        const entries = useMemo(() => {
          const full = allQuestions && allQuestions.sessionId === currentId ? allQuestions.list : null
          if (!full || full.length === 0) return windowEntries
          // index live entries by identity so full keys can borrow the
          // model-reply preview of a matching live entry when in-window
          const liveById = new Map()
          for (const e of windowEntries) {
            const ident = keyIdentity(e.key)
            if (ident) liveById.set(ident, e)
          }
          const seen = new Set()
          const merged = full.map((q) => {
            const id = q.id || ('seq' + q.seq)
            const ident = keyIdentity(id)
            const live = liveById.get(ident) || (ident && ident.length >= 8 ? [...liveById.values()].find((e) => typeof e.key === 'string' && e.key.endsWith(ident)) : undefined)
            if (ident) seen.add(ident)
            return {
              key: id,
              seq: q.seq,
              userText: q.text || '…',
              modelText: live && live.modelText ? live.modelText : '',
            }
          })
          for (const e of windowEntries) {
            const ident = keyIdentity(e.key)
            if (ident && seen.has(ident)) continue
            if (ident) seen.add(ident)
            merged.push(e)
          }
          return merged
        }, [allQuestions, currentId, windowEntries])

        // live diagnostics: publish snapshot stats for CDP inspection
        try {
          window.__dssnNavDebug__.stats = window.__dssnNavDebug__.statsOf(snapshot)
          window.__dssnNavDebug__.snapDiag = snapDiag
          window.__dssnNavDebug__.entryCount = entries.length
          window.__dssnNavDebug__.fullCount = allQuestions && allQuestions.sessionId === currentId ? allQuestions.list.length : null
        } catch (err) { /* ignore */ }

        const [dark, setDark] = useState(readDark)
        const [hover, setHover] = useState(null)
        const [layout, setLayout] = useState({ hidden: true })
        const [tipExit, setTipExit] = useState(null)
        // Transient user-facing notice for degraded jumps (C7): shown briefly
        // after a failed / unsupported history paging, then auto-cleared.
        const [notice, setNotice] = useState(null)
        const noticeTimerRef = useRef(0)
        const showNotice = (text) => {
          setNotice(text)
          if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
          noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3200)
        }
        useEffect(() => () => {
          if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
        }, [])
        const lastHoverRef = useRef(null)
        const visibleLoggedRef = useRef(false)
        const missingLoggedRef = useRef(0)

        const entriesRef = useRef(entries)
        useEffect(() => { entriesRef.current = entries }, [entries])

        const rafRef = useRef(0)
        const computeRef = useRef(null)
        // Anchor-row cache (key → element): one querySelectorAll pass per
        // recompute instead of a per-key querySelector. Rows may be recycled by
        // the virtualized list — entries are validated via isConnected.
        const rowCacheRef = useRef(null)
        // Lazily attached ResizeObserver on the scrollport (see attachObserver).
        const roRef = useRef(null)
        const roAttachedRef = useRef(false)

        // sameLayout lives in lib/shared.js (unit-tested); keep a local alias
        // for readability. It is always defined — the fallback above covers
        // contexts where require('./shared.js') is unavailable.
        const sameLayoutLocal = sameLayout

        const compute = () => {
          const list = entriesRef.current || []
          const sp = findScrollport()
          if (!sp || list.length === 0 || !isChatViewActive() || isScrollportOccluded(sp) || hasModalOverlapping(sp)) {
            setLayout((prev) => (prev && prev.hidden ? prev : { hidden: true }))
            return
          }
          attachObserver()
          attachShellObserver()
          const spRect = sp.getBoundingClientRect()
          if (spRect.width < 1 || spRect.height < 1) {
            setLayout((prev) => (prev && prev.hidden ? prev : { hidden: true }))
            return
          }
          const composer = sp.querySelector('[data-composer-seat]')
          const bottomEdge = composer ? Math.min(composer.getBoundingClientRect().top, spRect.bottom) : spRect.bottom
          const top = spRect.top + PAD
          const height = Math.max(60, bottomEdge - top - PAD)
          const left = spRect.left + BAR_LEFT_OFFSET

          // Keys form one compact cluster: fixed PITCH center spacing,
          // vertically centered in the strip. Only when the cluster would
          // overflow the strip does the pitch compress down to MIN_PITCH.
          // The cluster never scatters across the full strip — the bar reads
          // as one contiguous run of keys, each mapping to one user message.
          // Pure geometry lives in lib/shared.js (unit-tested); computeCluster
          // is guaranteed present via the fallback above.
          const cluster = computeCluster(list.length, top, height)
          const pitch = cluster.pitch
          const ys = cluster.ys
          const n = list.length

          // active = the entry whose message row is currently in view.
          // Rows resolved through the cache: one querySelectorAll collects all
          // anchor rows (O(n)) instead of a per-key querySelector (O(n²) with
          // forced synchronous layouts).
          const scrollTop = sp.scrollTop
          const scrollH = Math.max(1, sp.scrollHeight)
          let active = n - 1
          let found = false
          if (!rowCacheRef.current) rowCacheRef.current = new Map()
          const rowCache = rowCacheRef.current
          // Drop unmounted rows (recycled by virtual scrolling) and add new ones.
          const liveRows = sp.querySelectorAll('[data-chat-anchor-key]')
          const seen = new Set()
          for (const el of liveRows) {
            const k = el.dataset.chatAnchorKey
            if (k === undefined) continue
            seen.add(k)
            if (rowCache.get(k) !== el) rowCache.set(k, el)
          }
          for (const [k, el] of rowCache) {
            if (!seen.has(k) || !el.isConnected) rowCache.delete(k)
          }
          // Sequential scan of cached rows (first visible row); skip missing.
          for (let i = 0; i < n; i++) {
            const row = rowCache.get(list[i].key)
            if (!row) continue
            const rr = row.getBoundingClientRect()
            if (rr.bottom > spRect.top + 8) {
              active = i
              found = true
              break
            }
          }
          if (!found) {
            active = Math.min(n - 1, Math.max(0, Math.round(((scrollTop + spRect.height / 2) / scrollH) * n)))
          }
          const next = {
            hidden: false,
            left: Math.round(left * 2) / 2,
            top: Math.round(top * 2) / 2,
            height: Math.round(height),
            ys: ys.map((y) => Math.round(y * 2) / 2),
            active,
          }
          // one-shot console diagnostics (never affect rendering)
          if (!next.hidden && !visibleLoggedRef.current) {
            visibleLoggedRef.current = true
            console.info('[dsh-session-nav] piano bar visible: entries=' + list.length + ' pitch=' + Math.round(pitch * 10) / 10)
          } else if (next.hidden && list.length > 0 && Date.now() - missingLoggedRef.current > 10000) {
            missingLoggedRef.current = Date.now()
            console.warn('[dsh-session-nav] entries present but conversation scrollport not found — retrying')
          }
          setLayout((prev) => (sameLayoutLocal(prev, next) ? prev : next))
        }
        computeRef.current = compute

        const schedule = () => {
          if (rafRef.current) return
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0
            if (computeRef.current) computeRef.current()
          })
        }

        // Lazily attach the scrollport ResizeObserver: compute() invokes this
        // (idempotently) on every run, so whenever the scrollport mounts late
        // (session view switches, late renders) any recompute trigger re-attaches
        // the observer — no perpetual timer needed. When switching sessions the
        // scrollport is rebuilt as a new element: if the observed target changed,
        // unobserve the old one (and its parent) before observing the new one.
        const attachObserver = () => {
          const ro = roRef.current
          if (!ro) return
          const sp = findScrollport()
          if (!sp) return
          if (roAttachedRef.current === sp) return
          if (roAttachedRef.current) {
            try { ro.unobserve(roAttachedRef.current) } catch (err) { /* ignore */ }
            if (roAttachedRef.current.parentElement) {
              try { ro.unobserve(roAttachedRef.current.parentElement) } catch (err) { /* ignore */ }
            }
          }
          roAttachedRef.current = sp
          try { ro.observe(sp) } catch (err) { /* already observed / detached */ }
          if (sp.parentElement) {
            try { ro.observe(sp.parentElement) } catch (err) { /* already observed / detached */ }
          }
        }

        // Geometry tracking — event-driven, no background churn:
        //   scroll / resize / scrollport size changes → recompute (rAF-merged)
        //   entries signature change (user message set) → recompute
        // No document.body MutationObserver and no perpetual interval — the
        // live UI mutates the DOM constantly (streaming tokens, cursor,
        // animations) and reacting to every mutation burns ~50% of a core in
        // the renderer process. The scrollport itself may mount after the
        // root-scope overlay; attachObserver above heals lazily.
        useEffect(() => {
          const onScroll = () => schedule()
          document.addEventListener('scroll', onScroll, { capture: true, passive: true })
          window.addEventListener('resize', onScroll)
          if (typeof ResizeObserver !== 'undefined' && !roRef.current) {
            roRef.current = new ResizeObserver(() => schedule())
          }
          attachObserver()
          schedule()
          return () => {
            document.removeEventListener('scroll', onScroll, { capture: true })
            window.removeEventListener('resize', onScroll)
            if (roRef.current) {
              roRef.current.disconnect()
              roRef.current = null
              roAttachedRef.current = null
            }
          }
        }, [])

        // Modal/panel mount/unmount does not change the scrollport size, so
        // the ResizeObserver above stays silent when the settings panel
        // opens. Observe the shared overlay root (every DSH modal mounts
        // there) for child list changes — cheap because DSH swaps panels
        // rarely, never per-keystroke. Lazy + idempotent, mirroring
        // attachObserver: compute() re-runs the attach so a late-mounting
        // overlay still gets observed.
        const shellMoRef = useRef(null)
        const bodyMoRef = useRef(null)
        const modalOpenRef = useRef(false)
        // conversation.view 切 Tab：官方多 view 共存（chat DOM 不隐藏），
        // 只能靠「激活 tab 是否为对话」判断。记录上次值，仅翻转时 schedule。
        const chatViewActiveRef = useRef(
          typeof document === 'undefined' ? true : isChatViewActive(),
        )
        const attachShellObserver = () => {
          if (!shellMoRef.current && typeof MutationObserver !== 'undefined') {
            const overlay = document.querySelector('[data-shell-overlay]')
            if (overlay) {
              shellMoRef.current = new MutationObserver(() => schedule())
              shellMoRef.current.observe(overlay, { childList: true })
            }
          }
          // The settings page itself is `ui-settings-general`'s SettingsRoot:
          // a `position: fixed; inset: 0; z-index: 1000` overlay mounted under
          // the sidebar (`sidebar.settings` slot) — NOT under `[data-shell-overlay]`
          // and NOT in the details column. Its panel carries
          // `role="dialog" aria-modal="true"`, the exact marker DSH's own shell
          // CSS keys off (`html:has([aria-modal="true"])`). Watching the overlay
          // root or the details column never fires on settings open, so the
          // strip keeps its stale `live` state. Observe the whole body for
          // `[aria-modal="true"]` mount/unmount instead — this is the one
          // deterministic signal that fires for every full-screen modal DSH
          // raises (settings, and any future dialog using the same chrome).
          if (!bodyMoRef.current && typeof MutationObserver !== 'undefined') {
            bodyMoRef.current = new MutationObserver(() => {
              const hasModal = !!document.querySelector('[aria-modal="true"]')
              // Only react when the modal state actually flips: streaming
              // tokens mutate the body every frame, and recomputing on each
              // would burn the renderer. Recompute on open (hide the strip)
              // and on close (restore it).
              if (hasModal !== modalOpenRef.current) {
                modalOpenRef.current = hasModal
                schedule()
              }
              // conversation.view Tab 切换：官方多 view 共存（切到轨迹/Agent
              // 调度/记忆系统时 chat DOM 完全不隐藏，只切 tab aria-selected）。
              // 必须监听激活 tab 翻转：非「对话」时 compute 走 hidden 分支隐藏
              // 钢琴键。与 modal 同模式，仅翻转时 schedule。
              const chatActive = isChatViewActive()
              if (chatActive !== chatViewActiveRef.current) {
                chatViewActiveRef.current = chatActive
                schedule()
              }
            })
            // childList（view 挂载/卸载）+ attributes（tab aria-selected 翻转）
            bodyMoRef.current.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['aria-selected', 'data-state', 'aria-current'],
            })
          }
        }
        useEffect(() => () => {
          if (shellMoRef.current) {
            try { shellMoRef.current.disconnect() } catch (err) { /* ignore */ }
            shellMoRef.current = null
          }
          if (bodyMoRef.current) {
            try { bodyMoRef.current.disconnect() } catch (err) { /* ignore */ }
            bodyMoRef.current = null
          }
        }, [])

        // Recompute layout only when the user-message set (entries signature)
        // changes — streaming model output only alters modelText and must not
        // re-layout the piano keys.
        const entriesSig = useMemo(
          () => entries.map((e) => e.key + '|' + e.userText.length).join(','),
          [entries],
        )
        useEffect(() => { schedule() }, [entriesSig])

        // theme tracking
        useEffect(() => {
          const applyTheme = () => setDark(readDark())
          let mo = null
          if (typeof MutationObserver !== 'undefined') {
            mo = new MutationObserver(applyTheme)
            mo.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
          }
          let mq = null
          if (typeof matchMedia !== 'undefined') {
            mq = matchMedia('(prefers-color-scheme: dark)')
            if (typeof mq.addEventListener === 'function') mq.addEventListener('change', applyTheme)
          }
          applyTheme()
          return () => {
            if (mo) mo.disconnect()
            if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', applyTheme)
          }
        }, [])

        // hover index can drift out of range when messages stream in
        const safeHover = hover != null && entries[hover] ? hover : null

        // Soft fade-out: keep the tip rendered with a leave animation when the
        // pointer leaves, then unmount it after the animation completes.
        useEffect(() => {
          if (safeHover != null) {
            lastHoverRef.current = safeHover
            setTipExit(null)
            return
          }
          const leaving = lastHoverRef.current
          if (leaving == null) return
          lastHoverRef.current = null
          setTipExit(leaving)
          const t = window.setTimeout(() => {
            setTipExit((cur) => (cur === leaving ? null : cur))
          }, 220)
          return () => window.clearTimeout(t)
        }, [safeHover])

        /** Resolve the row whose data-chat-anchor-key matches the entry key.
         *  Full-history keys are raw message ids (uuid or seq-based); DOM keys
         *  are `13:input-message<uuid>` — match by exact key or trailing uuid
         *  suffix when the entry key is at least 8 chars. */
        const findRowForKey = (sp, key) => {
          if (!sp || !key) return null
          for (const r of sp.querySelectorAll('[data-chat-anchor-key]')) {
            const k = r.dataset.chatAnchorKey
            if (k === key) return r
            if (key.length >= 8 && typeof k === 'string' && k.endsWith(key)) return r
          }
          return null
        }

        const jumpTo = async (entry) => {
          const sp = findScrollport()
          if (!sp) return
          // 1. Row already rendered in the loaded window: scroll straight to it.
          const row = findRowForKey(sp, entry.key)
          if (row) {
            try { row.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch (err) { row.scrollIntoView() }
            return
          }
          // 2. The message lies outside the loaded window (virtualized
          //    history): the chat view does NOT auto-prepend when you reach
          //    scrollTop 0 — it only loads older pages via session.loadOlder()
          //    (the same path as the "加载更早" paging button). Pull pages
          //    until the target row renders (bounded), then scroll to it.
          const sessionBinding = currentId ? ctxRef?.sessions?.binding(currentId) : null
          const session = sessionBinding ? sessionBinding.session : null
          if (!session || typeof session.loadOlder !== 'function') {
            // No paging handle: degrade to the previous strip-top behavior,
            // with a one-shot user-facing notice so the jump never looks
            // silently broken.
            try { sp.scrollTo({ top: 0, behavior: 'smooth' }) } catch (err) { sp.scrollTop = 0 }
            showNotice('当前环境不支持历史翻页，已跳到最早可见消息')
            return
          }
          let attempts = 0
          const MAX_PAGES = 200
          let lastScrollHeight = -1
          while (attempts < MAX_PAGES) {
            attempts++
            try {
              await session.loadOlder()
            } catch (err) {
              console.warn('[dsh-session-nav] loadOlder failed:', err && err.message ? err.message : err)
              showNotice('历史加载失败，已跳到最早可见消息')
              break
            }
            const landed = findRowForKey(sp, entry.key)
            if (landed) {
              // The row was just prepended: React may not have committed the
              // new layout yet, so a synchronous scrollIntoView would target a
              // stale position and smooth scrolling gets cancelled by the
              // layout shift. Wait one frame, then scroll by an explicit
              // offset so the target row lands at the strip top.
              await new Promise((resolve) => {
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
                else resolve()
              })
              const spRect = sp.getBoundingClientRect()
              const rowRect = landed.getBoundingClientRect()
              const targetTop = sp.scrollTop + (rowRect.top - spRect.top) - 8
              try { sp.scrollTo({ top: targetTop, behavior: 'smooth' }) } catch (err2) { sp.scrollTop = targetTop }
              return
            }
            if (sp.scrollHeight === lastScrollHeight) {
              // scrollHeight stopped growing: no more history to load.
              break
            }
            lastScrollHeight = sp.scrollHeight
          }
          // 3. History exhausted without the row: fall back to the strip top.
          try { sp.scrollTo({ top: 0, behavior: 'smooth' }) } catch (err) { sp.scrollTop = 0 }
          showNotice('未找到该消息，已跳到最早可见消息')
        }

        let stateAttr = 'empty'
        if (entries.length > 0 && layout && !layout.hidden) stateAttr = 'live'
        else if (entries.length > 0) stateAttr = 'waiting'
        if (entries.length === 0) {
          return React.createElement('div', {
            className: 'dssn-root',
            'data-state': 'empty',
            style: { display: 'none' },
          })
        }
        if (!layout || layout.hidden) {
          return React.createElement('div', {
            className: 'dssn-root',
            'data-state': 'waiting',
            style: { display: 'none' },
          })
        }

        const tipIndex = safeHover != null ? safeHover : tipExit

        // Keyboard navigation (C8): the key strip is one tab stop; arrow
        // keys move the hover/focus index so the bar is fully usable without
        // a mouse. Enter/Space on a focused key jumps (native button
        // behavior), so we only need the movement keys here.
        const onKeysKeyDown = (event) => {
          const dir = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
            : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1
              : 0
          if (dir === 0) return
          event.preventDefault()
          const base = safeHover != null ? safeHover : (layout && layout.active != null ? layout.active : 0)
          const next = Math.min(entries.length - 1, Math.max(0, base + dir))
          if (next !== safeHover) {
            setHover(next)
            setTipExit(null)
            lastHoverRef.current = next
          }
        }

        return React.createElement('div', { className: 'dssn-root', 'data-state': stateAttr, 'data-theme': dark ? 'dark' : 'light' },
          React.createElement('div',
            {
              className: 'dssn-keys',
              role: 'group',
              'aria-label': '会话消息导航',
              style: { left: layout.left, top: layout.top, height: layout.height },
              onMouseLeave: () => setHover(null),
              onKeyDown: onKeysKeyDown,
            },
            entries.map((entry, i) => {
              const y = layout.ys[i]
              if (y == null) return null
              const d = safeHover == null ? 4 : Math.min(Math.abs(i - safeHover), 4)
              const isActive = safeHover == null && i === layout.active
              const isHover = i === safeHover
              return React.createElement('button',
                {
                  key: entry.key + ':' + i,
                  type: 'button',
                  tabIndex: -1,
                  className: 'dssn-key' + (isActive ? ' dssn-key-active' : '') + (isHover ? ' dssn-key-hover' : ''),
                  'data-offset': String(d),
                  style: { top: y - KEY_HIT / 2 },
                  'aria-label': entry.userText,
                  'aria-current': isActive ? 'true' : undefined,
                  onMouseEnter: () => setHover(i),
                  onFocus: () => setHover(i),
                  onClick: () => jumpTo(entry),
                },
                React.createElement('span', { className: 'dssn-key-bar' }),
              )
            }),
          ),
          tipIndex != null && entries[tipIndex] && layout.ys[tipIndex] != null
            ? React.createElement('div',
                {
                  className: 'dssn-tip' + (safeHover == null ? ' dssn-tip-leave' : ''),
                  // layout.ys is the key's anchor y relative to the .dssn-keys
                  // container (which itself sits at layout.top inside the
                  // overlay root), so the tip — rendered directly under the
                  // overlay root — must add layout.top back. The key's visual
                  // center sits KEY_HIT/2 above that anchor (the CSS
                  // translateY(-50%) on the tip then centers it there).
                  style: { left: layout.left + KEY_MAX + TIP_GAP, top: layout.top + layout.ys[tipIndex] - KEY_HIT / 2 },
                },
                // 轮次徽标：第 N 轮（N = 该键在全部用户消息中的序号，1 起）
                React.createElement('div', { className: 'dssn-tip-turn' }, '第 ' + (tipIndex + 1) + ' 轮'),
                entries[tipIndex].userText
                  ? React.createElement('div', { className: 'dssn-tip-user' }, entries[tipIndex].userText)
                  : null,
                entries[tipIndex].modelText
                  ? React.createElement('div', { className: 'dssn-tip-model' }, entries[tipIndex].modelText)
                  : null,
              )
            : null,
          notice
            ? React.createElement('div',
                {
                  className: 'dssn-notice',
                  'data-testid': 'dssn-notice',
                  role: 'status',
                  style: { left: layout.left + KEY_MAX + TIP_GAP, top: layout.top },
                },
                notice,
              )
            : null,
        )
      }

      const name = 'dsh-session-nav'
      const inject = ['slots', 'sessions', 'uiConversation']

      function apply(ctx) {
        ctxRef = ctx
        ensureCss()
        let dispose = null
        try {
          if (ctx.slots && typeof ctx.slots.inject === 'function') {
            dispose = ctx.slots.inject('shell.overlay', () => {
              try {
                window.__dssnNavDebug__.registered = true
              } catch (err) { /* ignore */ }
              return ctx.slots.register(
                { name: 'shell.overlay', id: PLUGIN_ID, order: 40 },
                PianoNavOverlay,
              )
            })
            try {
              window.__dssnNavDebug__.applied = true
            } catch (err) { /* ignore */ }
          } else {
            try { window.__dssnNavDebug__.applyError = 'no slots service' } catch (err) { /* ignore */ }
            console.warn('[dsh-session-nav] slots service unavailable — piano bar disabled')
          }
        } catch (err) {
          try { window.__dssnNavDebug__.applyError = String((err && err.message) || err) } catch (err2) { /* ignore */ }
          console.warn('[dsh-session-nav] shell.overlay registration failed:', err)
        }
        return () => {
          ctxRef = null
          if (dispose) dispose()
        }
      }

      return { name, inject, apply }
    },
  })
})()

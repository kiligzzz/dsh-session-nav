// @kiligzzz/dsh-session-nav — shared pure helpers.
//
// Extracted from the host (index.js) and browser (lib/client.js) halves so
// the text-extraction and truncation logic is defined once, imported by
// both sides, and directly unit-testable without a DOM or a session store.

/** Extract plain text from one message-content block. */
export function blockText(block) {
  if (!block || typeof block !== 'object') return undefined
  if (typeof block.text === 'string' && block.text.length > 0) return block.text
  if (typeof block.content === 'string' && block.content.length > 0) return block.content
  return undefined
}

/** Flatten a message content payload (array of blocks or a single block)
 *  into one normalized whitespace-collapsed string. */
export function textOfBlocks(blocks) {
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

/** Model-preview budget: ~3 lines of 12px/18px text in the 280px tooltip.
 *  Width-model truncation (CJK = 1 unit, Latin/digits = 0.5) guarantees the
 *  preview never exceeds 3 lines even where -webkit-line-clamp is inert;
 *  the CSS clamp adds the line-level ellipsis where supported. */
export const MODEL_TEXT_BUDGET = 55

export function clampModelText(text) {
  if (!text) return ''
  let units = 0
  let idx = 0
  for (; idx < text.length; idx++) {
    const code = text.charCodeAt(idx)
    const w = code > 0x2E7F ? 1 : 0.5
    if (units + w > MODEL_TEXT_BUDGET) break
    units += w
  }
  if (idx >= text.length) return text
  return text.slice(0, Math.max(0, idx - 1)) + '…'
}

/** Normalize a chat-node key to the raw message identity so full-list
 *  keys (raw uuid / seq) and live-window keys (`13:input-message<uuid>`)
 *  can be compared. Returns null for keys without a message identity. */
export function keyIdentity(key) {
  if (typeof key !== 'string' || key.length === 0) return null
  const m = key.match(/input-message([0-9a-fA-F-]{8,})/)
  if (m) return m[1]
  return key
}

// Piano geometry — pixel measurements from the reference visual spec:
// 2px bars, 6px base, 26px hovered, fixed 10px pitch, vertically centered
// cluster. Hover ladder 26/20/14/10.
export const KEY_MAX = 26
export const KEY_BASE = 6
export const KEY_HIT = 10
export const PITCH = 10   // fixed center-to-center spacing between keys
export const MIN_PITCH = 6 // densest pitch when the cluster overflows the strip
export const PAD = 10

/** One compact cluster of keys: fixed PITCH center spacing, vertically
 *  centered in the strip. Only when the cluster would overflow the strip
 *  height does the pitch compress down to MIN_PITCH. Returns { pitch, ys }
 *  where ys holds each key's vertical center (page-relative). */
export function computeCluster(entryCount, stripTop, stripHeight) {
  if (!Number.isFinite(entryCount) || entryCount <= 0) {
    return { pitch: PITCH, ys: [] }
  }
  const n = Math.floor(entryCount)
  const avail = Math.max(1, stripHeight - 2 * PAD)
  const pitch = n * PITCH <= avail ? PITCH : Math.max(MIN_PITCH, avail / n)
  const clusterH = n * pitch
  const startY = stripTop + (stripHeight - clusterH) / 2 + pitch / 2
  const ys = new Array(n)
  for (let i = 0; i < n; i++) ys[i] = startY + pitch * i
  return { pitch, ys }
}

/** Deep-compare two layout snapshots for the React state bail-out. */
export function sameLayout(a, b) {
  if (!a || !b) return false
  if (a.hidden !== b.hidden || a.left !== b.left || a.top !== b.top || a.height !== b.height || a.active !== b.active) return false
  if (!Array.isArray(a.ys) || !Array.isArray(b.ys) || a.ys.length !== b.ys.length) return false
  for (let i = 0; i < a.ys.length; i++) if (a.ys[i] !== b.ys[i]) return false
  return true
}

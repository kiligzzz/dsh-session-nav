// @kiligzzz/dsh-session-nav — host half.
//
// The piano navigation bar renders in the browser half (lib/client.js), but
// the conversation snapshot the browser sees is a LOADED WINDOW: DSH's chat
// view pulls history on demand, so `legacy.nodes` holds only the recent slice
// (e.g. 3 user turns out of 108 in a long session). The full history lives in
// the on-disk session log, which this half reads through the official
// `sessionPersistence` service and exposes over a same-origin route so the
// browser can build one navigation key per REAL user question.
//
// The same-origin route pattern mirrors @kiligzzz/dsh-session-archive:
// ctx.inject(['webServer']) registers an exact-path handler.

import { blockText, textOfBlocks, clampModelText } from './lib/shared.js'

export const name = '@kiligzzz/dsh-session-nav'

export const inject = ['sessions', 'sessionPersistence']

/** Exact route used by the browser half. */
export const ROUTE = '/_dsh/session-nav/questions'

/** Response helpers (same shape as session-archive). */
function responseJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Read every REAL user question of a session from its on-disk log, plus the
 * model reply of the same turn where the log has one.
 * Filters by source.kind === 'user' so agent-injected steering / plugin /
 * skill-catalog messages never become navigation keys. Purely observational.
 */
export async function listUserQuestions(sessionId, persistence, signal) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new TypeError('sessionId must be a non-empty string')
  }
  const { meta, events } = await persistence.readFrom(sessionId, 0, signal)
  const questions = []
  let pending = null // user question awaiting its turn's assistant reply
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const type = event.type
    const data = event.data && typeof event.data === 'object' ? event.data : {}
    if (type === 'user/message') {
      const source = data.source && typeof data.source === 'object' ? data.source : {}
      if (source.kind !== 'user') { pending = null; continue }
      const blocks = data.content
      const text = (Array.isArray(blocks) ? blocks : [blocks])
        .map(blockText)
        .filter((t) => typeof t === 'string' && t.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text.length === 0) { pending = null; continue }
      pending = {
        seq: event.seq,
        id: typeof data.id === 'string' ? data.id : String(event.seq),
        text,
        response: '',
      }
      questions.push(pending)
    } else if (type === 'assistant/message' && pending !== null) {
      // 同一 turn 的模型回复：assistant/message 的 content 是 blocks
      const content = data.message && typeof data.message === 'object'
        ? data.message.content
        : (data.content ?? undefined)
      const reply = textOfBlocks(Array.isArray(content) ? content : (content !== undefined ? [content] : []))
      if (reply) pending.response = reply
    } else if (type === 'turn/end' || type === 'steering/message' || type === 'user/message') {
      // turn 结束或新用户消息：当前 pending 不再追加
      if (type !== 'user/message') pending = null
    }
  }
  for (const q of questions) q.response = clampModelText(q.response)
  return { title: typeof meta.title === 'string' ? meta.title : undefined, questions }
}

/** Parse the session id query param. */
function parseSessionId(req) {
  const url = new URL(req.url ?? '/', 'http://x')
  return url.searchParams.get('sessionId') ?? undefined
}

/** Plugin entry. */
export function apply(ctx) {
  if (ctx.logger && typeof ctx.logger.info === 'function') {
    ctx.logger.info('[dsh-session-nav] host half active — user-question route ready')
  }
  let disposeRoutes = () => {}
  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.webServer
    const detach = server.register({
      kind: 'exact',
      path: ROUTE,
      handler: (req, res) => {
        const sessionId = parseSessionId(req)
        if (sessionId === undefined) {
          responseJson(res, 400, { ok: false, error: { code: 'missing-session-id', message: 'sessionId query parameter is required' } })
          return
        }
        listUserQuestions(sessionId, ctx.sessionPersistence)
          .then((result) => responseJson(res, 200, { ok: true, ...result }))
          .catch((error) => {
            const message = error && error.message ? error.message : String(error)
            ctx.logger?.warn?.('[dsh-session-nav] questions route failed:', message)
            responseJson(res, 500, { ok: false, error: { code: 'read-failed', message } })
          })
      },
    })
    disposeRoutes = detach
    webCtx.effect(() => detach, 'dsh-session-nav: questions route')
  })
  return () => { disposeRoutes() }
}

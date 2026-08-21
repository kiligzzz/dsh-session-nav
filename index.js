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

import { blockText } from './lib/shared.js'

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
 * Read every REAL user question of a session from its on-disk log.
 * Filters by source.kind === 'user' so agent-injected steering / plugin /
 * skill-catalog messages never become navigation keys. Purely observational.
 */
export async function listUserQuestions(sessionId, persistence, signal) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new TypeError('sessionId must be a non-empty string')
  }
  const { meta, events } = await persistence.readFrom(sessionId, 0, signal)
  const questions = []
  for (const event of events) {
    if (!event || event.type !== 'user/message') continue
    const data = event.data && typeof event.data === 'object' ? event.data : {}
    const source = data.source && typeof data.source === 'object' ? data.source : {}
    if (source.kind !== 'user') continue
    const blocks = data.content
    const text = (Array.isArray(blocks) ? blocks : [blocks])
      .map(blockText)
      .filter((t) => typeof t === 'string' && t.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length === 0) continue
    questions.push({
      seq: event.seq,
      id: typeof data.id === 'string' ? data.id : String(event.seq),
      text,
    })
  }
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

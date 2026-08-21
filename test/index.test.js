// Unit tests for the host half (index.js): full-history user-question
// extraction from the on-disk session log.
import { describe, expect, it } from 'vitest'
import { listUserQuestions, ROUTE, name } from '../index.js'

/** Minimal persistence stub shaped like DSH's sessionPersistence.readFrom. */
function stubPersistence(events, meta = {}) {
  return {
    readFrom: async (_sessionId) => ({ meta, events }),
  }
}

function userEvent(seq, { id, content, sourceKind = 'user' } = {}) {
  return {
    type: 'user/message',
    seq,
    data: {
      id: id ?? `msg-${seq}`,
      source: { kind: sourceKind },
      content,
    },
  }
}

describe('plugin contract', () => {
  it('exports the expected name and route', () => {
    expect(name).toBe('@kiligzzz/dsh-session-nav')
    expect(ROUTE).toBe('/_dsh/session-nav/questions')
  })
})

describe('listUserQuestions', () => {
  it('rejects a non-string or empty session id', async () => {
    const persistence = stubPersistence([])
    await expect(listUserQuestions('', persistence)).rejects.toThrow(TypeError)
    await expect(listUserQuestions(undefined, persistence)).rejects.toThrow(TypeError)
    await expect(listUserQuestions(42, persistence)).rejects.toThrow(TypeError)
  })

  it('returns only real user messages, skipping steering and other kinds', async () => {
    const events = [
      userEvent(1, { content: [{ text: 'first question' }] }),
      userEvent(2, { content: [{ text: 'steering prompt' }], sourceKind: 'steering' }),
      userEvent(3, { content: [{ text: 'plugin-injected' }], sourceKind: 'plugin' }),
      { type: 'assistant/message', seq: 4, data: { content: [{ text: 'model reply' }] } },
      userEvent(5, { content: [{ text: 'second question' }] }),
    ]
    const { questions } = await listUserQuestions('sess-1', stubPersistence(events))
    expect(questions.map((q) => q.text)).toEqual(['first question', 'second question'])
    expect(questions.map((q) => q.seq)).toEqual([1, 5])
  })

  it('skips empty content and whitespace-only blocks', async () => {
    const events = [
      userEvent(1, { content: [] }),
      userEvent(2, { content: [{ text: '   ' }] }),
      userEvent(3, { content: [{ text: 'real' }, { content: 'second block' }] }),
    ]
    const { questions } = await listUserQuestions('sess-1', stubPersistence(events))
    expect(questions).toHaveLength(1)
    expect(questions[0].text).toBe('real second block')
    expect(questions[0].seq).toBe(3)
  })

  it('normalizes internal whitespace and trims', async () => {
    const events = [userEvent(1, { content: [{ text: '  hello \n\n  world ' }] })]
    const { questions } = await listUserQuestions('sess-1', stubPersistence(events))
    expect(questions[0].text).toBe('hello world')
  })

  it('falls back to seq-based ids when data.id is absent', async () => {
    // Build the event by hand: the stub default id ('msg-<seq>') must not apply
    const events = [{ type: 'user/message', seq: 7, data: { source: { kind: 'user' }, content: [{ text: 'no id' }] } }]
    const { questions } = await listUserQuestions('sess-1', stubPersistence(events))
    expect(questions[0].id).toBe('7')
  })

  it('returns the session title from meta when present', async () => {
    const events = [userEvent(1, { content: [{ text: 'q' }] })]
    const { title } = await listUserQuestions('sess-1', stubPersistence(events, { title: 'My Session' }))
    expect(title).toBe('My Session')
  })

  it('handles malformed events defensively', async () => {
    const events = [
      null,
      'garbage',
      { type: 'user/message', data: null },
      userEvent(1, { content: null }),
    ]
    const { questions } = await listUserQuestions('sess-1', stubPersistence(events))
    expect(questions).toHaveLength(0)
  })
})

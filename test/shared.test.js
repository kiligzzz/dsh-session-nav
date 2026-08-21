// Unit tests for lib/shared.js — pure helpers shared by the host and client halves.
import { describe, expect, it } from 'vitest'
import { blockText, textOfBlocks, clampModelText, keyIdentity, MODEL_TEXT_BUDGET } from '../lib/shared.js'

describe('blockText', () => {
  it('reads the text field of a text block', () => {
    expect(blockText({ text: 'hello' })).toBe('hello')
  })

  it('reads the content field when text is absent', () => {
    expect(blockText({ content: 'hello' })).toBe('hello')
  })

  it('returns undefined for empty, missing or non-object values', () => {
    expect(blockText({ text: '' })).toBeUndefined()
    expect(blockText({ content: '' })).toBeUndefined()
    expect(blockText(null)).toBeUndefined()
    expect(blockText('string')).toBeUndefined()
    expect(blockText(undefined)).toBeUndefined()
  })
})

describe('textOfBlocks', () => {
  it('joins text blocks and collapses whitespace', () => {
    expect(textOfBlocks([{ text: 'a' }, { text: '  b\nc ' }])).toBe('a b c')
  })

  it('marks image blocks with a placeholder', () => {
    expect(textOfBlocks([{ type: 'image' }, { text: 'caption' }])).toBe('[图片] caption')
  })

  it('handles content-style text blocks and unknown shapes', () => {
    expect(textOfBlocks([{ type: 'text', content: 'x' }, { kind: 'text', text: 'y' }, { weird: true }])).toBe('x y')
  })

  it('returns an empty string for non-array input', () => {
    expect(textOfBlocks(null)).toBe('')
    expect(textOfBlocks(undefined)).toBe('')
    expect(textOfBlocks('nope')).toBe('')
  })
})

describe('clampModelText', () => {
  it('keeps short text untouched', () => {
    expect(clampModelText('short')).toBe('short')
  })

  it('truncates Latin text at the budget with an ellipsis', () => {
    // 0.5 units per Latin char → budget 55 = 110 chars; 111+ chars truncates
    const long = 'x'.repeat(MODEL_TEXT_BUDGET * 2 + 2)
    const out = clampModelText(long)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThan(MODEL_TEXT_BUDGET * 2 + 2)
  })

  it('charges CJK text at 1 unit per char (half the Latin capacity)', () => {
    const cjk = '汉'.repeat(MODEL_TEXT_BUDGET * 2)
    const out = clampModelText(cjk)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThan(MODEL_TEXT_BUDGET + 1)
  })

  it('returns empty for falsy input', () => {
    expect(clampModelText('')).toBe('')
    expect(clampModelText(null)).toBe('')
    expect(clampModelText(undefined)).toBe('')
  })
})

describe('keyIdentity', () => {
  it('extracts the raw uuid from a live-window prefixed key', () => {
    expect(keyIdentity('13:input-message550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('passes through a raw uuid key unchanged', () => {
    expect(keyIdentity('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('passes through seq-based keys', () => {
    expect(keyIdentity('seq42')).toBe('seq42')
  })

  it('returns null for empty or non-string keys', () => {
    expect(keyIdentity('')).toBeNull()
    expect(keyIdentity(null)).toBeNull()
    expect(keyIdentity(undefined)).toBeNull()
    expect(keyIdentity(42)).toBeNull()
  })
})

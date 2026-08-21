// Unit tests for the piano-bar geometry: cluster layout, pitch compression
// and the layout snapshot bail-out comparison.
import { describe, expect, it } from 'vitest'
import { computeCluster, sameLayout, PITCH, MIN_PITCH } from '../lib/shared.js'

describe('computeCluster', () => {
  it('keeps the fixed pitch when the cluster fits the strip', () => {
    const { pitch, ys } = computeCluster(5, 100, 300)
    expect(pitch).toBe(PITCH)
    expect(ys).toHaveLength(5)
    // 10px spacing, vertically centered within the 300px strip starting at 100
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeCloseTo(PITCH)
    }
    const clusterH = 5 * PITCH
    expect(ys[0]).toBeCloseTo(100 + (300 - clusterH) / 2 + PITCH / 2)
  })

  it('compresses the pitch when the cluster would overflow the strip', () => {
    // 100 keys × 10px = 1000px in a 200px strip → compress toward MIN_PITCH
    const { pitch, ys } = computeCluster(100, 0, 200)
    expect(pitch).toBeLessThan(PITCH)
    expect(pitch).toBeGreaterThanOrEqual(MIN_PITCH)
    expect(ys).toHaveLength(100)
    // 100 keys × 6px = 600px is the densest the spec allows; the strip is
    // 180px usable, so extreme overflow is expected to remain visually
    // dense (the alternative — scattering keys — is worse). The invariant
    // we guarantee is that pitch never drops below MIN_PITCH.
    expect(pitch).toBe(MIN_PITCH)
    expect(100 * pitch).toBe(600)
  })

  it('never compresses below MIN_PITCH', () => {
    const { pitch } = computeCluster(10000, 0, 100)
    expect(pitch).toBe(MIN_PITCH)
  })

  it('returns an empty layout for zero or invalid counts', () => {
    expect(computeCluster(0, 0, 100)).toEqual({ pitch: PITCH, ys: [] })
    expect(computeCluster(-3, 0, 100).ys).toEqual([])
    expect(computeCluster(NaN, 0, 100).ys).toEqual([])
  })

  it('keeps the cluster vertically centered', () => {
    const { ys } = computeCluster(3, 50, 200)
    // The returned centers must be symmetric around the strip midpoint
    // (50 + 200/2 = 150): first and last key center average to it.
    expect(ys).toHaveLength(3)
    expect((ys[0] + ys[2]) / 2).toBeCloseTo(150)
    expect(ys[1]).toBeCloseTo(150)
  })
})

describe('sameLayout', () => {
  it('returns true for identical layouts', () => {
    const a = { hidden: false, left: 10, top: 20, height: 300, active: 2, ys: [30, 40, 50] }
    const b = { hidden: false, left: 10, top: 20, height: 300, active: 2, ys: [30, 40, 50] }
    expect(sameLayout(a, b)).toBe(true)
  })

  it('returns false when any field differs', () => {
    const base = { hidden: false, left: 10, top: 20, height: 300, active: 2, ys: [30, 40, 50] }
    expect(sameLayout(base, { ...base, active: 3 })).toBe(false)
    expect(sameLayout(base, { ...base, hidden: true })).toBe(false)
    expect(sameLayout(base, { ...base, ys: [31, 40, 50] })).toBe(false)
    expect(sameLayout(base, { ...base, ys: [30, 40] })).toBe(false)
    expect(sameLayout(base, { ...base, left: 11 })).toBe(false)
  })

  it('returns false for nullish or mismatched-shape inputs', () => {
    expect(sameLayout(null, {})).toBe(false)
    expect(sameLayout({}, null)).toBe(false)
    expect(sameLayout(undefined, undefined)).toBe(false)
  })
})

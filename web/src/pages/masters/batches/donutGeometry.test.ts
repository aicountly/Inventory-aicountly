import { describe, expect, it } from 'vitest'
import { donutSegments, sharePercent } from './donutGeometry'

const C = 100

describe('donutSegments', () => {
  it('lays the arcs end to end and fills the whole ring', () => {
    const segments = donutSegments([{ key: 'a', value: 3 }, { key: 'b', value: 1 }], C)
    expect(segments[0].length).toBe(75)
    expect(segments[0].offset).toBe(-0)
    expect(segments[1].length).toBe(25)
    expect(segments[1].offset).toBe(-75)
    expect(segments.reduce((sum, s) => sum + s.length, 0)).toBeCloseTo(C)
  })

  it('keeps an empty part so the legend colours do not shift', () => {
    const segments = donutSegments([{ key: 'a', value: 5 }, { key: 'b', value: 0 }, { key: 'c', value: 5 }], C)
    expect(segments).toHaveLength(3)
    expect(segments[1].length).toBe(0)
    expect(segments[2].offset).toBe(-50)
  })

  it('draws nothing rather than dividing by zero when there is no data', () => {
    const segments = donutSegments([{ key: 'a', value: 0 }, { key: 'b', value: 0 }], C)
    expect(segments.every((s) => s.length === 0 && s.share === 0)).toBe(true)
  })

  it('treats a negative figure as nothing instead of painting backwards', () => {
    const segments = donutSegments([{ key: 'a', value: -5 }, { key: 'b', value: 10 }], C)
    expect(segments[0].length).toBe(0)
    expect(segments[1].length).toBe(100)
  })
})

describe('sharePercent', () => {
  it('rounds to whole percents and survives an empty total', () => {
    expect(sharePercent(186, 248)).toBe(75)
    expect(sharePercent(5, 248)).toBe(2)
    expect(sharePercent(0, 0)).toBe(0)
  })
})

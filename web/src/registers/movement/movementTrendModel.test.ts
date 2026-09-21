import { describe, expect, it } from 'vitest'
import {
  availableBuckets,
  bucketLabel,
  bucketTitle,
  rollUp,
  startOfBucket,
  trendView,
} from './movementTrendModel'
import type { MovementTrendPoint, MovementTrendSeries } from '../../services/stockViewsApi'

function point(bucket: string, inQty: number, outQty: number): MovementTrendPoint {
  return {
    bucket,
    movements: 1,
    in_qty: inQty,
    out_qty: outQty,
    in_value: inQty * 10,
    out_value: outQty * 10,
  }
}

describe('startOfBucket', () => {
  it('starts a week on Monday, as PostgreSQL date_trunc does', () => {
    // 19 Sep 2026 is a Saturday; its week began on Monday the 14th. Starting weeks on
    // Sunday here would shift every rolled-up column a day off the server's own buckets.
    expect(startOfBucket('2026-09-19', 'week')).toBe('2026-09-14')
    expect(startOfBucket('2026-09-14', 'week')).toBe('2026-09-14')
    expect(startOfBucket('2026-09-13', 'week')).toBe('2026-09-07')
  })

  it('starts a month on the first, and leaves a day alone', () => {
    expect(startOfBucket('2026-09-19', 'month')).toBe('2026-09-01')
    expect(startOfBucket('2026-09-19', 'day')).toBe('2026-09-19')
  })

  it('hands back anything it cannot read rather than inventing a date', () => {
    expect(startOfBucket('not-a-date', 'week')).toBe('not-a-date')
  })
})

describe('rollUp', () => {
  it('adds the days of a week into one column — exactly, never estimated', () => {
    const rolled = rollUp(
      [point('2026-09-14', 1, 0), point('2026-09-15', 2, 3), point('2026-09-21', 5, 1)],
      'day',
      'week',
    )
    expect(rolled.map((p) => p.bucket)).toEqual(['2026-09-14', '2026-09-21'])
    expect(rolled[0].in_qty).toBe(3)
    expect(rolled[0].out_qty).toBe(3)
    expect(rolled[0].in_value).toBe(30)
    expect(rolled[0].movements).toBe(2)
    expect(rolled[1].in_qty).toBe(5)
  })

  it('rolls weeks into months', () => {
    const rolled = rollUp([point('2026-08-31', 1, 0), point('2026-09-07', 4, 0)], 'week', 'month')
    expect(rolled.map((p) => p.bucket)).toEqual(['2026-08-01', '2026-09-01'])
  })

  it('refuses to go finer than what was served — the numbers do not exist here', () => {
    const weekly = [point('2026-09-14', 7, 0)]
    expect(rollUp(weekly, 'week', 'day')).toEqual(weekly)
  })

  it('leaves a same-width request untouched', () => {
    const daily = [point('2026-09-14', 1, 0)]
    expect(rollUp(daily, 'day', 'day')).toEqual(daily)
  })

  it('returns the columns in date order whatever order they arrived in', () => {
    const rolled = rollUp([point('2026-09-21', 1, 0), point('2026-09-14', 1, 0)], 'day', 'week')
    expect(rolled.map((p) => p.bucket)).toEqual(['2026-09-14', '2026-09-21'])
  })

  it('does not mutate the series it was handed', () => {
    const source = [point('2026-09-14', 1, 0), point('2026-09-15', 2, 0)]
    rollUp(source, 'day', 'week')
    expect(source[0].in_qty).toBe(1)
  })
})

describe('availableBuckets', () => {
  it('offers only widths the client can reach by adding up', () => {
    expect(availableBuckets('day')).toEqual(['day', 'week', 'month'])
    expect(availableBuckets('week')).toEqual(['week', 'month'])
    expect(availableBuckets('month')).toEqual(['month'])
  })
})

describe('labels', () => {
  it('marks a week column so it is not read as a single day', () => {
    expect(bucketLabel('2026-09-14', 'day')).toBe('14 Sep')
    expect(bucketLabel('2026-09-14', 'week')).toBe('14 Sep+')
    expect(bucketLabel('2026-09-01', 'month')).toBe('Sep 26')
  })

  it('spells the column out in full for the tooltip and the screen-reader table', () => {
    expect(bucketTitle('2026-09-14', 'day')).toBe('14 Sep 2026')
    expect(bucketTitle('2026-09-14', 'week')).toBe('Week of 14 Sep 2026')
    expect(bucketTitle('2026-09-01', 'month')).toBe('Sep 2026')
  })
})

describe('trendView', () => {
  const series: MovementTrendSeries = {
    bucket: 'day',
    from: '2026-09-14',
    to: '2026-09-21',
    truncated: false,
    points: [point('2026-09-14', 3, 1), point('2026-09-15', 0, 4)],
  }

  it('draws the measure it was asked for', () => {
    expect(trendView(series, 'day', 'qty').inward).toEqual([3, 0])
    expect(trendView(series, 'day', 'value').inward).toEqual([30, 0])
    expect(trendView(series, 'day', 'qty').outward).toEqual([1, 4])
  })

  it('carries a label and a full title for every column', () => {
    const view = trendView(series, 'day', 'qty')
    expect(view.categories).toEqual(['14 Sep', '15 Sep'])
    expect(view.titles).toEqual(['14 Sep 2026', '15 Sep 2026'])
  })

  it('re-buckets before it reads the measure', () => {
    const view = trendView(series, 'week', 'qty')
    expect(view.categories).toEqual(['14 Sep+'])
    expect(view.inward).toEqual([3])
    expect(view.outward).toEqual([5])
  })

  it('reports an all-zero period as empty, so the card says so instead of drawing a flat axis', () => {
    const flat: MovementTrendSeries = { ...series, points: [point('2026-09-14', 0, 0)] }
    expect(trendView(flat, 'day', 'qty').empty).toBe(true)
    expect(trendView(series, 'day', 'qty').empty).toBe(false)
  })

  it('survives a missing series rather than throwing at render', () => {
    const view = trendView(null, 'day', 'qty')
    expect(view.points).toEqual([])
    expect(view.empty).toBe(true)
  })
})

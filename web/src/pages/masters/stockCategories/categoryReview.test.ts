import { describe, expect, it } from 'vitest'
import { editDistance, normaliseName, reviewCategories } from './categoryReview'
import type { StockCategory } from '../../../services/masters'

/**
 * The review is the one part of the side panel that makes claims about a
 * company's data, so the properties worth pinning are the ones that decide
 * whether a claim is true: that a finding is only raised when the rows say so,
 * and — the one that matters most — that "unused" is never asserted about a row
 * whose usage the API did not send.
 */

function cat(partial: Partial<StockCategory> & { stock_cat_id: number; cat_name: string }): StockCategory {
  return { cat_alias: null, is_active: 1, ...partial }
}

const kindsOf = (rows: StockCategory[]) => reviewCategories(rows).findings.map((f) => f.kind)

describe('normaliseName', () => {
  it('folds case, punctuation and a trailing plural together', () => {
    expect(normaliseName('Raw Material')).toBe(normaliseName('raw  materials'))
    expect(normaliseName('Work-in-Progress (WIP)')).toBe(normaliseName('work in progress wip'))
  })

  it('is empty for nothing', () => {
    expect(normaliseName(null)).toBe('')
    expect(normaliseName('   ')).toBe('')
  })
})

describe('editDistance', () => {
  it('measures small edits and gives up past the bound', () => {
    expect(editDistance('finished', 'finishd')).toBe(1)
    expect(editDistance('packing', 'packing')).toBe(0)
    expect(editDistance('raw', 'completely different')).toBe(3)
  })
})

describe('reviewCategories', () => {
  it('finds nothing to say about a clean list', () => {
    const review = reviewCategories([
      cat({ stock_cat_id: 1, cat_name: 'Raw Material', cat_alias: 'RM', item_count: 4 }),
      cat({ stock_cat_id: 2, cat_name: 'Finished Goods', cat_alias: 'FG', item_count: 9 }),
    ])
    expect(review.findings).toEqual([])
    expect(review.examined).toBe(2)
  })

  it('reports two categories that normalise to one name', () => {
    const kinds = kindsOf([
      cat({ stock_cat_id: 1, cat_name: 'Raw Material', cat_alias: 'RM', item_count: 1 }),
      cat({ stock_cat_id: 2, cat_name: 'raw materials', cat_alias: 'RM2', item_count: 1 }),
    ])
    expect(kinds).toContain('duplicate_name')
  })

  it('reports an alias used twice', () => {
    const kinds = kindsOf([
      cat({ stock_cat_id: 1, cat_name: 'Packing Material', cat_alias: 'PM', item_count: 1 }),
      cat({ stock_cat_id: 2, cat_name: 'Promotional Material', cat_alias: 'pm', item_count: 1 }),
    ])
    expect(kinds).toContain('duplicate_alias')
  })

  it('reports names a character or two apart', () => {
    const kinds = kindsOf([
      cat({ stock_cat_id: 1, cat_name: 'Consumable', cat_alias: 'CON', item_count: 1 }),
      cat({ stock_cat_id: 2, cat_name: 'Consumible', cat_alias: 'CNS', item_count: 1 }),
    ])
    expect(kinds).toContain('similar_name')
  })

  it('reports active categories with no alias', () => {
    const kinds = kindsOf([cat({ stock_cat_id: 1, cat_name: 'Spare Parts', item_count: 3 })])
    expect(kinds).toContain('missing_alias')
  })

  it('reports an active category no item uses', () => {
    const kinds = kindsOf([cat({ stock_cat_id: 1, cat_name: 'Trading Goods', cat_alias: 'TG', item_count: 0 })])
    expect(kinds).toContain('unused')
  })

  it('never calls a category unused when the API sent no count', () => {
    // The row simply has no `item_count`. Saying "no items use it" here would
    // be the panel inventing a fact about the company's stock.
    const kinds = kindsOf([cat({ stock_cat_id: 1, cat_name: 'Trading Goods', cat_alias: 'TG' })])
    expect(kinds).not.toContain('unused')
    expect(kinds).not.toContain('inactive_in_use')
  })

  it('reports an inactive category that items still point at', () => {
    const kinds = kindsOf([
      cat({ stock_cat_id: 1, cat_name: 'Old Stock', cat_alias: 'OS', is_active: 0, item_count: 12 }),
    ])
    expect(kinds).toContain('inactive_in_use')
  })

  it('puts problems before observations', () => {
    const review = reviewCategories([
      cat({ stock_cat_id: 1, cat_name: 'Raw Material', cat_alias: 'RM', item_count: 0 }),
      cat({ stock_cat_id: 2, cat_name: 'raw material', cat_alias: 'RM2', item_count: 0 }),
    ])
    expect(review.findings[0]?.severity).toBe('warning')
  })

  it('names the categories a finding is about, so the list can be filtered to them', () => {
    const review = reviewCategories([
      cat({ stock_cat_id: 7, cat_name: 'Raw Material', cat_alias: 'RM', item_count: 1 }),
      cat({ stock_cat_id: 9, cat_name: 'Raw Materials', cat_alias: 'RM2', item_count: 1 }),
    ])
    const duplicate = review.findings.find((f) => f.kind === 'duplicate_name')
    expect(duplicate?.categoryIds.sort()).toEqual([7, 9])
  })
})

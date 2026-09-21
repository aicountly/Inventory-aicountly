import { describe, expect, it } from 'vitest'
import { DEFAULT_ISSUE_MODE, ISSUE_MODES, isIssueMode, issueModeFromMetadata, issueModeLabel, referencesProduction } from './issueMode'

describe('issue mode', () => {
  it('round-trips through document metadata', () => {
    for (const mode of ISSUE_MODES) {
      expect(issueModeFromMetadata({ issue_mode: mode.value })).toBe(mode.value)
    }
  })

  it('falls back to the default for a document saved before the field existed', () => {
    expect(issueModeFromMetadata({})).toBe(DEFAULT_ISSUE_MODE)
    expect(issueModeFromMetadata(null)).toBe(DEFAULT_ISSUE_MODE)
    expect(issueModeFromMetadata(undefined)).toBe(DEFAULT_ISSUE_MODE)
  })

  it('refuses a value the UI does not know', () => {
    // metadata is free-form JSON, so anything can be in there; a mode the
    // switch cannot render must not reach it.
    expect(issueModeFromMetadata({ issue_mode: 'scrap' })).toBe(DEFAULT_ISSUE_MODE)
    expect(issueModeFromMetadata({ issue_mode: 7 })).toBe(DEFAULT_ISSUE_MODE)
    expect(isIssueMode('against_production')).toBe(true)
    expect(isIssueMode('nonsense')).toBe(false)
  })

  it('names every mode and only references production for one', () => {
    expect(issueModeLabel('against_production')).toBe('Against Production')
    expect(referencesProduction('against_production')).toBe(true)
    expect(referencesProduction('standard')).toBe(false)
    expect(referencesProduction('sample')).toBe(false)
    expect(referencesProduction('other')).toBe(false)
  })
})

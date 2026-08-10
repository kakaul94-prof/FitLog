import { describe, it, expect } from 'vitest'
import { displayText, parseRemember } from './trainer'

// The memory marker arrives inside a token stream, so displayText has to hide
// it while it is still half-written — otherwise "[[REMEM" flashes in the bubble.

describe('displayText', () => {
  it('passes plain text through', () => {
    expect(displayText('Add 5 lb next session.')).toBe('Add 5 lb next session.')
  })

  it('strips a completed marker and its trailing whitespace', () => {
    expect(
      displayText('Back off to 205.\n\n[[REMEMBER: Left knee aches deep]]'),
    ).toBe('Back off to 205.')
  })

  it('hides a marker that is still streaming in', () => {
    expect(displayText('Back off to 205.\n\n[[REMEMBER: Left knee')).toBe(
      'Back off to 205.',
    )
  })

  it.each(['[', '[[', '[[R', '[[REMEMBER', '[[REMEMBER:'])(
    'hides the partial opener %j',
    (partial) => {
      expect(displayText(`Do 3x5.${partial}`)).toBe('Do 3x5.')
    },
  )

  it('keeps brackets that are not the marker', () => {
    expect(displayText('Use a belt [optional] here.')).toBe(
      'Use a belt [optional] here.',
    )
  })
})

describe('parseRemember', () => {
  it('returns null when there is no marker', () => {
    expect(parseRemember('Just squat more.')).toBeNull()
  })

  it('returns null for a marker that never closed', () => {
    expect(parseRemember('Text [[REMEMBER: half a fact')).toBeNull()
  })

  it('extracts and trims the fact', () => {
    expect(parseRemember('Text\n[[REMEMBER:  Prefers paused reps  ]]')).toBe(
      'Prefers paused reps',
    )
  })

  it('caps a runaway fact', () => {
    const fact = parseRemember(`[[REMEMBER: ${'x'.repeat(500)}]]`)
    expect(fact).toHaveLength(200)
  })
})

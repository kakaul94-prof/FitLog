import { describe, expect, it } from 'vitest'
import {
  foodSearchFilter,
  highlightSegments,
  matchesFoodSearch,
  searchWords,
} from './foodSearch'

const kettle = { name: 'Sweet & Salty Kettle Corn', brand: 'Boom Chicka Pop' }

describe('searchWords', () => {
  it('lowercases, splits on punctuation, and de-duplicates', () => {
    expect(searchWords('  Sweet & Salty  sweet ')).toEqual(['sweet', 'salty'])
    expect(searchWords("Ben-&-Jerry's")).toEqual(['ben', 'jerry', 's'])
  })
  it('returns nothing for blank or punctuation-only input', () => {
    expect(searchWords('')).toEqual([])
    expect(searchWords(' & - ')).toEqual([])
  })
})

describe('matchesFoodSearch', () => {
  it('matches on brand alone', () => {
    expect(matchesFoodSearch(kettle, searchWords('boom chicka pop'))).toBe(true)
  })
  it('matches words split across name and brand, in any order', () => {
    expect(matchesFoodSearch(kettle, searchWords('kettle boom'))).toBe(true)
  })
  it('ignores punctuation in the food name', () => {
    expect(matchesFoodSearch(kettle, searchWords('sweet salty kettle'))).toBe(true)
  })
  it('needs every word to appear', () => {
    expect(matchesFoodSearch(kettle, searchWords('boom cheddar'))).toBe(false)
  })
  it('handles foods without a brand', () => {
    const apple = { name: 'Apple', brand: null }
    expect(matchesFoodSearch(apple, searchWords('apple'))).toBe(true)
    expect(matchesFoodSearch(apple, searchWords('boom'))).toBe(false)
  })
  it('matches everything for an empty query', () => {
    expect(matchesFoodSearch(kettle, [])).toBe(true)
  })
})

describe('foodSearchFilter', () => {
  it('ANDs a name-or-brand clause per word', () => {
    expect(foodSearchFilter(['boom', 'pop'])).toBe(
      'and(or(name.ilike.*boom*,brand.ilike.*boom*),or(name.ilike.*pop*,brand.ilike.*pop*))',
    )
  })
  it('is null for an empty query', () => {
    expect(foodSearchFilter([])).toBeNull()
  })
})

describe('highlightSegments', () => {
  it('marks each matched word, keeping original casing', () => {
    expect(highlightSegments('Boom Chicka Pop', ['boom', 'pop'])).toEqual([
      { text: 'Boom', hit: true },
      { text: ' Chicka ', hit: false },
      { text: 'Pop', hit: true },
    ])
  })
  it('merges overlapping matches into one run', () => {
    expect(highlightSegments('Popcorn', ['pop', 'opc'])).toEqual([
      { text: 'Popc', hit: true },
      { text: 'orn', hit: false },
    ])
  })
  it('returns the text unmarked when nothing matches', () => {
    expect(highlightSegments('Apple', ['boom'])).toEqual([{ text: 'Apple', hit: false }])
    expect(highlightSegments('Apple', [])).toEqual([{ text: 'Apple', hit: false }])
  })
})

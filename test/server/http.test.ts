import { describe, it, expect } from 'vitest'
import {
  pagination,
  intParam,
  numberParam,
  boolParam,
  textParam,
  dateParam,
  likePattern,
  listParam,
  idListParam,
  today
} from '../../server/utils/http'

describe('pagination', () => {
  it('defaults and clamps hostile input', () => {
    const page = pagination({ page: '0', pageSize: '999' }, 50, 200)
    expect(page.page).toBe(1)
    expect(page.pageSize).toBe(200)
    expect(page.offset).toBe(0)
  })

  it('computes the offset from page and size', () => {
    const page = pagination({ page: '3', pageSize: '10' })
    expect(page).toMatchObject({ page: 3, pageSize: 10, limit: 10, offset: 20 })
  })
})

describe('intParam', () => {
  it('parses positive integers and rejects everything else', () => {
    expect(intParam('5')).toBe(5)
    expect(intParam(7)).toBe(7)
    expect(intParam('0')).toBeNull()
    expect(intParam('-3')).toBeNull()
    expect(intParam('abc')).toBeNull()
    expect(intParam(undefined)).toBeNull()
  })
})

describe('numberParam', () => {
  it('parses finite numbers', () => {
    expect(numberParam('2.5')).toBe(2.5)
    expect(numberParam('abc')).toBeNull()
  })
})

describe('boolParam', () => {
  it('accepts 1/true/yes in any case', () => {
    expect(boolParam('1')).toBe(true)
    expect(boolParam('true')).toBe(true)
    expect(boolParam('YES')).toBe(true)
  })

  it('treats anything else as false', () => {
    expect(boolParam('0')).toBe(false)
    expect(boolParam(undefined)).toBe(false)
  })
})

describe('textParam', () => {
  it('trims, truncates and nulls empty values', () => {
    expect(textParam('  hi  ', 10)).toBe('hi')
    expect(textParam('abcdef', 3)).toBe('abc')
    expect(textParam('   ')).toBeNull()
    expect(textParam(null)).toBeNull()
  })
})

describe('dateParam', () => {
  it('accepts a real calendar date', () => {
    expect(dateParam('2024-02-29')).toBe('2024-02-29')
  })

  it('rejects a rollover date, a wrong format and junk', () => {
    expect(dateParam('2024-02-31')).toBeNull()
    expect(dateParam('2024/02/01')).toBeNull()
    expect(dateParam('2024-2-1')).toBeNull()
    expect(dateParam('nope')).toBeNull()
  })
})

describe('likePattern', () => {
  it('wraps the value and escapes LIKE wildcards', () => {
    expect(likePattern('plain')).toBe('%plain%')
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%')
  })
})

describe('listParam', () => {
  it('accepts comma lists and repeated params', () => {
    expect(listParam('a,b')).toEqual(['a', 'b'])
    expect(listParam(['a', 'b'])).toEqual(['a', 'b'])
    expect(listParam(undefined)).toEqual([])
  })
})

describe('idListParam', () => {
  it('keeps distinct positive integers only', () => {
    expect(idListParam('1,2,2,foo,0,-3')).toEqual([1, 2])
  })
})

describe('today', () => {
  it('is a YYYY-MM-DD string', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

import { describe, expect, it } from 'vitest'
import { parseCsv } from '../server/imports'

describe('CSV parser', () => {
  it('parses headers and rows with CRLF', () => {
    const rows = parseCsv('name,studentNo,classId\r\n张三,S001,1\r\n李四,S002,2\r\n')
    expect(rows).toEqual([
      ['name', 'studentNo', 'classId'],
      ['张三', 'S001', '1'],
      ['李四', 'S002', '2']
    ])
  })

  it('supports quoted fields, commas and escaped quotes', () => {
    const rows = parseCsv('name,note\n"王, 五","他说 ""你好"""')
    expect(rows).toEqual([
      ['name', 'note'],
      ['王, 五', '他说 "你好"']
    ])
  })

  it('drops blank lines', () => {
    expect(parseCsv('\n\nname,studentNo,classId\n\n')).toEqual([
      ['name', 'studentNo', 'classId']
    ])
  })
})

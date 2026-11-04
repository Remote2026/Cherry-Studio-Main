import { describe, expect, it } from 'vitest'

import { buildSectionIndex } from '../sectionIndex'

describe('buildSectionIndex', () => {
  it('builds ancestor paths from one general-parser chunk containing several headings', () => {
    const index = buildSectionIndex([
      {
        content:
          '第三章 投标人资格要求\n3.1 基本资格要求\n3.1.2 企业资质\n投标人应具备以下资质：\n3.2 财务要求\n提供近三年审计报告。'
      }
    ])

    expect(index.headings.map((heading) => heading.path)).toEqual([
      ['第三章 投标人资格要求'],
      ['第三章 投标人资格要求', '3.1 基本资格要求'],
      ['第三章 投标人资格要求', '3.1 基本资格要求', '3.1.2 企业资质'],
      ['第三章 投标人资格要求', '3.2 财务要求']
    ])
    // 一个 chunk 跨多个章节：引用可用，但标为 medium。
    expect(index.byChunk[0]).toMatchObject({
      sectionPath: ['第三章 投标人资格要求'],
      sectionNumber: '第三章',
      confidence: 'medium'
    })
  })

  it('carries the section across separate chunks', () => {
    const index = buildSectionIndex([
      { content: '第三章 投标人资格要求\n' },
      { content: '3.1 基本资格要求\n' },
      { content: '3.1.2 企业资质\n投标人应具备以下资质：\n' },
      { content: '3.2 财务要求\n提供近三年审计报告。' }
    ])

    expect(index.byChunk).toEqual([
      {
        sectionPath: ['第三章 投标人资格要求'],
        sectionNumber: '第三章',
        sectionTitle: '投标人资格要求',
        confidence: 'high'
      },
      {
        sectionPath: ['第三章 投标人资格要求', '3.1 基本资格要求'],
        sectionNumber: '3.1',
        sectionTitle: '基本资格要求',
        confidence: 'high'
      },
      {
        sectionPath: ['第三章 投标人资格要求', '3.1 基本资格要求', '3.1.2 企业资质'],
        sectionNumber: '3.1.2',
        sectionTitle: '企业资质',
        confidence: 'high'
      },
      {
        sectionPath: ['第三章 投标人资格要求', '3.2 财务要求'],
        sectionNumber: '3.2',
        sectionTitle: '财务要求',
        confidence: 'high'
      }
    ])
  })

  it('does not treat a bare numbered list item as a heading', () => {
    const index = buildSectionIndex([
      { content: '1. 具有独立法人资格。\n2. 具备专业承包资质。' },
      { content: '3.1.1 企业资质\n投标人应提供证书。' }
    ])

    expect(index.headings).toHaveLength(1)
    expect(index.headings[0]).toMatchObject({ number: '3.1.1', level: 3 })
    expect(index.byChunk[0]).toMatchObject({ sectionPath: [], confidence: 'low' })
  })

  it('inherits the preceding section for table chunks and keeps HTML untouched', () => {
    const index = buildSectionIndex([
      { content: '3.1.2 企业资质\n投标人应具备以下资质：' },
      { content: '<table><tr><td>3.9 不是标题</td></tr></table>', docType: 'table' }
    ])

    expect(index.headings).toHaveLength(1)
    expect(index.byChunk[1]).toMatchObject({
      sectionPath: ['3.1.2 企业资质'],
      sectionNumber: '3.1.2',
      confidence: 'high'
    })
  })

  it('marks Chinese list-style headings as ambiguous', () => {
    const index = buildSectionIndex([{ content: '（一）资格要求\n投标人应提供证明材料。' }])

    expect(index.headings[0]).toMatchObject({ number: '一', ambiguous: true, level: 4 })
    expect(index.byChunk[0]).toMatchObject({ confidence: 'medium' })
  })

  it('does not treat a body sentence starting with a number as a heading', () => {
    const index = buildSectionIndex([
      { content: '3.1 投标人应在投标文件中提供有效的营业执照。' },
      { content: '正常正文。' }
    ])

    expect(index.headings).toHaveLength(0)
    expect(index.byChunk.every((location) => location.confidence === 'low')).toBe(true)
  })
})

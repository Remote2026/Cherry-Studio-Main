/**
 * 从 RagFlow 的 general chunk 文本构建章节索引。
 *
 * RagFlow 的 general parser 不返回结构化章节字段，只保留标题文本；这里按
 * 文档顺序扫描标题行，维护祖先栈，供读取与完整性检查共用。
 */

export type SectionConfidence = 'high' | 'medium' | 'low'

export interface SectionLocation {
  sectionPath: string[]
  sectionNumber?: string
  sectionTitle?: string
  confidence: SectionConfidence
}

export interface SectionHeading {
  path: string[]
  number?: string
  title: string
  /** 原始标题行，用作祖先路径的一段。 */
  text: string
  level: number
  /** 中文序号（一、/（一））无法与列表项可靠区分，标记后降置信度。 */
  ambiguous: boolean
  chunkIndex: number
  lineIndex: number
}

export interface SectionIndex {
  headings: SectionHeading[]
  byChunk: SectionLocation[]
}

export interface SectionIndexChunk {
  content: string
  docType?: string | null
}

interface ParsedHeading {
  level: number
  number?: string
  title: string
  text: string
  ambiguous: boolean
}

const MAX_HEADING_LENGTH = 120

const CHAPTER_RE = /^(第[零一二三四五六七八九十百千0-9]+(?:分?编|部分|章|节|条))\s*[、.．:：]?\s*(.*)$/
// 至少带一个点，避免把 “1. 列表项” 当成标题。
const DOTTED_RE = /^(\d+(?:\.\d+){1,4})(?:\s+|[、.．:：])\s*(.*)$/
const CN_PAREN_RE = /^[（(]([零一二三四五六七八九十百]+)[）)]\s*(.*)$/
const CN_LIST_RE = /^([零一二三四五六七八九十百]+)[、.．]\s*(.*)$/

const chapterLevel = (label: string): number => {
  if (/编|部分|章/.test(label)) return 1
  if (/节/.test(label)) return 2
  return 3
}

function parseHeading(raw: string): ParsedHeading | null {
  const line = raw.trim()
  // 标题不会以句末标点收尾；长行按正文处理。
  if (!line || line.length > MAX_HEADING_LENGTH || /[。；;！？!?]$/.test(line)) return null

  const chapter = CHAPTER_RE.exec(line)
  if (chapter) {
    return {
      level: chapterLevel(chapter[1]),
      number: chapter[1],
      title: chapter[2]?.trim() ?? '',
      text: line,
      ambiguous: false
    }
  }

  const dotted = DOTTED_RE.exec(line)
  if (dotted) {
    return {
      level: dotted[1].split('.').length,
      number: dotted[1],
      title: dotted[2]?.trim() ?? '',
      text: line,
      ambiguous: false
    }
  }

  const paren = CN_PAREN_RE.exec(line)
  if (paren) {
    return { level: 4, number: paren[1], title: paren[2]?.trim() ?? '', text: line, ambiguous: true }
  }

  const list = CN_LIST_RE.exec(line)
  if (list) {
    return { level: 3, number: list[1], title: list[2]?.trim() ?? '', text: line, ambiguous: true }
  }

  return null
}

const currentLocation = (heading: SectionHeading | undefined): SectionLocation => {
  if (!heading) return { sectionPath: [], confidence: 'low' }
  return {
    sectionPath: heading.path,
    sectionNumber: heading.number,
    sectionTitle: heading.title,
    confidence: heading.ambiguous ? 'medium' : 'high'
  }
}

const firstNonEmptyLine = (lines: ReadonlyArray<string>): number => {
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim()) return index
  }
  return -1
}

export function buildSectionIndex(chunks: ReadonlyArray<SectionIndexChunk>): SectionIndex {
  const headings: SectionHeading[] = []
  const byChunk: SectionLocation[] = []
  const stack: SectionHeading[] = []

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex]
    const sectionAtStart = stack[stack.length - 1]
    const chunkHeadings: SectionHeading[] = []

    if (chunk.docType !== 'table') {
      const lines = chunk.content.split(/\r?\n/)
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const parsed = parseHeading(lines[lineIndex])
        if (!parsed) continue

        while (stack.length > 0 && stack[stack.length - 1].level >= parsed.level) stack.pop()
        const heading: SectionHeading = {
          path: [...stack.map((item) => item.text), parsed.text],
          number: parsed.number,
          title: parsed.title,
          text: parsed.text,
          level: parsed.level,
          ambiguous: parsed.ambiguous,
          chunkIndex,
          lineIndex
        }
        stack.push(heading)
        headings.push(heading)
        chunkHeadings.push(heading)
      }
    }

    if (chunkHeadings.length === 0) {
      byChunk.push(currentLocation(stack[stack.length - 1]))
      continue
    }

    const lines = chunk.content.split(/\r?\n/)
    const startsWithHeading = chunkHeadings[0].lineIndex === firstNonEmptyLine(lines)
    const spansSections = chunkHeadings.length > 1 || !startsWithHeading
    if (!startsWithHeading) {
      // 标题出现在正文之后：chunk 从上一章节开始，跨入新章节。
      byChunk.push({ ...currentLocation(sectionAtStart), confidence: stack.length > 0 ? 'medium' : 'low' })
      continue
    }
    const start = chunkHeadings[0]
    byChunk.push({
      ...currentLocation(start),
      confidence: spansSections || start.ambiguous ? 'medium' : 'high'
    })
  }

  return { headings, byChunk }
}

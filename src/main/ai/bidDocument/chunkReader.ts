/**
 * 顺序读取 TemporaryKB 文档的 chunk，并校验分页连续性。
 *
 * RagFlow 的 chunk 数组顺序即文档顺序（chunk_order_int 排序），这里不重排；
 * 读取缓存按文档保存，re-parse 后按 chunkCount 失效。
 */

import { estimateTokenCount } from 'tokenx'

import { ragflowClient } from '@main/features/ragflow'
import type { RagflowChunk } from '@shared/ipc/schemas/ragflow'

import { buildSectionIndex, type SectionIndex, type SectionLocation } from './sectionIndex'

const PAGE_SIZE = 100
const DEFAULT_MAX_TOKENS = 6_000
const MAX_TOKENS = 12_000
const MAX_CACHED_DOCUMENTS = 8

interface CachedDocument {
  total: number
  chunks: RagflowChunk[]
  index: SectionIndex
  fetchedAt: number
}

const documentCache = new Map<string, CachedDocument>()

export interface BidChunkBatch {
  content: string
  startIndex: number
  endIndex: number
  nextIndex: number | null
  done: boolean
  total: number
  tokens: number
  sectionPath?: string[]
  sectionNumber?: string
  sectionConfidence?: SectionLocation['confidence']
}

export interface BidCoverage {
  total: number
  readThrough: number
  gaps: Array<[number, number]>
  complete: boolean
  sections: { total: number; covered: number; missing: string[] }
  /** null 表示当前版本无法可靠识别表格，不能声称已覆盖。 */
  tables: { total: number; covered: number; unreadIndices: number[] } | null
}

export async function readBidChunkBatch(input: {
  datasetId: string
  documentId: string
  startIndex?: number
  maxTokens?: number
  expectedTotal?: number
  signal?: AbortSignal
}): Promise<BidChunkBatch> {
  const document = await loadDocument(input.datasetId, input.documentId, input.expectedTotal, input.signal)
  const startIndex = Math.max(0, Math.min(input.startIndex ?? 0, document.total))
  const budget = Math.min(input.maxTokens ?? DEFAULT_MAX_TOKENS, MAX_TOKENS)

  if (startIndex >= document.total) {
    return {
      content: '',
      startIndex,
      endIndex: startIndex - 1,
      nextIndex: null,
      done: true,
      total: document.total,
      tokens: 0
    }
  }

  let content = ''
  let used = 0
  let endIndex = startIndex - 1

  for (let index = startIndex; index < document.total; index += 1) {
    const piece = formatChunk(index, document.chunks[index], document.index.byChunk[index])
    const pieceTokens = estimateTokenCount(piece)
    // 至少返回一段，避免单段超过预算时卡住。
    if (endIndex >= startIndex && used + pieceTokens > budget) break
    content += piece
    used += pieceTokens
    endIndex = index
  }

  const nextIndex = endIndex + 1 < document.total ? endIndex + 1 : null
  const first = document.index.byChunk[startIndex]

  return {
    content,
    startIndex,
    endIndex,
    nextIndex,
    done: nextIndex === null,
    total: document.total,
    tokens: estimateTokenCount(content),
    ...(first && first.confidence !== 'low'
      ? {
          sectionPath: first.sectionPath,
          sectionNumber: first.sectionNumber,
          sectionConfidence: first.confidence
        }
      : {})
  }
}

export async function checkBidCoverage(input: {
  datasetId: string
  documentId: string
  readThrough: number
  expectedTotal?: number
  signal?: AbortSignal
}): Promise<BidCoverage> {
  const document = await loadDocument(input.datasetId, input.documentId, input.expectedTotal, input.signal)
  const readThrough = Math.max(0, Math.min(input.readThrough, document.total))
  const gaps: Array<[number, number]> = readThrough < document.total ? [[readThrough, document.total - 1]] : []

  const headings = document.index.headings
  const missing = headings.filter((heading) => heading.chunkIndex >= readThrough).map((heading) => heading.text)

  const allDocTypesMissing = document.chunks.every((chunk) => chunk.docType == null)
  const tableIndices = document.chunks.flatMap((chunk, index) =>
    chunk.docType === 'table' || /<table[\s>]/i.test(chunk.content) ? [index] : []
  )
  const tables =
    allDocTypesMissing && tableIndices.length === 0
      ? null
      : {
          total: tableIndices.length,
          covered: tableIndices.filter((index) => index < readThrough).length,
          unreadIndices: tableIndices.filter((index) => index >= readThrough)
        }

  return {
    total: document.total,
    readThrough,
    gaps,
    complete: readThrough >= document.total,
    sections: { total: headings.length, covered: headings.length - missing.length, missing },
    tables
  }
}

async function loadDocument(
  datasetId: string,
  documentId: string,
  expectedTotal?: number,
  signal?: AbortSignal
): Promise<CachedDocument> {
  const key = `${datasetId}:${documentId}`
  const cached = documentCache.get(key)
  if (cached && (expectedTotal === undefined || cached.total === expectedTotal)) return cached
  if (cached) documentCache.delete(key)

  const chunks: RagflowChunk[] = []
  const seen = new Set<string>()
  let total: number | undefined

  for (let page = 1; ; page += 1) {
    const response = await ragflowClient.listChunks({
      datasetId,
      documentId,
      page,
      pageSize: PAGE_SIZE,
      signal
    })
    if (total === undefined) total = response.total
    else if (response.total !== total) throw new Error('RagFlow 返回的 chunk 总数在分页过程中发生变化，请重新解析文档')

    for (const chunk of response.items) {
      if (!chunk.id || seen.has(chunk.id)) throw new Error('RagFlow 返回了重复的 chunk，请重新解析文档')
      seen.add(chunk.id)
      chunks.push(chunk)
    }

    if (response.items.length < PAGE_SIZE) break
    if (chunks.length >= total) break
    if (page > 10_000) throw new Error('RagFlow 返回的 chunk 分页异常，请重新解析文档')
  }

  const resolvedTotal = total ?? chunks.length
  if (chunks.length !== resolvedTotal) throw new Error('RagFlow 返回的 chunk 数量与 total 不一致，请重新解析文档')

  const index = buildSectionIndex(chunks.map((chunk) => ({ content: chunk.content, docType: chunk.docType })))
  const document = { total: resolvedTotal, chunks, index, fetchedAt: Date.now() }
  documentCache.set(key, document)
  if (documentCache.size > MAX_CACHED_DOCUMENTS) {
    const oldest = [...documentCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0]
    if (oldest) documentCache.delete(oldest[0])
  }
  return document
}

function formatChunk(index: number, chunk: RagflowChunk, location: SectionLocation | undefined): string {
  const header = [`第${index + 1}段`]

  if (chunk.pages && chunk.pages.length > 0) {
    const pages = [...new Set(chunk.pages)].sort((a, b) => a - b)
    header.push(pages.length === 1 ? `第${pages[0]}页` : `第${pages[0]}-${pages[pages.length - 1]}页`)
  }
  if (chunk.docType === 'table') header.push('表')
  if (location && location.confidence !== 'low' && location.sectionNumber) {
    header.push(`${location.sectionNumber}${location.sectionTitle ? ` ${location.sectionTitle}` : ''}`)
  }

  const text = chunk.content.trim() || '（本段无可提取文本）'
  return `[${header.join('｜')}]\n${text}\n\n`
}

/**
 * 标书分析文档句柄：把本地附件映射到 RagFlow 的 TemporaryKB 文档。
 *
 * 句柄只存在于工作区 `.bid-docs/`，按 session 授权；模型只持有 docId，
 * 不能直接指定 RagFlow datasetId/documentId。
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { atomicWriteFile, ensureDir, isPathInside } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

export const BID_ANALYSIS_AGENT_ID = 'bid-analysis'
export const BID_READ_CHUNKS_TOOL_NAME = 'bid_read_chunks'
export const BID_CHECK_COVERAGE_TOOL_NAME = 'bid_check_coverage'
export const BID_DOCUMENT_DIR_NAME = '.bid-docs'
export const BID_DOC_ID_PATTERN = /^rf-[a-f0-9]{32}$/
export const MAX_BID_DOCUMENT_BYTES = 128 * 1024 * 1024

export type BidDocumentKind = 'pdf' | 'docx'

export interface BidDocumentHandle {
  version: 2
  docId: string
  fingerprint: string
  kind: BidDocumentKind
  filename: string
  datasetId: string
  documentId: string
  sessionIds: string[]
  createdAt: number
  lastAccessAt: number
  expiresAt?: number
  /** 每个 session 连续读到的 chunk 上界（exclusive）。 */
  readThroughBySession: Record<string, number>
}

export interface WriteBidDocumentHandleInput {
  workspacePath: string
  sessionId: string
  docId: string
  fingerprint: string
  kind: BidDocumentKind
  filename: string
  datasetId: string
  documentId: string
}

export interface ReadBidDocumentHandleInput {
  workspacePath: string
  sessionId: string
  docId: string
}

export function isBidAnalysisAgent(agentId: string): boolean {
  return agentId === BID_ANALYSIS_AGENT_ID
}

export function bidFingerprint(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export function bidDocumentId(fingerprint: string): string {
  return `rf-${fingerprint.slice(0, 32)}`
}

export function isBidDocumentId(value: string): boolean {
  return BID_DOC_ID_PATTERN.test(value)
}

export function readThroughOf(handle: BidDocumentHandle, sessionId: string): number {
  return handle.readThroughBySession[sessionId] ?? 0
}

function bidDocumentDir(workspacePath: string): string {
  return join(workspacePath, BID_DOCUMENT_DIR_NAME)
}

export function bidDocumentFilePath(workspacePath: string, docId: string): string {
  if (!isBidDocumentId(docId)) throw new Error('文档句柄无效')
  const dir = bidDocumentDir(workspacePath)
  const file = join(dir, `${docId}.json`)
  if (!isPathInside(file, dir)) throw new Error('文档句柄无效')
  return file
}

export async function writeBidDocumentHandle(input: WriteBidDocumentHandleInput): Promise<BidDocumentHandle> {
  const file = bidDocumentFilePath(input.workspacePath, input.docId)
  const existing = await tryReadBidFile(file)
  const now = Date.now()

  const handle: BidDocumentHandle = {
    version: 2,
    docId: input.docId,
    fingerprint: input.fingerprint,
    kind: input.kind,
    filename: input.filename,
    datasetId: input.datasetId,
    documentId: input.documentId,
    sessionIds: [...new Set([...(existing?.sessionIds ?? []), input.sessionId])],
    createdAt: existing?.createdAt ?? now,
    lastAccessAt: now,
    expiresAt: existing?.expiresAt,
    readThroughBySession: { ...existing?.readThroughBySession }
  }

  await ensureDir(AbsoluteFilePathSchema.parse(bidDocumentDir(input.workspacePath)))
  await atomicWriteFile(AbsoluteFilePathSchema.parse(file), JSON.stringify(handle))
  return handle
}

export async function readBidDocumentHandle(input: ReadBidDocumentHandleInput): Promise<BidDocumentHandle> {
  const handle = await readBidFile(bidDocumentFilePath(input.workspacePath, input.docId))
  if (handle.docId !== input.docId || !handle.sessionIds.includes(input.sessionId)) {
    throw new Error('文档不存在或不属于当前会话，请重新发送附件')
  }
  return handle
}

export async function touchBidDocumentHandle(input: ReadBidDocumentHandleInput): Promise<void> {
  const handle = await readBidDocumentHandle(input)
  const file = bidDocumentFilePath(input.workspacePath, input.docId)
  await atomicWriteFile(AbsoluteFilePathSchema.parse(file), JSON.stringify({ ...handle, lastAccessAt: Date.now() }))
}

/** 连续读取推进：只有请求起点未越过已读上界时才推进。 */
export async function updateBidReadThrough(
  input: ReadBidDocumentHandleInput & { readThrough: number }
): Promise<number> {
  const handle = await readBidDocumentHandle(input)
  const current = readThroughOf(handle, input.sessionId)
  const next = Math.max(current, input.readThrough)
  if (next === current) return current

  const file = bidDocumentFilePath(input.workspacePath, input.docId)
  await atomicWriteFile(
    AbsoluteFilePathSchema.parse(file),
    JSON.stringify({
      ...handle,
      lastAccessAt: Date.now(),
      readThroughBySession: { ...handle.readThroughBySession, [input.sessionId]: next }
    })
  )
  return next
}

async function tryReadBidFile(file: string): Promise<BidDocumentHandle | null> {
  try {
    return await readBidFile(file)
  } catch {
    return null
  }
}

async function readBidFile(file: string): Promise<BidDocumentHandle> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    throw new Error('文档已过期或不存在，请重新发送附件')
  }

  let parsed: BidDocumentHandle
  try {
    parsed = JSON.parse(raw) as BidDocumentHandle
  } catch {
    throw new Error('文档已过期或不存在，请重新发送附件')
  }

  if (
    parsed?.version !== 2 ||
    !isBidDocumentId(parsed.docId) ||
    typeof parsed.fingerprint !== 'string' ||
    typeof parsed.datasetId !== 'string' ||
    typeof parsed.documentId !== 'string' ||
    !Array.isArray(parsed.sessionIds) ||
    typeof parsed.readThroughBySession !== 'object' ||
    parsed.readThroughBySession === null
  ) {
    throw new Error('文档已过期或不存在，请重新发送附件')
  }

  return parsed
}

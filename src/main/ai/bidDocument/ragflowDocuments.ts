/**
 * 标书附件在 RagFlow TemporaryKB 中的建库、上传、指纹去重与解析等待。
 *
 * RagFlow 1.0 rc2 只有 general parser 能同时保留表格与 PDF 页码；章节路径
 * 由 sectionIndex 在 TS 层构建，不依赖 RagFlow 的 hierarchy chunker。
 */

import { loggerService } from '@logger'
import { ragflowClient } from '@main/features/ragflow'
import type { RagflowDocument } from '@shared/ipc/schemas/ragflow'
import { TEMPORARY_KB_NAME } from '@shared/utils/ragflow'

const logger = loggerService.withContext('BidRagflowDocuments')

const PARSE_POLL_INTERVAL_MS = 2_000
const PARSE_WAIT_DEFAULT_MS = 30_000
const PARSE_WATCH_MAX_MS = 30 * 60_000

export interface TemporaryKb {
  id: string
  name: string
}

let temporaryKbPromise: Promise<TemporaryKb> | undefined

export async function ensureTemporaryKb(signal?: AbortSignal): Promise<TemporaryKb> {
  temporaryKbPromise ??= resolveTemporaryKb(signal).catch((error: unknown) => {
    temporaryKbPromise = undefined
    throw error
  })
  return temporaryKbPromise
}

async function resolveTemporaryKb(signal?: AbortSignal): Promise<TemporaryKb> {
  const { items } = await ragflowClient.listDatasets({ name: TEMPORARY_KB_NAME, pageSize: 100, signal })
  const existing = items.find((item) => item.name === TEMPORARY_KB_NAME)

  if (existing) {
    const parserId = existing.parserId ?? null
    if (parserId !== 'general') {
      if (existing.documentCount === 0) {
        await ragflowClient.updateDatasetParser({ datasetId: existing.id, parserId: 'general', signal })
      } else {
        throw new Error(
          `RagFlow 数据集 ${TEMPORARY_KB_NAME} 已存在但解析器是 ${parserId ?? 'unknown'}，请删除或重建为 general`
        )
      }
    }
    return { id: existing.id, name: existing.name }
  }

  const created = await ragflowClient.createDataset({ name: TEMPORARY_KB_NAME, parserId: 'general', signal })
  if (created.name === TEMPORARY_KB_NAME) return { id: created.id, name: created.name }

  // rc2 遇到同名会改成 “name (1)”；再查一次精确名，避免用到错误的库。
  const retry = await ragflowClient.listDatasets({ name: TEMPORARY_KB_NAME, pageSize: 100, signal })
  const exact = retry.items.find((item) => item.name === TEMPORARY_KB_NAME)
  if (!exact) throw new Error(`无法创建 RagFlow 数据集 ${TEMPORARY_KB_NAME}`)
  return { id: exact.id, name: exact.name }
}

const fingerprintLocks = new Map<string, Promise<unknown>>()

/** 同一指纹的“查询→上传”串行化，避免两个会话同时传同一文件。 */
export async function withFingerprintLock<T>(fingerprint: string, work: () => Promise<T>): Promise<T> {
  const previous = fingerprintLocks.get(fingerprint) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(work)
  fingerprintLocks.set(fingerprint, next)
  try {
    return await next
  } finally {
    if (fingerprintLocks.get(fingerprint) === next) fingerprintLocks.delete(fingerprint)
  }
}

export interface FingerprintHit {
  document: RagflowDocument
  failed: boolean
}

/** 按文档 metadata fingerprint 精确查找；RagFlow 的 metadata 查询可能模糊，再过滤一次。 */
export async function findDocumentByFingerprint(input: {
  datasetId: string
  fingerprint: string
  signal?: AbortSignal
}): Promise<FingerprintHit | null> {
  const { items } = await ragflowClient.listDocuments({
    datasetId: input.datasetId,
    metadata: { fingerprint: input.fingerprint },
    pageSize: 100,
    signal: input.signal
  })
  const matches = items.filter((item) => item.metaFields?.fingerprint === input.fingerprint)
  if (matches.length === 0) return null

  const sortedMatches = [...matches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const document = sortedMatches[0]
  return { document, failed: document.run === 'FAIL' || document.run === 'CANCEL' }
}

export interface IngestBidDocumentInput {
  fingerprint: string
  filename: string
  content: Uint8Array
  signal?: AbortSignal
}

export interface IngestBidDocumentResult {
  datasetId: string
  documentId: string
  documentName: string
  reused: boolean
}

export async function ingestBidDocument(input: IngestBidDocumentInput): Promise<IngestBidDocumentResult> {
  return withFingerprintLock(input.fingerprint, async () => {
    const dataset = await ensureTemporaryKb(input.signal)
    const hit = await findDocumentByFingerprint({
      datasetId: dataset.id,
      fingerprint: input.fingerprint,
      signal: input.signal
    })

    if (hit) {
      if (hit.failed || hit.document.run === 'UNSTART') {
        try {
          await ragflowClient.startParsing({
            datasetId: dataset.id,
            documentIds: [hit.document.id],
            signal: input.signal
          })
        } catch (error) {
          // 已有人在跑解析时不能阻断复用；真正的失败由读取工具回报。
          logger.warn('Could not restart RagFlow parsing for a reused document', {
            documentId: hit.document.id,
            error
          })
        }
      }
      return {
        datasetId: dataset.id,
        documentId: hit.document.id,
        documentName: hit.document.name,
        reused: true
      }
    }

    const uploaded = await ragflowClient.uploadDocument({
      datasetId: dataset.id,
      filename: input.filename,
      content: input.content,
      signal: input.signal
    })
    await writeFingerprintMetadata(dataset.id, uploaded.id, input.fingerprint, input.signal)
    await ragflowClient.startParsing({
      datasetId: dataset.id,
      documentIds: [uploaded.id],
      signal: input.signal
    })

    return {
      datasetId: dataset.id,
      documentId: uploaded.id,
      documentName: uploaded.name,
      reused: false
    }
  })
}

async function writeFingerprintMetadata(
  datasetId: string,
  documentId: string,
  fingerprint: string,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await ragflowClient.updateDocumentMetadata({
        datasetId,
        documentId,
        metaFields: { fingerprint },
        signal
      })
      return
    } catch (error) {
      if (attempt === 0) continue
      logger.error('Failed to write RagFlow fingerprint metadata after retry', {
        datasetId,
        documentId,
        error
      })
      throw new Error('RagFlow 文档指纹写入失败，无法保证后续去重', { cause: error })
    }
  }
}

export type WaitForBidDocumentResult =
  | { status: 'done'; document: RagflowDocument }
  | { status: 'failed'; document: RagflowDocument; error: string }
  | { status: 'processing'; document: RagflowDocument; progress: number }

export async function waitForBidDocument(input: {
  datasetId: string
  documentId: string
  timeoutMs?: number
  intervalMs?: number
  signal?: AbortSignal
}): Promise<WaitForBidDocumentResult> {
  const deadline = Date.now() + (input.timeoutMs ?? PARSE_WAIT_DEFAULT_MS)
  const interval = input.intervalMs ?? PARSE_POLL_INTERVAL_MS

  for (;;) {
    const document = await ragflowClient.findDocument({
      datasetId: input.datasetId,
      documentId: input.documentId,
      signal: input.signal
    })
    if (!document) throw new Error('文档已过期或不存在，请重新发送附件')

    if (document.run === 'DONE') return { status: 'done', document }
    if (document.run === 'FAIL' || document.run === 'CANCEL') {
      return {
        status: 'failed',
        document,
        error: document.latestEventMessage ?? document.progressMessage ?? 'RagFlow 解析失败'
      }
    }
    if (Date.now() >= deadline) return { status: 'processing', document, progress: document.progress }

    await delay(interval, input.signal)
  }
}

/** 后台轮询解析状态；用于客户端状态胶囊，不依赖模型是否调用读取工具。 */
export async function watchBidDocumentParse(input: {
  datasetId: string
  documentId: string
  onUpdate: (result: WaitForBidDocumentResult) => void | Promise<void>
  intervalMs?: number
  signal?: AbortSignal
}): Promise<void> {
  const interval = input.intervalMs ?? PARSE_POLL_INTERVAL_MS
  const deadline = Date.now() + PARSE_WATCH_MAX_MS
  while (!input.signal?.aborted && Date.now() < deadline) {
    const result = await waitForBidDocument({
      datasetId: input.datasetId,
      documentId: input.documentId,
      timeoutMs: interval,
      intervalMs: interval,
      signal: input.signal
    })
    await input.onUpdate(result)
    if (result.status !== 'processing') return
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'))
      return
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      cleanup()
      reject(signal?.reason ?? new Error('Aborted'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

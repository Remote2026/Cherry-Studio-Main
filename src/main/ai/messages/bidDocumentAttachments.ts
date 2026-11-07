/**
 * 标书分析附件预处理：把 PDF/DOCX 上传到 RagFlow TemporaryKB，并用文档句柄
 * 替换原始文件 part，避免大文件直接进入模型上下文。
 */

import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loggerService } from '@logger'
import { setBidAttachmentStatus } from '@main/ai/bidDocument/attachmentStatus'
import {
  BID_CHECK_COVERAGE_TOOL_NAME,
  BID_READ_CHUNKS_TOOL_NAME,
  MAX_BID_DOCUMENT_BYTES,
  bidDocumentId,
  bidFingerprint,
  writeBidDocumentHandle,
  type BidDocumentKind
} from '@main/ai/bidDocument/documentHandle'
import { ingestBidDocument, watchBidDocumentParse } from '@main/ai/bidDocument/ragflowDocuments'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryMessagePart } from '@shared/data/types/message'

const logger = loggerService.withContext('BidDocumentAttachments')

const DOCUMENT_EXTS = new Set(['pdf', 'docx'])

type FileMessagePart = Extract<CherryMessagePart, { type: 'file' }>

export interface PrepareBidDocumentMessageInput {
  agentId: string
  sessionId: string
  workspacePath: string
  message: AgentSessionMessageEntity
  signal: AbortSignal
}

const filePathOf = (part: FileMessagePart): string | null => {
  if (!part.url.startsWith('file://')) return null
  try {
    return fileURLToPath(part.url)
  } catch {
    return null
  }
}

const filenameOf = (part: FileMessagePart): string => {
  if (part.filename) return part.filename
  const path = filePathOf(part)
  return path ? basename(path) : 'attachment'
}

const buildHandleText = (docId: string, filename: string): string =>
  [
    `[系统提示] 附件「${filename}」已上传到 RagFlow 的 TemporaryKB，由 General/DeepDOC 解析。`,
    '正文只能通过下方文档工具读取，不得直接读取原文件或使用命令等待解析。',
    '',
    `文档句柄：${docId}`,
    '',
    `使用 mcp__cherry-tools__${BID_READ_CHUNKS_TOOL_NAME} 连续读取；首次只传 docId，后续沿用工具返回的 nextIndex。`,
    `生成报告前调用 mcp__cherry-tools__${BID_CHECK_COVERAGE_TOOL_NAME}，只有 complete 且无 gaps 时才能声称已读完。`,
    '工具返回失败、过期或不属于当前会话时，告知用户检查 RagFlow 或重新发送附件。'
  ].join('\n')

const buildFailureText = (filename: string, reason: string): string =>
  `[系统提示] 附件「${filename}」上传/解析 RagFlow 失败：${reason}。请告知用户检查 RagFlow 设置或稍后重试；不得使用 read/bash 读取原文件，也不得编造内容。`

const buildTooLargeText = (filename: string): string =>
  `[系统提示] 附件「${filename}」超过 RagFlow 上传上限（128MB），未做解析。请提示用户拆分文件；不得声称已完整读取该文件。`

export async function prepareBidDocumentMessage(
  input: PrepareBidDocumentMessageInput
): Promise<AgentSessionMessageEntity> {
  const parts = input.message.data?.parts
  if (!parts?.length) return input.message

  const fileParts = parts.flatMap((part, index) => (part.type === 'file' ? [{ part, index }] : []))
  if (fileParts.length === 0) return input.message

  const rewritten: CherryMessagePart[] = structuredClone(parts)
  let changed = false

  for (const { part, index } of fileParts) {
    if (input.signal.aborted) throw input.signal.reason ?? new Error('Aborted')

    const path = filePathOf(part)
    if (!path) continue
    const ext = extname(path).replace(/^\./, '').toLowerCase()
    if (!DOCUMENT_EXTS.has(ext)) continue

    const kind = ext as BidDocumentKind
    const filename = filenameOf(part)
    let docId: string | undefined

    try {
      const size = (await stat(path)).size
      if (size > MAX_BID_DOCUMENT_BYTES) {
        rewritten[index] = { type: 'text', text: buildTooLargeText(filename) }
        changed = true
        continue
      }

      const content = await readFile(path)
      if (input.signal.aborted) throw input.signal.reason ?? new Error('Aborted')

      const fingerprint = bidFingerprint(content)
      const resolvedDocId = bidDocumentId(fingerprint)
      docId = resolvedDocId
      setBidAttachmentStatus({
        sessionId: input.sessionId,
        messageId: input.message.id,
        docId: resolvedDocId,
        filename,
        phase: 'uploading'
      })

      const ingested = await ingestBidDocument({ fingerprint, filename, content, signal: input.signal })

      await writeBidDocumentHandle({
        workspacePath: input.workspacePath,
        sessionId: input.sessionId,
        docId: resolvedDocId,
        fingerprint,
        kind,
        filename,
        datasetId: ingested.datasetId,
        documentId: ingested.documentId
      })

      setBidAttachmentStatus({
        sessionId: input.sessionId,
        messageId: input.message.id,
        docId: resolvedDocId,
        filename,
        phase: 'parsing',
        percent: 0
      })
      void watchBidDocumentParse({
        datasetId: ingested.datasetId,
        documentId: ingested.documentId,
        onUpdate: (result) => {
          if (result.status === 'processing') {
            setBidAttachmentStatus({
              sessionId: input.sessionId,
              messageId: input.message.id,
              docId: resolvedDocId,
              filename,
              phase: 'parsing',
              percent: Math.round(result.progress * 100)
            })
          } else if (result.status === 'done') {
            setBidAttachmentStatus({
              sessionId: input.sessionId,
              messageId: input.message.id,
              docId: resolvedDocId,
              filename,
              phase: 'ready',
              percent: 100
            })
          } else {
            setBidAttachmentStatus({
              sessionId: input.sessionId,
              messageId: input.message.id,
              docId: resolvedDocId,
              filename,
              phase: 'failed',
              error: result.error
            })
          }
        }
      }).catch((error: unknown) => {
        setBidAttachmentStatus({
          sessionId: input.sessionId,
          messageId: input.message.id,
          docId: resolvedDocId,
          filename,
          phase: 'failed',
          error: error instanceof Error ? error.message : String(error)
        })
      })

      rewritten[index] = { type: 'text', text: buildHandleText(resolvedDocId, filename) }
      changed = true
    } catch (error) {
      if (input.signal.aborted) throw error
      logger.warn('Failed to prepare a bid document for RagFlow; replacing the attachment with a failure note', {
        filename,
        error: error instanceof Error ? error.message : String(error)
      })
      rewritten[index] = {
        type: 'text',
        text: buildFailureText(filename, error instanceof Error ? error.message : String(error))
      }
      if (docId) {
        setBidAttachmentStatus({
          sessionId: input.sessionId,
          messageId: input.message.id,
          docId,
          filename,
          phase: 'failed',
          error: error instanceof Error ? error.message : String(error)
        })
      }
      changed = true
    }
  }

  if (!changed) return input.message
  return { ...input.message, data: { ...input.message.data, parts: rewritten } }
}

/** 顶层异常兜底：把 PDF/DOCX 文件 part 换成失败提示，避免原文件进入上下文。 */
export function withBidDocumentFailureNotes(
  message: AgentSessionMessageEntity,
  error: unknown
): AgentSessionMessageEntity {
  const parts = message.data?.parts
  if (!parts?.length) return message

  const reason = error instanceof Error ? error.message : String(error)
  const rewritten = parts.map((part): CherryMessagePart => {
    if (part.type !== 'file') return part
    const path = filePathOf(part)
    const ext = path ? extname(path).replace(/^\./, '').toLowerCase() : ''
    if (!DOCUMENT_EXTS.has(ext)) return part
    return { type: 'text', text: buildFailureText(filenameOf(part), reason) }
  })

  return { ...message, data: { ...message.data, parts: rewritten } }
}

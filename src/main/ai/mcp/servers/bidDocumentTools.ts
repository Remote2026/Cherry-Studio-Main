/**
 * bid_read_chunks / bid_check_coverage：TemporaryKB 文档的顺序读取与完整性检查。
 *
 * 工具负责顺序、连续性、进度和完成状态；模型只负责理解与生成报告。
 */

import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { checkBidCoverage, readBidChunkBatch } from '@main/ai/bidDocument/chunkReader'
import {
  BID_CHECK_COVERAGE_TOOL_NAME,
  BID_READ_CHUNKS_TOOL_NAME,
  readBidDocumentHandle,
  readThroughOf,
  touchBidDocumentHandle,
  updateBidReadThrough
} from '@main/ai/bidDocument/documentHandle'
import { waitForBidDocument } from '@main/ai/bidDocument/ragflowDocuments'
import { modelOutputToMcpResult } from '@main/ai/mcp/toolResult'

const DEFAULT_MAX_TOKENS = 6_000
const MAX_TOKENS = 12_000
const PARSE_WAIT_MS = 30_000

const readInputSchema = z.object({
  docId: z.string().min(1),
  startIndex: z.number().int().min(0).optional(),
  maxTokens: z.number().int().positive().max(MAX_TOKENS).optional()
})

const coverageInputSchema = z.object({ docId: z.string().min(1) })

const BID_READ_CHUNKS_DESCRIPTION = `Read consecutive chunks from a PDF/DOCX parsed by RagFlow (TemporaryKB).

Input: docId is required; omit startIndex on the first call, then pass the previous nextIndex unchanged. maxTokens is optional (1-${MAX_TOKENS}, default ${DEFAULT_MAX_TOKENS}).
Chunks include [第N段｜第P页｜章节] when page/section is known; table chunks are marked [表].
If status="processing", call again with the same docId/startIndex after retryAfterMs; do not use read/bash or invent content. Before reporting, call ${BID_CHECK_COVERAGE_TOOL_NAME} and resolve all gaps.`

const BID_CHECK_COVERAGE_DESCRIPTION = `Check contiguous read coverage for a RagFlow TemporaryKB document.

Input: docId is required. Returns gaps, covered/missing sections, and read/unread table chunks.
complete=true proves every chunk was delivered, not that the analysis is correct; continue reading when complete=false or gaps exist.`

export interface BidDocumentToolsContext {
  sessionId: string
  workspacePath: string
}

export function registerBidDocumentTools(server: McpServer, context: BidDocumentToolsContext): void {
  server.registerTool(
    BID_READ_CHUNKS_TOOL_NAME,
    { description: BID_READ_CHUNKS_DESCRIPTION, inputSchema: readInputSchema },
    async (input, ctx) => {
      try {
        const handle = await readBidDocumentHandle({
          workspacePath: context.workspacePath,
          sessionId: context.sessionId,
          docId: input.docId
        })

        const wait = await waitForBidDocument({
          datasetId: handle.datasetId,
          documentId: handle.documentId,
          timeoutMs: PARSE_WAIT_MS,
          signal: ctx.mcpReq.signal
        })

        if (wait.status === 'processing') {
          return modelOutputToMcpResult({
            type: 'json',
            value: {
              status: 'processing',
              docId: handle.docId,
              filename: handle.filename,
              progress: wait.progress,
              retryAfterMs: 5_000
            }
          })
        }
        if (wait.status === 'failed') {
          return modelOutputToMcpResult({
            type: 'json',
            value: { status: 'failed', docId: handle.docId, filename: handle.filename, error: wait.error }
          })
        }

        const expectedTotal = wait.document.chunkCount > 0 ? wait.document.chunkCount : undefined
        const batch = await readBidChunkBatch({
          datasetId: handle.datasetId,
          documentId: handle.documentId,
          startIndex: input.startIndex,
          maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
          expectedTotal,
          signal: ctx.mcpReq.signal
        })

        if (batch.total === 0) {
          return modelOutputToMcpResult({
            type: 'json',
            value: {
              status: 'failed',
              docId: handle.docId,
              filename: handle.filename,
              error: 'RagFlow 解析完成但没有分块，请检查解析结果或重新发送附件'
            }
          })
        }

        const currentReadThrough = readThroughOf(handle, context.sessionId)
        const nextReadThrough =
          batch.startIndex <= currentReadThrough ? Math.max(currentReadThrough, batch.endIndex + 1) : currentReadThrough
        const readThrough = await updateBidReadThrough({
          workspacePath: context.workspacePath,
          sessionId: context.sessionId,
          docId: handle.docId,
          readThrough: nextReadThrough
        })

        return modelOutputToMcpResult({
          type: 'json',
          value: {
            status: 'completed',
            docId: handle.docId,
            filename: handle.filename,
            startIndex: batch.startIndex,
            endIndex: batch.endIndex,
            nextIndex: batch.nextIndex,
            done: batch.done,
            total: batch.total,
            content: batch.content,
            tokens: batch.tokens,
            readThrough,
            ...(batch.sectionPath ? { sectionPath: batch.sectionPath } : {}),
            ...(batch.sectionNumber ? { sectionNumber: batch.sectionNumber } : {}),
            ...(batch.sectionConfidence ? { sectionConfidence: batch.sectionConfidence } : {})
          }
        })
      } catch (error) {
        return modelOutputToMcpResult({
          type: 'json',
          value: {
            status: 'failed',
            docId: input.docId,
            error: error instanceof Error ? error.message : String(error)
          }
        })
      }
    }
  )

  server.registerTool(
    BID_CHECK_COVERAGE_TOOL_NAME,
    { description: BID_CHECK_COVERAGE_DESCRIPTION, inputSchema: coverageInputSchema },
    async (input, ctx) => {
      try {
        const handle = await readBidDocumentHandle({
          workspacePath: context.workspacePath,
          sessionId: context.sessionId,
          docId: input.docId
        })
        await touchBidDocumentHandle({
          workspacePath: context.workspacePath,
          sessionId: context.sessionId,
          docId: input.docId
        })

        const wait = await waitForBidDocument({
          datasetId: handle.datasetId,
          documentId: handle.documentId,
          timeoutMs: 0,
          signal: ctx.mcpReq.signal
        })
        if (wait.status === 'processing') {
          return modelOutputToMcpResult({
            type: 'json',
            value: {
              status: 'processing',
              docId: handle.docId,
              filename: handle.filename,
              progress: wait.progress,
              retryAfterMs: 5_000
            }
          })
        }
        if (wait.status === 'failed') {
          return modelOutputToMcpResult({
            type: 'json',
            value: { status: 'failed', docId: handle.docId, filename: handle.filename, error: wait.error }
          })
        }

        const expectedTotal = wait.document.chunkCount > 0 ? wait.document.chunkCount : undefined
        const coverage = await checkBidCoverage({
          datasetId: handle.datasetId,
          documentId: handle.documentId,
          readThrough: readThroughOf(handle, context.sessionId),
          expectedTotal,
          signal: ctx.mcpReq.signal
        })

        return modelOutputToMcpResult({
          type: 'json',
          value: { status: 'completed', docId: handle.docId, filename: handle.filename, ...coverage }
        })
      } catch (error) {
        return modelOutputToMcpResult({
          type: 'json',
          value: {
            status: 'failed',
            docId: input.docId,
            error: error instanceof Error ? error.message : String(error)
          }
        })
      }
    }
  )
}

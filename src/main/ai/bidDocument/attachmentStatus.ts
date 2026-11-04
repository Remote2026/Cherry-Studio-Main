/**
 * 标书附件状态：按 session/docId 合并，写入 main-owned shared cache。
 *
 * 不覆盖其他消息/附件；终态保留 10 秒后清理，避免胶囊一直停留。
 */

import { application } from '@application'
import {
  BID_ATTACHMENT_STATUS_CACHE_KEY,
  type BidAttachmentFileStatus,
  type BidAttachmentPhase
} from '@shared/ai/bidAttachmentStatus'

const CLEAR_DELAY_MS = 10_000

const statusBySession = new Map<string, Map<string, BidAttachmentFileStatus>>()
const clearTimers = new Map<string, ReturnType<typeof setTimeout>>()

export interface SetBidAttachmentStatusInput {
  sessionId: string
  messageId: string
  docId: string
  filename: string
  phase: BidAttachmentPhase
  percent?: number | null
  error?: string
}

export function setBidAttachmentStatus(input: SetBidAttachmentStatusInput): void {
  const bucket = statusBySession.get(input.sessionId) ?? new Map<string, BidAttachmentFileStatus>()
  statusBySession.set(input.sessionId, bucket)

  bucket.set(input.docId, {
    messageId: input.messageId,
    docId: input.docId,
    filename: input.filename,
    phase: input.phase,
    percent: input.percent ?? null,
    ...(input.error ? { error: input.error } : {}),
    updatedAt: Date.now()
  })
  publish(input.sessionId)

  if (input.phase === 'ready' || input.phase === 'failed') scheduleClear(input.sessionId, input.docId)
}

function publish(sessionId: string): void {
  const bucket = statusBySession.get(sessionId)
  const files = bucket ? [...bucket.values()].sort((a, b) => a.updatedAt - b.updatedAt) : []
  application.get('CacheService').setShared(BID_ATTACHMENT_STATUS_CACHE_KEY(sessionId), { files })
}

function scheduleClear(sessionId: string, docId: string): void {
  const key = `${sessionId}:${docId}`
  const existing = clearTimers.get(key)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    clearTimers.delete(key)
    const bucket = statusBySession.get(sessionId)
    bucket?.delete(docId)
    if (bucket && bucket.size === 0) statusBySession.delete(sessionId)
    publish(sessionId)
  }, CLEAR_DELAY_MS)
  timer.unref?.()
  clearTimers.set(key, timer)
}

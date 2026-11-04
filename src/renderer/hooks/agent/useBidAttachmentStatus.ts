import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { BID_ATTACHMENT_STATUS_CACHE_KEY, type BidAttachmentStatus } from '@shared/ai/bidAttachmentStatus'

const EMPTY_STATUS: BidAttachmentStatus = { files: [] }
const EMPTY_SESSION_ID = '__none__'

/** 只读观察 main 写入的标书附件状态，不把 schema 默认值写回缓存。 */
export function useBidAttachmentStatus(sessionId: string | undefined): BidAttachmentStatus {
  const state = useSharedCacheValue(BID_ATTACHMENT_STATUS_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))
  if (!sessionId) return EMPTY_STATUS
  return state ?? EMPTY_STATUS
}

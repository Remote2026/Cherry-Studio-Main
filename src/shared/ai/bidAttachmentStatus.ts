/** 标书附件上传/解析状态：main 写入 shared cache，renderer 只读展示。 */
export type BidAttachmentPhase = 'uploading' | 'parsing' | 'ready' | 'failed'

export interface BidAttachmentFileStatus {
  messageId: string
  docId: string
  filename: string
  phase: BidAttachmentPhase
  /** 解析阶段 0-100；uploading/未知时为 null。 */
  percent: number | null
  error?: string
  updatedAt: number
}

export interface BidAttachmentStatus {
  files: BidAttachmentFileStatus[]
}

export const BID_ATTACHMENT_STATUS_CACHE_KEY = (sessionId: string) =>
  `agent.session.bid_attachment_status.${sessionId}` as const

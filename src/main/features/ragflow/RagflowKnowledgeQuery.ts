import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { KnowledgeItemChunk } from '@shared/data/types/knowledge'

import { ragflowClient } from './RagflowClient'

const PAGE_SIZE = 100

/** 一条镜像条目在远端的定位信息。本地条目没有对应物，解析结果为 undefined。 */
export type MirroredItemLocator = {
  datasetId: string
  documentId: string
  itemId: string
  /** 展示用的来源名，即 RagFlow 报出的文档名。 */
  source: string
}

/**
 * 定位一条镜像条目。返回 undefined 表示这是本地条目——调用方据此走本地链路，
 * 而不是把 RagFlow 的 id 交给本地知识服务。
 */
export const resolveMirroredItem = (baseId: string, itemId: string): MirroredItemLocator | undefined => {
  const base = knowledgeBaseService.getById(baseId)
  if (base.source !== 'ragflow' || base.remoteId === null) return undefined

  const item = knowledgeItemService.getById(itemId)
  if (item.baseId !== baseId || item.type !== 'ragflow' || !item.remoteId) return undefined

  return { datasetId: base.remoteId, documentId: item.remoteId, itemId: item.id, source: item.data.source }
}

/**
 * 镜像条目的分块列表，由 RagFlow 提供。分块序号取响应顺序、token 数记 0，
 * 与检索结果的映射（knowledgeMapping）保持同一套约定：RagFlow 两者都不报。
 */
export const listRagflowItemChunks = async (locator: MirroredItemLocator): Promise<KnowledgeItemChunk[]> => {
  const chunks: KnowledgeItemChunk[] = []

  for (let page = 1; ; page += 1) {
    const { items } = await ragflowClient.listChunks({
      datasetId: locator.datasetId,
      documentId: locator.documentId,
      page,
      pageSize: PAGE_SIZE
    })

    for (const chunk of items) {
      chunks.push({
        id: chunk.id,
        itemId: locator.itemId,
        content: chunk.content,
        metadata: {
          itemId: locator.itemId,
          itemType: 'ragflow',
          source: locator.source,
          chunkIndex: chunks.length,
          tokenCount: 0
        }
      })
    }

    if (items.length < PAGE_SIZE) return chunks
  }
}

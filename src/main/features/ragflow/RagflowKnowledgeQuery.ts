import { and, eq } from 'drizzle-orm'

import { application } from '@application'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { KnowledgeItemChunk, KnowledgeSearchResult } from '@shared/data/types/knowledge'

import { toKnowledgeSearchResults, type RagflowHitSource } from './knowledgeMapping'
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

/** 该库的内容是否在远端。检索与分块都据此在本地链路和 RagFlow 之间分流。 */
export const isMirroredBase = (baseId: string): boolean => {
  const base = knowledgeBaseService.getById(baseId)
  return base.source === 'ragflow'
}

/** 检索命中只带远端文档 id，得反查回本地条目——查不到的结果既打不开也引用不了。 */
const resolveHitSource = (baseId: string, documentId: string): RagflowHitSource | undefined => {
  const row = application
    .get('DbService')
    .getDb()
    .select({ id: knowledgeItemTable.id, data: knowledgeItemTable.data })
    .from(knowledgeItemTable)
    .where(and(eq(knowledgeItemTable.baseId, baseId), eq(knowledgeItemTable.remoteId, documentId)))
    .get()

  return row ? { itemId: row.id, itemType: 'ragflow', source: row.data.source } : undefined
}

/** 镜像库的检索：问答交给 RagFlow，命中再映射回本地的知识库结果结构。 */
export const searchRagflowKnowledge = async (baseId: string, query: string): Promise<KnowledgeSearchResult[]> => {
  const base = knowledgeBaseService.getById(baseId)
  if (base.source !== 'ragflow' || base.remoteId === null) {
    return []
  }

  const { items } = await ragflowClient.retrieve({ question: query, datasetIds: [base.remoteId] })
  return toKnowledgeSearchResults(items, (documentId) => resolveHitSource(baseId, documentId))
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

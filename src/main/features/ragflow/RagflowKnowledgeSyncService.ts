import { eq, inArray } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  DEFAULT_KNOWLEDGE_BASE_STATUS,
  DEFAULT_KNOWLEDGE_CHUNK_SEPARATOR,
  DEFAULT_KNOWLEDGE_CHUNK_STRATEGY,
  KNOWLEDGE_ITEM_ERROR_RAGFLOW_PARSE_FAILED,
  type KnowledgeItemStatus
} from '@shared/data/types/knowledge'
import type { RagflowDataset, RagflowDocument, RagflowRunState } from '@shared/ipc/schemas/ragflow'

import { RagflowClientError, ragflowClient } from './RagflowClient'

const logger = loggerService.withContext('RagflowKnowledgeSync')

const PAGE_SIZE = 100

type DatasetSnapshot = {
  dataset: RagflowDataset
  documents: RagflowDocument[]
}

type MirroredRow = {
  id: string
  remoteId: string | null
}

/** RagFlow 的解析状态映射到本地条目状态。 */
const toItemLifecycle = (run: RagflowRunState): { status: KnowledgeItemStatus; error: string | null } => {
  if (run === 'DONE') return { status: 'completed', error: null }
  if (run === 'UNSTART' || run === 'RUNNING') return { status: 'processing', error: null }
  return { status: 'failed', error: KNOWLEDGE_ITEM_ERROR_RAGFLOW_PARSE_FAILED }
}

const fetchAllDatasets = async (): Promise<RagflowDataset[]> => {
  const datasets: RagflowDataset[] = []
  for (let page = 1; ; page += 1) {
    const { items } = await ragflowClient.listDatasets({ page, pageSize: PAGE_SIZE })
    datasets.push(...items)
    if (items.length < PAGE_SIZE) return datasets
  }
}

const fetchAllDocuments = async (datasetId: string): Promise<RagflowDocument[]> => {
  const documents: RagflowDocument[] = []
  for (let page = 1; ; page += 1) {
    const { items } = await ragflowClient.listDocuments({ datasetId, page, pageSize: PAGE_SIZE })
    documents.push(...items)
    if (items.length < PAGE_SIZE) return documents
  }
}

/**
 * 把 RagFlow 数据集与文档的元数据镜像进本地知识库两张表。
 *
 * 只写 `source = 'ragflow'` 的行，本地知识库的数据不在这里被读写。远端拉取失败时一律
 * 不删镜像行——RagFlow 宕机不该让知识库看起来被清空。落库在一次同步事务里完成；网络
 * 请求全部先跑完，事务内不await任何 I/O。
 */
export class RagflowKnowledgeSyncService {
  /** 导入用户选中的数据集；已导入的按 remoteId 命中并刷新，不会重复建库。 */
  async importDatasets(remoteDatasetIds: string[]): Promise<void> {
    const datasets = await fetchAllDatasets()
    const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]))
    const chosen = remoteDatasetIds.flatMap((id) => {
      const dataset = datasetById.get(id)
      return dataset ? [dataset] : []
    })

    if (chosen.length === 0) {
      throw new RagflowClientError('REQUEST_FAILED', 'None of the selected RagFlow datasets exist')
    }

    const snapshots: DatasetSnapshot[] = []
    for (const dataset of chosen) {
      snapshots.push({ dataset, documents: await fetchAllDocuments(dataset.id) })
    }

    this.writeMirror(snapshots, new Set(datasetById.keys()))
  }

  /** 刷新所有已导入的镜像库，并清掉 RagFlow 侧已不存在的数据集与文档。 */
  async sync(): Promise<void> {
    const datasets = await fetchAllDatasets()
    const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]))
    const snapshots: DatasetSnapshot[] = []

    for (const base of this.listMirroredBases()) {
      // 远端已删除：本轮不拉文档，交给 prune 处理。
      const dataset = base.remoteId === null ? undefined : datasetById.get(base.remoteId)
      if (!dataset) continue

      try {
        snapshots.push({ dataset, documents: await fetchAllDocuments(dataset.id) })
      } catch (error) {
        // 单个数据集拉不到文档不能牵连别的库，也不能让它的镜像行被当成"已消失"删掉。
        logger.warn('Skipped a RagFlow dataset whose documents could not be listed', {
          datasetId: dataset.id,
          error
        })
      }
    }

    this.writeMirror(snapshots, new Set(datasetById.keys()))
  }

  private listMirroredBases(): MirroredRow[] {
    return application
      .get('DbService')
      .getDb()
      .select({ id: knowledgeBaseTable.id, remoteId: knowledgeBaseTable.remoteId })
      .from(knowledgeBaseTable)
      .where(eq(knowledgeBaseTable.source, 'ragflow'))
      .all()
  }

  private writeMirror(snapshots: DatasetSnapshot[], knownRemoteIds: ReadonlySet<string>): void {
    application.get('DbService').withWriteTx((tx) => {
      const existingBases = tx
        .select({ id: knowledgeBaseTable.id, remoteId: knowledgeBaseTable.remoteId })
        .from(knowledgeBaseTable)
        .where(eq(knowledgeBaseTable.source, 'ragflow'))
        .all()
      const baseIdByRemoteId = new Map(
        existingBases.flatMap((base) => (base.remoteId === null ? [] : [[base.remoteId, base.id] as const]))
      )

      // 条目随 knowledge_base 的外键级联删除。
      const vanishedBaseIds = existingBases
        .filter((base) => base.remoteId !== null && !knownRemoteIds.has(base.remoteId))
        .map((base) => base.id)
      if (vanishedBaseIds.length > 0) {
        tx.delete(knowledgeBaseTable).where(inArray(knowledgeBaseTable.id, vanishedBaseIds)).run()
      }

      for (const { dataset, documents } of snapshots) {
        const existingBaseId = baseIdByRemoteId.get(dataset.id)
        const baseId = existingBaseId ?? this.insertBase(tx, dataset)
        if (existingBaseId !== undefined) {
          // 远端改过名就跟着改；其余配置仍然只属于 RagFlow。
          tx.update(knowledgeBaseTable).set({ name: dataset.name }).where(eq(knowledgeBaseTable.id, baseId)).run()
        }
        this.writeItems(tx, baseId, documents)
      }
    })

    notifyDataApiDataChange([{ endpoint: '/knowledge-bases', kind: 'projection' }])
  }

  private insertBase(tx: DbOrTx, dataset: RagflowDataset): string {
    const [inserted] = tx
      .insert(knowledgeBaseTable)
      .values({
        name: dataset.name,
        source: 'ragflow',
        remoteId: dataset.id,
        groupId: null,
        // 没有本地 embedding 契约，走 BM25-only 的合法 completed 形态。
        dimensions: null,
        embeddingModelId: null,
        status: DEFAULT_KNOWLEDGE_BASE_STATUS,
        error: null,
        rerankModelId: null,
        fileProcessorId: null,
        chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
        chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
        chunkStrategy: DEFAULT_KNOWLEDGE_CHUNK_STRATEGY,
        chunkSeparator: DEFAULT_KNOWLEDGE_CHUNK_SEPARATOR,
        threshold: null,
        documentCount: null
      })
      .returning({ id: knowledgeBaseTable.id })
      .all()

    return inserted.id
  }

  private writeItems(tx: DbOrTx, baseId: string, documents: RagflowDocument[]): void {
    const existing = tx
      .select({ id: knowledgeItemTable.id, remoteId: knowledgeItemTable.remoteId })
      .from(knowledgeItemTable)
      .where(eq(knowledgeItemTable.baseId, baseId))
      .all()
    const itemIdByRemoteId = new Map(
      existing.flatMap((item) => (item.remoteId === null ? [] : [[item.remoteId, item.id] as const]))
    )

    for (const document of documents) {
      const { status, error } = toItemLifecycle(document.run)
      const values = {
        baseId,
        groupId: null,
        type: 'ragflow' as const,
        remoteId: document.id,
        data: { source: document.name },
        status,
        error
      }
      const itemId = itemIdByRemoteId.get(document.id)
      if (itemId === undefined) {
        tx.insert(knowledgeItemTable).values(values).run()
      } else {
        tx.update(knowledgeItemTable).set(values).where(eq(knowledgeItemTable.id, itemId)).run()
      }
    }

    const seenRemoteIds = new Set(documents.map((document) => document.id))
    const staleItemIds = existing
      .filter((item) => item.remoteId !== null && !seenRemoteIds.has(item.remoteId))
      .map((item) => item.id)
    if (staleItemIds.length > 0) {
      tx.delete(knowledgeItemTable).where(inArray(knowledgeItemTable.id, staleItemIds)).run()
    }
  }
}

export const ragflowKnowledgeSyncService = new RagflowKnowledgeSyncService()

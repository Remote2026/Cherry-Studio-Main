import type { KnowledgeItemType, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import type { RagflowRetrievalHit } from '@shared/ipc/schemas/ragflow'

/**
 * The local identity a mirrored RagFlow document resolves to. Retrieval hits
 * carry only RagFlow ids, so anything that maps them into the knowledge result
 * shape must resolve the owning item first.
 */
export type RagflowHitSource = {
  itemId: string
  itemType: KnowledgeItemType
  source: string
}

/**
 * Maps RagFlow retrieval hits into the knowledge result shape the recall UI and
 * the knowledge tools already consume. Hits whose document cannot be resolved to
 * a local item are dropped — a result the app can neither open nor cite is worse
 * than a shorter list. RagFlow reports neither a chunk ordinal nor a token count,
 * so `chunkIndex` is the hit's position in the response and `tokenCount` is 0.
 */
export const toKnowledgeSearchResults = (
  hits: RagflowRetrievalHit[],
  resolveSource: (documentId: string) => RagflowHitSource | undefined
): KnowledgeSearchResult[] => {
  const results: KnowledgeSearchResult[] = []

  hits.forEach((hit, hitIndex) => {
    const source = resolveSource(hit.documentId)
    if (!source) return

    results.push({
      pageContent: hit.content,
      score: hit.similarity,
      scoreKind: 'relevance',
      rank: results.length + 1,
      metadata: {
        itemId: source.itemId,
        itemType: source.itemType,
        source: source.source,
        chunkIndex: hitIndex,
        tokenCount: 0
      },
      itemId: source.itemId,
      chunkId: hit.chunkId,
      title: hit.documentName
    })
  })

  return results
}

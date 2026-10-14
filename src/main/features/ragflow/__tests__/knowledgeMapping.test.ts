import { v7 as uuidv7 } from 'uuid'
import { describe, expect, it } from 'vitest'

import { KnowledgeSearchResultSchema } from '@shared/data/types/knowledge'
import type { RagflowRetrievalHit } from '@shared/ipc/schemas/ragflow'

import { toKnowledgeSearchResults, type RagflowHitSource } from '../knowledgeMapping'

const ITEM_ID = uuidv7()

const hit = (overrides: Partial<RagflowRetrievalHit> = {}): RagflowRetrievalHit => ({
  chunkId: 'chunk-1',
  content: 'The bidder shall submit two sealed envelopes.',
  documentId: 'doc-1',
  documentName: 'bid.docx',
  similarity: 0.61,
  vectorSimilarity: 0.65,
  termSimilarity: 0.58,
  ...overrides
})

const source: RagflowHitSource = { itemId: ITEM_ID, itemType: 'file', source: 'bid.docx' }
const resolveAll = () => source

describe('toKnowledgeSearchResults', () => {
  it('produces a result the local knowledge contract accepts', () => {
    const [result] = toKnowledgeSearchResults([hit()], resolveAll)

    expect(KnowledgeSearchResultSchema.parse(result)).toEqual(result)
    expect(result).toEqual({
      pageContent: 'The bidder shall submit two sealed envelopes.',
      score: 0.61,
      scoreKind: 'relevance',
      rank: 1,
      metadata: { itemId: ITEM_ID, itemType: 'file', source: 'bid.docx', chunkIndex: 0, tokenCount: 0 },
      itemId: ITEM_ID,
      chunkId: 'chunk-1',
      title: 'bid.docx'
    })
  })

  it('drops hits whose document has no local item and re-ranks what remains', () => {
    const hits = [
      hit({ documentId: 'doc-missing', chunkId: 'orphan-1' }),
      hit({ documentId: 'doc-1', chunkId: 'kept-1' }),
      hit({ documentId: 'doc-missing', chunkId: 'orphan-2' }),
      hit({ documentId: 'doc-1', chunkId: 'kept-2' })
    ]

    const results = toKnowledgeSearchResults(hits, (documentId) => (documentId === 'doc-1' ? source : undefined))

    expect(results.map((result) => result.chunkId)).toEqual(['kept-1', 'kept-2'])
    // Rank is positional in the returned list; chunkIndex keeps the API's order.
    expect(results.map((result) => result.rank)).toEqual([1, 2])
    expect(results.map((result) => result.metadata.chunkIndex)).toEqual([1, 3])
  })

  it('reports no token count, because RagFlow does not return one', () => {
    const [result] = toKnowledgeSearchResults([hit()], resolveAll)

    expect(result.metadata.tokenCount).toBe(0)
  })
})

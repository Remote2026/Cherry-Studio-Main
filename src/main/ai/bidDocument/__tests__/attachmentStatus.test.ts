import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BidAttachmentStatus } from '@shared/ai/bidAttachmentStatus'

const { setSharedMock } = vi.hoisted(() => ({ setSharedMock: vi.fn() }))

vi.mock('@application', () => ({
  application: { get: vi.fn(() => ({ setShared: setSharedMock })) }
}))

const load = async () => {
  vi.resetModules()
  return await import('../attachmentStatus')
}

const lastPublished = (): BidAttachmentStatus => setSharedMock.mock.calls.at(-1)?.[1] as BidAttachmentStatus

const set = (
  module: Awaited<ReturnType<typeof load>>,
  overrides: Partial<Parameters<typeof module.setBidAttachmentStatus>[0]> = {}
) =>
  module.setBidAttachmentStatus({
    sessionId: 's1',
    messageId: 'm1',
    docId: 'doc-1',
    filename: 'bid.pdf',
    phase: 'uploading',
    ...overrides
  })

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('bid attachment status', () => {
  it('publishes uploading without a fake percentage and parsing progress separately', async () => {
    const module = await load()

    set(module)
    expect(lastPublished().files).toEqual([
      expect.objectContaining({ docId: 'doc-1', phase: 'uploading', percent: null })
    ])

    set(module, { phase: 'parsing', percent: 42 })
    expect(lastPublished().files).toEqual([expect.objectContaining({ phase: 'parsing', percent: 42 })])
    expect(setSharedMock).toHaveBeenCalledWith('agent.session.bid_attachment_status.s1', expect.any(Object))
  })

  it('merges files by docId instead of letting a new message overwrite the old status', async () => {
    const module = await load()

    set(module, { messageId: 'm1', docId: 'doc-1', filename: 'a.pdf', phase: 'parsing', percent: 10 })
    set(module, { messageId: 'm2', docId: 'doc-2', filename: 'b.pdf', phase: 'uploading' })

    expect(lastPublished().files).toEqual([
      expect.objectContaining({ messageId: 'm1', docId: 'doc-1' }),
      expect.objectContaining({ messageId: 'm2', docId: 'doc-2' })
    ])
  })

  it('clears a terminal file after the retention window', async () => {
    vi.useFakeTimers()
    const module = await load()

    set(module, { phase: 'ready', percent: 100 })
    expect(lastPublished().files).toHaveLength(1)

    vi.advanceTimersByTime(10_000)
    expect(lastPublished().files).toHaveLength(0)
  })
})

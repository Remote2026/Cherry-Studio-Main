import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { useBidAttachmentStatusMock } = vi.hoisted(() => ({ useBidAttachmentStatusMock: vi.fn() }))

vi.mock('@renderer/hooks/agent/useBidAttachmentStatus', () => ({
  useBidAttachmentStatus: useBidAttachmentStatusMock
}))

import i18n from '@renderer/i18n/resolver'

import { BidAttachmentStatusCapsule } from '../BidAttachmentStatusCapsule'

const file = (overrides: Record<string, unknown>) => ({
  messageId: 'm1',
  docId: 'doc-1',
  filename: 'bid.pdf',
  phase: 'uploading',
  percent: null,
  updatedAt: 1,
  ...overrides
})

describe('BidAttachmentStatusCapsule', () => {
  beforeEach(() => {
    useBidAttachmentStatusMock.mockReset()
  })

  it('renders nothing when no attachment is being prepared', () => {
    useBidAttachmentStatusMock.mockReturnValue({ files: [] })

    const { container } = render(<BidAttachmentStatusCapsule sessionId="s1" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the processing summary while an upload or parse is active', () => {
    useBidAttachmentStatusMock.mockReturnValue({
      files: [
        file({ phase: 'uploading' }),
        file({ docId: 'doc-2', filename: 'tender.docx', phase: 'parsing', percent: 42 })
      ]
    })

    render(<BidAttachmentStatusCapsule sessionId="s1" />)

    expect(screen.getByTestId('bid-attachment-status-capsule')).toBeInTheDocument()
    const capsule = within(screen.getByTestId('bid-attachment-status-capsule'))
    expect(capsule.getByText('bid.pdf', { selector: 'span[aria-live="polite"]' })).toBeInTheDocument()
    expect(capsule.getByTestId('bid-attachment-status-summary')).toHaveTextContent(
      i18n.t('agent.session.attachment.uploading')
    )
    expect(screen.getByText('tender.docx')).toBeInTheDocument()
    expect(screen.getByText(`${i18n.t('agent.session.attachment.parsing')} 42%`)).toBeInTheDocument()
  })

  it('shows the failure summary after a terminal failure', () => {
    useBidAttachmentStatusMock.mockReturnValue({
      files: [file({ phase: 'failed', error: 'RagFlow service is unavailable' })]
    })

    render(<BidAttachmentStatusCapsule sessionId="s1" />)

    expect(screen.getAllByText(i18n.t('agent.session.attachment.failed')).length).toBeGreaterThan(0)
  })
})

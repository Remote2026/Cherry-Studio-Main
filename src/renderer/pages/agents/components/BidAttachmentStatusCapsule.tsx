import { AlertCircle, CheckCircle, FileText, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CircularProgress, HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'
import ComposerFloatingCapsule from '@renderer/components/composer/ComposerFloatingCapsule'
import { useBidAttachmentStatus } from '@renderer/hooks/agent/useBidAttachmentStatus'
import { cn } from '@renderer/utils/style'
import type { BidAttachmentFileStatus, BidAttachmentPhase } from '@shared/ai/bidAttachmentStatus'

const phaseKey = (phase: BidAttachmentPhase) => `agent.session.attachment.${phase}` as const

function PhaseIcon({ phase }: { phase: BidAttachmentPhase }) {
  if (phase === 'ready') return <CheckCircle className="size-3.5 shrink-0 text-success" />
  if (phase === 'failed') return <AlertCircle className="size-3.5 shrink-0 text-destructive" />
  return <Loader2 className="size-3.5 shrink-0 animate-spin text-info" />
}

export function BidAttachmentStatusCapsule({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const { files } = useBidAttachmentStatus(sessionId)

  if (files.length === 0) return null

  const active = files.filter((file) => file.phase === 'uploading' || file.phase === 'parsing')
  const failed = files.filter((file) => file.phase === 'failed')
  const currentFile = active[0] ?? failed[0] ?? files[0]
  const currentPercent = currentFile.percent

  const statusLine = (file: BidAttachmentFileStatus): string => {
    const label = t(phaseKey(file.phase))
    return file.phase === 'parsing' && file.percent !== null
      ? `${label} ${t('agent.session.attachment.percent', { percent: file.percent })}`
      : label
  }

  return (
    <div
      className="pointer-events-none flex w-full justify-center px-4 pb-2"
      data-testid="bid-attachment-status-capsule">
      <HoverCard openDelay={120} closeDelay={100}>
        <HoverCardTrigger asChild>
          <ComposerFloatingCapsule tabIndex={0} className="gap-1.5 px-2.5">
            {active.length > 0 && currentPercent !== null ? (
              <CircularProgress
                value={currentPercent}
                size={17}
                strokeWidth={2}
                className="stroke-border"
                progressClassName="stroke-info transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
              />
            ) : active.length > 0 ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-info" />
            ) : failed.length > 0 ? (
              <AlertCircle className="size-4 shrink-0 text-destructive" />
            ) : (
              <CheckCircle className="size-4 shrink-0 text-success" />
            )}
            <span aria-live="polite" className="min-w-0 max-w-64 truncate">
              {currentFile.filename}
            </span>
            <span data-testid="bid-attachment-status-summary" className="shrink-0 text-xs text-muted-foreground">
              {statusLine(currentFile)}
            </span>
          </ComposerFloatingCapsule>
        </HoverCardTrigger>
        <HoverCardContent
          align="center"
          side="top"
          sideOffset={8}
          className="w-72 max-w-[calc(100vw-2rem)] overflow-hidden p-2.5 shadow-lg">
          <div className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
            {t('agent.session.attachment.title')}
          </div>
          <ul className="max-h-64 space-y-1 overflow-auto pr-1">
            {files.map((file) => (
              <li key={file.docId} className="flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1">
                <PhaseIcon phase={file.phase} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1 text-xs leading-5">
                    <FileText className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{file.filename}</span>
                  </div>
                  <div className={cn('text-[0.7rem] leading-4 text-muted-foreground')}>{statusLine(file)}</div>
                  {file.error && <div className="text-[0.7rem] leading-4 text-destructive">{file.error}</div>}
                </div>
              </li>
            ))}
          </ul>
        </HoverCardContent>
      </HoverCard>
    </div>
  )
}

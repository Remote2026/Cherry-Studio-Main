import { Cloud, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { ragflowErrorCodes } from '@shared/ipc/errors/ragflow'
import type { RagflowDataset } from '@shared/ipc/schemas/ragflow'

interface ImportRagflowDatasetsDialogProps {
  open: boolean
  /** 已经镜像过的数据集 id；它们不再作为候选出现。 */
  importedRemoteIds: ReadonlySet<string>
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

const isConfigInvalid = (error: unknown) => error instanceof IpcError && error.code === ragflowErrorCodes.CONFIG_INVALID

const ImportRagflowDatasetsDialog = ({
  open,
  importedRemoteIds,
  onOpenChange,
  onImported
}: ImportRagflowDatasetsDialogProps) => {
  const { t } = useTranslation()
  const [datasets, setDatasets] = useState<RagflowDataset[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [isImporting, setIsImporting] = useState(false)

  // 每次打开都重新拉一次：远端随时会有新数据集，缓存的列表没有意义。
  useEffect(() => {
    if (!open) return

    setSelectedIds(new Set())
    setLoadError(null)
    setIsLoading(true)

    ipcApi
      .request('ragflow.list_datasets', {})
      .then(({ items }) => setDatasets(items))
      .catch((error: unknown) => setLoadError(error))
      .finally(() => setIsLoading(false))
  }, [open])

  const candidates = useMemo(
    () => datasets.filter((dataset) => !importedRemoteIds.has(dataset.id)),
    [datasets, importedRemoteIds]
  )

  const allSelected = candidates.length > 0 && candidates.every((dataset) => selectedIds.has(dataset.id))
  const someSelected = candidates.some((dataset) => selectedIds.has(dataset.id))

  const toggleOne = (datasetId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(datasetId)) next.delete(datasetId)
      else next.add(datasetId)
      return next
    })
  }

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(candidates.map((dataset) => dataset.id)))
  }

  const handleImport = async () => {
    setIsImporting(true)
    try {
      await ipcApi.request('ragflow.import_datasets', { datasetIds: [...selectedIds] })
    } catch (error) {
      toast.error(formatErrorMessageWithPrefix(error, t('knowledge.ragflow.import_failed')))
      return
    } finally {
      setIsImporting(false)
    }

    onImported()
  }

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="flex min-h-24 items-center justify-center text-foreground-tertiary text-sm">
          {t('common.loading')}
        </div>
      )
    }

    if (loadError) {
      return (
        <div className="flex min-h-24 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-error text-sm">
            {formatErrorMessageWithPrefix(loadError, t('knowledge.ragflow.load_failed'))}
          </p>
          {isConfigInvalid(loadError) ? (
            <Button variant="outline" onClick={() => openSettingsTab('/settings/ragflow')}>
              <Settings2 className="size-3.5" />
              {t('knowledge.ragflow.open_settings')}
            </Button>
          ) : null}
        </div>
      )
    }

    if (candidates.length === 0) {
      return (
        <div className="flex min-h-24 items-center justify-center px-4 text-center text-foreground-tertiary text-sm">
          {t(datasets.length === 0 ? 'knowledge.ragflow.no_datasets' : 'knowledge.ragflow.all_imported')}
        </div>
      )
    }

    return (
      <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        <li className="flex items-center gap-2 px-2.5 py-1.5">
          <Checkbox
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={toggleAll}
            aria-label={t('knowledge.ragflow.select_all')}
          />
          <span className="text-foreground-tertiary text-xs">{t('knowledge.ragflow.select_all')}</span>
        </li>
        {candidates.map((dataset) => (
          <li key={dataset.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent/40">
              <Checkbox
                checked={selectedIds.has(dataset.id)}
                onCheckedChange={() => toggleOne(dataset.id)}
                aria-label={dataset.name}
              />
              <Cloud className="size-4 shrink-0 text-sky-500" />
              <span className="truncate">{dataset.name}</span>
              <span className="ml-auto shrink-0 text-foreground-tertiary text-xs tabular-nums">
                {t('knowledge.ragflow.document_count', { count: dataset.documentCount })}
              </span>
            </label>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isImporting && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('knowledge.ragflow.import_title')}</DialogTitle>
          <DialogDescription>{t('knowledge.ragflow.import_description')}</DialogDescription>
        </DialogHeader>
        {renderBody()}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isImporting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="emphasis"
            onClick={() => void handleImport()}
            loading={isImporting}
            disabled={selectedIds.size === 0}>
            {t('knowledge.ragflow.import_action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ImportRagflowDatasetsDialog

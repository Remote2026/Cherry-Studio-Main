import { createFileRoute } from '@tanstack/react-router'

import { RagflowSettings } from '@renderer/pages/settings/RagflowSettings'

export const Route = createFileRoute('/settings/ragflow')({
  component: RagflowSettings
})

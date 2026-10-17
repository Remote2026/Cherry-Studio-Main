import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import type { BuiltinAgentRole } from '@shared/ai/builtinAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { UniqueModelId } from '@shared/data/types/model'

import { loadBuiltinAgentDefaults } from './builtin/builtinAgentDefinition'

export function loadBuiltinAgentEnsureInput(
  builtinRole: BuiltinAgentRole
): Parameters<typeof agentService.ensureBuiltinAgent>[0] {
  const defaults = loadBuiltinAgentDefaults(builtinRole)
  const defaultModelId = (application.get('PreferenceService').get('chat.default_model_id') ??
    null) as UniqueModelId | null
  return {
    ...defaults,
    builtinRole,
    preferredModelId: defaultModelId,
    // 内网版裁掉了 Claude Code，内置智能体改用保留下来的 Pi 运行时。
    type: 'pi'
  }
}

export function ensureBuiltinAgent(builtinRole: BuiltinAgentRole): AgentEntity {
  return agentService.ensureBuiltinAgent(loadBuiltinAgentEnsureInput(builtinRole))
}

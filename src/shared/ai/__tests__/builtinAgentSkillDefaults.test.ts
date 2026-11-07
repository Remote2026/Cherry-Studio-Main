import { describe, expect, it } from 'vitest'

import { BUSINESS_BID_AGENT_ID, isBuiltinSkillEnabledForAgentByDefault } from '../builtinAgentSkillDefaults'

describe('isBuiltinSkillEnabledForAgentByDefault', () => {
  it('disables office and shell-routing skills for the business bid agent', () => {
    for (const folderName of ['docx', 'office-transform', 'pdf', 'pptx', 'xlsx', 'cherry-tool-guide']) {
      expect(isBuiltinSkillEnabledForAgentByDefault(BUSINESS_BID_AGENT_ID, folderName)).toBe(false)
    }
  })

  it('keeps unrelated skills and other agents enabled', () => {
    expect(isBuiltinSkillEnabledForAgentByDefault(BUSINESS_BID_AGENT_ID, 'canvas-design')).toBe(true)
    expect(isBuiltinSkillEnabledForAgentByDefault('another-agent', 'docx')).toBe(true)
  })
})

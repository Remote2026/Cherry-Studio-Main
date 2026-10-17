import { describe, expect, it } from 'vitest'

import { isBuiltinSkillEnabledByDefault } from '../builtinSkillDefaults'

describe('isBuiltinSkillEnabledByDefault', () => {
  it('keeps find-skills off until the user enables it', () => {
    expect(isBuiltinSkillEnabledByDefault('find-skills')).toBe(false)
  })

  it('keeps every code-mate CLI skill off by default', () => {
    expect(isBuiltinSkillEnabledByDefault('code-mate-claude-code')).toBe(false)
    expect(isBuiltinSkillEnabledByDefault('code-mate-pi')).toBe(false)
    expect(isBuiltinSkillEnabledByDefault('code-mate-minimax-code')).toBe(false)
  })

  it('leaves the other bundled skills enabled by default', () => {
    for (const folderName of ['cherry-browser', 'cherry-tool-guide', 'docx', 'office-transform', 'xlsx']) {
      expect(isBuiltinSkillEnabledByDefault(folderName), folderName).toBe(true)
    }
  })

  it('does not match lookalike folder names', () => {
    expect(isBuiltinSkillEnabledByDefault('my-find-skills')).toBe(true)
    expect(isBuiltinSkillEnabledByDefault('code-mate')).toBe(true)
    expect(isBuiltinSkillEnabledByDefault('local-code-mate-pi')).toBe(true)
  })
})

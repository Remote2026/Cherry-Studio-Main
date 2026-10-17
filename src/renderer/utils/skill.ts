import type { TFunction } from 'i18next'

/** 内置技能的说明由 UI 本地化；SKILL.md 本身保持英文原样。 */
const BUILTIN_SKILL_DESCRIPTION_KEYS: Record<string, string> = {
  'canvas-design': 'settings.skills.builtinDescriptions.canvas-design',
  'cherry-browser': 'settings.skills.builtinDescriptions.cherry-browser',
  'cherry-tool-guide': 'settings.skills.builtinDescriptions.cherry-tool-guide',
  docx: 'settings.skills.builtinDescriptions.docx',
  'find-skills': 'settings.skills.builtinDescriptions.find-skills',
  'frontend-design': 'settings.skills.builtinDescriptions.frontend-design',
  'internal-comms': 'settings.skills.builtinDescriptions.internal-comms',
  'office-transform': 'settings.skills.builtinDescriptions.office-transform',
  pdf: 'settings.skills.builtinDescriptions.pdf',
  pptx: 'settings.skills.builtinDescriptions.pptx',
  xlsx: 'settings.skills.builtinDescriptions.xlsx'
}

type SkillDescriptionSource = {
  folderName?: string
  filename?: string
  source?: string
  description?: string | null
}

export function getSkillDescriptionForDisplay(skill: SkillDescriptionSource, t: TFunction): string {
  const folderName = skill.folderName ?? skill.filename
  const key = folderName ? BUILTIN_SKILL_DESCRIPTION_KEYS[folderName] : undefined
  const isBuiltin = skill.source === 'builtin' || (skill.source === undefined && key !== undefined)

  if (key && isBuiltin) {
    return t(key, { defaultValue: skill.description ?? '' })
  }
  return skill.description ?? ''
}

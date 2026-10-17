/**
 * Bundled skills whose first install lands disabled. Everything else keeps the
 * builtin default of enabled for every agent; users opt these in from Skills settings.
 */
const DEFAULT_DISABLED_SKILLS = new Set(['find-skills'])
const DEFAULT_DISABLED_PREFIXES = ['code-mate-']

export function isBuiltinSkillEnabledByDefault(folderName: string): boolean {
  return (
    !DEFAULT_DISABLED_SKILLS.has(folderName) &&
    !DEFAULT_DISABLED_PREFIXES.some((prefix) => folderName.startsWith(prefix))
  )
}

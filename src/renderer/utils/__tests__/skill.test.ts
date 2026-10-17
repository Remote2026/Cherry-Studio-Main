import fs from 'node:fs'
import path from 'node:path'

import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import enUs from '@renderer/i18n/locales/en-us.json'
import zhCn from '@renderer/i18n/locales/zh-cn.json'
import zhTw from '@renderer/i18n/locales/zh-tw.json'

import { getSkillDescriptionForDisplay } from '../skill'

const BUILTIN_SKILLS = [
  'canvas-design',
  'cherry-browser',
  'cherry-tool-guide',
  'docx',
  'find-skills',
  'frontend-design',
  'internal-comms',
  'office-transform',
  'pdf',
  'pptx',
  'xlsx'
]

const CATALOGS: Record<string, Record<string, string>> = {
  'en-us': enUs,
  'zh-cn': zhCn,
  'zh-tw': zhTw
}

function catalogT(catalog: Record<string, string>): TFunction {
  return ((key: string, options?: { defaultValue?: string }) =>
    catalog[key] ?? options?.defaultValue ?? key) as TFunction
}

describe('getSkillDescriptionForDisplay', () => {
  it('shows a Chinese description for built-in skills instead of the English SKILL.md text', () => {
    const description = getSkillDescriptionForDisplay(
      {
        folderName: 'office-transform',
        source: 'builtin',
        description: 'Derive new Office files from structural selections without touching the original.'
      },
      catalogT(CATALOGS['zh-cn'])
    )

    expect(description).not.toContain('Derive new Office files')
    expect(description).toMatch(/[一-鿿]/)
  })

  it('keeps the stored description for non-built-in skills', () => {
    expect(
      getSkillDescriptionForDisplay(
        { folderName: 'my-own-skill', source: 'github', description: 'User skill description' },
        catalogT(CATALOGS['zh-cn'])
      )
    ).toBe('User skill description')
  })

  it('falls back to the stored description when a built-in skill has no catalog entry', () => {
    expect(
      getSkillDescriptionForDisplay(
        { folderName: 'cherry-browser', source: 'builtin', description: 'English fallback' },
        catalogT({})
      )
    ).toBe('English fallback')
  })

  it('localizes local skills discovered by folder name', () => {
    const description = getSkillDescriptionForDisplay(
      { filename: 'cherry-browser', description: 'English description' },
      catalogT(CATALOGS['zh-cn'])
    )

    expect(description).toMatch(/[一-鿿]/)
  })

  it('has a non-empty description in every locale for every bundled skill', () => {
    const skillsDir = path.resolve(process.cwd(), 'resources/skills')
    const folders = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    expect(folders).toEqual([...BUILTIN_SKILLS].sort())

    for (const folder of folders) {
      const key = `settings.skills.builtinDescriptions.${folder}`
      for (const [locale, catalog] of Object.entries(CATALOGS)) {
        expect(catalog[key], `${locale} is missing ${key}`).toBeTruthy()
      }
    }
  })
})

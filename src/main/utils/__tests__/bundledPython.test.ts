import fs from 'fs'
import path from 'path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyBundledPythonExecution, getBundledPythonRuntime } from '../bundledPython'

// Force the Windows code path regardless of host so both branches run everywhere.
vi.mock('@main/core/platform', () => ({ isWin: true }))
vi.mock('fs')
// Resolve application.getPath() + toAsarUnpackedPath in the test so the assertions
// cover the real env merge, not a mocked PATH.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('../asar', () => ({ toAsarUnpackedPath: (p: string) => p }))

describe('bundledPython', () => {
  const platformKey = `${process.platform}-${process.arch}`
  const root = path.join('/mock/app.root.resources.binaries', platformKey)
  const pythonDir = path.join(root, 'python')
  const pythonPath = path.join(pythonDir, 'python.exe')
  const scriptsDir = path.join(pythonDir, 'Scripts')
  const wheelsDir = path.join(root, 'python-wheels')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the bundled interpreter and wheelhouse when both exist', () => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) => candidate === pythonPath || candidate === wheelsDir)

    expect(getBundledPythonRuntime()).toEqual({ pythonPath, pythonDir, scriptsDir, wheelsDir })
  })

  it('returns null when the bundled interpreter is missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(getBundledPythonRuntime()).toBeNull()
  })

  it('returns null when the offline wheelhouse is missing', () => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) => candidate === pythonPath)

    expect(getBundledPythonRuntime()).toBeNull()
  })

  it('prepends the interpreter to PATH and pins uv to the offline wheelhouse', () => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) => candidate === pythonPath || candidate === wheelsDir)

    const merged = applyBundledPythonExecution({ PATH: '/system/bin', KEEP: '1' })

    expect(merged.PATH.split(';')).toEqual([pythonDir, scriptsDir, '/system/bin'])
    expect(merged).toMatchObject({
      KEEP: '1',
      UV_PYTHON: pythonPath,
      UV_PYTHON_DOWNLOADS: 'never',
      UV_OFFLINE: '1',
      UV_FIND_LINKS: wheelsDir,
      UV_NO_PROJECT: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUTF8: '1',
      PYTHONNOUSERSITE: '1'
    })
  })

  it('leaves the environment untouched when no bundled runtime is installed', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const env = { PATH: '/system/bin', KEEP: '1' }

    const merged = applyBundledPythonExecution(env)

    expect(merged).toEqual(env)
    expect(merged).not.toHaveProperty('UV_PYTHON')
  })
})

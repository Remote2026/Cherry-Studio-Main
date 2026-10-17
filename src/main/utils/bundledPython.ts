import fs from 'fs'
import path from 'path'

import { application } from '@application'
import { isWin } from '@main/core/platform'

import { toAsarUnpackedPath } from './asar'
import { mergePathPrefixes } from './binaryEnv'

export interface BundledPythonRuntime {
  pythonPath: string
  pythonDir: string
  scriptsDir: string
  wheelsDir: string
}

/**
 * Resolve the offline Python runtime shipped under resources/binaries/<platform>/python
 * plus the wheelhouse used by `uv --with`. Windows-only; returns null when the bundle
 * (or its wheelhouse) is absent, so callers keep the previous online-uv behavior.
 */
export function getBundledPythonRuntime(): BundledPythonRuntime | null {
  if (!isWin) {
    return null
  }
  const platformKey = `${process.platform}-${process.arch}`
  const root = toAsarUnpackedPath(path.join(application.getPath('app.root.resources.binaries'), platformKey))
  const pythonDir = path.join(root, 'python')
  const pythonPath = path.join(pythonDir, 'python.exe')
  const wheelsDir = path.join(root, 'python-wheels')

  if (!fs.existsSync(pythonPath) || !fs.existsSync(wheelsDir)) {
    return null
  }
  return { pythonPath, pythonDir, scriptsDir: path.join(pythonDir, 'Scripts'), wheelsDir }
}

/**
 * Put the bundled interpreter first on PATH and pin uv to the offline wheelhouse.
 * Returns the input unchanged when the bundle is absent.
 */
export function applyBundledPythonExecution(env: Record<string, string>): Record<string, string> {
  const runtime = getBundledPythonRuntime()
  if (!runtime) {
    return env
  }
  return {
    ...mergePathPrefixes(env, [runtime.pythonDir, runtime.scriptsDir]),
    UV_PYTHON: runtime.pythonPath,
    UV_PYTHON_DOWNLOADS: 'never',
    UV_OFFLINE: '1',
    UV_FIND_LINKS: runtime.wheelsDir,
    UV_NO_PROJECT: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUTF8: '1',
    PYTHONNOUSERSITE: '1'
  }
}

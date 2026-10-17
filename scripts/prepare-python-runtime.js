/**
 * Prepares the offline Python runtime shipped under resources/binaries/<platform>/:
 *   python/         relocatable CPython + preinstalled site-packages
 *   python-wheels/  wheelhouse resolved by `uv run --with` in offline mode
 *
 * The runtime is intentionally Windows-x64 only. Other platforms print a note and
 * exit successfully, leaving the existing online-uv behavior in place.
 *
 * Usage:
 *   node scripts/prepare-python-runtime.js          # build (downloads from uv/PyPI)
 *   node scripts/prepare-python-runtime.js --check  # verify an existing build
 *
 * before-pack.js runs --check and fails the build when the runtime is missing, so a
 * packaging machine either ships a complete offline runtime or refuses to package.
 */
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '..')
const PLATFORM_KEY = 'win32-x64'
const PYTHON_SERIES = '3.12'
const BINARIES_ROOT = path.join(REPO_ROOT, 'resources', 'binaries', PLATFORM_KEY)
const PYTHON_DIR = path.join(BINARIES_ROOT, 'python')
const PYTHON_EXE = path.join(PYTHON_DIR, 'python.exe')
const WHEELS_DIR = path.join(BINARIES_ROOT, 'python-wheels')
const MARKER_PATH = path.join(PYTHON_DIR, '.python-version')
const PACKAGE_LIST_PATH = path.join(PYTHON_DIR, 'python-packages.txt')

// Packages cover the bundled document skills, office-transform, and skill-creator.
// Import names are separate because a distribution name is not the module name.
const PACKAGES = [
  'defusedxml',
  'lxml',
  'Pillow',
  'openpyxl',
  'pypdf',
  'pdfplumber',
  'pdf2image',
  'python-docx',
  'python-pptx',
  'PyYAML',
  'reportlab'
]
const IMPORT_NAMES = [
  'defusedxml',
  'lxml',
  'PIL',
  'openpyxl',
  'pypdf',
  'pdfplumber',
  'pdf2image',
  'docx',
  'pptx',
  'yaml',
  'reportlab'
]

const PACKAGE_SET_HASH = crypto.createHash('sha256').update(PACKAGES.join('\n')).digest('hex').slice(0, 8)

function log(message) {
  console.log(`[python-runtime] ${message}`)
}

function fail(message) {
  console.error(`[python-runtime] ${message}`)
  process.exit(1)
}

function isSupportedTarget() {
  return process.platform === 'win32' && process.arch === 'x64'
}

function uvExe() {
  return path.join(BINARIES_ROOT, 'uv.exe')
}

function run(exe, args, options = {}) {
  execFileSync(exe, args, { cwd: REPO_ROOT, stdio: 'inherit', ...options })
}

function readMarker() {
  try {
    return fs.readFileSync(MARKER_PATH, 'utf8').trim()
  } catch {
    return ''
  }
}

function pythonVersion() {
  return execFileSync(
    PYTHON_EXE,
    ['-c', 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")'],
    {
      encoding: 'utf8'
    }
  ).trim()
}

function expectedMarker() {
  return `py${pythonVersion()}+pkgs-${PACKAGE_SET_HASH}`
}

function bundleIsCurrent() {
  if (!fs.existsSync(PYTHON_EXE)) return false
  if (!fs.existsSync(WHEELS_DIR) || !fs.readdirSync(WHEELS_DIR).some((name) => name.endsWith('.whl'))) return false
  try {
    return readMarker() === expectedMarker()
  } catch {
    return false
  }
}

function assertBundle() {
  if (!fs.existsSync(PYTHON_EXE)) fail(`missing ${PYTHON_EXE}`)
  if (!fs.existsSync(WHEELS_DIR) || !fs.readdirSync(WHEELS_DIR).some((name) => name.endsWith('.whl'))) {
    fail(`missing wheels in ${WHEELS_DIR}`)
  }
  const marker = readMarker()
  if (!marker) fail(`missing ${MARKER_PATH}`)
  if (marker !== expectedMarker()) {
    fail(`runtime marker ${marker} does not match ${expectedMarker()}; rerun the prepare script`)
  }
  try {
    execFileSync(PYTHON_EXE, ['-c', `import ${IMPORT_NAMES.join(', ')}`], { stdio: 'pipe' })
  } catch (error) {
    const detail = error.stderr ? error.stderr.toString() : String(error)
    fail(`bundled interpreter cannot import the required packages:\n${detail}`)
  }
  log(`OK ${marker}`)
}

// The skills only need the interpreter, the standard library and site-packages.
// Headers, import libs, the Tcl/Tk runtime and idle/turtle/ensurepip are dead weight
// in an installed bundle.
const PRUNE_PATHS = ['include', 'libs', 'tcl', 'Lib/idlelib', 'Lib/turtledemo', 'Lib/ensurepip', 'pythonw.exe']

function pruneRuntime() {
  for (const relative of PRUNE_PATHS) {
    fs.rmSync(path.join(PYTHON_DIR, relative), { recursive: true, force: true, maxRetries: 3 })
  }
}

function build() {
  if (!isSupportedTarget()) {
    log(`offline Python runtime is win32-x64 only (host: ${process.platform}-${process.arch}); skipping`)
    return
  }
  if (bundleIsCurrent()) {
    log(`already prepared ${readMarker()}`)
    return
  }
  if (!fs.existsSync(uvExe())) fail(`missing bundled uv: ${uvExe()}`)

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-python-'))
  const installDir = path.join(staging, 'python-install')
  const wheelStaging = path.join(staging, 'wheels')
  try {
    log(`installing CPython ${PYTHON_SERIES} from the bundled uv`)
    run(uvExe(), [
      'python',
      'install',
      PYTHON_SERIES,
      '--install-dir',
      installDir,
      '--no-bin',
      '--managed-python',
      '--no-config'
    ])

    // uv also creates a `cpython-<series>-...` symlink beside the real versioned
    // directory; isDirectory() is false for symlinks, so this keeps the real tree.
    const installed = fs
      .readdirSync(installDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('cpython-'))
      .map((entry) => entry.name)
    if (installed.length !== 1) fail(`expected one cpython directory in ${installDir}, found ${installed.length}`)

    log(`publishing interpreter to ${PYTHON_DIR}`)
    fs.rmSync(PYTHON_DIR, { recursive: true, force: true, maxRetries: 3 })
    fs.cpSync(path.join(installDir, installed[0]), PYTHON_DIR, { recursive: true })
    pruneRuntime()

    log(`installing packages: ${PACKAGES.join(', ')}`)
    run(uvExe(), [
      'pip',
      'install',
      '--python',
      PYTHON_EXE,
      '--target',
      path.join(PYTHON_DIR, 'Lib', 'site-packages'),
      '--no-compile',
      '--no-cache',
      ...PACKAGES
    ])

    log('downloading wheels for offline `uv --with`')
    fs.mkdirSync(wheelStaging, { recursive: true })
    run(PYTHON_EXE, [
      '-m',
      'pip',
      'download',
      '--only-binary=:all:',
      '--disable-pip-version-check',
      '--dest',
      wheelStaging,
      ...PACKAGES
    ])

    fs.rmSync(WHEELS_DIR, { recursive: true, force: true, maxRetries: 3 })
    // cpSync, not rename: the staging dir lives on the OS temp drive, which may
    // differ from the checkout drive (EXDEV).
    fs.cpSync(wheelStaging, WHEELS_DIR, { recursive: true })
    fs.writeFileSync(PACKAGE_LIST_PATH, `${PACKAGES.join('\n')}\n`)
    fs.writeFileSync(MARKER_PATH, `${expectedMarker()}\n`)
    log(`prepared ${expectedMarker()}`)
  } finally {
    fs.rmSync(staging, { recursive: true, force: true, maxRetries: 3 })
  }
}

if (process.argv.includes('--check')) {
  if (!isSupportedTarget()) {
    log(`offline Python runtime is win32-x64 only (host: ${process.platform}-${process.arch}); skipping check`)
    process.exit(0)
  }
  assertBundle()
} else {
  build()
}

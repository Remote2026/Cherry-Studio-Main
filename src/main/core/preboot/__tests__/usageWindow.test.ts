import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const exitMock = vi.fn()

function stubApplication() {
  vi.doMock('@application', () => ({
    application: { forceExit: exitMock }
  }))
}

async function loadModule() {
  return import('../usageWindow')
}

beforeEach(() => {
  vi.resetModules()
  exitMock.mockReset()
  stubApplication()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('enforceUsageWindow', () => {
  it('allows startup on the last allowed day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2027, 11, 31, 23, 59, 59))
    const { enforceUsageWindow } = await loadModule()

    enforceUsageWindow()

    expect(exitMock).not.toHaveBeenCalled()
  })

  it('exits silently from 2028-01-01', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2028, 0, 1, 0, 0, 0))
    const { enforceUsageWindow } = await loadModule()

    enforceUsageWindow()

    expect(exitMock).toHaveBeenCalledWith(0)
  })
})

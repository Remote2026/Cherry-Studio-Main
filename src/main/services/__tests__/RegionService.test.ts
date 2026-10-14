import { describe, expect, it } from 'vitest'

import { regionService } from '../RegionService'

describe('RegionService', () => {
  it('returns CN without requiring a network request', async () => {
    await expect(regionService.getCountry()).resolves.toBe('CN')
    await expect(regionService.detectIsInChina()).resolves.toBe(true)
    await expect(regionService.isInChina()).resolves.toBe(true)
  })

  it('honors an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(regionService.getCountry(controller.signal)).rejects.toThrow()
    await expect(regionService.detectIsInChina(controller.signal)).rejects.toThrow()
    await expect(regionService.isInChina(controller.signal)).rejects.toThrow()
  })
})

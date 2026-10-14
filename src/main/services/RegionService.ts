const FIXED_COUNTRY = 'CN'

/**
 * The internal deployment has no internet egress and performs no public IP
 * geolocation. CN is the fixed answer so mirror selection stays deterministic.
 */
class RegionService {
  async getCountry(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    return FIXED_COUNTRY
  }

  async detectIsInChina(signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    return true
  }

  async isInChina(signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    return true
  }
}

export const regionService = new RegionService()

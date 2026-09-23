import { z } from 'zod'
import { Prisma } from '@prisma/client'
import type { Device } from '@prisma/client'
import { prisma } from './prisma'
import { getFlags } from './flags'
import { log } from './logger'

// Apple's Ad Services attribution response is an arbitrary JSON object; validate it as JSON and store
// it verbatim. The annotation makes the parsed value assignable to Prisma's Json input.
const jsonValue: z.ZodType<Prisma.InputJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ])
)

/**
 * Resolve an Apple Search Ads attribution token and store the result on the device.
 * - 200: store the JSON payload.
 * - 404: a token from a non-ad install; store `{ attribution: false }`.
 * - anything else: log, don't throw. Never fails the caller.
 */
export async function resolveAttribution(device: Device, token: string): Promise<{ ok: true }> {
  const flags = await getFlags()
  if (!flags.attributionOn) return { ok: true }
  try {
    const res = await fetch('https://api-adservices.apple.com/api/v1/', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: token,
    })
    if (res.status === 200) {
      const payload = jsonValue.parse(await res.json())
      await prisma.device.update({ where: { id: device.id }, data: { attribution: payload } })
    } else if (res.status === 404) {
      await prisma.device.update({
        where: { id: device.id },
        data: { attribution: { attribution: false } },
      })
    } else {
      log.warn(`attribution ${res.status} for device ${device.code}`)
    }
  } catch (e) {
    log.warn(`attribution failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { ok: true }
}

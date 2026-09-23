import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { env } from './env'
import { getFlags } from './flags'
import { sendEmail } from './email'
import { log } from './logger'
import { BRAND } from '../../../packages/shared/src/brand'

const DEDUPE_MS = 6 * 60 * 60 * 1000

/**
 * Record something the operator should hear about and email it when ALERT_EMAIL is set. Deduped by
 * kind+message over a 6h window so a stuck condition does not spam the inbox.
 */
export async function raiseAlert(
  kind: string,
  message: string,
  detail?: Prisma.InputJsonValue
): Promise<void> {
  const since = new Date(Date.now() - DEDUPE_MS)
  const recent = await prisma.alert.findFirst({
    where: { kind, message, createdAt: { gte: since } },
    select: { id: true },
  })
  if (recent) return

  const alert = await prisma.alert.create({
    data: { kind, message, detail: detail ?? undefined },
  })
  log.warn(`[alert] ${kind}: ${message}`)

  if (env.ALERT_EMAIL) {
    const sent = await sendEmail({
      to: env.ALERT_EMAIL,
      subject: `[${BRAND.name}] ${kind}`,
      text: `${message}\n\n${detail ? JSON.stringify(detail, null, 2) : ''}`.trimEnd(),
    })
    if (sent) await prisma.alert.update({ where: { id: alert.id }, data: { sentAt: new Date() } })
  }
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Cost thresholds are stored in cents; CallLog.costMicros is USD*1e6, so cents*10_000 = micros. */
export async function runAlertChecks(): Promise<void> {
  const flags = await getFlags()
  const today = startOfToday()

  const spend = await prisma.callLog.aggregate({
    _sum: { costMicros: true },
    where: { createdAt: { gte: today } },
  })
  const spentMicros = spend._sum.costMicros ?? 0
  const spendCapMicros = flags.dailySpendAlertCents * 10_000
  if (spendCapMicros > 0 && spentMicros > spendCapMicros) {
    await raiseAlert(
      'daily_spend',
      `Today's model spend is $${(spentMicros / 1e6).toFixed(2)}, over the $${(spendCapMicros / 1e6).toFixed(2)} alert line`,
      { spentMicros, spendCapMicros }
    )
  }

  const deviceCapMicros = flags.dailyDeviceCostCapCents * 10_000
  if (deviceCapMicros > 0) {
    const perDevice = await prisma.callLog.groupBy({
      by: ['deviceId'],
      _sum: { costMicros: true },
      where: { createdAt: { gte: today } },
      having: { costMicros: { _sum: { gt: deviceCapMicros } } },
    })
    for (const row of perDevice) {
      const device = await prisma.device.findUnique({
        where: { id: row.deviceId },
        select: { code: true },
      })
      const micros = row._sum.costMicros ?? 0
      await raiseAlert(
        'device_cap',
        `Device ${device?.code ?? row.deviceId} spent $${(micros / 1e6).toFixed(2)} today, over the per-device cap`,
        { deviceId: row.deviceId, code: device?.code ?? null, micros, deviceCapMicros }
      )
    }
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const [total, errors] = await Promise.all([
    prisma.callLog.count({ where: { createdAt: { gte: hourAgo } } }),
    prisma.callLog.count({ where: { createdAt: { gte: hourAgo }, error: { not: null } } }),
  ])
  if (total >= 20 && errors / total > 0.2) {
    await raiseAlert(
      'relay_errors',
      `${errors} of ${total} model calls in the last hour errored (${Math.round((errors / total) * 100)}%)`,
      { total, errors }
    )
  }
}

// All admin-portal reads and the direct-Prisma writes (block, reset, unpublish, mark-read, audit).
// Money is integer US cents on the wire; durations are seconds; dates are ISO strings.
// Per-day series are always zero-filled to one row per UTC day in the range.
// Cross-module writes (ledger credit/debit, gift void, flag set, mask invalidate) live in the
// router; this file only touches Prisma so it can be reasoned about on its own.
//
// Raw day-series queries bucket by UTC day: `date_trunc('day', <col> AT TIME ZONE 'UTC')`. Only the
// range start is interpolated (a bound parameter); the SQL text is otherwise constant.

import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

// --- ears vendor rates (cents per minute), from plans/2026-09-22-ipad-app-production.md ---
const EARS_CENTS_PER_MIN: Record<string, number> = { deepgram: 0.77, openai: 1.7, browser: 0 }

function earsCents(vendor: string, listenedMs: number): number {
  return (listenedMs / 60000) * (EARS_CENTS_PER_MIN[vendor] ?? 0)
}

function centsFromMicros(micros: number): number {
  return micros / 10000
}

// ---------------------------------------------------------------- time helpers

function midnightUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** [oldest ... today] as YYYY-MM-DD, UTC, inclusive. */
function dayKeys(days: number): string[] {
  const end = midnightUtc(new Date())
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) keys.push(new Date(end - i * 86400000).toISOString().slice(0, 10))
  return keys
}

function rangeStart(days: number): Date {
  return new Date(midnightUtc(new Date()) - (days - 1) * 86400000)
}

function byDay<T extends { day: string }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>()
  for (const r of rows) m.set(r.day, r)
  return m
}

/** Widen Prisma's deeply-recursive JsonValue to `unknown` for the wire (avoids TS depth limits). */
function jsonValue(v: Prisma.JsonValue): unknown {
  return v
}

// ================================================================ overview

export async function overview(days: number) {
  const start = rangeStart(days)
  const keys = dayKeys(days)

  const [
    installs,
    finishedStories,
    firstStoriesRow,
    byPack,
    byChannel,
    revenueAgg,
    servedAgg,
    llmAgg,
    earsByVendor,
    freeAgg,
    sharesCreated,
    shareInstallsAgg,
    refunds,
  ] = await Promise.all([
    prisma.device.count({ where: { createdAt: { gte: start } } }),
    prisma.storySession.count({ where: { startedAt: { gte: start }, endReason: 'the-end' } }),
    prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT device_id, min(started_at) AS first FROM story_session GROUP BY device_id
      ) t WHERE first >= ${start}`,
    prisma.purchase.groupBy({
      by: ['packId'],
      where: { createdAt: { gte: start }, refundedAt: null },
      _count: { _all: true },
    }),
    prisma.purchase.groupBy({
      by: ['channel'],
      where: { createdAt: { gte: start }, refundedAt: null },
      _count: { _all: true },
      _sum: { grossCents: true, netCents: true },
    }),
    prisma.purchase.aggregate({
      where: { createdAt: { gte: start }, refundedAt: null },
      _sum: { grossCents: true, netCents: true },
    }),
    prisma.storySession.aggregate({ where: { startedAt: { gte: start } }, _sum: { chargedSec: true } }),
    prisma.callLog.aggregate({ where: { createdAt: { gte: start } }, _sum: { costMicros: true } }),
    prisma.storySession.groupBy({
      by: ['earsVendor'],
      where: { startedAt: { gte: start } },
      _sum: { listenedMs: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { createdAt: { gte: start }, kind: { in: ['grant_first', 'grant_weekly'] } },
      _sum: { seconds: true },
    }),
    prisma.share.count({ where: { createdAt: { gte: start } } }),
    prisma.share.aggregate({ where: { createdAt: { gte: start } }, _sum: { installs: true } }),
    prisma.purchase.count({ where: { refundedAt: { gte: start } } }),
  ])

  const [installsD, revenueD, llmD, earsD, servedD] = await Promise.all([
    prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM device WHERE created_at >= ${start} GROUP BY 1`,
    prisma.$queryRaw<{ day: string; gross: number }[]>`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             coalesce(sum(gross_cents), 0)::float8 AS gross
      FROM purchase WHERE created_at >= ${start} AND refunded_at IS NULL GROUP BY 1`,
    prisma.$queryRaw<{ day: string; micros: number }[]>`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             coalesce(sum(cost_micros), 0)::float8 AS micros
      FROM call_log WHERE created_at >= ${start} GROUP BY 1`,
    prisma.$queryRaw<{ day: string; vendor: string; ms: number }[]>`
      SELECT to_char(date_trunc('day', started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             ears_vendor AS vendor, coalesce(sum(listened_ms), 0)::float8 AS ms
      FROM story_session WHERE started_at >= ${start} GROUP BY 1, 2`,
    prisma.$queryRaw<{ day: string; sec: number }[]>`
      SELECT to_char(date_trunc('day', started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             coalesce(sum(charged_sec), 0)::float8 AS sec
      FROM story_session WHERE started_at >= ${start} GROUP BY 1`,
  ])

  const installMap = byDay(installsD)
  const revMap = byDay(revenueD)
  const llmMap = byDay(llmD)
  const servedMap = byDay(servedD)
  const earsDayMap = new Map<string, number>()
  for (const r of earsD) earsDayMap.set(r.day, (earsDayMap.get(r.day) ?? 0) + earsCents(r.vendor, r.ms))

  const series = keys.map((day) => {
    const cogs = centsFromMicros(llmMap.get(day)?.micros ?? 0) + (earsDayMap.get(day) ?? 0)
    return {
      day,
      revenueCents: Math.round(revMap.get(day)?.gross ?? 0),
      cogsCents: Math.round(cogs),
      installs: installMap.get(day)?.n ?? 0,
      minutes: (servedMap.get(day)?.sec ?? 0) / 60,
    }
  })

  const earsTotalCents = earsByVendor.reduce((a, v) => a + earsCents(v.earsVendor, v._sum.listenedMs ?? 0), 0)
  const cogsCents = Math.round(centsFromMicros(llmAgg._sum.costMicros ?? 0) + earsTotalCents)
  const revenueNet = revenueAgg._sum.netCents ?? 0

  return {
    installs,
    firstStories: firstStoriesRow[0]?.n ?? 0,
    finishedStories,
    purchasesByPack: byPack.map((p) => ({ packId: p.packId, count: p._count._all })),
    purchasesByChannel: byChannel.map((c) => ({
      channel: c.channel,
      count: c._count._all,
      grossCents: c._sum.grossCents ?? 0,
      netCents: c._sum.netCents ?? 0,
    })),
    revenueGross: revenueAgg._sum.grossCents ?? 0,
    revenueNet,
    minutesServedSec: servedAgg._sum.chargedSec ?? 0,
    cogsCents,
    grossMarginCents: revenueNet - cogsCents,
    freeSecGiven: freeAgg._sum.seconds ?? 0,
    sharesCreated,
    shareInstalls: shareInstallsAgg._sum.installs ?? 0,
    refunds,
    series,
  }
}

// ================================================================ usage

export async function usage(days: number) {
  const start = rangeStart(days)
  const keys = dayKeys(days)

  const [callD, micD, earsSplitRows, modelSplitRows] = await Promise.all([
    prisma.$queryRaw<
      {
        day: string
        beats: number
        out_p50: number | null
        out_p95: number | null
        ft_p50: number | null
        ft_p95: number | null
        tot_p50: number | null
        restart_rate: number | null
        skip_rate: number | null
        cache_hit: number | null
      }[]
    >`
      SELECT
        to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
        count(*)::int AS beats,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY output_tokens)::float8 AS out_p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY output_tokens)::float8 AS out_p95,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY first_token_ms)::float8 AS ft_p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY first_token_ms)::float8 AS ft_p95,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms)::float8 AS tot_p50,
        avg((restart)::int)::float8 AS restart_rate,
        avg((skip)::int)::float8 AS skip_rate,
        (sum(cached_tokens)::float8 / nullif(sum(cached_tokens + input_tokens), 0)) AS cache_hit
      FROM call_log WHERE created_at >= ${start} GROUP BY 1`,
    prisma.$queryRaw<{ day: string; ms: number }[]>`
      SELECT to_char(date_trunc('day', started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             coalesce(sum(listened_ms), 0)::float8 AS ms
      FROM story_session WHERE started_at >= ${start} GROUP BY 1`,
    prisma.storySession.groupBy({
      by: ['earsVendor'],
      where: { startedAt: { gte: start } },
      _sum: { listenedMs: true },
    }),
    prisma.callLog.groupBy({ by: ['model'], where: { createdAt: { gte: start } }, _count: { _all: true } }),
  ])

  const callMap = byDay(callD)
  const micMap = byDay(micD)

  const series = keys.map((day) => {
    const c = callMap.get(day)
    return {
      day,
      micMinutes: (micMap.get(day)?.ms ?? 0) / 60000,
      beats: c?.beats ?? 0,
      outputTokensP50: Math.round(c?.out_p50 ?? 0),
      outputTokensP95: Math.round(c?.out_p95 ?? 0),
      firstTokenP50: Math.round(c?.ft_p50 ?? 0),
      firstTokenP95: Math.round(c?.ft_p95 ?? 0),
      totalMsP50: Math.round(c?.tot_p50 ?? 0),
      restartRate: c?.restart_rate ?? 0,
      skipRate: c?.skip_rate ?? 0,
      cacheHitRate: c?.cache_hit ?? 0,
    }
  })

  return {
    series,
    earsSplit: earsSplitRows.map((e) => ({ vendor: e.earsVendor, minutes: (e._sum.listenedMs ?? 0) / 60000 })),
    modelSplit: modelSplitRows.map((m) => ({ model: m.model, calls: m._count._all })),
  }
}

// ================================================================ ledger

export async function ledgerSearch(q: string) {
  const term = q.trim()
  if (!term) return []
  const [giftDev, purch] = await Promise.all([
    prisma.giftCode.findFirst({ where: { code: term }, select: { redeemedByDeviceId: true } }),
    prisma.purchase.findFirst({ where: { externalId: term }, select: { deviceId: true } }),
  ])
  const extraIds = [giftDev?.redeemedByDeviceId, purch?.deviceId].filter((x): x is string => Boolean(x))
  const devices = await prisma.device.findMany({
    where: {
      OR: [
        { code: { contains: term, mode: 'insensitive' } },
        { installId: { contains: term } },
        { id: { startsWith: term } },
        ...(extraIds.length ? [{ id: { in: extraIds } }] : []),
      ],
    },
    orderBy: { lastSeenAt: 'desc' },
    take: 20,
  })
  return devices.map((d) => ({
    id: d.id,
    code: d.code,
    platform: d.platform,
    balanceSec: d.balanceSec,
    paying: d.paying,
    blocked: d.blocked,
    createdAt: d.createdAt.toISOString(),
    lastSeenAt: d.lastSeenAt.toISOString(),
  }))
}

export async function ledgerDevice(deviceId: string) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } })
  if (!device) return null
  const [entries, sessions, purchases, shares] = await Promise.all([
    prisma.ledgerEntry.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.storySession.findMany({ where: { deviceId }, orderBy: { startedAt: 'desc' }, take: 50 }),
    prisma.purchase.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' } }),
    prisma.share.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' }, select: shareCardSelect }),
  ])
  return {
    device: {
      id: device.id,
      code: device.code,
      installId: device.installId,
      platform: device.platform,
      appVersion: device.appVersion,
      balanceSec: device.balanceSec,
      paying: device.paying,
      blocked: device.blocked,
      blockedReason: device.blockedReason,
      freeStoryUsed: device.freeStoryUsed,
      weeklyGrantAt: device.weeklyGrantAt?.toISOString() ?? null,
      shareVoice: device.shareVoice,
      lastPack: device.lastPack,
      createdAt: device.createdAt.toISOString(),
      lastSeenAt: device.lastSeenAt.toISOString(),
    },
    entries: entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      seconds: e.seconds,
      balanceAfter: e.balanceAfter,
      ref: e.ref,
      note: e.note,
      actor: e.actor,
      createdAt: e.createdAt.toISOString(),
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      storyId: s.storyId,
      earsVendor: s.earsVendor,
      status: s.status,
      endReason: s.endReason,
      chargedSec: s.chargedSec,
      listenedMs: s.listenedMs,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
    })),
    purchases: purchases.map((p) => ({
      id: p.id,
      channel: p.channel,
      packId: p.packId,
      seconds: p.seconds,
      grossCents: p.grossCents,
      netCents: p.netCents,
      externalId: p.externalId,
      refundedAt: p.refundedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
    shares: shares.map(toShareCard),
  }
}

export async function setBlocked(deviceId: string, blocked: boolean, reason: string, actor: string) {
  const device = await prisma.device.update({
    where: { id: deviceId },
    data: { blocked, blockedReason: blocked ? reason : null },
  })
  await logAudit(actor, blocked ? 'device.block' : 'device.unblock', deviceId, { reason })
  return { blocked: device.blocked, balanceSec: device.balanceSec }
}

export async function resetFreeStory(deviceId: string, actor: string) {
  await prisma.device.update({
    where: { id: deviceId },
    data: { freeStoryUsed: false, weeklyGrantAt: null },
  })
  await logAudit(actor, 'device.reset_free_story', deviceId, null)
  return { ok: true }
}

/** Re-read the balance after a ledger credit/debit so the drawer can update in place. */
export async function deviceBalance(deviceId: string) {
  const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { balanceSec: true } })
  return { balanceSec: d?.balanceSec ?? 0 }
}

// ================================================================ revenue

export async function revenue(days: number) {
  const start = rangeStart(days)

  const [rows, dailyRaw, giftSold, giftRedeemed, outstanding, refunds] = await Promise.all([
    prisma.purchase.findMany({
      where: { createdAt: { gte: start } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { device: { select: { code: true } } },
    }),
    prisma.$queryRaw<{ day: string; gross: number; net: number; iap: number; web: number }[]>`
      SELECT
        to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
        coalesce(sum(gross_cents), 0)::float8 AS gross,
        coalesce(sum(net_cents), 0)::float8 AS net,
        coalesce(sum(gross_cents) FILTER (WHERE channel = 'iap'), 0)::float8 AS iap,
        coalesce(sum(gross_cents) FILTER (WHERE channel = 'stripe'), 0)::float8 AS web
      FROM purchase WHERE created_at >= ${start} AND refunded_at IS NULL GROUP BY 1`,
    prisma.giftCode.count({ where: { createdAt: { gte: start } } }),
    prisma.giftCode.count({ where: { redeemedAt: { gte: start } } }),
    prisma.giftCode.aggregate({
      where: { redeemedAt: null, voidedAt: null },
      _count: { _all: true },
      _sum: { seconds: true },
    }),
    prisma.purchase.count({ where: { refundedAt: { gte: start } } }),
  ])

  const dailyMap = byDay(dailyRaw)
  const daily = dayKeys(days).map((day) => {
    const r = dailyMap.get(day)
    return {
      day,
      grossCents: Math.round(r?.gross ?? 0),
      netCents: Math.round(r?.net ?? 0),
      iapCents: Math.round(r?.iap ?? 0),
      webCents: Math.round(r?.web ?? 0),
    }
  })

  return {
    purchases: rows.map((p) => ({
      id: p.id,
      createdAt: p.createdAt.toISOString(),
      packId: p.packId,
      channel: p.channel,
      grossCents: p.grossCents,
      feeCents: p.feeCents,
      netCents: p.netCents,
      deviceCode: p.device.code,
      refundedAt: p.refundedAt?.toISOString() ?? null,
    })),
    daily,
    giftCodes: {
      sold: giftSold,
      redeemed: giftRedeemed,
      outstanding: outstanding._count._all,
      liabilitySeconds: outstanding._sum.seconds ?? 0,
    },
    refunds,
  }
}

// ================================================================ costs

export async function costs(days: number) {
  const start = rangeStart(days)

  const [rows, llmDaily, earsDaily, byPaying, earsByPaying, topLlm] = await Promise.all([
    prisma.callLog.findMany({
      where: { createdAt: { gte: start } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { device: { select: { code: true } } },
    }),
    prisma.$queryRaw<{ day: string; micros: number; calls: number }[]>`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             coalesce(sum(cost_micros), 0)::float8 AS micros, count(*)::int AS calls
      FROM call_log WHERE created_at >= ${start} GROUP BY 1`,
    prisma.$queryRaw<{ day: string; vendor: string; ms: number }[]>`
      SELECT to_char(date_trunc('day', started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             ears_vendor AS vendor, coalesce(sum(listened_ms), 0)::float8 AS ms
      FROM story_session WHERE started_at >= ${start} GROUP BY 1, 2`,
    prisma.$queryRaw<{ paying: boolean; micros: number; devs: number }[]>`
      SELECT d.paying AS paying, coalesce(sum(c.cost_micros), 0)::float8 AS micros,
             count(DISTINCT c.device_id)::int AS devs
      FROM call_log c JOIN device d ON d.id = c.device_id
      WHERE c.created_at >= ${start} GROUP BY d.paying`,
    prisma.$queryRaw<{ paying: boolean; vendor: string; ms: number }[]>`
      SELECT d.paying AS paying, s.ears_vendor AS vendor, coalesce(sum(s.listened_ms), 0)::float8 AS ms
      FROM story_session s JOIN device d ON d.id = s.device_id
      WHERE s.started_at >= ${start} GROUP BY d.paying, s.ears_vendor`,
    prisma.$queryRaw<{ id: string; code: string; paying: boolean; calls: number; micros: number }[]>`
      SELECT d.id AS id, d.code AS code, d.paying AS paying, count(c.id)::int AS calls,
             coalesce(sum(c.cost_micros), 0)::float8 AS micros
      FROM call_log c JOIN device d ON d.id = c.device_id
      WHERE c.created_at >= ${start} GROUP BY d.id, d.code, d.paying
      ORDER BY micros DESC LIMIT 20`,
  ])

  const earsDayMap = new Map<string, number>()
  for (const r of earsDaily) earsDayMap.set(r.day, (earsDayMap.get(r.day) ?? 0) + earsCents(r.vendor, r.ms))
  const llmMap = byDay(llmDaily)
  const daily = dayKeys(days).map((day) => ({
    day,
    llmCents: Math.round(centsFromMicros(llmMap.get(day)?.micros ?? 0)),
    earsCents: Math.round(earsDayMap.get(day) ?? 0),
    calls: llmMap.get(day)?.calls ?? 0,
  }))

  // cost per paying / free user = (llm + ears) for that cohort / distinct active devices in it
  const earsPay = new Map<string, number>()
  for (const r of earsByPaying) {
    const key = r.paying ? 'pay' : 'free'
    earsPay.set(key, (earsPay.get(key) ?? 0) + earsCents(r.vendor, r.ms))
  }
  const pay = byPaying.find((r) => r.paying)
  const free = byPaying.find((r) => !r.paying)
  const payCost = centsFromMicros(pay?.micros ?? 0) + (earsPay.get('pay') ?? 0)
  const freeCost = centsFromMicros(free?.micros ?? 0) + (earsPay.get('free') ?? 0)
  const costPerPayingUser = pay && pay.devs > 0 ? Math.round(payCost / pay.devs) : 0
  const costPerFreeUser = free && free.devs > 0 ? Math.round(freeCost / free.devs) : 0

  // fold ears into the top-cost list by device
  const topIds = topLlm.map((t) => t.id)
  const earsByDevice = topIds.length
    ? await prisma.$queryRaw<{ id: string; vendor: string; ms: number }[]>`
        SELECT s.device_id AS id, s.ears_vendor AS vendor, coalesce(sum(s.listened_ms), 0)::float8 AS ms
        FROM story_session s
        WHERE s.started_at >= ${start} AND s.device_id IN (${Prisma.join(topIds)})
        GROUP BY s.device_id, s.ears_vendor`
    : []
  const earsDevMap = new Map<string, number>()
  for (const r of earsByDevice) earsDevMap.set(r.id, (earsDevMap.get(r.id) ?? 0) + earsCents(r.vendor, r.ms))
  const topDevices = topLlm
    .map((t) => ({
      code: t.code,
      paying: t.paying,
      calls: t.calls,
      costCents: Math.round(centsFromMicros(t.micros) + (earsDevMap.get(t.id) ?? 0)),
    }))
    .sort((a, b) => b.costCents - a.costCents)

  return {
    calls: rows.map((c) => ({
      id: c.id,
      createdAt: c.createdAt.toISOString(),
      deviceCode: c.device.code,
      model: c.model,
      dialect: c.dialect,
      inputTokens: c.inputTokens,
      cachedTokens: c.cachedTokens,
      outputTokens: c.outputTokens,
      costCents: centsFromMicros(c.costMicros),
      firstTokenMs: c.firstTokenMs,
      totalMs: c.totalMs,
      restart: c.restart,
      skip: c.skip,
      error: c.error,
    })),
    daily,
    costPerPayingUser,
    costPerFreeUser,
    topDevices,
  }
}

// ================================================================ shares

const shareCardSelect = {
  id: true,
  title: true,
  childName: true,
  views: true,
  downloads: true,
  installs: true,
  voiceMime: true,
  createdAt: true,
  expiresAt: true,
  unpublishedAt: true,
  device: { select: { code: true } },
} as const

type ShareCardRow = {
  id: string
  title: string
  childName: string | null
  views: number
  downloads: number
  installs: number
  voiceMime: string | null
  createdAt: Date
  expiresAt: Date
  unpublishedAt: Date | null
  device: { code: string }
}

function toShareCard(s: ShareCardRow) {
  return {
    id: s.id,
    title: s.title,
    childName: s.childName,
    deviceCode: s.device.code,
    hasVoice: s.voiceMime !== null,
    views: s.views,
    downloads: s.downloads,
    installs: s.installs,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    unpublishedAt: s.unpublishedAt?.toISOString() ?? null,
  }
}

export async function sharesList(days: number) {
  const start = rangeStart(days)
  const [rows, dailyRaw] = await Promise.all([
    prisma.share.findMany({
      where: { createdAt: { gte: start } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: shareCardSelect,
    }),
    prisma.$queryRaw<{ day: string; n: number; views: number }[]>`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             count(*)::int AS n, coalesce(sum(views), 0)::float8 AS views
      FROM share WHERE created_at >= ${start} GROUP BY 1`,
  ])
  const dailyMap = byDay(dailyRaw)
  const daily = dayKeys(days).map((day) => ({
    day,
    created: dailyMap.get(day)?.n ?? 0,
    views: Math.round(dailyMap.get(day)?.views ?? 0),
  }))
  return { rows: rows.map(toShareCard), daily }
}

export async function unpublishShare(id: string, actor: string) {
  await prisma.share.update({ where: { id }, data: { unpublishedAt: new Date() } })
  await logAudit(actor, 'share.unpublish', id, null)
  return { ok: true }
}

// ================================================================ kid-safety

export async function safety(days: number) {
  const start = rangeStart(days)
  const [skipRaw, recent, maskRows] = await Promise.all([
    prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM call_log WHERE created_at >= ${start} AND skip = true GROUP BY 1`,
    prisma.callLog.findMany({
      where: { skip: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { device: { select: { code: true } } },
    }),
    prisma.maskWord.findMany({ orderBy: { word: 'asc' } }),
  ])
  const skipMap = byDay(skipRaw)
  const skips = dayKeys(days).map((day) => ({ day, count: skipMap.get(day)?.n ?? 0 }))
  return {
    skips,
    recentSkips: recent.map((c) => ({
      createdAt: c.createdAt.toISOString(),
      deviceCode: c.device.code,
      skipWords: c.skipWords,
    })),
    maskWords: maskRows.map((m) => m.word),
  }
}

export async function maskAdd(word: string, actor: string) {
  const clean = word.trim().toLowerCase()
  await prisma.maskWord.upsert({
    where: { word: clean },
    create: { word: clean, addedBy: actor },
    update: {},
  })
  await logAudit(actor, 'mask.add', clean, null)
  return { word: clean }
}

export async function maskRemove(word: string, actor: string) {
  const clean = word.trim().toLowerCase()
  await prisma.maskWord.delete({ where: { word: clean } }).catch(() => undefined)
  await logAudit(actor, 'mask.remove', clean, null)
  return { word: clean }
}

// ================================================================ alerts + audit

export async function alertsList(unreadOnly: boolean) {
  const rows = await prisma.alert.findMany({
    where: unreadOnly ? { readAt: null } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return rows.map((a) => ({
    id: a.id,
    kind: a.kind,
    message: a.message,
    detail: jsonValue(a.detail),
    sentAt: a.sentAt?.toISOString() ?? null,
    readAt: a.readAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  }))
}

export async function markAlertRead(id: string) {
  await prisma.alert.update({ where: { id }, data: { readAt: new Date() } })
  return { ok: true }
}

export async function auditList(limit: number) {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
  return rows.map((a) => ({
    id: a.id,
    actor: a.actor,
    action: a.action,
    target: a.target,
    detail: jsonValue(a.detail),
    createdAt: a.createdAt.toISOString(),
  }))
}

/** Append an admin action to the audit log. */
export async function logAudit(
  actor: string,
  action: string,
  target: string | null,
  detail: Prisma.InputJsonValue | null
) {
  await prisma.auditLog.create({
    data: { actor, action, target, ...(detail !== null ? { detail } : {}) },
  })
}

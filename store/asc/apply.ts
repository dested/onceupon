#!/usr/bin/env bun
/**
 * Writes Squiggletale 1.0.0's App Store Connect metadata, one step at a time. Each step reads first and only
 * writes what differs, so a re-run is safe. Never submits, never creates a review submission, never attaches a
 * build, never touches another app's data (Store Brand Puzzles is only read).
 *
 *   bun store/asc/apply.ts status                 read back everything this script owns (phone never printed)
 *   bun store/asc/apply.ts settings               version string, copyright, release type, URLs, content rights,
 *                                                 age rating, free price, availability, IAP prices, review contact
 *   bun store/asc/apply.ts territories            app + IAP availability from store/asc/territories.json
 *   bun store/asc/apply.ts categories             primary + secondary category (needs the lead's OK)
 *   bun store/asc/apply.ts copy                   listing copy from store/asc/listing.json (after `pass listing`)
 *   bun store/asc/apply.ts iap-screenshot <png>   App Review screenshot on all three IAPs
 *   bun store/asc/apply.ts screenshots            store/screenshots/iphone-6.9/* and ipad-13/*, file order
 *   bun store/asc/apply.ts notes <file>           App Review notes text (after the lead's `notes ready`)
 *
 * Exit 0 = done, 1 = an API refusal (printed), 2 = usage.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { asc } from './asc'

const APP = '6815029998'
const VERSION = 'ab409615-45cd-4e93-91f4-08b26038746b'
const REFERENCE_APP = '6819053321' // Store Brand Puzzles: read only, for territories and the review contact
const IAPS = ['6815030317', '6815031238', '6815032143'] as const
const ROOT = new URL('../../', import.meta.url).pathname

const Res = z.object({ id: z.string(), type: z.string(), attributes: z.record(z.unknown()).optional() }).passthrough()
type Res = z.infer<typeof Res>
const One = z.object({ data: Res, included: z.array(Res).optional() })
const Many = z.object({ data: z.array(Res), included: z.array(Res).optional(), links: z.object({ next: z.string().optional() }).optional() })

class AscError extends Error {}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const { status, json } = await asc(method, path, body)
  if (status >= 300) throw new AscError(`${method} ${path}: HTTP ${status} ${JSON.stringify(json).slice(0, 900)}`)
  return json
}
const get1 = async (path: string) => One.parse(await call('GET', path))
async function getAll(path: string): Promise<Res[]> {
  const out: Res[] = []
  let next: string | undefined = path
  while (next) {
    const page = Many.parse(await call('GET', next))
    out.push(...page.data)
    next = page.links?.next
  }
  return out
}
const str = (r: Res, k: string): string | null => {
  const v = r.attributes?.[k]
  return typeof v === 'string' ? v : null
}
const say = (s: string) => console.log(s)

/** PATCH only the attributes that differ from `current`. */
async function patchDiff(type: string, id: string, path: string, current: Res, want: Record<string, unknown>): Promise<void> {
  const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => current.attributes?.[k] !== v))
  if (Object.keys(diff).length === 0) return say(`= ${type} ${id}: already set`)
  await call('PATCH', path, { data: { type, id, attributes: diff } })
  say(`✓ ${type} ${id}: ${Object.keys(diff).join(', ')}`)
}

async function appInfo(): Promise<{ info: Res; loc: Res; age: Res }> {
  const infos = Many.parse(await call('GET', `/v1/apps/${APP}/appInfos?include=appInfoLocalizations,ageRatingDeclaration`))
  const info = infos.data.find((i) => str(i, 'state') !== 'READY_FOR_DISTRIBUTION') ?? infos.data[0]
  const loc = infos.included?.find((r) => r.type === 'appInfoLocalizations' && str(r, 'locale') === 'en-US')
  const age = infos.included?.find((r) => r.type === 'ageRatingDeclarations')
  if (!info || !loc || !age) throw new AscError('appInfo: missing info, en-US localization or age rating')
  return { info, loc, age }
}

async function versionLoc(): Promise<Res> {
  const locs = await getAll(`/v1/appStoreVersions/${VERSION}/appStoreVersionLocalizations`)
  const loc = locs.find((l) => str(l, 'locale') === 'en-US')
  if (!loc) throw new AscError('no en-US version localization')
  return loc
}

const AGE_RATING = {
  kidsAgeBand: 'SIX_TO_EIGHT',
  violenceCartoonOrFantasy: 'NONE',
  violenceRealistic: 'NONE',
  violenceRealisticProlongedGraphicOrSadistic: 'NONE',
  gunsOrOtherWeapons: 'NONE',
  profanityOrCrudeHumor: 'NONE',
  matureOrSuggestiveThemes: 'NONE',
  horrorOrFearThemes: 'NONE',
  sexualContentOrNudity: 'NONE',
  sexualContentGraphicAndNudity: 'NONE',
  alcoholTobaccoOrDrugUseOrReferences: 'NONE',
  medicalOrTreatmentInformation: 'NONE',
  healthOrWellnessTopics: false,
  gamblingSimulated: 'NONE',
  gambling: false,
  contests: 'NONE',
  lootBox: false,
  unrestrictedWebAccess: false,
  messagingAndChat: false,
  userGeneratedContent: false,
  socialMedia: false,
  socialMediaAgeRestricted: false,
  advertising: false,
  parentalControls: true,
  ageAssurance: false,
  ageRatingOverride: 'NONE',
  ageRatingOverrideV2: 'NONE',
} as const

const Listing = z.object({
  subtitle: z.string(),
  promotionalText: z.string(),
  description: z.string(),
  keywords: z.string(),
  supportUrl: z.string(),
  marketingUrl: z.string(),
  privacyPolicyUrl: z.string(),
  iaps: z.array(z.object({ productId: z.string(), id: z.string(), name: z.string(), description: z.string(), usd: z.string(), reviewNote: z.string() })),
})
const listing = () => Listing.parse(JSON.parse(readFileSync(join(ROOT, 'store/asc/listing.json'), 'utf8')))

// ---------------------------------------------------------------- settings

async function settings(): Promise<void> {
  const l = listing()
  const version = await get1(`/v1/appStoreVersions/${VERSION}`)
  await patchDiff('appStoreVersions', VERSION, `/v1/appStoreVersions/${VERSION}`, version.data, {
    versionString: '1.0.0',
    copyright: '2026 QuickGame World Inc.',
    releaseType: 'AFTER_APPROVAL',
    usesIdfa: false,
  })

  const vloc = await versionLoc()
  await patchDiff('appStoreVersionLocalizations', vloc.id, `/v1/appStoreVersionLocalizations/${vloc.id}`, vloc, {
    supportUrl: l.supportUrl,
    marketingUrl: l.marketingUrl,
  })

  const { loc, age } = await appInfo()
  await patchDiff('appInfoLocalizations', loc.id, `/v1/appInfoLocalizations/${loc.id}`, loc, { privacyPolicyUrl: l.privacyPolicyUrl })

  const app = await get1(`/v1/apps/${APP}`)
  await patchDiff('apps', APP, `/v1/apps/${APP}`, app.data, { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' })

  await patchDiff('ageRatingDeclarations', age.id, `/v1/ageRatingDeclarations/${age.id}`, age, AGE_RATING)

  await freePrice()
  await availability()
  for (const iap of l.iaps) await iapPrice(iap.id, iap.usd)
  await iapAvailability()
  await reviewContact()
}

async function freePrice(): Promise<void> {
  const existing = await asc('GET', `/v1/appPriceSchedules/${APP}/manualPrices?include=appPricePoint`)
  if (existing.status === 200 && Many.parse(existing.json).data.length > 0) {
    return say(`= app price schedule: ${Many.parse(existing.json).data.length} manual price(s) already set`)
  }
  const points = await getAll(`/v1/apps/${APP}/appPricePoints?filter[territory]=USA&limit=200`)
  const free = points.find((p) => Number(str(p, 'customerPrice')) === 0)
  if (!free) throw new AscError('no USA price point at 0.00')
  await call('POST', '/v1/appPriceSchedules', {
    data: {
      type: 'appPriceSchedules',
      relationships: {
        app: { data: { type: 'apps', id: APP } },
        baseTerritory: { data: { type: 'territories', id: 'USA' } },
        manualPrices: { data: [{ type: 'appPrices', id: '${free}' }] },
      },
    },
    included: [
      {
        type: 'appPrices',
        id: '${free}',
        attributes: { startDate: null },
        relationships: { appPricePoint: { data: { type: 'appPricePoints', id: free.id } } },
      },
    ],
  })
  say('✓ app price: free (USA base)')
}

/**
 * The territory list: store/asc/territories.json (Store Brand Puzzles' 175 minus China mainland and every region
 * Anthropic doesn't serve, lead 2026-11-04). The same list goes on the app and all three IAPs.
 */
const Territories = z.object({ availableInNewTerritories: z.boolean(), territories: z.array(z.string()), dropped: z.record(z.string()) })
const territoryPlan = () => Territories.parse(JSON.parse(readFileSync(join(ROOT, 'store/asc/territories.json'), 'utf8')))

const TerritoryRow = z.object({
  id: z.string(),
  attributes: z.object({ available: z.boolean().nullable().optional() }).passthrough(),
  relationships: z.object({ territory: z.object({ data: z.object({ id: z.string() }) }) }),
})

async function availability(): Promise<void> {
  const plan = territoryPlan()
  const want = new Set(plan.territories)
  const mine = await asc('GET', `/v1/apps/${APP}/appAvailabilityV2`)
  if (mine.status !== 200) {
    await call('POST', '/v2/appAvailabilities', {
      data: {
        type: 'appAvailabilities',
        attributes: { availableInNewTerritories: plan.availableInNewTerritories },
        relationships: {
          app: { data: { type: 'apps', id: APP } },
          territoryAvailabilities: { data: plan.territories.map((t) => ({ type: 'territoryAvailabilities', id: `\${${t}}` })) },
        },
      },
      included: plan.territories.map((t) => ({
        type: 'territoryAvailabilities',
        id: `\${${t}}`,
        attributes: { available: true },
        relationships: { territory: { data: { type: 'territories', id: t } } },
      })),
    })
    return say(`✓ app availability: ${want.size} territories, new territories ${plan.availableInNewTerritories ? 'on' : 'off'}`)
  }
  const avail = z.object({ data: z.object({ attributes: z.object({ availableInNewTerritories: z.boolean() }) }) }).parse(mine.json)
  if (avail.data.attributes.availableInNewTerritories !== plan.availableInNewTerritories) {
    say(`! app availableInNewTerritories is ${String(avail.data.attributes.availableInNewTerritories)}; the API has no update for it (set it in App Store Connect → Pricing and Availability)`)
  }
  const rows = (await getAll(`/v2/appAvailabilities/${APP}/territoryAvailabilities?limit=200&include=territory`)).map((r) => TerritoryRow.parse(r))
  let changed = 0
  for (const r of rows) {
    const t = r.relationships.territory.data.id
    const on = want.has(t)
    if ((r.attributes.available === true) === on) continue
    await call('PATCH', `/v1/territoryAvailabilities/${r.id}`, { data: { type: 'territoryAvailabilities', id: r.id, attributes: { available: on } } })
    say(`✓ app ${t}: ${on ? 'on' : 'off'}${on ? '' : ` (${plan.dropped[t] ?? 'not in the list'})`}`)
    changed++
  }
  const missing = plan.territories.filter((t) => !rows.some((r) => r.relationships.territory.data.id === t))
  if (missing.length > 0) say(`! app availability has no row for: ${missing.join(',')}`)
  const onNow = rows.filter((r) => want.has(r.relationships.territory.data.id)).length
  say(`${changed === 0 ? '=' : '✓'} app availability: ${onNow} territories on, ${changed} changed`)
}

async function iapPrice(iapId: string, usd: string): Promise<void> {
  const existing = await asc('GET', `/v1/inAppPurchasePriceSchedules/${iapId}/manualPrices?include=inAppPurchasePricePoint,territory`)
  if (existing.status === 200 && Many.parse(existing.json).data.length > 0) return say(`= IAP ${iapId} price already set`)
  const points = await getAll(`/v2/inAppPurchases/${iapId}/pricePoints?filter[territory]=USA&limit=200`)
  const point = points.find((p) => str(p, 'customerPrice') === usd || Number(str(p, 'customerPrice')) === Number(usd))
  if (!point) throw new AscError(`IAP ${iapId}: no USA price point at ${usd}`)
  await call('POST', '/v1/inAppPurchasePriceSchedules', {
    data: {
      type: 'inAppPurchasePriceSchedules',
      relationships: {
        inAppPurchase: { data: { type: 'inAppPurchases', id: iapId } },
        baseTerritory: { data: { type: 'territories', id: 'USA' } },
        manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${p}' }] },
      },
    },
    included: [
      {
        type: 'inAppPurchasePrices',
        id: '${p}',
        attributes: { startDate: null },
        relationships: { inAppPurchasePricePoint: { data: { type: 'inAppPurchasePricePoints', id: point.id } } },
      },
    ],
  })
  say(`✓ IAP ${iapId}: $${usd} USA base, other territories equalized`)
}

async function iapAvailability(): Promise<void> {
  const plan = territoryPlan()
  const want = new Set(plan.territories)
  for (const id of IAPS) {
    const cur = z.object({ data: z.object({ attributes: z.object({ availableInNewTerritories: z.boolean() }) }) })
      .parse(await call('GET', `/v2/inAppPurchases/${id}/inAppPurchaseAvailability`))
    const have = new Set((await getAll(`/v1/inAppPurchaseAvailabilities/${id}/availableTerritories?limit=200`)).map((t) => t.id))
    const same = have.size === want.size && [...want].every((t) => have.has(t))
    if (same && cur.data.attributes.availableInNewTerritories === plan.availableInNewTerritories) {
      say(`= IAP ${id} availability: ${have.size} territories, same as the app`)
      continue
    }
    await call('POST', '/v1/inAppPurchaseAvailabilities', {
      data: {
        type: 'inAppPurchaseAvailabilities',
        attributes: { availableInNewTerritories: plan.availableInNewTerritories },
        relationships: {
          inAppPurchase: { data: { type: 'inAppPurchases', id } },
          availableTerritories: { data: plan.territories.map((t) => ({ type: 'territories', id: t })) },
        },
      },
    })
    const dropped = [...have].filter((t) => !want.has(t))
    say(`✓ IAP ${id} availability: ${want.size} territories, new territories ${plan.availableInNewTerritories ? 'on' : 'off'}; dropped ${dropped.join(',') || 'none'}`)
  }
}

const ReviewDetail = z.object({
  contactFirstName: z.string().nullable(),
  contactLastName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
})

async function reviewDetailOf(versionId: string): Promise<Res | null> {
  const r = await asc('GET', `/v1/appStoreVersions/${versionId}/appStoreReviewDetail`)
  if (r.status !== 200) return null
  return z.object({ data: Res.nullable() }).parse(r.json).data
}

async function reviewContact(): Promise<void> {
  const refVersions = await getAll(`/v1/apps/${REFERENCE_APP}/appStoreVersions?limit=10`)
  let ref: Res | null = null
  for (const v of refVersions) {
    ref = await reviewDetailOf(v.id)
    if (ref) break
  }
  if (!ref) throw new AscError('Store Brand Puzzles has no review detail to copy')
  const c = ReviewDetail.parse(ref.attributes)
  const want = {
    contactFirstName: c.contactFirstName,
    contactLastName: c.contactLastName,
    contactEmail: c.contactEmail,
    contactPhone: c.contactPhone,
    demoAccountRequired: false,
  }
  const mine = await reviewDetailOf(VERSION)
  if (mine) {
    const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => mine.attributes?.[k] !== v))
    if (Object.keys(diff).length === 0) return say('= review contact: already set')
    await call('PATCH', `/v1/appStoreReviewDetails/${mine.id}`, { data: { type: 'appStoreReviewDetails', id: mine.id, attributes: diff } })
    return say(`✓ review contact updated: ${Object.keys(diff).join(', ')}`)
  }
  await call('POST', '/v1/appStoreReviewDetails', {
    data: {
      type: 'appStoreReviewDetails',
      attributes: want,
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: VERSION } } },
    },
  })
  say('✓ review contact created from Store Brand Puzzles (name, email, phone), demo account not required')
}

// ---------------------------------------------------------------- categories

async function categories(): Promise<void> {
  const { info } = await appInfo()
  await call('PATCH', `/v1/appInfos/${info.id}`, {
    data: {
      type: 'appInfos',
      id: info.id,
      relationships: {
        primaryCategory: { data: { type: 'appCategories', id: 'EDUCATION' } },
        secondaryCategory: { data: { type: 'appCategories', id: 'ENTERTAINMENT' } },
      },
    },
  })
  say('✓ categories: primary EDUCATION, secondary ENTERTAINMENT')
}

// ---------------------------------------------------------------- copy

async function copy(): Promise<void> {
  const l = listing()
  const vloc = await versionLoc()
  await patchDiff('appStoreVersionLocalizations', vloc.id, `/v1/appStoreVersionLocalizations/${vloc.id}`, vloc, {
    description: l.description,
    keywords: l.keywords,
    promotionalText: l.promotionalText,
  })
  const { loc } = await appInfo()
  await patchDiff('appInfoLocalizations', loc.id, `/v1/appInfoLocalizations/${loc.id}`, loc, { subtitle: l.subtitle })
  for (const iap of l.iaps) {
    const one = await get1(`/v2/inAppPurchases/${iap.id}?include=inAppPurchaseLocalizations`)
    await patchDiff('inAppPurchases', iap.id, `/v2/inAppPurchases/${iap.id}`, one.data, { reviewNote: iap.reviewNote })
    const iloc = one.included?.find((r) => r.type === 'inAppPurchaseLocalizations' && str(r, 'locale') === 'en-US')
    if (!iloc) throw new AscError(`IAP ${iap.id}: no en-US localization`)
    await patchDiff('inAppPurchaseLocalizations', iloc.id, `/v1/inAppPurchaseLocalizations/${iloc.id}`, iloc, {
      name: iap.name,
      description: iap.description,
    })
  }
}

// ---------------------------------------------------------------- assets

const UploadOps = z.array(
  z.object({ method: z.string(), url: z.string(), length: z.number(), offset: z.number(), requestHeaders: z.array(z.object({ name: z.string(), value: z.string() })) }),
)

/** Reserve → PUT the bytes → commit with the md5, the ASC asset dance. */
async function uploadAsset(createPath: string, type: string, rel: Record<string, unknown>, file: string): Promise<string> {
  const bytes = readFileSync(file)
  const created = One.parse(
    await call('POST', createPath, { data: { type, attributes: { fileName: basename(file), fileSize: statSync(file).size }, relationships: rel } }),
  )
  const ops = UploadOps.parse(created.data.attributes?.uploadOperations)
  for (const op of ops) {
    const headers = Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value]))
    const res = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) })
    if (!res.ok) throw new AscError(`upload ${basename(file)}: ${res.status}`)
  }
  const md5 = createHash('md5').update(bytes).digest('hex')
  await call('PATCH', `${createPath}/${created.data.id}`, {
    data: { type, id: created.data.id, attributes: { uploaded: true, sourceFileChecksum: md5 } },
  })
  return created.data.id
}

async function iapScreenshot(file: string): Promise<void> {
  for (const id of IAPS) {
    const cur = await asc('GET', `/v2/inAppPurchases/${id}/appStoreReviewScreenshot`)
    const old = cur.status === 200 ? z.object({ data: Res.nullable() }).parse(cur.json).data : null
    if (old) await call('DELETE', `/v1/inAppPurchaseAppStoreReviewScreenshots/${old.id}`)
    await uploadAsset('/v1/inAppPurchaseAppStoreReviewScreenshots', 'inAppPurchaseAppStoreReviewScreenshots', {
      inAppPurchaseV2: { data: { type: 'inAppPurchases', id } },
    }, file)
    say(`✓ IAP ${id}: review screenshot ${basename(file)}`)
  }
}

const DISPLAY: Record<string, string> = { 'iphone-6.9': 'APP_IPHONE_67', 'ipad-13': 'APP_IPAD_PRO_3GEN_129' }

async function screenshots(): Promise<void> {
  const vloc = await versionLoc()
  const sets = await getAll(`/v1/appStoreVersionLocalizations/${vloc.id}/appScreenshotSets`)
  for (const [dir, displayType] of Object.entries(DISPLAY)) {
    const abs = join(ROOT, 'store/screenshots', dir)
    let files: string[]
    try {
      files = readdirSync(abs).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort()
    } catch {
      say(`- ${dir}: no folder yet`)
      continue
    }
    if (files.length === 0) {
      say(`- ${dir}: empty`)
      continue
    }
    let set = sets.find((s) => str(s, 'screenshotDisplayType') === displayType)
    if (set) {
      for (const old of await getAll(`/v1/appScreenshotSets/${set.id}/appScreenshots`)) await call('DELETE', `/v1/appScreenshots/${old.id}`)
    } else {
      set = One.parse(
        await call('POST', '/v1/appScreenshotSets', {
          data: {
            type: 'appScreenshotSets',
            attributes: { screenshotDisplayType: displayType },
            relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: vloc.id } } },
          },
        }),
      ).data
    }
    for (const f of files) {
      await uploadAsset('/v1/appScreenshots', 'appScreenshots', { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } }, join(abs, f))
    }
    say(`✓ ${displayType}: ${files.length} screenshots (${files.join(', ')})`)
  }
}

async function notes(file: string): Promise<void> {
  const text = readFileSync(file, 'utf8').trim()
  if (text.length > 4000) throw new AscError(`notes: ${text.length} > 4000`)
  const mine = await reviewDetailOf(VERSION)
  if (!mine) throw new AscError('no review detail yet: run settings first')
  await patchDiff('appStoreReviewDetails', mine.id, `/v1/appStoreReviewDetails/${mine.id}`, mine, { notes: text })
}

// ---------------------------------------------------------------- status

async function status(): Promise<void> {
  const v = (await get1(`/v1/appStoreVersions/${VERSION}`)).data
  say(`version ${str(v, 'versionString')} ${str(v, 'appStoreState')} copyright=${str(v, 'copyright')} release=${str(v, 'releaseType')}`)
  const vloc = await versionLoc()
  for (const k of ['description', 'keywords', 'promotionalText']) say(`  ${k}: ${(str(vloc, k) ?? '').length} chars`)
  say(`  supportUrl=${str(vloc, 'supportUrl')} marketingUrl=${str(vloc, 'marketingUrl')}`)
  const { info, loc, age } = await appInfo()
  const rel = z
    .object({ data: z.object({ relationships: z.record(z.object({ data: z.object({ id: z.string() }).nullable().optional() })) }) })
    .parse(await call('GET', `/v1/appInfos/${info.id}?include=primaryCategory,secondaryCategory`)).data
  say(`appInfo subtitle=${JSON.stringify(str(loc, 'subtitle'))} privacy=${str(loc, 'privacyPolicyUrl')} primary=${rel.relationships.primaryCategory?.data?.id ?? null} secondary=${rel.relationships.secondaryCategory?.data?.id ?? null}`)
  const unset = Object.entries(AGE_RATING).filter(([k, want]) => age.attributes?.[k] !== want).map(([k]) => k)
  say(`age rating: ${unset.length === 0 ? 'all answers set' : `differs: ${unset.join(', ')}`}; appStoreAgeRating=${String(info.attributes?.appStoreAgeRating)}`)
  const app = (await get1(`/v1/apps/${APP}`)).data
  say(`contentRights=${str(app, 'contentRightsDeclaration')} madeForKids=${String(app.attributes?.isOrEverWasMadeForKids)}`)
  const price = await asc('GET', `/v1/appPriceSchedules/${APP}/manualPrices?include=appPricePoint`)
  const pricePoint = price.status === 200 ? Many.parse(price.json).included?.find((r) => r.type === 'appPricePoints') : undefined
  say(`app price: ${pricePoint ? `USA ${str(pricePoint, 'customerPrice')}` : 'missing'}`)
  const av = await asc('GET', `/v1/apps/${APP}/appAvailabilityV2`)
  say(`availability: ${av.status === 200 ? 'set' : 'missing'}`)
  for (const id of IAPS) {
    const one = await get1(`/v2/inAppPurchases/${id}?include=inAppPurchaseLocalizations,appStoreReviewScreenshot`)
    const iloc = one.included?.find((r) => r.type === 'inAppPurchaseLocalizations')
    const prices = await asc('GET', `/v1/inAppPurchasePriceSchedules/${id}/manualPrices?include=inAppPurchasePricePoint`)
    const pp = prices.status === 200 ? Many.parse(prices.json) : null
    const usd = pp?.included?.find((r) => r.type === 'inAppPurchasePricePoints')
    const shot = one.included?.some((r) => r.type === 'inAppPurchaseAppStoreReviewScreenshots') ?? false
    say(`IAP ${id} ${str(one.data, 'state')} name=${JSON.stringify(iloc ? str(iloc, 'name') : null)} price=${usd ? str(usd, 'customerPrice') : 'none'} note=${str(one.data, 'reviewNote') ? 'set' : 'none'} screenshot=${shot}`)
  }
  const rd = await reviewDetailOf(VERSION)
  if (!rd) say('review detail: missing')
  else {
    const a = rd.attributes ?? {}
    say(`review detail: first=${a.contactFirstName ? 'set' : 'none'} last=${a.contactLastName ? 'set' : 'none'} email=${a.contactEmail ? 'set' : 'none'} phone=${a.contactPhone ? 'set' : 'none'} demoRequired=${String(a.demoAccountRequired)} notes=${typeof a.notes === 'string' ? a.notes.length : 0} chars`)
  }
  const sets = await getAll(`/v1/appStoreVersionLocalizations/${vloc.id}/appScreenshotSets`)
  for (const s of sets) say(`screenshots ${str(s, 'screenshotDisplayType')}: ${(await getAll(`/v1/appScreenshotSets/${s.id}/appScreenshots`)).length}`)
  if (sets.length === 0) say('screenshots: none')
}

async function main(): Promise<number> {
  const [step, arg] = process.argv.slice(2)
  try {
    if (step === 'status') await status()
    else if (step === 'settings') await settings()
    else if (step === 'territories') {
      await availability()
      await iapAvailability()
    }
    else if (step === 'categories') await categories()
    else if (step === 'copy') await copy()
    else if (step === 'iap-screenshot' && arg) await iapScreenshot(arg)
    else if (step === 'screenshots') await screenshots()
    else if (step === 'notes' && arg) await notes(arg)
    else {
      console.log('usage: bun store/asc/apply.ts status|settings|territories|categories|copy|iap-screenshot <png>|screenshots|notes <file>')
      return 2
    }
    return 0
  } catch (e) {
    if (e instanceof AscError || e instanceof z.ZodError) {
      console.error(`✗ ${e.message}`)
      return 1
    }
    throw e
  }
}

process.exit(await main())

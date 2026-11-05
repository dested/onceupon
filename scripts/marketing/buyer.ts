/**
 * Makes a LOCAL device a buyer (a 120-minute pack, paying), so its stories draw with the crayon buyers
 * get. Local databases only: refuses any DATABASE_URL that is not on localhost.
 *   cd apps/web && DATABASE_URL=postgresql://postgres@localhost:5432/onceupon_voice \
 *     bun ../../scripts/marketing/buyer.ts <installId>
 */
import { credit } from '../../apps/web/server/ledger'
import { prisma } from '../../apps/web/server/prisma'

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? ''
  if (!/@localhost[:/]/.test(url)) throw new Error('DATABASE_URL must point at a localhost database')
  const installId = process.argv[2]
  if (!installId) throw new Error('usage: buyer.ts <installId>')
  const d = await prisma.device.findUnique({ where: { installId } })
  if (!d) throw new Error(`no device with installId ${installId}`)
  if (!d.paying) await credit(d.id, 'admin', 7200, null, 'marketing capture: 120-minute pack', 'assets')
  const after = await prisma.device.update({
    where: { id: d.id },
    data: { paying: true, lastPack: 'pack_120' },
  })
  console.log(`${after.id}: paying=${after.paying} balance=${after.balanceSec}s`)
  await prisma.$disconnect()
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})

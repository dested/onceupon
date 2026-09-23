import { BRAND } from '../../../../packages/shared/src/brand'

/**
 * Per-page document metadata. Rendered as real <title>/<meta> elements inside the component tree;
 * React 19 hoists them (on the client into <head>, and during SSR into the rendered markup so the
 * tags ride along in the raw HTML response — which is what iMessage/Facebook read for /s/:id
 * unfurls). No useEffect: the tags must exist in the first byte, before hydration.
 *
 * index.html carries the static fallbacks (og:type, og:site_name, a default og:image and the tab
 * title) so a page that renders no <Head> still unfurls; og:title/og:description are page-owned so
 * there is a single authoritative value per document.
 */
export const SITE_META = {
  title: BRAND.name,
  description: `Your child tells a story out loud and a crayon draws it as they talk. Say "The End" and send the picture book to grandma.`,
  image: `${BRAND.origin}/app/og-default.png`,
} as const

export function Head({
  title,
  description = SITE_META.description,
  image,
}: {
  title: string
  description?: string
  image?: string
}) {
  const full = `${title} · ${BRAND.name}`
  return (
    <>
      <title>{full}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={full} />
      <meta property="og:description" content={description} />
      {image ? <meta property="og:image" content={image} /> : null}
    </>
  )
}

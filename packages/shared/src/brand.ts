/**
 * Everything that changes with the app's name. The name is Squiggletale (locked 2026-09-22, see
 * plans/2026-09-22-app-name.md and decisions.md). `origin`/`domain` are squiggletale.com since
 * 2026-11-05 (onceupon.dested.com is retired, decisions.md); flip them here only.
 */
export const BRAND = {
  name: 'Squiggletale',
  tagline: 'Say a story, the crayon draws',
  /** The website and API origin; the studio is served at `${origin}/app/`. */
  origin: 'https://squiggletale.com',
  domain: 'squiggletale.com',
  /** The public domain (Sal's, registered 2026-09-23); `origin`/`domain` moved to it on 2026-11-05. */
  publicDomain: 'squiggletale.com',
  company: 'QuickGame',
  /** The operator named in the privacy policy (COPPA notice: name, postal address, phone, email). */
  legalName: 'QuickGame World Inc.',
  /** Required before App Store submission (COPPA operator notice); empty strings are left out of the page. */
  postalAddress: '11201 N Tatum Blvd Ste 300, Phoenix, AZ 85028',
  phone: '+1 (623) 341-0751',
  /** Decision 7: forwarded to Sal's inbox by Namecheap email forwarding on squiggletale.com. */
  supportEmail: 'support@squiggletale.com',
  bundleId: 'com.quickgame.squiggletale',
  /** Deep-link scheme of the native shell. */
  scheme: 'squiggletale',
  /** The App Store listing (app 6815029998); 404s until 1.0 is live. */
  appStoreUrl: 'https://apps.apple.com/app/id6815029998',
  /** The end card of every exported video and the share page footer. */
  madeWith: 'Made with Squiggletale',
} as const

export const STUDIO_PATH = '/app/'

/**
 * Everything that changes with the app's name. The name is Squiggletale (locked 2026-09-22, see
 * plans/2026-09-22-app-name.md and decisions.md). `origin`/`domain` still point at the Drydock
 * deploy until squiggletale.app is bought and pointed; flip them here only.
 */
export const BRAND = {
  name: 'Squiggletale',
  tagline: 'Say a story, the crayon draws',
  /** The website and API origin; the studio is served at `${origin}/app/`. */
  origin: 'https://onceupon.dested.com',
  domain: 'onceupon.dested.com',
  /** The public domain once registered (squiggletale.com redirects here). */
  publicDomain: 'squiggletale.app',
  company: 'QuickGame',
  supportEmail: 'sal@quickga.me',
  bundleId: 'com.quickgame.squiggletale',
  /** Deep-link scheme of the native shell. */
  scheme: 'squiggletale',
  /** Filled in once the App Store listing exists. */
  appStoreUrl: '',
  /** The end card of every exported video and the share page footer. */
  madeWith: 'Made with Squiggletale',
} as const

export const STUDIO_PATH = '/app/'

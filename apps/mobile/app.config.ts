import type { ConfigContext, ExpoConfig } from 'expo/config'

// The Expo config loader transpiles this file in isolation and resolves requires with Node's CJS
// resolver, which cannot import the extensionless TS at ../../packages/shared/src/brand. So the
// brand values are mirrored here. SOURCE OF TRUTH: packages/shared/src/brand.ts — keep in sync.
const BRAND = {
  name: 'Squiggletale',
  origin: 'https://onceupon.dested.com',
  domain: 'onceupon.dested.com',
  bundleId: 'com.quickgame.squiggletale',
  scheme: 'squiggletale',
} as const

// Created by `eas init` on 2026-09-22 (owner quickgame); EAS_PROJECT_ID overrides for CI.
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID ?? '2606405b-8283-4717-a35b-25a41ca45a69'

const PAPER = '#fbf6ea'
// The splash image's paper tone (sampled from the generated icon) so the letterbox matches the art.
const SPLASH_PAPER = '#f9f0d0'

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: BRAND.name,
  slug: 'squiggletale',
  scheme: BRAND.scheme,
  version: '1.0.0',
  orientation: 'default',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  // The splash is configured through the expo-splash-screen plugin below (SDK 54+ removed the
  // top-level `splash` key from the config type).
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: BRAND.bundleId,
    supportsTablet: true,
    requireFullScreen: true,
    buildNumber: '1',
    infoPlist: {
      NSMicrophoneUsageDescription: `${BRAND.name} listens while your child tells a story so the crayon can draw it. Audio is transcribed live and never stored.`,
      WKAppBoundDomains: [BRAND.domain],
      ITSAppUsesNonExemptEncryption: false,
      UISupportedInterfaceOrientations: [
        'UIInterfaceOrientationLandscapeLeft',
        'UIInterfaceOrientationLandscapeRight',
        'UIInterfaceOrientationPortrait',
      ],
      'UISupportedInterfaceOrientations~ipad': [
        'UIInterfaceOrientationPortrait',
        'UIInterfaceOrientationPortraitUpsideDown',
        'UIInterfaceOrientationLandscapeLeft',
        'UIInterfaceOrientationLandscapeRight',
      ],
    },
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: BRAND.bundleId,
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: PAPER },
  },
  updates: {
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: 'appVersion' },
  plugins: [
    'expo-iap',
    'expo-updates',
    'expo-secure-store',
    ['expo-splash-screen', { image: './assets/splash.png', backgroundColor: SPLASH_PAPER, resizeMode: 'contain' }],
    'expo-dev-client',
  ],
  extra: { eas: { projectId: EAS_PROJECT_ID } },
})

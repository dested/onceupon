import type { ConfigContext, ExpoConfig } from 'expo/config'
import { type ConfigPlugin, withAppDelegate, withInfoPlist } from 'expo/config-plugins'

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

// Info.plist usage strings (parents read these in the iOS permission prompts).
const MIC_USAGE = `${BRAND.name} listens while your child tells a story so the crayon can draw it. Speech is turned into words on this device, and the recording stays on this device unless a grown-up shares the story.`
const PHOTOS_ADD_USAGE = `${BRAND.name} saves your story videos to your Photos.`
const SPEECH_USAGE = `${BRAND.name} turns your child's spoken story into words on this device so the crayon can draw it.`
// The splash image's paper tone (sampled from the generated icon) so the letterbox matches the art.
const SPLASH_PAPER = '#f9f0d0'

// The iOS 27 SDK (Xcode 27) ends the app at launch unless it adopts the UIScene life cycle. Expo 57
// ships the scene delegate (EXExpoAppSceneDelegate) but its prebuild template does not wire it, so
// the AppDelegate becomes the factory provider and stops creating the window; the scene delegate
// starts React Native. Same plugin as pickleball's app.config.ts. Drop it once the Expo template
// adopts scenes itself.
const WINDOW_BLOCK =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/
const APP_DELEGATE_DECL = 'class AppDelegate: ExpoAppDelegate {'

const withSceneLifecycle: ConfigPlugin = (cfg) =>
  withInfoPlist(
    withAppDelegate(cfg, (mod) => {
      const src = mod.modResults.contents
      if (src.includes('ExpoReactNativeFactoryProvider')) return mod
      if (
        mod.modResults.language !== 'swift' ||
        !src.includes(APP_DELEGATE_DECL) ||
        !WINDOW_BLOCK.test(src)
      ) {
        throw new Error(
          'withSceneLifecycle: AppDelegate.swift no longer matches the Expo 57 template; update the plugin'
        )
      }
      mod.modResults.contents = src
        .replace(
          APP_DELEGATE_DECL,
          'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {'
        )
        .replace(
          WINDOW_BLOCK,
          '\n    // The window and React Native start in EXExpoAppSceneDelegate (scene life cycle).\n'
        )
      return mod
    }),
    (mod) => {
      mod.modResults.UIApplicationSceneManifest = {
        UIApplicationSupportsMultipleScenes: false,
        UISceneConfigurations: {
          UIWindowSceneSessionRoleApplication: [
            {
              UISceneConfigurationName: 'Default Configuration',
              UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
            },
          ],
        },
      }
      return mod
    }
  )

export default ({ config }: ConfigContext): ExpoConfig =>
  withSceneLifecycle({
    ...config,
    name: BRAND.name,
    slug: 'squiggletale',
    scheme: BRAND.scheme,
    version: '1.0.0',
    orientation: 'default',
    userInterfaceStyle: 'light',
    // Root view color (expo-system-ui) so rotation and the keyboard never flash white.
    backgroundColor: PAPER,
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
        NSMicrophoneUsageDescription: MIC_USAGE,
        // No WKAppBoundDomains: with that key present WebKit disables user scripts, script message
        // handlers and evaluateJavaScript on any navigation it does not treat as app-bound (file:// never
        // is), which silently removed window.ReactNativeWebView and broke the whole bridge.
        ITSAppUsesNonExemptEncryption: false,
        // iPhone is portrait only for 1.0 (its landscape layout is broken); iPad keeps all four.
        UISupportedInterfaceOrientations: ['UIInterfaceOrientationPortrait'],
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
    // No OTA in 1.0: EAS Update sends a per-install client id to u.expo.dev on every launch, a third
    // party the privacy page doesn't name (Kids 1.3). The studio is hosted, so only shell changes need
    // a build. decisions.md 2026-11-04.
    updates: { enabled: false, checkAutomatically: 'NEVER' },
    runtimeVersion: { policy: 'appVersion' },
    plugins: [
      'expo-iap',
      'expo-updates',
      // Keychain only, never biometrics: no NSFaceIDUsageDescription.
      ['expo-secure-store', { faceIDPermission: false }],
      // Stays up until the studio's `ready` (StudioWebView has a 20 s backstop).
      ['expo-splash-screen', { image: './assets/splash.png', backgroundColor: SPLASH_PAPER, imageWidth: 220 }],
      'expo-dev-client',
      // Add-only Photos access for saving exported videos; the app never asks for the full-library read
      // permission. NSPhotoLibraryUsageDescription still has to exist: expo-media-library links the full
      // photo-library API, and App Store Connect rejects a build without the key (ITMS-90683, build 1).
      [
        'expo-media-library',
        {
          photosPermission: PHOTOS_ADD_USAGE,
          savePhotosPermission: PHOTOS_ADD_USAGE,
          granularPermissions: ['video'],
        },
      ],
      // Audio session control only; the WebView records, so no background audio modes.
      [
        'expo-audio',
        {
          microphonePermission: MIC_USAGE,
          enableBackgroundPlayback: false,
          enableBackgroundRecording: false,
        },
      ],
      'expo-web-browser',
      'expo-localization',
      'expo-system-ui',
      [
        'expo-speech-recognition',
        { speechRecognitionPermission: SPEECH_USAGE, microphonePermission: MIC_USAGE },
      ],
    ],
    extra: { eas: { projectId: EAS_PROJECT_ID } },
  })

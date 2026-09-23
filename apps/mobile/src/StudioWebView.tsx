import * as Application from 'expo-application'
import * as Network from 'expo-network'
import * as SplashScreen from 'expo-splash-screen'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Linking, Platform, View } from 'react-native'
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { SHELL_INSET_VARS } from '../../../packages/shared/src/bridge'
import { createHandlers } from './bridge/handlers'
import { openExternal } from './bridge/handlers/share'
import { BridgeHost, type HostContext } from './bridge/host'
import { isStudioUrl } from './links'
import { localSource, remoteSource, type StudioSource } from './studio-source'

const PAPER = '#fbf6ea'
// If the remote studio has not loaded in this long, give up and show the bundled copy.
const REMOTE_LOAD_TIMEOUT_MS = 12_000
// The splash normally hides on the `ready` bridge message (studio's first paint); this is the
// backstop if it never arrives. Past this the paper background shows while the page finishes.
const SPLASH_BACKSTOP_MS = 3_000

interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

function roundInsets(i: EdgeInsets): Insets {
  return { top: Math.round(i.top), right: Math.round(i.right), bottom: Math.round(i.bottom), left: Math.round(i.left) }
}

/**
 * Writes the native safe-area insets as `--shell-inset-*` px vars on <html> (a backstop for
 * env(safe-area-inset-*) reading 0 in the WebView) and mirrors them on window.__onceuponShell.
 * Works at document start (waits for <html>) and when injected later on rotation.
 */
function insetsScript(i: Insets): string {
  const json = JSON.stringify(i)
  const vars = JSON.stringify(SHELL_INSET_VARS)
  return `(function(){var i=${json},v=${vars};var set=function(){var e=document.documentElement;if(!e)return false;for(var k in v){e.style.setProperty(v[k],i[k]+'px');}return true;};if(!set()){document.addEventListener('readystatechange',set,{once:true});}if(window.__onceuponShell){window.__onceuponShell.insets=i;}})();`
}

function currentPlatform(): 'ios' | 'android' {
  return Platform.OS === 'android' ? 'android' : 'ios'
}

export function StudioWebView({ initialSource }: { initialSource: StudioSource }) {
  const [source, setSource] = useState<StudioSource>(initialSource)
  const sourceRef = useRef<StudioSource>(initialSource)
  const onlineRef = useRef<boolean>(initialSource.kind === 'remote')
  const webRef = useRef<WebView>(null)
  const fellBackRef = useRef(false)
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const insets = roundInsets(useSafeAreaInsets())
  const insetsRef = useRef<Insets>(insets)
  insetsRef.current = insets

  useEffect(() => {
    sourceRef.current = source
  }, [source])

  const host = useMemo(() => {
    const ctx: HostContext = {
      platform: currentPlatform(),
      getSource: () => sourceRef.current.kind,
      getOnline: () => onlineRef.current,
    }
    return new BridgeHost(
      (js) => {
        webRef.current?.injectJavaScript(js)
      },
      createHandlers(),
      ctx
    )
  }, [])

  const fallbackToLocal = useCallback(() => {
    if (fellBackRef.current) return
    if (sourceRef.current.kind !== 'remote') return
    fellBackRef.current = true
    localSource()
      .then(setSource)
      .catch(() => {
        // Nothing else to fall back to; the remote view stays with whatever it managed to render.
      })
  }, [])

  const armLoadTimeout = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current)
    if (sourceRef.current.kind !== 'remote') return
    loadTimer.current = setTimeout(fallbackToLocal, REMOTE_LOAD_TIMEOUT_MS)
  }, [fallbackToLocal])

  const clearLoadTimeout = useCallback(() => {
    if (loadTimer.current) {
      clearTimeout(loadTimer.current)
      loadTimer.current = null
    }
  }, [])

  // Offline at launch: swap to the bundled copy. Runs in parallel with the first remote load instead
  // of gating the first render on it (the load error path also falls back).
  useEffect(() => {
    Network.getNetworkStateAsync()
      .then((state) => {
        if (state.isInternetReachable === false) {
          onlineRef.current = false
          fallbackToLocal()
        }
      })
      .catch(() => undefined)
  }, [fallbackToLocal])

  // Safe-area insets: push on change (rotation) as CSS vars and as an `insets` bridge event.
  const pushInsets = useCallback(() => {
    const i = insetsRef.current
    webRef.current?.injectJavaScript(`${insetsScript(i)}true;`)
    host.emit('insets', i)
  }, [host])
  useEffect(() => {
    pushInsets()
  }, [insets.top, insets.right, insets.bottom, insets.left, pushInsets])

  // Backstop so the splash never sticks even if the studio never sends `ready`.
  useEffect(() => {
    const timer = setTimeout(() => {
      void SplashScreen.hideAsync()
    }, SPLASH_BACKSTOP_MS)
    return () => clearTimeout(timer)
  }, [])

  // Foreground/background events for the studio (pause the mic, refresh the meter, etc.).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') host.emit('foreground', {})
      else if (state === 'background') host.emit('background', {})
    })
    return () => sub.remove()
  }, [host])

  // Network transitions: tell the studio, and when connectivity returns to a local session, reload
  // the hosted studio so the child gets the latest build.
  useEffect(() => {
    const sub = Network.addNetworkStateListener((state) => {
      const online = state.isInternetReachable !== false
      onlineRef.current = online
      host.emit('net', { online })
      if (online && sourceRef.current.kind === 'local') {
        fellBackRef.current = false
        setSource(remoteSource())
      }
    })
    return () => sub.remove()
  }, [host])

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      host.handle(event.nativeEvent.data)
    },
    [host]
  )

  // react-native-webview doesn't re-export ShouldStartLoadRequest from its root; we only need `url`.
  // Only the studio itself loads in the WebView. Everything else, including the rest of BRAND.origin
  // (web shop, privacy, terms, support), opens in an in-app Safari sheet, or the system for
  // mailto:/App Store links, so the child's WebView never turns into a website with no way back.
  const onShouldStartLoad = useCallback((request: { url: string }): boolean => {
    const url = request.url
    if (isStudioUrl(url)) return true
    if (url.startsWith('blob:') || url.startsWith('data:')) return false
    void openExternal(url).catch(() => {
      void Linking.openURL(url).catch(() => undefined)
    })
    return false
  }, [])

  const onLoadEnd = useCallback(() => {
    clearLoadTimeout()
    pushInsets()
  }, [clearLoadTimeout, pushInsets])

  const injectedBefore = useMemo(() => {
    const shell = {
      platform: currentPlatform(),
      appVersion: Application.nativeApplicationVersion ?? '0',
      source: source.kind,
    }
    // Read the insets once per source; later changes are pushed by pushInsets.
    return `window.__onceuponShell = ${JSON.stringify(shell)};${insetsScript(insetsRef.current)}true;`
  }, [source.kind])

  return (
    <View style={{ flex: 1, backgroundColor: PAPER }}>
      <WebView
        ref={webRef}
        source={{ uri: source.uri }}
        originWhitelist={['https://*', 'file://*', 'about:*']}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        allowsBackForwardNavigationGestures={false}
        bounces={false}
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        dataDetectorTypes="none"
        // Safari Web Inspector on device builds too: this is the last native build, and the WebView
        // is where every field bug will live. Exposes nothing a user could reach.
        webviewDebuggingEnabled
        contentInsetAdjustmentBehavior="never"
        allowFileAccess
        allowFileAccessFromFileURLs
        allowingReadAccessToURL={source.kind === 'local' ? source.readAccess : undefined}
        injectedJavaScriptBeforeContentLoaded={injectedBefore}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoad}
        onLoadStart={armLoadTimeout}
        onLoadEnd={onLoadEnd}
        onError={fallbackToLocal}
        onHttpError={fallbackToLocal}
        style={{ flex: 1, backgroundColor: PAPER }}
      />
    </View>
  )
}

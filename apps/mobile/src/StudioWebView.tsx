import * as Application from 'expo-application'
import * as Network from 'expo-network'
import * as SplashScreen from 'expo-splash-screen'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Linking, Platform, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { BRAND } from '../../../packages/shared/src/brand'
import { createHandlers } from './bridge/handlers'
import { BridgeHost, type HostContext } from './bridge/host'
import { localSource, remoteSource, type StudioSource } from './studio-source'

const PAPER = '#fbf6ea'
// If the remote studio has not loaded in this long, give up and show the bundled copy.
const REMOTE_LOAD_TIMEOUT_MS = 12_000
// The splash normally hides on the `ready` bridge message; this is the backstop if it never arrives.
const SPLASH_BACKSTOP_MS = 10_000

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
  const onShouldStartLoad = useCallback((request: { url: string }): boolean => {
    const url = request.url
    if (url.startsWith('about:') || url.startsWith('file://') || url.startsWith(BRAND.origin)) return true
    // Anything else (privacy policy, web checkout, App Store links) opens in the system browser.
    void Linking.openURL(url).catch(() => undefined)
    return false
  }, [])

  const injectedBefore = useMemo(() => {
    const shell = {
      platform: currentPlatform(),
      appVersion: Application.nativeApplicationVersion ?? '0',
      source: source.kind,
    }
    return `window.__onceuponShell = ${JSON.stringify(shell)}; true;`
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
        contentInsetAdjustmentBehavior="never"
        allowFileAccess
        allowFileAccessFromFileURLs
        allowingReadAccessToURL={source.kind === 'local' ? source.readAccess : undefined}
        injectedJavaScriptBeforeContentLoaded={injectedBefore}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoad}
        onLoadStart={armLoadTimeout}
        onLoadEnd={clearLoadTimeout}
        onError={fallbackToLocal}
        onHttpError={fallbackToLocal}
        style={{ flex: 1, backgroundColor: PAPER }}
      />
    </View>
  )
}

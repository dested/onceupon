import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { StudioWebView } from './StudioWebView'
import { pickStudioSource, remoteSource, type StudioSource } from './studio-source'

const PAPER = '#fbf6ea'

// Hold the splash until we know which studio source to load; the studio hides it via the `ready`
// bridge message once it has painted.
void SplashScreen.preventAutoHideAsync()

export default function App() {
  const [source, setSource] = useState<StudioSource | null>(null)

  useEffect(() => {
    let active = true
    pickStudioSource()
      .then((picked) => {
        if (active) setSource(picked)
      })
      .catch(() => {
        // Even if the probe throws, try the hosted studio; the WebView falls back to local on error.
        if (active) setSource(remoteSource())
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <View style={{ flex: 1, backgroundColor: PAPER }}>
      <StatusBar hidden />
      {source ? <StudioWebView initialSource={source} /> : null}
    </View>
  )
}

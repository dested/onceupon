import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import * as SystemUI from 'expo-system-ui'
import { useState } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { applyAudioMode } from './bridge/handlers/audio'
import { StudioWebView } from './StudioWebView'
import { remoteSource, type StudioSource } from './studio-source'

const PAPER = '#fbf6ea'

// The studio hides the splash via the `ready` bridge message once it has painted (StudioWebView has
// a short backstop).
void SplashScreen.preventAutoHideAsync()
// Root view paper so rotation and the keyboard never flash white behind the WebView.
void SystemUI.setBackgroundColorAsync(PAPER).catch(() => undefined)
// Story sounds play with the silent switch on; WebKit takes over the session while the mic is live.
void applyAudioMode(true).catch(() => undefined)

export default function App() {
  // No network probe before the first render: the hosted studio starts loading immediately and
  // StudioWebView swaps to the bundled copy if the probe (run in parallel) says we are offline or the
  // load errors out.
  const [source] = useState<StudioSource>(remoteSource)

  return (
    <SafeAreaProvider style={{ backgroundColor: PAPER }}>
      <View style={{ flex: 1, backgroundColor: PAPER }}>
        <StatusBar hidden />
        <StudioWebView initialSource={source} />
      </View>
    </SafeAreaProvider>
  )
}

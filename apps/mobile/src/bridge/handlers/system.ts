import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { Linking } from 'react-native'
import { z } from 'zod'
import { parseInput, type Handler } from '../host'

// Small OS switches the studio flips: keep-awake and this app's page in iOS Settings.

const AWAKE_TAG = 'squiggletale-studio'
const awakeSchema = z.object({ on: z.boolean() })
export const awakeSet: Handler<'awake.set'> = async (input) => {
  const { on } = parseInput(awakeSchema, input)
  if (on) await activateKeepAwakeAsync(AWAKE_TAG)
  else await deactivateKeepAwake(AWAKE_TAG)
  return {}
}

/** The studio calls it behind the parental gate when the mic or speech permission is off. */
export const settingsOpen: Handler<'settings.open'> = async () => {
  await Linking.openSettings()
  return {}
}

import { Directory, File, Paths } from 'expo-file-system'
import * as Haptics from 'expo-haptics'
import * as Linking from 'expo-linking'
import * as Sharing from 'expo-sharing'
import { Share } from 'react-native'
import { z } from 'zod'
import { BridgeHostError, parseInput, type Handler } from '../host'

function safeName(name: string): string {
  if (name.length === 0 || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new BridgeHostError('bad_request', `illegal filename: ${name}`)
  }
  return name
}

function utiFor(mime: string): string | undefined {
  if (mime === 'video/mp4') return 'public.mpeg-4'
  return undefined
}

const shareUrlSchema = z.object({ url: z.string(), title: z.string() })
export const shareUrl: Handler<'share.url'> = async (input) => {
  const { url, title } = parseInput(shareUrlSchema, input)
  const result = await Share.share({ url, title, message: title })
  return { completed: result.action === Share.sharedAction }
}

const shareFileSchema = z.object({ base64: z.string(), mime: z.string(), filename: z.string() })
export const shareFile: Handler<'share.file'> = async (input) => {
  const { base64, mime, filename } = parseInput(shareFileSchema, input)
  const dir = new Directory(Paths.cache, 'share')
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  const file = new File(dir, safeName(filename))
  file.create({ intermediates: true, overwrite: true })
  file.write(base64, { encoding: 'base64' })
  if (!(await Sharing.isAvailableAsync())) throw new BridgeHostError('unsupported', 'sharing is not available')
  // Sharing.shareAsync resolves once the sheet is dismissed and does not report the chosen action.
  await Sharing.shareAsync(file.uri, { mimeType: mime, UTI: utiFor(mime), dialogTitle: filename })
  return { completed: true }
}

const openUrlSchema = z.object({ url: z.string() })
export const openUrl: Handler<'open.url'> = async (input) => {
  const { url } = parseInput(openUrlSchema, input)
  await Linking.openURL(url)
  return {}
}

const hapticSchema = z.object({ kind: z.enum(['light', 'success', 'warning']) })
export const haptic: Handler<'haptic'> = async (input) => {
  const { kind } = parseInput(hapticSchema, input)
  if (kind === 'light') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  else if (kind === 'success') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  else await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
  return {}
}

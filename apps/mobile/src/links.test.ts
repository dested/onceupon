import { expect, test } from 'bun:test'
import { isStudioUrl } from './links'

test('only the studio itself stays in the WebView', () => {
  expect(isStudioUrl('https://onceupon.dested.com/app/?shell=native&v=1.0.0')).toBe(true)
  expect(isStudioUrl('https://onceupon.dested.com/app?shell=native')).toBe(true)
  expect(isStudioUrl('file:///var/mobile/studio.html?shell=native')).toBe(true)
  expect(isStudioUrl('about:blank')).toBe(true)
  expect(isStudioUrl('https://onceupon.dested.com/shop?d=abc&pack=small')).toBe(false)
  expect(isStudioUrl('https://onceupon.dested.com/privacy')).toBe(false)
  expect(isStudioUrl('https://onceupon.dested.com/apple')).toBe(false)
  expect(isStudioUrl('https://onceupon.dested.com.evil.test/app/')).toBe(false)
  expect(isStudioUrl('https://example.com/app/')).toBe(false)
  expect(isStudioUrl('mailto:sal@quickga.me')).toBe(false)
})

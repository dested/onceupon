import { useState } from 'react'
import { appStore, persistSettings, useApp } from '~/story/store'
import { PaperCard, StickerButton } from './bits'

/**
 * Bring-your-own-key gate. This app draws with the visitor's own AI keys, straight from their
 * browser (nothing is baked into the build, nobody pays for anyone else). If the Anthropic key
 * is missing we block until it is entered; the OpenAI key (better voice) is optional and can be
 * skipped. Once satisfied or skipped it stays out of the way for the session.
 */
export function KeyGate() {
  const keys = useApp((s) => s.settings.keys)
  const dismissed = useApp((s) => s.keyGateDismissed)
  const hosted = useApp((s) => s.hosted)

  const [anthropic, setAnthropic] = useState(keys.anthropic)
  const [openai, setOpenai] = useState(keys.openai)

  // Hosted mode draws with the server relay, so there is no key to bring.
  if (hosted) return null
  const needed = (!keys.anthropic || !keys.openai) && !dismissed
  if (needed === false) return null

  const field = 'w-full rounded-xl border-[3px] border-ink bg-white px-3 py-2 font-hand text-lg text-ink outline-none'
  const label = 'mb-1 block font-hand text-lg text-ink-soft'

  const save = (): void => {
    appStore.set((s) => {
      const settings = { ...s.settings, keys: { ...s.settings.keys, anthropic: anthropic.trim(), openai: openai.trim() } }
      persistSettings(settings)
      return { settings, keyGateDismissed: true }
    })
  }
  const skipVoice = (): void => {
    // Anthropic already set; keep whatever is typed and stop nagging about the OpenAI key.
    appStore.set((s) => {
      const settings = { ...s.settings, keys: { ...s.settings.keys, anthropic: anthropic.trim() || s.settings.keys.anthropic } }
      persistSettings(settings)
      return { settings, keyGateDismissed: true }
    })
  }

  const canStart = anthropic.trim().length > 0

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-ink/40">
      <PaperCard className="relative w-[34rem] max-w-[92vw]">
        <h2 className="mb-2 font-scrawl text-3xl">Bring your own crayons</h2>
        <p className="mb-5 font-hand text-lg text-ink-soft">
          Squiggletale draws with your own AI keys, straight from this browser. They stay on this device, nobody else
          sees them, and you only ever pay for your own drawing
        </p>

        <div className="mb-4">
          <label className={label} htmlFor="gate-anthropic">
            Anthropic key — draws the picture (required)
          </label>
          <input
            id="gate-anthropic"
            type="password"
            value={anthropic}
            placeholder="sk-ant-..."
            className={field}
            autoFocus
            onChange={(e) => setAnthropic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canStart) save()
            }}
          />
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block font-hand text-base text-crayon-blue underline">
            get an Anthropic key
          </a>
        </div>

        <div className="mb-6">
          <label className={label} htmlFor="gate-openai">
            OpenAI key — best voice (optional)
          </label>
          <input
            id="gate-openai"
            type="password"
            value={openai}
            placeholder="sk-..."
            className={field}
            onChange={(e) => setOpenai(e.target.value)}
          />
          <p className="mt-1 font-hand text-base text-ink-soft">
            Without it the app listens with Chrome's built-in voice (Chrome or Edge only, rougher with little kids)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <StickerButton tone="green" tilt={-1} onClick={save} disabled={canStart === false}>
            Start drawing
          </StickerButton>
          {keys.anthropic ? (
            <StickerButton tone="paper" tilt={1} onClick={skipVoice}>
              Skip voice for now
            </StickerButton>
          ) : null}
        </div>
      </PaperCard>
    </div>
  )
}

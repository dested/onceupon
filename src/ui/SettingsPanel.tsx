import { useEffect, useState } from 'react'
import { listMics } from '~/speech/openai-realtime'
import { X } from 'lucide-react'
import { MODEL_OPTIONS, PROVIDERS, isProvider, type Provider } from '~/llm/models'
import { appStore, persistSettings, STT_MODES, useApp, type Settings, type SttMode } from '~/story/store'
import { PaperCard, StickerButton } from './bits'

function update(patch: (s: Settings) => Settings): void {
  appStore.set((s) => {
    const settings = patch(s.settings)
    persistSettings(settings)
    return { settings }
  })
}

const isSttMode = (v: string): v is SttMode => (STT_MODES as readonly string[]).includes(v)

const STT_LABELS: Record<SttMode, string> = {
  auto: 'auto (OpenAI if a key is set, else Chrome)',
  browser: 'Chrome built-in (free, rough)',
  openai: 'OpenAI Realtime (needs OpenAI key)',
}

export function SettingsPanel() {
  const [mics, setMics] = useState<{ id: string; label: string }[]>([])
  useEffect(() => {
    void listMics().then(setMics)
  }, [])
  const settings = useApp((s) => s.settings)
  const close = (): void => appStore.set({ settingsOpen: false })
  const field = 'w-full rounded-xl border-[3px] border-ink bg-white px-3 py-2 font-hand text-lg text-ink outline-none'
  const label = 'mb-1 block font-hand text-lg text-ink-soft'

  return (
    <div className="absolute inset-0 grid place-items-center bg-ink/30" onClick={close}>
      <PaperCard className="relative max-h-[92vh] w-[36rem] max-w-[92vw] overflow-y-auto">
        <div onClick={(e) => e.stopPropagation()}>
          <button onClick={close} aria-label="Close" className="absolute top-4 right-4 text-ink">
            <X size={26} strokeWidth={3} />
          </button>
          <h2 className="mb-4 font-scrawl text-3xl">Settings</h2>

          <h3 className="mb-2 font-hand text-xl">Drawing brain</h3>
          <div className="mb-3 grid grid-cols-[8rem_1fr] gap-3">
            <div>
              <label className={label} htmlFor="provider">
                Provider
              </label>
              <select
                id="provider"
                value={settings.provider}
                className={field}
                onChange={(e) => {
                  const v = e.target.value
                  if (!isProvider(v)) return
                  const first = MODEL_OPTIONS.find((m) => m.provider === v)
                  update((s) => ({ ...s, provider: v, model: first ? first.id : s.model }))
                }}>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="model">
                Model
              </label>
              <input
                id="model"
                list="model-presets"
                value={settings.model}
                className={field}
                onChange={(e) => update((s) => ({ ...s, model: e.target.value }))}
              />
              <datalist id="model-presets">
                {MODEL_OPTIONS.filter((m) => m.provider === settings.provider).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} - {m.hint}
                  </option>
                ))}
              </datalist>
            </div>
          </div>
          <div className="mb-5 flex flex-wrap gap-2">
            {MODEL_OPTIONS.map((m) => (
              <StickerButton
                key={`${m.provider}/${m.id}`}
                tilt={0}
                tone={m.id === settings.model && m.provider === settings.provider ? 'yellow' : 'paper'}
                className="!px-3 !py-1 !text-base"
                onClick={() => update((s) => ({ ...s, provider: m.provider, model: m.id }))}>
                {m.label}
              </StickerButton>
            ))}
          </div>

          <h3 className="mb-2 font-hand text-xl">Ears</h3>
          <div className="mb-5 grid grid-cols-[1fr_11rem] gap-3">
            <div>
              <label className={label} htmlFor="stt">
                Speech to text
              </label>
              <select
                id="stt"
                value={settings.stt}
                className={field}
                onChange={(e) => {
                  const v = e.target.value
                  if (isSttMode(v)) update((s) => ({ ...s, stt: v }))
                }}>
                {STT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {STT_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="sttModel">
                OpenAI STT model
              </label>
              <input
                id="sttModel"
                list="stt-presets"
                value={settings.sttModel}
                className={field}
                onChange={(e) => update((s) => ({ ...s, sttModel: e.target.value }))}
              />
              <datalist id="stt-presets">
                <option value="gpt-live-transcribe">live, word by word (best)</option>
                <option value="gpt-transcribe">phrase at a time</option>
                <option value="gpt-4o-transcribe">older, phrase at a time</option>
              </datalist>
            </div>
          </div>

          <div className="mb-5">
            <label className={label} htmlFor="mic">
              Microphone (OpenAI ears; Chrome's recognizer always uses the default)
            </label>
            <select
              id="mic"
              value={settings.micDeviceId}
              className={field}
              onChange={(e) => update((s) => ({ ...s, micDeviceId: e.target.value }))}>
              <option value="">system default</option>
              {mics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-5">
            <label className={label} htmlFor="sttRate">
              Transcription price, $ per minute of audio (estimate shown on the chip)
            </label>
            <input
              id="sttRate"
              type="number"
              step="0.001"
              min="0"
              value={settings.sttRatePerMin}
              className={field}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v) && v >= 0) update((s) => ({ ...s, sttRatePerMin: v }))
              }}
            />
          </div>

          <h3 className="mb-2 font-hand text-xl">Keys</h3>
          <div className="grid gap-3">
            {(['anthropic', 'openrouter', 'openai'] as const satisfies readonly Provider[]).map((p) => (
              <div key={p}>
                <label className={label} htmlFor={`key-${p}`}>
                  {p} {settings.keys[p] ? '(set)' : '(missing)'}
                </label>
                <input
                  id={`key-${p}`}
                  type="password"
                  value={settings.keys[p]}
                  placeholder="paste a key, stays in this browser only"
                  className={field}
                  onChange={(e) => update((s) => ({ ...s, keys: { ...s.keys, [p]: e.target.value } }))}
                />
              </div>
            ))}
          </div>

          <p className="mt-4 font-hand text-base text-ink-soft">
            Keys are used straight from the browser. Localhost only. Press the backtick key for the debug panel.
          </p>
        </div>
      </PaperCard>
    </div>
  )
}

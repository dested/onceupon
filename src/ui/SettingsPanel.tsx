import { DIALECT_IDS, DIALECT_LABELS, isDialectId } from '~/llm/dialect'
import { useEffect, useState } from 'react'
import { listMics } from '~/speech/pcm-mic'
import { setModeration } from '~/story/clean'
import { X } from 'lucide-react'
import { MODEL_OPTIONS, PROVIDERS, isProvider, type Provider } from '~/llm/models'
import {
  appStore,
  effectiveSttRate,
  persistSettings,
  resolveStt,
  STT_MODES,
  useApp,
  type Settings,
  type SttMode,
} from '~/story/store'
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
  auto: 'auto (OpenAI key → OpenAI, else Deepgram key → Deepgram, else Chrome)',
  browser: 'Chrome built-in (free, rough)',
  openai: 'OpenAI Realtime (needs OpenAI key)',
  deepgram: 'Deepgram streaming (needs Deepgram key)',
}

export function SettingsPanel() {
  const [mics, setMics] = useState<{ id: string; label: string }[]>([])
  useEffect(() => {
    void listMics().then(setMics)
  }, [])
  const settings = useApp((s) => s.settings)
  const resolved = resolveStt(settings)
  const close = (): void => appStore.set({ settingsOpen: false })
  const field =
    'w-full rounded-xl border-[3px] border-ink bg-white px-3 py-2 font-hand text-lg text-ink outline-none'
  const label = 'mb-1 block font-hand text-lg text-ink-soft'

  return (
    <div className="bg-ink/30 absolute inset-0 grid place-items-center" onClick={close}>
      <PaperCard className="relative max-h-[92vh] w-[36rem] max-w-[92vw] overflow-y-auto">
        <div onClick={(e) => e.stopPropagation()}>
          <button onClick={close} aria-label="Close" className="text-ink absolute top-4 right-4">
            <X size={26} strokeWidth={3} />
          </button>
          <h2 className="font-scrawl mb-4 text-3xl">Settings</h2>

          <h3 className="font-hand mb-2 text-xl">Drawing brain</h3>
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
                tone={
                  m.id === settings.model && m.provider === settings.provider ? 'yellow' : 'paper'
                }
                className="!px-3 !py-1 !text-base"
                onClick={() => update((s) => ({ ...s, provider: m.provider, model: m.id }))}>
                {m.label}
              </StickerButton>
            ))}
          </div>

          <label className="font-hand mb-5 flex items-center gap-3 text-lg" htmlFor="moderation">
            <input
              id="moderation"
              type="checkbox"
              className="accent-crayon-red h-5 w-5"
              checked={settings.moderation}
              onChange={(e) => {
                setModeration(e.target.checked)
                update((s) => ({ ...s, moderation: e.target.checked }))
              }}
            />
            Kid-safe moderation (skip not-for-kids beats, mask rude words). Prompt change applies to
            the next new story.
          </label>

          <div className="mb-5">
            <label className={label} htmlFor="dialect">
              Drawing language (applies to the next new story)
            </label>
            <select
              id="dialect"
              value={settings.dialect}
              className={field}
              onChange={(e) => {
                const v = e.target.value
                if (isDialectId(v)) update((s) => ({ ...s, dialect: v }))
              }}>
              {DIALECT_IDS.map((d) => (
                <option key={d} value={d}>
                  {DIALECT_LABELS[d]}
                </option>
              ))}
            </select>
          </div>

          <h3 className="font-hand mb-2 text-xl">Ears</h3>
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
              {resolved === 'openai' ? (
                <>
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
                </>
              ) : resolved === 'deepgram' ? (
                <>
                  <label className={label} htmlFor="deepgramModel">
                    Deepgram model
                  </label>
                  <input
                    id="deepgramModel"
                    list="deepgram-presets"
                    value={settings.deepgramModel}
                    className={field}
                    onChange={(e) => update((s) => ({ ...s, deepgramModel: e.target.value }))}
                  />
                  <datalist id="deepgram-presets">
                    <option value="nova-3">Nova-3 streaming</option>
                  </datalist>
                </>
              ) : null}
            </div>
          </div>

          <div className="mb-5">
            <label className={label} htmlFor="mic">
              Microphone (OpenAI or Deepgram ears; Chrome's recognizer always uses the default)
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
              Transcription price, $ per minute of audio (vendor default unless you change it)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="sttRate"
                type="number"
                step="0.001"
                min="0"
                value={effectiveSttRate(settings)}
                className={field}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v) && v >= 0) update((s) => ({ ...s, sttRateOverride: v }))
                }}
              />
              <StickerButton
                tone="paper"
                tilt={0}
                className="!px-3 !py-2 !text-base"
                onClick={() => update((s) => ({ ...s, sttRateOverride: null }))}>
                reset
              </StickerButton>
            </div>
          </div>

          <h3 className="font-hand mb-2 text-xl">Keys</h3>
          <div className="grid gap-3">
            {(['anthropic', 'openrouter', 'openai'] as const satisfies readonly Provider[]).map(
              (p) => (
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
                    onChange={(e) =>
                      update((s) => ({ ...s, keys: { ...s.keys, [p]: e.target.value } }))
                    }
                  />
                </div>
              )
            )}
            <div>
              <label className={label} htmlFor="key-deepgram">
                deepgram {settings.keys.deepgram ? '(set)' : '(missing)'}
              </label>
              <input
                id="key-deepgram"
                type="password"
                value={settings.keys.deepgram}
                placeholder="paste a key, stays in this browser only"
                className={field}
                onChange={(e) =>
                  update((s) => ({ ...s, keys: { ...s.keys, deepgram: e.target.value } }))
                }
              />
            </div>
          </div>

          <p className="font-hand text-ink-soft mt-4 text-base">
            Keys are used straight from your browser and stay on this device only. Press the
            backtick key for the debug panel.
          </p>
        </div>
      </PaperCard>
    </div>
  )
}

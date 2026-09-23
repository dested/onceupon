import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { PageHeader } from './layout'
import { AsyncBlock, Section } from './parts'
import { FIELD, StickerButton } from '~/components/paper'

// Kill switches get the red card; other keys render as ordinary rows. Labels/enums are best-effort
// niceties keyed by the flag name — unknown keys still render with a humanised label and a
// type-inferred control, so the page works whatever the flag set turns out to be.
const KILL_SWITCHES = new Set(['purchasesPaused', 'relayPaused', 'readOnly'])
const ENUMS: Record<string, string[]> = {
  earsVendor: ['deepgram', 'openai'],
  dialect: ['ops', 'json', 'lines'],
}

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\bSec\b/g, '(seconds)')
    .replace(/^./, (c) => c.toUpperCase())
}

export function SettingsPage() {
  const trpc = useTRPC()
  const query = useQuery(trpc.admin.flags.get.queryOptions())

  return (
    <>
      <PageHeader title="Settings" />
      <AsyncBlock query={query}>
        {(flags) => {
          const entries = Object.entries(flags as Record<string, unknown>)
          const kill = entries.filter(([k]) => KILL_SWITCHES.has(k))
          const normal = entries.filter(([k]) => !KILL_SWITCHES.has(k))
          return (
            <>
              {kill.length > 0 && (
                <Section title="Kill switches">
                  <div className="rounded-2xl border-[3px] border-crayon-red bg-paper p-4 shadow-[3px_4px_0_0_rgba(239,68,68,0.3)]">
                    <div className="grid gap-3 md:grid-cols-3">
                      {kill.map(([k, v]) => (
                        <FlagRow key={k} flagKey={k} value={v} />
                      ))}
                    </div>
                  </div>
                </Section>
              )}
              <Section title="Feature flags">
                <div className="grid gap-3 md:grid-cols-2">
                  {normal.map(([k, v]) => (
                    <FlagRow key={k} flagKey={k} value={v} />
                  ))}
                </div>
              </Section>
              <p className="font-hand text-sm text-ink-soft">Every change is logged to the audit trail with who and when.</p>
            </>
          )
        }}
      </AsyncBlock>
    </>
  )
}

function FlagRow({ flagKey, value }: { flagKey: string; value: unknown }) {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const [saved, setSaved] = useState(false)
  const save = useMutation(
    trpc.admin.flags.set.mutationOptions({
      onSuccess: () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
        qc.invalidateQueries({ queryKey: trpc.admin.flags.get.queryKey() })
      },
    })
  )

  const label = humanize(flagKey)

  // Booleans save immediately on toggle.
  if (typeof value === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border-[3px] border-ink bg-paper px-3 py-2">
        <span className="font-hand text-base text-ink">{label}</span>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ key: flagKey, value: !value })}
          className={`rounded-full border-[3px] border-ink px-3 py-1 font-hand text-base leading-none shadow-[2px_3px_0_0_rgba(59,47,47,0.28)] ${
            value ? 'bg-crayon-green text-white' : 'bg-paper-deep text-ink-soft'
          }`}>
          {value ? 'On' : 'Off'}
        </button>
      </div>
    )
  }

  const enumOptions = ENUMS[flagKey]
  return (
    <div className="rounded-xl border-[3px] border-ink bg-paper px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-hand text-base text-ink">{label}</span>
        {saved && <span className="font-hand text-sm text-crayon-green">saved ✓</span>}
        {save.isError && <span className="font-hand text-sm text-crayon-red">failed</span>}
      </div>
      <FlagEditor
        value={value}
        enumOptions={enumOptions}
        pending={save.isPending}
        onSave={(next) => save.mutate({ key: flagKey, value: next })}
      />
    </div>
  )
}

function FlagEditor({
  value,
  enumOptions,
  pending,
  onSave,
}: {
  value: unknown
  enumOptions?: string[]
  pending: boolean
  onSave: (next: unknown) => void
}) {
  const isNumber = typeof value === 'number'
  const isString = typeof value === 'string'
  const initial = isNumber || isString ? String(value) : JSON.stringify(value, null, 2)
  const [draft, setDraft] = useState(initial)
  const dirty = draft !== initial

  function commit() {
    if (isNumber) {
      const n = Number(draft)
      if (Number.isFinite(n)) onSave(n)
      return
    }
    if (isString) {
      onSave(draft)
      return
    }
    // object / array: parse JSON
    try {
      onSave(JSON.parse(draft))
    } catch {
      // leave as-is; the failed tick will not show, but an invalid value cannot be sent
    }
  }

  if (enumOptions && isString) {
    return (
      <select
        className={FIELD}
        value={draft}
        disabled={pending}
        onChange={(e) => {
          setDraft(e.target.value)
          onSave(e.target.value)
        }}>
        {enumOptions.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }

  const multiline = !isNumber && !isString
  return (
    <div className="flex items-start gap-2">
      {multiline ? (
        <textarea
          className={`${FIELD} min-h-24 font-mono text-sm`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <input
          className={FIELD}
          type={isNumber ? 'number' : 'text'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      <StickerButton tone="green" tilt={-1} disabled={pending || !dirty} onClick={commit}>
        Save
      </StickerButton>
    </div>
  )
}

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type ToastTone = 'error' | 'ok'
export interface Toast {
  id: number
  text: string
  tone: ToastTone
}

interface ToastApi {
  push: (text: string, tone?: ToastTone) => void
}

const ToastCtx = createContext<ToastApi | null>(null)

/** Every fetch error in the lab lands here as a dismissable pill; no alert(). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (text: string, tone: ToastTone = 'error') => {
      const id = nextId.current++
      setToasts((list) => [...list, { id, text, tone }])
      window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 3500)
    },
    [dismiss]
  )

  const api = useMemo<ToastApi>(() => ({ push }), [push])

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed top-3 left-1/2 z-50 flex w-[min(40rem,90vw)] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`border-ink pointer-events-auto flex items-start justify-between gap-3 rounded-2xl border-[3px] px-4 py-2 text-lg shadow-[3px_4px_0_0_rgba(59,47,47,0.3)] ${
              t.tone === 'error' ? 'bg-crayon-red text-white' : 'bg-crayon-green text-white'
            }`}>
            <span className="min-w-0 break-words">{t.text}</span>
            <button
              className="shrink-0 rounded-full px-2 leading-none hover:opacity-80"
              aria-label="dismiss"
              onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastCtx)
  if (!api) throw new Error('useToast outside ToastProvider')
  return api
}

import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { PaperCard, Scrawl, StickerLink } from '~/components/paper'
import { Wordmark } from './site-parts'

// Root route ErrorBoundary. React Router renders this in place of the layout when a loader/render
// throws OR when no route matches (a 404). It carries its own slim crayon header so the page still
// looks intentional; the HTTP status is set server-side from routerContext.statusCode.
export function RouteErrorBoundary() {
  const error = useRouteError()
  const isNotFound = isRouteErrorResponse(error) && error.status === 404

  const title = isNotFound ? 'This page wandered off' : 'Something got scribbled'
  const message = isNotFound
    ? 'We looked everywhere on the desk and could not find it.'
    : isRouteErrorResponse(error)
      ? `${error.status} ${error.statusText}`
      : error instanceof Error
        ? error.message
        : 'An unexpected error occurred.'

  return (
    <div className="tabletop flex min-h-screen flex-col">
      <header className="mx-auto w-full max-w-6xl px-6 py-4">
        <Link to="/" className="text-ink">
          <Wordmark className="text-[28px]" />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
        <PaperCard tilt={-1.5} className="max-w-lg text-center">
          <Scrawl as="h1" className="text-5xl text-ink">
            {title}
          </Scrawl>
          <p className="mt-4 font-hand text-xl text-ink-soft">{message}</p>
          <div className="mt-6 flex justify-center">
            <StickerLink to="/" tone="yellow" tilt={-1}>
              Back to the start
            </StickerLink>
          </div>
        </PaperCard>
        {import.meta.env.DEV && error instanceof Error && error.stack ? (
          <pre className="max-w-full overflow-auto rounded-2xl border-[3px] border-ink bg-ink/85 p-4 font-mono text-xs text-paper">
            {error.stack}
          </pre>
        ) : null}
      </main>
    </div>
  )
}

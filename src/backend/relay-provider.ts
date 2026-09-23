import { appStore } from '~/story/store'
import { ApiError, drawStream } from './api'
import type { LlmChunk, LlmProvider, LlmRequest } from '~/llm/providers'

/**
 * The hosted LLM provider: instead of calling Anthropic from the browser, it streams the same drawing
 * prompt through the server relay (`/api/app/draw`), which meters and holds the API key. It reads the
 * live session id lazily so the same instance serves every story of a session (see session.ts).
 */
export class RelayProvider implements LlmProvider {
  readonly label = 'relay'

  constructor(private getSessionId: () => string | null) {}

  get model(): string {
    return appStore.get().config?.model ?? 'relay'
  }

  async *stream(req: LlmRequest): AsyncGenerator<LlmChunk, void, void> {
    const sessionId = this.getSessionId()
    if (!sessionId) throw new Error('no story session')
    for await (const c of drawStream(
      {
        sessionId,
        system: req.system,
        user: req.user.map((b) => ({ text: b.text, cache: b.cache })),
        maxTokens: req.maxTokens,
        dialect: appStore.get().settings.dialect,
        restart: false,
      },
      req.signal
    )) {
      if (c.k === 'text') {
        yield { k: 'text', text: c.text }
      } else if (c.k === 'usage') {
        yield {
          k: 'usage',
          usage: {
            input: c.usage.input,
            cacheRead: c.usage.cacheRead,
            cacheWrite: c.usage.cacheWrite,
            output: c.usage.output,
            costUsd: c.costUsd,
          },
        }
      } else {
        throw new ApiError(0, c.code, c.message)
      }
    }
  }
}

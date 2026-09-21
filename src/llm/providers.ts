import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { Provider, Usage } from './models'

export interface LlmRequest {
  system: string
  user: string
  maxTokens: number
  signal: AbortSignal
}

export type LlmChunk = { k: 'text'; text: string } | { k: 'usage'; usage: Usage }

export interface LlmProvider {
  readonly label: string
  readonly model: string
  stream(req: LlmRequest): AsyncGenerator<LlmChunk, void, void>
}

export interface ApiKeys {
  anthropic: string
  openrouter: string
  openai: string
}

class AnthropicProvider implements LlmProvider {
  readonly label: string
  private client: Anthropic
  constructor(
    readonly model: string,
    apiKey: string
  ) {
    this.label = `anthropic/${model}`
    // Browser-direct on purpose: this app is localhost-only with no server. Never deploy it like this.
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  }

  async *stream(req: LlmRequest): AsyncGenerator<LlmChunk, void, void> {
    // Sonnet 5 and Opus 5 run adaptive thinking by default; we want first tokens fast, so switch it off.
    const thinkingOff = /sonnet-5|opus-5|opus-4-8|opus-4-7|sonnet-4-6|opus-4-6/.test(this.model)
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: req.maxTokens,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.user }],
        ...(thinkingOff ? { thinking: { type: 'disabled' } } : {}),
      },
      { signal: req.signal }
    )
    const usage: Usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: null }
    for await (const event of stream) {
      if (event.type === 'message_start') {
        usage.input = event.message.usage.input_tokens
        usage.cacheRead = event.message.usage.cache_read_input_tokens ?? 0
        usage.cacheWrite = event.message.usage.cache_creation_input_tokens ?? 0
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { k: 'text', text: event.delta.text }
      } else if (event.type === 'message_delta') {
        usage.output = event.usage.output_tokens
        if (event.delta.stop_reason === 'refusal') throw new Error('model refused this passage')
      }
    }
    yield { k: 'usage', usage }
  }
}

const chunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z.object({ content: z.string().nullable().optional() }).optional(),
      })
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      cost: z.number().optional(),
      prompt_tokens_details: z.object({ cached_tokens: z.number().optional() }).nullable().optional(),
    })
    .nullable()
    .optional(),
  error: z.object({ message: z.string() }).optional(),
})

/** OpenRouter and OpenAI share the chat-completions SSE wire format. */
class OpenAiCompatProvider implements LlmProvider {
  readonly label: string
  constructor(
    private kind: 'openrouter' | 'openai',
    readonly model: string,
    private apiKey: string
  ) {
    this.label = `${kind}/${model}`
  }

  async *stream(req: LlmRequest): AsyncGenerator<LlmChunk, void, void> {
    const base = this.kind === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1'
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }
    if (this.kind === 'openrouter') {
      headers['HTTP-Referer'] = 'http://localhost:7710'
      headers['X-Title'] = 'Once Upon'
    }
    const body: Record<string, unknown> = {
      model: this.model,
      stream: true,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    }
    if (this.kind === 'openrouter') {
      body['max_tokens'] = req.maxTokens
      body['provider'] = { sort: 'throughput' }
      body['reasoning'] = { effort: 'low' }
      body['usage'] = { include: true }
    } else {
      body['max_completion_tokens'] = req.maxTokens
      body['stream_options'] = { include_usage: true }
      if (/^(gpt-5|o\d)/.test(this.model)) body['reasoning_effort'] = 'minimal'
    }
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(`${this.kind} ${res.status}: ${text.slice(0, 300)}`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let usage: Usage | null = null
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl = buf.indexOf('\n')
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        nl = buf.indexOf('\n')
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          if (usage) yield { k: 'usage', usage }
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }
        const chunk = chunkSchema.safeParse(parsed)
        if (!chunk.success) continue
        if (chunk.data.error) throw new Error(chunk.data.error.message)
        const text = chunk.data.choices?.[0]?.delta?.content
        if (text) yield { k: 'text', text }
        const u = chunk.data.usage
        if (u) {
          const cached = u.prompt_tokens_details?.cached_tokens ?? 0
          usage = {
            input: Math.max(0, (u.prompt_tokens ?? 0) - cached),
            cacheRead: cached,
            cacheWrite: 0,
            output: u.completion_tokens ?? 0,
            costUsd: u.cost ?? null,
          }
        }
      }
    }
    if (usage) yield { k: 'usage', usage }
  }
}

export function makeProvider(provider: Provider, model: string, keys: ApiKeys): LlmProvider | null {
  switch (provider) {
    case 'anthropic':
      return keys.anthropic ? new AnthropicProvider(model, keys.anthropic) : null
    case 'openrouter':
      return keys.openrouter ? new OpenAiCompatProvider('openrouter', model, keys.openrouter) : null
    case 'openai':
      return keys.openai ? new OpenAiCompatProvider('openai', model, keys.openai) : null
  }
}

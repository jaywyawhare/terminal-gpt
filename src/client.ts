import crypto from 'node:crypto';
import { generateConfig, generateDeviceId, getHeaders, type Config } from './fingerprint.js';
import { getRequirementsToken, solveProofOfWork } from './pow.js';
import { solveTurnstile } from './turnstile.js';

const BASE_URL = 'https://chatgpt.com';

export interface ChatEvent {
  type: 'token' | 'done' | 'error';
  text?: string;
  error?: string;
}

export class ChatGPTClient {
  private config: Config;
  private ua: string;
  private deviceId: string;
  private oaiVersion?: string;
  private conversationId?: string;
  private parentMessageId: string;
  private cookies = new Map<string, string>();

  constructor() {
    const { config, ua } = generateConfig();
    this.config = config;
    this.ua = ua;
    this.deviceId = generateDeviceId();
    this.parentMessageId = crypto.randomUUID();
  }

  private parseCookies(setCookieHeaders: string[]) {
    for (const header of setCookieHeaders) {
      const [pair] = header.split(';');
      if (pair) {
        const [name, ...rest] = pair.split('=');
        if (name) this.cookies.set(name.trim(), rest.join('=').trim());
      }
    }
  }

  private getCookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async init(): Promise<void> {
    const resp = await fetch(BASE_URL, {
      headers: {
        'user-agent': this.ua,
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    const text = await resp.text();

    const match = text.match(/data-build="([^"]+)"/);
    if (match) this.oaiVersion = match[1];

    const setCookies = resp.headers.getSetCookie?.() ?? [];
    this.parseCookies(setCookies);
    if (this.cookies.has('oai-did')) {
      this.deviceId = this.cookies.get('oai-did')!;
    }
  }

  private async getRequirements(): Promise<Record<string, unknown>> {
    const headers = getHeaders(this.ua, this.deviceId, this.oaiVersion);
    const cookie = this.getCookieHeader();
    if (cookie) headers['cookie'] = cookie;

    const pToken = getRequirementsToken(this.config);
    const resp = await fetch(`${BASE_URL}/backend-anon/sentinel/chat-requirements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p: pToken }),
    });

    const setCookies = resp.headers.getSetCookie?.() ?? [];
    this.parseCookies(setCookies);

    return resp.json() as Promise<Record<string, unknown>>;
  }

  private solveChallenges(requirements: Record<string, unknown>) {
    const tokens = { chatToken: '', proofToken: '', turnstileToken: '' };

    tokens.chatToken = (requirements.token as string) ?? '';

    const pow = requirements.proofofwork as Record<string, unknown> | undefined;
    if (pow?.required) {
      const seed = pow.seed as string;
      const difficulty = pow.difficulty as string;
      if (seed && difficulty) {
        tokens.proofToken = solveProofOfWork(seed, difficulty, [...this.config]);
      }
    }

    const turnstile = requirements.turnstile as Record<string, unknown> | undefined;
    if (turnstile?.required) {
      tokens.turnstileToken = solveTurnstile(
        (turnstile.dx as string) ?? '',
        (turnstile.p as string) ?? '',
      );
    }

    return tokens;
  }

  async *chat(message: string): AsyncGenerator<ChatEvent> {
    const requirements = await this.getRequirements();
    const tokens = this.solveChallenges(requirements);

    const headers = getHeaders(this.ua, this.deviceId, this.oaiVersion);
    headers['accept'] = 'text/event-stream';
    headers['openai-sentinel-chat-requirements-token'] = tokens.chatToken;
    if (tokens.proofToken) headers['openai-sentinel-proof-token'] = tokens.proofToken;
    if (tokens.turnstileToken) headers['openai-sentinel-turnstile-token'] = tokens.turnstileToken;
    const cookie = this.getCookieHeader();
    if (cookie) headers['cookie'] = cookie;

    const msgId = crypto.randomUUID();
    const body = {
      action: 'next',
      messages: [{
        id: msgId,
        author: { role: 'user' },
        content: { content_type: 'text', parts: [message] },
        metadata: {},
      }],
      parent_message_id: this.parentMessageId,
      model: 'auto',
      timezone_offset_min: -300,
      history_and_training_disabled: true,
      conversation_mode: { kind: 'primary_assistant' },
      force_paragen: false,
      force_paragen_model_slug: '',
      force_nulligen: false,
      force_rate_limit: false,
      reset_rate_limits: false,
      websocket_request_id: crypto.randomUUID(),
      ...(this.conversationId ? { conversation_id: this.conversationId } : {}),
    };

    const resp = await fetch(`${BASE_URL}/backend-anon/conversation`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => String(resp.status));
      yield { type: 'error', error: `Request failed (${resp.status}): ${errText.slice(0, 200)}` };
      return;
    }

    if (!resp.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    yield* this.parseStream(resp.body);
    yield { type: 'done' };
  }

  private async *parseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastLen = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop()!; // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') return;

          let data: Record<string, unknown>;
          try {
            data = JSON.parse(dataStr);
          } catch {
            continue;
          }

          // Track conversation
          if (data.conversation_id) {
            this.conversationId = data.conversation_id as string;
          }

          // Standard message format
          const message = data.message as Record<string, unknown> | undefined;
          if (message) {
            const author = message.author as Record<string, unknown> | undefined;
            if (author?.role !== 'assistant') continue;

            const content = message.content as Record<string, unknown> | undefined;
            const parts = content?.parts as string[] | undefined;
            if (parts?.length && content?.content_type === 'text') {
              const text = parts[0]!;
              if (text.length > lastLen) {
                yield { type: 'token', text: text.slice(lastLen) };
                lastLen = text.length;
              }
            }

            if (message.id) {
              this.parentMessageId = message.id as string;
            }
          } else {
            // JSON-patch format
            if (data.o === 'append' && data.p === '/message/content/parts/0') {
              yield { type: 'token', text: data.v as string };
            } else if (data.o === 'patch' && Array.isArray(data.v)) {
              for (const op of data.v as Record<string, unknown>[]) {
                if (op.o === 'append' && op.p === '/message/content/parts/0') {
                  yield { type: 'token', text: op.v as string };
                }
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  reset(): void {
    this.conversationId = undefined;
    this.parentMessageId = crypto.randomUUID();
  }
}

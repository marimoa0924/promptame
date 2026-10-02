// AI 제공자: Gemini, GPT(OpenAI), Claude(Anthropic). 모두 유저 프롬프트를 시스템 프롬프트 없이 그대로 보내고
// 같은 모양의 결과를 돌려준다(game/gemini.js의 generate와 같음):
//   { status: 'OK'|'EMPTY'|'BLOCKED'|'ERROR', text, truncated, finishReason, latencyMs, usage, detail }
// API 키가 있는 제공자만 방에서 고를 수 있다. 키가 하나도 없으면 목 AI로 돌아간다.
import { createGemini, createAIFromEnv, createMockAI, AI_TIMEOUT_MS } from './gemini.js';

const MAX_OUTPUT_TOKENS = 1024;

export const PROVIDERS = {
  gemini: { label: 'Gemini', keyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL' },
  openai: { label: 'GPT', keyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-4o-mini' },
  anthropic: { label: 'Claude', keyEnv: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_MODEL', defaultModel: 'claude-haiku-4-5-20251001' },
};

// 공통: JSON POST 한 번. 시간 초과와 중단 신호를 처리하고, 실패하면 이유를 담아 돌려준다.
async function postJson({ url, headers, body, timeoutMs, signal, fetchImpl }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      return { ok: false, finishReason: `HTTP_${res.status}`, detail: err?.error?.message ?? null };
    }
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, finishReason: err?.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_FAILED', detail: err?.cause?.code ?? err?.message ?? null };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const result = (started, status, extra = {}) => ({ status, text: '', truncated: false, finishReason: null, latencyMs: Date.now() - started, usage: null, ...extra });

export function createOpenAI({ apiKey, model = PROVIDERS.openai.defaultModel, timeoutMs = AI_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY가 없어요');
  model = String(model).trim();
  return {
    kind: 'openai',
    model,
    async generate(prompt, { signal } = {}) {
      const started = Date.now();
      const r = await postJson({
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { authorization: `Bearer ${apiKey}` },
        body: { model, messages: [{ role: 'user', content: prompt }], max_completion_tokens: MAX_OUTPUT_TOKENS },
        timeoutMs, signal, fetchImpl,
      });
      if (!r.ok) return result(started, 'ERROR', { finishReason: r.finishReason, detail: r.detail });
      const choice = r.data.choices?.[0];
      const finish = choice?.finish_reason ?? null;
      const u = r.data.usage;
      const usage = u ? { inTokens: u.prompt_tokens ?? 0, outTokens: u.completion_tokens ?? 0, thinkTokens: u.completion_tokens_details?.reasoning_tokens ?? 0 } : null;
      const text = String(choice?.message?.content ?? '').trim();
      if (!text) return result(started, finish === 'content_filter' || choice?.message?.refusal ? 'BLOCKED' : 'EMPTY', { finishReason: finish, usage });
      return result(started, 'OK', { text, truncated: finish === 'length', finishReason: finish, usage });
    },
    async listModels() {
      try {
        const res = await fetchImpl('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${apiKey}` } });
        return res.ok ? ((await res.json()).data ?? []).map((m) => m.id) : [];
      } catch {
        return [];
      }
    },
  };
}

export function createAnthropic({ apiKey, model = PROVIDERS.anthropic.defaultModel, timeoutMs = AI_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 없어요');
  model = String(model).trim();
  const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  return {
    kind: 'anthropic',
    model,
    async generate(prompt, { signal } = {}) {
      const started = Date.now();
      const r = await postJson({
        url: 'https://api.anthropic.com/v1/messages',
        headers,
        body: { model, max_tokens: MAX_OUTPUT_TOKENS, messages: [{ role: 'user', content: prompt }] },
        timeoutMs, signal, fetchImpl,
      });
      if (!r.ok) return result(started, 'ERROR', { finishReason: r.finishReason, detail: r.detail });
      const stop = r.data.stop_reason ?? null;
      const u = r.data.usage;
      const usage = u ? { inTokens: u.input_tokens ?? 0, outTokens: u.output_tokens ?? 0, thinkTokens: 0 } : null;
      const text = (r.data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
      if (!text) return result(started, stop === 'refusal' ? 'BLOCKED' : 'EMPTY', { finishReason: stop, usage });
      return result(started, 'OK', { text, truncated: stop === 'max_tokens', finishReason: stop, usage });
    },
    async listModels() {
      try {
        const res = await fetchImpl('https://api.anthropic.com/v1/models?limit=100', { headers });
        return res.ok ? ((await res.json()).data ?? []).map((m) => m.id) : [];
      } catch {
        return [];
      }
    },
  };
}

// 환경변수에 키가 있는 제공자만 만든다. defaultKind는 방을 만들 때 고르지 않았을 때 쓰는 제공자(키가 없으면 'mock').
export function createProviders(env = process.env) {
  const available = {};
  if (env.GEMINI_API_KEY) available.gemini = createAIFromEnv(env);
  if (env.OPENAI_API_KEY) available.openai = createOpenAI({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || undefined });
  if (env.ANTHROPIC_API_KEY) available.anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || undefined });
  const mock = createMockAI();
  const preferred = ['gemini', 'openai', 'anthropic'].find((k) => available[k]);
  const defaultKind = env.DEFAULT_AI && available[env.DEFAULT_AI] ? env.DEFAULT_AI : (preferred ?? 'mock');
  return {
    available,
    mock,
    defaultKind,
    default: available[defaultKind] ?? mock,
    // 화면에 보여 줄 정보(키 값은 절대 포함하지 않는다)
    info: () => Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, ok: !!available[id], model: available[id]?.model ?? null })),
  };
}

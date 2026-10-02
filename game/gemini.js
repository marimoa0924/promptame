// AI 답변 생성기. 유저 프롬프트를 시스템 프롬프트 없이 그대로 보내고, 답변 전체를 받아 돌려준다.
// 실제 Gemini 호출(createGemini)과 키 없이 돌리는 목(createMockAI)이 같은 모양이다.
//
// generate(prompt, { signal, problem, lengthRule }) -> {
//   status: 'OK' | 'EMPTY' | 'BLOCKED' | 'ERROR',
//   text, truncated, finishReason, latencyMs, usage: { inTokens, outTokens } | null, detail(실패 원인 문장)
// }
// problem과 lengthRule은 목이 답변을 꾸밀 때만 쓰고, 실제 호출에는 전혀 보내지 않는다.

export const AI_TIMEOUT_MS = 8000;
export const AI_RETRY_MAX = 2;
const RETRY_WAIT_MS = 500;
const MAX_OUTPUT_TOKENS = 1024; // 가장 긴 분량(300자)보다 넉넉하게
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createGemini({
  apiKey,
  model = DEFAULT_MODEL,
  // 생각 기능을 끈다. 이 설정을 받지 않는 모델이면 빈 문자열로 두면 필드를 보내지 않는다.
  thinkingBudget = 0,
  timeoutMs = AI_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY가 없어요');
  model = String(model).trim().replace(/^models\//, ''); // 'models/gemini-...'로 적어도 된다
  // 생각 끄기 설정(thinkingBudget)을 보낸다. gemini-3 계열은 이 설정을 거부하는 것이 확인되어서 처음부터 보내지 않는다.
  // 다른 모델이 거부하면 빼고 다시 시도하고, 그 뒤로는 계속 뺀다.
  let useThinking = thinkingBudget !== '' && thinkingBudget != null && !/^gemini-3/.test(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  return {
    kind: 'gemini',
    model,
    async generate(prompt, { signal } = {}) {
      const started = Date.now();
      const done = (status, extra = {}) => ({
        status,
        text: '',
        truncated: false,
        finishReason: null,
        latencyMs: Date.now() - started,
        usage: null,
        ...extra,
      });

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const onAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const call = () => {
          const generationConfig = { maxOutputTokens: MAX_OUTPUT_TOKENS };
          if (useThinking) generationConfig.thinkingConfig = { thinkingBudget };
          return fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
            signal: ctrl.signal,
          });
        };
        let res = await call();
        let errBody = null;
        if (!res.ok) {
          errBody = await res.json().catch(() => null);
          // 생각 기능 설정을 받지 않는 모델이면 그 설정만 빼고 한 번 더 보낸다
          if (res.status === 400 && useThinking) {
            useThinking = false;
            res = await call();
            errBody = res.ok ? null : await res.json().catch(() => null);
          }
        }
        if (!res.ok) {
          // 원인을 알 수 있게 Gemini가 돌려준 오류 문장을 남긴다 (키 문제, 모델 이름 오류 등)
          return done('ERROR', { finishReason: `HTTP_${res.status}`, detail: errBody?.error?.message ?? null });
        }
        const data = await res.json();

        const usage = data.usageMetadata
          ? {
              inTokens: data.usageMetadata.promptTokenCount ?? 0,
              outTokens: data.usageMetadata.candidatesTokenCount ?? 0,
              thinkTokens: data.usageMetadata.thoughtsTokenCount ?? 0, // 생각에 쓴 토큰. 0이 아니면 생각 기능이 켜져 있다
            }
          : null;
        if (data.promptFeedback?.blockReason) {
          return done('BLOCKED', { finishReason: data.promptFeedback.blockReason, usage });
        }
        const cand = data.candidates?.[0];
        const finishReason = cand?.finishReason ?? null;
        const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
        if (!text) {
          const blocked = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(finishReason);
          return done(blocked ? 'BLOCKED' : 'EMPTY', { finishReason, usage });
        }
        return done('OK', { text, truncated: finishReason === 'MAX_TOKENS', finishReason, usage });
      } catch (err) {
        return done('ERROR', { finishReason: err?.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_FAILED', detail: err?.cause?.code ?? err?.message ?? null });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

// 오류, 시간 초과, 빈 응답이면 같은 프롬프트로 다시 시도한다. 유저가 보낸 횟수로는 세지 않는다.
// onRetry(n)은 n번째 재시도에 들어가기 직전에 불린다(화면에 "다시 시도하는 중"을 띄우는 용도)
export async function generateWithRetry(ai, prompt, ctx = {}, { retries = AI_RETRY_MAX, waitMs = RETRY_WAIT_MS, onRetry } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    if (ctx.signal?.aborted) return { status: 'ERROR', text: '', truncated: false, finishReason: 'ABORTED', latencyMs: 0, usage: null };
    last = await ai.generate(prompt, ctx);
    if (last.status === 'OK') return last;
    if (i < retries) {
      onRetry?.(i + 1);
      await sleep(waitMs);
    }
  }
  return last;
}

// ---------------------------------------------------------------------------
// 목: 키가 없을 때, 연습봇, 튜토리얼에서 쓴다. 프롬프트가 길고 구체적일수록 필수어가 많이 담긴다.
// 짧게 말해 달라는 표현이 없으면 군말이 붙어서 분량을 넘기기도 한다.
// ---------------------------------------------------------------------------
const SHORT_CUES = ['짧게', '간단', '간결', '한 줄', '한줄', '요약'];

export function createMockAI({ minMs = 300, maxMs = 900 } = {}) {
  return {
    kind: 'mock',
    model: 'mock',
    async generate(prompt, { problem, lengthRule } = {}) {
      const started = Date.now();
      await sleep(minMs + Math.random() * (maxMs - minMs));
      const len = [...String(prompt)].length;
      const keywords = problem?.keywords ?? [];
      const n = len < 12 ? 0 : len < 25 ? 1 : len < 45 ? 2 : 3;
      const wantsShort = SHORT_CUES.some((c) => prompt.includes(c));

      let lines;
      if (n === 0) {
        lines = ['음… 무슨 이야기인지 잘 모르겠어요.', '조금 더 구체적으로 알려 줄래요?'];
      } else {
        lines = keywords.slice(0, n).map((k) => `'${k}'도 꼭 알아야 해요.`);
        if (!wantsShort) lines.push('조금 더 자세히 풀어서 설명해 볼게요.', '더 궁금한 점이 있으면 물어보세요!');
      }
      if (wantsShort && lengthRule?.type === 'chars') {
        lines = [lines.join(' ').slice(0, lengthRule.value)];
      }
      return {
        status: 'OK',
        text: lines.join('\n'),
        truncated: false,
        finishReason: 'STOP',
        latencyMs: Date.now() - started,
        usage: null,
      };
    },
  };
}

// 환경변수로 실제 클라이언트를 만든다. 키가 없으면 목으로 돌아간다.
export function createAIFromEnv(env = process.env) {
  if (!env.GEMINI_API_KEY) return createMockAI();
  return createGemini({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL || undefined,
    thinkingBudget: env.GEMINI_THINKING_BUDGET === undefined ? 0 : env.GEMINI_THINKING_BUDGET === '' ? '' : Number(env.GEMINI_THINKING_BUDGET),
  });
}

// 이 키로 쓸 수 있는 모델 이름 목록 (모델 이름이 틀렸을 때 안내용)
export async function listModels(apiKey, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
  } catch {
    return [];
  }
}

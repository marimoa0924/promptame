// 실행: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAI, createAnthropic, createProviders } from './providers.js';

const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const fail = (status, body) => async () => ({ ok: false, status, json: async () => body });

test('GPT: 프롬프트를 시스템 프롬프트 없이 그대로 보내고, 답과 사용량을 돌려준다', async () => {
  let sent;
  const ai = createOpenAI({
    apiKey: 'sk-test',
    fetchImpl: async (url, init) => {
      sent = { url, init, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ choices: [{ message: { content: ' 답 ' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 1 } } }) };
    },
  });
  const r = await ai.generate('안녕');
  assert.deepEqual([r.status, r.text, r.truncated], ['OK', '답', false]);
  assert.deepEqual(r.usage, { inTokens: 5, outTokens: 2, thinkTokens: 1 });
  assert.equal(sent.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(sent.init.headers.authorization, 'Bearer sk-test');
  assert.deepEqual(sent.body.messages, [{ role: 'user', content: '안녕' }]); // 시스템 메시지 없음
  assert.equal(sent.body.max_completion_tokens, 1024);
});

test('GPT: 잘림, 비어 있음, 필터, HTTP 오류를 구분한다', async () => {
  const mk = (f) => createOpenAI({ apiKey: 'k', fetchImpl: f });
  assert.equal((await mk(ok({ choices: [{ message: { content: '잘린 답' }, finish_reason: 'length' }] })).generate('x')).truncated, true);
  assert.equal((await mk(ok({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] })).generate('x')).status, 'EMPTY');
  assert.equal((await mk(ok({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] })).generate('x')).status, 'BLOCKED');
  assert.equal((await mk(ok({ choices: [{ message: { content: null, refusal: '안 돼요' }, finish_reason: 'stop' }] })).generate('x')).status, 'BLOCKED');
  const e = await mk(fail(401, { error: { message: 'Incorrect API key' } })).generate('x');
  assert.deepEqual([e.status, e.finishReason, e.detail], ['ERROR', 'HTTP_401', 'Incorrect API key']);
});

test('Claude: 프롬프트를 시스템 프롬프트 없이 그대로 보내고, 텍스트 블록만 모은다', async () => {
  let sent;
  const ai = createAnthropic({
    apiKey: 'sk-ant-test',
    fetchImpl: async (url, init) => {
      sent = { url, init, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '가' }, { type: 'text', text: '나' }], stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 3 } }) };
    },
  });
  const r = await ai.generate('안녕');
  assert.deepEqual([r.status, r.text, r.truncated], ['OK', '가나', false]);
  assert.deepEqual(r.usage, { inTokens: 4, outTokens: 3, thinkTokens: 0 });
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(sent.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(sent.body.system, undefined);
  assert.deepEqual(sent.body.messages, [{ role: 'user', content: '안녕' }]);
  assert.equal(sent.body.max_tokens, 1024);
});

test('Claude: 잘림, 거절, 비어 있음, HTTP 오류를 구분한다', async () => {
  const mk = (f) => createAnthropic({ apiKey: 'k', fetchImpl: f });
  assert.equal((await mk(ok({ content: [{ type: 'text', text: '잘림' }], stop_reason: 'max_tokens' })).generate('x')).truncated, true);
  assert.equal((await mk(ok({ content: [], stop_reason: 'refusal' })).generate('x')).status, 'BLOCKED');
  assert.equal((await mk(ok({ content: [], stop_reason: 'end_turn' })).generate('x')).status, 'EMPTY');
  const e = await mk(fail(404, { error: { message: 'model: nope' } })).generate('x');
  assert.deepEqual([e.finishReason, e.detail], ['HTTP_404', 'model: nope']);
});

test('시간 초과와 네트워크 오류', async () => {
  const slow = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' }))));
  assert.equal((await createOpenAI({ apiKey: 'k', timeoutMs: 20, fetchImpl: slow }).generate('x')).finishReason, 'TIMEOUT');
  assert.equal((await createAnthropic({ apiKey: 'k', fetchImpl: async () => { throw new Error('offline'); } }).generate('x')).finishReason, 'FETCH_FAILED');
});

test('모델 목록 조회(모델 이름이 틀렸을 때 안내용)', async () => {
  const o = createOpenAI({ apiKey: 'k', fetchImpl: ok({ data: [{ id: 'gpt-a' }, { id: 'gpt-b' }] }) });
  assert.deepEqual(await o.listModels(), ['gpt-a', 'gpt-b']);
  const a = createAnthropic({ apiKey: 'k', fetchImpl: ok({ data: [{ id: 'claude-x' }] }) });
  assert.deepEqual(await a.listModels(), ['claude-x']);
});

test('키가 있는 제공자만 고를 수 있고, 키 값은 화면용 정보에 없다', () => {
  const none = createProviders({});
  assert.equal(none.defaultKind, 'mock');
  assert.equal(none.default.kind, 'mock');
  assert.deepEqual(none.info().map((p) => p.ok), [false, false, false]);

  const some = createProviders({ OPENAI_API_KEY: 'sk-secret', ANTHROPIC_API_KEY: 'sk-ant-secret' });
  assert.deepEqual(Object.keys(some.available), ['openai', 'anthropic']);
  assert.equal(some.defaultKind, 'openai'); // 앞 순서(gemini, openai, anthropic) 중 키가 있는 것
  assert.equal(JSON.stringify(some.info()).includes('secret'), false);
  assert.equal(some.info().find((p) => p.id === 'anthropic').model, 'claude-haiku-4-5-20251001');

  const pick = createProviders({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', DEFAULT_AI: 'anthropic', GEMINI_MODEL: 'gm' });
  assert.equal(pick.defaultKind, 'anthropic');
  assert.equal(pick.available.gemini.model, 'gm');
});

// 실행: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGemini, createMockAI, generateWithRetry, listModels } from './gemini.js';

const reply = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });

test('프롬프트를 시스템 프롬프트 없이 그대로 보내고 생각 기능을 끈다', async () => {
  let sent;
  const ai = createGemini({
    apiKey: 'k',
    fetchImpl: async (url, init) => {
      sent = { url, init, body: JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '답' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, thoughtsTokenCount: 2 } }) };
    },
  });
  const r = await ai.generate('안녕');
  assert.equal(r.status, 'OK');
  assert.equal(r.text, '답');
  assert.deepEqual(r.usage, { inTokens: 3, outTokens: 1, thinkTokens: 2 });
  assert.equal(sent.body.contents[0].parts[0].text, '안녕');
  assert.equal(sent.body.systemInstruction, undefined);
  assert.equal(sent.body.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(sent.body.generationConfig.maxOutputTokens, 1024);
  assert.equal(sent.init.headers['x-goog-api-key'], 'k');
});

test('토큰 한도로 잘리면 truncated', async () => {
  const ai = createGemini({ apiKey: 'k', fetchImpl: reply({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '잘린 답' }] } }] }) });
  const r = await ai.generate('x');
  assert.equal(r.status, 'OK');
  assert.equal(r.truncated, true);
});

test('안전 필터, 빈 응답, HTTP 오류를 구분한다', async () => {
  const mk = (body, ok, status) => createGemini({ apiKey: 'k', fetchImpl: reply(body, ok, status) });
  assert.equal((await mk({ promptFeedback: { blockReason: 'SAFETY' } }).generate('x')).status, 'BLOCKED');
  assert.equal((await mk({ candidates: [{ finishReason: 'SAFETY' }] }).generate('x')).status, 'BLOCKED');
  assert.equal((await mk({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }).generate('x')).status, 'EMPTY');
  const err = await mk({}, false, 429).generate('x');
  assert.equal(err.status, 'ERROR');
  assert.equal(err.finishReason, 'HTTP_429');
  const withMsg = await createGemini({ apiKey: 'k', fetchImpl: reply({ error: { message: 'API key not valid' } }, false, 400) }).generate('x');
  assert.equal(withMsg.detail, 'API key not valid');
});

test('시간 초과는 ERROR(TIMEOUT)', async () => {
  const ai = createGemini({
    apiKey: 'k',
    timeoutMs: 20,
    fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })))),
  });
  const r = await ai.generate('x');
  assert.equal(r.status, 'ERROR');
  assert.equal(r.finishReason, 'TIMEOUT');
});

test('실패하면 최대 2번 더 시도한다', async () => {
  let calls = 0;
  const ai = { generate: async () => (++calls < 3 ? { status: 'EMPTY', text: '' } : { status: 'OK', text: '됐다' }) };
  const seen = [];
  const r = await generateWithRetry(ai, 'x', {}, { waitMs: 1, onRetry: (n) => seen.push(n) });
  assert.equal(r.status, 'OK');
  assert.equal(calls, 3);
  assert.deepEqual(seen, [1, 2]);

  calls = 0;
  const bad = { generate: async () => (calls++, { status: 'ERROR', text: '' }) };
  assert.equal((await generateWithRetry(bad, 'x', {}, { waitMs: 1 })).status, 'ERROR');
  assert.equal(calls, 3);
});

test('목은 프롬프트가 길수록 필수어를 더 담는다', async () => {
  const mock = createMockAI({ minMs: 0, maxMs: 0 });
  const problem = { keywords: ['가', '나', '다'] };
  const count = async (p) => ((await mock.generate(p, { problem })).text.match(/'[가나다]'/g) ?? []).length;
  assert.equal(await count('짧게'), 0);
  assert.equal(await count('아이들에게 쉽게 짧게 알려 줘'), 1);
  assert.equal(await count('아이들에게 쉽고 짧게 차근차근 알려 주세요 부탁해요'), 2);
  assert.equal(await count('나는 아이들을 가르치는 교사야. 아이들 눈높이에 맞게 짧고 간결하게 차근차근 설명해줘'), 3);
});

test('모델 이름 앞의 models/ 는 떼고, 목록에서는 generateContent 가능한 것만 고른다', async () => {
  let url;
  const ai = createGemini({ apiKey: 'k', model: ' models/gemini-x ', fetchImpl: async (u) => ((url = u), { ok: true, status: 200, json: async () => ({}) }) });
  await ai.generate('x');
  assert.match(url, /\/models\/gemini-x:generateContent$/);
  const list = await listModels('k', reply({ models: [{ name: 'models/a', supportedGenerationMethods: ['generateContent'] }, { name: 'models/b', supportedGenerationMethods: ['embedContent'] }] }));
  assert.deepEqual(list, ['a']);
});

test('생각 기능 설정을 거부하는 모델이면 그 설정만 빼고 다시 보낸다', async () => {
  const bodies = [];
  const ai = createGemini({
    apiKey: 'k',
    fetchImpl: async (u, init) => {
      const b = JSON.parse(init.body);
      bodies.push(b);
      if (b.generationConfig.thinkingConfig) return { ok: false, status: 400, json: async () => ({ error: { message: 'Request contains an invalid argument.' } }) };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '답' }] } }] }) };
    },
  });
  assert.equal((await ai.generate('x')).status, 'OK');
  assert.equal(bodies.length, 2);
  await ai.generate('y');
  assert.equal(bodies.length, 3); // 한 번 알게 된 뒤에는 처음부터 빼고 보낸다
});

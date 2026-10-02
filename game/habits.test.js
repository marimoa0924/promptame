// 실행: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { featuresOf, makeEntry, analyze, MIN_ENTRIES } from './habits.js';

test('프롬프트의 특징을 찾는다', () => {
  assert.deepEqual(featuresOf('나는 초등학교 교사야. 아이들에게 쉽게 짧게 설명해줘'), ['role', 'audience', 'brevity']);
  assert.ok(featuresOf('예를 들어 비유로 알려줘').includes('example'));
  assert.ok(featuresOf('먼저 무엇인지, 그다음 어떻게 쓰는지 순서대로').includes('steps'));
  assert.ok(featuresOf('이게 뭐야?').includes('question'));
  assert.ok(featuresOf('첫 줄\n둘째 줄').includes('structure'));
  assert.deepEqual(featuresOf('알려줘'), []);
});

test('기록 한 건: 길이와 특징, 앞 200자만 남긴다', () => {
  const e = makeEntry({ text: '가'.repeat(250), attempt: 2, pass: true, reasons: [], difficulty: '보통', t: 1 });
  assert.equal(e.len, 250);
  assert.equal(e.text.length, 200);
  assert.deepEqual([e.attempt, e.pass, e.t], [2, true, 1]);
});

const mk = (n, o = {}) => Array.from({ length: n }, (_, i) => makeEntry({ text: '알려줘', attempt: 1, pass: i % 2 === 0, reasons: i % 2 ? ['KEYWORD_SHORT'] : [], ...o }));

test('기록이 적으면 아직 분석하지 않는다', () => {
  const r = analyze(mk(MIN_ENTRIES - 3));
  assert.equal(r.enough, false);
  assert.equal(r.need, 3);
});

test('짧은 직설형: 짧고 상황 설정이 없다. 필수어 실패가 많으면 팁이 나온다', () => {
  const r = analyze([...mk(10, { text: '알려줘' })].map((e, i) => ({ ...e, pass: i < 3, reasons: i < 3 ? [] : ['KEYWORD_SHORT'] })));
  assert.equal(r.enough, true);
  assert.equal(r.type.name, '짧은 직설형');
  assert.ok(r.avgLen < 28);
  assert.equal(r.failure.keyword, 1);
  assert.ok(r.tips.some((t) => t.includes('필수어')));
});

test('상황 설정형과 특징별 성공률 비교', () => {
  const withRole = Array.from({ length: 6 }, () => makeEntry({ text: '나는 초등학교 교사야. 아이들에게 쉽게 설명해줘', attempt: 1, pass: true }));
  const without = Array.from({ length: 4 }, () => makeEntry({ text: '그냥 알려줘', attempt: 1, pass: false, reasons: ['KEYWORD_SHORT'] }));
  const r = analyze([...withRole, ...without]);
  assert.equal(r.type.name, '상황 설정형');
  const role = r.features.find((f) => f.key === 'role');
  assert.equal(role.withRate, 1);
  assert.equal(role.withoutRate, 0);
  assert.ok(r.tips.some((t) => t.includes('역할·상황 설정')));
  assert.equal(Math.round(r.firstTryRate * 100), 60);
});

test('분량을 자주 넘으면 길이 팁', () => {
  const r = analyze(mk(10).map((e) => ({ ...e, pass: false, reasons: ['LENGTH_OVER'] })));
  assert.ok(r.tips[0].includes('분량'));
});

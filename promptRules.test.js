// 실행: node --test
// 금지어 범위를 업데이트로 늘릴 때마다 여기에 새 우회 예시를 한 줄씩 추가해 두면 안전해요.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  checkPrompt, checkAnswer, countSentences, countChars, composeJamo, drawQuestion, drawSequence,
} from './promptRules.js';

const data = JSON.parse(fs.readFileSync(new URL('./problems.json', import.meta.url), 'utf8'));
const byTopic = (t) => data.problems.find((p) => p.topic === t);
const mito = byTopic('미토콘드리아');
const dog = byTopic('강아지');
const db = byTopic('데이터베이스');

const blocked = (prompt, problem) => checkPrompt(prompt, problem).code === 'FORBIDDEN';
const allowed = (prompt, problem) => checkPrompt(prompt, problem).ok === true;

test('주제어와 필수어를 그대로 쓰면 막혀요', () => {
  assert.ok(blocked('미토콘드리아가 뭐야', mito));
  assert.ok(blocked('에너지 만드는 곳 알려줘', mito));
  assert.ok(blocked('세포호흡 설명', mito));
});

test('직관적인 쪼개기와 끼워 넣기 우회는 막혀요', () => {
  assert.ok(blocked('미 토 콘 드 리 아', mito)); // 한 글자씩 띄어쓰기
  assert.ok(blocked('미-토-콘-드-리-아', mito)); // 특수문자 끼우기
  assert.ok(blocked('미.토.콘.드.리.아', mito));
  assert.ok(blocked('미😀토😀콘😀드😀리😀아', mito)); // 이모지 끼우기
  assert.ok(blocked('미\u200b토\u200b콘드리아', mito)); // 보이지 않는 문자
  assert.ok(blocked('미ㅋ토ㅋ콘ㅋ드ㅋ리ㅋ아', mito)); // 낱자 끼우기
  assert.ok(blocked('미1토2콘3드4리5아', mito)); // 숫자 끼우기
  assert.ok(blocked('ㅁㅣㅌㅗㅋㅗㄴㄷㅡㄹㅣㅇㅏ', mito)); // 자모 풀어쓰기
  assert.ok(blocked('ㅁㅌㅋㄷㄹㅇ 설명해줘', mito)); // 초성
  assert.ok(blocked('MITOCHONDRIA', mito)); // 영어 번역어
  assert.ok(blocked('mito chondria', mito));
  assert.ok(blocked('ＡＴＰ 알려줘', mito)); // 전각 문자
  assert.ok(blocked('atp', mito));
  assert.ok(blocked('에이티피', mito));
});

test('창의적인 돌려 말하기는 통과해요', () => {
  assert.ok(allowed('세포 안에서 힘을 만들어 주는 발전소를 설명해줘', mito));
  assert.ok(allowed('식물이 힘내는 법 알려줘', byTopic('광합성')));
});

test('짧은 영어 금지어는 다른 단어 속에 있을 때 막지 않아요', () => {
  assert.ok(blocked('dog 알려줘', dog));
  assert.ok(blocked('d o g', dog));
  assert.ok(blocked('dogs', dog));
  assert.ok(allowed('dogma 같은 철학 이야기', dog));
  assert.ok(blocked('primary key 설명', db));
  assert.ok(allowed('keyboard 말고 다른 걸로', byTopic('우유')));
});

test('자모 합치기', () => {
  assert.equal(composeJamo('ㅁㅣㅌㅗㅋㅗㄴㄷㅡㄹㅣㅇㅏ'), '미토콘드리아');
  assert.equal(composeJamo('ㅎㅏㄴㄱㅡㄹ'), '한글');
  assert.equal(composeJamo('ㅇㅜㅇㅠ'), '우유');
  assert.equal(composeJamo('ㄷㅏㄹㄱ'), '닭');
  assert.equal(composeJamo('ㅇㅗㅏ'), '와');
});

test('프롬프트 글자 수 제한과 빈 입력', () => {
  assert.equal(checkPrompt('', mito).code, 'EMPTY');
  assert.equal(checkPrompt('   ', mito).code, 'EMPTY');
  const fifty = '가'.repeat(50);
  assert.equal(checkPrompt(fifty, mito, 50).ok, true);
  assert.equal(checkPrompt(fifty + '가', mito, 50).code, 'TOO_LONG');
  assert.equal(checkPrompt(fifty + '가'.repeat(500), mito, null).ok, true);
  assert.equal(countChars('안녕 😀'), 4);
});

test('필수어 개수는 난이도에 따라 달라져요', () => {
  const easy = byTopic('피자'); // 쉬움: 1개 이상
  const len = { type: 'chars', value: 100 };
  assert.equal(checkAnswer('치즈가 올라가요.', easy, len).pass, true);
  assert.equal(checkAnswer('둥글고 맛있어요.', easy, len).pass, false);
  // 보통: 2개 이상
  assert.equal(checkAnswer('세포호흡을 해요.', mito, len).pass, false);
  assert.equal(checkAnswer('세포호흡으로 에너지를 만들어요.', mito, len).pass, true);
  assert.equal(checkAnswer('ATP와 세포 호흡', mito, len).pass, true); // 대소문자, 띄어쓰기 무시
  // 어려움: 3개 모두
  assert.equal(checkAnswer('정규화와 테이블을 써요.', db, len).pass, false);
  assert.equal(checkAnswer('정규화와 테이블과 기본키를 써요.', db, len).pass, true);
});

test('답변 분량 검사', () => {
  const easy = byTopic('피자');
  assert.equal(checkAnswer('치즈가 올라가요. 맛있어요. 따뜻해요.', easy, { type: 'sentences', value: 2 }).lengthOk, false);
  assert.equal(checkAnswer('치즈가 올라가요. 맛있어요.', easy, { type: 'sentences', value: 2 }).lengthOk, true);
  assert.equal(checkAnswer('치즈'.repeat(30), easy, { type: 'chars', value: 50 }).lengthOk, false);
  assert.equal(checkAnswer('', easy, { type: 'chars', value: 50 }).pass, false);
  assert.equal(countSentences('원주율은 3.14예요. 정말요?'), 2);
  assert.equal(countSentences('1. 첫째\n2. 둘째\n3. 셋째'), 3);
  assert.equal(countSentences('끝 기호 없이 한 문장'), 1);
});

test('출제는 같은 난이도에서 안 나온 문제를 먼저 뽑아요', () => {
  const easyIds = data.problems.filter((p) => p.difficulty === '쉬움').map((p) => p.id);
  const used = easyIds.slice(0, -1);
  const { problem, lengthRule } = drawQuestion(data, '쉬움', used);
  assert.equal(problem.id, easyIds.at(-1));
  assert.ok(['chars', 'sentences'].includes(lengthRule.type));
});

test('모든 문제의 주제어와 필수어는 스스로 막혀요', () => {
  for (const p of data.problems) {
    assert.ok(blocked(p.topic, p), `${p.topic} 주제어가 안 막혀요`);
    for (const k of p.keywords) assert.ok(blocked(k, p), `${p.topic}의 ${k}가 안 막혀요`);
    for (const e of p.extraForbidden) assert.ok(blocked(e, p), `${p.topic}의 ${e}가 안 막혀요`);
  }
});

test('답변이 잘렸으면 분량 초과로 실패해요', () => {
  const easy = byTopic('피자');
  const len = { type: 'chars', value: 100 };
  const ok = checkAnswer('치즈가 올라가요.', easy, len);
  assert.equal(ok.pass, true);
  assert.deepEqual(ok.reasons, []);
  const cut = checkAnswer('치즈가 올라가요.', easy, len, undefined, { truncated: true });
  assert.equal(cut.pass, false);
  assert.equal(cut.truncated, true);
  assert.deepEqual(cut.reasons, ['TRUNCATED']);
});

test('실패 이유 목록', () => {
  const easy = byTopic('피자');
  assert.deepEqual(checkAnswer('둥글어요.', easy, { type: 'chars', value: 100 }).reasons, ['KEYWORD_SHORT']);
  assert.deepEqual(checkAnswer('치즈'.repeat(30), easy, { type: 'chars', value: 50 }).reasons, ['LENGTH_OVER']);
  assert.deepEqual(checkAnswer('', easy, { type: 'chars', value: 50 }).reasons, ['EMPTY', 'KEYWORD_SHORT']);
});

test('문제 목록은 풀을 다 쓰기 전에는 겹치지 않고 다 쓰면 다시 섞어요', () => {
  const list = drawSequence(data, '보통', 40);
  assert.equal(list.length, 40);
  assert.ok(list.every((x) => x.problem.difficulty === '보통' && x.lengthRule));
  assert.equal(new Set(list.slice(0, 20).map((x) => x.problem.id)).size, 20);
  assert.equal(new Set(list.slice(20, 40).map((x) => x.problem.id)).size, 20);
});

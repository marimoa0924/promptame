// 실행: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNickname } from './nickname.js';

test('길이는 2~8자', () => {
  assert.equal(checkNickname('가').code, 'LENGTH');
  assert.equal(checkNickname('  ').code, 'LENGTH');
  assert.equal(checkNickname('가나다라마바사아자').code, 'LENGTH');
  assert.deepEqual(checkNickname(' 냥이 '), { ok: true, name: '냥이' });
  assert.equal(checkNickname('가나다라마바사아').ok, true);
});

test('욕설은 쪼개거나 풀어 써도 막는다', () => {
  assert.equal(checkNickname('씨발이').code, 'BANNED');
  assert.equal(checkNickname('씨 발').code, 'BANNED');
  assert.equal(checkNickname('ㅅㅣㅂㅏㄹ').code, 'BANNED');
  assert.equal(checkNickname('ㅅㅂ러').code, 'BANNED');
  assert.equal(checkNickname('FUCK이').code, 'BANNED');
});

test('평범한 닉네임은 통과', () => {
  for (const n of ['고양이집사', '비둘기', '프롬프트왕', 'abc123']) assert.equal(checkNickname(n).ok, true, n);
});

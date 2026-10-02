// 실행: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJsonStore } from './jsonStore.js';
import { createSeen } from './seen.js';
import { createRanking, tierOf, RANK } from './ranking.js';

const A = (score, extra = {}) => ({ id: 'pa', device: 'devA-0001', name: '에이', char: 'cat', score, ...extra });
const B = (score, extra = {}) => ({ id: 'pb', device: 'devB-0001', name: '비이', char: 'dog', score, ...extra });
const mk = () => createRanking(createJsonStore(null));

test('승리 +25, 패배 -10(0 밑으로는 안 내려감), 무승부 +5', () => {
  const r = mk();
  let res = r.record({ reason: 'timeup', winnerId: 'pa', a: A(3), b: B(1) });
  assert.deepEqual([res.pa.delta, res.pa.rp, res.pb.delta, res.pb.rp], [25, 25, 0, 0]); // 0점에서 -10은 0
  res = r.record({ reason: 'timeup', winnerId: null, a: A(2), b: B(2) });
  assert.deepEqual([res.pa.delta, res.pa.rp, res.pb.delta, res.pb.rp], [5, 30, 5, 5]);
  res = r.record({ reason: 'timeup', winnerId: 'pb', a: A(1), b: B(4) });
  assert.deepEqual([res.pa.delta, res.pa.rp, res.pb.delta, res.pb.rp], [-10, 20, 25, 30]);
  const me = r.me('devB-0001');
  assert.equal(me.rank, 1);
  assert.equal(me.wins, 1);
  assert.equal(me.draws, 1);
});

test('포기: 포기한 쪽 -15, 상대 +12', () => {
  const r = mk();
  r.record({ reason: 'timeup', winnerId: 'pa', a: A(3), b: B(0) }); // A 25
  const res = r.record({ reason: 'forfeit', winnerId: 'pb', leaverId: 'pa', a: A(0), b: B(0) });
  assert.equal(res.pa.delta, -15);
  assert.equal(res.pb.delta, 12);
});

test('반영하지 않는 판: 같은 기기, PASS가 너무 적음, 같은 상대와 1시간에 5판 넘게', () => {
  const r = mk();
  let res = r.record({ reason: 'timeup', winnerId: 'pa', a: A(3), b: B(0, { device: 'devA-0001' }) });
  assert.equal(res.pa.counted, false);
  assert.equal(res.pa.note, '같은 계정끼리 한 판이에요');
  res = r.record({ reason: 'timeup', winnerId: 'pa', a: A(1), b: B(0) });
  assert.equal(res.pa.counted, false);
  assert.equal(res.pa.note, 'PASS가 너무 적은 판이에요');
  for (let i = 0; i < RANK.PAIR_LIMIT; i++) assert.equal(r.record({ reason: 'timeup', winnerId: 'pa', a: A(3), b: B(1) }).pa.counted, true);
  res = r.record({ reason: 'timeup', winnerId: 'pa', a: A(3), b: B(1) });
  assert.equal(res.pa.counted, false);
  assert.equal(r.me('devA-0001').games, RANK.PAIR_LIMIT);
});

test('같은 상대와 한 시간이 지나면 다시 반영된다', () => {
  let t = 1_000_000;
  const r = createRanking(createJsonStore(null), () => t);
  for (let i = 0; i < RANK.PAIR_LIMIT; i++) r.record({ reason: 'timeup', winnerId: 'pa', a: A(3), b: B(1) });
  assert.equal(r.record({ reason: 'timeup', winnerId: 'pa', a: A(3), b: B(1) }).pa.counted, false);
  t += RANK.PAIR_WINDOW_MS + 1;
  assert.equal(r.record({ reason: 'timeup', winnerId: 'pa', a: A(3), b: B(1) }).pa.counted, true);
});

test('봇이나 튜토리얼처럼 기기가 없는 판은 랭킹과 상관없다', () => {
  assert.equal(mk().record({ reason: 'timeup', winnerId: 'pa', a: A(3), b: { id: 'bot', device: null, name: '봇', char: 'cat', score: 1 } }), null);
});

test('순위는 점수, 승수 순이고 기기 ID는 밖으로 안 나간다', () => {
  const r = mk();
  r.record({ reason: 'timeup', winnerId: 'pa', a: A(3), b: B(1) });
  r.record({ reason: 'timeup', winnerId: 'pa', a: { ...A(3), id: 'pc', device: 'devC-0001', name: '씨' }, b: { ...B(1), id: 'pd', device: 'devD-0001', name: '디' } });
  const top = r.top(10);
  assert.equal(top.length, 4);
  assert.deepEqual(top.map((x) => x.rank), [1, 2, 3, 4]);
  assert.ok(top.every((x) => x.device === undefined));
  assert.equal(top[0].rp, 25);
});

test('등급과 다음 등급까지 남은 점수', () => {
  assert.deepEqual(tierOf(0), { name: '브론즈', next: { name: '실버', need: 100 } });
  assert.deepEqual(tierOf(100), { name: '실버', next: { name: '골드', need: 150 } });
  assert.deepEqual(tierOf(1500), { name: '다이아', next: null });
});

test('파일에 저장하고 다시 읽는다. 깨진 파일은 빈 상태로 시작한다', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'promptame-')), 'store.json');
  const s1 = createJsonStore(file);
  createRanking(s1).record({ reason: 'timeup', winnerId: 'pa', a: A(3), b: B(1) });
  createSeen(s1).add('devA-0001', [1, 2, 3]);
  s1.flush();
  const s2 = createJsonStore(file);
  assert.equal(createRanking(s2).me('devA-0001').rp, 25);
  assert.deepEqual(createSeen(s2).ids('devA-0001'), [1, 2, 3]);
  fs.writeFileSync(file, '{깨진 파일');
  assert.equal(createRanking(createJsonStore(file)).top().length, 0);
});

test('본 문제 기록: 중복 없이 이어 붙이고 기기당 80개까지만 보관한다', () => {
  const seen = createSeen(createJsonStore(null));
  seen.add('d1', [1, 2, 3]);
  seen.add('d1', [3, 4]);
  assert.deepEqual(seen.ids('d1'), [1, 2, 3, 4]);
  seen.add('d1', Array.from({ length: 100 }, (_, i) => 100 + i));
  assert.equal(seen.ids('d1').length, 80);
  assert.deepEqual(seen.ids('nobody'), []);
});

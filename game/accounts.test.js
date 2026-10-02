// 실행: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJsonStore } from './jsonStore.js';
import { createSeen } from './seen.js';
import { createRanking } from './ranking.js';
import { createAccounts, ECON } from './accounts.js';
import { verifyGoogleIdToken, GoogleAuthError } from './googleAuth.js';

function setup(opts = {}) {
  const store = createJsonStore(null);
  const ranking = createRanking(store);
  const seen = createSeen(store);
  let t = Date.UTC(2026, 9, 3, 9, 0, 0);
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const accounts = createAccounts(store, { ranking, seen, now: clock.now, random: opts.random ?? (() => 0) });
  return { store, ranking, seen, accounts, clock };
}
const guest = (a, nickname) => a.createGuest({ nickname }).account;

test('게스트 계정: 토큰으로 다시 들어오고, 로그아웃하면 못 들어온다', () => {
  const { accounts } = setup();
  const r = accounts.createGuest({ nickname: '냥이' });
  assert.equal(r.ok, true);
  assert.equal(r.account.kind, 'guest');
  assert.equal(r.account.nickname, '냥이');
  assert.equal(r.account.coins, ECON.START_COINS);
  assert.deepEqual(r.account.owned, ['cat']);
  assert.equal(accounts.byToken(r.token).id, r.account.id);
  assert.equal(accounts.byToken('엉터리토큰엉터리토큰엉터리토큰'), null);
  accounts.logout(r.token);
  assert.equal(accounts.byToken(r.token), null);
});

test('나쁜 닉네임은 기본 이름이 되고, 토큰은 해시만 저장한다', () => {
  const { accounts, store } = setup();
  const r = accounts.createGuest({ nickname: '씨발' });
  assert.equal(r.account.nickname, '익명의 고수');
  assert.equal(JSON.stringify(store.data).includes(r.token), false);
});

test('토큰은 90일이 지나면 만료되고, 한 계정에 5개까지만 둔다', () => {
  const { accounts, clock } = setup();
  const r = accounts.createGuest({});
  clock.advance(91 * 24 * 3600 * 1000);
  assert.equal(accounts.byToken(r.token), null);
  const g = accounts.loginGoogle({ sub: 'g1', name: '구글' }, {});
  const tokens = [g.token];
  for (let i = 0; i < 6; i++) tokens.push(accounts.loginGoogle({ sub: 'g1', name: '구글' }, {}).token);
  assert.equal(accounts.byToken(tokens[0]), null); // 가장 오래된 토큰은 밀려났다
  assert.ok(accounts.byToken(tokens.at(-1)));
});

test('구글 로그인: 새 계정, 같은 구글로 다시 로그인, 게스트를 구글 계정으로 승격', () => {
  const { accounts } = setup();
  const a = accounts.loginGoogle({ sub: 'sub-1', name: '김구글' }, {});
  assert.equal(a.account.kind, 'google');
  assert.equal(a.account.nickname, '김구글');
  const again = accounts.loginGoogle({ sub: 'sub-1', name: '김구글' }, {});
  assert.equal(again.account.id, a.account.id);

  const g = guest(accounts, '게스트');
  g.coins = 77;
  const up = accounts.loginGoogle({ sub: 'sub-2', name: '이구글' }, { current: g });
  assert.equal(up.linked, true);
  assert.equal(up.account.id, g.id); // 기록이 그대로 이어진다
  assert.equal(up.account.kind, 'google');
  assert.equal(up.account.coins, 77);
  assert.equal(up.account.nickname, '게스트');

  const g2 = guest(accounts, '다른게스트');
  const sw = accounts.loginGoogle({ sub: 'sub-1', name: '김구글' }, { current: g2 });
  assert.equal(sw.account.id, a.account.id); // 이미 있는 구글 계정으로 전환
  assert.equal(sw.switched, true);
});

test('이전 기기 ID로 쌓은 랭킹과 본 문제 기록을 계정으로 옮긴다', () => {
  const { accounts, ranking, seen } = setup();
  ranking.record({ reason: 'timeup', winnerId: 'a', a: { id: 'a', device: 'old-device-1', name: '에이', char: 'cat', score: 3 }, b: { id: 'b', device: 'old-device-2', name: '비이', char: 'dog', score: 0 } });
  seen.add('old-device-1', [1, 2]);
  const acc = accounts.createGuest({ legacyDevice: 'old-device-1' }).account;
  assert.equal(ranking.me(acc.id).rp, 25);
  assert.equal(ranking.me('old-device-1'), null);
  assert.deepEqual(seen.ids(acc.id), [1, 2]);
});

test('닉네임과 캐릭터 변경: 규칙을 지키고, 가진 캐릭터만 고를 수 있다', () => {
  const { accounts } = setup();
  const acc = guest(accounts, '냥이');
  assert.equal(accounts.update(acc, { nickname: '씨발' }).ok, false);
  assert.equal(accounts.update(acc, { nickname: '가' }).ok, false);
  assert.equal(accounts.update(acc, { nickname: '새닉네임' }).ok, true);
  assert.equal(acc.nickname, '새닉네임');
  assert.equal(accounts.update(acc, { char: 'dog' }).ok, false);
  assert.equal(accounts.update(acc, { char: '없는캐릭터' }).ok, false);
});

test('상점 구매와 뽑기: 재화가 모자라면 안 되고, 안 가진 캐릭터만 나온다', () => {
  const { accounts } = setup({ random: () => 0 });
  const acc = guest(accounts, '냥이');
  assert.equal(accounts.buy(acc, 'dog').ok, false); // 30 < 120
  assert.equal(accounts.gacha(acc).ok, false); // 30 < 50
  acc.coins = 300;
  const b = accounts.buy(acc, 'dog');
  assert.equal(b.ok, true);
  assert.equal(acc.coins, 300 - ECON.BUY_PRICE);
  assert.equal(accounts.buy(acc, 'dog').ok, false); // 이미 있음
  const g = accounts.gacha(acc);
  assert.equal(g.ok, true);
  assert.ok(['pigeon', 'otaku'].includes(g.char));
  assert.equal(g.odds, 2);
  assert.equal(accounts.update(acc, { char: 'dog' }).ok, true);
  acc.coins = 1000;
  accounts.gacha(acc);
  assert.equal(accounts.gacha(acc).ok, false); // 다 모았다
  assert.equal(acc.owned.length, 4);
});

const P = (id, accountId, name, score, log = []) => ({ id, accountId, name, score, firstTry: score, bestStreak: score, log });
const entry = (prompt, attempt, pass, reasons = []) => ({ prompt, attempt, pass, reasons, difficulty: '보통' });

test('판 정산: 성적, 최근 경기, 프롬프트 기록, 재화(승리 +30, PASS 보너스)', () => {
  const { accounts } = setup();
  const a = guest(accounts, '에이');
  const b = guest(accounts, '비이');
  const rk = { pa: { counted: true, delta: 25 }, pb: { counted: true, delta: 0 } };
  const out = accounts.settle({
    reason: 'timeup', winnerId: 'pa', vsBot: false, difficulty: '보통', ranking: rk,
    players: [P('pa', a.id, '에이', 3, [entry('나는 교사야', 1, true)]), P('pb', b.id, '비이', 1, [entry('알려줘', 1, false, ['KEYWORD_SHORT'])])],
  });
  assert.deepEqual([out.pa.coins, out.pb.coins], [ECON.WIN + 3, ECON.LOSS + 1]);
  assert.equal(a.coins, ECON.START_COINS + ECON.WIN + 3);
  assert.deepEqual([a.stats.games, a.stats.wins, a.stats.passes, a.stats.firstTry, a.stats.bestStreak], [1, 1, 3, 3, 3]);
  assert.deepEqual([b.stats.losses, b.stats.retries], [1, 1]);
  assert.equal(a.games[0].outcome, 'win');
  assert.equal(a.games[0].vs, '비이');
  assert.equal(a.games[0].rp, 25);
  assert.equal(a.habit.length, 1);
  assert.deepEqual(a.habit[0].f, ['role']);
});

test('포기: 포기한 쪽은 참가비 -10(0 밑으로는 안 내려감), 이긴 쪽은 +15', () => {
  const { accounts } = setup();
  const a = guest(accounts, '에이');
  const b = guest(accounts, '비이');
  b.coins = 4;
  const rk = { pa: { counted: true, delta: 12 }, pb: { counted: true, delta: -15 } };
  const out = accounts.settle({ reason: 'forfeit', winnerId: 'pa', leaverId: 'pb', vsBot: false, ranking: rk, players: [P('pa', a.id, '에이', 0), P('pb', b.id, '비이', 0)] });
  assert.equal(out.pa.coins, ECON.FORFEIT_WIN);
  assert.equal(out.pb.coins, -4);
  assert.equal(b.coins, 0);
});

test('재화가 없는 판: 연습봇, 반영 안 된 판, 무효 판, 하루 상한', () => {
  const { accounts, clock } = setup();
  const a = guest(accounts, '에이');
  const bot = { id: 'bot', accountId: null, name: '연습봇', score: 0, log: [] };
  let out = accounts.settle({ reason: 'timeup', winnerId: 'pa', vsBot: true, ranking: null, players: [P('pa', a.id, '에이', 2, [entry('x', 1, true)]), bot] });
  assert.equal(out.pa.coins, 0);
  assert.equal(a.stats.botGames, 1);
  assert.equal(a.habit.length, 1); // 습관 기록은 연습봇 판에서도 남는다
  const b = guest(accounts, '비이');
  out = accounts.settle({ reason: 'timeup', winnerId: 'pa', ranking: { pa: { counted: false, note: 'PASS가 너무 적은 판이에요' }, pb: { counted: false, note: 'x' } }, players: [P('pa', a.id, '에이', 0), P('pb', b.id, '비이', 0)] });
  assert.equal(out.pa.coins, 0);
  assert.equal(out.pa.note, 'PASS가 너무 적은 판이에요');
  assert.deepEqual(accounts.settle({ reason: 'aborted', players: [P('pa', a.id, '에이', 0)] }), {});
  const before = a.stats.games;
  assert.equal(a.stats.games, before);
  const rk = { pa: { counted: true, delta: 5 }, pb: { counted: true, delta: 5 } };
  const coinsAt = a.coins;
  for (let i = 0; i < ECON.DAILY_GAMES; i++) accounts.settle({ reason: 'timeup', winnerId: null, ranking: rk, players: [P('pa', a.id, '에이', 1), P('pb', b.id, '비이', 1)] });
  const full = accounts.settle({ reason: 'timeup', winnerId: null, ranking: rk, players: [P('pa', a.id, '에이', 1), P('pb', b.id, '비이', 1)] });
  assert.equal(full.pa.coins, 0);
  assert.match(full.pa.note, /오늘은/);
  assert.equal(a.coins, coinsAt + ECON.DAILY_GAMES * (ECON.DRAW + 1));
  clock.advance(24 * 3600 * 1000);
  assert.ok(accounts.settle({ reason: 'timeup', winnerId: null, ranking: rk, players: [P('pa', a.id, '에이', 1), P('pb', b.id, '비이', 1)] }).pa.coins > 0); // 다음 날은 다시
});

test('프롬프트 기록은 300개까지, 본문은 최근 100개만 남기고, 최근 경기는 30개까지', () => {
  const { accounts } = setup();
  const a = guest(accounts, '에이');
  for (let i = 0; i < 35; i++) {
    accounts.settle({ reason: 'timeup', winnerId: null, vsBot: true, players: [P('pa', a.id, '에이', 0, Array.from({ length: 10 }, (_, k) => entry(`프롬프트 ${i}-${k}`, 1, false, ['KEYWORD_SHORT']))), { id: 'bot', accountId: null, name: '봇', score: 0, log: [] }] });
  }
  assert.equal(a.habit.length, 300);
  assert.equal(a.habit.filter((e) => e.text).length, 100);
  assert.equal(a.games.length, 30);
  const rep = accounts.report(a);
  assert.equal(rep.habit.enough, true);
  assert.equal(rep.recent.length, 10);
});

test('기록 지우기와 계정 삭제(랭킹과 토큰까지)', () => {
  const { accounts, ranking } = setup();
  const r = accounts.createGuest({ nickname: '냥이' });
  const a = r.account;
  const bot = { id: 'bot', accountId: null, name: '봇', score: 0, log: [] };
  accounts.settle({ reason: 'timeup', winnerId: 'pa', vsBot: true, players: [P('pa', a.id, '냥이', 1, [entry('x', 1, true)]), bot] });
  accounts.clearHistory(a);
  assert.deepEqual([a.habit.length, a.games.length], [0, 0]);
  assert.equal(a.stats.games, 1); // 성적 숫자는 남는다
  ranking.record({ reason: 'timeup', winnerId: 'pa', a: { id: 'pa', device: a.id, name: '냥이', char: 'cat', score: 3 }, b: { id: 'pb', device: 'other-0001', name: '비이', char: 'dog', score: 0 } });
  assert.ok(ranking.me(a.id));
  accounts.remove(a);
  assert.equal(accounts.byToken(r.token), null);
  assert.equal(accounts.get(a.id), null);
  assert.equal(ranking.me(a.id), null);
});

test('구글 ID 토큰 확인: 대상, 발급자, 만료를 검사한다', async () => {
  const info = { aud: 'client-1', iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 600), sub: '123', name: '김구글' };
  const f = (body, ok = true) => async () => ({ ok, json: async () => body });
  const opts = (body, ok) => ({ clientId: 'client-1', fetchImpl: f(body, ok) });
  const tok = 'x'.repeat(40);
  assert.deepEqual(await verifyGoogleIdToken(tok, opts(info)), { sub: '123', name: '김구글' });
  const fails = async (o, code) => await assert.rejects(() => verifyGoogleIdToken(tok, o), (e) => e instanceof GoogleAuthError && e.code === code);
  await fails(opts({ ...info, aud: 'other' }), 'AUDIENCE');
  await fails(opts({ ...info, iss: 'evil.example' }), 'INVALID');
  await fails(opts({ ...info, exp: '1' }), 'EXPIRED');
  await fails(opts({ ...info, sub: '' }), 'INVALID');
  await fails(opts({}, false), 'INVALID');
  await fails({ clientId: '', fetchImpl: f(info) }, 'NOT_CONFIGURED');
  await fails({ clientId: 'client-1', fetchImpl: async () => { throw new Error('offline'); } }, 'NETWORK');
  await assert.rejects(() => verifyGoogleIdToken('짧음', opts(info)), (e) => e.code === 'INVALID');
});

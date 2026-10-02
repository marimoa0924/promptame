// 방 규칙 검증: 소켓 없이 가짜 io와 가짜 AI로 판 진행을 돌려 본다. 실행: node --test
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from './room.js';
import { createJsonStore } from './jsonStore.js';
import { createSeen } from './seen.js';
import { createRanking } from './ranking.js';
import { createAccounts, ECON } from './accounts.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rooms = [];
afterEach(() => {
  for (const r of rooms.splice(0)) r.close();
});
const FAST = { countdownMs: 20, replayTickMs: 1, judgeBaseMs: 5, judgePerLineMs: 1, endGraceMs: 600, waitTtlMs: 600_000, submitGapMs: 0, rematchMs: 600_000 };

// 프롬프트에 XQZ1이 들어 있으면 필수어를 모두 담은 짧은 답, XQZ2도 있으면 분량 초과, 그 외에는 필수어 없는 답
// (영어 PASS는 어떤 문제의 금지어와 겹쳐서 쓰지 않는다)
function fakeAI({ delay = 0, status = 'OK' } = {}) {
  return {
    kind: 'fake',
    async generate(prompt, { problem }) {
      await sleep(delay);
      if (status !== 'OK') return { status, text: '', truncated: false, finishReason: 'X', latencyMs: 0, usage: null };
      let text = '관련 없는 답이에요';
      if (prompt.includes('XQZ1')) text = problem.keywords.join(' ');
      if (prompt.includes('XQZ2')) text = `${problem.keywords.join(' ')}. 하나. 둘. 셋. 넷. 다섯.`.repeat(30);
      return { status: 'OK', text, truncated: false, finishReason: 'STOP', latencyMs: delay, usage: null };
    },
  };
}

function setup({ settings = {}, ai = fakeAI(), timing = FAST, hooks = {}, devices = {} } = {}) {
  const log = [];
  const io = {
    to: (target) => ({ emit: (ev, payload) => log.push({ target, ev, payload }) }),
    in: () => ({ socketsLeave() {} }),
  };
  let closed = false;
  const room = new Room(io, 'ABCDEF', { title: 't', difficulty: 'easy', map: 'east', timeLimit: 60, promptLimit: 100, ...settings }, () => (closed = true), ai, timing, hooks);
  rooms.push(room);
  const sock = (id) => ({ id, join() {}, data: {} });
  const A = sock('sA'), B = sock('sB');
  room.join(A, 'pA', { name: '에이', char: 'cat', device: devices.pA });
  room.join(B, 'pB', { name: '비이', char: 'dog', device: devices.pB });
  return { room, log, A, B, isClosed: () => closed, events: (ev) => log.filter((l) => l.ev === ev) };
}
// 조건이 될 때까지 기다린다 (고정 시간 대기는 느린 컴퓨터에서 흔들린다)
async function until(cond, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('기다리던 조건이 안 됐어요');
    await sleep(2);
  }
}
const playing = (ctx) => until(() => ctx.room.state === 'playing');
// 진행 중인 AI 요청이 모두 끝날 때까지
const answered = (ctx) => until(() => ![...ctx.room.players.values()].some((p) => p.busy));

test('두 사람이 들어오면 카운트다운 뒤 시작하고, 같은 순서의 문제를 받는다', async () => {
  const c = setup();
  assert.equal(c.room.state, 'countdown');
  await playing(c);
  const [a, b] = [...c.room.players.values()];
  assert.equal(c.room.topicOf(a).problem.id, c.room.topicOf(b).problem.id);
  assert.equal(c.room.sequence.length, 40);
  assert.ok(c.room.sequence.every((x) => x.problem.difficulty === '쉬움'));
  assert.equal(c.room.endsAt - c.room.startedAt, 60_000);
});

test('상대의 프롬프트는 판이 끝날 때까지 보내지 않는다', async () => {
  const c = setup();
  await playing(c);
  c.room.submit('pA', 'XQZ1 설명해줘');
  const toB = c.log.filter((l) => l.target === 'sB' && l.ev === 'ai:start').at(-1);
  const toA = c.log.filter((l) => l.target === 'sA' && l.ev === 'ai:start').at(-1);
  assert.equal(toB.payload.prompt, null);
  assert.equal(toA.payload.prompt, 'XQZ1 설명해줘');
  const snapB = c.room.snapshot('pB').players.find((p) => p.id === 'pA');
  assert.equal(snapB.live.prompt, null);
  assert.equal(c.room.snapshot('pA').players.find((p) => p.id === 'pA').live.prompt, 'XQZ1 설명해줘');
});

test('금지어, 빈 입력, 길이 초과는 전송으로 세지 않는다', async () => {
  const c = setup({ settings: { promptLimit: 50 } });
  await playing(c);
  const a = c.room.players.get('pA');
  const word = c.room.topicOf(a).problem.topic;
  for (const text of [`${word} 알려줘`, '   ', '가'.repeat(51)]) assert.equal(c.room.submit('pA', text).ok, false);
  assert.equal(a.attempts, 0);
  assert.equal(a.busy, false);
});

test('PASS하면 그 사람만 다음 문제로 넘어가고 점수를 얻는다', async () => {
  const c = setup();
  await playing(c);
  c.room.submit('pA', 'XQZ1 설명');
  await answered(c);
  const [a, b] = [...c.room.players.values()];
  assert.equal(a.score, 1);
  assert.equal(a.topicIdx, 1);
  assert.equal(a.streak, 1);
  assert.equal(b.topicIdx, 0);
  assert.equal(b.score, 0);
});

test('RETRY는 같은 문제에 계속 다시 쓸 수 있고, RETRY 뒤 PASS는 연속에 안 들어간다', async () => {
  const c = setup();
  await playing(c);
  const a = c.room.players.get('pA');
  c.room.submit('pA', '엉뚱한 말');
  await answered(c);
  assert.equal(a.topicIdx, 0);
  assert.equal(a.attempts, 1);
  c.room.submit('pA', 'XQZ1 다시');
  await answered(c);
  assert.equal(a.score, 1);
  assert.equal(a.streak, 0);
  assert.equal(a.attempts, 0);
});

test('분량을 넘기면 필수어가 있어도 RETRY', async () => {
  const c = setup();
  await playing(c);
  c.room.submit('pA', 'XQZ1 XQZ2');
  await answered(c);
  const r = c.events('ai:result').at(-1).payload;
  assert.equal(r.pass, false);
  assert.ok(r.verdict.reasons.includes('LENGTH_OVER'));
});

test('한 번에 맞힌 PASS 3연속이면 상대 입력이 5초 멈추고 내 카운트는 0이 된다', async () => {
  const c = setup();
  await playing(c);
  const [a, b] = [...c.room.players.values()];
  for (let i = 0; i < 3; i++) {
    assert.equal(c.room.submit('pA', 'XQZ1').ok, true);
    await answered(c);
  }
  assert.equal(a.score, 3);
  assert.equal(a.streak, 0);
  assert.ok(b.frozenUntil - Date.now() > 4000 && b.frozenUntil - Date.now() <= 5000);
  assert.equal(c.events('game:event').at(-1).payload.type, 'freeze');
  assert.equal(c.room.submit('pB', 'XQZ1').ok, false); // 얼음 중에는 못 보낸다
  assert.equal(c.room.snapshot('pA').players[0].streak, 0);
});

test('건너뛰기: 점수 없이 내 문제만 넘어가고 연속이 0이 되며 3초 멈춘다', async () => {
  const c = setup();
  await playing(c);
  const [a, b] = [...c.room.players.values()];
  c.room.submit('pA', 'XQZ1');
  await answered(c);
  assert.equal(a.streak, 1);
  assert.equal(c.room.skip('pA').ok, true);
  assert.equal(a.topicIdx, 2);
  assert.equal(a.score, 1);
  assert.equal(a.streak, 0);
  assert.equal(a.frozenKind, 'skip');
  assert.equal(c.room.skip('pA').ok, false); // 멈춰 있는 동안은 또 못 한다
  assert.equal(b.topicIdx, 0);
});

test('AI가 끝내 답하지 못하면 시도로 세지 않고 다시 보낼 수 있다', async () => {
  const c = setup({ ai: fakeAI({ status: 'ERROR' }) });
  await playing(c);
  const a = c.room.players.get('pA');
  c.room.submit('pA', 'XQZ1');
  await until(() => c.events('ai:void').length === 1, 5000); // 재시도 두 번의 대기
  assert.equal(c.events('ai:void').length, 1);
  assert.equal(a.attempts, 0);
  assert.equal(a.busy, false);
  assert.equal(a.live, null);
});

test('시간이 끝나기 전에 보낸 요청은 유예 안에 끝나면 점수에 들어가고, 이후 전송은 거절한다', async () => {
  const c = setup({ settings: { timeLimit: 0.5 }, ai: fakeAI({ delay: 700 }), timing: { ...FAST, endGraceMs: 3000 } });
  await playing(c);
  assert.equal(c.room.submit('pA', 'XQZ1').ok, true);
  await until(() => c.room.closing); // 시간이 끝났다
  assert.equal(c.room.state, 'playing'); // 아직 유예 중
  assert.equal(c.room.submit('pB', 'XQZ1').ok, false);
  await until(() => c.room.state === 'ended');
  assert.equal(c.room.players.get('pA').score, 1);
  assert.equal(c.events('game:end').at(-1).payload.winnerId, 'pA');
  assert.equal(c.events('game:end').at(-1).payload.reason, 'timeup');
});

test('유예가 지나도 안 온 요청은 버리고 끝낸다', async () => {
  const c = setup({ settings: { timeLimit: 0.3 }, ai: fakeAI({ delay: 3000 }), timing: { ...FAST, endGraceMs: 200 } });
  await playing(c);
  c.room.submit('pA', 'XQZ1');
  await until(() => c.room.state === 'ended');
  assert.equal(c.room.players.get('pA').score, 0);
});

test('점수가 같으면 무승부(0 대 0 포함)', async () => {
  const c = setup({ settings: { timeLimit: 0.1 } });
  await until(() => c.room.state === 'ended');
  assert.equal(c.events('game:end').at(-1).payload.winnerId, null);
});

test('게임 중에 나가면 상대가 승리한다', async () => {
  const c = setup();
  await playing(c);
  c.room.leave('pA');
  const end = c.events('game:end').at(-1).payload;
  assert.equal(end.reason, 'forfeit');
  assert.equal(end.winnerId, 'pB');
  assert.equal(end.leaverId, 'pA');
});

test('카운트다운 중에 나가면 판이 무효다(승패 없음)', async () => {
  const c = setup({ timing: { ...FAST, countdownMs: 200 } });
  assert.equal(c.room.state, 'countdown');
  c.room.leave('pB');
  assert.equal(c.room.state, 'waiting');
  assert.equal(c.events('game:end').length, 0);
  await sleep(250);
  assert.equal(c.room.state, 'waiting'); // 예약된 시작이 취소됐다
});

test('한 번 더 하기는 양쪽이 모두 눌러야 시작하고, 이미 나온 문제는 피한다', async () => {
  const c = setup({ settings: { timeLimit: 0.6 } });
  await playing(c);
  c.room.submit('pA', 'XQZ1'); // A는 두 번째 문제까지 도달
  await answered(c);
  await until(() => c.room.state === 'ended');
  const seen = c.room.sequence.slice(0, 2).map((x) => x.problem.id);
  assert.equal(c.room.rematch('pA').ok, true);
  assert.equal(c.room.state, 'ended'); // 한쪽만 누르면 시작하지 않는다
  c.room.rematch('pB');
  assert.equal(c.room.state, 'countdown');
  assert.equal(c.room.players.get('pA').score, 0);
  assert.equal(c.room.sequence.slice(0, 18).filter((x) => seen.includes(x.problem.id)).length, 0);
});

test('상대가 안 들어온 대기방은 시간이 지나면 닫힌다', async () => {
  const log = [];
  let closed = false;
  const io = { to: () => ({ emit: (ev) => log.push(ev) }), in: () => ({ socketsLeave() {} }) };
  rooms.push(new Room(io, 'ZZZZZZ', { timeLimit: 60, difficulty: 'easy' }, () => (closed = true), fakeAI(), { ...FAST, waitTtlMs: 30 }));
  await sleep(80);
  assert.equal(closed, true);
  assert.ok(log.includes('room:closed'));
});

test('같은 playerId가 다시 들어오면 재접속으로 처리한다', async () => {
  const c = setup();
  await playing(c);
  const a = c.room.players.get('pA');
  c.room.socketDropped('pA', 'sA');
  assert.equal(a.connected, false);
  const res = c.room.join({ id: 'sA2', join() {}, data: {} }, 'pA', {});
  assert.equal(res.ok, true);
  assert.equal(a.connected, true);
  assert.equal(a.socketId, 'sA2');
  assert.equal(c.room.join({ id: 'sC', join() {}, data: {} }, 'pC', { name: '씨', char: 'cat' }).ok, false); // 가득 참
});

test('이전 판에서 본 문제는 다음 방에서 먼저 피한다(기기 기준)', async () => {
  const store = createJsonStore(null);
  const hooks = { seen: createSeen(store), ranking: createRanking(store) };
  const devices = { pA: 'devA-0001', pB: 'devB-0001' };
  const c1 = setup({ hooks, devices, settings: { timeLimit: 0.6 } });
  await playing(c1);
  for (let i = 0; i < 3; i++) {
    c1.room.submit('pA', 'XQZ1');
    await answered(c1);
  }
  await until(() => c1.room.state === 'ended');
  const seenA = hooks.seen.ids('devA-0001');
  assert.equal(seenA.length, 4); // 풀어서 지나간 3문제와 지금 풀던 문제
  assert.deepEqual(seenA, c1.room.sequence.slice(0, 4).map((x) => x.problem.id));
  assert.equal(hooks.seen.ids('devB-0001').length, 1); // B는 첫 문제만 봤다

  const c2 = setup({ hooks, devices, settings: { timeLimit: 5 } });
  await playing(c2);
  const first = c2.room.sequence.slice(0, 16).map((x) => x.problem.id); // 쉬움 20개 중 A가 본 4개를 뺀 16개가 먼저 나온다
  assert.equal(first.filter((id) => seenA.includes(id)).length, 0);
  assert.equal(new Set(first).size, 16);
});

test('판이 끝나면 랭크 점수가 정산되어 결과에 실린다', async () => {
  const store = createJsonStore(null);
  const hooks = { seen: createSeen(store), ranking: createRanking(store) };
  const devices = { pA: 'devA-0001', pB: 'devB-0001' };
  const c = setup({ hooks, devices, settings: { timeLimit: 0.6 } });
  await playing(c);
  for (let i = 0; i < 3; i++) {
    c.room.submit('pA', 'XQZ1');
    await answered(c);
  }
  await until(() => c.room.state === 'ended');
  const end = c.events('game:end').at(-1).payload;
  assert.equal(end.ranking.pA.counted, true);
  assert.equal(end.ranking.pA.delta, 25);
  assert.equal(end.ranking.pB.delta, 0); // 0점에서는 더 안 내려간다
  assert.equal(hooks.ranking.me('devA-0001').rp, 25);
  assert.equal(hooks.ranking.top()[0].name, '에이');
  assert.equal(JSON.stringify(end.ranking).includes('devA-0001'), false); // 기기 ID는 안 나간다
});

test('튜토리얼과 연습봇 판은 랭킹에 반영하지 않는다', async () => {
  const store = createJsonStore(null);
  const hooks = { seen: createSeen(store), ranking: createRanking(store) };
  const log = [];
  const io = { to: () => ({ emit: (ev, p) => log.push({ ev, p }) }), in: () => ({ socketsLeave() {} }) };
  const room = new Room(io, 'TUTOR2', { tutorial: true, difficulty: 'normal', timeLimit: 0.2, promptLimit: 150, map: 'east', title: 't' }, () => {}, fakeAI(), FAST, hooks);
  rooms.push(room);
  room.join({ id: 's', join() {}, data: {} }, 'pT', { name: '나', char: 'cat', device: 'devT-0001' });
  await until(() => room.state === 'ended');
  assert.equal(hooks.ranking.top().length, 0);
  assert.deepEqual(hooks.seen.ids('devT-0001'), []);
});

test('전송 최소 간격보다 빨리 다시 보내면 거절한다', async () => {
  const c = setup({ timing: { ...FAST, submitGapMs: 300 } });
  await playing(c);
  assert.equal(c.room.submit('pA', '엉뚱한 말').ok, true);
  await answered(c);
  const fast = c.room.submit('pA', '엉뚱한 말 둘');
  assert.equal(fast.ok, false);
  assert.match(fast.error, /너무 빨라요/);
  assert.equal(c.room.players.get('pA').attempts, 1); // 거절된 전송은 시도로 세지 않는다
  await sleep(320);
  assert.equal(c.room.submit('pA', '엉뚱한 말 셋').ok, true);
});

test('판이 끝나면 두 사람이 보낸 프롬프트가 결과에 공개된다(그 전에는 상대 것을 안 준다)', async () => {
  const c = setup({ settings: { timeLimit: 0.6 } });
  await playing(c);
  c.room.submit('pA', 'XQZ1 첫 프롬프트');
  await answered(c);
  c.room.submit('pB', '엉뚱한 말');
  await answered(c);
  assert.equal(c.room.snapshot('pA').lastResult, null); // 아직 진행 중
  await until(() => c.room.state === 'ended');
  const h = c.events('game:end').at(-1).payload.history;
  assert.deepEqual(h.map((x) => x.name), ['에이', '비이']);
  assert.equal(h[0].entries[0].prompt, 'XQZ1 첫 프롬프트');
  assert.equal(h[0].entries[0].pass, true);
  assert.equal(h[1].entries[0].pass, false);
  assert.ok(h[0].entries[0].topic && h[0].entries[0].answer);
});

test('평가 연출용으로 필수어 위치와 분량 초과 위치를 함께 보낸다', async () => {
  const c = setup();
  await playing(c);
  c.room.submit('pA', 'XQZ1 XQZ2');
  await answered(c);
  const j = c.events('ai:judge').at(-1).payload;
  assert.ok(j.len > 0);
  assert.ok(j.marks.length > 0 && j.marks.every((m) => m.start >= 0 && m.end > m.start && m.end <= j.len));
  assert.equal(typeof j.over, 'number'); // 분량을 넘겼다
  c.room.submit('pA', 'XQZ1');
  await answered(c);
  assert.equal(c.events('ai:judge').at(-1).payload.over, null); // 넘지 않았다
});

test('AI 재시도 중에는 전송한 사람에게 알린다', async () => {
  const c = setup({ ai: fakeAI({ status: 'ERROR' }) });
  await playing(c);
  c.room.submit('pA', 'XQZ1');
  await until(() => c.events('ai:void').length === 1, 5000);
  const retries = c.events('ai:retrying');
  assert.deepEqual(retries.map((r) => r.payload.n), [1, 2]);
  assert.ok(retries.every((r) => r.target === 'sA'));
});

test('두 사람이 모두 끊겨 있으면 판이 무효가 되고 랭킹에 반영되지 않는다', async () => {
  const store = createJsonStore(null);
  const hooks = { seen: createSeen(store), ranking: createRanking(store) };
  const c = setup({ hooks, devices: { pA: 'devA-0001', pB: 'devB-0001' } });
  await playing(c);
  c.room.socketDropped('pA', 'sA');
  c.room.socketDropped('pB', 'sB');
  c.room.leave('pA'); // 먼저 시간이 지난 쪽
  const end = c.events('game:end').at(-1).payload;
  assert.equal(end.reason, 'aborted');
  assert.equal(end.winnerId, null);
  assert.equal(end.ranking, undefined);
  assert.equal(hooks.ranking.top().length, 0);
});

test('한 번 더 하기 요청은 시간 안에 응답이 없으면 취소된다', async () => {
  const c = setup({ settings: { timeLimit: 0.1 }, timing: { ...FAST, rematchMs: 80 } });
  await until(() => c.room.state === 'ended');
  c.room.rematch('pA');
  assert.equal(c.room.players.get('pA').ready, true);
  await until(() => c.events('rematch:expired').length === 1);
  assert.equal(c.room.players.get('pA').ready, false);
  assert.equal(c.room.state, 'ended');
  c.room.rematch('pA'); // 다시 요청할 수 있다
  c.room.rematch('pB');
  assert.equal(c.room.state, 'countdown');
});

test('판이 끝나면 계정별 성적, 프롬프트 기록, 재화가 정산되어 결과에 실린다', async () => {
  const store = createJsonStore(null);
  const ranking = createRanking(store);
  const seen = createSeen(store);
  const accounts = createAccounts(store, { ranking, seen });
  const a = accounts.createGuest({ nickname: '에이' }).account;
  const b = accounts.createGuest({ nickname: '비이' }).account;
  const c = setup({ hooks: { seen, ranking, accounts }, devices: { pA: a.id, pB: b.id }, settings: { timeLimit: 0.6 } });
  await playing(c);
  c.room.submit('pA', '엉뚱한 말'); // RETRY
  await answered(c);
  for (let i = 0; i < 3; i++) {
    c.room.submit('pA', '나는 교사야 XQZ1');
    await answered(c);
  }
  await until(() => c.room.state === 'ended');
  const end = c.events('game:end').at(-1).payload;
  assert.equal(end.rewards.pA.coins, ECON.WIN + 3);
  assert.equal(end.rewards.pB.coins, ECON.LOSS);
  assert.equal(a.coins, ECON.START_COINS + ECON.WIN + 3);
  assert.deepEqual([a.stats.games, a.stats.wins, a.stats.passes, a.stats.retries], [1, 1, 3, 1]);
  assert.equal(a.stats.firstTry, 2); // 첫 문제는 RETRY 뒤 PASS라서 한 번에 맞힌 것은 2개
  assert.equal(a.stats.bestStreak, 2);
  assert.equal(a.habit.length, 4);
  assert.ok(a.habit.some((e) => e.f.includes('role')));
  assert.equal(a.games[0].vs, '비이');
  assert.equal(b.stats.losses, 1);
});

test('연습봇과 한 판은 성적과 프롬프트 기록은 남기고 재화와 랭킹은 없다', async () => {
  const store = createJsonStore(null);
  const hooks = { seen: createSeen(store), ranking: createRanking(store) };
  hooks.accounts = createAccounts(store, hooks);
  const a = hooks.accounts.createGuest({ nickname: '에이' }).account;
  const log = [];
  const io = { to: () => ({ emit: (ev, p) => log.push({ ev, p }) }), in: () => ({ socketsLeave() {} }) };
  const room = new Room(io, 'BOT111', { difficulty: 'easy', timeLimit: 0.4, promptLimit: 100, map: 'east', title: 't' }, () => {}, fakeAI(), FAST, hooks);
  rooms.push(room);
  room.join({ id: 's', join() {}, data: {} }, 'pA', { name: '에이', char: 'cat', device: a.id });
  room.addBot();
  await until(() => room.state === 'playing');
  room.submit('pA', 'XQZ1');
  await until(() => room.state === 'ended');
  const end = log.filter((l) => l.ev === 'game:end').at(-1).p;
  assert.equal(end.rewards.pA.coins, 0);
  assert.equal(end.ranking, undefined);
  assert.equal(a.stats.botGames, 1);
  assert.ok(a.habit.length >= 1);
  assert.equal(hooks.ranking.top().length, 0);
});

test('솔로: 상대 없이 혼자 시작하고, 끝나면 이기고 지는 것 없이 솔로 기록이 남는다', async () => {
  const store = createJsonStore(null);
  const hooks = { seen: createSeen(store), ranking: createRanking(store) };
  hooks.accounts = createAccounts(store, hooks);
  const a = hooks.accounts.createGuest({ nickname: '혼자' }).account;
  const log = [];
  const io = { to: (target) => ({ emit: (ev, p) => log.push({ target, ev, p }) }), in: () => ({ socketsLeave() {} }) };
  const room = new Room(io, 'SOLO11', { difficulty: 'easy', timeLimit: 0.6, promptLimit: 100, map: 'east', title: '솔로', solo: true }, () => {}, fakeAI(), FAST, hooks);
  rooms.push(room);
  assert.equal(room.addBot().ok, false); // 솔로에서는 연습봇을 부를 수 없다
  room.join({ id: 's', join() {}, data: {} }, 'pA', { name: '혼자', char: 'cat', device: a.id });
  assert.equal(room.state, 'countdown'); // 혼자라도 바로 시작한다
  await until(() => room.state === 'playing');
  for (let i = 0; i < 3; i++) {
    room.submit('pA', 'XQZ1');
    await until(() => !room.players.get('pA').busy);
  }
  assert.equal(room.players.get('pA').frozenUntil, 0); // 3연속이어도 얼릴 상대가 없다
  await until(() => room.state === 'ended');
  const end = log.filter((l) => l.ev === 'game:end').at(-1).p;
  assert.equal(end.isSolo, true);
  assert.equal(end.winnerId, null);
  assert.equal(end.ranking, undefined);
  assert.equal(end.soloResult.score, 3);
  assert.equal(end.soloResult.isBest, true);
  assert.equal(end.soloResult.coins, 3);
  assert.equal(hooks.ranking.top().length, 0); // 대전 랭킹에는 안 들어간다
  assert.equal(hooks.accounts.soloBoard('쉬움', 0.6)[0].score, 3);
  room.rematch('pA'); // 한 번 더: 혼자라서 바로 시작
  assert.equal(room.state, 'countdown');
});

test('솔로 판을 중간에 나가면 기록하지 않는다', async () => {
  const store = createJsonStore(null);
  const hooks = { seen: createSeen(store), ranking: createRanking(store) };
  hooks.accounts = createAccounts(store, hooks);
  const a = hooks.accounts.createGuest({ nickname: '혼자' }).account;
  const log = [];
  const io = { to: () => ({ emit: (ev, p) => log.push({ ev, p }) }), in: () => ({ socketsLeave() {} }) };
  let closed = false;
  const room = new Room(io, 'SOLO22', { difficulty: 'easy', timeLimit: 60, promptLimit: 100, map: 'east', title: '솔로', solo: true }, () => (closed = true), fakeAI(), FAST, hooks);
  rooms.push(room);
  room.join({ id: 's', join() {}, data: {} }, 'pA', { name: '혼자', char: 'cat', device: a.id });
  await until(() => room.state === 'playing');
  room.submit('pA', 'XQZ1');
  await until(() => !room.players.get('pA').busy);
  room.leave('pA');
  assert.equal(closed, true);
  assert.equal(log.filter((l) => l.ev === 'game:end').length, 0);
  assert.equal(a.solo.games, 0);
});

test('방 설정의 AI 제공자를 쓰고, 없으면 기본 AI로 돌아간다', async () => {
  const calls = [];
  const tag = (name) => ({ kind: name, generate: async (prompt, { problem }) => (calls.push(name), { status: 'OK', text: problem.keywords.join(' '), truncated: false, finishReason: 'STOP', latencyMs: 0, usage: null }) });
  const hooks = { providers: { openai: tag('openai'), anthropic: tag('anthropic') } };
  const c = setup({ ai: tag('default'), hooks, settings: { ai: 'anthropic' } });
  await playing(c);
  c.room.submit('pA', 'XQZ1');
  await answered(c);
  assert.deepEqual(calls, ['anthropic']);
  assert.equal(c.room.snapshot('pA').players[0].aiKind, 'anthropic');
  const d = setup({ ai: tag('default'), hooks, settings: { ai: 'gemini' } }); // 키 없는 제공자를 골랐다면 기본 AI
  await playing(d);
  d.room.submit('pA', 'XQZ1');
  await answered(d);
  assert.equal(calls.at(-1), 'default');
});

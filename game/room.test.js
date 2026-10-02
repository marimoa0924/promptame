// 방 규칙 검증: 소켓 없이 가짜 io와 가짜 AI로 판 진행을 돌려 본다. 실행: node --test
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from './room.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rooms = [];
afterEach(() => {
  for (const r of rooms.splice(0)) r.close();
});
const FAST = { countdownMs: 20, replayTickMs: 1, judgeBaseMs: 5, judgePerLineMs: 1, endGraceMs: 600, waitTtlMs: 600_000 };

// 프롬프트에 PASS가 들어 있으면 필수어를 모두 담은 짧은 답, LONG이 있으면 분량 초과, 그 외에는 필수어 없는 답
function fakeAI({ delay = 0, status = 'OK' } = {}) {
  return {
    kind: 'fake',
    async generate(prompt, { problem }) {
      await sleep(delay);
      if (status !== 'OK') return { status, text: '', truncated: false, finishReason: 'X', latencyMs: 0, usage: null };
      let text = '관련 없는 답이에요';
      if (prompt.includes('PASS')) text = problem.keywords.join(' ');
      if (prompt.includes('LONG')) text = `${problem.keywords.join(' ')}. 하나. 둘. 셋. 넷. 다섯.`.repeat(30);
      return { status: 'OK', text, truncated: false, finishReason: 'STOP', latencyMs: delay, usage: null };
    },
  };
}

function setup({ settings = {}, ai = fakeAI(), timing = FAST } = {}) {
  const log = [];
  const io = {
    to: (target) => ({ emit: (ev, payload) => log.push({ target, ev, payload }) }),
    in: () => ({ socketsLeave() {} }),
  };
  let closed = false;
  const room = new Room(io, 'ABCDEF', { title: 't', difficulty: 'easy', map: 'east', timeLimit: 60, promptLimit: 100, ...settings }, () => (closed = true), ai, timing);
  rooms.push(room);
  const sock = (id) => ({ id, join() {}, data: {} });
  const A = sock('sA'), B = sock('sB');
  room.join(A, 'pA', { name: '에이', char: 'cat' });
  room.join(B, 'pB', { name: '비이', char: 'dog' });
  return { room, log, A, B, isClosed: () => closed, events: (ev) => log.filter((l) => l.ev === ev) };
}
const playing = async (ctx) => { await waitFor(() => ctx.room.state === 'playing'); };

// 고정 시간 대신 조건이 될 때까지 기다린다.
// 윈도우는 타이머 단위가 약 15ms라 sleep(1)도 15ms가 걸려서, 고정 대기는 답변이 끝나기 전에 검사하게 된다.
async function waitFor(cond, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > until) throw new Error('waitFor: 시간 안에 조건이 맞지 않았어요');
    await sleep(5);
  }
}
// 보낸 답변이 재생·판정까지 끝날 때까지 기다린다
const answered = (ctx, id = 'pA') => waitFor(() => !ctx.room.players.get(id).busy);

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
  c.room.submit('pA', 'PASS 설명해줘');
  await sleep(5);
  const toB = c.log.filter((l) => l.target === 'sB' && l.ev === 'ai:start').at(-1);
  const toA = c.log.filter((l) => l.target === 'sA' && l.ev === 'ai:start').at(-1);
  assert.equal(toB.payload.prompt, null);
  assert.equal(toA.payload.prompt, 'PASS 설명해줘');
  const snapB = c.room.snapshot('pB').players.find((p) => p.id === 'pA');
  assert.equal(snapB.live.prompt, null);
  assert.equal(c.room.snapshot('pA').players.find((p) => p.id === 'pA').live.prompt, 'PASS 설명해줘');
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
  c.room.submit('pA', 'PASS 설명');
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
  c.room.submit('pA', 'PASS 다시');
  await answered(c);
  assert.equal(a.score, 1);
  assert.equal(a.streak, 0);
  assert.equal(a.attempts, 0);
});

test('분량을 넘기면 필수어가 있어도 RETRY', async () => {
  const c = setup();
  await playing(c);
  c.room.submit('pA', 'PASS LONG');
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
    assert.equal(c.room.submit('pA', 'PASS').ok, true);
    await answered(c);
  }
  assert.equal(a.score, 3);
  assert.equal(a.streak, 0);
  assert.ok(b.frozenUntil - Date.now() > 4000 && b.frozenUntil - Date.now() <= 5000);
  assert.equal(c.events('game:event').at(-1).payload.type, 'freeze');
  assert.equal(c.room.submit('pB', 'PASS').ok, false); // 얼음 중에는 못 보낸다
  assert.equal(c.room.snapshot('pA').players[0].streak, 0);
});

test('건너뛰기: 점수 없이 내 문제만 넘어가고 연속이 0이 되며 3초 멈춘다', async () => {
  const c = setup();
  await playing(c);
  const [a, b] = [...c.room.players.values()];
  c.room.submit('pA', 'PASS');
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
  c.room.submit('pA', 'PASS');
  await sleep(1300); // 재시도 두 번의 대기
  assert.equal(c.events('ai:void').length, 1);
  assert.equal(a.attempts, 0);
  assert.equal(a.busy, false);
  assert.equal(a.live, null);
});

test('시간이 끝나기 전에 보낸 요청은 유예 안에 끝나면 점수에 들어가고, 이후 전송은 거절한다', async () => {
  const c = setup({ settings: { timeLimit: 0.15 }, ai: fakeAI({ delay: 250 }) });
  await sleep(40);
  assert.equal(c.room.submit('pA', 'PASS').ok, true);
  await sleep(200); // 이제 endsAt 이후
  assert.equal(c.room.state, 'playing'); // 아직 유예 중
  assert.equal(c.room.submit('pB', 'PASS').ok, false);
  await sleep(500);
  assert.equal(c.room.state, 'ended');
  assert.equal(c.room.players.get('pA').score, 1);
  assert.equal(c.events('game:end').at(-1).payload.winnerId, 'pA');
  assert.equal(c.events('game:end').at(-1).payload.reason, 'timeup');
});

test('유예가 지나도 안 온 요청은 버리고 끝낸다', async () => {
  const c = setup({ settings: { timeLimit: 0.1 }, ai: fakeAI({ delay: 2000 }), timing: { ...FAST, endGraceMs: 150 } });
  await sleep(40);
  c.room.submit('pA', 'PASS');
  await sleep(450);
  assert.equal(c.room.state, 'ended');
  assert.equal(c.room.players.get('pA').score, 0);
});

test('점수가 같으면 무승부(0 대 0 포함)', async () => {
  const c = setup({ settings: { timeLimit: 0.1 } });
  await sleep(150);
  assert.equal(c.room.state, 'ended');
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
  const c = setup({ settings: { timeLimit: 0.15 } });
  await sleep(40);
  c.room.submit('pA', 'PASS'); // A는 두 번째 문제까지 도달
  await answered(c);
  await waitFor(() => c.room.state === 'ended');
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

// 서버를 켠 상태에서 실행: npm run smoke
// 1) 두 플레이어가 동시에 프롬프트를 던지고 (스트리밍 → 평가 → 결과)
// 2) 재접속, 기권, 3) 연습봇 대결과 한번 더 하기까지 확인한다.
import { io } from 'socket.io-client';

const URL = process.env.URL ?? 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (s, ev, payload) => s.timeout(5000).emitWithAck(ev, payload);
const connect = (token) => new Promise((r) => { const s = io(URL, { transports: ['websocket'], auth: token ? { token } : {} }); s.on('connect', () => r(s)); });

const a = await connect();
const b = await connect();
const counts = { chunk: 0, judge: 0, result: 0 };
let lastState;
let lastEnd;
a.on('ai:chunk', () => counts.chunk++);
a.on('ai:judge', () => counts.judge++);
a.on('ai:result', (d) => { counts.result++; console.log(`  result ${d.playerId}: ${d.pass ? 'PASS' : 'RETRY'} - ${d.reason}`); });
a.on('room:state', (r) => (lastState = r));
a.on('game:end', (e) => { lastEnd = e; console.log(`  game:end ${e.reason} winner=${e.winnerId} duration=${e.durationMs}ms`); });

// ---- 0) 보안: 다른 사이트(Origin)에서의 접속 거절, 요청 폭주 제한 ----
const evil = io(URL, { transports: ['websocket'], extraHeaders: { Origin: 'http://evil.example' }, reconnection: false });
const evilResult = await new Promise((r) => { evil.on('connect', () => r('연결됨(문제!)')); evil.on('connect_error', () => r('거절됨')); setTimeout(() => r('응답 없음'), 3000); });
console.log('다른 Origin 접속:', evilResult);
evil.close();
const burst = await Promise.all(Array.from({ length: 120 }, () => ask(a, 'ranking:get', { device: 'smoke-device-0001' })));
console.log('폭주 제한:', burst.filter((x) => x.ok).length, '건 처리,', burst.filter((x) => !x.ok).length, '건 거절');
await sleep(1100);

// ---- 1) 사람 대 사람 ----
console.log('로그인 없이 방 만들기:', (await ask(a, 'room:create', { playerId: 'player-XXXX', settings: {} })).code);
const ga = await ask(a, 'auth:guest', {});
const gb = await ask(b, 'auth:guest', {});
console.log('guest login:', ga.ok, gb.ok, ga.account.coins, '| char 잠금:', (await ask(a, 'account:update', { char: 'miku' })).error);
console.log('bad nickname:', (await ask(a, 'account:update', { nickname: '씨발' })).error);
console.log('long nickname:', (await ask(a, 'account:update', { nickname: '가나다라마바사아자' })).error);
await ask(a, 'account:update', { nickname: '냥이' });
await ask(b, 'account:update', { nickname: '멍멍' });
const created = await ask(a, 'room:create', {
  playerId: 'player-AAAA',
  settings: { title: '테스트', difficulty: 'normal', map: 'space', timeLimit: 120, promptLimit: 100 },
});
console.log('create', created.ok, created.room.code, created.room.settings.map);
const code = created.room.code;
const joined = await ask(b, 'room:join', { playerId: 'player-BBBB', code });
console.log('join', joined.ok, joined.room.state);
await sleep(3800);
console.log('state after countdown:', lastState.state);

const topicA = lastState.players.find((p) => p.id === 'player-AAAA').topic;
console.log('banned check:', await ask(a, 'prompt:submit', { text: `${topicA.topic} 알려줘` }));
console.log('opponent prompt hidden:', lastState.players.find((p) => p.id === 'player-BBBB').live?.prompt == null);
const [ra, rb] = await Promise.all([
  ask(a, 'prompt:submit', { text: '선생님인데 아이들에게 설명할 거야. 짧게 알려줘' }),
  ask(b, 'prompt:submit', { text: '아무거나 말해줘' }),
]);
console.log('skip while busy:', (await ask(a, 'prompt:skip')).error);
console.log('submit', ra.ok, rb.ok, '/ while busy:', (await ask(a, 'prompt:submit', { text: '또' })).error);
await sleep(9000);
console.log('events', counts);

// 건너뛰기: AI 답변이 끝난 뒤 눌러야 하고, 점수 없이 내 문제만 넘어간다
const before = lastState.players.find((p) => p.id === 'player-AAAA');
const skipped = await ask(a, 'prompt:skip');
await sleep(200);
const after = lastState.players.find((p) => p.id === 'player-AAAA');
console.log('skip:', skipped.ok, 'topicIdx', before.topicIdx, '->', after.topicIdx, 'score', after.score === before.score, 'kind', after.frozenKind);
console.log('skip again while paused:', (await ask(a, 'prompt:skip')).error);

// 재접속
b.disconnect();
await sleep(300);
console.log('B connected?', lastState.players.find((p) => p.id === 'player-BBBB').connected);
const b2 = await connect(gb.token); // 토큰으로 다시 접속하면 같은 계정으로 이어진다
const rejoin = await ask(b2, 'room:join', { playerId: 'player-BBBB', code });
const thief = await connect();
await ask(thief, 'auth:guest', {});
console.log('남의 자리 가로채기:', (await ask(thief, 'room:join', { playerId: 'player-BBBB', code })).error);
thief.close();
console.log('rejoin', rejoin.ok, rejoin.room.state);

// 기권 → 상대에게 game:end, 방은 결과 화면 상태로 남는다
await ask(b2, 'room:leave');
await sleep(300);
console.log('after forfeit:', lastState.state, 'players', lastState.players.length, 'winner is A?', lastEnd?.winnerId === 'player-AAAA');

// ---- 2) 연습봇 대결 + 한번 더 하기 (상대가 나갔으므로 대기실로) ----
console.log('rematch alone:', (await ask(a, 'room:rematch')).ok, '→', (await sleep(200), lastState.state));
console.log('addBot:', (await ask(a, 'room:addBot')).ok);
await sleep(300);
console.log('with bot:', lastState.state, lastState.players.map((p) => `${p.name}${p.isBot ? '(bot)' : ''}`));
counts.result = 0;
await sleep(24000);
console.log('bot results so far:', counts.result, 'bot score', lastState.players.find((p) => p.isBot)?.score);

await ask(a, 'room:leave');
a.close();
b2.close();
process.exit(0);

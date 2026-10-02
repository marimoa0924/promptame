// 서버를 켠 상태에서 실행: npm run smoke
// 1) 두 플레이어가 동시에 프롬프트를 던지고 (스트리밍 → 평가 → 결과)
// 2) 재접속, 기권, 3) 연습봇 대결과 한번 더 하기까지 확인한다.
import { io } from 'socket.io-client';

const URL = process.env.URL ?? 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (s, ev, payload) => s.timeout(5000).emitWithAck(ev, payload);
const connect = () => new Promise((r) => { const s = io(URL, { transports: ['websocket'] }); s.on('connect', () => r(s)); });

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

// ---- 1) 사람 대 사람 ----
const created = await ask(a, 'room:create', {
  playerId: 'player-AAAA', profile: { name: '냥이', char: 'cat' },
  settings: { title: '테스트', difficulty: 'normal', map: 'space', timeLimit: 120, promptLimit: 100 },
});
console.log('create', created.ok, created.room.code, created.room.settings.map);
const code = created.room.code;
const joined = await ask(b, 'room:join', { playerId: 'player-BBBB', profile: { name: '멍멍', char: 'dog' }, code });
console.log('join', joined.ok, joined.room.state);
await sleep(3800);
console.log('state after countdown:', lastState.state);

const topicA = lastState.players.find((p) => p.id === 'player-AAAA').topic;
console.log('banned check:', await ask(a, 'prompt:submit', { text: `${topicA.topic} 알려줘` }));
const [ra, rb] = await Promise.all([
  ask(a, 'prompt:submit', { text: '선생님인데 아이들에게 설명할 거야. 짧게 알려줘' }),
  ask(b, 'prompt:submit', { text: '아무거나 말해줘' }),
]);
console.log('submit', ra.ok, rb.ok, '/ while busy:', (await ask(a, 'prompt:submit', { text: '또' })).error);
await sleep(9000);
console.log('events', counts);

// 재접속
b.disconnect();
await sleep(300);
console.log('B connected?', lastState.players.find((p) => p.id === 'player-BBBB').connected);
const b2 = await connect();
const rejoin = await ask(b2, 'room:join', { playerId: 'player-BBBB', profile: {}, code });
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

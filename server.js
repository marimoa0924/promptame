import express from 'express';

// 프로젝트 폴더의 .env 파일이 있으면 환경변수로 읽는다 (GEMINI_API_KEY 등). 없으면 그냥 넘어간다.
try {
  process.loadEnvFile('.env');
} catch {
  /* .env 없음 */
}

import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Room } from './game/room.js';
import { listModels } from './game/gemini.js';
import { createProviders, PROVIDERS } from './game/providers.js';
import { createAccounts } from './game/accounts.js';
import { verifyGoogleIdToken, GoogleAuthError, clientIdFromJson, checkClientId } from './game/googleAuth.js';
import { readdirSync, readFileSync } from 'node:fs';
import { createJsonStore } from './game/jsonStore.js';
import { createSeen } from './game/seen.js';
import { createRanking } from './game/ranking.js';

const PORT = Number(process.env.PORT) || 3000;
const CHARACTERS = ['cat', 'pigeon', 'dog', 'otaku', 'miku', 'snake', 'engineer', 'mantis', 'ditto', 'chiikawa'];
const MAPS = ['east', 'future', 'medieval', 'space'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// AI 제공자: 키가 있는 것(Gemini, GPT, Claude)만 방에서 고를 수 있다. 하나도 없으면 목 AI.
const providers = createProviders();
const ai = providers.default;
// 랭킹과 본 문제 기록은 파일에 남긴다 (DATA_FILE로 위치 변경, 기본 ./store.json)
const store = createJsonStore(process.env.DATA_FILE || './store.json');
process.on('exit', () => store.flush());
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
const seen = createSeen(store);
const ranking = createRanking(store);
// 처음 4종은 모두 쓸 수 있고, 나머지는 상점이나 뽑기로 얻는다
const accounts = createAccounts(store, { ranking, seen, characters: CHARACTERS, starters: CHARACTERS.slice(0, 4) });
// 앞뒤 공백, 따옴표가 섞여 들어와도 지운다 (.env에 잘못 붙여 넣는 경우가 잦다)
// 클라이언트 ID는 GOOGLE_CLIENT_ID 환경변수가 우선이고, 없으면 구글 콘솔에서 내려받은 JSON 파일에서 읽는다
// (GOOGLE_CLIENT_FILE로 지정하거나, 프로젝트 폴더의 google-client.json 또는 client_secret*.json)
let googleFileNote = '';
function googleIdFromFile() {
  const candidates = [process.env.GOOGLE_CLIENT_FILE, 'google-client.json', ...readdirSync('.').filter((f) => /^client_secret.*\.json$/i.test(f))].filter(Boolean);
  for (const file of candidates) {
    try {
      const found = clientIdFromJson(readFileSync(file, 'utf8'));
      if (!found) continue;
      googleFileNote = `${file}에서 읽음${found.type === 'web' ? '' : ` (⚠ 유형이 '${found.type}'라 웹 로그인에는 쓸 수 없어요. 구글 콘솔에서 '웹 애플리케이션' 유형으로 새로 만드세요)`}`;
      return found.clientId;
    } catch {
      /* 파일이 없으면 다음 후보 */
    }
  }
  return '';
}
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '').trim() || googleIdFromFile();
const googleIdLooksValid = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(GOOGLE_CLIENT_ID);
// 계정이 생기기 전 기기 ID(브라우저 저장값). 이 값으로 쌓인 랭킹은 처음 로그인할 때 계정으로 옮겨 준다
const validDevice = (d) => (typeof d === 'string' && d.length >= 8 && d.length <= 64 ? d : null);
const app = express();
app.get('/favicon.ico', (_req, res) => res.status(204).end());
// 화면이 구글 로그인 버튼을 그릴 때 쓰는 공개 설정(클라이언트 ID는 비밀이 아니다)
app.get('/config.json', (_req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID, providers: providers.info(), defaultAi: providers.defaultKind }));
app.use(express.static('public'));
// 금지어 검사 규칙은 서버와 같은 파일을 브라우저에서도 쓴다
for (const file of ['promptRules.js', 'nickname.js']) {
  app.get(`/shared/${file}`, (_req, res) => res.sendFile(fileURLToPath(new URL(`./${file}`, import.meta.url))));
}
const httpServer = createServer(app);
// 메시지 한 건은 8KB까지만 받는다 (프롬프트 최대 2000자는 이 안에 들어간다)
// 다른 사이트에서 이 서버로 몰래 접속하는 것을 막는다: 브라우저가 보내는 Origin이 이 서버 주소와 같을 때만 받는다.
// Origin이 없는 접속(서버 점검 스크립트 등)은 받는다. 프록시 뒤에서 주소가 다르면 ALLOWED_ORIGINS에 쉼표로 적는다.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.headers.host || ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes(host);
  } catch {
    return false;
  }
}
const io = new Server(httpServer, {
  maxHttpBufferSize: 8 * 1024,
  allowRequest: (req, cb) => cb(null, originAllowed(req)),
});
const RATE_LIMIT_PER_SEC = 40; // 소켓 하나가 1초에 보낼 수 있는 요청 수
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 500;

const rooms = new Map();

// 접속할 때 보낸 로그인 토큰이 맞으면 그 계정으로 이어 준다(새로고침, 재접속). 없거나 틀리면 로그인 전 상태로 둔다.
io.use((socket, next) => {
  const acc = accounts.byToken(socket.handshake.auth?.token);
  if (acc) {
    socket.data.accountId = acc.id;
    accounts.touch(acc);
  }
  next();
});

// 게스트 계정을 마구 만드는 것을 막는다: 같은 주소에서 1분에 5개까지
const guestLog = new Map();
function guestAllowed(socket) {
  const ip = String(socket.handshake.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || socket.handshake.address;
  const t = Date.now();
  const list = (guestLog.get(ip) ?? []).filter((x) => t - x < 60_000);
  if (list.length >= 5) return false;
  list.push(t);
  guestLog.set(ip, list);
  return true;
}

function newCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

// 방에 들어갈 때의 이름, 캐릭터는 로그인한 계정의 것을 쓴다(클라이언트가 보낸 값은 믿지 않는다). device는 계정 번호다.
const profileOf = (acc) => ({ name: acc.nickname, char: acc.char, device: acc.id });

function cleanSettings(s = {}) {
  if (s.tutorial) {
    return { title: '튜토리얼', difficulty: 'normal', map: pick(s.map, MAPS, 'east'), timeLimit: 300, promptLimit: 150, tutorial: true };
  }
  return {
    title: ((t) => (t.length >= 2 ? t : '프롬프트 한 판!'))(String(s.title ?? '').trim().slice(0, 20)), // 2~20자
    difficulty: pick(s.difficulty, ['easy', 'normal', 'hard', 'expert'], 'normal'),
    ai: pick(s.ai, Object.keys(providers.available), providers.defaultKind), // 방의 두 사람이 같은 AI를 쓴다
    solo: s.solo === true,
    map: pick(s.map, MAPS, 'east'),
    timeLimit: pick(Number(s.timeLimit), [120, 180, 300], 180),
    promptLimit: pick(Number(s.promptLimit), [50, 100, 150, 300, 0], 100),
  };
}

const reply = (ack, value) => typeof ack === 'function' && ack(value);
const validId = (id) => typeof id === 'string' && id.length >= 8 && id.length <= 64;

io.on('connection', (socket) => {
  // 너무 빠르게 몰아서 보내는 요청은 받지 않는다
  let windowStart = Date.now();
  let count = 0;
  socket.use((packet, next) => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      count = 0;
    }
    if (++count <= RATE_LIMIT_PER_SEC) return next();
    const ack = packet.at(-1);
    if (typeof ack === 'function') ack({ ok: false, error: '요청이 너무 많아요. 잠깐만 기다려 주세요' });
  });

  const currentRoom = () => rooms.get(socket.data.roomCode);
  // 로그인한 계정. 삭제된 계정이면 로그인이 풀린 것으로 본다.
  const me = () => {
    const acc = socket.data.accountId && accounts.get(socket.data.accountId);
    return acc || null;
  };
  const NEED_LOGIN = { ok: false, error: '로그인이 필요해요', code: 'AUTH' };
  const signedIn = (acc, token, extra = {}) => {
    socket.data.accountId = acc.id;
    return { ok: true, token, account: accounts.view(acc), ...extra };
  };

  // ---------- 로그인 ----------
  socket.on('auth:me', (_p, ack) => {
    const acc = me();
    reply(ack, acc ? { ok: true, account: accounts.view(acc), googleEnabled: !!GOOGLE_CLIENT_ID } : { ok: false, googleEnabled: !!GOOGLE_CLIENT_ID });
  });

  socket.on('auth:guest', ({ legacyDevice } = {}, ack) => {
    if (!guestAllowed(socket)) return reply(ack, { ok: false, error: '잠시 뒤에 다시 시도해 주세요' });
    const r = accounts.createGuest({ legacyDevice: validDevice(legacyDevice) });
    reply(ack, r.ok ? signedIn(r.account, r.token) : r);
  });

  socket.on('auth:google', async ({ credential, legacyDevice } = {}, ack) => {
    try {
      const g = await verifyGoogleIdToken(credential, { clientId: GOOGLE_CLIENT_ID });
      const r = accounts.loginGoogle(g, { current: me(), legacyDevice: validDevice(legacyDevice) });
      reply(ack, r.ok ? signedIn(r.account, r.token, { linked: r.linked, switched: r.switched }) : r);
    } catch (err) {
      reply(ack, { ok: false, error: err instanceof GoogleAuthError ? err.message : '구글 로그인에 실패했어요' });
    }
  });

  socket.on('auth:logout', ({ token } = {}, ack) => {
    accounts.logout(token);
    socket.data.accountId = null;
    currentRoom()?.leave(socket.data.playerId);
    socket.data.roomCode = null;
    reply(ack, { ok: true });
  });

  // ---------- 내 계정 ----------
  socket.on('account:get', (_p, ack) => {
    const acc = me();
    reply(ack, acc ? { ok: true, ...accounts.report(acc) } : NEED_LOGIN);
  });

  socket.on('account:update', (payload = {}, ack) => {
    const acc = me();
    if (!acc) return reply(ack, NEED_LOGIN);
    const r = accounts.update(acc, { nickname: payload.nickname, char: payload.char });
    reply(ack, r.ok ? { ok: true, account: accounts.view(acc) } : r);
  });

  socket.on('shop:buy', ({ char } = {}, ack) => {
    const acc = me();
    if (!acc) return reply(ack, NEED_LOGIN);
    const r = accounts.buy(acc, char);
    reply(ack, r.ok ? { ...r, account: accounts.view(acc) } : r);
  });

  socket.on('shop:gacha', (_p, ack) => {
    const acc = me();
    if (!acc) return reply(ack, NEED_LOGIN);
    const r = accounts.gacha(acc);
    reply(ack, r.ok ? { ...r, account: accounts.view(acc) } : r);
  });

  socket.on('account:clearHistory', (_p, ack) => {
    const acc = me();
    if (!acc) return reply(ack, NEED_LOGIN);
    accounts.clearHistory(acc);
    reply(ack, { ok: true });
  });

  socket.on('account:delete', (_p, ack) => {
    const acc = me();
    if (!acc) return reply(ack, NEED_LOGIN);
    currentRoom()?.leave(socket.data.playerId);
    socket.data.roomCode = null;
    accounts.remove(acc);
    socket.data.accountId = null;
    reply(ack, { ok: true });
  });

  // ---------- 방 ----------
  socket.on('room:create', ({ playerId, settings } = {}, ack) => {
    const acc = me();
    if (!acc) return reply(ack, NEED_LOGIN);
    if (!validId(playerId)) return reply(ack, { ok: false, error: '잘못된 요청이에요' });
    currentRoom()?.leave(socket.data.playerId);
    if (rooms.size >= MAX_ROOMS) return reply(ack, { ok: false, error: '지금은 방을 더 만들 수 없어요. 잠시 후 다시 시도해 주세요' });
    const code = newCode();
    const room = new Room(io, code, cleanSettings(settings), (c) => rooms.delete(c), ai, {}, { seen, ranking, accounts, providers: providers.available });
    rooms.set(code, room);
    reply(ack, room.join(socket, playerId, profileOf(acc)));
  });

  socket.on('room:join', ({ playerId, code } = {}, ack) => {
    const acc = me();
    if (!acc) return reply(ack, NEED_LOGIN);
    if (!validId(playerId)) return reply(ack, { ok: false, error: '잘못된 요청이에요' });
    const room = rooms.get(String(code ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase());
    if (!room) return reply(ack, { ok: false, error: '방을 찾을 수 없어요' });
    // 이미 방에 있던 playerId로 다시 들어올 때는 같은 계정이어야 한다(남의 자리를 가로채지 못하게)
    const existing = room.players.get(playerId);
    if (existing && existing.device !== acc.id) return reply(ack, { ok: false, error: '이 방의 다른 사람 자리예요' });
    reply(ack, room.join(socket, playerId, profileOf(acc)));
  });

  socket.on('room:leave', (_payload, ack) => {
    const room = currentRoom();
    if (room) socket.leave(room.code);
    room?.leave(socket.data.playerId);
    socket.data.roomCode = null;
    reply(ack, { ok: true });
  });

  socket.on('room:rematch', (_payload, ack) => {
    const room = currentRoom();
    if (!room) return reply(ack, { ok: false, error: '방이 사라졌어요' });
    reply(ack, room.rematch(socket.data.playerId));
  });

  socket.on('room:addBot', (_payload, ack) => {
    const room = currentRoom();
    if (!room) return reply(ack, { ok: false, error: '방에 들어가 있지 않아요' });
    reply(ack, room.addBot());
  });

  // 솔로 랭킹: 난이도와 제한시간별 최고 기록
  socket.on('ranking:solo', ({ difficulty, timeLimit } = {}, ack) => {
    const d = { easy: '쉬움', normal: '보통', hard: '어려움', expert: '매우 어려움' }[difficulty] ?? '보통';
    const t = pick(Number(timeLimit), [120, 180, 300], 180);
    reply(ack, { ok: true, difficulty: d, timeLimit: t, top: accounts.soloBoard(d, t, 10) });
  });

  // 랭킹 상위 목록과 내 순위
  socket.on('ranking:get', (_p, ack) => {
    reply(ack, { ok: true, top: ranking.top(20), me: me() ? ranking.me(me().id) : null });
  });

  socket.on('prompt:submit', ({ text } = {}, ack) => {
    const room = currentRoom();
    if (!room) return reply(ack, { ok: false, error: '방에 들어가 있지 않아요' });
    reply(ack, room.submit(socket.data.playerId, text));
  });

  socket.on('prompt:skip', (_payload, ack) => {
    const room = currentRoom();
    if (!room) return reply(ack, { ok: false, error: '방에 들어가 있지 않아요' });
    reply(ack, room.skip(socket.data.playerId));
  });

  socket.on('player:typing', ({ len } = {}) => {
    const code = socket.data.roomCode;
    if (!code) return;
    socket.to(code).emit('player:typing', { playerId: socket.data.playerId, len: Number(len) || 0 });
  });

  socket.on('disconnect', () => {
    currentRoom()?.socketDropped(socket.data.playerId, socket.id);
  });
});

// 키가 있으면 서버를 켤 때 한 번 호출해서 연결이 되는지 바로 알려 준다. 끄려면 AI_SELFTEST=0
async function googleSelfTest() {
  if (!GOOGLE_CLIENT_ID || process.env.AI_SELFTEST === '0') return;
  const r = await checkClientId(GOOGLE_CLIENT_ID);
  if (r.status === 'NOT_FOUND') {
    console.log('  ❌ 구글이 이 클라이언트 ID를 모른대요 (invalid_client). 구글 로그인이 401 invalid_client로 실패해요.');
    console.log(`     쓰고 있는 ID: ${GOOGLE_CLIENT_ID}`);
    console.log('     → 구글 콘솔(API 및 서비스 > 사용자 인증 정보)에 보이는 "웹 애플리케이션" 클라이언트 ID와 글자 하나까지 같은지, 지운 클라이언트가 아닌지 확인하세요.');
  } else if (r.status === 'FOUND') console.log('  ✅ 구글이 이 클라이언트 ID를 인식해요');
  else console.log(`  (구글 클라이언트 ID 확인은 못 했어요: ${r.detail})`);
}

// 키가 있는 AI 제공자마다 서버를 켤 때 한 번 호출해서 연결이 되는지 알려 준다
async function providerSelfTest(id, client) {
  const label = PROVIDERS[id].label;
  const r = await client.generate('안녕이라고만 답해 줘');
  if (r.status === 'OK') {
    console.log(`  ✅ ${label} 연결 확인 (${r.latencyMs}ms): ${r.text.slice(0, 30)}`);
    if (r.usage) console.log(`     토큰: 입력 ${r.usage.inTokens}, 출력 ${r.usage.outTokens}, 생각 ${r.usage.thinkTokens}${r.usage.thinkTokens > 0 ? ' ← 생각 기능이 켜져 있어요' : ''}`);
    return;
  }
  const { keyEnv, modelEnv } = PROVIDERS[id];
  const detail = `${r.detail ?? ''}`;
  console.log(`  ❌ ${label} 호출 실패: ${r.status} ${r.finishReason ?? ''} ${detail}`);
  // 원인에 맞는 안내만 한다
  if (/credit|billing|quota|insufficient|exceeded/i.test(detail) || r.finishReason === 'HTTP_429' || r.finishReason === 'HTTP_402') {
    console.log(`     → 키와 모델은 맞아요. ${label} 계정의 결제(크레딧)나 사용 한도 문제예요. 해당 서비스의 Billing 페이지에서 크레딧을 충전하거나 한도를 확인하세요.`);
    console.log(`     → 지금은 쓰지 않으려면 .env 에서 ${keyEnv} 줄을 지우고 서버를 다시 켜세요.`);
  } else if (r.finishReason === 'HTTP_401' || r.finishReason === 'HTTP_403') {
    console.log(`     → 키(${keyEnv})가 틀렸거나 권한이 없어요. 키를 다시 복사해서 넣으세요.`);
  } else if (r.finishReason === 'HTTP_404' || /model/i.test(detail)) {
    console.log(`     → 모델 이름(${modelEnv})이 틀렸을 수 있어요.`);
    const names = id === 'gemini' ? (await listModels(process.env.GEMINI_API_KEY)).filter((n) => n.includes('gemini')) : await client.listModels?.();
    if (names?.length) console.log(`     → 이 키로 쓸 수 있는 모델: ${names.slice(0, 12).join(', ')}\n     → .env 의 ${modelEnv}= 뒤에 위 이름 중 하나를 적고 서버를 다시 켜세요`);
  } else {
    console.log(`     → 키(${keyEnv})와 모델 이름(${modelEnv}), 네트워크를 확인하세요.`);
  }
}

async function selfTest() {
  googleSelfTest();
  if (process.env.AI_SELFTEST === '0') return;
  for (const [id, client] of Object.entries(providers.available)) providerSelfTest(id, client);
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🏮 프롬프트 배틀 서버 실행 중`);
  if (!GOOGLE_CLIENT_ID) console.log('  구글 로그인: 꺼짐 (GOOGLE_CLIENT_ID 없음, 게스트 로그인만 가능)');
  else if (googleIdLooksValid) console.log(`  구글 로그인: 켜짐 (${GOOGLE_CLIENT_ID.slice(0, 14)}…)${googleFileNote ? ` ${googleFileNote}` : ''}`);
  else console.log(`  ⚠ 구글 로그인: GOOGLE_CLIENT_ID 모양이 이상해요 (${GOOGLE_CLIENT_ID.slice(0, 20)}…). '숫자-문자.apps.googleusercontent.com' 형태여야 해요. 클라이언트 보안 비밀번호(GOCSPX-…)나 프로젝트 ID를 넣은 건 아닌지 확인하세요`);
  const on = Object.entries(providers.available).map(([id, c]) => `${PROVIDERS[id].label}(${c.model})`);
  console.log(on.length ? `  AI: ${on.join(', ')} · 기본 ${PROVIDERS[providers.defaultKind].label}` : '  AI: 목업 (GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY 중 하나도 없음)');
  console.log(`  ➜ 로컬:  http://localhost:${PORT}`);
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`  ➜ 같은 와이파이: http://${net.address}:${PORT}`);
    }
  }
  console.log('');
  selfTest();
});

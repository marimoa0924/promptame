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
import { createAIFromEnv } from './game/gemini.js';
import { checkNickname, nicknameError } from './nickname.js';

const PORT = Number(process.env.PORT) || 3000;
const CHARACTERS = ['cat', 'pigeon', 'dog', 'otaku'];
const EMOTES = ['😹', '👍', '🔥', '😭', '🫵', '🙏'];
const MAPS = ['east', 'future', 'medieval', 'space'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const ai = createAIFromEnv();
const app = express();
app.use(express.static('public'));
// 금지어 검사 규칙은 서버와 같은 파일을 브라우저에서도 쓴다
for (const file of ['promptRules.js', 'nickname.js']) {
  app.get(`/shared/${file}`, (_req, res) => res.sendFile(fileURLToPath(new URL(`./${file}`, import.meta.url))));
}
const httpServer = createServer(app);
const io = new Server(httpServer);

const rooms = new Map();

function newCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const DEFAULT_NAME = '익명의 고수';

// 닉네임이 비어 있으면 기본 이름을 쓰고, 있으면 2~8자와 금칙어 규칙을 지켜야 한다.
function cleanProfile(profile = {}) {
  const raw = String(profile.name ?? '').trim();
  const char = pick(profile.char, CHARACTERS, 'cat');
  if (!raw) return { ok: true, profile: { name: DEFAULT_NAME, char } };
  const nick = checkNickname(raw);
  if (!nick.ok) return { ok: false, error: nicknameError(nick.code) };
  return { ok: true, profile: { name: nick.name, char } };
}

function cleanSettings(s = {}) {
  if (s.tutorial) {
    return { title: '튜토리얼', difficulty: 'normal', map: pick(s.map, MAPS, 'east'), timeLimit: 300, promptLimit: 150, tutorial: true };
  }
  return {
    title: String(s.title ?? '').trim().slice(0, 20) || '프롬프트 한 판!',
    difficulty: pick(s.difficulty, ['easy', 'normal', 'hard'], 'normal'),
    map: pick(s.map, MAPS, 'east'),
    timeLimit: pick(Number(s.timeLimit), [120, 180, 300], 180),
    promptLimit: pick(Number(s.promptLimit), [50, 100, 150, 300, 0], 100),
  };
}

const reply = (ack, value) => typeof ack === 'function' && ack(value);
const validId = (id) => typeof id === 'string' && id.length >= 8 && id.length <= 64;

io.on('connection', (socket) => {
  const currentRoom = () => rooms.get(socket.data.roomCode);

  socket.on('room:create', ({ playerId, profile, settings } = {}, ack) => {
    if (!validId(playerId)) return reply(ack, { ok: false, error: '잘못된 요청이에요' });
    const who = cleanProfile(profile);
    if (!who.ok) return reply(ack, who);
    currentRoom()?.leave(socket.data.playerId);
    const code = newCode();
    const room = new Room(io, code, cleanSettings(settings), (c) => rooms.delete(c), ai);
    rooms.set(code, room);
    reply(ack, room.join(socket, playerId, who.profile));
  });

  socket.on('room:join', ({ playerId, profile, code } = {}, ack) => {
    if (!validId(playerId)) return reply(ack, { ok: false, error: '잘못된 요청이에요' });
    const room = rooms.get(String(code ?? '').trim().toUpperCase());
    if (!room) return reply(ack, { ok: false, error: '방을 찾을 수 없어요' });
    // 이미 방에 있던 사람의 재접속은 닉네임을 다시 검사하지 않는다
    const who = room.players.has(playerId) ? { ok: true, profile: {} } : cleanProfile(profile);
    if (!who.ok) return reply(ack, who);
    reply(ack, room.join(socket, playerId, who.profile));
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

  socket.on('player:emote', ({ emoji } = {}) => {
    const code = socket.data.roomCode;
    const now = Date.now();
    if (!code || !EMOTES.includes(emoji) || now - (socket.data.lastEmote ?? 0) < 800) return;
    socket.data.lastEmote = now;
    socket.to(code).emit('player:emote', { playerId: socket.data.playerId, emoji });
  });

  socket.on('disconnect', () => {
    currentRoom()?.socketDropped(socket.data.playerId, socket.id);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🏮 프롬프트 배틀 서버 실행 중`);
  console.log(`  AI: ${ai.kind === 'gemini' ? `Gemini (${ai.model})` : '목업 (GEMINI_API_KEY 없음)'}`);
  console.log(`  ➜ 로컬:  http://localhost:${PORT}`);
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`  ➜ 같은 와이파이: http://${net.address}:${PORT}`);
    }
  }
  console.log('');
});

import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';
import { Room } from './game/room.js';

const PORT = Number(process.env.PORT) || 3000;
const CHARACTERS = ['cat', 'pigeon', 'dog', 'otaku'];
const EMOTES = ['😹', '👍', '🔥', '😭', '🫵', '🙏'];
const MAPS = ['east', 'future', 'medieval', 'space'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const app = express();
app.use(express.static('public'));
const httpServer = createServer(app);
const io = new Server(httpServer);

const rooms = new Map();

function newCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

function cleanProfile(profile = {}) {
  const name = String(profile.name ?? '').trim().slice(0, 12) || '익명의 고수';
  return { name, char: pick(profile.char, CHARACTERS, 'cat') };
}

function cleanSettings(s = {}) {
  if (s.tutorial) {
    return { title: '튜토리얼', difficulty: 'easy', map: pick(s.map, MAPS, 'east'), timeLimit: 300, promptLimit: 150, tutorial: true };
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
    currentRoom()?.leave(socket.data.playerId);
    const code = newCode();
    const room = new Room(io, code, cleanSettings(settings), (c) => rooms.delete(c));
    rooms.set(code, room);
    reply(ack, room.join(socket, playerId, cleanProfile(profile)));
  });

  socket.on('room:join', ({ playerId, profile, code } = {}, ack) => {
    if (!validId(playerId)) return reply(ack, { ok: false, error: '잘못된 요청이에요' });
    const room = rooms.get(String(code ?? '').trim().toUpperCase());
    if (!room) return reply(ack, { ok: false, error: '방을 찾을 수 없어요' });
    reply(ack, room.join(socket, playerId, cleanProfile(profile)));
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

  socket.on('player:chat', ({ text } = {}) => {
    const code = socket.data.roomCode;
    const clean = String(text ?? '').trim().slice(0, 30);
    const now = Date.now();
    if (!code || !clean || now - (socket.data.lastChat ?? 0) < 700) return;
    socket.data.lastChat = now;
    socket.to(code).emit('player:chat', { playerId: socket.data.playerId, text: clean });
  });

  socket.on('prompt:submit', ({ text } = {}, ack) => {
    const room = currentRoom();
    if (!room) return reply(ack, { ok: false, error: '방에 들어가 있지 않아요' });
    reply(ack, room.submit(socket.data.playerId, text));
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
  console.log(`  ➜ 로컬:  http://localhost:${PORT}`);
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`  ➜ 같은 와이파이: http://${net.address}:${PORT}`);
    }
  }
  console.log('');
});

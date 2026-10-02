import { TOPICS } from './topics.js';
import { composeAnswer, streamText, judge, findBannedWord, bannedWords, lengthLabel } from './ai.js';
import { botPrompt, botLine, BOT_NAMES } from './bot.js';

const COUNTDOWN_MS = 3500;
const RECONNECT_GRACE_MS = 20_000;
const FREEZE_MS = 5000;
const STREAK_FOR_FREEZE = 3;
const REQUIRED_HITS = { easy: 1, normal: 2, hard: 3 };
// 평가 AI가 답변을 "읽는" 시간. 너무 빨리 채점되면 사용자가 결과를 읽을 틈이 없다.
const JUDGE_BASE_MS = 900;
const JUDGE_PER_LINE_MS = 750;
const BOT_CHARS = ['cat', 'pigeon', 'dog', 'otaku'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 상태: waiting → countdown → playing → ended → (한번 더) countdown …
export class Room {
  constructor(io, code, settings, onClose) {
    this.io = io;
    this.code = code;
    this.settings = settings;
    this.onClose = onClose;
    this.players = new Map(); // playerId -> player
    this.state = 'waiting';
    this.round = 0; // 판이 바뀌면 증가. 이전 판의 AI 답변이 새 판에 섞이지 않게 한다.
    this.topics = this.pickTopics();
    this.countdownEndsAt = null;
    this.startedAt = null;
    this.endsAt = null;
    this.lastResult = null;
    this.timers = new Set();
    this.closed = false;
  }

  get capacity() {
    return this.settings.tutorial ? 1 : 2;
  }

  pickTopics() {
    const list = shuffle(TOPICS);
    if (this.settings.tutorial) {
      // 튜토리얼은 기획서 예시(광합성)로 시작
      const i = list.findIndex((t) => t.topic === '광합성');
      list.unshift(...list.splice(i, 1));
    }
    return list;
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  emit(event, payload) {
    this.io.to(this.code).emit(event, payload);
  }

  broadcast() {
    if (!this.closed) this.emit('room:state', this.snapshot());
  }

  humans() {
    return [...this.players.values()].filter((p) => !p.isBot);
  }

  opponentOf(playerId) {
    for (const p of this.players.values()) if (p.id !== playerId) return p;
    return null;
  }

  topicOf(p) {
    return this.topics[p.topicIdx % this.topics.length];
  }

  newPlayer(id, profile, isBot = false) {
    return {
      id,
      name: profile.name,
      char: profile.char,
      isBot,
      connected: true,
      socketId: null,
      dropTimer: null,
      ready: false,
      score: 0,
      streak: 0,
      attempts: 0,
      topicIdx: 0,
      busy: false,
      frozenUntil: 0,
      live: null,
    };
  }

  // ---------- 입장 / 퇴장 ----------

  // 신규 입장과 재접속을 모두 처리한다
  join(socket, playerId, profile) {
    let p = this.players.get(playerId);
    if (p) {
      clearTimeout(p.dropTimer);
      p.dropTimer = null;
    } else {
      if (this.players.size >= this.capacity) return { ok: false, error: '방이 가득 찼어요' };
      if (this.state !== 'waiting') return { ok: false, error: '이미 시작된 게임이에요' };
      p = this.newPlayer(playerId, profile);
      this.players.set(playerId, p);
    }
    p.socketId = socket.id;
    p.connected = true;
    socket.join(this.code);
    socket.data.roomCode = this.code;
    socket.data.playerId = playerId;

    if (this.state === 'waiting' && this.players.size === this.capacity) this.startCountdown();
    else this.broadcast();
    return { ok: true, room: this.snapshot() };
  }

  addBot() {
    if (this.settings.tutorial || this.state !== 'waiting' || this.players.size !== 1) {
      return { ok: false, error: '지금은 연습봇을 부를 수 없어요' };
    }
    const id = `bot-${Math.random().toString(36).slice(2, 10)}`;
    const bot = this.newPlayer(id, {
      name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
      char: BOT_CHARS[Math.floor(Math.random() * BOT_CHARS.length)],
    }, true);
    this.players.set(id, bot);
    this.startCountdown();
    return { ok: true };
  }

  // 소켓이 끊김: 바로 내보내지 않고 재접속을 기다린다
  socketDropped(playerId, socketId) {
    const p = this.players.get(playerId);
    if (!p || p.socketId !== socketId) return;
    p.connected = false;
    this.broadcast();
    p.dropTimer = setTimeout(() => this.leave(playerId), RECONNECT_GRACE_MS);
  }

  // 나가기 버튼 또는 재접속 시간 초과. 게임 중이면 기권 처리되고 상대도 게임이 끝난다.
  leave(playerId) {
    const p = this.players.get(playerId);
    if (!p || this.closed) return;
    clearTimeout(p.dropTimer);
    if (this.state === 'countdown' || this.state === 'playing') {
      this.end('forfeit', this.opponentOf(playerId)?.id ?? null, playerId);
    }
    this.players.delete(playerId);
    if (this.humans().length === 0) return this.close();
    if (this.state === 'waiting') {
      // 대기실에 봇만 남으면 봇도 내보낸다
      for (const other of this.players.values()) if (other.isBot) this.players.delete(other.id);
    }
    this.tryRematch();
    this.broadcast();
  }

  // ---------- 진행 ----------

  startCountdown() {
    this.state = 'countdown';
    this.countdownEndsAt = Date.now() + COUNTDOWN_MS;
    this.broadcast();
    this.later(() => this.start(), COUNTDOWN_MS);
  }

  start() {
    const duration = this.settings.timeLimit * 1000;
    this.state = 'playing';
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + duration;
    this.broadcast();
    this.later(() => this.end('timeup'), duration);
    for (const p of this.players.values()) if (p.isBot) this.scheduleBot(p, 2500 + Math.random() * 2500);
  }

  submit(playerId, raw) {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: '플레이어를 찾을 수 없어요' };
    if (this.state !== 'playing') return { ok: false, error: '아직 게임 중이 아니에요' };
    if (p.busy) return { ok: false, error: 'AI가 아직 답변 중이에요' };
    if (Date.now() < p.frozenUntil) return { ok: false, error: '얼어붙어서 입력할 수 없어요!' };

    const text = String(raw ?? '').trim();
    if (!text) return { ok: false, error: '프롬프트를 입력해 주세요' };
    const limit = this.settings.promptLimit;
    if (limit && [...text].length > limit) return { ok: false, error: `${limit}자를 넘었어요` };

    const topic = this.topicOf(p);
    const banned = findBannedWord(text, topic);
    if (banned) return { ok: false, error: `'${banned}'은(는) 직접 쓸 수 없어요!` };

    p.busy = true;
    p.attempts += 1;
    p.live = { prompt: text, text: '', phase: 'stream', result: null };
    this.emit('ai:start', { playerId, prompt: text });
    this.broadcast();
    this.runAnswer(p, text, topic).catch((err) => {
      console.error('[ai] answer failed', err);
      p.busy = false;
      this.broadcast();
    });
    return { ok: true };
  }

  async runAnswer(p, prompt, topic) {
    const round = this.round;
    const alive = () => !this.closed && this.round === round && this.state === 'playing';

    const answer = composeAnswer(prompt, topic, REQUIRED_HITS[this.settings.difficulty]);
    for await (const chunk of streamText(answer)) {
      if (!alive()) return;
      p.live.text += chunk;
      this.emit('ai:chunk', { playerId: p.id, chunk });
    }
    if (!alive()) return;

    // 평가 AI가 답변을 줄마다 읽는 시간
    const lines = answer.split('\n').filter((l) => l.trim()).length;
    const durationMs = JUDGE_BASE_MS + lines * JUDGE_PER_LINE_MS;
    p.live.phase = 'judge';
    this.emit('ai:judge', { playerId: p.id, durationMs });
    await sleep(durationMs);
    if (!alive()) return;

    const result = judge(answer, topic);
    p.live.phase = 'done';
    p.live.result = result;
    if (result.pass) {
      p.score += 1;
      p.streak = p.attempts === 1 ? p.streak + 1 : 0;
      p.topicIdx += 1;
      p.attempts = 0;
      if (p.streak >= STREAK_FOR_FREEZE) {
        p.streak = 0;
        const opp = this.opponentOf(p.id);
        if (opp) {
          opp.frozenUntil = Date.now() + FREEZE_MS;
          this.emit('game:event', { type: 'freeze', from: p.id, target: opp.id, until: opp.frozenUntil });
        }
      }
    } else {
      p.streak = 0;
    }
    p.busy = false;
    this.emit('ai:result', { playerId: p.id, ...result });
    this.broadcast();

    if (p.isBot) {
      if (Math.random() < 0.4) this.later(() => this.chat(p.id, botLine(result.pass)), 600);
      this.scheduleBot(p, 2500 + Math.random() * 3500);
    }
  }

  scheduleBot(bot, ms) {
    this.later(() => this.botTurn(bot), ms);
  }

  botTurn(bot) {
    if (this.state !== 'playing' || !this.players.has(bot.id)) return;
    if (bot.busy || Date.now() < bot.frozenUntil) return this.scheduleBot(bot, 1500);
    const prompt = botPrompt(this.topicOf(bot));
    // 타이핑하는 척
    const len = [...prompt].length;
    [0.3, 0.6, 1].forEach((f, i) =>
      this.later(() => this.emit('player:typing', { playerId: bot.id, len: Math.round(len * f) }), 400 * (i + 1)),
    );
    this.later(() => {
      if (this.state === 'playing' && this.players.has(bot.id)) this.submit(bot.id, prompt);
    }, 1700);
  }

  chat(playerId, text) {
    this.emit('player:chat', { playerId, text });
  }

  end(reason, winnerId, leaverId = null) {
    if (this.state !== 'countdown' && this.state !== 'playing') return;
    this.round += 1; // 진행 중이던 AI 답변 중단
    this.clearTimers();
    this.state = 'ended';
    const endedAt = Date.now();
    const players = [...this.players.values()];
    for (const p of players) {
      p.busy = false;
      p.ready = p.isBot; // 봇은 언제나 한판 더 OK
    }
    if (winnerId === undefined) {
      const [a, b] = players;
      if (!b) winnerId = a?.id ?? null;
      else winnerId = a.score === b.score ? null : a.score > b.score ? a.id : b.id;
    }
    this.lastResult = {
      code: this.code,
      reason,
      winnerId,
      leaverId,
      durationMs: this.startedAt ? endedAt - this.startedAt : 0,
      players: this.snapshot().players,
    };
    this.emit('game:end', this.lastResult);
    this.broadcast();
  }

  // ---------- 한번 더 하기 ----------

  rematch(playerId) {
    const p = this.players.get(playerId);
    if (!p || this.state !== 'ended') return { ok: false, error: '지금은 다시 할 수 없어요' };
    p.ready = true;
    this.tryRematch();
    this.broadcast();
    return { ok: true };
  }

  tryRematch() {
    if (this.state !== 'ended') return;
    const all = [...this.players.values()];
    if (!all.every((p) => p.ready)) return;
    // 같은 방 설정으로 초기화
    this.topics = this.pickTopics();
    this.startedAt = this.endsAt = null;
    for (const p of all) {
      Object.assign(p, { ready: false, score: 0, streak: 0, attempts: 0, topicIdx: 0, busy: false, frozenUntil: 0, live: null });
    }
    if (all.length >= this.capacity) {
      this.startCountdown();
    } else {
      // 상대가 나갔으면 같은 방 코드로 새 상대를 기다린다
      this.state = 'waiting';
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    for (const p of this.players.values()) clearTimeout(p.dropTimer);
    this.io.in(this.code).socketsLeave(this.code);
    this.onClose(this.code);
  }

  snapshot() {
    const showTopic = this.state === 'playing' || this.state === 'ended';
    return {
      code: this.code,
      settings: this.settings,
      state: this.state,
      countdownEndsAt: this.countdownEndsAt,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      serverNow: Date.now(),
      lastResult: this.state === 'ended' ? this.lastResult : null,
      players: [...this.players.values()].map((p) => {
        const t = this.topicOf(p);
        return {
          id: p.id,
          name: p.name,
          char: p.char,
          isBot: p.isBot,
          ready: p.ready,
          score: p.score,
          streak: p.streak,
          connected: p.connected,
          busy: p.busy,
          frozenUntil: p.frozenUntil,
          topicIdx: p.topicIdx,
          topic: showTopic
            ? { topic: t.topic, length: lengthLabel(t), keyword: t.keyword, banned: bannedWords(t) }
            : null,
          live: p.live,
        };
      }),
    };
  }
}

import { readFileSync } from 'node:fs';
import { checkPrompt, checkAnswer, drawSequence } from '../promptRules.js';
import { createMockAI, generateWithRetry } from './gemini.js';
import { botPrompt, botEmoji, BOT_NAMES } from './bot.js';

const DATA = JSON.parse(readFileSync(new URL('../problems.json', import.meta.url), 'utf8'));
const DIFFICULTY_KO = { easy: '쉬움', normal: '보통', hard: '어려움' };
const SEQUENCE_LENGTH = 40;
const PROMPT_HARD_CAP = 2000; // 방 설정이 무제한이어도 서버는 이 이상 받지 않는다
const REPLAY_TICK_MS = 40;
const REPLAY_MAX_TICKS = 75; // 답변 재생은 아무리 길어도 약 3초
const JUDGE_MAX_MS = 4500;

const COUNTDOWN_MS = 3500;
const RECONNECT_GRACE_MS = 20_000;
const FREEZE_MS = 5000;
const SKIP_PAUSE_MS = 3000; // 건너뛰면 내 입력이 잠깐 멈춘다 (분량만 골라 뽑는 것을 막는다)
const STREAK_FOR_FREEZE = 3;
// 평가 AI가 답변을 "읽는" 시간. 너무 빨리 채점되면 사용자가 결과를 읽을 틈이 없다.
const JUDGE_BASE_MS = 900;
const JUDGE_PER_LINE_MS = 750;
const BOT_CHARS = ['cat', 'pigeon', 'dog', 'otaku'];
const TUTORIAL_FIRST = { topic: '광합성', lengthRule: { name: '3문장 이내', type: 'sentences', value: 3 } };

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
  constructor(io, code, settings, onClose, ai) {
    this.io = io;
    this.ai = ai;
    this.mock = createMockAI();
    this.code = code;
    this.settings = settings;
    this.onClose = onClose;
    this.players = new Map(); // playerId -> player
    this.state = 'waiting';
    this.round = 0; // 판이 바뀌면 증가. 이전 판의 AI 답변이 새 판에 섞이지 않게 한다.
    this.sequence = this.pickSequence();
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

  // 판 시작 때 문제 목록을 미리 뽑아 둔다. 두 사람이 같은 순서로 풀고, 각자 자기 속도로 넘어간다.
  pickSequence() {
    const difficulty = DIFFICULTY_KO[this.settings.difficulty] ?? '보통';
    const list = drawSequence(DATA, difficulty, SEQUENCE_LENGTH);
    if (this.settings.tutorial) {
      // 튜토리얼은 기획서 예시(광합성)로 시작
      const problem = DATA.problems.find((p) => p.topic === TUTORIAL_FIRST.topic);
      list.unshift({ problem, lengthRule: TUTORIAL_FIRST.lengthRule });
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

  // 사람마다 따로 보낸다. 상대 프롬프트는 판이 끝날 때까지 보여 주지 않는다.
  broadcast() {
    if (this.closed) return;
    for (const p of this.humans()) {
      if (p.socketId && p.connected) this.io.to(p.socketId).emit('room:state', this.snapshot(p.id));
    }
  }

  humans() {
    return [...this.players.values()].filter((p) => !p.isBot);
  }

  opponentOf(playerId) {
    for (const p of this.players.values()) if (p.id !== playerId) return p;
    return null;
  }

  // { problem, lengthRule }
  topicOf(p) {
    return this.sequence[p.topicIdx % this.sequence.length];
  }

  aiFor(p) {
    return p.isBot || this.settings.tutorial ? this.mock : this.ai;
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
      frozenKind: null,
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
    return { ok: true, room: this.snapshot(playerId) };
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
    if (this.state === 'countdown') {
      // 시작 전 카운트다운 중에 나가면 판이 무효다. 승패 없이 대기실로 돌아간다.
      this.clearTimers();
      this.state = 'waiting';
      this.countdownEndsAt = null;
      for (const other of this.players.values()) other.ready = false;
    } else if (this.state === 'playing') {
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
    const item = this.topicOf(p);
    const limit = this.settings.promptLimit || null;
    const check = checkPrompt(text, item.problem, limit ?? PROMPT_HARD_CAP);
    if (!check.ok) return { ok: false, error: promptError(check) };

    p.busy = true;
    p.attempts += 1;
    p.live = { prompt: text, text: '', phase: 'stream', result: null };
    for (const other of this.players.values()) {
      if (other.socketId && other.connected) {
        this.io.to(other.socketId).emit('ai:start', { playerId: p.id, prompt: other.id === p.id ? text : null });
      }
    }
    this.broadcast();
    this.runAnswer(p, text, item).catch((err) => {
      console.error('[ai] answer failed', err);
      p.busy = false;
      this.broadcast();
    });
    return { ok: true };
  }

  // 건너뛰기: 점수 없이 내 다음 문제로 넘어간다. 연속 카운트는 0이 되고 내 입력이 3초 멈춘다.
  skip(playerId) {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: '플레이어를 찾을 수 없어요' };
    if (this.settings.tutorial) return { ok: false, error: '튜토리얼에서는 건너뛸 수 없어요' };
    if (this.state !== 'playing') return { ok: false, error: '아직 게임 중이 아니에요' };
    if (p.busy) return { ok: false, error: 'AI가 답변 중일 때는 건너뛸 수 없어요' };
    if (Date.now() < p.frozenUntil) return { ok: false, error: '지금은 입력할 수 없어요' };
    p.topicIdx += 1;
    p.attempts = 0;
    p.streak = 0;
    p.live = null;
    p.frozenUntil = Date.now() + SKIP_PAUSE_MS;
    p.frozenKind = 'skip';
    this.emit('game:event', { type: 'skip', target: p.id, until: p.frozenUntil });
    this.broadcast();
    return { ok: true };
  }

  async runAnswer(p, prompt, item) {
    const round = this.round;
    const alive = () => !this.closed && this.round === round && this.state === 'playing';
    const { problem, lengthRule } = item;

    const gen = await generateWithRetry(this.aiFor(p), prompt, { problem, lengthRule });
    if (!alive()) return;
    if (gen.status !== 'OK') {
      // AI가 끝내 답하지 못했다. 시도로 세지 않고 다시 보낼 수 있게 한다.
      console.warn(`[ai] 답변 실패: ${gen.status} ${gen.finishReason ?? ''} ${gen.detail ?? ''}`);
      p.busy = false;
      p.attempts = Math.max(0, p.attempts - 1);
      p.live = null;
      this.emitTo(p, 'ai:void', { playerId: p.id, message: 'AI가 답하지 못했어요. 다시 보내 주세요' });
      this.broadcast();
      return;
    }

    // 판정은 서버가 지금 확정한다. 이후의 답변 재생과 평가 연출은 이 결과를 보여 주기만 한다.
    const answer = gen.text;
    const verdict = checkAnswer(answer, problem, lengthRule, DATA.difficultyRules, { truncated: gen.truncated });

    for (const chunk of replayChunks(answer)) {
      if (!alive()) return;
      p.live.text += chunk;
      this.emit('ai:chunk', { playerId: p.id, chunk });
      await sleep(REPLAY_TICK_MS);
    }
    if (!alive()) return;

    // 평가 AI가 답변을 줄마다 읽는 시간
    const lines = answer.split('\n').filter((l) => l.trim()).length;
    const durationMs = Math.min(JUDGE_MAX_MS, JUDGE_BASE_MS + lines * JUDGE_PER_LINE_MS);
    p.live.phase = 'judge';
    this.emit('ai:judge', { playerId: p.id, durationMs });
    await sleep(durationMs);
    if (!alive()) return;

    const result = { pass: verdict.pass, reason: verdictReason(verdict) };
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
          opp.frozenKind = 'freeze';
          this.emit('game:event', { type: 'freeze', from: p.id, target: opp.id, until: opp.frozenUntil });
        }
      }
    } else {
      p.streak = 0;
    }
    p.busy = false;
    this.emit('ai:result', { playerId: p.id, ...result, verdict });
    this.broadcast();

    if (p.isBot) {
      if (Math.random() < 0.4) this.later(() => this.emit('player:emote', { playerId: p.id, emoji: botEmoji(result.pass) }), 600);
      this.scheduleBot(p, 2500 + Math.random() * 3500);
    }
  }

  emitTo(p, event, payload) {
    if (p.socketId && p.connected) this.io.to(p.socketId).emit(event, payload);
  }

  scheduleBot(bot, ms) {
    this.later(() => this.botTurn(bot), ms);
  }

  botTurn(bot) {
    if (this.state !== 'playing' || !this.players.has(bot.id)) return;
    if (bot.busy || Date.now() < bot.frozenUntil) return this.scheduleBot(bot, 1500);
    const prompt = botPrompt();
    // 타이핑하는 척
    const len = [...prompt].length;
    [0.3, 0.6, 1].forEach((f, i) =>
      this.later(() => this.emit('player:typing', { playerId: bot.id, len: Math.round(len * f) }), 400 * (i + 1)),
    );
    this.later(() => {
      if (this.state === 'playing' && this.players.has(bot.id)) this.submit(bot.id, prompt);
    }, 1700);
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
    this.sequence = this.pickSequence();
    this.startedAt = this.endsAt = null;
    for (const p of all) {
      Object.assign(p, { ready: false, score: 0, streak: 0, attempts: 0, topicIdx: 0, busy: false, frozenUntil: 0, frozenKind: null, live: null });
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

  // viewerId: 이 스냅샷을 받는 사람. null이면 공개용(결과 화면)이다.
  snapshot(viewerId = null) {
    const showTopic = this.state === 'playing' || this.state === 'ended';
    const reveal = this.state === 'ended';
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
        const { problem, lengthRule } = this.topicOf(p);
        const hidePrompt = !reveal && p.id !== viewerId;
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
          frozenKind: p.frozenKind,
          topicIdx: p.topicIdx,
          topic: showTopic
            ? {
                topic: problem.topic,
                length: lengthRule.name,
                keyword: problem.keywords.join(' · '),
                keywords: problem.keywords,
                banned: [problem.topic, ...problem.keywords],
                problem, // 클라이언트도 같은 규칙 파일로 금지어를 미리 검사한다
              }
            : null,
          live: p.live && hidePrompt ? { ...p.live, prompt: null } : p.live,
        };
      }),
    };
  }
}

// 답변을 약 3초 안에 다 보여 주도록 조각으로 나눈다
function* replayChunks(text) {
  const chars = [...text];
  const step = Math.max(1, Math.ceil(chars.length / REPLAY_MAX_TICKS));
  for (let i = 0; i < chars.length; i += step) yield chars.slice(i, i + step).join('');
}

function promptError(check) {
  switch (check.code) {
    case 'EMPTY':
      return '프롬프트를 입력해 주세요';
    case 'TOO_LONG':
      return `${check.limit}자를 넘었어요`;
    case 'FORBIDDEN':
      return `'${check.word}'은(는) 직접 쓸 수 없어요!`;
    default:
      return '보낼 수 없는 프롬프트예요';
  }
}

function verdictReason(v) {
  if (v.pass) return `필수어 ${v.matched.join(', ')} 포함, 분량도 딱 맞아요!`;
  const unit = v.length.type === 'sentences' ? '문장' : '자';
  const parts = [];
  if (v.reasons.includes('EMPTY')) parts.push('답변이 비어 있어요');
  if (v.reasons.includes('TRUNCATED')) parts.push('답변이 너무 길어서 잘렸어요');
  if (v.reasons.includes('LENGTH_OVER')) parts.push(`너무 길어요! (${v.length.actual}${unit} / ${v.length.limit}${unit} 이내)`);
  if (v.reasons.includes('KEYWORD_SHORT')) parts.push(`필수어가 ${v.matched.length}개뿐이에요 (${v.needed}개 필요)`);
  return parts.join(' · ');
}

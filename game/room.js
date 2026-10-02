import { readFileSync } from 'node:fs';
import { checkPrompt, checkAnswer, drawSequence, locateMatches, locateOverflow, requiredWords } from '../promptRules.js';
import { createMockAI, generateWithRetry } from './gemini.js';
import { botPrompt, BOT_NAMES } from './bot.js';

const DATA = JSON.parse(readFileSync(new URL('../problems.json', import.meta.url), 'utf8'));
// 난이도 4단계. 화면에서 보내는 값 -> problems.json의 난이도 이름
const DIFFICULTY_KO = { easy: '쉬움', normal: '보통', hard: '어려움', expert: '매우 어려움' };
const SEQUENCE_LENGTH = 40;
const PROMPT_HARD_CAP = 2000; // 방 설정이 무제한이어도 서버는 이 이상 받지 않는다
const REPLAY_TICK_MS = 40;
const REPLAY_MAX_TICKS = 75; // 답변 재생은 아무리 길어도 약 3초
const JUDGE_MAX_MS = 4500;

const DEFAULT_TIMING = {
  countdownMs: 3500,
  replayTickMs: REPLAY_TICK_MS,
  judgeBaseMs: 900, // 평가 AI가 답변을 "읽는" 시간. 너무 빨리 채점되면 사용자가 결과를 읽을 틈이 없다.
  judgePerLineMs: 750,
  waitTtlMs: 600_000, // 대기방은 10분 안에 상대가 안 오면 닫는다
  submitGapMs: 1000, // 같은 사람의 프롬프트 전송 최소 간격
  rematchMs: 10_000, // 한 번 더 하기 요청이 유효한 시간
};
const LOG_MAX = 60; // 결과 화면에 보여 줄 프롬프트 기록은 사람당 최대 60개
const LOG_ANSWER_MAX = 400;
const RECONNECT_GRACE_MS = 20_000;
const FREEZE_MS = 5000;
const SKIP_PAUSE_MS = 3000; // 건너뛰면 내 입력이 잠깐 멈춘다 (분량만 골라 뽑는 것을 막는다)
const STREAK_FOR_FREEZE = 3;
const BOT_CHARS = ['cat', 'pigeon', 'dog', 'otaku', 'miku', 'snake', 'engineer', 'mantis', 'ditto', 'chiikawa'];
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
  constructor(io, code, settings, onClose, ai, timing = {}, hooks = {}) {
    this.io = io;
    this.hooks = hooks; // { seen, ranking }. 없으면 해당 기능을 건너뛴다
    this.t = { ...DEFAULT_TIMING, ...timing };
    this.usedIds = []; // 이전 판에서 나온 문제 번호. 한 번 더 하기에서 겹치지 않게 한다.
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
    this.scheduleWaitExpiry();
  }

  // 상대가 안 들어온 대기방은 오래 두지 않는다
  scheduleWaitExpiry() {
    clearTimeout(this.waitTimer);
    this.waitTimer = setTimeout(() => {
      if (this.state === 'waiting' && !this.closed) {
        this.emit('room:closed', { reason: 'expired' });
        this.close();
      }
    }, this.t.waitTtlMs);
    this.waitTimer.unref?.(); // 이 타이머만으로 프로세스가 살아 있지 않게 한다
  }

  get capacity() {
    return this.settings.tutorial || this.settings.solo ? 1 : 2;
  }

  // 판 시작 때 문제 목록을 미리 뽑아 둔다. 두 사람이 같은 순서로 풀고, 각자 자기 속도로 넘어간다.
  pickSequence() {
    const difficulty = DIFFICULTY_KO[this.settings.difficulty] ?? '보통';
    // 이 방에서 이미 나온 문제와, 두 사람이 이전에 본 문제를 먼저 피해서 뽑는다
    const pool = new Set(DATA.problems.filter((p) => p.difficulty === difficulty).map((p) => p.id));
    const avoid = new Set(this.usedIds);
    if (!this.settings.tutorial) for (const h of this.humans()) for (const id of this.hooks.seen?.ids(h.device) ?? []) avoid.add(id);
    const list = drawSequence(DATA, difficulty, SEQUENCE_LENGTH, Math.random, [...avoid].filter((id) => pool.has(id)));
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

  // 방 설정의 AI(Gemini, GPT, Claude)를 쓴다. 연습봇과 튜토리얼은 항상 목 AI다. 설정한 AI를 쓸 수 없으면 기본 AI로 돌아간다.
  aiFor(p) {
    if (p.isBot || this.settings.tutorial) return this.mock;
    return this.hooks.providers?.[this.settings.ai] ?? this.ai;
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
      firstTry: 0, // 한 번에 맞힌 문제 수
      bestStreak: 0,
      lastSubmitAt: 0,
      log: [], // 이번 판에서 보낸 프롬프트와 결과. 판이 끝난 뒤 결과 화면에서 공개한다
      device: isBot ? null : (profile.device ?? null), // 랭킹과 본 문제 기록에 쓰는 기기 ID. 밖으로 보내지 않는다
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
    if (this.settings.tutorial || this.settings.solo || this.state !== 'waiting' || this.players.size !== 1) {
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
      this.scheduleWaitExpiry();
    } else if (this.state === 'playing' && this.settings.solo) {
      // 솔로 판을 중간에 나가면 기록하지 않고 방을 닫는다
      this.clearTimers();
    } else if (this.state === 'playing') {
      const opp = this.opponentOf(playerId);
      // 두 사람이 모두 끊겨 있으면 누구의 잘못이라고 할 수 없다. 승패 없이 판을 무효로 한다.
      if (opp && !opp.isBot && !opp.connected) this.end('aborted', null, playerId);
      else this.end('forfeit', opp?.id ?? null, playerId);
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
    clearTimeout(this.waitTimer);
    this.countdownEndsAt = Date.now() + this.t.countdownMs;
    this.broadcast();
    this.later(() => this.start(), this.t.countdownMs);
  }

  start() {
    const duration = this.settings.timeLimit * 1000;
    this.sequence = this.pickSequence(); // 두 사람이 다 들어온 뒤에 뽑아야 두 사람이 본 문제를 피할 수 있다
    this.state = 'playing';
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + duration;
    this.broadcast();
    this.later(() => this.timeUp(), duration);
    for (const p of this.players.values()) if (p.isBot) this.scheduleBot(p, 2500 + Math.random() * 2500);
  }

  // 시간이 끝나면 AI가 답하는 중이든 판정 중이든 바로 끝낸다. 진행 중이던 요청은 버리고 점수에 넣지 않는다.
  timeUp() {
    this.end('timeup');
  }

  submit(playerId, raw) {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: '플레이어를 찾을 수 없어요' };
    if (this.state !== 'playing') return { ok: false, error: '아직 게임 중이 아니에요' };
    if (Date.now() >= this.endsAt) return { ok: false, error: '시간이 끝났어요' };
    if (p.busy) return { ok: false, error: 'AI가 아직 답변 중이에요' };
    if (Date.now() < p.frozenUntil) return { ok: false, error: '얼어붙어서 입력할 수 없어요!' };
    if (Date.now() - p.lastSubmitAt < this.t.submitGapMs) return { ok: false, error: '너무 빨라요! 잠깐만 기다려 주세요' };

    const text = String(raw ?? '').trim();
    const item = this.topicOf(p);
    const limit = this.settings.promptLimit || null;
    const check = checkPrompt(text, item.problem, limit ?? PROMPT_HARD_CAP);
    if (!check.ok) return { ok: false, error: promptError(check) };

    p.busy = true;
    p.lastSubmitAt = Date.now();
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
    if (Date.now() >= this.endsAt) return { ok: false, error: '시간이 끝났어요' };
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

    const gen = await generateWithRetry(this.aiFor(p), prompt, { problem, lengthRule }, {
      onRetry: (n) => alive() && this.emitTo(p, 'ai:retrying', { playerId: p.id, n }),
    });
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
      await sleep(this.t.replayTickMs);
    }
    if (!alive()) return;

    // 평가 AI가 답변을 줄마다 읽는 시간
    const lines = answer.split('\n').filter((l) => l.trim()).length;
    const durationMs = Math.min(JUDGE_MAX_MS, this.t.judgeBaseMs + lines * this.t.judgePerLineMs);
    p.live.phase = 'judge';
    // 평가 연출용: 필수어 위치와 분량을 넘기 시작한 위치(원문 글자 위치). 판정은 아래 verdict가 전부다.
    const marks = locateMatches(answer, requiredWords(problem)).map(({ start, end }) => ({ start, end }));
    const over = verdict.lengthOk || verdict.truncated ? null : locateOverflow(answer, lengthRule);
    this.emit('ai:judge', { playerId: p.id, durationMs, len: answer.length, marks, over });
    await sleep(durationMs);
    if (!alive()) return;

    const result = { pass: verdict.pass, reason: verdictReason(verdict) };
    p.log.push({ topic: problem.topic, difficulty: problem.difficulty, attempt: p.attempts, prompt, answer: answer.slice(0, LOG_ANSWER_MAX), pass: result.pass, reasons: verdict.reasons, reason: result.reason });
    if (p.log.length > LOG_MAX) p.log.shift();
    p.live.phase = 'done';
    p.live.result = result;
    if (result.pass) {
      p.score += 1;
      if (p.attempts === 1) p.firstTry += 1;
      p.streak = p.attempts === 1 ? p.streak + 1 : 0;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
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

    if (p.isBot) this.scheduleBot(p, 2500 + Math.random() * 3500);
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
    clearTimeout(this.rematchTimer);
    this.rematchTimer = null;
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
      if (!b) winnerId = this.settings.solo ? null : (a?.id ?? null); // 솔로는 이기고 지는 것이 없다
      else winnerId = a.score === b.score ? null : a.score > b.score ? a.id : b.id;
    }
    this.lastResult = {
      code: this.code,
      reason,
      winnerId,
      leaverId,
      isSolo: !!this.settings.solo,
      durationMs: this.startedAt ? endedAt - this.startedAt : 0,
      players: this.snapshot().players,
      // 판이 끝났으니 두 사람이 보낸 프롬프트를 공개한다
      history: players.map((p) => ({ playerId: p.id, name: p.name, entries: p.log })),
    };
    this.recordHistory(reason, winnerId, leaverId, players);
    this.emit('game:end', this.lastResult);
    this.broadcast();
  }

  // 본 문제 기록, 랭킹, 계정별 성적·재화를 남긴다. 튜토리얼은 아무것도 남기지 않는다.
  recordHistory(reason, winnerId, leaverId, players) {
    if (this.settings.tutorial) return;
    for (const p of players) {
      if (p.device) this.hooks.seen?.add(p.device, this.sequence.slice(0, p.topicIdx + 1).map((x) => x.problem.id));
    }
    if (this.settings.solo) {
      // 솔로: 상대가 없으니 랭킹 대신 솔로 기록(개인 최고, 솔로 랭킹)을 남긴다
      const p = players[0];
      const r = p && this.hooks.accounts?.settleSolo({ accountId: p.device, name: p.name, reason, difficulty: DIFFICULTY_KO[this.settings.difficulty], timeLimit: this.settings.timeLimit, score: p.score, firstTry: p.firstTry, bestStreak: p.bestStreak, log: p.log });
      if (r) this.lastResult.soloResult = r;
      return;
    }
    const humans = players.filter((p) => !p.isBot);
    let ranking = null;
    if (reason !== 'aborted' && humans.length === 2 && players.length === 2 && this.hooks.ranking) {
      const [a, b] = humans.map((p) => ({ id: p.id, device: p.device, name: p.name, char: p.char, score: p.score }));
      ranking = this.hooks.ranking.record({ reason, winnerId, leaverId, a, b });
      if (ranking) this.lastResult.ranking = ranking;
    }
    // device는 로그인한 계정 번호다
    const rewards = this.hooks.accounts?.settle({
      reason,
      winnerId,
      leaverId,
      vsBot: players.some((p) => p.isBot),
      difficulty: DIFFICULTY_KO[this.settings.difficulty],
      ranking,
      players: players.map((p) => ({ id: p.id, accountId: p.device, name: p.name, score: p.score, firstTry: p.firstTry, bestStreak: p.bestStreak, log: p.log })),
    });
    if (rewards && Object.keys(rewards).length) this.lastResult.rewards = rewards;
  }

  // ---------- 한번 더 하기 ----------

  rematch(playerId) {
    const p = this.players.get(playerId);
    if (!p || this.state !== 'ended') return { ok: false, error: '지금은 다시 할 수 없어요' };
    p.ready = true;
    this.tryRematch();
    if (this.state === 'ended' && [...this.players.values()].some((x) => x.ready)) this.armRematchExpiry();
    this.broadcast();
    return { ok: true };
  }

  // 한 번 더 하기 요청은 일정 시간 안에 상대가 응답하지 않으면 취소된다
  armRematchExpiry() {
    if (this.rematchTimer) return;
    this.rematchTimer = setTimeout(() => {
      this.rematchTimer = null;
      if (this.state !== 'ended' || this.closed) return;
      for (const p of this.players.values()) p.ready = p.isBot;
      this.emit('rematch:expired', {});
      this.broadcast();
    }, this.t.rematchMs);
    this.rematchTimer.unref?.();
  }

  tryRematch() {
    if (this.state !== 'ended') return;
    const all = [...this.players.values()];
    if (!all.every((p) => p.ready)) return;
    clearTimeout(this.rematchTimer);
    this.rematchTimer = null;
    // 같은 방 설정으로 초기화
    // 이번 판에서 본 문제는 다음 판에서 먼저 피한다
    const reached = Math.max(0, ...all.map((p) => p.topicIdx)) + 1;
    for (const item of this.sequence.slice(0, reached)) this.usedIds.push(item.problem.id);
    this.sequence = this.pickSequence();
    this.startedAt = this.endsAt = null;
    for (const p of all) {
      Object.assign(p, { ready: false, score: 0, streak: 0, attempts: 0, topicIdx: 0, busy: false, frozenUntil: 0, frozenKind: null, firstTry: 0, bestStreak: 0, lastSubmitAt: 0, log: [], live: null });
    }
    if (all.length >= this.capacity) {
      this.startCountdown();
    } else {
      // 상대가 나갔으면 같은 방 코드로 새 상대를 기다린다
      this.state = 'waiting';
      this.scheduleWaitExpiry();
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.waitTimer);
    clearTimeout(this.rematchTimer);
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
          aiKind: this.aiFor(p).kind,
          topicIdx: p.topicIdx,
          topic: showTopic
            ? {
                topic: problem.topic,
                length: lengthRule.name,
                keyword: requiredWords(problem).join(' · '),
                keywords: requiredWords(problem),
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
    case 'LENGTH_SPEC':
      return `분량('${check.match}')은 직접 말할 수 없어요!`;
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

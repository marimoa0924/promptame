// 게임 화면. 서버 이벤트를 받아 그리기만 하고, 시간 표시는 requestAnimationFrame 루프가 담당한다.
// 네트워크 응답을 기다리는 동안에도 루프와 애니메이션은 계속 돈다.
import { socket, session, request } from './net.js';
import { $, refs, charSvg, EMOTES, toast, copyText, formatTime, replay } from './ui.js';
import { applyTheme, sceneSvg, sparkle, SCENE_W, SCENE_TOP, SCENE_BOTTOM, SCENE_FLOOR } from './maps.js';
import { coach } from './tutorial.js';

const ROULETTE = {
  topic: ['광합성', '중력', '화산', '무지개', '소화', '민주주의', '인공지능', '훈민정음', '물의 순환', '달의 위상'],
  length: ['1줄 이내', '2줄 이내', '3줄 이내', '5줄 이내'],
  keyword: ['엽록체', '뉴턴', '마그마', '굴절', '효소', '투표', '학습', '세종', '증발', '공전'],
};
const STREAK_FOR_FREEZE = 3;
const FINAL_SECONDS = 10;
const normalize = (s) => s.replace(/\s+/g, '').toLowerCase();

function createBoard(slot, isMe) {
  const el = $('#tpl-board').content.firstElementChild.cloneNode(true);
  el.classList.add(isMe ? 'me' : 'opp');
  slot.replaceChildren(el);
  const r = refs(el);
  r.tag.textContent = isMe ? '나' : '상대';
  if (!isMe) {
    r.form.remove();
    r.chatForm.remove();
    r.avatar.title = '';
  }
  // 배경 SVG가 늘어나는 비율에 맞춰 캐릭터를 바닥 위에 세운다
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    const scale = Math.max(width / SCENE_W, height / (SCENE_BOTTOM - SCENE_TOP));
    r.frame.style.setProperty('--floor', `${Math.round((SCENE_BOTTOM - SCENE_FLOOR) * scale)}px`);
  }).observe(r.frame);
  return { el, r, isMe, playerId: null, topicKey: null, spin: {}, overlayKey: null, timers: {}, judgeTimers: [] };
}

const REEL_SPINS = 14;
const reelItem = (text) => Object.assign(document.createElement('span'), { className: 'reel-item', textContent: text });

export class Game {
  constructor() {
    this.room = null;
    this.map = null;
    this.offset = 0; // 서버 시각 - 내 시각
    this.prevState = null;
    this.startFlashUntil = 0;
    this.me = null;
    this.opp = null;
    this.boards = {
      me: createBoard($('#side-me'), true),
      opp: createBoard($('#side-opp'), false),
    };
    this.bindInput();
    this.bindChat();
    this.bindEmotes();
    this.bindSocket();
    $('#room-code').addEventListener('click', () => this.room && copyText(this.room.code));
    requestAnimationFrame(() => this.tick());
  }

  now() {
    return Date.now() + this.offset;
  }

  // ---------- 상태 반영 ----------

  // fresh: 입장/재접속 직후. 놓친 스트리밍 내용을 스냅샷으로 복원한다.
  setRoom(room, { fresh = false } = {}) {
    if (fresh) this.resetBoards();
    // 한번 더 하기로 새 판이 시작되면 보드를 비운다
    if (this.prevState === 'ended' && room.state !== 'ended') this.resetBoards();

    if (room.settings.map !== this.map) {
      this.map = room.settings.map;
      applyTheme(document.body, this.map);
      for (const b of Object.values(this.boards)) b.r.scene.innerHTML = sceneSvg(this.map);
    }
    this.room = room;
    this.offset = room.serverNow - Date.now();
    this.me = room.players.find((p) => p.id === session.playerId) ?? null;
    this.opp = room.players.find((p) => p.id !== session.playerId) ?? null;

    if (this.prevState === 'countdown' && room.state === 'playing') this.startFlashUntil = Date.now() + 800;
    this.prevState = room.state;

    $('#screen-game').classList.toggle('tutorial', !!room.settings.tutorial);
    $('#room-title').textContent = room.settings.title;
    $('#room-code').textContent = room.settings.tutorial ? '튜토리얼 모드' : `방 코드 ${room.code} ⧉`;
    this.renderHud($('#hud-me'), this.me);
    this.renderHud($('#hud-opp'), this.opp, room.settings.tutorial ? '튜토리얼' : '상대 기다리는 중');
    this.renderBoard(this.boards.me, this.me);
    this.renderBoard(this.boards.opp, this.opp);
    this.updateForm();
  }

  resetBoards() {
    this.prevState = null;
    for (const b of Object.values(this.boards)) {
      b.playerId = null;
      b.topicKey = null;
      b.overlayKey = null;
      this.stopJudge(b);
      this.hydrateLive(b, null);
      this.setTopicText(b, null);
      b.r.flash.className = 'flash';
      b.r.avatar.className = 'avatar';
    }
  }

  // HUD는 한 번만 뼈대를 만들고 값만 바꾼다 (말풍선이 지워지지 않게)
  renderHud(el, p, emptyLabel = '') {
    if (!el.dataset.built) {
      el.dataset.built = '1';
      el.innerHTML = `
        <div class="hud-avatar"></div>
        <div class="hud-info"><span class="hud-name"></span><span class="hud-score"></span></div>
        <div class="hud-bubble"></div>`;
    }
    const avatar = $('.hud-avatar', el);
    const charKey = p ? p.char : '';
    if (avatar.dataset.char !== charKey) {
      avatar.dataset.char = charKey;
      avatar.innerHTML = p ? charSvg(p.char) : '<span class="q">?</span>';
    }
    $('.hud-name', el).textContent = p ? `${p.name}${p.isBot ? ' 🤖' : ''}` : emptyLabel;
    $('.hud-score', el).innerHTML = `${p ? p.score : 0}<small> PASS</small>`;
    el.classList.toggle('offline', !!p && !p.connected);
  }

  renderBoard(b, p) {
    const { r } = b;
    if (!p) {
      b.playerId = null;
      r.name.textContent = '???';
      r.avatar.innerHTML = '';
      r.streak.textContent = '';
      this.setTopicText(b, null);
      return;
    }
    if (b.playerId !== p.id) {
      b.playerId = p.id;
      this.hydrateLive(b, p.live);
    }
    r.name.textContent = `${p.name}${p.isBot ? ' 🤖' : ''}`;
    if (r.avatar.dataset.char !== p.char) {
      r.avatar.dataset.char = p.char;
      r.avatar.innerHTML = charSvg(p.char);
    }
    r.streak.textContent = `🔥 ${p.streak}/${STREAK_FOR_FREEZE}`;
    r.streak.classList.toggle('hot', p.streak >= STREAK_FOR_FREEZE - 1);
    b.el.classList.toggle('busy', p.busy);

    const key = p.topic ? `${p.topicIdx}` : null;
    if (key !== b.topicKey) {
      b.topicKey = key;
      if (p.topic && this.room.state === 'playing') this.roulette(b, p.topic);
      else this.setTopicText(b, p.topic);
    }
  }

  setReel(b, k, text) {
    clearTimeout(b.spin[k]);
    const strip = b.r[k];
    strip.style.transition = 'none';
    strip.style.transform = '';
    strip.replaceChildren(reelItem(text));
    this.slotOf(b, k).classList.remove('spinning');
  }

  slotOf(b, k) {
    return b.r[`slot${k[0].toUpperCase()}${k.slice(1)}`];
  }

  setTopicText(b, topic) {
    for (const k of ['topic', 'length', 'keyword']) this.setReel(b, k, topic ? topic[k] : '???');
    b.r.banned.textContent = topic ? `금지어: ${topic.banned.join(', ')}` : '';
    if (b.isMe) this.checkBanned();
  }

  // 슬롯머신처럼 릴이 돌다가 차례로 멈춘다
  roulette(b, topic) {
    b.r.banned.textContent = `금지어: ${topic.banned.join(', ')}`;
    ['topic', 'length', 'keyword'].forEach((k, i) => {
      const strip = b.r[k];
      const pool = ROULETTE[k];
      const ms = 1100 + i * 450;
      const spins = Array.from({ length: REEL_SPINS + i * 4 }, () => pool[Math.floor(Math.random() * pool.length)]);
      clearTimeout(b.spin[k]);
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';
      strip.replaceChildren(...[...spins, topic[k]].map(reelItem));
      void strip.offsetHeight;
      strip.style.transition = `transform ${ms}ms cubic-bezier(0.15, 0.7, 0.25, 1.06)`;
      strip.style.transform = `translateY(-${spins.length * 1.5}em)`;
      const slot = this.slotOf(b, k);
      slot.classList.add('spinning');
      b.spin[k] = setTimeout(() => {
        this.setReel(b, k, topic[k]);
        replay(slot, 'landed');
      }, ms + 40);
    });
    if (b.isMe) this.checkBanned();
  }

  hydrateLive(b, live) {
    const { r } = b;
    r.prompt.textContent = live ? `▶ ${live.prompt}` : '';
    r.answer.textContent = live ? live.text : '';
    r.answer.classList.toggle('streaming', !!live && live.phase === 'stream');
    this.showStamp(b, live?.result ?? null, false);
  }

  // ---------- AI 답변: 스트리밍 → 평가 AI 읽기 → PASS / RETRY ----------

  boardOf(playerId) {
    return Object.values(this.boards).find((b) => b.playerId === playerId) ?? null;
  }

  onAiStart({ playerId, prompt }) {
    const b = this.boardOf(playerId);
    if (!b) return;
    this.stopJudge(b);
    b.r.prompt.textContent = `▶ ${prompt}`;
    b.r.answer.textContent = '';
    b.r.answer.classList.add('streaming');
    this.showStamp(b, null);
    b.el.classList.add('busy');
    b.r.avatar.classList.remove('cheer', 'cry');
  }

  onAiChunk({ playerId, chunk }) {
    const b = this.boardOf(playerId);
    if (!b) return;
    b.r.answer.append(chunk);
    b.r.scroll.scrollTop = b.r.scroll.scrollHeight;
  }

  // 평가 AI가 한 줄씩 형광펜을 칠하며 읽는다
  onAiJudge({ playerId, durationMs }) {
    const b = this.boardOf(playerId);
    if (!b) return;
    const { answer } = b.r;
    answer.classList.remove('streaming');
    const lines = answer.textContent.split('\n');
    answer.replaceChildren();
    const spans = lines.map((text, i) => {
      const span = document.createElement('span');
      span.className = 'line';
      span.textContent = text;
      answer.append(span);
      if (i < lines.length - 1) answer.append('\n');
      return span;
    });
    b.el.classList.add('judging');
    const per = (durationMs - 300) / Math.max(1, spans.length);
    spans.forEach((span, i) => {
      b.judgeTimers.push(
        setTimeout(() => {
          spans[i - 1]?.classList.replace('reading', 'read');
          span.style.setProperty('--d', `${per}ms`);
          span.classList.add('reading');
          span.scrollIntoView({ block: 'nearest' });
        }, i * per),
      );
    });
  }

  stopJudge(b) {
    b.judgeTimers.forEach(clearTimeout);
    b.judgeTimers = [];
    b.el.classList.remove('judging');
  }

  onAiResult({ playerId, pass, reason }) {
    const b = this.boardOf(playerId);
    if (!b) return;
    this.stopJudge(b);
    for (const s of b.r.answer.querySelectorAll('.line')) s.className = 'line read';
    this.showStamp(b, { pass, reason });

    // PASS: 검은 화면 / RETRY: 블루스크린
    const f = b.r.flash;
    f.innerHTML = pass
      ? `<b>PASS</b><small>+1 · ${reason}</small>`
      : `<p class="bsod-face">:(</p><b>RETRY</b><small></small><small class="bsod-hint">프롬프트를 고쳐서 다시 시도하세요_</small>`;
    if (!pass) f.querySelector('small').textContent = reason;
    f.className = 'flash';
    replay(f, pass ? 'pass' : 'retry');

    // 캐릭터 반응
    b.r.avatar.classList.remove('cheer', 'cry', 'hop');
    replay(b.r.avatar, pass ? 'cheer' : 'cry');
    clearTimeout(b.timers.mood);
    b.timers.mood = setTimeout(() => b.r.avatar.classList.remove('cheer', 'cry'), 2600);
    this.say(b, pass ? '야호!' : '엉엉…');

    if (b.isMe) coach.emit('result');
  }

  showStamp(b, result, animate = true) {
    const s = b.r.stamp;
    s.className = 'stamp';
    s.innerHTML = '';
    if (!result) return;
    s.innerHTML = `${result.pass ? sparkle() : ''}<b>${result.pass ? 'PASS' : 'RETRY'}</b><small></small>`;
    $('small', s).textContent = result.reason;
    s.classList.add(result.pass ? 'pass' : 'fail');
    if (animate) s.classList.add('in');
  }

  // ---------- 캐릭터: 말풍선 / 채팅 ----------

  // 캐릭터 대사는 상단 HUD의 내 이름 옆에 말풍선으로 띄운다
  say(b, text) {
    const el = $(`${b.isMe ? '#hud-me' : '#hud-opp'} .hud-bubble`);
    if (!el) return;
    el.textContent = text;
    replay(el, 'show');
    clearTimeout(b.timers.bubble);
    b.timers.bubble = setTimeout(() => el.classList.remove('show'), 3200);
  }

  openChat() {
    const { r } = this.boards.me;
    r.chatForm.hidden = false;
    r.chatInput.focus();
  }

  bindChat() {
    const { r } = this.boards.me;
    r.avatar.addEventListener('click', () => {
      replay(r.avatar, 'hop');
      if (r.chatForm.hidden) this.openChat();
      else r.chatForm.hidden = true;
    });
    this.boards.opp.r.avatar.addEventListener('click', () => replay(this.boards.opp.r.avatar, 'hop'));
    r.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') r.chatForm.hidden = true;
    });
    r.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = r.chatInput.value.trim().slice(0, 30);
      if (!text || !this.room) return;
      socket.emit('player:chat', { text });
      this.say(this.boards.me, text);
      replay(r.avatar, 'hop');
      r.chatInput.value = '';
      r.chatForm.hidden = true;
      coach.emit('chat');
    });
  }

  // ---------- 입력 ----------

  bindInput() {
    const { r } = this.boards.me;
    let lastTypingSent = 0;

    r.input.addEventListener('input', () => {
      this.updateCounter();
      this.checkBanned();
      const now = Date.now();
      if (now - lastTypingSent > 300) {
        lastTypingSent = now;
        socket.emit('player:typing', { len: [...r.input.value].length });
      }
    });

    r.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        r.form.requestSubmit();
      }
    });

    r.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = r.input.value.trim();
      if (!text || r.send.disabled) return;
      r.send.disabled = true;
      const res = await request('prompt:submit', { text });
      if (!res.ok) {
        toast(res.error, 'error');
        replay(r.form, 'shake');
      } else {
        r.input.value = '';
        this.updateCounter();
        this.checkBanned();
        coach.emit('submitted');
      }
      this.updateForm();
    });
  }

  fillPrompt(text) {
    const { r } = this.boards.me;
    r.input.value = text;
    r.input.dispatchEvent(new Event('input'));
    r.input.focus();
  }

  updateCounter() {
    const { r } = this.boards.me;
    const limit = this.room?.settings.promptLimit ?? 0;
    const len = [...r.input.value].length;
    r.counter.textContent = limit ? `${len} / ${limit}` : `${len}자`;
    r.counter.classList.toggle('over', !!limit && len > limit);
  }

  checkBanned() {
    const { r } = this.boards.me;
    const banned = this.me?.topic?.banned ?? [];
    const text = normalize(r.input.value);
    const hit = banned.find((w) => text.includes(normalize(w)));
    r.warn.textContent = hit ? `'${hit}'은(는) 쓸 수 없어요!` : '';
    r.form.classList.toggle('has-banned', !!hit);
  }

  updateForm() {
    const { r } = this.boards.me;
    const limit = this.room?.settings.promptLimit ?? 0;
    if (limit) r.input.maxLength = limit;
    else r.input.removeAttribute('maxLength');
    this.updateCounter();

    const me = this.me;
    const frozen = !!me && me.frozenUntil > this.now();
    const playing = this.room?.state === 'playing';
    r.input.disabled = !playing || frozen;
    r.send.disabled = !playing || !me || me.busy || frozen;
    r.input.placeholder = !playing
      ? '게임이 시작되면 입력할 수 있어요'
      : frozen
        ? '❄ 얼어붙었어요…'
        : me?.busy
          ? 'AI가 답하는 동안 다음 프롬프트를 미리 써 두세요'
          : '주제를 직접 말하지 말고 AI가 답하게 만들어 보세요! (Enter 전송)';
    this.frozenShown = frozen;
  }

  // ---------- 이모티콘 / 타이핑 ----------

  bindEmotes() {
    const wrap = $('#emotes');
    let last = 0;
    for (const emoji of EMOTES) {
      const btn = document.createElement('button');
      btn.className = 'emote-btn';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        if (Date.now() - last < 800 || !this.room) return;
        last = Date.now();
        socket.emit('player:emote', { emoji });
        this.popEmote(this.boards.me, emoji);
      });
      wrap.append(btn);
    }
  }

  popEmote(b, emoji) {
    b.r.emote.textContent = emoji;
    replay(b.r.emote, 'show');
  }

  onTyping({ playerId, len }) {
    const b = this.boardOf(playerId);
    if (!b) return;
    b.r.typing.textContent = `✍ 입력 중… ${len}자`;
    b.r.typing.classList.add('show');
    clearTimeout(b.timers.typing);
    b.timers.typing = setTimeout(() => b.r.typing.classList.remove('show'), 1500);
  }

  bindSocket() {
    socket.on('ai:start', (d) => this.onAiStart(d));
    socket.on('ai:chunk', (d) => this.onAiChunk(d));
    socket.on('ai:judge', (d) => this.onAiJudge(d));
    socket.on('ai:result', (d) => this.onAiResult(d));
    socket.on('player:typing', (d) => this.onTyping(d));
    socket.on('player:emote', ({ playerId, emoji }) => {
      const b = this.boardOf(playerId);
      if (b) this.popEmote(b, emoji);
    });
    socket.on('player:chat', ({ playerId, text }) => {
      const b = this.boardOf(playerId);
      if (!b) return;
      this.say(b, text);
      replay(b.r.avatar, 'hop');
    });
    socket.on('game:event', (e) => {
      if (e.type !== 'freeze') return;
      if (e.target === session.playerId) toast('❄ 상대가 3연속 원샷 PASS! 5초간 얼음!', 'error', 3000);
      else toast('🔥 3연속 원샷 PASS! 상대를 얼렸어요!', 'ok', 3000);
    });
  }

  reset() {
    this.room = null;
    this.map = null;
    this.me = this.opp = null;
    applyTheme(document.body, 'lobby');
    this.resetBoards();
    this.boards.me.r.input.value = '';
    $('#final-count').hidden = true;
    $('#countdown').hidden = true;
  }

  // ---------- 프레임 루프 (체력바 타이머·카운트다운·오버레이) ----------

  tick() {
    requestAnimationFrame(() => this.tick());
    const room = this.room;
    if (!room) return;
    const now = this.now();
    const total = room.settings.timeLimit * 1000;

    // 체력바 타이머
    let remain = total;
    if (room.state === 'playing') remain = Math.max(0, room.endsAt - now);
    else if (room.state === 'ended') remain = 0;
    const text = room.state === 'waiting' ? '대기 중' : formatTime(remain);
    const timer = $('#timer');
    if (timer.textContent !== text) timer.textContent = text;
    const fill = $('#hp-fill');
    fill.style.width = `${(remain / total) * 100}%`;
    const hp = $('#hp');
    hp.classList.toggle('low', room.state === 'playing' && remain <= 30_000);
    hp.classList.toggle('critical', room.state === 'playing' && remain <= FINAL_SECONDS * 1000);

    // 시작 카운트다운 3 2 1
    const cd = $('#countdown');
    let cdText = null;
    if (room.state === 'countdown') {
      const n = Math.ceil((room.countdownEndsAt - now - 500) / 1000);
      cdText = n > 0 ? String(n) : 'START!';
    } else if (Date.now() < this.startFlashUntil) {
      cdText = 'START!';
    }
    this.setBigText(cd, cdText);

    // 마지막 10초 카운트다운
    const sec = Math.ceil(remain / 1000);
    this.setBigText($('#final-count'), room.state === 'playing' && sec <= FINAL_SECONDS && sec > 0 ? String(sec) : null);

    // 보드 오버레이
    this.updateOverlay(this.boards.me, this.me, now);
    this.updateOverlay(this.boards.opp, this.opp, now);

    // 얼음이 풀리는 순간 입력창 다시 열기
    const frozen = !!this.me && this.me.frozenUntil > now;
    if (frozen !== this.frozenShown) this.updateForm();
  }

  setBigText(wrap, text) {
    wrap.hidden = text === null;
    const span = wrap.firstElementChild;
    if (text !== null && span.textContent !== text) {
      span.textContent = text;
      replay(span, 'pop');
    }
  }

  updateOverlay(b, p, now) {
    const room = this.room;
    let key = null;
    let html = '';
    if (!b.isMe && room.settings.tutorial) {
      key = 'solo';
      html = `<div class="ov-icon">📘</div><p>튜토리얼 모드<br><small>상대 없이 혼자 연습하는 중이에요</small></p>`;
    } else if (!p && !b.isMe) {
      key = 'waiting';
      html = `<div class="ov-icon spin">${sparkle()}</div><p>상대를 기다리는 중<span class="dots"></span></p>
        <button class="btn btn-primary ov-copy">방 코드 <b>${room.code}</b> 복사</button>
        <button class="btn ov-bot">🤖 연습봇과 붙기</button>
        <small class="ov-hint">친구에게 코드를 보내거나, 혼자라면 연습봇을 불러 보세요</small>`;
    } else if (p && !p.connected) {
      key = 'offline';
      html = `<div class="ov-icon">📡</div><p>연결이 끊겼어요<br><small>재접속을 기다리는 중<span class="dots"></span></small></p>`;
    } else if (!b.isMe && p && room.state === 'ended' && this.me?.ready && !p.ready) {
      key = 'rematch';
      html = `<div class="ov-icon spin">${sparkle()}</div><p>상대가 한번 더 할지<br>고르는 중<span class="dots"></span></p>`;
    } else if (p && p.frozenUntil > now) {
      const sec = ((p.frozenUntil - now) / 1000).toFixed(1);
      key = `frozen-${sec}`;
      html = `<div class="ov-icon">❄</div><p>얼음!<br><b>${sec}s</b></p>`;
    }
    if (key === b.overlayKey) return;
    b.overlayKey = key;
    b.r.overlay.hidden = key === null;
    b.r.overlay.className = `board-overlay ${key ? key.split('-')[0] : ''}`;
    b.r.overlay.innerHTML = html;
    $('.ov-copy', b.r.overlay)?.addEventListener('click', () => copyText(room.code));
    $('.ov-bot', b.r.overlay)?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const res = await request('room:addBot');
      if (!res.ok) toast(res.error, 'error');
    });
  }
}

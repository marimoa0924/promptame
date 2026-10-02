// 게임 종료 연출: 흑백 전환 → 두둥! → The Winner is…… → 승자 이름 → 결과 카드
import { playSfx } from './sfx.js';
import { $, refs, CHARACTERS, charSvg, formatTime, replay } from './ui.js';

const REASON = {
  timeup: '시간 종료!',
  aborted: '두 사람 모두 연결이 끊겨 판이 무효가 됐어요',
};

export class Finale {
  constructor({ onLeave, onRematch }) {
    this.el = $('#finale');
    this.r = refs(this.el);
    this.timers = [];
    this.fireworks = new Fireworks($('#fireworks'));
    this.r.intro.addEventListener('click', () => this.showCard());
    this.r.leave.addEventListener('click', () => onLeave());
    this.r.again.addEventListener('click', () => onRematch());
  }

  get visible() {
    return !this.el.hidden;
  }

  later(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  }

  show(result, meId, { skipIntro = false } = {}) {
    this.result = result;
    this.meId = meId;
    this.clear();
    $('#screen-game').classList.add('ended');
    this.el.hidden = false;
    this.r.card.hidden = true;
    this.r.again.disabled = false;
    this.r.readyNote.textContent = '';
    if (skipIntro) return this.showCard();

    const { r } = this;
    r.intro.hidden = false;
    r.winnerIs.hidden = r.winnerName.hidden = true;
    r.dots.textContent = '';
    // 솔로와 무효 판에는 승자가 없으니 "The Winner is" 대신 상황에 맞는 말을 쓴다
    r.winnerIs.firstChild.nodeValue = result.isSolo ? '솔로 결과는' : result.reason === 'aborted' ? '이번 판은' : 'The Winner is';
    replay(r.dudung, 'boom');
    replay(document.body, 'shake');

    this.later(() => {
      r.winnerIs.hidden = false;
      for (let i = 1; i <= 6; i++) this.later(() => (r.dots.textContent = ' .'.repeat(i)), i * 330);
    }, 1300);
    this.later(() => {
      const winner = result.players.find((p) => p.id === result.winnerId);
      const mine = result.players.find((p) => p.id === meId);
      const solo = result.isSolo ? result.soloResult : null;
      r.winnerName.textContent = result.isSolo
        ? `${mine?.score ?? 0} PASS${solo?.isBest ? ' 신기록' : ''}!!`
        : result.reason === 'aborted'
          ? '무효!!'
          : winner
            ? `${winner.name}!!!`
            : '무승부!!';
      r.winnerName.hidden = false;
      replay(r.winnerName, 'pop');
      if (winner || (result.isSolo && result.soloResult?.isBest)) this.fireworks.burst(3);
    }, 3700);
    this.later(() => this.showCard(), 6000);
  }

  showCard() {
    if (!this.result || !this.r.card.hidden) return;
    this.clear();
    const { r, result, meId } = this;
    const me = result.players.find((p) => p.id === meId);
    const opp = result.players.find((p) => p.id !== meId);
    const solo = result.isSolo ? result.soloResult : null;
    const outcome = result.isSolo ? 'solo' : result.reason === 'aborted' ? 'void' : result.winnerId === null ? 'draw' : result.winnerId === meId ? 'win' : 'lose';

    r.intro.hidden = true;
    r.card.hidden = false;
    if (outcome === 'win' || (outcome === 'solo' && solo?.isBest)) playSfx('win');
    else if (outcome === 'lose') playSfx('lose');
    r.card.className = `finale-card ${outcome}`;
    r.title.textContent = { win: 'WIN!', lose: 'LOSE…', draw: 'DRAW', void: '무효', solo: solo?.isBest ? '신기록!' : '솔로 완료!' }[outcome];
    r.reason.textContent =
      result.reason === 'forfeit'
        ? result.leaverId === meId
          ? '연결이 너무 오래 끊겨 기권 처리됐어요'
          : '상대가 게임을 포기했어요'
        : (REASON[result.reason] ?? '');

    // 캐릭터들: 이기면 환호, 지면 바닥 치며 울기
    const mood = outcome === 'win' || (outcome === 'solo' && solo?.isBest) ? 'cheer' : outcome === 'lose' ? 'cry' : 'bob';
    const cast = [...new Set([me?.char ?? 'cat', ...Object.keys(CHARACTERS)])].slice(0, 4);
    r.crowd.innerHTML = cast
      .map((c, i) => `<span class="crowd-member ${mood}${i === 0 ? ' star' : ''}" style="animation-delay:${i * 0.12}s">${charSvg(c)}</span>`)
      .join('');

    const rows = [
      ['총 게임 시간', formatTime(result.durationMs)],
      ['내 포인트', `${me?.score ?? 0} PASS`],
    ];
    if (opp) rows.push([`${opp.name}`, `${opp.score} PASS`]);
    if (outcome === 'solo') {
      rows.length = 1; // 총 게임 시간만 남기고 솔로 전용 항목으로 바꾼다
      rows.push(['맞힌 문제', `${me?.score ?? 0} PASS`]);
      if (solo) {
        rows.push(['내 최고 기록', `${solo.best} PASS${solo.isBest ? ' 🎉 신기록!' : ''}`]);
        if (solo.rank) rows.push(['솔로 랭킹', `${solo.rank}위`]);
        rows.push(['재화', solo.coins ? `+${solo.coins} 🪙 (총 ${solo.total})` : (solo.note ?? '없음')]);
      }
    } else {
      rows.push(['결과', { win: '승리', lose: '패배', draw: '무승부', void: '무효' }[outcome]]);
    }
    const rw = result.rewards?.[meId];
    if (rw) rows.push(rw.coins || !rw.note ? ['재화', `${rw.coins >= 0 ? '+' : ''}${rw.coins} 🪙 (총 ${rw.total})`] : ['재화', rw.note]);
    const rk = result.ranking?.[meId];
    if (rk) {
      rows.push(rk.counted
        ? ['랭크 점수', `${rk.delta >= 0 ? '+' : ''}${rk.delta} → ${rk.rp} RP (${rk.tier.name})`]
        : ['랭크 점수', `반영 안 됨 · ${rk.note}`]);
    }
    r.stats.innerHTML = rows.map(([k]) => `<div><dt></dt><dd></dd></div>`).join('');
    [...r.stats.children].forEach((row, i) => {
      row.querySelector('dt').textContent = rows[i][0];
      row.querySelector('dd').textContent = rows[i][1];
    });

    this.renderHistory(result, meId);

    if (outcome === 'win' || (outcome === 'solo' && solo?.isBest)) this.fireworks.start();
    else this.fireworks.stop();
  }

  // 판이 끝났으니 두 사람이 보낸 프롬프트와 AI 답변을 공개한다
  renderHistory(result, meId) {
    const { historyBox, history } = this.r;
    historyBox.hidden = !result.history?.length;
    history.replaceChildren();
    const mk = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls ?? '', textContent: text ?? '' });
    const ordered = [...(result.history ?? [])].sort((a, b) => (b.playerId === meId) - (a.playerId === meId));
    for (const who of ordered) {
      history.append(mk('h3', '', who.playerId === meId ? `내 프롬프트 (${who.name})` : `${who.name}의 프롬프트`));
      if (!who.entries.length) history.append(mk('p', 'none', '보낸 프롬프트가 없어요'));
      for (const e of who.entries) {
        const item = mk('div', 'history-item');
        const meta = mk('div', 'meta');
        meta.append(mk('span', `badge${e.pass ? '' : ' fail'}`, e.pass ? 'PASS' : 'RETRY'), mk('span', '', `${e.topic} · ${e.attempt}번째 시도`));
        const details = mk('details');
        details.append(mk('summary', '', `AI 답변 · ${e.reason}`), mk('p', '', e.answer));
        item.append(meta, mk('p', 'prompt', e.prompt), details);
        history.append(item);
      }
    }
  }

  // 상대의 한번 더 하기 여부를 보여 준다
  updateRoom(room, meId) {
    if (!this.visible) return;
    const opp = room.players.find((p) => p.id !== meId);
    const note = this.r.readyNote;
    if (room.settings.tutorial || room.settings.solo) note.textContent = '';
    else if (!opp) note.textContent = '상대가 방을 나갔어요. 한번 더 하기를 누르면 새 상대를 기다려요.';
    else if (opp.ready) note.textContent = `✦ ${opp.name}님이 한번 더 하고 싶어해요!`;
    else note.textContent = '';
  }

  clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  hide() {
    this.clear();
    this.fireworks.stop();
    this.el.hidden = true;
    this.result = null;
    $('#screen-game').classList.remove('ended');
  }
}

// 저해상도 캔버스 픽셀 폭죽
class Fireworks {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.running = false;
    this.auto = false;
    this.tick = this.tick.bind(this);
  }

  colors() {
    const cs = getComputedStyle(document.body);
    return ['--c1', '--c2', '--c3', '--accent', '--accent-2'].map((v) => cs.getPropertyValue(v).trim() || '#fff');
  }

  resize() {
    this.canvas.width = Math.ceil(innerWidth / 4);
    this.canvas.height = Math.ceil(innerHeight / 4);
  }

  burst(n = 1) {
    this.resize();
    const cols = this.colors();
    for (let k = 0; k < n; k++) {
      const x = this.canvas.width * (0.15 + Math.random() * 0.7);
      const y = this.canvas.height * (0.15 + Math.random() * 0.35);
      const color = cols[Math.floor(Math.random() * cols.length)];
      for (let i = 0; i < 36; i++) {
        const a = (Math.PI * 2 * i) / 36;
        const sp = 0.6 + Math.random() * 1.4;
        this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 50 + Math.random() * 25, color });
      }
    }
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this.tick);
    }
  }

  start() {
    this.auto = true;
    this.burst(2);
  }

  stop() {
    this.auto = false;
    this.parts = [];
  }

  tick() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.auto && Math.random() < 0.05) this.burst(1);
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const p of this.parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.03;
      p.vx *= 0.98;
      p.life -= 1;
      ctx.globalAlpha = Math.min(1, p.life / 20);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    ctx.globalAlpha = 1;
    if (this.parts.length || this.auto) requestAnimationFrame(this.tick);
    else this.running = false;
  }
}

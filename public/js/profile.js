// 내 기록: 성적, 프롬프트 작성 습관 분석, 최근 경기와 프롬프트, 계정 관리. 분석은 서버가 규칙으로 계산해서 보내 준다.
import { request } from './net.js';
import { $, refs, toast, confirmDialog } from './ui.js';
import { state, setAccount, renderGoogleButton, logout } from './auth.js';

const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls ?? '', textContent: text ?? '' });
const pct = (x) => `${Math.round(x * 100)}%`;
const OUTCOME = { win: '승', loss: '패', draw: '무', solo: '솔' };
const when = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function section(title) {
  const box = el('section', 'pf-section');
  box.append(el('h3', '', title));
  return box;
}

function bar(label, share, note = '') {
  const row = el('div', 'pf-bar');
  const fill = el('span', 'fill');
  fill.style.width = `${Math.round(share * 100)}%`;
  const track = el('span', 'track');
  track.append(fill);
  row.append(el('span', 'lbl', label), track, el('span', 'val', note || pct(share)));
  return row;
}

export function initProfile({ openTips } = {}) {
  const modal = $('#modal-profile');
  const r = refs(modal);

  function render(res) {
    const { account: acc, habit, games, recent } = res;
    r.body.replaceChildren();

    const head = el('div', 'pf-head');
    head.append(el('strong', '', acc.nickname), el('span', 'pf-badge', acc.kind === 'google' ? '구글 계정' : '게스트'));
    const rank = acc.rank ? `${acc.rank.tier.name} · ${acc.rank.rp} RP · ${acc.rank.rank}위` : '랭킹 기록 없음';
    head.append(el('span', 'pf-sub', `${rank} · 🪙 ${acc.coins}`));
    r.body.append(head);

    // 성적
    const st = acc.stats;
    const stats = section('성적');
    const grid = el('dl', 'pf-grid');
    const cell = (k, v) => {
      const d = el('div');
      d.append(el('dt', '', k), el('dd', '', String(v)));
      grid.append(d);
    };
    const decided = st.wins + st.losses;
    cell('판 수', st.games);
    cell('승 / 무 / 패', `${st.wins} / ${st.draws} / ${st.losses}`);
    cell('승률', decided ? pct(st.wins / decided) : '-');
    cell('맞힌 문제', st.passes);
    cell('한 번에 맞힌 비율', st.passes ? pct(st.firstTry / st.passes) : '-');
    cell('최고 연속 PASS', st.bestStreak);
    stats.append(grid);
    r.body.append(stats);

    // 솔로 기록
    const soloBox = section('솔로 기록');
    if (!res.solo?.games) soloBox.append(el('p', 'muted', '아직 솔로 플레이를 안 했어요. 로비의 "솔로" 탭에서 혼자 도전해 보세요!'));
    else {
      soloBox.append(el('p', 'muted', `솔로 ${res.solo.games}판`));
      for (const b of [...res.solo.bests].sort((x, y) => y.score - x.score)) soloBox.append(el('p', 'pf-solo-best', `${b.difficulty} · ${b.timeLimit / 60}분 · 최고 ${b.score} PASS`));
    }
    r.body.append(soloBox);

    // 프롬프트 습관
    const hab = section('프롬프트 작성 습관');
    if (openTips) {
      const b = el('button', 'btn btn-accent2', '🕊️ 고득점 팁 (비둘기 선생님)');
      b.type = 'button';
      b.addEventListener('click', () => openTips(habit));
      hab.append(b);
    }
    if (!habit.enough) {
      hab.append(el('p', 'muted', `프롬프트를 ${habit.need}개 더 쓰면 나의 작성 유형을 알려 줄게요! (지금 ${habit.count}개 기록됨)`));
    } else {
      const type = el('div', 'pf-type');
      type.append(el('strong', '', `나는 "${habit.type.name}"`), el('p', '', habit.type.desc));
      hab.append(type);
      const meta = el('p', 'muted', `최근 ${habit.count}개 기준 · 평균 ${habit.avgLen}자 · 첫 시도 성공률 ${pct(habit.firstTryRate)}${habit.avgAttempts ? ` · 맞힐 때까지 평균 ${habit.avgAttempts.toFixed(1)}번` : ''}`);
      hab.append(meta);
      hab.append(el('h4', '', '자주 쓰는 방법 (성공률 비교)'));
      for (const f of habit.features) {
        const cmp = f.withRate != null ? `${pct(f.withRate)} vs ${pct(f.withoutRate)}` : '';
        hab.append(bar(f.label, f.share, `${pct(f.share)}${cmp ? ` · ${cmp}` : ''}`));
      }
      hab.append(el('p', 'muted small', '"성공률 비교"는 그 방법을 쓴 프롬프트와 안 쓴 프롬프트의 PASS 비율이에요.'));
      hab.append(el('h4', '', '틀린 이유'));
      hab.append(bar('필수어가 부족', habit.failure.keyword), bar('분량 초과', habit.failure.length));
      hab.append(el('h4', '', '이렇게 해 보세요'));
      const ul = el('ul', 'pf-tips');
      for (const t of habit.tips) ul.append(el('li', '', t));
      hab.append(ul);
    }
    r.body.append(hab);

    // 최근 경기
    const gs = section('최근 경기');
    if (!games.length) gs.append(el('p', 'muted', '아직 한 판도 안 했어요.'));
    for (const g of games.slice(0, 10)) {
      const row = el('div', 'pf-game');
      row.append(el('span', `pf-out ${g.outcome}`, OUTCOME[g.outcome]), el('span', '', g.outcome === 'solo' ? `솔로 · ${g.score} PASS` : `${g.vs}${g.bot ? ' 🤖' : ''} · ${g.score} : ${g.oppScore}`));
      const extra = [g.difficulty, g.rp != null ? `${g.rp >= 0 ? '+' : ''}${g.rp} RP` : null, g.coins ? `${g.coins > 0 ? '+' : ''}${g.coins}🪙` : null].filter(Boolean).join(' · ');
      row.append(el('span', 'muted small', `${extra} · ${when(g.t)}`));
      gs.append(row);
    }
    r.body.append(gs);

    // 최근 프롬프트
    if (recent.length) {
      const rp = section('최근에 쓴 프롬프트');
      for (const e of recent) {
        const row = el('div', 'pf-prompt');
        row.append(el('span', `badge${e.pass ? '' : ' fail'}`, e.pass ? 'PASS' : 'RETRY'), el('span', '', e.text));
        rp.append(row);
      }
      r.body.append(rp);
    }

    // 계정 관리
    const mg = section('계정');
    if (acc.kind === 'guest') {
      mg.append(el('p', 'muted', '게스트 계정은 이 브라우저에만 저장돼요. 구글 계정과 연결하면 기록을 잃지 않아요.'));
      const box = el('div', 'pf-google');
      mg.append(box);
      renderGoogleButton(box);
    }
    const actions = el('div', 'pf-actions');
    const clear = el('button', 'btn', '프롬프트·경기 기록 지우기');
    clear.addEventListener('click', async () => {
      if (!(await confirmDialog('프롬프트 기록과 최근 경기를 모두 지울까요? (성적 숫자, 랭킹, 재화는 남아요)'))) return;
      const res = await request('account:clearHistory');
      if (res.ok) {
        toast('기록을 지웠어요', 'ok');
        open();
      }
    });
    const del = el('button', 'btn btn-danger', '계정 삭제');
    del.addEventListener('click', async () => {
      if (!(await confirmDialog('계정을 삭제하면 기록, 랭킹, 재화, 캐릭터가 모두 사라지고 되돌릴 수 없어요. 정말 삭제할까요?'))) return;
      const res = await request('account:delete');
      if (res.ok) {
        modal.hidden = true;
        await logout();
        toast('계정을 삭제했어요', 'ok');
      }
    });
    actions.append(clear, del);
    mg.append(actions);
    r.body.append(mg);
  }

  async function open() {
    modal.hidden = false;
    if (!r.body.childElementCount) r.body.textContent = '불러오는 중…';
    const res = await request('account:get');
    if (!res.ok) {
      modal.hidden = true;
      return toast(res.error ?? '불러오지 못했어요', 'error');
    }
    setAccount(res.account);
    render(res);
  }

  r.close.addEventListener('click', () => (modal.hidden = true));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
  $('#btn-profile').addEventListener('click', open);
  return { open };
}

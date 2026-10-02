// 랭킹 창과 내 등급 표시. 데이터는 서버가 계산해서 주고, 여기서는 그리기만 한다.
import { session, request } from './net.js';
import { $, refs, charSvg } from './ui.js';

const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls ?? '', textContent: text ?? '' });

export function tierLine(me) {
  if (!me) return '아직 랭킹 기록이 없어요. 사람과 한 판 해 보세요!';
  const next = me.tier.next ? ` · ${me.tier.next.name}까지 ${me.tier.next.need}점` : ' · 최고 등급!';
  return `${me.tier.name} · ${me.rp} RP · ${me.rank}위${next}`;
}

export function initRanking() {
  const modal = $('#modal-ranking');
  const r = refs(modal);
  let last = null;
  let tab = 'versus'; // 'versus' | 'solo'
  const solo = { difficulty: 'normal', timeLimit: 180 };

  const render = (data) => {
    if (tab === 'solo') return renderSolo();
    r.rules.hidden = false;
    r.me.textContent = `내 랭크: ${tierLine(data.me)}`;
    r.list.replaceChildren();
    if (!data.top.length) r.list.append(el('li', 'ranking-empty', '아직 아무도 없어요. 첫 랭커가 되어 보세요!'));
    for (const row of data.top) {
      const li = el('li', data.me && row.rank === data.me.rank && row.name === data.me.name ? 'me' : '');
      const name = el('span', 'rk-name', `${row.name}`);
      name.append(el('small', '', `${row.tier.name} · ${row.wins}승 ${row.draws}무 ${row.losses}패`));
      const score = el('span', 'rk-score', `${row.rp} RP`);
      score.append(el('small', '', `${row.games}판`));
      li.append(el('span', 'rk', String(row.rank)), name, score);
      r.list.append(li);
    }
  };

  // 솔로 랭킹: 난이도와 제한시간별 내 최고 기록 순위
  async function renderSolo() {
    r.rules.hidden = true;
    const res = await request('ranking:solo', { difficulty: solo.difficulty, timeLimit: solo.timeLimit });
    if (tab !== 'solo' || !res.ok) return;
    r.me.textContent = `솔로 · ${res.difficulty} · ${res.timeLimit / 60}분 — 맞힌 문제 수 최고 기록`;
    r.list.replaceChildren();
    if (!res.top.length) r.list.append(el('li', 'ranking-empty', '아직 기록이 없어요. 솔로 플레이로 첫 기록을 남겨 보세요!'));
    for (const row of res.top) {
      const li = el('li');
      const name = el('span', 'rk-name', row.name);
      const score = el('span', 'rk-score', `${row.score} PASS`);
      li.append(el('span', 'rk', String(row.rank)), name, score);
      r.list.append(li);
    }
  }

  function selectChip(group, btn) {
    for (const b of group.querySelectorAll('button')) b.classList.toggle('on', b === btn);
  }
  r.tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    tab = btn.dataset.tab;
    selectChip(r.tabs, btn);
    r.soloFilter.hidden = tab !== 'solo';
    if (tab === 'solo') renderSolo();
    else if (last) render(last);
  });
  r.soloDiff.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-v]');
    if (!btn) return;
    solo.difficulty = btn.dataset.v;
    selectChip(r.soloDiff, btn);
    renderSolo();
  });
  r.soloTime.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-v]');
    if (!btn) return;
    solo.timeLimit = Number(btn.dataset.v);
    selectChip(r.soloTime, btn);
    renderSolo();
  });

  async function refresh() {
    const res = await request('ranking:get', { device: session.device });
    if (!res.ok) return null;
    last = res;
    $('#my-rank').textContent = res.me ? `🏆 ${tierLine(res.me)}` : '';
    if (!modal.hidden) render(res);
    return res;
  }

  async function open() {
    modal.hidden = false;
    if (last) render(last);
    const res = await refresh();
    if (res) render(res);
  }

  r.close.addEventListener('click', () => (modal.hidden = true));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
  $('#btn-ranking').addEventListener('click', open);
  return { refresh, open };
}

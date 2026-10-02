import { spriteSvg } from './sprites.js';
import { applyTheme } from './maps.js';

export const CHARACTERS = {
  cat: { name: '고양이' },
  pigeon: { name: '비둘기' },
  dog: { name: '강아지' },
  otaku: { name: '씹덕' },
  miku: { name: '미쿠' },
  snake: { name: '뱀' },
  engineer: { name: '공대생' },
  mantis: { name: '사마귀' },
  ditto: { name: '메타몽' },
  chiikawa: { name: '치이카와' },
  tv: { name: '티비', secret: true }, // 히든: 나머지를 모두 모으면 열린다
};

export const charSvg = (id, cls = '') => spriteSvg(id in CHARACTERS ? id : 'cat', cls);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function refs(root) {
  return Object.fromEntries($$('[data-ref]', root).map((el) => [el.dataset.ref, el]));
}

// 게임 화면을 뺀 나머지(로그인·인트로·로비)는 언제나 로비 색을 쓴다
const LOBBY_THEMED = new Set(['screen-login', 'screen-intro', 'screen-lobby']);

export function showScreen(id) {
  for (const s of $$('.screen')) s.classList.toggle('active', s.id === id);
  if (LOBBY_THEMED.has(id) && document.body.dataset.theme !== 'lobby') applyTheme(document.body, 'lobby');
}

// 애니메이션 클래스를 다시 재생
export function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

export function toast(message, kind = 'info', ms = 2400) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

export function confirmDialog(message) {
  const modal = $('#modal-confirm');
  const r = refs(modal);
  r.msg.textContent = message;
  modal.hidden = false;
  r.no.focus();
  return new Promise((resolve) => {
    const done = (value) => {
      modal.hidden = true;
      r.yes.onclick = r.no.onclick = null;
      resolve(value);
    };
    r.yes.onclick = () => done(true);
    r.no.onclick = () => done(false);
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // http(비보안) 환경에서는 clipboard API가 막혀 있어서 구식 방법으로 복사
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(`방 코드 ${text} 복사 완료!`, 'ok');
}

export function formatTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

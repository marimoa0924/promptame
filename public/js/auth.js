// 로그인(구글 또는 게스트)과 로그인한 계정 상태. 판단은 서버가 하고, 여기서는 토큰을 보관하고 화면을 이어 준다.
import { socket, session, request, tokenStore } from './net.js';
import { $, showScreen, toast } from './ui.js';
import { playIntro } from './intro.js';

export const state = { account: null, googleEnabled: false, clientId: '', providers: [], defaultAi: 'mock' };
const listeners = [];
export const onAccount = (fn) => listeners.push(fn);

export function setAccount(account) {
  state.account = account;
  for (const fn of listeners) fn(account);
}

let afterLogin = () => {};
let googleReady = null;

// 구글 로그인 스크립트는 설정(GOOGLE_CLIENT_ID)이 있을 때만 불러온다
function loadGoogle() {
  if (googleReady) return googleReady;
  googleReady = new Promise((resolve) => {
    if (globalThis.google?.accounts?.id) return resolve(true);
    const s = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true, defer: true });
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.append(s);
  });
  return googleReady;
}

async function onGoogleCredential({ credential }) {
  const res = await request('auth:google', { credential, legacyDevice: session.device });
  if (!res.ok) return toast(res.error, 'error');
  tokenStore.set(res.token);
  setAccount(res.account);
  if (res.linked) toast('구글 계정과 연결했어요! 이제 기록이 계정에 안전하게 남아요', 'ok', 3500);
  else if (res.switched) toast('기존 구글 계정으로 로그인했어요', 'ok', 3000);
  afterLogin();
}

// container 안에 "Google로 로그인" 버튼을 그린다. 설정이 없으면 안내만 보여 준다.
export async function renderGoogleButton(container) {
  container.replaceChildren();
  if (!state.googleEnabled) {
    container.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Google 로그인은 서버에 GOOGLE_CLIENT_ID 설정이 있어야 해요.' }));
    return;
  }
  if (!(await loadGoogle())) {
    container.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: '구글 로그인 스크립트를 불러오지 못했어요.' }));
    return;
  }
  google.accounts.id.initialize({ client_id: state.clientId, callback: onGoogleCredential });
  google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ko', width: 260 });
}

async function guestLogin() {
  const res = await request('auth:guest', { legacyDevice: session.device });
  if (!res.ok) return toast(res.error, 'error');
  tokenStore.set(res.token);
  setAccount(res.account);
  afterLogin();
}

export function showLogin() {
  showScreen('screen-login');
  renderGoogleButton($('#google-login'));
}

export async function logout() {
  await request('auth:logout', { token: tokenStore.get() });
  tokenStore.set(null);
  session.room = null;
  setAccount(null);
  showLogin();
}

// 시작: 저장된 토큰으로 이어서 로그인하고, 안 되면 로그인 화면을 보여 준다
export async function startAuth(onReady) {
  afterLogin = async () => {
    // 진행 중이던 방이 있으면 화면은 재접속 처리(main.js)가 맡는다. 여기서 로비를 띄우면 게임 맵 색 그대로 로비가 보인다.
    if (session.room) return onReady?.();
    await playIntro();
    showScreen('screen-lobby');
    onReady?.();
  };
  $('#btn-guest').addEventListener('click', guestLogin);
  try {
    const cfg = await (await fetch('/config.json')).json();
    state.clientId = cfg.googleClientId ?? '';
    state.googleEnabled = !!state.clientId;
    state.providers = cfg.providers ?? [];
    state.defaultAi = cfg.defaultAi ?? 'mock';
  } catch {
    /* 설정을 못 읽으면 구글 로그인은 꺼 둔다 */
  }
  const me = await request('auth:me');
  if (me.ok) {
    setAccount(me.account);
    afterLogin();
  } else {
    tokenStore.set(null);
    showLogin();
  }
}

// 서버가 로그인 상태를 잃었을 때(서버 재시작으로 토큰이 사라지거나 다른 곳에서 삭제) 로그인 화면으로 돌아간다
socket.on('connect', async () => {
  if (!state.account) return;
  const me = await request('auth:me');
  if (!me.ok) {
    tokenStore.set(null);
    setAccount(null);
    showLogin();
    toast('다시 로그인해 주세요', 'error');
  }
});

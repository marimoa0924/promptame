import { socket, session, request } from './net.js';
import { $, showScreen, toast, confirmDialog } from './ui.js';
import { initLobby } from './lobby.js';
import { initRanking } from './ranking.js';
import { startAuth, onAccount, setAccount, logout } from './auth.js';
import { initProfile } from './profile.js';
import { initShop } from './shop.js';
import { Game } from './game.js';
import { Finale } from './finale.js';
import { applyTheme } from './maps.js';
import { startBackground } from './bg.js';
import { coach, LOBBY_STEPS, GAME_STEPS, EXAMPLE_PROMPT } from './tutorial.js';

startBackground($('#bg'));
applyTheme(document.body, 'lobby');

const game = new Game();
const finale = new Finale({ onLeave: leaveRoom, onRematch: rematch });
const shop = initShop();
const lobby = initLobby({ onEnterRoom: enterRoom, onOpenShop: () => shop.open() });
const ranking = initRanking();
initProfile();

// 계정 정보가 바뀔 때마다(로그인, 상점, 경기 정산) 로비 화면을 맞춘다
function refreshAccount() {
  return request('auth:me').then((r) => r.ok && setAccount(r.account));
}
onAccount((acc) => {
  lobby.applyAccount(acc);
  const rk = acc?.rank ? `${acc.rank.tier.name} ${acc.rank.rp}RP` : '랭킹 기록 없음';
  $('#account-chip').textContent = acc ? `${acc.nickname} · 🪙 ${acc.coins} · 🏆 ${rk} · ${acc.kind === 'google' ? '구글 계정' : '게스트 계정'}` : '';
  shop.render();
});
$('#btn-logout').addEventListener('click', logout);
let tutorialStarted = false;

function enterRoom(room) {
  session.room = room.code;
  tutorialStarted = false;
  game.setRoom(room, { fresh: true });
  showScreen('screen-game');
  // 결과창을 보던 중에 새로고침했다면 결과 카드부터 다시 보여 준다
  const me = room.players.find((p) => p.id === session.playerId);
  if (room.state === 'ended' && room.lastResult && !me?.ready) {
    finale.show(room.lastResult, session.playerId, { skipIntro: true });
  }
}

function toLobby() {
  ranking.refresh(); // 방금 끝난 판의 랭크 점수와 재화를 반영한다
  refreshAccount();
  session.room = null;
  coach.stop();
  finale.hide();
  game.reset();
  showScreen('screen-lobby');
}

async function leaveRoom() {
  // 서버가 보내는 game:end(기권 패배)를 내가 받지 않도록 먼저 방 세션을 끊는다
  session.room = null;
  await request('room:leave');
  toLobby();
}

async function rematch() {
  const res = await request('room:rematch');
  if (!res.ok) {
    toast(res.error, 'error');
    return toLobby();
  }
  finale.hide();
}

$('#btn-exit').addEventListener('click', async () => {
  if (!game.room) return;
  const playing = ['countdown', 'playing'].includes(game.room.state);
  if (playing && !(await confirmDialog('정말 게임을 포기하실건가요?'))) return;
  leaveRoom();
});

socket.on('room:state', (room) => {
  if (room.code !== session.room) return;
  game.setRoom(room);
  finale.updateRoom(room, session.playerId);
  // 튜토리얼: 주제문 룰렛이 멈춘 뒤 안내 시작
  if (room.settings.tutorial && room.state === 'playing' && !tutorialStarted) {
    tutorialStarted = true;
    setTimeout(() => {
      if (session.room !== room.code) return;
      coach.run(GAME_STEPS, {
        actions: { example: () => game.fillPrompt(EXAMPLE_PROMPT) },
        onDone: () => {
          try {
            localStorage.setItem('promptame.tutorialDone', '1');
          } catch {
            /* 저장 실패해도 무시 */
          }
        },
      });
    }, 1700);
  }
});

// 한 번 더 하기 요청에 상대가 응답하지 않아 취소됐다: 결과 카드를 다시 보여 준다
socket.on('rematch:expired', () => {
  const last = game.room?.lastResult;
  if (!last || last.code !== session.room) return;
  finale.show(last, session.playerId, { skipIntro: true });
  toast('상대가 응답하지 않아 한번 더 하기가 취소됐어요', 'info', 3000);
});

// 대기방이 오래 비어 있어서 닫혔다
socket.on('room:closed', () => {
  if (!session.room) return;
  toast('대기방이 닫혔어요. 다시 만들어 주세요', 'error');
  toLobby();
});

socket.on('game:end', (result) => {
  if (result.code !== session.room) return;
  coach.stop();
  finale.show(result, session.playerId);
});

// 튜토리얼: 로비 안내 → 혼자 하는 연습 게임
async function startTutorialGame() {
  const res = await request('room:create', {
    playerId: session.playerId,
    profile: lobby.profile(),
    settings: { tutorial: true, map: lobby.selectedMap() },
  });
  if (!res.ok) return toast(res.error, 'error');
  enterRoom(res.room);
}

$('#btn-tutorial').addEventListener('click', () => coach.run(LOBBY_STEPS, { onDone: startTutorialGame }));

// 연결/재연결: 진행 중이던 방이 있으면 자동으로 복귀한다 (새로고침 포함)
const banner = $('#net-banner');
socket.on('connect', async () => {
  banner.hidden = true;
  if (!session.room) return;
  const res = await request('room:join', {
    playerId: session.playerId,
    profile: session.profile,
    code: session.room,
  });
  if (res.ok) {
    enterRoom(res.room);
  } else {
    toast('진행 중이던 게임이 종료되었어요', 'error');
    toLobby();
  }
});
socket.on('disconnect', () => {
  banner.hidden = false;
});

// 처음 온 사람에게는 튜토리얼 버튼을 반짝여 준다
try {
  if (!localStorage.getItem('promptame.tutorialDone')) $('#btn-tutorial').classList.add('blink');
} catch {
  $('#btn-tutorial').classList.add('blink');
}

// 로그인부터 시작한다(저장된 토큰이 있으면 바로 로비로)
startAuth(() => ranking.refresh());

// 맵별 배경음악. 카운트다운과 플레이 중에만 그 맵의 곡이 반복 재생되고, 판이 끝나거나 방을 나가면 멈춘다.
// 브라우저는 사용자가 한 번이라도 누르기 전에는 소리를 막는다. 방에 들어오려면 이미 눌렀으므로 보통은 바로 재생된다.
const KEY = 'bgm-muted';
const VOLUME = 0.35;
const tracks = new Map();
let current = null;
let wanted = null; // 지금 틀어야 하는 맵(없으면 null)
let muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch { /* 저장소를 못 쓰면 켜진 채로 둔다 */ }

function audioFor(map) {
  if (!tracks.has(map)) {
    const a = new Audio(`/audio/bgm-${map}.mp3`);
    a.loop = true;
    a.preload = 'auto';
    a.volume = VOLUME;
    tracks.set(map, a);
  }
  return tracks.get(map);
}

function apply() {
  if (current && current !== wanted) {
    current.pause();
    current.currentTime = 0;
    current = null;
  }
  if (!wanted || muted) {
    current?.pause();
    return;
  }
  const a = audioFor(wanted);
  current = a;
  if (a.paused) a.play().catch(() => {}); // 자동재생이 막히면 다음 상호작용 때 다시 시도된다
}

// 방 상태가 바뀔 때마다 부른다. map: 'east' | 'future' | 'medieval' | 'space'
// 판이 진행 중이면 그 맵의 곡, 대기방과 로비는 로비 곡, 결과 화면(ended)은 효과음만 들리도록 조용히 둔다.
export function syncBgm(state, map) {
  if (state === 'countdown' || state === 'playing') wanted = map || null;
  else if (state === 'ended') wanted = null;
  else wanted = 'lobby';
  apply();
}

export const stopBgm = () => syncBgm('lobby', null); // 방을 나가면 로비 곡

export function initBgmButton(btn) {
  const paint = () => {
    btn.textContent = muted ? '🔇' : '🔊';
    btn.title = muted ? '배경음악 켜기' : '배경음악 끄기';
    btn.setAttribute('aria-pressed', String(!muted));
  };
  btn.addEventListener('click', () => {
    muted = !muted;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* 무시 */ }
    paint();
    apply();
  });
  // 자동재생이 막혔다면 첫 클릭이나 키 입력 때 이어서 튼다
  document.addEventListener('pointerdown', apply);
  document.addEventListener('keydown', apply);
  paint();
  syncBgm('lobby', null); // 처음에는 로비 곡. 브라우저가 막으면 첫 클릭 때 시작된다
}

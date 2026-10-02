// 소켓 연결 + 세션. 모든 요청은 Promise로 감싸서 UI가 응답을 기다리며 멈추지 않게 한다.
/* global io */
export const socket = io({ transports: ['websocket', 'polling'] });

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// sessionStorage는 탭마다 따로라서 한 브라우저에서 탭 두 개로 대결 테스트가 가능하다.
// 새로고침해도 같은 플레이어로 다시 접속된다.
function stored(storage, key) {
  return {
    get: () => {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (v) => {
      try {
        if (v == null) storage.removeItem(key);
        else storage.setItem(key, v);
      } catch {
        /* 저장소 차단 시 무시 */
      }
    },
  };
}

const pidStore = stored(sessionStorage, 'promptame.pid');
const roomStore = stored(sessionStorage, 'promptame.room');
const profileStore = stored(localStorage, 'promptame.profile');

if (!pidStore.get()) pidStore.set(uid());

export const session = {
  playerId: pidStore.get() ?? uid(),
  get room() {
    return roomStore.get();
  },
  set room(code) {
    roomStore.set(code);
  },
  get profile() {
    try {
      return { name: '', char: 'cat', ...JSON.parse(profileStore.get() ?? '{}') };
    } catch {
      return { name: '', char: 'cat' };
    }
  },
  set profile(p) {
    profileStore.set(JSON.stringify(p));
  },
};

export function request(event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, res) => {
      resolve(err ? { ok: false, error: '서버 응답이 없어요' } : res);
    });
  });
}

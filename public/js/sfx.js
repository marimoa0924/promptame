// 효과음. 🔊 버튼으로 음소거하면(배경음악과 같은 설정) 효과음도 꺼진다.
const files = { click: 'click.wav', pass: 'pass.wav', retry: 'retry.wav', gacha: 'gacha.wav', win: 'win.wav', lose: 'lose.wav' };
const volume = { click: 0.5, pass: 0.7, retry: 0.7, gacha: 0.9, win: 0.8, lose: 0.8 };
const cache = new Map();

const muted = () => {
  try { return localStorage.getItem('bgm-muted') === '1'; } catch { return false; }
};

export function playSfx(name) {
  if (!files[name] || muted()) return;
  let base = cache.get(name);
  if (!base) {
    base = new Audio(`/audio/${files[name]}`);
    base.preload = 'auto';
    cache.set(name, base);
  }
  const a = base.cloneNode(); // 겹쳐 울릴 수 있게 복제해서 튼다
  a.volume = volume[name] ?? 0.7;
  a.play().catch(() => {});
}

// 버튼을 누르면 딸깍. 효과음이 따로 있는 버튼(뽑기 등)과 음소거 버튼은 제외한다.
export function initClickSfx() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('button, .btn');
    if (b && !b.disabled && !b.closest('.reveal') && b.id !== 'btn-bgm') playSfx('click');
  });
}

// 뽑기 연출: 캡슐이 흔들리며 두근두근 → 실루엣 룰렛이 점점 느려짐 → 반짝 터지며 캐릭터 공개.
// 결과는 서버가 이미 정했고, 여기서는 보여 주기만 한다. 화면을 누르면 건너뛴다.
import { playSfx } from './sfx.js';
import { CHARACTERS, charSvg } from './ui.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const el = (tag, cls, html) => Object.assign(document.createElement(tag), { className: cls ?? '', innerHTML: html ?? '' });

let ctx = null;
function beep(freq, ms = 70, type = 'square', gain = 0.05) {
  try {
    if (localStorage.getItem('bgm-muted') === '1') return; // 🔇 상태면 효과음도 끈다
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + ms / 1000);
  } catch { /* 소리를 못 내도 연출은 계속한다 */ }
}

function confetti(box, n = 36) {
  const colors = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#fff', '#c77dff'];
  for (let i = 0; i < n; i++) {
    const p = el('i', 'gc-confetti');
    const a = Math.random() * Math.PI * 2;
    const d = 90 + Math.random() * 170;
    p.style.cssText = `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px;--rot:${Math.random() * 720 - 360}deg;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.12}s`;
    box.append(p);
  }
}

// root: 연출을 깔 요소(비어 있어야 한다), resultId: 서버가 뽑아 준 캐릭터, 반환: 연출이 끝나면 resolve
export async function playGacha(root, resultId, { total = 0, owned = [] } = {}) {
  let skipped = false;
  const skip = () => (skipped = true);
  root.hidden = false;
  root.replaceChildren();
  root.addEventListener('click', skip);

  const wait = async (ms) => {
    const end = Date.now() + ms;
    while (!skipped && Date.now() < end) await sleep(Math.min(40, end - Date.now()));
  };

  const stage = el('div', 'gc-stage');
  const rays = el('div', 'gc-rays');
  const capsule = el('div', 'gc-capsule', '<span class="gc-top"></span><span class="gc-bottom"></span><span class="gc-shine"></span>');
  const text = el('p', 'gc-text', '두근두근…');
  const slot = el('div', 'gc-slot');
  slot.hidden = true;
  const hint = el('p', 'gc-skip', '화면을 누르면 건너뛰어요');
  stage.append(rays, capsule, slot, text, hint);
  root.append(stage);

  // 1) 캡슐이 점점 세게 흔들린다 (심장 박동처럼 쿵, 쿵)
  const rounds = [['gc-s1', 520, 220], ['gc-s2', 520, 260], ['gc-s3', 600, 330]];
  for (const [cls, ms, hz] of rounds) {
    if (skipped) break;
    capsule.className = `gc-capsule ${cls}`;
    beep(hz, 90, 'sine', 0.09);
    await wait(ms / 2);
    beep(hz * 0.8, 90, 'sine', 0.09);
    await wait(ms / 2);
  }
  if (!skipped) {
    text.textContent = '뭐가 나올까…?!';
    stage.classList.add('gc-dark');
    capsule.className = 'gc-capsule gc-s4';
    await wait(650);
  }

  // 2) 실루엣 룰렛: 빠르게 돌다가 점점 느려지고, 마지막 하나 앞에서 한 번 멈칫한다
  if (!skipped) {
    capsule.hidden = true;
    slot.hidden = false;
    text.textContent = '과연…';
    const pool = Object.keys(CHARACTERS);
    const delays = [50, 50, 50, 50, 55, 60, 70, 85, 105, 135, 175, 230, 310, 420, 600, 850]; // 점점 느려진다
    let shown = null;
    const steps = delays.length;
    for (let i = 0; i < steps && !skipped; i++) {
      let id = pool[Math.floor(Math.random() * pool.length)];
      if (i === steps - 1) id = resultId;
      else if (i === steps - 2) id = pool.find((c) => c !== resultId && !owned.includes(c)) ?? id; // 아깝게 놓친 척
      if (id === shown) id = pool[(pool.indexOf(id) + 1) % pool.length];
      shown = id;
      slot.innerHTML = `<span class="gc-sil">${charSvg(id)}</span>`;
      beep(400 + i * 28, 50, 'square', 0.04);
      await wait(delays[i]);
    }
    await wait(450);
  }

  // 3) 번쩍! 터지면서 공개
  stage.classList.remove('gc-dark');
  stage.classList.add('gc-flash');
  const c = CHARACTERS[resultId];
  slot.hidden = true;
  capsule.hidden = true;
  rays.classList.add('on');
  text.remove();
  const card = el('div', 'gc-reveal', `<span class="gc-new">NEW!</span><span class="gc-char">${charSvg(resultId)}</span><b>🎉 ${c?.name ?? resultId} 획득!</b>${total ? `<small>${total}종 중 ${owned.length}종 보유</small>` : ''}`);
  stage.append(card);
  confetti(stage);
  playSfx('gacha');

  await new Promise((resolve) => {
    const t = setTimeout(done, 3200);
    function done() {
      clearTimeout(t);
      root.removeEventListener('click', done);
      resolve();
    }
    root.addEventListener('click', done); // 공개 후에는 눌러서 닫는다
  });
  root.removeEventListener('click', skip);
  root.hidden = true;
  root.replaceChildren();
}

// 저해상도 캔버스에 메시 그라데이션을 그리고 디더링해서 크게 늘린다 → 로우폴리 도트 배경.
// 테마가 바뀌면(applyTheme → 'theme' 이벤트) 색이 부드럽게 넘어간다.
const W = 96;
const H = 60;
const STEP = 22; // 색 단계 (클수록 도트 느낌이 강함)
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export function startBackground(canvas) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let current = null;
  let from = null;
  let target = null;
  let fadeStart = 0;

  const sparks = Array.from({ length: 14 }, () => ({
    x: Math.floor(Math.random() * W),
    y: Math.floor(Math.random() * H),
    phase: Math.random() * Math.PI * 2,
    speed: 0.6 + Math.random() * 0.8,
  }));

  document.addEventListener('theme', (e) => {
    const next = { bg: e.detail.bg.map(hex), spark: hex(e.detail.palette[0]) };
    if (!current) current = target = next;
    from = current;
    target = next;
    fadeStart = performance.now();
  });

  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!target || now - last < 90) return; // 11fps면 충분
    last = now;

    const t = Math.min(1, (now - fadeStart) / 900);
    current = {
      bg: target.bg.map((c, i) => mix(from.bg[i], c, t)),
      spark: mix(from.spark, target.spark, t),
    };
    const [base, a, b, c] = current.bg;
    const s = now / 1000;

    ctx.fillStyle = `rgb(${base})`;
    ctx.fillRect(0, 0, W, H);
    const blob = (col, x, y, r, alpha) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${col},${alpha})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    blob(a, W * (0.12 + 0.06 * Math.sin(s / 7)), H * (0.18 + 0.08 * Math.cos(s / 9)), W * 0.55, 0.95);
    blob(b, W * (0.9 + 0.05 * Math.cos(s / 8)), H * (0.85 + 0.06 * Math.sin(s / 6)), W * 0.6, 0.95);
    blob(c, W * (0.72 + 0.08 * Math.sin(s / 10)), H * (0.12 + 0.05 * Math.sin(s / 5)), W * 0.35, 0.7);
    blob(c, W * (0.3 + 0.07 * Math.cos(s / 11)), H * (0.95 + 0.04 * Math.cos(s / 7)), W * 0.4, 0.45);

    // 4×4 베이어 디더링 + 색 단계 줄이기
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const bias = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * STEP;
        for (let k = 0; k < 3; k++) d[i + k] = Math.round((d[i + k] + bias) / STEP) * STEP;
      }
    }
    ctx.putImageData(img, 0, 0);

    // 반짝이 (십자 모양 픽셀)
    ctx.fillStyle = `rgb(${current.spark})`;
    for (const p of sparks) {
      const v = Math.sin(s * p.speed + p.phase);
      if (v < 0.2) continue;
      ctx.globalAlpha = Math.min(1, v);
      ctx.fillRect(p.x, p.y, 1, 1);
      if (v > 0.75) {
        ctx.fillRect(p.x - 1, p.y, 3, 1);
        ctx.fillRect(p.x, p.y - 1, 1, 3);
      }
    }
    ctx.globalAlpha = 1;
  }
  requestAnimationFrame(frame);
}

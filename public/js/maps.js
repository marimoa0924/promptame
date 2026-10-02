// 맵(테마) 정의. 팔레트와 픽셀 무대 배경을 여기 한 곳에서 관리한다.
// 화면 색상은 전부 applyTheme()이 넣어 주는 CSS 변수(--c1~--c5, --ink, --accent …)를 쓴다.

// 픽셀 반짝이 (5×5)
export const sparkle = (cls = '') =>
  `<svg class="sparkle ${cls}" viewBox="0 0 5 5" shape-rendering="crispEdges" aria-hidden="true"><path d="M2 0h1v2h2v1H3v2H2V3H0V2h2z"/></svg>`;

// ---------- 픽셀 그리기 도우미 (좌표는 200×30 격자, 한 칸 = 화면 4px) ----------
const R = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${c}"/>`;
const dots = (list, c) => list.map(([x, y]) => R(x, y, 1, 1, c)).join('');

function ellipse(cx, cy, rx, ry, c) {
  let s = '';
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy / (ry + 0.5)) ** 2));
    s += R(cx - half, cy + dy, half * 2 + 1, 1, c);
  }
  return s;
}
const disc = (cx, cy, r, c) => ellipse(cx, cy, r, r, c);

// 계단식 언덕
function mound(cx, top, base, slope, c) {
  let s = '';
  for (let y = top; y < base; y++) {
    const half = 2 + (y - top) * slope;
    s += R(cx - half, y, half * 2, 1, c);
  }
  return s;
}

// 소실점에서 퍼지는 픽셀 선
function ray(x0, y0, x1, y1, c) {
  let s = '';
  for (let y = y0 + 1; y <= y1; y++) s += R(Math.round(x0 + ((x1 - x0) * (y - y0)) / (y1 - y0)), y, 1, 1, c);
  return s;
}

// 캐릭터가 서는 바닥은 y=20 (무대 아래에서 40px)
const SCENES = {
  east: [
    R(0, 0, 200, 30, 'f5'),
    dots([[30, 4], [62, 3], [85, 8], [118, 5], [170, 9], [45, 10], [96, 2]], 'f1 o7'),
    disc(140, 7, 4, 'f2 g2'),
    mound(40, 13, 21, 3, 'f4 o6'),
    mound(118, 11, 21, 4, 'f4 o6'),
    mound(186, 14, 21, 3, 'f4 o6'),
    R(0, 21, 200, 9, 'f4'),
    R(48, 24, 8, 1, 'f1 o3'), R(140, 23, 10, 1, 'f1 o3'), R(104, 28, 6, 1, 'f1 o3'), R(70, 27, 5, 1, 'f1 o3'),
    R(56, 25, 8, 2, 'f3'), R(57, 24, 5, 1, 'f3'), R(60, 23, 1, 1, 'f2'),
    R(142, 26, 6, 1, 'f3'), R(143, 25, 4, 1, 'f3'),
    R(72, 22, 2, 7, 'f2 o8'), R(126, 22, 2, 7, 'f2 o8'),
    R(68, 20, 64, 2, 'f2'),
    ...Array.from({ length: 15 }, (_, i) => R(72 + i * 4, 20, 1, 2, 'f4 o3')),
    R(68, 16, 64, 1, 'f2'),
    R(69, 16, 1, 4, 'f2'), R(99, 16, 1, 4, 'f2'), R(130, 16, 1, 4, 'f2'),
    R(68, 12, 3, 4, 'f2 g2'), R(129, 12, 3, 4, 'f2 g2'),
  ],

  future: [
    R(0, 0, 200, 30, 'fi'),
    dots([[20, 3], [70, 6], [150, 4], [182, 8]], 'f1 o6'),
    disc(100, 12, 9, 'f5 g5'),
    R(90, 13, 21, 1, 'fi'), R(90, 16, 21, 1, 'fi'), R(90, 18, 21, 1, 'fi'),
    R(33, 12, 6, 8, 'f3'), R(39, 8, 5, 12, 'f3'), R(44, 14, 4, 6, 'f3'), R(48, 6, 6, 14, 'f3'),
    R(54, 11, 5, 9, 'f3'), R(59, 15, 8, 5, 'f3'),
    R(133, 13, 7, 7, 'f3'), R(140, 7, 6, 13, 'f3'), R(146, 12, 5, 8, 'f3'), R(151, 9, 6, 11, 'f3'),
    R(157, 14, 5, 6, 'f3'), R(162, 10, 5, 10, 'f3'),
    dots([[40, 10], [42, 12], [50, 8], [52, 11], [50, 14], [35, 14], [141, 9], [143, 12], [153, 11], [155, 14], [163, 12]], 'f2'),
    R(0, 20, 200, 10, 'fi'),
    R(0, 20, 200, 1, 'f5'), R(0, 22, 200, 1, 'f5 o7'), R(0, 25, 200, 1, 'f5 o6'), R(0, 29, 200, 1, 'f5 o5'),
    ...[-80, -10, 40, 70, 100, 130, 160, 210, 280].map((x) => ray(100, 20, x, 30, 'f5 o7')),
    R(78, 20, 44, 1, 'f2 g2'), R(84, 21, 32, 1, 'f2 o6'),
  ],

  medieval: [
    R(0, 0, 200, 30, 'f5'),
    dots([[22, 4], [48, 8], [75, 3], [110, 6], [172, 4], [186, 11]], 'f1 o7'),
    disc(152, 6, 3, 'f2 g2'), disc(154, 5, 3, 'f5'),
    R(62, 9, 6, 11, 'f4 o6'), R(63, 7, 4, 2, 'f4 o6'), R(64, 5, 2, 2, 'f4 o6'),
    R(70, 12, 8, 8, 'f4 o6'), R(70, 11, 2, 1, 'f4 o6'), R(73, 11, 2, 1, 'f4 o6'), R(76, 11, 2, 1, 'f4 o6'),
    R(118, 10, 8, 10, 'f4 o6'), R(118, 9, 2, 1, 'f4 o6'), R(121, 9, 2, 1, 'f4 o6'), R(124, 9, 2, 1, 'f4 o6'),
    R(130, 8, 6, 12, 'f4 o6'), R(131, 6, 4, 2, 'f4 o6'), R(132, 4, 2, 2, 'f4 o6'),
    R(0, 20, 200, 10, 'f3'),
    ...Array.from({ length: 25 }, (_, i) => i * 8).filter((x) => x < 84 || x > 112).map((x) => R(x, 18, 4, 2, 'f3')),
    R(0, 24, 200, 1, 'fi o2'), R(0, 27, 200, 1, 'fi o2'),
    ...[10, 40, 70, 130, 160, 190].map((x) => R(x, 20, 1, 4, 'fi o2')),
    ...[25, 55, 100, 145, 175].map((x) => R(x, 25, 1, 2, 'fi o2')),
    R(74, 21, 6, 6, 'f4'), R(74, 27, 2, 1, 'f4'), R(78, 27, 2, 1, 'f4'), R(76, 23, 2, 2, 'f2'),
    R(120, 21, 6, 6, 'f4'), R(120, 27, 2, 1, 'f4'), R(124, 27, 2, 1, 'f4'), R(122, 23, 2, 2, 'f2'),
    R(86, 15, 1, 5, 'f1'), R(85, 12, 3, 3, 'f2 g2'),
    R(113, 15, 1, 5, 'f1'), R(112, 12, 3, 3, 'f2 g2'),
  ],

  space: [
    R(0, 0, 200, 30, 'fi'),
    ellipse(62, 9, 32, 6, 'f4 o7'),
    ellipse(136, 7, 24, 5, 'f3 o2'),
    dots([[18, 5], [40, 12], [57, 3], [75, 10], [88, 4], [108, 7], [118, 2], [130, 13], [165, 5], [180, 11], [192, 3]], 'f1 o8'),
    dots([[95, 11], [50, 7]], 'f3 g3'),
    disc(150, 10, 4, 'f3'),
    R(141, 10, 19, 1, 'f2'), R(142, 11, 2, 1, 'f2'), R(156, 9, 2, 1, 'f2'),
    R(0, 20, 200, 10, 'f4'),
    R(18, 19, 16, 1, 'f4'), R(158, 19, 20, 1, 'f4'),
    R(62, 24, 8, 1, 'fi o4'), R(61, 25, 10, 1, 'fi o3'), R(130, 26, 10, 1, 'fi o4'), R(104, 28, 4, 1, 'fi o4'),
    R(84, 20, 32, 1, 'f3 g3'),
  ],
};

export const THEMES = {
  lobby: {
    palette: ['#F8F7FF', '#FFEEDD', '#FFD8BE', '#B8B8FF', '#9381FF'],
    ink: '#2E2665',
    accent: '#9381FF',
    onAccent: '#FFFFFF',
    accent2: '#FFB997',
    bg: ['#C7C1FF', '#9381FF', '#FFD8BE', '#FFEEDD'],
  },
  east: {
    name: '동양풍',
    sub: '달빛 연못',
    palette: ['#E6FBDA', '#FFF8D2', '#84D175', '#3E5BA3', '#0C2D45'],
    ink: '#0C2D45',
    accent: '#3E5BA3',
    onAccent: '#FFFFFF',
    accent2: '#84D175',
    bg: ['#0C2D45', '#84D175', '#3E5BA3', '#FFF8D2'],
  },
  future: {
    name: '미래풍',
    sub: '네온 시티',
    palette: ['#D4E5FB', '#66C7F4', '#6C6EA0', '#D9D2C4', '#FF1053'],
    ink: '#2A2A5C',
    accent: '#FF1053',
    onAccent: '#FFFFFF',
    accent2: '#66C7F4',
    bg: ['#FF1053', '#66C7F4', '#6C6EA0', '#D9D2C4'],
  },
  medieval: {
    name: '중세',
    sub: '보랏빛 성채',
    palette: ['#F6FFE9', '#F2E0A4', '#CAC5E5', '#A230A4', '#290087'],
    ink: '#1C0060',
    accent: '#A230A4',
    onAccent: '#FFFFFF',
    accent2: '#F2E0A4',
    bg: ['#290087', '#A230A4', '#CAC5E5', '#F2E0A4'],
  },
  space: {
    name: '우주',
    sub: '성운 정거장',
    palette: ['#E2F5F3', '#A4CBE3', '#4DD4CD', '#333C77', '#001B29'],
    ink: '#001B29',
    accent: '#4DD4CD',
    onAccent: '#001B29',
    accent2: '#A4CBE3',
    bg: ['#001B29', '#4DD4CD', '#333C77', '#A4CBE3'],
  },
};

export const MAP_IDS = ['east', 'future', 'medieval', 'space'];

export function applyTheme(el, id) {
  const t = THEMES[id] ?? THEMES.lobby;
  const vars = { '--ink': t.ink, '--accent': t.accent, '--on-accent': t.onAccent, '--accent-2': t.accent2 };
  t.palette.forEach((c, i) => (vars[`--c${i + 1}`] = c));
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  el.dataset.theme = id in THEMES ? id : 'lobby';
  if (el === document.body) document.dispatchEvent(new CustomEvent('theme', { detail: t }));
}

export function sceneSvg(id) {
  return `<svg class="scene" viewBox="0 0 200 30" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges" aria-hidden="true">${(SCENES[id] ?? SCENES.east).join('')}</svg>`;
}

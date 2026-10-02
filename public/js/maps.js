// 맵(테마) 정의. 팔레트와 픽셀 무대 배경을 여기 한 곳에서 관리한다.
// 화면 색상은 전부 applyTheme()이 넣어 주는 CSS 변수(--c1~--c5, --ink, --accent …)를 쓴다.

// 픽셀 반짝이 (5×5)
export const sparkle = (cls = '') =>
  `<svg class="sparkle ${cls}" viewBox="0 0 5 5" shape-rendering="crispEdges" aria-hidden="true"><path d="M2 0h1v2h2v1H3v2H2V3H0V2h2z"/></svg>`;

// ---------- 픽셀 그리기 도우미 (좌표는 200×80 격자) ----------
export const SCENE_W = 200;
export const SCENE_TOP = -40; // 무대가 세로로 길어도 장면이 덜 확대되도록 하늘을 위로 40칸 더 그린다
export const SCENE_BOTTOM = 80;
export const SCENE_FLOOR = 66; // 캐릭터가 서는 바닥 y

const R = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${c}"/>`;
const dots = (list, c) => list.map(([x, y]) => R(x, y, 1, 1, c)).join('');
const group = (cls, ...parts) => `<g class="${cls}">${parts.join('')}</g>`;

function ellipse(cx, cy, rx, ry, c) {
  let s = '';
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy / (ry + 0.5)) ** 2));
    s += R(cx - half, cy + dy, half * 2 + 1, 1, c);
  }
  return s;
}
const disc = (cx, cy, r, c) => ellipse(cx, cy, r, r, c);

// 계단식 산
function mound(cx, top, base, slope, c) {
  let s = '';
  for (let y = top; y < base; y++) {
    const half = Math.round(2 + (y - top) * slope);
    s += R(cx - half, y, half * 2, 1, c);
  }
  return s;
}

// 계단식 삼각형 (지붕, 소나무)
function tri(cx, top, h, c, step = 1) {
  let s = '';
  for (let i = 0; i < h; i++) s += R(cx - Math.floor(i * step), top + i, Math.floor(i * step) * 2 + 1, 1, c);
  return s;
}

const outline = (x, y, w, h, c) => R(x, y, w, 1, c) + R(x, y + h - 1, w, 1, c) + R(x, y, 1, h, c) + R(x + w - 1, y, 1, h, c);
const cross = (x, y, c) => R(x - 1, y, 3, 1, c) + R(x, y - 1, 1, 3, c);

// 소실점에서 퍼지는 픽셀 선
function ray(x0, y0, x1, y1, c) {
  let s = '';
  for (let y = y0 + 1; y <= y1; y++) s += R(Math.round(x0 + ((x1 - x0) * (y - y0)) / (y1 - y0)), y, 1, 1, c);
  return s;
}

// 매번 같은 결과가 나오는 난수 (별 배치용)
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
function starfield(seed, n, maxY, c, minY = 0) {
  const rnd = seeded(seed);
  return dots(Array.from({ length: n }, () => [Math.floor(rnd() * SCENE_W), minY + Math.floor(rnd() * (maxY - minY))]), c);
}

// 위로 늘린 하늘: 각 장면의 하늘색 + 별
const SKY = { east: 'f5', future: 'fi', medieval: 'f5', space: 'fi' };
const skyTop = (id) => R(0, SCENE_TOP, SCENE_W, -SCENE_TOP, SKY[id]) + starfield(id.length * 7, 28, 0, 'f1 o6', SCENE_TOP);

// 건물 창문
function windows(x, y, w, h, seed, c) {
  const rnd = seeded(seed);
  let s = '';
  for (let yy = y + 2; yy < y + h - 1; yy += 3) {
    for (let xx = x + 1; xx < x + w - 1; xx += 2) if (rnd() > 0.45) s += R(xx, yy, 1, 1, c);
  }
  return s;
}

const SCENES = {
  // 달빛 연못: 대나무 숲, 산 위 탑, 도리이, 나무 다리, 등불, 연잎, 반딧불
  east: () => [
    R(0, 0, 200, 80, 'f5'),
    R(0, 34, 200, 8, 'f4 o2'), R(0, 42, 200, 8, 'f4 o3'), R(0, 50, 200, 8, 'f4 o4'),
    starfield(7, 26, 34, 'f1 o7'),
    disc(150, 16, 13, 'f2 o2'), disc(150, 16, 9, 'f2 g2'), dots([[146, 12], [153, 18], [148, 20]], 'f1 o6'),
    R(124, 22, 24, 2, 'f1 o3'), R(130, 20, 12, 2, 'f1 o3'), R(160, 12, 28, 2, 'f1 o3'), R(166, 10, 12, 2, 'f1 o3'),
    R(22, 18, 30, 2, 'f1 o2'), R(28, 16, 14, 2, 'f1 o2'),
    mound(30, 36, 58, 2, 'f4 o6'), mound(78, 30, 58, 2.4, 'f4 o7'), mound(132, 40, 58, 2, 'f4 o5'), mound(186, 34, 58, 2.2, 'f4 o6'),
    // 산 위 탑
    group('f5 o9',
      R(77, 13, 2, 5), R(73, 18, 10, 1), R(71, 19, 14, 1), R(74, 20, 8, 3), R(70, 23, 16, 1), R(68, 24, 20, 1),
      R(72, 25, 12, 4), R(67, 29, 22, 1), R(66, 30, 24, 1), R(70, 31, 16, 5)),
    dots([[76, 21], [80, 21], [75, 27], [79, 27], [83, 27], [74, 33], [78, 33], [82, 33]], 'f2 g2'),
    R(0, 58, 200, 22, 'f4'),
    R(144, 60, 12, 1, 'f2 o6'), R(146, 62, 8, 1, 'f2 o5'), R(143, 72, 14, 1, 'f2 o4'), R(147, 75, 6, 1, 'f2 o3'),
    R(20, 61, 10, 1, 'f1 o3'), R(96, 63, 8, 1, 'f1 o3'), R(60, 77, 12, 1, 'f1 o3'), R(110, 74, 6, 1, 'f1 o3'),
    // 도리이
    group('f2', R(156, 38, 32, 2), R(158, 40, 28, 1), R(160, 44, 24, 1), R(163, 40, 3, 26), R(178, 40, 3, 26), R(170, 41, 2, 3)),
    // 대나무
    ...[2, 8, 14].map((x, i) => group('f3',
      R(x, 4 + i * 5, 2, 62 - i * 5),
      R(x + 2, 14 + i * 7, 4, 1), R(x + 4, 13 + i * 7, 2, 1), R(x - 3, 24 + i * 6, 3, 1), R(x - 4, 23 + i * 6, 2, 1),
      R(x + 2, 38 + i * 4, 3, 1), R(x - 2, 48 - i * 3, 2, 1))),
    ...[2, 8, 14].flatMap((x) => [20, 30, 40, 50].map((y) => R(x, y, 2, 1, 'f5 o5'))),
    // 나무 다리
    R(0, 58, 200, 1, 'f2'),
    ...Array.from({ length: 9 }, (_, i) => R(i * 24 + 6, 58, 1, 8, 'f2')),
    R(0, 66, 200, 3, 'f2'),
    ...Array.from({ length: 34 }, (_, i) => R(i * 6, 66, 1, 3, 'f4 o3')),
    ...Array.from({ length: 9 }, (_, i) => R(i * 24 + 5, 69, 2, 11, 'f2 o7')),
    // 등불
    ...[30, 102, 174].map((x) => group('f2', R(x - 1, 51, 3, 1), R(x - 2, 52, 5, 5, 'f2 g2'), R(x - 1, 57, 3, 1))),
    // 연잎과 잉어
    ellipse(40, 75, 5, 1, 'f3'), R(41, 73, 1, 1, 'f1'), ellipse(122, 77, 4, 1, 'f3'), ellipse(184, 74, 3, 1, 'f3'),
    R(70, 73, 3, 1, 'f2 o8'), R(73, 72, 1, 1, 'f2 o8'), R(73, 74, 1, 1, 'f2 o8'),
    dots([[30, 46], [60, 40], [112, 50], [140, 44], [192, 48], [92, 36], [50, 54]], 'f2 g2 twinkle'),
  ],

  // 네온 시티: 신스웨이브 태양, 빌딩 숲, 네온 간판, 날아다니는 차, 네온 바닥
  future: () => [
    R(0, 0, 200, 80, 'fi'),
    R(0, 28, 200, 8, 'f5 o1'), R(0, 36, 200, 8, 'f5 o2'), R(0, 44, 200, 8, 'f5 o3'), R(0, 52, 200, 8, 'f5 o4'),
    starfield(11, 22, 30, 'f1 o6'),
    disc(100, 40, 18, 'f5 g5'),
    group('fi', R(80, 41, 41, 1), R(80, 45, 41, 2), R(80, 50, 41, 2), R(80, 54, 41, 3)),
    // 먼 빌딩
    group('f3 o5', ...[[0, 40, 8], [9, 36, 6], [62, 44, 8], [72, 38, 6], [124, 40, 7], [132, 34, 6], [190, 38, 10]].map(([x, y, w]) => R(x, y, w, 60 - y))),
    // 가까운 빌딩
    ...[[0, 26, 10], [11, 18, 9], [21, 30, 8], [30, 22, 12], [43, 34, 8], [52, 28, 7],
      [140, 30, 8], [149, 20, 11], [161, 32, 7], [169, 16, 10], [180, 26, 9], [190, 34, 10]]
      .map(([x, y, w], i) => R(x, y, w, 60 - y, 'f3') + windows(x, y, w, 60 - y, i + 3, i % 3 ? 'f2 o8' : 'f4 o8')),
    R(15, 10, 1, 8, 'f3'), R(15, 9, 1, 1, 'f5 g5 twinkle'), R(174, 8, 1, 8, 'f3'), R(174, 7, 1, 1, 'f5 g5 twinkle'),
    outline(31, 24, 10, 6, 'f5 g5'), R(33, 26, 6, 1, 'f2'), R(33, 28, 4, 1, 'f2'),
    outline(150, 22, 9, 7, 'f2 g2'), R(152, 24, 5, 1, 'f5'), R(152, 26, 3, 1, 'f5'),
    group('drift', R(0, 20, 7, 2, 'f4'), R(-12, 21, 12, 1, 'f5 o5'), R(5, 19, 2, 1, 'f2')),
    group('drift slow', R(0, 12, 5, 2, 'f2'), R(-9, 13, 9, 1, 'f2 o4'), R(4, 11, 1, 1, 'f5')),
    // 네온 바닥
    R(0, 60, 200, 20, 'fi'),
    R(0, 60, 200, 1, 'f5 g5'),
    ...[62, 64, 67, 71, 76].map((y) => R(0, y, 200, 1, 'f5 o6')),
    ...[-120, -40, 20, 55, 80, 100, 120, 145, 180, 240, 320].map((x) => ray(100, 60, x, 80, 'f5 o6')),
    R(0, 66, 200, 1, 'f2 g2'),
  ],

  // 보랏빛 성채: 초승달, 큰 성, 소나무, 성벽, 깃발, 횃불
  medieval: () => [
    R(0, 0, 200, 80, 'f5'),
    R(0, 38, 200, 10, 'f4 o2'), R(0, 48, 200, 10, 'f4 o3'),
    starfield(5, 24, 36, 'f1 o7'),
    disc(170, 14, 7, 'f2 g2'), disc(173, 12, 7, 'f5'),
    R(20, 22, 26, 2, 'f3 o3'), R(26, 20, 12, 2, 'f3 o3'), R(70, 12, 22, 2, 'f3 o2'),
    dots([[50, 14], [52, 13], [51, 15], [54, 15], [53, 14]], 'f1 o6'),
    mound(40, 44, 62, 2.5, 'f4 o4'), mound(170, 46, 62, 2.5, 'f4 o4'),
    // 성
    group('f4 o8',
      R(112, 30, 30, 32), ...[112, 118, 124, 130, 136, 139].map((x) => R(x, 28, 3, 2)),
      R(102, 22, 10, 40), tri(107, 12, 10, ''), R(142, 18, 10, 44), tri(147, 8, 10, ''),
      R(122, 20, 8, 10), tri(126, 13, 7, '')),
    R(107, 6, 1, 6, 'f1'), R(108, 6, 4, 2, 'f2'), R(147, 2, 1, 6, 'f1'), R(148, 2, 4, 2, 'f2'),
    R(106, 30, 2, 3, 'f2 g2'), R(146, 26, 2, 3, 'f2 g2'), R(146, 36, 2, 3, 'f2 g2'),
    R(118, 38, 2, 3, 'f2 g2'), R(126, 38, 2, 3, 'f2 g2'), R(134, 38, 2, 3, 'f2 g2'),
    R(122, 50, 10, 12, 'f5'), R(123, 49, 8, 1, 'f5'),
    // 소나무
    ...[[16, 36], [28, 42], [62, 40], [186, 38]].map(([x, top]) => group('f4', tri(x, top, 20, '', 0.4), R(x - 1, top + 20, 3, 6))),
    // 성벽
    R(0, 66, 200, 14, 'f3'),
    ...Array.from({ length: 25 }, (_, i) => R(i * 8, 62, 4, 4, 'f3')),
    ...[70, 74, 78].map((y) => R(0, y, 200, 1, 'fi o2')),
    ...Array.from({ length: 20 }, (_, i) => R(i * 10 + (i % 2) * 5, 66 + (i % 3) * 4, 1, 4, 'fi o2')),
    ...[60, 100, 140, 180].map((x) => R(x, 67, 6, 8, 'f4') + R(x, 75, 2, 1, 'f4') + R(x + 4, 75, 2, 1, 'f4') + R(x + 2, 69, 2, 2, 'f2')),
    ...[80, 120, 160].map((x) => R(x, 58, 1, 4, 'f1') + R(x - 1, 55, 3, 3, 'f2 g2')),
  ],

  // 성운 정거장: 성운, 고리 행성, 위성, 별똥별, 달 표면, 기지
  space: () => [
    R(0, 0, 200, 80, 'fi'),
    ellipse(60, 24, 40, 12, 'f4 o6'), ellipse(70, 20, 24, 6, 'f3 o2'), ellipse(150, 44, 34, 10, 'f4 o4'),
    starfield(3, 46, 64, 'f1 o8'),
    cross(40, 10, 'f2 g2 twinkle'), cross(120, 30, 'f3 g3 twinkle'), cross(188, 52, 'f2 g2 twinkle'),
    disc(158, 22, 12, 'f3'), disc(161, 19, 7, 'f2 o3'),
    R(147, 25, 22, 1, 'f4 o4'), R(149, 29, 18, 1, 'f4 o4'),
    R(138, 23, 40, 1, 'f2'), R(140, 24, 6, 1, 'f2'), R(170, 22, 6, 1, 'f2'),
    disc(30, 14, 4, 'f2'), R(29, 13, 1, 1, 'fi o3'), R(32, 15, 1, 1, 'fi o3'),
    group('drift slow', R(0, 36, 6, 3, 'f1'), R(-8, 36, 7, 3, 'f2'), R(7, 36, 7, 3, 'f2'),
      R(-5, 36, 1, 3, 'fi o4'), R(10, 36, 1, 3, 'fi o4'), R(2, 33, 1, 3, 'f1'), R(2, 32, 1, 1, 'f3')),
    group('drift fast', R(0, 8, 7, 1, 'f1 o5'), R(7, 8, 2, 1, 'f1')),
    // 달 표면
    R(0, 66, 200, 14, 'f4'),
    R(8, 64, 24, 2, 'f4'), R(146, 62, 34, 4, 'f4'), R(150, 61, 24, 1, 'f4'), R(60, 64, 5, 2, 'f4'),
    ellipse(70, 72, 7, 1, 'fi o4'), ellipse(124, 75, 10, 1, 'fi o4'), ellipse(30, 77, 5, 1, 'fi o3'),
    // 기지
    ellipse(176, 64, 10, 6, 'f2 o9'), R(166, 64, 21, 2, 'f1'), R(172, 61, 2, 1, 'f3 g3'), R(178, 60, 2, 1, 'f3 g3'),
    R(190, 48, 1, 14, 'f1'), R(190, 47, 1, 1, 'f3 g3 twinkle'),
    R(10, 66, 70, 1, 'f3 g3'),
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

const sceneCache = new Map();
export function sceneSvg(id) {
  const key = id in SCENES ? id : 'east';
  if (!sceneCache.has(key)) sceneCache.set(key, skyTop(key) + SCENES[key]().join(''));
  return `<svg class="scene" viewBox="0 ${SCENE_TOP} ${SCENE_W} ${SCENE_BOTTOM - SCENE_TOP}" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges" aria-hidden="true">${sceneCache.get(key)}</svg>`;
}

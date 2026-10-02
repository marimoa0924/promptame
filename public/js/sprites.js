// 16×16 픽셀 캐릭터. 글자 하나가 픽셀 하나, '.'은 투명.
const SPRITES = {
  cat: {
    colors: { K: '#25233a', p: '#ff9db0', Y: '#ffd166', W: '#ffffff', P: '#ff9db0' },
    rows: [
      '................',
      '..K.........K...',
      '..KK.......KK...',
      '..KpK.....KpK...',
      '..KKKKKKKKKKK...',
      '.KKKKKKKKKKKKK..',
      '.KKYYKKKKKYYKK..',
      '.KKYWKKKKKYWKK..',
      '.KKKKKKPKKKKKK..',
      '.KKKKKKKKKKKKK..',
      '..KKKKKKKKKKK...',
      '...KKKKKKKKK..K.',
      '..KKKKKKKKKKK.K.',
      '..KKKKKKKKKKKK..',
      '..KK.KK..KK.KK..',
      '................',
    ],
  },
  dog: {
    colors: { O: '#e8954a', o: '#c46f2c', C: '#fff1dc', K: '#2b1d14', P: '#ff7b8a' },
    rows: [
      '................',
      '..OO........OO..',
      '..OOO......OOO..',
      '..OOOOOOOOOOOO..',
      '.OOOOOOOOOOOOOO.',
      '.OOKOOOOOOOOKOO.',
      '.OOOOOCCCCOOOOO.',
      '.OOOOCCKKCCOOOO.',
      '..OOOCCCCCCOOO..',
      '...OOCCPPCCOO...',
      '....OOOOOOOO....',
      '...OOOCCCCOOO.oo',
      '..OOOOCCCCOOOOo.',
      '..OOOOOOOOOOOO..',
      '..OO..OO..OO.OO.',
      '................',
    ],
  },
  pigeon: {
    colors: { G: '#b3bacb', g: '#7d8599', N: '#5fbf8f', M: '#9a7fd6', R: '#ff6b4a', K: '#3a3a4a', F: '#ff8a73' },
    rows: [
      '................',
      '.....GGGG.......',
      '....GGGGGG......',
      '....GRGGGG......',
      '..KKGGGGGG......',
      '.....NNGGG......',
      '.....NMNGGG.....',
      '.....MNGGGGG....',
      '....GGGGGGGGG...',
      '...GGGGGGgggGG..',
      '...GGGGGgggggGGg',
      '....GGGGGgggggg.',
      '.....GGGGGGGg...',
      '.......F..F.....',
      '......FF.FF.....',
      '................',
    ],
  },
  otaku: {
    colors: {
      H: '#3a2a1e', R: '#e63946', S: '#f6cfa4', B: '#1b1b2a', L: '#bfe3ff',
      M: '#c0504d', T: '#d9534f', t: '#8f2d2b', J: '#33415c',
    },
    rows: [
      '................',
      '....HHHHHHHH....',
      '...HHHHHHHHHH...',
      '...RRRRRRRRRR...',
      '...HSSSSSSSSH...',
      '...SBBBSSBBBS...',
      '...SBLLBBLLBS...',
      '...SBBBSSBBBS...',
      '...SSSSSSSSSS...',
      '....SSSMMSSS....',
      '.....SSSSSS.....',
      '...TTtTTTTtTT...',
      '..TTTtTTTTtTTT..',
      '..STTtTTTTtTTS..',
      '....JJJJJJJJ....',
      '....JJJ..JJJ....',
    ],
  },
};

const cache = new Map();

// 같은 색이 이어지는 가로 픽셀은 rect 하나로 합친다
function build(id) {
  const s = SPRITES[id] ?? SPRITES.cat;
  let rects = '';
  s.rows.forEach((row, y) => {
    const line = row.padEnd(16, '.').slice(0, 16);
    for (let x = 0; x < 16; ) {
      const ch = line[x];
      let w = 1;
      while (x + w < 16 && line[x + w] === ch) w++;
      if (ch !== '.') rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${s.colors[ch]}"/>`;
      x += w;
    }
  });
  return rects;
}

export function spriteSvg(id, cls = '') {
  if (!cache.has(id)) cache.set(id, build(id));
  return `<svg class="sprite ${cls}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${cache.get(id)}</svg>`;
}

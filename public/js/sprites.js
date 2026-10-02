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
  // 청록 트윈테일 아이돌
  miku: {
    colors: {
      T: '#39c5bb', t: '#1f8f88', K: '#2b2b3a', S: '#f7d7c4', P: '#e97a8a',
      G: '#cfd3dc', g: '#5d6273', R: '#e2445c',
    },
    rows: [
      '....TTTTTTTT....',
      '..KTTTTTTTTTTK..',
      '.TTTTTTTTTTTTTT.',
      '.TTTSSTTTTSSTTT.',
      'TTTSSSSSSSSSSTTT',
      'TTTSKKSSSSKKSTTT',
      'TTTSKTSSSSKTSTTT',
      'TT.SSSSPPSSSS.TT',
      'TT..SSSSSSSS..TT',
      'TT.GGGGtRGGGG.TT',
      'TT.GGGGttGGGG.TT',
      'TT.SGGGGGGGGS.TT',
      'tt..gggggggg..tt',
      'tt..gggggggg..tt',
      '.t...KK..KK...t.',
      '.....KK..KK.....',
    ],
  },
  // 똬리 튼 초록 뱀
  snake: {
    colors: { G: '#6cc24a', g: '#3e8a2c', Y: '#e8e27a', K: '#1f2a1a', R: '#e2445c' },
    rows: [
      '................',
      '.....GGGG.......',
      '....GGGGGG......',
      '....GKGGKG......',
      '..RRGGGGGG......',
      '.R...GGGG.......',
      '.....gGGg.......',
      '......GG........',
      '....GGGGGGG.....',
      '...GGYYYYYGG....',
      '..GGGGGGGGGGG...',
      '.GGYYYYYYYYYGG..',
      '.GGGGGGGGGGGGGG.',
      'GGYYYYYYYYYYYYGG',
      'gGGGGGGGGGGGGGGg',
      '..............gg',
    ],
  },
  // 체크무늬 셔츠 공대생: 부스스한 머리, 뿔테 안경
  engineer: {
    colors: {
      H: '#4a3426', S: '#f2c9a0', K: '#1b1b2a', L: '#d6ecff', M: '#7a3b2e',
      B: '#3b6fb6', b: '#1d3557', W: '#e8eef7', J: '#34425a',
    },
    rows: [
      '.....H.HH.H.....',
      '....HHHHHHHH....',
      '...HHHHHHHHHH...',
      '...HHSSSSSSHH...',
      '...HSSSSSSSSH...',
      '...SKKKSSKKKS...',
      '...SKLKKKKLKS...',
      '...SKKKSSKKKS...',
      '...SSSSSSSSSS...',
      '....SSSMMSSS....',
      '.....SSSSSS.....',
      '..BBbBBbBBbBBb..',
      '..WWbWWbWWbWWb..',
      '.SBBbBBbBBbBBbS.',
      '....JJJJJJJJ....',
      '....JJJ..JJJ....',
    ],
  },
  // 앞발을 든 사마귀
  mantis: {
    colors: { G: '#8fd14f', g: '#4f8f2a', E: '#e6f59a', K: '#1f2a1a', m: '#3c6e20' },
    rows: [
      '..g..........g..',
      '...g........g...',
      '....GGGGGGGG....',
      '...GEEGGGGEEG...',
      '...GEKGGGGKEG...',
      '....GGGGGGGG....',
      '.....GGGGGG.....',
      '......GmmG......',
      '..gg...GG...gg..',
      '..g.g..GG..g.g..',
      '..g..gGGGGg..g..',
      '.....GGGGGG.....',
      '.....GgGGgG.....',
      '....gGGGGGGg....',
      '...g..g..g..g...',
      '..g..g....g..g..',
    ],
  },
  // 보라색 말랑 슬라임 (메타몽)
  ditto: {
    colors: { P: '#b78ce0', p: '#8f63c2', K: '#3a2a4a' },
    rows: [
      '................',
      '................',
      '.....PPP..PP....',
      '....PPPPPPPPP...',
      '...PPPPPPPPPPP..',
      '..PPPPPPPPPPPPP.',
      '..PPPKPPPPKPPPP.',
      '.PPPPPPPPPPPPPP.',
      '.PPPPKPPPPKPPPPP',
      '.PPPPPKKKKPPPPP.',
      'PPPPPPPPPPPPPPPP',
      'PPPPPPPPPPPPPPPp',
      'pPPPPPPPPPPPPPpp',
      '.ppPPPPPPPPPPpp.',
      '...pppp..pppp...',
      '................',
    ],
  },
  // 히든: 얼굴이 있는 브라운관 티비
  tv: {
    colors: { K: '#25233a', G: '#b9bccf', S: '#7de8d8', R: '#ff6b6b', Y: '#ffd166' },
    rows: [
      '................',
      '.....K....K.....',
      '......K..K......',
      '.......KK.......',
      '..KKKKKKKKKKKK..',
      '.KGGGGGGGGGGGGK.',
      '.KGSSSSSSSSGGGK.',
      '.KGSKSSSSKSGRGK.',
      '.KGSKSSSSKSGYGK.',
      '.KGSSSSSSSSGGGK.',
      '.KGSSKKKKSSGGGK.',
      '.KGSSSSSSSSGGGK.',
      '.KGGGGGGGGGGGGK.',
      '..KKKKKKKKKKKK..',
      '...KK......KK...',
      '................',
    ],
  },
  // 하얗고 작은 동글이 (치이카와)
  chiikawa: {
    colors: { W: '#fffaf3', w: '#d9c9b8', K: '#2b2b3a', P: '#ffb3c1', M: '#c46a6a' },
    rows: [
      '................',
      '...ww......ww...',
      '..wWWw....wWWw..',
      '..wWWWwwwwWWWw..',
      '.wWWWWWWWWWWWWw.',
      '.wWWWWWWWWWWWWw.',
      '.wWWKWWWWWWKWWw.',
      '.wWWKWWWWWWKWWw.',
      '.wPPWWWMMWWWPPw.',
      '.wWWWWWWWWWWWWw.',
      '..wWWWWWWWWWWw..',
      '..wWWWWWWWWWWw..',
      '.wWwWWWWWWWWwWw.',
      '..wWWWWWWWWWWw..',
      '...wWWw..wWWw...',
      '....ww....ww....',
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

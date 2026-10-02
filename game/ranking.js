// 랭킹. 기기 ID(브라우저에 저장된 값)를 기준으로 랭크 점수(RP)를 쌓는다. 로그인이 없어서 기기를 바꾸면 처음부터다.
// 친구끼리 져 주며 점수를 모으는 것을 줄이기 위해 판이 너무 한산하거나 같은 둘이 너무 자주 하면 반영하지 않는다.

export const RANK = {
  WIN: 25,
  DRAW: 5,
  LOSS: -10,
  FORFEIT_WIN: 12, // 상대가 포기해서 이긴 경우
  FORFEIT_LOSS: -15, // 포기한 경우
  MIN_TOTAL_PASS: 2, // 시간 종료 판에서 두 사람 PASS 합계가 이보다 적으면 반영하지 않는다
  PAIR_LIMIT: 5, // 같은 두 사람의 반영 판 수 상한
  PAIR_WINDOW_MS: 60 * 60 * 1000, // ...1시간 안에
};

export const TIERS = [
  { min: 0, name: '브론즈' },
  { min: 100, name: '실버' },
  { min: 250, name: '골드' },
  { min: 500, name: '플래티넘' },
  { min: 1000, name: '다이아' },
];

export function tierOf(rp) {
  let i = 0;
  TIERS.forEach((t, idx) => {
    if (rp >= t.min) i = idx;
  });
  const next = TIERS[i + 1] ?? null;
  return { name: TIERS[i].name, next: next ? { name: next.name, need: next.min - rp } : null };
}

const NOT_COUNTED = {
  'same-device': '같은 기기끼리 한 판이에요',
  'low-activity': 'PASS가 너무 적은 판이에요',
  'pair-limit': '같은 상대와 너무 자주 했어요',
};

export function createRanking(store, now = () => Date.now()) {
  const root = (store.data.ranking ??= {});
  root.players ??= {};
  root.pairs ??= {};

  const view = (device, rec) => ({ ...rec, tier: tierOf(rec.rp), device });

  // a, b: { id, device, name, char, score }. 사람 둘이 한 판이 아니면 null(랭킹과 상관없는 판).
  function record({ reason, winnerId, leaverId, a, b }) {
    if (!a?.device || !b?.device) return null;
    const players = [a, b];
    const result = {};
    const key = [a.device, b.device].sort().join('|');
    const t = now();
    const recent = (root.pairs[key] ?? []).filter((ts) => t - ts < RANK.PAIR_WINDOW_MS);

    let note = null;
    if (a.device === b.device) note = 'same-device';
    else if (reason === 'timeup' && a.score + b.score < RANK.MIN_TOTAL_PASS) note = 'low-activity';
    else if (recent.length >= RANK.PAIR_LIMIT) note = 'pair-limit';

    for (const p of players) {
      const rec = root.players[p.device] ?? { name: p.name, char: p.char, rp: 0, wins: 0, losses: 0, draws: 0, passes: 0, games: 0 };
      if (note) {
        result[p.id] = { counted: false, note: NOT_COUNTED[note], delta: 0, rp: rec.rp, tier: tierOf(rec.rp) };
        continue;
      }
      let delta;
      let outcome;
      if (reason === 'forfeit') {
        outcome = p.id === leaverId ? 'loss' : 'win';
        delta = outcome === 'win' ? RANK.FORFEIT_WIN : RANK.FORFEIT_LOSS;
      } else if (winnerId == null) {
        outcome = 'draw';
        delta = RANK.DRAW;
      } else {
        outcome = p.id === winnerId ? 'win' : 'loss';
        delta = outcome === 'win' ? RANK.WIN : RANK.LOSS;
      }
      const before = rec.rp;
      const rp = Math.max(0, before + delta);
      Object.assign(rec, {
        name: p.name,
        char: p.char,
        rp,
        games: rec.games + 1,
        passes: rec.passes + p.score,
        wins: rec.wins + (outcome === 'win' ? 1 : 0),
        losses: rec.losses + (outcome === 'loss' ? 1 : 0),
        draws: rec.draws + (outcome === 'draw' ? 1 : 0),
      });
      root.players[p.device] = rec;
      result[p.id] = { counted: true, delta: rp - before, rp, tier: tierOf(rp), outcome };
    }
    if (!note) root.pairs[key] = [...recent, t];
    // 오래된 쌍 기록은 지운다
    for (const [k, list] of Object.entries(root.pairs)) {
      const kept = list.filter((ts) => t - ts < RANK.PAIR_WINDOW_MS);
      if (kept.length) root.pairs[k] = kept;
      else delete root.pairs[k];
    }
    store.save();
    return result;
  }

  const sorted = () =>
    Object.entries(root.players)
      .filter(([, r]) => r.games > 0)
      .sort(([, x], [, y]) => y.rp - x.rp || y.wins - x.wins || y.games - x.games || x.name.localeCompare(y.name));

  return {
    record,
    top(n = 20) {
      return sorted()
        .slice(0, n)
        .map(([device, rec], i) => ({ rank: i + 1, ...view(device, rec) }))
        .map(({ device, ...pub }) => pub); // 기기 ID는 밖으로 보내지 않는다
    },
    me(device) {
      const list = sorted();
      const i = list.findIndex(([d]) => d === device);
      if (i < 0) return null;
      const { device: _d, ...pub } = view(device, list[i][1]);
      return { rank: i + 1, total: list.length, ...pub };
    },
  };
}

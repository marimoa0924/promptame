// 계정: 구글 로그인 또는 게스트. 계정마다 닉네임, 캐릭터, 재화, 성적, 최근 경기, 프롬프트 습관 기록을 저장한다.
// 로그인 상태는 서버가 만든 긴 무작위 토큰으로 유지하고, 서버에는 토큰의 해시만 저장한다.
import crypto from 'node:crypto';
import { checkNickname, nicknameError } from '../nickname.js';
import { makeEntry, analyze } from './habits.js';

export const CHARACTERS = ['cat', 'pigeon', 'dog', 'otaku'];
export const CHAR_NAMES = { cat: '고양이', pigeon: '비둘기', dog: '강아지', otaku: '씹덕' };
export const DEFAULT_NAME = '익명의 고수';

// 재화. 값은 모두 시작값(제안)이다.
export const ECON = {
  START_COINS: 30, // 처음 가입 선물
  WIN: 30,
  DRAW: 15,
  LOSS: 10,
  FORFEIT_WIN: 15, // 상대가 포기해서 이긴 경우(승리 보상의 절반)
  FORFEIT_LOSS: -10, // 포기한 경우(참가비)
  PASS_BONUS: 1, // PASS 하나당
  PASS_BONUS_CAP: 10,
  DAILY_GAMES: 10, // 하루에 재화를 받는 판 수 상한
  BUY_PRICE: 120, // 캐릭터를 골라서 사기
  GACHA_PRICE: 50, // 안 가진 캐릭터 중 무작위
};

const LIMITS = { HABIT_MAX: 300, HABIT_TEXT_KEEP: 100, GAMES_MAX: 30, TOKENS_MAX: 5, TOKEN_TTL_MS: 90 * 24 * 3600 * 1000, MAX_ACCOUNTS: 50_000 };
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const day = (t) => new Date(t).toISOString().slice(0, 10);

// characters: 서버가 아는 캐릭터 전체. starters: 처음부터 가진 캐릭터(나머지는 상점이나 뽑기로 얻는다)
export function createAccounts(store, { ranking, seen, characters = CHARACTERS, starters = ['cat'], now = () => Date.now(), random = Math.random } = {}) {
  const root = (store.data.accounts ??= {});
  root.byId ??= {}; // 계정 번호 -> 계정
  root.google ??= {}; // 구글 고유 번호(sub) -> 계정 번호
  root.tokens ??= {}; // 토큰 해시 -> 계정 번호
  const save = () => store.save();

  const blank = (kind, nickname) => ({
    id: `acc_${crypto.randomBytes(9).toString('base64url')}`,
    kind, // 'guest' | 'google'
    googleSub: null,
    googleName: null,
    nickname,
    char: starters[0],
    owned: [...starters],
    coins: ECON.START_COINS,
    createdAt: now(),
    lastLoginAt: now(),
    tokens: [], // [{ h, t }]
    stats: { games: 0, botGames: 0, wins: 0, losses: 0, draws: 0, passes: 0, firstTry: 0, retries: 0, bestStreak: 0 },
    games: [],
    habit: [],
    daily: { date: '', games: 0 },
  });

  function issueToken(acc) {
    const token = crypto.randomBytes(32).toString('base64url');
    const t = now();
    const alive = acc.tokens.filter((x) => t - x.t < LIMITS.TOKEN_TTL_MS);
    for (const x of acc.tokens) if (!alive.includes(x)) delete root.tokens[x.h];
    acc.tokens = alive;
    acc.tokens.push({ h: sha(token), t });
    while (acc.tokens.length > LIMITS.TOKENS_MAX) delete root.tokens[acc.tokens.shift().h];
    root.tokens[sha(token)] = acc.id;
    return token;
  }

  const validName = (raw) => {
    const n = checkNickname(raw);
    return n.ok ? n.name : null;
  };

  function adoptLegacy(acc, legacyDevice) {
    if (!legacyDevice) return;
    ranking?.adopt(legacyDevice, acc.id);
    seen?.adopt(legacyDevice, acc.id);
  }

  const get = (id) => root.byId[id] ?? null;

  function byToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    const id = root.tokens[sha(token)];
    const acc = id && get(id);
    if (!acc) return null;
    const entry = acc.tokens.find((x) => x.h === sha(token));
    if (!entry || now() - entry.t >= LIMITS.TOKEN_TTL_MS) return null;
    return acc;
  }

  function createGuest({ nickname, legacyDevice } = {}) {
    if (Object.keys(root.byId).length >= LIMITS.MAX_ACCOUNTS) return { ok: false, error: '지금은 새 계정을 만들 수 없어요' };
    const acc = blank('guest', validName(nickname) ?? DEFAULT_NAME);
    root.byId[acc.id] = acc;
    adoptLegacy(acc, legacyDevice);
    const token = issueToken(acc);
    save();
    return { ok: true, account: acc, token };
  }

  // google: { sub, name }. current: 지금 로그인한 계정(게스트면 구글 계정으로 승격한다)
  function loginGoogle(google, { current = null, legacyDevice } = {}) {
    const existingId = root.google[google.sub];
    let acc = existingId ? get(existingId) : null;
    let linked = false;
    if (!acc) {
      if (current?.kind === 'guest') {
        acc = current; // 게스트 기록을 그대로 두고 구글 계정으로 바꾼다
        acc.kind = 'google';
        linked = true;
      } else {
        if (Object.keys(root.byId).length >= LIMITS.MAX_ACCOUNTS) return { ok: false, error: '지금은 새 계정을 만들 수 없어요' };
        acc = blank('google', validName([...google.name].slice(0, 8).join('')) ?? DEFAULT_NAME);
        root.byId[acc.id] = acc;
        adoptLegacy(acc, legacyDevice);
      }
      acc.googleSub = google.sub;
      root.google[google.sub] = acc.id;
    }
    acc.googleName = google.name || acc.googleName;
    acc.lastLoginAt = now();
    const token = issueToken(acc);
    save();
    return { ok: true, account: acc, token, linked, switched: !!current && current.id !== acc.id && !linked };
  }

  function logout(token) {
    const acc = byToken(token);
    if (!acc) return;
    acc.tokens = acc.tokens.filter((x) => x.h !== sha(token));
    delete root.tokens[sha(token)];
    save();
  }

  function touch(acc) {
    acc.lastLoginAt = now();
    save();
  }

  function update(acc, { nickname, char } = {}) {
    if (nickname !== undefined) {
      const n = checkNickname(nickname);
      if (!n.ok) return { ok: false, error: nicknameError(n.code) };
      acc.nickname = n.name;
    }
    if (char !== undefined) {
      if (!characters.includes(char)) return { ok: false, error: '없는 캐릭터예요' };
      if (!acc.owned.includes(char)) return { ok: false, error: '아직 갖고 있지 않은 캐릭터예요. 상점에서 얻을 수 있어요' };
      acc.char = char;
    }
    save();
    return { ok: true };
  }

  function buy(acc, char) {
    if (!characters.includes(char)) return { ok: false, error: '없는 캐릭터예요' };
    if (acc.owned.includes(char)) return { ok: false, error: '이미 갖고 있어요' };
    if (acc.coins < ECON.BUY_PRICE) return { ok: false, error: `재화가 모자라요 (${ECON.BUY_PRICE} 필요)` };
    acc.coins -= ECON.BUY_PRICE;
    acc.owned.push(char);
    save();
    return { ok: true, char };
  }

  function gacha(acc) {
    const locked = characters.filter((c) => !acc.owned.includes(c));
    if (!locked.length) return { ok: false, error: '모든 캐릭터를 갖고 있어요!' };
    if (acc.coins < ECON.GACHA_PRICE) return { ok: false, error: `재화가 모자라요 (${ECON.GACHA_PRICE} 필요)` };
    const char = locked[Math.floor(random() * locked.length)];
    acc.coins -= ECON.GACHA_PRICE;
    acc.owned.push(char);
    save();
    return { ok: true, char, odds: locked.length };
  }

  const view = (acc) => ({
    id: acc.id,
    kind: acc.kind,
    nickname: acc.nickname,
    char: acc.char,
    owned: [...acc.owned],
    coins: acc.coins,
    createdAt: acc.createdAt,
    googleName: acc.kind === 'google' ? acc.googleName : null,
    stats: { ...acc.stats },
    rank: ranking?.me(acc.id) ?? null,
  });

  function report(acc) {
    return {
      account: view(acc),
      habit: analyze(acc.habit),
      games: acc.games,
      recent: acc.habit.slice(-10).reverse().filter((e) => e.text).map(({ t, text, pass, attempt, difficulty }) => ({ t, text, pass, attempt, difficulty })),
    };
  }

  // 판이 끝났을 때 계정마다 성적, 최근 경기, 프롬프트 기록, 재화를 정산한다.
  // players: [{ id, accountId, name, score, firstTry, bestStreak, log }] 사람과 봇 모두(봇은 accountId가 없다)
  function settle({ reason, winnerId, leaverId, vsBot, difficulty, ranking: rk = null, players }) {
    const out = {};
    if (reason === 'aborted') return out;
    for (const p of players) {
      const acc = p.accountId && get(p.accountId);
      if (!acc) continue;
      const opp = players.find((x) => x.id !== p.id);
      const outcome = reason === 'forfeit' ? (p.id === leaverId ? 'loss' : 'win') : winnerId == null ? 'draw' : p.id === winnerId ? 'win' : 'loss';
      const s = acc.stats;
      s.games += 1;
      if (vsBot) s.botGames += 1;
      s[{ win: 'wins', loss: 'losses', draw: 'draws' }[outcome]] += 1;
      s.passes += p.score;
      s.firstTry += p.firstTry ?? 0;
      s.retries += p.log.filter((e) => !e.pass).length;
      s.bestStreak = Math.max(s.bestStreak, p.bestStreak ?? 0);

      // 프롬프트 기록: 최근 것만 본문을 남기고 오래된 것은 특징만 남긴다
      for (const e of p.log) acc.habit.push(makeEntry({ text: e.prompt, attempt: e.attempt, pass: e.pass, reasons: e.reasons ?? [], difficulty: e.difficulty ?? difficulty ?? '', t: now() }));
      if (acc.habit.length > LIMITS.HABIT_MAX) acc.habit.splice(0, acc.habit.length - LIMITS.HABIT_MAX);
      for (const e of acc.habit.slice(0, Math.max(0, acc.habit.length - LIMITS.HABIT_TEXT_KEEP))) e.text = '';

      // 재화: 사람과 한 판 중 랭킹에 반영된 판만. 하루 상한이 있다.
      let coins = 0;
      let note = null;
      if (vsBot) note = '연습봇과 한 판은 재화가 없어요';
      else if (!rk?.[p.id]?.counted) note = rk?.[p.id]?.note ?? '반영되지 않은 판이에요';
      else {
        const today = day(now());
        if (acc.daily.date !== today) acc.daily = { date: today, games: 0 };
        if (acc.daily.games >= ECON.DAILY_GAMES) note = `오늘은 재화를 받는 판 ${ECON.DAILY_GAMES}판을 다 채웠어요`;
        else {
          acc.daily.games += 1;
          if (reason === 'forfeit') coins = outcome === 'win' ? ECON.FORFEIT_WIN : -Math.min(acc.coins, -ECON.FORFEIT_LOSS);
          else coins = { win: ECON.WIN, draw: ECON.DRAW, loss: ECON.LOSS }[outcome] + Math.min(p.score, ECON.PASS_BONUS_CAP) * ECON.PASS_BONUS;
        }
      }
      acc.coins = Math.max(0, acc.coins + coins);
      out[p.id] = { coins, total: acc.coins, note };

      acc.games.unshift({ t: now(), vs: opp?.name ?? '', bot: !!vsBot, difficulty: difficulty ?? '', outcome, score: p.score, oppScore: opp?.score ?? 0, reason, rp: rk?.[p.id]?.counted ? rk[p.id].delta : null, coins });
      if (acc.games.length > LIMITS.GAMES_MAX) acc.games.length = LIMITS.GAMES_MAX;
    }
    save();
    return out;
  }

  const clearHistory = (acc) => {
    acc.habit = [];
    acc.games = [];
    save();
  };

  function remove(acc) {
    for (const x of acc.tokens) delete root.tokens[x.h];
    if (acc.googleSub) delete root.google[acc.googleSub];
    delete root.byId[acc.id];
    ranking?.remove(acc.id);
    seen?.remove(acc.id);
    save();
  }

  return { get, byToken, createGuest, loginGoogle, logout, touch, update, buy, gacha, view, report, settle, clearHistory, remove };
}

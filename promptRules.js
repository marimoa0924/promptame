// promptRules.js
// 프롬프트 배틀 규칙 검사. 브라우저와 Node에서 같이 쓰는 파일이고 외부 라이브러리는 필요 없어요.
// UI는 전송 전에 checkPrompt로, 서버는 같은 함수로 한 번 더, AI 답변이 오면 checkAnswer로 판정해요.
// 문제 데이터는 build-problems.mjs로 엑셀에서 만든 problems.json을 그대로 넘기면 돼요.

// 방 설정의 프롬프트 제한 값이에요. null은 무제한이에요.
export const PROMPT_LIMITS = [50, 100, 150, 300, null];

// ---------------------------------------------------------------------------
// 1. 글자 정규화
// ---------------------------------------------------------------------------

const COMPAT_JAMO = /[\u3131-\u318e]/; // ㄱ ㅏ 같은 낱자
const COMPAT_JAMO_G = /[\u3131-\u318e]/g;
const NOISE = /[\s\p{P}\p{S}\p{C}_]/gu; // 띄어쓰기, 구두점, 기호, 이모지, 보이지 않는 문자
const DIGITS = /\p{N}/gu;

// 전각 문자 같은 호환 문자를 일반 문자로 바꾸되 낱자 자모는 건드리지 않아요.
function foldCompat(text) {
  let out = '';
  for (const ch of String(text).normalize('NFC')) {
    const cp = ch.codePointAt(0);
    out += cp >= 0x3131 && cp <= 0x318e ? ch : ch.normalize('NFKC');
  }
  return out;
}

// 띄어쓰기, 특수문자, 이모지를 지우고 소문자로 맞춘 글자열이에요. 낱자 자모와 숫자는 남겨 둬요.
export function normalizeLoose(text) {
  return foldCompat(text).toLowerCase().replace(NOISE, '');
}

// ㅁㅣㅌㅗ 같은 낱자 입력을 글자로 합쳐 줘요.
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
const COMPOUND_VOWEL = { ㅗㅏ: 'ㅘ', ㅗㅐ: 'ㅙ', ㅗㅣ: 'ㅚ', ㅜㅓ: 'ㅝ', ㅜㅔ: 'ㅞ', ㅜㅣ: 'ㅟ', ㅡㅣ: 'ㅢ' };
const COMPOUND_FINAL = {
  ㄱㅅ: 'ㄳ', ㄴㅈ: 'ㄵ', ㄴㅎ: 'ㄶ', ㄹㄱ: 'ㄺ', ㄹㅁ: 'ㄻ', ㄹㅂ: 'ㄼ',
  ㄹㅅ: 'ㄽ', ㄹㅌ: 'ㄾ', ㄹㅍ: 'ㄿ', ㄹㅎ: 'ㅀ', ㅂㅅ: 'ㅄ',
};

export function composeJamo(text) {
  const cs = Array.from(text);
  const isJung = (c) => c !== undefined && JUNG.includes(c);
  let out = '';
  let i = 0;
  while (i < cs.length) {
    const c = cs[i];
    if (CHO.includes(c) && isJung(cs[i + 1])) {
      let jung = cs[i + 1];
      let j = i + 2;
      if (COMPOUND_VOWEL[jung + (cs[j] ?? '')]) {
        jung = COMPOUND_VOWEL[jung + cs[j]];
        j += 1;
      }
      let jong = '';
      const next = cs[j];
      if (next !== undefined && JONG.includes(next) && !isJung(cs[j + 1])) {
        const pair = COMPOUND_FINAL[next + (cs[j + 1] ?? '')];
        if (pair && !isJung(cs[j + 2])) {
          jong = pair;
          j += 2;
        } else {
          jong = next;
          j += 1;
        }
      }
      const code = 0xac00 + (CHO.indexOf(c) * 21 + JUNG.indexOf(jung)) * 28 + JONG.indexOf(jong);
      out += String.fromCharCode(code);
      i = j;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// 금지어 비교용 글자열 묶음이에요. 서로 다른 우회를 각각 잡아내요.
//  1) 낱자 자모를 글자로 합친 것
//  2) 낱자 자모와 숫자를 전부 지운 것  예: 미ㅋ토ㅋ콘, 미1토2콘
//  3) 숫자를 지우고 낱자를 합친 것
function forbiddenVariants(text) {
  const loose = normalizeLoose(text);
  const noDigits = loose.replace(DIGITS, '');
  return [...new Set([composeJamo(loose), noDigits.replace(COMPAT_JAMO_G, ''), composeJamo(noDigits)])];
}

// ---------------------------------------------------------------------------
// 2. 금지어 목록
// ---------------------------------------------------------------------------

// 주제어, 필수어, 추가금지어가 모두 금지어예요.
export function buildForbiddenList(problem) {
  const entries = [
    { word: problem.topic, kind: 'topic' },
    ...problem.keywords.map((word) => ({ word, kind: 'keyword' })),
    ...(problem.extraForbidden ?? []).map((word) => ({ word, kind: 'extra' })),
  ];
  const seen = new Set();
  const list = [];
  for (const { word, kind } of entries) {
    const key = normalizeLoose(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push({ word, kind, key, initials: toInitials(key) });
  }
  return list;
}

const listCache = new WeakMap();
function forbiddenListOf(problem) {
  if (!listCache.has(problem)) listCache.set(problem, buildForbiddenList(problem));
  return listCache.get(problem);
}

// 한글 단어를 초성 글자열로 바꿔요. 한글이 아닌 글자가 섞여 있으면 null이에요.
function toInitials(key) {
  let out = '';
  for (const ch of key) {
    const code = ch.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return null;
    out += CHO[Math.floor((code - 0xac00) / 588)];
  }
  return out.length >= 3 ? out : null; // 두 글자 이하 초성은 우연히 겹치는 일이 많아서 검사하지 않아요.
}

const SHORT_ASCII = /^[a-z]{1,4}$/;

// 프롬프트가 금지어를 담고 있으면 그 항목을 돌려줘요. 없으면 null이에요.
export function findForbidden(prompt, problem) {
  const variants = forbiddenVariants(prompt);
  const loose = normalizeLoose(prompt);
  for (const entry of forbiddenListOf(problem)) {
    // 짧은 영어 단어는 father 안의 fat처럼 다른 단어에 들어 있는 경우를 살려 줘요.
    // 단어 앞뒤에 영어 글자가 붙어 있지 않을 때만 걸러요. dogs처럼 복수형은 걸러요.
    if (SHORT_ASCII.test(entry.key)) {
      const re = new RegExp(`(?<![a-z])${entry.key}(?:s|es)?(?![a-z])`);
      if (variants.some((v) => re.test(v))) return entry;
      continue;
    }
    if (variants.some((v) => v.includes(entry.key))) return entry;
    if (entry.initials && loose.includes(entry.initials)) return { ...entry, kind: 'initials' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. 프롬프트 검사. 전송 전에 UI와 서버가 같이 불러요.
// ---------------------------------------------------------------------------

// 공백과 줄바꿈을 포함해서 센 글자 수예요.
export function countChars(text) {
  return Array.from(String(text).replace(/\r\n/g, '\n')).length;
}

// promptLimit은 PROMPT_LIMITS 중 하나예요. null이면 길이 제한이 없어요.
// 결과 code는 EMPTY, TOO_LONG, FORBIDDEN 중 하나이고, 통과하면 ok가 true예요.
export function checkPrompt(prompt, problem, promptLimit = null) {
  const text = String(prompt ?? '');
  if (!text.trim()) return { ok: false, code: 'EMPTY' };
  const length = countChars(text);
  if (promptLimit !== null && length > promptLimit) {
    return { ok: false, code: 'TOO_LONG', length, limit: promptLimit };
  }
  const hit = findForbidden(text, problem);
  if (hit) return { ok: false, code: 'FORBIDDEN', word: hit.word, kind: hit.kind };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 4. AI 답변 검사. 필수어 포함과 분량만 봐요.
// ---------------------------------------------------------------------------

// 문장 끝 기호나 줄바꿈 뒤에서 문장을 나누고, 번호나 글머리표만 있는 조각은 문장으로 세지 않아요.
export function countSentences(text) {
  const pieces = String(text)
    .trim()
    .split(/(?<=[.!?。！？…])["'”’)\]]*\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s && !/^(\d+[.)]|[-*•])$/.test(s));
  return pieces.length;
}

// 난이도별 필수어 최소 개수예요. problems.json의 difficultyRules가 있으면 그것을 써요.
export const DEFAULT_DIFFICULTY_RULES = {
  쉬움: { minKeywords: 1 },
  보통: { minKeywords: 2 },
  어려움: { minKeywords: 3 },
};

// lengthRule은 { type: 'chars' | 'sentences', value: 숫자 } 형태예요.
// opts.truncated가 true면 AI 답변이 토큰 한도로 잘린 거라서 분량 초과로 보고 실패 처리해요.
// reasons에는 실패 이유가 담겨요: KEYWORD_SHORT, LENGTH_OVER, TRUNCATED, EMPTY
export function checkAnswer(answer, problem, lengthRule, difficultyRules = DEFAULT_DIFFICULTY_RULES, opts = {}) {
  const text = String(answer ?? '').trim();
  const body = normalizeLoose(text);
  const truncated = opts.truncated === true;

  const matched = problem.keywords.filter((k) => body.includes(normalizeLoose(k)));
  const needed = Math.min(
    difficultyRules[problem.difficulty]?.minKeywords ?? problem.keywords.length,
    problem.keywords.length,
  );
  const keywordOk = matched.length >= needed;

  const actual = lengthRule.type === 'sentences' ? countSentences(text) : countChars(text);
  const lengthOk = text.length > 0 && actual <= lengthRule.value && !truncated;

  const reasons = [];
  if (text.length === 0) reasons.push('EMPTY');
  if (truncated) reasons.push('TRUNCATED');
  else if (text.length > 0 && actual > lengthRule.value) reasons.push('LENGTH_OVER');
  if (!keywordOk) reasons.push('KEYWORD_SHORT');

  return {
    pass: keywordOk && lengthOk,
    keywordOk,
    lengthOk,
    truncated,
    matched,
    needed,
    length: { type: lengthRule.type, limit: lengthRule.value, actual },
    reasons,
  };
}

// ---------------------------------------------------------------------------
// 5. 출제. 주제 쌍과 분량을 따로 뽑아서 조합해요.
// ---------------------------------------------------------------------------

// data는 problems.json 내용이에요. usedIds에 이미 낸 번호를 넣으면 겹치지 않게 뽑아요.
// 서버가 한 번 뽑아서 두 플레이어에게 똑같이 보내 주세요.
export function drawQuestion(data, difficulty, usedIds = [], rng = Math.random) {
  const pool = data.problems.filter((p) => p.difficulty === difficulty);
  const fresh = pool.filter((p) => !usedIds.includes(p.id));
  const source = fresh.length > 0 ? fresh : pool;
  const problem = source[Math.floor(rng() * source.length)];
  const lengthRule = data.lengthRules[Math.floor(rng() * data.lengthRules.length)];
  return { problem, lengthRule };
}

// 판 시작 때 문제 목록을 한 번에 뽑아요. 난이도 풀을 다 쓰면 다시 섞어서 이어 붙여요.
export function drawSequence(data, difficulty, count, rng = Math.random) {
  const poolSize = data.problems.filter((p) => p.difficulty === difficulty).length;
  const list = [];
  let used = [];
  for (let i = 0; i < count; i++) {
    if (used.length >= poolSize) used = [];
    const item = drawQuestion(data, difficulty, used, rng);
    used.push(item.problem.id);
    list.push(item);
  }
  return list;
}

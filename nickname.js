// 닉네임 규칙. 서버와 브라우저가 같이 쓴다. 길이는 2~8자이고, 욕설은 막는다.
// 금칙어 목록은 초안이다. 새로 발견되는 말은 BANNED에 한 줄씩 추가한다.
import { normalizeLoose, composeJamo, countChars } from './promptRules.js';

export const NICK_MIN = 2;
export const NICK_MAX = 8;

const BANNED = [
  '시발', '씨발', '씨바', '병신', '지랄', '개새끼', '좆', '썅', '느금마', '섹스', '자지', '보지',
  'ㅅㅂ', 'ㅂㅅ', 'ㅈㄹ', 'fuck', 'shit', 'bitch', 'sex',
].map((w) => normalizeLoose(w));

// 결과: { ok: true, name } 또는 { ok: false, code: 'LENGTH' | 'BANNED' }
export function checkNickname(raw) {
  const name = String(raw ?? '').trim();
  const len = countChars(name);
  if (len < NICK_MIN || len > NICK_MAX) return { ok: false, code: 'LENGTH' };
  const loose = normalizeLoose(name);
  const forms = [loose, composeJamo(loose)];
  if (BANNED.some((w) => forms.some((f) => f.includes(w)))) return { ok: false, code: 'BANNED' };
  return { ok: true, name };
}

export function nicknameError(code) {
  return code === 'BANNED' ? '쓸 수 없는 말이 들어 있어요' : `닉네임은 ${NICK_MIN}~${NICK_MAX}자로 써 주세요`;
}

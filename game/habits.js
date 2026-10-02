// 프롬프트 작성 습관 분석. AI를 쓰지 않고 규칙으로만 한다(판정과 같은 원칙).
// 판이 끝날 때마다 보낸 프롬프트를 특징(역할 설정, 비유 요청 등)으로 바꿔 기록하고, 모인 기록으로 "작성 유형"을 알려 준다.

export const FEATURES = {
  role: { label: '역할·상황 설정', re: [/(나는|저는|난|전|내가)\s*[^.!?\n]{0,15}(교사|선생|학생|기자|작가|의사|엄마|아빠|부모|강사|교수|디자이너|개발자|유튜버|가이드)/, /(너는|넌|당신은)\s*[^.!?\n]{0,15}(선생|교사|전문가|박사|작가|가이드|도우미|친구)/] },
  audience: { label: '듣는 사람 지정', re: [/(초등|어린이|아이들|아이|유치원|중학생|고등학생|친구|동생|할머니|누구나|초보|처음|입문|쉬운 ?말|쉽게|쉬운)/] },
  brevity: { label: '짧게 요청', re: [/(짧게|간단|간결|핵심만|요약|한마디|줄여)/] },
  example: { label: '비유·예시 요청', re: [/(예를 ?들|예시|비유|처럼|빗대|상상)/] },
  steps: { label: '단계·순서 요청', re: [/(단계|순서|차례|먼저|그다음|그 다음|첫째|둘째|하나씩|차근차근)/] },
  context: { label: '특징·과정 묘사', re: [/(과정|원리|특징|역할|이유|모양|색깔|생김새|만드는|하는 ?법|방법|어디서|언제)/] },
  question: { label: '질문형', re: [/(\?|뭐야|뭔가요|무엇|왜 |어떻게|어떤)/] },
  structure: { label: '줄 나누기·목록', re: [/\n/, /^\s*[-*•]/m, /\d+[.)]\s/] },
};

export function featuresOf(text) {
  const t = String(text ?? '');
  return Object.entries(FEATURES)
    .filter(([, f]) => f.re.some((re) => re.test(t)))
    .map(([key]) => key);
}

// 기록 한 건. text는 최근 것만 오래 남기고(accounts.js에서 정리), 나머지는 특징만 남긴다.
export function makeEntry({ text, attempt, pass, reasons = [], difficulty = '', t = Date.now() }) {
  const s = String(text ?? '');
  return { t, len: [...s].length, attempt, pass: !!pass, reasons, difficulty, f: featuresOf(s), text: s.slice(0, 200) };
}

export const MIN_ENTRIES = 8; // 이만큼은 써 봐야 유형을 알려 준다

const pct = (x) => Math.round(x * 100);
const rate = (list) => (list.length ? list.filter((e) => e.pass).length / list.length : null);

const TYPES = {
  situation: { name: '상황 설정형', desc: '누가 누구에게 설명하는 상황인지부터 깔고 시작하는 편이에요. AI가 눈높이를 맞추기 좋아요.' },
  example: { name: '비유·예시형', desc: '비유나 예시를 요청해서 AI의 설명을 쉽게 끌어내는 편이에요.' },
  steps: { name: '단계 안내형', desc: '순서와 단계를 짚어서 AI의 답을 차근차근 이끄는 편이에요.' },
  describer: { name: '특징 묘사형', desc: '모양, 쓰임, 과정 같은 특징을 풀어서 AI가 핵심 낱말을 꺼내게 하는 편이에요.' },
  concise: { name: '간결 요청형', desc: '"짧게", "핵심만"처럼 답의 길이를 다스리는 말을 자주 써요. 분량 조건에 강해요.' },
  organizer: { name: '정리 구성형', desc: '줄을 나누고 목록으로 요구 사항을 깔끔하게 정리해서 쓰는 편이에요.' },
  asker: { name: '질문 던지기형', desc: '"왜", "어떻게" 같은 질문으로 AI의 답을 끌어내는 편이에요.' },
  long: { name: '장문 설명형', desc: '상황과 조건을 길게 풀어서 쓰는 편이에요. 자세하지만 글자 제한이 있는 방에서는 줄여야 해요.' },
  direct: { name: '짧은 직설형', desc: '핵심만 짧게 던지는 편이에요. 빠르지만 AI가 엉뚱하게 알아들을 수도 있어요.' },
  sniper: { name: '한 방 저격형', desc: '첫 시도에 맞히는 비율이 높아요. 프롬프트를 쓰기 전에 조건을 잘 따져 보는 편이에요.' },
  tryer: { name: '끈기 도전형', desc: '실패해도 프롬프트를 고쳐 가며 끝까지 맞히는 편이에요. 고쳐 쓰는 힘이 좋아요.' },
  balanced: { name: '균형형', desc: '어느 한 가지에 치우치지 않고 상황에 맞게 섞어 쓰는 편이에요.' },
};

// 유형마다 점수를 매겨서 기준을 넘은 것 중 가장 두드러진 하나를 고른다(1.0이 기준). 아무것도 두드러지지 않을 때만 균형형이다.
// 비교를 쉽게 하려고 비율을 "그 유형의 기준 비율 대비 몇 배인지"로 바꾼다.
function pickType({ sh, avgLen, firstTryRate, avgAttempts, solvedCount, firstTryCount }) {
  const scores = {
    situation: Math.max((sh('role') + sh('audience')) / 0.5, sh('role') / 0.25),
    example: sh('example') / 0.25,
    steps: sh('steps') / 0.2,
    describer: sh('context') / 0.45,
    concise: sh('brevity') / 0.25,
    organizer: sh('structure') / 0.25,
    asker: sh('question') / 0.6,
    long: avgLen / 80,
    direct: 30 / Math.max(avgLen, 1),
    sniper: firstTryCount >= 5 && avgLen >= 30 ? firstTryRate / 0.7 : 0,
    tryer: solvedCount >= 4 && avgAttempts != null ? (avgAttempts - 1) / 0.8 : 0,
  };
  const best = Object.entries(scores).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 'balanced';
}

export function analyze(entries) {
  const list = entries ?? [];
  const count = list.length;
  if (count < MIN_ENTRIES) return { enough: false, count, need: MIN_ENTRIES - count };

  const avgLen = Math.round(list.reduce((n, e) => n + e.len, 0) / count);
  const firstTries = list.filter((e) => e.attempt === 1);
  const firstTryRate = firstTries.length ? firstTries.filter((e) => e.pass).length / firstTries.length : 0;
  const solved = list.filter((e) => e.pass);
  const avgAttempts = solved.length ? solved.reduce((n, e) => n + e.attempt, 0) / solved.length : null;
  const failed = list.filter((e) => !e.pass);
  const share = (re) => (failed.length ? failed.filter((e) => e.reasons.some((r) => re.test(r))).length / failed.length : 0);
  const failure = { keyword: share(/KEYWORD_SHORT/), length: share(/LENGTH_OVER|TRUNCATED/) };

  const features = Object.entries(FEATURES).map(([key, f]) => {
    const withF = list.filter((e) => e.f.includes(key));
    const withoutF = list.filter((e) => !e.f.includes(key));
    const enoughBoth = withF.length >= 3 && withoutF.length >= 3;
    return { key, label: f.label, share: withF.length / count, withRate: enoughBoth ? rate(withF) : null, withoutRate: enoughBoth ? rate(withoutF) : null };
  });
  const sh = (key) => features.find((f) => f.key === key).share;

  const type = TYPES[pickType({ sh, avgLen, firstTryRate, avgAttempts, solvedCount: solved.length, firstTryCount: firstTries.length })];

  const tips = [];
  if (failure.length >= 0.4) tips.push('AI 답변이 분량을 자주 넘어요. 숫자 없이 "핵심만 짧게"처럼 길이를 줄여 달라고 해 보세요.');
  if (failure.keyword >= 0.5) tips.push('답변에 필수어가 잘 안 담겨요. 주제의 모양, 쓰임, 과정 같은 구체적인 특징을 풀어 쓰면 AI가 핵심 낱말을 더 잘 꺼내요.');
  const lift = features
    .filter((f) => f.withRate != null && f.withRate - f.withoutRate >= 0.15)
    .sort((a, b) => b.withRate - b.withoutRate - (a.withRate - a.withoutRate))[0];
  if (lift) tips.push(`"${lift.label}"를 쓴 프롬프트의 성공률이 더 높았어요 (${pct(lift.withRate)}% 대 ${pct(lift.withoutRate)}%). 더 자주 써 보세요.`);
  if (avgLen < 25) tips.push('프롬프트가 아주 짧아요. 누구에게 설명하는지, 어떤 상황인지 한 줄만 더해 보세요.');
  if (avgLen > 120) tips.push('프롬프트가 긴 편이에요. 글자 제한이 있는 방에서는 핵심만 남겨 보세요.');
  if (!tips.length) tips.push('지금 방식이 잘 맞아요. 난이도를 올려서 도전해 보세요!');

  return { enough: true, count, avgLen, firstTryRate, avgAttempts, failure, features, type: { ...type }, tips: tips.slice(0, 3) };
}

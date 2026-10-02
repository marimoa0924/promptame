// 연습봇: 혼자서도 대결 화면을 확인할 수 있게 상대 역할을 한다.
const shuffle = (list) => [...list].sort(() => Math.random() - 0.5);
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

// 힌트 단어를 조합해 프롬프트를 만든다. 일부러 가끔 길게 쓰거나 대충 써서 RETRY도 나오게 한다.
export function botPrompt(topic) {
  const r = Math.random();
  const hints = shuffle(topic.hints);
  if (r < 0.55) return `${hints.slice(0, 3).join(', ')}에 대해 초등학생도 알아듣게 짧게 설명해줘`;
  if (r < 0.8) return `${hints.slice(0, 3).join(', ')} 이야기를 자세히 풀어서 해줘`;
  return `${hints[0]} 알려줘`;
}

const LINES = {
  pass: ['ㅋㅋ 쉽네', '이 정도쯤이야', '다음 거 가자~', '봤지?'],
  fail: ['아 이게 아닌데', '엉엉', '다시 해볼게…', '흠…'],
};

export function botLine(pass) {
  return pickOne(pass ? LINES.pass : LINES.fail);
}

export const BOT_NAMES = ['연습봇', '깡통봇', '삐빅봇'];

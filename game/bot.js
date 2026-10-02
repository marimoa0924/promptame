// 연습봇: 혼자서도 대결 화면을 확인할 수 있게 상대 역할을 한다.
// 봇은 목 AI와 겨룬다. 프롬프트 길이가 제각각이라 PASS도 RETRY도 나온다.
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

const PROMPTS = [
  '나는 아이들을 가르치는 교사야. 아이들 눈높이에 맞게 짧고 간결하게 설명해줘',
  '초등학생도 알아듣게 짧게 차근차근 중요한 말을 넣어서 알려줘',
  '중요한 용어를 빠짐없이 넣어서 자세히 풀어서 설명해줘',
  '쉽게 짧게 알려줘',
  '그것에 대해 알려줘',
];

export const botPrompt = () => pickOne(PROMPTS);

const EMOJI = { pass: ['😹', '🔥', '👍'], fail: ['😭', '🙏'] };
export const botEmoji = (pass) => pickOne(pass ? EMOJI.pass : EMOJI.fail);

export const BOT_NAMES = ['연습봇', '깡통봇', '삐빅봇'];

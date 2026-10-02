// 목업 AI.
// 실제 LLM으로 바꿀 때는 composeAnswer/streamText 대신 LLM 스트리밍 응답을 yield 하면 된다.
// judge()는 최종 답변 텍스트만 보고 판정하므로 그대로 재사용 가능.
import { LENGTH_CUES } from './topics.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (s) => s.replace(/\s+/g, '').toLowerCase();

const NUM_KO = { 1: '한', 2: '두', 3: '세', 4: '네', 5: '다섯' };

const OFF_TOPIC = [
  '음… 무슨 이야기인지 잘 모르겠어요.\n조금 더 구체적으로 알려 줄래요?',
  '좋은 질문이에요!\n하지만 어떤 주제를 말하는지 헷갈려요.',
  '오늘 날씨가 참 좋네요.\n산책하기 딱 좋은 날이에요!',
];

export function lengthLabel(topic) {
  return `${topic.maxLines}줄 이내`;
}

export function bannedWords(topic) {
  const n = topic.maxLines;
  return [...topic.banned, `${n}줄`, `${NUM_KO[n]}줄`];
}

export function findBannedWord(prompt, topic) {
  const p = normalize(prompt);
  return bannedWords(topic).find((w) => p.includes(normalize(w))) ?? null;
}

// 프롬프트에 담긴 힌트 개수로 답변 품질이 정해진다
export function composeAnswer(prompt, topic, requiredHits) {
  const p = normalize(prompt);
  const hits = topic.hints.filter((h) => p.includes(normalize(h))).length;
  const wantsShort = LENGTH_CUES.some((c) => p.includes(c));

  if (hits >= requiredHits) {
    return (wantsShort ? topic.short : [...topic.short, ...topic.extra]).join('\n');
  }
  if (hits > 0) return topic.vague.join('\n');
  return OFF_TOPIC[Math.floor(Math.random() * OFF_TOPIC.length)];
}

// ChatGPT처럼 몇 글자씩 흘려보낸다. await 사이에 이벤트 루프가 풀리므로 다른 플레이어를 막지 않는다.
export async function* streamText(text) {
  const chars = [...text];
  for (let i = 0; i < chars.length; ) {
    const step = 1 + Math.floor(Math.random() * 3);
    yield chars.slice(i, i + step).join('');
    i += step;
    await sleep(25 + Math.random() * 45);
  }
}

export function judge(answer, topic) {
  const lines = answer.split('\n').filter((l) => l.trim()).length;
  if (!answer.includes(topic.keyword)) {
    return { pass: false, reason: `필수 키워드 '${topic.keyword}'가 빠졌어요` };
  }
  if (lines > topic.maxLines) {
    return { pass: false, reason: `너무 길어요! (${lines}줄 / ${lengthLabel(topic)})` };
  }
  return { pass: true, reason: '주제·분량·키워드 모두 충족!' };
}

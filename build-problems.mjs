// 엑셀 문제 데이터를 게임에서 쓰는 problems.json으로 바꿔 주는 스크립트
// 준비: npm i xlsx
// 실행: node build-problems.mjs [엑셀파일] [출력파일]
// 예시: node build-problems.mjs 교육용_대전게임_문제데이터_v2.xlsx problems.json
import xlsx from 'xlsx';
import fs from 'node:fs';

const [, , input = '교육용_대전게임_문제데이터_v2.xlsx', output = 'problems.json'] = process.argv;

const wb = xlsx.readFile(input);
const readSheet = (name) => {
  if (!wb.Sheets[name]) throw new Error(`시트 ${name}이 엑셀에 없어요.`);
  return xlsx.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
};
const splitList = (v) =>
  String(v ?? '')
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);

const errors = [];
const warn = (msg) => errors.push(msg);
const notes = [];
const squash = (s) => String(s).replace(/[\s\p{P}\p{S}\p{C}_]+/gu, '').toLowerCase();

// 난이도 시트
const difficultyRules = {};
for (const r of readSheet('난이도')) {
  difficultyRules[String(r['난이도']).trim()] = { minKeywords: Number(r['필수어최소개수']) };
}

// 분량 시트
const TYPE_MAP = { 글자: 'chars', 문장: 'sentences' };
const lengthRules = readSheet('분량').map((r) => {
  const type = TYPE_MAP[String(r['기준종류']).trim()];
  if (!type) warn(`분량 시트: ${r['분량이름']}의 기준종류가 글자나 문장이 아니에요.`);
  return { name: String(r['분량이름']).trim(), type, value: Number(r['값']) };
});

// 주제 시트
const seenIds = new Set();
const seenTopics = new Set();
const seenKeywords = new Set();
const problems = readSheet('주제').map((r) => {
  const id = Number(r['번호']);
  const topic = String(r['주제']).trim();
  const keywords = splitList(r['필수어']);
  const difficulty = String(r['난이도']).trim();
  const label = `주제 시트 ${id}번 ${topic}`;

  if (seenIds.has(id)) warn(`${label}: 번호가 중복돼요.`);
  seenIds.add(id);
  if (seenTopics.has(topic)) warn(`${label}: 주제가 중복돼요.`);
  seenTopics.add(topic);
  if (!difficultyRules[difficulty]) warn(`${label}: 난이도 ${difficulty}가 난이도 시트에 없어요.`);
  if (topic.length < 2) notes.push(`${label}: 한 글자 주제는 금지어 검사가 너무 넓게 걸릴 수 있어요.`);
  if (keywords.length === 0) warn(`${label}: 필수어가 비어 있어요.`);
  if (difficultyRules[difficulty] && keywords.length < difficultyRules[difficulty].minKeywords) {
    warn(`${label}: 필수어가 ${keywords.length}개인데 난이도가 요구하는 개수보다 적어요.`);
  }
  for (const k of keywords) {
    if (k.length < 2 || k.length > 8) warn(`${label}: 필수어 ${k}는 2~8글자여야 해요.`);
    if (squash(k).includes(squash(topic)) || squash(topic).includes(squash(k))) {
      warn(`${label}: 필수어 ${k}가 주제와 겹쳐요.`);
    }
    if (seenKeywords.has(squash(k))) warn(`${label}: 필수어 ${k}가 다른 행과 중복돼요.`);
    seenKeywords.add(squash(k));
  }
  return {
    id,
    topic,
    keywords,
    difficulty,
    category: String(r['분류']).trim(),
    extraForbidden: splitList(r['추가금지어']),
  };
});

for (const n of notes) console.warn('참고: ' + n);
if (errors.length > 0) {
  console.error(`엑셀에서 문제 ${errors.length}개를 찾았어요. 고친 뒤 다시 실행해 주세요.`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}

fs.writeFileSync(output, JSON.stringify({ problems, lengthRules, difficultyRules }, null, 2), 'utf8');
console.log(`${output} 생성 완료: 주제 ${problems.length}개, 분량 ${lengthRules.length}개`);

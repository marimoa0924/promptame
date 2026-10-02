// 배포용 빌드 점검: 따로 만들 파일은 없고, 서버가 뜨는 데 필요한 파일이 제자리에 있는지만 확인한다.
// 개발용 패키지(xlsx 등) 없이도 돌아야 한다. 배포 환경은 devDependencies를 설치하지 않는 경우가 많다.
// 엑셀에서 문제 데이터를 다시 만들 때는 npm run build:problems를 쓴다.
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const need = ['server.js', 'promptRules.js', 'nickname.js', 'problems.json', 'public/index.html', 'public/js/main.js', 'public/css/style.css'];
const missing = need.filter((f) => !existsSync(new URL(f, root)));
if (missing.length) {
  console.error(`빌드 점검 실패: 파일이 없어요 → ${missing.join(', ')}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(new URL('problems.json', root), 'utf8'));
if (!Array.isArray(data.problems) || data.problems.length === 0) {
  console.error('빌드 점검 실패: problems.json에 문제 목록(problems)이 비어 있어요');
  process.exit(1);
}
console.log(`빌드 점검 통과: 서버·화면 파일 확인, 문제 ${data.problems.length}개`);

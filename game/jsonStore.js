// 서버를 다시 켜도 남겨야 하는 값(랭킹, 본 문제 기록)을 JSON 파일에 저장한다.
// file이 null이면 메모리에만 둔다(테스트용). 저장은 잠깐 모았다가 한 번에 하고, 임시 파일에 쓴 뒤 바꿔치기해서 파일이 반쯤 쓰인 채 남지 않게 한다.
import fs from 'node:fs';
import path from 'node:path';

export function createJsonStore(file = null, { delayMs = 300 } = {}) {
  let data = {};
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
    } catch {
      /* 파일이 없거나 깨졌으면 빈 상태로 시작 */
    }
  }
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.warn('[store] 저장 실패:', err.message);
    }
  };
  return {
    data,
    save() {
      if (!file || timer) return;
      timer = setTimeout(flush, delayMs);
      timer.unref?.();
    },
    flush,
  };
}

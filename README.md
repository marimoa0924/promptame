# 🏮 PROMPT P.T (promptame)

AI에게 주제문을 **직접 말하지 않고** 원하는 답을 끌어내는 실시간 1:1 프롬프트 대결 게임. 로우폴리 도트 스타일.

## 실행

```bash
npm install
npm run dev        # http://localhost:3000 (서버 파일 수정 시 자동 재시작, 화면은 새로고침)
npm test           # 판정 규칙·AI 클라이언트 테스트
npm run build      # 엑셀 문제 데이터 → problems.json 다시 만들기 (= npm run build:problems)
```

방 최대 개수(`MAX_ROOMS`, 기본 500)와 허용할 사이트(`ALLOWED_ORIGINS`, 프록시 뒤에서 주소가 다를 때만)는 환경변수로 바꿀 수 있어요.

AI는 방을 만들 때 Gemini, GPT, Claude 중에서 고를 수 있어요(키가 있는 것만). 로비의 "솔로" 탭에서는 상대 없이 혼자 점수 도전을 할 수 있어요(`docs/spec/11-ai-providers-and-solo.md`).

로그인은 게스트(버튼 한 번)와 구글을 지원해요. 구글 로그인을 켜려면 구글 클라우드 콘솔에서 만든 웹 클라이언트 ID를 `.env`의 `GOOGLE_CLIENT_ID`에 넣어요(설정 방법은 `docs/spec/10-accounts-personalization.md`). 계정, 랭킹, 재화, 성적, 프롬프트 습관 기록은 모두 `store.json`에 저장돼요.

랭킹(RP)과 "이미 본 문제" 기록은 `store.json`에 저장돼요 (`DATA_FILE`로 위치 변경, git에는 안 올라가요).

AI는 `GEMINI_API_KEY`가 있으면 Gemini를, 없으면 목업을 쓴다. 키는 프로젝트 폴더의 `.env` 파일에 넣는다 (git에 올라가지 않는다).

```bash
cp .env.example .env     # 그다음 .env 를 열어 GEMINI_API_KEY= 뒤에 키를 붙여 넣기
npm run dev              # 서버 첫 줄에 'AI: Gemini (모델명)'이 나오면 성공
```

- **혼자 배틀 화면 보기**: 방 만들기 → 상대 칸의 **🤖 연습봇과 붙기**
- **사람 둘 테스트**: 브라우저 탭 2개 → 한쪽은 방 만들기, 다른 쪽은 코드 입력 (탭마다 다른 플레이어로 취급)
- **같은 와이파이의 다른 기기**: 서버 실행 시 출력되는 `http://192.168.x.x:3000`
- **튜토리얼**: 로비 상단 📘 버튼 (상대 없이 혼자, 하이라이트 박스 안내)
- 서버 동작 점검: 서버를 켠 상태에서 `npm run smoke`

## 게임 흐름

1. 3·2·1 카운트다운 → 주제문 룰렛 (주제문 / 분량 / 필수 키워드)
2. 프롬프트 전송 → AI가 한 글자씩 답변 → **평가 AI가 한 줄씩 형광펜으로 읽음** → PASS(검은 화면) / RETRY(블루스크린)
3. 시간은 체력바로 줄어들고 마지막 10초는 큰 숫자로 카운트다운
4. 3연속 원샷 PASS → 상대 5초 얼음
5. 종료 → 흑백 전환 → 두둥! → The Winner is…… → 결과 카드 (총 시간 / 포인트 / 승패, 폭죽 or 우는 캐릭터)
6. **한번 더 하기**(같은 방 설정) / **나가기**(로비)

캐릭터는 PASS면 "야호!", RETRY면 울어요. 채팅 기능은 없고, 상대의 프롬프트는 판이 끝날 때까지 보이지 않아요.

## 구조

```
server.js           Express + Socket.IO, 방 목록과 소켓 이벤트 연결
game/room.js        방 상태 머신 (waiting → countdown → playing → ended → 한번 더), 점수·얼음·평가 시간
game/gemini.js      AI 클라이언트 (Gemini 호출 + 키 없을 때 쓰는 목업)
game/bot.js         연습봇 프롬프트
promptRules.js      금지어 검사·답변 판정·출제 (서버와 브라우저가 같이 씀)
problems.json       문제 데이터 (엑셀 → build-problems.mjs)
public/js/main.js   화면 전환, 종료·한번 더 하기·튜토리얼 연결
public/js/game.js   게임 화면 (보드, 룰렛, 스트리밍, 평가 형광펜, PASS/RETRY, 채팅, 체력바)
public/js/finale.js 게임 종료 연출 + 결과 카드 + 픽셀 폭죽
public/js/tutorial.js 하이라이트 박스 코치 + 튜토리얼 단계
public/js/lobby.js  로비 (내 옷장, 방 만들기, 코드 입장)
public/js/maps.js   맵 테마 (팔레트 + 픽셀 무대)  ← 색/배경은 여기서만 수정
public/js/sprites.js 16×16 픽셀 캐릭터
public/js/bg.js     디더링 픽셀 배경 캔버스
```

## 맵 테마

| 맵 | 컨셉 | 팔레트 |
|---|---|---|
| 로비 | 파스텔 | Ghost White · Antique White · Peach Fuzz · Periwinkle · Soft Periwinkle |
| 동양풍 | 달빛 연못 | Frosted Mint · Lemon Chiffon · Moss Green · Dusk Blue · Deep Space Blue |
| 미래풍 | 네온 시티 | Pale Sky · Sky Blue · Dusty Grape · Bone · Hot Fuchsia |
| 중세 | 보랏빛 성채 | Honeydew · Vanilla Custard · Periwinkle · Amethyst · Dark Ultramarine |
| 우주 | 성운 정거장 | Azure Mist · Icy Blue · Strong Cyan · Twilight Indigo · Ink Black |

## 비동기 처리 방식

- 모든 진행은 서버가 기준이고, 클라이언트는 이벤트를 받아 그리기만 한다.
- AI 답변은 `ai:chunk`로 조금씩, 평가는 `ai:judge`(읽는 시간) → `ai:result` 순서로 온다. 두 플레이어가 동시에 진행돼도 서로를 막지 않는다.
- 타이머는 서버 시각(`endsAt`) 기준으로 `requestAnimationFrame` 루프에서 계산한다.
- 연결이 끊기면 배너만 뜨고 자동 재연결. 서버는 20초 동안 자리를 유지하고, 새로고침해도 같은 게임(결과 화면 포함)으로 복귀한다.

## 소켓 이벤트

| 클라 → 서버 | 서버 → 클라 |
|---|---|
| `room:create` `room:join` `room:leave` `room:rematch` `room:addBot` | `room:state` (사람마다 따로 보내는 스냅샷) |
| `prompt:submit` `prompt:skip` | `ai:start` `ai:chunk` `ai:judge` `ai:result` `ai:void` |
| `player:typing` | `player:typing` |
| | `game:event` (얼음) `game:end` |

## 다음 할 일

- [x] 실제 판정 모듈(`promptRules.js`)과 문제 데이터 연결, Gemini 호출 코드
- [ ] Gemini 실호출 확인 (키·모델명·한도)
- [x] 건너뛰기(개인 건너뛰기) 구현
- [ ] 임의 매칭 (지금은 안내 토스트만)
- [ ] 랭크 / 재화 / 가챠

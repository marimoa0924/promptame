# 04. 실시간 프로토콜

## 1. 연결과 기본 규칙

- 연결: `ws://호스트/ws` 하나. 같은 포트에서 정적 파일도 서빙한다. [제안]
- 모든 메시지는 JSON 한 줄이고, 최대 8KB다. 넘으면 연결을 닫는다. [제안]
- 형식: `{ "t": "이벤트이름", ...데이터 }`. 서버가 보내는 메시지에는 항상 `ts`(서버 에포크 밀리초)가 들어간다. [확정]
- 클라이언트가 보내는 요청에는 선택적으로 `rid`(숫자)를 붙일 수 있고, 서버의 응답이나 오류에 같은 `rid`가 돌아온다. [제안]
- 서버가 기준이다. 타이머, 점수, 문제, 페널티, 선착은 서버가 정하고 클라이언트는 표시만 한다. [확정]
- 첫 메시지는 반드시 `hello`다. 그 전의 다른 메시지는 오류로 닫는다. [제안]
- 방 입장은 코드 입장 하나다. 임의 매칭을 나중에 붙일 때도 서버 안에서 `joinRoomByCode(code)`를 호출하는 입구를 재사용한다. [확정]

## 2. 공통 데이터 형식

```js
// Problem: problems.json의 한 항목 그대로
{ id: 22, topic: "미토콘드리아", keywords: ["세포호흡","에너지","ATP"],
  difficulty: "보통", category: "과학", extraForbidden: ["mitochondria", ...] }

// LengthRule: problems.json의 lengthRules 항목
{ name: "2문장 이내", type: "sentences", value: 2 }   // type: "chars" | "sentences"

// Settings
{ title: "우리방", difficulty: "쉬움"|"보통"|"어려움", durationSec: 120|180|300,
  promptLimit: 50|100|150|300|null, map: "eastern" }

// Verdict: checkAnswer 결과에 truncated와 reasons를 더한 것
{ pass: true, keywordOk: true, lengthOk: true, truncated: false,
  matched: ["세포호흡","ATP"], needed: 2,
  length: { type: "sentences", limit: 2, actual: 2 },
  reasons: [] }          // 실패 이유: "KEYWORD_SHORT" | "LENGTH_OVER" | "TRUNCATED" | "EMPTY"

// PlayerPublic
{ playerId: "p_xxx", nickname: "고양이집사", characterId: "cat"|"pigeon"|"dog"|"otaku",
  ready: false, connected: true }
```

- 서버는 클라이언트가 보낸 문제나 설정 값을 믿지 않고 항상 서버 메모리의 값으로 검사한다. [확정]
- `Problem`에는 `extraForbidden`이 들어 있어 클라이언트가 같은 규칙으로 금지어를 검사할 수 있다. 현재 문제 하나만 보내고 다음 문제는 미리 보내지 않는다. [확정]

## 3. 클라이언트에서 서버로

| 이벤트 | 데이터 | 언제 | 단계 |
|---|---|---|---|
| `hello` | `{ v: 1, playerId?, resumeToken?, nickname? }` | 접속 직후 | P0 |
| `profile:set` | `{ nickname?, characterId? }` | 닉네임이나 캐릭터 변경 | P0/P1 |
| `room:create` | `Settings` | 방 만들기 | P0 |
| `room:join` | `{ code }` | 코드 입장 | P0 |
| `room:settings` | `Settings` | 호스트가 대기방에서 설정 변경 | P0 |
| `room:ready` | `{ ready: boolean }` | 게스트 준비 | P0 |
| `room:leave` | `{}` | 대기방 나가기 | P0 |
| `game:start` | `{}` | 호스트 시작 | P0 |
| `prompt:submit` | `{ seq, text }` | 프롬프트 전송 | P0 |
| `skip:set` | `{ seq, on: boolean }` | 건너뛰기 누름/취소 | P1 |
| `emote:send` | `{ emoteId }` | 이모지 | P1 |
| `game:forfeit` | `{}` | 포기 확인 예 | P0 |
| `rematch:request` | `{}` | 한 번 더 하기 | P1 |
| `rematch:respond` | `{ accept: boolean }` | 요청 응답 | P1 |
| `status:typing` | `{ on: boolean }` | 입력 중 표시(1초에 1번 이하) | P1 |
| `ping` | `{ c }` | 5초마다 | P0 |

## 4. 서버에서 클라이언트로

| 이벤트 | 데이터 | 받는 사람 | 단계 |
|---|---|---|---|
| `hello:ok` | `{ playerId, resumeToken, profile }` | 본인 | P0 |
| `pong` | `{ c, s }` | 본인 | P0 |
| `error` | `{ code, message?, rid? }` | 본인 | P0 |
| `room:state` | `{ room: { code, status, settings, hostId, players: PlayerPublic[] } }` | 방 전체 | P0 |
| `room:closed` | `{ reason }` | 방 전체 | P0 |
| `game:countdown` | `{ startsAt, seconds: 3 }` | 방 전체 | P0 |
| `game:begin` | `{ endsAt }` | 방 전체 | P0 |
| `problem:new` | `{ seq, problem, lengthRule, opensAt, lockedUntil? }` | 방 전체. `lockedUntil`은 페널티 걸린 사람에게만 | P0 |
| `prompt:rejected` | `{ seq, code, detail? }` | 전송한 사람 | P0 |
| `attempt:accepted` | `{ seq, attemptId, attemptNo }` | 전송한 사람 | P0 |
| `ai:retrying` | `{ seq, attemptId, n }` | 전송한 사람 | P0 |
| `attempt:void` | `{ seq, attemptId }` | 전송한 사람 | P0 |
| `answer:ready` | `{ seq, attemptId, text, verdict, present: { typeCps, readMs } }` | 전송한 사람 | P0 |
| `opponent:answer` | `{ seq, attemptNo, text, verdict, present }` (프롬프트는 없음) | 상대 | P0 |
| `opponent:status` | `{ state: "IDLE"|"TYPING"|"WAITING_AI"|"REVEALING"|"LOCKED" }` | 상대 | P1 |
| `problem:cancelled` | `{ seq, reason: "OPPONENT_PASSED" }` | 진행 중이던 쪽 | P0 |
| `problem:resolved` | `{ seq, outcome: "PASS"|"SKIP", winnerId?, firstTry, scores, streaks, revealAfterMs }` | 방 전체 | P0 |
| `skip:state` | `{ seq, votes: { [playerId]: boolean } }` | 방 전체 | P1 |
| `penalty:start` | `{ targetId, seconds: 5, startsAt, endsAt }` | 방 전체 | P0 |
| `emote` | `{ from, emoteId }` | 방 전체 | P1 |
| `conn:peer` | `{ playerId, connected, graceEndsAt? }` | 상대 | P1 |
| `game:ended` | `{ reason: "TIMEUP"|"FORFEIT"|"DISCONNECT"|"ABORTED", winnerId: string|null, scores, durationMs, history }` | 방 전체 | P0 |
| `rematch:state` | `{ requestedBy, expiresAt }` | 방 전체 | P1 |
| `rematch:result` | `{ accepted }` | 방 전체 | P1 |

- `history`는 문제별 두 사람의 프롬프트와 AI 답변, 판정이다. 이 시점에서야 상대 프롬프트가 공개된다. [제안]
- 방 전체에 보내는 이벤트도 문제 번호 `seq`가 현재와 다르면 클라이언트는 무시한다. [제안]

## 5. 오류 코드

| 코드 | 뜻 |
|---|---|
| `BAD_MESSAGE` | 형식이 잘못됨 |
| `NOT_HELLO` | `hello` 전에 다른 메시지를 보냄 |
| `NICK_INVALID` | 닉네임 길이 또는 금칙어 |
| `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_STARTED` | 입장 실패 |
| `NOT_HOST` | 호스트만 가능한 요청 |
| `NOT_PLAYING` | 게임 중이 아님 |
| `EMPTY`, `TOO_LONG`, `FORBIDDEN` | `checkPrompt` 결과 코드를 그대로 쓴다 |
| `LOCKED` | 페널티 중 |
| `BUSY` | 이미 처리 중인 전송이 있음 |
| `STALE` | 이미 끝난 문제 번호 |
| `RATE_LIMIT` | 요청이 너무 잦음 |

[확정] `EMPTY`, `TOO_LONG`, `FORBIDDEN`과 방 입장 오류 세 개. [제안] 나머지.

## 6. 시간 동기화

- 클라이언트는 5초마다 `ping { c: 클라이언트시각 }`을 보내고 `pong { c, s }`를 받아 `오프셋 = s - (c + 왕복/2)`를 계산한다. 이 오프셋으로 `serverNow()`를 구하고, 시간 바와 카운트다운은 `endsAt - serverNow()`로 그린다. [제안]
- 시간 값은 항상 서버 에포크 밀리초 절대값이다. 남은 시간을 보내지 않는다(전송 지연 때문에). [제안]
- 클라이언트가 자기 시계를 근거로 판정하거나 종료를 결정하지 않는다. [확정]

## 7. 판정과 연출이 어긋나지 않게 하는 약속

1. 판정은 서버가 AI 답변을 받자마자 `checkAnswer`로 확정한다. [확정]
2. `answer:ready`에는 답변 전문, 판정 전체, 연출 시간(`typeCps`, `readMs`)이 한 번에 들어 있다. 클라이언트가 따로 판정을 계산하지 않는다. [확정]
3. 연출 순서는 답변 재생, 평가 읽기, 결과 공개다. 결과 공개의 종류(PASS 검은 화면, RETRY 블루스크린)는 `verdict.pass`로만 정한다. [확정]
4. PASS가 선착으로 확정되면 서버가 `problem:resolved`를 보내고 `revealAfterMs`(재생 + 읽기 시간)가 지난 뒤에 클라이언트가 점수를 갱신해서 보여 준다. 연출 전에 점수가 먼저 올라가지 않는다. [제안]
5. 상대는 `opponent:answer`로 같은 `verdict`와 `present`를 받아 같은 연출을 보되, 입력은 잠긴다. [제안]
6. 서버는 다음 문제(`problem:new`)를 `problem:resolved` 이후 `revealAfterMs + RESULT_HOLD_MS`가 지나서 보낸다. [제안]

## 8. 흐름 예시

### 8.1 방 만들기에서 시작까지 [제안]
```
A -> hello
S -> A hello:ok
A -> room:create {...settings}
S -> A room:state {code:"K7M3QX", status:"WAITING"}
B -> hello, room:join {code:"K7M3QX"}
S -> A,B room:state {players:[A,B]}
B -> room:ready {ready:true}
A -> game:start
S -> A,B game:countdown {startsAt, seconds:3}
S -> A,B game:begin {endsAt}
S -> A,B problem:new {seq:1, problem, lengthRule, opensAt}
```

### 8.2 한 문제: A가 먼저 PASS [제안]
```
A -> prompt:submit {seq:1, text}
S -> A attempt:accepted
S: Gemini 호출, checkAnswer -> PASS (선착 확정)
S -> A answer:ready {verdict:{pass:true}, present}
S -> B opponent:answer {...}
S -> B problem:cancelled {seq:1, reason:"OPPONENT_PASSED"}
S -> A,B problem:resolved {outcome:"PASS", winnerId:A, scores:{A:1,B:0}, revealAfterMs}
(연출 시간과 1초 뒤)
S -> A,B problem:new {seq:2, ...}
```

### 8.3 RETRY [제안]
```
A -> prompt:submit
S -> A answer:ready {verdict:{pass:false, reasons:["KEYWORD_SHORT"]}}
S -> B opponent:answer {...}
(문제는 계속 열려 있고 A는 다시 전송할 수 있음)
```

### 8.4 3연속 [제안]
```
S -> A,B problem:resolved {winnerId:A, streaks:{A:3,B:0}}
S -> A,B penalty:start {targetId:B, seconds:5, startsAt:다음 문제 opensAt, endsAt:+5000}
S -> A,B problem:new {...}
```

## 9. 재접속

- `hello`에 `playerId`와 `resumeToken`을 넣어 다시 접속하면 서버가 기존 접속을 대체하고 스냅샷을 보낸다. [제안]
- 스냅샷은 `room:state`에 `game` 부분을 더한 것이다. [제안]

```js
game: { phase: "OPEN"|"RESOLVING"|"INTERMISSION", seq, problem, lengthRule, endsAt,
        scores, streaks, skipVotes, lockedUntil, myAttempts: [...], lastOpponentAnswer, ts }
```

- 허용 시간은 20초(대기방에서는 60초)다. 상대에게는 `conn:peer { connected:false, graceEndsAt }`를 보낸다. [제안]
- 끊겨 있는 동안 타이머는 멈추지 않는다. 그 사이 끝난 요청의 결과는 서버가 보관했다가 복귀 시 스냅샷에 담는다. [제안]
- 20초를 넘기면 서버가 부전패로 처리하고 `game:ended { reason:"DISCONNECT" }`를 보낸다. [제안]
- 서버가 다시 켜져 방이 사라졌으면 `error { code:"ROOM_NOT_FOUND" }`와 함께 로비로 보낸다. [제안]

## 10. 서버 처리 순서(전송 기준) [제안]

1. 방과 게임 상태, 문제 번호(`seq`), 페널티, 진행 중 요청 여부를 확인한다. 실패하면 `NOT_PLAYING`, `STALE`, `LOCKED`, `BUSY`.
2. 전송 최소 간격(1초)을 확인한다. 실패하면 `RATE_LIMIT`.
3. `checkPrompt(text, 서버의 현재 문제, 방 설정의 프롬프트 제한 ?? 2000)`를 한다. 실패하면 `prompt:rejected`. Gemini 호출 없음.
4. 통과하면 시도 번호를 올리고 `attempt:accepted`를 보낸다.
5. Gemini를 호출한다(06 문서). 실패나 빈 응답은 재시도한다.
6. 답변이 오면 `checkAnswer`로 판정한다. 그 사이 이 문제가 끝났거나 종료 유예를 넘겼다면 결과는 버린다.
7. PASS면 선착 처리, 점수와 연속 카운트, 페널티를 갱신한다. RETRY면 연속 카운트의 첫 시도 조건을 깨고 판정을 보낸다.

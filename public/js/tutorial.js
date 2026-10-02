// 튜토리얼: 하이라이트 박스로 눌러야 할 곳을 짚어 주는 코치.
// 각 단계는 target(강조할 요소)과 text, 그리고 넘어가는 조건(waitFor 이벤트 또는 '다음' 버튼)을 가진다.
import { $, refs } from './ui.js';

export const EXAMPLE_PROMPT = '나는 어린 아이들을 가르치는 교사야. 식물이 햇빛으로 에너지를 만드는 과정을 간결하고 짧게 설명해줘';

export const LOBBY_STEPS = [
  {
    target: '#char-grid',
    text: '반가워요! 먼저 <b>내 옷장</b>에서 함께할 캐릭터를 골라 주세요.',
    waitFor: 'char',
    next: '건너뛰기',
  },
  {
    target: '.panel-start',
    text: '실전에서는 여기서 <b>방을 만들거나</b> 친구에게 받은 <b>방 코드</b>로 입장해요.<br>지금은 혼자 연습해 볼게요!',
    next: '연습 시작',
  },
];

export const GAME_STEPS = [
  {
    target: '.board.me .topic-card',
    text: '<b>주제문 룰렛</b>이에요. AI 답변에 <b>필수 키워드</b>가 충분히 담기고 <b>분량</b>을 지키면 PASS!',
  },
  {
    target: '.board.me .banned',
    text: '단, 이 단어들은 프롬프트에 <b>직접 쓰면 안 돼요</b>. 돌려 말하는 게 핵심!',
  },
  {
    target: '.board.me .prompt-box',
    text: '상황과 근거를 구체적으로 말할수록 AI가 잘 알아들어요. 직접 써 보거나 예시를 넣어 <b>보내기</b>를 눌러 보세요.',
    waitFor: 'submitted',
    action: 'example',
  },
  {
    target: '.board.me .frame',
    text: '내 캐릭터가 말풍선으로 AI 답변을 한 글자씩 말하고, 끝나면 <b>평가 AI</b>가 형광펜으로 한 줄씩 읽으며 채점해요. 같이 읽어 보세요!',
    waitFor: 'result',
  },
  {
    target: '.hud-center',
    text: '시간은 <b>체력바</b>처럼 줄어요. 10초 남으면 카운트다운! 시간 안에 더 많이 PASS한 쪽이 승리해요.',
  },
  {
    target: '#btn-exit',
    text: '실전에서 <b>3연속 원샷 PASS</b>를 하면 상대가 5초 동안 얼어요.<br>연습은 여기까지! <b>완료</b>를 누르면 로비로 돌아가서 몇 가지를 더 보여 드릴게요.',
    next: '완료',
  },
];

// 연습이 끝난 뒤 로비에서: 랭킹, 내 기록, 상점·뽑기는 안쪽 화면까지 열어서 보여 주고, 마지막에 고득점 팁을 권한다.
export const TOUR_STEPS = [
  {
    target: '#modal-ranking .modal-card',
    enter: 'ranking',
    text: '🏆 <b>랭킹</b> 화면이에요. 사람과 대전하면 승패에 따라 <b>랭크 점수(RP)</b>가 오르내리고, 위쪽 탭에서 <b>대전</b>과 <b>솔로</b> 기록을 오갈 수 있어요.',
    next: '다음',
  },
  {
    target: '#modal-profile .modal-card',
    enter: 'profile',
    text: '📊 <b>내 기록</b>에서는 내 성적과 최근 경기, 그리고 내가 프롬프트를 쓰는 <b>습관과 유형</b>을 분석해서 보여 줘요.',
    next: '다음',
  },
  {
    target: '#modal-shop .modal-card',
    enter: 'shop',
    text: '🪙 <b>상점·뽑기</b>에서는 경기로 번 코인으로 새 캐릭터를 사거나 뽑을 수 있어요. 모두 모으면 숨은 캐릭터도 열려요!',
    next: '다음',
  },
  {
    target: '#btn-tips',
    enter: 'closeAll',
    text: '점수를 더 높이고 싶다면 <b>🕊️ 고득점 팁</b>을 확인해 보세요! 비둘기 선생님이 잘 통하는 프롬프트 작성법을 알려 줘요.',
    next: '완료',
  },
];

class Coach {
  constructor() {
    this.hole = $('#coach-hole');
    this.tip = $('#coach-tip');
    this.r = refs(this.tip);
    this.steps = [];
    this.i = -1;
    this.actions = {};
    this.r.next.addEventListener('click', () => this.next());
    this.r.quit.addEventListener('click', () => this.stop());
    this.r.action.addEventListener('click', () => this.actions[this.step?.action]?.());
    this.loop = this.loop.bind(this);
    // 안쪽 영역을 스크롤할 때도 박스가 바로 따라오도록 스크롤 이벤트에서 즉시 다시 맞춘다
    addEventListener('scroll', () => this.active && this.place(), { capture: true, passive: true });
  }

  get active() {
    return this.i >= 0;
  }

  get step() {
    return this.steps[this.i];
  }

  run(steps, { onDone, onEnd, actions = {} } = {}) {
    const looping = this.active;
    this.steps = steps;
    this.onDone = onDone;
    this.onEnd = onEnd;
    this.actions = actions;
    this.i = -1;
    this.next();
    if (!looping) requestAnimationFrame(this.loop);
  }

  next() {
    this.i += 1;
    if (this.i >= this.steps.length) {
      const done = this.onDone;
      this.stop();
      done?.();
      return;
    }
    const s = this.step;
    this.r.step.textContent = `튜토리얼 ${this.i + 1} / ${this.steps.length}`;
    this.r.text.innerHTML = s.text;
    this.r.next.hidden = !!s.waitFor && !s.next;
    this.r.next.textContent = s.next ?? '다음';
    this.r.action.hidden = !s.action;
    this.r.action.textContent = s.action === 'example' ? '✎ 예시 넣기' : '';
    this.hole.hidden = this.tip.hidden = false;
    if (s.enter) this.actions[s.enter]?.();
    this.hole.classList.add('glide');
    this.place();
    clearTimeout(this.glideTimer);
    this.glideTimer = setTimeout(() => this.hole.classList.remove('glide'), 260);
  }

  // 게임/로비에서 일어난 일을 알려 주면, 기다리던 단계면 넘어간다
  emit(event) {
    if (this.active && this.step.waitFor === event) this.next();
  }

  stop() {
    const end = this.onEnd;
    this.onEnd = null;
    this.i = -1;
    this.steps = [];
    this.hole.hidden = this.tip.hidden = true;
    end?.(); // 끝나거나 중간에 그만둘 때 정리(열어 둔 창 닫기 등)
  }

  loop() {
    if (!this.active) return;
    this.place();
    requestAnimationFrame(this.loop);
  }

  // 여러 요소를 가리키면 전부 감싸는 하나의 박스로 강조한다
  targetRect() {
    const sels = [].concat(this.step?.target ?? []);
    const rects = sels
      .flatMap((sel) => [...document.querySelectorAll(sel)])
      .filter((el) => el.getClientRects().length)
      .map((el) => el.getBoundingClientRect());
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  place() {
    const r = this.targetRect();
    const tip = this.tip;
    const pad = 8;
    if (!r) {
      this.hole.style.cssText = 'left:50%;top:50%;width:0;height:0';
      tip.style.left = `${Math.max(16, (innerWidth - tip.offsetWidth) / 2)}px`;
      tip.style.top = `${Math.max(16, (innerHeight - tip.offsetHeight) / 2)}px`;
      return;
    }
    Object.assign(this.hole.style, {
      left: `${r.left - pad}px`,
      top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const below = r.bottom + pad + 14;
    const top = below + th < innerHeight - 8 ? below : Math.max(8, r.top - pad - 14 - th);
    const left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), innerWidth - tw - 8);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
}

export const coach = new Coach();

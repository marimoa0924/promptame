// 고득점 팁: 비둘기가 프롬프트 작성 방법을 한 장씩 알려 주는 튜토리얼. 분석 화면의 "자주 쓰는 방법", "틀린 이유"와 같은 항목을 다룬다.
// 예시 문장은 주제어·필수어를 직접 말하지 않고, 분량을 숫자로 정하지도 않는다(게임 규칙 그대로).
import { $, refs, charSvg } from './ui.js';

const pct = (x) => `${Math.round(x * 100)}%`;

const SLIDES = [
  {
    key: 'intro', icon: '🕊️', title: '고득점의 비밀',
    say: '구구! 나는 비둘기 선생이야. 이 게임은 주제와 필수 키워드를 직접 말하지 않고, AI가 스스로 그 낱말을 꺼내게 만드는 게임이지. 딱 8가지 방법과 실패 이유 2가지만 알면 훨씬 잘할 수 있어!',
    tip: '넘겨 보면서 하나씩 익혀 봐. 방향키(← →)로도 넘어가!',
  },
  {
    key: 'role', icon: '🎭', title: '역할·상황 설정',
    say: 'AI에게 "누구로서 말해 줘"라고 먼저 역할을 주는 방법이야. 상황이 정해지면 AI가 그 분위기에 맞는 낱말을 골라 써 줘.',
    good: '너는 이 분야를 오래 가르친 선생님이야. 처음 배우는 친구에게 설명해 주는 상황이야.',
    bad: '설명해줘',
    note: '역할만 길게 쓰지 말고, 한 줄로 끝내야 글자 제한에 안 걸려요.',
  },
  {
    key: 'audience', icon: '👶', title: '듣는 사람 지정',
    say: '"누구에게 설명하는지"를 말해 주면 AI가 눈높이를 맞춰서 쉬운 대표 낱말을 써 줘. 필수어는 보통 쉬운 대표 낱말이니까 잘 맞아!',
    good: '초등학생도 알아듣게 쉬운 말로 알려줘.',
    bad: '어렵게 알려줘',
    note: '"쉽게", "아이들에게", "처음 보는 사람에게"가 대표적인 표현이에요.',
  },
  {
    key: 'brevity', icon: '✂️', title: '짧게 요청',
    say: '분량 조건을 못 맞추면 RETRY야. 하지만 "몇 자 이내"처럼 숫자로 정하는 건 금지! 대신 "핵심만 짧게"라고 말하면 AI가 알아서 줄여 줘.',
    good: '핵심만 간단하게 알려줘.',
    bad: '100자 이내로 알려줘  (← 숫자는 금지!)',
    note: '분량 초과로 자주 틀린다면 이 방법이 가장 먼저예요.',
  },
  {
    key: 'example', icon: '🍎', title: '비유·예시 요청',
    say: '비유나 예를 들어 달라고 하면 AI가 구체적인 낱말을 줄줄이 늘어놓아. 필수어가 그 사이에 섞여 나올 확률이 확 올라가!',
    good: '일상 속 물건에 빗대서 예를 들어 설명해줘.',
    bad: '그냥 말해줘',
    note: '주제어를 직접 쓰면 안 되니까, "빗대서"처럼 방식만 요청해요.',
  },
  {
    key: 'steps', icon: '🪜', title: '단계·순서 요청',
    say: '"먼저, 그다음, 마지막으로"처럼 순서대로 말하게 하면 AI가 과정에 나오는 낱말을 빠짐없이 늘어놓아. 과정이 있는 주제에 특히 좋아!',
    good: '처음부터 끝까지 순서대로 차근차근 설명해줘.',
    bad: '다 알려줘',
    note: '순서를 많이 요구하면 답이 길어져요. 분량이 짧은 문제에서는 조심해요.',
  },
  {
    key: 'context', icon: '🔍', title: '특징·과정 묘사',
    say: '이게 제일 강력해! 모양, 쓰임, 원리, 만드는 법처럼 "특징"을 말하라고 하면 필수어가 거기에 그대로 들어 있을 때가 많아. 주제어를 안 쓰고도 AI가 정답을 짐작하게 되거든.',
    good: '모양과 쓰임, 그리고 어떤 원리로 움직이는지 풀어서 설명해줘.',
    bad: '뭔지 말해줘',
    note: '필수어가 자주 모자란다면 이 방법부터 써 보세요.',
  },
  {
    key: 'question', icon: '❓', title: '질문형',
    say: '"왜", "어떻게", "어떤"으로 물으면 AI가 이유와 방법을 줄줄 대답해. 질문은 짧아서 글자 제한에도 강해!',
    good: '이것은 어떻게 생겼고 왜 쓰는지 알려줘?',
    bad: '이거',
    note: '질문 하나에 질문을 너무 여러 개 넣으면 AI 답이 길어져요.',
  },
  {
    key: 'structure', icon: '📋', title: '줄 나누기·목록',
    say: '요구 사항을 줄로 나누거나 번호를 붙여서 정리하면 AI가 헷갈리지 않아. 조건이 여러 개일 때 효과가 커!',
    good: '1. 생김새\n2. 쓰임새\n3. 특징\n이 세 가지를 짧게 알려줘.',
    bad: '생김새랑 쓰임새랑 특징이랑 이것저것 다 알려줘',
    note: '줄바꿈은 Shift+Enter로 넣을 수 있어요.',
  },
  {
    key: 'fail-keyword', icon: '🎯', title: '필수어가 부족할 때',
    say: 'AI 답에 필수어가 모자라면 RETRY야. 이유는 대부분 프롬프트가 너무 막연해서 AI가 다른 얘기를 한 것! 구체적인 특징을 요청하고, 필요한 만큼 필수어가 나오는지 확인해 봐.',
    good: '생김새, 쓰임새, 관련된 대표적인 낱말들을 구체적으로 알려줘.',
    bad: '재밌는 얘기 해줘',
    note: '난이도가 높을수록 필수어가 더 많이 필요해요. (쉬움·보통 1개 → 어려움 2개 → 매우 어려움 3개)',
  },
  {
    key: 'fail-length', icon: '📏', title: '분량이 넘칠 때',
    say: 'AI가 너무 길게 말하면 분량 초과로 RETRY야. 숫자 대신 "짧게", "핵심만", "한 문장 느낌으로"처럼 감으로 줄여 달라고 해 봐. 그리고 질문 개수도 줄이면 효과가 있어!',
    good: '가장 중요한 특징만 짧게 알려줘.',
    bad: '자세하게 길게 설명해줘',
    note: '숫자로 분량을 말하면 전송 자체가 막혀요.',
  },
  {
    key: 'outro', icon: '🏆', title: '마무리 한마디',
    say: '정리하면 "역할 한 줄 + 특징 요청 + 짧게!" 이 조합이 제일 안정적이야. 한 번에 PASS 3번이면 상대를 5초 얼릴 수 있으니까, 연속으로 도전해 봐! 구구, 파이팅!',
    tip: '막힐 땐 건너뛰기도 좋은 전략이에요. (3초 쉬고 다음 문제)',
  },
];

export function initTips() {
  const modal = $('#modal-tips');
  const r = refs(modal);
  let i = 0;
  let habit = null;

  r.pigeon.innerHTML = charSvg('pigeon', 'tip-pigeon-svg');

  function mine(slide) {
    const f = habit?.enough ? habit.features?.find((x) => x.key === slide.key) : null;
    if (f) {
      const cmp = f.withRate != null ? ` · 쓴 프롬프트 ${pct(f.withRate)} vs 안 쓴 프롬프트 ${pct(f.withoutRate)}` : '';
      return `📊 내 기록: 프롬프트의 ${pct(f.share)}에 사용${cmp}`;
    }
    if (habit?.enough && slide.key === 'fail-keyword') return `📊 내 기록: 틀린 답의 ${pct(habit.failure.keyword)}가 필수어 부족`;
    if (habit?.enough && slide.key === 'fail-length') return `📊 내 기록: 틀린 답의 ${pct(habit.failure.length)}가 분량 초과`;
    return '';
  }

  function render() {
    const s = SLIDES[i];
    r.step.textContent = `${i + 1} / ${SLIDES.length}`;
    r.title.textContent = `${s.icon} ${s.title}`;
    r.say.textContent = s.say;
    r.example.replaceChildren();
    if (s.good) {
      for (const [cls, label, text] of [['good', '✅ 이렇게 써 보세요', s.good], ['bad', '❌ 이런 건 아쉬워요', s.bad]]) {
        const row = Object.assign(document.createElement('div'), { className: `tip-ex ${cls}` });
        const b = Object.assign(document.createElement('b'), { textContent: label });
        const p = Object.assign(document.createElement('p'), { textContent: text });
        row.append(b, p);
        r.example.append(row);
      }
    }
    const note = s.note ?? s.tip ?? '';
    r.note.textContent = note ? `💡 ${note}` : '';
    r.mine.textContent = mine(s);
    r.mine.hidden = !r.mine.textContent;
    r.prev.disabled = i === 0;
    r.next.textContent = i === SLIDES.length - 1 ? '끝!' : '다음 ▶';
    r.dots.replaceChildren(...SLIDES.map((sl, n) => Object.assign(document.createElement('button'), { type: 'button', className: n === i ? 'on' : '', title: sl.title, onclick: () => { i = n; render(); } })));
    r.pigeon.classList.remove('hop');
    void r.pigeon.offsetWidth;
    r.pigeon.classList.add('hop');
  }

  const close = () => {
    modal.hidden = true;
    document.removeEventListener('keydown', onKey);
  };
  function go(d) {
    if (i + d >= SLIDES.length) return close();
    i = Math.max(0, i + d);
    render();
  }
  function onKey(e) {
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Escape') close();
  }
  r.prev.onclick = () => go(-1);
  r.next.onclick = () => go(1);
  r.close.onclick = close;
  modal.addEventListener('click', (e) => e.target === modal && close());

  // 분석 결과(habit)를 넘기면 슬라이드마다 내 기록도 함께 보여 준다
  return function open(habitInfo = null) {
    habit = habitInfo;
    i = 0;
    render();
    modal.hidden = false;
    document.addEventListener('keydown', onKey);
    r.next.focus();
  };
}

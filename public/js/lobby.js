import { session, request } from './net.js';
import { $, $$, CHARACTERS, charSvg, toast, replay } from './ui.js';
import { THEMES, MAP_IDS, applyTheme, sceneSvg } from './maps.js';
import { coach } from './tutorial.js';
import { checkNickname, nicknameError } from '/shared/nickname.js';
import { setAccount } from './auth.js';

export function initLobby({ onEnterRoom, onOpenShop }) {
  const nickname = $('#nickname');
  const grid = $('#char-grid');
  const picked = $('#char-picked');
  // 이름과 캐릭터는 로그인한 계정의 것이다(서버가 정한다). 여기 profile은 화면 표시용 사본이다.
  let profile = { name: '', char: 'cat', device: session.device };
  let account = null;

  nickname.addEventListener('input', () => {
    profile = { ...profile, name: nickname.value.trim() };
  });
  // 입력을 마치면 서버에 저장한다. 규칙에 안 맞으면 되돌린다.
  nickname.addEventListener('change', async () => {
    if (!account || nickname.value.trim() === account.nickname) return;
    const res = await request('account:update', { nickname: nickname.value.trim() });
    if (!res.ok) {
      toast(res.error, 'error');
      nickname.value = account.nickname;
      profile = { ...profile, name: account.nickname };
      return;
    }
    setAccount(res.account); // 계정 상태가 바뀌면 로비 화면(applyAccount)과 상단 계정 표시가 함께 갱신된다
    toast('닉네임을 바꿨어요', 'ok', 1800);
  });

  // 내 옷장: 캐릭터 선택
  const renderChars = () => {
    grid.replaceChildren(
      ...Object.entries(CHARACTERS).map(([id, c]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const locked = !!account && !account.owned.includes(id);
        btn.className = `char-tile${profile.char === id ? ' on' : ''}${locked ? ' locked' : ''}`;
        btn.innerHTML = `<span class="char-icon">${charSvg(id)}</span><span class="char-name">${c.name}</span>${locked ? '<span class="char-lock">🔒</span>' : ''}`;
        btn.addEventListener('click', async () => {
          if (locked) {
            toast('아직 없는 캐릭터예요. 상점이나 뽑기에서 얻을 수 있어요', 'info', 2200);
            return onOpenShop?.();
          }
          const res = await request('account:update', { char: id });
          if (!res.ok) return toast(res.error, 'error');
          setAccount(res.account); // 계정 상태가 바뀌면 로비 화면(applyAccount)과 상단 계정 표시가 함께 갱신된다
          picked.textContent = `✦ ${c.name} 선택 완료!`;
          replay(picked, 'pop');
          coach.emit('char');
        });
        return btn;
      }),
    );
  };
  renderChars();

  // 로그인했거나 계정 정보가 바뀌었을 때 호출된다(상점에서 캐릭터를 얻은 뒤 등)
  function applyAccount(acc) {
    account = acc;
    if (!acc) return;
    profile = { name: acc.nickname, char: acc.char, device: session.device };
    nickname.value = acc.nickname;
    renderChars();
  }

  // 맵 선택: 각 카드가 자기 테마 색으로 무대 미리보기를 그린다(방 만들기와 솔로 양쪽에)
  const fillMaps = (container) =>
    container.replaceChildren(
      ...MAP_IDS.map((id, i) => {
        const t = THEMES[id];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.value = id;
        btn.className = `map-chip${i === 0 ? ' on' : ''}`;
        btn.innerHTML = `<span class="map-thumb">${sceneSvg(id)}</span><span class="map-name">${t.name}</span><span class="map-sub">${t.sub}</span>`;
        applyTheme(btn, id);
        return btn;
      }),
    );
  fillMaps($('#map-chips'));
  fillMaps($('#solo-map-chips'));

  // 서버에 API 키가 있는 AI만 고를 수 있다. 키가 하나도 없으면 목 AI로 진행한다는 안내만 보여 준다.
  function applyProviders(info = [], defaultAi = 'mock') {
    const any = info.some((p) => p.ok);
    for (const group of $$('.chips[data-name=ai]')) {
      if (!any) {
        group.replaceChildren(Object.assign(document.createElement('span'), { className: 'muted', textContent: '목 AI (서버에 API 키가 없어요)' }));
        continue;
      }
      for (const btn of $$('button', group)) {
        const p = info.find((x) => x.id === btn.dataset.value);
        btn.disabled = !p?.ok;
        btn.title = p?.ok ? `${p.label} · ${p.model}` : `${p?.label ?? btn.textContent}: 서버에 API 키가 없어요`;
        btn.classList.toggle('on', p?.ok && p.id === defaultAi);
      }
    }
  }

  // 탭
  for (const tab of $$('.tab')) {
    tab.addEventListener('click', () => {
      for (const t of $$('.tab')) t.classList.toggle('active', t === tab);
      for (const body of $$('.tab-body')) body.hidden = body.dataset.body !== tab.dataset.tab;
    });
  }

  $('#btn-random').addEventListener('click', () => toast('임의 매칭은 준비 중이에요! 방 코드로 친구와 붙어 보세요'));

  // 칩 선택
  for (const group of $$('.chips')) {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-value]');
      if (!btn || btn.disabled) return;
      for (const b of $$('button', group)) b.classList.toggle('on', b === btn);
    });
  }

  const readSettings = (form) => {
    const settings = { title: form.title?.value ?? '' };
    for (const group of $$('.chips', form)) settings[group.dataset.name] = $('.on', group)?.dataset.value;
    return settings;
  };

  const withBusy = async (form, fn) => {
    const btn = $('button[type=submit]', form);
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await fn();
    } finally {
      btn.disabled = false;
    }
  };

  // 비어 있으면 서버가 기본 이름을 붙이고, 적었다면 2~8자와 금칙어 규칙을 미리 확인한다
  const nameOk = () => {
    if (!profile.name) return true;
    const nick = checkNickname(profile.name);
    if (!nick.ok) toast(nicknameError(nick.code), 'error');
    return nick.ok;
  };

  $('#form-create').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!nameOk()) return;
    withBusy(e.currentTarget, async () => {
      const res = await request('room:create', {
        playerId: session.playerId,
        profile,
        settings: readSettings(e.currentTarget),
      });
      if (!res.ok) return toast(res.error, 'error');
      onEnterRoom(res.room);
    });
  });

  // 솔로: 상대 없이 혼자 시작한다. 방은 만들어지지만 코드로 들어올 사람은 없다.
  $('#form-solo').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!nameOk()) return;
    withBusy(e.currentTarget, async () => {
      const res = await request('room:create', {
        playerId: session.playerId,
        profile,
        settings: { ...readSettings(e.currentTarget), title: '솔로 플레이', solo: true },
      });
      if (!res.ok) return toast(res.error, 'error');
      onEnterRoom(res.room);
    });
  });

  $('#form-join').addEventListener('submit', (e) => {
    e.preventDefault();
    // 복사해 온 코드에 섞인 공백·하이픈 등은 떼고 읽는다
    const code = e.currentTarget.code.value.replace(/[^0-9a-z]/gi, '').toUpperCase();
    if (!code) return toast('방 코드를 입력해 주세요', 'error');
    if (!nameOk()) return;
    withBusy(e.currentTarget, async () => {
      const res = await request('room:join', { playerId: session.playerId, profile, code });
      if (!res.ok) return toast(res.error, 'error');
      onEnterRoom(res.room);
    });
  });

  return {
    applyAccount,
    applyProviders,
    selectedMap: () => $('#map-chips .on')?.dataset.value ?? 'east',
    profile: () => profile,
  };
}

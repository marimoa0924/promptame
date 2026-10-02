import { session, request } from './net.js';
import { $, $$, CHARACTERS, charSvg, toast, replay } from './ui.js';
import { THEMES, MAP_IDS, applyTheme, sceneSvg } from './maps.js';
import { coach } from './tutorial.js';

export function initLobby({ onEnterRoom }) {
  const nickname = $('#nickname');
  const grid = $('#char-grid');
  const picked = $('#char-picked');
  let profile = session.profile;

  const save = () => (session.profile = profile);

  nickname.value = profile.name;
  nickname.addEventListener('input', () => {
    profile = { ...profile, name: nickname.value.trim() };
    save();
  });

  // 내 옷장: 캐릭터 선택
  const renderChars = () => {
    grid.replaceChildren(
      ...Object.entries(CHARACTERS).map(([id, c]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `char-tile${profile.char === id ? ' on' : ''}`;
        btn.innerHTML = `<span class="char-icon">${charSvg(id)}</span><span class="char-name">${c.name}</span>`;
        btn.addEventListener('click', () => {
          profile = { ...profile, char: id };
          save();
          renderChars();
          picked.textContent = `✦ ${c.name} 선택 완료!`;
          replay(picked, 'pop');
          coach.emit('char');
        });
        return btn;
      }),
    );
  };
  renderChars();

  // 맵 선택: 각 카드가 자기 테마 색으로 무대 미리보기를 그린다
  $('#map-chips').replaceChildren(
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
    const settings = { title: form.title.value };
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

  $('#form-create').addEventListener('submit', (e) => {
    e.preventDefault();
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

  $('#form-join').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = e.currentTarget.code.value.trim().toUpperCase();
    if (!code) return toast('방 코드를 입력해 주세요', 'error');
    withBusy(e.currentTarget, async () => {
      const res = await request('room:join', { playerId: session.playerId, profile, code });
      if (!res.ok) return toast(res.error, 'error');
      onEnterRoom(res.room);
    });
  });

  return {
    selectedMap: () => $('#map-chips .on')?.dataset.value ?? 'east',
    profile: () => profile,
  };
}

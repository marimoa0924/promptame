// 상점과 뽑기: 경기에서 번 재화로 캐릭터를 얻는다. 가격, 확률, 지급은 모두 서버가 정한다.
import { request } from './net.js';
import { $, refs, toast, CHARACTERS, charSvg } from './ui.js';
import { state, setAccount } from './auth.js';
import { playGacha } from './gacha.js';

const BUY_PRICE = 120; // 서버(game/accounts.js ECON)와 같은 값. 표시용이고, 실제 검사는 서버가 한다.
const GACHA_PRICE = 50;
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls ?? '', textContent: text ?? '' });

export function initShop() {
  const modal = $('#modal-shop');
  const r = refs(modal);

  function render() {
    const acc = state.account;
    if (!acc) return;
    r.coins.textContent = `🪙 ${acc.coins}`;
    const locked = Object.keys(CHARACTERS).filter((id) => !acc.owned.includes(id));
    r.gacha.disabled = !locked.length || acc.coins < GACHA_PRICE;
    r.gacha.textContent = locked.length ? `🎲 뽑기 ${GACHA_PRICE}🪙` : '모두 모았어요!';
    r.odds.textContent = locked.length ? `아직 없는 캐릭터 ${locked.length}종 중에서 같은 확률(각 ${(100 / locked.length).toFixed(1)}%)로 하나가 나와요. 이미 가진 캐릭터는 나오지 않아요.` : '';
    r.grid.replaceChildren();
    for (const [id, c] of Object.entries(CHARACTERS)) {
      const owned = acc.owned.includes(id);
      const card = el('div', `shop-card${owned ? ' owned' : ''}`);
      card.append(Object.assign(el('span', 'char-icon'), { innerHTML: charSvg(id) }), el('span', 'char-name', c.name));
      if (owned) card.append(el('span', 'shop-own', acc.char === id ? '사용 중' : '보유'));
      else {
        const buy = el('button', 'btn btn-primary', `${BUY_PRICE}🪙 구매`);
        buy.disabled = acc.coins < BUY_PRICE;
        buy.addEventListener('click', async () => {
          buy.disabled = true;
          const res = await request('shop:buy', { char: id });
          if (!res.ok) {
            toast(res.error, 'error');
            return render();
          }
          setAccount(res.account);
          toast(`${c.name}을(를) 얻었어요!`, 'ok');
          render();
        });
        card.append(buy);
      }
      r.grid.append(card);
    }
  }

  async function pull() {
    r.gacha.disabled = true;
    const res = await request('shop:gacha');
    if (!res.ok) {
      toast(res.error, 'error');
      return render();
    }
    setAccount(res.account);
    await playGacha(r.reveal, res.char, { total: Object.keys(CHARACTERS).length, owned: res.account.owned });
    render();
  }

  function open() {
    modal.hidden = false;
    r.reveal.hidden = true;
    render();
  }

  r.gacha.addEventListener('click', pull);
  r.close.addEventListener('click', () => (modal.hidden = true));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
  $('#btn-shop').addEventListener('click', open);
  return { open, render };
}

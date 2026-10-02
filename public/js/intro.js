// 로그인 뒤 로비로 넘어가기 전에 게임 이름만 잠깐 보여 주는 인트로. 누르면 바로 넘어간다.
import { $, showScreen } from './ui.js';

const SHOW_MS = 2200;
const LEAVE_MS = 350;

export function playIntro() {
  const screen = $('#screen-intro');
  screen.classList.remove('leaving');
  showScreen('screen-intro');
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      screen.removeEventListener('click', finish);
      screen.classList.add('leaving');
      setTimeout(resolve, LEAVE_MS);
    };
    const timer = setTimeout(finish, SHOW_MS);
    screen.addEventListener('click', finish);
  });
}

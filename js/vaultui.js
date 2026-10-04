// The passphrase screen shown before anything is loaded when encryption is on.
import * as vault from './vault.js';

const $ = (s) => document.querySelector(s);
const root = document.documentElement;

/** Resolves once the right passphrase has been typed. `onForgot` wipes this phone's copy (the sheet is untouched). */
export function promptUnlock({ onForgot }) {
  return new Promise((resolve) => {
    const form = $('#lockPass');
    const input = $('#vaultInput');
    const btn = $('#vaultBtn');
    const reset = $('#lockReset');
    const say = (t) => { $('#lockSub').textContent = t; };
    let fails = 0;
    let until = 0;
    try { until = Number(localStorage.getItem('el_vault_until')) || 0; } catch (e) { /* ignore */ }

    root.classList.add('locked');
    root.classList.remove('cover');
    $('#lockBio').hidden = true;
    $('#lockPin').hidden = true;
    form.hidden = false;
    $('#lockTitle').textContent = 'Enter passphrase';
    say(Date.now() < until ? `Try again in ${Math.ceil((until - Date.now()) / 1000)} seconds` : 'Your data is encrypted on this phone');

    const forget = () => {
      if (confirm('Forgot the passphrase?\n\nThe only way in is to wipe this phone’s copy and reconnect. Your Google Sheet is untouched. Anything not yet uploaded from this phone is lost.')) onForgot();
    };
    reset.addEventListener('click', forget);

    const done = () => {
      reset.removeEventListener('click', forget);
      form.removeEventListener('submit', submit);
      form.hidden = true;
      root.classList.remove('locked');
      try { localStorage.removeItem('el_vault_until'); } catch (e) { /* ignore */ }
      resolve();
    };

    async function submit(e) {
      e.preventDefault();
      if (Date.now() < until) { say(`Try again in ${Math.ceil((until - Date.now()) / 1000)} seconds`); return; }
      if (!input.value) return;
      btn.disabled = true;
      input.disabled = true;
      say('Unlocking…');
      try {
        await vault.open(input.value);
        input.value = '';
        done();
      } catch (err) {
        fails++;
        input.value = '';
        btn.disabled = false;
        input.disabled = false;
        input.focus();
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
        if (fails >= 3) {
          until = Date.now() + Math.min(60000, 2000 * Math.pow(2, fails - 3));
          try { localStorage.setItem('el_vault_until', String(until)); } catch (e2) { /* ignore */ }
          say(`Wrong passphrase. Wait ${Math.ceil((until - Date.now()) / 1000)} seconds`);
        } else say('Wrong passphrase. Try again');
      }
    }
    form.addEventListener('submit', submit);
    setTimeout(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 300);
  });
}

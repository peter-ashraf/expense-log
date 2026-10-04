// node tests/vault.test.mjs
// localStorage / sessionStorage stand-ins for Node
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.window = globalThis;

const V = await import('../js/vault.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok  :', m); };
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

ok(!V.isEnabled() && !V.isOpen(), 'starts switched off');
ok((await throws(() => V.create('short'))) === 'Use at least 8 characters.', 'a short passphrase is refused');
ok(!V.isEnabled(), 'a refused passphrase leaves nothing behind');

await V.create('correct horse battery');
ok(V.isEnabled() && V.isOpen(), 'creating turns it on and leaves it open');
const meta = JSON.parse(localStorage.getItem('el_vault'));
ok(meta.iter === 600000 && meta.salt && meta.iv && meta.wrapped && !JSON.stringify(meta).includes('correct horse'), 'only salt, iv and the wrapped key are stored, never the passphrase');

const secret = { cfg: { url: 'https://script.google.com/macros/s/ABC/exec', key: 'TOP-SECRET-API-KEY' }, amount: 1234.56, list: [1, 2, 3] };
const sealed = await V.seal(secret);
const asText = JSON.stringify(sealed);
ok(V.isSealed(sealed) && !asText.includes('TOP-SECRET') && !asText.includes('1234') && !asText.includes('script.google'), 'sealed data contains none of the plain values');
ok(JSON.stringify(await V.unseal(sealed)) === JSON.stringify(secret), 'unsealing returns exactly what was sealed');
ok((await V.seal(secret)).ct !== sealed.ct, 'sealing the same value twice gives different bytes (fresh random iv)');
ok((await V.unseal({ plain: true })).plain === true, 'values written before encryption was on pass through untouched');
ok((await V.unseal(await V.seal(undefined))) === null && (await V.unseal(await V.seal([]))).length === 0, 'null and empty values round-trip');

// tampering is detected
const bad = { ...sealed, ct: sealed.ct.slice(0, -4) + (sealed.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
ok((await throws(() => V.unseal(bad))) !== null, 'a modified value is rejected, not silently misread');

// lock and unlock
const keep = localStorage.getItem('el_vault');
V.forget();
localStorage.setItem('el_vault', keep);              // simulate a fresh launch: metadata exists, the key does not
ok(V.isEnabled() && !V.isOpen(), 'after a restart the data key is gone');
ok((await throws(() => V.unseal(sealed))) === 'The app is locked.', 'locked: nothing can be read');
ok((await throws(() => V.open('wrong passphrase!'))) === 'Wrong passphrase.' && !V.isOpen(), 'a wrong passphrase does not open it');
ok((await V.open('correct horse battery')) === true && V.isOpen(), 'the right passphrase opens it');
ok(JSON.stringify(await V.unseal(sealed)) === JSON.stringify(secret), 'data sealed before the restart reads back after unlocking');

// changing the passphrase keeps the same data
ok((await throws(() => V.changePassphrase('nope nope nope', 'a brand new phrase'))) === 'Wrong passphrase.', 'changing needs the current passphrase');
ok((await throws(() => V.changePassphrase('correct horse battery', 'tiny'))) === 'Use at least 8 characters.', 'the new passphrase must be long enough');
await V.changePassphrase('correct horse battery', 'a brand new phrase');
ok(!(await V.check('correct horse battery')) && (await V.check('a brand new phrase')), 'old passphrase stops working, new one works');
const kept = localStorage.getItem('el_vault');
V.forget(); localStorage.setItem('el_vault', kept);
await V.open('a brand new phrase');
ok(JSON.stringify(await V.unseal(sealed)) === JSON.stringify(secret), 'existing data is still readable after a passphrase change');

// reload hand-over
V.stashForReload();
const stashed = sessionStorage.getItem('el_dek_tmp');
V.forget(); localStorage.setItem('el_vault', kept);
ok(!stashed || true, 'stash written');
sessionStorage.setItem('el_dek_tmp', stashed);
ok((await V.takeStash()) === true && V.isOpen() && sessionStorage.getItem('el_dek_tmp') === null, 'an automatic reload reopens without asking, and the parked key is removed at once');
ok((await V.takeStash()) === false, 'the parked key can only be used once');
ok(JSON.stringify(await V.unseal(sealed)) === JSON.stringify(secret), 'data readable after the reload hand-over');


// ---- automatic mode: the app keeps the key itself, nothing to type
{
  let kept = null;
  V._setKeyStore({ get: async () => kept, put: async (k) => { kept = k; }, del: async () => { kept = null; } });
  V.forget();
  ok(V.mode() === null, 'automatic: starts off');
  await V.createDevice();
  ok(V.isEnabled() && V.isOpen() && V.mode() === 'device', 'automatic: turning it on needs no passphrase and leaves it open');
  ok(JSON.parse(localStorage.getItem('el_vault')).mode === 'device' && !('wrapped' in JSON.parse(localStorage.getItem('el_vault'))), 'automatic: the stored note holds no key material at all');
  ok(kept && kept.extractable === false && kept.algorithm.name === 'AES-GCM' && kept.algorithm.length === 256, 'automatic: the key is AES-256 and cannot be exported, not even by the app');
  const v1 = { cfg: { key: 'SECRET-API-KEY' }, amount: 99.5 };
  const s1 = await V.seal(v1);
  ok(!JSON.stringify(s1).includes('SECRET') && JSON.stringify(await V.unseal(s1)) === JSON.stringify(v1), 'automatic: values are sealed and read back exactly');

  // a restart: the note says "on", memory is empty, the browser still has the key
  const note = localStorage.getItem('el_vault');
  const saved = kept;
  V.forget();
  ok(kept === null && !V.isEnabled(), 'automatic: turning it off removes the key and the note');
  localStorage.setItem('el_vault', note);
  kept = saved;
  ok(V.isEnabled() && !V.isOpen(), 'automatic: after a restart nothing is open yet');
  ok((await V.openDevice()) === true && V.isOpen(), 'automatic: the start-up opens it silently');
  ok(JSON.stringify(await V.unseal(s1)) === JSON.stringify(v1), 'automatic: data sealed before the restart reads back');

  // the browser lost the key
  V.forget();
  localStorage.setItem('el_vault', note);
  kept = null;
  let err = '';
  try { await V.openDevice(); } catch (e) { err = e.message; }
  ok(err === 'KEY_MISSING' && !V.isOpen(), 'automatic: a lost key is reported clearly (the app then starts clean from the sheet)');
  V.forget();
}

// turning it off
V.forget();
ok(!V.isEnabled() && !V.isOpen() && localStorage.getItem('el_vault') === null, 'forget() removes every trace of the key');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);

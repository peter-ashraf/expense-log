// App lock primitives.
//  - Biometric: a WebAuthn "platform authenticator" credential (Face ID / Touch ID on iPhone). A web app cannot
//    call Face ID directly; user verification through a passkey is the only biometric door the browser offers.
//  - PIN: a salted PBKDF2 hash kept on the device.
// This is a screen lock for the app. It does not encrypt the data stored on the phone.

const enc = new TextEncoder();

export const b64u = {
  enc(buf) {
    const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer || buf);
    let s = '';
    u8.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  },
};

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

export const bioSupported = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && navigator.credentials.get);

export async function bioAvailable() {
  try {
    return bioSupported() && !!(await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (e) { return false; }
}

/** Creates the device credential (shows the Face ID / Touch ID prompt). Returns its id. */
export async function bioEnroll() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'Credit Card Expenses' },
      user: { id: rand(16), name: 'owner', displayName: 'Owner' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      attestation: 'none',
      timeout: 60000,
    },
  });
  if (!cred) throw new Error('No credential was created.');
  return b64u.enc(cred.rawId);
}

/** Asks for Face ID / Touch ID. Resolves when the user was verified. */
export async function bioVerify(credId, signal) {
  const a = await navigator.credentials.get({
    ...(signal ? { signal } : {}),
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: 'public-key', id: b64u.dec(credId), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  if (!a) throw new Error('Not verified.');
  return true;
}

// ---- PIN ---------------------------------------------------------------------------------------
async function derive(pin, saltBytes) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 150000 }, key, 256);
  return b64u.enc(bits);
}

export async function pinCreate(pin) {
  const salt = rand(16);
  return { salt: b64u.enc(salt), hash: await derive(pin, salt), len: pin.length };
}

export async function pinCheck(pin, rec) {
  if (!rec || !rec.salt) return false;
  return (await derive(pin, b64u.dec(rec.salt))) === rec.hash;
}

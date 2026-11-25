// Zero-dependency rolling digit odometer engine (Web Animations API, no synchronous forced reflows).
const prevValues = new Map(); // key -> number
const prevHtml = new Map();   // key -> innerHTML
const prevTexts = new Map();  // key -> textContent
const elTokens = new WeakMap();
const elTimers = new WeakMap();
let nextToken = 0;

const escAttr = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Wrap a formatted numeric value in a keyed odometer span. */
export function nfSpan(numValue, key, formattedHTML) {
  const n = Number.isFinite(+numValue) ? +numValue : 0;
  return `<span class="nf" data-nf="${n}" data-nf-key="${escAttr(key)}">${formattedHTML ?? ''}</span>`;
}

/** Clear recorded previous values so the next sync does not animate from stale state. */
export function resetNumFlow() {
  prevValues.clear();
  prevHtml.clear();
  prevTexts.clear();
}

function isReducedOrPrivate() {
  if (typeof document !== 'undefined' && document.documentElement?.classList?.contains('privacy')) return true;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  return false;
}

function buildReelElement(prevChar, curChar, dir) {
  const slot = document.createElement('span');
  slot.className = 'nf-slot';
  const reel = document.createElement('span');
  reel.className = 'nf-reel';
  // dir > 0 animates 0 -> -50% (shows child 0 first, lands on child 1);
  // dir < 0 animates -50% -> 0 (shows child 1 first, lands on child 0).
  const first = document.createElement('span');
  first.textContent = dir > 0 ? prevChar : curChar;
  const second = document.createElement('span');
  second.textContent = dir > 0 ? curChar : prevChar;
  reel.append(first, second);
  slot.appendChild(reel);
  return { slot, reel };
}

function replaceChangedDigits(el, prevText, curText, dir) {
  const curDigits = curText.match(/[0-9]/g) || [];
  if (!curDigits.length) return [];
  const prevDigits = prevText.match(/[0-9]/g) || [];
  const offset = curDigits.length - prevDigits.length;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  const reels = [];
  let digitIndex = 0;

  for (const node of textNodes) {
    const str = node.nodeValue || '';
    if (!/[0-9]/.test(str)) continue;

    let changed = false;
    const frag = document.createDocumentFragment();
    let buf = '';
    const flushBuf = () => {
      if (buf) {
        frag.appendChild(document.createTextNode(buf));
        buf = '';
      }
    };

    for (const ch of str) {
      if (ch >= '0' && ch <= '9') {
        const pIdx = digitIndex - offset;
        const prevChar = pIdx >= 0 && pIdx < prevDigits.length ? prevDigits[pIdx] : '\u00A0';
        digitIndex++;
        if (prevChar !== ch) {
          flushBuf();
          const { slot, reel } = buildReelElement(prevChar, ch, dir);
          frag.appendChild(slot);
          reels.push(reel);
          changed = true;
        } else {
          buf += ch;
        }
      } else {
        buf += ch;
      }
    }

    if (changed) {
      flushBuf();
      node.parentNode.replaceChild(frag, node);
    }
  }

  return reels;
}

/** Batch-read `.nf[data-nf-key]` elements in `root` and roll changed digits via WAAPI. */
export function syncNumFlow(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const els = [...root.querySelectorAll('.nf[data-nf-key]')];
  if (!els.length) return;

  // Phase 1: Batch all DOM reads before any DOM writes.
  const reads = els.map((el) => ({
    el,
    key: el.dataset.nfKey,
    next: Number(el.dataset.nf),
    finalHTML: el.innerHTML,
    curText: el.textContent || '',
  }));

  if (isReducedOrPrivate()) {
    for (const r of reads) {
      if (!r.key || !Number.isFinite(r.next)) continue;
      prevValues.set(r.key, r.next);
      prevHtml.set(r.key, r.finalHTML);
      prevTexts.set(r.key, r.curText);
    }
    return;
  }

  // Phase 2: Prepare state and perform DOM writes.
  const pendingAnimations = [];
  for (const r of reads) {
    const { el, key, next, finalHTML, curText } = r;
    if (!key || !Number.isFinite(next)) continue;

    const prev = prevValues.get(key);
    const prevText = prevTexts.get(key) ?? '';
    prevValues.set(key, next);
    prevHtml.set(key, finalHTML);
    prevTexts.set(key, curText);

    if (prev === undefined || !Number.isFinite(prev) || Math.abs(prev - next) < 0.005) continue;

    const prevTimer = elTimers.get(el);
    if (prevTimer) {
      clearTimeout(prevTimer);
      elTimers.delete(el);
    }

    const dir = next > prev ? 1 : -1;
    const reels = replaceChangedDigits(el, prevText, curText, dir);
    if (!reels.length) continue;

    if (typeof reels[0].animate !== 'function') {
      el.innerHTML = finalHTML;
      continue;
    }

    const token = ++nextToken;
    elTokens.set(el, token);
    pendingAnimations.push({ el, finalHTML, reels, dir, token });
  }

  // Phase 3: Trigger WAAPI animations and schedule clean HTML restoration.
  for (const item of pendingAnimations) {
    const { el, finalHTML, reels, dir, token } = item;
    const frames = [
      { transform: dir > 0 ? 'translateY(0)' : 'translateY(-50%)' },
      { transform: dir > 0 ? 'translateY(-50%)' : 'translateY(0)' },
    ];
    const timing = { duration: 400, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' };
    for (const reel of reels) reel.animate(frames, timing);

    const timer = setTimeout(() => {
      elTimers.delete(el);
      if (elTokens.get(el) !== token) return;
      if (!el.querySelector('.nf-reel')) return;
      el.innerHTML = finalHTML;
    }, 420);
    elTimers.set(el, timer);
  }
}

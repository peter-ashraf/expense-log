// One sliding highlight for every pill group (segmented controls, wallet chips, filters, date chips).
// The app rebuilds a screen's HTML on every tap, so the highlight is a separate element that remembers where it
// was and glides from there to the newly chosen pill instead of vanishing from one and appearing on the other.
const TARGETS = '.seg, .acc-chips, #filters, .datechips';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const seen = new Map();          // key -> where the highlight last was
let scopeOf = () => 'app';

function geometry(on) {
  return { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
}

function paint(ind, g, look) {
  ind.style.width = g.w + 'px';
  ind.style.height = g.h + 'px';
  ind.style.transform = `translate(${g.x}px, ${g.y}px)`;
  if (look) { ind.style.backgroundColor = look.bg; ind.style.borderColor = look.bd; ind.style.borderRadius = look.r; }
}

function enhance(box, key, scope) {
  const on = box.querySelector(':scope > .on');
  let ind = box.querySelector(':scope > .slide-ind');
  if (!on) { if (ind) ind.remove(); box.classList.remove('slide-ready'); seen.delete(key); return; }
  if (ind && ind._on === on) return;                       // nothing changed

  // read how the chosen pill looks BEFORE it is made transparent
  // (a box that stays on screen while its buttons are replaced is already neutralised: undo that for the read)
  // Transitions are switched off for the read, otherwise a pill that was just neutralised is caught mid-fade (transparent).
  const was = box.classList.contains('slide-ready');
  box.classList.add('slide-probe');
  box.classList.remove('slide-ready');
  const cs = getComputedStyle(on);
  const look = { bg: cs.backgroundColor, bd: parseFloat(cs.borderTopWidth) ? cs.borderTopColor : 'transparent', r: cs.borderRadius };
  if (was) box.classList.add('slide-ready');
  requestAnimationFrame(() => box.classList.remove('slide-probe'));
  const fresh = !ind;
  if (fresh) {
    ind = document.createElement('i');
    ind.className = 'slide-ind';
    ind.setAttribute('aria-hidden', 'true');
    box.insertBefore(ind, box.firstChild);
    box.classList.add('slide-ready');
  }
  const to = geometry(on);
  const n = box.querySelectorAll(':scope > button').length;
  const cw = box.clientWidth;
  const prev = seen.get(key);
  const glide = !reduce && prev && prev.n === n && Math.abs(prev.cw - cw) < 3 && (prev.x !== to.x || prev.y !== to.y || prev.w !== to.w);
  const from = fresh ? prev : { ...geometry(ind._on || on), bg: ind.style.backgroundColor, bd: ind.style.borderColor, r: ind.style.borderRadius };
  if (glide && from) {
    ind.style.transition = 'none';
    paint(ind, from, { bg: from.bg, bd: from.bd, r: from.r });
    void ind.offsetWidth;                                   // commit the starting spot
    ind.style.transition = '';
  }
  if (fresh && !(glide && from)) {                          // first appearance: show at once, no colour fade-in
    ind.style.transition = 'none';
    paint(ind, to, look);
    void ind.offsetWidth;
    ind.style.transition = '';
  } else paint(ind, to, look);
  ind._on = on;
  seen.set(key, { ...to, n, cw, bg: look.bg, bd: look.bd, r: look.r, scope });
}

function scan() {
  const scope = scopeOf();
  const layer = document.getElementById('layer');
  const sheetOpen = !!(layer && layer.classList.contains('open'));
  for (const [k, v] of seen) if (v.scope === 'sheet' ? !sheetOpen : v.scope !== scope) seen.delete(k);   // never glide across screens
  const count = {};
  document.querySelectorAll(TARGETS).forEach((box) => {
    const sc = box.closest('#layer') ? 'sheet' : scope;
    const base = box.id || box.getAttribute('aria-label') || box.className.replace(/\bslide-ready\b/, '').trim();
    count[sc + base] = (count[sc + base] || 0) + 1;
    enhance(box, `${sc}|${base}|${count[sc + base]}`, sc);
  });
}

export function initSlide(getScope) {
  scopeOf = getScope || scopeOf;
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
}

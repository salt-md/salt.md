/**
 * Tempo des laufenden Randes beim Hover — ohne Sprung.
 *
 * Der naheliegende Weg ist CSS: `animation-duration` beim Hover verkürzen. Das
 * springt sichtbar, und zwar zwangsläufig. Der Fortschritt einer Animation
 * ergibt sich aus verstrichener Zeit GETEILT durch Dauer. Läuft der Bogen seit
 * 4s bei 9s Umlauf, steht er bei 160°. Wird die Dauer im selben Moment auf
 * 3,5s gesetzt, gilt (4 mod 3,5) / 3,5 — also 51°. Das Licht setzt zurück,
 * statt zu beschleunigen.
 *
 * `updatePlaybackRate` ist genau dafür gemacht: es hält die aktuelle Zeit fest
 * und ändert nur das Tempo. Und weil ein harter Sprung von 1 auf 2,6 sich
 * anfühlt wie ein Ruck, wird die Rate über eine knappe halbe Sekunde
 * hochgezogen.
 *
 * Delegiert am document, nicht pro Element: Dialoge entstehen erst beim
 * Öffnen, ein Listener beim Einhängen würde sie nie erreichen.
 */

const SELECTOR = '.ring, .dialog, .confirm-dialog';
const FAST = 2.6;
const RAMP_MS = 420;

/** Die Rand-Animation eines Elements (es kann mehrere Animationen tragen). */
function ringAnimations(el: Element): Animation[] {
  return el.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'ring-rotate');
}

const ramps = new WeakMap<Element, number>();

function rampTo(el: Element, target: number) {
  const anims = ringAnimations(el);
  if (!anims.length) return;
  const from = anims[0].playbackRate;
  if (from === target) return;

  const previous = ramps.get(el);
  if (previous) cancelAnimationFrame(previous);

  const started = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - started) / RAMP_MS);
    // Kubisch ausklingend: schnell ansprechen, weich ankommen.
    const eased = 1 - Math.pow(1 - t, 3);
    for (const a of anims) a.updatePlaybackRate(from + (target - from) * eased);
    if (t < 1) ramps.set(el, requestAnimationFrame(step));
    else ramps.delete(el);
  };
  ramps.set(el, requestAnimationFrame(step));
}

export function installRingHover() {
  // Ein bewegungsempfindlicher Mensch hat die Drehung ohnehin abgeschaltet
  // (siehe styles.css) — dann gibt es hier nichts zu beschleunigen.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.addEventListener('pointerover', (e) => {
    const el = (e.target as Element | null)?.closest?.(SELECTOR);
    if (!el) return;
    // Von einem Kind zum anderen zu fahren ist kein neues Betreten.
    const from = (e as PointerEvent).relatedTarget as Element | null;
    if (from && el.contains(from)) return;
    rampTo(el, FAST);
  });

  document.addEventListener('pointerout', (e) => {
    const el = (e.target as Element | null)?.closest?.(SELECTOR);
    if (!el) return;
    const to = (e as PointerEvent).relatedTarget as Element | null;
    if (to && el.contains(to)) return;
    rampTo(el, 1);
  });
}

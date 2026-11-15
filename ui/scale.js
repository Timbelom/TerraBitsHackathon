// One scale for the whole interface. The page is drawn for a 1920 x 950 px window; --dp in tokens.css is one px of that
// drawing in the window at hand, and every size in the stylesheets is a multiple of it. dp() is the same number for
// script: sizes that code sets or assumes in px (gaps, margins, minimum sizes) are multiplied by it.
// Keep REF_W, REF_H, MIN and MAX equal to --dp in tokens.css.
const REF_W = 1920, REF_H = 950, MIN = .65, MAX = 2;
const hasWindow = typeof innerWidth === 'number';
/** One design px in CSS px of this window. 1 without a window (tests). */
export const dp = () => hasWindow ? Math.min(MAX, Math.max(MIN, Math.min(innerWidth / REF_W, innerHeight / REF_H))) : 1;
const subs = [];
/** fn(k) now and after every resize: for module constants in px. */
export function onScale(fn) { subs.push(fn); fn(dp()); }
if (hasWindow) addEventListener('resize', () => { const k = dp(); for (const fn of subs) fn(k); });

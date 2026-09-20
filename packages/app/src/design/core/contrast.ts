/**
 * WCAG contrast, computed at render time from the values actually in use.
 *
 * Point of doing it live rather than in a spreadsheet: if someone edits a token, the design
 * system page starts failing immediately instead of quietly drifting out of compliance.
 */

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 4.5:1 is AA for body text, 3:1 for large text and non-text indicators (icons, focus rings,
 * status dots). Anything under 3:1 fails outright.
 */
export function ratioVerdict(r: number): { label: string; cls: string } {
  if (r >= 7) return { label: 'AAA', cls: 'pass' };
  if (r >= 4.5) return { label: 'AA', cls: 'pass' };
  if (r >= 3) return { label: 'AA large', cls: 'warn' };
  return { label: 'Fail', cls: 'fail' };
}

export const GLOBAL = 1;
export const IGNORE_CASE = 2;
export const MULTILINE = 4;
export const DOT_ALL = 8;
export const UNICODE = 16;
export const STICKY = 32;
export const INDICES = 64;
export const UNICODE_SETS = 128;

export function parseFlags(flags: string): number {
  let mask = 0;
  for (let i = 0; i < flags.length; i++) {
    const c = flags.charCodeAt(i);
    let bit = 0;
    if (c === 103) bit = GLOBAL;
    else if (c === 105) bit = IGNORE_CASE;
    else if (c === 109) bit = MULTILINE;
    else if (c === 115) bit = DOT_ALL;
    else if (c === 117) bit = UNICODE;
    else if (c === 121) bit = STICKY;
    else if (c === 100) bit = INDICES;
    else if (c === 118) bit = UNICODE_SETS;
    else throw new SyntaxError("Invalid regular expression flag");
    if ((mask & bit) !== 0) throw new SyntaxError("Duplicate regular expression flag");
    mask |= bit;
  }
  if ((mask & UNICODE) !== 0 && (mask & UNICODE_SETS) !== 0) {
    throw new SyntaxError("The u and v flags are mutually exclusive");
  }
  return mask;
}

export function flagsText(mask: number): string {
  let result = "";
  if ((mask & INDICES) !== 0) result += "d";
  if ((mask & GLOBAL) !== 0) result += "g";
  if ((mask & IGNORE_CASE) !== 0) result += "i";
  if ((mask & MULTILINE) !== 0) result += "m";
  if ((mask & DOT_ALL) !== 0) result += "s";
  if ((mask & UNICODE) !== 0) result += "u";
  if ((mask & UNICODE_SETS) !== 0) result += "v";
  if ((mask & STICKY) !== 0) result += "y";
  return result;
}

export function fullUnicode(mask: number): boolean {
  return (mask & (UNICODE | UNICODE_SETS)) !== 0;
}

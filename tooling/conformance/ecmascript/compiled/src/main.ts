import {
  parseFlags,
  flagsText,
  fullUnicode,
} from "../../../../../runtime/ecmascript/src/regexp/flags.ts";
import {
  advanceStringIndex,
  pointAt,
  previousIndex,
} from "../../../../../runtime/ecmascript/src/regexp/utf16.ts";
import { parsePattern } from "../../../../../runtime/ecmascript/src/regexp/parser.ts";
import { compile, execute } from "../../../../../runtime/ecmascript/src/regexp/engine.ts";

export function flagsRoundTrip(flags: string): string {
  return flagsText(parseFlags(flags));
}

export function advance(text: string, index: number, unicode: boolean): number {
  return advanceStringIndex(text, index, unicode);
}

export function codePoint(text: string, index: number, flags: string): number {
  return pointAt(text, index, fullUnicode(parseFlags(flags)));
}

export function previous(text: string, index: number, unicode: boolean): number {
  return previousIndex(text, index, unicode);
}

export function parseCaptures(caseId: number): number {
  if (caseId < 0) return parsePattern("(?<a>a)|(?<a>b)", "u").captureCount;
  if (caseId < 3) return parsePattern("[a-z]+(b)?", "i").captureCount;
  return parsePattern("(?<=a)(b)", "").captureCount;
}

export function engineProbe(caseId: number): number {
  const pattern = caseId < 0 ? "(?<=([ab]+)([bc]+))$" : caseId < 3 ? "(a(b)?)+" : "(?=(a+))a*b\\1";
  const input = caseId < 0 ? "abc" : caseId < 3 ? "aba" : "baaabac";
  const matched = execute(compile(pattern, "d"), input);
  if (matched === null) return -1;
  let sum = 0;
  for (let i = 0; i < matched.captures.length; i++) sum = sum * 7 + matched.captures[i]! + 1;
  return sum;
}

// Exercises generated data and string-set tries in emitted code, beyond the
// ASCII VM control probe. Standard conformance comes from Test262 above it.
export function unicodeProbe(caseId: number): number {
  const pattern =
    caseId < 0 ? "\\p{Script=Greek}+" : caseId < 3 ? "\\p{RGI_Emoji}" : "(?<k>k)\\k<k>";
  const flags = caseId < 0 ? "u" : caseId < 3 ? "v" : "iu";
  const input = caseId < 0 ? "αβγ" : caseId < 3 ? "👨‍👩‍👧‍👦" : "Kk";
  const match = execute(compile(pattern, flags), input);
  if (match === null) return -1;
  let sum = 0;
  for (let i = 0; i < match.captures.length; i++) sum = sum * 7 + match.captures[i]! + 1;
  return sum;
}

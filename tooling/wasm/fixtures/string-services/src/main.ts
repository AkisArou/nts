// The string methods the host applies with node's own String.prototype:
// searches, tests, trims, padding, replacement and its `$` patterns, well
// formedness, code points, URIs, and a for-of over astral characters.

function text(v: number): string {
  return "  abc😀def abc " + (v | 0) + " ";
}

export function searches(v: number): string {
  const s = text(v);
  return `${s.indexOf("abc")}|${s.indexOf("abc", 4)}|${s.lastIndexOf("abc")}|${s.indexOf("zz")}|${s.includes("😀")}|${s.startsWith("  a")}|${s.endsWith(" ")}`;
}

export function trims(v: number): string {
  const s = text(v);
  return `[${s.trim()}][${s.trimStart()}][${s.trimEnd()}]`;
}

export function pads(v: number): string {
  const n = (v | 0) & 15;
  return `${"7".padStart(n, "ab")}|${"7".padEnd(n)}|${"xyz".padStart(2, "0")}`;
}

export function replaces(v: number): string {
  const s = "a-b-a-b " + ((v | 0) & 3);
  return `${s.replace("a", "[$&]")}|${s.replaceAll("b", "<$'>")}|${s.replace("", "^")}|${s.replaceAll("-", "")}`;
}

export function wellFormed(v: number): string {
  const lone = String.fromCharCode(0xd800 + ((v | 0) & 1)) + "x";
  return `${lone.isWellFormed()}|${"ok😀".isWellFormed()}|${lone.toWellFormed().charCodeAt(0)}`;
}

export function codePoints(v: number): string {
  const point = ((v | 0) & 0xffff) + 0x1f000;
  return `${String.fromCodePoint(point).length}|${String.fromCodePoint(65 + ((v | 0) & 7))}`;
}

export function uris(v: number): string {
  const s = "a b/c?d=é&" + (v | 0);
  const once = encodeURIComponent(s);
  return `${encodeURI(s)}|${once}|${decodeURIComponent(once)}|${decodeURI("%41%2F")}`;
}

export function points(v: number): number {
  let count = 0;
  let width = 0;
  for (const ch of "a😀b🎉c" + (v | 0)) {
    count++;
    width += ch.length;
  }
  return count * 100 + width;
}

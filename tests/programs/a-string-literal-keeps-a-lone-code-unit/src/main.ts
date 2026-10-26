// A literal and its fromCharCode control contain the same UTF-16 code units.
// The controls differ only in how the string is constructed.
export function literal(n: number): number {
  const text = n & 1 ? "\ud800" : "\udc00";
  return text.length * 65536 + text.charCodeAt(0);
}
export function constructed(n: number): number {
  const text = String.fromCharCode(n & 1 ? 0xd800 : 0xdc00);
  return text.length * 65536 + text.charCodeAt(0);
}
export function embeddedLiteral(n: number): number {
  const text = n & 1 ? "a\ud800b" : "a\udc00b";
  return text.length * 65536 + text.charCodeAt(1);
}
export function embeddedConstructed(n: number): number {
  const text = "a" + String.fromCharCode(n & 1 ? 0xd800 : 0xdc00) + "b";
  return text.length * 65536 + text.charCodeAt(1);
}
export function pairLiteral(n: number): number {
  const text = n & 1 ? "\ud83d\ude00" : "\ud83d\ude01";
  return text.length * 65536 + text.charCodeAt(1);
}
export function pairConstructed(n: number): number {
  const text = String.fromCharCode(0xd83d, n & 1 ? 0xde00 : 0xde01);
  return text.length * 65536 + text.charCodeAt(1);
}

function tagged(parts: TemplateStringsArray): number {
  const rawSpelling = "\\ud800";
  const cooked = parts[0];
  return cooked.length * 65536 + cooked.charCodeAt(0) + (cooked === rawSpelling ? 1 : 0);
}
export function taggedCooked(n: number): number { return tagged`\ud800` + (n & 0); }
export function taggedSpelling(n: number): number { return tagged`\\ud800` + (n & 0); }

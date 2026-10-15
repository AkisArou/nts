// `startsWith` and `endsWith` with no position, every string against every
// affix: empty ones, an affix longer than the string, the whole string, and
// surrogate pairs at either end. Wasm answers them over the engine's string
// builtins; node is the oracle.

const WORDS = ["", "a", "ab", "abc", "\u{1F600}x", "x\u{1F600}", "abcabc"];

function pick(n: number): string {
  return WORDS[Math.abs(n | 0) % WORDS.length];
}

export function starts(n: number): string {
  const s = pick(n);
  let answer = "";
  for (const affix of WORDS) answer += s.startsWith(affix) ? "1" : "0";
  return answer;
}

export function ends(n: number): string {
  const s = pick(n);
  let answer = "";
  for (const affix of WORDS) answer += s.endsWith(affix) ? "1" : "0";
  return answer;
}

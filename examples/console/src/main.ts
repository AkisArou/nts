// `console.log` and its siblings, as node spells and writes them. Every line
// is compared with node's, in order, between the cases' own results.
//
// - a number as `String` spells it, except negative zero, which is `-0`;
// - a bigint with its `n`;
// - `null`, `undefined` and a boolean as their words;
// - a string as itself, as UTF-8, a lone surrogate as U+FFFD;
// - arguments joined by one space, and `console.log()` an empty line;
// - a `number | undefined` holding negative zero, spelled from its tag;
// - arguments evaluated left to right before the line is written;
// - `console.error` and `console.warn` to stderr, which a combined log
//   interleaves with stdout in the order they happen.

export function numbers(x: number): number {
  console.log("numbers", x, -x, x * 0, -x * 0, x / 3);
  return x;
}

export function words(s: string, flag: boolean): number {
  console.log("words", s, `[${s}]`, s.length, flag, !flag);
  console.info("info", null, undefined);
  console.debug();
  return s.length;
}

function last(xs: number[]): number | undefined {
  return xs.pop();
}

export function absent(x: number): number {
  const none = last([]);
  const held = last([x * 0]);
  console.log("absent", none, held);
  return held ?? 1;
}

let calls = 0;
function next(): number {
  calls += 1;
  return calls;
}

export function order(): number {
  calls = 0;
  console.log("order", next(), next(), next());
  console.error("stderr", calls);
  console.warn("warn");
  return calls;
}

export function text(): number {
  const lone = String.fromCharCode(0xd800);
  console.log("text", "é", "😀", lone, "a\u0000b", 10n ** 20n, -(10n ** 20n), "100%%");
  return lone.length;
}

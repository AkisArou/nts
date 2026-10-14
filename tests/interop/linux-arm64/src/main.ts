// A TypeScript program on arm64 Linux, the C backend's build and the LLVM
// backend's printing one text.
//
// Every line crosses into the C runtime in a way AAPCS64 spells differently
// from System V, which is what the LLVM backend has to get right by itself:
// an erased value (sixteen bytes) passes and returns as two words, `[2 x
// i64]`, and an awaited promise's task (a record of three pointers) passes
// as a pointer to a copy. The erased values come from `Map.get` (`T |
// undefined`) and from `unknown` below: `instanceof`, truthiness and `===`
// each hand one to the runtime. Each line also leans on a part of the
// runtime that is platform-sensitive:
// Unicode tables (case mapping), shortest-round-trip number formatting,
// 64-bit integer arithmetic, hash-map iteration order, and the event loop
// (a timer and a promise continuation, which only a working libuv host runs
// in this order -- on Windows that host is IOCP). The same text is the claim.
import { report } from "c:report";

const lines: string[] = [];

lines.push("upper " + "straße ǆ αβγ".toUpperCase());
lines.push("numbers " + String(0.1 + 0.2) + " " + String(1e21) + " " + (2 / 3).toFixed(5));
lines.push("bigint " + String(2n ** 100n % 1000000007n));

const seen = new Map<string, number>();
for (const word of ["pear", "apple", "fig", "apple", "pear", "apple"]) {
  seen.set(word, (seen.get(word) ?? 0) + 1);
}
let counts = "";
for (const [word, n] of seen) {
  counts += word + "=" + String(n) + " ";
}
lines.push("map " + counts.trim());

class Point {
  constructor(public x: number) {}
}
const values: unknown[] = [1, "two", new Point(3), null, true, 0];
let kinds = "";
for (const value of values) {
  kinds += (value instanceof Point ? "p" : "") + (value ? "t" : "f") + (value === 1 ? "1" : "") + ",";
}
lines.push("erased " + kinds);
const keyed = new Map<unknown, unknown>();
keyed.set(1, "one");
keyed.set("b", 2);
lines.push("keyed " + String(keyed.get(1) === "one") + " " + String(keyed.get("b") === 2) + " " + String(keyed.get(3) === undefined));
lines.push("shift " + String((2n ** 100n) >> 37n) + " " + String(-(2n ** 90n) << 3n));

const squares: number[] = [];
for (let i = 1; i <= 5; i++) {
  squares.push(i * i);
}
lines.push("array " + squares.join(","));

// The order is the event loop's: synchronous code, then the microtask, then
// the timer. Reported from the timer, so a host that never runs timers prints
// nothing at all and the comparison fails loudly.
async function later(): Promise<void> {
  const v = await Promise.resolve(7);
  lines.push("await " + String(v));
}
later();
setTimeout(() => {
  lines.push("timer");
  for (const line of lines) {
    report(line);
  }
}, 1);
lines.push("sync");

// A TypeScript program on macOS, checked against the same program on Linux.
//
// Each line leans on a part of the runtime that is platform-sensitive:
// Unicode tables (case mapping), shortest-round-trip number formatting,
// 64-bit integer arithmetic, hash-map iteration order, and the event loop
// (a timer and a promise continuation, which only a working libuv host runs
// in this order). The same text on both machines is the claim.

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
    console.log(line);
    // One line to stderr between two to stdout: a log holding both streams
    // has it here, as node's does, only when each line is written through.
    if (line === "sync") {
      console.error("stderr after sync");
    }
  }
}, 1);
lines.push("sync");

// run: check
// backend: jvm
//
// `outcomes/a-string-stored-through-a-widened-number-map-reads-as-a-number`,
// on the JVM.
//
// **A string stored through a `Map<unknown, unknown>` view of a
// `Map<number, number>` reads back through the typed view as the type says.**
// TypeScript's method bivariance lets `widen` take the typed map and store a
// string key and a string value in it. Read back through the map's own type,
// whose callback types `k` and `v` as `number`, node prints the strings; nts
// prints what the static type promised, reading a number out of a string: on
// C, its pointer's bits as a double (`4.67e-310`, which moves with the
// address); on LLVM the same (`-llvm`); on the JVM, the zero an `NtsValue`
// holding a string carries beside it (`-jvm`). Wasm declines the upcast
// itself: "no Wasm cast relates their storage". TypeScript's unsoundness, not
// a misread of the program -- but what the user sees is the wrong answer, so
// it is recorded.
//
// The control, `anUnknownMapTheWholeWay`, differs in one thing: the map is
// made a `Map<unknown, unknown>`, so its own view is the one that stored the
// strings. It agrees on every backend.
//
// Found on 2026-10-21 by the JVM lane, writing
// `programs/a-number-table-holds-its-numbers-unboxed`, whose own column turn
// reads the entries back through the `unknown` view for this reason.

function widen(into: Map<unknown, unknown>, seed: number): void {
  into.set("text", seed);
  into.set(seed + 100, "value");
}

export function aNumberMapWidened(seed: number): string {
  const m = new Map<number, number>();
  m.set(3, 4);
  widen(m, seed);
  const out: string[] = [];
  m.forEach((v, k) => out.push(String(k) + ":" + String(v)));
  return out.join(" ");
}

export function anUnknownMapTheWholeWay(seed: number): string {
  const m = new Map<unknown, unknown>();
  m.set(3, 4);
  widen(m, seed);
  const out: string[] = [];
  m.forEach((v, k) => out.push(String(k) + ":" + String(v)));
  return out.join(" ");
}

// From lifetimes/frame-container-outer-fields.ts. Both holders are bounded.
// The control differs only by clearing busy before its second fill.
// #916 fixed the overwritten Entry/string leak. #1049 tracks the remaining
// null-release attempts: the shared fill entry lacks per-call null-slot facts.
type Entry = { id: number; text: string };
type Holder = { first: Entry | null; second: Entry | null };
function fill(n: number, out: Holder): void {
  const entry = { id: n, text: "entry:" + n };
  entry.id += 3;
  out.first = entry;
  out.second = entry;
}
export function work(_iterations: number): number {
  for (let n = 0; n < 1; n++) {
    const kept: Holder = { first: null, second: null };
    fill(n, kept);
    const busy: Holder = { first: null, second: null };
    for (let j = 1; j <= 2; j++) {
      fill(n + j + 1000, busy);
      const first = busy.first as Entry | null;
      if (first === null || first.id !== n + j + 1003) return 0;
    }
    if (kept.first === null || kept.second === null) return 0;
    if (kept.first !== kept.second || kept.first.id !== n + 3 ||
        kept.first.text !== "entry:" + n) return 0;
  }
  return 1;
}

// An object pushed into an `unknown[]`, which then lets it go, while another
// array still holds it.
//
// `nts_array_push_value` consumes the reference it is given -- its header says
// "consuming, like `nts_array_push_ref`", and it stores without a retain -- and
// the counting pass did not know, so the caller released the reference the
// array had just taken. Twenty pushes left the object's count where it was, and
// letting go of the twenty freed it under the array that still held it.
//
// **Freed at the next collection, not at once.** An object whose count reaches
// zero while it waits in the possible-roots buffer is destroyed when the
// collector next runs, so reading it straight away still answers correctly.
// `collect` releases enough to cross the collector's threshold, and the boxes
// made after it reuse what was freed: `kept[0].value` then reads one of them.
//
// **Valgrind does not see it either**: the runtime pools what it frees, so the
// early free is not a free valgrind watches. Look for a missing consume with a
// fixture that forces a collection, as this one does, and not with valgrind.
//
// Only reference counting can see it, which is what `NTS_RC=1` runs.

class Box {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
}

const kept: Box[] = [];

function hold(n: number): void {
  const box = new Box(n);
  kept.push(box);
  const bag: unknown[] = [];
  for (let i = 0; i < 20; i++) bag.push(box);
  bag.length = 0;
}

// Enough releases of a counted object to fill the possible-roots buffer past
// the collector's threshold, so the collector runs.
function collect(): void {
  const shared = new Box(0);
  const many: Box[] = [];
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 5000; i++) many.push(shared);
    many.length = 0;
  }
}

export function survives(n: number): number {
  kept.length = 0;
  hold(n);
  collect();
  let noise = 0;
  for (let i = 0; i < 64; i++) noise += new Box(i * 1000).value;
  return kept[0].value + (noise > 0 ? 0 : 1);
}

// The same with the array released whole rather than emptied.
export function survivesTheArray(n: number): number {
  kept.length = 0;
  (function (): void {
    const box = new Box(n * 2);
    kept.push(box);
    const bag: unknown[] = [box, box, box];
    bag.push(box);
  })();
  collect();
  let noise = 0;
  for (let i = 0; i < 64; i++) noise += new Box(i + 5000).value;
  return kept[0].value + (noise > 0 ? 0 : 1);
}

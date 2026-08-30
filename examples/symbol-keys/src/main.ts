// A class member whose name is a symbol.
//
// `node` uses this everywhere to keep internal state off the public shape:
//
//     export const kRefed = Symbol("refed");
//     class Immediate { [kRefed]: boolean | null; ... this[kRefed] = false; }
//
// It reads like a property map and is not one. A symbol declared `const` at
// module scope is *one* symbol, known at compile time, so `[kRefed]` is an
// ordinary field with an unusual name and costs exactly what `_refed` would.
//
// The snapshot already reports it, under TypeScript's own spelling for such a
// member: `__@kRefed@2`, the description and the checker's id. What was missing
// was the access side, which had the *variable's* name — `kRefed` — and looked
// for a field called that.

const kRefed = Symbol("refed");
const kAsyncId = Symbol("asyncId");

class Immediate {
  [kRefed]: boolean;
  [kAsyncId]: number;
  plain: number;

  constructor(id: number) {
    this[kRefed] = false;
    this[kAsyncId] = id;
    this.plain = id * 2;
  }
}

export function readsAndWrites(n: number): number {
  const i = new Immediate(n);
  if (i[kRefed] === false) {
    i[kRefed] = true;
  }
  i[kAsyncId] = i[kAsyncId] + 1;
  return (i[kRefed] ? 1000 : 0) + i[kAsyncId];
}

// Beside an ordinary field, in one layout, so the two kinds of name coexist.
export function besideAPlainField(n: number): number {
  const i = new Immediate(n);
  return i.plain + i[kAsyncId] * 10;
}

// Through a call, where the receiver's type comes from the parameter rather
// than from the `new` that made it.
function refed(i: Immediate): boolean {
  return i[kRefed];
}

export function throughACall(n: number): number {
  const i = new Immediate(n);
  i[kRefed] = n > 0;
  return (refed(i) ? 1 : 0) + n * 0;
}

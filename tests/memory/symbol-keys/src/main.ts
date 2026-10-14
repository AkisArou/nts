// A symbol key is a field name, and this is the case that says it costs a field
// name's worth of nothing.
//
// `typescript.md` claims `[kRefed]` "costs exactly what `_refed` would". That is
// a claim about *layout*, and the thing that would falsify it is a property map
// hiding behind the syntax: a hash lookup allocates, a field does not. So both
// spellings are here, in one loop, and the floor is the same number for both.

const kRefed = Symbol("refed");
const kAsyncId = Symbol("asyncId");

class Immediate {
  [kRefed]: boolean;
  [kAsyncId]: number;
  plainRefed: boolean;
  plainAsyncId: number;

  constructor(id: number) {
    this[kRefed] = false;
    this[kAsyncId] = id;
    this.plainRefed = false;
    this.plainAsyncId = id;
  }
}

export function work(n: number): number {
  const each = new Immediate(n);
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    each[kRefed] = !each[kRefed];
    each[kAsyncId] = each[kAsyncId] + 1;
    each.plainRefed = !each.plainRefed;
    each.plainAsyncId = each.plainAsyncId + 1;
    total = total + each[kAsyncId] + each.plainAsyncId;
  }
  return total + (each[kRefed] ? 1 : 0) + (each.plainRefed ? 2 : 0);
}

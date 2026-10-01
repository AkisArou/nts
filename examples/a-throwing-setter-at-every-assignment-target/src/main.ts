// A throwing setter inside a `try`, written through every assignment target
// that is not a plain `o.x = v`.
//
// A setter write's callee is resolved for the property access `o.x`, and its
// raise has to be tested at that same node. Before the accessor work landed the
// test sat at the *assignment*, which held no raising call, so the call named
// `Box#set checked@raises` and nothing read the flag: the `throw` was recorded
// and dropped, and the write answered the success value. A flag nobody reads
// returns a plausible number, so **each function here throws, under node, on 10
// to 12 of its 32 inputs**: a setter fixture whose raise path is never taken
// agrees for the wrong reason. Each target is a different place the recorded
// node and the resolved one could separate: an update (`++`), a logical
// assignment, a nested and a parenthesized receiver, a string key, a chain, an
// assignment used as a value, an array-destructuring target and a `for ... of`
// target.
//
// Before the accessor raising copies every function here refused, so there is
// no wrong-answer arm to compare against; the property is that all nine agree
// with node with the raise taken.
class Box {
  stored = 0;
  get checked(): number {
    return this.stored;
  }
  set checked(v: number) {
    if (v > 10) throw new Error("too big");
    this.stored = v;
  }
}
class Holder {
  inner = new Box();
}

export function increment(n: number): number {
  const b = new Box();
  b.stored = n & 15;
  try {
    b.checked++;
  } catch {
    return -1;
  }
  return b.stored;
}

export function nullishAssign(n: number): number {
  const b = new Box();
  try {
    b.checked ||= n & 15;
  } catch {
    return -1;
  }
  return b.stored;
}

export function nested(n: number): number {
  const h = new Holder();
  try {
    h.inner.checked = n & 15;
  } catch {
    return -1;
  }
  return h.inner.stored;
}

export function parenthesized(n: number): number {
  const b = new Box();
  try {
    (b).checked = n & 15;
  } catch {
    return -1;
  }
  return b.stored;
}

export function elementLiteral(n: number): number {
  const b = new Box();
  try {
    b["checked"] = n & 15;
  } catch {
    return -1;
  }
  return b.stored;
}

export function chained(n: number): number {
  const b = new Box();
  const c = new Box();
  try {
    b.checked = c.checked = n & 15;
  } catch {
    return -1;
  }
  return b.stored + c.stored;
}

export function asExpression(n: number): number {
  const b = new Box();
  let r = 0;
  try {
    r = (b.checked = n & 15) + 1;
  } catch {
    return -1;
  }
  return r + b.stored;
}

export function arrayDestructure(n: number): number {
  const b = new Box();
  try {
    [b.checked] = [n & 15];
  } catch {
    return -1;
  }
  return b.stored;
}

export function forOfTarget(n: number): number {
  const b = new Box();
  try {
    for (b.checked of [n & 15, 3]) {
      if (b.stored < 0) break;
    }
  } catch {
    return -1;
  }
  return b.stored;
}

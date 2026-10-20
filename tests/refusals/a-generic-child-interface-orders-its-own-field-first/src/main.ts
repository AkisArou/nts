// expect: NTS1001 `NumHolder` where `NumBox` is wanted
//
// A generic child interface's layout puts its own field before the
// inherited one, so the inherited fields are not a prefix of it --
// where a plain inheriting interface prefixes. `NumBox` here holds
// `extra` in slot 0 and `Box`'s `v` in slot 1, so a store of a holder
// into a `NumBox` (and onward into a `Box<number>`) is a pointer cast
// between structs that disagree about where their shared fields are,
// and lowering refuses it. The same shape first refused in
// tests/programs/inherited-interface-fields' generic arm, which now
// reads through the child types instead of upcasting.
//
// The control is `direct`: the same holder kept in a holder-typed
// local and upcast from there, which agrees. The second
// specialization is load-bearing -- with `Box<number>` alone in the
// program the ordering comes out prefixed and nothing refuses.

interface Box<T> {
  v: T;
}
interface NumBox extends Box<number> {
  extra: number;
}
interface StrBox extends Box<string> {
  extra: string;
}

class Padding {
  padding = 901;
}

class NumHolder extends Padding implements NumBox {
  extra: number;
  v: number;
  constructor(n: number) {
    super();
    this.extra = n + 1;
    this.v = n;
  }
}

class StrHolder extends Padding implements StrBox {
  extra: string;
  v: string;
  constructor(s: string) {
    super();
    this.extra = s + "!";
    this.v = s;
  }
}

export function boxes(n: number): number {
  const nums: NumBox = new NumHolder(n | 0);
  const other: StrBox = new StrHolder("s");
  const box: Box<number> = nums;
  return box.v + other.v.length;
}

export function direct(n: number): number {
  const nums = new NumHolder(n | 0);
  const other: StrBox = new StrHolder("s");
  const box: Box<number> = nums;
  return box.v + other.v.length;
}

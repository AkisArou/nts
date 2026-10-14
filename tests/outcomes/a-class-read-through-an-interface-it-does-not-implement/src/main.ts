// **A class instance read through an interface it does not implement, out of
// an `unknown`, read the wrong memory.** `Red` holds `name` second, after
// `level`; `UnreadyFace` holds it first. `unreadyName` casts its `unknown` to
// `UnreadyFace`, TypeScript accepts it, and node reads `red`. A read through
// an interface is tested against the classes that implement it and hold the
// field elsewhere -- `Unready` here -- but `Red` implements `Channel`, not
// `UnreadyFace`, so nothing tested it, and the read was `UnreadyFace`'s
// offset on a `Red`: the program crashed.
//
// **Pinned, not fixed.** Testing every such owner at every read through a
// face was measured and rejected: the flow that proves an owner reaches a
// face through `unknown` is conservative, so in the runtime modules almost
// every class reaches almost every face, and the tests grew `zlib` by
// 4.5 MB (`nts_is_class` 1,349 to 69,058). The fix is a family that reads
// `Red`'s own `name`, licensed for owners the flow proves arrive this way.
//
// The shape is `compiler/core/tests/programs/interface-fields`' `Unready`.
// Measured: with
// `Unready`'s `name` initialized, or with a third class that is a prefix of
// the face, a family dispatches the read and the program agrees on main, so
// neither is added here.
//
// **Control**: the same `Red`, read through its own class, observed first.
interface Channel {
  level: number;
  name: string;
}

class Red implements Channel {
  level: number = 0;
  name: string = "red";
  tag: number = 1;
}

interface UnreadyFace {
  name: string;
}

class Unready implements UnreadyFace {
  extra: number = 1;
  name!: string;
}

export function unreadyName(held: unknown): string {
  return (held as UnreadyFace).name;
}

export function nameThroughItsClass(held: unknown): string {
  return (held as Red).name;
}

export function make(n: number): unknown {
  if (n === 0) return new Red();
  const unready = new Unready();
  unready.name = "unready";
  return unready;
}

observe("the control, read through its own class", nameThroughItsClass(make(0)));
observe("a class laid out otherwise", unreadyName(make(0)));
done();

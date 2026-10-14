// A method an interface inherits from one it extends is callable through it.
// `interface Tagged extends Named`, `Named` declaring `label`: `tagged.label()`
// and a `Named` it was assigned to were both refused, "a method `label` with
// no declaration in the hierarchy", wherever the call had to dispatch -- with
// one implementer the call resolved to the class and never asked. The
// declaration walk followed classes' bases only and stopped at an interface;
// it now follows the interfaces an interface extends, and the slot is the one
// numbered against the interface that declares the member. Reported by the
// Wasm lane, writing a fixture for its interface rows.
interface Named { label(prefix: string): string }
interface Tagged extends Named { tag(): number }
interface Marked extends Tagged { mark(): string }
interface Shape { area(): number }
interface Sized { size(): number }
interface Both extends Named, Sized { both(): number }

class Badge implements Marked {
  label(prefix: string): string { return prefix + "badge"; }
  tag(): number { return 1; }
  mark(): string { return "!"; }
}
class Square implements Shape, Marked {
  constructor(private side: number) {}
  area(): number { return this.side * this.side; }
  label(prefix: string): string { return prefix + "square" + this.side; }
  tag(): number { return 2; }
  mark(): string { return "*"; }
}
class Plain implements Named {
  label(prefix: string): string { return prefix + "plain"; }
}
class Pair implements Both {
  constructor(private n: number) {}
  label(prefix: string): string { return prefix + "pair" + this.n; }
  size(): number { return this.n * 2; }
  both(): number { return this.n + 1; }
}
class Trio implements Both {
  label(prefix: string): string { return prefix + "trio"; }
  size(): number { return 3; }
  both(): number { return 0; }
}

// The reported shape: through the extending interface, and through the base
// it was assigned to.
export function throughBase(n: number): string {
  const tagged: Tagged = n > 2 ? new Square(n) : new Badge();
  const named: Named = tagged;
  return named.label("") + tagged.label("t") + tagged.tag();
}
// Two levels down, called through each level.
export function throughTwoLevels(n: number): string {
  const marked: Marked = n > 2 ? new Square(n) : new Badge();
  const tagged: Tagged = marked;
  return marked.label("m") + tagged.label("t") + marked.tag() + marked.mark();
}
// An interface extending two, each base's member called through it.
export function twoBases(n: number): string {
  const both: Both = n > 2 ? new Pair(n) : new Trio();
  return both.label("") + both.size() + both.both();
}
// The control: the base implemented directly beside classes reached through
// an extension, called through the base that declares the member.
export function throughTheDeclaringBase(n: number): string {
  const all: Named[] = [new Badge(), new Plain(), new Pair(n), new Square(n)];
  let s = "";
  for (const named of all) s += named.label("") + ";";
  return s;
}

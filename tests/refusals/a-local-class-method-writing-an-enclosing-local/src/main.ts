// expect: NTS1001 `value`, a name from an enclosing scope
//
// A method of a class declared inside a function assigns a local of that
// function. node answers `n`.
//
// The read twin, tests/refusals/a-class-capturing-its-enclosing-scope, has
// refused by name since a local class lowered: its member is lowered by a
// builder with no enclosing bindings. The write took a fresh binding of the
// method's own instead, which nothing reads, and this answered 0 for every
// `n`. A setter of the class, `g.amount = n`, took the same path. The place of
// a name is now one answer for a read and a write, so both refuse alike.
//
// Control: tests/programs/a-literal-method-writing-an-enclosing-local-is-a-closure,
// where the writer is a literal method, a closure with a cell.

export function afterMethod(n: number): number {
  let value = 0;
  class Gate {
    set(next: number): void {
      value = next;
    }
  }
  new Gate().set(n);
  return value;
}

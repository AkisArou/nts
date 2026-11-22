// expect: NTS1001 `value`, a name from an enclosing scope
//
// An object literal's setter, called implicitly by `hook.next = n`, assigns
// a local of the function around it. node answers `n`.
//
// An accessor is lowered by a builder of its own, which holds no binding for
// an enclosing local, and a read of `value` there was refused by name. The
// write was not: the place for a name with no binding fell through to a
// fresh binding of the accessor's own, which nothing reads, so the store
// vanished and this answered 0 for every `n` on C, LLVM and the JVM. Where a
// name lives is now one answer for a read and a write: a name declared in
// another execution, which this builder has no binding for, refuses as the
// read does.
//
// Control: tests/programs/a-literal-method-writing-an-enclosing-local-is-a-closure,
// the same write through a method called by name. A literal method that
// captures is a closure with a cell, so its write is kept and it agrees.
//
// The accessor capturing its environment the way that method does would turn
// this refusal into agreement.

export function afterSetter(n: number): number {
  let value = 0;
  const hook = {
    set next(next: number) {
      value = next;
    },
  };
  hook.next = n;
  return value;
}

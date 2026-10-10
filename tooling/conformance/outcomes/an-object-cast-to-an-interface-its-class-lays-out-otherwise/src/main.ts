// **Stops by name, where it answered wrong.** `h as Channel` from an
// `unknown`, where `Green` implements `Channel` with `extra` declared before
// `level`. Reading `level` at `Channel`'s index on a `Green` read `extra`:
// node's 9, another representation's bits on C, until 2026-10-10.
//
// Now an access through `Channel` to a field some implementing class holds
// elsewhere tests the object's class first (`hir::interface_fields`,
// `docs/interfaces-by-shape.md` Part 0): a `Red`, laid out as `Channel`,
// reads at `Channel`'s offsets and agrees, and a `Green` stops -- `refused at
// run time: `level` read through `Channel` on an object whose class does not
// hold it where `Channel` does`. A stop and not a `TypeError`, because a
// `Green` is a `Channel` to JavaScript and it is the compiler that cannot read
// it there. The access is tested, not the cast, so a `Green` cast to `Channel`
// and never read there runs. Part 2 lifts the stop: such a read goes through a
// getter each class fills, and the `Green` case then agrees.
//
// The cast's sibling is the erased join of two classes,
// `outcomes/a-field-through-an-interface-its-classes-order-differently`. Not
// an example, because the JVM declines the cast on main already: an interface
// with fields is a class there, and `Red` does not extend it. The levels are
// distinct per class, so a read of the wrong field cannot agree by a constant
// fold -- which is how an earlier probe of this shape agreed while reading
// `extra`.
interface Channel {
  level: number;
}

class Red implements Channel {
  level: number = 5;
  tag: number = 1;
}

class Green implements Channel {
  extra: number = 2;
  level: number = 9;
}

function levelOf(held: unknown): string {
  const c = held as Channel;
  return String(c.level);
}

observe("a Red through the cast", levelOf(new Red()));
observe("a Green through the cast", levelOf(new Green()));
done();

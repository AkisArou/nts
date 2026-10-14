// **Answers wrong on C: a member both arms of a union of interfaces declare,
// read on a class that holds it at another index.** `s.kind` with `s: Circle |
// Square` lowers to one shared read, `field.get.shared %0.0 over obj1 | obj3`
// (prepared HIR, main b266dc665 and Part 2 stage B's 6d43d310d alike): both
// arms put `kind` at index 0, so the read takes index 0 of whatever arrives.
// An interface arm holds any object of its shape, and `Both` fits both arms
// with `side` first -- index 0 is `side`, and nts answers 4 where node answers 3.
//
// The precondition is checked over the arms' layouts and not over the objects
// the arms hold. It is the argument stage B made for `in` ("the arms' own
// members decide only the `true` direction"), here for `SharedFieldGet`. Nor
// does `hir::interface_fields`' run-time stop see it, which is what makes a
// read through one interface on a class holding the field elsewhere stop by
// name (`outcomes/an-object-cast-to-an-interface-its-class-lays-out-otherwise`):
// that guards a read through *a* face, and this one reads through a union of
// two.
//
// **The control is `BothInOrder`**, which fits both arms too and holds `kind`
// at index 0, as the arms do. It answers 6 with node, in the same program, so
// what differs is the index and not the union, the erasure or the class.
// `Round` and `Block`, each laid out as its arm, agree as well.
//
// Fixed in the lowering: a union's structural arm holds the owners the source
// flow proves reach it, `Both` among them, and the read asks its agreement of
// all of them; where one disagrees it tests each at its own index. The record
// now pins the agreement.
//
// The JVM does not answer wrong. Its read is a chain of class tests over the
// arms' classes, `Both` is neither, and the chain ends in
// `NtsRuntime.unreachable`, which `nts check` scores as declined (probe
// `iface-union-no-in`, 12 cases declined and 17 agreed). What lifts it is the
// precondition ranging over each arm's structural owners, the set the field
// families already use, with a family read or a per-owner chain where an owner
// disagrees.
//
// Found on 2026-10-12 by the JVM lane, reviewing stage B: the JVM declined
// where C read on.

interface Circle {
  kind: number;
  radius: number;
}

interface Square {
  kind: number;
  side: number;
}

class Round {
  kind = 1;
  radius = 2;
}

class Block {
  kind = 2;
  side = 3;
}

/** Fits both arms, and holds `kind` at index 1. */
class Both {
  side = 4;
  kind = 3;
  radius = 5;
}

/** The control: fits both arms, and holds `kind` at index 0, where both arms do. */
class BothInOrder {
  kind = 6;
  side = 7;
  radius = 8;
}

function kindOf(s: Circle | Square): number {
  return s.kind;
}

const shapes: (Circle | Square)[] = [new Round(), new Block(), new Both(), new BothInOrder()];
const names = ["a Round", "a Block", "a Both", "a BothInOrder"];
for (let i = 0; i < shapes.length; i++) {
  observe(names[i]!, String(kindOf(shapes[i]!)));
}
done();

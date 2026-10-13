// run: check
// backend: jvm
//
// **Refused at run time on the JVM, by name: an interface arm read after `in`
// picked it, on a class that fits the arm and is not its class.** `area`
// takes `Circle | Square`, and `Both` fits both. Prepared HIR for the JVM
// (`--backend jvm`, which preserves field access) reads each arm as `unerase
// %0 : managed<obj#N>` then `field.get`: a `checkcast` to that arm's class and
// a `getfield`. `Both` is a third class, so whichever arm it reaches cannot
// take the cast, in every case that builds one -- 12 of 29, with 17 checked
// and agreeing.
//
// **Named at run time since `test_held_cast` (2026-10-13); the representation
// fix is stage C.** The cast used to throw `ClassCastException`. Now the
// unerase tests the value first, because `Both` holds `Circle` by shape
// without extending it (`hierarchy::held_without_extending`), and refuses it
// as `nts: refused at run time: reading a value back as \`Circle\` ...`.
// `nts check` still counts that as aborted rather than as the program
// declining its input, which is right: node answers these cases and the JVM
// cannot.
//
// **Recorded on main b266dc665, where it threw at `Square`.** Main's `in`
// folded from the arms' members, so a `Both` took the `side` branch; C read
// `side` at `Square`'s index there and answered wrong in the same 12 cases.
// Part 2 stage B (6d43d310d) tests `in` over every object type, so a `Both`
// takes the `radius` branch, and the JVM fails at `Circle` instead. On C,
// stage B's read is the accessor family's selector, `call.virtual
// Circle#nts$get$radius@interface1`, which every structural owner fills, and
// it agrees. The cases that build a `Round` or a `Block`, each laid out as its
// arm, are the control in the same program and agree on every backend.
//
// The JVM cannot read a common position across two classes the way C can
// (`blockers/union-members-lay-fields-out-differently`), and a matching index
// is not enough: probe `in-iface-agreeing` has a third class holding `read`
// where `Reader` does, and it fails the same way, as do probes
// `in-iface-chain` and `iface-reordered-arm` (all under the JVM lane's
// `mainctl/jvm-probes/probes`). With `Both` declared as `{ kind, radius }` its
// layout is `Round`'s, and the probe agrees on the JVM.
//
// What lifts it is stage C's representation: a face of fields emitted as a
// JVM interface that its structural owners implement, so the cast is to
// something `Both` is. A compile-time refusal of the unerase was measured and
// dropped: it is asked per face, and refused `examples/in-operator`'s
// `chained`, where an earlier `"duplex" in s` keeps the face's other owner
// from ever arriving.
//
// Found on 2026-10-12 by the JVM lane, reviewing stage B.

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

/** Fits both arms, laid out as neither. */
class Both {
  kind = 3;
  side = 4;
  radius = 5;
}

function area(s: Circle | Square): number {
  return "radius" in s ? s.radius * 10 : s.side;
}

export function areaOfOne(n: number): number {
  const k = ((n % 3) + 3) % 3;
  const s: Circle | Square = k === 0 ? new Round() : k === 1 ? new Block() : new Both();
  return area(s) + s.kind * 1000;
}

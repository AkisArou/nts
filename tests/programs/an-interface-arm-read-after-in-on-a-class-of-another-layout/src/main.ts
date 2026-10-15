// **An interface arm read after `in` picked it, on a class that fits the arm
// and is not its class.** `area` takes `Circle | Square`, and `Both` fits both
// while laid out as neither; `Round` and `Block`, each laid out as its arm, are
// the control in the same program. All 29 cases agree on C, LLVM and the JVM.
//
// A guard since 2026-10-15, moved from `tests/outcomes`, where it was recorded
// first as a wrong answer and then as a JVM run-time refusal:
//
// - **On main b266dc665** `in` folded from the arms' members, so a `Both` took
//   the `side` branch, and C read `side` at `Square`'s index and answered wrong
//   in the 12 cases that build one. Part 2 stage B (6d43d310d) tests `in` over
//   every object type, so a `Both` takes the `radius` branch, which C reads
//   through the accessor family's selector, `Circle#nts$get$radius@interface1`.
// - **The JVM then failed at `Circle`.** A face that carries state was a JVM
//   class, and `Both` does not extend it: the unerase was a `checkcast` that
//   threw, and from 2026-10-13 a refusal by name ("reading a value back as
//   `Circle` from a class that fits it by shape without extending it").
// - **Stage C (7364f4132) lifted it**: a face its holders do not extend is
//   split, and a value of it is referred to as `Circle$Face`, an interface
//   `Both` implements, so the read is an `invokeinterface` of the field's
//   accessor.
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

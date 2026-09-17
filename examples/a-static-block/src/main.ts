// `static { … }` in a class body.
//
// It lowered to **nothing at all** — not refused, ignored — so
// `class C { static a = 0; static { C.a = 5 } }` answered 0 where node answers
// 5, on every backend and with no diagnostic anywhere. A refusal census cannot
// see a construct that is skipped, and `nts check` reported "agreed on every
// case" for every program that did not happen to read the value back.
//
// The frontend knew the node the whole time: `syntax::name_of(176)` is
// `class static block declaration`. Only the lowering had never been told, and
// `super::unaccounted` — the conservation law that catches a construct which is
// silently absent rather than refused — does not see this one, because a static
// block declares no symbol for it to miss.
//
// # Why it belongs in the same loop as the static fields
//
// The specification runs a class's static blocks and its static field
// initialisers in **one source order**, so
//
//     class C { static a = 1; static { C.a += 1 } static b = C.a }
//
// gives `b` the value the block produced. Two loops would be two orders, and
// the arm below that says so is `fieldBlockField` — it is the only one here
// whose answer depends on the interleaving rather than on the block running at
// all.

class Simple {
  static value = 0;

  static {
    Simple.value = 5;
  }
}

/** The shape that was ignored. */
export function blockWrites(n: number): number {
  return Simple.value + n * 0;
}

class Interleaved {
  static first = 1;

  static {
    Interleaved.first += 1;
  }

  static second = Interleaved.first * 10;
}

/** A field, a block, then a field that reads what the block wrote. The arm that
 *  fails if blocks and fields run in two passes rather than one order. */
export function fieldBlockField(n: number): number {
  return Interleaved.first * 100 + Interleaved.second + n * 0;
}

class Twice {
  static value = 1;

  static {
    Twice.value *= 2;
  }

  static {
    Twice.value += 3;
  }
}

/** Two blocks: `1 * 2 + 3` is 5 and `(1 + 3) * 2` is 8, so the order is the
 *  assertion. */
export function twoBlocksInOrder(n: number): number {
  return Twice.value + n * 0;
}

class Summed {
  static total = 0;

  static {
    for (let i = 1; i <= 4; i++) {
      Summed.total += i;
    }
  }
}

/** A block is a statement list, not an expression: a loop, a local and a branch
 *  all belong in one. */
export function blockWithALoop(n: number): number {
  return Summed.total + n * 0;
}

class Branched {
  static value = 0;

  static {
    const seed = 3;
    if (seed > 2) {
      Branched.value = seed * 2;
    } else {
      Branched.value = 1;
    }
  }
}

export function blockWithABranch(n: number): number {
  return Branched.value + n * 0;
}

class Calling {
  static value = 0;

  static twice(x: number): number {
    return x * 2;
  }

  static {
    Calling.value = Calling.twice(6);
  }
}

/** A block calling a static method of its own class, which is defined by the
 *  time the block runs. */
export function blockCallingAStatic(n: number): number {
  return Calling.value + n * 0;
}

class Texts {
  static label = "";

  static {
    Texts.label = "hello";
  }
}

/** A reference field rather than a double, so the store is a pointer write. */
export function blockWritingAString(n: number): number {
  return Texts.label.length + n * 0;
}

class NoBlock {
  static first = 1;
  static second = NoBlock.first + 1;
}

/** Control: static fields with no block at all, which already ran in order and
 *  must keep doing so. */
export function staticFieldsWithoutABlock(n: number): number {
  return NoBlock.first * 10 + NoBlock.second + n * 0;
}

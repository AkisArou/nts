// **This was `blockers/an-accessor-inside-a-try`.** An accessor has a raising copy
// now, so all three arms compile and agree with node; what the file is for is the
// *boundary* rather than the refusal.
//
// `examples/accessors` opens with the sentence this is about -- "an accessor looks like
// a property and **is** a call" -- and the guard that refuses a call inside a `try` did
// not know it. That guard matched `CallExpression` and `NewExpression`; a getter read is
// a `PropertyAccessExpression`, so `try { return c.checked } catch { }` compiled, the
// throw crossed the boundary the refusal exists to name, and the program **declined 6
// of 29 cases** where node answers `-1`. A setter does the same under an assignment.
//
// Neither was reported. `emit-c` said nothing, the differential folded a decline into
// *skipped* rather than *disagreed*, and its last line read `agreed on every case`.
//
// # What each arm is for, now that all three compile
//
//     aGetterInsideATry   the read, through `Checked#get checked@raises`
//     aSetterInsideATry   the write, through `Stored#set checked@raises` -- an
//                         assignment is not a call node, so nothing keyed on one saw it
//     aFieldInsideATry    **an ordinary field in the same position**, which must keep
//                         lowering. It is the arm that fails if the guard is ever
//                         widened to every member access, and it is why this file stays
//                         beside the larger `a-throwing-accessor-inside-a-try`: that one
//                         covers the six shapes an accessor is reached by, this one
//                         covers the one shape that must not be mistaken for an accessor

class Checked {
  private readonly value: number;

  constructor(value: number) {
    this.value = value;
  }

  get checked(): number {
    if (this.value < 0) {
      throw new Error("negative");
    }
    return this.value;
  }
}

class Stored {
  public value = 0;

  set checked(given: number) {
    if (given < 0) {
      throw new Error("negative");
    }
    this.value = given;
  }
}

export function aGetterInsideATry(n: number): number {
  const held = new Checked(n);
  try {
    return held.checked;
  } catch {
    return -1;
  }
}

export function aSetterInsideATry(n: number): number {
  const held = new Stored();
  try {
    held.checked = n;
    return held.value;
  } catch {
    return -1;
  }
}

// An ordinary field read in the same position, which must keep lowering -- the
// arm that fails if the guard is widened to every member access.
export function aFieldInsideATry(n: number): number {
  const held = new Stored();
  try {
    held.value = n;
    return held.value;
  } catch {
    return -1;
  }
}

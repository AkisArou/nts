// expect: emit-jvm -> storing a `Closure0` where a `Fn__13` is declared
//
// Two closures merged into one signature-typed binding. The JVM declines it by
// name; **C and LLVM compile it and agree**, which is a pointer being a pointer
// rather than agreement, so this is the JVM as the type-confusion oracle.
//
// The cause is `Layout.base`. `relate_closures_to_signatures` gives a closure
// class the signature layout as its base only when **exactly one** layout matches
// the closure's signature key -- and its own comment is right that guessing would
// be worse ("two layouts for one signature is the case that would give two
// closures two different bases for the same type"). Where it declines to relate
// them the IR still does, so the JVM meets a store whose static types are
// unrelated and says so.
//
// **Writing both closures at the slot's own signature does not fix it**, which is
// worth recording because it was my first guess and it is wrong: `sameSignature`
// below declines too, at a *different* `Fn__N`. So the cause is not "assignability
// is not signature identity", and this fixture does not claim to have isolated it
// beyond the merge -- what is measured is that removing the merge removes the
// decline and changing the declared returns does not.
//
// **The third cause of one diagnostic.** `a-closure-outliving-its-iteration` and
// `a-closure-with-fewer-parameters-than-its-slot` pin the same NTS4001 on
// *capture* and on *arity* -- the latter because `signature_key` compares
// parameter lists, so a callback ignoring a trailing parameter gets no base. This
// is a third, and the family is worth reading together before anyone changes
// `relate_closures_to_signatures`.
//
// **Control, and it is the half that matters:** `oneClosure` is the identical
// program with the merge removed -- one closure into the same signature-typed
// binding. It compiles on every backend. One difference, and the decline goes
// away, which is what says the cause is the merge and not the signature.
//
// **What it cost before the erased-call entry:** at `a6b5f0445` this program is
// `killed by signal 11` on **C as well as the JVM**. The uniform entry turned a
// segfault into a dispatch that works wherever the representation can express it,
// and this fixture is what is left: the backend that has to name a class.
//
// Expected under node: `82 1 1`, `82 1 1`, `123 0 0`.

type Reads = () => unknown;

class Box {
  readonly v: number;
  constructor(v: number) {
    this.v = v;
  }
}

let effects = 0;

const makesABox: () => Box = () => new Box(41);
const bumps: () => void = () => {
  effects += 1;
};

// The same two bodies, written at the slot's own signature.
const makesABoxAtTheSignature: Reads = () => new Box(41);
const bumpsAtTheSignature: Reads = () => {
  effects += 1;
};

export function differentReturns(): string {
  effects = 0;
  let boxes = 0;
  let absences = 0;
  for (let round = 0; round < 3; round++) {
    const slot: Reads = round === 1 ? bumps : makesABox;
    const got = slot();
    if (got === undefined) {
      absences += 1;
    } else {
      boxes += (got as Box).v;
    }
  }
  return `${boxes} ${absences} ${effects}`;
}

export function sameSignature(): string {
  effects = 0;
  let boxes = 0;
  let absences = 0;
  for (let round = 0; round < 3; round++) {
    const slot: Reads =
      round === 1 ? bumpsAtTheSignature : makesABoxAtTheSignature;
    const got = slot();
    if (got === undefined) {
      absences += 1;
    } else {
      boxes += (got as Box).v;
    }
  }
  return `${boxes} ${absences} ${effects}`;
}

// The control: no merge. One closure, the same binding, the same call.
export function oneClosure(): string {
  effects = 0;
  let boxes = 0;
  for (let round = 0; round < 3; round++) {
    const slot: Reads = makesABox;
    const got = slot();
    boxes += (got as Box).v;
  }
  return `${boxes} 0 ${effects}`;
}

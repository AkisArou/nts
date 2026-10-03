// expect: a function that itself calls something whose `throw` cannot be carried
//
// **The other half of `examples/a-method-that-calls-a-callback-held-in-a-field-inside-a-
// try`, which that file cannot hold**: the same program with the program-global raising
// gate **off**.
//
// A call through a value is carried by `Hierarchy::raising_call_slot` or not at all, and
// that slot may only be dispatched at where *every* raising body this program would build
// can carry what it calls -- `what_holds_the_gate_off`, which is program-global
// because which closure arrives at a signature is what nobody at the site can know. So
// the two halves cannot be arms of one file: the gate is a property of the whole program,
// and a file holding both would have it off for all of it.
//
// What turns it off here is the closure's own body: it calls `Picker.pick`, a
// **generic method** that can throw, and `a_copy_can_be_made_of` excludes a method with
// type parameters of its own -- they have no instantiations to name a copy by. One such
// closure is enough.
//
// **The trigger is the perishable part of this file, and it has already expired once.** It
// was `new Thing(n)` on the argument that a `new` resolves to a `Constructor`, which was
// never eligible; the constructor boundary landed and this fixture went FIXED while the
// branch it exists to cover was untouched. So: the trigger is any callee
// `a_copy_can_be_made_of` says no to, that list is the one to read when this expires
// again, and what the file is *for* is the branch below -- not the particular callee.
//
// **It expired a second time on 2026-10-03**, with the compiler lane's #42: a generic
// *function* declaration gained raising copies, which share its specialization's
// identity, so `pick<T>` as a plain function stopped turning the gate off. The trigger is
// now a generic *method*, which #42 left excluded on purpose. The working generic-function
// shape is guarded in `outcomes/` once #42 lands.
//
// **Why this file exists at all.** Without the gate, this program was a *silent* wrong
// answer -- `nts: uncaught RangeError` on 8 of 29 cases where node answers `-1` -- and the
// refusal that replaced it is the only thing standing between the gate being off and a
// `throw` leaving a `try` that compiled. A refusal with no fixture does not fail when it
// expires, so the day someone makes a plain copy name an entry the gate withheld, this is
// what says so.
//
// The control must go on compiling, and it is the arm that keeps the rule from being "a
// `try` is refused when the gate is off": a callee that is a **declaration** has a copy to
// name, gate or no gate.

class Picker {
  pick<T>(value: T, deep: boolean): T {
    if (deep) {
      throw new RangeError("generic");
    }
    return value;
  }
}
const picker = new Picker();

class Holder {
  cb: ((n: number) => number) | null = null;
  run(n: number): number {
    const f = this.cb;
    if (f) {
      return f(n);
    }
    return n * 3;
  }
}

const held = new Holder();
// The closure that turns the gate off: it calls a generic method that can throw.
held.cb = (n: number): number => picker.pick(n, n > 5);

/** Refused: `run` calls a closure held in a field and no entry can carry its `throw`. */
export function guarded(n: number): number {
  try {
    return held.run(n & 7);
  } catch {
    return -1;
  }
}

/** The control: a callee that is a declaration, so its raising copy is named directly. */
export function throughADeclaration(n: number): number {
  try {
    return made(n & 7);
  } catch {
    return -1;
  }
}

function made(n: number): number {
  if (n > 5) {
    throw new RangeError("from the function");
  }
  return n * 4;
}

// The control for `tests/outcomes/a-class-stored-into-a-module-global`: the
// class is stored into an object's field, which `relate_tokens_to_the_slot_they_reach`
// notes, so `Ctor_C` extends the slot's layout. It differs in one thing, the
// slot, and agrees with node on every backend.

class C {}

const holder = { probe: C };

const same = holder.probe === C;

/** @param {number} n @returns {number} */
export function probeIsTheClass(n) {
  return (same ? 1 : 0) + n;
}

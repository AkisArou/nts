// `xs[xs.length] = v` grows an array for a scalar element and **aborts** for a
// counted one, in a program that compiles clean:
//
//     nts: refused: index 0 is outside [0, 0)
//
// This file holds the shapes that work and the measurements behind the ones that
// do not, because the gap is one diagnosis away from being closed and the
// diagnosis is what was wrong for a day.
//
// # The boundary, from ten arms against node
//
//     number   grows      string   aborts
//     boolean  grows      object   aborts
//                         array    aborts
//
// It does not depend on anything else that looked like it might. Annotated
// (`const xs: string[] = []`) and evolving (`const xs = []`) both abort, and so
// does a non-empty array written one past its end (`const xs = ["q"]; xs[1] =
// "ab"`). `xs.push("ab")` grows a string array correctly — so the runtime can
// do this, and only the index-write path cannot.
//
// # The obstacle is the load's *bounds*, not the slot's contents
//
// `hir::array_write_may_grow` gives the reason: `rc.rs` pairs every store of a
// value that `may_hold_a_reference` with a load of what the slot held, so the
// old reference can be released, and at `index == length` there is no such slot.
//
// Read as *"the new slot holds garbage"*, that says: give the appended slot a
// null and the load will find one. A whole change was built on that reading —
// `nts_append_slot_ref` writing the null, `holds_a_pointer` choosing which
// arrays take it, both backends picking the helper — and it worked with
// reference counting off and trapped with it on. The counted HIR says why:
//
//     %26 = array.get %2[%4] : managed<str>
//     array.set %2[%4] = %9
//     release %26
//
// The load is emitted **before** the store and with the store's own `checked`
// flag, so at `index == length` the read itself is out of range. The append has
// not happened yet, and nothing about the slot's contents is reachable.
//
// # What would close it
//
// Either a read that answers *nothing* out of range instead of faulting — the
// semantics a detached view already has, "reading one is `undefined` rather than
// a fault" — expressed as something all three backends render; or a store that
// releases the old value inside the same helper that resolves the slot, so the
// ordering is the runtime's problem and not the pass's.
//
// # How it was found, and what nearly hid it
//
// From a *control* arm — written to show that an unrelated fix had left the
// working path alone, and it had not been working. Two instruments were pointed
// at it and neither could say so. A `blockers/` fixture is compiled and never
// run, so `// expect: nothing refused` was true on the broken compiler and the
// fixed one alike. `nts check` reported `17 case(s) the compiled program
// declined` above `agreed on every case`: the abort landed in the bucket meant
// for a *caller's* broken `!` promise, which looks identical from outside.
//
// And the six probes that "verified" the counted build verified nothing.
// `NTS_RC` is read by `tooling/differential` alone — `emit-c` ignores it — so
// `NTS_RC=1 probe.sh` compiled the same program twice. The flag that changes the
// build is `--rc`, and `nts check` under `NTS_RC=1` is what finally showed it.

/** Scalar elements grow, and must keep growing. */
export function growsANumberArray(n: number): number {
  const xs: number[] = [];
  xs[0] = n;
  xs[1] = n + 1;
  return xs[0] * 10 + xs[1];
}

/** Booleans too — the other element type that takes no reference count. */
export function growsABooleanArray(n: number): number {
  const flags: boolean[] = [];
  flags[0] = n > 0;
  flags[1] = n <= 0;
  return (flags[0] ? 10 : 0) + (flags[1] ? 1 : 0);
}

/** Past the end of a non-empty array, which is the same write one slot along. */
export function growsPastTheEnd(n: number): number {
  const xs = [9];
  xs[1] = n;
  return xs[0] * 10 + xs[1];
}

/**
 * The counted case, written the way that works today.
 *
 * `push` reaches the same runtime growth without a load of the slot it is about
 * to create, which is the whole of the difference — so this arm is the evidence
 * that nothing is missing below the compiler.
 */
export function growsAStringArrayByPushing(n: number): number {
  const xs: string[] = [];
  xs.push("ab");
  xs.push("cde");
  return xs[0].length * 10 + xs[1].length + n * 0;
}

/** An overwrite of a slot that *does* hold a reference, which must release it. */
export function overwritesACountedSlot(n: number): number {
  const xs: string[] = [];
  xs.push("ab");
  xs[0] = "cdef";
  return xs[0].length + n * 0;
}

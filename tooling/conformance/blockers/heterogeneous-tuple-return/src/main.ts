// expect: emit-c --napi -> NTS2010 `nts_probe_heterogeneous` returns a tuple
//          whose elements are not all one type
//
// Now a **named refusal** rather than a conflicting prototype, which is a
// smaller claim than it looks and the honest one. The type was never the whole
// problem: the C side *builds* this value, and it builds a two-element
// `NtsArray` of references where the compiler wants a struct with two fields.
//
// The `NtsHeader *` escape that fixed `binding-returns-program-type` made both
// declarations agree here and would have let the program read struct fields out
// of an array header -- a build failure turned into a silently wrong program.
// The clang error was doing useful work; this refuses in its place and says
// why. The two cases differ by **who built the value**: `nts_async_context_get`
// hands back a pointer the program gave it and never constructs one.
//
// This fixture reported FIXED when the escape landed, and it was not fixed. Its
// own note says to read a `Tuple7` -> `Tuple8` shift as renumbering rather than
// a fix; the general form is that a fixture going green because the emitted
// *text* changed is not the defect being gone. Nothing here was asking whether
// the value was still correct, and `emits-c` cannot ask it.
//
// **`os` is where this is real**, and it is three bindings rather than one:
// `nts_os_cpus` `[string[], number[]]`, `nts_os_network_interfaces` and
// `nts_os_constants` -- all the same form, an array of columns whose columns
// have different element types, and `os.c` returns `NtsArray *` for all of
// them. Two are unreached today and will hit this the moment their callers
// lower, so a fix aimed at `nts_os_cpus` alone meets the same wall twice more.
//
// The remaining question is a *representation* one and is not settled here: a
// tuple whose elements are all pointer-sized references could be an `NtsArray`
// of references, which is exactly what the C already builds, and that would
// settle all three at once. `[string, number]` could not -- mixed storage
// genuinely needs a struct.
//
// A native function returning a tuple gets one of two completely different C
// return types depending on whether its elements happen to have the same type,
// and only one of them is a type any binding in this tree can produce.
//
//     [number[], number[]]   ->  NtsArray *        homogeneous
//     [string[], number[]]   ->  NtsObj_Tuple7 *   heterogeneous
//
// **`Tuple7` is a per-program serial, and that is deliberate.** An unrelated
// change that renumbers tuples makes this fixture print `FIXED` when nothing
// was fixed -- read a `Tuple7` -> `Tuple8` shift as renumbering, not as a fix,
// and re-point the expectation.
//
// The obvious repair is to assert the absence of the fixed form instead
// (`lacks-c NtsArray * nts_probe_heterogeneous`, which is absent today, checked).
// It is not an improvement. That form keeps holding if the fix takes any shape
// other than `NtsArray *`, and a blocker that quietly goes on reporting
// `reproduces` after it is fixed is the failure this directory spent a day on --
// five `emits-c` fixtures were in that state at once. A serial that false-alarms
// is loud and gets checked; a wrong absence is silent and does not. Prefer the
// loud direction when the two trade off.
//
// Every array-returning C function in `runtime/node` returns `NtsArray *`, so
// the second row is unimplementable: the C is correct, the declaration is
// correct, and clang rejects the pair with `conflicting types`.
//
// **This is the second blocker under `os.constants`, and it is invisible until
// the first is fixed.** `os` fails three of its seven compiled tests and all
// three are `os.constants` being undefined. The refusal that stops it today is
// `table[name] = value` at os/src/main.ts:541 -- see `computed-member-write`.
// Behind that sits `nts_os_constants(): [string[], string[], number[]]`, which
// is this. Repairing the computed write alone moves `os` from a refusal to a
// build failure rather than to green, so this fixture exists to say so before
// that happens rather than after.
//
// Two more `os` bindings have the same shape and the same problem:
// `nts_os_cpus(): [string[], number[]]` and `nts_os_network_interfaces()`, which
// is five `string[]` and two `number[]`. `nts_os_loadavg`, `nts_os_user_info`
// and `nts_os_static_information` are homogeneous and lower correctly, which is
// what makes the rule visible.
//
// Either half would settle it: lower a tuple of aggregates to `NtsArray *` at a
// native boundary the way the homogeneous case already does, or publish the
// tuple struct in a header so a binding can return one. The declarations here
// are not the problem and will not be edited to work around it.

declare function nts_probe_homogeneous(): [number[], number[]];
declare function nts_probe_heterogeneous(): [string[], number[]];

export function homogeneous(): number {
  return nts_probe_homogeneous()[1][0] ?? 0;
}

export function heterogeneous(): number {
  return nts_probe_heterogeneous()[1][0] ?? 0;
}

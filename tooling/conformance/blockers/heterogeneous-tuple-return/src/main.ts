// expect: emit-c --napi -> emits-c NtsArray * nts_probe_heterogeneous(void);
//
// FIXED, kept as a guard. **Both shapes emit `NtsArray *` now**, which is the
// type every array-returning C function in this tree already returns.
//
// A tuple whose elements are all pointer-sized references is an `NtsArray` of
// references: `[string[], number[]]` is two pointers, and a struct of two and
// an array of two are the same bytes. The array is the one a C binding can
// build, and `nts_os_cpus` builds exactly that today. Mixed *storage* still
// needs the struct -- `[string, number]` is a pointer beside a double and no
// array of one width holds both.
//
// The slots then agree on width and disagree on type, so a read restores the
// declared one: position 1 comes back as the array's element type, which is
// position 0's, and `element_of` converts it. In C that is a pointer cast and
// costs nothing:
//
//     v2 = NTS_ITEMS(v0, NtsArray *)[nts_index(v0, v1)];
//     v3 = (NtsArray *)v2;
//     v5 = NTS_ITEMS(v3, double)[nts_index(v3, v4)];
//
// On the JVM it is a `checkcast`, which the JVM lane wrote as `2b2d7adf` --
// and their diagnosis was worse than the one I asked them to check for. Two
// managed types matched `a == b` in `Convert`'s table and emitted **nothing at
// all**: a silent no-op, not a missing arm. A missing arm fails the first time
// it is reached; a no-op that type-checks does not.
//
// **This does not publish `os.cpus`.** That export has a second blocker behind
// this one -- `no wrapper for cpus: returns an object[]`, since `number[]` is
// the only array the wrapper can return -- so `os` goes from 17 names to 17.
// The Node lane priced that before this landed, which is the only reason this
// commit does not claim a module it did not move. See
// `array-return-only-carries-numbers`: 71 signatures across ten modules.
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

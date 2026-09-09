// expect: a `spread assignment` in an object literal
//
// `{ ...base, b }`. The same object built by naming its properties lowers, so
// it is the spread and not the literal:
//
//     { a, b }        -> lowers
//     { ...base, b }  -> REFUSED
//
// `control` is the control and returns the same shape, so the refusal cannot be
// read as "an object literal does not cross".
//
// **23 distinct sites: web-platform 8, fs 5, http 4, util 3, stream 3.**
// Counted as sites, not summed over module cones. This is how upstream writes
// "the same options with one field changed", so the sites are option-threading
// rather than anything exotic -- which is also why rewriting them away would be
// rewriting correct source to hide a refusal.
//
// Two smaller relatives report separately and are not this: `a `get accessor`
// in an object literal` (1 site, web-platform) and `a `method declaration` in
// an object literal` (1 site, process). All three say "in an object literal"
// and each names a different member form, so a fix for one does not imply the
// others. They are left unfiled deliberately at one site each -- a fixture per
// site would outnumber the defect.

export function control(a: number, b: number): { a: number; b: number } {
  return { a, b };
}

export function subject(base: { a: number }, b: number): { a: number; b: number } {
  return { ...base, b };
}

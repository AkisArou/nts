// An array of closures produced by a conditional -- the merge type is a
// *container* of signatures rather than a signature.
//
// Not `examples/closure-merge`, which is the other half: two arrows reaching
// one **variable**, where the hazard is which closure class the merge takes.
// Here both arms agree about the class and the missing thing is a *layout*.
//
// A signature is written on a declaration and never allocated, so nothing
// constructs one and nothing gives it a layout. `lower_branching_value` knew
// that and laid one out for a conditional whose own type is a signature --
// `cond ? () => a : () => b`. It tested `Managed(Object(_))` and nothing else.
//
// So `cond ? [() => n] : []` went unlaid. Both arms build the array at one
// signature type and the merge parameter carries another -- two type ids for
// one function type, the checker's for the declaration and the arms' for the
// literals -- and only the arms' one had been laid out. The C emitter then
// said, with no line and no name:
//
//     NTS2006 an object type with no layout: type 9
//
// on a program the lowering had reported as complete. `materialize` is the walk
// that already answers this for an array's element, a map's value and a set's
// member; the merge now uses it instead of looking only at the top level, and
// `collect_layouts` merges the two ids by shape once both exist.
//
// The arms below cover the container kinds that walk reaches, and each pairs
// the conditional with a direct construction, because an arm exercising only
// the merged spelling would pass before the fix as well.

type Fn = () => number;

// The shape the fix is for: one arm builds, the other is empty.
export function anArrayOfClosuresFromABranch(n: number): number {
  const fns: Fn[] = n > 0 ? [() => n * 2] : [];
  return fns.length === 0 ? -1 : fns[0]();
}

// Both arms build, so the element type is inferred on each side.
export function bothArmsBuildAnArray(n: number): number {
  const fns: Fn[] = n > 0 ? [() => n * 2] : [() => -7];
  return fns[0]();
}

// Called through an optional link, which is how this was found: `fns?.[0]?.()`.
export function calledThroughAnOptionalLink(n: number): number {
  const fns: Fn[] | undefined = n > 0 ? [() => n * 3] : undefined;
  return fns?.[0]?.() ?? -1;
}

// A direct construction with no conditional, as the control that the merge is
// what mattered rather than arrays of closures in general.
export function anArrayOfClosuresDirectly(n: number): number {
  const fns: Fn[] = [() => n, () => n + 1];
  return fns[1]();
}

// The signature at the top level rather than inside a container, which already
// worked -- the arm that says the fix widened the walk and did not replace it.
export function aClosureMergedDirectly(n: number): number {
  const fn: Fn = n > 0 ? () => n : () => -7;
  return fn();
}

// Two arms whose closures capture different things, so the merge cannot be
// folded away by either side being constant.
export function armsCapturingDifferentNames(n: number): number {
  const doubled = n * 2;
  const halved = n / 2;
  const fns: Fn[] = n > 1 ? [() => doubled] : [() => halved];
  return fns[0]();
}

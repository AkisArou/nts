// An empty tuple *inside* another tuple, which used to end the compile with no
// diagnostic and no file named.
//
// tsgo cannot encode the type. `newTypeResponse` reads `ObjectFlagsTuple` off
// the type and calls `AsTupleType()`, but an instantiated tuple's data is a
// `TypeReference` and the tupleness lives on its *target*, so the cast panics:
//
//     interface conversion: checker.TypeData is *checker.TypeReference,
//     not *checker.TupleType
//
// tsgo recovers and returns that as a rejected request; our side turned the
// rejection into a fatal error, so a compile of ordinary TypeScript stopped
// with a Go stack trace instead of a diagnostic.
//
// # The precondition is the nesting, not the destructuring
//
// The census recorded this as *"4 files, `assignment/dstr/*nested-array*`"* and
// minimised it to `[[x]] = [[]]`, which put the subject on nested destructuring
// assignment. The declaration below has no destructuring in it and fails the
// same way, and a bare `const e: [] = []` --- the same empty tuple, not nested
// --- is accepted. What the top-level spelling has is `types_at`, which
// bisects a failed batch and degrades one poisonous node to `None`; this path
// had no such degradation, so the same upstream failure was fatal here and
// invisible there.
//
// Five shapes reached it, through three different requests:
//
//     const nest: [[]] = [[]]           getTypeArguments
//     [[x]] = [[]]                      getTypeArguments
//     [[x, y]] = [[]]                   getTypeArguments
//     ({ a: [x] } = { a: [] })          getTypesOfSymbols
//     import.defer('./x.js')            getSymbolsAtLocations  (a separate cause)
//
// # Why this is a refusal and not an empty tuple
//
// The tempting answer is `Tuple(vec![])`: the failing program *does* contain an
// empty tuple, so it would look correct here. It would also give every other
// tuple whose encoding fails the wrong arity, silently. `Unknown` is what is
// actually known, and lowering refuses it by name.
//
// Lifting this belongs upstream --- the cast should test the target's flags ---
// and until then the refusal is the honest answer. The controls that must keep
// working are in `examples/`: a bare empty tuple, a one-element tuple, a
// two-element tuple, and a nested *non-empty* tuple all lower.

const nest: [[]] = [[]];

export function reachesIt(): number {
  return nest.length;
}

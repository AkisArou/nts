# Recording mutation HostConfig

The first host kernel uses a single physical `HostNode` record for containers,
instances and text. Its `kind` field preserves the logical distinction while
all child traversal uses one native layout. Props are ordered `HostProp`
records whose values are the checked union `string | number | boolean | null`.

The Node oracle passes 12 scenario checks covering mount, reorder, update,
visibility, removal, rejected reparenting and clear. The NTS C backend also
compiles and executes a 15-check version of the same kernel. Its HIR contains
19 functions with nothing refused.

Two adaptations were required and remain useful constraints for generated
renderer code:

- Three structural node interfaces initially produced 11 HIR refusals because
  their common fields had different offsets. One record removed all of them.
- A literal array containing props with different value variants initially
  reached HIR as `Array<Erased>` where `Array<HostProp>` was required. Passing
  each literal through a typed `HostProp` constructor gave the array one stable
  element representation and made C emission succeed.

The materialized profile module currently supplies 47 of the 164 runtime
bindings imported from `ReactFiberConfig`. Another 117 disabled capability
bindings are generated as typed trapping functions, so an incorrect feature
flag or reachability decision fails loudly. Thirteen of 24 imported types are
mapped to concrete host types; the remaining 11 disabled-feature types are
temporarily opaque.

The seven added core bindings implement host update priority and the
no-host-resource suspended-commit contract. These were reached by the exact
upstream bundle; leaving them as traps prevented ordinary commits and Suspense
fallbacks.

This is enough to validate the mutation data structure and ABI shape. It is
not yet an end-to-end React renderer: React element props still need a checked
heterogeneous representation and a type-directed adapter into `HostProp[]`.

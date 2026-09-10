# React semantic overrides

This directory is reserved for small, handwritten adaptations that cannot be
expressed as mechanical Flow-to-TypeScript rules or NTS intrinsics.

Every override must name the upstream path and commit, explain the semantic
reason, and have a differential conformance test. Generated TypeScript must not
be edited to make a compile pass.

`manifest.json` is consumed by the normalizer. Each entry is guarded by the
exact upstream source hash, so an upstream edit stops generation until the
override is reviewed. Type-only corrections must also pass the normalizer's
runtime-syntax equivalence check after TypeScript annotations are stripped.

The first three overrides restore six Flow special `this` parameters discarded
by Hermes' Babel adapter. Upstream types all six as `$FlowFixMe`; the manifest
uses the exact runtime record or interface initialized/received at each site.
This avoids turning 75 receiver operations into unchecked `any` while adding no
runtime operation.

Constructor-function assertions retain the function's checked `typeof` and add
only a construct signature whose argument tuple comes from `Parameters` of that
same function. `FiberRootNode` also uses a construction-state receiver because
its `current` field is null only while the root is being initialized.

`react-base-class-signatures` handles an upstream file which is intentionally
plain JavaScript rather than annotated Flow. It types the `Component` and
`PureComponent` implementation receivers, heterogeneous values, updater
contract and prototype methods. Its type-only assertion gives
`ComponentDummy` the constructor shape used by the existing prototype setup.
The development-only deprecation table retains its two-string tuple value and
gives its local warning helper a contextual signature.
The public generic `Component<Props, State>` surface will be provided by the
typed React module facade; this override describes the upstream runtime
implementation boundary.

`react-noop-update-queue-signatures` covers the other intentionally plain
JavaScript half of that contract. A variable annotation contextually types the
updater object's function expressions, and a direct signature types the private
warning helper. State remains a checked `ReactValue`; component, callback and
caller-name parameters use their concrete structural types. Its development
warning cache is explicitly string-keyed, and component constructor metadata
contains only the name fields that warning path reads.

`react-instance-map-signatures` gives the intentionally plain JavaScript
instance map a generic structural contract. The generic keeps each public
instance's `_reactInternals` field tied to its concrete internal value type, so
callers retain a monomorphic `Fiber` instead of crossing an erased boundary.

`post-paint-callback-storage` removes a Flow annotation whose `any | callback`
union collapses to `any`. The module's complete dataflow stores only the typed
callback parameter, so its array retains that concrete callable type.

`class-component-updater-context` supplies the structural updater interface at
the object literal where upstream carries two missing-local-annotation
suppressions. Contextual typing then recovers both callback types from the same
contract used by the public base class.

`scheduler-profiling-state` restores the concrete union types of two module
variables which Flow evolves across function boundaries. Both are nullable
native storage objects; neither crosses a heterogeneous value boundary.

`devtools-hook-contract` replaces the upstream DevTools bridge's deliberately
erased `Object` surface with the exact methods reached by this reconciler
profile. The hook arguments remain opaque React values, while method presence,
renderer identity and call signatures are checked structurally.

`fiber-tree-search-state` and `component-stack-affixes` restore concrete types
for uninitialized module scratch state which Flow evolves across calls. The
former stores nullable Fibers; the latter stores strings or its initial
`undefined` state.

`async-action-mutable-thenables` restores callback element types for two empty
listener arrays and describes the extra storage React preallocates on pending
thenables before their status transition. The broader shared `Thenable` API is
left unchanged.

`scheduler-host-loop-state` restores the callable type of the host-loop entry
initialized by Scheduler's exhaustive transport selection. The optional
`setImmediate` probe has a narrow ambient host signature beside the other
profile globals.

The normalizer also moves detached type-only overloads next to their
implementations, as TypeScript requires, without moving runtime statements in
the stripped program. The stronger `isArray` predicate remains coupled to the
React union-narrowing cleanup; it is not claimed as complete by an override.

`react-jsx-element-runtime` supplies the fixed structural contract omitted from
the intentionally plain JavaScript JSX implementation. Element/config/props
containers are concrete; only individual prop, owner and debug payload values
cross `ReactValue` boundaries.

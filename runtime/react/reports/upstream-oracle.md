# Exact-source upstream oracle

`tools/upstream-oracle.mjs` bundles the mechanically normalized, specialized
runtime from the commit in `upstream.lock.json`. It applies the upstream client
shared-internals fork, redirects only `ReactFiberConfig` to the recording host,
and uses a finite JavaScript props projection for the host types in the corpus.
No npm React runtime is used.

The current bundle reaches 100 inputs after primitive link-time constant
propagation and runs eight deterministic scenarios:

- function component mount, text children and unmount;
- keyed deletion, movement and insertion;
- state, reducer and context updates;
- layout/passive effect ordering and cleanup plus host refs;
- class state, lifecycle and class refs;
- a pending Suspense fallback;
- upstream `_c/useMemoCache` ownership, hit and invalidation; and
- the actual recovered output of the pinned React Compiler.

The checked JSON report contains normalized trees, ordered mutation names and
effect/lifecycle observations. These are the expected results for the future
native and JVM run of the same scenario entry. Suspense retry, concurrent
interruption, transitions and error recovery remain explicit missing cases;
the report does not claim them from the fallback-only scenario.

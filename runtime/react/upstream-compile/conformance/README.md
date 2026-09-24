# Differential conformance plan

The recording host is the observable boundary. Each test runs an equivalent
component and update sequence with upstream React and with each NTS backend,
then compares the final tree, ordered mutation log, render count, effect log
and captured error.

| Area | Minimum cases | Current executable evidence |
| --- | --- | --- |
| element/children | text, arrays, fragments, null/boolean, keys | upstream oracle covers elements/text/keys; native host kernel covers operations |
| reconciliation | mount, prop update, insertion, move, deletion, clear | upstream oracle records keyed update; host operations pass Node and NTS C |
| functions/classes | render, state update, lifecycle, refs | upstream oracle covers both component kinds and ref attach/detach |
| hooks | state, reducer, memo, callback, ref, layout/passive effect | upstream oracle covers state/reducer and both effect phases |
| context | nested providers, changed/unchanged values | upstream oracle covers provider update and consumer render |
| Suspense/transitions | suspend, retry, fallback, interrupted render | upstream oracle covers pending fallback; retry/interruption pending |
| errors | render/commit/effect errors and recovery callbacks | pending |
| React Compiler | cache hit/miss, invalidation, nested control flow, outlined functions | goldens, source-range recovery, `_c(6)` execution and NTS HIR entry |

`npm run conformance:upstream` bundles the mechanically generated exact-source
runtime, substitutes the recording HostConfig and records eight passing
scenarios in `reports/upstream-oracle.json`. Local tests may reduce a failing
upstream case, but the pinned upstream implementation remains the oracle once a
backend can execute the same entry.

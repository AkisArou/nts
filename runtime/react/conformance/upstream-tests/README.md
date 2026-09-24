# Upstream React's tests, run against this runtime

Compatibility is not something we judge ourselves. It is upstream React's own
test suite, run unmodified against our packages.

Upstream already has a mode that runs its tests against built packages
(`scripts/jest/config.build.js`, used by `yarn test --build`). It skips
`*-test.internal.js` files, so the files it runs exercise public behaviour
only. `jest.config.cjs` is that configuration with one change: `react`,
`react-noop-renderer` and `scheduler`, together with their subpaths, resolve to
the arm under test. Test files, `internal-test-utils`, `jest-react` and every
package we do not implement stay upstream's own.

```sh
runtime/react/tools/setup-upstream.sh          # once: clone, install, build the control
npm --prefix runtime/react install              # the lane's toolchain and workspaces
node runtime/react/tools/build-js.ts           # emit this runtime for the harness
node runtime/react/conformance/upstream-tests/run.ts --arm upstream   # control
node runtime/react/conformance/upstream-tests/run.ts --arm stub       # control
node runtime/react/conformance/upstream-tests/run.ts --suite scheduler --mode production
node runtime/react/conformance/upstream-tests/run.ts --update         # accept the ledger
```

Suites are `reconciler` (the default), `scheduler` and `react`, each an
upstream `__tests__` directory with a ledger of its own. Extra arguments
narrow a run to matching test files; a narrowed run never writes a ledger.

## Buckets

Each test has one row in `ledger/<suite>.<mode>.json`, and a run prints its diff
against that ledger. Only the diff says what changed; a total cannot say which
test moved.

- **In scope:** the test file uses only packages this lane implements.
- **Out of scope `[out:react-dom]` etc.:** the file requires another renderer
  or the server packages. It is recorded, but it counts toward neither side.
- **`gated-*`:** upstream's `@gate` inverts a test whose feature is off in the
  stable channel. The test must fail, and it reports `passed` when it does, so
  any broken implementation passes it. The stub arm found 260 of these. They
  are recorded and never counted as passing.

## Controls (2026-09-24, upstream 1d34f91d, reconciler suite)

| Arm | In scope passed | failed | pending | gated | out of scope |
| --- | ---: | ---: | ---: | ---: | ---: |
| upstream, development | 594 | 0 | 19 | 286 | 21 |
| upstream, production | 567 | 0 | 19 | 313 | 21 |
| stub, development | 1 | 593 | 19 | 286 | 21 failed |
| stub, production | 1 | 566 | 19 | 313 | 21 failed |

In both modes the one test the stub passes is `ReactIsomorphicAct-test.js ::
behavior in production`. In development its body is empty. In production it
asserts that `React` has no `act`, which an empty module satisfies.

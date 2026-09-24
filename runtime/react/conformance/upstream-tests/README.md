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
- **Out of scope `[out:react-dom]` etc.:** the file requires another renderer,
  the server packages, React's server-components build
  (`react/react.react-server`) or the noop server renderers. It is recorded,
  but it counts toward neither side. The classification is per file, so
  `ReactOwnerStacks-test.js`, which mixes client and server cases, is out of
  scope as a whole.
- **`gated-*`:** upstream's `@gate` inverts a test whose feature is off in the
  stable channel. The test must fail, and it reports `passed` when it does, so
  any broken implementation passes it. The stub arm found 260 of these. They
  are recorded and never counted as passing.

## Controls and this runtime (reconciler suite, upstream 1d34f91d)

| Arm | Mode | In scope passed | failed | pending | gated |
| --- | --- | ---: | ---: | ---: | ---: |
| upstream | production | 557 | 0 | 19 | 309 |
| upstream | development | 580 | 0 | 19 | 286 |
| stub | production | 1 | 556 | 19 | 309 |
| stub | development | 1 | 579 | 19 | 286 |
| **this runtime** | production | **557** | **0** | 19 | 309 |
| **this runtime** | development | **580** | **0** | 19 | 286 |

The one test the stub passes is `ReactIsomorphicAct-test.js :: behavior in
production`. In development its body is empty; in production it asserts that
`React` has no `act`, which an empty module satisfies.

Across every upstream package (`--suite all`), each in-scope test that fails
here also fails under upstream's own build. Those are the nested-Jest
`ReactClassEquivalence`, the DevTools `ReactHooksInspection`, and
`react-refresh/babel`, which the control does not build.

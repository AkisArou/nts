# Staged case identities

Issue #767, 2026-11-12. The wide run at verified `87a6dc508790` was held when
integrity sent its first materialised outcome's scratch path to caseIdentity.
Its source label was still present in `scan(project)`, but `run(args)` replaced
it with the last execution argument. Every outcome takes that staging route.

The lease now receives the source project explicitly. The compiler arguments
and scratch ownership are unchanged. caseIdentity still rejects absolute or
traversing paths outside its source root. There is no new identity field,
outside-path exception or history-format change.

The control runs the real collector, token pool and case-memory broker with a
fake compiler and supplied memory observations. A private staged mutation
restores the old context expression and is refused before any compiler starts.
Two independent staging roots then run all four listings each, using the same
source key; the second run reads the first run's history. The compiler still
receives the distinct scratch paths. Existing outside-path refusal controls
remain in case-memory.test.ts.

The staging sweep follows the token request, rather than assuming every file
that mentions scratch has a case lease:

| Reader or step | Execution staging | Lease identity |
| --- | --- | --- |
| integrity | Outcome materialised by outcomes-project | Source project from scan; fixed here |
| program-oracles | Materialised outcomes, controls, sweep projects and oracle snapshots | Task subject, mapped before dispatch |
| test262 and TypeScript compiled census | Harness materialisation and worker-local outputs | Planner's original case path |
| typescript-oracles | Captured oracle mirror/output | Original selected TypeScript case path |
| check-consumers, including benchmarks | Generated or captured project configuration | entry.fixture, falling back to its original project |
| blockers pool | Worker-local fixture driver and outputs | tests/refusals/name/tsconfig.json |
| benchmark build records | Resolved compiler project and output per lane | cell.path and backend |
| C compile, LLVM assembly and JVM verification | Generated emissions, driver and build outputs | Original project passed to the worker |
| JVM verifier-driver compilation | Run-local Java driver source | tooling/conformance/JvmVerify.java |
| agree | Pins and comparison views | tests/programs/example/tsconfig.json |
| types, definitions and compile-time listings | Listings/counters/output only | Original module or project |
| all.sh token.sh callers | Shell work/output directories | Explicit source script or original input tsconfig via --case/--case-last |

Sequential outcome-recording and auxiliary probe helpers also stage sources,
but do not acquire a per-case token and therefore do not call caseIdentity.
No second request deriving its identity from a materialised scratch path was
found in the pooled entry points above.

Commands:

```sh
node --test tooling/gate/integrity-case-identity.test.ts tooling/gate/case-memory.test.ts tooling/gate/test-timing.test.ts
```

The focused collector, supervision, memory and timing proof passes 29 tests.
Host ownership checks 1,869 sources, 253 closures and 412 reads. The strict
project checks 810 modules with no new diagnostics. The wide-run confirmation
is the full check's next integrity execution after this change lands.

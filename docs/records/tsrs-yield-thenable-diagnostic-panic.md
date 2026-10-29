# Pristine checker panic for an async generator yielding an invalid thenable

The native checker panics while reporting an ordinary JavaScript type error.
This reproduces without any capture queries, using only SDK `open`, an explicit
`Files` scope containing `main.js`, and `finish`. No vendor change or panic
recovery is applied.

The checker is tsrs 0.19.0 at
`bb5c6037ad04decdd7c5832997e810000e85943d`, porting TypeScript
`3e9236361fa97a9e6c685f4833ac457ae2d8c50a` (7.1.0-beta).

`main.js`:

```js
const thenable = { then(resolve, reject) { resolve(reject); } };
async function* g() { yield thenable; }
g().next();
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noImplicitAny": false,
    "target": "ESNext",
    "module": "ESNext",
    "noEmit": true,
    "skipLibCheck": true,
    "types": []
  },
  "files": ["main.js"]
}
```

Build and run the committed SDK diagnostic instrument:

```sh
cargo build --profile nts-dev -p nts-frontend-tsrs --example diagnostics
target/nts-dev/examples/diagnostics /absolute/path/tsconfig.json --checkers 1
target/nts-dev/examples/diagnostics /absolute/path/tsconfig.json --checkers 4
```

Both commands exit 101 at
`third_party/tsrs/crates/tsrs_checker/src/checker_10.rs:1590:18`:

```text
called `Option::unwrap()` on a `None` value
```

The call unwraps `get_yielded_type_of_yield_expression(...)`. The unpatched
TypeScript checker at the exact 3e commit reports TS1321 instead: the yield
operand must be a valid promise or have no callable `then` member. The old
7.0 Go checker also reports TS1321. The unpatched 3e source checkout is clean;
its `--version` reports 7.1.0-beta. The `noImplicitAny: false` option removes
unrelated implicit-parameter diagnostics from both controls.

The one-change control replaces `yield thenable` with `yield 1`. It exits 0
with an empty diagnostic vector on native checker counts 1 and 4, and both Go
controls accept it.

The full semantic-code audit encountered the same site in these two positive
Test262 cases:

- `test/language/expressions/async-generator/yield-thenable-create-resolving-functions-reject.js`
- `test/language/expressions/async-generator/yield-thenable-create-resolving-functions-resolve.js`

This prevents a complete semantic-code audit on the current checker pin;
these inputs are unmeasured, rather than omitted from the population. The
separate phase-import capture-query defect and four named refusals for
unpaired UTF-16 semantic names are independent of this diagnostic panic.

Raw source, configs, exact argv, exit status, stdout and stderr are preserved
under `~/.cache/nts-scratch/tsrs-lane/checker-audit/yield-upstream/`, in
`results.json` and `sdk-example-results.json`. The latter records the SDK
instrument's binary hash; its source checkpoint is `db6127807`.

## Latest-upstream replay and carried recovery

The latest upstream main was fetched and independently verified as
`a0db53eabe483062205717f067a49b6ccb3fc868`, tree
`edc8c0fce72fc768adf4ff8e58e5476c3f1eecea`. Its TypeScript pin is unchanged.
The pristine SDK instrument built from nts source
`3472c0ea4816fa8d4066d3971e60702dc4eecf16` has SHA-256
`ec360f7862f91e0e6cc4b0dcd54143df8ce2151ed0598f195ee5d7e43f6d6fb3`.
It reproduces both materialised Test262 crashes and the minimal subject at
checker counts 1 and 4; `yield 1` remains clean. Exact commands, complete
output and provenance are in
`~/.cache/nts-scratch/tsrs-lane/upstream-a0db-unpatched-replay1/`.

The user authorized a temporary local semantic repair after this latest-first
replay. The reviewed patch is
`compiler/frontend-tsrs/patches/yield-thenable-diagnostics-and-check-state.patch`,
SHA-256 `31522736dd21d79d6c655aee82fdeeef2c35b00f0564cad1718615c8d1917840`.
Its base, reason and removal condition are in the adapter's `patches.json`;
the generated `UPSTREAM.json` discloses the carried patch, and `MANIFEST`
hashes the actual patched bytes. The adapter exports the patch identity to
the CLI and raw diagnostic instrument, so checker-bound evidence cannot
confuse this build with pristine upstream. Changing the upstream pin requires
an explicit applicability or removal review.

The checker calls the yield diagnostic routine unconditionally, then appends
only a present inferred yield constituent. It retains TS1321 and leaves
next-type collection and traversal outside that conditional. This is explicit
Rust error recovery that preserves valid constituents and subsequent errors.
The Go single-constituent nil fallback explains the minimal case; it does not
establish general mixed-error inference equivalence. Permanent SDK controls
cover both valid/invalid yield orders, valid yields surrounding an invalid
one, a subsequent TS2322, contextual next types, valid promise and thenable
yields, a delegated-yield neighbor and a synchronous control.

The second patch hunk adds a read-only completed-file observation: `try_get`
reads existing checker state without computation or insertion. This preserves
the scoped-diagnostics work guard after upstream made the storage private;
counting requested paths or filtered diagnostics would not prove that default
libraries were left unchecked. Patched controls and the complete raw audit
remain required before checker-bound records can be re-pinned.

Remove the semantic hunk independently when an official equivalent passes
those controls and the complete raw audit. A remaining need for the read-only
test observation is not a reason to retain the semantic change.

The invalid delegated neighbor is a separate upstream bug, outside this
ordinary-yield repair:

```ts
const bad = { then(resolve, reject) { resolve(reject); } };
async function* g() { yield* [bad]; }
g().next();
```

With strict checking and `noImplicitAny: false`, pristine a0db panics at
`utilities.rs:24:44` (`message.unwrap()`), on checker counts 1 and 4 without
capture queries. The exact unpatched TypeScript 3e executable also nil-panics;
TS1322 is not an established oracle result for this input. Replacing `bad`
inside the delegated array with `1` is clean on both checkers. The permanent
in-scope guard uses that valid delegated control; the invalid reproduction
remains named upstream backlog and is not counted as passing or as TS1322.
Full source, configs, argv, output and statuses are retained in
`~/.cache/nts-scratch/tsrs-lane/upstream-a0db-patched-validation3/delegated-isolation/results.json`.

## Public object-flag getter qualification at a0db

The adapter's public `Type::object_flags()` reads seed flags on frozen shared
types, whereas the former private `get_lazy()` read checker overlay flags.
The adapter asks only for `Reference`, `NonInferrableType` and `EvolvingArray`.
The source audit found 39 `object_flags.set` sites in the checker closure.
The writes that can set or copy these three bits initialize newly allocated
types; writes to an existing type preserve them while changing lazy memo bits.
This establishes equality only for those queried bits, not for every flag.

| Write family | Source locations in the a0db checker |
| --- | --- |
| New types, initialization, or construction-time propagation (23 sites) | checker.rs:2147; checker_03.rs:376,2014; checker_04.rs:2838; checker_05.rs:2747; checker_07.rs:78,85,88,569,1066,1197; checker_08.rs:3032; checker_09.rs:378,1252,1411,1415,1481,2116; checker_11.rs:2006; checker_12.rs:2472,2644; checker_14.rs:550; jsx.rs:1093 |
| Existing types, preserving queried bits while changing memo flags (16 sites) | checker_09.rs:4074,4133; checker_10.rs:2251; checker_11.rs:732,737,1512,1839,1852; checker_12.rs:2237,2666; checker_13.rs:3983,3990,4003; checker_14.rs:382,435; relater_1.rs:1449 |

`EvolvingArray` is selected at `new_object_type` construction. The class or
interface `Reference` write happens in `get_declared_type_of_class_or_interface`
before that fresh type's initialization completes; the links set earlier in
that function support recursion within the same construction. A shared seed
is frozen after construction, rather than midway through that function.
`NonInferrableType` writes initialize the checker intrinsic or newly created
anonymous, widened or instantiated types. The remaining writes alter member,
weak-type, genericity, normalization, unknown-like, enum, and relation memo
families. Shared-graph semantic and lifetime controls must still pass on the
new source before accepting this public getter adaptation.

## Focused patched validation

On nts source `bfe47788d8a96cd88086dac6528034fcdbcb047a`, all 77 active
SDK tests and six lifetime documentation tests pass. The existing shared-graph
child control now includes public type/reference/argument/member/signature
facts and compares one/four checkers across shared-graph and Rayon modes;
it passes with the explicit mode-note assertion retained. Strict workspace
Clippy over all targets passes in the `nts-dev` profile.

The sealed focused raw instrument has SHA-256
`8d1a7c74c32d1bc1341496d7c33c8d2603258b4463cbcd9d0786d2556362dabe`.
The minimal subject reports exactly TS1321 and exits 2; its `yield 1` control
is clean and exits 0. Both original materialised Test262 cases now complete
with TS1321 exactly once. Their other diagnostics are retained: reject has
three TS7006 and two TS2339, resolve has two TS7006 and two TS2339. Each
case's complete owned diagnostic vector is identical at checker counts 1
and 4. Exact commands, build logs, source and patch provenance, raw output
and full-vector checks are in
`~/.cache/nts-scratch/tsrs-lane/upstream-a0db-patched-validation8/`.

Earlier attempts remain separate evidence: the first found ambiguous empty
integer-vector test assertions; the second found the incorrect widened-number
expectation for a retained `1 | 2` union; the third found the upstream delegated
neighbor above; the fourth passed SDK units but documentation testing failed
on an absent launcher `TMPDIR`. The fifth's whole default-assumption suite
under a shared-graph environment failed on its added informational mode note,
which is why the permanent mode-aware child guard is the relevant comparison.
The sixth and seventh found strict lint issues in generated-identity writing
and a test literal, respectively. None is relabelled as a passing run.

The subsequent complete raw audit measured all 47,504 cases with zero
unmeasured or unread cases: 42,909 positives and 4,595 negatives. Its source
is the same `bfe47788d` checkpoint, with the a0db upstream and explicit
`31522736` patch identities above. The sealed release instrument has SHA-256
`fa536fe1145423c5bc417d76f020ed61e4c09866e07d80677ea06ace7624d6ba`.
The population is exactly the prior bb5 audit's population. All 47,502
previously measured per-case code sets are unchanged; the two previously
unmeasured rows now complete with TS7006, TS1321 and TS2339. The eight current
semantic early-error codes still have zero positives; their negative counts
are TS2364:267, TS2357:12, TS1108:12, TS2487:5, TS2652:4, TS2323:2, TS2661:1
and TS2701:1. No semantic-code allowlist change follows from this audit.

Full results, raw logs, build and patch provenance, exact commands and the
path-by-path comparison are under
`~/.cache/nts-scratch/tsrs-lane/checker-audit-a0db-patched-bfe4/`.
The separate evidence-override re-audit finds two previously unlisted TS1005
positive paths and four previously unlisted TS1127 positive paths, all Unicode
identifier cases already present in the old bb5 raw audit. TS1109's positive
paths are unchanged and no listed path is stale. Those entries require
classification before their checker-bound pin changes; the audit is not
permission to edit the records or their thresholds without that evidence.

## Microsoft's released TypeScript 7.0.2 on the same family

On 10-29 the coordinator ran the official TypeScript 7.0.2 package (the
repository's catalog pin, `node_modules/.bin/tsc --version`) on seven
async-generator bodies, each in a checked JavaScript file with the
configuration above plus `strict`, and a probe
`/** @type {number} */ const probe = g();` that prints the inferred
generator type. `thenable` is the object above; `other` is a second
callable-`then` object.

| body of `g` | TypeScript 7.0.2 |
|---|---|
| `yield thenable;` | TS1321; `AsyncGenerator<never, void, unknown>` |
| `yield thenable; yield other;` | TS1321 twice; `AsyncGenerator<never, void, unknown>` |
| `yield 1; yield thenable;` | nil-pointer panic in `getUnionTypeEx` |
| `yield thenable; yield 1;` | nil-pointer panic in `getUnionTypeEx` |
| `yield "s"; yield thenable; yield 1;` | nil-pointer panic in `addTypesToUnion` |
| `yield* [thenable];` | nil-pointer panic creating the TS1322 diagnostic |
| `yield 1;` (control) | `AsyncGenerator<number, void, unknown>` |

The single-invalid case is clean in Go only because `AppendIfUnique` keeps
one nil constituent and a one-element union returns it unchanged; any mix
with a valid yield reaches the union code and panics. The defect is
therefore TypeScript 7's own, and tsrs ported it faithfully. For mixed
bodies there is no TypeScript 7 result to match: the carried repair keeps
the valid constituents, which is a recovery choice, not an established
oracle result. The cases and raw output are under the coordinator's job
directory (`tmp/yield-oracle/`).

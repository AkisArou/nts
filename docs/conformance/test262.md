# Test262: protocol, scope, and NativeTS prerequisites

This document records the intended Test262 conformance protocol. The
tooling-only part now exists: pin-checked discovery, metadata parsing, strict
scheduling, source-unit assembly plans, host declaration assets, a mock adapter,
verdict logic, and deterministic report types. It does not compile or run a
Test262 case. The NativeTS execution adapter, script initializer, host
implementation, and representation-recovery pass do not exist yet.

The suite is pinned locally at commit
`d86b2294eb0a17eaa281ff12c73c473ec864c72f`.

## Scope at the pin

| corpus | test files | required variants |
| --- | ---: | ---: |
| all `.js` files, including fixtures | 53,872 | — |
| `_FIXTURE.js` module dependencies | 294 | never standalone |
| standalone tests | 53,578 | 102,918 |
| ECMA-402 / `Intl` | 3,357 | 6,714 |
| NativeTS ECMA-262 scope | **50,221** | **96,204** |

One file may require two variants, which is why variants outnumber files.
At this pin, 4,238 standalone files select one variant and 49,340 use the
default two; the ECMA-402 files all use two variants.
NativeTS does not implement `Intl`, and Test262 explicitly permits an
implementation without ECMA-402 to exclude `test/intl402`. That scope exclusion
must be recorded rather than mixed into the ECMA-262 conformance percentage.
Staging tests outside ECMA-402 remain part of the ECMA-262 inventory.

The metadata parser must still read all 53,578 standalone files. Parser
correctness is independent of whether the selected compiler profile implements
a feature used by a test.

## Initial lane: strict global scripts

NativeTS will initially focus only on global scripts executed with a
`"use strict";` directive. This is an intentional scheduled subset, not a claim
of full-file Test262 conformance.

At the pinned commit, the ECMA-262 inventory divides as follows after normalizing
both flow-style and multiline YAML flag lists:

| scheduling bucket | files | initial action |
| --- | ---: | --- |
| default scripts | 45,983 | run the injected strict variant only |
| `onlyStrict` scripts | 678 | run |
| **initial strict-script lane** | **46,661** | one variant per file |
| `noStrict` scripts | 2,687 | scope-excluded |
| modules | 843 | scope-excluded |
| raw tests | 30 | scope-excluded |

Modules are inherently strict, but they are not global scripts with an injected
directive and require a different loader and resolution protocol. Raw tests
forbid source modification. Neither belongs in this first lane. An `async` flag
does not remove a test from the strict lane; it adds a capability requirement,
so the test remains scheduled and reports `unsupported` until the async host can
execute it.

The runner must name this result `strict-pass`, or otherwise qualify it as a
strict-variant result. It must not collapse one passing strict variant into a
full Test262 file pass when the file's default metadata also requires a sloppy
variant. Sloppy scripts, raw tests, and modules may be reconsidered later
without changing metadata parsing, variant identity, or the report schema.

## The oracle is Test262

A positive Test262 case is self-checking. It completes normally on success and
usually throws through an assertion on failure. A negative case declares the
exact phase and exception constructor it expects. The test body, harness, and
metadata are therefore the oracle.

Node may be run as an optional diagnostic control for the runner, but Node's
exit code, stdout, or agreement with NativeTS never determines a Test262
verdict. In particular:

- two implementations rejecting a case at different phases is not a pass;
- a generic compiler refusal cannot satisfy an expected JavaScript exception;
- an expected `SyntaxError` cannot be satisfied by a runtime `TypeError`;
- a missing host capability cannot pass merely because another host also lacks
  it.

The result vocabulary must distinguish `pass`, `fail`, `unsupported`,
`inapplicable`, `scope-excluded`, `timeout`, `crash`, and
`infrastructure-error`. A file passes only when every variant required by its
metadata passes. In the initial lane, `strict-pass` deliberately reports only
the scheduled strict variant and is not promoted to that full-file result.

## Metadata drives execution

Test262 metadata is YAML embedded in a `/*--- ... ---*/` block. For example:

```yaml
flags: [onlyStrict]
negative:
  phase: runtime
  type: ReferenceError
```

The execution-relevant fields are:

- `flags`, which select strictness, scripts versus modules, raw source, and
  asynchronous completion;
- `includes`, which name additional files in `harness/` and preserve their
  listed order;
- `negative.phase` and `negative.type`, which define an expected failure;
- `features`, which describe required language or host capabilities.

The runner rejects both the wrong revision and a locally modified checkout. Its
parser matches Test262's bundled `monkeyYaml`/`parseTestRecord.py` behavior.
Validation compares the normalized metadata and extracted test-body hash for
every standalone file. Malformed metadata, an absent include, a dirty checkout,
or the wrong suite commit is an infrastructure error, never an implicit default
or skip.

The production parser implements this small Test262 YAML dialect directly in
Rust rather than inheriting the larger and subtly different behavior of a
general YAML library. It handles mappings, nested mappings, flow and multiline
lists, folded and literal text, integer and float scalars, and continuation
lines exactly as `monkeyYaml.py` defines them. Test262's Python parser is a
validation oracle used in tests; it is not a runtime dependency of the Rust
tool.

### Worked strict-negative flow

Suppose a test contains:

```js
/*---
flags: [onlyStrict]
negative:
  phase: runtime
  type: ReferenceError
---*/

undeclared = 1;
```

For NativeTS, the flow is:

1. The parser returns `flags = {onlyStrict}` and the exact negative expectation
   `{runtime, ReferenceError}` while retaining a hash of the extracted body.
2. The strict scheduler emits one stable variant ID ending in `#strict`; it does
   not create a sloppy variant.
3. Assembly initializes the host profile, resolves any listed includes, and
   retains the test as a separate unit with prefix `"use strict";\n`.
4. A future adapter compiles those units and returns structured compile/run
   events. Here the expected trace is compile success followed by a runtime
   `ReferenceError`.
5. Verdict logic compares both fields and emits `strict-pass`. Normal completion,
   a parse-phase `ReferenceError`, a runtime `TypeError`, or an unaudited
   compiler refusal does not pass; the last is `unsupported`.

This is why YAML is control data, not merely a skip list, and why comparing
process exit codes is insufficient.

## Variants and source units

Every variant runs in a fresh realm. Unless a flag says otherwise, a test is a
global script and runs twice:

1. the original non-strict source;
2. a strict variant with exactly `"use strict";\n` inserted at the beginning of
   the **test source**.

The other flag rules are:

- `onlyStrict`: one strict script variant;
- `noStrict`: one non-strict script variant;
- `module`: one module variant, inherently strict, without adding the script
  directive;
- `raw`: one unchanged script source with no Test262 harness or injected strict
  directive;
- `async`: the ordinary strictness rule plus asynchronous completion handling.

For a non-raw test, the logical evaluation order is:

```text
host equivalent of harness/assert.js
host equivalent of harness/sta.js
host equivalent of harness/doneprintHandle.js    only for async
metadata includes            in listed order
test source
```

The three default harness entries may be equivalent profile-owned host
initializers rather than JavaScript source units. Metadata includes and the test
remain separate source units evaluated in one realm. They must not be
concatenated into a function or CommonJS wrapper: that changes global script
semantics, strict-directive reach, parse phases, and declaration visibility.
`_FIXTURE` files are resolved as module dependencies and are never initialized
as independent tests. Harness and host modifications belong to the test realm,
not to the fixture module source.

## Positive, negative, and asynchronous verdicts

A positive synchronous variant passes only after successful parse/resolution,
successful compilation, and normal execution. An assertion or any other
uncaught exception fails it.

A negative variant passes only when the actual result matches both declared
fields:

- `parse`: parsing or early-error checking produces the declared constructor;
- `resolution`: module resolution produces the declared constructor;
- `runtime`: evaluation produces an uncaught exception of the declared
  constructor.

Completing normally, failing in a different phase, producing a different
constructor, or refusing an otherwise valid construct cannot pass. Compiler
diagnostics may satisfy parse or resolution metadata only through an audited
mapping to the corresponding ECMAScript phase and error constructor.

An async test also loads `doneprintHandle.js` and does not pass on ordinary
process exit. It waits for the Test262 completion message, fails on the failure
message, and times out when no completion arrives. NativeTS should eventually
implement this on the deterministic microtask host rather than parsing
arbitrary stdout as a verdict.

## Tooling architecture and parallel-work boundary

The protocol tooling can be built before representation recovery or script
lowering and without modifying compiler or runtime code. It should remain in
the existing `nts-suite` crate so this work does not edit the root workspace
manifest currently shared with other efforts. The existing numeric harvester
remains a separate command and result type.

The tooling is divided into six layers:

1. **Discovery and pin validation** enumerate the suite deterministically,
   reject the wrong commit, identify fixtures, and read exact source bytes.
2. **Metadata parsing** returns a typed `TestRecord` plus the exact body span and
   hashes; it does not decide whether NativeTS supports the test.
3. **Scheduling** applies the strict-script policy and capability inventory to
   produce explicit `VariantPlan` values or a reasoned exclusion.
4. **Assembly planning** retains harness files, includes, and the test as ordered
   source units. It records the strict prefix on the test unit without writing a
   combined wrapper file.
5. **Execution adapters** accept a plan and return structured compile and run
   events. A mock adapter supports protocol tests now; the real NativeTS adapter
   is added only when the compiler exposes the required script interface.
6. **Verdict and reporting** compare structured events with positive or negative
   expectations and emit stable JSON plus a human summary.

The protocol model contains stable, serializable values equivalent to:

```text
TestRecord
    suite-relative path
    source hash and body hash
    flags, includes, features
    optional negative { phase, type }

VariantPlan
    stable test and variant ID
    strict-script execution mode
    required capabilities
    expected outcome

AssemblyPlan
    host profile identity
    ordered SourceUnit[] and hashes

CompileEvent / RunEvent
    success, diagnostic, exception, timeout, or crash
    ECMAScript phase where applicable
    exception constructor identity where applicable

Verdict
    strict-pass, fail, unsupported, inapplicable,
    timeout, crash, or infrastructure-error

UnscheduledResult
    scope-excluded or unsupported, with a reason code
```

Paths in reports are suite-relative, collections are sorted, and no temporary
build path appears in stable output. Every exclusion and unsupported result has
a machine-readable reason code; unknown flags or features are never silently
ignored.

### Checker-facing harness declarations

The tooling owns a synthetic ambient declaration asset for the profile-provided
Test262 host. It declares `Test262Error` and its `thrower`, callable `assert`
and its standard methods, `compareArray` and the formatting helpers exported by
the default harness, `print`, `$DONE`, `$DONOTEVALUATE`, and the typed `$262`
shape. Known assertion extensions supplied by metadata includes are also typed,
but the include remains responsible for initializing them. Arbitrary values use
`unknown`, never `any`, and `$262` has no open-ended string index signature.

Declarations provide checker types only. A separate host-contract manifest maps
each declaration identity to a stable intrinsic ID and required capability.
The future compiler adapter consumes that contract; the tooling must not teach
the compiler to recognize names such as `assert` or `$262`. Unsupported host
members remain declared when needed to typecheck discovery, but scheduling
prevents execution unless their capability is implemented.

This asset replaces only the default host functions for which Test262 permits
an equivalent implementation. Ordinary `includes` remain original JavaScript
source units and are not rewritten, annotated with JSDoc, or replaced merely
because they are difficult to compile.

### Tooling completed before compiler integration

The independent tooling can:

- validate the pin and inventory;
- parse and normalize every standalone file;
- reproduce the strict scheduling counts above;
- resolve and hash every metadata include used by the strict-script lane;
- print the exact ordered source-unit plan for any test;
- validate positive, negative, timeout, crash, and capability verdict logic
  through a scripted mock adapter; and
- write deterministic JSON reports.

Module fixtures are deliberately not resolved in this first lane because all
modules are scope-excluded. Fixture graph resolution belongs to the later module
adapter and does not change the record, plan, event, or report types.

The command surface is:

```sh
cargo run -p nts-suite --no-default-features --bin nts-test262-protocol -- \
  inventory third_party/test262

cargo run -p nts-suite --no-default-features --bin nts-test262-protocol -- \
  plan third_party/test262 \
  test/language/expressions/tagged-template/template-object.js
```

`inventory` fails on the wrong git revision, a dirty checkout, or malformed
metadata. `plan` first performs that same full validation, then prints either a
reasoned scheduling exclusion or the host profile, ordered include/test units,
hashes, capabilities, negative expectation, and exact strict prefix. Source
text is intentionally not copied into stable plan JSON.

No compiler refusal can be measured as Test262 support during this milestone.
The adapter seam is complete when swapping the mock for a future NativeTS
driver requires no change to parsing, scheduling, assembly, or verdict code.

## NativeTS architecture required by the runner

### Ordinary JavaScript and `NeedsRepresentation`

Test262 receives no typing exception. It consumes the compiler-wide JavaScript
source policy described in [`../any-unknown.md`](../any-unknown.md).

An unannotated parameter may have TypeScript checker type `any`, but its runtime
value enters the frontend-only `NeedsRepresentation` flow. Whole-program
evidence and operation requirements must resolve it to concrete
representations, direct-call specializations, or a deliberately supported
union/erased representation before HIR. The verifier admits no `Any`, unresolved
representation, or generic dynamic operation into HIR or MIR.

This is general compiler functionality shared by application JavaScript,
declaration-originated `any`, and `unknown`; it is not a Test262 mode that makes
`any` executable. Test sources are not rewritten with JSDoc. Raw tests remain
byte-for-byte unchanged, and other tests receive only the source
transformations prescribed by Test262.

### Script execution

NativeTS currently lowers function bodies, not a complete global script. The
runner requires a real ordered script initializer that executes top-level
statements and shares declarations across harness, include, and test units. A
wrapper function is not equivalent. Reflective global-object behavior may
remain unsupported until the runtime has a global object, but statically
resolved script bindings still require correct declaration and execution order.

### Harness and host boundary

Test262 permits implementations to replace harness functions with equivalent
functionality. NativeTS may provide typed, profile-owned identities for
`Test262Error`, `assert`, `assert.sameValue`, `assert.notSameValue`, `print`, and
supported `$262` operations. They must be recognized by trusted declaration
identity, never by a spelling such as `assert` that application code could
reuse.

Ordinary metadata includes remain unmodified JavaScript source units. A missing
runtime feature in an include makes the case unsupported; the include is not
silently omitted. `assert.throws` remains unsupported until the runtime can
invoke a callback and catch its exception.

The process result must preserve an uncaught exception's constructor type in a
structured side channel. Exit code and stdout alone cannot distinguish an
assertion failure from an expected runtime `ReferenceError` or a native crash.

Host APIs such as realms, agents, dynamic script evaluation, detached buffers,
GC control, and reflective global access must each report a stable unsupported
capability until implemented. Reachable runtime-generated code follows the
finite-source AOT policy in [`../eval.md`](../eval.md); arbitrary runtime source
is an explicit AOT inapplicability. Source-text scanning is not sufficient
because reachability matters.

## What exists today

The standards-facing implementation is
`tooling/suite/src/test262_runner/`, exposed by the
`nts-test262-protocol` binary. It has no dependency on a NativeTS compiler or
runtime API and does not modify either subsystem. Normal unit tests cover the
parser dialect, scheduling, safe include resolution, assembly, mock adapter,
exact negative verdicts, and deterministic reports. Explicit whole-corpus
audits are available with:

```sh
cargo test -p nts-suite --no-default-features --lib \
  pinned_corpus_matches_the_documented_strict_inventory -- --ignored
cargo test -p nts-suite --no-default-features --lib \
  every_strict_lane_include_resolves_at_the_pin -- --ignored
cargo test -p nts-suite --no-default-features --lib \
  rust_metadata_matches_test262s_parser_for_the_whole_pin -- --ignored
```

The last audit compares normalized metadata and extracted body hashes for all
53,578 standalone files with Test262's bundled Python parser. Python is a test
oracle only; the Rust command has no Python or general-purpose YAML dependency.

`tooling/suite/src/test262.rs` is an expression harvester, not a Test262 runner.
It extracts closed numeric expressions, feeds them through the constant folder,
and compares their values with Node. That remains useful as a differential test
of arithmetic and compile-time folding, but it does not execute Test262's
harness, metadata, variants, negative expectations, or realms and must not be
reported as Test262 conformance.

The real execution adapter should be added only after the first general
`NeedsRepresentation` path and top-level script initializer can execute a
non-vacuous synchronous slice. Until then, no compiler refusal can be promoted
to a Test262 verdict; once connected, a generic refusal remains `unsupported`
rather than manufacturing a negative-test pass.

The intended first directory inventory is all 11,102 standalone files under
`test/language/expressions` plus the ten files under
`test/built-ins/Math/sqrt`: 11,112 files and 21,306 full-protocol variants. The
strict-script lane schedules **10,455** of those files, one strict variant each;
588 `noStrict` tests and 69 modules are scope-excluded. Normal pull-request CI
needs only runner self-tests and a small pinned protocol smoke manifest; larger
conformance reports are advisory until coverage is broad enough to set a
meaningful gate.

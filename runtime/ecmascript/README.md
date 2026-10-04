# Shared ECMAScript builtins

Date, Temporal and Intl architecture, implementation stages and validation are
tracked in [DATE-TEMPORAL-INTL.md](DATE-TEMPORAL-INTL.md). Their calendar/exact-time
core shares TypeScript semantics; ICU providers supply typed data primitives.
Date, Instant and Duration now own their state in typed private fields and check
their supported API against the pinned TypeScript libraries. The type audit in
that document records the remaining RegExp facade rewrite and compiler gaps for
canonical Temporal unions. Host results do not establish that public exports
compile under NTS's typed object model. No WeakMap is needed for these values.

Intl number options now normalize in shared TypeScript and produce the same ICU
configuration on C and JVM. Currency precision uses pinned provider data;
formatting reuses its state and buffers. PluralRules shares the digit algorithm
and supports cardinal/ordinal selection, notation, exact inputs and ranges.
ListFormat and RelativeTimeFormat have typed implementations and pinned providers.
Provider/shared assembly probes execute on C, LLVM, JVM and both native memory
modes. Complete standard bindings and public conformance remain in progress.

## Regexp

The parser, matcher and builtin algorithms have one TypeScript source for native
and JVM targets. JVM execution needs no JNI, Java regex engine or C library.
Compiler binding to the standard `RegExp` and String builtins belongs to the
compiler/backend lanes. Core imports provide the emitted-code integration API;
the generic builtin facade is currently validated on the host.

`src/regexp/engine.ts` exports `compile`, `execute`, `RegexProgram` and
`RegexRunner`. A program owns compiled instructions, character sets and capture
metadata. A runner owns reusable matching buffers. `NtsRegExp` creates a runner
per instance; clones can share code but keep separate runners and `lastIndex`.
The standalone `execute` entry point creates its own runner.

Matching uses an explicit backtracking stack and an undo trail for captures and
repeat registers. Instructions, ranges, stacks and trails use typed arrays.
There is no recursion during matching. Pattern parsing and compilation still
recurse over nested grammar constructs. Literal prefixes use the backend's
string search primitive, and ASCII folding bypasses Unicode decoding.

The implementation supports `dgimsuvy`, UTF-16 offsets, named and numbered
captures, forward references, lookahead and lookbehind, scoped `ims` modifiers,
Unicode properties and `v` set operations and finite strings. Builtin algorithms
cover construction, `exec`, `test`, `escape`, the six regexp symbol methods and
the associated String methods. Captures are allocated to their known size;
builder arrays still use `push` during compilation and for results whose length
is unknown. Backtracking does not copy all capture registers at each choice.

## Unicode data

`../c/quickjs/REVISION` and its vendored Unicode files are the canonical data
source. `tools/generate-unicode.ts` derives the regexp subset through a small
build-time C adapter. It normalizes ranges to `[0, 0x110000)`, deduplicates encoded
payloads and represents composite emoji properties through their components.
The checked-in generated module is 191,394 bytes with 378 shared payloads.
Decoding allocates exact-size typed arrays and caches them per compilation.

```sh
node runtime/ecmascript/tools/generate-unicode.ts
node runtime/ecmascript/tools/generate-unicode.ts --check
```

A C compiler is needed to regenerate or verify data, not to run it on JVM.
The generator is TypeScript and uses Node's built-in APIs. There is no Python
tooling or second Unicode revision to maintain. MIT and Unicode notices are in
`third_party/`.

The generated TS data and C header are two representations of one pinned source.
A native program using both the existing C String case-conversion code and this
regexp implementation can contain overlapping Unicode data. This change does
not claim that one binary copy exists. Removing that overlap requires migrating
String case conversion to shared Unicode primitives or a backend data ABI; that
must be coordinated with the compiler/runtime lane.

## Validation

Test262 supplies the grammar and builtin conformance tests. The host adapter in
`tooling/conformance/ecmascript/test262.ts` consumes the existing metadata
protocol and the pinned checkout. It adapts regexp literals to construct this
implementation, loads it in each test's realm and runs Test262's original harness
and assertions. It also binds the six String methods to the shared algorithms.
Its verdict is `host-pass`, not compiled builtin conformance. Global `eval` is
adapted; direct-eval lexical scope and the `$262` realm host are not implemented.
Lexical/JavaScript parse negatives outside the regexp grammar are explicitly
reported as unsupported.

```sh
pnpm exec tsc -p runtime/ecmascript/tsconfig.json
node tooling/conformance/ecmascript/test262.ts
node tooling/conformance/ecmascript/test262.ts --under test/language/literals/regexp
node tooling/conformance/ecmascript/test262.ts --under test/built-ins/String/prototype/match
node tooling/conformance/ecmascript/test262.ts --under test/built-ins/String/prototype/replace
node tooling/conformance/ecmascript/test262.ts --under test/built-ins/String/prototype/search
node tooling/conformance/ecmascript/test262.ts --under test/built-ins/String/prototype/split
```

`--rows` selects a JSONL report, `--filter` selects a path substring, and
`--timeout` sets a per-unit execution limit. Counts retain failures and scheduler
exclusions. Prefix selection includes `matchAll` with `match`, `replaceAll` with
`replace`, and `RegExpStringIteratorPrototype` with `RegExp`.

The sabotage control must fail with exit code 1 and a null-result assertion:

```sh
node tooling/conformance/ecmascript/test262.ts --sabotage --filter /S15.10.2.8_A1_T2.js
```

The small emitted-code fixture tests the integration boundary: parser execution,
captures and assertions, Unicode decoding, emoji string tries and folding.
It is supplementary to Test262, not a second conformance corpus.

```sh
NTS_BACKEND=c NTS_TSGO=target/tsgo target/release/nts check tooling/conformance/ecmascript/compiled/tsconfig.json
NTS_BACKEND=jvm NTS_TSGO=target/tsgo target/release/nts check tooling/conformance/ecmascript/compiled/tsconfig.json
```

Inspect the CLI output as well as its status: `nts check` can return success
after refusing an export. No function refusal is acceptable for this fixture.
Hostile out-of-range inputs to scalar helpers can be declined and are reported
separately by the differential harness.

Validation at Test262 revision `14e8c908e54ae2e770e473bcacf536f8cb654929`:

| Slice                     | Host passes | Failures | Unsupported | Scheduler exclusions |
| ------------------------- | ----------: | -------: | ----------: | -------------------: |
| `built-ins/RegExp` prefix |       1,874 |       21 |           0 |                    1 |
| Regexp literals           |         220 |        1 |          19 |                    0 |
| String match/matchAll     |          76 |        0 |           0 |                    0 |
| String replace/replaceAll |          98 |        0 |           0 |                    2 |
| String search             |          43 |        0 |           0 |                    0 |
| String split              |         120 |        0 |           0 |                    0 |

C and JVM each agreed on all 62 reached differential cases, with no refused
exports. Their compiler binary fingerprint was `ddec06c004727691`; 17 hostile
cases were declined and the harness did not reach its entire 203-case pool.
The always-no-match sabotage failed the positive Test262 lookahead control.
Remaining host failures are described below; they are retained in the reports.

Host measurements are reproducible with
`node tooling/conformance/ecmascript/bench.ts 5000`. On this workspace, prefix
search and buffer reuse reduced the literal-search sample from about 5.7 to
0.2 microseconds per execution. Native Node was about 0.05 microseconds. Capture
repetition and lookbehind remain substantially slower than native Node. These
measurements concern hosted TS and do not establish native/JVM throughput.

## Compiler and JVM handoff

Bind standard literals and dynamic constructors to this same parser and program
representation. An invalid dynamic pattern throws `SyntaxError`; literal syntax
errors remain frontend early errors. A compiler may precompile a literal to the
same instruction/data format later. Do not introduce a second matching engine.

The generic facade uses `Reflect.apply`, dynamic species construction and
unchecked constructor casts. These conflict with the fixed-layout boundary in
`docs/conformance/typescript.md` §13. Replace the production facade with typed
operations and direct calls while retaining the parser, matcher and reusable
buffers. Bind supported default builtin paths to those operations; the compiler
must not recreate excluded metaobject behavior to accommodate the host facade.
Host validation does not establish that the public exports compile unchanged.

Builtin lowering must provide:

- Regexp instance branding through the normal class/descriptor machinery.
  Replace existing constant-false handling of `instanceof RegExp` when the
  representation lands.
- Mutable `lastIndex`, ordered coercion and global/sticky reset rules. `exec`
  does not advance an empty match; the String algorithms do when required.
- Match arrays with `index`, `input`, `groups` and optional `indices`. Named maps
  use typed dictionaries, unmatched entries are `undefined`, and named index
  entries share the same pair objects as numbered entries. Metadata and entries
  use intrinsic creation, without invoking inherited setters.
- Supported String operations, typed replacement callbacks, iterators and regexp
  errors. Direct default construction does not need dynamic species dispatch.

The host source currently does not reproduce native object descriptors,
prototype poisoning immunity or `$262` realms. Those remain visible failures,
including the `lastIndex` descriptor, inherited setters on match-array metadata,
the RegExp object tag and iterator ancestry/tag descriptor. The project's
metaobject boundary is documented in `docs/conformance/typescript.md` §13; these
host results must not be advertised as full ECMAScript engine conformance.

Run the compiler lane's ordinary Test262 runner after builtin binding. The host
adapter cannot establish that standard syntax reaches the emitted matcher.

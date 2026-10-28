# Encoding conformance: UTF-8 and UTF-16 source policy

This PR stacks on [global-error handlers PR #43](https://github.com/AkisArou/nts/pull/43),
`chatgpt/global-error-handlers` at `f52f77a56294c30f79ef804b654deb514279012c`. It imports the Encoding WPT
API cases and fixes specification policy in `src/core/encoding.ts` and
`src/core/encoding-streams.ts`. Byte loops remain straightforward TypeScript for
replacement by the maintainers' native SIMD implementation.

**The new Encoding WPT run is 3,812 pass, zero fail, 255 named dependency blocks.
The full package gate is not green:** its ordinary `node:test` phase passes,
but the older upstream runner reports eleven descriptor failures after the
required removal of production descriptor reflection. Its `async_test` path
cannot currently apply named exclusions. The exact failures and the reverted
profile-only trial are recorded below; no tooling workaround ships.

## Measurement identity

The final executable candidate measured on 2026-10-28 is local commit
`008c2857795431fe8053929b882bd92bb083bb37`, tree `5ef5ea4de3497c5693aff723033c3116c2531c29`. The PR description records the published
same-tree commit mapping. These results belong to that source candidate;
maintainers still compile and gate the eventual landed artifact.

The environment was Node **24.20.0** and pnpm **10.15.0**. The current contribution
rules were read from `main` at `d283612e`. Machine-readable counts, exact dependency
names, paired Node results and log SHA-256 values are in
[`encoding-results.json`](encoding-results.json). Source hashes identify the
measured bytes independently of commit publication:

| File | SHA-256 |
|---|---|
| `runtime/web-platform/src/core/encoding.ts` | `aabbcd2f424bfa867c32c38a87967ed7adbe6d898765fe49f5d6cd31844d2849` |
| `runtime/web-platform/src/core/encoding-streams.ts` | `c4081845c15f16a1c9d37533b7e565568727cd84a1e0449c6a188e61532c64df` |
| `runtime/web-platform/test/wpt/encoding-manifest.json` | `0491c0563810c4e3b29a99bc80e31b100f6583a495214a814933582d4d70d271` |
| `runtime/web-platform/test/wpt/versions.json` | `c8c6d1ab7ed34627207192bfc1ed6fb9727f1d50ca9bf974029272047d352e3a` |

## Specification and changes

The algorithms follow the [Encoding Standard](https://encoding.spec.whatwg.org/):
[`TextDecoder.decode`](https://encoding.spec.whatwg.org/#dom-textdecoder-decode),
[UTF-8 decoder](https://encoding.spec.whatwg.org/#utf-8-decoder),
[shared UTF-16 decoder](https://encoding.spec.whatwg.org/#shared-utf-16-decoder),
[`TextEncoder`](https://encoding.spec.whatwg.org/#interface-textencoder),
[`TextDecoderStream`](https://encoding.spec.whatwg.org/#interface-textdecoderstream)
and [`TextEncoderStream`](https://encoding.spec.whatwg.org/#interface-textencoderstream).
Web IDL defines [operation invocation](https://webidl.spec.whatwg.org/#es-operations),
[buffer-source conversion](https://webidl.spec.whatwg.org/#es-buffer-source-types),
[copying buffer-source bytes](https://webidl.spec.whatwg.org/#dfn-get-buffer-source-copy)
and [DOMString conversion](https://webidl.spec.whatwg.org/#es-DOMString).

Separate source commits address these boundaries:

- Receiver branding occurs before argument conversion in `encodeInto()` and
  `decode()`, so an invalid receiver cannot run an argument's observable getter
  or conversion first.
- Buffer validation precedes decode options conversion; the byte-copy step
  follows that conversion. A detached `DataView` yields an empty sequence.
  Resizable/growable buffers are rejected where the IDL lacks `AllowResizable`.
- Decoder state uses actual private slots. An ordinary property with a former
  implementation-field name cannot reset UTF-8 continuation state, UTF-16
  pending bytes/surrogates, or BOM state.
- Fatal streaming errors retain a copied input queue. A later call can consume
  unprocessed bytes; invalid UTF-8 continuation bytes and the UTF-16 unit after
  an unmatched lead surrogate are restored as the algorithms require. UTF-16
  restoration also works when a code unit straddles calls. Discarded output
  from a throwing call does not commit new BOM-serialization state; previously
  committed BOM state survives.
- `TextEncoderStream` uses DOMString conversion, rejecting a primitive Symbol
  instead of applying the special Symbol-description behavior of `String()`.
  `TextDecoderStream` converts its label before its options dictionary and
  preserves a label-conversion exception's identity.
- All four classes declare their string tags plainly. Production prototype and
  descriptor patching is removed under the fixed-layout contribution rule.

Existing byte-loop behavior remains covered: replacement characters, overlong
UTF-8, surrogate input, invalid continuations, byte order, split BOMs, repeated
calls, empty chunks, final flush, fatal error propagation and stream backpressure.
`utf-16` remains the UTF-16LE label; BOM bytes do not choose a different decoder.
There is no new optimized byte engine, platform fallback, dependency, or global
bootstrap mutation.

## Pins, fixtures and isolation

| WPT directory | Revision | Use |
|---|---|---|
| `encoding/` | `1ac8deee082ecfb5d3b6f9c56cf9d1688a2fc218` | All 29 selected fixture files and three Encoding helpers |
| `common/` | `dbd648158d337580885e70a54f929daf215211a0` | Shared `sab.js` and `subset-tests.js` |
| `resources/` | `6a2f32237615d7ea9c1eb1e30453066b5555c603` | Existing upstream harness references for the original adapter |

The pins are Node's [v24.20.0 directory revisions](https://github.com/nodejs/node/blob/v24.20.0/test/fixtures/wpt/versions.json).
The [Node Encoding status file](https://github.com/nodejs/node/blob/v24.20.0/test/wpt/status/encoding.json)
provides comparison context, including its ISO-2022-JP state issue,
ISO-8859-16 limitations and browser-only omissions. Those broad Node exclusions
are not copied over the runnable UTF cases here.

The copied bytes retain their upstream headers and root BSD-3-Clause license;
files that originally had no individual header remain unedited. Each blob was
checked against the upstream Git tree as well as the vendored Node copy.
[`encoding-manifest.json`](encoding-manifest.json) owns area selection, exact
names and registration bounds. The central [`versions.json`](versions.json)
records one revision per imported directory and hashes for every copied file:
**16 directories, 260 copied files and two upstream harness references** across
the full stacked adapter. The two common helpers are added at the existing pin;
no common/resources revision is upgraded and no second copy is introduced.
Two integrity controls check consistency and exact bytes.

Each fixture executes in a fresh `node:vm` context with the package's canonical
four Encoding classes and Streams classes, through the ordinary-node provider.
No host codec or host MessageChannel is installed. Genuine implementation-realm
ECMAScript buffer constructors make input brands consistent across the VM boundary.
The unchanged `common/sab.js` uses host `WebAssembly.Memory` only to obtain a real
SharedArrayBuffer constructor; this provides test inputs, not evidence for native
WebAssembly, concurrent shared-memory mutation or compiled shared-memory support.

The `api-invalid-label.any.js` query helper receives an empty search, so all
**3,421** registrations from its four declared query variants run in one file.
Rejecting an invalid label does not prove support for its underlying valid codec.

## Per-file results

Each cell is **pass / fail / blocked**. “Raw baseline” executed every imported
case against #43 with exclusions disabled. “Scoped baseline” used the exact
named dependency blocks shipped in the manifest. “Final” is the corrected source
candidate above. The unchanged WPT cases do not expose the new source-policy
regressions; those have separate before/after controls below.

| File under `encoding/` | Raw baseline | Scoped baseline | Final |
|---|---:|---:|---:|
| `api-basics.any.js` | 6/0/0 | 6/0/0 | 6/0/0 |
| `api-invalid-label.any.js` | 3421/0/0 | 3421/0/0 | 3421/0/0 |
| `api-replacement-encodings.any.js` | 6/0/0 | 6/0/0 | 6/0/0 |
| `api-surrogates-utf8.any.js` | 6/0/0 | 6/0/0 | 6/0/0 |
| `encodeInto.any.js` | 110/1/0 | 110/0/1 | 110/0/1 |
| `textdecoder-arguments.any.js` | 3/0/0 | 3/0/0 | 3/0/0 |
| `textdecoder-byte-order-marks.any.js` | 3/0/0 | 3/0/0 | 3/0/0 |
| `textdecoder-copy.any.js` | 2/0/0 | 2/0/0 | 2/0/0 |
| `textdecoder-eof.any.js` | 2/0/0 | 2/0/0 | 2/0/0 |
| `textdecoder-fatal-streaming.any.js` | 2/0/0 | 2/0/0 | 2/0/0 |
| `textdecoder-fatal.any.js` | 36/0/0 | 36/0/0 | 36/0/0 |
| `textdecoder-ignorebom.any.js` | 4/0/0 | 4/0/0 | 4/0/0 |
| `textdecoder-labels.any.js` | 15/207/0 | 15/0/207 | 15/0/207 |
| `textdecoder-streaming.any.js` | 32/0/0 | 32/0/0 | 32/0/0 |
| `textdecoder-utf16-surrogates.any.js` | 10/0/0 | 10/0/0 | 10/0/0 |
| `textencoder-constructor-non-utf.any.js` | 43/36/0 | 43/0/36 | 43/0/36 |
| `textencoder-utf16-surrogates.any.js` | 7/0/0 | 7/0/0 | 7/0/0 |
| `streams/backpressure.any.js` | 4/0/0 | 4/0/0 | 4/0/0 |
| `streams/decode-attributes.any.js` | 26/2/0 | 26/0/2 | 26/0/2 |
| `streams/decode-bad-chunks.any.js` | 5/0/0 | 5/0/0 | 5/0/0 |
| `streams/decode-ignore-bom.any.js` | 12/0/0 | 12/0/0 | 12/0/0 |
| `streams/decode-incomplete-input.any.js` | 2/0/0 | 2/0/0 | 2/0/0 |
| `streams/decode-non-utf8.any.js` | 6/7/0 | 6/0/7 | 6/0/7 |
| `streams/decode-split-character.any.js` | 11/0/0 | 11/0/0 | 11/0/0 |
| `streams/decode-utf8.any.js` | 10/2/0 | 10/0/2 | 10/0/2 |
| `streams/encode-bad-chunks.any.js` | 6/0/0 | 6/0/0 | 6/0/0 |
| `streams/encode-utf8.any.js` | 19/0/0 | 19/0/0 | 19/0/0 |
| `streams/readable-writable-properties.any.js` | 2/0/0 | 2/0/0 | 2/0/0 |
| `sharedarraybuffer.https.html` | 1/0/0 | 1/0/0 | 1/0/0 |
| **Total WPT registrations** | **3812/255/0** | **3812/0/255** | **3812/0/255** |

The final driver reports **4,097 `node:test` entries: 3,842 pass, zero fail,
255 skip**, including enclosing suite/file tests. These wrapper entries are not
extra WPT cases. A restricted subprocess run reported only a file-level pass;
it is excluded from evidence. Official runs used normal subprocess access and
reported all registrations; their per-file counts also match an independent
direct adapter run.

## Native and compiler dependencies

The **252 named legacy decoder blocks** consist of 207 label cases, 36 constructor
cases, two stream-attribute cases and seven stream decoder/error cases. The
canonical encodings awaiting native capabilities are:

- **Single-byte:** `IBM866`, `ISO-8859-2`, `ISO-8859-3`, `ISO-8859-4`, `ISO-8859-5`, `ISO-8859-6`, `ISO-8859-7`, `ISO-8859-8`, `ISO-8859-8-I`, `ISO-8859-10`, `ISO-8859-13`, `ISO-8859-14`, `ISO-8859-15`, `ISO-8859-16`, `KOI8-R`, `KOI8-U`, `macintosh`, `windows-874`, `windows-1250`, `windows-1251`, `windows-1252`, `windows-1253`, `windows-1254`, `windows-1255`, `windows-1256`, `windows-1257`, `windows-1258`, `x-mac-cyrillic`.
- **Multi-byte:** `GBK`, `gb18030`, `Big5`, `EUC-JP`, `ISO-2022-JP`, `Shift_JIS`, `EUC-KR`.
- **Other legacy codec:** `x-user-defined`.

TextEncoder's extra encoding argument remains ignored, so its UTF-8 cases for
all legacy argument names still run. Replacement-encoding label rejection also
runs. No legacy source byte tables or host decoder substitute is supplied.

The **three compiler-owned transfer blocks** are exact unchanged WPT names:

- `encodeInto() and a detached output buffer`
- `decoding a transferred Uint8Array chunk should give no output`
- `decoding a transferred ArrayBuffer chunk should give no output`

They require a canonical `MessageChannel`/`MessagePort` transfer capability.
Direct buffer detachment policy controls do not claim to execute those WPT cases.

The manifest names excluded IDL reflection files, browser/iframe/realm cases,
worker-termination crash coverage, XHR/document encoding tests, each remaining
root HTML file, and legacy codec directories. Excluded whole files have no
invented registration count and are not included in the 255 registered blocks.

## Source controls, descriptor profile and Node differences

| Source controls | Before | After |
|---|---:|---:|
| TextEncoder/TextDecoder policy | 9 pass / 18 fail | 27 pass / 0 fail |
| Encoder/decoder stream policy | 23 pass / 3 fail | 26 pass / 0 fail |

The combined final policy command also includes the two versions controls and
78 existing WebIDL-surface entries: **133 entries, 114 pass, zero fail, 19 skip**.
Eight added, individually named encoding descriptor-only skips are:

- `TextDecoder @@toStringTag descriptor`
- `TextDecoderStream @@toStringTag descriptor`
- `TextEncoder @@toStringTag descriptor`
- `TextEncoderStream @@toStringTag descriptor`
- `TextDecoder Web IDL member enumerability`
- `TextDecoderStream Web IDL member enumerability`
- `TextEncoder Web IDL member enumerability`
- `TextEncoderStream Web IDL member enumerability`

The other eleven skips are inherited. Ordinary tags, brands, operation behavior
and conversion ordering remain tested. `encodeInto.length` is also a documented
metadata gap: the rest-argument tuple preserves missing-argument validation but
has JavaScript length zero rather than Web IDL's required count two. No forbidden
descriptor patch recreates that metadata. The full IDL reflection fixture is
excluded as a file from the new fixed-layout adapter profile.

Paired probes document **14 Node differences in 15 codec scenarios**; the
unchanged codec SHA-256 confirms these probes apply to this candidate. Node
24.20 accepts the eight tested resizable/growable buffer forms that the source
rejects under the referenced Web IDL conversion rule. In six tested fatal-stream
continuations, Node discards queued bytes or produces a further UTF-16 error
where the specification queue-restoration algorithm retains input. The detached
DataView control agrees. Separately, Node encodes a primitive Symbol stream chunk
as `Symbol(chunk)` while the source rejects it with TypeError; constructor-order
and exception-identity controls agree. Exact inputs/results and specification
links are preserved in `encoding-results.json`. These supplemental probes are
not added to WPT totals and this PR does not claim bit-for-bit Node agreement
for these known cases.

An independent source review also checked 50 split/restoration probes and two
reentrant options-getter scenarios. All 50 probes passed and both reentrant
scenarios agreed with Node. These are review evidence, separate from automated
WPT and gate counts.

## Sabotage control

On the measured source candidate, an intentional mutation ignored `ignoreBOM`
and always stripped the initial U+FEFF. The unchanged
`textdecoder-ignorebom.any.js` then reported **one pass and three failures**
(one failing case for each UTF decoder). Restoring the original bytes returned
**four passes and zero failures**. The source restored byte-for-byte to
SHA-256 `aabbcd2f424bfa867c32c38a87967ed7adbe6d898765fe49f5d6cd31844d2849`.
This confirms the fixture observes the package implementation.

## Validation commands and the remaining full-gate failure

```sh
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/wpt-encoding.test.ts
node --expose-gc --test runtime/web-platform/test/encoding-policy.test.ts runtime/web-platform/test/encoding-stream-policy.test.ts runtime/web-platform/test/wpt-versions.test.ts runtime/web-platform/test/webidl-surface.test.ts
sh tooling/conformance/web-platform/check.sh
```

Both TypeScript projects exit zero. `check.sh` executes **9,286 `node:test`
entries: 8,698 pass, zero fail, 588 skip**. Its older upstream runner then reports
**2,817 total: 2,761 pass, eleven fail, 45 not applicable**. The complete command
exits one. All eleven failures are in `encoding/idlharness.any.js`, at the
assertion that a method/accessor must be enumerable:

- `TextDecoder interface: operation decode(optional AllowSharedBufferSource, optional TextDecodeOptions)`
- `TextDecoder interface: attribute encoding`
- `TextDecoder interface: attribute fatal`
- `TextDecoder interface: attribute ignoreBOM`
- `TextEncoder interface: operation encode(optional USVString)`
- `TextEncoder interface: operation encodeInto(USVString, Uint8Array)`
- `TextEncoder interface: attribute encoding`
- `TextDecoderStream interface: attribute encoding`
- `TextDecoderStream interface: attribute fatal`
- `TextDecoderStream interface: attribute ignoreBOM`
- `TextEncoderStream interface: attribute encoding`

Removing production `Object.defineProperty` and descriptor reflection is
required by the current contribution rules. The allowed package manifest was
briefly given these eleven named exclusions to test whether the legacy runner
could express that profile. It could not: its `async_test` path does not consult
`excludedTests`, unlike its `test` and `promise_test` paths, and the trial ends
with `Stale or unobserved WPT exclusions: encoding/idlharness.any.js`. The legacy
manifest was restored byte-for-byte, returning the executable tree to the
candidate above. The failed trial has a separate log/hash and is not a passing
result. No change to out-of-scope `tooling/conformance/web-platform/test-upstream.mjs`
ships. Maintainers need to make that legacy async exclusion path honor the same
named profile before this gate can be green. The existing check.sh footer still
mentions eight historical structural failures; the actual eleven failures are
listed here rather than borrowing that generic footer's count.

`check.sh` explicitly skips the compiled axis because no nts compiler is
available. Native SIMD replacement, native legacy codecs, native buffer/stream
bindings, compiled execution, performance and the eventual landed artifact are
**not verified** by this host run. The bootstrap remains separate.

The only shared adapter change is additive test entries in `tsconfig.json`;
`harness.ts` and `runner.ts` behavior are unchanged. New tests are registered in
the shared `check.sh` list. Log names and exact SHA-256 values, including baseline,
final, sabotage, paired probes and the reverted trial, are in the results file.

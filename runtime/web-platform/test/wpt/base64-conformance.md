# HTML base64 and FileReader DataURL conformance

This increment is stacked on Encoding PR #47, branch `chatgpt/wpt-encoding`,
at `852a0525b4e740674c3789ffaaaa1b3ac41a4676`. Its branch is
`chatgpt/html-base64`. It implements the authorized base64 item independently
of the held globals bootstrap and interface-tag sweep.

## Implemented policy and codec boundary

The public barrel exports `atob` and `btoa` from `core/base64-globals.ts`.
That module owns required-argument checks, Web IDL DOMString conversion,
and conversion of codec failures into the canonical package
`DOMException` with name `InvalidCharacterError`. It preserves exceptions
raised by input coercion. Method definitions produce non-constructible
callables without descriptor reflection.

Every new byte and binary-string loop is in `core/base64.ts`, the boundary
whose internals nts replaces with native SIMD code. The existing forgiving
decoder is unchanged. The encoder body is moved unchanged from
`dispatch/proxy.ts`; proxy authorization now calls it and retains its existing
UTF-8 credential conversion. No second base64 algorithm or host codec is added.
The independent WebSocket handshake implementation, owned by another open PR,
is outside this increment.

The helpers reject code units above 255 before storing into a byte array,
so Unicode cannot be accepted by truncating its low byte. `btoa` uses Latin-1
byte values; `atob` produces one same-valued code unit per decoded byte.
Neither direction applies UTF-8 conversion. Forgiving decoding removes only
ASCII whitespace, handles allowed padding and unpadded tails, rejects invalid
alphabet characters, and discards the unused trailing bits.

`FileReader.readAsDataURL` adds a read kind and packaging arm to the existing
state machine. It reads the Blob's stored MIME type and calls the same
encoder. Existing progress, abort, overlapping-read and cleanup behavior is
preserved. There is no base64 loop in FileReader.

## Specification sections

- [HTML §8.3, Base64 utility methods](https://html.spec.whatwg.org/multipage/webappapis.html#base64-utility-methods).
- [Infra §7, Forgiving base64](https://infra.spec.whatwg.org/#forgiving-base64), including its RFC 4648 encoding reference.
- [Web IDL DOMString conversion](https://webidl.spec.whatwg.org/#es-DOMString) and [operation functions](https://webidl.spec.whatwg.org/#dfn-create-operation-function).
- [File API §6.2.3.1, readAsDataURL](https://w3c.github.io/FileAPI/#readAsDataURL), [§6.2.3, reading](https://w3c.github.io/FileAPI/#readOperation), and [§6.3, packaging data](https://w3c.github.io/FileAPI/#package-data).

The current File API packaging prose says an empty MIME type should omit the
media type. The unchanged pinned WPT expects `application/octet-stream` for
untyped and empty Blobs. This implementation follows that WPT spelling and
otherwise uses the Blob's stored MIME type. It is an explicit compatibility
choice: the normative prose does not prescribe that default, and
[FileAPI issue #104](https://github.com/w3c/FileAPI/issues/104) tracks the
incomplete DataURL serialization algorithm.

## Pinned WPT inputs

| Input | Revision | Git blob |
| --- | --- | --- |
| `html/webappapis/atob/base64.any.js` | `2b38ea1cb920a2d0f91bf140d0e1eba73db8e742` | `fbb64042932a2890ed448e632bfa7366fcc2739f` |
| `fetch/data-urls/resources/base64.json` | `2b38ea1cb920a2d0f91bf140d0e1eba73db8e742` | `01f981a6502aec41351de52519c5437d6c77a609` |
| Existing FileAPI fixtures | `7f5130188818b6c12c636491186b459ec2bf131f` | Individual hashes remain unchanged in `file-forms-manifest.json`. |
| Harness behavior reference | `6a2f32237615d7ea9c1eb1e30453066b5555c603` | Existing `resources/testharness.js` reference. |

The atob directory contains one executable fixture and one metadata file.
The fixture and its JSON input retain exact upstream bytes and original
headers. The existing BSD-3-Clause license is reused unchanged. The versions
table gains only the two new file hashes within its existing directory pins;
no directory revision or common helper is upgraded or duplicated.

The fixture registers 285 btoa cases, one atob setup promise test, and
94 atob cases (80 JSON vectors and 14 conversion cases). All 380 execute
against the package's own exports. A fresh VM receives only those exports,
canonical DOMException and a restricted `fetch_json` fixture-data loader.
The loader accepts exactly the relative resource path used by upstream;
the shared runner verifies its hashes before fixture execution. It supplies
no host fetch, network access, atob or btoa.

Window and dedicated-worker META variants execute once in this source-host
profile. This is not evidence for actual browser global exposure or realms.

## Per-file WPT changes

Counts are **pass / fail / blocked**, excluding node:test container entries.
The baseline is the unchanged #47 head; the candidate is the tested source
commit below. The atob fixture was not previously imported, so its baseline
is absent rather than a fabricated measurement.

| Fixture | Before | After |
| --- | ---: | ---: |
| `html/webappapis/atob/base64.any.js` | Not imported | 380 / 0 / 0 |
| `FileAPI/reading-data-section/FileReader-multiple-reads.any.js` | 5 / 0 / 1 | 6 / 0 / 0 |
| `FileAPI/reading-data-section/filereader_readAsDataURL.any.js` | 0 / 0 / 4 | 4 / 0 / 0 |
| `FileAPI/reading-data-section/filereader_readystate.any.js` | 0 / 0 / 1 | 1 / 0 / 0 |
| `FileAPI/reading-data-section/filereader_result.any.js` | 9 / 0 / 3 | 12 / 0 / 0 |

Exactly nine named base64 dependencies are removed. The Files/FormData
selection now reports **494 passed / 0 failed / 8 blocked**. Its two
callback-cleanup checkpoint cases remain **0 / 0 / 2** in
`filereader_events.any.js`; all other existing exclusions are unchanged.
Native legacy text codecs remain outside this change.

All **235 other existing shared fixture files** have identical per-file
results. The shared WPT total changes from **7,016 / 0 / 564 across 239 files**
to **7,405 / 0 / 555 across 240 files**.

## Shared adapter and gate changes

- `runtime/web-platform/test/wpt/harness.ts` adds `generate_tests`. It preserves the pinned helper's names, arguments, test receiver, discarded return value, own-index iteration, failure attribution, named blocks, and registration guards. Unsupported nonempty per-test properties fail explicitly. The pinned helper uses its own `forEach` with an own-property check; it does not visit inherited numeric entries.
- `runtime/web-platform/test/wpt/tsconfig.json` adds the three new test files.
- `tooling/conformance/web-platform/check.sh` adds the same three files to its explicit list: `wpt-base64.test.ts`, `wpt-base64-harness.test.ts`, and `base64-policy.test.ts`.

`runner.ts` is unchanged. Seven adapter controls include positive execution,
assertion failures, named blocks, sparse and inherited entries, duplicate and
inventory guards, unsupported properties, and completion-driven asynchronous
registration. The driver separately rejects unpinned JSON paths. No new test
depends on an elapsed timer.

There are 23 focused HTML policy controls and 32 FileReader controls,
including the three new DataURL controls. They cover the full byte range,
exact lengths, invalid Unicode before truncation, coercion count/order and
exception identity, missing versus undefined, padding and whitespace,
nonconstructibility, private MIME reads, loading/result states, and abort
followed by a reentrant read.

## Validation

Runtime: **Node 24.20.0 / pnpm 10.15.0 / TypeScript 7.0.2**. The ignored
Node v24.20.0 WPT corpus is present for the legacy runner.

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
```

All exit zero. The conformance TypeScript command is also the first step of
the full gate. Commands execute inside the cached Node/pnpm environment
provided by `npm exec --offline --yes --package=pnpm@10.15.0 --package=node@24.20.0 --`.

```sh
node --expose-gc --test --test-reporter=tap \
  runtime/web-platform/test/base64-policy.test.ts \
  runtime/web-platform/test/wpt-base64.test.ts \
  runtime/web-platform/test/wpt-base64-harness.test.ts \
  runtime/web-platform/test/file-reader-wpt-policy.test.ts \
  runtime/web-platform/test/wpt-files-forms.test.ts \
  runtime/web-platform/test/proxy.test.ts \
  runtime/web-platform/test/wpt-versions.test.ts
```

Focused output: **1,012 tests / 1,004 passed / 0 failed / 8 skipped**, exit zero.
This includes the proxy regression tests and fixture-pin verification.

```sh
sh tooling/conformance/web-platform/check.sh
```

Host output: **9,702 tests / 9,123 passed / 0 failed / 579 skipped**. The
legacy runner then reports **2,817 total / 2,761 passed / 11 failed /
45 not applicable**. The full command exits **one**, exactly as the baseline
does. All eleven failures are the unchanged Encoding IDL enumerability cases
listed in [the Encoding report](encoding-conformance.md); their exact names
are also retained in `base64-results.json`. The maintainers will add named
descriptor-shape exclusions when #47 lands. This increment does not alter
those cases or the legacy runner. The script's historical footer says eight;
the actual failure count is eleven.

The compiled axis explicitly skips because no nts compiler is available.
Native SIMD replacement, native code, compiled execution and performance are
not verified by these host tests. Global installation and Window/Worker
receiver validation remain provider-bootstrap responsibilities; no globalThis
write or provider runtime change is included.

## Tested and published source

The measured local source commit is
`dc5f92eb3e83881c586dd7720898dd3c2f75e54c`. Its published counterpart is
[`8f33780791a19cf0178714d13aac2c30c8d426ef`](https://github.com/AkisArou/nts/commit/8f33780791a19cf0178714d13aac2c30c8d426ef).
Both have exactly the complete Git tree
`dfdb61f6bc31b881dfb358298c40cf8f630aad90`. The evidence commit adds this report,
`base64-results.json` and a pointer from the FileAPI report; executable source,
tests, fixture selection and pins are unchanged.

[Machine-readable results](base64-results.json) preserve command exit codes,
baseline and candidate identities, all changed per-file results, the nine
removed dependency names, unchanged legacy failures and validation-log hashes.

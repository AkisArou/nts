# FileAPI, FormData and URL-encoded WPT conformance

Item A4 is stacked on [Fetch PR #18](https://github.com/AkisArou/nts/pull/18),
branch `chatgpt/wpt-fetch-data`, at
`8f23f225c90e7d461dd0f3d0d157edf2b2b64d27`, including its approved
Object.entries record profile. This branch is `chatgpt/wpt-files-forms`.
Retarget it to main after its dependency lands.

The change brings pinned, unedited WPT cases into the ordinary-node host
suite, implements FileReader and ProgressEvent source policy, and fixes
Blob conversion/private reads and URL-encoded form-body parsing. FileReader
also supplies the ArrayBuffer read needed by three cases in WebSocket PR #16.
It has explicit remaining capability limits below; this is not a claim of
complete FileReader, browser-global or compiled nts conformance.

## Provenance and execution

| Directory or reference | WPT revision |
| --- | --- |
| `FileAPI` | `7f5130188818b6c12c636491186b459ec2bf131f` |
| `url/urlencoded-parser.any.js` | `4832db47614f5f48cc57374cbf5c1f70937fad48` |
| `xhr/formdata` | `2b38ea1cb920a2d0f91bf140d0e1eba73db8e742` |
| `common` helper | `dbd648158d337580885e70a54f929daf215211a0` |
| Harness `resources` reference | `6a2f32237615d7ea9c1eb1e30453066b5555c603` |

FileAPI and URL use the directory revisions in
[Node v24.20.0's versions.json](https://github.com/nodejs/node/blob/71b8b174857e25106d39b61a9e6f30d927da8b01/test/fixtures/wpt/versions.json).
Node does not vendor `xhr/formdata`; it uses the same recent upstream revision
reserved by A3. The [manifest](file-forms-manifest.json) records source URLs,
Git blob IDs, SHA-256 hashes, registration names, named exclusions, and Node's
status files as compatibility context. Node's expected failures are not
transferred into this package's applicability rules.

All 34 fixture files and both helpers retain upstream bytes and existing
headers. The BSD-3-Clause licence is preserved; a missing individual header
is not inserted into an otherwise unedited fixture. One helper is new
(`FileAPI/support/Blob.js`), and the other is the inherited `common/gc.js`.
The loader checks hashes before executing files. The copied
`FileAPI/FileReader/progress_event_bubbles_cancelable.html` retains its
upstream trailing blank line; that is the sole `git diff --check` whitespace
finding. A separate audit checked
all 502 registration names and their order, every per-file outcome, and the
identical blocked selection in both runs. This includes the 150 Blob-slice
registrations, including cases registered inside synchronous tests, and the
four unnamed fixtures whose unchanged META titles provide their names.

The complete requested source-path inventory has 121 entries: 34 selected
fixtures, one in-directory support file, 84 excluded paths and two metadata
files. `common/gc.js` is outside those requested directories. Every excluded
path has a reason in the manifest. Two Document-dependent registrations in
the File constructor fixture never register in this environment; they are
listed separately and counted as neither executed nor blocked cases.

`../wpt-files-forms.test.ts` creates a fresh `node:vm` context per file with
canonical package Blob, File, FileReader, ProgressEvent, FormData, Request,
Response, streams, events, errors and encoding classes. It uses the ordinary
Node host provider. Genuine ECMAScript constructors align promise and buffer
identity with the imported implementation; `self` is the actual VM global.
The existing canonical URLSearchParams is exposed for the URL-encoded fixture,
without changing its implementation. Host `gc` is supplied under `--expose-gc`
because the pinned helper supports that genuine facility.

The Fetch transport rejects any dispatch and records it; teardown asserts
that no outbound transport attempt occurred. This selection is network-free.
Node's competing Web API classes, fake browser globals, platform strings and
worker emulation are not substituted. META global variants execute once in
this host environment; browser exposure and nts garbage collection are not
established by that execution.

## Before and after, per file

The baseline uses source at the updated #18 head, with the same final fixtures,
adapter and exclusions. Since FileReader and ProgressEvent do not exist there,
the baseline driver omits those two imports/globals. It does not install a
host substitute. Counts below are WPT cases, excluding node:test containers.

The final comparison is **441 pass / 44 fail / 17 blocked** before and
**485 pass / 0 fail / 17 blocked** after. Forty-four failures become passes
across thirteen files. Initial diagnostic runs also exposed two genuine
callback-checkpoint failures and missing META-title metadata; those runs
are not substituted for this corrected, complete 34-file comparison.

| WPT path | Before: pass / fail / blocked | After: pass / fail / blocked |
| --- | ---: | ---: |
| `FileAPI/FileReader/progress_event_bubbles_cancelable.html` | 0 / 1 / 0 | 1 / 0 / 0 |
| `FileAPI/blob/Blob-array-buffer.any.js` | 5 / 0 / 0 | 5 / 0 / 0 |
| `FileAPI/blob/Blob-bytes.any.js` | 5 / 0 / 0 | 5 / 0 / 0 |
| `FileAPI/blob/Blob-constructor.any.js` | 67 / 0 / 6 | 67 / 0 / 6 |
| `FileAPI/blob/Blob-newobject.any.js` | 4 / 0 / 0 | 4 / 0 / 0 |
| `FileAPI/blob/Blob-slice-overflow.any.js` | 4 / 0 / 0 | 4 / 0 / 0 |
| `FileAPI/blob/Blob-slice.any.js` | 150 / 0 / 0 | 150 / 0 / 0 |
| `FileAPI/blob/Blob-stream.any.js` | 6 / 0 / 0 | 6 / 0 / 0 |
| `FileAPI/blob/Blob-text.any.js` | 8 / 0 / 0 | 8 / 0 / 0 |
| `FileAPI/file/File-constructor.any.js` | 49 / 0 / 0 | 49 / 0 / 0 |
| `FileAPI/fileReader.any.js` | 0 / 4 / 0 | 4 / 0 / 0 |
| `FileAPI/reading-data-section/Determining-Encoding.any.js` | 0 / 6 / 0 | 6 / 0 / 0 |
| `FileAPI/reading-data-section/FileReader-event-handler-attributes.any.js` | 0 / 6 / 0 | 6 / 0 / 0 |
| `FileAPI/reading-data-section/FileReader-multiple-reads.any.js` | 0 / 5 / 1 | 5 / 0 / 1 |
| `FileAPI/reading-data-section/filereader_abort.any.js` | 0 / 2 / 0 | 2 / 0 / 0 |
| `FileAPI/reading-data-section/filereader_error.any.js` | 0 / 1 / 0 | 1 / 0 / 0 |
| `FileAPI/reading-data-section/filereader_events.any.js` | 0 / 0 / 2 | 0 / 0 / 2 |
| `FileAPI/reading-data-section/filereader_readAsArrayBuffer.any.js` | 0 / 1 / 0 | 1 / 0 / 0 |
| `FileAPI/reading-data-section/filereader_readAsBinaryString.any.js` | 0 / 1 / 0 | 1 / 0 / 0 |
| `FileAPI/reading-data-section/filereader_readAsDataURL.any.js` | 0 / 0 / 4 | 0 / 0 / 4 |
| `FileAPI/reading-data-section/filereader_readAsText.any.js` | 0 / 2 / 0 | 2 / 0 / 0 |
| `FileAPI/reading-data-section/filereader_readystate.any.js` | 0 / 0 / 1 | 0 / 0 / 1 |
| `FileAPI/reading-data-section/filereader_result.any.js` | 0 / 9 / 3 | 9 / 0 / 3 |
| `FileAPI/unicode.html` | 0 / 4 / 0 | 4 / 0 / 0 |
| `url/urlencoded-parser.any.js` | 103 / 2 / 0 | 105 / 0 / 0 |
| `xhr/formdata/append.any.js` | 7 / 0 / 0 | 7 / 0 / 0 |
| `xhr/formdata/constructor.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `xhr/formdata/delete.any.js` | 3 / 0 / 0 | 3 / 0 / 0 |
| `xhr/formdata/foreach.any.js` | 4 / 0 / 0 | 4 / 0 / 0 |
| `xhr/formdata/get.any.js` | 6 / 0 / 0 | 6 / 0 / 0 |
| `xhr/formdata/has.any.js` | 3 / 0 / 0 | 3 / 0 / 0 |
| `xhr/formdata/iteration.any.js` | 3 / 0 / 0 | 3 / 0 / 0 |
| `xhr/formdata/set-blob.any.js` | 6 / 0 / 0 | 6 / 0 / 0 |
| `xhr/formdata/set.any.js` | 7 / 0 / 0 | 7 / 0 / 0 |
| **Total** | **441 / 44 / 17** | **485 / 0 / 17** |

## Source changes and specification controls

Source-policy fixes have individual commits with specification citations.
The supplemental controls below are locally authored tests, not rewritten
WPT cases. They cover behavior that the selected pinned fixtures do not
always distinguish.

| Supplemental file | Before | After |
| --- | ---: | ---: |
| `file-forms-wpt-policy.test.ts` | 2 pass / 10 fail | 12 pass / 0 fail |
| `file-forms-urlencoded-policy.test.ts` | 10 pass / 6 fail | 16 pass / 0 fail |
| `file-reader-wpt-policy.test.ts` | New API; handler-override control was 28 pass / 1 fail before its separate fix | 29 pass / 0 fail |
| `wpt-file-harness.test.ts` | New adapter controls | 10 pass / 0 fail |

The Blob/FormData baseline was measured at initial #18 head `e2fbd9df`;
those source files are byte-identical at the final #18 base. Three of its ten
failures identify the new internal-access capability being absent; seven
identify existing behavior defects. The selected upstream Blob and FormData
cases already pass on the base, so their unchanged WPT totals are not credited
as improvements from these supplemental fixes.

### Blob, File and FormData

- Add module-only access to Blob identity, private metadata and its existing
  stream for [File API's read operation](https://w3c.github.io/FileAPI/#readOperation).
  FileReader must not invoke script overrides of `size`, `type`, `stream` or
  public conversion methods. Independent reads, provider-backed storage and
  cancellation retain their existing paths. These helpers are not barrel exports.
- Follow [Web IDL sequence conversion](https://webidl.spec.whatwg.org/#create-sequence-from-iterable)
  in the [Blob constructor](https://w3c.github.io/FileAPI/#constructorBlob):
  cache iterator/next methods, preserve element-conversion failures without
  IteratorClose, and do not read later constructor options after failure.
- Make [Blob.arrayBuffer()](https://w3c.github.io/FileAPI/#dom-blob-arraybuffer)
  read private storage instead of an overridable public `bytes()` method.
  Result buffers remain fresh and mutable while Blob data stays immutable.
- Return rejected promises for immediate `bytes()`, `text()` and `arrayBuffer()`
  failures, including incompatible receivers, as
  [Web IDL operation invocation](https://webidl.spec.whatwg.org/#es-operations)
  requires. Existing synchronous fast paths are retained without adding an
  extra async wrapper.
- Remove the old Blob/File/FormData descriptor-configuration code under the
  current cloud-agent fixed-layout rule. Plain members preserve functional
  tags and File constructor arity. The legacy surface suite names ten
  descriptor-only omissions: two each for Blob, File, FormData, FileReader
  and ProgressEvent. Other interfaces keep their descriptor checks, and the
  functional tag/arity checks remain active. That suite records
  **68 pass / 0 fail / 10 skipped** including its containers.

### URL-encoded form bodies

[Fetch formData()](https://fetch.spec.whatwg.org/#dom-body-formdata) passes the
original body bytes to the [URL Standard section 5.1 parser](https://url.spec.whatwg.org/#concept-urlencoded-parser).
The new source helper splits fields at `&`, splits a field at its first `=`,
replaces literal `+`, percent-decodes valid escapes, and only then decodes
UTF-8 without consuming a leading BOM. It preserves malformed percent escapes,
combines raw and percent-escaped UTF-8 bytes correctly, and treats an initial
`?` as data rather than a query prefix. Existing canonical decoding performs
the conversion; no codec is added. An unescaped component uses a byte view.

The focused Request/Response controls improve from **10/6 to 16/0**. The six
failures are the raw leading BOM, mixed raw/escaped UTF-8 and initial question
mark cases for each class. The unedited URL-encoded WPT improves from
**103/2 to 105/0**. URL and URLSearchParams source remain outside this change.

### FileReader and ProgressEvent

[File API sections 6.2–6.4](https://w3c.github.io/FileAPI/#APIASynch) define the
read state, [read operation](https://w3c.github.io/FileAPI/#readOperation),
[abort](https://w3c.github.io/FileAPI/#abort),
[data packaging](https://w3c.github.io/FileAPI/#package-data) and
[event ordering](https://w3c.github.io/FileAPI/#events).
FileReader implements `readAsArrayBuffer()`, `readAsBinaryString()`,
`readAsText()`, `abort()`, `readyState`, `result`, `error`, constants and all
six event-handler attributes over private Blob data and the existing provider
scheduler/clock. Canonical helpers perform byte and text conversions.

Operation identity retires pending reads and queued events after abort.
Completion/abort handlers can start another read without emitting the prior
operation's loadend while the replacement is loading. Handler activation and
deactivation use captured canonical EventTarget operations, following
[HTML event handlers](https://html.spec.whatwg.org/multipage/webappapis.html#event-handlers),
so an ordinary subclass override cannot intercept onload assignment or
clearing. Its separate regression control fails before that fix.

[ProgressEvent](https://xhr.spec.whatwg.org/#interface-progressevent) uses
finite-double progress values and the inherited Event options. Dictionary
conversion precedes timestamp capture. FileReader dispatches trusted progress
events through the existing EventTarget operation. Both classes are exported
from the package barrel, with declared fixed-layout members. The provider
bootstrap is left for its own coordinated PR.

## Named exclusions and missing capabilities

All 17 blocked WPT registrations are named in the manifest; the same list is
used before and after. They are separate from the ten legacy descriptor-only
surface skips and the 84 wholly excluded source paths.

| Reason | Registered cases | Required resolution |
| --- | ---: | --- |
| Intrinsic prototype mutation | 5 | Excluded by the fixed-layout language profile; ordinary iterables still run. |
| FrozenArray obtained from MessageChannel/MessagePort | 1 | Compiler-owned messaging/transfer support; no fabricated ports array. |
| FileReader DataURL encoding | 9 | A canonical bytes-to-base64 ASCII capability. |
| Callback-cleanup microtask checkpoint | 2 | Shared provider/engine callback execution support, described below. |

`readAsDataURL()` is deliberately absent pending that base64 capability.
A native operation must return failures as values for source policy to convert
to exceptions. No source base64 codec, Node shortcut or global hook is added.

Canonical TextDecoder currently supplies UTF-8 and UTF-16. Invalid labels
follow File API's MIME-charset/UTF-8 fallback. When decoding requires an
unavailable legacy codec, `readAsText()` reports an explicit `NotSupportedError`
capability failure; this is not conformant legacy decoding. A UTF BOM
overrides the fallback label and uses the corresponding supported UTF codec.
Recognition follows the
[official Encoding labels pinned at 02b303619962bd0fce3651c460117f67cd8c2cd4](https://github.com/whatwg/encoding/blob/02b303619962bd0fce3651c460117f67cd8c2cd4/encodings.json),
using ASCII case matching. Actual transcoding remains a canonical capability.

The two registrations in `FileAPI/reading-data-section/filereader_events.any.js`
are named `events are dispatched in the correct order for an empty blob` and
`events are dispatched in the correct order for a non-empty blob`. Both
actually failed with `Not expecting event, but got loadend event` before
classification. Their EventWatcher awaits `load` and then installs the
`loadend` wait in a promise continuation. The source code performs File API's
same-task completion sequence, but its JavaScript callback stack cannot
perform the host callback-cleanup microtask checkpoint between dispatches.
This needs the shared callback-execution boundary. The exclusions are
**temporary capability dependencies**, not permanent language exclusions.
The strict EventWatcher was not weakened, and no artificial task or partial
promise yield was inserted to turn these cases green.

Entire excluded files cover real DOM/form controls, user file selection,
workers/FileReaderSync, URL/object-URL integration, network, browser document
lifecycle and IDL support. The two constructor-endings HTML fixtures also
read `navigator.platform` at top level; no canonical platform capability is
available, so no invented Navigator value is supplied. Exact per-path reasons
and the two unregistered Document cases are in the manifest.

## Additive shared-adapter changes and overlap

The maintainer permits concurrent additive changes to `harness.ts`,
`runner.ts`, `tsconfig.json` and the `check.sh` list. Each addition here is
independent of the Web API source implementation:

- `format_value` follows the pinned WPT formatter so generated test names and
  diagnostics match, including escaping, sparse arrays, repeated references
  and object truncation. An independent comparison against the pinned helper
  covered 66 calls with 56 distinct outputs and all 223 names across the
  Blob constructor/slice fixtures.
- `assert_class_string` checks the intrinsic class tag.
- `assert_less_than`, `assert_less_than_equal` and `assert_greater_than_equal`
  retain primitive numeric-kind and boundary checks, including NaN failures.
- `EventWatcher` preserves event order, unexpected-event failures, overlapping
  wait rejection, cleanup and timeout handling. Negative controls deliberately
  exercise those failures.
- Optional `defaultTestName` metadata travels from a fixture through runner
  to harness. Four unchanged META titles provide unnamed test names; the
  existing fallback remains unchanged when metadata is absent.
- The strict adapter project and shared test list register the five new files.

The existing Streams additions (`step_timeout`, timeout arguments,
`assert_greater_than`, `assert_object_equals` correction) and Fetch's bounded
HTML loader are inherited unchanged. [PR #10](https://github.com/AkisArou/nts/pull/10)
and other conformance tasks also touch the shared adapter; maintainers should
merge these additions while retaining their negative controls and title/hash
validation. No worker/importScripts emulation or callback deferral is added.
Shared source files in #18 are modified through this explicit stack; the
provider bootstrap and PR #16's events/WebSocket source are untouched.

## WebSocket dependency verified

A detached integration checkout used published [PR #16](https://github.com/AkisArou/nts/pull/16)
at `c6b53121a054cef8207e7f321e94ac12702c58ee`. Applying this change's final
Blob, FileReader and ProgressEvent source, injecting the canonical FileReader
into its existing fixture globals, and removing only the three corresponding
missing-FileReader blocks produced **3 pass / 0 fail / 0 blocked** in
`websockets/send-data-isolation.sub.html`:

- `Modifying a Uint8Array after send() does not affect the sent data`
- `Modifying an ArrayBuffer after send() does not affect the sent data`
- `Modifying a typed array view after send() does not affect the sent data`

The fixture uses WPT revision
`a8f306ee4399724f33399dfdcac7da296f3cc05a` and SHA-256
`4cd32475f7f68360c6fa0e80c0ea8fbfaa2fa450ffb595c4ee7bffdfb761abe5`.
Its bytes, shared harness/runner, provider and test server stayed unchanged.
The final source Git blob IDs in [the results](file-forms-results.json) match
that integration checkout exactly. No PR #16 files are included in this diff.

To repeat in a temporary PR #16 checkout, apply only the final `src/file/blob.ts`,
`src/file/file-reader.ts` and `src/core/progress-event.ts` changes, import/expose
FileReader in its driver, and remove only those three manifest blocks (runnable
count 0 to 3). Then run:

```sh
NTS_WPT_WEBSOCKET_FILTER=send-data-isolation.sub.html \
  node --expose-gc --test runtime/web-platform/test/wpt-websocket.test.ts
```

The measured command exited zero. Node counted five passes including its two
containers. A diagnostic run observed three outbound connections, all to
`127.0.0.1:34583` (an allocated test port); server listeners were loopback-only.
This verifies the three dependency cases, not the whole WebSocket suite or
compiled nts execution.

## Sabotage and restoration

Temporarily replacing FileReader's ArrayBuffer packaging with
`new ArrayBuffer(0)` makes the unchanged
`FileAPI/reading-data-section/filereader_readAsArrayBuffer.any.js` fail:
**0 pass / 1 fail / 0 blocked**, exit 1. The assertion reports a byte length
of 0 instead of 4. The stack passes through this package's FileReader handler
and EventTarget, establishing that the fixture exercises the canonical class.

The source was restored in a finally block. Its SHA-256 before and after is
`7f101d36263ba73304a0fdc2c855897fef6e462bd227b78645c27368a8aa76d1`;
the temporary mutant was
`729abee880901baa3c07d367c89b289fb18a733b481eb7f04cad0e2a0d8bd082`.
The complete gate below ran after exact restoration. The mutant is not committed.

## Validation

Node **24.20.0**, pnpm **10.15.0**. Commands use the repository's installed
dependencies and pinned Node upstream fixture checkout:

```sh
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test --test-isolation=none --test-reporter=tap runtime/web-platform/test/wpt-files-forms.test.ts
node --expose-gc --test runtime/web-platform/test/file-forms-wpt-policy.test.ts runtime/web-platform/test/file-reader-wpt-policy.test.ts runtime/web-platform/test/file-forms-urlencoded-policy.test.ts
node --expose-gc --test runtime/web-platform/test/wpt-file-harness.test.ts
sh tooling/conformance/web-platform/check.sh
```

Both strict TypeScript projects pass. The required full gate's successful run
reports **3,978 tests: 3,729 pass / 0 fail / 249 skipped**, followed by the
broader upstream runner's **2,772 pass / 0 fail / 45 not applicable**.
The A4 WPT alone reports 502 cases, 485 passing and 17 blocked; its node:test
aggregate is 537 entries, 520 passing and 17 skipped because it adds 35
containers. These counting levels are not combined.

The first full-gate attempt recorded **3,728 pass / 1 fail / 249 skipped**:
the unchanged `WPT exposes self only on request as the fixture's actual global
object` control exceeded its 100 ms VM timeout while a separate type check
was also running. A4 passed in that run. The unchanged control then passed
alone (1/0), and the unchanged complete gate passed on rerun without the
concurrent type-check process. The timeout is preserved as observed evidence;
no assertion, timeout or source code was changed to obtain the rerun result.

The unrouted-export and explicit-test-list gates pass. The compiled gate says
it is skipped because no nts compiler is present: **compiled nts behavior is
not verified**. No timing or benchmark claim is made. The maintainers' compiled
and canonical landing gates remain required.

The [machine-readable results](file-forms-results.json) retain per-file
counts, exact exclusions, source identities, sabotage/restoration evidence,
WebSocket integration details and raw-log digests. This PR changes only
`runtime/web-platform/` and the authorized `check.sh` test list; it adds no
dependency, native implementation, compiler change, URL/JSON implementation
change or provider-bootstrap edit.

# Fetch data-type WPT conformance

Item A3 is stacked on [Streams PR #15](https://github.com/AkisArou/nts/pull/15),
branch `chatgpt/wpt-streams`, at
`35be6b184ebcdf61e70a93b0b223805e9ab35a7e`. Its own branch is
`chatgpt/wpt-fetch-data`. The review diff contains Fetch/Body source policy,
the multipart parser used by `formData()`, fixtures and tests. It changes no
compiler, native implementation, provider bootstrap, URL implementation,
JSON implementation or dependency.

## Provenance and execution

Node v24.20.0 does not vendor `fetch/api` or `xhr/formdata`. Both areas reserve
the same recent [WPT revision](https://github.com/web-platform-tests/wpt/commit/2b38ea1cb920a2d0f91bf140d0e1eba73db8e742),
verified from upstream HEAD on 2026-10-28; the commit is dated
2026-10-28 09:34:35 UTC. This PR imports only the Fetch portion. Shared helpers
retain the handoff's Node directory pins.

| Directory or reference | WPT revision |
| --- | --- |
| `fetch/api/{headers,request,response,body}` and Fetch helpers; reserved for later `xhr/formdata` | `2b38ea1cb920a2d0f91bf140d0e1eba73db8e742` |
| `common` helpers | `dbd648158d337580885e70a54f929daf215211a0` |
| Harness `resources` reference | `6a2f32237615d7ea9c1eb1e30453066b5555c603` |

The [manifest](fetch-manifest.json) records every source path, revision,
SHA-256, Git blob ID, exact registration count and named exclusion. All 54
selected fixtures and five required helpers are unedited upstream bytes;
existing headers and the original BSD-3-Clause licence are preserved. Files
without an individual header are covered by that licence, without inserting
text into the copied bytes. The loader verifies hashes before execution.

The complete requested-directory inventory is 122 paths: 54 selected fixtures,
two in-directory support files, 62 excluded paths and four metadata files.
Three other helpers come from outside those four directories. The 62-path
inventory has a reason for each exclusion; it is not an executed-test count.
An additional 19 registrations behind the blocked no-CORS network loader are
listed separately. They never register in this host run and are counted as
neither passes nor blocked registrations.

`../wpt-fetch-data.test.ts` creates the ordinary-node provider and a fresh
`node:vm` context for every file. It supplies the package's Headers, Request,
Response, body data types, streams, abort interfaces and encoding classes.
Node's competing Web API implementations are not supplied. Genuine host
ECMAScript constructors align ordinary promise and buffer identities with
the imported implementation; `self` is the actual VM global. No fake URL,
Location, Document, Window or FileReader implementation is supplied.

Relative inputs use the provider's explicit `https://web-platform.test/`
base URL and origin. `fetch` is the package runtime's implementation. Its
transport records and rejects any outbound dispatch; environment cleanup
asserts that the count is zero even if a test catches the thrown error.
The selected data-URL and invalid-priority-before-transport cases therefore
exercise real local behavior, with no network request. Every fixture completes
with zero outbound transport attempts. META global variants execute once in
this host environment; this is not browser exposure or lifecycle conformance.

## Shared adapter changes and overlap with #10

The maintainer authorizes additive concurrent changes to `harness.ts`,
`runner.ts`, `tsconfig.json` and the `check.sh` list. This PR changes
`runner.ts` additively and registers five new test files in both lists.
It inherits Streams' `step_timeout`, timeout arguments, `assert_greater_than`
and `assert_object_equals` correction; it adds no further harness assertion.

The new `runWptHtmlScripts` helper executes pinned external classic scripts
and unchanged inline scripts in source order. It checks the complete declared
dependency plan before running any script, accepts only mapped same-origin
paths without query or fragment, and rejects module, async, defer and nomodule
scripts. Original fixture/helper hashes are checked by the common loader.
Existing JavaScript META loading remains unchanged. Four positive/negative
controls cover order, undeclared dependencies, unsupported script execution
and rejection before side effects.

[PR #10](https://github.com/AkisArou/nts/pull/10) also extends HTML support
loading and the shared runner/configuration. Maintainers should merge the two
additions, retaining this dependency-plan validation and the existing hash
checks. This PR does not merge or replace #10's URL/variant/deadline,
substitution or `importScripts` work. The helper is a bounded fixture loader,
not an HTML parser or browser environment.

## Before and after

These are WPT leaf counts, excluding node:test file/suite wrappers. The final
selection runs the same fixture bytes, adapter and named applicability rules
against source at the Streams base and against the corrected source.

The initial diagnostic run was **591 pass / 144 fail / 45 blocked**. The
classification review explicitly defers 117 browser security-profile cases,
two inconsistent empty-FormData expectations and two compiler-owned clone
dependencies. Those 121 reclassifications are not source fixes. The final
selection's actual source improvement is **591 pass / 23 fail / 166 blocked**
to **614 pass / 0 fail / 166 blocked**.

| WPT path | Before: pass / fail / blocked | After: pass / fail / blocked |
| --- | ---: | ---: |
| `fetch/api/body/cloned-any.js` | 5 / 0 / 0 | 5 / 0 / 0 |
| `fetch/api/body/formdata.any.js` | 3 / 0 / 0 | 3 / 0 / 0 |
| `fetch/api/body/mime-type.any.js` | 20 / 0 / 0 | 20 / 0 / 0 |
| `fetch/api/body/textstream.any.js` | 4 / 10 / 0 | 14 / 0 / 0 |
| `fetch/api/headers/header-setcookie.any.js` | 23 / 0 / 1 | 23 / 0 / 1 |
| `fetch/api/headers/headers-basic.any.js` | 20 / 0 / 3 | 20 / 0 / 3 |
| `fetch/api/headers/headers-casing.any.js` | 4 / 0 / 0 | 4 / 0 / 0 |
| `fetch/api/headers/headers-combine.any.js` | 6 / 0 / 0 | 6 / 0 / 0 |
| `fetch/api/headers/headers-errors.any.js` | 18 / 0 / 0 | 18 / 0 / 0 |
| `fetch/api/headers/headers-forbidden-override.any.js` | 18 / 0 / 72 | 18 / 0 / 72 |
| `fetch/api/headers/headers-no-cors.any.js` | 0 / 0 / 8 | 0 / 0 / 8 |
| `fetch/api/headers/headers-normalize.any.js` | 3 / 0 / 0 | 3 / 0 / 0 |
| `fetch/api/headers/headers-record.any.js` | 3 / 10 / 0 | 13 / 0 / 0 |
| `fetch/api/headers/headers-structure.any.js` | 8 / 0 / 0 | 8 / 0 / 0 |
| `fetch/api/request/forbidden-method.any.js` | 6 / 0 / 0 | 6 / 0 / 0 |
| `fetch/api/request/request-clone-readable-stream-body.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `fetch/api/request/request-clone.sub.html` | 1 / 0 / 1 | 1 / 0 / 1 |
| `fetch/api/request/request-constructor-init-body-override.any.js` | 2 / 0 / 0 | 2 / 0 / 0 |
| `fetch/api/request/request-consume-empty.any.js` | 13 / 0 / 1 | 13 / 0 / 1 |
| `fetch/api/request/request-consume.any.js` | 45 / 0 / 0 | 45 / 0 / 0 |
| `fetch/api/request/request-disturbed.any.js` | 8 / 0 / 1 | 8 / 0 / 1 |
| `fetch/api/request/request-error.any.js` | 22 / 0 / 0 | 22 / 0 / 0 |
| `fetch/api/request/request-headers.any.js` | 24 / 0 / 37 | 24 / 0 / 37 |
| `fetch/api/request/request-init-001.sub.html` | 50 / 0 / 3 | 50 / 0 / 3 |
| `fetch/api/request/request-init-002.any.js` | 8 / 0 / 0 | 8 / 0 / 0 |
| `fetch/api/request/request-init-contenttype.any.js` | 18 / 0 / 0 | 18 / 0 / 0 |
| `fetch/api/request/request-init-priority.any.js` | 5 / 0 / 3 | 5 / 0 / 3 |
| `fetch/api/request/request-init-stream.any.js` | 23 / 0 / 0 | 23 / 0 / 0 |
| `fetch/api/request/request-keepalive.any.js` | 2 / 0 / 0 | 2 / 0 / 0 |
| `fetch/api/request/request-structure.any.js` | 24 / 0 / 0 | 24 / 0 / 0 |
| `fetch/api/response/json.any.js` | 1 / 0 / 1 | 1 / 0 / 1 |
| `fetch/api/response/response-cancel-stream.any.js` | 3 / 0 / 4 | 3 / 0 / 4 |
| `fetch/api/response/response-clone.any.js` | 17 / 0 / 4 | 17 / 0 / 4 |
| `fetch/api/response/response-consume-empty.any.js` | 13 / 0 / 1 | 13 / 0 / 1 |
| `fetch/api/response/response-consume-stream.any.js` | 15 / 0 / 0 | 15 / 0 / 0 |
| `fetch/api/response/response-error-from-stream.any.js` | 14 / 0 / 0 | 14 / 0 / 0 |
| `fetch/api/response/response-error.any.js` | 10 / 0 / 0 | 10 / 0 / 0 |
| `fetch/api/response/response-form-data.html` | 11 / 3 / 0 | 14 / 0 / 0 |
| `fetch/api/response/response-from-stream.any.js` | 3 / 0 / 0 | 3 / 0 / 0 |
| `fetch/api/response/response-init-001.any.js` | 9 / 0 / 0 | 9 / 0 / 0 |
| `fetch/api/response/response-init-002.any.js` | 8 / 0 / 0 | 8 / 0 / 0 |
| `fetch/api/response/response-init-contenttype.any.js` | 18 / 0 / 0 | 18 / 0 / 0 |
| `fetch/api/response/response-static-error.any.js` | 2 / 0 / 0 | 2 / 0 / 0 |
| `fetch/api/response/response-static-json.any.js` | 16 / 0 / 0 | 16 / 0 / 0 |
| `fetch/api/response/response-static-redirect.any.js` | 11 / 0 / 0 | 11 / 0 / 0 |
| `fetch/api/response/response-stream-bad-chunk.any.js` | 6 / 0 / 0 | 6 / 0 / 0 |
| `fetch/api/response/response-stream-disturbed-1.any.js` | 8 / 0 / 4 | 8 / 0 / 4 |
| `fetch/api/response/response-stream-disturbed-2.any.js` | 8 / 0 / 4 | 8 / 0 / 4 |
| `fetch/api/response/response-stream-disturbed-3.any.js` | 8 / 0 / 4 | 8 / 0 / 4 |
| `fetch/api/response/response-stream-disturbed-4.any.js` | 8 / 0 / 4 | 8 / 0 / 4 |
| `fetch/api/response/response-stream-disturbed-5.any.js` | 8 / 0 / 4 | 8 / 0 / 4 |
| `fetch/api/response/response-stream-disturbed-6.any.js` | 5 / 0 / 0 | 5 / 0 / 0 |
| `fetch/api/response/response-stream-disturbed-by-pipe.any.js` | 2 / 0 / 0 | 2 / 0 / 0 |
| `fetch/api/response/response-stream-with-broken-then.any.js` | 0 / 0 / 6 | 0 / 0 / 6 |
| **Total** | **591 / 23 / 166** | **614 / 0 / 166** |

The four baseline passes in `body/textstream.any.js` are negative assertions
that can also succeed when the method is absent. Its ten positive cases fail
on the base and pass with the API implemented. The separate source controls
assert that the method exists before testing unusability, so a missing method
cannot satisfy those controls.

## Source fixes and specification controls

Each source fix has its own commit with a specification citation. The three
`fetch-*-wpt-policy.test.ts` files below are locally authored controls, not
edited or relabeled WPT cases.

| Supplemental source-policy file | Original source at `35be6b18` | Corrected source |
| --- | ---: | ---: |
| `fetch-headers-wpt-policy.test.ts` | 11 pass / 24 fail | 35 pass / 0 fail |
| `fetch-body-wpt-policy.test.ts` | 8 pass / 42 fail | 50 pass / 0 fail |
| `fetch-multipart-wpt-policy.test.ts` | 3 pass / 2 fail | 5 pass / 0 fail |
| **Total** | **22 pass / 68 fail** | **90 pass / 0 fail** |

1. Separate [HeadersInit Web IDL conversion](https://webidl.spec.whatwg.org/#es-union)
   from [Fetch header filling](https://fetch.spec.whatwg.org/#concept-headers-fill).
   Complete dictionary conversion before HTTP validation, cache iterator
   methods and preserve the specified abrupt-completion behavior. Request
   and Response share converted values without invoking script getters twice.
2. Follow [Web IDL record conversion](https://webidl.spec.whatwg.org/#es-to-record):
   take the own-key list once, recheck each descriptor just before processing
   it, convert the key before reading/converting the value, reject enumerable
   symbol keys, and skip properties deleted by an earlier getter.
3. Enforce [required operation arguments](https://webidl.spec.whatwg.org/#es-operations)
   and [forEach callback conversion/invocation](https://webidl.spec.whatwg.org/#es-forEach).
   Empty headers still validate the callback; calls do not read a user-owned
   `.call` override. A separate fix converts both `append`/`set` ByteString
   arguments in order before HTTP validation.
4. In the [Request constructor](https://fetch.spec.whatwg.org/#dom-request),
   reject incompatible modes for source-less streaming bodies before
   transferring an inherited stream. Replayable/replacement bodies retain
   their specified behavior; rejection leaves the original stream usable.
   A separate fix reads Request MIME metadata from its private header list,
   bypassing shadowed public getters.
5. Make each [Body consumption method](https://fetch.spec.whatwg.org/#concept-body-consume-body)
   consume internal state instead of calling overridable `bytes()` or
   `text()` methods. Separately follow [read-all-bytes failures](https://streams.spec.whatwg.org/#readablestreamdefaultreader-read-all-bytes)
   without cancelling a source that supplies an invalid chunk. The explicit
   configured consumption limit still cancels with its exact LimitError.
6. In [Response construction](https://fetch.spec.whatwg.org/#dom-response),
   extract the body after argument conversion and before status validation.
   Separately delay header validation until [initialization](https://fetch.spec.whatwg.org/#initialize-a-response),
   and preserve [Response.json](https://fetch.spec.whatwg.org/#dom-response-json)
   serialization order without rereading input. Another fix derives `ok`,
   cloning and MIME metadata from internal status/header state, including
   immutable guards, rather than public overrides.
7. Implement [MIME extraction](https://fetch.spec.whatwg.org/#concept-header-extract-mime-type)
   from the header list, including quote-aware splitting, invalid entries,
   the final valid essence and the specified charset inheritance rule.
   Reuse the existing MIME parser/serializer for Blob types and form-data
   selection.
8. Implement current-standard [Body.textStream()](https://fetch.spec.whatwg.org/#dom-body-textstream)
   as source orchestration of the existing canonical TextDecoderStream and
   ReadableStream operations. It checks unusability synchronously, returns a
   fresh closed stream for a null body, and decodes UTF-8 independently of
   Content-Type while preserving streaming/error/cancellation behavior.
   Request inherits the common implementation. No encoding implementation
   or native byte path changes.
9. Accept SP/HTAB transport padding at opening, intermediate and closing
   multipart delimiters as required by [RFC 2046 section 5.1.1](https://www.rfc-editor.org/rfc/rfc2046#section-5.1.1),
   while preserving boundary-like payload. Separately report missing part
   headers as the syntax TypeError required by [formData()](https://fetch.spec.whatwg.org/#dom-body-formdata),
   preserving LimitError when the configured header-byte limit is actually
   exceeded. `response-form-data.html` improves from 11 pass / 3 fail to 14 / 0.

The final unused combined header-conversion export was removed after the
repository's unrouted-export gate identified it. The private normalization
helper remains; no allowance was added to the gate.

### Maintainer review requested: exact record enumeration

The cloud rules require asking in the PR before using Reflect. Please review
the narrow `Reflect.ownKeys` use and `Object.getOwnPropertyDescriptor` reads
in Headers record conversion. These implement Web IDL's complete own-key list
and per-key enumerability check; `Object.keys` alone misses enumerable symbols
and cannot preserve the required observation order after getters mutate later
properties. The controls make those differences concrete. No new
`Object.defineProperty`, descriptor mutation or Proxy implementation is added.
If nts refuses these operations, that dependency needs maintainer/compiler
handling; host success does not establish compiler support.

### Node comparisons and specification priority

The repository's [recorded contract](https://github.com/AkisArou/nts/blob/35be6b184ebcdf61e70a93b0b223805e9ab35a7e/docs/records/notebooks/decisions-log.md#L368-L376)
gives applicable specifications priority over Node quirks. Exact Node
24.20.0/Undici 7.29.0 probes inform the review without becoming a blanket skip
rule. Native Headers/Request replay is **32 pass / 3 fail** for the 35 controls:
Node rereads an iterator's `.next`, includes a deleted later record key as
`"undefined"`, and invokes an overridden callback `.call`. The corrected
package follows the linked Web IDL algorithms and passes all 35.

Node also fails the two upstream multipart transport-padding cases. RFC 2046
requires receivers to accept that padding, so both are fixed and remain
runnable here. Node 24.20.0 has no `textStream()` method; its current-standard
implementation is justified by the Fetch algorithm and specification controls,
not a claim of agreement with a missing Node API.

## Required sabotage run

Temporarily changed the package's header-name normalization from
`name.toLowerCase()` to `name`, with fixture bytes, imports and globals
unchanged. `fetch/api/headers/headers-casing.any.js` failed with exit status 1:
**0 pass / 4 fail / 0 blocked**. Node's competing Headers class would not be
affected by this package-source change.

Restored the source byte-for-byte and verified SHA-256
`6ea23c2791f71f469faa28a9b730547e615144f5bc7afad5837c1ff00c384880`.
This restoration hash belongs to the candidate before the later removal of
the unused combined conversion export; it is not mislabeled as the final
file hash. The restored fixture is **4 pass / 0 fail / 0 blocked**. The full
gate below passes after the unused-export cleanup.

## Validation

Exact tools: Node **24.20.0**, pnpm **10.15.0**, unchanged lockfile and no new
npm dependencies. All five new test files are in the explicit `check.sh`
list and the strict WPT test project.

```sh
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/wpt-fetch-data.test.ts
node --expose-gc --test runtime/web-platform/test/wpt-html-support.test.ts
node --expose-gc --test runtime/web-platform/test/fetch-headers-wpt-policy.test.ts
node --expose-gc --test runtime/web-platform/test/fetch-body-wpt-policy.test.ts
node --expose-gc --test runtime/web-platform/test/fetch-multipart-wpt-policy.test.ts
sh tooling/conformance/web-platform/check.sh
```

Both TypeScript projects pass. Prescribed isolated test execution passes
inside `check.sh`. Detailed per-file leaf TAP was additionally captured with
`--test-isolation=none --test-reporter=tap`, one test file per process; every
WPT fixture still receives its own VM context.

| Check | Observed result |
| --- | --- |
| Fetch WPT leaf cases | 614 pass / 0 fail / 166 blocked |
| Supplemental Fetch source controls | 90 pass / 0 fail |
| New HTML adapter controls | 4 pass / 0 fail |
| Full `check.sh` Node suite, including wrappers | 3,305 tests: 3,096 pass / 0 fail / 209 skipped |
| Existing broader upstream runner | 2,817 cases: 2,772 applicable and passed / 0 failed / 45 not applicable |
| Compiled axis | Explicitly skipped: no nts compiler |

The 209 host-suite skips are this selection's 166, the inherited 35 Streams
blocks, seven events/abort capability blocks and one Event descriptor-only
control. The broader upstream runner uses the Node v24.20.0 fixture checkout
prescribed by the repository's bootstrap procedure. The new committed corpus
needs no network or external fixture checkout. PR #2's maintainer-reported nts
compilation is not transferred to this candidate. Native execution, nts
compilation and performance are **not verified** here.

## Deliberately left out and dependencies

The manifest gives each of the 166 named registrations a reason; stale names
or changed registration totals fail the run.

| Category | Cases | Reason |
| --- | ---: | --- |
| Server security profile | 117 | Browser forbidden-header and no-CORS filtering expectations differ from the repository's standalone server profile. Positive operations and HTTP syntax validation remain runnable. |
| Adapter realm | 9 | Three Headers iterator-prototype identity checks and six patched Object.prototype.then checks need the implementation and fixture to share an intrinsic realm. |
| Network | 31 | Selected files contain explicit HTTP/remote-resource paths. Outbound access is prohibited for this item. |
| WPT server templates | 4 | Untouched `.sub.html` fixtures require WPT server substitution that this bounded loader does not provide. |
| Stale WPT expectation | 2 | Empty FormData-as-text assertions expect zero bytes despite the required multipart closing delimiter. |
| Provider capability | 1 | A request-disturbance case requires the absent canonical URL global; URL work is separately owned. |
| Compiler capability | 2 | Response clone cases with ArrayBuffer and DataView chunks require compiler-owned structured cloning beyond the existing byte-view path. |

The 117 profile cases are 72 forbidden-header overrides, 37 Request header
filtering cases, seven no-CORS filtering cases and one Set-Cookie filtering
case. Their basis is the repository's [standalone execution profile](https://github.com/AkisArou/nts/blob/35be6b184ebcdf61e70a93b0b223805e9ab35a7e/docs/reference/web-platform.md#L13-L26)
and Node/Undici's [intentional removal of browser header restrictions](https://github.com/nodejs/node/blob/71b8b174857e25106d39b61a9e6f30d927da8b01/deps/undici/src/README.md#L583-L590),
with exact native probes and source hashes recorded in the manifest. Node
failure alone is not the justification. Native Request probes preserve the
tested operations with an absolute URL because Node has no document base;
they are not represented as execution of the entire unchanged fixture.

For the two empty-FormData cases, the same pinned
[`response-form-data.html`](https://github.com/web-platform-tests/wpt/blob/2b38ea1cb920a2d0f91bf140d0e1eba73db8e742/fetch/api/response/response-form-data.html#L105-L116)
requires a nonempty closing delimiter and passes here. The request fixture
also carries a FIXME. The [multipart encoding algorithm](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#multipart-form-data-encoding-algorithm)
and [RFC 7578 section 4.1](https://www.rfc-editor.org/rfc/rfc7578#section-4.1)
support retaining the closing delimiter; the fixture bytes are not patched.

The two Response clone exclusions are temporary compiler dependencies, not
permanent language exclusions. The other typed-array cloning cases remain
enabled. This contribution supplies no representation-dependent clone
workaround. The broader excluded-path inventory covers real network/server
integration, browser/global exposure, additional realm/lifecycle behavior and
their support files. It does not claim those paths have passed.

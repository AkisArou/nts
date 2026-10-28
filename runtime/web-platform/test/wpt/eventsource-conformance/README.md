# EventSource conformance

This is item 4 of the realtime WPT work, stacked on the tentative
[WebSocketStream PR #26](https://github.com/AkisArou/nts/pull/26). It reuses the
[shared adapter from PR #2](https://github.com/AkisArou/nts/pull/2), its
[network extension from PR #10](https://github.com/AkisArou/nts/pull/10), and the
[Node resource server from PR #3](https://github.com/AkisArou/nts/pull/3).
No second testharness shim, Python process, npm dependency, or system package
is introduced.

## Sources and specification

The WPT revision is
[`a8f306ee4399724f33399dfdcac7da296f3cc05a`](https://github.com/web-platform-tests/wpt/tree/a8f306ee4399724f33399dfdcac7da296f3cc05a/eventsource).
All 45 selected fixtures are copied unedited, preserving their original
headers. [The manifest](manifest.json) records source paths, source URLs,
SHA-256 hashes, Git blob IDs, dependencies, the complete 98-path directory
inventory, and the existing unedited BSD-3-Clause licence. Reused resources
and support scripts match the same revision. The shared loader verifies
original fixture and support bytes and declared dependencies before applying
host and port substitutions.

The [HTML Standard's server-sent events specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
was reviewed on **28 October 2026**; the page reported **26 October 2026** as
its last update. The relevant sections are
[9.2.2, the EventSource interface](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface),
[9.2.3, processing model](https://html.spec.whatwg.org/multipage/server-sent-events.html#processing-model-9),
[9.2.4, Last-Event-ID](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-last-event-id-header),
[9.2.5, parsing](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream),
and [9.2.6, interpreting an event stream](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation).

## Results and execution profile

The manifest selects **45 files and 79 registrations**. The initial baseline
enabled every selected registration, including the three negative CORS cases.

| Evidence set | Before | After |
| --- | --- | --- |
| Selected WPT registrations | 72 pass / 7 fail / 0 blocked | 76 pass / 0 fail / 3 blocked |
| Same final 15 supplemental controls | 7 pass / 8 fail | 15 pass / 0 fail |

The four unsupported-scheme WPT cases change from failures to passes. The
three CORS failures remain explicit blocks, not passes. The supplemental
controls also expose a parser-limit cleanup defect that the selected WPT
cases do not cover; its correction is not claimed as a WPT count reduction.

The recorded full package gate has **2,663 passes, zero failures and 46
skips**. Its separate existing upstream corpus reports **2,772 passes, zero
failures and 45 not-applicable cases**. Those gate totals include other API
areas and are distinct from the 79 EventSource registrations above. Exact
per-file counts, tested revisions and validation evidence are in:

- [before-results.json](before-results.json)
- [after-results.json](after-results.json)
- [per-file-results.md](per-file-results.md)
- [validation.json](validation.json)

Each fixture executes in an ordinary host with this package's `EventSource`
and event classes, a canonical local-server URL, and a fresh cookie jar. The
cookie jar lets the upstream reconnect and credentials resources advance
their state. Node's `EventSource` is not supplied. `self` is the actual VM
global. Upstream Window and Worker environments are recorded for provenance;
this execution does not establish browser or worker exposure, separate-realm
behavior, or browser lifecycle conformance.

Eight audited files use only `document.title`, exclusively to form test
names. Their verified META title is supplied as fixed naming metadata; no
other document member, document identity, or DOM behavior is provided or
tested. The standalone `dedicated-worker/eventsource-eventtarget.worker.js`
body uses a verified reserved testharness import and ordinary EventSource
operations. Its script loader does not implement a WorkerGlobalScope.

## Source fixes

Two separate specification-cited commits change
[`event-source.ts`](../../../src/eventsource/event-source.ts):

1. **Fail requests whose unsupported scheme makes retry futile.** HTML
   9.2.2, constructor step 15.2, permits terminal failure for a known-futile
   network error. Construction still succeeds for a parseable URL; the
   queued error observes `CLOSED` and no reconnect follows. Valid `data:`,
   `blob:` and provider-backed `file:` responses remain supported, while
   transient HTTP and HTTPS failures remain retryable.
2. **Retire the active Fetch after a fatal parser limit.** The parser's
   reader is canceled with the original `LimitError` while it still owns the
   body, and its lock is released even if cancellation rejects. The attempt's
   controller is then aborted with that same error before its reference is
   cleared. The queued terminal error and no-retry behavior from HTML 9.2.3
   are preserved. Public `close()` and runtime shutdown retain ordinary
   `AbortError` cancellation; the fix does not call `close()` early and
   suppress the terminal error.

The 15 controls cover four unsupported schemes, three supported local
schemes, transient HTTP/HTTPS failures, line/event limits with successful or
rejected cancellation, and public close/runtime shutdown. They use controlled
providers and `VirtualScheduler`, with no elapsed-time assertions. Existing
retry, Last-Event-ID, BOM and line-parsing behavior is exercised by the
unchanged fixtures and existing package controls. No Fetch, core encoding,
provider bootstrap, native byte work, or reflective surface initialization is
changed by these fixes.

## Remaining blocks and exclusions

The following registrations in `eventsource-cross-origin.window.js` remain
named `fetch-cors-policy` blocks:

- `EventSource: cross-origin allow-origin: http://example.org should fail`
- `EventSource: cross-origin allow-origin:'' should fail`
- `EventSource: cross-origin No allow-origin should fail`

They require Fetch to reject missing or mismatched
`Access-Control-Allow-Origin` responses. The current ordinary-host Fetch
policy does not enforce that browser policy, and Fetch source remains owned
by the separate task until the later network-Fetch item. The three positive
resource/origin registrations in the same file still run. Their success is
not a claim of browser CORS enforcement.

The inventory explicitly excludes **21 fixture files and 27 registrations**:

| Category | Files | Registrations | Reason |
| --- | ---: | ---: | --- |
| Dedicated-worker wrappers | 7 | 10 | Require browser Worker creation, messaging or lifecycle. |
| Shared-worker wrappers | 7 | 10 | Require SharedWorker, ports and worker lifecycle. |
| Document, navigation and iframe cases | 4 | 4 | Require `document.domain`, `window.stop()`, or iframe URL/event realms. |
| Prototype mutation | 1 | 1 | The only case adds a method to `EventSource.prototype`; no independent registration can be retained. |
| Wall-clock retry assertions | 2 | 2 | Require a measured 3,000 ms delay to stay within 25%; the concurrent gate cannot guarantee this. |

The two timing files remain unchanged upstream and excluded from this
profile. Existing virtual-time controls cover reconnection timing. The
remaining inventory consists of 13 existing resources, 16 browser-worker
support scripts and three metadata files. Every omitted path and its reason
is recorded in the manifest. FileReader and constant-descriptor work remain
deferred in the prerequisite areas; this item adds no such workaround.

## Running and negative control

From the repository root, with Node 24 and the repository's pnpm version:

```sh
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/wpt-eventsource.test.ts
node --expose-gc --test runtime/web-platform/test/eventsource-wpt-policy.test.ts
sh tooling/conformance/web-platform/check.sh
```

`NTS_WPT_EVENTSOURCE_FILTER` is an explicit diagnostic substring filter over
the fixture path plus variant. The normal gate leaves it unset and runs all
45 files. For example:

```sh
NTS_WPT_EVENTSOURCE_FILTER=format-field-data.any.js node --expose-gc --test --test-reporter=spec runtime/web-platform/test/wpt-eventsource.test.ts
```

Network deadlines are **60 seconds**; reconnect and declared-long deadlines
are **120 seconds**. The selected fixtures declare no long timeout. These
are failure bounds, not assertions about how quickly the machine completes
an operation.

The required sabotage used an isolated checkout and the unchanged
`format-field-data.any.js` case. Temporarily changing delivered data from
`event.data` to `event.data + "!"` produced **zero passes and one WPT failure**;
restoring the original source bytes produced **one pass and zero failures**
with the same command. This verifies that the fixture exercises the package
implementation. Wrapper test counts are kept separate in the validation
record.

All recorded execution is host evidence under Node. The full gate explicitly
skips its compiled axis when the nts compiler is absent. These results make
no claim that the changed source has compiled or run on native, JVM or
WebAssembly targets; maintainers run the compiled checks when landing the
stack.

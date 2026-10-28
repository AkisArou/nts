# Network Fetch: inventory and HTTP resource preparation

This item prepares network Fetch coverage while [#27](https://github.com/AkisArou/nts/pull/27)
and [#45](https://github.com/AkisArou/nts/pull/45) are open. It adds original Node
HTTP resource handlers and their controls, plus a complete source-path inventory
of `fetch/api/`. It does not edit `src/fetch/`, import WPT fixtures, or report an
nts WPT pass count. Execution work starts from `main` after both prerequisites
land, as required by the handoff.

## Inventory and provenance

[inventory.json](inventory.json) accounts for **all 292 paths** under
`fetch/api/` at the inherited revision. Each row records its source URL,
revision, SHA-256, Git blob ID, disposition and reason. Test rows also record
declared support scripts, relevant resources and available Undici compatibility
context. Mixed files identify known case exclusions by their upstream names.
The few names containing an origin use explicit inventory URL placeholders;
the future driver must resolve them against its allocated server origins.

| WPT directory | Revision |
| --- | --- |
| `fetch/` | `2b38ea1cb920a2d0f91bf140d0e1eba73db8e742` |
| `common/` | `dbd648158d337580885e70a54f929daf215211a0` |
| `resources/` | `6a2f32237615d7ea9c1eb1e30453066b5555c603` |

These are the Fetch data-type stack's existing pins and match the shared
[`versions.json` in #47](https://github.com/AkisArou/nts/blob/852a0525b4e740674c3789ffaaaa1b3ac41a4676/runtime/web-platform/test/wpt/versions.json).
That table is owned by an open PR, so this preparatory change does not edit it.
Every subsequently imported fixture and helper must be registered there, using
the recorded bytes and existing BSD-3-Clause notices. Existing fixtures and
shared helpers are reused at their canonical WPT paths; no second copy is
introduced. `externalResourceReferences` includes the hashes of required
resources outside `fetch/api/`, including raw HTTP references under `xhr/`.

The [Undici status file](https://github.com/nodejs/undici/blob/609c6efca79f1592954d5fe10e58f69cda342a07/test/web-platform-tests/expectation.json)
is pinned at `609c6efca79f1592954d5fe10e58f69cda342a07`. It contains recorded
outcomes, including failures for browser-only behavior; it is not an applicability
allowlist. The inventory maps its generated `.any.html` and `.window.html`
entries back to source files, preserving query variants. Its per-file success,
failure and other counts are **Undici's recorded context**, not measurements of
nts. Missing status entries do not imply success or exclusion.

| Inventory disposition | Paths |
| --- | ---: |
| New network candidates, including mixed files with named exclusions | 36 |
| Existing #18 fixtures with network registrations to revisit | 9 |
| Existing data-type coverage to retain | 45 |
| Local companion cases without HTTP body transport | 8 |
| Deferred HTTP resource, cache, cookie, Blob URL, HTTP/2, accepting-peer or crashtest capability | 22 |
| Browser environment/profile, reflection, or timing exclusions | 77 |
| Resources/helpers | 84 |
| Upstream feature metadata | 11 |
| **Total paths** | **292** |

These are file counts. Candidate means the operation is relevant to a standalone
client; it does not assert that its resource, provider or adapter is ready, or
that its current source passes.

## Cases to execute after the prerequisites land

The first finite HTTP group covers default and explicit request headers, header
case and byte preservation, request body uploads, null response bodies, status,
UTF-8 decoding, response URLs, immutable response headers, explicit
authentication and authorization stripping on cross-origin redirects. The
redirect group covers method/body/header transitions, missing and empty
Location, supported schemes, escaped Location bytes, follow/error modes and
the twenty-redirect limit. Relevant specification anchors are
[HTTP-network-or-cache fetch](https://fetch.spec.whatwg.org/#http-network-or-cache-fetch),
[HTTP-redirect fetch](https://fetch.spec.whatwg.org/#http-redirect-fetch),
[HTTP-network fetch](https://fetch.spec.whatwg.org/#http-network-fetch),
[response body](https://fetch.spec.whatwg.org/#concept-response-body),
[Headers guards](https://fetch.spec.whatwg.org/#concept-headers-guard), and the
[Body mixin](https://fetch.spec.whatwg.org/#body-mixin).

The abort group contains `abort/general.any.js`, `abort/request.any.js` and
`abort/cache.https.any.js`. The Cache API case uses canonical `runtime.caches`;
it needs no browser document. Tests of abort reason identity, already-aborted
signals, Request signal following and body disturbance remain applicable under
[Fetch's fetch method](https://fetch.spec.whatwg.org/#fetch-method) and
[abort fetch](https://fetch.spec.whatwg.org/#abort-fetch). Connection-closure
polling and the test that infers absence of a request from an unrelated request's
completion are named separately in the inventory.

The existing data suite already imports `response-stream-disturbed-1.any.js`
through `response-stream-disturbed-5.any.js`. Their **twenty named fetched-body
registrations** are recorded as network-blocked in #18; the future network
selection can execute them against `data.json`. The other existing files to
revisit are `request-init-priority.any.js`, `response/json.any.js`,
`response-cancel-stream.any.js` and `response-clone.any.js`. Their upstream
copies and unrelated existing exclusions remain owned by #18. The clone cases
compare completed content and can become eligible when a deterministic finite
`trickle.py` resource is available; their use of that route does not by itself
make their assertion depend on elapsed time.

The inventory also retains referrer and Origin-header candidates with explicit
client settings. Missing source policy is not reclassified as a browser-only
case merely because a current implementation fails it. Likewise,
`cors/cors-redirect-credentials.any.js` tests redirect URL-credential rejection
that can apply without enforcing CORS; its `preflight.py` destination resource
is still pending.

## HTTP resources prepared here

[`../server/fetch-handlers.ts`](../server/fetch-handlers.ts) implements these
finite routes from the pinned Python references. Original controls in
[`../../wpt-fetch-server.test.ts`](../../wpt-fetch-server.test.ts) exercise the
real HTTP listener; they do not run nts Fetch or substitute Node Fetch for it.

| Route under `/fetch/api/resources/` | Behavior exercised by later WPT |
| --- | --- |
| `echo-content.py` | Echo raw request body and request method, Content-Type and Content-Length metadata |
| `method.py` | Echo body and request metadata, including request body headers used by redirects |
| `status.py` | Supplied status, reason phrase, Content-Type and byte-preserving query content; HEAD/null-body handling |
| `inspect-headers.py` | Requested header values and the endpoint's optional CORS response fields |
| `echo-header-bytes.py` | Hex representation of request header bytes, including Last-Event-ID |
| `redirect.py` | Redirect status and Location, query propagation, token/count state, OPTIONS state and referrer-policy header |
| `redirect-empty-location.py` | An explicitly empty Location field |
| `clean-stash.py` | Remove redirect token state |
| `authentication.py` | Basic authorization acceptance/challenge |
| `dump-authorization-header.py` | Observe authorization before and after redirecting |

The handlers use Node services only in test infrastructure. They add no npm
dependency and no WebSocket behavior. Unsupported resource modifiers must fail
explicitly. Nonzero redirect delays, timed streaming, multipart POST parsing
for resource control fields, and generic response pipes on these new dynamic
routes are outside this finite handler profile. Selected redirect fixtures use
query control fields even when their request body is POST data.

The existing server supplies stash operations and common redirect/blank
resources; this preparation also adds `application/json` static serving.
Future fixture imports must supply the exact pinned `top.txt`, `cors-top.txt`,
`empty.txt` and `data.json` bytes. Response-URL tests may intentionally fetch missing paths; successful
Fetch promise resolution for a 404 response is distinct from successfully
serving a required fixture body. A missing resource must never turn an error
expectation into a false positive.

## Explicit boundaries

Browser forbidden-header filtering, opaque and opaqueredirect responses, CORS
failure/preflight enforcement, document/worker lifecycle and cross-realm
bindings retain their named profile exclusions. The applicable branches of
mixed files remain candidates. Prototype/descriptor mutation cases are outside
the fixed-layout source rules in
[`cloud-agents.md`](../../../../../docs/contributing/cloud-agents.md).

No timer decides a test result. `stream-response.any.js` assumes a certain
number of reads from a timed trickle; `response-body-stashed-chunk.html` uses
both sleeps and a deadline; `request-keepalive-quota.html` and
`crashtests/huge-fetch.any.js` also depend on delayed execution. Those files are
explicitly excluded. `abort/general.any.js` lists its wall-clock polling and
`step_wait` cases by name. A separately authored completion-driven control may
cover their underlying policy without editing or relabeling the WPT case.

Resource capability gaps are kept separate:

- Node's HTTP listener rejects extension methods such as `Chicken`, `TacO`
  and `TESTING` with HTTP 400 before handler dispatch. Their exact request and
  redirect registrations need a suitable resource peer. This is not evidence
  of Fetch method-normalization failure.
- Duplicate/invalid raw response headers and malformed chunk framing require
  an exact raw HTTP resource path. In `error-after-response.any.js`, the first
  body read must complete before the peer sends malformed framing; replacing
  upstream sleeps with an immediate corrupt response does not preserve that
  ordering.
- The 421 retry and 425 non-retry cases need connection-aware request counters.
  The HTTP/2 fixtures need an HTTP/2 resource peer. These are additional Fetch
  resource needs, distinct from the already recorded realtime extended-CONNECT
  gap.
- HTTP cache tests need explicit cache integration and a consistent injected
  clock. Cookie tests need the cookie jar and Set-Cookie pipe semantics. Blob
  URL tests need WPT URL static exposure of the package's existing
  `BlobURLStore` and runtime object-URL operations. These remain relevant
  capability work; they are not all browser-only APIs.
- The bad-port fixture needs its positive accepting-peer/proxy control for
  `bad-port.wpt`. Source changes for 4190 and 6679 belong to #24.

## Execution and evidence plan

After both prerequisite landings, refresh `main`, reconcile the shared adapter
and versions table, import the selected original files, and supply canonical
package values with the ordinary-node provider. Configure explicit origins,
client referrer settings, digest/cache capabilities where selected, and the
resource server. Verify every required resource directly before treating a
Fetch rejection as a valid result.

Capture one report row per upstream file (and each selected query variant),
with pass, failure and named blocked cases. Capture the same selection against
the source before each fix. Each source fix gets a separate commit citing the
Fetch section it implements. Run `pnpm install`, the conformance TypeScript
project, the focused Node tests and the full web-platform `check.sh`; its
compiled axis is expected to skip when nts is unavailable. Test command output
for this preparation belongs in its PR description. No network Fetch result is
claimed until that execution occurs.

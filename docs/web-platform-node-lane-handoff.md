# Web-platform Node/shared-runtime handoff

## Why this handoff exists

The original Node/shared-TypeScript session stopped at the repository owner's request
because its subscription budget was nearly exhausted. The last feature slice is
committed and verified; no new feature tranche was started after that request.

Continue the Node lane of the governing contract in
[`docs/web-platform-integration-plan.md`](web-platform-integration-plan.md). This is
not a fresh import and it is not permission to simplify the contract to the original
external delivery. The target is the complete server/mobile profile specified by the
plan. Read this file, the plan, and
[`runtime/web-platform/docs/BASELINE.md`](../runtime/web-platform/docs/BASELINE.md)
before editing.

## Suggested continuation goal

Own and complete the shared TypeScript Web-platform lane described by
`docs/web-platform-integration-plan.md`. Preserve the canonical, strictly typed,
environment-owned architecture and immutable upstream fixtures. Work primarily in
`runtime/web-platform/**` and `tooling/conformance/web-platform/**`; coordinate every
shared ABI or ownership change with the compiler/common-runtime and JVM peers before
editing their paths. Reproduce the current host and upstream baselines first, then
continue from the open decisions and ordered next work below. Do not introduce
compiler-gap workarounds, shared process globals, synthetic realms, unchecked casts,
or host-only behavior into shared source. Every completed slice needs positive tests,
a sabotage whose precondition is verified, a fresh NTS diagnostic measurement, a
narrow commit, and an evidence update. Host execution is not compiled-provider
evidence. Preserve unrelated changes in the shared dirty worktree.

## Exact checkpoint

- Governing implementation-start commit: `31f15a0`.
- Last commit from this lane: `1cd2d5df` (`The capability the raw transport cannot
  have`). The section below titled *Last completed slice* describes `03c03d93` and is
  kept as history; see *Where this lane is now* for the current state.
- HEAD observed while writing this handoff: `b7651b84`; while updating it, `bca60e9e`
  -- which is another lane's commit, not this one's, and it had moved between reading
  it and writing this line. Use the current HEAD; neither value is a tip for long.
- `origin/main` was at `dcfb2a78` when this handoff began. Do not push merely because
  this file records that observation.
- The worktree is shared and dirty with other agents' work. Do not clean, reset,
  restore, reformat, or stage paths outside this lane.

`runtime/web-platform/docs/BASELINE.md` is the chronological evidence ledger and is now
**ahead of this file**: every slice named below has its entry there, with the numbers,
the sabotages and the stated limits. Read the ledger's tail first; this file is the map,
not the record.

## Where this lane is now

Newer than every section that follows. Those describe an earlier checkpoint and are kept
for their reasoning rather than their status.

**Closed since:** the storage row — a provider-backed durable byte store with a portable
flat adapter, spill-to-disk, and a replay body for retry that is released when the
dispatch settles; the caching row — a persistent `HttpCacheStore` and a durable
`CacheStorageStore` serving the real `Cache`/`CacheStorage` API; Undici-shaped `request`,
`stream` and `pipeline`; a transport seam that surrenders its connection on a protocol
switch, with `connect` and `upgrade` built on it; and a WebSocket client that opens
through the HTTP dispatch stack and therefore works through a CONNECT proxy.

**Current numbers**, all with one binary pinned from the current tree and the same
binary on both sides of every slice, on `runtime/web-platform/tsconfig.json`:

- 1,296 primary `NTS1001`, 314 `NTS1003`, and zero `NTS1004`, `NTS4xxx` and invalid HIR
  — **but read the `NTS4xxx` zero with the correction in the ledger**: a backend defect
  behind a language refusal never reaches the emitter, so that zero says "nothing
  currently emitted trips the backend", and it gets harder to keep as primaries fall;
- local Node-host/real-socket corpus **717/717**, zero skipped;
- pinned upstream corpus **2,433 tests, 2,418 applicable, 2,408 passing, 10 failing** —
  the eight long-standing structural failures plus the two `Event.timeStamp` assertions;
- compiled axis **138 of 142 cases across 13 functions**, agreeing on jvm, c and llvm,
  with the four declines being the out-of-range typed-array read reported to the compiler
  lane with a minimal reproduction;
- `unrouted.mjs` clean over 101 audited files and 719 corpus files.

**The upstream corpus grew from 2,300 by pinning fixtures already sitting in Node's
vendored checkout** — nothing was fetched. That vein is now exhausted for in-profile
areas: the remaining unpinned Encoding fixtures test legacy single-byte and ISO-2022
encodings this profile does not claim, and pinning a test to watch it fail for a known
reason is not evidence. Three conformance gaps it exposed are fixed (UTF-16 decoding,
`Event.isTrusted` as an unforgeable own accessor, `Blob.stream()` as a byte stream) and
one boundary is recorded as not applicable with its reason.

**Still open, and why.** The **public server module or package** is a repository-layout
decision. The **Undici API ledger** still cannot be written honestly with nothing
pinned. **Server-side TLS** — terminating `wss://` — is deliberately separate: it needs a
certificate and a private key, which on Android means a key store and a set of questions
about where the key lives, and coupling it to the listener would have held the listener
behind it. And whether the dispatched WebSocket transport should become the *default* has
been left as a deliberate decision rather than taken by accident.

**One ABI proposal is outstanding: a monotonic clock.** `Event.timeStamp` is two failing
upstream assertions and cannot be implemented without one — shared source has no clock
by convention (`defaultNow()` returns literal `0`), and `new Event("x")` is constructible
with no runtime to inject into. The JVM lane has measured `System.nanoTime()` on a device
and confirmed the contract is keepable, with the caveat that it stalls rather than
reverses during deep sleep. The Node lane has not answered yet.

**One ABI change went in and the JVM lane has confirmed it on a device.**
`DurableByteStore.source` now promises that a reader keeps reading what it was opened
over even after the key is replaced or deleted. Without it nothing above the seam can
release stored bytes while anything might still be reading them.

**Two instrument defects found here.** `tooling/conformance/web-platform/check.sh` had
stopped running its compiled axis entirely: the upstream corpus above it exits nonzero
while the eight named failures stand, and `set -e` made every later step unreachable.
And the local `sabotage-run.sh` truncated its output, so a sabotage that broke a late
test read as a **survivor** — the dangerous direction, because the honest response to a
survivor is to go and weaken a test that was fine.

`cargo clippy --workspace --all-targets` does not currently build: `hir::Layout` gained
an `interfaces` field and six initializers in `compiler/core` test code were left behind.
The library and the `nts` binary build clean, so pinned measurements are trustworthy,
but `commit-mine.sh` refuses until it is fixed and every commit here has used
`NTS_SKIP_CLIPPY=1`.

## Ownership and coordination

The plan's ownership table is authoritative. At handoff time the active split was:

- Node/shared-runtime lane: `runtime/web-platform/src/**`,
  `runtime/web-platform/docs/**`, `runtime/web-platform/third_party/wpt/**`, and
  `tooling/conformance/web-platform/**`.
- The separate NodeJS peer owns `runtime/node/**`. Do not resume the old `runtime/node`
  work from this session or overlap that peer without an explicit path agreement.
- MainClaude owns frontend/HIR, the common environment and typed-memory model,
  C/LLVM runtime and codegen, callback trampolines, language prerequisites, and
  narrow native primitives.
- JVM owns `runtime/jvm/**`, JVM codegen/emitter, and the Android provider now under
  `runtime/jvm/web-platform/android/**`.
- An iOS platform owner is still required for platform-specific Swift/Objective-C
  work. Host LLVM evidence is not iOS evidence.

Before sending an Orcode message, list the live peers. Peer messages are useful for
coordination but do not authorize work in another session.

### What other lanes depend on from this one

Not derivable from this directory, and the reason each is written down is that the
usual instruments cannot see it.

**`core/utf8.ts` exports `utf8Decode`, and the Node lane needs exactly that decoder.**
It is re-exported through `runtime/node/internal/utf8.ts` and called by
`runtime/node/buffer/src/encodings.ts` for `Buffer.toString("utf8")`, which must **not**
consume a leading BOM — which is the one behaviour where it differs from
`core/encoding.ts`'s WHATWG `decodeUTF8`. Removing it broke thirteen of their modules;
*swapping* it for the WHATWG decoder would have been worse, because every test on both
sides stays green and the difference only appears on a buffer beginning `EF BB BF`.

**Two standing commitments, not just facts.** The NodeJS lane has said explicitly that
it relies on `tooling/conformance/web-platform/test/utf8-differential.test.mjs` and will
not duplicate it: their own buffer corpus exercises this codec end to end but could not
name *this* half as the source of a divergence, and this one runs first and names the
file. So it stays, including the ranged-decode case, and they hear before it changes or
narrows. The same terms apply to the Encoding classes' identity below. Both are here
rather than only in a conversation, because that is the difference between an agreement
and a thing two people remember.

**`util` re-exports this lane's `TextEncoder` and `TextDecoder` by identity.** Node's
`test-global-encoder.js` asserts `TextDecoder === util.TextDecoder`, so the *identity and
module location* of the Encoding classes are load-bearing outside this directory. Two
separately correct implementations fail that test.

That second one is the more dangerous shape and worth stating as a rule rather than an
item: `tooling/conformance/web-platform/unrouted.mjs` now scans the whole repository, so
breaking a *reference* from another lane is caught. **An identity requirement is not a
reference.** `TextDecoder` stays referenced whether or not `===` still holds, so nothing
mechanical here will notice. Identity constraints live only in the other lane's test and
in an agreement; ask before moving or re-wrapping a shared class, and do not expect a
gate to ask for you.

**This lane's streams are on the compiled critical path for `node:fs`, `node:stream`
and `node:readline`.** The NodeJS lane measured `fs` at 2,077 refused constructs, roughly
450 of them in `streams/fifo.ts`, `streams/writable.ts`, `streams/readable.ts` and
`provider/web-platform-runtime.ts`.

**An earlier version of this section said the largest blocker was nullable and optional
properties. That was wrong, it was retracted by the lane that reported it, and the
retraction was verified here rather than accepted.** A plain nullable property compiles:

    class Holder { slot: number | undefined = undefined; }        no refusal
    class Holder { slot: Marker | null = null; }                  no refusal
    class Holder { readonly slots: (number | undefined)[] = []; } no refusal

All three compile and agree with node on 34 generated cases. The `| null` appearing in
those diagnostics is in the message because it is in the *type*, not because it is the
cause — `PromiseWithResolvers<void>` and `PromiseWithResolvers<void> | null` are the same
refusal, one of them wearing a union.

**One narrower claim survives and is real.** A `T | undefined` where `T` is a *type
parameter* refuses, and `Fifo<T>` has that shape:

    class Slot<T> { value: T | undefined = undefined; }
    -> `null` or `undefined` where what it stands in for is not a reference

Verified in isolation: the three non-generic shapes alone produce no refusal, and the
generic one alone produces exactly that.

**So the real blockers in these files are property types that are objects with function
members** — `PromiseWithResolvers` and its kind — along with async iterators,
promise-likes and weak references. Nothing here should be bent around any of them.

The boxing constraint recorded earlier — that a representation which boxed a nullable
property would satisfy the type and defeat the purpose of `Fifo` clearing a dequeued slot
— **is still sound engineering and is no longer a live design input**, because the fix it
constrained is not one anybody is scoped to make. It is kept as advice rather than
deleted, and marked as advice.

**Two standing commitments, not just facts.** The NodeJS lane has said explicitly that
it relies on `tooling/conformance/web-platform/test/utf8-differential.test.mjs` and will
not duplicate it: their own buffer corpus exercises this codec end to end but could not
name *this* half as the source of a divergence, and this one runs first and names the
file. So it stays, including the ranged-decode case, and they hear before it changes or
narrows. The same terms apply to the Encoding classes' identity below. Both are here
rather than only in a conversation, because that is the difference between an agreement
and a thing two people remember.

**`util` re-exports this lane's `TextEncoder` and `TextDecoder` by identity.** Node's
`test-global-encoder.js` asserts `TextDecoder === util.TextDecoder`, so the *identity and
module location* of the Encoding classes are load-bearing outside this directory. Two
separately correct implementations fail that test.

That second one is the more dangerous shape and worth stating as a rule rather than an
item: `tooling/conformance/web-platform/unrouted.mjs` now scans the whole repository, so
breaking a *reference* from another lane is caught. **An identity requirement is not a
reference.** `TextDecoder` stays referenced whether or not `===` still holds, so nothing
mechanical here will notice. Identity constraints live only in the other lane's test and
in an agreement; ask before moving or re-wrapping a shared class, and do not expect a
gate to ask for you.

**This lane's streams are on the compiled critical path for `node:fs`, `node:stream`
and `node:readline`.** The NodeJS lane measured `fs` at 2,077 refused constructs and
roughly 450 of them are in `streams/fifo.ts`, `streams/writable.ts`, `streams/readable.ts`
and `provider/web-platform-runtime.ts`. Two distinct compiler blockers, not one: nullable
and optional properties (305 sites) and plain unrepresentable property types such as
`PromiseWithResolvers` (164). Nothing here should be bent around either — they were
inspected and every nullable one is nullable by design, either to *release* a reference
(`Fifo` clears a dequeued slot so the value is not retained) or because null is a value
in the domain (a list head when empty). The first kind matters to whoever fixes it: it is
not "might not be there", it is "deliberately made absent", and a representation that
boxed it would satisfy the type and defeat the purpose.

The NodeJS lane searched their pinned suite and found exactly one explicit `===`
assertion, `test-global-encoder.js`, covering `TextEncoder`/`TextDecoder`, `URL`,
`URLSearchParams`, `Blob`, `File`, `AbortController`, `AbortSignal`, `Event`,
`EventTarget` and `CustomEvent`. **Do not read that as the exposure.** They also named
the invisible form, which is the one that matters: `instanceof` across the boundary. A
program that builds a `Blob` from the global and hands it to something checking
`instanceof` against a differently-sourced `Blob` fails exactly as an identity failure
does, matches no search for `===`, and surfaces as a wrong-type error rather than a
missing reference. Neither lane has a list of those and neither should invent one — a
guessed list would look like coverage. Every canonical global reused across the boundary
is a candidate, which is the whole rule.

## Last completed slice

Commit `03c03d93` removed repeated ambient declarations and made the environment slot
the single shared access seam:

- `runtime/web-platform/src/provider/environment.ts` owns the exact typed ambient
  natives `nts_environment_install_platform` and `nts_environment_platform`.
- Fetch, Request, Response, FormData, Blob, EventSource, WebSocket, and
  WebSocketStream resolve their runtime through the environment.
- The ordinary-Node conformance host supplies a deliberately host-only single-runtime
  shim. Shared TypeScript contains no process-global fallback.
- `AbortSignal.timeout(milliseconds)` again has its standard one-argument public
  signature and obtains its scheduler from the environment.
- `[EnforceRange] unsigned long long` conversion is shared Web-IDL code, including
  truncation before the provider-independent 64-bit range check.
- The complete pinned Node WPT `dom/abort/timeout.any.js` fixture is immutable and
  hash-verified.

Positive evidence for this slice:

- repository TypeScript check: pass;
- complete local Node-host/real-socket corpus: 402/402;
- pinned timeout WPT: 3/3;
- complete currently pinned upstream corpus: 2,300 total, 2,286 applicable,
  2,278 pass, 8 fail, 14 named not-applicable;
- environment-install sabotage: changing installation to a no-op made the focused
  access test fail 0/1 with “runtime was read before installed”; restoration returned
  it to green.

An NTS check with the release binary available to this session produced valid HIR,
no environment-symbol or JVM-backend refusal, 1,264 primary `NTS1001` diagnostics,
and 228 `NTS1003` cascades. Do not make those two counts a durable frontier: compiler
sources and binaries were moving concurrently. Rebuild the current compiler, name
the measured commit, and regroup diagnostics by feature before quoting a new count.

## Exact visible upstream failures

The complete upstream runner intentionally exits nonzero while these remain visible:

1. `fetch/api/headers/headers-basic.any.js :: Check keys method`
2. `fetch/api/headers/headers-basic.any.js :: Check values method`
3. `fetch/api/headers/headers-basic.any.js :: Check entries method`
4. `streams/piping/then-interception.any.js :: piping should not be observable`
5. `streams/piping/then-interception.any.js :: tee should not be observable`
6. `streams/transform-streams/general.any.js :: methods should not not have .apply()
or .call() called`
7. `streams/readable-streams/async-iterator.any.js :: Async iterator instances
should have the correct list of properties`
8. `streams/writable-streams/general.any.js :: methods should not not have .apply()
or .call() called`

These are structural/common-runtime dependencies, not eight missing network
features. The known dependency shapes are:

- canonical iterator and iterator-result objects with the correct intrinsic and
  realm identity for `Headers` iteration;
- internal Promise observation that cannot be intercepted through a user-visible
  `.then` property;
- compiler-synthesized bound-method values that capture the method and its receiver
  once, then invoke through the existing closure calling convention, instead of
  shared source calling user-replaceable `.call` or `.apply`;
- the Web-IDL async-iterator object/prototype shape: its immediate prototype extends
  `%AsyncIteratorPrototype%`, owns enumerable/writable/configurable `next` and
  `return`, and has no `throw`.

The async-iterator WPT runs in a VM realm while the API is imported from the host
realm. Do not falsify the comparison by substituting the test realm's intrinsic.
Either execute API code in the test realm or assert against the API realm's canonical
intrinsic, coordinated with the compiler/common-runtime owner.

An arrow such as `(chunk) => sink.write(chunk)` avoids hostile `.call`/`.apply`
properties and passes the currently pinned receiver test, but it re-reads
`sink.write` at invocation time. Web IDL requires capturing the method once with its
original receiver. Keep the failure visible until the real bound-method primitive
lands; do not trade the visible failure for that untested semantic deviation.

## What is already implemented in shared TypeScript

Do not rebuild these from the external archive. The tree already contains substantial
reviewed work:

- canonical events, aborts, DOMException, encoding, Blob/File, FormData,
  URLSearchParams, Headers, Request/Response, bodies, data URLs, and Blob URLs;
- readable, writable, transform and byte Streams, tee, piping, async iteration, BYOB,
  and transfer-sensitive body behavior;
- HTTP/1.1 parsing, connection pooling and real-socket host transport;
- HPACK/Huffman, HTTP/2 frames, multiplexed connection state, flow control, and a
  prior-knowledge HTTP/2 Fetch transport;
- Fetch policy, redirects, retries, cookies and a persistent jar, RFC 9111 cache
  policy, public Cache/CacheStorage, content codings, and DNS policy;
- WebSocket, `WebSocketStream`, RFC 7692 `permessage-deflate`, and EventSource;
- Undici-style Agent, Client, Pool, BalancedPool, MockAgent, SnapshotAgent,
  interceptors, bounded deduplication, response policies, and typed diagnostics;
- direct, HTTP CONNECT, and SOCKS5 proxy routing with environment proxy policy and
  graceful proxy transport shutdown.

The ledger contains each slice's actual limits, tests, and sabotage. A feature name in
this list is not a claim of complete compiled-provider or standards evidence.

## Newer proxy commits

These commits follow the last ledger entry and should be summarized when the ledger
is next updated:

- `8948eca6` — portable HTTP CONNECT and SOCKS5 tunnel connectors;
- `52b629fa` — environment proxy policy and modern Undici-style `NO_PROXY` matching;
- `93364490` — proxy dispatch agents, including absolute-form HTTP and tunneled TLS;
- `185145f9` and `1db768c0` — protocol connections and sockets routed through the
  environment policy;
- `44eea06a` — WebPlatformRuntime owns proxy routing used by Fetch, EventSource, and
  WebSocket;
- `dcfb2a78` — graceful pool drain is distinct from forceful destroy.

Security invariants already tested include TLS identity against the logical target,
never the proxy, typed proxy authentication, dynamic bypass policy, and provider
shutdown. Preserve them when introducing automatic HTTP protocol selection.

## Open decisions and dependencies

### Negotiated ALPN: the ABI is settled and landed; selection is not built

Resolved for the ABI half. `NegotiatedConnection`, `NegotiatingSocketConnector`,
`NegotiatingTlsUpgrader`, `ProtocolPreference` and the `offeredProtocols` /
`offeredUpgradeProtocols` contract are in `runtime/web-platform/src/provider/`, agreed
with the compiler/common-runtime and JVM owners before editing. The rule that fell out
of a real API-26 device measurement is that **a connector which cannot report a
selection is never offered a choice**. See "The connect result reports what TLS
negotiated" in `runtime/web-platform/docs/BASELINE.md`.

Selection is now built too. `ProtocolSelectingTransport` chooses the engine from what
TLS negotiated, once per origin, and hands that engine the stream the decision was made
on; it is covered on the direct, HTTP CONNECT and SOCKS5 routes against real servers.
See "The engine is chosen on the connection the decision was made on" and "The contract
survives a proxy" in the ledger.

HTTP/2 connection coalescing is built too, using `certificateNames` plus a matching
endpoint and port, off by default. See "Coalescing, and the endpoint question it
forced" in the ledger, including the architectural finding it surfaced: the reuse
decision happens before connecting, while the endpoint an origin resolves to is chosen
by the DNS policy *below* the transport, so the transport is given a synchronous
`knownEndpoint` probe of what is already resolved rather than being allowed to resolve
at the pool.

Still open in this area: wiring `knownEndpoint` to the shared DNS cache, which is its
natural consumer. Only the ordinary-Node conformance host implements the new members,
and host execution is not evidence that a real provider can report a selection.

The original statement of the problem follows.

### Negotiated ALPN was not exposed by the shared connection ABI

`ConnectAddress.alpnProtocols` expresses what the caller requests, but
`ByteConnection` does not expose the protocol selected by TLS. The current host
adapter validates an expected protocol internally; shared policy cannot negotiate
`["h2", "http/1.1"]` once and then choose the correct engine over that same socket.

Resolve the typed provider ABI with MainClaude and JVM before implementing automatic
H1/H2 selection. Do not reconnect after negotiation merely to change engines, and do
not infer the protocol from request intent. The resulting contract must work for
direct and proxied TLS and preserve target hostname verification.

### Native environment slot and provider capabilities

Shared source now consumes the environment slot. MainClaude reported the C/LLVM slot
implemented and under gate with retain/replace/close ownership tests. Recheck the
current tree and their latest commit before claiming compiled execution. Verify JVM
and every real provider separately. Bootstrap order is environment, platform runtime,
then host.

`WebPlatformRuntime` also now carries provider-native line ending and wall-clock
milliseconds. Confirm the common and JVM host capability implementations rather than
adding a shared fallback.

### Compiler prerequisites are moving

Typed-array views, `ArrayBuffer`, `DataView`, `Promise.withResolvers`, iteration,
class/interface representation, absence/nullability, RegExp, JSON, WeakRef and typed
receiver invocation were all active or known dependencies during this session. Some
have landed partially or completely since the plan baseline. Inspect current code,
rebuild the compiler, and measure the current source; do not preserve a stale refusal
count or add a temporary source substitute.

### Public constructor capability injection is closed

Resolved. Request, Response, EventSource, WebSocket, and WebSocketStream no longer
accept a provider context as a surplus JavaScript argument. Each class gates internal
construction behind a module-private `unique symbol` key and an internal factory, in
the convention already used by `abortSignalConstructorKey`; EventSource lost its third
parameter outright because nothing constructed it with an explicit context. See the
"Environment-owned capability confinement in public constructors" entry in
`runtime/web-platform/docs/BASELINE.md` for the tests, the three sabotages, and the
resulting compiler dependency on `unique symbol` representation.

### Node URL and event reconciliation is coordinated follow-on work

Earlier messages routed under the `claude:NodeJS` address reported a reservation of
`runtime/node/url/src/url.ts` and `runtime/node/buffer/src/blob.ts` while the successor
designs the canonical shared URL/Blob surface. The current NodeJS session later
disputed authoring those messages. Treat the attribution and reservation as
unverified: inspect the current tree, list the live peers, and obtain a fresh path
agreement before editing either file. The technical constraints below are review
items that must be verified against pinned Node tests rather than accepted on peer
attribution alone:

- `URL.createObjectURL` and `URL.revokeObjectURL` must attach without subclassing or
  changing constructor identity;
- `URL.parse` and `URL.canParse` preserve the observable distinction between missing
  arguments and explicit `undefined`;
- the Node facade retains its getter/setter-specific brand errors and
  `ERR_INVALID_ARG_TYPE` behavior;
- IDNA initialization remains a real module-initialization edge; and
- the shared parser entry shape must remain consumable by Node's legacy
  `parse`/`format`/`resolve` implementation.

Node's Blob URL spelling and lookup normalization remain Node-facade policy:
`blob:nodedata:`, C0/space trimming, embedded tab/CR/LF removal, and query/fragment
removal for lookup and revocation. The shared store needs a typed raw-lookup seam;
do not silently impose Node's grammar on every provider. Exact `Blob` constructor
identity between the shared store and `node:buffer` remains a deliberate
canonicalization decision, not a wrapper cast.

The NodeJS lane also reported one remaining `node:events` dependency. Node's internal
abort listener resists an earlier listener's `stopImmediatePropagation()`. Shared
`EventTarget` needs a private, non-Web-observable listener option for that behavior,
and the canonical `AbortController`/`AbortSignal` must be installable as the Node test
globals. Coordinate the internal hook; do not expose it in the public Web API or copy
the host's private symbol. `resistStopPropagation` itself is still open: the current
NodeJS session confirmed that no pinned test it has claimed depends on it, and asked
for the weak-handler half separately.

The `node:util` half of that dependency is implemented on the shared side.
`addWeaklyHeldEventListener` in `runtime/web-platform/src/core/events.ts` registers a
listener whose lifetime is bounded by a caller-supplied resource, with no
`addEventListener` option and no new property on `EventTarget` or its prototype. See
"A listener whose lifetime is bounded by a caller-supplied resource" in
`runtime/web-platform/docs/BASELINE.md` for the tests, the two verified sabotages, and
the one branch recorded as untested because this host cannot force the window before
finalization runs.

**This does not unblock `test-aborted-util.js`, and the reason is the interesting
part.** The NodeJS lane wired `util.aborted` to the seam at `2512b7c7` and then
measured which branch actually ran, through the conformance substitution rather than
by reading the code. It printed `strong`. The registration reaches an ECMAScript
private member of the canonical `EventTarget`, so only an instance of that class can
accept it, and `runtime/node/**` installs no canonical abort globals: a pinned test's
`new AbortController()` is still the host's. The seam is correct and the caller cannot
reach it.

The consequence is that Node currently forks on whether the signal is canonical, which
the NodeJS lane explicitly does not defend as design. It is a weaker guarantee rather
than a different API — nothing observable differs until the resource is collected,
which is precisely the case the ordinary listener cannot serve — and it disappears when
Node reexports the canonical abort globals. That reexport, not the hook, is the
remaining dependency, and it belongs to the canonical-ownership row in the plan rather
than to this listener option. The Node gc case cannot evidence the dispatch-time
liveness branch, because it does not reach the shared registration at all. The JVM lane
can: its API-26 retirement check runs rather than skipping, once `System.runFinalization()`
was found to be what actually drains ART's reference queue.

## Recommended next work

Items 3 to 6 of the original list are done; their entries in
`runtime/web-platform/docs/BASELINE.md` carry the evidence. What follows replaces them
with the state after that work.

1. Reproduce the tests and build a current compiler before editing, then **pin a
   private copy of the binary** and measure against that. Three sessions share this
   checkout and `target/release/nts` moves several times an hour, so a frontier taken
   across a moving binary is a number about nothing. Isolate a slice's own contribution
   by measuring HEAD's source and yours with the *same* pinned binary, rather than
   comparing against a figure produced by a different compiler.

   **Three traps in that procedure, each of which cost this session real work.**

   Diagnostic isolation swaps files for HEAD's copies and swaps them back, so it is a
   *mutation of the tree* and needs its own control. Key backups by full path: keying
   by basename put `fetch/transport.ts` and `http1/transport.ts` in one slot and the
   restore wrote one into both, which reached a commit. Verify the restore type-checks
   before doing anything else.

   Run the gate **after** the isolation step, not before. A green corpus taken before a
   swap is a true statement about a tree that no longer exists.

   A sabotage that does not type-check leaves the previous emit in place, so the tests
   run against the code the mutation was meant to replace and report green. That has
   happened at least five times here. Check `tsc` is silent before believing any
   sabotage result, including — especially — one that passes.

   Note that `commit-mine.sh` runs clippy, which has nothing to say about TypeScript.
   For this lane the last automatic gate before a commit does not look at the source at
   all; the type-check has to be yours to run.
   One more, added since: **a truncating instrument argues for damage.** A sabotage
   that appears to survive is a claim that some test is too weak, and the honest
   response is to go and weaken something — which is the wrong thing to do when the
   test was fine and the tool merely cut the line that said so. Read the whole output.
2. Verify the environment slot end to end on C, LLVM and JVM with a compiled fixture,
   including install-before-read, replacement, two-environment isolation, close, and
   bootstrap order. Still unstarted and still needs the other lanes.
3. Wire the HTTP/2 `knownEndpoint` probe to the shared DNS cache. Coalescing is built
   and correct but inert without it, because the reuse decision happens before
   connecting while the endpoint is resolved below the transport. Do not resolve DNS at
   the pool to close this.
4. Reconcile the exact eight upstream structural failures with the current
   compiler/common-runtime work. Do not turn them into local prototype or `.call`
   tricks. Six of the eight are compiler-owned and the compiler lane has confirmed
   which; interface method resolution is ahead of the `BrokenBase` layout defect in
   their queue, and that shape is now the most frequent single dependency in this lane.
5. Settle the canonical URL/Blob identity with the NodeJS peer. They have asked to do
   it after their current slice and to bring a *pinned failing test* rather than a
   requirements list, which is the right way round. The internal abort-listener seam is
   built, and so is `resistStopPropagation`. What remains is on the Node side and is
   larger than it looked: their four-line experiment installing the canonical abort
   globals showed that a canonical `AbortSignal` handed to the host's `node:events`
   breaks `listenerCount`, because the host cannot answer for a foreign `EventTarget`.
   So the globals pull in `node:events` substitution too. Price the globals, not the
   listener options.
6. Pin an Undici revision, or decide not to. The plan requires an API ledger with
   evidence per export and nothing is pinned or vendored, so the ledger cannot be
   written honestly today. This is a dependency decision for the repository owner
   rather than work this lane can do alone; see the ledger entry recording it.
7. Take the next incomplete row from the plan's server/mobile feature table. Read the
   table rather than guessing from the original delivery, and check the ledger first —
   several rows are partly done with their exact limits recorded. Rows closed since
   this list was written: `file:` as a capability-scoped provider extension;
   subresource integrity, which had been accepted on `Request` and enforced nowhere;
   and a portable deterministic virtual-time `Scheduler`.

   The **WebSocket server** row is the largest one still open and is now substantially
   built. Its handshake exists — request validation, the accept derivation, subprotocol
   selection and RFC 7692 `permessage-deflate` negotiation from the server side — and
   so does a server-side session: masking is the only asymmetry in the framing, so the
   message engine took a role rather than being written twice, and
   `adoptServerWebSocketSession` drives it over a connection the caller has upgraded.
   The canonical client and a server built from these pieces round-trip text, binary
   and compressed messages over a real socket.

   What does not exist is the surrounding server: no accept loop, no backpressure
   policy above the session, and no separate public module or package. The connection
   lifecycle owner named here **has since been built** (`WebSocketServer`: bounded
   connections, a 503 refusal, one shutdown, self-unregistering sessions). The plan asks for all of those. Note that the last is a packaging
   decision touching repository layout, so it is worth agreeing before building.

   The **Testing and observability** row is now essentially closed: mock and snapshot
   transports, typed diagnostics, statistics, a portable deterministic virtual-time
   `Scheduler`, seeded protocol fuzzing with asserted generator coverage, and an
   asserted error taxonomy. What remains there is opt-in tracing beyond the existing
   diagnostics, if anything.

   Interim (1xx) responses now reach the caller on both HTTP/1 and HTTP/2 through
   `TransportRequest.onInformational`, so `103 Early Hints` is no longer discarded.
   Which `Request` fields are enforced and which are deliberately inert is asserted
   rather than assumed.

8. **Look for mechanisms nothing routes through.** Four were found in this lane in one
   session: a dead internal factory, HTTP/2 coalescing that read an address the pooling
   layer never has, an `onInformational` hook on the HTTP/2 connection that no caller
   passed, and `Request.integrity` accepted and enforced nowhere. None was found by a
   failing test, because a suite of refusals cannot tell you whether the thing refusing
   exists — only a positive test can. Grepping for an option that is stored and never
   read found two of them directly.

## Reproduction commands

Type-check and emit the ordinary-Node host build:

```sh
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
```

Run the complete local host/real-socket corpus:

```sh
node --expose-gc --test tooling/conformance/web-platform/test/*.test.mjs
```

Run the complete pinned upstream corpus. Exit 1 is expected only while the eight
named failures above remain visible:

```sh
NTS_WEB_PLATFORM_COMPILED=1 \
  node tooling/conformance/web-platform/test-upstream.mjs
```

Run one pinned fixture while iterating:

```sh
NTS_WEB_PLATFORM_COMPILED=1 \
NTS_WEB_PLATFORM_FIXTURE=dom/abort/timeout.any.js \
  node tooling/conformance/web-platform/test-upstream.mjs
```

For NTS, first rebuild or otherwise identify a compiler binary from the current tree.
Then run the root project and record the exact compiler/source commit with the result:

```sh
NTS_TSGO="$PWD/target/tsgo" NTS_BACKEND=jvm \
  ./target/release/nts check runtime/web-platform/tsconfig.json
```

The repository-wide `tooling/conformance/web-platform/check.sh` currently includes
the nonzero upstream step, so read its output rather than treating its exit code alone
as the local-host verdict.

## Working and commit discipline

- Upstream fixtures are immutable inputs. Pin the upstream revision and each consumed
  blob hash; never edit a fixture to make it applicable.
- Every sabotage must first prove the intended branch is exercised. Restore the
  mutation and rerun the positive test before committing.
- Keep shared source portable and fully typed: no Node imports, `globalThis` state,
  `any`, unchecked casts, property/prototype hacks, or compiler-specific substitutes.
- Preserve visible failures. A green test that examined fewer cases is a regression in
  the instrument, not progress.
- Use narrow explicit staging. In a shared dirty worktree, a private Git index is the
  safest commit method; never stage all files or clean another agent's changes.
- Announce an ABI, shared ownership, or overlapping-path change before editing it.
- Do not push unless the repository owner explicitly asks.

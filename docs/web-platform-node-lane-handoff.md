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
- Last commit from this lane: `03c03d93` (`Use the environment-owned web platform
runtime`).
- HEAD observed while writing this handoff: `b7651b84`. Other agents remain active,
  so use the current HEAD rather than assuming that value is still the tip.
- `origin/main` was at `dcfb2a78` when this handoff began. Do not push merely because
  this file records that observation.
- The worktree is shared and dirty with other agents' work. Do not clean, reset,
  restore, reformat, or stage paths outside this lane.

`runtime/web-platform/docs/BASELINE.md` is the chronological evidence ledger, but its
last section currently stops at dispatcher pools. The proxy and environment commits
listed below are newer than its final entry; use this handoff as the checkpoint for
those slices and resume updating the ledger with future work.

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

Still open: HTTP/2 connection coalescing, which must use `certificateNames` rather than
hostname alone and is deliberately not implemented yet. Only the ordinary-Node
conformance host implements the new members, and host execution is not evidence that a
real provider can report a selection.

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

1. Reproduce the tests and build a current compiler before editing. Record the exact
   current HEAD and distinguish host evidence from compiled-provider evidence.
2. Verify the environment slot end to end on C, LLVM and JVM with a compiled fixture,
   including install-before-read, replacement, two-environment isolation, close, and
   bootstrap order.
3. Done. The negotiated-ALPN result is landed, its contract is enforced centrally, and
   automatic HTTP/1.1 versus HTTP/2 selection runs over one connected stream on the
   direct, HTTP-proxy tunnel and SOCKS routes. HTTP/2 connection coalescing remains
   unbuilt and must use `certificateNames` rather than hostname alone.
4. Done. A SOCKS pooling regression proves two logical target origins never reuse one
   target-bound tunnel merely because the proxy endpoint is the same; see "One proxy
   endpoint is not one connection pool" in `runtime/web-platform/docs/BASELINE.md`.
5. Done. The public constructor context-injection paths are removed and internal
   construction and identity are preserved; see the ledger entry named above.
6. Done, and it found a real defect. `drain()` did report completion while provider
   work from a cancelled open was outstanding; it now awaits the settlement of every
   open it cancelled. See "A cancelled open is not a finished open" in
   `runtime/web-platform/docs/BASELINE.md`.
7. Reconcile the exact eight upstream structural failures with the current
   compiler/common-runtime work. Do not turn them into local prototype or `.call`
   tricks.
8. Settle the canonical URL/Blob identity and internal abort-listener seam with the
   NodeJS peer before either lane freezes its facade.
9. Take the next incomplete row from the plan's full server/mobile feature ledger
   only after this audit; do not guess from the original delivery or copy its layout.

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

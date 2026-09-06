# The JVM and Android provider lane

What this lane owns, what it refuses, and where the evidence for each claim is.
Written for whoever picks it up next, on the assumption they will want to know
which numbers were measured and which were argued.

## The environment

`nts.rt.NtsEnv` is an **instance**, not a set of statics. Queues, timer heap,
depth, clock and liveness are per environment; only the cross-thread inbox is
atomic, because one lane mutates everything else.

Two clocks, deliberately separate. **Virtual** time advances to the next
deadline, which is what an oracle test wants: deterministic, no waiting, the
same answer every run. **Monotonic** time waits in real time and never jumps,
which is what a liveness test needs. They are not the same test and they do not
share an implementation.

Quiescence in monotonic mode is *nothing queued, no timer pending, and nothing
outstanding*. Testing only the outstanding count returns immediately from a lane
whose only work is a timer that is not due, which reads as an idle environment
and is a timer that never fires.

### Completion reservations

A credit is reserved **before** the I/O is submitted. `NtsEnv.launch` returns
`null` when there is none, and the transport reports `Backpressure` rather than
queueing without limit. `NtsInbox` allocates the node at reserve and links it at
post, so posting from a worker is wait-free and allocation-free.

`Slot.next` is `volatile`, and that write/read pair is the publication edge that
makes a worker's bytes visible to the owner lane. A reflection ratchet asserts
the keyword stays, because deleting it is silently correct on x86 and wrong on
ARM. See `docs/records/0181` for the three ways ARM evidence was attempted here
and why none of them work on an x86 machine.

Close is bounded and **reports what it could not recover**. Work still running
on an I/O thread holds a credit and a single drain walks past it, so `reclaim`
alternates drain, check and yield until every credit is back — and a launch that
never settles is a refusal naming the count rather than a clean-looking close.

## The callback ABI

Generated closures are reached by **interface, keyed by descriptor**:

    ()V                                        NtsCallback
    (D)V                                       NtsNumberCallback
    (Ljava/lang/String;)V                      NtsTextCallback
    (Ljava/lang/String;Ljava/lang/String;)V    NtsTextPairCallback
    ([BDD)V                                    NtsBytesCallback

By descriptor and not by class name, because `nts/gen/Closure7` counts closures
in source order and renames itself when an unrelated line moves.

**A generated closure has exactly one method, named `call`.** So a Java
interface with two methods can never be implemented by TypeScript and is
Java-only by construction. `NtsSocket.Completion` was such an interface and is
now two closures; any callback surface either side designs has the same
constraint.

The member name is half the key. Asking only whether a dispatched method was
`()V` matched an ordinary `reset(): void`, and four classes in the shipping
corpus declared `NtsCallback` without a `call()`. Nothing noticed because **the
JVM does not check**: interface conformance is verified at the call, not at
load, so `-Xverify:all` is silent and the first symptom is an
`AbstractMethodError` from inside a provider.

## Typed memory

`NtsBuffer` is an `ArrayBuffer`: a `byte[]` that is `null` once detached, a
length, and a maximum. A resizable buffer **reserves its maximum at
construction**, matching `runtime/c`, so the backing never moves and `resize` is
an assignment plus a zero-fill of what it exposes. Growth zeroes even though the
block was zero when reserved, because a resize down and up again would otherwise
show what the shrunk region held.

`NtsView` and its nine element classes are the typed arrays. The length is
**computed, not stored**: a view built without an explicit length tracks its
buffer, and a stored length is right until the first `resize`.

`NtsDataView` is big-endian by default — the one place in the language where the
default is the less common byte order — and unaligned access is legal, which is
why it assembles from bytes rather than reaching for a wider primitive.

Three conversion rules that are each other's near-misses: integer views store
`ToInt32`, `Float32Array` rounds to nearest even and keeps a NaN's payload, and
`Uint8ClampedArray` does neither — it clamps and rounds **half to even**, so
`0.5` is `0`. `Math.round` agrees with it on every input except the exact
halves.

`set` and `copyWithin` move ranges rather than elements, and their only hard
case is the overlapping one -- a forward loop is correct for every
non-overlapping input. `copyWithin` is `System.arraycopy`, which is specified to
behave as if copied through a temporary; `set` snapshots the source when the two
views share a buffer, because two views can overlap at different element widths
and the source is read as it was before the write began. Mixing a bigint view
with a numeric one is a `TypeError` rather than a conversion, so the generic
bulk path refuses there and the bigint views have their own.

Out of bounds **refuses**. JavaScript reads out of bounds as `undefined` and
writes by doing nothing; `nts_bounds` already refuses for ordinary arrays, and a
typed array behaving differently would be a second answer to one question.

Measured, in `docs/records/0182`: element access through a view is 4.65x a bare
array, which is 2.28x of lost vectorisation times 1.98x of accessor work. The
indirection through the buffer is not part of it.

## Transports

Two, and neither can call the other — the Android library depends on no NTS
runtime, which is what lets it be built on its own.

`nts.rt.NtsSocket` is the JVM reference transport. `org.nts.web.NetworkPrimitives`
is the Android one. Both speak HTTP `CONNECT` and SOCKS5, both close every
connection on a network transition, both verify TLS against the target.
`BothTunnels` runs every case through both against one proxy and requires the
same answer, because two copies of something subtle is how drift starts.

### Three things that are easy to get wrong

**A synchronous failure is delivered as a task, not inline.** Backpressure, a
full queue and a closed handle are known before the call returns; reporting them
there means a program observes them at a different position in the task order
than a connection refusal, so its output depends on *which* failure occurred.

**TLS through a tunnel verifies the target, not the proxy** — and the name that
decides it is the **SNI** one. JSSE identifies against `setServerNames` when set
and falls back to the peer host only when not, so an implementation that hands
`createSocket` the proxy and `setServerNames` the target is accidentally
correct. Both must come from the target. No SNI for an address: RFC 6066 wants a
DNS name and `SNIHostName` accepts `127.0.0.1` anyway.

**The `CONNECT` response is read a byte at a time**, to stop exactly at the
blank line. A buffered read takes the first bytes of the tunnelled stream into a
buffer the `SSLSocket` will never look in, and the handshake then fails on a
truncated ServerHello with no sign of where they went.

## The OkHttp provider

Mostly a list of things turned off. Redirects, cookies, caching and retries are
observable Fetch behaviour the shared TypeScript owns; if OkHttp does any of
them the answer depends on which provider a program is running under.

The one that is different in kind is **transparent decompression**, which
changes what the response *says*: OkHttp adds `Accept-Encoding: gzip` when the
caller has not, inflates, and strips `Content-Encoding` and `Content-Length`
because they would describe bytes it replaced. Setting the header explicitly
keeps it out — same wire request, different owner for the inflation.

`retryOnConnectionFailure` has no behavioural test and that is deliberate:
OkHttp retries a *pooled* connection that turns out to be dead, not a fresh one
that hangs up, so the obvious server never triggers it. All five switches are
asserted on the built client through OkHttp's own accessors instead.

## The artifacts

| | |
| --- | --- |
| `nts-runtime.jar` | reproducible, class file 52, **zero** `invokedynamic`, byte-compared against a rebuild |
| typed memory | 3,098 oracle lines against node, by bit pattern, covering all eleven element types |
| the Android library | class file 52, `-Xlint:all -Werror` clean, one `android.*` import in one file |
| both, after `d8 --min-api 26` | zero `invoke-custom`; D8 desugars every lambda even where it would be legal |
| after `r8` with `consumer-rules.pro` | the FFI surface survives, the private internals do not, and the shrunk library passes its whole suite on a device |
| OkHttp, Okio, kotlin-stdlib, R8 | pinned to exact versions in `dependencies.tsv` with SHA-256, license and scope; verified before use, and a mismatch **fails** |

The zero-invokedynamic rule is about NTS-authored Java. It is not applied to the
third-party jars, which are reviewed on their version, hash, license and
behaviour — counting their `invoke-custom` would be measuring someone else's
compiler against our house style.

## Running the evidence

    cargo test -p nts-codegen-jvm            # every suite above, skipping what it cannot find
    sh tooling/android/on-device.sh          # the same suites on ART, plus the R8-shrunk library
    sh tooling/jvm/sabotage.sh <edit> <driver>   # prove one can fail, without breaking the tree

The last one copies `runtime/jvm/src` before editing it. Sabotage in place
leaves wrong source in a checkout three sessions build from, for a window
`git status` shows as clean a second later.

## What this lane is still waiting for

- **`ManagedType::View { element }`**, so the typed arrays have a lowering. The
  runtime half is done and oracle-tested; the descriptor and extern tables are
  small once the variant exists.
- **The `nts_jvm_web_*` intrinsic declarations**, so the transports are callable
  from the shared TypeScript rather than only from Java.
- **ARM hardware**, for the publication race itself. The keyword and the
  barrier it generates are both checked; only the reordering that would expose
  their absence is not. See `docs/records/0181`.

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

`NtsView` and its **eleven** element classes are the typed arrays — the nine
numeric ones and the `BigInt64`/`BigUint64` pair, whose element is 64 bits where
a bigint is 128, so a read sign-extends into the high word or zero-fills it and
a write keeps the low one either way. The length is
**computed, not stored**: a view built without an explicit length tracks its
buffer, and a stored length is right until the first `resize`.

`NtsDataView` is lowered as `ManagedType::DataView` since `932a9969`, which
carries nothing — a typed array *is* its element type, and a `DataView` has none
because the width is chosen per access by the method called. `examples/data-view`
drives 466 cases across sixteen functions and all three backends agree with node.

It is big-endian by default — the one place in the language where the
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

`set` and `copyWithin` move ranges and their only hard case is the overlapping
one — a forward loop is correct for every non-overlapping input. `copyWithin` is
`System.arraycopy`, specified to behave as if copied through a temporary; `set`
snapshots the source when the two views share a buffer, because two views can
overlap at *different element widths*.

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

### Partial writes, which only the reference path can produce

`OutputStream.write` writes everything or throws, so a JVM primitive naturally
always reports the full count — and the shared `writeAll` loop above it, which
exists precisely to handle a short write, would have its body executed once,
ever, on every platform. The shared contract permits `1..data.length` because a
real `send(2)` on a full send buffer returns short.

`NtsSocket.fragmentWritesAt(n)` makes the deterministic reference path produce
one. Not a production behaviour — the Android provider still writes in full —
but a *reference* one, which is what the plan means by a deterministic reference
transport. Deterministic rather than random, so a corpus that exercises it stays
an oracle instead of becoming a flake.

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
| after `r8` with `consumer-rules.pro` | the FFI surface survives, the private internals do not, and the shrunk library passes its whole suite on a device. A keep rule matching **nothing** fails the run: it names a class now absent from the artifact, and every caller of it is across an FFI where nothing complains until it is called |
| OkHttp, Okio, kotlin-stdlib, R8 | pinned to exact versions in `dependencies.tsv` with SHA-256, license and scope; verified before use, and a mismatch **fails** |

The zero-invokedynamic rule is about NTS-authored Java. It is not applied to the
third-party jars, which are reviewed on their version, hash, license and
behaviour — counting their `invoke-custom` would be measuring someone else's
compiler against our house style.

## Running the evidence

    cargo test -p nts-codegen-jvm            # every suite above, skipping what it cannot find
    sh tooling/android/on-device.sh          # the same suites on ART, plus the R8-shrunk library
    sh tooling/android/barrier.sh            # does `volatile` reach the compiler and make a fence
    sh tooling/jvm/sabotage.sh <edit> <driver>   # prove one can fail, without breaking the tree

Every Java driver reports a **check count** and every harness asserts the number
rather than the zero. Removing a whole case gives `30 checks, 0 failures` where
it should be 56, and the old assertion passed that happily — zero failures is
satisfied by a suite that stopped running.

The last one copies `runtime/jvm/src` before editing it. Sabotage in place
leaves wrong source in a checkout three sessions build from, for a window
`git status` shows as clean a second later.

## What this lane is still waiting for

Three things, and only one of them is code.

- **A physical ARM device**, for the publication race itself. The keyword and
  the barrier it generates are both checked, and the compiler-reordering
  manifestation is tested; only the hardware reordering that would expose a
  missing barrier is not. See `docs/records/0181` for the five routes and which
  one worked.
- **An ARM device**, for the reordering itself. The emulator here is `x86_64`
  and the only system image is `android-36.1`, so the hazard is unobtainable --
  and an ARM image under full emulation is a *model* of a weak memory system
  rather than one, worth no more than the x86 run.

  The other half is done and is in the device suite: `tooling/android/
  barrier.sh` compiles two methods differing only in the keyword with **ART's
  own AOT compiler** and disassembles them with its own dumper. `volatile` gets
  `lock add [rsp], 0` and plain gets nothing. That does not show the race; it
  shows the compiler on the platform we ship to discharging the obligation the
  JMM gives it, which is the mechanism ARM correctness rests on. It had been
  written weeks before there was a device and never run.
- **The command-line SDK tools, before API 26 can be *run* at all.** The
  artifact question is answered without them: `SDK_MEMBERS` records every
  Android member this library names with the level that introduced it, ten of
  them, extracted from the constant pools rather than from a list of files.
  `--min-api 26` only proves the bytecode is acceptable -- a call to a method
  added in API 31 dexes perfectly well and throws `NoSuchMethodError` on the
  floor we declare. What is missing is running *on* 26, and that needs: There is
  no `cmdline-tools` in this SDK and therefore no `sdkmanager` or `avdmanager`,
  so an API-26 system image cannot be installed and an AVD at that level cannot
  be created. Getting them means fetching an unpinned SDK component, which is
  the one thing this lane's dependency rules are written against -- OkHttp,
  Okio and Kotlin are pinned, hash-verified and SBOM-recorded, and an
  unverified toolchain download to satisfy a test would be worse than the gap.
  Checked with `ls` rather than assumed, which is the lesson of record 0190.
- **A device at API 26 specifically, and one that is not an emulator.** What
  runs today is API 36 on `x86_64`, which is real ART -- concurrent copying
  collector with read barriers, Conscrypt over BoringSSL, framework natives
  `dalvikvm` does not link -- and it covers the cleartext policy, TLS with a
  private root, hostname rejection, handshake timeouts, capacity, timers, close
  races and the two-adapter HTTP corpus. What it does not cover is the API floor
  the library actually declares, Wi-Fi/cellular transitions, background
  restrictions and DNS races, which need a device with a radio.
- **HTTP/2 against a real controlled peer**, which is deferred rather than
  missing -- and the deferral is now checked rather than declared. Every case in
  the two-adapter corpus asserts the **request line the server received**, not
  only the protocol list the client was built with: those are two claims, and
  only the second was tested before. An h2 client with prior knowledge opens
  with `PRI * HTTP/2.0`, which the server records like any other request line,
  so the corpus can tell a provider that was configured not to speak h2 from one
  that does not. `OkHttpNetworking.client()` pins the protocol list to HTTP/1.1 alone
  and asserts it, because the deterministic reference speaks HTTP/1.1 and the
  two-adapter corpus compares what the two expose -- two adapters on different
  protocols do not disagree about policy, they disagree about framing, and the
  corpus would either report that as a defect or be taught to tolerate it. h2
  becomes a negotiated capability when the reference can match it.

- **A lowering that can make two views alias**, which is the property
  `ManagedType::View` exists for and which nothing tests. `new Uint8Array(buffer)`,
  `subarray`, `slice` and `copyWithin` are all `NTS1001` today, so there is no
  way for a program to hold two views over one buffer -- and all 292 cases of
  `examples/typed-arrays` would pass against a lowering that copied. The runtime
  half is built and oracle-tested: `set` snapshots when the buffers are the same
  object, `copyWithin` is `System.arraycopy` for memmove semantics, `subarray`
  aliases and `slice` copies. Ten cases are written and waiting; raised with the
  owner of `hir::lower`.

Everything else the plan asks of this lane has evidence, and since
`tooling/android/on-device.sh` started running, that evidence is from ART rather
than from a desktop JVM standing in for it:

    ok 1..11  org.nts.web.NetworkPrimitivesTest
    EnvTest          26 checks, 0 failures
    CloseRaceTest    240 checks, 0 failures
    Stress           16 producers x 200 rounds, credits balanced
    ok 1..11  again, against the R8-shrunk library
    both-http        78 checks, 0 failures
    device: every suite green on ART

The last of those is the plan's device evidence that transparent decompression
cannot alter exposed headers unnoticed. Sabotaged on the device as well as on
the desktop -- removing the adapter's explicit `Accept-Encoding` fails it three
ways, on the headers and on 62 encoded bytes arriving as 52 decoded ones. What arrived most
recently, and what it cost:

- **Typed arrays lower and run.** `examples/typed-arrays` agrees with node on
  292 cases; the corpus is 115 of 115 with no refusals. Eight of the eleven
  runtime classes are reachable -- `NtsViewU8C`, `NtsViewI64` and `NtsViewU64`
  have no element in `hir::builtin` and are refused by name in two independent
  places, so the lists cannot drift into disagreeing about which elements exist.
- **All eight `nts_jvm_web_*` intrinsics are wired**, with a round trip driven
  from TypeScript against a real peer: connect, write, read back, checksum. The
  environment parameter that gated five of them turned out to be redundant
  rather than unrepresentable -- the environment is ambient in both runtimes --
  and the two completion reservations are withdrawn with their reason written
  down rather than left looking unfinished.
- **Two shared middle-end defects**, found by that round trip and fixed in
  `docs/records/0188`. A closure handed to an intrinsic through an intermediate
  function had its body pruned, and its parameters joined to BOTTOM, so a global
  assigned only from a callback was constant-folded to its initial value on all
  three backends while node printed the real one.
- **Byte ownership at the boundary.** A read or write into a view whose buffer
  has been detached is a synchronous `TypeError` -- the operation never starts,
  which is what the language specifies -- and the check happens *before* the
  completion credit is reserved. It did not: Java evaluates arguments left to
  right, so `NtsSocket.read(env, NtsEnv.launch(env), handle, storage(into), ...)`
  reserved a completion and threw past it. A leaked credit is invisible until an
  environment closes, which is where the test found it.
- **The worker queue's bound is reached and asserted**: 8 workers over a
  256-deep queue admits exactly 264 blocked operations and refuses the rest at
  submission, with the completion credit returned. `submit` had said "the queue
  is bounded, so this is reachable" since it was written, and nothing had ever
  asked for more than a handful of operations.

## `import { OkHttpClient } from "java:okhttp3"`

Raised by the repository's owner, and it is a better spelling than the one the
JVM plan carries. Worth writing down now, while nothing is built, because the
difference is not cosmetic.

The plan's step 10 is `nts bind --jar android.jar --out types/android.d.ts`: a
generate step producing a `.d.ts` you check in and import by path. That is a
**fourth statement of an ABI**, and this lane has just spent a day on what those
cost — the networking intrinsics had their signatures written four times with
nothing asserting they agreed, and the fixture's copy went on compiling after
the real declarations changed. A checked-in generated `.d.ts` is the same shape:
it can be stale against the jar it came from, and nothing notices.

A `java:` specifier removes the artifact rather than checking it. The frontend
resolves the specifier against the **pinned, hash-verified jar** that
`dependencies.tsv` already names, so there is no second thing to be out of date
with the first. That is the whole argument, and it is the same argument as
`WEB_INTRINSICS` being public so a test can read the compiler's real table
instead of parsing Rust to find out what the compiler believes.

What it does **not** change: the hard parts are all still there. A class-file
reader (the same crate as the writer — the format is symmetric), nullability
that Java's type system does not express, overload collapse where `f(int)`,
`f(long)` and `f(double)` all become `f(number)`, and the transitive closure
where binding `OkHttpClient` drags in most of the JDK. The spelling is nearly
free once those exist; none of them is free.

What it costs specifically: `tsgo` resolves module specifiers and is
`third_party`. So `java:` is served by generating into a cache directory that is
**not** checked in and mapping it with `paths` in the tsconfig — which is the
generated artifact again, but as a build product rather than a source file, and
that is exactly the difference between something that can drift and something
that cannot.

### The specifier is the package, the named imports are the classes

The owner's examples settle a question the plan left open:

    import { Button, EditText } from "android:widget";
    import { AndroidNetworking } from "java:org.nts.web";
    import { OkHttpClient } from "java:okhttp3";

Not `java:okhttp3.OkHttpClient`. A specifier naming one class would make the
import list redundant with the specifier and would need one specifier per class;
naming the **package** and importing classes from it decomposes exactly the way
`android.widget.Button` already does, and it is what makes `{ Button, EditText }`
read as one import rather than two.

Two consequences worth having in advance. `android:` as a separate scheme from
`java:` is not sugar: the Android SDK is a compile-only jar resolved from
`$ANDROID_HOME` at a pinned API level, where `java:` resolves against the
repository's own pinned dependencies — different sources, different verification,
and a scheme is where that difference should be visible rather than in a path.
And `hir::reachable` already answers the transitive-closure question the plan
names as hard: an import that names three classes is a closure request rooted at
three names, not at a jar.

None of this is the current lane's work. The four wired intrinsics are the
boundary the plan asked for — "a small typed runtime-owned intrinsic table", and
small is the point. This is written here so that when step 10 arrives it starts
from the better shape rather than rediscovering it.

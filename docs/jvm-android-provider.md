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

## Durable storage

Fourteen intrinsics behind `runtime/jvm/web-platform/store.ts`, implementing the
provider half of `runtime/web-platform/src/storage/durable.ts`: bytes,
atomicity, durability and enumeration, and nothing above them. RFC 9111
freshness, `Vary`, invalidation, eviction, quota policy and CacheStorage
matching are shared TypeScript, and none of these is a primitive for any of
them.

**One class for both runtimes, because a measurement said so.** `NtsStore` names
no Android SDK member and lives in the runtime jar, so ART and a desktop JDK run
the same code -- which is what makes the desktop suite evidence about the device
rather than a proxy for it. The one operation with any reason to need the
platform is syncing a directory, and it does not:

    FileChannel.open(dir, READ).force(true)                        ok  (API 26)
    android.system.Os.fsync on the same directory (the control)    ok

The control is there so a failure would have been about the portable route
rather than about the directory or the permissions. Without it the seam would
have been written on a reasonable-sounding belief.

### A commit is four operations and one of them is invisible

Write to a temporary, sync the file, rename over the target, sync the
**directory**. The rename is what makes a value appear whole or not at all; the
first sync is what makes its bytes durable; the second is what makes the rename
durable, because the directory entry lives in a different inode with its own
dirty pages.

That last one is the guarantee **no functional test can see**. Delete it and a
committed value is still whole, still atomic, still correct on every machine
that does not lose power -- all 66 checks pass. So the test checks the cause: an
`LD_PRELOAD` shim in front of libc reports which calls a commit makes.

    SHIM fsync  .../ns/k.1.nts-partial
    SHIM rename .../ns/k.1.nts-partial -> .../ns/k
    SHIM fsync  .../ns

Not a power-cut test, and it says so. What it rules out is the edit that removes
the guarantee silently -- deleting the sync, or moving it *before* the rename,
which looks like it is still there. Both fail it; the functional suite stays
green through both. `docs/records/0203`.

### What it refuses, and why each is not a smaller answer

- **A key whose encoded name passes the length limit.** Truncating would make
  two keys one key, and a wrong answer is worse than an error.
- **A second concurrent write to one key.** The ABI is sequential per key.
  Making that true by *waiting* turns a caller's mistake into a pause, with the
  pause as the only evidence it made one. A caller that wants the later value
  serialises above this seam, where it can also decide which value should win --
  which the store cannot know.
- **A ranged view that does not fit the value.** A caller asked for a range of
  *that* value; if the key was replaced between being sized and being opened, a
  prefix of the new one is not a shorter answer to that question but an answer to
  a different one, returned without saying so. Once open, the descriptor pins
  what it was opened over, so a later commit cannot change what a view sees.

Names are percent-encoded, reversibly so enumeration gives back what was stored,
and that is also what makes escape impossible: `..` and `/` do not survive it.
`../escape`, `/etc/passwd`, `.hidden`, `%41` and `é中` all round-trip inside
their namespace.

### Views both ways, and the record encoding

`append` takes a view and the two reads fill one, because three entries in the
table already borrow a caller's window and a store that allocated here would be
the only one that does -- copying every value twice, once out of the file and
once into the view the caller wanted anyway. `append` takes no offset or length
beside the view: a view carries both, and passing them again is a second answer
that can disagree with the first.

`read` and `list` both answer **what there was** and write **what fits**, so a
short guess is corrected by the same call. `list` is one call and one snapshot --
`size NUL modified NUL keyByteLength NUL key` per record, concatenated -- because
a count plus a lookup per key cannot be atomic, and a key created or removed
between them makes the metadata disagree with the names with no way to tell which
half is stale. The explicit key length is what lets records concatenate and still
parse when a key contains a separator, which a key may.

`source_read` answers `-1` at the end of a range and a positive count otherwise,
so zero never occurs and "an empty chunk is invalid" is structural rather than a
rule a consumer has to know.

### The bug only the device could find

`close` iterated `ConcurrentHashMap.keySet()`. Java 8 made that method's return
type covariant -- `KeySetView` where Android's `core-oj` still says `Set` -- so
`javac --release 8` wrote a descriptor ART cannot resolve, and it died with
`NoSuchMethodError` on a method that *exists*.

Every guard passed. The source is fine, the bytecode is valid, it dexes at
`--min-api 26`, it needs no feature above the floor, and `android.jar` on the
classpath supplies `android.*` while `java.util.*` still comes from the JDK.
**ART resolves lazily**, so even forcing linkage over the corpus would not find
it -- only executing that line does.

Recompiling against Android's bootclasspath is not the fix: that descriptor then
fails on every desktop JVM, where `keySet()` really does return `KeySetView`. The
two platforms disagree and one jar runs on both, so the only rule that works is
to avoid the members where they differ.
`the_jar_names_no_method_android_spells_differently` reads the shipped jar's
constant pool for them -- a list with one entry, and it says in its own doc that
it is a list rather than a rule and cannot find the next one. The device suite
can. `docs/records/0204`.

## The system proxy, and the measurement that had to be an app

`systemProxyFor` formats what `ProxySelector.getDefault().select(uri)` answers.
Everything that answers depends on system properties **the framework sets when
an application process starts** — and a bare `app_process`, which every other
device measurement in this lane uses, never runs that path.

That distinction produced a wrong conclusion before it produced a right one.
Measuring through `app_process` with `http.nonProxyHosts` set by hand showed
the selector honouring the bypass list, and I reported that Android excludes
bypassed hosts itself. It is a fact about `DefaultProxySelector` and not about
what a device gives it.

`tooling/android/proxy-app.sh` installs a real APK and asks from inside it:

    global_http_proxy_exclusion_list = localhost,127.0.0.1   (verified set)
    http.proxyHost                   = proxy.test
    http.nonProxyHosts               =                        (empty)
    http://example.com/a             -> PROXY proxy.test:3128
    http://127.0.0.1:8080/b          -> PROXY proxy.test:3128

So on API 26 the framework propagates the proxy's **host and port** and not the
**exclusion list**, and **a loopback request goes to the proxy**. Shared code
cannot rely on the platform applying a bypass list; the no-proxy list applied
above this seam is load-bearing rather than defensive.

**One ordering trap, recorded because it cost two runs and nearly a wrong
finding.** `settings put global http_proxy host:port` *clears*
`global_http_proxy_exclusion_list`. Setting the list first and the proxy second
leaves the list empty — and an empty list then reads as a platform behaviour
rather than as a configuration mistake. The script sets the proxy first and
asserts the list took before believing anything downstream of it.

The check reports the bypass result rather than requiring it in one direction: a
later Android that propagates the list would answer `DIRECT`, and that is an
improvement rather than a regression. What it asserts is that the two halves
agree — an empty `nonProxyHosts` with a bypassed loopback would mean the
property is not what decides it, and everything above would be built on the
wrong thing.

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
    cargo test -p nts-codegen-jvm --test store   # the durable store, and the syscalls a commit makes
    sh tooling/android/on-device.sh          # the same suites on ART, plus the R8-shrunk library
    sh tooling/android/barrier.sh            # does `volatile` reach the compiler and make a fence
    sh tooling/android/arm-barrier.sh        # the same question of the arm64 compiler
    sh tooling/android/proxy-app.sh          # what a real app is told about the system proxy
    sh tooling/jvm/sabotage.sh <edit> <driver>   # prove one can fail, without breaking the tree

Every Java driver reports a **check count** and every harness asserts the number
rather than the zero. Removing a whole case gives `30 checks, 0 failures` where
it should be 56, and the old assertion passed that happily — zero failures is
satisfied by a suite that stopped running.

The last one copies `runtime/jvm/src` before editing it. Sabotage in place
leaves wrong source in a checkout three sessions build from, for a window
`git status` shows as clean a second later.

## What this lane is still waiting for

Two pieces of hardware, and one protocol that is not this lane's to write.

- **An ARM device, for the race itself.** The emulator will not help:

      FATAL | QEMU2 emulator does not support arm64 CPU architecture

  The SDK emulator runs an arm64 guest only on an arm64 host, so showing a
  reader observe a half-published object -- the race `docs/records/0181` is
  about -- still needs two cores executing ARM64 concurrently and there are
  none here.

  **The compiler's half is no longer missing**, and this section used to say it
  was. `tooling/android/arm-barrier.sh` runs ART's own **arm64** `oatdump`
  under `qemu-user` over the arm64 boot image and compares a volatile write
  against a plain one:

      void java.util.concurrent.atomic.AtomicInteger.set(int)   volatile int value
        stlr w2, [x16]              <- release store
      void java.io.CharArrayWriter.reset()                      plain int count
        str wzr, [x1, #20]          <- plain store

  `stlr` is ARM64's release store, emitted for the volatile field and not for
  the plain one, by the compiler that ships on the architecture this lane
  targets. `barrier.sh` beside it asks the same question of x86_64 and gets
  `lock add [rsp], 0`.

  Two limits, because they are the difference between this and the race.
  **It is not our code**: `dex2oat` under `qemu-user` will not cross-compile a
  dex -- it opens the file, closes it and exits, with its diagnostics going to
  a `logd` that a user-mode sysroot does not have, probed and absent 1,092
  times in one run. So the evidence is Android's own compiled code, and what
  carries across is the compiler rather than the class. **And it is not
  execution**: nothing ARM64 is run for its behaviour, only disassembled, so an
  emulator with wrong semantics would print the same bytes.

- **A stable way to produce a network transition**, which is not the same as a
  radio and is the correction to what this said before. The emulator carries
  both a WiFi and a cellular network, and with `adb root` taking `wlan0` down
  moves the default from one to the other exactly as a handover does. A test
  that did it saw `watchDefaultNetwork` sweep the open connections, and the
  sabotage that removes the registration left three open.

  It is not in the suite because it would not do it twice: it then hung from
  two different dex compositions, wedged `adb`, and left the device without
  Wi-Fi when killed. A case that cannot be run twice in a row is not a ratchet.
  See `docs/records/0200`. The transition *decision* stays tested thirteen ways
  on a desktop JVM, and background restrictions and DNS races still want real
  hardware.

- **HTTP/2 against a real controlled peer**, which is deferred and is not this
  lane's to implement: the shared layer owns the protocol engine. What is this
  lane's is not lying about it, and every case in the two-adapter corpus now
  asserts the **request line the server received** rather than only the protocol
  list the client was built with. An h2 client with prior knowledge opens with
  `PRI * HTTP/2.0`; sabotaging the client to `H2_PRIOR_KNOWLEDGE` fails every
  case.

### API 26 is no longer waiting

The whole device suite runs on the floor this library declares, not on the API
36 that had been standing in for it. Getting there found three defects API 36
could not show -- a PKCS12 MAC its BouncyCastle cannot read, the ART tools
living in `/system/bin` rather than an APEX, and a retirement check that was
**accusing the code under test**, because on that configuration a weak reference
to a plainly dead object is neither cleared nor enqueued. See
`docs/records/0197`, including the explanation I got wrong on the way.

Nothing skips there any more. The retirement check did, until the cause was
found on a fourth attempt: `System.gc()` asks for a collection and does not wait
for reference processing, which ART hands to a daemon. `System.runFinalization()`
waits, and with it the first attempt enqueues where sixty without it never did.

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

## What API 26 cannot answer, and the trap in finding out

The shared lane proposed a negotiated-connection result carrying the ALPN
protocol TLS selected and the peer's dNSName SANs. Measured on a device at the
floor this library declares:

    sdk 26
    MISS  SSLSocket.getApplicationProtocol        (NoSuchMethodException)
    MISS  SSLParameters.setApplicationProtocols   (NoSuchMethodException)
    MISS  SSLParameters.getApplicationProtocols   (NoSuchMethodException)
    HAVE  X509Certificate.getSubjectAlternativeNames

SANs are plain X.509 and available from API 1. The selected protocol is not
reportable until **API 29**; on 26 to 28 the only route is Conscrypt's hidden
`setAlpnProtocols` / `getAlpnSelectedProtocol` by reflection, which the
hidden-API restrictions from 28 make fragile and which this lane's dependency
rules exist to forbid.

**All three compile against the API-26 `android.jar`.** The stub declares them
and the device does not have them, so a compile check answers "yes" to a
question it cannot see. That is the same shape as `--min-api 26` proving the
bytecode is acceptable and not that the methods exist -- and it is why
`the_library_compiles_against_the_api_level_it_declares` compiles against the
real jar rather than trusting a written list, and why that test is still not
sufficient on its own for members the stub over-declares.

The consequence for the ABI is that "empty means cleartext" collapses two facts:
*there was no TLS*, and *there was and this platform cannot report it*. A
provider that offered `["h2","http/1.1"]` on API 26 and negotiated h2 would
answer empty, and a dispatcher would then speak HTTP/1.1 into an h2 connection.
The rule this lane keeps instead: **a provider that cannot report the selection
does not offer a choice.** It requests exactly one protocol, so absence is
unambiguous -- and the two-adapter corpus asserts the request line the server
actually received, so a provider that broke that rule fails rather than
negotiating quietly.

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

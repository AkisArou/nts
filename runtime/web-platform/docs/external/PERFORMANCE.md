# Performance design and measurement boundary

No throughput, p99 latency, allocation or battery benchmark is claimed. The tests
are correctness tests; their elapsed time is not a benchmark. Compiler/runtime
representation can change performance substantially and must be measured after AOT
integration on the actual target.

## Implemented mechanisms

* One shared HTTP parser and WebSocket codec, not parallel platform implementations.
* Pull-driven 64 KiB-or-smaller network chunks. Application pause propagates to the
  primitive reader rather than an eager whole-response downloader.
* Keep-alive connection reuse with global/per-origin capacity and a bounded queue.
  No automatic retry of a possibly transmitted non-idempotent request.
* Header raw ordering is retained. A mutation-invalidated sorted cache avoids
  re-sorting on every normal Headers iterator step while preserving live iteration.
* Body sources distinguish immutable replayable data from one-shot streaming bodies.
  Multipart encoding composes Blob segments; networking does not flatten them first.
* Framing checks lengths before allocation. WebSocket messages and fragment counts
  have independent caps. Outgoing frames are sliced and masked in-place only after
  the public API has acquired ownership; public send snapshots mutable caller bytes.
* Mutable bytes in Body.clone are isolated across branches. This necessary copy is
  not traded away to produce a misleading allocation number.
* UTF-8 decoding handles streaming partial code points. Multipart boundary search
  uses KMP to avoid repeated-prefix quadratic scans.

## Costs and tradeoffs

The core uses Promises, ordinary typed arrays, Maps/Sets, typed classes and async
state machines. Frame assembly and text/JSON/form materialization intentionally
allocate. Sending a string currently encodes once for immediate bufferedAmount
accounting and again when the raw session sends it; a future typed pre-encoded-text
transport message could eliminate that duplicate work without weakening UTF-8 rules.
Blob/File are memory-backed, not file-backed or mmap-backed. Message-oriented
WebSocket delivery inherently assembles a complete message before dispatch.

Android's baseline uses separate bounded connect/read/write pools around Socket and
SSLSocket. This prevents a blocked read from starving writes or TLS setup, but it is
not a selector/SSLEngine implementation and should not be advertised as ideal for
thousands of sockets. At most N workers in each pool and N queued jobs per pool are
allowed; idle workers expire after 60 seconds. Size N and the HTTP pool together;
the examples use 16. OS DNS operations can linger despite cancellation, but do not
spawn unbounded replacement workers. For large mobile fan-out, implement a selector
or platform raw-I/O backend behind the same ByteConnection contract and benchmark it.

The strong dependency retention described in CONFORMANCE's AbortSignal section is
also a performance integration issue. Native weak references/finalization or a safe
operation-lifetime cleanup contract are needed before unbounded repeated use of a
long-lived parent signal.

## Suggested downstream benchmark matrix (not executed)

Measure native and JVM builds separately: pooled small GETs; large uploads/downloads
with a throttled consumer; TLS cold vs resumed setup; concurrent 1/8/16/64 connections;
text/binary WebSocket payloads at 64 B, 4 KiB and 1 MiB; fragmentation/control-frame
interleaving; fast/slow clone consumers; abort churn; retained heap after GC; and
Android background/foreground transitions. Report throughput, p50/p95/p99, CPU,
peak/retained bytes and active worker/socket counts. Compare identical workloads
with target-platform baselines under the repository's exclusive benchmark lock.

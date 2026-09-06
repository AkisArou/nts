• My recommendation is: use Boa’s temporal_rs as the semantic engine, behind an NTS-owned narrow C ABI and a clean typed TypeScript façade. Do not use fullcalendar/temporal-polyfill directly
as the implementation.

Why:

                              temporal-polyfill                                                       temporal_rs

━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Intended environment Dynamic JavaScript engines JavaScript-engine implementations
───────────────────────── ────────────────────────────────────────────────────────────────────── ─────────────────────────────────────────────────────────────────
NTS compatibility Poor without major rewriting Strong
───────────────────────── ────────────────────────────────────────────────────────────────────── ─────────────────────────────────────────────────────────────────
Time zones Derived through host Intl.DateTimeFormat Explicit TimeZoneProvider abstraction
───────────────────────── ────────────────────────────────────────────────────────────────────── ─────────────────────────────────────────────────────────────────
Internal representation WeakMap, dynamic descriptors, prototypes, some Proxy/Reflect and any Native typed structs and enums
───────────────────────── ────────────────────────────────────────────────────────────────────── ─────────────────────────────────────────────────────────────────
Calendars Basic build is limited; full build depends partly on host facilities ICU4X calendars
───────────────────────── ────────────────────────────────────────────────────────────────────── ─────────────────────────────────────────────────────────────────
Native interface None Generated C and C++ API
───────────────────────── ────────────────────────────────────────────────────────────────────── ─────────────────────────────────────────────────────────────────
Reuse on JVM Excellent only after substantial static rewrite JNI/Android NDK to the same native core
───────────────────────── ────────────────────────────────────────────────────────────────────── ─────────────────────────────────────────────────────────────────
Main risk A “port” becomes a rewrite ABI completeness, binary size and Rust/native build integration

The TypeScript polyfill is excellent browser code—it reports near-perfect conformance and a very small JavaScript bundle—but its architecture assumes exactly the machinery NTS
intentionally rejects. Its class construction uses descriptors, slots are stored in WeakMap, instances are sometimes built with Object.create, and named time-zone calculations query
Intl.DateTimeFormat. See its class construction (https://github.com/fullcalendar/temporal-polyfill/blob/main/polyfill/src/apiHelpers/classStyle.ts), Instant representation
(https://github.com/fullcalendar/temporal-polyfill/blob/main/polyfill/src/classApi/basic/instant.ts), and time-zone implementation
(https://github.com/fullcalendar/temporal-polyfill/blob/main/polyfill/src/internal/timeZone.ts). Porting it faithfully would therefore be almost a new implementation.

temporal_rs is much closer to what we need:

- It was designed for embedding in ECMAScript engines and is now used by V8.
- It separates pure Temporal calculations from host clocks and time-zone data.
- It supports no_std.
- It uses ICU4X calendars.
- It already provides generated C/C++ bindings through temporal_capi.
- Its internal nanosecond representation is i128, which fits NTS particularly well because NTS bigint is also 128-bit. Temporal’s permitted Instant range needs far less than 128 bits. Boa
  project overview (https://github.com/boa-dev/temporal), provider architecture (https://docs.rs/temporal_rs/latest/temporal_rs/), C API surface
  (https://docs.rs/temporal_capi/latest/temporal_capi/all.html).

I would structure it like this:

Typed Temporal classes in TypeScript
│
│ narrow NTS-owned ABI
▼
temporal_rs / temporal_capi
│
├── pinned time-zone provider for deterministic tests
├── production time-zone provider
└── platform clock/local-zone hooks

For the backends:

- C and LLVM: link a Rust static library exposing the C ABI.
- JVM/Android: call the same library through JNI and package the appropriate Android .so per ABI.
- Temporal.Now: use an explicit platform clock/local-zone capability. Do not bury Date.now() or platform discovery inside the semantic core.
- TypeScript: own the public classes, overloads, typed property bags, errors, object lifetimes and NTS-supported coercion rules.
- Rust: own parsing, arithmetic, rounding, calendars, time-zone transitions and disambiguation.

I would not expose temporal_capi wholesale. It is still evolving—the source explicitly allows unused code “until we add all the APIs”—and its generated surface is larger and chattier than
NTS needs. Use it as the foundation, then place a small stable NTS adapter over it. Missing operations can be contributed upstream or added to that adapter. Current C API crate source
(https://github.com/boa-dev/temporal/blob/main/temporal_capi/src/lib.rs).

Before committing, I would require a short spike proving:

1. Instant, PlainDate, Duration and ZonedDateTime operations.
2. C string/result/ownership and error mapping.
3. A custom time-zone provider.
4. Static-library size with and without compiled tzdata.
5. Android cross-compilation and one JNI call.
6. Coverage of the current TypeScript lib.esnext.temporal.d.ts API.
7. Representative Test262 results.

One important ownership point: Temporal is now Stage 4 and shipped in Node 26, but the project’s pinned Node 24.20 profile predates it. Therefore it should be a shared language runtime
such as runtime/temporal, not part of runtime/node. The pinned TypeScript-Go checkout already contains lib.esnext.temporal.d.ts. Temporal status and implementation list
(https://github.com/tc39/proposal-temporal).

So my answer is: Boa core, typed TS façade, NTS-owned ABI. Keep FullCalendar’s implementation as a readable algorithmic and testing reference, particularly for ISO parsing/formatting, but
do not adopt its runtime architecture.

› so you are proposing that for java, we should use JNI, right?

• Yes—for the first high-quality implementation, I recommend JNI on JVM/Android so C/LLVM and JVM share the same temporal_rs semantics.

But not JNI for every getter. The boundary should be coarse:

- Store immutable Temporal values in JVM fields where practical.
- Represent nanoseconds as two longs matching NTS’s signed 128-bit bigint.
- Let getters such as year or epochNanoseconds read fields directly.
- Use one JNI call for substantial operations: parsing, date arithmetic, rounding, time-zone resolution and calendar conversion.
- Return value records rather than creating many long-lived native handles where possible.
- Obtain the clock and current time-zone ID in Java, then pass them into the native core.

Raw temporal_capi uses opaque native objects, which could require Cleaner-managed lifetimes on Java. I would put an NTS-specific ABI above it to favor by-value records and avoid thousands
of tiny JNI calls or native allocations.

The drawback is that JVM output would require platform-specific native libraries:

Linux/macOS/Windows JVM → matching native library
Android arm64/x86_64 → packaged .so through JNI

If “one pure Java JAR with no native library” is a hard product requirement, then JNI is unsuitable. We would instead need a JVM implementation based on ICU4J plus Temporal-specific
algorithms—java.time alone is not sufficient. That would create two semantic implementations and considerably more conformance work.

So my preference is: JNI initially for correctness and shared behavior, with a deliberately coarse NTS ABI.

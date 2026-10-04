# Date, Temporal and Intl architecture

The accepted implementation uses shared TypeScript semantics across runtimes.
The complete implementation plan, current verification results and remaining
work are maintained in
[Shared Date, Temporal and Intl](../runtime/ecmascript/DATE-TEMPORAL-INTL.md).

Native targets call ICU4C data and formatting primitives through the existing
managed C ABI. JVM and Android call bundled ICU4J directly through generated Java
bindings. JVM builtins do not load the native ICU provider. JNI and a Rust
semantic engine are not part of this architecture.

Shared TypeScript owns ECMAScript parsing, validation, option resolution,
rounding, clipping, calendar arithmetic, time-zone disambiguation and result
objects. Providers supply locale/calendar/time-zone data, text formatting,
string comparison and UTF-16 field spans. ISO arithmetic and parsing remain
independent of ICU.

Chinese/Korean modern year tables are generated in TypeScript from licensed,
pinned ICU4X data. No ICU4X execution engine or Rust dependency is imported.
The calendar context is shared by all calendar-bearing Temporal values and
relative Duration operations. Intl now supplies the same shared Chinese/Korean
fields to both text providers, including ranges selected in TS. The original
lunisolar formatting consistency test passes; other calendars and compiled
public formatting acceptance remain open. Shared same-day datetime ranges
format one date and select the time interval separately. Date spans use public
ICU APIs, with cached locator handles only where stable field identifiers are
unavailable. Datetime connectors and interval fallbacks retain their respective
LDML and SimpleFormatter quoting rules.

Best architecture, clean code and performance are standing requirements.
Use the pinned TypeScript library contracts directly, private instance state,
managed provider handles, configuration outside hot loops and reusable typed
scratch buffers. Measure compiled public paths, construction, allocations,
startup and artifact size as well as reused formatting throughput. UTC/ISO-only
programs must not acquire ICU.

Original Test262 is the semantic corpus. Host replay and provider probes are
supplementary; completion requires actual standard builtin execution across the
supported compiler backends and the platform acceptance matrix in the plan.

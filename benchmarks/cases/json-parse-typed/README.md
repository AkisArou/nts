# Typed JSON parsing

A handwritten prototype of a parser specialized for a known document shape.
It uses the runtime JSON scanner and constructs typed objects directly. Every
engine runs the same `work(offset)` implementation; host `JSON.parse` is only
used by the separate sizing experiment and semantic controls.

Each operation parses eight distinct prebuilt documents in rotated order and
checksums every known field. A document contains 2,000 rows and 136,304 UTF-8
bytes; the pool contains 1,090,432 bytes. Pool construction is outside timing.
The declared input domain is the integer offsets zero through two (plus the
oracle generator's signed-zero control). All documents are visited for every
offset. There is no C++ or Java rewrite of the parser.

`verify.mjs` checks native parity, escaped and duplicate keys, key order, syntax
error precedence, shape validation, unknown fields and deep unknown values.
Its semantic corpus runs on node; the declared valid workload is also checked
on C, LLVM and the JVM by the differential harness.

The two-pool sizing study, host native-parse arms, NoGc control and native
profiles are recorded in
[the sizing notebook](../../../docs/records/notebooks/json-parse-typed-sizing.md).
This case is an instrument for generated-parser and native-codegen work; it
does not implement the production `JSON.parse(text) as T` design.

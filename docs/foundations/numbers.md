# Numbers

How `number` and `bigint` are represented on native (C and LLVM), what each
operation on them costs, and how native code is compiled so that arithmetic is
both fast and exactly node's. For compiler and runtime work. What a numeric
program *means* (the language's `number`, the written scalar types such as
`Uint8` and `c_int`, and the rules at fixed-width boundaries) is
[language/numbers.md](../language/numbers.md).

## What a number is

| value | native representation | when |
|---|---|---|
| `number` | `double` | by default: always correct, sometimes slower |
| `number`, proved whole and in `int32` | `int32_t` | the compiler proves it ([below](#integers-proved-from-doubles)) |
| the same, proved in `uint32` | `uint32_t` | |
| the same, proved within ±(2^53 − 1) | `int64_t` | |
| an element of `number[]` | `double`, or `int32_t` or `int64_t` | narrowed per element type, for every array of that type in the program |
| an element of a typed array | the array's own width (`Int8Array` to `Float64Array`) | always ([objects](objects.md#typed-arrays)) |
| a value of a written scalar type | its width (`Uint8` is one byte) | [language/numbers.md](../language/numbers.md) |
| `bigint` | `__int128`, signed | always ([below](#bigint)) |
| a number or bigint in an erased value (`any`, `unknown`, a union) | a 16-byte tagged value, the number as a `double`; a bigint in an owned box | [objects](objects.md#dynamic-values) |

## Integers proved from doubles

TypeScript's `number` is a double, and a C program that uses integers runs the
same arithmetic markedly faster. The compiler closes that gap by **proof**,
never by guessing: a value becomes an integer only when the analysis proves
every value it can hold is one. Where the proof is missing it stays a double.

**What the analysis tracks** (`hir::facts`, driven by `hir::flow` over the SSA
program): for every number, an interval over the extended reals, and three
facts an interval cannot hold: whether it is whole, whether it may be `NaN`,
and whether it may be `-0`. Its transfer functions are JavaScript's: `0 *
Infinity` is `NaN`, `%` takes the sign of its dividend, `x | 0` is a proof by
way of `ToInt32`.

**Where facts come from:**

- operators, the `Math` functions and the coercions;
- guards: `if`, `&&`, early returns, and loop conditions (`hir::loops` bounds
  loop counters);
- fields: a field holds the join of every store the program makes into it
  (`hir::fields`), and an array element the join of every store into arrays of
  its element type (`hir::elements`);
- other functions: arguments are joined over every call site in the program,
  including calls through dispatch tables, and results flow back.

**Three obligations** before a value may be an integer, in this order:
representable (the literal survives as a double), whole on every path with
`NaN` excluded, and within ±(2^53 − 1), past which adjacent integers are not
distinguishable as doubles. **Negative zero** must also be unobservable: `-0`
and `0` are one integer, so a value that may be `-0` stays a double where
something can tell the difference: dividing by it, `Math.min` and `Math.max`,
or leaving the function (`hir::zero_sign`). `ToInt32`, the bitwise operators
and the comparisons erase the sign, which is why `(x * y) | 0` computes in
integers.

**Where conversions happen.** Values joined by the edges of the control-flow
graph are one storage location, so they get one representation: a loop's
counter is an integer on every edge or on none. A conversion appears only at a
use that needs a double (a floating-point operation, a call whose parameter is
a double, a return), and each is one instruction.

**Across calls.** A parameter that every caller in the program proves whole
becomes an integer parameter (`hir::signatures`). A **root**, a function called
from outside the program, keeps its published `double` signature, and gets a
clone with integer parameters behind one test at entry: `ToInt32(n) == n`
sends whole arguments to the clone and everything else (`NaN`, `1e300`, `1.5`)
to the original body (`hir::guards`). A function named by a dispatch table
keeps the table's signature.

| operation | cost on native |
|---|---|
| arithmetic on proved integers | one integer instruction |
| arithmetic on doubles | one floating-point instruction, never fused with the next |
| `x \| 0`, `x >>> 0` on a double | inline: the hardware conversion when `x` is in range, about ten instructions when it is not; no library call |
| an integer meeting a double | one conversion, at that use |
| a number crossing a call | nothing where the callee's parameter is narrowed; one conversion otherwise |

**Bounds checks** fall out of the same intervals ([objects](objects.md#arrays)).

`nts facts` prints each function's numbers with their representation and
facts, and `nts stats` counts what was specialized
([cli](../reference/cli.md#inspecting)).

## BigInt

**Exact to 128 bits, and stopped past them.** A `bigint` is a signed 128-bit
integer, held in registers, locals and fields with no allocation, and every
result is exact within that range. A result outside it stops the program by
name, `a bigint past 128 bits, which this runtime does not hold`, on every
backend. Arbitrary precision is to come (see [Decisions](#decisions)).

| operation | how, on native | cost |
|---|---|---|
| `+`, `-`, `*` | `__builtin_*_overflow` on `__int128` | two-word arithmetic and a branch; no call unless the result leaves the range |
| `/`, `%` | C's operators, with the one overflowing case (`MIN / -1n`) stopped | a zero divisor throws `RangeError`, as JavaScript does |
| `<<`, `>>`, `**` | runtime helpers | a call. An upward shift or a power past 128 bits stops; a downward shift saturates arithmetically, as JavaScript's does |
| `BigInt.asIntN`, `asUintN` | runtime helpers | a call |
| `BigInt(x)` of a number | a range and integrality check | a non-integer, or a value outside 128 bits, stops by name where JavaScript throws `RangeError` |
| comparisons, equality | two-word compares | inline; comparison with a string is exact against `StringToBigInt`'s grammar |
| into an erased slot | an owned, immutable box (`NtsBigIntBox`) | one allocation; compared by value, never by identity |
| in an array | unboxed 128-bit slots | none |

The stops by name (a result past 128 bits, `BigInt(x)` of a non-integer) are
not yet catchable errors, like the other run-time stops (L14 in
[open questions](../open-questions.md)).
`BigInt64Array` and `BigUint64Array` are not provided; `DataView`'s 64-bit
accessors read and write the low 64 bits.

## Number and text

**Number to text** (`String(n)`, templates, `+` with a string, `toString`):

- **a whole number below 2^53** is written two digits at a time, its length
  known before the first digit, straight into the destination: no division per
  digit and no scratch buffer;
- **any other finite number** takes its shortest round-trip digits from
  **zmij** (vendored, unedited), placed in ECMAScript's layout;
- **`toString(radix)`** is V8's algorithm, the one that agrees with node on the
  fraction;
- **`toFixed(d)`** expands the double exactly and rounds as the specification
  says;
- `toPrecision` and `toExponential` are refused (`NTS1001`).

A number appended to a string being built is written where it is appended
([strings](strings.md)).

**Text to number:** `Number(s)` and unary `+` check ECMAScript's
StringToNumber grammar in the runtime (whitespace, `0x`/`0o`/`0b`, `Infinity`,
the empty string as `0`), because a C library's parser accepts spellings
JavaScript does not (`inf`, hexadecimal floats); `parseFloat` scans its own
longest-prefix grammar, and `parseInt` its integer one. The value of a decimal
span, for `Number(s)` and `parseFloat`, comes from **ffc**, a C port of
fast_float (vendored, unedited): correctly rounded by Eisel–Lemire with
fast_float's slow path behind it, and independent of the C library's locale.

## Math

ECMAScript divides `Math` in two, and so does nts.

| group | members | on native |
|---|---|---|
| exact: one right answer per input | `abs`, `sign`, `floor`, `ceil`, `trunc`, `round`, `sqrt`, `fround`, `min`, `max`, `imul`, the constants | computed exactly. `floor`, `ceil`, `trunc`, `round`, `abs`, `sqrt`, `min` and `max` are operations the analysis knows, so their results can be integers; `sign`, `fround` and `imul` are small runtime helpers |
| approximated: the specification names the function and its special cases | `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `exp`, `expm1`, `log`, `log1p`, `log2`, `log10`, `cbrt`, `hypot`, `pow` | a call into the C library's libm, with `pow`'s ECMAScript special cases (`1 ** NaN` and `(±1) ** ±Infinity` are `NaN`) |
| absent | `asinh`, `acosh`, `atanh`, `clz32`, `f16round`, `random` | `NTS1100` |

- **`x ** k` for a literal `k`** of 0, 1 or 2 is folded (`x * x` is exact);
  every other exponent calls `pow`, since a cube by multiplication rounds twice.
- **Today the approximated group can differ from node** by up to 2 ULP, glibc
  against V8. So [`nts check`](../reference/cli.md#nts-check) compares those
  functions, and anything their result reaches, within 4 ULP.
- **Decided, not built:** ship V8's fdlibm-derived `ieee754` functions on
  native, so every `Math` function matches node bit for bit.
- **`Math.random`, designed, not built:** V8's own generator (xorshift128+),
  seeded once from the OS's random source, so a test can seed it to reproduce
  `node --random-seed=N` exactly. [Builtins](builtins.md#the-clock-and-randomness)
  has the design; today it is `NTS1100` (G12).

## How native code is built

The flags live in one list (`compiler/codegen/common/src/compile_flags.rs`),
read by `nts build` and by the benchmark harness alike, so a benchmark row
measures what ships.

| flag | applies to | why |
|---|---|---|
| `-O2` | every native compile | |
| `-ffp-contract=off` | every native compile | JavaScript arithmetic is one IEEE-754 operation at a time. Fusing a multiply into an add (FMA) rounds once where the program rounds twice; FMA comes with x86-64-v3, and this keeps it out of the program's arithmetic |
| `-fno-math-errno` | every native compile | no JavaScript program can read `errno`, and while `sqrt` may set it, clang cannot inline it |
| `-march=x86-64-v3` | x86-64, unless the target says `cpu: "baseline"` | AVX2, BMI2 and FMA (Intel from Haswell, AMD from Zen). The program checks the CPU before anything else runs, in code built for the baseline, and stops with a sentence naming `cpu: "baseline"` |
| `-falign-loops=32` | x86-64, at every CPU level | every loop starts on a 32-byte boundary, so a loop's speed does not depend on where it happens to land |
| `-flto=thin` | builds whose compiler is clang | ThinLTO inlines the runtime's small helpers (a typed-array read, a bounds check, the string helpers) into the program across translation units |
| `-ffunction-sections`, `-fdata-sections`, `--gc-sections` (`-dead_strip` on Mach-O) | every native link | only the parts of the runtime and its tables a program reaches are linked |

Array elements start on a 32-byte boundary, one AVX2 register, whatever the
CPU level ([objects](objects.md#arrays)). Cross toolchains build without
ThinLTO and without the CPU flags for now
([nts.config.ts](../reference/nts-config.md#toolchains)). The measurements
behind these flags are in the
[numbers study](../records/notebooks/studies/primitives-numbers-control.md).

## The other backends

The JVM computes in `int`, `long` and `double`, with BigInt to 128 bits and the
same stop past it; its number-to-text formatter is a Grisu2 port, and a port of
zmij is decided. Wasm computes in `i32`, `i64` and `f64`, holds a bigint as one
`v128` and stops past 128 bits, and gives erased small integers `i31`.
[The JVM and Wasm](jvm-and-wasm.md) has each backend's state and proposals,
including `Math` on the JVM (J3).

## Decisions

- **x86-64 builds default to x86-64-v3,** with a clear error on an older CPU, a
  portable opt-out (`cpu: "baseline"`), run-time dispatch kept in vendored SIMD
  kernels, 32-byte array alignment, and `-ffp-contract=off`
  ([log](../records/notebooks/decisions-log.md#numbers-and-json-10-22)).
- **`Math` is bit-identical to node:** V8's fdlibm-derived `ieee754` ships
  ([log](../records/notebooks/decisions-log.md#numbers-and-json-10-22)).
- **Benchmarks build exactly as `nts build` does, and `nts build` uses ThinLTO**
  ([log](../records/notebooks/decisions-log.md#numbers-and-json-10-22)).
- **BigInt gets real bignums past 128 bits, later**
  ([log](../records/notebooks/decisions-log.md#numbers-and-json-10-22)). The
  log's interim "wrap at 64 bits" is not what the code does: it is exact to 128
  bits and stops past them.
- **The clock and randomness come from the environment,** with seeded
  randomness under the differential tests
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22),
  decision 2). With `Math` bit-identical to node, that makes `Math.random`
  V8's own generator.

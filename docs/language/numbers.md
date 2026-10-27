# Numbers

What `number`, `bigint` and the scalar types of `@nts/scalars` mean in a
program nts compiles, and how exactly numbers turn into text and back. For
anyone writing numeric code for nts, or binding a library whose functions take
fixed-width integers. How numbers are represented on each backend and what
they cost is [foundations/numbers.md](../foundations/numbers.md).

## `number`

A `number` is an IEEE 754 double, with JavaScript's semantics on every
backend: `7 / 2` is `3.5`, `2 ** 53 + 1` rounds, `NaN` and `-0` exist and
behave as the specification says, and nothing wraps or truncates unless the
program writes an operator that does. The bitwise operators convert through
`ToInt32` and `ToUint32` exactly as JavaScript does, so `a | 0` is a signed
32-bit integer and `x >>> 0` an unsigned one.

## Integers proved from doubles

The compiler works out, for every number, its range, whether it is whole, and
whether it can be `NaN` or `-0`, from literals, operators, `Math` calls,
guards (`if`, `&&`, early returns), loop bounds and written scalar types. Where
every value a variable, parameter or field can hold is proved to be a whole
number in range, it is held in a 32- or 64-bit integer, and the operations on
it become integer instructions. The proof never changes a result: an integer
is used only where the double the program describes would have the same
value, `-0` included. Array bounds checks the analysis can prove away are
removed the same way.

A program needs no annotation for any of this. Writing a scalar type (below)
adds a checked fact; it does not change what an operator computes.

## Numbers as text, and text as numbers

Conversions give node's answer, digit for digit, because each is the
specification's algorithm rather than a C library's. On native targets and
the JVM nts's runtime implements them; on Wasm the JavaScript host does. How
is [foundations/numbers.md](../foundations/numbers.md#number-and-text).

| Conversion | The answer |
|---|---|
| `String(n)`, `` `${n}` ``, `n.toString()`, `JSON.stringify` | the shortest decimal that reads back as the same double, in ECMAScript's layout |
| `Number(s)`, `+s` | the double nearest the decimal, correctly rounded, by the whole-string grammar: `Number("12abc")` is `NaN` |
| `parseFloat(s)`, `parseInt(s, radix)` | the longest prefix their grammars admit: `parseFloat("12abc")` is `12` |
| `n.toString(radix)`, `n.toFixed(d)` | node's digits; a radix or digit count out of range throws `RangeError` |
| `n.toPrecision(p)`, `n.toExponential(d)` | refused |

## `Math`

`Math`'s constants and functions are provided on every backend. Where the
specification gives one right answer (`abs`, `floor`, `round`, `sqrt`,
`fround`, `imul`, `min` and `max` at any arity, and the rest), nts gives it.
For the approximated functions (`sin`, `exp`, `log`, `pow` and their kin) the
specification allows any close answer, and node's come from V8's port of
fdlibm. Today native targets call the C library's `libm` and the JVM
`java.lang.StrictMath`, so their answers can differ from node's in the last
bits; Wasm calls the host's `Math`. Shipping V8's functions so that `Math`
matches node bit for bit is decided, not built
([foundations/numbers.md](../foundations/numbers.md#math)).

Refused with NTS1100: `Math.clz32`, `asinh`, `acosh`, `atanh`, `f16round`,
and `Math.random`, which waits for the environment's randomness (register
[G12](../open-questions.md#2-builtins-and-globals)).

## BigInt

A `bigint` is exact, and nts holds it in 128 bits: every value from
-2<sup>127</sup> to 2<sup>127</sup> - 1, on every backend.

- Arithmetic (`+ - * / % **`), comparison, and the shifts follow JavaScript's
  rules, including those C leaves undefined: a negative shift count shifts the
  other way, and a downward shift past the width saturates (`-1n >> 300n` is
  `-1n`).
- `BigInt(n)` takes an integer `number` or a `boolean`. `BigInt.asIntN` and
  `BigInt.asUintN` wrap to a width. `String(b)` and `b.toString()` give the
  decimal digits. A `bigint` compares exactly with a `string` (`10n < "11"`).
- A division by zero and a negative exponent throw a catchable `RangeError`,
  as in node.
- A result that leaves the 128-bit range stops the program by name:
  `nts: refused at run time: a bigint past 128 bits, which this runtime does
  not hold`. So does `BigInt(1.5)`, where node throws a `RangeError`, and
  `BigInt(x)` for a double outside the 128-bit range.
- `BigInt("123")`, a conversion from a string, is refused, and so is `==`
  between a `bigint` and a `number`, since it coerces.
- `DataView` reads and writes 64-bit integers as bigints; `BigInt64Array` and
  `BigUint64Array` are not provided.

Unbounded bigints are the decided end state (below). The run-time stops are
listed with the other uncatchable errors in [errors.md](errors.md#which-run-time-errors-a-program-can-catch).

## Scalar types

`@nts/scalars` names numbers of a fixed kind. A program imports the names it
uses as types:

```ts
import type { Uint8, Uint16, Int32, c_int } from "@nts/scalars";
```

The module is declared by `runtime/native/scalars.d.ts`, which the program
lists in its `tsconfig.json`; it is not distributed as a package yet
([modules.md](modules.md#nts)).

| Kinds | Carried as |
|---|---|
| `Int8`, `Uint8`, `Int16`, `Uint16`, `Int32`, `Uint32` | `number` |
| `Float32` (a value C's `float` holds exactly), `Float64` | `number` |
| `BigInt64`, `BigUint64` | `bigint` |
| C's own types, as C spells them: `c_char`, `c_int`, `c_uint`, `c_long32`, `c_ulong32` | `number` |
| `c_long`, `c_ulong`, `c_size_t`, `c_ptrdiff_t`, `c_uintptr_t` | `bigint` |
| `AsNumber<C>`: a 64-bit or pointer-wide integer a binding hands over as a number, such as a size or a count | `number` |

A scalar is a `number` or `bigint` with an optional label that TypeScript
checks nothing about: a plain number goes anywhere a scalar does, and the
reverse. nts checks it, by one rule:

- **A value stored into a written kind must be proved to fit, or the build
  stops.** That covers a parameter, a field, a global, a local, a return, an
  argument to a native function, and a result returned to native code. The
  error, NTS5001, says what nts knows about the value and what to write
  instead: a guard (`if (n >= 0 && n <= 0xffff)`), a mask (`n & 0xffff`),
  `Number.isInteger`, or `Math.fround` for a `Float32`. nts inserts no check
  the program did not write.
- **Only local facts prove a store:** what the function proves alone, its loop
  bounds, and written types. What callers happen to pass never counts, so
  adding a caller in one file cannot break a call in another.
- **A read of a written kind is one of its values**, and the compiler uses that
  as a fact: `n: Uint16` is a whole number in 0..65535.
- **`n as Uint16` keeps TypeScript's meaning:** an assertion with no run-time
  effect, accepted only where nts proves it.
- **Operators compute JavaScript's values.** Two `Uint8`s add to `300`, as in
  node; only storing the result into a `Uint8` is checked.
- **Containers and functions are invariant in their scalar positions.** An
  `Int8[]` passed where a `number[]` is expected is refused, though TypeScript
  allows it. A function let into a function type whose parameter is written as
  another kind is NTS5002, and an override that writes a parameter or result as
  another kind than the method it overrides is NTS5003.
- **Floats and `-0` keep node's values.** A store into `Float32` must be
  exact, and a value that may be `-0` cannot enter an integer kind unless
  proved otherwise.
- **Typed arrays and `DataView` are not scalar slots.** Their stores wrap, as
  in node.

C's kinds are as wide as the target makes them, and a build for several
targets accepts a value only where it fits on every one: `c_long` is a `bigint`
because it is 64 bits on LP64 targets, and `c_long32` is the Windows `LONG`.
`AsNumber<C>` turns a value past 2<sup>53</sup>, where C answers one, into a
`RangeError` rather than a rounded number.

Designed, not built: the conversions (`Uint16(x)`, which throws a `RangeError`
where the value does not fit, `try`, `is`, `wrap`, `clamp`), the integer
operations in five overflow modes (`wrappingAdd`, `saturatingMul`,
`checkedDiv` and the rest), the bit, byte and float operations, the `MIN`,
`MAX` and `BITS` constants, and the `Float16`, `Float128` and 128-bit integer
kinds. Each will be a compiler operation and a TypeScript implementation in
`@nts/scalars` that node runs, kept equal by an oracle test.

## Decisions

- `Math` is bit-identical to node, by shipping V8's fdlibm-derived `ieee754`
  (10-22,
  [Numbers and JSON](../records/notebooks/decisions-log.md#numbers-and-json-10-22)).
  Not built.
- BigInt past 128 bits becomes real bignums (10-22,
  [Numbers and JSON](../records/notebooks/decisions-log.md#numbers-and-json-10-22)).
  The interim the entry names, wrapping at 64 bits, is not what the runtime
  does: it stops by name past 128 bits.
- Scalar types are strict from the start, and written slots are strict too:
  nts adds no check the program did not write (D1, D2). The complete library is
  the target, Rust's integer API designed as a TC39 proposal (D3, D6). The
  explicit escape is `Uint16(x)`, and `as` keeps TypeScript's meaning (D4).
  Errors come from the compiler at build time (D7). A written type is a sound
  fact, only local facts prove a store, and floats and `-0` keep node's values
  (Q1 to Q3). All 2026-10-08, recorded in the
  [scalar numbers notebook](../records/notebooks/scalar-numbers.md#6-decisions).

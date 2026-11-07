# JVM backend: unsigned integers compare as signed, and u64 converts to double as signed

Status: **latent**. Found by reading the source and confirmed by probing (2026-10-08).
- Plain TypeScript can't reach it today: every probe below gives node's answer on the JVM lane.
- It becomes reachable as soon as a `u32` holding 2^31 or more, or a `u64` holding 2^63 or more, reaches the JVM lane. Holding written `Uint32` / `BigUint64` values at their width, which scalar adoption plans to do, does exactly that.
- So it must be fixed before or with adoption.
- Not reported to MainClaude; the user decides when.

## Where

Line numbers are as read at nts HEAD on 2026-10-08.

- **Comparisons.**
  - In `compiler/codegen/jvm/src/ops.rs`, `compare_and_branch` (around lines 4809-4823) picks the instruction from `Kind` alone: `Kind::Int` becomes `branch_int` (`if_icmpXX`), and `Kind::Long` becomes `lcmp` and then a test against zero.
  - `Kind` is the JVM stack representation, which has no signedness, so an unsigned `HirType::Int { signed: false }` compares as signed.
  - Nothing in `compiler/codegen/jvm` calls `Integer.compareUnsigned` or `Long.compareUnsigned`.
- **u64 to double or float.**
  - `ops.rs` (around lines 5185-5205) routes a `u32` going to long/float/double through `Integer.toUnsignedLong`. Its own comment describes this bug for u32: "`storeU32` answered -2147483648 where node said 2147483648".
  - `HirType::Int { bits: 64, signed: false }` has no such route, so `l2d` / `l2f` read the top bit as a sign.

## Effect, once reachable

| Expression | node | JVM lane |
|---|---|---|
| `a > b` with `a: u32 = 3000000000`, `b = 1` | `true` | `false` (`-1294967296 > 1`) |
| `a < b` with `a: u64 = 2^63`, `b = 1n` | `false` | `true` |
| `Number(a)` with `a: u64 = 2^64 - 1` | 18446744073709552000 | -1 |

The C and LLVM lanes are unaffected: they emit `icmp ugt`/`ult` and `uitofp`.

## Why plain code doesn't reach it today

These were probed with `target/release/nts` (built 2026-10-03), `NTS_NO_SNAPSHOT_CACHE=1`, in a scratch directory.
- **`x >>> 0` is held as an `i64`,** not a `u32` (`touint32 %0 : i64`). So comparisons on it are correct.
- **`specialize.rs` makes a remainder `u32` only when its divisor fits an `i32`.** For example, `h % 10` gives `rem %13, %14 : u32`. That remainder is always below 2^31, so its top bit is never set. With a larger divisor (`h % 4000000000`) the remainder is `u64`, and its values stay below 2^63.
  - `big(3000000000)`, which tests `h % 4000000000 > 2000000000`: node `true`, JVM lane `true`.
  - `small(3000000000)`: both `false`.
- **A scalar label on an ordinary function's parameter is lowered to `f64` today** (`gt(a: f64, b: f64)`). Labels matter only at C boundaries, so nothing holds a `u32` across a comparison.

## Repro, for when it becomes reachable

The test should hold values at their width, then compare and convert:

```ts
// with Uint32 / BigUint64 held as u32 / u64 by the JVM lane
export function gt(a: Uint32, b: Uint32): boolean { return a > b; }
export function lt64(a: BigUint64, b: BigUint64): boolean { return a < b; }
export function toNum(a: BigUint64): number { return Number(a); }
console.log(gt(3000000000, 1));                    // true
console.log(lt64(9223372036854775808n, 1n));      // false
console.log(toNum(18446744073709551615n));        // 18446744073709552000
```

Today the same can be forced by a HIR-level test in the JVM crate. Construct `gt %a, %b` over `u32` / `u64` params directly and run it.

## Fix

- **Thread signedness into `compare_and_branch`.** For unsigned operands either:
  - call `Integer.compareUnsigned(a, b)` / `Long.compareUnsigned(a, b)` and branch on the result against zero; or
  - XOR both operands with `Integer.MIN_VALUE` / `Long.MIN_VALUE` and compare signed, which is branch-free and what javac's own `compareUnsigned` compiles to.
- **u64 to double:** `x >= 0 ? (double) x : (double) ((x >>> 1) | (x & 1)) * 2.0`. Keeping the low bit (sticky) makes this round to nearest correctly. To float, do the same with `(float)`.
- **Fixture:** compare and convert values just above 2^31 and 2^63 on every lane, and diff against node. The C and LLVM lanes act as the control.

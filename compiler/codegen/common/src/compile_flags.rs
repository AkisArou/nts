//! How a native program's C and LLVM IR are optimized: one list, read by
//! `nts build` and by `nts-bench`.
//!
//! # Why one list
//!
//! The two had their own, and drifted: the benchmark compiled with `-flto`
//! and `nts build` did not, so a runtime helper only LTO inlines was inlined
//! in every row and in no shipped program. The study that found it measured
//! LLVM's `awfy-permute` 2.99x slower as `nts build` makes it than as the
//! table reported (`~/.cache/nts-scratch/primitives/numbers-control/`, 2026-10-22).
//! A benchmark is a claim about what ships, so it reads what ships.

/// The optimization flags for nts's own C and LLVM IR and for the runtime it
/// links, on every native target.
///
/// - `-O2`.
/// - `-ffp-contract=off`: JavaScript arithmetic is one IEEE-754 operation at
///   a time, and fusing a multiply into an add (an FMA) rounds once where the
///   program rounds twice. clang contracts by default wherever the target has
///   FMA; nts's program code escaped only because it writes one operation per
///   C statement, and the runtime's expressions did not. With AVX2 enabled,
///   the C++ references for `awfy-mandelbrot` and `awfy-nbody` failed their own
///   verification, which is the same fault in code that does not escape it.
/// - `-fno-math-errno`: no JavaScript program can read `errno`, and while
///   `sqrt` may set it clang cannot inline it. Measured as noise on 20 rows.
/// - `-falign-loops=32`: every loop starts on a 32-byte boundary, for a build
///   that is not linked with LTO, where code is generated at compile time. The
///   reason, and the one loss, are [`LINK_LTO`]'s; under LTO this flag does
///   nothing, and it goes when `nts build` links with `ThinLTO`.
pub const OPTIMIZE: &[&str] = &[
    "-O2",
    "-ffp-contract=off",
    "-fno-math-errno",
    "-falign-loops=32",
];

/// What a link with `-flto` adds, where code is generated at the link and a
/// compile-time code-generation flag has no effect.
///
/// - `-plugin-opt=-align-loops=32`: every loop starts on a 32-byte boundary.
///   Where a hot loop lands decided whole rows: C and LLVM disagreed on the
///   same prepared program by up to 2.7x while executing the same instructions
///   per iteration, with one lane's loop straddling what the front end fetches
///   in one go (C's `dispatch` took 321M decoded-stream misses where LLVM's
///   took 0.8M). Aligned, the two lanes agree. One sitting each way, nts-bench
///   on CPU 4, µs (C / LLVM), 2026-10-22:
///
///   | row        | plain         | aligned 32    | aligned 64    |
///   |------------|---------------|---------------|---------------|
///   | awfy-list  | 9.92 / 10.06  | 7.27 / 7.27   | 7.66 / 7.50   |
///   | dispatch   | 27.61 / 10.29 | 22.41 / 21.40 | 22.10 / 22.11 |
///   | awfy-sieve | 6.23 / 6.15   | 5.69 / 5.69   |               |
///   | substrings | 1.46 / 2.28   | 1.42 / 1.43   |               |
///   | fib        | 565.9 / 566.8 | 520.9 / 521.1 |               |
///   | loop       | 673.7 / 665.3 | 650.2 / 650.0 |               |
///
///   `arrays` and `bigint`, which straddle nothing, held level. **One cell
///   loses**: LLVM's `dispatch` goes from 10.29 to 21.40 µs. Its interpreter
///   loop is the same instructions as C's, and it had landed, by accident of
///   placement, where the front end serves it best; aligning takes that accident
///   away, and no alignment tried gives it back (64 is no better). C's
///   `dispatch` gains 19%, and every lane now runs at the speed the code earns
///   rather than the speed its address happens to give it.
pub const LINK_LTO: &[&str] = &["-Wl,-plugin-opt=-align-loops=32"];

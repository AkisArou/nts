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
pub const OPTIMIZE: &[&str] = &["-O2", "-ffp-contract=off", "-fno-math-errno"];

//! The facts each optimization won, asserted so losing one is a failing test.
//!
//! # Why not a snapshot of the emitted code
//!
//! A golden `.ll` file churns on every unrelated change -- this emitter moved a
//! dozen times in a day -- and a diff nobody can read gets waved through. That
//! is a check that has stopped being a check.
//!
//! So each test states the *fact* the optimization won, in a sentence: the
//! counter is an integer, the loop vectorizes, the byte does not go through a
//! double. When one fails it names which fact was lost, where a snapshot diff
//! says "1,200 lines changed".
//!
//! # Why the differential does not already cover this
//!
//! It proves the answer is right, which is a different question from whether
//! the optimization still fires. `benches/cases/elementwise` could go back to
//! 4.95x hand-written C++ with every existing test green -- the numbers are
//! timings, and nobody fails a build on a timing.
//!
//! The project already works this way twice over: generated C carries
//! `_Static_assert(offsetof(...) == N)` for every field, and
//! `tests/signatures.rs` regenerates the runtime table from clang and fails on
//! drift. Assert the claim; let the toolchain check it.

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn tsgo() -> Option<String> {
    let path = std::env::var("NTS_TSGO").ok()?;
    std::path::Path::new(&path).exists().then_some(path)
}

/// The LLVM module for one small program, and the HIR behind it.
fn rendered(case: &str, source: &str) -> Option<(String, hir::Program)> {
    let tsgo = tsgo()?;
    // Per case, because `cargo test` runs these in parallel.
    let dir = std::env::temp_dir().join(format!("nts-opt-{}-{case}", std::process::id()));
    let src = dir.join("src");
    std::fs::create_dir_all(&src).expect("a work directory");
    std::fs::write(src.join("main.ts"), source).expect("write the program");
    std::fs::write(
        dir.join("tsconfig.json"),
        r#"{ "compilerOptions": { "target": "ESNext", "module": "ESNext",
             "moduleResolution": "bundler", "strict": true, "noEmit": true },
             "include": ["src"] }"#,
    )
    .expect("write the tsconfig");

    let tsconfig = Utf8Path::from_path(&dir)
        .expect("utf-8 path")
        .join("tsconfig.json");
    let mut api = TsgoApi::for_compilation(tsgo);
    let snapshot = api.snapshot(&tsconfig).expect("snapshot should succeed");
    assert!(!snapshot.has_errors(), "the fixture should typecheck");
    let prepared = hir::prepare(&snapshot).expect("prepared HIR should verify");
    let emitted = nts_codegen_llvm::emit(&prepared.program);
    assert!(
        emitted.diagnostics.is_empty(),
        "{case}: the backend declined: {:?}",
        emitted
            .diagnostics
            .iter()
            .map(|d| &d.message)
            .collect::<Vec<_>>()
    );
    Some((emitted.text, prepared.program))
}

/// Optimize the module the way `tooling/bench` does and hand back the assembly.
fn optimized(case: &str, module: &str) -> Option<String> {
    let dir = std::env::temp_dir().join(format!("nts-opt-{}-{case}", std::process::id()));
    let path = dir.join("program.ll");
    std::fs::write(&path, module).ok()?;
    let out = std::process::Command::new("clang")
        .args(["-x", "ir", "-O2", "-S", "-w"])
        .arg(&path)
        .arg("-o")
        .arg("-")
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// A loop counter bounded by a length is an integer, not a double.
///
/// `xs.length` is a `uint32_t`, so a counter compared against it is not
/// provably an `int32` -- and left a `double` every index becomes an `fptoui`
/// of a floating-point induction variable, which LLVM's scalar evolution
/// cannot model. `benches/cases/elementwise` was 4.95x hand-written C++ and is
/// 1.25x.
#[test]
fn a_length_bounded_counter_is_an_integer() {
    let Some((module, _)) = rendered(
        "counter",
        "export function scale(xs: number[]): void {\n\
         for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * 2; }\n}",
    ) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    assert!(
        module.contains("phi i64") || module.contains("phi i32"),
        "the counter went back to a double:\n{module}"
    );
    assert!(
        !module.contains("fptoui double"),
        "an index is converted from a double per iteration:\n{module}"
    );
}

/// And the loop that counter is in vectorizes.
///
/// The counter is why it could not: every iteration is independent here, so
/// there is no ordering to preserve and a compiler is free to do four at a
/// time. Asserted on the *assembly*, because that is where the claim is true or
/// not.
#[test]
fn an_elementwise_loop_vectorizes() {
    let Some((module, _)) = rendered(
        "vectorize",
        "export function scale(xs: number[], k: number): void {\n\
         for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * k; }\n}",
    ) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    let Some(assembly) = optimized("vectorize", &module) else {
        eprintln!("SKIP: clang is unavailable");
        return;
    };
    assert!(
        assembly.contains("mulpd") || assembly.contains("vmulpd"),
        "the elementwise loop stopped vectorizing:\n{assembly}"
    );
}

/// A byte out of a typed array reaches integer arithmetic as an integer.
///
/// The lowering converts to `number` because that is the expression's type and
/// specialization converts back because that is what the arithmetic wants, so
/// the byte went `u8 -> f64 -> i32` around a value that was already an integer.
/// `simplify::fold_conversions` collapses the detour.
///
/// The extension is `zext`, and that half is a correctness claim rather than a
/// speed one: widening reads the *source's* signedness, and asking the
/// destination made bytes 128..255 negative.
#[test]
fn a_byte_does_not_travel_through_a_double() {
    let Some((module, _)) = rendered(
        "bytes",
        "export function sum(data: Uint8Array): number {\n\
         let total = 0;\n\
         for (let i = 0; i < data.length; i++) { total = (total + data[i]) | 0; }\n\
         return total;\n}",
    ) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    assert!(
        module.contains("zext i8"),
        "a byte is not widened with `zext`:\n{module}"
    );
    assert!(
        !module.contains("uitofp i8"),
        "a byte still travels through a double:\n{module}"
    );
}

/// A loop whose index is proven in range carries no bounds check.
///
/// `hir::bounds` removes them where the guard proves the index, and it does so
/// on the *natural* form -- coercing the bound with `| 0` breaks the connection
/// and puts two checks per iteration back, which is worse than the double
/// counter it was meant to fix.
#[test]
fn a_proven_index_costs_no_check() {
    let Some((module, _)) = rendered(
        "checks",
        "export function total(xs: number[]): number {\n\
         let t = 0;\n\
         for (let i = 0; i < xs.length; i++) { t = t + xs[i]; }\n\
         return t;\n}",
    ) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    let body: String = module
        .lines()
        .filter(|line| !line.starts_with("declare"))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        !body.contains("@nts_check_fn") && !body.contains("@nts_index_fn"),
        "a proven index grew a bounds check:\n{body}"
    );
}

/// The control for the test above: a shape that *does* carry a check.
///
/// An assertion that something is absent is only worth having if it can see the
/// thing when it is there. Coercing the bound with `| 0` is exactly that shape
/// -- it breaks the connection `hir::bounds` needs and puts two checks back per
/// iteration -- so if this stops finding one, the test above has stopped
/// meaning anything and both need looking at rather than only this one.
#[test]
fn the_check_for_a_check_can_see_one() {
    let Some((module, _)) = rendered(
        "control",
        "export function total(xs: number[]): number {\n\
         const n = xs.length | 0;\n\
         let t = 0;\n\
         for (let i = 0; i < n; i++) { t = t + xs[i]; }\n\
         return t;\n}",
    ) else {
        eprintln!("SKIP: NTS_TSGO is not set to a built frontend");
        return;
    };
    let body: String = module
        .lines()
        .filter(|line| !line.starts_with("declare"))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        body.contains("@nts_check_fn") || body.contains("@nts_index_fn"),
        "the control found no check, so the test above proves nothing:\n{body}"
    );
}

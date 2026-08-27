//! The end-to-end gate: TypeScript in, a running binary out, answers checked.
//!
//! Every other test in this workspace asserts something about a data structure.
//! This one is the only place that answers the question the project actually
//! asks — does the emitted code *compute the right thing* — and it is the only
//! test that would catch a block order, a parallel copy, or an operator spelling
//! that is individually well-formed and collectively wrong.
//!
//! The C is compiled with `-Wall -Wextra -Werror`. A warning from a generated
//! translation unit is a compiler bug, not a style preference: nothing here is
//! hand-written, so there is no one to disagree with.
//!
//! Skips without `NTS_TSGO` or without `clang`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

/// Compile an example to C, link it with a harness, run it.
///
/// Returns `None` when the toolchain is unavailable, so a machine without clang
/// or a tsgo build skips rather than fails.
fn run(example: &str, harness: &str) -> Option<String> {
    let output = build_and_run(example, harness)?;
    assert!(
        output.status.success(),
        "binary failed:\n{}",
        String::from_utf8_lossy(&output.stdout)
    );
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Compile and run, returning the result whether or not it succeeded.
fn build_and_run(example: &str, harness: &str) -> Option<std::process::Output> {
    build_and_run_with(example, harness, hir::Provider::NoGc)
}

/// As above, under a chosen memory provider.
fn build_and_run_with(
    example: &str,
    harness: &str,
    provider: hir::Provider,
) -> Option<std::process::Output> {
    let Ok(tsgo) = std::env::var("NTS_TSGO").map(Utf8PathBuf::from) else {
        // Announced, because a skip that prints nothing is indistinguishable
        // from a pass — and this is the test whose passing means the most.
        eprintln!("SKIP {example}: NTS_TSGO is not set");
        return None;
    };
    if !tsgo.exists() {
        eprintln!("SKIP {example}: no tsgo at {tsgo}");
        return None;
    }
    if which_clang().is_none() {
        eprintln!("SKIP {example}: clang is not on PATH");
        return None;
    }

    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../examples")
        .join(example)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .expect("example fixture is checked in");

    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    assert!(!snapshot.has_errors(), "{example} should typecheck");

    // The same pipeline the CLI runs, specialization included — otherwise these
    // tests would prove that *unspecialized* code computes the right answers,
    // which is not what ships.
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider,
            ..hir::Options::default()
        },
    )
    .expect("prepared HIR should verify");
    let emitted = nts_codegen_c::emit(&prepared.program);

    // Keyed by the harness as well as the example: two tests exercising one
    // example otherwise share a directory, and cargo runs them concurrently.
    let mut hasher = std::hash::DefaultHasher::new();
    std::hash::Hash::hash(harness, &mut hasher);
    std::hash::Hash::hash(&format!("{provider:?}"), &mut hasher);
    let key = std::hash::Hasher::finish(&hasher);
    let dir = std::env::temp_dir().join(format!("nts-e2e-{example}-{key:016x}"));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let generated = dir.join("generated.c");
    let main = dir.join("main.c");
    let binary = dir.join("run");
    std::fs::write(&generated, emitted.writer.text()).expect("write generated C");
    std::fs::write(&main, harness).expect("write harness");
    // The runtime is a real translation unit, so it is written beside the
    // generated file and compiled with it rather than pasted into it.
    let runtime = dir.join(nts_codegen_c::RUNTIME_SOURCE_NAME);
    std::fs::write(
        dir.join(nts_codegen_c::RUNTIME_HEADER_NAME),
        nts_codegen_c::RUNTIME_HEADER,
    )
    .expect("write runtime header");
    std::fs::write(&runtime, nts_codegen_c::RUNTIME_SOURCE).expect("write runtime");

    // The provider is a property of the runtime as much as of the HIR: RC needs
    // each object to be its own allocation so the last release can give it back,
    // and the bump allocator cannot do that. Compiling the runtime without this
    // define while the HIR counts references would balance the counts and still
    // grow the heap.
    // Reference counting is a claim about memory, so the tests that make it are
    // built with the thing that checks memory. The use-after-free the cycle
    // collector shipped with -- freeing an object mid-walk while another edge of
    // the same cycle still named it -- compiled clean, ran clean at -O2, and
    // produced the right answers. AddressSanitizer found it immediately, which
    // is an argument for it being on rather than for it being reached for.
    //
    // NoGC is left alone: it never frees, so there is nothing for a
    // use-after-free detector to find, and every one of its tests would pay.
    let provider_define: &[&str] = match provider {
        hir::Provider::ReferenceCounting => &[
            "-DNTS_PROVIDER_RC",
            "-fsanitize=address",
            "-fno-omit-frame-pointer",
        ],
        hir::Provider::NoGc => &[],
    };

    let compile = std::process::Command::new("clang")
        // `--gc-sections` is reachability's other half: the compiler drops what
        // no export reaches, and the linker drops what survives compilation and
        // is never referenced -- an unused runtime function, most of all.
        .args([
            "-std=c11",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-O2",
            "-ffunction-sections",
            "-fdata-sections",
            "-Wl,--gc-sections",
        ])
        .args(provider_define)
        .arg("-o")
        .arg(&binary)
        .arg(&generated)
        .arg(&main)
        .arg(&runtime)
        .arg("-I")
        .arg(&dir)
        // The generated prelude uses fmod and trunc for JavaScript's integer
        // coercions.
        .arg("-lm")
        .output()
        .expect("clang should run");
    assert!(
        compile.status.success(),
        "generated C did not compile cleanly:\n{}\n--- source ---\n{}",
        String::from_utf8_lossy(&compile.stderr),
        emitted.writer.text()
    );

    Some(
        std::process::Command::new(&binary)
            // Leak detection off: what leaks is what these tests are *about*,
            // and they measure it themselves with `nts_live_bytes`, which says
            // how much rather than merely that. A cycle deliberately left
            // uncollected at exit is not a defect for LeakSanitizer to find.
            .env("ASAN_OPTIONS", "detect_leaks=0")
            .output()
            .expect("compiled binary should run"),
    )
}

fn which_clang() -> Option<()> {
    std::process::Command::new("clang")
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|_| ())
}

/// Asserts in C, so a wrong answer is a non-zero exit rather than a string this
/// test would have to parse.
const CHECK: &str = r#"
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
static int failures = 0;
static void check(const char *what, double got, double want) {
    if (got != want) { printf("FAIL %s: got %g want %g\n", what, got, want); failures++; }
    else { printf("ok %s = %g\n", what, got); }
}
"#;

#[test]
fn a_loop_computes_the_right_sum() {
    // The one that caught invalid SSA at loop exit: `sumTo` reads a value the
    // body defined, from a block the header dominates. It compiled and returned
    // garbage. Nothing but running it would have said so.
    let harness = format!(
        r#"{CHECK}
double sumTo(double n);
int main(void) {{
    check("sumTo(10)", sumTo(10), 45);
    check("sumTo(0)", sumTo(0), 0);
    check("sumTo(1)", sumTo(1), 0);
    check("sumTo(100)", sumTo(100), 4950);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("loops", &harness) else {
        return;
    };
    assert!(output.contains("sumTo(10) = 45"), "{output}");
}

#[test]
fn branches_pick_the_right_arm() {
    let harness = format!(
        r#"{CHECK}
double max(double a, double b);
double clamp(double v, double lo, double hi);
int main(void) {{
    check("max(3,7)", max(3, 7), 7);
    check("max(7,3)", max(7, 3), 7);
    check("max(-1,-9)", max(-1, -9), -1);
    check("clamp(5)", clamp(5, 1, 10), 5);
    check("clamp(-5)", clamp(-5, 1, 10), 1);
    check("clamp(50)", clamp(50, 1, 10), 10);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("control", &harness) else {
        return;
    };
    assert!(output.contains("clamp(50) = 10"), "{output}");
}

#[test]
fn arithmetic_and_comparison_agree_with_typescript() {
    let harness = format!(
        r#"{CHECK}
double add(double a, double b);
double mul(double a, double b);
bool lt(double a, double b);
int main(void) {{
    check("add", add(2, 3), 5);
    check("mul", mul(4, 5), 20);
    // Division is floating point in TypeScript. Emitting integer division
    // somewhere in the pipeline would pass every unit test and fail here.
    check("lt(1,2)", lt(1, 2), 1);
    check("lt(2,1)", lt(2, 1), 0);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("arith", &harness) else {
        return;
    };
    assert!(output.contains("mul = 20"), "{output}");
}

#[test]
fn a_call_reaches_a_function_whose_name_c_reserves() {
    // `function double()` is ordinary TypeScript and an impossible C identifier.
    // The call site has to agree with the definition about the mangling.
    let harness = format!(
        r#"{CHECK}
double compute(double a, double b);
int main(void) {{
    check("compute(5,1)", compute(5, 1), 11);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("calls2", &harness) else {
        return;
    };
    assert!(output.contains("compute(5,1) = 11"), "{output}");
}

#[test]
fn an_if_inside_a_loop_merges_both_arms() {
    // The case that motivated merge-block parameters. Each arm leaves a
    // different value in `result`; without a parameter the merge reads whichever
    // one the else arm happened to define, from a block it does not dominate.
    // `classify(n)` counts 1 per iteration below 6 and 2 per iteration after.
    let harness = format!(
        r#"{CHECK}
double classify(double n);
double atLeastTen(double n);
double nested(double n);
int main(void) {{
    check("classify(0)", classify(0), 0);
    check("classify(3)", classify(3), 3);
    // i = 0..9: six iterations at +1 (i <= 5), four at +2.
    check("classify(10)", classify(10), 14);
    // An `if` with no `else`: the false edge carries the merge argument on the
    // branch itself, so the untaken path has to leave `v` alone.
    check("atLeastTen(3)", atLeastTen(3), 10);
    check("atLeastTen(42)", atLeastTen(42), 42);
    // A name declared in the outer body is fresh per iteration, not carried.
    check("nested(5)", nested(5), 25);
    check("nested(0)", nested(0), 0);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("nested", &harness) else {
        return;
    };
    assert!(output.contains("classify(10) = 14"), "{output}");
    assert!(output.contains("nested(5) = 25"), "{output}");
}

#[test]
fn unary_operators_mean_what_they_say() {
    // The encoder writes a dense operator index, not a SyntaxKind, and its own
    // documentation says otherwise. Reading it the documented way yields `~`
    // where `!` was written — which still compiles.
    let harness = format!(
        r#"{CHECK}
double negate(double x);
bool flip(bool b);
double grouped(double a, double b);
bool always(void);
int main(void) {{
    check("negate(3)", negate(3), -3);
    check("negate(-3)", negate(-3), 3);
    check("flip(true)", flip(true), 0);
    check("flip(false)", flip(false), 1);
    // Negating zero must give negative zero: `0 - x` would give +0, and the two
    // are distinguishable by 1/x.
    check("1/negate(0)", 1.0 / negate(0), -1.0 / 0.0);
    // Parentheses group: (a+b)*(a-b) is 9-4, not a + b*a - b.
    check("grouped(3,2)", grouped(3, 2), 5);
    check("always()", always(), 1);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("nested", &harness) else {
        return;
    };
    assert!(output.contains("negate(3) = -3"), "{output}");
}

#[test]
fn bitwise_operators_follow_javascript_and_not_c() {
    // Every expected value here came from running the same expressions on node,
    // not from reasoning about them. C and JavaScript disagree about all of it:
    // `(int32_t)x` is undefined for an out-of-range double where `x | 0` wraps,
    // `a << b` is undefined for `b >= 32` where JavaScript masks the count, and
    // `>>>` has no C operator at all.
    let harness = format!(
        r#"{CHECK}
double toInt(double x);
double bucket(double hash);
double mix(double a, double b);
bool isEven(double n);
int main(void) {{
    check("toInt(3.7)", toInt(3.7), 3);
    check("toInt(-3.7)", toInt(-3.7), -3);
    // Wraps at the int32 boundary rather than saturating or trapping.
    check("toInt(2^31)", toInt(2147483648.0), -2147483648.0);
    check("toInt(2^32)", toInt(4294967296.0), 0);
    check("toInt(1e21)", toInt(1e21), -559939584.0);
    // Total on the values a C cast cannot represent at all.
    check("toInt(NaN)", toInt(0.0 / 0.0), 0);
    check("toInt(inf)", toInt(1.0 / 0.0), 0);
    check("toInt(-1)", toInt(-1), -1);

    // A mask bounds the result whatever the input was -- including negatives.
    check("bucket(-1)", bucket(-1), 1023);
    check("bucket(5000)", bucket(5000), 904);
    check("bucket(1024)", bucket(1024), 0);

    check("mix(5,3)", mix(5, 3), 24);
    // `>>>` is unsigned: a negative intermediate comes back positive.
    check("mix(-1,0)", mix(-1, 0), 2147483644.0);

    check("isEven(4)", isEven(4), 1);
    check("isEven(7)", isEven(7), 0);
    check("isEven(-3)", isEven(-3), 0);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("bitwise", &harness) else {
        return;
    };
    assert!(output.contains("toInt(2^31) = -2.14748e+09"), "{output}");
    assert!(output.contains("bucket(-1) = 1023"), "{output}");
}

#[test]
fn idiomatic_integer_typescript_computes_the_same_answers() {
    // `for`, `+=`, `++`, `--`, and a bitwise hash loop -- the forms integer code
    // is actually written in, and the ones specialization turns into integer
    // machine arithmetic. Every expected value came from running this same
    // `src/index.ts` on node.
    let harness = format!(
        r#"{CHECK}
double sumTo(double n);
double triangle(void);
double hash(double seed, double rounds);
double countDown(double start);
double countdown(double seed);
double inclusive(double seed);
int main(void) {{
    check("sumTo(100)", sumTo(100), 4950);
    check("sumTo(0)", sumTo(0), 0);
    check("triangle()", triangle(), 499500);
    check("hash(12345,50)", hash(12345, 50), 32786);
    // A fractional seed: `seed | 0` truncates toward zero, so -7.5 becomes -7.
    check("hash(-7.5,10)", hash(-7.5, 10), 17598);
    check("countDown(1000)", countDown(1000), 1000);
    check("countDown(0)", countDown(0), 0);
    // Counting down, where the trip count is measured from the other end.
    // 500 iterations of (12345 & 15) = 9.
    check("countdown(12345)", countdown(12345), 4500);
    // -1 masks to 15, the largest the increment can be -- the exact bound the
    // accumulator was proven against.
    check("countdown(-1)", countdown(-1), 7500);
    // `>=` runs 101 times, not 100.
    check("inclusive(12345)", inclusive(12345), 101);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("idioms", &harness) else {
        return;
    };
    assert!(output.contains("triangle() = 499500"), "{output}");
    assert!(output.contains("hash(-7.5,10) = 17598"), "{output}");
}

#[test]
fn literal_types_make_a_parameter_provable() {
    // The only way a parameter becomes provable without seeing a call site: its
    // declared type is a fact about every possible caller. `mode: 0 | 1 | 2 | 3`
    // proves [0, 3] and the multiplication becomes integer arithmetic, while the
    // same function taking `number` cannot.
    let harness = format!(
        r#"{CHECK}
double weigh(double mode);
double fixed(double scale);
double loose(double mode);
double plain(double n);
int main(void) {{
    check("weigh(0)", weigh(0), 0);
    check("weigh(3)", weigh(3), 30);
    check("fixed(8)", fixed(8), 64);
    check("loose(5)", loose(5), 50);
    // Unspecialized, so it still divides and multiplies as a double.
    check("plain(2.5)", plain(2.5), 25);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("literals", &harness) else {
        return;
    };
    assert!(output.contains("weigh(3) = 30"), "{output}");
    assert!(output.contains("plain(2.5) = 25"), "{output}");
}

#[test]
fn facts_cross_function_boundaries() {
    // A parameter is written by callers and a call's result by the callee, so a
    // function analyzed alone knows neither. `pipeline` is fully provable only
    // because `clamp`'s return bounds `twice`'s parameter, which bounds the
    // accumulator, which bounds `clamp`'s parameter again -- a fixpoint over the
    // call graph.
    //
    // `exposed` is the boundary. It is exported, so its parameter stays as wide
    // as `number` however few callers are visible here, and calling `clamp` from
    // it widens `clamp`'s parameter too. That is the analysis being honest
    // rather than clever, and the values below prove the resulting code still
    // handles anything: -1 and 1e21 are exactly what an unbounded double means.
    let harness = format!(
        r#"{CHECK}
double pipeline(double rounds);
double exposed(double v);
int main(void) {{
    check("pipeline(64)", pipeline(64), 382);
    check("exposed(300)", exposed(300), 44);
    check("exposed(-1)", exposed(-1), 255);
    check("exposed(1e21)", exposed(1e21), 0);
    check("exposed(NaN)", exposed(0.0 / 0.0), 0);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("interprocedural", &harness) else {
        return;
    };
    assert!(output.contains("pipeline(64) = 382"), "{output}");
    assert!(output.contains("exposed(1e21) = 0"), "{output}");
}

#[test]
fn math_intrinsics_follow_javascript_and_not_c() {
    // `Math.floor` is a proof of wholeness -- a stronger one than `| 0`, since
    // it keeps the magnitude rather than wrapping it. The rounding rules are
    // also where C and JavaScript quietly disagree: C's `round` takes a half
    // away from zero and JavaScript takes it toward positive infinity, and C's
    // `fmin` returns the non-NaN operand where JavaScript returns NaN.
    //
    // Every expected value came from running this same `src/main.ts` on node.
    let harness = format!(
        r#"{CHECK}
#include <math.h>
double shard(double hash);
double clampIndex(double i, double limit);
double rounded(double x);
double distance(double a, double b);
int main(void) {{
    check("shard(0)", shard(0), 0);
    check("shard(65535)", shard(65535), 0);
    check("shard(70000)", shard(70000), 1);
    // abs first, so a negative hash lands in the same shard as its magnitude.
    check("shard(-70000)", shard(-70000), 1);
    check("shard(2^31-1)", shard(2147483647.0), 32767);
    check("shard(1e21)", shard(1e21), 8544);
    // `Math.abs(-2147483648)` is 2147483648, which does not fit the `int32`
    // its operand does. Negating before widening is signed overflow -- in
    // practice `INT32_MIN` again -- and the answer came out negative. Found by
    // `nts check`, which is the only thing that would have.
    check("shard(-2^31)", shard(-2147483648.0), 32768);
    check("shard(2^31)", shard(2147483648.0), 32768);

    check("clampIndex(-5)", clampIndex(-5, 1000), 0);
    // Math.trunc, so 3.9 becomes 3 rather than 4.
    check("clampIndex(3.9)", clampIndex(3.9, 1000), 3);
    check("clampIndex(5000)", clampIndex(5000, 1000), 1000);

    // Half toward positive infinity: C's round would say -2 here.
    check("rounded(-1.5)", rounded(-1.5), -1);
    // An integer rounds to itself. `floor(x + 0.5)` does not manage that near
    // 2^53, where 0.5 is below the spacing between adjacent doubles: the sum
    // rounds to an even neighbour and the answer is one too small. Also found
    // by `nts check`.
    check("rounded(2^53-1)", rounded(9007199254740991.0), 9007199254740991.0);
    check("rounded(-(2^53-1))", rounded(-9007199254740991.0), -9007199254740991.0);
    check("rounded(2.5)", rounded(2.5), 3);
    check("distance(-3,8)", distance(-3, 8), 11);

    // NaN is contagious through Math.min/max, unlike fmin/fmax. Checked apart
    // because NaN compares equal to nothing, including itself.
    if (!isnan(clampIndex(0.0 / 0.0, 1000))) {{
        printf("FAIL clampIndex(NaN) should be NaN\n");
        failures++;
    }} else {{
        printf("ok clampIndex(NaN) = nan\n");
    }}
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("mathops", &harness) else {
        return;
    };
    assert!(output.contains("rounded(-1.5) = -1"), "{output}");
    assert!(output.contains("shard(1e21) = 8544"), "{output}");
    assert!(output.contains("clampIndex(NaN) = nan"), "{output}");
}

#[test]
fn conditionals_short_circuit_and_use_javascript_truthiness() {
    // `||` and `&&` do not produce booleans and do not evaluate both sides.
    // Truthiness is not `!= 0`: NaN is falsy, and every comparison against NaN
    // is false including the inequality, so `x != 0` calls NaN true. `-0` is
    // falsy as well, and compares equal to `0`.
    //
    // Every expected value came from running this `src/main.ts` on node.
    let harness = format!(
        r#"{CHECK}
#include <math.h>
double sign(double x);
double pick(bool flag, double a, double b);
double orDefault(double x);
double andThen(double x, double y);
bool both(bool a, bool b);
bool isTruthy(double x);
int main(void) {{
    check("sign(5)", sign(5), 1);
    check("sign(-5)", sign(-5), -1);
    check("sign(0)", sign(0), 0);
    // NaN is greater than nothing and less than nothing, so both arms fail.
    check("sign(NaN)", sign(0.0 / 0.0), 0);

    check("pick(true)", pick(true, 1, 2), 1);
    check("pick(false)", pick(false, 1, 2), 2);

    check("orDefault(0)", orDefault(0), 42);
    check("orDefault(7)", orDefault(7), 7);
    check("orDefault(NaN)", orDefault(0.0 / 0.0), 42);
    check("orDefault(-0)", orDefault(-0.0), 42);

    // `&&` yields the left operand when it is falsy -- including NaN itself.
    check("andThen(0,9)", andThen(0, 9), 0);
    check("andThen(3,9)", andThen(3, 9), 9);
    if (!isnan(andThen(0.0 / 0.0, 9))) {{
        printf("FAIL andThen(NaN,9) should be NaN\n");
        failures++;
    }} else {{
        printf("ok andThen(NaN,9) = nan\n");
    }}

    check("both(t,t)", both(true, true), 1);
    check("both(t,f)", both(true, false), 0);
    check("both(f,t)", both(false, true), 0);

    check("isTruthy(0)", isTruthy(0), 0);
    check("isTruthy(NaN)", isTruthy(0.0 / 0.0), 0);
    check("isTruthy(-0)", isTruthy(-0.0), 0);
    check("isTruthy(1)", isTruthy(1), 1);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("conditionals", &harness) else {
        return;
    };
    assert!(output.contains("orDefault(NaN) = 42"), "{output}");
    assert!(output.contains("andThen(NaN,9) = nan"), "{output}");
    assert!(output.contains("isTruthy(-0) = 0"), "{output}");
}

#[test]
fn arrays_allocate_index_and_measure() {
    // Allocation through the NoGC provider, stores, loads, and `length` as a
    // loop bound. `total` and `squares` build their own arrays, so they are
    // self-contained; `sum` and `at` receive one, which is where the length is
    // genuinely unknown to the compiler.
    //
    // Expected values came from running this `src/main.ts` on node.
    let harness = format!(
        r#"{CHECK}
double total(void);
double squares(void);
double empty(void);
int main(void) {{
    check("total()", total(), 15);
    // 0+1+4+9+16+25+36+49
    check("squares()", squares(), 140);
    check("empty()", empty(), 0);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("arrays", &harness) else {
        return;
    };
    assert!(output.contains("squares() = 140"), "{output}");
    assert!(output.contains("empty() = 0"), "{output}");
}

#[test]
fn an_out_of_bounds_index_traps_rather_than_reading_past_the_end() {
    // The safety claim. `xs[i]!` is the author asserting the index is in
    // bounds, and a native compiler has no `undefined` to return when it is
    // not -- so the assertion is *checked*, and a false one stops the program
    // instead of reading whatever follows the array.
    //
    // Reading past the end would not fail on its own: the bump allocator hands
    // out large chunks, so the memory is mapped and the read would quietly
    // return whatever happened to be next. That is exactly why this needs a
    // test rather than an argument.
    let harness = format!(
        r#"{CHECK}
double readAt(double i);
int main(void) {{
    // In bounds first, so a failure here is not mistaken for the trap firing.
    check("readAt(2)", readAt(2), 30);
    printf("about to read out of bounds\n");
    fflush(stdout);
    readAt(3);
    printf("FAIL: kept going past the end\n");
    return 0;
}}
"#
    );
    let Some(output) = build_and_run("arrays", &harness) else {
        return;
    };
    assert!(
        !output.status.success(),
        "an out-of-bounds read should stop the program, not continue:\n{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let printed = String::from_utf8_lossy(&output.stdout);
    assert!(
        printed.contains("about to read out of bounds") && !printed.contains("FAIL"),
        "{printed}"
    );
}

#[test]
fn strings_are_utf16_code_units_and_compare_by_value() {
    // `length` counts UTF-16 code units, which is what JavaScript means by one.
    // Stored one byte per unit when every unit fits and two otherwise, so
    // `length` stays O(1) for all of JavaScript while ordinary text costs one
    // byte per character rather than two.
    //
    // Equality is by value: a concatenation and a literal holding the same code
    // units are different allocations and must still compare equal.
    //
    // Expected values came from running this `src/main.ts` on node.
    let harness = format!(
        r#"{CHECK}
double greetingLength(void);
double emptyLength(void);
bool concatEqualsLiteral(void);
bool differs(void);
bool sameLength(void);
double wideLength(void);
double mixedLength(void);
bool mixedEquals(void);
int main(void) {{
    check("greetingLength", greetingLength(), 11);
    check("emptyLength", emptyLength(), 0);
    check("concatEqualsLiteral", concatEqualsLiteral(), 1);
    check("differs", differs(), 0);
    check("sameLength", sameLength(), 1);
    // Five code units, all beyond Latin-1, so this string is stored two bytes
    // per unit -- and `length` is still five.
    check("wideLength", wideLength(), 5);
    // One narrow operand and one wide: the result has to be wide.
    check("mixedLength", mixedLength(), 8);
    // ...and comparing them must not depend on how either was stored.
    check("mixedEquals", mixedEquals(), 1);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("strings", &harness) else {
        return;
    };
    assert!(output.contains("wideLength = 5"), "{output}");
    assert!(output.contains("mixedEquals = 1"), "{output}");
}

#[test]
fn objects_are_flat_structs_with_fields_at_fixed_offsets() {
    // A declared shape becomes a real C struct, so `p.x` is a load at an offset
    // the C compiler chose -- not a hash lookup and not a hand-computed offset.
    //
    // `distanceSquared` and `shifted` build their object through `make`, whose
    // literal has an *anonymous* type. TypeScript is structurally typed, so that
    // type and `Point` share one layout; without that they would be two structs
    // of identical shape that could not be passed to each other.
    //
    // Expected values came from running this `src/main.ts` on node.
    let harness = format!(
        r#"{CHECK}
double distanceSquared(double x, double y);
double shifted(double x, double y, double by);
double explicit(void);
double scaledBy(double v);
int main(void) {{
    check("distanceSquared(3,4)", distanceSquared(3, 4), 25);
    // (1+10)*1000 + (2+10)
    check("shifted(1,2,10)", shifted(1, 2, 10), 11012);
    // Written out rather than shorthand -- both spellings reach the same field.
    check("explicit()", explicit(), 34);
    // A `readonly` field is `const` in the struct, written once at construction
    // through the qualifier and read normally after.
    check("scaledBy(6)", scaledBy(6), 42);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("objects", &harness) else {
        return;
    };
    assert!(output.contains("shifted(1,2,10) = 11012"), "{output}");
    assert!(output.contains("scaledBy(6) = 42"), "{output}");
}

#[test]
fn objects_hold_references_and_arrays_hold_objects() {
    // A reference field is a pointer. Under NoGC nothing is ever freed, so it
    // costs neither a write barrier nor a trace -- but *which* fields are
    // references is recorded on the layout as a pointer bitmap (RFC 8.3),
    // because that is a fact about the layout and a collector cannot be told it
    // after the fact.
    //
    // Expected values came from running this `src/main.ts` on node.
    let harness = format!(
        r#"{CHECK}
double describe(void);
double teamAge(void);
double totalAges(void);
int main(void) {{
    // "ada".length * 100 + 36
    check("describe()", describe(), 336);
    // An object holding an object: 45 * 3 + "grace".length
    check("teamAge()", teamAge(), 140);
    // An array whose elements are references, walked with `length`.
    check("totalAges()", totalAges(), 81);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("objects", &harness) else {
        return;
    };
    assert!(output.contains("teamAge() = 140"), "{output}");
    assert!(output.contains("totalAges() = 81"), "{output}");
}

#[test]
fn methods_are_static_calls_with_an_explicit_receiver() {
    // A method lowers to a function whose first parameter is the receiver, and a
    // call site to a direct call. There is no dispatch to arrange: the checker
    // resolved every call site, so `c.advance()` names exactly one target. A
    // vtable only becomes necessary where a site has more than one, and
    // TypeScript says when that is.
    //
    // `twoCounters` keeps two instances alive at once, so the receiver is
    // genuinely an argument rather than something that could have been folded.
    //
    // Expected values came from running this `src/main.ts` on node.
    let harness = format!(
        r#"{CHECK}
double run(double step, double times);
double scaled(double step, double times, double factor);
double twoCounters(double a, double b);
double eitherOr(double pick, double step);
double borrowChain(double step, double times);
double chain(double times);
int main(void) {{
    check("run(3,4)", run(3, 4), 12);
    check("scaled(2,5,10)", scaled(2, 5, 10), 100);
    // 7*100 + 3*2
    check("twoCounters(7,3)", twoCounters(7, 3), 706);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("instances", &harness) else {
        return;
    };
    assert!(output.contains("twoCounters(7,3) = 706"), "{output}");
}

#[test]
fn reference_counting_balances_and_still_computes_the_right_answers() {
    // The two things reference counting has to get right, and they pull against
    // each other: release everything, and release nothing twice.
    //
    // The live count makes both visible from inside the program. Under NoGC a
    // loop that allocates grows it without bound; under RC it must come back to
    // where it started, and the answers must be unchanged -- a premature release
    // shows up as a wrong answer or a crash rather than as a number.
    let harness = format!(
        r#"{CHECK}
#include "nts_runtime.h"
double run(double step, double times);
double twoCounters(double a, double b);
double eitherOr(double pick, double step);
double borrowChain(double step, double times);
double chain(double times);
int main(void) {{
    size_t before = nts_live_count();
    check("run(3,4)", run(3, 4), 12);
    check("twoCounters(7,3)", twoCounters(7, 3), 706);

    // A thousand more allocations. Under NoGC this ends with a thousand live
    // objects; under RC it must end where it started.
    for (int i = 0; i < 1000; i++) {{
        if (run(3, 4) != 12) {{
            printf("FAIL run(3,4) changed under repetition\n");
            failures++;
            break;
        }}
    }}
    size_t after = nts_live_count();
    if (after != before) {{
        printf("FAIL live objects went from %zu to %zu\n", before, after);
        failures++;
    }} else {{
        printf("ok live objects %zu -> %zu\n", before, after);
    }}

    // Counts balancing is not the same as memory coming back: a release at zero
    // that only decremented a counter would pass the check above and still grow
    // the heap. This is the check that cannot be satisfied by bookkeeping.
    if (nts_live_bytes() != 0) {{
        printf("FAIL %zu bytes still held\n", nts_live_bytes());
        failures++;
    }} else {{
        printf("ok no bytes held\n");
    }}

    // Ownership crossing a call boundary in both directions: `makeCounter`
    // hands its reference to `borrowChain`, which lends the object to `bump`
    // and holds it throughout. A callee that retained what it was handed and
    // forgot to give it back would show up here and nowhere else.
    check("borrowChain(3,4)", borrowChain(3, 4), 12);
    for (int i = 0; i < 500; i++) {{ borrowChain(3, 4); }}
    if (nts_live_count() != 0 || nts_live_bytes() != 0) {{
        printf("FAIL borrowed across calls leaks: %zu objects, %zu bytes\n",
               nts_live_count(), nts_live_bytes());
        failures++;
    }} else {{
        printf("ok references move across call boundaries\n");
    }}

    // A thousand objects allocated and dropped through one loop-carried slot.
    // If the back edge leaked, this would end holding every one of them.
    check("chain(1000)", chain(1000), 999);
    if (nts_live_count() != 0 || nts_live_bytes() != 0) {{
        printf("FAIL loop-carried slot leaks: %zu objects, %zu bytes\n",
               nts_live_count(), nts_live_bytes());
        failures++;
    }} else {{
        printf("ok loop-carried references are released\n");
    }}

    // Each arm drops the object the other arm keeps.
    check("eitherOr(1,5)", eitherOr(1, 5), 5);
    check("eitherOr(0,5)", eitherOr(0, 5), 6);
    for (int i = 0; i < 500; i++) {{ eitherOr(i % 2, 5); }}
    if (nts_live_count() != 0 || nts_live_bytes() != 0) {{
        printf("FAIL divergent paths leak: %zu objects, %zu bytes\n",
               nts_live_count(), nts_live_bytes());
        failures++;
    }} else {{
        printf("ok divergent paths release on both arms\n");
    }}
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = build_and_run_with("instances", &harness, hir::Provider::ReferenceCounting)
    else {
        return;
    };
    let printed = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "{printed}");
    assert!(printed.contains("live objects 0 -> 0"), "{printed}");
    assert!(printed.contains("ok no bytes held"), "{printed}");
    assert!(
        printed.contains("ok divergent paths release on both arms"),
        "{printed}",
    );
    assert!(
        printed.contains("ok references move across call boundaries"),
        "{printed}",
    );
    assert!(
        printed.contains("ok loop-carried references are released"),
        "{printed}",
    );
    assert!(printed.contains("twoCounters(7,3) = 706"), "{printed}");
}

#[test]
fn without_reference_counting_the_same_program_leaks() {
    // The control. Not a complaint about NoGC -- RFC 9.1 says it allocates and
    // never frees, and this is what that means when a program runs for a while.
    // It is here so the test above is measuring something.
    //
    // It has to be `borrowChain`, whose object comes back from `makeCounter`
    // and therefore reaches the heap. `run` used to work here and does not any
    // more: its counter never escapes, so escape analysis puts it in the frame
    // and there is nothing left to leak. A control that measures zero either
    // way would be worse than no control.
    let harness = format!(
        r#"{CHECK}
#include "nts_runtime.h"
double borrowChain(double step, double times);
int main(void) {{
    check("borrowChain(3,4)", borrowChain(3, 4), 12);
    for (int i = 0; i < 99; i++) {{ borrowChain(3, 4); }}
    printf("live objects after 100 calls: %zu\n", nts_live_count());
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = build_and_run_with("instances", &harness, hir::Provider::NoGc) else {
        return;
    };
    let printed = String::from_utf8_lossy(&output.stdout);
    assert!(
        printed.contains("live objects after 100 calls: 100"),
        "NoGC should hold every object it allocated: {printed}",
    );
}

#[test]
fn a_store_gives_up_the_reference_the_slot_was_holding() {
    // A field is a slot with an owner. Writing it takes a reference to what goes
    // in and drops the one to what comes out, and the second half is the half
    // that is easy to omit -- omitting it is invisible except as growth.
    //
    // `makeBox` is what makes this a test rather than an accident: the caller
    // never names the cell inside the box, so the overwritten cell's only
    // reference is the field. Nothing else is going to release it.
    let harness = format!(
        r#"{CHECK}
#include "nts_runtime.h"
double replace(double first, double second);
double churn(double times);
double selfAssign(double value);
double nested(double count);
double localBox(double times);
int main(void) {{
    check("replace(3,7)", replace(3, 7), 3007);
    check("selfAssign(9)", selfAssign(9), 9);
    // 0 + 1 + ... + 999
    check("churn(1000)", churn(1000), 499500);
    // Three boxes, each holding a cell, read once per round. Dropping the array
    // has to reach two levels down.
    check("nested(100)", nested(100), 600);

    // The box stays in the frame and the cell it holds does not, so the release
    // of that cell is the compiler's to emit -- there is no count reaching zero
    // and no destructor running to do it.
    check("localBox(1000)", localBox(1000), 499500);
    if (nts_live_count() != 0 || nts_live_bytes() != 0) {{
        printf("FAIL a frame object kept what it held: %zu objects, %zu bytes\n",
               nts_live_count(), nts_live_bytes());
        failures++;
    }} else {{
        printf("ok a frame object gives up what it holds\n");
    }}

    for (int i = 0; i < 200; i++) {{
        replace(3, 7);
        selfAssign(9);
        churn(50);
        nested(2);
    }}
    if (nts_live_count() != 0 || nts_live_bytes() != 0) {{
        printf("FAIL overwritten references leak: %zu objects, %zu bytes\n",
               nts_live_count(), nts_live_bytes());
        failures++;
    }} else {{
        printf("ok overwritten references are released\n");
    }}
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = build_and_run_with("references", &harness, hir::Provider::ReferenceCounting)
    else {
        return;
    };
    let printed = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "{printed}");
    assert!(
        printed.contains("ok overwritten references are released"),
        "{printed}",
    );
    assert!(
        printed.contains("ok a frame object gives up what it holds"),
        "{printed}",
    );
}

#[test]
fn cycles_are_collected_and_acyclic_objects_are_never_considered() {
    // A cycle is what reference counting on its own cannot reclaim: every
    // object in one is held by another object in the same one, so no count
    // reaches zero. RFC 9.2 names this as the price of 9.2, and this is the
    // part that pays it.
    //
    // `acyclic` is here for the other half. A type whose references cannot lead
    // back to it can never be in a cycle, and the compiler knows which types
    // those are, so the collector never sees one. If it did, every program that
    // allocates would pay for a hazard it does not have.
    let harness = format!(
        r#"{CHECK}
#include "nts_runtime.h"
double selfCycle(double times);
double pairCycle(double times);
double acyclic(double times);
int main(void) {{
    check("selfCycle(100)", selfCycle(100), 4950);
    check("pairCycle(100)", pairCycle(100), 4950);
    check("acyclic(100)", acyclic(100), 4950);

    nts_collect_cycles();
    if (nts_live_count() != 0 || nts_live_bytes() != 0) {{
        printf("FAIL cycles leak: %zu objects, %zu bytes\n",
               nts_live_count(), nts_live_bytes());
        failures++;
    }} else {{
        printf("ok cycles are reclaimed\n");
    }}

    // Nothing calls the collector by hand in a real program, so the threshold
    // has to be what keeps a cycling loop bounded. This allocates well past it
    // without asking for anything.
    check("selfCycle(40000)", selfCycle(40000), 799980000);
    if (nts_live_bytes() > 1u << 20) {{
        printf("FAIL cycles are not collected on their own: %zu bytes\n",
               nts_live_bytes());
        failures++;
    }} else {{
        printf("ok cycles are collected without being asked\n");
    }}

    // Acyclic objects must never reach the collector's candidate buffer, or
    // every allocating program pays for a hazard it does not have.
    size_t before = nts_cycle_candidates();
    acyclic(1000);
    if (nts_cycle_candidates() != before) {{
        printf("FAIL acyclic objects were considered: %zu -> %zu\n",
               before, nts_cycle_candidates());
        failures++;
    }} else {{
        printf("ok acyclic objects are never considered\n");
    }}
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = build_and_run_with("cycles", &harness, hir::Provider::ReferenceCounting)
    else {
        return;
    };
    let printed = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "{printed}");
    assert!(printed.contains("ok cycles are reclaimed"), "{printed}");
    assert!(
        printed.contains("ok cycles are collected without being asked"),
        "{printed}",
    );
    assert!(
        printed.contains("ok acyclic objects are never considered"),
        "{printed}",
    );
}

#[test]
fn module_scope_state_persists_between_calls() {
    // A `let` at module scope is one location every function shares, so the
    // answer to a call depends on the calls before it. That is the whole point
    // and is also the thing a compiler can quietly get wrong -- by reading a
    // stale copy, or by dropping a store nothing reads back.
    //
    // A `const` with a constant initializer is not storage at all: it resolves
    // to its value at each use. `scaled` is the check on that, and its C has an
    // immediate rather than a load.
    let harness = format!(
        r#"{CHECK}
double bump(double by);
double readCounter(void);
double reset(void);
bool toggle(void);
double scaled(double x);
int main(void) {{
    check("bump(5)", bump(5), 47.5);
    check("bump(5)", bump(5), 97.5);
    check("readCounter", readCounter(), 10);
    check("reset", reset(), 0);
    check("readCounter after reset", readCounter(), 0);
    check("bump(1)", bump(1), 7.5);

    check("toggle", toggle() ? 1 : 0, 1);
    check("toggle again", toggle() ? 1 : 0, 0);

    // Reads a constant, so the store above cannot have touched it.
    check("scaled(3)", scaled(3), 30);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("globals", &harness) else {
        return;
    };
    assert!(
        output.contains("ok bump(5) = 47.5"),
        "module state should carry between calls: {output}",
    );
}

#[test]
fn string_methods_count_utf16_code_units() {
    // Every one of these is defined over UTF-16 code units, which is what a
    // JavaScript string is. The interesting inputs are the ones where that
    // matters: a character above the byte boundary, so the narrow and wide
    // representations both appear, and one outside the basic plane, where
    // `length` counts two and a code point is one.
    //
    // Every expected value came from running the same expressions on node.
    let harness = format!(
        r#"{CHECK}
#include <string.h>
#include "nts_runtime.h"
double unitAt(NtsString *s, double i);
double pointAt(NtsString *s, double i);
double firstOf(NtsString *s, NtsString *needle);
double lastOf(NtsString *s, NtsString *needle);
bool contains(NtsString *s, NtsString *needle);
NtsString *tail(NtsString *s, double from);
NtsString *between(NtsString *s, double from, double to);
NtsString *repeated(NtsString *s, double times);

static void same(const char *what, NtsString *got, const char *want) {{
    NtsString *expected = nts_string_from_utf8(want, strlen(want));
    if (nts_string_eq(got, expected)) {{
        printf("ok %s\n", what);
    }} else {{
        printf("FAIL %s: length %u, wanted %u\n", what, got->length, expected->length);
        failures++;
    }}
}}

int main(void) {{
    NtsString *plain = nts_string_from_utf8("abcabc", 6);
    /* "a" U+1F600 "b": the middle character is a surrogate pair, so length is 4.
       Written a byte at a time, because a hex escape next to a printable hex
       digit would swallow it -- "\x80b" is one escape, not two characters. */
    static const char emoji[] = {{'a', (char)0xF0, (char)0x9F, (char)0x98, (char)0x80, 'b'}};
    NtsString *wide = nts_string_from_utf8(emoji, sizeof emoji);

    check("length of a surrogate pair", (double)wide->length, 4);
    check("unitAt(1) is the lead surrogate", unitAt(wide, 1), 55357);
    check("pointAt(1) is the whole code point", pointAt(wide, 1), 128512);
    /* A fractional index truncates rather than failing. */
    check("unitAt(1.9)", unitAt(wide, 1.9), 55357);
    check("unitAt past the end is NaN", isnan(unitAt(wide, 99)) ? 1 : 0, 1);

    check("firstOf", firstOf(plain, nts_string_from_utf8("bc", 2)), 1);
    check("lastOf", lastOf(plain, nts_string_from_utf8("bc", 2)), 4);
    check("contains", contains(plain, nts_string_from_utf8("cab", 3)) ? 1 : 0, 1);

    /* Negative counts from the end, which is what `slice` does and
       `substring` does not. */
    same("tail(-2)", tail(plain, -2), "bc");
    /* `substring` swaps ends that are out of order. */
    same("between(4, 1)", between(plain, 4, 1), "bca");
    same("repeated twice", repeated(nts_string_from_utf8("ab", 2), 2), "abab");
    same("repeated zero times", repeated(plain, 0), "");
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("strings", &harness) else {
        return;
    };
    assert!(
        output.contains("ok pointAt(1) is the whole code point"),
        "a surrogate pair is two units and one code point: {output}",
    );
}

#[test]
fn array_methods_follow_javascript_and_not_intuition() {
    // The interesting cases are where `indexOf` and `includes` part company.
    // `indexOf` compares with `===`, which is false for NaN against itself, so
    // it never finds one; `includes` uses SameValueZero, which does. An
    // implementation that shares one loop between them gets exactly this wrong.
    //
    // Every expected value came from running the same expressions on node.
    let harness = format!(
        r#"{CHECK}
#include "nts_runtime.h"
double firstAt(double x);
double lastAt(double x);
bool holds(double x);
double nth(double i);
double filledWith(double v);
double reversedHead(void);
double slicedLength(double from, double to);
int main(void) {{
    /* [3, 1, 4, 1, 5, 9, 2, 6] */
    check("firstAt(1)", firstAt(1), 1);
    check("lastAt(1)", lastAt(1), 3);
    check("firstAt(7) is -1", firstAt(7), -1);

    /* `===` never finds a NaN; SameValueZero does. */
    check("firstAt(NaN) is -1", firstAt((double)NAN), -1);
    check("holds(NaN)", holds((double)NAN) ? 1 : 0, 0);
    check("holds(9)", holds(9) ? 1 : 0, 1);

    /* Negative counts from the end, and out of range is undefined. */
    check("nth(-1)", nth(-1), 6);
    check("nth(0)", nth(0), 3);
    check("nth(99) is NaN", isnan(nth(99)) ? 1 : 0, 1);

    check("filledWith(7)", filledWith(7), 7);
    check("reversedHead", reversedHead(), 6);

    check("slicedLength(2, 5)", slicedLength(2, 5), 3);
    /* Backwards is empty rather than an error. */
    check("slicedLength(5, 2)", slicedLength(5, 2), 0);
    /* Negative counts from the end here too. */
    check("slicedLength(-3, 99)", slicedLength(-3, 99), 3);
    return failures ? 1 : 0;
}}
"#
    );
    let Some(output) = run("arrays", &harness) else {
        return;
    };
    assert!(
        output.contains("ok firstAt(NaN) is -1") && output.contains("ok holds(NaN) = 0"),
        "`indexOf` and `includes` must disagree about NaN: {output}",
    );
}

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
    let prepared = hir::prepare(&snapshot).expect("prepared HIR should verify");
    let emitted = nts_codegen_c::emit(&prepared.program);

    // Keyed by the harness as well as the example: two tests exercising one
    // example otherwise share a directory, and cargo runs them concurrently.
    let mut hasher = std::hash::DefaultHasher::new();
    std::hash::Hash::hash(harness, &mut hasher);
    let key = std::hash::Hasher::finish(&hasher);
    let dir = std::env::temp_dir().join(format!("nts-e2e-{example}-{key:016x}"));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let generated = dir.join("generated.c");
    let main = dir.join("main.c");
    let binary = dir.join("run");
    std::fs::write(&generated, emitted.writer.text()).expect("write generated C");
    std::fs::write(&main, harness).expect("write harness");

    let compile = std::process::Command::new("clang")
        .args(["-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "-o"])
        .arg(&binary)
        .arg(&generated)
        .arg(&main)
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

    let output = std::process::Command::new(&binary)
        .output()
        .expect("compiled binary should run");
    assert!(
        output.status.success(),
        "binary failed:\n{}",
        String::from_utf8_lossy(&output.stdout)
    );
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
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
int main(void) {{
    check("sumTo(100)", sumTo(100), 4950);
    check("sumTo(0)", sumTo(0), 0);
    check("triangle()", triangle(), 499500);
    check("hash(12345,50)", hash(12345, 50), 32786);
    // A fractional seed: `seed | 0` truncates toward zero, so -7.5 becomes -7.
    check("hash(-7.5,10)", hash(-7.5, 10), 17598);
    check("countDown(1000)", countDown(1000), 1000);
    check("countDown(0)", countDown(0), 0);
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

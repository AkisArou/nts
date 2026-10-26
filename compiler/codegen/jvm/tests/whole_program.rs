//! A compiled program run whole on the JVM, through `nts.rt.NtsMain`: the
//! module initializer, then the event loop to quiescence.
//!
//! Before the launcher nothing on this lane ran a program as a program --
//! the emitted `Program` has `module$init()` and no `main`, and every other
//! test here drives exported functions -- so whatever only a whole program
//! shows was invisible to every instrument. These pin the three ways a run
//! ends, each against the exit status the C lane gives: 0 for a clean run, 1
//! for an uncaught throw, 134 (C's `abort`) for a run-time refusal.

use std::process::Command;

use camino::Utf8PathBuf;
use nts_frontend_ts::Frontend;

mod common;

/// Compile `source` as a one-file program, run it through the launcher, and
/// return `(status, stdout, stderr)`.
fn run_whole(name: &str, source: &str) -> Option<(i32, String, String)> {
    run_whole_file(name, "main.ts", source)
}

/// `run_whole` for a JavaScript script, compiled as test262's cases are
/// (`allowJs`, unchecked): a top-level `var` is hoisted, and erased.
fn run_whole_script(name: &str, source: &str) -> Option<(i32, String, String)> {
    run_whole_file(name, "main.js", source)
}

fn run_whole_file(name: &str, file: &str, source: &str) -> Option<(i32, String, String)> {
    let Some(java) = common::tool("java") else {
        eprintln!("SKIP whole_program/{name}: no JDK");
        return None;
    };
    let dir = std::env::temp_dir().join(format!("nts-whole-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("src")).expect("a temp dir");
    let fixtures = common::repository().join("tsconfig.fixtures.json");
    let script = if std::path::Path::new(file)
        .extension()
        .is_some_and(|it| it.eq_ignore_ascii_case("js"))
    {
        ", \"compilerOptions\": {\"allowJs\": true, \"checkJs\": false}"
    } else {
        ""
    };
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            "{{\"extends\": {:?}{script}, \"include\": [\"src\"]}}\n",
            fixtures.display().to_string()
        ),
    )
    .expect("write tsconfig");
    std::fs::write(dir.join("src").join(file), source).expect("write the program");

    let tsconfig = Utf8PathBuf::from_path_buf(dir.join("tsconfig.json")).expect("a UTF-8 path");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot");
    assert!(
        !snapshot.has_errors(),
        "{name} should typecheck: {:?}",
        snapshot.diagnostics
    );
    let prepared = common::prepare(&snapshot).expect("prepared HIR should verify");
    let emitted = nts_codegen_jvm::emit(&prepared.program);

    let out = dir.join("out");
    for class in &emitted.classes {
        let path = out.join(class.path());
        std::fs::create_dir_all(path.parent().expect("a class has a package")).expect("mkdir");
        std::fs::write(&path, &class.bytes).expect("write a class");
    }
    let jar = out.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).expect("write the jar");
    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", out.display(), jar.display()))
        .args(["nts.rt.NtsMain", "nts.gen.Program"])
        .output()
        .unwrap_or_else(|error| panic!("{name}: {} did not start: {error}", java.display()));
    // **A JVM killed has no exit code, and the -1 standing in for one said
    // nothing.** One failure under a gate's load
    // (`exp_and_hypot_answer_as_node_does`, 2026-10-21) left no way to tell a
    // JVM killed from one that answered wrong. Every call site prints `stderr`
    // when the status is not 0, so a signal leads it; an exit code is printed
    // by the assertion itself, and the tests that expect one read `stderr`
    // exactly, so it stays as the program wrote it.
    let mut stderr = String::from_utf8_lossy(&ran.stderr).into_owned();
    if ran.status.code().is_none() {
        stderr = format!("java ended by {}\n{stderr}", ran.status);
    }
    Some((
        ran.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&ran.stdout).into_owned(),
        stderr,
    ))
}

#[test]
fn a_clean_run_evaluates_the_module_then_drains_the_loop() {
    let Some((status, stdout, stderr)) = run_whole(
        "clean",
        "let total = 0;\nfor (let i = 0; i < 4; i++) total += i;\nconsole.log(\"total\", total);\n\
         setTimeout(() => console.log(\"timer\", total * 2), 0);\nconsole.log(\"end of module\");\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "a clean run exits 0: {stderr}");
    assert_eq!(
        stdout, "total 6\nend of module\ntimer 12\n",
        "node's order: the module, then the timer"
    );
}

#[test]
fn an_uncaught_throw_at_module_scope_exits_one() {
    let Some((status, stdout, stderr)) = run_whole(
        "throw",
        "console.log(\"before\");\nthrow new RangeError(\"at module scope\");\n",
    ) else {
        return;
    };
    assert_eq!(status, 1, "C and node both exit 1: {stderr}");
    assert_eq!(stdout, "before\n");
    assert_eq!(stderr.trim(), "nts: uncaught RangeError: at module scope");
}

/// The uncaught line names the class as the program does, which is C's
/// descriptor name. Two classes with the same fields share a layout, so each
/// is an empty subclass named for both -- `Test262Error__Test262Error` -- and
/// that was the name printed, where C prints `Test262Error`: test262's runner
/// compared the two lanes' lines and found a difference that was only a name.
#[test]
fn an_uncaught_throw_names_a_class_that_shares_its_layout_as_c_does() {
    let Some((status, stdout, stderr)) = run_whole(
        "shared",
        "class Test262Error {\n  message: string;\n  constructor(message: string) {\n    \
         this.message = message;\n  }\n}\nclass Other {\n  message: string;\n  \
         constructor(message: string) {\n    this.message = message;\n  }\n}\n\
         console.log(new Other(\"kept\").message);\nthrow new Test262Error(\"boom\");\n",
    ) else {
        return;
    };
    assert_eq!(status, 1, "an uncaught throw: {stderr}");
    assert_eq!(stdout, "kept\n");
    assert_eq!(
        stderr.trim(),
        "nts: uncaught Test262Error: boom",
        "C's line"
    );
}

/// A run-time refusal ends the run as C's `abort()` does: status 134 and the
/// line C prints, `nts: refused: ` and the reason. The refusal is a checked read past the end of an array --
/// `xs[1]!` on a one-element array, where node answers `undefined` and nts
/// refuses rather than hand back a value the `!` promised was there.
///
/// It used to be a `bigint` ordering the JVM declined, until cc95747e5 made
/// that comparison compile; a refusal that a feature can retire is a fragile
/// witness for the launcher, so this one is a rule rather than a gap.
#[test]
fn a_run_time_refusal_exits_as_c_aborts() {
    let Some((status, stdout, stderr)) = run_whole(
        "refusal",
        "function outside(xs: number[]): number {\n  return xs[1]!;\n}\n\
         console.log(\"start\");\nconsole.log(outside([3]));\n",
    ) else {
        return;
    };
    assert_eq!(status, 134, "C's `abort()` status: {stderr}");
    assert_eq!(stdout, "start\n");
    // C's `nts_bounds` line, `NTS_REFUSED` + the index: a legitimate decline, which the differential
    // reads by the `nts: refused: ` prefix. The launcher used to rewrite it to `nts: refused at run time: `,
    // the missing-feature abort's text, which this test then pinned.
    assert_eq!(stderr.trim(), "nts: refused: index 1 is outside [0, 1)");
}

/// A program with no module evaluation runs nothing and exits 0, as C's
/// launcher does for one. Here lowering drops the evaluation whole -- `count`
/// takes an array of `never` -- so `Program` has no `module$init`, and the
/// refusal is the emitter's to report. The launcher reflected for the method
/// anyway and died with `NoSuchMethodException` and a stack trace, which a
/// runner reads as the JVM crashing.
#[test]
fn a_program_with_nothing_to_evaluate_exits_zero() {
    let Some((status, stdout, stderr)) = run_whole(
        "nothing",
        "function count(xs: never[]): number {\n  return xs.length;\n}\n\
         console.log(\"start\");\nconsole.log(count([]));\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "nothing to run: {stderr}");
    assert_eq!(stdout, "");
    assert_eq!(stderr, "");
}

/// A top-level `var` read before anything assigns it is `undefined`, which is
/// test262's `var x; x--;` and node's answer.
///
/// Free on C, where the variable is an erased global, a zeroed `NtsValue` is
/// tag 0 and tag 0 is `undefined`. A JVM static field zeroes to Java `null`,
/// which is no erased value at all, so the first conversion refused at run
/// time -- "`Number()` on a value that is not there", exit 134 -- in eight
/// `++`/`--` cases and a `String(x)` one that pass on C. `given` is the control:
/// its declaration stores `undefined` itself, and it always answered.
#[test]
fn a_var_read_before_anything_assigns_it_is_undefined() {
    let Some((status, stdout, stderr)) = run_whole_script(
        "hoisted",
        "var held;\nconsole.log(String(held));\nheld--;\nconsole.log(held);\n\
         held = null;\nheld--;\nconsole.log(held);\n\
         var given = undefined;\nconsole.log(String(given));\ngiven--;\nconsole.log(given);\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "a clean run: {stderr}");
    assert_eq!(stdout, "undefined\nNaN\n-1\nundefined\nNaN\n");
}

/// A global folded to `-0` starts as `-0`: `<clinit>` skipped every global whose
/// initial value compared equal to zero, and `-0.0 == 0.0`, so it read Java's
/// `+0`. Test262's `S8.5_A11_T1` (`1 / n_zero`) and `-0 ** 1` failed on the JVM
/// alone. `p_zero` is the control.
#[test]
fn a_global_initialised_to_negative_zero_keeps_its_sign() {
    let Some((status, stdout, stderr)) = run_whole_script(
        "negative-zero",
        "var p_zero = +0;\nvar n_zero = -0;\nconsole.log(1 / p_zero, 1 / n_zero);\n\
         var base = -0;\nconsole.log(1 / (base ** 1), 1 / (base ** 111));\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "a clean run: {stderr}");
    assert_eq!(stdout, "Infinity -Infinity\n-Infinity -Infinity\n");
}

/// A shift the IR types `i64` is JavaScript's: the value's low 32 bits, by a
/// count masked to five. A shift compared with `4294967295` is typed `i64`, and
/// the JVM shifted all 64 bits by a count masked to six: `4294967295 >>> -32.1`
/// was a shift by 32 and answered 0 (test262 `S11.7.3_A5.2_T1`), and so did
/// `>>> -31.1` and `7 >>> -32.1`. The rest are the control -- counts the two
/// masks agree on -- and held before.
#[test]
fn a_shift_typed_i64_takes_the_low_32_bits() {
    let Some((status, stdout, stderr)) = run_whole_script(
        "shift",
        "console.log(4294967295 >>> -32.1 === 4294967295, 4294967295 >>> -31.1 === 2147483647, \
         4294967295 >>> 33 === 2147483647);\n\
         var big = 4294967295;\n\
         console.log(big >>> 0 === 4294967295, big >> 1 === -1, big << 1 === -2);\n\
         var small = 7;\nconsole.log(small >>> -32.1 === 7, small << 30 === -1073741824);\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "a clean run: {stderr}");
    assert_eq!(stdout, "true true true\ntrue true true\ntrue true\n");
}

/// A `Map<number, number>` handed a string key and a string value through a
/// `Map<unknown, unknown>` view, which TypeScript's method bivariance allows,
/// turns its number columns into boxes and keeps every entry, its order and
/// the hole `delete` left between two of them (`NtsTable.eraseKeys`,
/// `eraseValues`) -- between, because deleting the first entry only moves
/// `head`, which the turn starts after, and leaves no hole to keep. The second
/// line is the control, a table made `Map<unknown, unknown>`, which never had
/// a number column; node prints the same for both. A JVM test rather than a
/// program in the corpus because Wasm declines the upcast.
#[test]
fn a_number_table_handed_a_string_turns_its_columns() {
    let Some((status, stdout, stderr)) = run_whole(
        "turn",
        "function widen(into: Map<unknown, unknown>, seed: number): string {\n\
         \x20 into.set(\"text\", seed);\n\
         \x20 into.set(seed + 100, \"value\");\n\
         \x20 const out: string[] = [];\n\
         \x20 into.forEach((v, k) => out.push(String(k) + \":\" + String(v)));\n\
         \x20 return out.join(\" \");\n\
         }\n\
         const m = new Map<number, number>();\n\
         m.set(1, 2);\nm.set(2, 3);\nm.set(3, 4);\nm.delete(2);\n\
         console.log(widen(m, 7) + \" \" + m.get(3) + \" \" + m.has(2) + \" \" + m.size);\n\
         const unknown = new Map<unknown, unknown>();\n\
         unknown.set(1, 2);\nunknown.set(2, 3);\nunknown.set(3, 4);\nunknown.delete(2);\n\
         console.log(widen(unknown, 7) + \" \" + unknown.get(3) + \" \" + unknown.has(2) + \" \" + unknown.size);\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "a clean run: {stderr}");
    assert_eq!(
        stdout,
        "1:2 3:4 text:7 107:value 4 false 4\n1:2 3:4 text:7 107:value 4 false 4\n"
    );
}

/// `Math.exp` and `Math.hypot` answer node's bits. fdlibm's `exp(1)` is one bit
/// off `Math.E`, which V8 special-cases and `StrictMath` does not (test262's
/// staging `sm/Math/exp-exact`), and fdlibm's `hypot` is not V8's algorithm:
/// this pair differed in the last place. `exp(2)` is the control, on which
/// fdlibm and V8 always agreed.
#[test]
fn exp_and_hypot_answer_as_node_does() {
    let Some((status, stdout, stderr)) = run_whole(
        "math",
        "let one: number = 1;\nlet two: number = 2;\n\
         console.log(Math.exp(one) === Math.E, Math.exp(two), \
         Math.hypot(2.657729685306549, -11.75147533416748));\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "a clean run: {stderr}");
    assert_eq!(stdout, "true 7.38905609893065 12.048265419125958\n");
}

/// Three globals whose names the JVM's mangling makes one, each its own field:
/// `$`, `$‍` and `$‌` all mangle to `$$`, since ZWJ and ZWNJ are
/// outside what DEX spells. The class declared the field three times and was
/// refused (test262 `identifiers/part-zwj-zwnj-escaped`); the later two now
/// take their index, as two properties of one spelling do. `a` and `b` are the
/// control: names the mangling keeps apart, which always loaded.
#[test]
fn globals_the_mangling_makes_alike_are_told_apart() {
    let Some((status, stdout, stderr)) = run_whole_script(
        "zwj",
        "var $ = 1;\nvar $\\u200D = 2;\nvar $\\u200C = 3;\nconsole.log($, $\\u200D, $\\u200C);\n\
         var a = 4;\nvar b = 5;\nconsole.log(a, b);\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "a clean run: {stderr}");
    assert_eq!(stdout, "1 2 3\n4 5\n");
}

/// A generated name never takes a global's own spelling. `$‍` and
/// `$‌` both mangle to `$$`, so the second is told apart by its index --
/// and `$$_0` to `$$_3` are globals of their own, which a name chosen without
/// looking at them would have declared again. The index is bumped until free.
#[test]
fn a_told_apart_global_skips_the_names_other_globals_spell() {
    let Some((status, stdout, stderr)) = run_whole_script(
        "zwj-suffix",
        "var $\\u200D = 1;\nvar $\\u200C = 2;\nvar $$_0 = 3;\nvar $$_1 = 4;\nvar $$_2 = 5;\nvar $$_3 = 6;\n\
         console.log($\\u200D, $\\u200C, $$_0, $$_1, $$_2, $$_3);\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "a clean run: {stderr}");
    assert_eq!(stdout, "1 2 3 4 5 6\n");
}

/// A buffer the language allows and the machine cannot give is node's
/// catchable `RangeError: Array buffer allocation failed`, as on C, where
/// `calloc` fails and the lowering throws on the null. The JVM refused at run
/// time, which aborts, so test262's two `allocation-limit` cases -- an
/// `assert.throws(RangeError, ...)` each -- passed on C and failed here. The
/// eight-byte buffer is the control.
#[test]
fn a_buffer_too_large_for_the_machine_throws_a_range_error() {
    let Some((status, stdout, stderr)) = run_whole(
        "buffer-limit",
        "function attempt(make: () => ArrayBuffer): string {\n\
         \x20 try { return String(make().byteLength); }\n\
         \x20 catch (e) { return e instanceof RangeError ? \"RangeError: \" + e.message : \"other\"; }\n\
         }\n\
         console.log(attempt(() => new ArrayBuffer(8)));\n\
         console.log(attempt(() => new ArrayBuffer(7 * 1125899906842624)));\n\
         console.log(attempt(() => new ArrayBuffer(0, { maxByteLength: 7 * 1125899906842624 })));\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "a clean run: {stderr}");
    assert_eq!(
        stdout,
        "8\nRangeError: Array buffer allocation failed\nRangeError: Array buffer allocation failed\n"
    );
}

/// The program the refusal test used to run, now that it compiles: a `bigint`
/// ordering across a value past 2^64 answers as node does and the run is clean.
#[test]
fn a_bigint_ordering_runs_to_completion() {
    let Some((status, stdout, stderr)) = run_whole(
        "bigint",
        "function big(a: bigint, b: bigint): boolean {\n  return a > b;\n}\n\
         console.log(\"start\");\nconsole.log(big(10n ** 30n, 5n));\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "{stderr}");
    assert_eq!(stdout, "start\ntrue\n");
}

/// The first divergence the launcher measured: an unhandled rejection exited 0
/// here where node and C exit 1, because `NtsPromise` tracked nothing. It is
/// reported after the turn now, through the same `uncaught` line C prints.
#[test]
fn an_unhandled_rejection_is_reported_after_the_turn() {
    let Some((status, stdout, stderr)) = run_whole(
        "unhandled",
        "async function fail(): Promise<number> {\n  throw new RangeError(\"nobody handles this\");\n}\n\
         fail();\nconsole.log(\"after\");\n",
    ) else {
        return;
    };
    assert_eq!(status, 1, "node and C exit 1: {stderr}");
    assert_eq!(
        stdout, "after\n",
        "reported after the module, not at the throw"
    );
    assert_eq!(stderr.trim(), "nts: uncaught RangeError");
}

/// The control: the same rejection awaited inside a `try` later in the turn is
/// handled, so nothing is reported and the run is clean.
#[test]
fn a_rejection_awaited_in_the_same_turn_is_handled() {
    let Some((status, stdout, stderr)) = run_whole(
        "handled",
        "async function fail(): Promise<number> {\n  throw new RangeError(\"late\");\n}\n\
         const p = fail();\nasync function later(): Promise<void> {\n  try { await p; } catch { console.log(\"caught late\"); }\n}\n\
         later();\nconsole.log(\"after\");\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "{stderr}");
    assert_eq!(stdout, "after\ncaught late\n");
}

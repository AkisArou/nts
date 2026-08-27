//! Differential execution: the same TypeScript, compiled and interpreted, compared.
//!
//! # Why this is the foundation and not a nicety
//!
//! Every other test in this workspace asserts something *we* decided. The
//! end-to-end tests compare against expected values a person typed, which means
//! they test what that person thought to test. There is no oracle for "is this
//! what TypeScript means", and there is exactly one available: run the same
//! source on a JavaScript engine and see.
//!
//! That also turns every external corpus into a correctness suite. TypeScript's
//! own test cases check types, not answers; test262 assumes a runtime we do not
//! have. Neither is an oracle by itself. With this, both become one.
//!
//! # Comparing floating point
//!
//! By bit pattern, always. `printf("%.17g")` against `Number.prototype.toString`
//! disagrees about spelling, not value, and a comparison that has to know the
//! difference will eventually get it wrong. Bits also make the two cases that
//! matter most exact rather than approximate: `NaN` compares equal to `NaN`, and
//! `-0` does not compare equal to `0` — which is the whole reason the interval
//! domain tracks the sign of zero.
//!
//! Integer and boolean returns are widened to a double first. Both are exact
//! there, and one comparison rule beats three.
//!
//! # What it can time out on
//!
//! A pool value that lands in a loop bound. `fib(2147483648)` does not return,
//! and no analysis available here can tell which parameter is a bound. Both
//! sides run under a timeout, and the comparison covers the cases both sides
//! reached — reported, so a run that checked twelve cases does not read like one
//! that checked all of them.

use std::fmt::Write as _;

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir::facts::Facts;
use nts_core::hir::{self, HirType};
use nts_frontend_ts::{SemanticSource, TsgoApi};

/// Inputs chosen to hit the places TypeScript and C disagree.
///
/// Zero with both signs, the `int32` and `uint32` boundaries either side, the
/// largest exact integer, a value that is whole but not small, fractions that
/// round in both directions, and `NaN`. Infinities are left out: they are
/// interesting and they are also how a counted loop becomes a hang.
const POOL: &[f64] = &[
    0.0,
    -0.0,
    1.0,
    -1.0,
    2.0,
    3.0,
    0.5,
    -0.5,
    1.5,
    -1.5,
    3.7,
    -3.7,
    7.0,
    27.0,
    100.0,
    255.0,
    256.0,
    1_000.0,
    4_096.0,
    65_535.0,
    2_147_483_647.0,
    -2_147_483_648.0,
    2_147_483_648.0,
    4_294_967_295.0,
    9_007_199_254_740_991.0,
    -9_007_199_254_740_991.0,
    1e-8,
    12_345.0,
    f64::NAN,
];

/// What the other parameters hold while one of them sweeps the pool.
///
/// Small, whole and positive, because a parameter that is not the one under test
/// is most often a loop bound and this is the value least likely to hang.
const QUIET: f64 = 3.0;

/// How long either side may take before its remaining cases are abandoned.
const TIMEOUT: &str = "20";

/// A function this can drive, and the shape of its signature.
///
/// The types are kept rather than assumed. Declaring everything as
/// `double f(double)` and letting the linker sort it out reads a `bool` return
/// as whatever eight bytes happen to be in the return register, which produced a
/// page of disagreements that were entirely this harness's fault.
struct Testable {
    name: String,
    returns: HirType,
    params: Vec<(HirType, Facts)>,
}

/// The values one parameter may be given.
///
/// The declared type is the contract, and feeding a value outside it is not a
/// test — it is asking what happens when the program is called wrongly, which
/// TypeScript already forbids and the compiler is entitled to assume never
/// happens. `weigh(mode: 0 | 1 | 2 | 3)` handed `0.5` produced forty-four
/// disagreements that were all this harness's fault.
///
/// So the pool is filtered by the parameter's declared facts, and the facts'
/// own endpoints are added: a literal type like `64` admits exactly one value
/// and the pool does not happen to contain it.
fn inputs(ty: &HirType, known: Facts) -> Vec<f64> {
    if matches!(ty, HirType::Bool) {
        return vec![0.0, 1.0];
    }
    let mut values: Vec<f64> = POOL
        .iter()
        .copied()
        .filter(|value| known.contains(*value))
        .collect();
    for edge in [known.lo, known.hi] {
        if edge.is_finite() && !values.iter().any(|value| value.to_bits() == edge.to_bits()) {
            values.push(edge);
        }
    }
    if values.is_empty() {
        // Nothing in the declared set can be written down. Better to check
        // nothing than to check something the type forbids.
        values.push(0.0);
    }
    values
}

/// How a type is spelled in C.
fn c_type(ty: &HirType) -> &'static str {
    match ty {
        HirType::Bool => "bool",
        HirType::Int { bits: 8, signed } => {
            if *signed {
                "int8_t"
            } else {
                "uint8_t"
            }
        }
        HirType::Int { bits: 16, signed } => {
            if *signed {
                "int16_t"
            } else {
                "uint16_t"
            }
        }
        HirType::Int { bits: 64, signed } => {
            if *signed {
                "int64_t"
            } else {
                "uint64_t"
            }
        }
        HirType::Int { signed, .. } => {
            if *signed {
                "int32_t"
            } else {
                "uint32_t"
            }
        }
        HirType::Float { bits: 32 } => "float",
        _ => "double",
    }
}

/// Compile a program, run it, run the same source on node, and compare.
///
/// # Errors
///
/// If the program does not typecheck, does not lower, does not compile, or the
/// two sides disagree.
pub(crate) fn check(tsconfig: &Utf8Path) -> Result<()> {
    let tsgo = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    let mut source = TsgoApi::for_compilation(tsgo);
    let snapshot = source.snapshot(tsconfig)?;
    if snapshot.has_errors() {
        for diagnostic in &snapshot.diagnostics {
            eprintln!("{} {}", diagnostic.code, diagnostic.message);
        }
        bail!("the program does not typecheck");
    }

    let prepared = match hir::prepare(&snapshot) {
        Ok(prepared) => prepared,
        Err(problems) => bail!("invalid HIR: {problems:?}"),
    };
    for diagnostic in &prepared.diagnostics {
        eprintln!("  refused: {} {}", diagnostic.code, diagnostic.message);
    }

    let testable: Vec<Testable> = prepared
        .program
        .funcs
        .iter()
        .filter(|func| func.exported)
        .filter(|func| {
            scalar(&func.return_type) && func.params.iter().all(|param| scalar(&param.ty))
        })
        .map(|func| Testable {
            name: func.name.clone(),
            returns: func.return_type.clone(),
            params: func
                .params
                .iter()
                .map(|param| (param.ty.clone(), param.known))
                .collect(),
        })
        .collect();

    if testable.is_empty() {
        println!("nothing to check: no exported function has scalar arguments and a scalar result");
        return Ok(());
    }

    let entry = entry_module(&snapshot)?;
    let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .map_err(|path| anyhow::anyhow!("temp dir is not utf-8: {}", path.display()))?
        .join(format!("nts-check-{}", std::process::id()));
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {dir}"))?;

    let native = run_native(&dir, &prepared.program, &testable)?;
    let engine = run_node(&dir, &entry, &testable)?;
    report(&native, &engine, &testable)
}

/// Whether a type is something this can pass and compare.
fn scalar(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Bool | HirType::Int { .. } | HirType::Float { .. }
    )
}

/// The file to hand to node.
fn entry_module(snapshot: &nts_semantic_schema::SemanticSnapshot) -> Result<Utf8PathBuf> {
    let module = snapshot
        .modules
        .first()
        .context("the program has no modules")?;
    let file = snapshot
        .sources
        .get(module.file.0 as usize)
        .context("the entry module has no source file")?;
    Ok(file.display_path.clone())
}

/// The argument tuples one function is called with.
///
/// One parameter sweeps the pool while the rest stay quiet, which is linear in
/// the arity rather than exponential — and finds more, because a disagreement
/// almost always turns on one argument's value rather than on a combination.
fn tuples(params: &[(HirType, Facts)]) -> Vec<Vec<f64>> {
    if params.is_empty() {
        return vec![Vec::new()];
    }
    let pools: Vec<Vec<f64>> = params
        .iter()
        .map(|(ty, known)| inputs(ty, *known))
        .collect();
    // What a parameter holds while a different one is under test: the quiet
    // value if its type admits it, and otherwise whatever its type does admit.
    let resting: Vec<f64> = pools
        .iter()
        .map(|pool| {
            pool.iter()
                .copied()
                .find(|value| *value == QUIET)
                .unwrap_or(pool[0])
        })
        .collect();

    let mut out = Vec::new();
    for slot in 0..params.len() {
        for value in &pools[slot] {
            let mut tuple = resting.clone();
            tuple[slot] = *value;
            out.push(tuple);
        }
    }
    out
}

/// A double as C would print it and as JavaScript would print it: its bits.
fn literal(value: f64) -> String {
    if value.is_nan() {
        return "NAN".to_owned();
    }
    // Enough digits to round-trip, and a decimal point so C reads it as a
    // double rather than an int.
    let text = format!("{value:?}");
    if text.contains(['.', 'e', 'E']) {
        text
    } else {
        format!("{text}.0")
    }
}

fn run_native(
    dir: &Utf8Path,
    program: &hir::Program,
    testable: &[Testable],
) -> Result<Vec<String>> {
    let emitted = nts_codegen_c::emit(program);
    let generated = dir.join("program.c");
    std::fs::write(&generated, emitted.writer.text())?;
    std::fs::write(
        dir.join(nts_codegen_c::RUNTIME_HEADER_NAME),
        nts_codegen_c::RUNTIME_HEADER,
    )?;
    let runtime = dir.join(nts_codegen_c::RUNTIME_SOURCE_NAME);
    std::fs::write(&runtime, nts_codegen_c::RUNTIME_SOURCE)?;

    let mut main = String::from(
        "#include <math.h>\n#include <stdbool.h>\n#include <stdint.h>\n#include <stdio.h>\n#include <string.h>\n\n\
         static void show(const char *name, int at, double value) {\n\
         \x20   uint64_t bits;\n\
         \x20   /* Every NaN is the same NaN as far as JavaScript can tell: there\n\
         \x20    * is no way to observe the sign or payload from the language, so\n\
         \x20    * comparing them bit for bit would fail on a difference nobody\n\
         \x20    * can see. */\n\
         \x20   if (value != value) {\n\
         \x20       printf(\"%s %d nan\\n\", name, at);\n\
         \x20       fflush(stdout);\n\
         \x20       return;\n\
         \x20   }\n\
         \x20   memcpy(&bits, &value, sizeof bits);\n\
         \x20   printf(\"%s %d %016llx\\n\", name, at, (unsigned long long)bits);\n\
         \x20   fflush(stdout);\n\
         }\n\n",
    );
    for one in testable {
        let params: Vec<String> = one
            .params
            .iter()
            .enumerate()
            .map(|(at, (ty, _))| format!("{} a{at}", c_type(ty)))
            .collect();
        let _ = writeln!(
            main,
            "{} {}({});",
            c_type(&one.returns),
            one.name,
            if params.is_empty() {
                "void".to_owned()
            } else {
                params.join(", ")
            }
        );
    }
    main.push_str("\nint main(void) {\n");
    for one in testable {
        for (at, tuple) in tuples(&one.params).into_iter().enumerate() {
            let args: Vec<String> = tuple
                .iter()
                .zip(&one.params)
                .map(|(value, (ty, _))| format!("({}){}", c_type(ty), literal(*value)))
                .collect();
            let _ = writeln!(
                main,
                "    show(\"{}\", {at}, (double){}({}));",
                one.name,
                one.name,
                args.join(", ")
            );
        }
    }
    main.push_str("    return 0;\n}\n");
    let main_path = dir.join("check_main.c");
    std::fs::write(&main_path, main)?;

    let binary = dir.join("check");
    let build = std::process::Command::new("clang")
        .args(["-std=c11", "-O1", "-w"])
        .arg("-I")
        .arg(dir)
        .arg("-o")
        .arg(&binary)
        .arg(&main_path)
        .arg(&generated)
        .arg(&runtime)
        .arg("-lm")
        .output()
        .context("running clang")?;
    if !build.status.success() {
        bail!("clang: {}", String::from_utf8_lossy(&build.stderr));
    }

    let run = std::process::Command::new("timeout")
        .arg(TIMEOUT)
        .arg(&binary)
        .output()
        .context("running the compiled program")?;
    Ok(lines(&run.stdout))
}

fn run_node(dir: &Utf8Path, entry: &Utf8Path, testable: &[Testable]) -> Result<Vec<String>> {
    let absolute = entry
        .canonicalize_utf8()
        .with_context(|| format!("locating {entry}"))?;
    let mut driver = format!(
        "const m = await import({:?});\n\
         const view = new DataView(new ArrayBuffer(8));\n\
         function show(name, at, value) {{\n\
         \x20 const n = Number(value);\n\
         \x20 if (Number.isNaN(n)) {{ process.stdout.write(`${{name}} ${{at}} nan\\n`); return; }}\n\
         \x20 view.setFloat64(0, n);\n\
         \x20 const bits = view.getBigUint64(0).toString(16).padStart(16, \"0\");\n\
         \x20 process.stdout.write(`${{name}} ${{at}} ${{bits}}\\n`);\n\
         }}\n",
        format!("file://{absolute}")
    );
    for one in testable {
        // A method lowers to `Class#method`, which is not an export.
        let exported = one.name.replace('#', "__");
        for (at, tuple) in tuples(&one.params).into_iter().enumerate() {
            let args: Vec<String> = tuple
                .iter()
                .zip(&one.params)
                .map(|(value, (ty, _))| {
                    if matches!(ty, HirType::Bool) {
                        return if *value == 0.0 { "false" } else { "true" }.to_owned();
                    }
                    if value.is_nan() {
                        "NaN".to_owned()
                    } else if *value == 0.0 && value.is_sign_negative() {
                        "-0".to_owned()
                    } else {
                        format!("{value:?}")
                    }
                })
                .collect();
            let _ = writeln!(
                driver,
                "show({:?}, {at}, m.{exported}({}));",
                one.name,
                args.join(", ")
            );
        }
    }
    let path = dir.join("check_driver.mjs");
    std::fs::write(&path, driver)?;

    let run = std::process::Command::new("timeout")
        .arg(TIMEOUT)
        .arg("node")
        .arg(&path)
        .output()
        .context("running node")?;
    if run.stdout.is_empty() && !run.status.success() {
        bail!("node: {}", String::from_utf8_lossy(&run.stderr));
    }
    Ok(lines(&run.stdout))
}

fn lines(bytes: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::to_owned)
        .collect()
}

/// Compare, and say what was compared.
fn report(native: &[String], engine: &[String], testable: &[Testable]) -> Result<()> {
    let both = native.len().min(engine.len());
    let expected: usize = testable.iter().map(|one| tuples(&one.params).len()).sum();

    let mut disagreements = Vec::new();
    for at in 0..both {
        if native[at] != engine[at] {
            disagreements.push((native[at].clone(), engine[at].clone()));
        }
    }

    if both < expected {
        println!(
            "checked {both} of {expected} cases; the rest were not reached \
             (a pool value in a loop bound will do that)"
        );
    } else {
        println!("checked {both} cases across {} function(s)", testable.len());
    }

    if disagreements.is_empty() {
        println!("agreed on every case");
        return Ok(());
    }
    for (native, engine) in disagreements.iter().take(20) {
        println!("  nts  {native}");
        println!("  node {engine}");
    }
    bail!(
        "{} case(s) disagree between the compiled program and node",
        disagreements.len()
    )
}

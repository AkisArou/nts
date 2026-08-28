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

/// How many times the compiled program may end before the run gives up.
///
/// A handful is a program with a few assertions this pool falsifies. Hundreds is
/// something else, and continuing to restart would take all day to say so.
const REFUSALS: usize = 16;

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
    if is_string(ty) {
        // An index into `STRINGS`, carried as a double so that one tuple type
        // serves both kinds of parameter. Which pool a slot draws from is
        // decided by its type, at every point that reads it.
        return (0..STRINGS.len())
            .map(|at| f64::from(u32::try_from(at).unwrap_or(0)))
            .collect();
    }
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
/// The C spelling of a type, for the harness's own declarations.
///
/// Exhaustive, with no catch-all. It ended in `_ => "double"`, and when
/// `Promise` arrived that quietly declared an `async` function as returning a
/// number -- a pointer marshalled as a double, which clang accepted at the
/// declaration and rejected only where the two met. A default that is right for
/// its neighbours is wrong for the newcomer, and the newcomer is exactly what
/// nobody is looking at.
fn c_type(ty: &HirType) -> &'static str {
    match ty {
        HirType::Managed(nts_core::hir::ManagedType::String) => "NtsString *",
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
        HirType::Float { .. } => "double",
        // An `async` function hands back the fixed runtime type whatever it
        // settles with; `show_settled` reads the payload out.
        HirType::Managed(nts_core::hir::ManagedType::Promise(_)) => "NtsPromise *",
        // Neither is drivable -- `drivable` gates what reaches here -- but a
        // wrong *spelling* would be a wrong C declaration rather than a
        // refusal, so they are named rather than defaulted.
        HirType::Managed(nts_core::hir::ManagedType::Array(_)) => "NtsArray *",
        HirType::Managed(nts_core::hir::ManagedType::Object(_)) => "void *",
        HirType::Void | HirType::Never => "void",
    }
}

/// Compile a program, run it, run the same source on node, and compare.
///
/// # Errors
///
/// If the program does not typecheck, does not lower, does not compile, or the
/// two sides disagree.
pub fn check(tsconfig: &Utf8Path) -> Result<Report> {
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

    let entry = entry_module(&snapshot)?;
    let importable = exports_of(&snapshot, &entry);
    let testable: Vec<Testable> = prepared
        .program
        .funcs
        .iter()
        .filter(|func| func.exported)
        // Exported by the *entry* module, not merely by some module. `exported`
        // marks a root of the whole program, and node imports one file: a
        // function another module exports is a root here and `undefined` there,
        // so driving it threw `m.f is not a function` and the run died before
        // it compared anything. `examples/nested` had never been checked.
        .filter(|func| importable.contains(func.name.as_str()))
        .filter(|func| {
            drivable(&func.return_type) && func.params.iter().all(|param| drivable(&param.ty))
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
        return Ok(Report::default());
    }

    let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .map_err(|path| anyhow::anyhow!("temp dir is not utf-8: {}", path.display()))?
        .join(format!("nts-check-{}", std::process::id()));
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {dir}"))?;

    let mut refused = Vec::new();
    let native = run_native(&dir, &prepared.program, &testable, &mut refused)?;
    let engine = run_node(&dir, &entry, &testable)?;
    let approximate = nts_core::hir::builtin::approximating(&prepared.program);
    Ok(report(&native, &engine, &testable, &refused, &approximate))
}

/// How far apart two doubles may be and still be the same answer.
///
/// Only for a function the specification leaves approximate -- see
/// [`nts_core::hir::builtin::APPROXIMATED`]. Four rather than the two that
/// glibc and V8 were measured to differ by, because the bound being tested is
/// "two conforming implementations of the same function", not "this libm
/// build". A real defect -- the wrong helper, the arguments the wrong way
/// round, a missing conversion -- is off by millions of ULP, not by four.
pub const TOLERANCE: u64 = 4;

/// The distance between two doubles, counted in representable values.
///
/// Ordering the bit patterns as signed magnitudes makes adjacent doubles differ
/// by one, and makes `-0.0` and `0.0` adjacent rather than a hemisphere apart.
/// Infinities and NaN are not near anything: comparing those is exact, because
/// the specification pins every special case even where it leaves the rest
/// approximate.
fn ulps_apart(a: f64, b: f64) -> Option<u64> {
    if !a.is_finite() || !b.is_finite() {
        return None;
    }
    let ordered = |x: f64| {
        let bits = x.to_bits().cast_signed();
        if bits < 0 { i64::MIN - bits } else { bits }
    };
    Some(ordered(a).abs_diff(ordered(b)))
}

/// Whether two result lines say the same thing, given how exact this function
/// has to be.
///
/// A line is `name at bits`, or `name at nan`, or a string's code units. Only
/// the `bits` form can be near-miss compared; everything else is exact, and a
/// function that is not approximate is exact in every form.
fn agrees(native: &str, engine: &str, approximate: bool) -> bool {
    if native == engine {
        return true;
    }
    if !approximate {
        return false;
    }
    let (Some((left, left_at, x)), Some((right, right_at, y))) =
        (numeric_result(native), numeric_result(engine))
    else {
        return false;
    };
    left == right
        && left_at == right_at
        && ulps_apart(x, y).is_some_and(|distance| distance <= TOLERANCE)
}

/// A result line that carries a finite double, split into what it says.
fn numeric_result(line: &str) -> Option<(&str, &str, f64)> {
    let mut parts = line.split(' ');
    let name = parts.next()?;
    let at = parts.next()?;
    let bits = u64::from_str_radix(parts.next()?, 16).ok()?;
    parts
        .next()
        .is_none()
        .then_some((name, at, f64::from_bits(bits)))
}

/// Whether a type is something this can pass and compare.
fn scalar(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Bool | HirType::Int { .. } | HirType::Float { .. }
    )
}

/// Whether a type is a string, which this passes and compares differently.
fn is_string(ty: &HirType) -> bool {
    matches!(ty, HirType::Managed(nts_core::hir::ManagedType::String))
}

/// What a promise-returning function settles with, if that is what this is.
///
/// An `async` function's HIR return type is the promise rather than the value,
/// so driving one means calling it, running the loop until nothing is left,
/// and reading what it settled with. That is an *ordering* observation made of
/// return values, which is why it needs no new language surface: node's side of
/// it is an `await`.
fn settles_with(ty: &HirType) -> Option<&HirType> {
    match ty {
        HirType::Managed(nts_core::hir::ManagedType::Promise(payload)) => Some(payload),
        _ => None,
    }
}

/// Whether this can drive a function at all.
fn drivable(ty: &HirType) -> bool {
    if let Some(payload) = settles_with(ty) {
        // `Promise<void>` is drivable: settling with nothing is an answer, and
        // it is the one `await` on node prints as `undefined`.
        return matches!(payload, HirType::Void) || scalar(payload) || is_string(payload);
    }
    scalar(ty) || is_string(ty)
}

/// Strings chosen to reach the places a UTF-16 implementation goes wrong.
///
/// Empty, ASCII, a repeated substring so `indexOf` and `lastIndexOf` differ, a
/// character above the byte boundary so the narrow and wide representations both
/// appear, and one outside the basic plane so a surrogate pair is in play --
/// where `length` counts two and a code point is one.
const STRINGS: &[&str] = &["", "hello world", "abcabc", "héllo wörld", "a\u{1F600}b"];

/// The file to hand to node.
fn entry_module(snapshot: &nts_semantic_schema::SemanticSnapshot) -> Result<Utf8PathBuf> {
    // The functions being compared have to be *importable*, and node imports one
    // module. In a program of several, `main.ts` is where the exported surface
    // is by convention -- and taking whichever module happened to be decoded
    // first meant a multi-module program tested nothing while looking as though
    // it had.
    let named_main = snapshot.sources.iter().find(|source| {
        Utf8Path::new(&source.display_path)
            .file_name()
            .is_some_and(|name| name == "main.ts" || name == "main.tsx")
    });
    if let Some(source) = named_main {
        return Ok(source.display_path.clone());
    }

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

/// The names the entry module exports.
///
/// Empty when the entry has no module record, which leaves nothing testable and
/// reports "nothing to check" -- the honest answer, and better than driving
/// functions node cannot see.
fn exports_of(
    snapshot: &nts_semantic_schema::SemanticSnapshot,
    entry: &Utf8Path,
) -> std::collections::HashSet<String> {
    snapshot
        .modules
        .iter()
        .find(|module| {
            snapshot
                .sources
                .get(module.file.0 as usize)
                .is_some_and(|source| source.display_path == entry)
        })
        .map(|module| {
            module
                .exports
                .iter()
                .map(|(name, _)| name.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// Every case, one per function in turn rather than one function at a time.
///
/// Both sides run under a timeout, and a function whose loop bound picks up a
/// pool value like 2^31 will not finish. Emitting a function's cases together
/// means such a function starves every function after it -- `arrays` checked six
/// cases of two hundred and thirty-six, and the seven methods added to it were
/// never reached at all. Interleaving makes a timeout truncate everything
/// equally, so what is checked is a sample of the whole program rather than a
/// prefix of it.
fn interleaved(testable: &[Testable]) -> Vec<(&Testable, usize, Vec<f64>)> {
    let per: Vec<Vec<Vec<f64>>> = testable.iter().map(|one| tuples(&one.params)).collect();
    let deepest = per.iter().map(Vec::len).max().unwrap_or(0);

    let mut out = Vec::new();
    for at in 0..deepest {
        for (one, cases) in testable.iter().zip(&per) {
            if let Some(tuple) = cases.get(at) {
                out.push((one, at, tuple.clone()));
            }
        }
    }
    out
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
    // value if its type admits it, and otherwise something from the middle of
    // its pool. Not the first -- for a string that is the empty one, and every
    // sweep of the *other* parameters would then be asking what happens at an
    // index into nothing.
    let resting: Vec<f64> = pools
        .iter()
        .map(|pool| {
            pool.iter()
                .copied()
                .find(|value| *value == QUIET)
                .unwrap_or_else(|| pool[pool.len() / 2])
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

/// The string a tuple slot names.
///
/// A string parameter's "value" in a tuple is an index into [`STRINGS`], carried
/// as a double so that one tuple type serves both kinds of parameter.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the value is an index this module put there, and the guard covers the rest"
)]
fn string_at(index: f64) -> &'static str {
    let at = if index >= 0.0 { index as u32 } else { 0 };
    STRINGS.get(at as usize).copied().unwrap_or("")
}

/// A string as a C expression building it.
///
/// The bytes are written as hex escapes and the length is passed explicitly, so
/// nothing depends on C's escaping rules agreeing with anyone else's and an
/// embedded zero would survive.
fn c_string(text: &str) -> String {
    let mut escaped = String::new();
    for byte in text.as_bytes() {
        let _ = write!(escaped, "\\x{byte:02x}");
    }
    format!("nts_string_from_utf8(\"{escaped}\", {})", text.len())
}

/// The same string as a JavaScript expression.
///
/// `String.fromCharCode` of the UTF-16 units, for the same reason: it is exactly
/// what the C side built, with no escaping rules in between.
fn js_string(text: &str) -> String {
    let units: Vec<String> = text.encode_utf16().map(|unit| unit.to_string()).collect();
    format!("String.fromCharCode({})", units.join(", "))
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

/// The C harness: one declaration per function, then one call per case.
///
/// Separate from the building and running because it is the part worth
/// reading when a case does not compile, and because the two have nothing
/// to say to each other beyond this string.
/// Everything the generated driver needs before the first case.
///
/// A constant rather than an inline literal because it is most of
/// `native_harness` by line count and none of it varies with the program.
const HARNESS_PRELUDE: &str =
    // Deliberately *not* `<stdlib.h>`. The generated program includes
    // `nts_runtime.h` and nothing else, so a TypeScript function called
    // `div` or `abs` keeps its name -- and a harness that pulled in more
    // headers than the program does would collide on names the program was
    // entitled to use. `<string.h>` is here for `memcpy` and declares
    // nothing a program is likely to want.
    "#include <math.h>\n#include <stdbool.h>\n#include <stdint.h>\n#include <stdio.h>\n#include <string.h>\n\
         long strtol(const char *, char **, int);\n\
         #include \"nts_runtime.h\"\n\
         #include \"nts_test_host.h\"\n\n\
         /* A string is compared by its code units, which is what a JavaScript\n\
          * string is. Printing them beats printing the text: it needs no\n\
          * escaping rules, and a surrogate pair shows up as the two units\n\
          * `length` counts rather than as one character. */\n\
         static void show_string(const char *name, int at, const NtsString *s) {\n\
         \x20   printf(\"%s %d str %u\", name, at, s->length);\n\
         \x20   for (uint32_t i = 0; i < s->length; i++) {\n\
         \x20       printf(\",%u\", (unsigned)nts_str_char_code_at(s, (double)i));\n\
         \x20   }\n\
         \x20   printf(\"\\n\");\n\
         \x20   fflush(stdout);\n\
         }\n\n\
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
         }\n\n\
         /* An `async` function hands back a promise, so its answer is what it\n\
          * settles with once the loop has nothing left to run. The budget is a\n\
          * bound rather than a guess: a program that starves the loop fails\n\
          * here instead of hanging the run. */\n\
         static void show_settled(const char *name, int at, NtsPromise *p) {\n\
         \x20   nts_test_host_run(1000000);\n\
         \x20   if (p->state == NTS_PROMISE_FULFILLED\n\
         \x20       && p->payload == NTS_PAYLOAD_NUMBER) {\n\
         \x20       show(name, at, p->number);\n\
         \x20       return;\n\
         \x20   }\n\
         \x20   if (p->state == NTS_PROMISE_FULFILLED\n\
         \x20       && p->payload == NTS_PAYLOAD_REFERENCE) {\n\
         \x20       show_string(name, at, (const NtsString *)p->reference);\n\
         \x20       return;\n\
         \x20   }\n\
         \x20   if (p->state == NTS_PROMISE_PENDING) {\n\
         \x20       printf(\"%s %d pending\\n\", name, at);\n\
         \x20   } else if (p->state == NTS_PROMISE_REJECTED) {\n\
         \x20       printf(\"%s %d rejected\\n\", name, at);\n\
         \x20   } else {\n\
         \x20       printf(\"%s %d undefined\\n\", name, at);\n\
         \x20   }\n\
         \x20   fflush(stdout);\n\
         }\n\n";

fn native_harness(testable: &[Testable]) -> String {
    let mut main = String::from(HARNESS_PRELUDE);
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
            // The emitter mangles a name that a header already declares, so a
            // TypeScript function called `round` is `round_` in the object file.
            // Declaring it here by its TypeScript name would either not link or,
            // worse, link against `<math.h>`.
            nts_codegen_c::c_identifier(&one.name),
            if params.is_empty() {
                "void".to_owned()
            } else {
                params.join(", ")
            }
        );
    }
    // `argv[1]` is the case to start from. A case can end the process -- an
    // out-of-range index traps, which is the program keeping the promise its `!`
    // made -- and the runner restarts past it rather than losing every case
    // after. Node returns `undefined` for the same input, so the two never had
    // anything to compare there.
    main.push_str(
        "int main(int argc, char **argv) {\n\
         \x20   long from = argc > 1 ? strtol(argv[1], 0, 10) : 0;\n\
         \x20   long at_case = -1;\n\
         \x20   /* Deterministic: virtual time, one thread, no I/O. Ordering is\n\
         \x20    * reproducible here in a way it is not against a real loop. */\n\
         \x20   nts_test_host_install();\n",
    );
    for (one, at, tuple) in interleaved(testable) {
        {
            let args: Vec<String> = tuple
                .iter()
                .zip(&one.params)
                .map(|(value, (ty, _))| {
                    if is_string(ty) {
                        return c_string(string_at(*value));
                    }
                    format!("({}){}", c_type(ty), literal(*value))
                })
                .collect();
            let call = format!(
                "{}({})",
                nts_codegen_c::c_identifier(&one.name),
                args.join(", ")
            );
            let show = if settles_with(&one.returns).is_some() {
                format!("show_settled(\"{}\", {at}, {call});", one.name)
            } else if is_string(&one.returns) {
                format!("show_string(\"{}\", {at}, {call});", one.name)
            } else {
                format!("show(\"{}\", {at}, (double){call});", one.name)
            };
            let _ = writeln!(main, "    if (++at_case >= from) {{ {show} }}");
        }
    }
    main.push_str("    return 0;\n}\n");
    main
}

/// The deterministic host, compiled beside the runtime for every check.
const TEST_HOST_HEADER: &str = include_str!("../../../runtime/c/nts_test_host.h");
const TEST_HOST_SOURCE: &str = include_str!("../../../runtime/c/nts_test_host.c");

/// Whether the C backend's output for a program is well-formed C.
///
/// The corpus harness checks `hir::prepare` and stops there, so a lowering that
/// emits *invalid C* reads as a clean run over every file. That is how `"" + n`
/// survived: it emitted `(NtsString *)v0`, a cast from a `double` to a pointer,
/// while the compiler reported "1 function, nothing refused" and clang reported
/// an error nobody was listening for.
///
/// `-fsyntax-only` asks exactly the question -- is this C well formed -- and
/// skips code generation, which is most of what compiling costs. Over the whole
/// corpus that is the difference between a check worth running every time and
/// one nobody runs.
///
/// # Errors
///
/// The backend's own refusal, or clang's first line.
pub fn compiles(program: &hir::Program, dir: &Utf8Path) -> Result<(), String> {
    let emitted = nts_codegen_c::emit(program);
    if !emitted.diagnostics.is_empty() {
        return Err(emitted
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.clone())
            .collect::<Vec<_>>()
            .join("; "));
    }
    let generated = dir.join("program.c");
    std::fs::write(&generated, emitted.writer.text()).map_err(|error| error.to_string())?;
    std::fs::write(
        dir.join(nts_codegen_c::RUNTIME_HEADER_NAME),
        nts_codegen_c::RUNTIME_HEADER,
    )
    .map_err(|error| error.to_string())?;
    let build = std::process::Command::new("clang")
        .args(["-std=c11", "-fsyntax-only", "-w"])
        .arg("-I")
        .arg(dir)
        .arg(&generated)
        .output()
        .map_err(|error| error.to_string())?;
    if build.status.success() {
        return Ok(());
    }
    Err(String::from_utf8_lossy(&build.stderr)
        .lines()
        .find(|line| line.contains("error"))
        .unwrap_or("clang rejected the generated C")
        .trim()
        .to_owned())
}

fn run_native(
    dir: &Utf8Path,
    program: &hir::Program,
    testable: &[Testable],
    refused: &mut Vec<usize>,
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
    // The deterministic host, so a compiled `async` function has a loop to be
    // driven to quiescence on. Virtual time and one thread: the differential
    // must not depend on a wall clock.
    let host_header = dir.join("nts_test_host.h");
    std::fs::write(&host_header, TEST_HOST_HEADER)?;
    let host = dir.join("nts_test_host.c");
    std::fs::write(&host, TEST_HOST_SOURCE)?;

    let main = native_harness(testable);
    let main_path = dir.join("check_main.c");
    std::fs::write(&main_path, main)?;

    let binary = dir.join("check");
    // `NTS_POISON=1` fills every uninitialized allocation with a non-zero
    // pattern. The compiler emits one only where it believes the lowering
    // writes every slot; running the suite under this is what turns that
    // belief into a checked claim, since an unwritten slot then reads as a
    // conspicuous value rather than as whatever the allocator left.
    let poison = std::env::var("NTS_POISON").is_ok_and(|value| value != "0");
    let build = std::process::Command::new("clang")
        .args(["-std=c11", "-O1", "-w"])
        .args(if poison {
            &["-DNTS_POISON=1"][..]
        } else {
            &[][..]
        })
        .arg("-I")
        .arg(dir)
        .arg("-o")
        .arg(&binary)
        .arg(&main_path)
        .arg(&generated)
        .arg(&runtime)
        .arg(&host)
        .arg("-lm")
        .output()
        .context("running clang")?;
    if !build.status.success() {
        bail!("clang: {}", String::from_utf8_lossy(&build.stderr));
    }

    // Restarted past whatever ends it. A case can trap -- an out-of-range index
    // is the program keeping the promise its `!` made -- and without this, one
    // such case costs every case after it. Node answers `undefined` for the same
    // input, so the two had nothing to compare there anyway; what matters is
    // that the *rest* of the program still gets checked.
    let mut collected: Vec<String> = Vec::new();
    let total = interleaved(testable).len();
    let mut from = 0;
    let mut restarts = 0;
    while from < total && restarts <= REFUSALS {
        let run = std::process::Command::new("timeout")
            .arg(TIMEOUT)
            .arg(&binary)
            .arg(from.to_string())
            .output()
            .context("running the compiled program")?;
        let produced = lines(&run.stdout);
        let reached = produced.len();
        collected.extend(produced);
        if reached == total - from {
            break;
        }
        // The case after the last one that printed. A refusal leaves a gap on
        // this side, and the node side is trimmed to match by index below.
        refused.push(from + reached);
        from += reached + 1;
        restarts += 1;
    }
    Ok(collected)
}

fn run_node(dir: &Utf8Path, entry: &Utf8Path, testable: &[Testable]) -> Result<Vec<String>> {
    let absolute = entry
        .canonicalize_utf8()
        .with_context(|| format!("locating {entry}"))?;
    let mut driver = format!(
        "const m = await import({:?});\n\
         const view = new DataView(new ArrayBuffer(8));\n\
         function showString(name, at, s) {{\n\
         \x20 let out = `${{name}} ${{at}} str ${{s.length}}`;\n\
         \x20 for (let i = 0; i < s.length; i++) out += `,${{s.charCodeAt(i)}}`;\n\
         \x20 process.stdout.write(out + \"\\n\");\n\
         }}\n\
         function show(name, at, value) {{\n\
         \x20 const n = Number(value);\n\
         \x20 if (Number.isNaN(n)) {{ process.stdout.write(`${{name}} ${{at}} nan\\n`); return; }}\n\
         \x20 view.setFloat64(0, n);\n\
         \x20 const bits = view.getBigUint64(0).toString(16).padStart(16, \"0\");\n\
         \x20 process.stdout.write(`${{name}} ${{at}} ${{bits}}\\n`);\n\
         }}\n",
        format!("file://{absolute}")
    );
    for (one, at, tuple) in interleaved(testable) {
        // A method lowers to `Class#method`, which is not an export.
        let exported = one.name.replace('#', "__");
        {
            let args: Vec<String> = tuple
                .iter()
                .zip(&one.params)
                .map(|(value, (ty, _))| {
                    if is_string(ty) {
                        return js_string(string_at(*value));
                    }
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
            let payload = settles_with(&one.returns);
            let show = if is_string(payload.unwrap_or(&one.returns)) {
                "showString"
            } else {
                "show"
            };
            // `await` is the node side of running the loop to quiescence. It is
            // also why the driver is a module rather than a script: top-level
            // await needs one.
            //
            // A settled `Promise<void>` is `undefined`, which `show` would
            // print as NaN -- so it takes the same spelling the native side
            // gives it, and the two compare.
            let call = format!("m.{exported}({})", args.join(", "));
            let _ = match payload {
                Some(HirType::Void) => writeln!(
                    driver,
                    "await {call}; process.stdout.write(`{} {at} undefined\n`);",
                    one.name
                ),
                Some(_) => writeln!(driver, "{show}({:?}, {at}, await {call});", one.name),
                None => writeln!(driver, "{show}({:?}, {at}, {call});", one.name),
            };
        }
    }
    let path = dir.join("check_driver.mjs");
    std::fs::write(&path, driver)?;
    let hook = dir.join("resolve_ts.mjs");
    std::fs::write(&hook, RESOLVE_TS)?;

    let run = std::process::Command::new("timeout")
        .arg(TIMEOUT)
        .arg("node")
        .arg("--import")
        .arg(format!("file://{hook}"))
        .arg(&path)
        .output()
        .context("running node")?;
    if run.stdout.is_empty() && !run.status.success() {
        bail!("node: {}", String::from_utf8_lossy(&run.stderr));
    }
    Ok(lines(&run.stdout))
}

/// A resolve hook that follows TypeScript's `.js` specifiers to the `.ts` files
/// they mean.
///
/// TypeScript writes `import { d } from "./geometry.js"` for a file named
/// `geometry.ts` -- the specifier names the *output*, which is the rule under
/// `NodeNext` and the convention everywhere else. Node's type stripping does not
/// apply that rule, so it looked for a `.js` that does not exist and the run
/// died before comparing anything.
///
/// Only for a relative specifier whose `.ts` sibling exists, so a real `.js`
/// dependency still resolves as itself.
const RESOLVE_TS: &str = r#"import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
      const sibling = new URL(specifier, context.parentURL);
      sibling.pathname = sibling.pathname.slice(0, -3) + ".ts";
      if (existsSync(fileURLToPath(sibling))) {
        return { url: sibling.href, format: "module-typescript", shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
"#;

fn lines(bytes: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::to_owned)
        .collect()
}

/// What a run compared, and what it found.
#[derive(Debug, Default)]
pub struct Report {
    /// Exported functions with scalar arguments and a scalar result.
    pub functions: usize,
    /// Cases both sides reached.
    pub checked: usize,
    /// Cases the pool asked for. Larger than `checked` when a side ran out of
    /// time, which a pool value in a loop bound will do.
    pub expected: usize,
    /// Cases the compiled program declined to answer -- an index its `!`
    /// promised was in range and was not, most often.
    pub refused: usize,
    /// Cases that differed in the last bits of a result the specification
    /// leaves approximate, and were accepted for that reason. Reported rather
    /// than swallowed: a tolerance nobody can see is a tolerance nobody can
    /// tell has grown.
    pub approximated: usize,
    /// Every disagreement, as the two lines that differ.
    pub disagreements: Vec<(String, String)>,
}

impl Report {
    /// Whether the two sides agreed on everything they both reached.
    #[must_use]
    pub fn agreed(&self) -> bool {
        self.disagreements.is_empty()
    }
}

fn report(
    native: &[String],
    engine: &[String],
    testable: &[Testable],
    refused: &[usize],
    approximate: &std::collections::HashSet<String>,
) -> Report {
    // The native side skipped the cases it refused, so the node side's lines
    // are dropped at the same indices to line the two up again. Dropping rather
    // than comparing is the right thing: node answered `undefined` where the
    // compiled program declined to answer at all, and that is a difference
    // between the two languages rather than between the two compilers.
    let engine: Vec<&String> = engine
        .iter()
        .enumerate()
        .filter(|(at, _)| !refused.contains(at))
        .map(|(_, line)| line)
        .collect();

    let checked = native.len().min(engine.len());
    let mut disagreements = Vec::new();
    let mut approximated = 0;
    for at in 0..checked {
        let name = native[at].split(' ').next().unwrap_or_default();
        let loose = approximate.contains(name);
        if native[at] == *engine[at] {
            continue;
        }
        if agrees(&native[at], engine[at], loose) {
            approximated += 1;
            continue;
        }
        disagreements.push((native[at].clone(), engine[at].clone()));
    }
    Report {
        functions: testable.len(),
        checked,
        expected: testable.iter().map(|one| tuples(&one.params).len()).sum(),
        refused: refused.len(),
        approximated,
        disagreements,
    }
}

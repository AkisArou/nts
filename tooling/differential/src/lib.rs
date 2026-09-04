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
use nts_codegen_common::Backend;
use nts_core::hir::facts::Facts;
use nts_core::hir::{self, HirType};
use nts_frontend_ts::TsgoApi;

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

/// How much address space either side may claim, in bytes.
///
/// The pool above is deliberately hostile and no analysis here can tell which
/// parameter is a loop bound -- that is already said of *time*, and memory is
/// the same hazard through a different door: `selfCycle(9007199254740991)`
/// allocates once per iteration, so it exhausts a machine long before twenty
/// seconds are up.
///
/// Bounding it is not a nicety. Unbounded, the outcome depends on how much RAM
/// the machine has: where `malloc` fails early the runtime declines the case
/// and the run continues, and where it succeeds the kernel's OOM killer picks a
/// victim -- which on a large machine was the *harness*, and on occasion the
/// terminal that started it. The same suite passed on a 16GB laptop and took
/// down a 32GB desktop.
///
/// Two gigabytes is far more than any example needs and far less than a
/// runaway wants, so it separates the two without tuning.
const MEMORY: &str = "2147483648";

/// How many times the compiled program may end before the run gives up.
///
/// A handful is a program with a few assertions this pool falsifies. Hundreds is
/// something else, and continuing to restart would take all day to say so.
const REFUSALS: usize = 16;

/// A child of this harness, bounded in both dimensions.
///
/// One place, because both sides are driven by the same hostile pool and a
/// bound that only one of them has is a bound that reports a disagreement where
/// there is none. `prlimit` and `timeout` rather than the equivalents in this
/// process: the limits have to apply to the child and to whatever it spawns,
/// and both utilities are already how this runs its children.
fn bounded(program: &str) -> std::process::Command {
    let mut command = std::process::Command::new("prlimit");
    command
        .arg(format!("--as={MEMORY}"))
        .arg("timeout")
        .arg(TIMEOUT)
        .arg(program);
    command
}

/// A working directory that removes itself.
///
/// # Why this is a guard rather than a call at the end
///
/// Every run of this harness writes a program, a runtime, a driver and a linked
/// binary into a fresh directory, and `check` has a dozen early returns -- a
/// program that does not typecheck, a backend that declines a function, clang
/// rejecting a module. A `remove_dir_all` at the bottom is reached by none of
/// them.
///
/// Left uncleaned, these accumulated to **twelve gigabytes** on a machine where
/// `/tmp` is a 16G tmpfs. That is not disk: it is RAM taken away from whatever
/// else is running, including a benchmark run's working set, and it varies over
/// the run as directories come and go. `javac` failing with
/// `Disk quota exceeded` is how it was found, which is a long way from the
/// cause.
///
/// `NTS_KEEP_TEMP=1` keeps it, because the emitted program and the linked
/// binary are exactly what somebody debugging a disagreement wants to look at.
struct Scratch {
    path: Utf8PathBuf,
}

impl Scratch {
    fn holding(path: Utf8PathBuf) -> Self {
        Self { path }
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        if std::env::var_os("NTS_KEEP_TEMP").is_some() {
            eprintln!("  kept {} (NTS_KEEP_TEMP)", self.path);
            return;
        }
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

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
        // As with the promise below: the harness never drives one, because it
        // generates calls from scalar signatures, so this is here to be right
        // rather than to be reached.
        HirType::Managed(
            nts_core::hir::ManagedType::Map(_, _) | nts_core::hir::ManagedType::Set(_),
        ) => "NtsMap *",
        HirType::Bool => "bool",
        // The runtime's struct. The differential never drives one directly --
        // it generates calls from scalar signatures -- so this appears only
        // where an erased value is somewhere else in a compiled program.
        HirType::Erased => "NtsValue",
        // The harness drives scalar signatures and a `bigint` is not one it can
        // generate a value for, so this is here to be right rather than to be
        // reached.
        HirType::BigInt => "__int128",
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
    // The tool's identity, so a rebuilt frontend does not read entries the old
    // one wrote. Size and modified time rather than a hash of the binary: it is
    // eighty megabytes and this runs once per check.
    let stamp = std::fs::metadata(&tsgo).ok().map_or_else(
        || tsgo.clone(),
        |data| {
            format!(
                "{tsgo}:{}:{:?}",
                data.len(),
                data.modified().ok().map(|at| at
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs())
            )
        },
    );
    let mut source = TsgoApi::for_compilation(tsgo);
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, &stamp)?;
    if snapshot.has_errors() {
        for diagnostic in &snapshot.diagnostics {
            eprintln!("{} {}", diagnostic.code, diagnostic.message);
        }
        bail!("the program does not typecheck");
    }

    // `NTS_RC=1` compiles the program *and* the runtime for reference counting.
    // Both halves matter and they have to agree: the provider decides what the
    // compiler emits, not only what the runtime does with it, so selecting one
    // without the other compares a program that never releases against an
    // allocator that expects it to.
    let options = hir::Options {
        provider: if std::env::var("NTS_RC").is_ok_and(|value| value != "0") {
            hir::Provider::ReferenceCounting
        } else {
            hir::Provider::NoGc
        },
        ..hir::Options::default()
    };
    let prepared = match hir::prepare_with(&snapshot, &options) {
        Ok(prepared) => prepared,
        Err(problems) => bail!("invalid HIR: {problems:?}"),
    };
    for diagnostic in &prepared.diagnostics {
        eprintln!("  refused: {} {}", diagnostic.code, diagnostic.message);
    }

    let entry = entry_module(&snapshot)?;
    let importable = exports_of(&snapshot, &entry);
    // A module that exports `then` *is a thenable*. `await import(m)` sees the
    // property, decides the namespace object is a promise, and calls it with a
    // resolve function that the export -- being an ordinary function -- never
    // invokes. The import never settles, and node reports it as an unsettled
    // top-level await pointing at the driver rather than at the cause.
    //
    // Nothing to do with this compiler: a hand-written module exporting `then`
    // behaves the same. But the differential cannot check one, and saying so
    // beats letting the run hang and blaming the harness.
    if importable.contains("then") {
        bail!(
            "the entry module exports `then`, which makes its namespace object a \
             thenable -- `await import()` on it never resolves, so no differential \
             can run against node"
        );
    }
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
    let dir = Scratch::holding(dir);
    let dir = &dir.path;

    let mut refused = Vec::new();
    let mut aborts = Vec::new();
    // Which lane runs. The JVM is a sibling rather than a third arm of
    // `render`, because a JVM program is a directory of classes driven by
    // `java` -- a different artifact *and* a different runner, where C and
    // LLVM differ only in what they hand the same linker.
    let native = if Backend::from_environment()? == Backend::Jvm {
        run_jvm(dir, &prepared.program, &testable, &mut refused, &mut aborts)?
    } else {
        run_native(dir, &prepared.program, &testable, &mut refused, &mut aborts)?
    };
    let engine = run_node(dir, &entry, &testable)?;
    let approximate = nts_core::hir::builtin::approximating(&prepared.program);
    let mut report = report(&native, &engine, &testable, &refused, &approximate);
    report.aborts = aborts;
    Ok(report)
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
         \x20   /* Until it settles, not until the loop falls quiet. `await` on\n\
         \x20    * node returns when its promise does, and the two differ as\n\
         \x20    * soon as timers exist: a program that left another timer\n\
         \x20    * pending would have it fire on this side and not on node's. */\n\
         \x20   uint32_t budget = 1000000;\n\
         \x20   while (p->state == NTS_PROMISE_PENDING && budget > 0) {\n\
         \x20       if (!nts_test_host_step()) { break; }\n\
         \x20       budget--;\n\
         \x20   }\n\
         \x20   if (budget == 0) {\n\
         \x20       printf(\"%s %d starved\\n\", name, at);\n\
         \x20       fflush(stdout);\n\
         \x20       return;\n\
         \x20   }\n\
         \x20   if (p->state == NTS_PROMISE_FULFILLED\n\
         \x20       && nts_value_tag(p->value) == NTS_TAG_NUMBER) {\n\
         \x20       show(name, at, nts_value_number(p->value));\n\
         \x20       return;\n\
         \x20   }\n\
         \x20   if (p->state == NTS_PROMISE_FULFILLED\n\
         \x20       && NTS_TAG_IS_REFERENCE(nts_value_tag(p->value))) {\n\
         \x20       show_string(name, at,\n\
         \x20                   (const NtsString *)nts_value_reference(p->value));\n\
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

fn native_harness(testable: &[Testable], initializes: bool) -> String {
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
    if initializes {
        // Before any case, and before the first checkpoint: module evaluation
        // is itself a job, so what it queues is drained after it rather than
        // interleaved with it. Node's `await import()` does the same thing on
        // the other side, which is what makes the two comparable.
        main.push_str(
            "    void module__init(void);\n\
             \x20   module__init();\n\
             \x20   /* Module evaluation is itself a job, so what it queued is\n\
             \x20    * drained here rather than interleaved with the first\n\
             \x20    * case. */\n\
             \x20   nts_enter();\n\
             \x20   nts_leave();\n",
        );
    }
    let mut baselined = false;
    for (one, at, tuple) in interleaved(testable) {
        {
            // A string argument is *made* here, so it is this driver's to give
            // back. Built into named temporaries rather than inline so there is
            // something to release: the liveness check at the end measures what
            // the program holds, and a driver that kept every argument it built
            // would report its own hoard as the program's leak. It did.
            let (built, args, given_back) = arguments(one, &tuple);
            let call = format!(
                "{}({})",
                nts_codegen_c::c_identifier(&one.name),
                args.join(", ")
            );
            // A returned reference is the caller's, and this driver is the
            // caller. Releasing it is not tidiness: the liveness check at the
            // end measures what the *program* still holds, and a harness that
            // kept every string it printed would report its own hoard as the
            // program's leak. It did, until this line existed.
            let show = if settles_with(&one.returns).is_some() {
                format!(
                    "{{ NtsPromise *held = {call}; show_settled(\"{}\", {at}, held); \
                     nts_release((NtsHeader *)held); }}",
                    one.name
                )
            } else if is_string(&one.returns) {
                format!(
                    "{{ NtsString *held = {call}; show_string(\"{}\", {at}, held); \
                     nts_release((NtsHeader *)held); }}",
                    one.name
                )
            } else {
                format!("show(\"{}\", {at}, (double){call});", one.name)
            };
            let _ = writeln!(
                main,
                "    if (++at_case >= from) {{ {built}{show}{given_back} }}"
            );
            // The baseline, taken after the first case rather than before it:
            // whatever a module sets up on the way to answering once is state
            // it is entitled to keep, and the question is only whether the
            // rest of the run adds to it.
            if !baselined {
                baselined = true;
                main.push_str(
                    "#ifdef NTS_PROVIDER_RC\n                     \x20   nts_collect_cycles();\n                     \x20   fprintf(stderr, \"nts-live-first %zu\\n\", nts_live_count());\n                     #endif\n",
                );
            }
        }
    }
    // What the program still holds, once and again.
    //
    // Agreement cannot see a leak: a function that never gives an object back
    // answers exactly as well as one that does, and under the default provider
    // nothing is freed anyway so there is nothing to see. This is the other
    // half of the question, and it is only asked under a provider that frees.
    //
    // Two points rather than one, because "zero at the end" is the wrong
    // expectation: a module may legitimately hold state for the whole run. What
    // must not happen is *growth* between one case and the last, and a
    // collection is forced at each point so that what is merely awaiting the
    // cycle collector is not counted as held.
    main.push_str(
        "#ifdef NTS_PROVIDER_RC\n         \x20   nts_test_host_drain();\n         \x20   nts_collect_cycles();\n         \x20   fprintf(stderr, \"nts-live-end %zu\\n\", nts_live_count());\n         #endif\n         \x20   return 0;\n}\n",
    );
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
/// Why the backend did not produce C that compiles.
///
/// Two outcomes, and they are not the same failure. The backend *declining* is
/// a refusal like any other -- it named a construct and emitted nothing -- and
/// belongs in the refusal bucket. clang rejecting what we wrote means the
/// output is malformed, which is the row that must reach zero.
///
/// They were one `Err(String)`, so a named backend refusal was counted as
/// `uncompilable C`. That is the same category error as the `rc` list carrying
/// two fixtures that must fail: a number is only worth ratcheting if everything
/// in it is the thing the number is named after.
#[derive(Debug)]
pub enum NotC {
    Refused(String),
    Rejected(String),
}

impl std::fmt::Display for NotC {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Refused(what) | Self::Rejected(what) => f.write_str(what),
        }
    }
}

pub fn compiles(program: &hir::Program, dir: &Utf8Path) -> Result<(), NotC> {
    let emitted = nts_codegen_c::emit(program);
    if !emitted.diagnostics.is_empty() {
        return Err(NotC::Refused(
            emitted
                .diagnostics
                .iter()
                .map(|diagnostic| diagnostic.message.clone())
                .collect::<Vec<_>>()
                .join("; "),
        ));
    }
    let generated = dir.join("program.c");
    std::fs::write(&generated, emitted.writer.text()).map_err(|error| NotC::Rejected(error.to_string()))?;
    std::fs::write(
        dir.join(nts_codegen_c::RUNTIME_HEADER_NAME),
        nts_codegen_c::RUNTIME_HEADER,
    )
    .map_err(|error| NotC::Rejected(error.to_string()))?;
    let build = std::process::Command::new("clang")
        .args(["-std=c11", "-fsyntax-only", "-w"])
        .arg("-I")
        .arg(dir)
        .arg(&generated)
        .output()
        .map_err(|error| NotC::Rejected(error.to_string()))?;
    if build.status.success() {
        return Ok(());
    }
    Err(NotC::Rejected(
        String::from_utf8_lossy(&build.stderr)
            .lines()
            .find(|line| line.contains("error"))
            .unwrap_or("clang rejected the generated C")
            .trim()
            .to_owned(),
    ))
}

/// How the runtime says "the program correctly declined", as opposed to
/// "something here is broken".
///
/// A refusal is the program stopping on input the language does not permit --
/// an index outside an array, a string longer than a string can be. JavaScript
/// throws there and a compiled program without exceptions stops, so neither
/// side produces a value and the case is skipped. Anything else that aborts is
/// a defect and fails the run.
///
/// The distinction matters because a decline does not fail a run. Putting an
/// async frame back on the C stack -- a use-after-free -- showed up as
/// seventeen declines and a report that said "agreed on every case", which is
/// the hole this closes.
///
/// Matching a *prefix the runtime chooses*, not the text of one message. The
/// first version matched `"is outside ["`, and the first full run over the
/// examples reported `String.repeat` overflowing as a defect -- a refusal as
/// legitimate as the index one, and one of three rather than one of one.
const REFUSED: &str = "nts: refused: ";

/// And what it prints when it runs out of the memory this harness allowed it.
///
/// Neither a defect nor a refusal. The pool asks for a loop bound of
/// 9,007,199,254,740,991 and a program that allocates once per iteration does
/// exactly what that asks; the answer is that the case cannot be run, not that
/// the compiler is wrong. It is [`TIMEOUT`]'s hazard through a different door
/// and is counted the same way -- the case is not reached, the run continues,
/// and the total says how many were.
const EXHAUSTED: &str = "nts: out of memory";

/// Why a run stopped before its last case.
///
/// Two outcomes, and conflating them is what let a segfault be reported as
/// agreement. A *decline* is the program correctly refusing its input, and it
/// says so on stderr before it stops. A *defect* is anything else.
#[derive(Debug, PartialEq, Eq)]
enum Stopped {
    Declined,
    Defect(String),
}

/// The signal that killed a child, if one did.
fn signal_of(status: std::process::ExitStatus) -> Option<i32> {
    std::os::unix::process::ExitStatusExt::signal(&status)
}

/// Classify a run that ended early, from how it died and what it said.
///
/// The rule that was missing: **a program killed by a signal that printed no
/// refusal at all is a defect**, not a decline. Both of this week's worst bugs
/// hid exactly there. `examples/map-and-set` segfaulted on every case under
/// reference counting and the gate counted it as passing; `examples/async`
/// reached 263 of 928 cases for the same reason, and the cycle collector's
/// blind spot sat behind it. In both, stdout was buffered and lost with the
/// crash, so there was nothing to compare and nothing to complain about.
///
/// A timeout is not a signal here -- `timeout` exits 124 of its own accord --
/// so a case that takes too long stays what it was: not reached, and not a
/// verdict. An `abort()` *after* a refusal keeps its refusal line and stays a
/// decline, which is what every bounds check does.
fn stopped(signal: Option<i32>, complaint: &str) -> Stopped {
    if let Some(line) = complaint.lines().find(|line| {
        line.starts_with("nts:")
            && !line.starts_with(REFUSED)
            && !line.starts_with(EXHAUSTED)
    }) {
        return Stopped::Defect(line.trim().to_owned());
    }
    let said_something = complaint
        .lines()
        .any(|line| line.starts_with(REFUSED) || line.starts_with(EXHAUSTED));
    match signal {
        Some(number) if !said_something => Stopped::Defect(format!(
            "the program was killed by signal {number} without refusing \
             anything -- a crash, not a declined case"
        )),
        _ => Stopped::Declined,
    }
}

/// Write the program in whichever form the chosen backend produces, and hand
/// back the file the final link should take.
///
/// The C path writes a translation unit; the LLVM path writes a module and
/// assembles it here, so that a rejected module is reported as one rather than
/// as a C error about a file clang was not expecting.
fn render(
    dir: &Utf8Path,
    program: &hir::Program,
    backend: Backend,
    emitted: &nts_codegen_c::Emitted,
) -> Result<Utf8PathBuf> {
    if backend == Backend::Jvm {
        // Not a native object and not linked with clang: a JVM program is a
        // directory of classes run by `java`, which is a different runner
        // rather than a different arm of this one.
        bail!("the JVM backend produces class files, which this driver cannot link");
    }
    Ok(if backend == Backend::Llvm {
        let rendered = nts_codegen_llvm::emit(program);
        if !rendered.diagnostics.is_empty() {
            for diagnostic in rendered.diagnostics.iter().take(3) {
                eprintln!("  not rendered: {} {}", diagnostic.code, diagnostic.message);
            }
            bail!(
                "the LLVM backend declined {} function(s)",
                rendered.diagnostics.len()
            );
        }
        let path = dir.join("program.ll");
        std::fs::write(&path, &rendered.text)?;
        // Assembled here rather than handed to the final link, so that a
        // rejected module is reported as one rather than as a C error about a
        // file clang was not expecting.
        let object = dir.join("program.o");
        let assembled = std::process::Command::new("clang")
            .args(["-x", "ir", "-c", "-w", "-O1"])
            .arg(&path)
            .arg("-o")
            .arg(&object)
            .output()
            .context("assembling the emitted LLVM IR")?;
        if !assembled.status.success() {
            bail!(
                "clang rejected the emitted LLVM IR: {}",
                String::from_utf8_lossy(&assembled.stderr)
                    .lines()
                    .find(|line| line.contains("error"))
                    .unwrap_or("no message")
            );
        }
        object
    } else {
        let path = dir.join("program.c");
        std::fs::write(&path, emitted.writer.text())?;
        path
        })
}

fn run_native(
    dir: &Utf8Path,
    program: &hir::Program,
    testable: &[Testable],
    refused: &mut Vec<usize>,
    aborts: &mut Vec<String>,
) -> Result<Vec<String>> {
    // Which backend renders the program.
    //
    // `NTS_BACKEND` runs the whole differential -- every example, every case,
    // the same hostile pool, the same comparison against node -- through the
    // named backend instead of the C one. That is a far stronger net than
    // comparing the two backends against each other on a handful of fixtures:
    // node is the oracle either way, and if both backends agree with node they
    // agree with each other.
    //
    // A function the LLVM backend has not learned to render yet is *absent*,
    // and the driver would fail to link, so an example is either wholly
    // rendered or reported as declined. That makes "how many examples does the
    // second backend carry" a number, which is the shape worth ratcheting.
    // An unrecognised name is an error rather than a fallback to C. It used to
    // be `is_ok_and(|which| which == "llvm")`, so `NTS_BACKEND=llvmm` ran the C
    // backend and the gate's llvm floor reported green having measured the
    // wrong lane -- a quiet trap with two backends and a certainty with three,
    // since `llvm` and `jvm` differ by one character.
    let backend = Backend::from_environment()?;
    let emitted = nts_codegen_c::emit(program);
    // The backend's own refusals, which used to be dropped on the floor here.
    // A function the emitter cannot write is *absent* from the C, and the
    // driver below still calls it -- so the run died at the linker with an
    // undefined reference and no hint of which construct was behind it. The
    // lowering's refusals were printed all along; these were not.
    for diagnostic in &emitted.diagnostics {
        eprintln!("  not emitted: {} {}", diagnostic.code, diagnostic.message);
    }
    if !emitted.diagnostics.is_empty() {
        // Stop here rather than at the linker. The driver calls every function
        // the *lowering* produced, and one the backend then declined to write
        // is an undefined reference -- which reports a symbol name and nothing
        // about the construct, and takes the whole run down with it however
        // many other functions were fine.
        bail!(
            "the backend declined {} function(s), listed above; nothing can be \
             checked until they are removed or supported",
            emitted.diagnostics.len()
        );
    }
    let generated = render(dir, program, backend, &emitted)?;
    // The runtime, plus the Unicode tables when this program converts case.
    // Every `.c` among them goes on the command line below, so a helper that
    // arrives with a new translation unit needs no change here.
    let mut sources = Vec::new();
    for file in emitted.support_files() {
        let path = file.write(dir.as_std_path())?;
        if file.compiled {
            sources.push(Utf8PathBuf::from_path_buf(path).unwrap_or_default());
        }
    }
    // The deterministic host, so a compiled `async` function has a loop to be
    // driven to quiescence on. Virtual time and one thread: the differential
    // must not depend on a wall clock.
    let host_header = dir.join("nts_test_host.h");
    std::fs::write(&host_header, TEST_HOST_HEADER)?;
    let host = dir.join("nts_test_host.c");
    std::fs::write(&host, TEST_HOST_SOURCE)?;

    // Module evaluation, which node does at `import` and this side has to be
    // told to do. Only when the program has one: a program with no top-level
    // statements emits no such function, and calling it would be a link error.
    let initializes = program
        .funcs
        .iter()
        .any(|func| func.name == hir::lower::MODULE_INIT);
    let main = native_harness(testable, initializes);
    let main_path = dir.join("check_main.c");
    std::fs::write(&main_path, main)?;

    let binary = dir.join("check");
    // `NTS_POISON=1` fills every uninitialized allocation with a non-zero
    // pattern. The compiler emits one only where it believes the lowering
    // writes every slot; running the suite under this is what turns that
    // belief into a checked claim, since an unwritten slot then reads as a
    // conspicuous value rather than as whatever the allocator left.
    let poison = std::env::var("NTS_POISON").is_ok_and(|value| value != "0");
    // `NTS_RC=1` builds against the reference-counting provider instead of the
    // bump allocator.
    //
    // The retains and releases in the emitted C are the compiler's own work,
    // and under the default provider nothing is ever freed -- so a release too
    // few leaks where nobody looks and a release too many is never observed.
    // Both become visible here: too many frees an object something still holds,
    // and with `NTS_POISON` the next read of it is a conspicuous pattern rather
    // than whatever the allocator left.
    let counted = std::env::var("NTS_RC").is_ok_and(|value| value != "0");
    let mut defines: Vec<&str> = Vec::new();
    if poison {
        defines.push("-DNTS_POISON=1");
    }
    if counted {
        defines.push("-DNTS_PROVIDER_RC");
    }
    let build = std::process::Command::new("clang")
        .args(["-std=c11", "-O1", "-w"])
        .args(&defines)
        .arg("-I")
        .arg(dir)
        .arg("-o")
        .arg(&binary)
        .arg(&main_path)
        .arg(&generated)
        .args(&sources)
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
    collect_restarting(interleaved(testable).len(), refused, aborts, |from| {
        bounded(binary.as_str())
            .arg(from.to_string())
            .output()
            .context("running the compiled program")
    })
}

/// Run a case set, restarting past whatever ends it.
///
/// A case can end the process -- an out-of-range index is the program keeping
/// the promise its `!` made -- and without restarting, one such case costs
/// every case after it. Node answers `undefined` for the same input, so the two
/// had nothing to compare there anyway; what matters is that the *rest* of the
/// program still gets checked.
///
/// Shared by both runners rather than written twice. The two lanes produce
/// different artifacts and start them differently, but "what does a run that
/// stopped early mean" is one question, and two answers to it would be two
/// different accountings of the same refusal.
fn collect_restarting(
    total: usize,
    refused: &mut Vec<usize>,
    aborts: &mut Vec<String>,
    run_from: impl Fn(usize) -> Result<std::process::Output>,
) -> Result<Vec<String>> {
    let mut collected: Vec<String> = Vec::new();
    let mut from = 0;
    let mut restarts = 0;
    while from < total && restarts <= REFUSALS {
        let run = run_from(from)?;
        let produced = lines(&run.stdout);
        let reached = produced.len();
        collected.extend(produced);
        let complaint = String::from_utf8_lossy(&run.stderr);
        // What the program still held, once and at the end. Only under a
        // provider that frees, and on stderr because stdout is the comparison.
        //
        // Growth between the two is a leak: agreement cannot see one -- a
        // function that never gives an object back answers exactly as well as
        // one that does -- and this is the only place that asks.
        if let Some(grew) = growth(&complaint) {
            aborts.push(grew);
        }
        if reached == total - from {
            break;
        }
        match stopped(signal_of(run.status), &complaint) {
            Stopped::Declined => {}
            Stopped::Defect(what) => aborts.push(what),
        }
        // The case after the last one that printed. A refusal leaves a gap on
        // this side, and the node side is trimmed to match by index below.
        refused.push(from + reached);
        from += reached + 1;
        restarts += 1;
    }
    Ok(collected)
}

/// The JVM lane: classes, a jar, and `java`.
///
/// Everything upstream of this is shared -- the same HIR, the same testable
/// set, the same hostile pool, the same comparison against node. What differs
/// is that the artifact is a directory of class files rather than a linked
/// binary, so there is nothing for `render` to hand a linker and this is a
/// sibling of `run_native` rather than a third arm of it.
fn run_jvm(
    dir: &Utf8Path,
    program: &hir::Program,
    testable: &[Testable],
    refused: &mut Vec<usize>,
    aborts: &mut Vec<String>,
) -> Result<Vec<String>> {
    let emitted = nts_codegen_jvm::emit(program);
    for diagnostic in &emitted.diagnostics {
        eprintln!("  not emitted: {} {}", diagnostic.code, diagnostic.message);
    }
    if !emitted.diagnostics.is_empty() {
        // The same rule the C arm keeps: stop here rather than at the point of
        // use. A method the backend declined is *absent*, and the harness
        // reflects for it by name -- so the failure would arrive as a
        // `NoSuchMethodException` naming a method and nothing about the
        // construct behind it.
        bail!(
            "the backend declined {} function(s), listed above; nothing can be \
             checked until they are removed or supported",
            emitted.diagnostics.len()
        );
    }
    for class in &emitted.classes {
        let path = dir.join(class.path());
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, &class.bytes)?;
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::RUNTIME_JAR)?;

    // The cases, as data. Generating and compiling a driver per case set would
    // put `javac` in this loop -- some 300ms against nine hundred cases -- to
    // build something thrown away immediately. `nts/rt/Check` is compiled once
    // into the jar and reflects; it is slow, and a correctness harness is the
    // one place that does not matter.
    let mut cases = String::new();
    for (one, at, tuple) in interleaved(testable) {
        let Some(returns) = nts_codegen_jvm::types::descriptor(program, &one.returns) else {
            bail!("`{}` returns a type the JVM backend rendered but this harness cannot", one.name);
        };
        let mut parameters = String::new();
        for (ty, _) in &one.params {
            let Some(descriptor) = nts_codegen_jvm::types::descriptor(program, ty) else {
                bail!("`{}` takes a type the JVM backend rendered but this harness cannot", one.name);
            };
            parameters.push_str(&descriptor);
        }
        let _ = write!(
            cases,
            "{} {at} {returns} {}",
            nts_codegen_jvm::body::method_name(&one.name),
            if parameters.is_empty() { "-" } else { &parameters }
        );
        // Bit patterns rather than decimal: the pool contains values whose
        // shortest decimal is not their whole story, and a harness that lost a
        // bit in transit would report a disagreement it caused itself.
        for (slot, value) in tuple.iter().enumerate() {
            let descriptor = parameters.as_bytes().get(slot).copied().unwrap_or(b'D');
            representable(*value, descriptor).with_context(|| {
                format!("parameter {slot} of `{}`", one.name)
            })?;
            let _ = write!(cases, " {:016x}", value.to_bits());
        }
        cases.push('\n');
    }
    let cases_path = dir.join("cases.txt");
    std::fs::write(&cases_path, cases)?;

    let classpath = format!("{dir}:{jar}");
    collect_restarting(interleaved(testable).len(), refused, aborts, move |from| {
        bounded_jvm()
            .arg("-cp")
            .arg(&classpath)
            .arg("nts.rt.Check")
            .arg(cases_path.as_str())
            .arg(from.to_string())
            .output()
            .context("running the compiled classes")
    })
}

/// Whether a pool value is one the parameter's proved type can hold.
///
/// # Why this refuses rather than casts
///
/// The pool is doubles whatever the parameter is, so both harnesses have to
/// narrow. The C driver writes the narrowing as a literal cast in generated
/// source, where out of range is undefined and clang picks; this side would
/// narrow at run time, where the JVM saturates. The instinct is to make one
/// match the other.
///
/// That is the wrong goal, and asking which of them matches *node* shows why:
/// neither, because in the source there is no `int32` parameter at all. It is
/// `number`, and `I` exists only because the compiler **proved** the value is an
/// int32. So a pool value outside that range means one of two things -- the
/// proof is wrong, or [`inputs`] ignored it -- and both are findings.
///
/// Two harnesses quietly agreeing on a value the source cannot produce is
/// strictly worse than two that disagree, because the disagreement is at least
/// visible. So the narrowing is a checked claim rather than a conversion, and
/// if it never fires an assumption has become a checked one for nothing.
#[allow(
    clippy::cast_possible_truncation,
    reason = "the narrowing is the question: the round trip is what answers it"
)]
#[allow(
    clippy::float_cmp,
    reason = "exactness is the question. A tolerance here would accept a value \
              the parameter's proved type cannot hold, which is the thing being \
              checked -- and `-0.0 == 0.0` is wanted, since a boolean parameter \
              given the negative zero the pool carries is `false` on both sides"
)]
fn representable(value: f64, descriptor: u8) -> Result<()> {
    let whole = value.fract() == 0.0 && value.is_finite();
    let ok = match descriptor {
        b'D' => true,
        b'F' => f64::from(value as f32) == value,
        b'Z' => value == 0.0 || value == 1.0,
        b'J' => whole && value >= -(2f64.powi(63)) && value < 2f64.powi(63),
        _ => whole && value >= f64::from(i32::MIN) && value <= f64::from(i32::MAX),
    };
    if ok {
        return Ok(());
    }
    bail!(
        "the pool offered {value} to a parameter the compiler proved is `{}` -- \
         either that proof is wrong or the pool filter ignored it, and casting \
         here would hide whichever it is",
        descriptor as char
    );
}

/// A JVM child, bounded -- but not the way a native one is.
///
/// `bounded` caps *address space* at two gigabytes, which is right for a native
/// program and fatal for this one: `HotSpot` reserves far more virtual address
/// space than it commits -- heap, code cache, metaspace, GC structures -- and a
/// two-gigabyte `--as` stops it before `main`. The equivalent bound here is on
/// the heap, which is what a runaway actually consumes, so it is `-Xmx` and the
/// same timeout rather than `prlimit`.
///
/// `-XX:TieredStopAtLevel=1` and `-Xshare:auto` are not tuning: a correctness
/// harness runs each case once, so time spent in C2 is time spent compiling
/// code that runs a handful of times.
fn bounded_jvm() -> std::process::Command {
    let java = std::env::var("JAVA_HOME")
        .map_or_else(|_| "java".to_owned(), |home| format!("{home}/bin/java"));
    let mut command = std::process::Command::new("timeout");
    command
        .arg(TIMEOUT)
        .arg(java)
        .arg("-Xmx512m")
        .arg("-XX:MaxMetaspaceSize=128m")
        .arg("-XX:TieredStopAtLevel=1")
        .arg("-XX:-UsePerfData");
    command
}

/// One case's arguments: what to build, what to pass, what to give back.
///
/// A string argument is *made* here, so it is this driver's to release. Built
/// into named temporaries rather than passed inline because there has to be
/// something to release -- the liveness check measures what the *program*
/// holds, and a driver that kept every string it built reported its own hoard
/// as the program's leak. It did, on three examples.
fn arguments(one: &Testable, tuple: &[f64]) -> (String, Vec<String>, String) {
    let mut built = String::new();
    let mut given_back = String::new();
    let mut args = Vec::new();
    for (slot, (value, (ty, _))) in tuple.iter().zip(&one.params).enumerate() {
        if is_string(ty) {
            let _ = write!(
                built,
                "NtsString *arg{slot} = {}; ",
                c_string(string_at(*value))
            );
            let _ = write!(given_back, " nts_release((NtsHeader *)arg{slot});");
            args.push(format!("arg{slot}"));
        } else {
            args.push(format!("({}){}", c_type(ty), literal(*value)));
        }
    }
    (built, args, given_back)
}

/// What the program still held, once and at the end, and whether it grew.
///
/// Only under a provider that frees, and read from stderr because stdout is the
/// comparison. Agreement cannot see a leak -- a function that never gives an
/// object back answers exactly as well as one that does -- so this is the only
/// place that asks.
fn growth(complaint: &str) -> Option<String> {
    let held = |marker: &str| {
        complaint
            .lines()
            .filter_map(|line| line.strip_prefix(marker))
            .filter_map(|rest| rest.trim().parse::<u64>().ok())
            .next_back()
    };
    let first = held("nts-live-first ")?;
    let end = held("nts-live-end ")?;
    (end > first).then(|| {
        format!(
            "held {first} object(s) after the first case and {end} at the end, so {} were \
             never given back",
            end - first
        )
    })
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
            // A rejected promise makes `await` throw, and an uncaught throw
            // ends the driver -- so one rejecting case cost every case after
            // it. Caught, "rejected" is an answer, and it is the same answer
            // the native side prints, so the two compare.
            let _ = match payload {
                Some(HirType::Void) => writeln!(
                    driver,
                    "try {{ await {call}; process.stdout.write(`{} {at} undefined\n`); }} \
                     catch {{ process.stdout.write(`{} {at} rejected\n`); }}",
                    one.name, one.name
                ),
                Some(_) => writeln!(
                    driver,
                    "try {{ {show}({:?}, {at}, await {call}); }} \
                     catch {{ process.stdout.write(`{} {at} rejected\n`); }}",
                    one.name, one.name
                ),
                None => writeln!(driver, "{show}({:?}, {at}, {call});", one.name),
            };
        }
    }
    let path = dir.join("check_driver.mjs");
    std::fs::write(&path, driver)?;
    let hook = dir.join("resolve_ts.mjs");
    std::fs::write(&hook, RESOLVE_TS)?;

    let run = bounded("node")
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
    /// Aborts the compiled program ended a case on that were *not* the one a
    /// program is allowed to make. See [`EXPECTED_ABORT`].
    pub aborts: Vec<String>,
}

impl Report {
    /// Whether the two sides agreed on everything they both reached.
    ///
    /// A run that reached *nothing* agreed on nothing, and this used not to
    /// say so. Every case declining is how a program that stops on all input
    /// looks from here, and the report printed `checked 0 of 29 cases` and
    /// `agreed on every case` one line apart -- over a module whose global was
    /// never initialized, because the initializer had been refused and the
    /// functions reading it were emitted anyway.
    ///
    /// The declines themselves are legitimate and stay tolerated: `xs.at(i)!`
    /// out of range is the program's own assertion failing, and node answers
    /// `undefined` where the compiled program stops, so there is nothing to
    /// compare. What is not legitimate is calling a run agreed when it is
    /// *all* of them.
    #[must_use]
    pub fn agreed(&self) -> bool {
        self.checked > 0 && self.disagreements.is_empty() && self.aborts.is_empty()
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
        aborts: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{stopped, Stopped};

    /// The distinction the whole check rests on, asked of each case that has
    /// actually occurred.
    ///
    /// Written because the classification it replaces had no test and was
    /// wrong in the one direction that matters: a program that said nothing at
    /// all was filed as a declined case, which is how a segfault on every case
    /// came to be reported as agreement.
    #[test]
    fn a_silent_death_is_a_defect_and_a_refusal_is_not() {
        // A bounds check: it refuses, prints, then aborts. SIGABRT with a
        // refusal line is the program keeping the promise its `!` made.
        assert_eq!(
            stopped(Some(6), "nts: refused: index 9 is outside [0, 3)\n"),
            Stopped::Declined,
        );
        // Out of the memory this harness allowed: not reached, not a verdict.
        assert_eq!(
            stopped(Some(9), "nts: out of memory\n"),
            Stopped::Declined,
        );
        // A timeout. `timeout` exits of its own accord, so there is no signal
        // on the child and nothing was printed.
        assert_eq!(stopped(None, ""), Stopped::Declined);
        // A segfault that printed nothing. This is the case that was missing.
        assert!(matches!(stopped(Some(11), ""), Stopped::Defect(_)));
        // And one that named itself is a defect however it died.
        assert!(matches!(
            stopped(None, "nts: `x` was read before its declaration ran\n"),
            Stopped::Defect(_)
        ));
    }
}

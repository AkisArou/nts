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
use nts_frontend_ts::Frontend;

mod artifact_shadow;
mod case_costs;
mod objects;

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
const MEMORY_MB: u64 = 2048;

/// What a compiled program maps of [`MEMORY_MB`] before it asks for anything:
/// its image, the C library, its stack and the runtime's first blocks -- 7 to
/// 24 MB measured (`VmSize`, three bench programs, 2026-10-22), with room.
///
/// Under `--as` the largest allocation a program can make is the bound less
/// these, so `new ArrayBuffer(4, { maxByteLength: 2 ** 31 - 1 })` fails there
/// and in node alike. The sanitized run cannot bound address space (see
/// [`bounded_native`]) and bounds each allocation instead, at the size `--as`
/// leaves one.
const PROGRAM_MAPS_MB: u64 = 32;

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
///
/// **And no core file.** A case the compiled program declines ends it by
/// `abort` -- that is the program answering, not crashing -- and each one had
/// `systemd-coredump` capture, compress and store a core: 52,596 in one day of
/// checks, most of them `nts check` binaries under `outcomes` and `agree`, on
/// the measurement CPUs as readily as anywhere else. With the limit at 0 it
/// still records the crash and stores nothing; the signal is unchanged.
fn bounded(program: &str) -> std::process::Command {
    let mut command = std::process::Command::new("prlimit");
    command
        .arg(format!("--as={}", MEMORY_MB << 20))
        .arg("--core=0")
        .arg("timeout")
        .arg(TIMEOUT)
        .arg(program);
    command
}

/// Whether the compiled program is built under `AddressSanitizer`:
/// `NTS_SANITIZE=address`, which `outcomes/` asks for with `// sanitizer:
/// address`.
///
/// It is what turns a reference released once too often into a report rather
/// than a value read back by luck. Under counting the runtime recycles a freed
/// block (`NTS_RECYCLES` in `nts_runtime.c`), so a read through a dangling
/// pointer usually finds what was there, and nothing disagrees. Under the
/// sanitizer every block comes from `malloc` and goes back to it, so the read
/// is caught: a thrown object released once too many after `nts_raise` read as
/// itself here until the sanitizer said `heap-use-after-free`. Build mode had
/// this already. A check reaches what build mode cannot, a raising copy among
/// them, so it needs it too.
fn address_sanitized() -> bool {
    std::env::var("NTS_SANITIZE").is_ok_and(|value| value == "address")
}

/// The compiled program, bounded as [`bounded`] bounds it, except in address
/// space under the sanitizer: `AddressSanitizer` reserves terabytes of shadow
/// memory up front, which a two-gigabyte `--as` refuses before `main` runs.
/// Its resident memory is bounded instead, time still bounds it, and its own
/// leak report is off -- what a counted
/// program still holds is this harness's question (`growth`), asked the same
/// way with or without the sanitizer.
fn bounded_native(program: &str) -> std::process::Command {
    if !address_sanitized() {
        return bounded(program);
    }
    let mut command = std::process::Command::new("prlimit");
    // The bound in the dimension the sanitizer leaves usable: its own limit on
    // resident memory, at the size `--as` gives an unsanitized run. Without it
    // a runaway was unbounded here alone -- one `check` reached 6.2 GB and the
    // OOM killer ended the whole run, which printed no verdict (2026-10-22).
    //
    // And an allocation it cannot satisfy answers NULL, as `malloc` does: the
    // runtime turns that into the RangeError a program can catch, where the
    // sanitizer's own default ends the process. `typed-array-aliasing` asks
    // for an impossible buffer on purpose, and was a wrong answer here alone.
    //
    // "Cannot satisfy" at the size `--as` would refuse, too. Resident memory
    // alone let an untouched `calloc(2 ** 31 - 1)` succeed here, which `--as`
    // refuses unsanitized and node refuses beside it: `trackingFollowsAResize`
    // answered 302 where node threw (CompilerHelper, 2026-10-22).
    command
        .arg("--core=0")
        .arg("timeout")
        .arg(TIMEOUT)
        .arg(program)
        .env(
            "ASAN_OPTIONS",
            format!(
                "detect_leaks=0:allocator_may_return_null=1:hard_rss_limit_mb={MEMORY_MB}:\
                 max_allocation_size_mb={}",
                MEMORY_MB - PROGRAM_MAPS_MB
            ),
        );
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
    /// What a null result stands for (`Func::result_absent`): the driver prints
    /// `null` for a `string | null` export's null pointer, and `undefined`
    /// otherwise, where it printed `undefined` for both.
    result_absent: nts_core::hir::Absent,
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
fn c_type(ty: &HirType) -> String {
    match ty {
        HirType::NativePointer(name) => return name.pointer_type(),
        HirType::Managed(nts_core::hir::ManagedType::String) => "NtsString *",
        // Same as the map below: the harness generates calls from scalar
        // signatures and cannot make a symbol, so this is here to be right
        // rather than to be reached.
        HirType::Managed(nts_core::hir::ManagedType::Symbol) => "NtsSymbol *",
        HirType::Managed(nts_core::hir::ManagedType::Date) => "NtsDate *",
        HirType::Managed(nts_core::hir::ManagedType::Region) => "NtsHeader *",
        // `emit.rs`'s spelling; never a scalar signature's, so here to be right.
        HirType::Managed(nts_core::hir::ManagedType::BoxedBigInt) => "NtsBigIntBox *",
        HirType::Managed(nts_core::hir::ManagedType::Buffer) => "NtsBuffer *",
        HirType::Managed(
            nts_core::hir::ManagedType::View(_) | nts_core::hir::ManagedType::AnyView,
        ) => "NtsView *",
        HirType::Managed(nts_core::hir::ManagedType::DataView) => "NtsDataView *",
        // As with the promise below: the harness never drives one, because it
        // generates calls from scalar signatures, so this is here to be right
        // rather than to be reached.
        HirType::Managed(
            nts_core::hir::ManagedType::Map(_, _)
            | nts_core::hir::ManagedType::Table(_, _)
            | nts_core::hir::ManagedType::Set(_),
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
        // settles with; `nts_check_show_settled` reads the payload out.
        //
        // **Every name this harness puts in scope carries `nts_check_`.**
        // They were `show`, `show_string`, `show_settled` and a local
        // `held`, and the harness `#include`s `program.h` -- so a program
        // exporting a function called `held` could not be checked at all.
        // `tests/programs/promise-with-resolvers` had one, and clang answered
        // `called object type 'NtsPromise *' is not a function`, which is
        // a sentence about the harness pointed at the program. It fails
        // loudly rather than answering wrongly, so this is about the
        // message rather than the result -- but the message named the
        // wrong file.
        HirType::Managed(nts_core::hir::ManagedType::Promise(_)) => "NtsPromise *",
        // Neither is drivable -- `drivable` gates what reaches here -- but a
        // wrong *spelling* would be a wrong C declaration rather than a
        // refusal, so they are named rather than defaulted.
        HirType::Managed(
            nts_core::hir::ManagedType::Array(_) | nts_core::hir::ManagedType::Template,
        ) => "NtsArray *",
        HirType::Managed(nts_core::hir::ManagedType::Object(_)) => "void *",
        HirType::Void | HirType::Never => "void",
    }
    .to_owned()
}

/// Compile a program, run it, run the same source on node, and compare.
///
/// The caller supplies the project's configured frontend, including its
/// generated bindings and source transforms.
///
/// # Errors
///
/// If the program does not typecheck, does not lower, does not compile, or the
/// two sides disagree.
#[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
pub fn check(tsconfig: &Utf8Path, source: &mut Frontend) -> Result<Report> {
    let _trace_session = case_costs::session(tsconfig);
    let backend = Backend::from_environment()?;
    let provider =
        match backend {
            Backend::Jvm => nts_codegen_common::provider::host_gc("jvm", counting())
                .map_err(anyhow::Error::msg)?,
            Backend::C | Backend::Llvm => {
                if counting() {
                    hir::Provider::ReferenceCounting
                } else {
                    hir::Provider::NoGc
                }
            }
            Backend::Wasm => nts_codegen_common::provider::host_gc("wasm", counting())
                .map_err(anyhow::Error::msg)?,
        };
    let snapshot = case_costs::measure("capture", || source.snapshot(tsconfig))?;
    if snapshot.has_errors() {
        for diagnostic in &snapshot.diagnostics {
            eprintln!(
                "{}",
                nts_diagnostics::diagnostic_line(&snapshot.sources, diagnostic)
            );
        }
        bail!("the program does not typecheck");
    }

    // Reference counting compiles the program *and* the runtime for it. Both
    // halves matter and they have to agree: the provider decides what the
    // compiler emits, not only what the runtime does with it, so selecting one
    // without the other compares a program that never releases against an
    // allocator that expects it to. Hence [`counting`], asked here and at the
    // runtime's defines, and nowhere else.
    let options = hir::Options {
        provider,
        table_entries: backend.table_entries(),
        // What the backend provides, for a `typeof` of an intrinsic
        // (`hir::features`): C's and LLVM's runtime header, each other
        // backend's own table.
        provided: hir::features::Provided::By(match backend {
            Backend::C | Backend::Llvm => nts_codegen_llvm::provides,
            Backend::Jvm => nts_codegen_jvm::provides,
            Backend::Wasm => nts_codegen_wasm::provides,
        }),
        ..hir::Options::default()
    };
    let raw = case_costs::measure("lower", || {
        hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign)
    });
    let prepared = match case_costs::measure("prepare", || {
        raw.into_prepared(&hir::PreparationOptions::from(&options))
    }) {
        Ok(prepared) => prepared,
        Err(unprepared) => bail!("{}", unprepared.render(&snapshot.sources)),
    };
    let mismatches =
        nts_codegen_common::provider::host_gc_diagnostics(&prepared.program, backend.name());
    if !mismatches.is_empty() {
        for diagnostic in &mismatches {
            eprintln!(
                "{}",
                nts_diagnostics::diagnostic_line(&snapshot.sources, diagnostic)
            );
        }
        bail!(
            "{} HostGc preparation declined counting markers",
            backend.name()
        );
    }
    for diagnostic in &prepared.diagnostics {
        eprintln!(
            "  refused: {}",
            nts_diagnostics::diagnostic_line(&snapshot.sources, diagnostic)
        );
    }

    let selection = case_costs::span("select_exports");
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
        // it compared anything. `tests/programs/nested` had never been checked.
        .filter(|func| importable.contains(func.name.as_str()))
        .filter(|func| {
            drivable(&func.return_type) && func.params.iter().all(|param| drivable(&param.ty))
        })
        .map(|func| Testable {
            name: func.name.clone(),
            returns: func.return_type.clone(),
            result_absent: func.result_absent,
            params: func
                .params
                .iter()
                .map(|param| (param.ty.clone(), param.known))
                .collect(),
        })
        .collect();

    drop(selection);
    case_costs::event(serde_json::json!({"event":"population", "functions":testable.len()}));
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
    // Cases the program did not finish in time. Counted rather than filed as
    // declines, because those are different facts; see `stopped_with`.
    let mut timeouts = 0usize;
    // Which lane runs. The JVM is a sibling rather than a third arm of
    // `render`, because a JVM program is a directory of classes driven by
    // `java` -- a different artifact *and* a different runner, where C and
    // LLVM differ only in what they hand the same linker.
    let native = match backend {
        Backend::Jvm => run_jvm(
            dir,
            &prepared.program,
            &snapshot.sources,
            &testable,
            &mut refused,
            &mut aborts,
            &mut timeouts,
        )?,
        Backend::Wasm => run_wasm(
            dir,
            &prepared.program,
            &snapshot.sources,
            &testable,
            &mut refused,
            &mut aborts,
        )?,
        Backend::C | Backend::Llvm => run_native(
            dir,
            &prepared.program,
            &snapshot.sources,
            &testable,
            &mut refused,
            &mut aborts,
            &mut timeouts,
        )?,
    };
    let engine = case_costs::measure("oracle.total", || {
        run_node(dir, &entry, &testable, &snapshot.sources)
    })?;
    let approximate = nts_core::hir::builtin::approximating(&prepared.program);
    let mut report = report(&native, &engine, &testable, &refused, &approximate);
    report.aborts = aborts;
    report.timeouts = timeouts;
    // A timed-out case still has to leave a gap on this side so the node side
    // trims to match by index -- so it goes into `refused` for *alignment* and
    // comes back out of the count, which is a different question. Reporting it
    // as both is how it read before: one line saying the program declined and
    // one saying it ran out of time, about the same case.
    report.refused = report.refused.saturating_sub(timeouts);
    case_costs::event(
        serde_json::json!({"event":"report", "functions":report.functions, "checked":report.checked, "expected":report.expected, "refused":report.refused, "timeouts":report.timeouts, "aborts":report.aborts.len(), "disagreements":report.disagreements.len()}),
    );
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

/// Whether this run counts references: `NTS_RC=1` in the environment, or `--rc`
/// on the command line.
///
/// **One function, because it is one decision with two halves** -- the provider
/// the program is lowered for and the define the runtime is built with. They are
/// asked in two places several hundred lines apart, and a run that answered them
/// differently would compare a program that never releases against an allocator
/// that expects it to.
///
/// **And one function because `--rc` used to be accepted and ignored.** It is
/// documented as `build`'s flag and read by `emit-c` and `hir`; `check` read only
/// the variable, and an unrecognised `--flag` is skipped rather than refused. So
/// `nts check --rc` compiled with the *no-GC* provider and printed `agreed on
/// every case`, which is a green answer to a question that was never asked --
/// and it hid a helper returning a borrowed reference where the counting
/// convention wanted an owned one (`nts_map_extend`), a double release that
/// `NTS_RC=1` finds in one run.
#[must_use]
pub fn counting() -> bool {
    std::env::var("NTS_RC").is_ok_and(|value| value != "0")
        || std::env::args().any(|argument| argument == "--rc")
}

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

    // **The module nothing imports.** Without a `main.ts`, the first module
    // decoded was taken -- and a program's first decoded module is whatever
    // its root imports first: every Are We Fast Yet case's `case.ts` imports
    // its base class, so the base class was the entry, its exports were the
    // surface, and `nts check` said "nothing to check" for all of them. The
    // `bench-agree` step had never compared one. The root is the module no
    // other module of the program imports; a declaration file is never one.
    let imported: std::collections::HashSet<nts_semantic_schema::ModuleId> = snapshot
        .modules
        .iter()
        .flat_map(|module| module.imports.iter().copied())
        .collect();
    let root = snapshot
        .modules
        .iter()
        .enumerate()
        .find_map(|(index, module)| {
            let id = nts_semantic_schema::ModuleId(u32::try_from(index).ok()?);
            let source = snapshot.sources.get(module.file.0 as usize)?;
            (!imported.contains(&id) && !source.display_path.as_str().ends_with(".d.ts"))
                .then(|| source.display_path.clone())
        });
    if let Some(root) = root {
        return Ok(root);
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
/// The start of each case's result line, `name at `, in the order the cases
/// are run: what both runners print before the value.
fn results(testable: &[Testable]) -> Vec<String> {
    interleaved(testable)
        .into_iter()
        .map(|(one, at, _)| format!("{} {at} ", one.name))
        .collect()
}

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
         char *getenv(const char *);\n\
         /* Where the results go: a file named by NTS_DIFF_RESULTS, not stdout.\n\
          * stdout is the program's own -- it can print on purpose -- and a\n\
          * result told from its output by shape could be spoofed by a program\n\
          * that logs `name 7 ...`. A channel of its own makes every line a\n\
          * result by construction. */\n\
         static FILE *nts_check_out;\n\
         #include \"nts_runtime.h\"\n\
         #include \"nts_test_host.h\"\n\n\
         /* A string is compared by its code units, which is what a JavaScript\n\
          * string is. Printing them beats printing the text: it needs no\n\
          * escaping rules, and a surrogate pair shows up as the two units\n\
          * `length` counts rather than as one character. */\n\
         static void nts_check_show_string(const char *name, int at, const NtsString *s,\n\
         \x20                                 int null_is_null) {\n\
         \x20   /* An absent string is the null pointer, which a `string | undefined`\n\
         \x20    * return and a `string | null` one both produce: which absence it\n\
         \x20    * is, the export says (`Func::result_absent`), and node prints the\n\
         \x20    * two differently. Reading `s->length` there segfaulted the whole\n\
         \x20    * run once -- a crash is the one outcome that reports nothing about\n\
         \x20    * the case it happened on. */\n\
         \x20   if (s == NULL) {\n\
         \x20       fprintf(nts_check_out, null_is_null ? \"%s %d null\\n\" : \"%s %d undefined\\n\",\n\
         \x20               name, at);\n\
         \x20       fflush(nts_check_out);\n\
         \x20       return;\n\
         \x20   }\n\
         \x20   fprintf(nts_check_out, \"%s %d str %u\", name, at, s->length);\n\
         \x20   for (uint32_t i = 0; i < s->length; i++) {\n\
         \x20       fprintf(nts_check_out, \",%u\", (unsigned)nts_str_char_code_at(s, (double)i));\n\
         \x20   }\n\
         \x20   fprintf(nts_check_out, \"\\n\");\n\
         \x20   fflush(nts_check_out);\n\
         }\n\n\
         static void nts_check_show(const char *name, int at, double value) {\n\
         \x20   uint64_t bits;\n\
         \x20   /* Every NaN is the same NaN as far as JavaScript can tell: there\n\
         \x20    * is no way to observe the sign or payload from the language, so\n\
         \x20    * comparing them bit for bit would fail on a difference nobody\n\
         \x20    * can see. */\n\
         \x20   if (value != value) {\n\
         \x20       fprintf(nts_check_out, \"%s %d nan\\n\", name, at);\n\
         \x20       fflush(nts_check_out);\n\
         \x20       return;\n\
         \x20   }\n\
         \x20   memcpy(&bits, &value, sizeof bits);\n\
         \x20   fprintf(nts_check_out, \"%s %d %016llx\\n\", name, at, (unsigned long long)bits);\n\
         \x20   fflush(nts_check_out);\n\
         }\n\n\
         /* An `async` function hands back a promise, so its answer is what it\n\
          * settles with once the loop has nothing left to run. The budget is a\n\
          * bound rather than a guess: a program that starves the loop fails\n\
          * here instead of hanging the run. */\n\
         static void nts_check_show_settled(const char *name, int at, NtsPromise *p) {\n\
         \x20   /* **This harness is the handler.** It inspects the outcome below,\n\
         \x20    * which is what handling a rejection means -- and it does so by\n\
         \x20    * polling rather than by subscribing, so nothing else says it.\n\
         \x20    * Without this an exported `async` function that rejects ends the\n\
         \x20    * process at the next checkpoint, since an unhandled rejection is\n\
         \x20    * node`s status 1: `promise-constructor` went from 174 cases to 162\n\
         \x20    * and `async` from 986 to 148 the hour that landed. The node side\n\
         \x20    * of the comparison awaits the same promise, so marking it here is\n\
         \x20    * what makes the two sides ask one question. */\n\
         \x20   p->handled = true;\n\
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
         \x20       fprintf(nts_check_out, \"%s %d starved\\n\", name, at);\n\
         \x20       fflush(nts_check_out);\n\
         \x20       return;\n\
         \x20   }\n\
         \x20   if (p->state == NTS_PROMISE_FULFILLED\n\
         \x20       && nts_value_tag(p->value) == NTS_TAG_NUMBER) {\n\
         \x20       nts_check_show(name, at, nts_value_number(p->value));\n\
         \x20       return;\n\
         \x20   }\n\
         \x20   if (p->state == NTS_PROMISE_FULFILLED\n\
         \x20       && NTS_TAG_IS_MANAGED(nts_value_tag(p->value))) {\n\
         \x20       nts_check_show_string(name, at,\n\
         \x20                   (const NtsString *)nts_value_reference(p->value), 0);\n\
         \x20       return;\n\
         \x20   }\n\
         \x20   if (p->state == NTS_PROMISE_FULFILLED && nts_value_tag(p->value) == NTS_TAG_NULL) {\n\
         \x20       fprintf(nts_check_out, \"%s %d null\\n\", name, at);\n\
         \x20   } else if (p->state == NTS_PROMISE_PENDING) {\n\
         \x20       fprintf(nts_check_out, \"%s %d pending\\n\", name, at);\n\
         \x20   } else if (p->state == NTS_PROMISE_REJECTED) {\n\
         \x20       fprintf(nts_check_out, \"%s %d rejected\\n\", name, at);\n\
         \x20   } else {\n\
         \x20       fprintf(nts_check_out, \"%s %d undefined\\n\", name, at);\n\
         \x20   }\n\
         \x20   fflush(nts_check_out);\n\
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
         \x20   const char *nts_check_path = getenv(\"NTS_DIFF_RESULTS\");\n\
         \x20   /* No fallback to stdout: that would quietly restore the shared\n\
         \x20    * channel this exists to remove. */\n\
         \x20   if (nts_check_path == NULL) { fprintf(stderr, \"nts-check: NTS_DIFF_RESULTS is not set\\n\"); return 2; }\n\
         \x20   nts_check_out = fopen(nts_check_path, \"a\");\n\
         \x20   if (nts_check_out == NULL) { fprintf(stderr, \"nts-check: cannot open %s\\n\", nts_check_path); return 2; }\n\
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
                    "{{ NtsPromise *nts_check_held = {call}; \
                     nts_check_show_settled(\"{}\", {at}, nts_check_held); \
                     nts_release((NtsHeader *)nts_check_held); }}",
                    one.name
                )
            } else if is_string(&one.returns) {
                format!(
                    "{{ NtsString *nts_check_held = {call}; \
                     nts_check_show_string(\"{}\", {at}, nts_check_held, {}); \
                     nts_release((NtsHeader *)nts_check_held); }}",
                    one.name,
                    i32::from(one.result_absent == nts_core::hir::Absent::Null)
                )
            } else {
                format!("nts_check_show(\"{}\", {at}, (double){call});", one.name)
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
                    "#ifdef NTS_PROVIDER_RC\n                     \x20   nts_collect_cycles();\n                     \x20   fprintf(stderr, \"nts-live-first %zu\\n\", nts_live_count() - nts_permanent_count());\n                     #endif\n",
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
    //
    // **The jobs the cases queued run first**, as they do on node's side: its
    // driver is a module calling each synchronous case in turn, so a reaction
    // one of them queued runs at the next `await` or when evaluation ends, and
    // never not at all. Here nothing ran them after the last synchronous case,
    // so `f().catch(() => {})` left its promise, its reaction and the closure
    // queued, and the count below took them for a leak: five or six objects a
    // case (`parameters-bound-where-the-call-answers`, whose controls leaked
    // as much as its arms). An asynchronous case already drives the loop, and
    // runs what was queued before it, as node's `await` does.
    main.push_str(
        "    nts_checkpoint();\n#ifdef NTS_PROVIDER_RC\n         \x20   nts_test_host_drain();\n         \x20   nts_collect_cycles();\n         \x20   fprintf(stderr, \"nts-live-end %zu\\n\", nts_live_count() - nts_permanent_count());\n         #endif\n         \x20   /* The terminal marker: a run that stopped after three cases leaves\n         \x20    * three good lines and nothing else, which reads exactly like a\n         \x20    * short clean run unless the end is written down. */\n         \x20   fprintf(nts_check_out, \"done %ld\\n\", at_case + 1 - from);\n         \x20   fclose(nts_check_out);\n         \x20   return 0;\n}\n",
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
    let emitted = nts_codegen_c::emit(program, nts_core::hir::native::NativeAbi::LP64);
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
    std::fs::write(&generated, emitted.writer.text())
        .map_err(|error| NotC::Rejected(error.to_string()))?;
    std::fs::write(
        dir.join(nts_codegen_c::RUNTIME_HEADER_NAME),
        nts_codegen_c::RUNTIME_HEADER,
    )
    .map_err(|error| NotC::Rejected(error.to_string()))?;
    std::fs::write(
        dir.join(nts_codegen_c::STRING_VIEW_HEADER_NAME),
        nts_codegen_c::STRING_VIEW_HEADER,
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

/// Whether every class the JVM backend emitted survives the JVM's verifier.
///
/// The same split as [`compiles`], for the same reason: a backend that declines
/// is a refusal like any other, and a class the verifier rejects is malformed
/// output. Only the second is the row that must reach zero.
///
/// This matters more here than its C counterpart does there. A verifier
/// rejection is the *characteristic* failure of a bytecode emitter -- the bytes
/// are well formed enough to write, the constant pool resolves, and the class
/// is refused at load because an abstract interpretation of the code says the
/// stack or a local has the wrong type on some path. Nothing short of the
/// verifier answers that question, and a program only ever loads the classes it
/// actually reaches, so running one is not the same as checking one.
///
/// Two of today's bugs were exactly this shape and both were found by running
/// an AWFY case rather than by any check: `boolean[]` allocated as `int[]`, and
/// an array length widened to `double` and stored into a `long` slot. Neither
/// was visible in the emitted text and both were a `VerifyError` at load.
pub fn verifies(program: &hir::Program, dir: &Utf8Path) -> Result<(), NotC> {
    let emitted = nts_codegen_jvm::emit(program);
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
    if emitted.classes.is_empty() {
        return Ok(());
    }
    let mut names = Vec::with_capacity(emitted.classes.len());
    for class in &emitted.classes {
        let path = dir.join(class.path());
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| NotC::Rejected(e.to_string()))?;
        }
        std::fs::write(&path, &class.bytes).map_err(|e| NotC::Rejected(e.to_string()))?;
        names.push(class.binary_name.replace('/', "."));
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref())
        .map_err(|e| NotC::Rejected(e.to_string()))?;

    let java = std::env::var("JAVA_HOME")
        .map_or_else(|_| "java".to_owned(), |home| format!("{home}/bin/java"));
    let loaded = std::process::Command::new("timeout")
        .arg(TIMEOUT)
        .arg(java)
        .args(["-Xmx256m", "-XX:-UsePerfData"])
        .arg("-cp")
        .arg(format!("{dir}:{jar}"))
        .arg("nts.rt.Verify")
        .args(&names)
        .output()
        .map_err(|error| NotC::Rejected(error.to_string()))?;
    if loaded.status.success() {
        return Ok(());
    }
    Err(NotC::Rejected(
        String::from_utf8_lossy(&loaded.stdout)
            .lines()
            .find(|line| line.starts_with("UNVERIFIABLE"))
            .unwrap_or("the JVM refused a generated class")
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

/// And what it prints when the *program* throws and nothing catches it.
///
/// Neither a defect nor a refusal by this compiler: the program did what the
/// language says, and node's driver reports the same event as `threw`. Both
/// sides then have no answer at that index and the case is skipped, which is
/// the pairing the two deserve.
///
/// It was missing because until `try`/`catch` existed every throw ended the
/// program by construction, so an uncaught one was indistinguishable from a
/// crash. `"x".repeat(-1)` is the first thing that throws where node also
/// throws and both are right.
const UNCAUGHT: &str = "nts: uncaught ";

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
    /// The program did not finish inside the harness's time. Neither a verdict
    /// nor a defect -- and, before this existed, indistinguishable from a
    /// decline, which is the one thing the standing rule forbids.
    TimedOut,
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
/// hid exactly there. `tests/programs/map-and-set` segfaulted on every case under
/// reference counting and the gate counted it as passing; `tests/programs/async`
/// reached 263 of 928 cases for the same reason, and the cycle collector's
/// blind spot sat behind it. In both, stdout was buffered and lost with the
/// crash, so there was nothing to compare and nothing to complain about.
///
/// A timeout is not a signal here -- `timeout` exits 124 of its own accord --
/// so a case that takes too long stays what it was: not reached, and not a
/// verdict. An `abort()` *after* a refusal keeps its refusal line and stays a
/// decline, which is what every bounds check does.
/// `timeout`'s own exit status when it kills the child. Not a signal on this
/// side -- the shell tool exits with it -- so nothing in `stopped` saw it.
const TIMED_OUT: i32 = 124;

/// As [`stopped`], plus the exit code, which is the only place a timeout shows.
///
/// `benchmarks/cases/absences` found the gap. Fixing an unsigned remainder made
/// the case correct and slow -- 14.74 s for its 2.1 billion iterations -- and
/// the harness reported **"1 case(s) the compiled program declined"**, which is
/// the sentence it uses for a program keeping the promise its `!` made. Before
/// the fix the case was fast and wrong; after it, slow and filed as a decline.
/// The second state is better and is still not honest.
///
/// A timeout is genuinely not a verdict, and the fix is not to make it one: it
/// is to stop it wearing another verdict's name.
fn stopped_with(code: Option<i32>, signal: Option<i32>, complaint: &str) -> Stopped {
    // Before anything else, because a timed-out program usually printed
    // nothing -- and an empty complaint is exactly what a clean decline looks
    // like once its line has been consumed.
    if code == Some(TIMED_OUT) {
        return Stopped::TimedOut;
    }
    // A sanitizer's report, which is never the program declining its input:
    // the memory it names was used wrongly, whatever the program printed or
    // was about to. Named by kind (`heap-use-after-free`), as a build-mode
    // outcome names it, because the address beside it differs on every run.
    if let Some(kind) = complaint.lines().find_map(|line| {
        line.split_once("ERROR: AddressSanitizer: ")
            .and_then(|(_, rest)| rest.split_whitespace().next())
    }) {
        return Stopped::Defect(format!("AddressSanitizer: {kind}"));
    }
    if let Some(line) = complaint.lines().find(|line| {
        line.starts_with("nts:")
            && !line.starts_with(REFUSED)
            && !line.starts_with(EXHAUSTED)
            && !line.starts_with(UNCAUGHT)
    }) {
        return Stopped::Defect(line.trim().to_owned());
    }
    // A class file the JVM will not load or link is the characteristic failure
    // of a bytecode emitter, and it must never read as a declined case.
    //
    // `Check.java` already says so -- its catch-all prints a stack trace with
    // the comment "the runner must count it as one rather than as a declined
    // case" -- but saying so was the whole of the enforcement, and this
    // function's fallthrough is `Declined`. A `VerifyError` in
    // `tests/programs/fluent-this` was reported as "17 case(s) the compiled program
    // declined -- an index its `!` promised was in range and was not", about a
    // file containing no subscript at all. The lane was refusing loudly and
    // being believed about the wrong thing.
    //
    // These are the errors that mean *the class is wrong*, as opposed to the
    // program computing something wrong, and there is no input for which any
    // of them is a legitimate answer.
    if let Some(line) = complaint.lines().find(|line| {
        [
            "VerifyError",
            "ClassFormatError",
            "UnsupportedClassVersionError",
            "NoClassDefFoundError",
            "NoSuchMethodError",
            "NoSuchFieldError",
            "AbstractMethodError",
            "IllegalAccessError",
            "IncompatibleClassChangeError",
        ]
        .iter()
        .any(|bad| line.contains(bad))
    }) {
        return Stopped::Defect(line.trim().to_owned());
    }
    // An uncaught `Throwable` prints a stack trace, and `Check.java` prints one
    // only for that: a refusal is an `NtsRefusal` and goes out as a `nts:`
    // line. So a stack frame is a defect, whatever threw it.
    //
    // The list above catches the errors that mean *the class is wrong*. It
    // cannot catch the ones that mean the *code* is wrong, because those are
    // ordinary runtime exceptions with no fixed name -- and a `java` process
    // that throws exits with a status rather than a signal, so the
    // signal-based rule below never sees them either. Both gaps meet at
    // `Declined`.
    //
    // Measured, on a generated `<init>` that left an optional reference field
    // as `null` where `undefined` was meant: the same program reported
    // **"checked 4 of 174 cases"** followed by **"agreed on every case"**,
    // because a hundred and seventy `NullPointerException`s were each counted
    // as the program declining its input. With this rule it is one defect and
    // a red run.
    if let Some(line) = complaint
        .lines()
        .find(|line| line.trim_start().starts_with("at ") && line.contains('('))
    {
        // Two throwables are not defects, and both were found by this rule
        // being wrong about them first.
        //
        // `NtsRefusal` is the program keeping the promise its `!` made. It has
        // its own arm in `Check.java` -- and that arm is **dead** when the entry
        // point is called reflectively, because reflection wraps it in an
        // `InvocationTargetException` and only the `Throwable` catch-all sees
        // it. So a real refusal arrives here with a stack trace attached, and
        // the old fallthrough filed it correctly for the wrong reason.
        //
        // `OutOfMemoryError` is this lane's `nts: out of memory`: the pool asks
        // for a loop bound of nine quadrillion and the program does exactly
        // what that asks. Not reached, not a verdict -- the same as `EXHAUSTED`
        // above, which the C lane recognises by its own message.
        //
        // `StackOverflowError` is the same event one resource over, and node
        // has it too: `RangeError: Maximum call stack size exceeded`. A
        // recursion the pool drives past its base case -- `count(n, acc = n)`
        // terminating on `n <= 0`, given a NaN, since `NaN <= 0` is false and
        // `NaN - 1` is NaN -- exhausts the stack in *both* lanes, so neither
        // produced an answer and there is nothing to compare.
        //
        // This is the narrowest of the three and the one to be most careful
        // about, because a genuine infinite recursion in this backend would
        // look identical. What separates them is that the other lane fails as
        // well; the case is only skipped, never asserted correct, and a
        // codegen bug that recursed where node did not would still show up as a
        // disagreement on every other case of the same function.
        let thrown_is_expected = complaint.lines().any(|line| {
            line.contains("NtsRefusal")
                || line.contains("OutOfMemoryError")
                || line.contains("StackOverflowError")
        });
        if thrown_is_expected {
            return Stopped::Declined;
        }
        // The *last* `Caused by:` where there is one. `Check.java` calls the
        // generated entry point reflectively, so the outermost throwable is
        // always `InvocationTargetException` and says nothing -- the cause is
        // the `NullPointerException` or the `ClassCastException` that names
        // what actually went wrong.
        let thrown = complaint
            .lines()
            .rfind(|line| line.trim_start().starts_with("Caused by: "))
            .map(|line| line.trim().trim_start_matches("Caused by: "))
            .or_else(|| complaint.lines().next())
            .unwrap_or(line)
            .trim();
        return Stopped::Defect(format!("the program threw rather than refusing: {thrown}"));
    }
    let said_something = complaint.lines().any(|line| {
        line.starts_with(REFUSED) || line.starts_with(EXHAUSTED) || line.starts_with(UNCAUGHT)
    });
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
    sources: &[nts_diagnostics::SourceFile],
) -> Result<Utf8PathBuf> {
    if backend == Backend::Jvm {
        // Not a native object and not linked with clang: a JVM program is a
        // directory of classes run by `java`, which is a different runner
        // rather than a different arm of this one.
        bail!("the JVM backend produces class files, which this driver cannot link");
    }
    Ok(if backend == Backend::Llvm {
        let rendered = case_costs::measure("llvm.emit", || {
            nts_codegen_llvm::emit(program, nts_codegen_llvm::Platform::SYSV_X86_64)
        });
        if !rendered.diagnostics.is_empty() {
            for diagnostic in rendered.diagnostics.iter().take(3) {
                eprintln!(
                    "  not rendered: {}",
                    nts_diagnostics::diagnostic_line(sources, diagnostic)
                );
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
        let assembled = case_costs::child("llvm.assemble", || {
            std::process::Command::new("clang")
                .args(["-x", "ir", "-c", "-w", "-O1"])
                .arg(&path)
                .arg("-o")
                .arg(&object)
                .output()
                .context("assembling the emitted LLVM IR")
        })?;
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
    sources: &[nts_diagnostics::SourceFile],
    testable: &[Testable],
    refused: &mut Vec<usize>,
    aborts: &mut Vec<String>,
    timeouts: &mut usize,
) -> Result<Run> {
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
    let emitted = case_costs::measure("c.emit", || {
        nts_codegen_c::emit(program, nts_core::hir::native::NativeAbi::LP64)
    });
    // The backend's own refusals, which used to be dropped on the floor here.
    // A function the emitter cannot write is *absent* from the C, and the
    // driver below still calls it -- so the run died at the linker with an
    // undefined reference and no hint of which construct was behind it. The
    // lowering's refusals were printed all along; these were not.
    for diagnostic in &emitted.diagnostics {
        eprintln!(
            "  not emitted: {}",
            nts_diagnostics::diagnostic_line(sources, diagnostic)
        );
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
    let generated = render(dir, program, backend, &emitted, sources)?;
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
    // Counting builds against the reference-counting provider instead of the
    // bump allocator.
    //
    // The retains and releases in the emitted C are the compiler's own work,
    // and under the default provider nothing is ever freed -- so a release too
    // few leaks where nobody looks and a release too many is never observed.
    // Both become visible here: too many frees an object something still holds,
    // and with `NTS_POISON` the next read of it is a conspicuous pattern rather
    // than whatever the allocator left.
    let counted = counting();
    let mut defines: Vec<&str> = Vec::new();
    if poison {
        defines.push("-DNTS_POISON=1");
    }
    if counted {
        defines.push("-DNTS_PROVIDER_RC");
    }
    // See `address_sanitized`. The runtime's objects are cached under their
    // flags, so a sanitized check never links an unsanitized runtime.
    if address_sanitized() {
        defines.extend(["-fsanitize=address", "-fno-omit-frame-pointer", "-g"]);
    }
    // The runtime and the host are the same bytes in nearly every check, and
    // compiling them was nearly all of one: see `objects`. The program and its
    // driver are compiled here, every time.
    let flags: Vec<&str> = ["-std=c11", "-O1", "-w"]
        .into_iter()
        .chain(defines.iter().copied())
        .collect();
    let objects = sources
        .iter()
        .chain(std::iter::once(&host))
        .map(|source| {
            case_costs::measure("native.runtime_objects", || {
                objects::object(source, &flags, &[dir], dir)
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let build = case_costs::child("native.link", || {
        std::process::Command::new("clang")
            .args(&flags)
            .arg("-I")
            .arg(dir)
            .arg("-o")
            .arg(&binary)
            .arg(&main_path)
            .arg(&generated)
            .args(&objects)
            .arg("-lm")
            .output()
            .context("running clang")
    })?;
    if !build.status.success() {
        bail!("clang: {}", String::from_utf8_lossy(&build.stderr));
    }

    // Restarted past whatever ends it. A case can trap -- an out-of-range index
    // is the program keeping the promise its `!` made -- and without this, one
    // such case costs every case after it. Node answers `undefined` for the same
    // input, so the two had nothing to compare there anyway; what matters is
    // that the *rest* of the program still gets checked.
    let _execution = case_costs::span("program.total");
    collect_restarting(
        dir,
        &results(testable),
        refused,
        aborts,
        timeouts,
        |from, path| {
            case_costs::child("program.attempt", || {
                bounded_native(binary.as_str())
                    .env("NTS_DIFF_RESULTS", path.as_str())
                    .arg(from.to_string())
                    .output()
                    .context("running the compiled program")
            })
        },
    )
}

/// The `n` of a results file's `done <n>` line, if it has one.
fn run_done(path: &Utf8Path) -> Option<usize> {
    let text = std::fs::read_to_string(path).ok()?;
    text.lines()
        .last()?
        .strip_prefix("done ")?
        .trim()
        .parse()
        .ok()
}

/// What one side of the comparison produced: the cases' result lines, from the
/// results file, and the program's own output, from its stdout. Two streams,
/// compared separately, because a program may now print on purpose and a
/// result told from its output by shape could be spoofed by it.
struct Run {
    results: Vec<String>,
    output: Vec<String>,
    /// The cases the compiled program stopped on by *throwing* -- an uncaught
    /// exception, `nts: uncaught ...` -- with the line it printed. Only these
    /// among the declines are paired with node's answer in [`report`]: a
    /// refusal is two languages answering differently, but a throw where node
    /// answered is one answer, and the compiled program got it wrong.
    thrown: Vec<(usize, String)>,
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
    dir: &Utf8Path,
    results: &[String],
    refused: &mut Vec<usize>,
    aborts: &mut Vec<String>,
    timeouts: &mut usize,
    run_from: impl Fn(usize, &Utf8Path) -> Result<std::process::Output>,
) -> Result<Run> {
    let total = results.len();
    let mut collected: Vec<String> = Vec::new();
    let mut output: Vec<String> = Vec::new();
    let mut thrown: Vec<(usize, String)> = Vec::new();
    let mut from = 0;
    let mut restarts = 0;
    while from < total && restarts <= REFUSALS {
        // One file per spawn, in this run's own directory: two lanes run at
        // once, and two writers appending to one file interleave into a
        // plausible-looking result set. **The spawner truncates, the harness
        // appends**: a file left by an earlier spawn goes here, before the
        // program starts, where the run boundary is known.
        let path = dir.join(format!("results-{restarts}.txt"));
        let _ = std::fs::remove_file(&path);
        let run = run_from(from, &path)?;
        let mut produced = std::fs::read(&path)
            .map(|bytes| lines(&bytes))
            .unwrap_or_default();
        // The terminal marker. A run that stopped after three cases leaves
        // three good lines; without `done` it is not a short clean run.
        let finished = produced
            .last()
            .is_some_and(|last| last.starts_with("done "));
        if finished {
            produced.pop();
        }
        let read = produced.len();
        output.extend(lines(&run.stdout));
        // The cases answered: result lines, in the order they were asked for.
        //
        // **They arrive on a channel of their own**, the file named by
        // `NTS_DIFF_RESULTS`, not on stdout. Until 2026-09-26 the subject and the
        // instrument shared stdout, and once a compiled program could write it
        // on purpose, a result was told from output by its shape (`name at `) --
        // so `console.log("twice 7 ...")` could spoof, duplicate or hide a
        // case. Now every line of the file is a result by construction, and
        // the program's stdout is its output, compared as its own stream.
        // Every line of the file is a result; matching each against the case
        // expected next is now a check on the harness, not a way to tell
        // results from output.
        let reached = produced.iter().fold(0, |answered, line| {
            if results
                .get(from + answered)
                .is_some_and(|result| line.starts_with(result.as_str()))
            {
                answered + 1
            } else {
                answered
            }
        });
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
        // The marker agreeing with the reader: `done <n>` is the cases this run
        // answered, and the collector counts the lines it read. A harness that
        // miscounts is reported rather than trusted.
        if let Some(said) = run_done(&path).filter(|said| *said != read) {
            aborts.push(format!(
                "the harness wrote `done {said}` after {read} result line(s)"
            ));
        }
        if !finished && run.status.success() && reached < total - from {
            aborts.push(format!(
                "exited 0 after {reached} of {} case(s) without its `done` line: the results file is truncated",
                total - from
            ));
        }
        if reached == total - from {
            if !finished {
                aborts.push(format!(
                    "answered every case and ended without its `done` line: {}",
                    String::from_utf8_lossy(&run.stderr)
                        .lines()
                        .next()
                        .unwrap_or("no message")
                ));
            }
            break;
        }
        match stopped_with(run.status.code(), signal_of(run.status), &complaint) {
            Stopped::Declined => {
                if let Some(line) = complaint.lines().find(|line| line.starts_with(UNCAUGHT)) {
                    thrown.push((from + reached, line.to_owned()));
                }
            }
            Stopped::TimedOut => *timeouts += 1,
            Stopped::Defect(what) => aborts.push(what),
        }
        // The case after the last one that printed. A refusal leaves a gap on
        // this side, and the node side is trimmed to match by index below.
        refused.push(from + reached);
        from += reached + 1;
        restarts += 1;
    }
    Ok(Run {
        results: collected,
        output,
        thrown,
    })
}

/// Write the already-validated JVM classes and runtime in their existing order.
fn write_jvm_artifacts(dir: &Utf8Path, emitted: &nts_codegen_jvm::Emitted) -> Result<Utf8PathBuf> {
    for class in &emitted.classes {
        let path = dir.join(class.path());
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, &class.bytes)?;
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref())?;
    Ok(jar)
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
    sources: &[nts_diagnostics::SourceFile],
    testable: &[Testable],
    refused: &mut Vec<usize>,
    aborts: &mut Vec<String>,
    timeouts: &mut usize,
) -> Result<Run> {
    let emitted = case_costs::measure("jvm.emit", || nts_codegen_jvm::emit(program));
    for diagnostic in &emitted.diagnostics {
        eprintln!(
            "  not emitted: {}",
            nts_diagnostics::diagnostic_line(sources, diagnostic)
        );
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
    let jar = case_costs::measure("jvm.toolchain", || write_jvm_artifacts(dir, &emitted))?;

    // The cases, as data. Generating and compiling a driver per case set would
    // put `javac` in this loop -- some 300ms against nine hundred cases -- to
    // build something thrown away immediately. `nts/rt/Check` is compiled once
    // into the jar and reflects; it is slow, and a correctness harness is the
    // one place that does not matter.
    let mut cases = String::new();
    // The backend's own facts, once: a split face is spelled as its interface.
    let facts = nts_codegen_jvm::JvmProgram::new(program);
    for (one, at, tuple) in interleaved(testable) {
        let Some(returns) = nts_codegen_jvm::types::descriptor(
            nts_codegen_jvm::types::Shape::of(&facts),
            &one.returns,
        ) else {
            bail!(
                "`{}` returns a type the JVM backend rendered but this harness cannot",
                one.name
            );
        };
        let mut parameters = Vec::with_capacity(one.params.len());
        for (ty, _) in &one.params {
            let Some(descriptor) =
                nts_codegen_jvm::types::descriptor(nts_codegen_jvm::types::Shape::of(&facts), ty)
            else {
                bail!(
                    "`{}` takes a type the JVM backend rendered but this harness cannot",
                    one.name
                );
            };
            parameters.push(descriptor);
        }
        // Comma-separated, because a descriptor is not one character. Packing
        // them as a string and indexing it per parameter was correct until the
        // first `Ljava/lang/String;` and then reported "the pool offered 0.5 to
        // a parameter the compiler proved is `j`" -- the `j` being the middle of
        // the descriptor. Found by `representable`, which is a check about
        // something else entirely refusing to believe a type it had never seen.
        //
        // After the return descriptor, what a null result stands for, which the
        // descriptor cannot say: `Ljava/lang/String;` is both `string | null`
        // and `string | undefined`, and node prints the two differently. C's
        // harness is told the same at `nts_check_show_string`.
        // Reflection needs the emitted name; comparison needs the source
        // identity from results(testable). Sharing one name made escaped JVM
        // names report zero reached cases despite executing the right methods.
        // The v2 marker also makes an older Check reject this header rather
        // than interpret the added identity as a parameter.
        let _ = write!(
            cases,
            "nts-check v2 {} {} {at} {returns} {} {}",
            nts_codegen_jvm::body::method_name(&one.name),
            one.name,
            if one.result_absent == nts_core::hir::Absent::Null {
                "null"
            } else {
                "-"
            },
            if parameters.is_empty() {
                "-".to_owned()
            } else {
                parameters.join(",")
            }
        );
        for (slot, value) in tuple.iter().enumerate() {
            let descriptor = parameters.get(slot).map_or("D", String::as_str);
            if descriptor == nts_codegen_jvm::types::STRING_DESCRIPTOR {
                // The pool carries an *index* into `STRINGS` for a string slot,
                // so the harness has to build the string. Sent as its code
                // units rather than its text: no escaping rules, and a
                // surrogate pair arrives as the two units `length` counts.
                let text = string_at(*value);
                let units: Vec<String> = text
                    .encode_utf16()
                    .map(|unit| format!("{unit:x}"))
                    .collect();
                let _ = write!(cases, " s:{}", units.join(","));
                continue;
            }
            representable(*value, descriptor.as_bytes()[0])
                .with_context(|| format!("parameter {slot} of `{}`", one.name))?;
            let _ = write!(cases, " {:016x}", value.to_bits());
        }
        cases.push('\n');
    }
    let cases_path = dir.join("cases.txt");
    std::fs::write(&cases_path, cases)?;

    let classpath = format!("{dir}:{jar}");
    let shadow = artifact_shadow::jvm(dir, &emitted, &jar, &cases_path);
    let execution = case_costs::span("program.total");
    let run = collect_restarting(
        dir,
        &results(testable),
        refused,
        aborts,
        timeouts,
        move |from, path| {
            case_costs::child("program.attempt", || {
                bounded_jvm()
                    .env("NTS_DIFF_RESULTS", path.as_str())
                    .arg("-cp")
                    .arg(&classpath)
                    .arg("nts.rt.Check")
                    .arg(cases_path.as_str())
                    .arg(from.to_string())
                    .output()
                    .context("running the compiled classes")
            })
        },
    );
    drop(execution);
    artifact_shadow::finish_jvm(shadow, &run, refused, aborts, *timeouts);
    run
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

/// The node-side driver: one line per case into `NTS_DIFF_RESULTS`, importing
/// `import` -- the program's source for node, the module's generated glue for
/// the Wasm backend -- so both runs ask the same questions in the same order.
///
/// A case that throws is `threw` (or `rejected`), whatever was thrown: neither
/// side's value is compared. Under Wasm an input-contract decline is `refused`;
/// a compiler stop or trap is an abort with its original message. An explicit
/// error kind marks a compiler stop; its reason is never parsed. An uncaught
/// object the program made carries `uncaught` and is its own throw.
fn driver(import: &str, testable: &[Testable], engine: Engine) -> String {
    let load = engine.load_module(import);
    let mut driver = format!(
        "import {{ openSync, writeSync, closeSync }} from \"node:fs\";\n\
         // Results to their own file, as on the compiled side: stdout is the\n\
         // program's, and its `console.log` is compared as output, never\n\
         // mistaken for a case.\n\
         const resultsFd = openSync(process.env.NTS_DIFF_RESULTS, \"a\");\n\
         function emit(line) {{ writeSync(resultsFd, line); }}\n\
         {load}\
         const view = new DataView(new ArrayBuffer(8));\n\
         function showString(name, at, s) {{\n\
         \x20 // The compiled side answers `undefined` for an absent string, and\n\
         \x20 // reading `.length` here threw where it segfaulted there. `null`\n\
         \x20 // is printed as itself rather than folded in with `undefined`:\n\
         \x20 // the compiler represents both as the null pointer, so folding\n\
         \x20 // them would make a `string | null` export *agree* about a\n\
         \x20 // difference it cannot represent.\n\
         \x20 if (s === undefined) {{ emit(`${{name}} ${{at}} undefined\\n`); return; }}\n\
         \x20 if (s === null) {{ emit(`${{name}} ${{at}} null\\n`); return; }}\n\
         \x20 let out = `${{name}} ${{at}} str ${{s.length}}`;\n\
         \x20 for (let i = 0; i < s.length; i++) out += `,${{s.charCodeAt(i)}}`;\n\
         \x20 emit(out + \"\\n\");\n\
         }}\n\
         function show(name, at, value) {{\n\
         \x20 const n = Number(value);\n\
         \x20 if (Number.isNaN(n)) {{ emit(`${{name}} ${{at}} nan\\n`); return; }}\n\
         \x20 view.setFloat64(0, n);\n\
         \x20 const bits = view.getBigUint64(0).toString(16).padStart(16, \"0\");\n\
         \x20 emit(`${{name}} ${{at}} ${{bits}}\\n`);\n\
         }}\n"
    );
    driver.push_str(engine.stop_handler());
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
                    "try {{ await {call}; emit(`{} {at} undefined\n`); }} \
                     catch (error) {{ stopped({:?}, {at}, error, \"rejected\"); }}",
                    one.name, one.name
                ),
                Some(_) => writeln!(
                    driver,
                    "try {{ {show}({:?}, {at}, await {call}); }} \
                     catch (error) {{ stopped({:?}, {at}, error, \"rejected\"); }}",
                    one.name, one.name
                ),
                // The same guard the two arms above have, for the same
                // reason, arrived late. An uncaught throw ends the module --
                // "one rejecting case cost every case after it" is written up
                // there about promises, and a *synchronous* throw does exactly
                // the same thing and had no catch at all.
                //
                // `benchmarks/cases/fib` is where it showed: the pool hands it
                // 2147483647 and node raises `RangeError: Maximum call stack
                // size exceeded`, so the driver died at case 20 and the
                // fourteen after it were never asked. The compiled program
                // exhausted its stack on precisely the same five values, so
                // both sides had nothing -- but only one of them said so, and
                // the other silently stopped.
                //
                // `threw` rather than `rejected`, which is a settled promise
                // and a different fact. Where the compiled side also refused,
                // the line is dropped with the rest at that index and the case
                // is skipped; where the compiled side *answered*, `threw`
                // against a number is a disagreement, which is what a
                // divergence between the two is supposed to look like.
                None => writeln!(
                    driver,
                    "try {{ {show}({:?}, {at}, {call}); }} \
                     catch (error) {{ stopped({:?}, {at}, error, \"threw\"); }}",
                    one.name, one.name
                ),
            };
        }
    }
    // The terminal marker, the same as the compiled side's: a driver that died
    // after three cases must not read as a run of three.
    let _ = writeln!(
        driver,
        "emit(\"done {}\\n\"); closeSync(resultsFd);",
        interleaved(testable).len()
    );
    driver
}

/// The program as a WebAssembly module, run by node with [`run_node`]'s driver.
///
/// The driver imports the module's generated glue instead of the source, so
/// the pool, the order and every line are node's own and the two runs compare
/// as any backend's do. A module declines a case by name without ending the
/// process, so nothing restarts: a declined case's line says `refused`, and
/// its index joins `refused` as a native stop on that case does.
///
/// **Only the testable functions cross to JavaScript; every function is still
/// compiled.** The emitter lowers every body, published or not, so a decline
/// in any of them -- a non-scalar export's included -- fails the program as a
/// C decline does. Publishing an export this check never calls would only
/// decline the program over a boundary nothing crosses here, which the census
/// and the boundary work measure.
fn run_wasm(
    dir: &Utf8Path,
    program: &hir::Program,
    sources: &[nts_diagnostics::SourceFile],
    testable: &[Testable],
    refused: &mut Vec<usize>,
    aborts: &mut Vec<String>,
) -> Result<Run> {
    let mut program = program.clone();
    let called: std::collections::HashSet<&str> =
        testable.iter().map(|one| one.name.as_str()).collect();
    program
        .public_api
        .retain(|(emitted, _)| called.contains(emitted.as_str()));
    program.public_namespaces.clear();
    let emitted = match case_costs::measure("wasm.emit", || nts_codegen_wasm::emit(&program)) {
        Ok(emitted) => emitted,
        Err(nts_codegen_wasm::EmitError::Declined(diagnostics)) => {
            for diagnostic in &diagnostics {
                eprintln!(
                    "  not emitted: {}",
                    nts_diagnostics::diagnostic_line(sources, diagnostic)
                );
            }
            bail!(
                "the Wasm backend declined {} shape(s), listed above; nothing can be \
                 checked until they are removed or supported",
                diagnostics.len()
            );
        }
        Err(error) => return Err(error.into()),
    };
    // A check calls every export it keeps, so one the boundary declined stops
    // it as a declined shape does, where the module would otherwise be emitted
    // without it.
    if !emitted.declined.is_empty() {
        for declined in &emitted.declined {
            let line = declined.diagnostic().map_or_else(
                || declined.to_string(),
                |diagnostic| nts_diagnostics::diagnostic_line(sources, &diagnostic),
            );
            eprintln!("  not emitted: {line}");
        }
        bail!(
            "the Wasm backend declined {} export(s), listed above; nothing can be \
             checked until they are removed or supported",
            emitted.declined.len()
        );
    }
    let glue = nts_codegen_wasm::glue(&emitted.manifest, nts_codegen_wasm::Host::Node)
        .map_err(anyhow::Error::msg)?;
    let module = dir.join("wasm");
    std::fs::create_dir_all(&module)?;
    std::fs::write(module.join("program.wasm"), &emitted.bytes)?;
    std::fs::write(module.join(nts_codegen_wasm::PROGRAM_FILE), glue.program)?;
    std::fs::write(module.join(nts_codegen_wasm::INSTANCE_FILE), glue.instance)?;
    let import = format!("file://{}", module.join(nts_codegen_wasm::PROGRAM_FILE));
    let path = dir.join("wasm_driver.mjs");
    std::fs::write(&path, driver(&import, testable, Engine::Wasm))?;
    let results_path = dir.join("results-wasm.txt");
    let _ = std::fs::remove_file(&results_path);
    let run = case_costs::child("program.total", || {
        without_colour(bounded("node"))
            .env("NTS_DIFF_RESULTS", results_path.as_str())
            .arg(&path)
            .output()
            .context("running the Wasm module under node")
    })?;
    let results = wasm_results(
        node_results("wasm", &results_path, &run)?,
        testable,
        refused,
        aborts,
    )?;
    Ok(Run {
        results,
        output: lines(&run.stdout),
        thrown: Vec::new(),
    })
}

/// Read the driver's own results channel. A compiler abort is not an input
/// decline, even if earlier cases answered or a later case also throws in node.
/// JSON keeps a reason containing quotes or newlines on one physical line.
fn wasm_results(
    lines: Vec<String>,
    testable: &[Testable],
    refused: &mut Vec<usize>,
    aborts: &mut Vec<String>,
) -> Result<Vec<String>> {
    let expected = results(testable);
    let mut collected = Vec::new();
    let mut at = 0;
    for line in lines {
        if let Some(outcome) = expected
            .get(at)
            .and_then(|prefix| line.strip_prefix(prefix))
        {
            if let Some(message) = outcome.strip_prefix("abort ") {
                aborts.push(serde_json::from_str(message).context("reading a Wasm compiler stop")?);
                // Align node's answer, just as collect_restarting does for a
                // native abort. Report.aborts makes the check fail regardless.
                refused.push(at);
            } else if outcome == "refused" {
                refused.push(at);
            } else {
                collected.push(line);
            }
            at += 1;
        } else if let Some(message) = line.strip_prefix("abort ") {
            // The initializer stopped before any exported case was called.
            aborts.push(serde_json::from_str(message).context("reading a Wasm initializer stop")?);
        } else {
            bail!("the Wasm driver wrote an unexpected result: {line}");
        }
    }
    Ok(collected)
}

/// Which engine a driver's import is run on.
#[derive(Clone, Copy)]
enum Engine {
    Node,
    Wasm,
}

impl Engine {
    fn stop_handler(self) -> &'static str {
        match self {
            Self::Node => {
                "function stopped(name, at, error, word) { emit(`${name} ${at} ${word}\\n`); }\n"
            }
            Self::Wasm => {
                "function compilerStop(error) {\n\
                 \x20 if (error?.kind === \"compiler-stop\") return `nts: refused at run time: ${error.reason}`;\n\
                 \x20 if (error instanceof WebAssembly.RuntimeError) return `nts: wasm trap: ${error.message}`;\n\
                 \x20 return null;\n\
                 }\n\
                 function stopped(name, at, error, word) {\n\
                 \x20 const why = compilerStop(error);\n\
                 \x20 if (why !== null) { emit(`${name} ${at} abort ${JSON.stringify(why)}\\n`); return; }\n\
                 \x20 const declined = error?.code === \"NTS5001\" && !error.uncaught;\n\
                 \x20 emit(`${name} ${at} ${declined ? \"refused\" : word}\\n`);\n\
                 }\n"
            }
        }
    }

    fn load_module(self, import: &str) -> String {
        match self {
            Self::Node => format!("const m = await import({import:?});\n"),
            Self::Wasm => format!(
                "let m;\n\
                 try {{ m = await import({import:?}); }} catch (error) {{\n\
                 \x20 const why = compilerStop(error);\n\
                 \x20 if (why === null) throw error;\n\
                 \x20 emit(`abort ${{JSON.stringify(why)}}\\n`);\n\
                 \x20 emit(\"done 0\\n\"); closeSync(resultsFd); process.exit(1);\n\
                 }}\n"
            ),
        }
    }
}

fn run_node(
    dir: &Utf8Path,
    entry: &Utf8Path,
    testable: &[Testable],
    sources: &[nts_diagnostics::SourceFile],
) -> Result<Run> {
    let absolute = entry
        .canonicalize_utf8()
        .with_context(|| format!("locating {entry}"))?;
    let driver = driver(&format!("file://{absolute}"), testable, Engine::Node);
    let path = dir.join("check_driver.mjs");
    std::fs::write(&path, driver)?;
    let hook = dir.join("resolve_ts.mjs");
    std::fs::write(&hook, RESOLVE_TS)?;
    let shadow = artifact_shadow::oracle(dir, sources);

    let results_path = dir.join("results-node.txt");
    // **The spawner truncates, the harness appends.** A file left by a previous
    // run at this path would read as this run's results, so it goes before
    // node starts -- here, where the run boundary is known.
    let _ = std::fs::remove_file(&results_path);
    let run = case_costs::child("oracle.execute", || {
        without_colour(bounded("node"))
            .env("NTS_DIFF_RESULTS", results_path.as_str())
            // Node strips types by default, which *refuses* the two TypeScript
            // constructs that are not erasable: a parameter property and an `enum`.
            // `constructor(private x: number)` is `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
            // ... not supported in strip-only mode`, and the oracle cannot run the
            // program at all.
            //
            // Transform mode compiles them instead of refusing them, which is what
            // `tsc` does and what the language says they mean. Without it, two
            // features on the goal's list are unverifiable rather than unimplemented
            // -- and "unmeasured is not done" would make them permanently not done
            // for a reason that has nothing to do with this compiler.
            //
            // Everything already passing is unaffected: an erasable program is
            // stripped identically either way, which the 89 examples check.
            .arg("--experimental-transform-types")
            .arg("--import")
            .arg(format!("file://{hook}"))
            .arg(&path)
            .output()
            .context("running node")
    });
    let result = run.and_then(|run| {
        let results = node_results("node", &results_path, &run)?;
        Ok(Run {
            results,
            output: lines(&run.stdout),
            thrown: Vec::new(),
        })
    });
    artifact_shadow::finish_oracle(shadow, &result);
    result
}

/// The node oracle, uncoloured whatever shell launched it.
///
/// **The oracle's output is decided by the oracle, not by the shell that
/// launched it.** `console.log` colourises through `util.inspect` when the
/// stream says colour is wanted, and `FORCE_COLOR` says so even into a pipe: a
/// developer shell exporting it turned `tests/programs/console` into 74
/// disagreements that were entirely escape codes, on one machine and not
/// another. Removed, and `NO_COLOR` set so the intent is stated rather than
/// implied by the absence of two variables.
fn without_colour(mut command: std::process::Command) -> std::process::Command {
    command
        .env_remove("FORCE_COLOR")
        .env_remove("CLICOLOR_FORCE")
        .env("NO_COLOR", "1");
    command
}

/// Node's results file, judged: the `done` line stripped, and its absence
/// split by how node ended. Apart from `run_node` so the rules about a
/// truncated file sit in one place.
fn node_results(
    engine: &str,
    results_path: &Utf8Path,
    run: &std::process::Output,
) -> Result<Vec<String>> {
    let mut results = std::fs::read(results_path)
        .map(|bytes| lines(&bytes))
        .unwrap_or_default();
    if results.last().is_some_and(|last| last.starts_with("done ")) {
        results.pop();
    } else {
        // **Said, and not fatal.** Node stopping part-way -- a pool value in a
        // loop bound, or its heap exhausted by one (`tests/programs/array-from` asks
        // for an array of 2^31) -- was always tolerated: the cases it answered
        // are compared and the rest are "not reached". The `done` line's job
        // is to make that *visible* rather than a short run that looks whole,
        // so it is printed here; turning it into an error lost three examples'
        // worth of answered cases on its first corpus run.
        if results.is_empty() && !run.status.success() {
            bail!("{engine}: {}", String::from_utf8_lossy(&run.stderr));
        }
        // Split by how it ended. Non-zero or a signal: the run died, which its
        // status already says, and the answered cases are kept. **Exit 0 with no
        // `done`**: the driver wrote fewer cases than it answered, or was cut
        // off by something that still exited zero -- nothing legitimate does
        // that, so it is not a notice.
        if run.status.success() {
            bail!(
                "{engine} exited 0 without writing its `done` line: the results file is truncated"
            );
        }
        eprintln!(
            "  {engine} stopped part-way: {} result(s), no `done` line ({})",
            results.len(),
            String::from_utf8_lossy(&run.stderr)
                .lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("no message")
        );
    }
    Ok(results)
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
    /// Cases the compiled program did not finish inside the harness's time.
    ///
    /// Its own field because it is its own fact. Reported and not fatal -- a
    /// pool value in a loop bound asks for two billion iterations and the
    /// program does exactly what that asks -- but never again spelled as
    /// "declined", which is what a program keeping the promise its `!` made
    /// does. A refused construct and an unmeasurable one must not look alike.
    pub timeouts: usize,
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
    native_run: &Run,
    engine_run: &Run,
    testable: &[Testable],
    refused: &[usize],
    approximate: &std::collections::HashSet<String>,
) -> Report {
    // The native side skipped the cases it refused, so the node side's lines
    // are dropped at the same indices to line the two up again. Dropping rather
    // than comparing is the right thing: node answered `undefined` where the
    // compiled program declined to answer at all, and that is a difference
    // between the two languages rather than between the two compilers.
    //
    // A case's *result* line is dropped, found by counting result lines in
    // the order the cases ran. What a program prints itself (`console.log`)
    // is no longer among them: results arrive on their own file, and the
    // program's stdout is compared as a separate stream below.
    //
    // **Except a throw where node answered.** `nts: uncaught` was a decline
    // on the claim that node's driver "reports the same event as `threw`",
    // and nothing checked it: on 2026-09-30 an example read "agreed on every
    // case" while 17 of its cases ended in an uncaught `TypeError` where node
    // answered 4. So an uncaught stop is skipped only when node threw at that
    // case too; otherwise it is a disagreement, the compiled throw against
    // node's answer. A refusal (`nts: refused:`) keeps the skip.
    let native = &native_run.results;
    let results = results(testable);
    let mut case = 0;
    let mut threw_against = Vec::new();
    let mut engine: Vec<&String> = Vec::new();
    for line in &engine_run.results {
        let Some(result) = results
            .get(case)
            .filter(|result| line.starts_with(result.as_str()))
        else {
            engine.push(line);
            continue;
        };
        case += 1;
        if !refused.contains(&(case - 1)) {
            engine.push(line);
            continue;
        }
        if let Some((_, said)) = native_run.thrown.iter().find(|(at, _)| *at == case - 1)
            && *line != format!("{result}threw")
        {
            threw_against.push((format!("{result}{said}"), line.clone()));
        }
    }

    let compared = native.len().min(engine.len());
    // Cases, not lines, for the same reason: a result line is `name at value`.
    let keys: std::collections::HashSet<&str> = results.iter().map(String::as_str).collect();
    let checked = native[..compared]
        .iter()
        .filter(|line| {
            let mut spaces = line.match_indices(' ').map(|(at, _)| at);
            spaces
                .nth(1)
                .is_some_and(|second| keys.contains(&line[..=second]))
        })
        .count();
    let mut disagreements = Vec::new();
    let answered_where_we_threw = threw_against.len();
    disagreements.append(&mut threw_against);
    let mut approximated = 0;
    for at in 0..compared {
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
    // The program's own output, compared on its own now that results have a
    // channel of theirs: line for line, and a line one side printed and the
    // other did not is a disagreement, not a trailing detail.
    let (ours, theirs) = (&native_run.output, &engine_run.output);
    for at in 0..ours.len().max(theirs.len()) {
        let mine = ours.get(at).map_or("(no line)", String::as_str);
        let node = theirs.get(at).map_or("(no line)", String::as_str);
        if mine != node {
            disagreements.push((
                format!("output {at}: {mine}"),
                format!("output {at}: {node}"),
            ));
        }
    }
    Report {
        functions: testable.len(),
        checked: checked + answered_where_we_threw,
        expected: testable.iter().map(|one| tuples(&one.params).len()).sum(),
        refused: refused.len() - answered_where_we_threw,
        approximated,
        disagreements,
        aborts: Vec::new(),
        timeouts: 0,
    }
}

#[cfg(test)]
mod structural_cast_array_stop {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    const TEST: &str = "structural_cast_array_stop::a_cast_stop_uses_cores_reason_on_every_backend";
    const EXPECTED: &str = "nts: refused at run time: the field `stack` read through structural cast `{ stack?: string }` at nts-workspace:///src/main.ts:11:25 on an object whose layout supplies no accessor for it";

    #[test]
    fn a_cast_stop_uses_cores_reason_on_every_backend() {
        if std::env::var_os("NTS_CAST_STOP_ARM").is_none() {
            // Each runner reads its backend from the environment. Child test
            // processes keep that choice isolated from concurrent tests.
            for backend in ["c", "llvm", "jvm", "wasm"] {
                let output = std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", TEST, "--nocapture"])
                    .env("NTS_CAST_STOP_ARM", backend)
                    .env("NTS_BACKEND", backend)
                    .output()
                    .unwrap();
                assert!(
                    output.status.success(),
                    "{backend}: {}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            return;
        }
        let fixture = include_str!(
            "../../../tests/outcomes/a-structural-cast-of-an-erased-array-needs-a-field-reader/src/main.ts"
        );
        let helpers = fixture.split_once("export function array").unwrap().0;
        // Each ordinary receiver differs from the stopped arm only in kind.
        check_case(
            "missing",
            &format!(
                "{helpers}export function aControl(n: number): string {{ return kindOf(new Missing()); }}\nfunction zStopped(n: number): string {{ return kindOf([n]); }}\n"
            ),
            EXPECTED,
        );
        // A literal of the face's own shape can give Wasm a concrete GC
        // projection. A mismatch must use the same core reason there too.
        check_case(
            "own-shape",
            "function kindOf(value: unknown): string {\n  const held = value as { stack?: string };\n  return typeof held.stack;\n}\nexport function aControl(n: number): string {\n  const own: { stack?: string } = { stack: String(n) };\n  return kindOf(own);\n}\nfunction zStopped(n: number): string { return kindOf([n]); }\n",
            &EXPECTED.replace(":11:25", ":2:25"),
        );
        // An assertion supplies no proof that `in` has an object operand.
        // JavaScript throws here; until that TypeError is catchable, core's
        // named stop must survive every backend. The guard changes one thing.
        check_case(
            "non-object-in",
            "function contains(value: unknown): boolean {\n  const held = value as { side: number };\n  return \"side\" in held;\n}\nexport function aControl(n: number): boolean {\n  const value: unknown = n === 27 ? n : { side: n };\n  return typeof value === \"object\" && value !== null && contains(value);\n}\nfunction zStopped(n: number): boolean {\n  const value: unknown = n === 27 ? n : { side: n };\n  return contains(value);\n}\n",
            "nts: refused at run time: property membership for `side` through structural cast `{ side: number }` at nts-workspace:///src/main.ts:2:25 on a non-object, whose TypeError this compiler does not yet lower",
        );
    }

    fn check_case(label: &str, source: &str, expected: &str) {
        let path = Utf8PathBuf::from_path_buf(
            std::env::temp_dir().join(format!("nts-cast-stop-{label}-{}", std::process::id())),
        )
        .unwrap();
        std::fs::create_dir_all(path.join("src")).unwrap();
        let scratch = Scratch::holding(path);
        let main = scratch.path.join("src/main.ts");
        std::fs::write(&main, source).unwrap();
        let config = scratch.path.join("tsconfig.json");
        let base = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tsconfig.fixtures.json");
        std::fs::write(
            &config,
            serde_json::json!({"extends": base, "include": ["src/main.ts"]}).to_string(),
        )
        .unwrap();
        let mut frontend = Frontend::new(&scratch.path).with_checkers(std::num::NonZeroU16::MIN);
        let control = check(&config, &mut frontend).unwrap();
        assert_eq!((control.functions, control.checked), (1, 29));
        assert!(control.agreed(), "{control:?}");
        std::fs::write(
            &main,
            source.replace("function zStopped", "export function zStopped"),
        )
        .unwrap();
        let report = check(&config, &mut frontend).unwrap();
        assert_eq!(report.functions, 2);
        assert_eq!(report.disagreements, Vec::<(String, String)>::new());
        assert!(
            !report.aborts.is_empty(),
            "{label}: the unsupported arm must stop: {report:?}"
        );
        assert!(
            report.aborts.iter().all(|reason| reason == expected),
            "{:?}",
            report.aborts
        );
        assert!(!report.agreed(), "a named compiler stop is not agreement");
    }
}

#[cfg(test)]
mod wasm_compiler_stop_guard {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use nts_core::hir::{Absent, Block, Callee, Func, Op, OpKind, Provider, Terminator, ValueId};

    const REASON: &str = "`Example#method` was refused: the original lowering reason";

    fn case(name: &str) -> Testable {
        Testable {
            name: name.to_owned(),
            returns: HirType::NUMBER,
            result_absent: Absent::Impossible,
            params: Vec::new(),
        }
    }

    fn directory(label: &str) -> Scratch {
        let path = Utf8PathBuf::from_path_buf(
            std::env::temp_dir().join(format!("nts-wasm-stop-{label}-{}", std::process::id())),
        )
        .unwrap();
        std::fs::create_dir_all(&path).unwrap();
        Scratch::holding(path)
    }

    fn run_driver(
        dir: &Utf8Path,
        source: &str,
        cases: &[Testable],
        refused: &mut Vec<usize>,
        aborts: &mut Vec<String>,
    ) -> Vec<String> {
        let module = dir.join("wrapper.mjs");
        std::fs::write(&module, source).unwrap();
        let path = dir.join("driver.mjs");
        std::fs::write(
            &path,
            driver(&format!("file://{module}"), cases, Engine::Wasm),
        )
        .unwrap();
        let results = dir.join("driver-results.txt");
        let run = without_colour(bounded("node"))
            .env("NTS_DIFF_RESULTS", results.as_str())
            .arg(path)
            .output()
            .unwrap();
        wasm_results(
            node_results("wasm", &results, &run).unwrap(),
            cases,
            refused,
            aborts,
        )
        .unwrap()
    }

    fn program() -> hir::Program {
        let origin = nts_semantic_schema::Origin::source(nts_diagnostics::Location {
            file: nts_diagnostics::SourceId(0),
            span: nts_diagnostics::Span { start: 0, end: 0 },
        });
        let op = |kind, ty| Op {
            kind,
            ty,
            origin: origin.clone(),
        };
        let mut stopped = Func {
            name: "stopped".to_owned(),
            params: Vec::new(),
            return_type: HirType::NUMBER,
            written_return: None,
            written_return_elements: Vec::new(),
            result_absent: Absent::Impossible,
            values: vec![
                op(
                    OpKind::ConstString(REASON.into()),
                    HirType::Managed(hir::ManagedType::String),
                ),
                op(
                    OpKind::Call {
                        callee: Callee::External("nts_refused".to_owned()),
                        args: vec![ValueId(0)],
                        frame: None,
                    },
                    HirType::Void,
                ),
            ],
            blocks: vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1)],
                terminator: Terminator::Unreachable,
            }],
            origin: origin.clone(),
            exported: true,
            initializes_receiver: false,
            abstract_declaration: false,
            async_result: None,
            frame: None,
            obligations: Vec::new(),
            exact: nts_core::hir::ExactArithmetic::default(),
        };
        let mut control = stopped.clone();
        control.name = "control".to_owned();
        control.values = vec![op(OpKind::ConstFloat(7.0), HirType::NUMBER)];
        control.blocks = vec![Block {
            params: Vec::new(),
            ops: vec![ValueId(0)],
            terminator: Terminator::Return(Some(ValueId(0))),
        }];
        stopped.exported = true;
        hir::Program {
            funcs: vec![control, stopped],
            provider: Provider::HostGc,
            public_api: vec![
                ("control".to_owned(), "control".to_owned()),
                ("stopped".to_owned(), "stopped".to_owned()),
            ],
            ..hir::Program::default()
        }
    }

    #[test]
    fn a_wasm_named_runtime_stop_is_a_compiler_stop_with_its_message() {
        let scratch = directory("named");
        let dir = &scratch.path;
        let program = program();
        // The emitter and the runner work: the same program's ordinary export
        // answers, with no skipped input, before the named-stop subject runs.
        let mut refused = Vec::new();
        let mut aborts = Vec::new();
        let control = run_wasm(
            dir,
            &program,
            &[],
            &[case("control")],
            &mut refused,
            &mut aborts,
        )
        .unwrap();
        assert_eq!(control.results.len(), 1);
        assert!(refused.is_empty() && aborts.is_empty());
        let cases = [case("control"), case("stopped")];
        let result = run_wasm(dir, &program, &[], &cases, &mut refused, &mut aborts).unwrap();
        // C's corresponding stop is a compiler defect, never an input decline.
        let message = format!("nts: refused at run time: {REASON}");
        assert_eq!(
            stopped_with(Some(134), None, &message),
            Stopped::Defect(message.clone())
        );
        assert_eq!(aborts, [message]);
        assert_eq!(refused, [1]);
        assert_eq!(
            result.results.len(),
            1,
            "the earlier control still answered"
        );
        let report = Report {
            checked: 1,
            aborts,
            ..Report::default()
        };
        assert!(
            !report.agreed(),
            "a compiler stop cannot count as agreement"
        );
    }

    #[test]
    fn an_assertion_declines_but_a_wasm_trap_aborts() {
        let scratch = directory("assertion-trap");
        let mut program = program();
        let mut asserted = program.funcs[1].clone();
        asserted.name = "asserted".into();
        let OpKind::Call { callee, .. } = &mut asserted.values[1].kind else {
            panic!("fixture call");
        };
        *callee = Callee::External("nts_assertion_failed".into());
        let mut trapped = asserted.clone();
        trapped.name = "trapped".into();
        trapped.values.clear();
        trapped.blocks[0].ops.clear();
        for f in [asserted, trapped] {
            program.public_api.push((f.name.clone(), f.name.clone()));
            program.funcs.push(f);
        }
        let (mut refused, mut aborts) = (Vec::new(), Vec::new());
        let result = run_wasm(
            &scratch.path,
            &program,
            &[],
            &[case("control"), case("asserted"), case("trapped")],
            &mut refused,
            &mut aborts,
        )
        .unwrap();
        assert_eq!(result.results.len(), 1);
        assert_eq!(refused, [1, 2]);
        assert_eq!(
            aborts.len(),
            1,
            "the representation assertion is not a compiler abort"
        );
        assert!(aborts[0].starts_with("nts: wasm trap: ") && aborts[0].contains("unreachable"));
    }

    #[test]
    fn an_async_compiler_stop_keeps_its_reason_and_source_throws_stay_throws() {
        let scratch = directory("async");
        let (mut refused, mut aborts) = (Vec::new(), Vec::new());
        run_wasm(
            &scratch.path,
            &program(),
            &[],
            &[case("control"), case("stopped")],
            &mut refused,
            &mut aborts,
        )
        .unwrap();
        refused.clear();
        aborts.clear();
        let mut cases = [
            case("control"),
            case("sourceThrow"),
            case("sourceReject"),
            case("asyncStop"),
        ];
        for at in [2, 3] {
            cases[at].returns =
                HirType::Managed(hir::ManagedType::Promise(Box::new(HirType::NUMBER)));
        }
        let result = run_driver(
            &scratch.path,
            "import { control, stopped } from './wasm/program.mjs';\n\
             export { control };\n\
             export function sourceThrow() { throw 17; }\n\
             export async function sourceReject() { throw 17; }\n\
             export async function asyncStop() { return stopped(); }\n",
            &cases,
            &mut refused,
            &mut aborts,
        );
        assert_eq!(result.len(), 3);
        assert_eq!(result[1], "sourceThrow 0 threw");
        assert_eq!(result[2], "sourceReject 0 rejected");
        assert_eq!(refused, [3]);
        assert_eq!(aborts, [format!("nts: refused at run time: {REASON}")]);
    }

    #[test]
    fn a_compiler_stop_while_importing_is_an_abort_not_a_short_clean_run() {
        let scratch = directory("init");
        let (mut refused, mut aborts) = (Vec::new(), Vec::new());
        run_wasm(
            &scratch.path,
            &program(),
            &[],
            &[case("control"), case("stopped")],
            &mut refused,
            &mut aborts,
        )
        .unwrap();
        refused.clear();
        aborts.clear();
        let result = run_driver(
            &scratch.path,
            "import { stopped } from './wasm/program.mjs'; stopped();\n",
            &[case("control")],
            &mut refused,
            &mut aborts,
        );
        assert!(result.is_empty() && refused.is_empty());
        assert_eq!(aborts, [format!("nts: refused at run time: {REASON}")]);
    }

    #[test]
    fn a_compiler_stop_reason_cannot_write_case_records() {
        let scratch = directory("reason");
        let mut program = program();
        let reason = "a \"quoted\" reason\ncontrol 0 nan\ndone 99\nλ";
        program.funcs[1].values[0].kind = OpKind::ConstString(reason.into());
        let (mut refused, mut aborts) = (Vec::new(), Vec::new());
        let result = run_wasm(
            &scratch.path,
            &program,
            &[],
            &[case("control"), case("stopped")],
            &mut refused,
            &mut aborts,
        )
        .unwrap();
        assert_eq!(result.results.len(), 1);
        assert_eq!(refused, [1]);
        assert_eq!(aborts, [format!("nts: refused at run time: {reason}")]);
    }
}

#[cfg(test)]
mod classification {
    use super::{Stopped, stopped_with};

    /// The text `java` actually prints, kept verbatim rather than paraphrased:
    /// the classifier reads stderr, so a test that invented its own wording
    /// would agree with itself about a format nothing produces.
    const VERIFY_ERROR: &str = "Exception in thread \"main\" java.lang.VerifyError: Bad type on operand stack\nException Details:\n  Location:\n    nts/gen/Program.subclassChain(D)D @19: invokestatic\n  Reason:\n    Type 'nts/gen/Counter' (current frame, stack[0]) is not assignable to 'nts/gen/Labelled'\n";

    #[test]
    fn a_class_that_will_not_verify_is_a_defect() {
        assert!(
            matches!(stopped_with(None, None, VERIFY_ERROR), Stopped::Defect(_)),
            "a VerifyError read as a declined case, which is how              `tests/programs/fluent-this` reported seventeen bounds failures about a              file with no subscript in it"
        );
    }

    #[test]
    fn every_linkage_failure_is_a_defect() {
        // Each of these means the class is wrong rather than the program
        // computing something wrong, and there is no input for which any of
        // them is a legitimate answer.
        for name in [
            "NoSuchMethodError",
            "AbstractMethodError",
            "ClassFormatError",
            "IllegalAccessError",
            "IncompatibleClassChangeError",
            "NoClassDefFoundError",
            "NoSuchFieldError",
            "UnsupportedClassVersionError",
        ] {
            let complaint =
                format!("Exception in thread \"main\" java.lang.{name}: nts/gen/Program\n");
            assert!(
                matches!(stopped_with(None, None, &complaint), Stopped::Defect(_)),
                "{name} read as a declined case"
            );
        }
    }

    #[test]
    fn a_refusal_is_still_a_declined_case() {
        // The other half, and the reason this is not simply "non-empty stderr
        // is a defect": a program that declines an input says so on stderr and
        // exits non-zero, and that is the normal, expected outcome for a pool
        // value outside a parameter's proved type.
        assert!(matches!(
            stopped_with(None, None, "nts: refused: index 5 is outside [0, 3)\n"),
            Stopped::Declined
        ));
        assert!(matches!(
            stopped_with(None, None, "nts: out of memory\n"),
            Stopped::Declined
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::{Stopped, stopped_with};

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
            stopped_with(None, Some(6), "nts: refused: index 9 is outside [0, 3)\n"),
            Stopped::Declined,
        );
        // Out of the memory this harness allowed: not reached, not a verdict.
        assert_eq!(
            stopped_with(None, Some(9), "nts: out of memory\n"),
            Stopped::Declined,
        );
        // A timeout. `timeout` exits of its own accord, so there is no signal
        // on the child and nothing was printed.
        assert_eq!(stopped_with(None, None, ""), Stopped::Declined);
        // The same empty complaint, with `timeout`'s exit code in front of it.
        // These two lines are the whole bug: a run that said nothing because it
        // refused and a run that said nothing because it was killed were one
        // verdict, and the second is not a verdict at all.
        assert_eq!(stopped_with(Some(124), None, ""), Stopped::TimedOut);
        // A segfault that printed nothing. This is the case that was missing.
        assert!(matches!(
            stopped_with(None, Some(11), ""),
            Stopped::Defect(_)
        ));
        // And one that named itself is a defect however it died.
        assert!(matches!(
            stopped_with(None, None, "nts: `x` was read before its declaration ran\n"),
            Stopped::Defect(_)
        ));
    }

    /// A sanitizer's report is a defect, named by its kind and not by the
    /// address, which differs on every run -- and it wins over a refusal line
    /// printed before it, because the memory was used wrongly whatever the
    /// program said first.
    #[test]
    fn an_address_sanitizer_report_is_a_defect_by_its_kind() {
        let report = "nts: refused: index 9 is outside [0, 3)\n\
             ==3978772==ERROR: AddressSanitizer: heap-use-after-free on address \
             0x7bd702de0060 at pc 0x563a768bd5ba\n\
             READ of size 8 at 0x7bd702de0060 thread T0\n";
        assert_eq!(
            stopped_with(Some(1), None, report),
            Stopped::Defect("AddressSanitizer: heap-use-after-free".to_owned()),
        );
    }

    /// A program that *threw* is a defect, and this is the gap it closes.
    ///
    /// `Check.java` runs the generated entry point reflectively and catches
    /// `Throwable`, printing a stack trace and exiting 1. Exiting is not a
    /// signal, and an ordinary runtime exception has no fixed name the list of
    /// link-time errors could hold — so both rules above missed it and the
    /// fallthrough filed it as the program declining its input.
    ///
    /// Measured, on a generated `<init>` leaving an optional reference field
    /// `null` where `undefined` was meant: **"checked 4 of 174 cases"**
    /// followed by **"agreed on every case"**, with a hundred and seventy
    /// `NullPointerException`s counted as declines. The example that would
    /// have caught the defect could not, because the harness turned its
    /// failures into skips.
    #[test]
    fn a_thrown_exception_is_a_defect_and_names_its_cause() {
        let trace = [
            "java.lang.reflect.InvocationTargetException",
            "\tat java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(X.java:118)",
            "Caused by: java.lang.NullPointerException: Cannot read field \"tag\" because \"<local3>\" is null",
            "\tat nts.gen.Program.unassignedRef(Program.java)",
        ]
        .join("\n");
        let Stopped::Defect(said) = stopped_with(None, None, &trace) else {
            panic!("a thrown exception is not a declined case");
        };
        // The *cause*, not the reflective wrapper. `InvocationTargetException`
        // is what `Check.java`'s reflection always reports and says nothing
        // about which field of which method was wrong.
        assert!(
            said.contains("NullPointerException") && said.contains("tag"),
            "the cause should be named, not the wrapper: {said}",
        );
        assert!(
            !said.contains("InvocationTargetException"),
            "the wrapper should not be what is reported: {said}",
        );
    }

    /// A refusal that arrives *as* a throwable is still a refusal.
    ///
    /// `Check.java` has a `catch (NtsRefusal)` arm, and it is **dead**: the
    /// entry point is called reflectively, so reflection wraps the refusal in
    /// an `InvocationTargetException` and only the `Throwable` catch-all sees
    /// it. A real bounds refusal therefore arrives with a stack trace attached.
    ///
    /// Found by the gate: the first version of the stack-frame rule turned nine
    /// passing examples into failures, and `tests/programs/arrays` was refusing
    /// `index -0.5 is outside [0, 3)` exactly as it should.
    #[test]
    fn a_refusal_wrapped_by_reflection_is_still_a_refusal() {
        let trace = [
            "java.lang.reflect.InvocationTargetException",
            "\tat java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(X.java:118)",
            "Caused by: nts.rt.NtsRefusal: nts: refused: index -0.500000 is outside [0, 3)",
            "\tat nts.rt.Check.bounds(Check.java:64)",
        ]
        .join("\n");
        assert_eq!(stopped_with(None, None, &trace), Stopped::Declined);
    }

    /// And running out of heap is not reached, not a verdict.
    ///
    /// The pool asks for a loop bound of nine quadrillion and a program that
    /// allocates per iteration does what that asks. The C lane recognises its
    /// own `nts: out of memory`; this is the same fact in the JVM's words, and
    /// it arrives as a throwable with a trace like any other.
    #[test]
    fn running_out_of_heap_is_not_a_defect() {
        let trace = [
            "java.lang.OutOfMemoryError: Java heap space",
            "\tat nts.gen.Program.build(Program.java)",
        ]
        .join("\n");
        assert_eq!(stopped_with(None, None, &trace), Stopped::Declined);
    }

    /// And a refusal that happens to mention a frame is still a refusal.
    ///
    /// The half a naive rule breaks: searching for the word `at` anywhere, or
    /// for `Exception`, would file a bounds check that printed a path
    /// containing `at ` as a defect. The rule is a *stack frame* — a line whose
    /// first token is `at` and which carries a parenthesised location — and a
    /// refusal is recognised before it is reached.
    #[test]
    fn a_refusal_is_not_a_stack_trace() {
        assert_eq!(
            stopped_with(
                None,
                Some(6),
                "nts: refused: index 9 is outside [0, 3) at /var/cat(1)/x
"
            ),
            Stopped::Declined,
        );
    }
}

#[cfg(test)]
mod result_channel {
    use super::collect_restarting;
    use camino::Utf8PathBuf;
    use std::os::unix::process::ExitStatusExt;

    fn scratch(name: &str) -> Utf8PathBuf {
        let dir = Utf8PathBuf::from_path_buf(
            std::env::temp_dir().join(format!("nts-result-channel-{name}-{}", std::process::id())),
        )
        .expect("utf-8 temp dir");
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn exited(stdout: &str) -> std::process::Output {
        std::process::Output {
            status: std::process::ExitStatus::from_raw(0),
            stdout: stdout.as_bytes().to_vec(),
            stderr: Vec::new(),
        }
    }

    const RESULTS: [&str; 2] = ["f 0 ", "f 1 "];

    fn expected() -> Vec<String> {
        RESULTS.iter().map(|r| (*r).to_owned()).collect()
    }

    /// A run that answered every case and wrote no `done` line is reported --
    /// the shape of a program that died after its last case, which without a
    /// terminal marker reads exactly like a clean run.
    #[test]
    fn answering_every_case_without_done_is_reported() {
        let dir = scratch("no-done");
        let (mut refused, mut aborts, mut timeouts) = (Vec::new(), Vec::new(), 0);
        let run = collect_restarting(
            &dir,
            &expected(),
            &mut refused,
            &mut aborts,
            &mut timeouts,
            |_, path| {
                std::fs::write(path, "f 0 1\nf 1 2\n").expect("write results");
                Ok(exited(""))
            },
        )
        .expect("collect");
        assert_eq!(run.results.len(), 2);
        assert!(
            aborts.iter().any(|a| a.contains("without its `done` line")),
            "no report: {aborts:?}"
        );
    }

    /// The spawner truncates: a file left at the path by an earlier run must
    /// never be read as this run's results.
    #[test]
    fn a_stale_results_file_is_removed_before_the_spawn() {
        let dir = scratch("stale");
        std::fs::write(dir.join("results-0.txt"), "f 0 stale\nf 1 stale\ndone 2\n")
            .expect("stale file");
        let (mut refused, mut aborts, mut timeouts) = (Vec::new(), Vec::new(), 0);
        let run = collect_restarting(
            &dir,
            &expected(),
            &mut refused,
            &mut aborts,
            &mut timeouts,
            |_, path| {
                assert!(
                    !path.exists(),
                    "the stale file was still there when the program started"
                );
                std::fs::write(path, "f 0 fresh\nf 1 fresh\ndone 2\n").expect("write results");
                Ok(exited(""))
            },
        )
        .expect("collect");
        assert_eq!(
            run.results,
            vec!["f 0 fresh".to_owned(), "f 1 fresh".to_owned()]
        );
        assert!(aborts.is_empty(), "{aborts:?}");
    }

    /// Exit 0 part-way with no `done`: nothing legitimate produces it, so it
    /// is a defect -- a truncated file must never read as a short clean run.
    #[test]
    fn exit_zero_without_done_part_way_is_a_defect() {
        let dir = scratch("exit-zero");
        let (mut refused, mut aborts, mut timeouts) = (Vec::new(), Vec::new(), 0);
        let _ = collect_restarting(
            &dir,
            &expected(),
            &mut refused,
            &mut aborts,
            &mut timeouts,
            |_, path| {
                std::fs::write(path, "f 0 1\n").expect("write results");
                Ok(exited(""))
            },
        )
        .expect("collect");
        assert!(
            aborts.iter().any(|a| a.contains("exited 0 after 1 of 2")),
            "no report: {aborts:?}"
        );
    }

    /// The marker must agree with the reader: `done 3` after two lines is a
    /// harness that miscounts, and it is reported.
    #[test]
    fn a_done_count_that_disagrees_is_reported() {
        let dir = scratch("miscount");
        let (mut refused, mut aborts, mut timeouts) = (Vec::new(), Vec::new(), 0);
        let _ = collect_restarting(
            &dir,
            &expected(),
            &mut refused,
            &mut aborts,
            &mut timeouts,
            |_, path| {
                std::fs::write(path, "f 0 1\nf 1 2\ndone 3\n").expect("write results");
                Ok(exited(""))
            },
        )
        .expect("collect");
        assert!(
            aborts.iter().any(|a| a.contains("wrote `done 3` after 2")),
            "no report: {aborts:?}"
        );
    }

    /// Program output shaped exactly like a result stays output: it cannot
    /// answer, duplicate or hide a case, because results have their own file.
    #[test]
    fn output_shaped_like_a_result_is_not_a_result() {
        let dir = scratch("spoof");
        let (mut refused, mut aborts, mut timeouts) = (Vec::new(), Vec::new(), 0);
        let run = collect_restarting(
            &dir,
            &expected(),
            &mut refused,
            &mut aborts,
            &mut timeouts,
            |_, path| {
                std::fs::write(path, "f 0 1\nf 1 2\ndone 2\n").expect("write results");
                Ok(exited("f 1 999 printed by the program\n"))
            },
        )
        .expect("collect");
        assert_eq!(run.results, vec!["f 0 1".to_owned(), "f 1 2".to_owned()]);
        assert_eq!(
            run.output,
            vec!["f 1 999 printed by the program".to_owned()]
        );
        assert!(refused.is_empty() && aborts.is_empty());
    }
}

#[cfg(test)]
mod pairing {
    use super::{HirType, Run, Testable, report};
    use std::collections::HashSet;

    /// One function of no parameters: one case, `f 0 `.
    fn one() -> Vec<Testable> {
        vec![Testable {
            name: "f".to_owned(),
            returns: HirType::Void,
            result_absent: nts_core::hir::Absent::Impossible,
            params: Vec::new(),
        }]
    }

    fn run(results: &[&str], thrown: &[(usize, &str)]) -> Run {
        Run {
            results: results.iter().map(|line| (*line).to_owned()).collect(),
            output: Vec::new(),
            thrown: thrown
                .iter()
                .map(|(at, line)| (*at, (*line).to_owned()))
                .collect(),
        }
    }

    /// The hole this closes: the compiled program threw where node answered,
    /// and the case was skipped as a decline. It is a disagreement.
    #[test]
    fn a_throw_where_node_answered_is_a_disagreement() {
        let compiled = run(&[], &[(0, "nts: uncaught TypeError: x")]);
        let node = run(&["f 0 4"], &[]);
        let got = report(&compiled, &node, &one(), &[0], &HashSet::new());
        assert_eq!(
            got.disagreements,
            vec![(
                "f 0 nts: uncaught TypeError: x".to_owned(),
                "f 0 4".to_owned()
            )]
        );
        assert_eq!((got.refused, got.checked), (0, 1));
        assert!(!got.agreed());
    }

    /// Both sides threw: nothing to compare, and the case is still skipped.
    #[test]
    fn a_throw_where_node_threw_is_still_skipped() {
        let compiled = run(&[], &[(0, "nts: uncaught RangeError: r")]);
        let node = run(&["f 0 threw"], &[]);
        let got = report(&compiled, &node, &one(), &[0], &HashSet::new());
        assert_eq!(
            got.disagreements,
            [] as [(std::string::String, std::string::String); 0]
        );
        assert_eq!(got.refused, 1);
    }

    /// A refusal is two languages answering differently, and keeps the skip
    /// whatever node answered -- the sibling of `a_refusal_is_still_a_declined_case`.
    #[test]
    fn a_refusal_where_node_answered_is_still_skipped() {
        let compiled = run(&[], &[]);
        let node = run(&["f 0 undefined"], &[]);
        let got = report(&compiled, &node, &one(), &[0], &HashSet::new());
        assert_eq!(
            got.disagreements,
            [] as [(std::string::String, std::string::String); 0]
        );
        assert_eq!(got.refused, 1);
    }
}

#[cfg(test)]
mod table_membership_tests;

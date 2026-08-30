//! The `nts` command-line interface.
//!
//! Commands are added as the capability behind them becomes real. A command that
//! prints a plausible result for something the compiler cannot yet do is worse
//! than no command: RFC §4.1 requires that unsupported reachable behavior be
//! diagnosed precisely, and that promise starts here.

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir::facts;
use nts_core::hir::{self, BinOp, HirType, ManagedType, OpKind};
use nts_core::reachability;
use nts_diagnostics::Location;
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo, tsgo::decompose::Budget};
use nts_semantic_schema::SCHEMA_VERSION;

/// The tsconfig a subcommand was pointed at: the first positional argument, or
/// the one in the working directory.
fn project(rest: &[String]) -> Utf8PathBuf {
    rest.iter()
        .find(|a| !a.starts_with("--"))
        .map_or_else(|| Utf8PathBuf::from("tsconfig.json"), Utf8PathBuf::from)
}

/// `nts check`: run a compiled program and node side by side.
fn check(rest: &[String]) -> Result<()> {
    let tsconfig = project(rest);
    let report = nts_differential::check(&tsconfig)?;
    if report.functions == 0 {
        println!(
            "nothing to check: no exported function has scalar arguments \
             and a scalar result"
        );
        return Ok(());
    }
    if report.refused > 0 {
        println!(
            "{} case(s) the compiled program declined -- an index its `!` \
             promised was in range and was not, most often; node answers \
             `undefined` there and the two have nothing to compare",
            report.refused
        );
    }
    if report.checked < report.expected {
        println!(
            "checked {} of {} cases; the rest were not reached (a pool \
             value in a loop bound will do that)",
            report.checked, report.expected
        );
    } else {
        println!(
            "checked {} cases across {} function(s)",
            report.checked, report.functions
        );
    }
    if report.approximated > 0 {
        println!(
            "{} case(s) matched only to within {} ULP, in functions whose \
             result the specification leaves implementation-approximated \
             -- glibc and V8 are both right there",
            report.approximated,
            nts_differential::TOLERANCE
        );
    }
    for abort in report.aborts.iter().take(5) {
        println!("  the compiled program aborted: {abort}");
    }
    for (native, engine) in report.disagreements.iter().take(20) {
        println!("  nts  {native}");
        println!("  node {engine}");
    }
    if report.agreed() {
        println!("agreed on every case");
        return Ok(());
    }
    if !report.aborts.is_empty() {
        bail!(
            "the compiled program aborted {} time(s) for a reason that is \
             not the program correctly declining its input",
            report.aborts.len()
        )
    }
    bail!(
        "{} case(s) disagree between the compiled program and node",
        report.disagreements.len()
    )
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("frontend") => {
            let rest: Vec<String> = args.collect();
            let decompose = rest.iter().any(|a| a == "--decompose");
            let calls = rest.iter().any(|a| a == "--calls");
            let constants = rest.iter().any(|a| a == "--constants");
            let tsconfig = project(&rest);
            frontend(&tsconfig, decompose, calls, constants)
        }
        Some("check") => check(&args.collect::<Vec<String>>()),
        Some("emit-c") => {
            let rest: Vec<String> = args.collect();
            let mut positional = rest.iter().filter(|a| !a.starts_with("--"));
            let tsconfig = positional
                .next()
                .map_or_else(|| Utf8PathBuf::from("tsconfig.json"), Utf8PathBuf::from);
            // `--out <dir>` writes the program *and* the runtime, which is what
            // it takes to compile anything. Without it the program goes to
            // stdout, which is convenient to read and not enough to build.
            let out = rest
                .iter()
                .position(|a| a == "--out")
                .and_then(|at| rest.get(at + 1))
                .map(Utf8PathBuf::from);
            emit_c(&tsconfig, out.as_deref())
        }
        // Every type the frontend resolved, as the schema records it. A
        // lowering refusal names a *type*, and until now there was no way to see
        // what that type actually is — which is a scavenger hunt for anyone
        // working on representation.
        Some("types") => {
            let rest: Vec<String> = args.collect();
            print_types(&project(&rest))
        }
        Some("hir") => {
            let rest: Vec<String> = args.collect();
            let tsconfig = project(&rest);
            dump_hir(&tsconfig)
        }
        Some("facts") => {
            let rest: Vec<String> = args.collect();
            let tsconfig = project(&rest);
            dump_facts(&tsconfig)
        }
        // The module graph, and the order it implies. The instrument comes
        // before anything depends on the order: evaluation order is one of the
        // few places where a wrong answer looks exactly like a right one, so it
        // has to be visible.
        Some("modules") => {
            let rest: Vec<String> = args.collect();
            dump_modules(&project(&rest))
        }
        // What a program does with its `any` and `unknown` values.
        //
        // `docs/any-unknown.md` argues for whole-program representation
        // analysis from a table its author counted by hand, and says outright
        // that the compiler should produce that table itself. This is the
        // instrument that does, and it exists before the representation on
        // purpose: the numbers decide whether the design is right.
        Some("erasure") => {
            let rest: Vec<String> = args.collect();
            dump_erasure(&project(&rest), rest.iter().any(|a| a == "--sites"))
        }
        Some("version") | None => {
            println!("nts {}", env!("CARGO_PKG_VERSION"));
            println!("snapshot schema v{SCHEMA_VERSION}");
            println!("pinned tsgo {}", tsgo::PINNED_TSGO);
            Ok(())
        }
        Some(other) => bail!("unknown command `{other}`; try `nts version`"),
    }
}

/// Print a snapshot's warnings, then fail if it does not typecheck.
///
/// Warnings go out whether or not it typechecks: a partial type graph
/// (NTS0002) or an unanswered type (NTS0003) makes every refusal below it
/// suspect, so a consumer that showed diagnostics only on error would hide the
/// one diagnostic that explains the others.
fn report_snapshot_diagnostics(snapshot: &nts_semantic_schema::SemanticSnapshot) -> Result<()> {
    for diagnostic in &snapshot.diagnostics {
        if diagnostic.severity == nts_diagnostics::Severity::Warning {
            eprintln!("warning: {} {}", diagnostic.code, diagnostic.message);
        }
    }
    if snapshot.has_errors() {
        for diagnostic in &snapshot.diagnostics {
            eprintln!("{} {}", diagnostic.code, diagnostic.message);
        }
        bail!("the program does not typecheck");
    }
    Ok(())
}

/// Whether the type graph is whole, and if not why.
///
/// Both of these mean the same thing downstream: a placeholder the lowering
/// will refuse while naming the construct rather than the cause.
fn report_graph_health(stats: &nts_frontend_ts::FrontendStats) {
    if stats.types_unanswered > 0 {
        println!(
            "  UNANSWERED     {} type(s) the checker could not answer for",
            stats.types_unanswered
        );
    }
    if stats.decomposition_exhausted {
        println!("  NOTE           budget exhausted; the type graph is partial");
    }
}

/// Show what the number analysis proves, value by value.
///
/// Exists so that a specialization strategy is chosen against evidence rather
/// than against a guess about what real code looks like. The interesting column
/// is the last one: what fraction of a function's numbers are provably integers,
/// and which ones are not.
fn dump_facts(tsconfig: &Utf8Path) -> Result<()> {
    let tsgo_binary = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = source.snapshot(tsconfig)?;
    if snapshot.has_errors() {
        bail!("the program does not typecheck");
    }

    let lowered = hir::lower::lower(&snapshot);
    // The whole-program analysis, so this reports what the compiler actually
    // knows rather than what one function could work out alone.
    let analyses =
        hir::interprocedural::analyze_program(&lowered.program, hir::reachable::Roots::EveryExport);
    for (func, analysis) in lowered.program.funcs.iter().zip(&analyses) {
        let numeric: Vec<usize> = (0..func.values.len())
            .filter(|index| matches!(func.values[*index].ty, HirType::Float { .. }))
            .collect();
        let provable = numeric
            .iter()
            .filter(|index| {
                analysis.is_integral_within(
                    hir::ValueId(u32::try_from(**index).unwrap_or(0)),
                    -2_147_483_648.0,
                    2_147_483_647.0,
                )
            })
            .count();

        println!(
            "{} — {provable}/{} numbers provably i32",
            func.name,
            numeric.len()
        );
        for index in numeric {
            let id = hir::ValueId(u32::try_from(index).unwrap_or(0));
            let facts = analysis.get(id);
            let verdict = if analysis.is_integral_within(id, -2_147_483_648.0, 2_147_483_647.0) {
                "i32"
            } else if analysis.is_integral_within(id, facts::SAFE_MIN, facts::SAFE_MAX) {
                "i64"
            } else {
                "f64"
            };
            println!(
                "  %{index:<3} {verdict:<4} [{}, {}]{}{}{}",
                render_bound(facts.lo),
                render_bound(facts.hi),
                if facts.whole { " whole" } else { "" },
                if facts.maybe_nan { " nan?" } else { "" },
                if facts.maybe_negative_zero {
                    " -0?"
                } else {
                    ""
                },
            );
        }
        println!();
    }
    Ok(())
}

fn render_bound(value: f64) -> String {
    if value == f64::INFINITY {
        "+inf".to_owned()
    } else if value == f64::NEG_INFINITY {
        "-inf".to_owned()
    } else {
        format!("{value}")
    }
}

/// Run the frontend against a project and report what it cost.
///
/// This exists before `nts build` on purpose. Gate G1 is the measurement that
/// validates the `tsgo --api` transport decision, and a gate nobody can run is
/// not a gate.
fn frontend(tsconfig: &Utf8Path, decompose: bool, calls: bool, constants: bool) -> Result<()> {
    let tsgo_binary = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    let mut source = TsgoApi::new(tsgo_binary);
    if decompose {
        source = source.with_decomposition(Budget::DEFAULT);
    }
    if calls {
        source = source.with_call_resolution(Budget::DEFAULT);
    }
    if constants {
        source = source.with_constant_folding(Budget::DEFAULT);
    }

    let snapshot = source.snapshot(tsconfig)?;
    let stats = source.stats();

    println!("files            {}", stats.files);
    println!("nodes decoded    {}", stats.nodes_decoded);
    println!("types resolved   {}", stats.types_resolved);
    println!("  distinct       {}", stats.distinct_types);
    println!("symbols          {}", stats.symbols);
    println!("modules          {}", stats.modules);
    if calls {
        println!("calls resolved   {}", stats.calls_resolved);
    }
    if constants {
        println!("constants folded {}", stats.constants_folded);
    }
    if decompose {
        println!("  decomposed     {}", stats.decomposed);
        report_graph_health(&stats);
    }
    println!("round trips      {}", stats.round_trips);
    println!("  per file       {:.2}", stats.round_trips_per_file());
    println!("elapsed          {} ms", stats.elapsed_ms);
    println!("snapshot digest  {}", hex(&snapshot.digest()?));

    // Pure computation over the snapshot — no round trips. Reported always,
    // because the ratio is what says whether a deep pass is worth its cost.
    let reached = reachability::from_exports(&snapshot);
    println!(
        "reachable        {} nodes, {} types of {}",
        reached.nodes.len(),
        reached.types.len(),
        snapshot.types.len(),
    );

    if !snapshot.diagnostics.is_empty() {
        println!();
        for diagnostic in &snapshot.diagnostics {
            let source = snapshot
                .sources
                .get(diagnostic.primary.file.0 as usize)
                .map_or("<unknown>", |s| s.uri.as_str());
            println!(
                "  {:?} {} {}:{} {}",
                diagnostic.severity,
                diagnostic.code,
                source,
                diagnostic.primary.span.start,
                diagnostic.message,
            );
            for label in &diagnostic.labels {
                println!("      {}", label.message);
            }
        }
    }

    // RFC §4.1: a program that does not typecheck is not a program to compile.
    // Reporting the snapshot and exiting zero would let a backend emit code for
    // it, which is the one outcome nothing downstream can detect.
    if snapshot.has_errors() {
        bail!("{} type error(s); refusing to proceed", stats.errors);
    }

    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

/// One line per site. `*` marks a verdict that came from another file.
fn list_sites(
    snapshot: &nts_semantic_schema::SemanticSnapshot,
    erasure: &nts_core::erasure::Erasure,
) {
    for site in &erasure.sites {
        let file = snapshot
            .sources
            .get(site.location.file.0 as usize)
            .map_or("?", |source| source.display_path.as_str());
        println!(
            "{:<9} {:<8} {}{}:{} {}.{}{} -- {}",
            site.verdict.as_str(),
            site.checker.as_str(),
            if site.decided_elsewhere { "* " } else { "" },
            file,
            site.location.span.start,
            site.owner,
            site.name,
            if site.in_container { "[]" } else { "" },
            site.because,
        );
    }
    println!();
}

/// The `any`/`unknown` classification, as a table.
///
/// Two columns: what the whole-program analysis says, and what each site's own
/// uses say. The difference is what following a value across calls is worth,
/// as a number rather than as an argument.
fn dump_erasure(tsconfig: &Utf8Path, per_site: bool) -> Result<()> {
    use nts_core::erasure::{Checker, Declaration, Verdict};

    let tsgo_binary = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = source.snapshot(tsconfig)?;
    let erasure = nts_core::erasure::classify(&snapshot);
    // The control. Judging each site by its own uses alone is what a
    // per-signature rule could do; the difference between the two columns is
    // what following the value across calls is worth, as a number.
    let local = nts_core::erasure::classify_as(&snapshot, nts_core::erasure::Analysis::Local);
    let local_verdict: std::collections::HashMap<(u32, u32), Verdict> = local
        .sites
        .iter()
        .map(|site| {
            (
                (site.location.file.0, site.location.span.start),
                site.verdict,
            )
        })
        .collect();

    if per_site {
        list_sites(&snapshot, &erasure);
    }

    // Split by what sort of declaration it is, because `docs/any-unknown.md`
    // counts parameters and a total that folded fields in with them would not
    // be the same measurement.
    for checker in [Checker::Any, Checker::Unknown] {
        for declaration in [
            Declaration::Parameter,
            Declaration::Variable,
            Declaration::Property,
        ] {
            let sites: Vec<_> = erasure
                .of(checker)
                .filter(|site| site.declaration == declaration)
                .collect();
            if sites.is_empty() {
                continue;
            }
            println!(
                "{} {}: {}",
                checker.as_str(),
                declaration.as_str(),
                sites.len()
            );
            for verdict in [
                Verdict::Carried,
                Verdict::Tested,
                Verdict::Examined,
                Verdict::Unclear,
            ] {
                let n = sites.iter().filter(|s| s.verdict == verdict).count();
                let held = sites
                    .iter()
                    .filter(|s| s.verdict == verdict && s.in_container)
                    .count();
                let alone = sites
                    .iter()
                    .filter(|s| {
                        local_verdict
                            .get(&(s.location.file.0, s.location.span.start))
                            .copied()
                            == Some(verdict)
                    })
                    .count();
                if n == 0 && alone == 0 {
                    continue;
                }
                println!(
                    "  {:<9} {n:>4}  ({held} in a container)   {alone:>4} without following calls",
                    verdict.as_str()
                );
            }
            let moved = sites
                .iter()
                .filter(|s| {
                    local_verdict
                        .get(&(s.location.file.0, s.location.span.start))
                        .copied()
                        != Some(s.verdict)
                })
                .count();
            let across = sites.iter().filter(|s| s.decided_elsewhere).count();
            println!(
                "  -> {moved} answered differently once calls are followed, {across} decided by a use in another file"
            );
        }
    }
    if erasure.sites.is_empty() {
        println!("no `any` or `unknown` declarations in this program");
    }
    Ok(())
}

/// Lower a project to HIR and print it.
///
/// A readable dump rather than a debug format: RFC §4.1 asks that every stage be
/// inspectable, and the point of this layer is that its decisions are visible.
/// Every module, what it imports, and what its file has at top level.
///
/// The kinds are printed as numbers on purpose: tsgo's `SyntaxKind` numbering is
/// not TypeScript's, and every constant in `syntax.rs` was read off real output
/// rather than taken from a table. This is the tool that reads them off.
fn dump_modules(tsconfig: &Utf8Path) -> Result<()> {
    let tsgo_binary = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = source.snapshot(tsconfig)?;

    let mut roots: Vec<(u32, usize)> = snapshot
        .modules
        .iter()
        .enumerate()
        .map(|(at, module)| (module.root.0, at))
        .collect();
    roots.sort_unstable();

    for (at, module) in snapshot.modules.iter().enumerate() {
        let name = snapshot
            .sources
            .get(module.file.0 as usize)
            .map_or("?", |file| file.display_path.as_str());
        println!("module {at} {name}  root=n{}", module.root.0);
        let end = roots
            .iter()
            .find(|(root, _)| *root > module.root.0)
            .map_or(u32::MAX, |(root, _)| *root);
        for child in &snapshot.nodes[module.root.0 as usize].children {
            let Some(record) = snapshot.nodes.get(child.0 as usize) else {
                continue;
            };
            if child.0 >= end {
                continue;
            }
            let kinds: Vec<String> = if record.kind == nts_semantic_schema::NodeKind::List {
                record
                    .children
                    .iter()
                    .filter_map(|inner| snapshot.nodes.get(inner.0 as usize))
                    .map(describe_node)
                    .collect()
            } else {
                vec![describe_node(record)]
            };
            for kind in kinds {
                println!("  {kind}");
            }
        }
        // How an import resolves, which is the question the graph turns on: does
        // an imported identifier's symbol name the *import site* or the
        // declaration it refers to? Printed rather than assumed.
        for child in module.root.0..end.min(u32::try_from(snapshot.nodes.len()).unwrap_or(0)) {
            let node = &snapshot.nodes[child as usize];
            if node.kind != nts_semantic_schema::NodeKind::Syntax(273) {
                continue;
            }
            println!("  import at n{child}:");
            let mut stack = vec![nts_semantic_schema::NodeId(child)];
            while let Some(id) = stack.pop() {
                let Some(record) = snapshot.nodes.get(id.0 as usize) else {
                    continue;
                };
                stack.extend(record.children.iter().copied());
                let Some(symbol) = record.symbol else {
                    continue;
                };
                let Some(declared) = snapshot.symbols.get(symbol.0 as usize) else {
                    continue;
                };
                let homes: Vec<String> = declared
                    .declarations
                    .iter()
                    .map(|node| {
                        let owner = roots
                            .iter()
                            .rev()
                            .find(|(root, _)| *root <= node.0)
                            .map_or(usize::MAX, |(_, at)| *at);
                        format!("n{}=module{owner}", node.0)
                    })
                    .collect();
                println!(
                    "    {:?} symbol {} declared at {:?}",
                    record.text.as_deref().unwrap_or(""),
                    symbol.0,
                    homes
                );
            }
        }
        println!("  imports: {:?}", module.imports);
    }
    Ok(())
}

/// One node, as `kind <number> "text"`.
fn describe_node(record: &nts_semantic_schema::NodeRecord) -> String {
    let kind = match record.kind {
        nts_semantic_schema::NodeKind::Syntax(kind) => kind.to_string(),
        nts_semantic_schema::NodeKind::List => "list".to_owned(),
    };
    match &record.text {
        Some(text) => format!("kind {kind} {text:?}"),
        None => format!("kind {kind}"),
    }
}

fn dump_hir(tsconfig: &Utf8Path) -> Result<()> {
    let tsgo_binary = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    // Call resolution is not optional here: without it a call site has no known
    // target and lowering refuses it.
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = source.snapshot(tsconfig)?;

    // Warnings are printed whether or not the program typechecks. A partial
    // type graph (NTS0002) makes every refusal below it suspect, so a consumer
    // that showed diagnostics only on error would hide the one diagnostic that
    // explains the others.
    for diagnostic in &snapshot.diagnostics {
        if diagnostic.severity == nts_diagnostics::Severity::Warning {
            println!("warning: {} {}", diagnostic.code, diagnostic.message);
        }
    }
    if snapshot.has_errors() {
        for diagnostic in &snapshot.diagnostics {
            println!("{} {}", diagnostic.code, diagnostic.message);
        }
        bail!("the program does not typecheck");
    }

    // `--prepared` shows the program the backend actually receives, which is
    // where every pass's output can be read at once; `--rc` adds the counting.
    // Raw lowering stays the default because it is what maps onto the source.
    let want_passes = std::env::args().any(|arg| arg == "--prepared" || arg == "--rc");
    let (program, diagnostics) = if want_passes {
        let options = hir::Options {
            provider: if std::env::args().any(|arg| arg == "--rc") {
                hir::Provider::ReferenceCounting
            } else {
                hir::Provider::NoGc
            },
            ..hir::Options::default()
        };
        // An invalid program is exactly the one worth reading, so the
        // complaints are printed and the program is dumped anyway.
        if let Err(problems) = hir::prepare_with(&snapshot, &options) {
            for problem in &problems {
                eprintln!("invalid HIR: {problem:?}");
            }
        }
        let prepared = hir::prepare_unverified(&snapshot, &options);
        (prepared.program, prepared.diagnostics)
    } else {
        let lowered = hir::lower::lower(&snapshot);
        (lowered.program, lowered.diagnostics)
    };
    for func in &program.funcs {
        let params: Vec<String> = func
            .params
            .iter()
            .map(|p| format!("{}: {}", p.name, render(&p.ty)))
            .collect();
        println!(
            "{}func {}({}) -> {} {{",
            if func.exported { "export " } else { "" },
            func.name,
            params.join(", "),
            render(&func.return_type),
        );
        for (index, block) in func.blocks.iter().enumerate() {
            let params: Vec<String> = block
                .params
                .iter()
                .map(|p| format!("%{}: {}", p.0, render(&func.value(*p).ty)))
                .collect();
            let label = if params.is_empty() {
                format!("b{index}:")
            } else {
                format!("b{index}({}):", params.join(", "))
            };
            println!("{label}");
            for value in &block.ops {
                println!("  {}", render_op(value.0 as usize, func.value(*value)));
            }
            println!("  {}", render_terminator(&block.terminator));
        }
        println!("}}");
    }

    for diagnostic in &diagnostics {
        // With its location. A refusal without one is a scavenger hunt, and
        // `where_it_is` already existed for the other subcommands.
        println!(
            "  -- {} {} {}",
            where_it_is(&snapshot, &diagnostic.primary),
            diagnostic.code,
            diagnostic.message
        );
    }
    println!(
        "\n{} function(s), {}",
        program.funcs.len(),
        if diagnostics.is_empty() {
            "nothing refused".to_owned()
        } else {
            format!("{} construct(s) refused", diagnostics.len())
        },
    );
    // And whether that number means anything. Lowering is not emitting: a
    // function can lower with no diagnostic and still be rejected before the
    // backend, and a count of the first read as a count of the second for as
    // long as nobody asked.
    //
    // The *prepared* program, not this one. Verifying the raw lowering reports
    // 280 problems in the node profile and almost none of them are real --
    // reachability pruning drops the functions with missing callees and `dce`
    // drops the dead blocks, so what matters is what survives the passes.
    if !want_passes {
        match hir::prepare(&snapshot) {
            // The count is what *reachability pruning* left, which is a
            // different question from how much lowered -- so it is labelled as
            // one rather than offered as a second headline.
            Ok(prepared) => println!(
                "  all of it verifies ({} after pruning unreachable functions)",
                prepared.program.funcs.len()
            ),
            Err(problems) => {
                println!("  the prepared program does NOT verify:");
                for problem in problems.iter().take(10) {
                    println!("    {problem:?}");
                }
            }
        }
    }
    Ok(())
}

fn render(ty: &HirType) -> String {
    match ty {
        HirType::Void => "void".to_owned(),
        HirType::Never => "never".to_owned(),
        HirType::Bool => "bool".to_owned(),
        HirType::Erased => "erased".to_owned(),
        HirType::BigInt => "bigint".to_owned(),
        HirType::Int { bits, signed } => format!("{}{bits}", if *signed { 'i' } else { 'u' }),
        HirType::Float { bits } => format!("f{bits}"),
        HirType::Managed(ManagedType::String) => "managed<str>".to_owned(),
        HirType::Managed(ManagedType::Object(id))
            if id.0 >= nts_core::hir::SYNTHETIC_TYPE_FLOOR =>
        {
            format!("managed<closure#{}>", u32::MAX - id.0)
        }
        HirType::Managed(ManagedType::Object(id)) => format!("managed<obj#{}>", id.0),
        HirType::Managed(ManagedType::Array(element)) => {
            format!("managed<[{}]>", render(element))
        }
        HirType::Managed(ManagedType::Promise(payload)) => {
            format!("managed<promise<{}>>", render(payload))
        }
        HirType::Managed(ManagedType::Map(key, value)) => {
            format!("managed<map<{}, {}>>", render(key), render(value))
        }
        HirType::Managed(ManagedType::Set(element)) => {
            format!("managed<set<{}>>", render(element))
        }
    }
}

/// How a call names what it is calling, and what to call the operation.
fn render_callee(
    callee: &nts_core::hir::Callee,
    args: &[nts_core::hir::ValueId],
) -> (String, String) {
    match callee {
        nts_core::hir::Callee::Direct(name) => ("call".to_owned(), name.clone()),
        nts_core::hir::Callee::External(name) => ("call.extern".to_owned(), name.clone()),
        nts_core::hir::Callee::Virtual { slot, declared } => {
            (format!("call.virtual[{slot}]"), declared.clone())
        }
        // The receiver *is* the name: a closure call has no declaration to point
        // at, only the value holding the code.
        nts_core::hir::Callee::Closure { slot } => (
            format!("call.closure[{slot}]"),
            args.first()
                .map_or_else(String::new, |a| format!("%{}", a.0)),
        ),
    }
}

/// A call, with where its result lives when that is not the heap.
/// `retain` and `release`, which differ only in the verb.
fn render_refcount(kind: &OpKind, object: nts_core::hir::ValueId) -> String {
    let verb = if matches!(kind, OpKind::Retain(_)) {
        "retain"
    } else {
        "release"
    };
    format!("{verb} %{}", object.0)
}

/// The four constants, which differ only in how the value is spelled.
fn render_constant(index: usize, ty: &str, kind: &OpKind) -> String {
    let value = match kind {
        OpKind::ConstInt(v) => v.to_string(),
        OpKind::ConstFloat(v) => v.to_string(),
        OpKind::ConstBool(v) => v.to_string(),
        OpKind::ConstString(v) => format!("{v:?}"),
        _ => unreachable!("only the constants reach here"),
    };
    format!("%{index} = const {value} : {ty}")
}

/// The three erasure operations, which differ only in their verb.
fn render_erasure(index: usize, ty: &str, kind: &OpKind, value: nts_core::hir::ValueId) -> String {
    let verb = match kind {
        OpKind::Erase { .. } => "erase",
        OpKind::TagOf { .. } => "tag.of",
        _ => "unerase",
    };
    format!("%{index} = {verb} %{} : {ty}", value.0)
}

fn render_call(
    index: usize,
    ty: &str,
    callee: &nts_core::hir::Callee,
    args: &[nts_core::hir::ValueId],
    frame: Option<u32>,
) -> String {
    let rendered: Vec<String> = args.iter().map(|a| format!("%{}", a.0)).collect();
    let (kind, name) = render_callee(callee, args);
    let at = frame.map_or_else(String::new, |units| format!(" frame[{units}]"));
    format!(
        "%{index} = {kind} {name}({}){at} : {ty}",
        rendered.join(", ")
    )
}

/// The two operations an `async` function is made of, printed.
///
/// `await` is what the lowering emits and `suspend` is what `hir::suspend`
/// turns it into, so seeing which one a dump contains says which side of that
/// pass you are looking at.
fn suspension(index: usize, op: &nts_core::hir::Op) -> String {
    let ty = render(&op.ty);
    match &op.kind {
        OpKind::Await { promise } => format!("%{index} = await %{} : {ty}", promise.0),
        OpKind::Suspend {
            promise,
            frame,
            resume,
        } => format!("suspend %{} -> {resume}(%{})", promise.0, frame.0),
        _ => unreachable!("only reached for the suspension pair"),
    }
}

fn render_op(index: usize, op: &nts_core::hir::Op) -> String {
    let ty = render(&op.ty);
    match &op.kind {
        OpKind::Param(n) => format!("%{index} = param {n} : {ty}"),
        OpKind::BlockParam(n) => format!("%{index} = blockparam {n} : {ty}"),
        OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstString(_) => render_constant(index, &ty, &op.kind),
        OpKind::Erase { value } | OpKind::TagOf { value } | OpKind::Unerase { value } => {
            render_erasure(index, &ty, &op.kind, *value)
        }
        OpKind::ConstNull => format!("%{index} = const null : {ty}"),
        OpKind::Binary { op: bin, lhs, rhs } => {
            format!(
                "%{index} = {} %{}, %{} : {ty}",
                render_bin(*bin),
                lhs.0,
                rhs.0
            )
        }
        OpKind::Convert(operand) => format!("%{index} = convert %{} : {ty}", operand.0),
        OpKind::ArrayNew { length, zeroed } => {
            // Printed, because "not zeroed" is a claim about what the rest of
            // the function does and is worth being able to read back.
            let fill = if *zeroed { "" } else { " uninitialized" };
            format!("%{index} = array.new{fill} %{} : {ty}", length.0)
        }
        OpKind::Length(array) => format!("%{index} = array.len %{} : {ty}", array.0),
        OpKind::StringUnitAt {
            string,
            index: at,
            checked,
        } => format!(
            "%{index} = str.unit{} %{}[%{}] : {ty}",
            if *checked { "" } else { " unchecked" },
            string.0,
            at.0
        ),
        OpKind::GlobalGet(global) => format!("%{index} = global.get {global} : {ty}"),
        OpKind::GlobalSet { global, value } => {
            format!("global.set {global} = %{}", value.0)
        }
        OpKind::ObjectNew { frame } => {
            let where_ = if *frame { "frame" } else { "heap" };
            format!("%{index} = object.new {where_} : {ty}")
        }
        OpKind::Retain(object) | OpKind::Release(object) => render_refcount(&op.kind, *object),
        OpKind::FieldGet { object, field } => {
            format!("%{index} = field.get %{}.{field} : {ty}", object.0)
        }
        OpKind::FieldSet {
            object,
            field,
            value,
        } => format!("field.set %{}.{field} = %{}", object.0, value.0),
        OpKind::ArrayGet {
            array,
            index: at,
            checked,
        } => format!(
            "%{index} = array.get{} %{}[%{}] : {ty}",
            if *checked { "" } else { " unchecked" },
            array.0,
            at.0
        ),
        OpKind::ArraySet {
            array,
            index: at,
            value,
            checked,
        } => format!(
            "array.set{} %{}[%{}] = %{}",
            if *checked { "" } else { " unchecked" },
            array.0,
            at.0,
            value.0
        ),
        OpKind::Await { .. } | OpKind::Suspend { .. } => suspension(index, op),
        OpKind::Unary { op: un, operand } => {
            let operator = match un {
                nts_core::hir::UnOp::Neg => "neg",
                nts_core::hir::UnOp::Not => "not",
                nts_core::hir::UnOp::ToInt32 => "toint32",
                nts_core::hir::UnOp::ToUint32 => "touint32",
                nts_core::hir::UnOp::Floor => "floor",
                nts_core::hir::UnOp::Ceil => "ceil",
                nts_core::hir::UnOp::Trunc => "trunc",
                nts_core::hir::UnOp::Sqrt => "sqrt",
                nts_core::hir::UnOp::Round => "round",
                nts_core::hir::UnOp::Abs => "abs",
                nts_core::hir::UnOp::Truthy => "truthy",
            };
            format!("%{index} = {operator} %{} : {ty}", operand.0)
        }
        OpKind::Call {
            callee,
            args,
            frame,
        } => render_call(index, &ty, callee, args, *frame),
        OpKind::Return(v) => v.map_or_else(|| "ret".to_owned(), |v| format!("ret %{}", v.0)),
    }
}

fn render_terminator(terminator: &nts_core::hir::Terminator) -> String {
    use nts_core::hir::Terminator;
    let args = |values: &[nts_core::hir::ValueId]| {
        if values.is_empty() {
            String::new()
        } else {
            format!(
                "({})",
                values
                    .iter()
                    .map(|v| format!("%{}", v.0))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        }
    };
    match terminator {
        Terminator::Return(Some(v)) => format!("ret %{}", v.0),
        Terminator::Return(None) => "ret".to_owned(),
        Terminator::Jump { target, args: a } => format!("jump b{}{}", target.0, args(a)),
        Terminator::Branch {
            cond,
            then_target,
            then_args,
            else_target,
            else_args,
        } => format!(
            "br %{}, b{}{}, b{}{}",
            cond.0,
            then_target.0,
            args(then_args),
            else_target.0,
            args(else_args),
        ),
        Terminator::Unreachable => "unreachable".to_owned(),
        // Printed apart from `unreachable`, because the difference is the
        // whole point of the two: this one is an absence the verifier has
        // to prove dead, and reading a dump is where you would first
        // notice one where it does not belong.
        Terminator::FellThrough => "fell through".to_owned(),
    }
}

const fn render_bin(op: BinOp) -> &'static str {
    match op {
        BinOp::Add => "add",
        BinOp::Sub => "sub",
        BinOp::Mul => "mul",
        BinOp::Div => "div",
        BinOp::Rem => "rem",
        BinOp::Concat => "concat",
        BinOp::Lt => "lt",
        BinOp::Le => "le",
        BinOp::Gt => "gt",
        BinOp::Ge => "ge",
        BinOp::Eq => "eq",
        BinOp::Ne => "ne",
        BinOp::BitAnd => "and",
        BinOp::BitOr => "or",
        BinOp::BitXor => "xor",
        BinOp::Shl => "shl",
        BinOp::Shr => "shr",
        BinOp::UShr => "ushr",
        BinOp::Min => "min",
        BinOp::Max => "max",
    }
}

/// Every type the frontend resolved, as the schema records it.
fn print_types(tsconfig: &Utf8Path) -> Result<()> {
    let tsgo_binary = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = source.snapshot(tsconfig)?;
    for (index, record) in snapshot.types.iter().enumerate() {
        let named = record
            .symbol
            .and_then(|symbol| snapshot.symbols.get(symbol.0 as usize))
            .map_or_else(String::new, |symbol| format!(" `{}`", symbol.name));
        let arguments = snapshot
            .type_arguments
            .get(&nts_semantic_schema::TypeId(
                u32::try_from(index).unwrap_or(0),
            ))
            .map_or_else(String::new, |args| format!(" args{args:?}"));
        println!("#{index}{named}{arguments} {:?}", record.kind);
    }
    // What each type extends. A generic class that extends another is the one
    // place the checker's answer is not obvious from the type list alone.
    for (ty, bases) in &snapshot.base_types {
        println!(
            "base #{} -> {:?}",
            ty.0,
            bases.iter().map(|b| b.0).collect::<Vec<_>>()
        );
    }
    // Signatures too. A type prints as `Function(SignatureId(2))`, which says
    // nothing about what the call takes -- and for a generic call, whether the
    // checker handed back the *instantiated* signature is the question the
    // monomorphizer turns on.
    for (index, signature) in snapshot.signatures.iter().enumerate() {
        let parameters: Vec<String> = signature
            .parameters
            .iter()
            .map(|parameter| format!("{}: #{}", parameter.name, parameter.ty.0))
            .collect();
        let generic = if signature.type_parameters.is_empty() {
            String::new()
        } else {
            format!(" <{:?}>", signature.type_parameters)
        };
        println!(
            "sig#{index}{generic} ({}) -> #{}",
            parameters.join(", "),
            signature.return_type.0
        );
    }
    Ok(())
}

/// Where a diagnostic is, as `path:line:column`.
///
/// A refusal without a location is a scavenger hunt: the message says what is
/// not supported and the program says nothing about where. Byte offsets are
/// what the snapshot carries, because that is what tsgo's encoded AST carries;
/// turning one into a line and a column means reading the file, which is a fine
/// price to pay once per diagnostic.
fn where_it_is(snapshot: &nts_semantic_schema::SemanticSnapshot, at: &Location) -> String {
    let Some(source) = snapshot.sources.get(at.file.0 as usize) else {
        return "<unknown>".to_owned();
    };
    let path = &source.display_path;
    let Ok(text) = std::fs::read_to_string(path) else {
        return path.to_string();
    };
    let upto = &text.as_bytes()[..(at.span.start as usize).min(text.len())];
    // Counted a byte at a time on purpose: this runs once per diagnostic, and
    // a dependency on a vectorized byte counter for that would be absurd.
    #[allow(clippy::naive_bytecount)]
    let line = upto.iter().filter(|byte| **byte == b'\n').count() + 1;
    let column = upto.len()
        - upto
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map_or(0, |at| at + 1);
    format!("{path}:{line}:{}", column + 1)
}

/// The entry point of a standalone program, and the host it needs.
///
/// Both are a *choice* rather than part of the runtime: an embedder with its
/// own loop supplies its own host and links none of this, and a library product
/// has no loop at all (RFC §26.1).
fn write_standalone(program: &hir::Program, out: &Utf8Path) -> Result<()> {
    // A program that is only declarations has nothing to evaluate, and calling
    // a function that was never emitted is a link error.
    let initializes = program
        .funcs
        .iter()
        .any(|func| func.name == hir::lower::MODULE_INIT);
    std::fs::write(
        out.join(nts_codegen_c::UV_HOST_HEADER_NAME),
        nts_codegen_c::UV_HOST_HEADER,
    )?;
    std::fs::write(
        out.join(nts_codegen_c::UV_HOST_SOURCE_NAME),
        nts_codegen_c::UV_HOST_SOURCE,
    )?;
    let main_path = out.join("main.c");
    std::fs::write(&main_path, nts_codegen_c::standalone_main(initializes))
        .with_context(|| format!("writing {main_path}"))?;
    println!(
        "wrote program.c, main.c, {}, {}, {}, {} to {out}",
        nts_codegen_c::RUNTIME_HEADER_NAME,
        nts_codegen_c::RUNTIME_SOURCE_NAME,
        nts_codegen_c::UV_HOST_HEADER_NAME,
        nts_codegen_c::UV_HOST_SOURCE_NAME,
    );
    println!(
        "  cc -std=c11 -I. main.c program.c {} {} -luv -lm -o program",
        nts_codegen_c::RUNTIME_SOURCE_NAME,
        nts_codegen_c::UV_HOST_SOURCE_NAME
    );
    Ok(())
}

/// Lower a project and print the C it becomes.
fn emit_c(tsconfig: &Utf8Path, out: Option<&Utf8Path>) -> Result<()> {
    let tsgo_binary = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = source.snapshot(tsconfig)?;
    report_snapshot_diagnostics(&snapshot)?;

    // `--rc` selects reference counting (RFC 9.2). NoGC stays the default: it
    // is what 9.1 says it is, and choosing a provider silently is exactly what
    // that section forbids.
    let provider = if std::env::args().any(|arg| arg == "--rc") {
        hir::Provider::ReferenceCounting
    } else {
        hir::Provider::NoGc
    };
    // `--main` says the product is an executable, which is a claim about
    // reachability as much as about output: a module's exports are not roots
    // for one, because nothing outside the program can call them. The entry is
    // module evaluation, because that is what an executable *is* -- the same
    // thing `node main.js` runs.
    let standalone = std::env::args().any(|arg| arg == "--main");
    let entry = [hir::lower::MODULE_INIT.to_owned()];
    let roots = if standalone {
        hir::reachable::Roots::Entry(&entry)
    } else {
        hir::reachable::Roots::EveryExport
    };
    let prepared = match hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider,
            roots,
            ..hir::Options::default()
        },
    ) {
        Ok(prepared) => prepared,
        Err(problems) => {
            for problem in &problems {
                eprintln!("invalid HIR: {problem:?}");
            }
            bail!("refusing to emit code from invalid HIR");
        }
    };
    for diagnostic in &prepared.diagnostics {
        eprintln!(
            "{}: {} {}",
            where_it_is(&snapshot, &diagnostic.primary),
            diagnostic.code,
            diagnostic.message
        );
    }
    let program = prepared.program;

    let emitted = nts_codegen_c::emit(&program);
    for diagnostic in &emitted.diagnostics {
        eprintln!(
            "{}: {} {}",
            where_it_is(&snapshot, &diagnostic.primary),
            diagnostic.code,
            diagnostic.message
        );
    }

    let Some(out) = out else {
        print!("{}", emitted.writer.text());
        return Ok(());
    };

    // The runtime is a translation unit of its own, so a buildable output is
    // three files rather than one.
    std::fs::create_dir_all(out).with_context(|| format!("creating {out}"))?;
    let program_path = out.join("program.c");
    std::fs::write(&program_path, emitted.writer.text())
        .with_context(|| format!("writing {program_path}"))?;
    std::fs::write(
        out.join(nts_codegen_c::RUNTIME_HEADER_NAME),
        nts_codegen_c::RUNTIME_HEADER,
    )?;
    std::fs::write(
        out.join(nts_codegen_c::RUNTIME_SOURCE_NAME),
        nts_codegen_c::RUNTIME_SOURCE,
    )?;
    // `--main` adds the entry point of a standalone program: evaluate the
    // module, run the loop until nothing is left, shut down. The libuv host
    // comes with it, because a program needs a loop and an embedder with its
    // own supplies a different one.
    if standalone {
        return write_standalone(&program, out);
    }

    // `--napi` adds the Node-API wrapper, which is what makes the compiled
    // program callable from JavaScript -- and therefore what lets node's own
    // test suite run against it. Node is a harness here, not a runtime: nothing
    // this writes enters a shipped binary.
    if std::env::args().any(|arg| arg == "--napi") {
        let addon = nts_codegen_napi::emit(&program);
        let addon_path = out.join(nts_codegen_napi::ADDON_SOURCE_NAME);
        std::fs::write(&addon_path, &addon.source)
            .with_context(|| format!("writing {addon_path}"))?;
        for skipped in &addon.skipped {
            eprintln!("no wrapper for {}: {}", skipped.function, skipped.reason);
        }
        println!(
            "wrote program.c, {}, {}, {} to {out}",
            nts_codegen_c::RUNTIME_HEADER_NAME,
            nts_codegen_c::RUNTIME_SOURCE_NAME,
            nts_codegen_napi::ADDON_SOURCE_NAME
        );
        return Ok(());
    }

    println!(
        "wrote program.c, {}, {} to {out}",
        nts_codegen_c::RUNTIME_HEADER_NAME,
        nts_codegen_c::RUNTIME_SOURCE_NAME
    );
    // The provider is half a runtime decision. Reference counting needs each
    // object to be its own allocation so that the last release can hand it back;
    // the bump allocator the default uses cannot free anything. Compiling the
    // runtime without this define while the program counts references balances
    // the counts and still grows the heap, which is the quiet failure worth
    // spending two lines of output to prevent.
    if provider == hir::Provider::ReferenceCounting {
        println!("compile the runtime with -DNTS_PROVIDER_RC");
    }
    Ok(())
}

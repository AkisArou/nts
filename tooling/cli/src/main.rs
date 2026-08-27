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
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo, tsgo::decompose::Budget};
use nts_diagnostics::Location;
use nts_semantic_schema::SCHEMA_VERSION;

/// The tsconfig a subcommand was pointed at: the first positional argument, or
/// the one in the working directory.
fn project(rest: &[String]) -> Utf8PathBuf {
    rest.iter()
        .find(|a| !a.starts_with("--"))
        .map_or_else(|| Utf8PathBuf::from("tsconfig.json"), Utf8PathBuf::from)
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
        Some("check") => {
            let rest: Vec<String> = args.collect();
            let tsconfig = project(&rest);
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
            for (native, engine) in report.disagreements.iter().take(20) {
                println!("  nts  {native}");
                println!("  node {engine}");
            }
            if report.agreed() {
                println!("agreed on every case");
                return Ok(());
            }
            bail!(
                "{} case(s) disagree between the compiled program and node",
                report.disagreements.len()
            )
        }
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
        Some("version") | None => {
            println!("nts {}", env!("CARGO_PKG_VERSION"));
            println!("snapshot schema v{SCHEMA_VERSION}");
            println!("pinned tsgo {}", tsgo::PINNED_TSGO);
            Ok(())
        }
        Some(other) => bail!("unknown command `{other}`; try `nts version`"),
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
        if stats.decomposition_exhausted {
            println!("  NOTE           budget exhausted; the type graph is partial");
        }
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

/// Lower a project to HIR and print it.
///
/// A readable dump rather than a debug format: RFC §4.1 asks that every stage be
/// inspectable, and the point of this layer is that its decisions are visible.
fn dump_hir(tsconfig: &Utf8Path) -> Result<()> {
    let tsgo_binary = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    // Call resolution is not optional here: without it a call site has no known
    // target and lowering refuses it.
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = source.snapshot(tsconfig)?;

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
        println!("  -- {} {}", diagnostic.code, diagnostic.message);
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
    Ok(())
}

fn render(ty: &HirType) -> String {
    match ty {
        HirType::Void => "void".to_owned(),
        HirType::Never => "never".to_owned(),
        HirType::Bool => "bool".to_owned(),
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

fn render_op(index: usize, op: &nts_core::hir::Op) -> String {
    let ty = render(&op.ty);
    match &op.kind {
        OpKind::Param(n) => format!("%{index} = param {n} : {ty}"),
        OpKind::BlockParam(n) => format!("%{index} = blockparam {n} : {ty}"),
        OpKind::ConstInt(v) => format!("%{index} = const {v} : {ty}"),
        OpKind::ConstFloat(v) => format!("%{index} = const {v} : {ty}"),
        OpKind::ConstBool(v) => format!("%{index} = const {v} : {ty}"),
        OpKind::ConstString(v) => format!("%{index} = const {v:?} : {ty}"),
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
        OpKind::ArrayNew { length } => format!("%{index} = array.new %{} : {ty}", length.0),
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
        OpKind::Retain(object) => format!("retain %{}", object.0),
        OpKind::Release(object) => format!("release %{}", object.0),
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
        OpKind::Return(Some(v)) => format!("ret %{}", v.0),
        OpKind::Return(None) => "ret".to_owned(),
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
        println!("#{index}{named} {:?}", record.kind);
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
    let column = upto.len() - upto.iter().rposition(|byte| *byte == b'\n').map_or(0, |at| at + 1);
    format!("{path}:{line}:{}", column + 1)
}

/// Lower a project and print the C it becomes.
fn emit_c(tsconfig: &Utf8Path, out: Option<&Utf8Path>) -> Result<()> {
    let tsgo_binary = std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned());
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = source.snapshot(tsconfig)?;
    if snapshot.has_errors() {
        for diagnostic in &snapshot.diagnostics {
            eprintln!("{} {}", diagnostic.code, diagnostic.message);
        }
        bail!("the program does not typecheck");
    }

    // `--rc` selects reference counting (RFC 9.2). NoGC stays the default: it
    // is what 9.1 says it is, and choosing a provider silently is exactly what
    // that section forbids.
    let provider = if std::env::args().any(|arg| arg == "--rc") {
        hir::Provider::ReferenceCounting
    } else {
        hir::Provider::NoGc
    };
    let prepared = match hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider,
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

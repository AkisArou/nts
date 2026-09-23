//! The `nts` command-line interface.
//!
//! Commands are added as the capability behind them becomes real. A command that
//! prints a plausible result for something the compiler cannot yet do is worse
//! than no command: RFC §4.1 requires that unsupported reachable behavior be
//! diagnosed precisely, and that promise starts here.

mod bind;

use std::fmt::Write as _;

use anyhow::{Context, Result, anyhow, bail};
use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir::facts;
use nts_core::hir::{self, BinOp, HirType, ManagedType, OpKind};
use nts_core::reachability;
use nts_diagnostics::Location;
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo, tsgo::decompose::Budget};
use nts_semantic_schema::SCHEMA_VERSION;

/// The tsconfig a subcommand was pointed at: the first positional argument, or
/// the one in the working directory.
/// Flags that take a value, so that the value is not mistaken for the project.
///
/// `nts emit-jvm --out /tmp/x proj/tsconfig.json` used to compile `/tmp/x`:
/// the scan below took the first argument not starting with `--`, and that is
/// the *out directory*. tsgo answered with an empty snapshot, the backend
/// emitted a class containing nothing but its constructor, and the command
/// printed "wrote 1 class(es)" and exited zero. An hour went into looking for
/// the emitter bug that had lost every method.
/// Flags whose *value* is not the project path.
///
/// `--entry` and `--product` were missing, so `nts emit-c --entry published
/// proj` took `published` as the tsconfig and failed with "`published` is not a
/// tsconfig" -- flag order deciding whether a command works, which is the shape
/// the comment in `named_project` records twice already.
const TAKES_A_VALUE: [&str; 4] = ["--out", "--entry", "--product", "--os"];

/// The tsconfig a command was pointed at, *and* its dependencies acquired.
///
/// Every command that builds a program goes through here, which is what makes
/// acquisition part of the build rather than a step somebody has to know
/// about: `pnpm install` and then compile, with no third command. When a
/// project has dependencies whose TypeScript could be recovered, the config
/// returned is the generated one that resolves them; otherwise it is the
/// developer's own, untouched.
///
/// `--no-acquire` opts out.
fn project(rest: &[String]) -> Result<Utf8PathBuf> {
    let named = named_project(rest)?;
    // `--no-acquire` for a single run; `NTS_NO_ACQUIRE=1` for a whole shell.
    // The environment switch exists because this changes what *every* command
    // compiles, and five sessions share this checkout: somebody who finds a
    // lane red needs a way to take this out of the picture in one variable
    // rather than by editing arguments in a script they did not write.
    if rest.iter().any(|arg| arg == "--no-acquire")
        || std::env::var("NTS_NO_ACQUIRE").is_ok_and(|value| value != "0")
    {
        return Ok(named);
    }
    acquire(&named)
}

/// Acquire what this project's dependencies can supply, and return the config
/// to compile with.
///
/// A project with no `package.json` has no dependencies to acquire and is left
/// exactly as it was found -- which is every example in this repository but
/// one, so the common case costs a `stat`.
fn acquire(tsconfig: &Utf8Path) -> Result<Utf8PathBuf> {
    let dir = tsconfig
        .parent()
        .filter(|parent| !parent.as_str().is_empty())
        .map_or_else(|| Utf8PathBuf::from("."), Utf8Path::to_path_buf);
    if !dir.join("package.json").is_file() {
        return Ok(tsconfig.to_owned());
    }
    let acquisition = nts_deps::acquire(
        &dir,
        tsconfig,
        &nts_deps::Options {
            // The checker resolves the program this compiler compiles, so it is
            // the authority on which specifier means which file. Without it,
            // acquisition falls back to reading manifests and says so.
            tsgo: nts_frontend_ts::tsgo::locate(),
            ..nts_deps::Options::default()
        },
    )?;

    // Quiet when everything worked, and specific when it did not. There is no
    // JavaScript fallback, so a dependency this compiler cannot take has to be
    // visible here rather than as a puzzling refusal inside a file nobody chose
    // to open.
    let refused: Vec<_> = acquisition
        .packages
        .iter()
        .filter(|package| !package.acquired())
        .collect();
    if !refused.is_empty() {
        eprintln!(
            "{} of {} dependencies acquired; these have no TypeScript to compile:",
            acquisition.acquired(),
            acquisition.packages.len()
        );
        for package in refused {
            eprintln!(
                "  {} {} -- {}",
                package.name,
                package.version,
                package.route.describe()
            );
        }
        // The lowerer names the *kind* of failure — "an imported name whose
        // implementation is not in this program" — and this names the package
        // it came from, which the lowerer cannot: a module specifier's text is
        // not in the snapshot. Two halves of one sentence, printed by the two
        // layers that each hold half.
        eprintln!("  a name imported from one of these will refuse below.");
    }
    Ok(acquisition.tsconfig.unwrap_or_else(|| tsconfig.to_owned()))
}

/// The tsconfig a command was pointed at.
///
/// Returns an error rather than a path so that naming something that is not a
/// project fails here instead of downstream as an empty program -- which is
/// indistinguishable from a program that legitimately has nothing in it.
/// The program a project directory describes.
///
/// **`Config.tsconfig` is what a config says its program is, and nothing read
/// it.** Its own documentation calls it "the program's source of truth ...
/// optional, defaulting to `./tsconfig.json` beside this file ... named only
/// when it differs" -- and a config naming `./program.json` was ignored, the
/// build failing on a `tsconfig.json` its author had deliberately not written.
/// A field that parses and does nothing.
///
/// **Naming the config means naming the project it describes.** A directory
/// already resolved to the `tsconfig.json` in it, and `nts build
/// path/to/nts.config.ts` is the same request spelled the other obvious way --
/// it is the file a person has open. Taken literally it made the *config* the
/// program, and `examples/library` failed with four `TS5097 An import path can
/// only end with a '.ts' extension`, about `@nts/config`'s own `package.json`.
/// Nothing in the tree built that example, so it had no observer.
///
/// **A config that will not evaluate falls through to the default rather than
/// reporting here.** `build` resolves it again a moment later and says why with
/// context this has no room for, and two messages for one fault is worse than a
/// late one. `resolve` is memoised per process, so asking twice costs one
/// `node`.
fn program_of(dir: &Utf8Path) -> Utf8PathBuf {
    let default = dir.join("tsconfig.json");
    let config = dir.join(nts_build::config::FILE_NAME);
    if !config.is_file() {
        return default;
    }
    nts_build::config::resolve(&config)
        .ok()
        .and_then(|resolved| resolved.tsconfig)
        .map_or(default, |named| dir.join(named))
}

fn named_project(rest: &[String]) -> Result<Utf8PathBuf> {
    let mut skip_next = false;
    let mut found = None;
    for arg in rest {
        if skip_next {
            skip_next = false;
            continue;
        }
        if TAKES_A_VALUE.contains(&arg.as_str()) {
            skip_next = true;
            continue;
        }
        if !arg.starts_with("--") {
            found = Some(Utf8PathBuf::from(arg));
            break;
        }
    }
    // Everything after the positional was never examined, because the loop
    // above **breaks** at it. So `nts emit-jvm proj -o /tmp/x` took `proj`,
    // ignored `-o /tmp/x` entirely, wrote to the default location and exited
    // zero -- and the reader concluded the backend had emitted nothing, from an
    // empty directory it had named itself.
    //
    // The same shape as the bug the comment on `TAKES_A_VALUE` records, which
    // cost an hour: an argument silently not doing anything looks exactly like
    // the thing it was meant to configure being broken.
    //
    // Only single-dash arguments are rejected here, and that is deliberate:
    // this CLI defines no short flags but `-h`, so anything else with one dash
    // is a mistake, while an unknown `--flag` may be one a subcommand reads for
    // itself. Narrow enough to be certain, which is the half that matters.
    if let Some(bad) = rest
        .iter()
        .find(|arg| arg.starts_with('-') && !arg.starts_with("--") && arg.as_str() != "-h")
    {
        bail!("`{bad}` is not an option this command takes; did you mean `--out`?");
    }
    let named_one = found.is_some();
    let path = found.unwrap_or_else(|| Utf8PathBuf::from("tsconfig.json"));
    // A directory and the config file are the same request -- "the project
    // here" -- and both have to ask the config which program it describes. An
    // explicitly named file is the caller being specific, and wins outright.
    let here = if path.is_dir() {
        Some(path.clone())
    } else if path.file_name() == Some(nts_build::config::FILE_NAME) {
        Some(
            path.parent()
                .filter(|parent| !parent.as_str().is_empty())
                .map_or_else(|| Utf8PathBuf::from("."), Utf8Path::to_path_buf),
        )
    } else {
        None
    };
    let path = here.map_or(path, |dir| program_of(&dir));
    if !path.is_file() {
        // **Missing and wrong-shaped are different mistakes**, and one message
        // for both sends a person to check a file's contents when the file is
        // not there. `nts build` in a directory without one answered
        // "`tsconfig.json` is not a tsconfig", which reads as a complaint about
        // a file they can see.
        if path.exists() {
            bail!("`{path}` is not a file: name the project's tsconfig.json");
        }
        if !named_one {
            bail!(
                "no `tsconfig.json` here. Run this in a project directory, or name \
                 the tsconfig: `nts <command> path/to/tsconfig.json`"
            );
        }
        bail!("`{path}` does not exist: name the project's tsconfig.json");
    }
    Ok(path)
}

/// `nts check`: run a compiled program and node side by side.
fn check(rest: &[String]) -> Result<()> {
    let tsconfig = project(rest)?;
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
    if report.timeouts > 0 {
        // Its own line, above the count, because for a long time it had no
        // line and arrived inside the one above: a case that ran out of time
        // was reported as the program *declining* its input. See
        // `stopped_with` for the run that found it.
        println!(
            "{} case(s) ran out of time and were not finished -- not a \
             disagreement and not a refusal; a pool value in a loop bound asks \
             for two billion iterations and the program does what it asks",
            report.timeouts
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
    if report.checked == 0 {
        bail!(
            "no case was checked: all {} declined, so the two sides were \
             never compared. A program that stops on every input looks \
             exactly like this",
            report.refused
        )
    }
    bail!(
        "{} case(s) disagree between the compiled program and node",
        report.disagreements.len()
    )
}

/// `nts bind-c --header sys/epoll.h --record epoll_event --fn epoll_ctl ...`
///
/// Repeatable flags rather than a request file: the command *is* the record of
/// how a binding was produced, and it belongs beside the generated file in a
/// script that can be re-run when a header moves.
fn bind_c(rest: &[String]) -> Result<()> {
    let repeated = |flag: &str| -> Vec<String> {
        rest.windows(2)
            .filter(|pair| pair[0] == flag)
            .map(|pair| pair[1].clone())
            .collect()
    };
    let single = |flag: &str| -> Option<String> {
        rest.windows(2).find(|pair| pair[0] == flag).map(|pair| pair[1].clone())
    };
    let request = bind::Request {
        headers: repeated("--header"),
        defines: repeated("--define"),
        module: single("--module")
            .ok_or_else(|| anyhow::anyhow!("`nts bind-c` needs `--module <name>`"))?,
        records: repeated("--record"),
        functions: repeated("--fn"),
        clang_args: repeated("--clang"),
        // `NAME` or `NAME:brand`. The brand defaults to `c_int`, which is what
        // C gives an unsuffixed integer constant and what most of these are.
        constants: repeated("--const")
            .iter()
            .map(|entry| match entry.split_once(':') {
                Some((name, brand)) => (name.to_owned(), brand.to_owned()),
                None => (entry.clone(), "c_int".to_owned()),
            })
            .collect(),
        no_escape: repeated("--no-escape")
            .iter()
            .map(|pair| {
                pair.split_once(':')
                    .map(|(f, p)| (f.to_owned(), p.to_owned()))
                    .ok_or_else(|| anyhow::anyhow!("`--no-escape` takes `function:parameter`, not `{pair}`"))
            })
            .collect::<Result<_>>()?,
        aliases: repeated("--alias")
            .iter()
            .map(|pair| {
                pair.split_once('=')
                    .map(|(tag, name)| (tag.to_owned(), name.to_owned()))
                    .ok_or_else(|| anyhow::anyhow!("`--alias` takes `tag=Name`, not `{pair}`"))
            })
            .collect::<Result<_>>()?,
    };
    // Constants go to their own file, and a `.ts` rather than a `.d.ts`: a
    // declaration file cannot carry a value, so the two outputs are two things
    // and not one split in half.
    if !request.constants.is_empty() {
        let text = bind::constants(&request)?;
        match single("--constants-out") {
            Some(path) => {
                std::fs::write(&path, &text)
                    .with_context(|| format!("writing the constants to {path}"))?;
                println!("wrote {path}");
            }
            None => print!("{text}"),
        }
        if request.records.is_empty() && request.functions.is_empty() {
            return Ok(());
        }
    }
    let text = bind::run(&request)?;
    match single("--out") {
        Some(path) => {
            std::fs::write(&path, &text)
                .with_context(|| format!("writing the binding to {path}"))?;
            println!("wrote {path}");
        }
        None => print!("{text}"),
    }
    Ok(())
}

/// What this command does, for somebody who has not read `main.rs`.
///
/// **Only what is built.** A usage listing a command that refuses, or a flag
/// that parses and does nothing, is the same promise a config field nothing
/// reads makes -- so this is checked against the dispatch below by a test
/// rather than kept in step by hand.
fn usage() {
    println!(
        "\
nts {version} -- compile TypeScript ahead of time

USAGE
  nts <command> [project] [options]

`project` is a directory, or the `tsconfig.json` in it. Defaults to the
current directory.

BUILDING
  build        build every product `nts.config.ts` declares, for every target
  check        typecheck and lower, writing nothing

EMITTING ONE BACKEND
  emit-c       render the program as C, to --out or stdout
  emit-llvm    render the program as textual LLVM IR, to stdout
  emit-jvm     render the program as class files, to --out

BINDINGS
  bind-c       generate a TypeScript declaration from a C header
  bind         generate declarations and a binding table from class files
  deps         acquire the TypeScript behind this project's dependencies

INSPECTING
  frontend     what the frontend answered, before lowering
  types        every type the frontend resolved, as the schema records it
  hir          the lowered program; --prepared is what a backend receives
  facts        the facts lowering derived; --prepared for the prepared program
  refusals     every construct this program was refused for, with its reason
  layouts      the object layouts the program produces
  modules      the modules the program is made of
  erasure      what the program does with its `any` and `unknown` values

  help         this
  version      version, snapshot schema, and the pinned tsgo

`nts build` options
  --out <dir>        where artifacts go. Default `<project>/.nts/build`
  --product <name>   build one product rather than all of them
  --os <os>          build only the targets whose OS is this
  --no-acquire       do not fetch dependencies first

The config is `nts.config.ts` beside the project's `tsconfig.json`. See
docs/nts-config.md for what it declares.",
        version = env!("CARGO_PKG_VERSION")
    );
}

/// Which binary this is, so "am I holding a stale one" has an answer.
///
/// **Identity, not provenance, and the difference is the whole of it.** This
/// cannot say which commit produced the binary -- nothing here records that --
/// so it does not pretend to. What it can say is *when this file was linked*,
/// which answers the question that actually gets asked: is what I am running
/// older than the change I am looking for?
///
/// It cost an hour of one session to not have. A probe reproduced a defect that
/// had been fixed, on a binary built before the fix, and reading it as a
/// regression in someone else's change took a `git merge-base` to rule out --
/// an answer only available to somebody standing in the repository.
///
/// Epoch seconds rather than a formatted date, because the comparison a person
/// makes is against `git log -1 --format=%ct <commit>`, and a date they have to
/// parse back is one more step between them and the answer. The line says so.
///
/// **And it is sound in one direction only, which the line also says.** Linked
/// *before* a commit proves the binary predates it. Linked *after* proves
/// nothing -- a rebuild without a pull gives a fresh mtime over old source. The
/// first version of this line read "older ... means stale", which is the true
/// half stated as though it were both.
fn binary_identity() {
    let Ok(exe) = std::env::current_exe() else { return };
    println!("binary {}", exe.display());
    let linked = exe
        .metadata()
        .and_then(|at| at.modified())
        .ok()
        .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_secs());
    if let Some(linked) = linked {
        println!(
            "linked {linked} -- below `git log -1 --format=%ct <commit>` means it \
             predates that commit; above proves nothing, a rebuild is not a pull"
        );
    }
}

/// What was asked for, or `None` when the answer was the usage.
///
/// **`--help` anywhere, not only alone.** `nts build --help` treated `--help`
/// as the project path and reported that there is no config beside it -- and
/// that is the spelling a person reaches for *after* they know the command
/// exists, so it is the more likely of the two to be typed.
fn arguments() -> Option<Vec<String>> {
    let given: Vec<String> = std::env::args().skip(1).collect();
    if given.iter().any(|arg| arg == "--help" || arg == "-h") {
        usage();
        return None;
    }
    Some(given)
}

fn main() -> Result<()> {
    let Some(given) = arguments() else { return Ok(()) };
    let mut args = given.into_iter();
    match args.next().as_deref() {
        Some("frontend") => {
            let rest: Vec<String> = args.collect();
            let decompose = rest.iter().any(|a| a == "--decompose");
            let calls = rest.iter().any(|a| a == "--calls");
            let constants = rest.iter().any(|a| a == "--constants");
            let tsconfig = project(&rest)?;
            frontend(&tsconfig, decompose, calls, constants)
        }
        Some("build") => build(&args.collect::<Vec<String>>()),
        Some("check") => check(&args.collect::<Vec<String>>()),
        // `bind-c`, not `bind`: `bind` is the Java binding generator below, and
        // an arm added above it silently shadowed that command. Named for what
        // it emits, the way `emit-c` is.
        Some("bind-c") => bind_c(&args.collect::<Vec<String>>()),
        Some("emit-c") => {
            let rest: Vec<String> = args.collect();
            // Through `project`, like every other command that builds a
            // program. It used to scan for the first non-`--` argument itself,
            // which found the same path *and* skipped dependency acquisition --
            // so `emit-c`, the most build-like command there is, was the one
            // that refused an imported name as a builtin. `project` already
            // knows `--out` takes a value, which is the reason the hand-rolled
            // scan existed.
            let tsconfig = project(&rest)?;
            // `--out <dir>` writes the program *and* the runtime, which is what
            // it takes to compile anything. Without it the program goes to
            // stdout, which is convenient to read and not enough to build.
            let out = rest
                .iter()
                .position(|a| a == "--out")
                .and_then(|at| rest.get(at + 1))
                .map(Utf8PathBuf::from);
            emit_c(&tsconfig, out.as_deref(), Emission::from_flags()).map(|_| ())
        }
        // The second backend, reading the same HIR. Textual, so it can be read
        // the way `program.c` can -- which is how three bugs were found in the
        // week before it existed.
        Some("emit-llvm") => {
            let rest: Vec<String> = args.collect();
            emit_llvm(&project(&rest)?, Emission::from_flags())
        }
        // The third backend. Not textual, so `--text` renders the listing that
        // stands in for reading `program.c` -- disassembled from the bytes
        // rather than logged while writing them, so it and `javap -c` are two
        // readings of the same class rather than one opinion twice.
        Some("emit-jvm") => {
            let rest: Vec<String> = args.collect();
            let out = rest
                .iter()
                .position(|arg| arg == "--out")
                .and_then(|at| rest.get(at + 1))
                .map(Utf8PathBuf::from);
            emit_jvm(
                &project(&rest)?,
                out.as_deref(),
                rest.iter().any(|arg| arg == "--text"),
                Emission::from_flags(),
            )
            .map(drop)
        }
        // Every type the frontend resolved, as the schema records it. A
        // lowering refusal names a *type*, and until now there was no way to see
        // what that type actually is — which is a scavenger hunt for anyone
        // working on representation.
        Some("types") => {
            let rest: Vec<String> = args.collect();
            print_types(&project(&rest)?)
        }
        Some("hir") => {
            let rest: Vec<String> = args.collect();
            let tsconfig = project(&rest)?;
            dump_hir(&tsconfig)
        }
        Some("facts") => {
            let rest: Vec<String> = args.collect();
            let tsconfig = project(&rest)?;
            dump_facts(&tsconfig, rest.iter().any(|arg| arg == "--prepared"))
        }
        Some("refusals") => {
            let rest: Vec<String> = args.collect();
            let tsconfig = project(&rest)?;
            dump_refusals(&tsconfig)
        }
        // Every layout, with its fields in order, its base, and the type ids
        // that share it.
        //
        // The instrument that was missing. `same_shape` merges layouts, and a
        // wrong merge is invisible in every answer a program computes until it
        // is a wrong field offset or a base that is not a prefix -- two of
        // those in one day, and both were diagnosed by reading generated C for
        // want of a way to ask the compiler directly. `types` prints what the
        // checker said and this prints what was made of it, which is the half
        // the merge decides.
        Some("layouts") => {
            let rest: Vec<String> = args.collect();
            dump_layouts(&project(&rest)?)
        }
        // The module graph, and the order it implies. The instrument comes
        // before anything depends on the order: evaluation order is one of the
        // few places where a wrong answer looks exactly like a right one, so it
        // has to be visible.
        Some("modules") => {
            let rest: Vec<String> = args.collect();
            dump_modules(&project(&rest)?)
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
            dump_erasure(&project(&rest)?, rest.iter().any(|a| a == "--sites"))
        }
        // Acquire the TypeScript behind this project's dependencies, and say
        // what could not be acquired. `docs/npm-deps-plan.md` is why this is a
        // report as much as an action: there is no JavaScript fallback, so a
        // dependency the compiler cannot take has to be visible before a build
        // fails on it.
        // Read a jar, write the declarations and the binding table beside each
        // other. `docs/jvm-interop.md` has quoted this command since its first
        // draft and it answered `unknown command` until now; the generator
        // lived in `cargo run --example bind` behind a shell script.
        Some("bind") => {
            let rest: Vec<String> = args.collect();
            bind_java(&rest)
        }
        Some("deps") => {
            let rest: Vec<String> = args.collect();
            deps(&rest)
        }
        Some("version") => {
            println!("nts {}", env!("CARGO_PKG_VERSION"));
            println!("snapshot schema v{SCHEMA_VERSION}");
            println!("pinned tsgo {}", tsgo::PINNED_TSGO);
            binary_identity();
            Ok(())
        }
        // **`nts` alone used to print the version banner and exit zero**, which
        // tells someone who has just installed it nothing about what it does.
        // `--help` answered `unknown command \`--help\``, which is the one
        // spelling every other tool on the machine accepts. A build tool whose
        // own surface has to be read out of `main.rs` is not finished, whatever
        // it can build.
        None | Some("help" | "--help" | "-h") => {
            usage();
            Ok(())
        }
        Some(other) => bail!(
            "unknown command `{other}`. `nts help` lists them; `nts version` prints \
             the version"
        ),
    }
}



/// A jar, unpacked into a directory this run owns.
///
/// **`nts-jvm-emitter` has no zip dependency and will not grow one to open an
/// archive the caller's machine can already open.** The workspace manifest
/// says every external dependency is a maintenance obligation, and a zip plus
/// a deflate crate would be two. `unzip` is already on any machine that has a
/// jar to bind.
fn unpacked(archive: &Utf8Path) -> Result<Utf8PathBuf> {
    let into = Utf8PathBuf::from(format!(
        "{}/nts-bind-{}",
        std::env::temp_dir().display(),
        std::process::id()
    ));
    std::fs::create_dir_all(&into)?;
    let status = std::process::Command::new("unzip")
        .args(["-o", "-q", archive.as_str(), "-d", into.as_str()])
        .status()
        .map_err(|why| anyhow!("could not run `unzip`, which --jar needs: {why}"))?;
    if !status.success() {
        bail!("`unzip` could not read {archive}");
    }
    Ok(into)
}

/// The member list `--members` names, as the binder wants it.
///
/// Blank lines and `#`-comments are skipped so the list can explain itself,
/// and `.` becomes `/` so a curator writes `java.util.Map#get` rather than the
/// binary name. `None` keeps everything, which is what binding somebody's jar
/// wants -- there the closure is the point.
fn curated(path: Option<&Utf8PathBuf>) -> Result<Option<std::collections::BTreeSet<String>>> {
    let Some(path) = path else { return Ok(None) };
    let text = std::fs::read_to_string(path.as_std_path())
        .map_err(|why| anyhow!("cannot read {path}: {why}"))?;
    Ok(Some(
        text.lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(|line| line.replace('.', "/"))
            .collect(),
    ))
}

/// `nts bind` -- a jar or a directory of class files in, TypeScript
/// declarations and a binding table out.
///
/// ```text
/// nts bind --jar app.jar     --package com.example --out types/
/// nts bind --classes out/cls --package com.example --out types/
/// ```
///
/// Writes `<out>/<package>.d.ts` and `<out>/<package>.bind`. The second is the
/// half the compiler reads: a `.d.ts` says `drawText` takes a string and says
/// nothing about which of four overloads to invoke, or whether the call is
/// `invokevirtual` or `invokeinterface`.
///
/// **Both files come from one call, and that is load-bearing.** `write_table`
/// numbers its rows by byte offset into the text `module_of` just produced, so
/// a table generated by a second pass would be a second derivation of one
/// fact. It would also be *silently* wrong: an offset that lands one
/// declaration over resolves a call to the wrong overload rather than to none.
/// The shell script this replaces ran the generator twice, once per file.
///
/// **`--prelude` writes a different filename, because it writes a different
/// document.** The prelude form wraps the same class bodies in a global
/// `declare namespace` instead of an ambient `declare module`, so its text --
/// and therefore every offset in its table -- differs. Sharing one output path
/// between the two modes meant the second run silently destroyed the first
/// run's bindings, which cost twenty minutes to find and would cost a user
/// longer, because the file left behind is a valid declaration file.
/// Read the never-null members from an overrides file.
///
/// The shape is one entry per class, because that is how a person reads a jar:
///
/// ```json
/// { "com.example.Catalog": { "nullability": { "name()Ljava/lang/String;": "nonnull" } } }
/// ```
///
/// Keys beginning `//` are comments -- JSON has none, and a file describing
/// decisions needs somewhere to say why.
///
/// **A value other than `nonnull` is an error rather than a skip.** `"nullable"`
/// is the default and writing it would be harmless; anything else is a typo, and
/// a typo silently ignored here produces exactly the file the author was trying
/// to correct.
fn nonnull_overrides(path: &Utf8Path) -> Result<std::collections::BTreeSet<String>> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
    let root: serde_json::Value =
        serde_json::from_str(&text).with_context(|| format!("parsing {path}"))?;
    let classes = root.as_object().ok_or_else(|| anyhow!("{path}: the top level is not an object"))?;
    let mut out = std::collections::BTreeSet::new();
    for (class, body) in classes {
        if class.starts_with("//") {
            continue;
        }
        let Some(nullability) = body.get("nullability").and_then(serde_json::Value::as_object) else {
            continue;
        };
        for (member, how) in nullability {
            if member.starts_with("//") {
                continue;
            }
            match how.as_str() {
                Some("nonnull") => {
                    out.insert(format!("{class}#{member}"));
                }
                Some("nullable") => {}
                other => bail!(
                    "{path}: {class}#{member} says {:?}; the values are \"nonnull\" and \"nullable\"",
                    other.unwrap_or("a non-string")
                ),
            }
        }
    }
    Ok(out)
}

fn bind_java(args: &[String]) -> Result<()> {
    let mut jar: Option<Utf8PathBuf> = None;
    let mut classes: Option<Utf8PathBuf> = None;
    let mut package: Option<String> = None;
    let mut out: Option<Utf8PathBuf> = None;
    let mut prelude = false;
    let mut keeps = false;
    let mut self_contained = false;
    let mut members: Option<Utf8PathBuf> = None;
    let mut overrides: Option<Utf8PathBuf> = None;
    let mut at = 0;
    while at < args.len() {
        let value = |at: usize, what: &str| -> Result<String> {
            args.get(at + 1).cloned().ok_or_else(|| anyhow!("`{what}` needs a value"))
        };
        match args[at].as_str() {
            "--jar" => { jar = Some(Utf8PathBuf::from(value(at, "--jar")?)); at += 2 }
            "--classes" => { classes = Some(Utf8PathBuf::from(value(at, "--classes")?)); at += 2 }
            "--package" => { package = Some(value(at, "--package")?); at += 2 }
            "--out" => { out = Some(Utf8PathBuf::from(value(at, "--out")?)); at += 2 }
            "--prelude" => { prelude = true; at += 1 }
            "--keeps" => { keeps = true; at += 1 }
            "--self-contained" => { self_contained = true; at += 1 }
            "--members" => { members = Some(Utf8PathBuf::from(value(at, "--members")?)); at += 2 }
            "--overrides" => { overrides = Some(Utf8PathBuf::from(value(at, "--overrides")?)); at += 2 }
            // Refused rather than ignored. A misspelled flag that is skipped
            // produces a correct-looking file built with the wrong options.
            other => bail!("unknown argument `{other}`; nts bind takes --jar or --classes, --package, --out, --prelude, --keeps, --self-contained, --members, --overrides"),
        }
    }
    // **What the class file cannot say**, supplied out of band.
    //
    // An unannotated reference return becomes `T | null` and that is the only
    // sound default -- guessing non-null produces the NPE the type system
    // promised could not happen. The cost lands on a jar that carries no
    // annotations at all, where every call site then narrows a value its author
    // knows is never null.
    //
    // The file was checked in beside `java-from-ts` from that project's first
    // commit, documented in `docs/jvm-interop.md`, and **read by nothing** until
    // 2026-09-15. The project's own `Catalog.java` says `describe` "is marked
    // and `name` is not, so the generator has to distinguish", and the generator
    // could not: both rendered `string | null` and there was no mechanism to
    // tell them apart.
    if let Some(path) = &overrides {
        nts_jvm_emitter::bind::set_nonnull(nonnull_overrides(path)?);
    }
    let (Some(package), Some(out)) = (package, out) else {
        bail!("nts bind needs --package and --out");
    };
    let root = match (jar, classes) {
        (Some(_), Some(_)) => bail!("--jar and --classes name the same input two ways; give one"),
        (None, None) => bail!("nts bind needs --jar or --classes"),
        (None, Some(directory)) => directory,
        // **A jar is a zip and this crate deliberately has no zip dependency**
        // -- the workspace manifest says every external dependency is a
        // maintenance obligation, and a zip plus a deflate crate would be two.
        // `unzip` is already on the machine that has a jar.
        (Some(archive), None) => unpacked(&archive)?,
    };
    // **Exactly this package, and no anonymous classes.**
    //
    // `ends_with` on the parent looked right and was not: a class in the
    // *default* package has an empty parent, and every path ends with the
    // empty path, so `Demo.class` sitting beside the tree came out as a member
    // of `com.example.ui`.
    //
    // Anonymous classes -- `Loader$1`, the compiler's name for an inline
    // `new OnBytes() { ... }` -- are excluded because no source can name one,
    // so a declaration for it is surface nobody can call. Excluding them here
    // is what lets a caller say `--package` and stop, instead of listing every
    // class by hand to leave the synthetic ones out.
    let want = package.replace('.', "/");
    let names = nts_jvm_emitter::bind::classes_under(root.as_std_path())
        .into_iter()
        .filter(|name| match name.rsplit_once('/') {
            Some((prefix, _)) => prefix == want,
            None => want.is_empty(),
        })
        .filter(|name| {
            !name.rsplit('/').next().unwrap_or(name).split('$').skip(1).any(|part| {
                !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())
            })
        })
        .collect::<Vec<_>>();
    if names.is_empty() {
        bail!("no class files for package `{package}` under {root}");
    }
    // **A curated prelude has to close.** With `--self-contained` a member
    // that mentions a class outside this tree is left out instead of rendered
    // against a type nothing declares -- which is a `.d.ts` that does not
    // compile, measured at 60 errors before this existed. The count is printed
    // below rather than swallowed: leaving a member out is a decision.
    // **A curated prelude is a vocabulary, not a jar.** `java.lang.Integer`
    // has fifty methods and a caller wants three. Naming the members is how a
    // person curates one -- and the byte offsets the table needs come from the
    // same run that renders the text, which is the half a hand-written prelude
    // cannot have and the reason one had no table at all.
    //
    // Blank lines and `#`-comments are skipped so the list can explain itself.
    nts_jvm_emitter::bind::keep_members(curated(members.as_ref())?);
    nts_jvm_emitter::bind::prune_to(self_contained.then(|| {
        nts_jvm_emitter::bind::classes_under(root.as_std_path()).into_iter().collect()
    }));
    let resolve = nts_jvm_emitter::bind::FromDirectory(root.as_std_path().to_path_buf());
    let mut bodies = Vec::new();
    for name in &names {
        let path = root.as_std_path().join(format!("{name}.class"));
        let bytes = std::fs::read(&path)
            .map_err(|why| anyhow!("cannot read {}: {why}", path.display()))?;
        let class = nts_jvm_emitter::read::class_file(&bytes)
            .map_err(|why| anyhow!("{}: {why}", path.display()))?;
        // Refuse by name, never half-emit: a declaration file that silently
        // dropped a member is one a caller trusts.
        let (text, rows) = nts_jvm_emitter::bind::declarations_with(&class, &resolve)
            .map_err(|why| anyhow!("refused {why}"))?;
        bodies.push((name.clone(), text, rows));
    }
    let (text, bound) = if prelude {
        nts_jvm_emitter::bind::namespace_of(&package, &bodies)
    } else {
        nts_jvm_emitter::bind::module_of(&package, &bodies)
    };
    std::fs::create_dir_all(&out)?;
    // **The table shares its text's stem, and must.** A `.bind` is only valid
    // for the exact text whose offsets it numbers, and the compiler finds it by
    // stripping `.d.ts` and appending `.bind` (`foreign_tables`). Writing both
    // modes' tables to one name left `com.example.bind` describing the prelude
    // text while `com.example.d.ts` was what got read -- offsets landing one
    // declaration over, which resolves a call to the wrong overload rather than
    // to none. The same defect as the shared `.d.ts` path, one size smaller.
    let stem = if prelude { format!("{package}.prelude") } else { package.clone() };
    let declarations = out.join(format!("{stem}.d.ts"));
    let table = out.join(format!("{stem}.bind"));
    std::fs::write(&declarations, &text)?;
    std::fs::write(&table, nts_jvm_emitter::bind::write_table(&package, &bound))?;
    println!("nts bind: {} class(es) -> {declarations} and {table}", names.len());
    if self_contained {
        println!(
            "nts bind: {} member(s) left out, mentioning classes outside this tree",
            nts_jvm_emitter::bind::pruned()
        );
    }
    // The escape table: which parameters a bound method retains, read out of
    // the callee's own bytecode. Its own artefact and its own flag because it
    // is consumed by the compiler rather than by a person, and because **an
    // empty one is a result** -- a jar of declarations with no code to analyse
    // produces nothing, and that is the signal, not a failure.
    if keeps {
        write_keeps(&root, &names, &out.join(format!("{stem}.keeps.json")))?;
    }
    Ok(())
}

/// The escape table for a set of bound classes, read out of their own
/// bytecode: which parameters each method retains.
///
/// Its own artefact because it is consumed by the compiler rather than by a
/// person, and **an empty one is a result rather than a failure** -- a jar of
/// declarations with no method bodies to analyse produces nothing, and that is
/// the signal. Collapsing "nothing retained" into "not analysed" is the one
/// mistake this file must not make: the first is a licence to keep a value on
/// the stack and the second is not.
fn write_keeps(root: &Utf8Path, names: &[String], path: &Utf8Path) -> Result<()> {
    let mut rows: Vec<String> = Vec::new();
    for name in names {
        let Ok(bytes) = std::fs::read(root.as_std_path().join(format!("{name}.class"))) else {
            continue;
        };
        let Ok(class) = nts_jvm_emitter::read::class_file(&bytes) else { continue };
        for (key, escaping) in nts_jvm_emitter::escapes::table(&class) {
            let list = escaping.iter().map(ToString::to_string).collect::<Vec<_>>().join(", ");
            rows.push(format!("  \"{key}\": [{list}]"));
        }
    }
    std::fs::write(path, format!("{{\n{}\n}}\n", rows.join(",\n")))?;
    println!("nts bind: {} row(s) -> {path}", rows.len());
    Ok(())
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
/// Every layout, and whether each one's base really is its prefix.
///
/// The check at the end is `verify::check_layouts` restated as a report rather
/// than a refusal: a base named here has to be laid out as the prefix every
/// backend already treats it as, and when it is not, seeing both field lists
/// side by side is the whole diagnosis.
/// What an addon would publish.
///
/// Invisible until it was printed: an export the wrapper cannot represent is
/// dropped silently, so a missing one costs a test failure naming nothing
/// rather than a diagnostic.
fn print_public_api(program: &hir::Program) {
    if program.public_api.is_empty() && program.public_namespaces.is_empty() {
        return;
    }
    println!("\npublic api");
    let names = |emitted: &str| program.funcs.iter().any(|func| func.name == emitted);
    // Three answers, not two. A published name that no function answers to is
    // not necessarily absent: `export const version = "2.1.0"` is a *global*,
    // and reporting it as a missing function is how the addon backend used to
    // describe it too -- "is not a function this backend can name", which reads
    // like a gap and was a shape.
    let missing = |emitted: &str| {
        if names(emitted) {
            ""
        } else if program
            .globals
            .iter()
            .any(|global| global.name == emitted && global.exported)
        {
            "   (a value)"
        } else {
            "   (no function or value of that name)"
        }
    };
    for (emitted, published) in &program.public_api {
        println!("  {published} -> {emitted}{}", missing(emitted));
    }
    // A namespace and its members, which this printed nothing about while the
    // built addon published one. The Node lane read the omission as a missing
    // export and reported `punycode` as four of six on the evening `ucs2`
    // started working -- understated by the export that had just been
    // repaired, by the instrument that exists to say so.
    for (namespace, members) in &program.public_namespaces {
        println!("  {namespace} (namespace)");
        for (property, emitted) in members {
            println!("    {property} -> {emitted}{}", missing(emitted));
        }
    }
}

/// Where the frontend binary is.
///
/// `NTS_TSGO` first, then the one this repository builds, and only then the
/// bare name through `PATH`. The bare name was the whole of it, in ten places,
/// and it is the worst of the three defaults: it reaches an asdf shim on this
/// machine, which fails; on a machine with some other `tsgo` installed it
/// **succeeds**, against an unpinned frontend, which is quietly wrong rather
/// than loudly broken.
///
/// Every gate script exports `NTS_TSGO`, so nothing in the gate ever saw it --
/// `all.sh` carries a note about `0 of 128` from exactly this cause, and a
/// two-binary measurement here reported zero diagnostics from both binaries,
/// which reads like a perfect result and was 22 modules failing at the
/// frontend.
///
/// [`tsgo::locate`] already answers this question and was called in one place.
/// Its own doc says why it exists: a suite run with the variable unset "is
/// green whatever it would have found". The same sentence is true of every
/// command here.
///
/// The bare name is kept as the last resort rather than removed, for a checkout
/// that has not run the bootstrap and a `tsgo` the user installed themselves.
fn frontend_binary() -> String {
    std::env::var("NTS_TSGO").ok().unwrap_or_else(|| {
        tsgo::locate().map_or_else(|| "tsgo".to_owned(), |path| path.to_string())
    })
}

fn dump_layouts(tsconfig: &Utf8Path) -> Result<()> {
    let tsgo_binary = frontend_binary();
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;
    if snapshot.has_errors() {
        bail!("the program does not typecheck");
    }
    // The prepared program, not the freshly lowered one. `settle` is where
    // `put_bases_first` runs, so a dump taken before it reports a `BROKEN`
    // relation that no backend ever sees -- an instrument describing a state
    // nothing consumes, which is the failure this file exists to avoid.
    let prepared = hir::prepare_unverified(&snapshot, &hir::Options::default());
    let program = &prepared.program;
    for layout in &program.layouts {
        let ids: Vec<String> = layout.types.iter().map(|ty| format!("{}", ty.0)).collect();
        println!("{} [{}]", layout.name, ids.join(" "));
        if !layout.interfaces.is_empty() {
            let faces: Vec<String> = layout
                .interfaces
                .iter()
                .map(|face| {
                    program
                        .layouts
                        .iter()
                        .find(|other| other.types.contains(face))
                        .map_or_else(|| format!("{}", face.0), |other| other.name.clone())
                })
                .collect();
            println!("  implements {}", faces.join(" "));
        }
        if let Some(base) = layout.base {
            let named = program
                .layouts
                .iter()
                .find(|other| other.types.contains(&base))
                .map_or("<no layout>", |other| other.name.as_str());
            println!("  base {} -> {named}", base.0);
        }
        for field in &layout.fields {
            println!("  {} : {:?}", field.name, field.ty);
        }
        let filled: Vec<&str> = layout
            .methods
            .iter()
            .filter_map(|slot| slot.as_deref())
            .collect();
        if !filled.is_empty() {
            println!("  methods {}", filled.join(" "));
        }
    }
    // What an addon would publish, which was invisible until now: an export the
    // wrapper cannot represent is dropped silently, so a missing one costs a
    // test failure naming nothing rather than a diagnostic.
    print_public_api(program);

    // The same question `verify` asks, reported rather than refused.
    for layout in &program.layouts {
        let Some(at) = program.base_layout(layout) else {
            continue;
        };
        let Some(base) = program.layouts.get(at) else {
            continue;
        };
        let prefix = base.fields.len() <= layout.fields.len()
            && base
                .fields
                .iter()
                .zip(&layout.fields)
                .all(|(mine, theirs)| mine.name == theirs.name && mine.ty == theirs.ty);
        if !prefix {
            println!("\nBROKEN {} over {}", layout.name, base.name);
            println!(
                "  base   {}",
                base.fields
                    .iter()
                    .map(|f| f.name.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            );
            println!(
                "  layout {}",
                layout
                    .fields
                    .iter()
                    .map(|f| f.name.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            );
        }
    }
    Ok(())
}

/// What the analysis proves about every number, before or after preparation.
///
/// `--prepared` is not a display option. The functions a backend compiles are
/// not the functions the lowering produced: `guards` gives a root a `#whole`
/// variant whose parameters are integers, `signatures` narrows them, and every
/// representation decision is made about *those*. Dumping the lowered program
/// reports the facts of a function that is not the one being compiled -- which
/// is how four hypotheses about `utf8Write`'s counter were tested against the
/// wrong `utf8Write`.
///
/// The facts here are the finished program's, not the ones that were available
/// at the moment a decision was made. That is the right question for "could
/// this have been narrowed" and the wrong one for "why was it not", and the
/// difference matters where a pass consumes an analysis it then invalidates.
/// Every function this program refused, by the name a later pass asks with.
///
/// `Program::uncompiled` is the only place a refusal is keyed by a **name**
/// rather than by a span. The napi wrapper reads it to say why an export is
/// missing; nothing else could, because no output mode printed it. That gap
/// was load-bearing: `tooling/conformance/gates.mjs` ranks the roots that
/// declined exports stand behind and could name the root and not its reason, so
/// establishing that `asRequest` is refused as "a generic function no call pins
/// down" meant grepping a module's whole diagnostic stream by hand and matching
/// on a line number.
///
/// The **prepared** program, not the freshly lowered one, for the same reason
/// `emit-c` uses it: a cascade entry — `it calls X, which was refused above` —
/// is written by a pass that runs after lowering, and those are most of the
/// interesting ones. Unverified, because a program that does not verify still
/// has refusals worth reading, and this is a question about the refusals.
///
/// One line per entry, `name<TAB>reason`, because a reason contains commas,
/// backticks and parentheses and a reader is usually a script.
fn dump_refusals(tsconfig: &Utf8Path) -> Result<()> {
    let tsgo_binary = frontend_binary();
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;
    if snapshot.has_errors() {
        bail!("the program does not typecheck");
    }
    let prepared = hir::prepare_unverified(&snapshot, &hir::Options::default());
    for (name, why) in &prepared.program.uncompiled {
        println!("{name}\t{why}");
    }
    Ok(())
}

fn dump_facts(tsconfig: &Utf8Path, prepared: bool) -> Result<()> {
    let tsgo_binary = frontend_binary();
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;
    if snapshot.has_errors() {
        bail!("the program does not typecheck");
    }

    let program = if prepared {
        hir::prepare(&snapshot)
            .map_err(|problems| {
                anyhow::anyhow!("the prepared program does not verify: {problems:?}")
            })?
            .program
    } else {
        hir::lower::lower(&snapshot).program
    };
    // The whole-program analysis, so this reports what the compiler actually
    // knows rather than what one function could work out alone.
    let analyses =
        hir::interprocedural::analyze_program(&program, hir::reachable::Roots::EveryExport);
    for (func, analysis) in program.funcs.iter().zip(&analyses) {
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
    let tsgo_binary = frontend_binary();
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

    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;
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

    let tsgo_binary = frontend_binary();
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;
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
    let tsgo_binary = frontend_binary();
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;

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


/// One function per header, one block per label, one operation per line.
fn print_program(program: &hir::Program) {
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
}
/// The functions `--entry name,name` roots the program at.
///
/// Empty means every export, which is what a *library* is. An executable has
/// one entry and so does a benchmark: `tooling/bench` roots at whatever its
/// `case.ts` exports.
///
/// It matters more than a flag usually does. Without it this printed a
/// different program than the benchmark builds -- every export is a root, a
/// root's signature is its published ABI, so nothing narrows. Reading that and
/// concluding the compiler had missed something cost me a whole diagnosis: four
/// conversions around a modulo that the real build does not have.
/// Every name any `--entry` names, in either spelling.
///
/// **There were two parsers and they disagreed.** This one took the first
/// `--entry` and split it on commas; the emitters' took every `--entry` and
/// split nothing. So `--entry a,b` meant two roots to `nts hir` and one root
/// named `"a,b"` to `emit-c` -- a name no function has, which matches nothing,
/// which narrows the program to nothing:
///
///     emit-c --entry published                (kept) onlyPublished published
///     emit-c --entry published,diagnostic     (kept)
///
/// Empty output, exit zero. Reading the two commands' help would not have told
/// you, because each was right about itself.
///
/// So both spellings are accepted everywhere rather than one being declared the
/// winner: each is already in use, neither is wrong, and a flag that silently
/// empties a program is not a thing to leave one more release.
fn entry_names() -> Vec<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .enumerate()
        .filter(|(_, arg)| arg.as_str() == "--entry")
        .filter_map(|(at, _)| args.get(at + 1))
        .flat_map(|names| names.split(','))
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect()
}

fn dump_hir(tsconfig: &Utf8Path) -> Result<()> {
    let tsgo_binary = frontend_binary();
    // Call resolution is not optional here: without it a call site has no known
    // target and lowering refuses it.
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;

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
        let entry = selected_roots(Shape::from_flags());
        let options = hir::Options {
            provider: if std::env::args().any(|arg| arg == "--rc") {
                hir::Provider::ReferenceCounting
            } else {
                hir::Provider::NoGc
            },
            // Through `selected_roots`, so this prints the program a backend
            // receives rather than a neighbouring one. It did not: the old
            // parser here never appended module initialization, so
            // `hir --prepared --entry published` dropped `module#init` while
            // `emit-c --entry published` kept it. An instrument describing a
            // state nothing consumes is the failure this command exists to
            // avoid, and `named_entry`'s own comment is about what a missing
            // `module#init` costs -- five module-level `const`s left null and a
            // benchmark answering 32768 against node's 10240.
            roots: entry.as_deref().map_or(hir::reachable::Roots::EveryExport, hir::reachable::Roots::Entry),
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
    print_program(&program);

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
        HirType::NativePointer(name) => format!("native<{name}>"),
        HirType::Void => "void".to_owned(),
        HirType::Never => "never".to_owned(),
        HirType::Bool => "bool".to_owned(),
        HirType::Erased => "erased".to_owned(),
        HirType::BigInt => "bigint".to_owned(),
        HirType::Int { bits, signed } => format!("{}{bits}", if *signed { 'i' } else { 'u' }),
        HirType::Float { bits } => format!("f{bits}"),
        HirType::Managed(ManagedType::String) => "managed<str>".to_owned(),
        HirType::Managed(ManagedType::Symbol) => "managed<sym>".to_owned(),
        HirType::Managed(ManagedType::Date) => "managed<date>".to_owned(),
        HirType::Managed(ManagedType::Buffer) => "managed<buffer>".to_owned(),
        HirType::Managed(ManagedType::View(element)) => {
            format!("managed<view<{}>>", render(element))
        }
        HirType::Managed(ManagedType::DataView) => "managed<dataview>".to_owned(),
        HirType::Managed(ManagedType::AnyView) => "managed<anyview>".to_owned(),
        // Named by the part of the synthetic space it is in. Every one of them
        // printed as `closure#N` before, which is the one thing an `async`
        // frame and a generator's frame are not -- and this dump is where a
        // frame is looked at.
        HirType::Managed(ManagedType::Object(id))
            if id.0 >= nts_core::hir::SYNTHETIC_TYPE_FLOOR =>
        {
            let (what, base) = if id.0 >= nts_core::hir::SYNTHETIC_CLOSURES {
                ("closure", nts_core::hir::SYNTHETIC_CLOSURES)
            } else if id.0 >= nts_core::hir::SYNTHETIC_GENERATOR_FRAMES {
                ("generator", nts_core::hir::SYNTHETIC_GENERATOR_FRAMES)
            } else if id.0 >= nts_core::hir::SYNTHETIC_FRAMES {
                ("frame", nts_core::hir::SYNTHETIC_FRAMES)
            } else {
                ("cell", nts_core::hir::SYNTHETIC_CELLS)
            };
            format!("managed<{what}#{}>", id.0 - base)
        }
        HirType::Managed(ManagedType::Object(id)) => format!("managed<obj#{}>", id.0),
        HirType::Managed(ManagedType::Array(element)) => {
            format!("managed<[{}]>", render(element))
        }
        HirType::Managed(ManagedType::Promise(payload)) => {
            format!("managed<promise<{}>>", render(payload))
        }
        HirType::Managed(ManagedType::Table(key, value)) => {
            format!("managed<table<{}, {}>>", render(key), render(value))
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
        // With the contract each parameter carries, because a contract that
        // cannot be read off the HIR cannot be checked to have survived it.
        // `escape.rs` consults exactly this, and until it was printed the only
        // way to see whether a pass had preserved it was to read the pass.
        //
        // `Unknown` is a dot rather than a word: it is the absence of a claim,
        // it is the common case, and spelling it out would bury the arguments
        // that do carry one under the ones that do not.
        nts_core::hir::Callee::Native(target) => {
            let contract: String = target
                .retention
                .iter()
                .map(|kept| match kept {
                    nts_core::hir::native::Retention::NotRetained => '-',
                    nts_core::hir::native::Retention::Unknown => '.',
                })
                .collect();
            let name = if contract.contains('-') {
                format!("{} [{contract}]", target.name)
            } else {
                target.name.clone()
            };
            ("call.native".to_owned(), name)
        }
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
        OpKind::ConstNull => "null".to_owned(),
        OpKind::ConstUndefined => "undefined".to_owned(),
        // A constant with an address: the one instance of a named function's
        // closure. Nullary like the rest, which is why it renders here.
        OpKind::ClosureStatic => "closure.static".to_owned(),
        // Named by the function it bridges rather than by the closure value, so
        // reading the dump answers "which function does C get" without first
        // resolving a layout by hand.
        OpKind::NativeBridge { closure, signature } => {
            format!("bridge %{} as {}", closure.0, signature.name)
        }
        _ => unreachable!("only the constants reach here"),
    };
    format!("%{index} = const {value} : {ty}")
}

/// Indexing an array, both directions.
///
/// `unchecked` is printed rather than omitted: it is the bound check the
/// analysis proved unnecessary, and a dump that did not say so would make an
/// elided check look like one that was never there.
fn render_element(index: usize, ty: &str, kind: &OpKind) -> String {
    match kind {
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
        _ => unreachable!("only the two indexing operations reach here"),
    }
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
        OpKind::Await {
            promise,
            rejects_to,
        } => {
            // The rejection edge is printed, because an `await` inside a `try`
            // and one outside it are the same three characters otherwise and
            // the difference is the whole feature.
            let caught = rejects_to.as_ref().map_or_else(String::new, |it| {
                let args: Vec<String> = it.args.iter().map(|a| format!("%{}", a.0)).collect();
                format!(" rejects to b{}({})", it.handler.0, args.join(", "))
            });
            format!("%{index} = await %{} : {ty}{caught}", promise.0)
        }
        OpKind::Yield { value } => format!("yield %{}", value.0),
        OpKind::Suspend {
            promise,
            frame,
            resume,
        } => format!("suspend %{} -> {resume}(%{})", promise.0, frame.0),
        _ => unreachable!("only reached for the suspension pair"),
    }
}

/// A shared field read, with its arms spelled out.
///
/// The arms are printed because they are the op's content: a reader checking
/// that the lowering established the precondition needs to see *which* types it
/// claimed agree, and a backend that emits a test chain walks exactly this list
/// in exactly this order.
fn render_shared_field(
    index: usize,
    value: nts_core::hir::ValueId,
    arms: &[nts_semantic_schema::TypeId],
    field: u32,
    ty: &str,
) -> String {
    let arms = arms
        .iter()
        .map(|arm| format!("obj{}", arm.0))
        .collect::<Vec<_>>()
        .join(" | ");
    format!("%{index} = field.get.shared %{}.{field} over {arms} : {ty}", value.0)
}

#[allow(clippy::too_many_lines)] // One exhaustive HIR rendering dispatch.
fn render_op(index: usize, op: &nts_core::hir::Op) -> String {
    let ty = render(&op.ty);
    match &op.kind {
        OpKind::NativeLoad { pointer, index: offset } => format!("%{index} = native.load %{}[%{}] : {ty}", pointer.0, offset.0),
        OpKind::NativeLocal { count } => format!("%{index} = native.local {count} : {ty}"),
        OpKind::NativeMalloc { bytes } => format!("%{index} = native.malloc %{} : {ty}", bytes.0),
        OpKind::NativeFree { pointer } => format!("native.free %{}", pointer.0),
        OpKind::NativeCopy { destination, source } => {
            format!("native.copy %{} <- %{}", destination.0, source.0)
        }
        OpKind::NativeBridge { closure, signature } => {
            format!("%{index} = native.bridge %{} as {} : {ty}", closure.0, signature.name)
        }
        OpKind::NativeIndexAddress { pointer, index: offset } => format!("%{index} = native.index.addr %{}[%{}] : {ty}", pointer.0, offset.0),
        OpKind::NativeFieldAddress { pointer, field } => format!("%{index} = native.field.addr %{}.{field} : {ty}", pointer.0),
        OpKind::NativeBitLoad { pointer, field } => format!("%{index} = native.bit.load %{}.{field} : {ty}", pointer.0),
        OpKind::NativeBitStore { pointer, field, value } => format!("native.bit.store %{}.{field} = %{}", pointer.0, value.0),
        OpKind::NativeStore { pointer, index, value } => format!("native.store %{}[%{}], %{}", pointer.0, index.0, value.0),
        OpKind::Param(n) => format!("%{index} = param {n} : {ty}"),
        OpKind::BlockParam(n) => format!("%{index} = blockparam {n} : {ty}"),
        OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstString(_)
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ClosureStatic => render_constant(index, &ty, &op.kind),
        OpKind::InstanceOf { value, classes } => format!(
            "%{index} = instanceof %{} against {} class(es) : {ty}",
            value.0,
            classes.len()
        ),
        OpKind::Erase { value } | OpKind::TagOf { value } | OpKind::Unerase { value } => {
            render_erasure(index, &ty, &op.kind, *value)
        }
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
        OpKind::SharedFieldGet { value, arms, field } => {
            render_shared_field(index, *value, arms, *field, &ty)
        }
        OpKind::FieldSet {
            object,
            field,
            value,
        } => format!("field.set %{}.{field} = %{}", object.0, value.0),
        OpKind::CellReady { cell, name } => {
            format!("cell.ready %{} `{name}`", cell.0)
        }
        OpKind::ArrayGet { .. } | OpKind::ArraySet { .. } => {
            render_element(index, &ty, &op.kind)
        }
        OpKind::Await { .. } | OpKind::Yield { .. } | OpKind::Suspend { .. } => {
            suspension(index, op)
        }
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
    let tsgo_binary = frontend_binary();
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;
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
fn write_standalone(
    program: &hir::Program,
    out: &Utf8Path,
    sources: &[&str],
    linking: bool,
    witness: bool,
    declined: &[String],
) -> Result<()> {
    // A program that is only declarations has nothing to evaluate, and calling
    // a function that was never emitted is a link error.
    //
    // **The HIR having it is not the same as the backend emitting it.** This
    // asked `program.funcs` alone, and an emitter *decline* -- `NTS2008`, a
    // value the C backend cannot erase yet -- removes the body afterwards. So
    // `main.c` declared `module__init`, called it, and nothing defined it:
    //
    //     const m = new Map<string, bigint>();   // NTS2008 on the erase
    //     main.c:(.text+0x12): undefined reference to `module__init'
    //
    // `emit-c` printed the decline on stderr and **exited 0**, having written a
    // program that cannot link. `Emitted::refused` exists for exactly this
    // question -- "did the body get emitted" -- and its doc records the same
    // failure for the Node-API wrapper, which was taught to consult it. The
    // executable path was not, so the story happened a second time one output
    // over.
    let initializes = program
        .funcs
        .iter()
        .any(|func| func.name == hir::lower::MODULE_INIT)
        && !declined.iter().any(|name| name == hir::lower::MODULE_INIT);
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
    // Named here for the reason the library path names it: it is the only
    // output whose value depends on a consumer choosing to include it, and an
    // artifact nobody is told about reads, later, as one that was never
    // generated. This path wrote it and did not say so.
    //
    // It is written whenever a *reachable* native binding exists, which is not
    // the same as the program having one: with `--main` a module's exports are
    // not roots, so a library-shaped program built as an executable prunes every
    // binding and needs no witness. That difference looked like `--main`
    // suppressing it until a program that calls one at top level said otherwise.
    println!(
        "wrote program.c, main.c, {}, {}, {}{} to {out}",
        sources.join(", "),
        nts_codegen_c::UV_HOST_HEADER_NAME,
        nts_codegen_c::UV_HOST_SOURCE_NAME,
        if witness { format!(", {}", nts_codegen_c::NATIVE_WITNESS_NAME) } else { String::new() },
    );
    // Every translation unit the program needs, which is not a fixed list: a
    // program that converts case gets `nts_unicode.c` too, and printing a
    // command that omits it is printing a link error.
    //
    // `--gc-sections` is not a micro-optimisation here. The Unicode tables are
    // one library's worth of data of which a program uses the part it calls,
    // and the linker is what knows which part: measured on a program that
    // converts case, the tables cost 81 KB linked whole and 10 KB after
    // stripping. The same flags take a `hello` with no Unicode at all from
    // 81 KB to 16 KB, because most of the runtime is unreachable from any one
    // program too.
    if !linking {
        println!(
        "  cc -std=c11 -O2 -ffunction-sections -fdata-sections -Wl,--gc-sections \\\n     -I. main.c program.c {} {} -luv -lm -o program",
        sources.join(" "),
        nts_codegen_c::UV_HOST_SOURCE_NAME
        );
    }
    Ok(())
}

/// Lower a project and print the C it becomes.
/// `nts emit-llvm <tsconfig>` — the same program, rendered as LLVM IR.
///
/// Prints rather than writes: the slice it renders is scalar, so there is no
/// runtime to place beside it yet and a file would suggest otherwise.
/// What this build is producing.
///
/// **One value, computed once, because it was four reads of
/// `std::env::args()`.** `--main` was asked in `selected_roots`, again in
/// `configured_surface`, and again in `emit_c` -- where it decided both which
/// functions survive and whether to write a `main()`. `--napi` was a fourth. A
/// question asked in four places is four places to answer it differently, which
/// is how `emit-c` came to accept `--entry` and ignore it.
///
/// It also gives a configured product somewhere to say the same thing. A
/// `node-addon` product *is* `--napi` and an `application` *is* `--main`, so
/// `nts build` does not synthesize flags to pass to itself.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Shape {
    /// A program with an entry point: module evaluation, then the loop.
    Executable,
    /// A Node addon: a library to its host, published through Node-API.
    Addon,
    /// A library, or a bare emit that claims to be neither.
    Library,
}

impl Shape {
    /// From the command line, which is what a bare `emit-*` has to go on.
    fn from_flags() -> Self {
        let args: Vec<String> = std::env::args().collect();
        if args.iter().any(|arg| arg == "--main") {
            Self::Executable
        } else if args.iter().any(|arg| arg == "--napi") {
            Self::Addon
        } else {
            Self::Library
        }
    }

    /// From a configured product's kind, which is the same claim written down.
    fn of(kind: &str) -> Self {
        match kind {
            "application" | "executable" => Self::Executable,
            "node-addon" => Self::Addon,
            _ => Self::Library,
        }
    }
}

/// `nts build [<project>] [--product <name>]` — every artifact the config declares.
///
/// **The command that was missing.** `nts` had seventeen subcommands and none of
/// them built anything: `emit-c` wrote C, and then twenty-two hand-written
/// `build.sh` in this tree each reconstructed the rest of the pipeline. A person
/// had to know which emitter their target wanted, that `--napi` goes with a Node
/// addon and `--main` with a program, and which compiler flags come next. Every
/// one of those is written down in `nts.config.ts` already.
///
/// So this asks the config and nothing else. The backend comes from the target,
/// the shape from the product's kind, the surface from its entry. There are no
/// flags to get right because there is nothing left for a flag to say.
///
/// **Refuses by name.** A target whose backend cannot yet write a program is
/// named, with the backend, rather than skipped -- a build that silently omits
/// one of three targets is worse than one that stops, because the missing
/// artifact is discovered by whoever links against it.
fn build(rest: &[String]) -> Result<()> {
    let tsconfig = project(rest)?;
    let Some(config_path) = nts_build::config::beside(&tsconfig) else {
        bail!(
            "no `{}` beside {tsconfig}. `nts build` builds what a config declares; \
             without one there is nothing that says what the artifacts are",
            nts_build::config::FILE_NAME
        )
    };
    let resolved = nts_build::config::resolve(&config_path)?;
    let chosen = chosen_products(&resolved)?;
    if chosen.is_empty() {
        // **A package is not nothing to build.** It contributes sources to its
        // consumers, and if any of them import a `c:` module it cannot
        // typecheck on its own until the binding exists -- which made every
        // package with native code uncheckable in isolation, in an editor or in
        // `tsc -b`. Generating them is the build this project has.
        //
        // Into the package, because here the package *is* the project. That is
        // the same rule as everywhere else rather than an exception to it.
        let ids: Vec<String> = resolved.targets.clone().unwrap_or_default();
        if resolved.native.iter().any(|entry| entry.header.is_some()) && !ids.is_empty() {
            generate_bindings(&tsconfig, &ids)?;
            println!("{config_path} declares no products; bound what its sources import");
            return Ok(());
        }
        bail!(
            "{config_path} declares no products. A package that only contributes \
             sources to its consumers has nothing of its own to build"
        )
    }

    let root = output_root(rest, &tsconfig);
    refuse_unwritable_integrations(&resolved)?;
    let only_os = rest
        .windows(2)
        .find(|pair| pair[0] == "--os")
        .map(|pair| pair[1].clone());
    let cache_dir = cache_directory(&tsconfig, &resolved);
    let mut built = 0usize;
    let mut refused = 0usize;
    for (name, product) in chosen {
        if product.targets.is_empty() {
            bail!("product `{name}` names no targets, so there is nothing to build it for")
        }
        let emission =
            Emission { shape: Shape::of(&product.kind), product: Some((name, product)), linking: true };
        for target in targets_for(name, product, only_os.as_deref())? {
            // **Before anything is written.** A kind whose packaging does not
            // exist would otherwise emit, compile, and produce a file of the
            // wrong format under the right name -- an `aar` product built a
            // `.jar`, which Gradle cannot resolve and which a reader has no
            // reason to doubt. Refusing after the output directory exists is
            // also worse than refusing before it.
            refuse_unpackaged(name, &product.kind, target)?;
            // **Before the emitter, not before the packager.** The SDK is the
            // one input to an APK that a machine can simply not have, and
            // discovering that after a full compile and a packaged jar spends
            // the whole build to deliver a message that was available in a
            // `stat`. It is also what makes the refusal testable: with no SDK
            // the run has to fail *here*, and it used to fail one step later
            // inside `jar`, reporting nothing.
            //
            // **Keyed on the OS and not on the backend**, which is the bug the
            // first version shipped: `target.jvm({ release: 17 })` is an
            // ordinary desktop program on the same backend, and it was sent
            // down this path and told to run `sdkmanager "platforms;java-17"`.
            // An APK is a property of Android, not of the JVM.
            let android = (target.os == "android"
                && matches!(product.kind.as_str(), "application" | "executable"))
            .then(|| android_sdk(name, target))
            .transpose()?;
            // **Declarations before bodies.** A `c:` module the program imports
            // has no `.d.ts` until one is generated from the header a config
            // names, and the program does not typecheck without it -- so this
            // runs before the emitter sees anything.
            //
            // Skipped entirely unless some config in the project declares a
            // header, which is every project with no native code: the check is a
            // `stat` and the snapshot it would otherwise cost is not taken.
            // A cheap guard on an expensive step: generating bindings needs a
            // snapshot, and taking one to find there is no native code anywhere
            // would put a frontend run on every build in the tree. Read from the
            // config this command already resolved rather than resolving it
            // again, which would be a second `node` for the same answer.
            //
            // **A workspace member counts too, and not because of its own
            // config.** An app declaring no native code can still import a
            // package that does -- `apps/native` has no `native:` and its
            // program contains `crypto-core`'s `c:digest`.
            // **Any native root, not only one with a header.** A header is what
            // a *binding* needs; a `.c` beside it is compiled either way, and
            // its directory is on the include path the witness uses. Gating on
            // the header meant `native-copy` -- which declares `sources({ dir })`
            // and no header -- had neither, and its witness failed to find
            // `point.h` for a reason that is not what a witness checks.
            //
            // **Unconditional, and it took three narrowings to get here.** This
            // was gated on the project declaring native code, then on that or
            // being in a workspace, then on either or targeting the JVM -- each
            // widening prompted by finding something the narrower rule had been
            // silently dropping: a package's Java, its manifest fragment, and
            // finally its `targets` claim.
            //
            // The claim is what settles it. A package declaring what it
            // supports exists so a consumer outside that set fails *here*
            // rather than at link time with a missing symbol, and a heuristic
            // deciding whether to look means the refusal does not fire for a
            // whole class of project. A correctness refusal that runs only
            // sometimes is worth less than what the gate costs.
            //
            // **It cost a second `tsgo` snapshot, and then it did not.** This
            // comment said "+0.15s, 0.26 to 0.41 ... the fix that makes it free
            // is one snapshot handed to both this and the emitter; priced, not
            // built" -- and both halves were falsified an hour later by the
            // author of the sentence. The fix was not threading a snapshot: it
            // was that `nts build` had been walking past
            // `nts_frontend_ts::cache::snapshot` at all twelve of its call
            // sites, so the second snapshot is now a cache hit and the number
            // measured the wrong thing.
            //
            // Controlled with `NTS_NO_SNAPSHOT_CACHE=1` on one binary,
            // alternating on warm state: **0.26s with the cache, 1.5s without**.
            //
            // **That number stopped being true for six hours and nothing said
            // so.** Canonicalising the cache key moved one of two derivations
            // of the config chain and not the other, so no entry ever matched
            // and the cache was dead. `cache.rs` owns the current figure and
            // the argument; this comment is the date-stamped one above and is
            // kept for what it records rather than as a claim about today.
            // A number in a comment is a claim with a date on it; this one had
            // no date and outlived the code it described by one commit.
            let config_roots = generate_bindings(&tsconfig, std::slice::from_ref(&target.id))?;
            let native = native_sources(&config_roots, target)?;
            // **At configuration time, naming the package**, which is the whole
            // point of a package declaring what it supports: the alternative is
            // a link error about a symbol, in a file the reader did not write,
            // for a platform the package never claimed.
            refuse_unclaimed_target(name, &config_roots, target, &tsconfig)?;
            // **The toolchain before the dependencies**, because a machine
            // that cannot build for this target at all is the fact to act on.
            //
            // `apps/ios` reported that `packages/notifications` declares a
            // SwiftPM claim this cannot read -- true, and not the reason the
            // build was never going to work on Linux, which is that there is no
            // Apple SDK here. The dependency refusal was standing in front of
            // it. Asking first costs one `zig version` on a cross build and
            // returns the same answer `link_c` will get.
            if target.backend == "c" {
                toolchain_for(name, target)?;
            }
            // **Before the output directory is announced**, because an
            // unsatisfiable claim is a configuration error and printing
            // `building ...` first says a build started that never could.
            let needs = dependencies_for(&config_roots, target)?;
            let out = root.join(name).join(target_directory(target));
            println!("building `{name}` for {} into {out}", target.id);
            // A claim that contributes nothing to link against still says so,
            // because a resolver nobody read looks exactly like one that
            // resolved to nothing.
            for note in &needs.notes {
                println!("  {note}");
            }
            match target.backend.as_str() {
                "c" => {
                    refused += build_c(
                        name,
                        product,
                        &out,
                        target,
                        &tsconfig,
                        emission,
                        &native,
                        cache_dir.as_deref(),
                        &needs,
                    )?;
                }
                "jvm" => build_jvm(
                    name,
                    product,
                    &out,
                    target,
                    &tsconfig,
                    emission,
                    &config_roots,
                    android.as_ref(),
                    &needs,
                )?,
                // Named rather than skipped. `emit-llvm` renders to stdout
                // because its slice is scalar and there is no runtime to place
                // beside it, so there is nothing here to write yet.
                "llvm" => bail!(
                    "product `{name}` targets {} on the llvm backend, which cannot write a \
                     program yet -- `nts emit-llvm` renders to stdout. Build it on the c \
                     backend, or wait for the llvm lane to grow an `--out`",
                    target.id
                ),
                other => bail!("product `{name}` names backend `{other}`, which is not one of c, llvm, jvm"),
            }
            built += 1;
        }
    }
    // **After the artifacts, because a hook names them.** The `CMake` package
    // points at paths this loop just produced, and emitting it first would
    // write a file describing an artifact that might never have appeared.
    emit_integrations(&resolved, &tsconfig, &root)?;
    if refused > 0 {
        println!("{built} artifact(s) under {root}, missing {refused} refused function(s)");
    } else {
        println!("{built} artifact(s) under {root}");
    }
    Ok(())
}

/// A `c:` module a program imports and nothing declares, and the file wanting it.
///
/// **From the checker's own diagnostics**, which is the only thing that knows
/// what failed to resolve. A scan of the sources for `from "c:..."` would answer
/// a different question -- what the text contains -- and would find specifiers
/// in comments and strings, and miss nothing being wrong with them.
///
/// `TS2307` is the code and the module is the quoted half of its message. Both
/// are the checker's, not ours, which is the cost: a message reworded upstream
/// is a binding silently not generated. The floor against that is the build
/// failing on the same unresolved import afterwards, which is what happened
/// before any of this existed.
fn unresolved_foreign(
    snapshot: &nts_semantic_schema::SemanticSnapshot,
) -> Vec<(String, Utf8PathBuf)> {
    let mut wanted = Vec::new();
    for diagnostic in &snapshot.diagnostics {
        if diagnostic.code != "TS2307" {
            continue;
        }
        let Some(module) = diagnostic.message.split('\'').nth(1) else { continue };
        if !module.starts_with("c:") {
            continue;
        }
        let Some(source) = snapshot.sources.get(diagnostic.primary.file.0 as usize) else {
            continue;
        };
        let at = Utf8PathBuf::from(source.display_path.as_str());
        if !wanted.iter().any(|(m, f): &(String, Utf8PathBuf)| m == module && f == &at) {
            wanted.push((module.to_owned(), at));
        }
    }
    wanted
}

/// The names a file imports from one module.
///
/// **The import list is the binding's surface.** `nts bind-c` binds nothing
/// unless told what -- `--module` alone produces `declare module "c:digest" {}`
/// -- and the program has already said: `import { digest32 } from "c:digest"`
/// names the module and the function in one statement, which is where a reader
/// looks anyway. A config field repeating it would be the duplicate this lane
/// keeps deleting.
///
/// Type-only imports are separated because they are records rather than
/// functions, and `nts bind-c` takes them as `--record`.
fn imported_names(file: &Utf8Path, module: &str) -> Result<(Vec<String>, Vec<String>)> {
    let text = std::fs::read_to_string(file).with_context(|| format!("reading {file}"))?;
    let mut values = Vec::new();
    let mut types = Vec::new();
    for statement in text.split("import ").skip(1) {
        let Some((clause, rest)) = statement.split_once(" from ") else { continue };
        let Some(spelled) = rest.split(['"', '\'']).nth(1) else { continue };
        if spelled != module {
            continue;
        }
        let type_only = clause.trim_start().starts_with("type ");
        let Some(braced) = clause.split_once('{').and_then(|(_, r)| r.split_once('}')) else {
            continue;
        };
        for name in braced.0.split(',') {
            let name = name.trim();
            let (kind, name) = match name.strip_prefix("type ") {
                Some(rest) => (true, rest.trim()),
                None => (type_only, name),
            };
            // `a as b` renames on import; the binding is asked for `a`.
            let name = name.split_whitespace().next().unwrap_or(name);
            if name.is_empty() {
                continue;
            }
            if kind { &mut types } else { &mut values }.push(name.to_owned());
        }
    }
    if values.is_empty() && types.is_empty() {
        bail!(
            "`{file}` imports from `{module}` and this could not read which names. \
             The import list is what a binding is generated from"
        )
    }
    Ok((values, types))
}

/// Generate the bindings a program's `c:` imports need, before it is compiled.
///
/// This is the first phase of the order `docs/nts-config.md` describes and the
/// config's own comments argue for: **declarations before bodies.** Bind the
/// native declarations, then typecheck and emit against them, then compile the
/// native sources. Mutual recursion resolves the same way and for the same
/// reason.
///
/// Returns how many were written. Nothing to do is the overwhelmingly common
/// case and costs one snapshot, taken only when a config nearby declares a
/// header at all.
/// `targets` is a set rather than one, because a package is built for all of
/// them at once: `notifications` declares five, and the header for
/// `c:notifications` exists under exactly one. Refusing per target reported "0
/// native roots with a header for android-29" for a module only `linux.ts`
/// imports, which is a true sentence about the wrong question.
fn generate_bindings(tsconfig: &Utf8Path, targets: &[String]) -> Result<Vec<Utf8PathBuf>> {
    let tsgo_binary = frontend_binary();
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    // Errors are the point of this snapshot, so they are not reported here.
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;
    let project = tsconfig.parent().unwrap_or_else(|| Utf8Path::new("."));
    let wanted = unresolved_foreign(&snapshot);
    // Every package the program's files belong to, whether or not it needed a
    // binding: a package can contribute native code that only the C side calls
    // -- a callback implementation -- and that still has to be compiled in.
    let mut roots: Vec<Utf8PathBuf> = Vec::new();
    for source in &snapshot.sources {
        let file = Utf8PathBuf::from(source.display_path.as_str());
        if let Some(config) = nts_build::config::above(&file)
            && !roots.contains(&config)
        {
            roots.push(config);
        }
    }
    for (module, file) in wanted {
        bind_one(&module, &file, targets, project)?;
    }
    Ok(roots)
}

/// Generate one binding: the module a file imports, from the header its package
/// names.
fn bind_one(module: &str, file: &Utf8Path, targets: &[String], into: &Utf8Path) -> Result<()> {
    {
        // **`c:types` is the compiler's, and no header declares it.** It holds
        // the scalar brands -- `c_int`, `c_uint32`, `c_double` -- that say how a
        // TypeScript number crosses to C, and every generated binding imports
        // from it. Binding it from a package's header is the wrong question, and
        // asking it produced `no complete definition of \`c_uint32\` in these
        // headers`: a true sentence naming something the reader cannot act on,
        // about a module their package was never supposed to declare.
        //
        // The fix is a path, so the message is the path. Nothing distributes
        // this file yet -- every tsconfig in the tree that uses a `c:` module
        // lists it by hand -- which is a gap in its own right, and naming it
        // here is the least this can do until it closes.
        if module == C_BRANDS {
            bail!(
                "`{file}` imports `{C_BRANDS}`, which is the compiler's scalar brand \
                 module rather than one a package declares -- so no header can define \
                 it. Add `runtime/native/libc.d.ts` to this project's tsconfig, in \
                 `files` or `include`, the way every other `c:` consumer in the tree \
                 does"
            )
        }
        let Some(config_path) = nts_build::config::above(file) else {
            bail!(
                "`{file}` imports `{module}` and there is no `{}` above it to say which \
                 header declares it",
                nts_build::config::FILE_NAME
            )
        };
        let package = config_path.parent().unwrap_or_else(|| Utf8Path::new("."));
        let resolved = nts_build::config::resolve(&config_path)?;
        let headers: Vec<&nts_build::config::NativeSources> = resolved
            .native
            .iter()
            .filter(|entry| {
                // **No floor, because there is no consumer here.** These are
                // the package's own declared ids, bound so it typechecks in
                // isolation; the id is both the surface and the floor.
                entry.header.is_some() && targets.iter().any(|id| entry.covers(id, None))
            })
            .collect();
        let [entry] = headers.as_slice() else {
            bail!(
                "`{module}` is imported by `{file}` and {config_path} declares {} native \
                 root(s) with a header for {}. One is a binding; several is a question \
                 only the config can answer",
                headers.len(),
                targets.join(", ")
            )
        };
        let header = package.join(entry.header.as_deref().unwrap_or_default());
        let (values, types) = imported_names(file, module)?;
        // **Into the project being built, not into the package.** The binding
        // is an artifact of *this* build: writing it under a dependency would
        // mutate somebody else's source tree, and the app's program does not
        // reach there anyway -- it resolves the package through `paths` and its
        // own `include` is what governs. Two apps depending on one package each
        // get their own, which is what self-contained means.
        let out = into.join("types").join(format!("{}.d.ts", module.replace([':', '/'], "-")));
        std::fs::create_dir_all(out.parent().unwrap_or(into))
            .with_context(|| format!("creating {out}"))?;
        let mut command = std::process::Command::new(std::env::current_exe()?);
        command.arg("bind-c").arg("--module").arg(module);
        command.arg("--header").arg(header.as_str());
        for name in &values {
            command.arg("--fn").arg(name);
        }
        for name in &types {
            command.arg("--record").arg(name);
        }
        // **The package's own dependency claims reach the header too.** A
        // header that includes `<gtk/gtk.h>` is only readable with gtk4's
        // `--cflags`, which the program's compile gets from the same claim --
        // so without them this read a header the build could compile and
        // reported that clang could not.
        for id in targets {
            let claimed = nts_build::dependencies::resolve(package, &resolved.dependencies, id, None)
                .with_context(|| format!("resolving the dependencies `{config_path}` declares"))?;
            for flag in claimed.cflags {
                command.arg("--clang").arg(flag);
            }
        }
        command.arg("--out").arg(out.as_str());
        let output = command.output().context("running `nts bind-c`")?;
        if !output.status.success() {
            bail!(
                "generating the binding for `{module}` failed:\n{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        println!("  bound {module} from {} into {out}", entry.header.as_deref().unwrap_or_default());
    }
    Ok(())
}

/// Every native source a program's packages contribute, for one target.
///
/// `sources({ dir })` is a directory of C that belongs to a package, and the
/// package's own config is what says so. A `.c` in it is a translation unit like
/// any other -- the difference is only that a person wrote it.
fn native_sources(
    roots: &[Utf8PathBuf],
    target: &nts_build::config::Target,
) -> Result<Vec<(Utf8PathBuf, Utf8PathBuf)>> {
    let mut found = Vec::new();
    for config_path in roots {
        let package = config_path.parent().unwrap_or_else(|| Utf8Path::new("."));
        let Ok(resolved) = nts_build::config::resolve(config_path) else { continue };
        for entry in &resolved.native {
            if !entry.covers(&target.id, target.minimum_version.as_deref()) {
                continue;
            }
            let directory = package.join(&entry.dir);
            let Ok(listing) = std::fs::read_dir(&directory) else { continue };
            for item in listing.flatten() {
                let path = Utf8PathBuf::from_path_buf(item.path())
                    .map_err(|bad| anyhow!("{} is not UTF-8", bad.display()))?;
                if path.extension() == Some("c") {
                    found.push((directory.clone(), path));
                }
            }
        }
    }
    found.sort();
    Ok(found)
}

/// Emit, package and report one JVM product.
///
/// Lifted out of `build` rather than inlined there because the three JVM kinds
/// diverge after packaging while the C ones do not -- and a `match` inside a
/// `match` inside the product-and-target loop reads as one shape when it is
/// two.
#[allow(clippy::too_many_arguments)]
fn build_jvm(
    name: &str,
    product: &nts_build::config::Product,
    out: &Utf8Path,
    target: &nts_build::config::Target,
    tsconfig: &Utf8Path,
    emission: Emission<'_>,
    config_roots: &[Utf8PathBuf],
    sdk: Option<&AndroidSdk>,
    needs: &nts_build::dependencies::Resolution,
) -> Result<()> {
    let initializes = emit_jvm(tsconfig, Some(out), false, emission)?;
    // **Compiled before the classes are packaged, because the artifact would
    // not say it was missing.** A JVM target's `native:` roots are Java, and
    // they are the half the program calls into -- an artifact built without
    // them links and then dies at the first call across the boundary with a
    // `NoClassDefFoundError`.
    //
    // It reads the *declared* roots and not `native_sources`, which collects
    // `.c` files: a package contributing a directory of Java produces an empty
    // list there and reads as having no native code at all.
    let java = compile_java_roots(name, config_roots, target, sdk, out, &needs.classpath)?;
    if !java.is_empty() {
        println!("  compiled {} Java package(s) in: {}", java.len(), java.join(", "));
    }
    let classes = package_jvm(name, product, out, &java)?;
    match product.kind.as_str() {
        // **An AAR carries its dependencies in `libs/`, an APK dexes them in.**
        // Both were refused this morning on the argument that no fixture in the
        // tree has a runtime-scoped pin, so the packaging would be untested --
        // which was true of the *fixtures* and not of the *tools*: `d8` is here
        // and a real jar is buildable, so the path can be exercised for real.
        // A refusal kept because the inputs were hard to make is a different
        // thing from one kept because the output cannot be checked.
        "aar" => {
            println!(
                "  {}",
                package_aar(name, product, out, &classes, target, tsconfig, &needs.classpath)?
            );
            if !needs.classpath.is_empty() {
                println!("  with {} pinned jar(s) in libs/", needs.classpath.len());
            }
        }
        // **Not every JVM application is an APK.** `t.android` and `t.jvm` are
        // the same backend and different platforms, and only one of them has a
        // container that needs an SDK.
        "application" | "executable" if target.os != "android" => {
            println!(
                "  {}",
                package_runnable_jar(name, out, &classes, initializes, &needs.classpath)?
            );
            if !needs.classpath.is_empty() {
                println!("  with {} pinned dependency jar(s) inside it", needs.classpath.len());
            }
        }
        "application" | "executable" => {
            let sdk = sdk.expect("an APK's SDK is resolved before the emitter runs");
            println!(
                "  {}",
                package_apk(
                    name,
                    product,
                    out,
                    &classes,
                    target,
                    tsconfig,
                    sdk,
                    config_roots,
                    &needs.classpath,
                )?
            );
            if !needs.classpath.is_empty() {
                println!("  with {} pinned jar(s) dexed into it", needs.classpath.len());
            }
            println!(
                "  signed with the debug key at {}, which is not a release key",
                out.join("debug.keystore")
            );
            // **Said because the directory name implies otherwise.** A product
            // declaring `arch: ["aarch64", "armv7"]` gets one build per target
            // and, with no native code in it, the two dex files are byte for
            // byte the same -- checked, not assumed. Per-ABI APKs exist to
            // carry `lib/<abi>/`, and an APK that carries none is one program
            // under two names. A JVM target whose packages declare native
            // roots refuses above, so today that is every APK this builds.
            println!("  no native libraries, so every `arch` of it is the same program");
        }
        _ => {
            println!("  {classes}");
            println!("  {}", out.join(RUNTIME_JAR));
        }
    }
    Ok(())
}

/// Emit, compile and link one product on the C backend, and say what it lost.
///
/// Returns the number of functions the lowering refused, which the caller adds
/// to the build's running total.
///
/// **Lifted out of `build` because that function passed a hundred lines**, and
/// the half that came out is the half with a backend in it -- deciding *which*
/// products and targets to build is a different job from rendering one of them.
#[allow(clippy::too_many_arguments)]
fn build_c(
    name: &str,
    product: &nts_build::config::Product,
    out: &Utf8Path,
    target: &nts_build::config::Target,
    tsconfig: &Utf8Path,
    emission: Emission<'_>,
    native: &[(Utf8PathBuf, Utf8PathBuf)],
    cache_dir: Option<&Utf8Path>,
    needs: &nts_build::dependencies::Resolution,
) -> Result<usize> {
    let wrote = emit_c(tsconfig, Some(out), emission)?;
    let artifact = link_c(name, product, out, &wrote, native, cache_dir, target, needs)?;
    println!("  {artifact}");
    // Named here as well as on stderr, because a build whose last line is
    // `1 artifact(s)` has told the reader the opposite of what happened.
    if wrote.refused > 0 {
        println!(
            "  {} function(s) refused and are absent from it; each is named above",
            wrote.refused
        );
    }
    Ok(wrote.refused)
}

/// libuv is the *program's* dependency, and a cross build rarely has one.
///
/// A program that awaits anything links the libuv host, and libuv is a system
/// library rather than something this repository vendors. On the host that is
/// fine -- every machine building this has one. Cross-compiling to Windows with
/// `zig cc` does not: zig bundles a libc for the target and nothing else, so
/// the build died on `fatal error: 'uv.h' file not found`, which names a file
/// rather than a dependency and says nothing about what to do.
///
/// **Asked rather than assumed, because the triple does not answer it.** A
/// machine *with* a Windows libuv on its include path should build, and a rule
/// keyed on "is this a cross build" would refuse it. So this compiles a
/// two-line translation unit and reports what the target's own compiler says --
/// the same shape as the measurement that produced the Apple refusal above.
///
/// Only on a cross build: a host missing libuv fails at `-luv` with a message
/// that already names it, and a probe on every build would be a compile nobody
/// asked for.
fn refuse_without_libuv(
    name: &str,
    out: &Utf8Path,
    tools: &Toolchain,
    target: &nts_build::config::Target,
    native: &[(Utf8PathBuf, Utf8PathBuf)],
    napi: Option<&Utf8Path>,
    cflags: &[String],
) -> Result<()> {
    if is_host(target) {
        return Ok(());
    }
    let probe = out.join("nts_libuv_probe.c");
    std::fs::write(&probe, "#include <uv.h>\nint nts_libuv_probe(void) { return 0; }\n")
        .with_context(|| format!("writing {probe}"))?;
    let object = out.join("nts_libuv_probe.o");
    let mut command = tools.command();
    // **The same include path the compile will use**, or this asks a narrower
    // question than the one that matters and refuses a build that would have
    // worked.
    command.args(program_includes(out, native, napi, cflags));
    // **A real compile, not `-fsyntax-only`.** `zig cc` does not honour that
    // flag -- it reports `error: FileNotFound` against line 1 column 1 whatever
    // the file says, so the probe failed identically whether or not `uv.h` was
    // reachable. A check whose answer does not depend on its input is not a
    // check, and this one was written for the toolchain it does not work under:
    // every cross build reaching it was refused, and the test could not see it
    // because a test asserting a refusal passes for a probe that always
    // refuses. Compiling a two-line unit to an object costs the same and
    // discriminates.
    command.args(["-c", probe.as_str(), "-o", object.as_str()]);
    let asked = command.output().with_context(|| {
        format!("asking the compiler for {} whether libuv is available", target.id)
    })?;
    let _ = std::fs::remove_file(&probe);
    let _ = std::fs::remove_file(&object);
    if asked.status.success() {
        return Ok(());
    }
    // **Says what it measured.** It said "libuv is not available", and what it
    // established is that `uv.h` is not reachable. The distinction earns its
    // words: a header without a library fails later at `-luv`, and the advice
    // below -- install one, put its headers on the path -- is wrong in its first
    // clause for that case. Two failure modes with two messages is the right
    // answer rather than a compromise, provided a reader can tell them apart.
    bail!(
        "product `{name}` targets {} and is built as an executable, so it links the \
         libuv host -- and `uv.h` is not reachable when compiling for {}. libuv is the \
         program's dependency rather than this compiler's: install one built for {}, \
         put its headers on the include path, declare it as a `dependencies` claim, or \
         set CC to a cross compiler that has one. Building on {} itself needs none of \
         that.",
        target.id,
        target.id,
        target.id,
        target.os
    )
}

/// Everywhere a translation unit of the generated program looks for a header.
///
/// **One derivation, because a guard computing its own was the bug.**
/// `refuse_without_libuv` probed for `uv.h` with a bare command while the real
/// compile added the output directory, every native root, the Node-API headers
/// and a dependency's `--cflags` -- so a libuv arriving through any of those was
/// invisible to the probe, and it would have refused a build that was going to
/// work. That is exactly the case its own comment says it exists to permit.
///
/// The output directory first: the emitter writes `nts_uv_host.h` and the
/// program's own headers there. Then the package's headers, because the
/// *generated* program includes them too -- a binding over `point.h` lowers to
/// `#include "point.h"`.
fn program_includes(
    out: &Utf8Path,
    native: &[(Utf8PathBuf, Utf8PathBuf)],
    napi: Option<&Utf8Path>,
    cflags: &[String],
) -> Vec<String> {
    let mut flags = vec!["-I".to_owned(), out.to_string()];
    for (directory, _) in native {
        flags.push("-I".to_owned());
        flags.push(directory.to_string());
    }
    if let Some(napi) = napi {
        flags.push("-I".to_owned());
        flags.push(napi.to_string());
    }
    flags.extend(cflags.iter().cloned());
    flags
}

/// The compiler, and what every translation unit is compiled with.
///
/// **A bundle rather than three more parameters.** `cache`, `tools` and
/// `cflags` travel together to every compile in this file and answer one
/// question between them -- which compiler, with which flags, reusing which
/// objects. They were passed separately until a dependency's include path made
/// it three, at which point the count was the signal rather than the cause.
struct Compiling<'a> {
    cache: &'a ObjectCache,
    tools: &'a Toolchain,
    /// A resolved dependency's include paths. Empty when nothing is claimed.
    cflags: &'a [String],
}

/// Compile the translation units the emitter wrote.
///
/// Lifted out of `link_c` because that function was over a hundred lines and
/// clippy says so: deciding *what* to compile and deciding *how to link it* are
/// two steps, and the flags below belong to the first.
#[allow(clippy::too_many_arguments)]
fn compile_program(
    name: &str,
    out: &Utf8Path,
    sources: &[String],
    native: &[(Utf8PathBuf, Utf8PathBuf)],
    pic: bool,
    napi: Option<&Utf8Path>,
    with: &Compiling<'_>,
    objects: &mut Vec<Utf8PathBuf>,
) -> Result<()> {
    for source in sources {
        let object = out.join(format!("{source}.o"));
        // `--gc-sections` is not a micro-optimisation, and the numbers are
        // `write_standalone`'s own: the Unicode tables are one library's worth
        // of data of which a program uses the part it calls, and the linker is
        // what knows which part. Measured there at 81 KB linked whole against
        // 10 KB after stripping, and a `hello` with no Unicode at all from
        // 81 KB to 16 KB, because most of the runtime is unreachable from any
        // one program. It needs the two `-f` flags at compile time to have
        // sections to drop.
        let mut arguments: Vec<String> =
            ["-std=c11", "-O2", "-ffunction-sections", "-fdata-sections"]
                .iter()
                .map(|flag| (*flag).to_owned())
                .collect();
        if pic {
            arguments.push("-fPIC".to_owned());
        }
        arguments.extend(program_includes(out, native, napi, with.cflags));
        let from = out.join(source);
        arguments.extend(["-c".to_owned(), from.to_string(), "-o".to_owned(), object.to_string()]);
        compile_one(
            with.cache,
            with.tools,
            &from,
            &object,
            &arguments,
            &format!("compiling {source} for `{name}`"),
        )?;
        objects.push(object);
    }
    Ok(())
}

/// Compile the Java a target's packages contribute, into the artifact.
///
/// **The library Java never references the emitted classes, which is what makes
/// the ordering simple.** Measured rather than assumed: across
/// `examples/interop/java-from-ts` and `android-shape`, every `.java` in a
/// declared root has zero `nts.gen` references -- the files that do are test
/// consumers living outside any root. So a root compiles against the platform
/// and the runtime, and nothing here has to be built twice.
///
/// The emitted classes are on the classpath anyway, because they exist by now
/// and a root that *did* call back into TypeScript would otherwise fail for a
/// reason the message could not name.
///
/// Returns the top-level package directories it produced, which is what
/// `package_jvm` has to add to the archive: it packages `nts` and nothing else,
/// so a `com/example` compiled beside it would be absent from the artifact and
/// present in the build directory -- the shape that looks like it worked.
fn compile_java_roots(
    name: &str,
    config_roots: &[Utf8PathBuf],
    target: &nts_build::config::Target,
    sdk: Option<&AndroidSdk>,
    out: &Utf8Path,
    depends: &[Utf8PathBuf],
) -> Result<Vec<String>> {
    let declared = declared_native_roots(config_roots, target);
    if declared.is_empty() {
        return Ok(Vec::new());
    }
    let mut sources: Vec<Utf8PathBuf> = Vec::new();
    for root in &declared {
        let root = Utf8Path::new(root);
        let mut found = java_files(root)?;
        if found.is_empty() {
            // **Refused rather than skipped.** A root declared for a JVM target
            // that holds no Java is contributing something this does not
            // compile -- Kotlin, a `.so`, a `.kt` beside the `.java` somebody
            // meant to add -- and the artifact would be missing it with nothing
            // said. `native_sources` would also report nothing here, because it
            // collects `.c`, so the silence is doubled.
            bail!(
                "product `{name}` targets {} and `{root}` is declared for it, but holds \
                 no `.java`. On this backend a native root is Java; a root of anything \
                 else is not compiled into the artifact and this will not ship one that \
                 is missing it",
                target.id
            )
        }
        sources.append(&mut found);
    }

    let mut classpath = vec![out.to_string(), out.join(RUNTIME_JAR).to_string()];
    if let Some(sdk) = sdk {
        classpath.push(sdk.platform_jar.to_string());
    }
    // The jars a package pinned. On the compile classpath because the Java a
    // package contributes is what calls into them -- the emitted classes do
    // not, since nothing in HIR can name a type this compiler did not read.
    classpath.extend(depends.iter().map(ToString::to_string));
    let mut javac = std::process::Command::new("javac");
    javac
        .arg("--release")
        .arg("8")
        .arg("-nowarn")
        .arg("-classpath")
        .arg(classpath.join(":"))
        .arg("-d")
        .arg(out.as_str());
    for file in &sources {
        javac.arg(file.as_str());
    }
    run_tool(javac, "javac", "compile the Java a package contributes")?;

    // The top-level directory of each compiled class, read from the *package*
    // the file declares rather than from its path: a root is a directory a
    // config named, and `native/android/com/example/ui` names a package four
    // segments in, so the path says nothing about where `com` begins.
    let mut packages: Vec<String> = Vec::new();
    for file in &sources {
        let text = std::fs::read_to_string(file).with_context(|| format!("reading {file}"))?;
        let Some(first) = text
            .lines()
            .map(str::trim)
            .find_map(|line| line.strip_prefix("package ")?.split(';').next())
            .and_then(|declared| declared.trim().split('.').next().map(str::to_owned))
        else {
            continue;
        };
        if !packages.contains(&first) {
            packages.push(first);
        }
    }
    packages.sort();
    Ok(packages)
}

/// Every `.java` under a root, at any depth, because a package is directories.
fn java_files(root: &Utf8Path) -> Result<Vec<Utf8PathBuf>> {
    let mut found = Vec::new();
    let Ok(listing) = std::fs::read_dir(root) else { return Ok(found) };
    for item in listing.flatten() {
        let path = Utf8PathBuf::from_path_buf(item.path())
            .map_err(|bad| anyhow!("{} is not UTF-8", bad.display()))?;
        if path.is_dir() {
            found.append(&mut java_files(&path)?);
        } else if path.extension() == Some("java") {
            found.push(path);
        }
    }
    found.sort();
    Ok(found)
}

/// The native roots a target's packages *declare*, whether or not they hold C.
///
/// **Declared, not discovered, and the difference is the whole point.**
/// `native_sources` collects `.c` files, because that is what the C backend
/// compiles -- so a package contributing a directory of Java for `android-29`
/// produces an empty list there and reads as "no native code". On the JVM
/// backend that is exactly backwards: the roots are Java and JNI, they are the
/// half the program calls into, and an artifact built without them is missing
/// something no file extension in this tree announces.
fn declared_native_roots(
    config_roots: &[Utf8PathBuf],
    target: &nts_build::config::Target,
) -> Vec<String> {
    let mut found = Vec::new();
    for config_path in config_roots {
        let package = config_path.parent().unwrap_or_else(|| Utf8Path::new("."));
        let Ok(resolved) = nts_build::config::resolve(config_path) else { continue };
        for entry in &resolved.native {
            if entry.covers(&target.id, target.minimum_version.as_deref()) {
                found.push(package.join(&entry.dir).to_string());
            }
        }
    }
    found.sort();
    found
}

/// Stop at a product kind whose packaging is not built, rather than near it.
///
/// **The kind and the backend together**, because neither decides alone: an
/// `application` is an executable on the C backend and an APK on the JVM one,
/// and the second has no packaging here. What the classes contain is right in
/// both cases; what is missing is the container, and a container of the wrong
/// format under the right name is the worst of the three outcomes.
fn refuse_unpackaged(name: &str, kind: &str, target: &nts_build::config::Target) -> Result<()> {
    let jvm = target.backend == "jvm";
    match (kind, jvm) {
        // Everything with a packaging path below, native and JVM alike.
        (
            "shared-library" | "static-library" | "node-addon" | "application" | "executable",
            false,
        )
        | ("jar" | "aar" | "application" | "executable", true) => Ok(()),
        // **Two facts, and the message used to conflate them.** It said "Not
        // available here", which reads as a limitation of this machine -- and
        // it is unconditional, so on a Mac with the toolchain installed it
        // would have said the same thing about a build that was refused for a
        // different reason entirely. Whether `xcodebuild` is present and
        // whether this can drive it are separate questions and get separate
        // clauses.
        ("xcframework", _) => bail!(
            "product `{name}` is an XCFramework. Assembling one is \
             `xcodebuild -create-xcframework` over a framework per platform slice, and \
             this build does not run it yet{}. Declare the slices as `shared-library` \
             products and assemble them yourself, or ship a `.dylib`",
            if std::process::Command::new("xcodebuild")
                .arg("-version")
                .output()
                .is_ok_and(|seen| seen.status.success())
            {
                ""
            } else {
                " -- and `xcodebuild` is not on this machine either, so the slices \
                 have to be assembled on a Mac"
            }
        ),
        // **Which side of the backend split it is on, because the kinds are not
        // one set.** This said "no packaging for `{other}`" whatever the reason,
        // and the reachable case is a kind that *is* packaged -- for the other
        // backend. `aar` on a native target was told an AAR cannot be built,
        // when what is true is that an AAR is a JVM artifact and this product's
        // target is not.
        (kind @ ("jar" | "aar"), false) => bail!(
            "product `{name}` has kind `{kind}`, which is a JVM artifact, and it targets \
             {} on the {} backend. Give it a JVM target -- `target.jvm(...)` or \
             `target.android(...)` -- or choose a kind this target can carry: \
             shared-library, static-library, executable, application, node-addon",
            target.id,
            target.backend
        ),
        (kind @ ("shared-library" | "static-library" | "node-addon"), true) => bail!(
            "product `{name}` has kind `{kind}`, which is a native artifact, and it \
             targets {} on the JVM backend. Give it a native target -- \
             `target.linux(...)`, `target.macos(...)`, `target.windows(...)` -- or \
             choose a kind the JVM carries: jar, aar, executable, application",
            target.id
        ),
        (other, _) => bail!(
            "product `{name}` has kind `{other}`, which is not one this build knows. \
             The kinds are shared-library, static-library, executable, application, \
             node-addon, jar, aar and xcframework"
        ),
    }
}

/// The compiler's scalar brand module, which no package declares.
const C_BRANDS: &str = "c:types";

/// The runtime `emit-jvm` places beside the classes it writes.
///
/// **Asked of the emitter rather than spelled again.** This was its own
/// `"nts-runtime.jar"`, identical to `nts_codegen_jvm::RUNTIME_JAR_NAME` --
/// which is the name the emitter actually *writes*, three lines from where this
/// packaged what it *reads*. One fact with two owners: rename it there and `d8`
/// would look for a file that is not there, reporting a path nobody typed.
const RUNTIME_JAR: &str = nts_codegen_jvm::RUNTIME_JAR_NAME;


/// Package the emitted classes into the jar the product names.
///
/// **Two artifacts, not one, and the choice is deliberate.**
/// `apps/java-desktop-brownfield` states it: the runtime jar is either shaded in
/// or declared as a dependency, "shading duplicates it when two nts libraries
/// meet in one application; declaring it makes the consumer resolve a second
/// artifact. Neither is free and the choice is not made." So both are reported
/// and neither is hidden inside the other, which is the option that can still
/// become either.
///
/// **Refuses a package it cannot produce.** `javaPackage` has had no reader
/// since it was written, and `codegen/jvm` hardcodes `nts/gen` --
/// `docs/jvm-interop.md` lists that under packaging gaps. A jar whose classes
/// are somewhere other than where its config says is an artifact that does not
/// match its own declaration, so a config asking for anything else is told what
/// it would have got rather than given it.
fn package_jvm(
    name: &str,
    product: &nts_build::config::Product,
    out: &Utf8Path,
    extra: &[String],
) -> Result<Utf8PathBuf> {
    let artifact = out.join(format!("{name}.jar"));
    let mut command = std::process::Command::new("jar");
    command.arg("--create").arg("--file").arg(artifact.as_str());
    // **The root of the package the emitter wrote into, not the literal `nts`.**
    // This said `nts` and a product declaring `javaPackage: "com.acme.sdk"`
    // produced a jar with nothing in it: the classes were on disk under
    // `com/acme/sdk/` and the archive asked for a directory that no longer
    // existed. `jar` reports that as success, because `-C out nts` with no
    // `nts` is not an error it has a name for.
    //
    // `extra` is what a package's Java contributed. Naming the roots rather
    // than packaging the whole directory, because `out` also holds the runtime
    // jar, the staging directories and -- for an APK -- a signing key, and an
    // archive assembled by exclusion grows a new member every time something
    // else is written beside it.
    let emitted_root = product
        .java_package
        .as_deref()
        .and_then(|named| named.split('.').next())
        .unwrap_or("nts")
        .to_owned();
    for package in std::iter::once(&emitted_root).chain(extra) {
        command.arg("-C").arg(out.as_str()).arg(package);
    }
    let output = command.output().with_context(|| {
        format!("running `jar` to package `{name}`. It ships with the JDK; is one on PATH?")
    })?;
    if !output.status.success() {
        bail!("packaging `{name}` failed:\n{}", String::from_utf8_lossy(&output.stderr));
    }
    Ok(artifact)
}

/// Package an AAR: a zip with `classes.jar`, a manifest, and the consumer's
/// R8 rules.
///
/// **No Android SDK.** An AAR is a container the *consumer* dexes, so `d8`,
/// `aapt2` and the rest are their build's business and not this one's. `jar`
/// writes a zip, which is what an AAR is.
///
/// **The manifest is carried, not merged.** AGP has a manifest merger with a
/// specification and `runtime/jvm/web-platform/android/` already relies on it,
/// so the fragment a package declares becomes this AAR's `AndroidManifest.xml`
/// and the consumer's build merges it in. Several fragments for one target is a
/// refusal rather than a merge: two answers to which permissions a library
/// declares is a question only the config can settle, and reimplementing XML
/// merging would be a second answer to one the platform already gives.
///
/// A package declaring none gets the minimal manifest an AAR must still have.
fn package_aar(
    name: &str,
    product: &nts_build::config::Product,
    out: &Utf8Path,
    classes: &Utf8Path,
    target: &nts_build::config::Target,
    tsconfig: &Utf8Path,
    depends: &[Utf8PathBuf],
) -> Result<Utf8PathBuf> {
    let staged = out.join("aar");
    drop(std::fs::remove_dir_all(&staged));
    std::fs::create_dir_all(&staged).with_context(|| format!("creating {staged}"))?;
    std::fs::copy(classes, staged.join("classes.jar"))
        .with_context(|| format!("copying {classes} into the AAR"))?;

    // **`libs/` rather than shaded into `classes.jar`**, and for the same
    // reason the manifest is carried rather than merged: the *consumer* dexes
    // an AAR, so their build puts `libs/*.jar` on the classpath the way AGP
    // already does. Shading would duplicate the dependency wherever two
    // libraries carrying it meet in one application.
    if !depends.is_empty() {
        let libs = staged.join("libs");
        std::fs::create_dir_all(&libs).with_context(|| format!("creating {libs}"))?;
        for jar in depends {
            let named = jar.file_name().unwrap_or("dependency.jar");
            std::fs::copy(jar, libs.join(named))
                .with_context(|| format!("copying {jar} into the AAR's libs/"))?;
        }
    }

    let project = tsconfig.parent().unwrap_or_else(|| Utf8Path::new("."));
    let fragments = android_manifest_fragments(target, tsconfig);
    let manifest = staged.join("AndroidManifest.xml");
    match fragments.as_slice() {
        [] => std::fs::write(
            &manifest,
            "<!-- Generated by nts: the minimal manifest an AAR must carry. The \
             package declared no fragment. -->\n\
             <manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" />\n",
        )
        .with_context(|| format!("writing {manifest}"))?,
        [one] => {
            std::fs::copy(project.join(&one.path), &manifest)
                .with_context(|| format!("copying {} into the AAR", one.path))?;
        }
        several => bail!(
            "product `{name}` has {} manifest fragments for {}. An AAR carries one \
             `AndroidManifest.xml`; which permissions a library declares is not \
             something this can merge for you",
            several.len(),
            target.id
        ),
    }

    if let Some(rules) = &product.consumer_proguard {
        std::fs::copy(project.join(rules), staged.join("proguard.txt"))
            .with_context(|| format!("copying {rules} into the AAR"))?;
    }

    let artifact = out.join(format!("{name}.aar"));
    let mut command = std::process::Command::new("jar");
    command
        .arg("--create")
        .arg("--file")
        .arg(artifact.as_str())
        .arg("-C")
        .arg(staged.as_str())
        .arg(".");
    let output = command.output().context("running `jar` to package an AAR")?;
    if !output.status.success() {
        bail!("packaging `{name}` failed:\n{}", String::from_utf8_lossy(&output.stderr));
    }
    Ok(artifact)
}

/// The four Android SDK tools an APK needs, found once and named when absent.
///
/// **Found rather than configured.** Every one of these has exactly one
/// conventional location under the SDK root, and a config field naming a path
/// to `d8` would be a second statement of something `ANDROID_HOME` already
/// says. What a person can get wrong is having no SDK, or an SDK missing a
/// component -- both of which are one message naming the component and the
/// `sdkmanager` line that installs it.
struct AndroidSdk {
    build_tools: Utf8PathBuf,
    platform_jar: Utf8PathBuf,
}

impl AndroidSdk {
    fn tool(&self, name: &str) -> std::process::Command {
        std::process::Command::new(self.build_tools.join(name))
    }
}

/// Newest first, so the search below takes the newest usable one.
///
/// Sorted numerically per component rather than lexically: `36.1.0` is newer
/// than `36.0.0` and both are newer than `9.0.0`, which a string sort gets
/// backwards on the last pair.
fn build_tools_versions(root: &Utf8Path) -> Vec<Utf8PathBuf> {
    let Ok(entries) = std::fs::read_dir(root.join("build-tools")) else { return Vec::new() };
    let mut found: Vec<(Vec<u64>, Utf8PathBuf)> = entries
        .filter_map(|entry| Utf8PathBuf::from_path_buf(entry.ok()?.path()).ok())
        .filter(|path| path.is_dir())
        .map(|path| {
            let parts = path
                .file_name()
                .unwrap_or_default()
                .split('.')
                .map(|part| part.parse().unwrap_or(0))
                .collect();
            (parts, path)
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, path)| path).collect()
}

/// The tools this packaging runs, in the order it runs them.
const APK_TOOLS: [&str; 3] = ["aapt2", "d8", "apksigner"];

fn android_sdk(name: &str, target: &nts_build::config::Target) -> Result<AndroidSdk> {
    // **A variable that is set and points nowhere is an error, and the one the
    // default guess must not paper over.** A stale `ANDROID_HOME` in a shell
    // profile is the likeliest way this goes wrong, and falling through to
    // `~/Android/Sdk` would build against an SDK the person did not name --
    // then report a missing component under a path they never typed. Absent is
    // not an error; unreadable is.
    let named = ["ANDROID_HOME", "ANDROID_SDK_ROOT"]
        .into_iter()
        .find_map(|var| Some((var, std::env::var(var).ok().filter(|v| !v.is_empty())?)));
    let root = if let Some((var, value)) = named {
        let path = Utf8PathBuf::from(value);
        if !path.is_dir() {
            bail!(
                "product `{name}` is an APK and `{var}` is set to {path}, which is not a \
                 directory. Point it at an Android SDK, or unset it to look in \
                 ~/Android/Sdk"
            )
        }
        path
    } else {
        let guess =
            Utf8PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Android/Sdk");
        if !guess.is_dir() {
            bail!(
                "product `{name}` is an APK and no Android SDK was found. Set \
                 `ANDROID_HOME` to one, or install it at {guess}"
            )
        }
        guess
    };

    let versions = build_tools_versions(&root);
    // **The newest one that is complete, not simply the newest.** A partial
    // `build-tools` directory is an ordinary state -- an interrupted
    // `sdkmanager`, or a version installed for one tool -- and stopping at the
    // newest would refuse while a usable one sits beside it.
    let build_tools = versions
        .iter()
        .find(|dir| APK_TOOLS.iter().all(|tool| dir.join(tool).is_file()))
        .cloned();
    let build_tools = match (build_tools, versions.first()) {
        (Some(dir), _) => dir,
        (None, Some(newest)) => {
            let missing: Vec<&str> =
                APK_TOOLS.iter().copied().filter(|tool| !newest.join(tool).is_file()).collect();
            bail!(
                "product `{name}` is an APK and no complete `build-tools` was found \
                 under {root}. The newest, {}, is missing {}. Install a complete one \
                 with: sdkmanager \"build-tools;36.0.0\"",
                newest.file_name().unwrap_or_default(),
                missing.join(", ")
            )
        }
        (None, None) => bail!(
            "product `{name}` is an APK and {root} has no `build-tools` at all. \
             Install one with: sdkmanager \"build-tools;36.0.0\""
        ),
    };

    // **The target id *is* the platform directory name.** `t.android` builds it
    // as `android-${compileSdk}` and the SDK lays platforms out under the same
    // string, so this is a lookup rather than a translation -- and a target
    // whose surface the SDK does not have installed is the same fact as a
    // missing `android.jar`.
    let platform_jar = root.join("platforms").join(&target.id).join("android.jar");
    if !platform_jar.is_file() {
        bail!(
            "product `{name}` compiles against {} and {platform_jar} does not exist. \
             Install that platform with: sdkmanager \"platforms;{}\"",
            target.id,
            target.id
        )
    }
    Ok(AndroidSdk { build_tools, platform_jar })
}

/// Run one SDK tool, naming it rather than the step when it fails.
fn run_tool(mut command: std::process::Command, tool: &str, what: &str) -> Result<()> {
    let output = command
        .output()
        .with_context(|| format!("running `{tool}` to {what}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        // `aapt2` reports on stdout and `apksigner` on stderr, so a message
        // taking only one of them is empty for half of these tools -- which is
        // the failure that reads as "it failed for no reason".
        bail!("`{tool}` failed to {what}:\n{}{}", stderr.trim_end(), stdout.trim_end());
    }
    Ok(())
}

/// The API level the artifact runs back to.
///
/// `minimumVersion` where the target declares one, which `t.android` always
/// does. A hand-written target literal need not, and the honest reading of "no
/// floor declared" is the surface it compiles against -- so the id's number,
/// which is `compileSdk`. That is minSdk == compileSdk, a legitimate
/// configuration, rather than a guess at a lower number nobody wrote down.
fn android_min_api(target: &nts_build::config::Target) -> u32 {
    target
        .minimum_version
        .as_deref()
        .and_then(|version| version.parse().ok())
        .or_else(|| target.id.rsplit('-').next()?.parse().ok())
        .unwrap_or(1)
}

/// Package the emitted classes into an installable, signed APK.
///
/// **Six tools in a row, and the ordering is not a preference.** `aapt2` writes
/// the container and the binary manifest; `d8` turns class files into the one
/// bytecode ART loads; the dex is added to the container afterwards because
/// `aapt2` has no way to take one; `zipalign` must run before signing, because
/// aligning rewrites offsets and would invalidate a signature; and `apksigner`
/// must be last for the same reason.
///
/// **It is signed with a debug key, and the output says so.** An unsigned APK
/// cannot be installed, so refusing to sign would make the product unbuildable
/// for the thing an APK is for. A release key is a secret and there is no
/// config surface naming one, so inventing a field for it here would be a
/// decision made in the wrong place -- what this does instead is name the
/// keystore it used, so nobody ships one believing otherwise.
#[allow(clippy::too_many_arguments)]
fn package_apk(
    name: &str,
    product: &nts_build::config::Product,
    out: &Utf8Path,
    classes: &Utf8Path,
    target: &nts_build::config::Target,
    tsconfig: &Utf8Path,
    sdk: &AndroidSdk,
    config_roots: &[Utf8PathBuf],
    depends: &[Utf8PathBuf],
) -> Result<Utf8PathBuf> {
    let min_api = android_min_api(target);
    let staged = out.join("apk");
    drop(std::fs::remove_dir_all(&staged));
    std::fs::create_dir_all(&staged).with_context(|| format!("creating {staged}"))?;
    let manifest = write_android_manifest(name, product, &staged, target, tsconfig, config_roots, min_api)?;

    // **The runtime jar goes in, and this is where it stops being optional.**
    // A jar consumer resolves the runtime as a dependency; an APK has no
    // resolver at install time, so every class the program loads has to be in
    // the dex or the app dies at its first call with a `NoClassDefFoundError`.
    let runtime = out.join(RUNTIME_JAR);
    let mut d8 = sdk.tool("d8");
    d8.arg("--release")
        .arg("--min-api")
        .arg(min_api.to_string())
        .arg("--output")
        .arg(staged.as_str())
        .arg(classes.as_str())
        .arg(runtime.as_str());
    // **And every pinned jar**, for exactly the reason the runtime is not
    // optional one comment above: an APK has no resolver at install time, so a
    // class that is not in the dex is a `NoClassDefFoundError` at the first
    // call rather than a build failure.
    for jar in depends {
        d8.arg(jar.as_str());
    }
    run_tool(d8, "d8", "convert the class files to dex")?;

    let unsigned = staged.join("unsigned.apk");
    let mut aapt2 = sdk.tool("aapt2");
    aapt2
        .arg("link")
        .arg("-o")
        .arg(unsigned.as_str())
        .arg("-I")
        .arg(sdk.platform_jar.as_str())
        .arg("--manifest")
        .arg(manifest.as_str())
        .arg("--min-sdk-version")
        .arg(min_api.to_string())
        .arg("--target-sdk-version")
        .arg(target.id.rsplit('-').next().unwrap_or("36"));
    run_tool(aapt2, "aapt2", "link the APK")?;

    // `jar --update` rather than a zip library, for the same reason
    // `package_jvm` and `package_aar` shell out to `jar`: the JDK is already a
    // hard requirement of this backend, and a second zip implementation in the
    // tree is a second set of answers about compression and alignment.
    let mut add = std::process::Command::new("jar");
    add.arg("--update")
        .arg("--file")
        .arg(unsigned.as_str())
        .arg("-C")
        .arg(staged.as_str())
        .arg("classes.dex");
    run_tool(add, "jar", "add classes.dex to the APK")?;

    let aligned = staged.join("aligned.apk");
    let mut zipalign = sdk.tool("zipalign");
    zipalign.arg("-p").arg("-f").arg("4").arg(unsigned.as_str()).arg(aligned.as_str());
    run_tool(zipalign, "zipalign", "align the APK")?;

    let keystore = debug_keystore(out)?;
    let artifact = out.join(format!("{name}.apk"));
    let mut sign = sdk.tool("apksigner");
    sign.arg("sign")
        .arg("--ks")
        .arg(keystore.as_str())
        .arg("--ks-pass")
        .arg("pass:android")
        .arg("--ks-key-alias")
        .arg("androiddebugkey")
        .arg("--key-pass")
        .arg("pass:android")
        .arg("--out")
        .arg(artifact.as_str())
        .arg(aligned.as_str());
    run_tool(sign, "apksigner", "sign the APK")?;
    Ok(artifact)
}

/// An executable JVM program: the classes, the runtime, and a `Main-Class`.
///
/// **The entry is module evaluation, not an exported `main`.** That is the C
/// lane's rule -- `write_standalone` generates a `main()` that runs the module
/// initialiser, "because that is what an executable is" -- and this is the same
/// fact one mangling away, so the launcher calls
/// `nts_codegen_jvm::module_init_method()` rather than a name spelled here.
///
/// **A program with nothing to evaluate still gets a launcher.** `initializes`
/// is false for a module that only declares things, and the C lane handles that
/// case by generating a `main()` that does nothing rather than by refusing.
/// Getting it wrong is caught at build time rather than at run time, and only
/// because the launcher is compiled *against the emitted classes*: `javac` says
/// `cannot find symbol` where a launcher assembled some other way would have
/// shipped and thrown `NoSuchMethodError` on the machine that ran it. Measured
/// by sabotage, not assumed -- the comment here claimed the run-time failure
/// until the mutation printed the compiler error instead.
///
/// **Shaded rather than declared.** A `jar` product reports two artifacts and
/// lets the consumer choose, because a library meeting another library needs
/// the choice; an executable has no consumer to resolve anything, so `java -jar`
/// has to work and the runtime goes in. That is the same reasoning as
/// `package_apk`'s dex, one container over.
fn package_runnable_jar(
    name: &str,
    out: &Utf8Path,
    classes: &Utf8Path,
    initializes: bool,
    depends: &[Utf8PathBuf],
) -> Result<Utf8PathBuf> {
    let staged = out.join("jar");
    drop(std::fs::remove_dir_all(&staged));
    std::fs::create_dir_all(&staged).with_context(|| format!("creating {staged}"))?;

    let call = if initializes {
        format!("{}.{}();", nts_codegen_jvm::PROGRAM.replace('/', "."), nts_codegen_jvm::module_init_method())
    } else {
        "// the module declares only types and functions: nothing to evaluate".to_owned()
    };
    let launcher = staged.join("NtsMain.java");
    std::fs::write(
        &launcher,
        format!(
            "// Generated by nts. The entry point of a standalone program is module
             // evaluation, which is what the C lane's `main.c` runs too.
             public final class NtsMain {{
                 public static void main(String[] args) {{
                     {call}
                 }}
             }}
"
        ),
    )
    .with_context(|| format!("writing {launcher}"))?;

    // Against the emitted classes and the runtime, because the launcher names a
    // generated class and `javac` resolves it from the classpath like any other.
    let runtime = out.join(RUNTIME_JAR);
    let built = staged.join("classes");
    std::fs::create_dir_all(&built).with_context(|| format!("creating {built}"))?;
    let mut javac = std::process::Command::new("javac");
    javac
        .arg("--release")
        .arg("8")
        .arg("-nowarn")
        .arg("-classpath")
        .arg(format!("{classes}:{runtime}"))
        .arg("-d")
        .arg(built.as_str())
        .arg(launcher.as_str());
    run_tool(javac, "javac", "compile the launcher")?;

    // One jar, assembled by unpacking the two it is made of. `jar` has no
    // "merge these archives" mode, and a classpath cannot be expressed inside a
    // `java -jar` invocation -- `Class-Path` in the manifest is relative to the
    // jar and would make the artifact depend on a file beside it, which is the
    // thing a single executable artifact exists to avoid.
    //
    // **A pinned dependency is unpacked here for the same reason**, rather than
    // named in `Class-Path`: that decision is made one paragraph up, and a jar
    // that shipped its own classes inside and its dependencies' beside would be
    // two answers to what a single artifact means. Unpacking is last-wins where
    // two jars carry the same class, which is what every shading tool does and
    // is worth knowing rather than discovering.
    //
    // **Every path made absolute first, because this is the one command in the
    // build that changes its working directory.** `--file` is then resolved
    // against `built` rather than against ours, so `nts build` with no argument
    // -- where the output directory is the relative `.nts/build/...` -- died on
    // `tool.jar (No such file or directory)` while the same build with an
    // absolute project path succeeded. Every test of this path passed an
    // absolute path, so nothing was looking: `CARGO_TARGET_TMPDIR` is absolute,
    // which is the same blind spot `absolute()` above was written for.
    let unpacked: Vec<Utf8PathBuf> = [classes, runtime.as_path()]
        .into_iter()
        .map(absolute)
        .chain(depends.iter().map(|jar| absolute(jar)))
        .collect();
    for source in &unpacked {
        let mut unpack = std::process::Command::new("jar");
        unpack.arg("--extract").arg("--file").arg(source.as_str()).current_dir(built.as_str());
        run_tool(unpack, "jar", "unpack a jar into the executable")?;
    }
    // A signature in the runtime jar's manifest would be checked against
    // contents that are now different; there is none today, and removing the
    // manifests we did not write costs nothing and keeps it that way.
    drop(std::fs::remove_dir_all(built.join("META-INF")));

    // **Built beside and then moved over.** `package_jvm` already wrote
    // `<name>.jar` -- the classes this is assembled *from* -- so creating the
    // executable at that path would have `jar` writing its own input. The
    // unpack above happens first and it would work today, which is exactly the
    // kind of ordering that survives until somebody reorders two lines.
    let assembled = staged.join("executable.jar");
    let mut package = std::process::Command::new("jar");
    package
        .arg("--create")
        .arg("--file")
        .arg(assembled.as_str())
        .arg("--main-class")
        .arg("NtsMain")
        .arg("-C")
        .arg(built.as_str())
        .arg(".");
    run_tool(package, "jar", "package the executable jar")?;
    let artifact = out.join(format!("{name}.jar"));
    std::fs::rename(&assembled, &artifact)
        .with_context(|| format!("moving the executable jar to {artifact}"))?;
    Ok(artifact)
}

/// The one `AndroidManifest.xml` an APK carries, and what it refuses to guess.
#[allow(clippy::too_many_arguments)]
fn write_android_manifest(
    name: &str,
    product: &nts_build::config::Product,
    staged: &Utf8Path,
    target: &nts_build::config::Target,
    tsconfig: &Utf8Path,
    config_roots: &[Utf8PathBuf],
    min_api: u32,
) -> Result<Utf8PathBuf> {
    // **An APK is the last artifact, so there is no consumer left to merge.**
    // `build/src/config.rs` says a fragment is "read, not merged" because an
    // AAR carries it and the consumer's Gradle merges it -- and here we *are*
    // that build. So either this merges them or it refuses, and a partial
    // merger would ship the half it got wrong inside an artifact nobody
    // re-reads. `biometrics` is the case: its fragment declares
    // `USE_BIOMETRIC`, and its own comment says omitting it means "a consumer
    // sees a crash and not a denial".
    let contributed = contributed_manifest_fragments(config_roots, target, tsconfig);
    let own = android_manifest_fragments(target, tsconfig);
    let manifest = staged.join("AndroidManifest.xml");
    match own.as_slice() {
        // **Refused only where it would otherwise be silent.** An app that
        // declares its own fragment owns its manifest, and whether it covers
        // what its packages need is the author's call -- visible in a file they
        // wrote. An app that declares none gets a generated manifest, and
        // generating one while a package needed a permission is the case that
        // ships an APK which installs and then crashes: `biometrics`' fragment
        // says so itself, "a consumer that omits it sees a crash and not a
        // denial".
        [] if !contributed.is_empty() => bail!(
            "product `{name}` targets {} and {} package(s) contribute a manifest \
             fragment: {}. This would otherwise generate a manifest that silently \
             carries none of them, and merging them is AGP's manifest merger, which \
             this does not reimplement. Declare an `AndroidManifest.xml` for the app \
             stating what they need, where the person shipping it can see it",
            target.id,
            contributed.len(),
            contributed.join(", ")
        ),
        [] => {
            let id = product.application_id.as_deref().with_context(|| {
                format!(
                    "product `{name}` is an APK and declares no `id`. An APK's manifest \
                     must name a package and this cannot invent one: two apps sharing an \
                     id cannot be installed side by side. Add `id: \"com.example.{name}\"` \
                     to the product, or declare a manifest fragment of your own"
                )
            })?;
            std::fs::write(
                &manifest,
                format!(
                    "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n\
                     <!-- Generated by nts from the product's `id`, `minSdk` and target. \
                     Declare a manifest fragment to own this file. -->\n\
                     <manifest xmlns:android=\"http://schemas.android.com/apk/res/android\"\n\
                     \x20         package=\"{id}\">\n\
                     \x20 <uses-sdk android:minSdkVersion=\"{min_api}\" />\n\
                     \x20 <application android:label=\"{name}\" />\n\
                     </manifest>\n"
                ),
            )
            .with_context(|| format!("writing {manifest}"))?;
        }
        [one] => {
            let project = tsconfig.parent().unwrap_or_else(|| Utf8Path::new("."));
            std::fs::copy(project.join(&one.path), &manifest)
                .with_context(|| format!("copying {} into the APK", one.path))?;
        }
        // **Refused rather than merged.** AGP's manifest merger is a
        // specification -- node ordering, `tools:` markers, attribute conflict
        // rules -- and `build/src/config.rs` already says a fragment is carried
        // and merged by the consumer's build. A partial merger here would be a
        // second answer to that, and the half it got wrong would ship silently
        // in an artifact nobody re-reads.
        several => bail!(
            "product `{name}` has {} manifest fragments covering {}. An APK carries one \
             `AndroidManifest.xml` and merging them is AGP's manifest merger, which this \
             does not reimplement. Declare one fragment for the application that states \
             what the others would have contributed",
            several.len(),
            target.id
        ),
    }
    Ok(manifest)
}

/// Manifest fragments contributed by packages *other than* the project itself.
///
/// **A different question from `android_manifest_fragments`, not a second
/// answer to it.** That one asks which fragment this project declares, and an
/// AAR's answer is its own: a library ships its fragment for the consumer's
/// build to merge, which is what `build/src/config.rs` means by "read, not
/// merged". An APK has no consumer downstream, so it has to ask the other
/// question -- what did everything I depend on need -- and the two lists are
/// genuinely different rather than the same list read twice.
fn contributed_manifest_fragments(
    config_roots: &[Utf8PathBuf],
    target: &nts_build::config::Target,
    tsconfig: &Utf8Path,
) -> Vec<String> {
    let own = nts_build::config::beside(tsconfig);
    let mut found = Vec::new();
    for config_path in config_roots {
        if own.as_ref() == Some(config_path) {
            continue;
        }
        let package = config_path.parent().unwrap_or_else(|| Utf8Path::new("."));
        let Ok(resolved) = nts_build::config::resolve(config_path) else { continue };
        for entry in &resolved.manifests {
            if entry.covers(&target.id, target.minimum_version.as_deref()) {
                found.push(package.join(&entry.path).to_string());
            }
        }
    }
    found.sort();
    found
}

/// Every dependency claim covering this target, from the app and its packages.
///
/// **The app's own config counts too**, unlike the manifest walk above: a
/// fragment an app declares is placed by the packaging step that knows where
/// the app's own manifest goes, whereas a dependency is a dependency wherever
/// it was declared. An app linking `libnotify` directly and an app getting it
/// through a package need the same flag on the same link line.
///
/// Ordered by config path so a link line does not reorder between runs for a
/// reason nobody changed.
fn dependencies_for(
    config_roots: &[Utf8PathBuf],
    target: &nts_build::config::Target,
) -> Result<nts_build::dependencies::Resolution> {
    let mut roots: Vec<&Utf8PathBuf> = config_roots.iter().collect();
    roots.sort();
    let mut total = nts_build::dependencies::Resolution::default();
    for config_path in roots {
        let directory = config_path.parent().unwrap_or_else(|| Utf8Path::new("."));
        // A config that does not parse is not this function's error to report:
        // everything else reading these roots skips one too, and the build
        // fails on it where it is actually used.
        let Ok(resolved) = nts_build::config::resolve(config_path) else { continue };
        if resolved.dependencies.is_empty() {
            continue;
        }
        let one = nts_build::dependencies::resolve(
            directory,
            &resolved.dependencies,
            &target.id,
            target.minimum_version.as_deref(),
        )
        .with_context(|| format!("resolving the dependencies `{config_path}` declares"))?;
        total.absorb(one);
    }
    Ok(total)
}

/// The manifest fragments a target's packages contribute.
///
/// Shared by the AAR and APK paths because it is one question -- which
/// fragments are for this target -- and two readings of it would be two answers
/// the first time `covers` changes.
fn android_manifest_fragments(
    target: &nts_build::config::Target,
    tsconfig: &Utf8Path,
) -> Vec<nts_build::config::Manifest> {
    let declared = nts_build::config::beside(tsconfig)
        .and_then(|path| nts_build::config::resolve(&path).ok())
        .map(|resolved| resolved.manifests)
        .unwrap_or_default();
    declared
        .into_iter()
        .filter(|entry| entry.covers(&target.id, target.minimum_version.as_deref()))
        .collect()
}

/// The debug key an APK is signed with, generated once and kept.
///
/// **Generated rather than required.** An absent keystore is the ordinary state
/// of a machine that has never built an Android app, and "absent is not an
/// error" -- Gradle makes the same one for the same reason. It is kept beside
/// the artifact rather than in `~/.android` so that deleting a build directory
/// deletes it: a key under `$HOME` outlives every project that used it, and a
/// *debug* key that outlives its project is one somebody eventually ships.
fn debug_keystore(out: &Utf8Path) -> Result<Utf8PathBuf> {
    let keystore = out.join("debug.keystore");
    if keystore.is_file() {
        return Ok(keystore);
    }
    let mut keytool = std::process::Command::new("keytool");
    keytool
        .arg("-genkeypair")
        .arg("-keystore")
        .arg(keystore.as_str())
        .arg("-storepass")
        .arg("android")
        .arg("-keypass")
        .arg("android")
        .arg("-alias")
        .arg("androiddebugkey")
        .arg("-keyalg")
        .arg("RSA")
        .arg("-keysize")
        .arg("2048")
        .arg("-validity")
        .arg("10950")
        .arg("-dname")
        .arg("CN=Android Debug, O=Android, C=US");
    run_tool(keytool, "keytool", "generate a debug signing key")?;
    Ok(keystore)
}

/// Where `node_api.h` is, for a product that is a Node addon.
///
/// **Searched, then refused by name.** A `.node` is a shared object that node
/// dlopens, and its one link-time dependency is that header -- there is no
/// library to link against, because the symbols resolve out of the host process
/// at load. So the only way this fails is the header being absent, and the fix
/// is one of two things a message can name.
///
/// Upward from the project, because `node-api-headers` is an ordinary
/// dependency of a project that builds an addon and lands in a `node_modules`
/// at or above it.
fn napi_include(project: &Utf8Path) -> Option<Utf8PathBuf> {
    if let Ok(named) = std::env::var("NTS_NAPI_INCLUDE") {
        return Some(Utf8PathBuf::from(named));
    }
    // **The pinned clone before the npm package**, which is the order
    // `tooling/conformance/build.sh` already chose and states the reason for:
    //
    // > `third_party/node/src` first, because it is the only candidate that is
    // > *pinned*: the clone is at the tag in `.tool-versions`, so `node_api.h`
    // > there and `deps/uv/include/uv.h` beside it are the same commit as the
    // > `lib` being ported. `node-api-headers` does not carry `uv.h` at all,
    // > which is how the system one used to get in -- and libuv is not
    // > ABI-stable, so a version match by luck is what that was.
    //
    // This function was a second, narrower answer to that question: it knew
    // only about `node_modules/node-api-headers` and the system directory, so
    // in a checkout that vendors the headers it reported *none* and every
    // `node-addon` product in this tree refused to build. Two derivations of
    // one fact, and the narrower one was the guard.
    //
    // Each candidate is looked for at every ancestor, because the project may
    // be an example several directories inside the checkout.
    for relative in ["third_party/node/src", "node_modules/node-api-headers/include"] {
        let mut at = Some(project);
        while let Some(directory) = at {
            let candidate = directory.join(relative);
            if candidate.join("node_api.h").exists() {
                return Some(candidate);
            }
            at = directory.parent();
        }
    }
    let system = Utf8PathBuf::from("/usr/include/node");
    system.join("node_api.h").exists().then_some(system)
}

/// The translation unit that runs module evaluation when a library loads.
const AUTO_INIT_NAME: &str = "nts_auto_init.c";

/// The host this build is running on, as the config spells an `os`.
fn host_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn host_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") { "aarch64" } else { "x86_64" }
}

/// Whether a target is the machine we are standing on.
fn is_host(target: &nts_build::config::Target) -> bool {
    target.os == host_os() && target.arch.as_deref().unwrap_or(host_arch()) == host_arch()
}

/// The LLVM triple `zig cc -target` takes for a target.
fn zig_triple(target: &nts_build::config::Target) -> Option<String> {
    let arch = target.arch.as_deref().unwrap_or(host_arch());
    // One vocabulary, because the config has one: `Os` is
    // `linux | macos | windows | ios | android | jvm`. `target.node` used to
    // take a free string and a fixture spelled its machines npm's way, so
    // `win32` reached here and matched nothing -- reported as "no cross
    // compiler configured for that pair" about an ordinary pair.
    let rest = match target.os.as_str() {
        "linux" => "linux-gnu",
        "windows" => "windows-gnu",
        _ => return None,
    };
    Some(format!("{arch}-{rest}"))
}

/// The C compiler for a target, and the refusal where there is none.
///
/// **Measured before it was written, because the goal said to.** `zig cc` is a
/// drop-in for `clang` on the host -- `examples/library` builds the same
/// artifact through either -- and it cross-compiles *this compiler's generated
/// C*, which is the question that matters and is not the same as whether zig
/// cross-compiles. Run against `program.c` and `nts_runtime.c`:
///
///     x86_64-windows-gnu    PE32+ executable for MS Windows (DLL)
///     x86_64-linux-musl     ELF 64-bit LSB shared object
///     aarch64-linux-gnu     ELF 64-bit LSB shared object, ARM aarch64
///     aarch64-macos-none    FAILED: unknown type name `malloc_zone_t`
///
/// So Apple is the one it cannot reach: the runtime includes headers that come
/// from Apple's SDK rather than from zig's bundled libc, and no flag fixes
/// that. Named rather than attempted, because the alternative is a page of
/// `unknown type name` from a tool the reader did not invoke.
///
/// **An explicit `CC` wins, including for a cross target.** Somebody who sets
/// `CC=x86_64-w64-mingw32-gcc` has chosen; second-guessing them would be this
/// deciding something the environment already decided.
/// A compiler, resolved once and spawnable many times.
///
/// `std::process::Command` is not `Clone` and the probe for `zig` is a process
/// spawn, so resolving per object file would fork once per translation unit to
/// re-answer a question that cannot change during a build.
#[derive(Clone)]
struct Toolchain {
    program: String,
    leading: Vec<String>,
}

impl Toolchain {
    fn command(&self) -> std::process::Command {
        let mut command = std::process::Command::new(&self.program);
        command.args(&self.leading);
        command
    }

    /// What the object cache keys on, so a target change is a cache miss.
    fn key(&self) -> String {
        format!("{} {}", self.program, self.leading.join(" "))
    }
}

fn toolchain_for(name: &str, target: &nts_build::config::Target) -> Result<Toolchain> {
    if is_host(target) || std::env::var_os("CC").is_some() {
        // `CC` split on whitespace, for the reason `bind.rs` states: it is a
        // command line and not a program name, so `zig cc`, `ccache clang` and
        // `xcrun clang` are all unusable when it is read as a file to execute.
        let spec = std::env::var("CC").unwrap_or_else(|_| "clang".to_owned());
        let mut words = spec.split_whitespace();
        return Ok(Toolchain {
            program: words.next().unwrap_or("clang").to_owned(),
            leading: words.map(str::to_owned).collect(),
        });
    }
    if matches!(target.os.as_str(), "macos" | "ios") {
        bail!(
            "product `{name}` targets {} and this is a {} machine. Cross-compiling to \
             Apple needs its SDK -- the runtime uses headers `zig cc` does not bundle, \
             and it stops at `unknown type name 'malloc_zone_t'`. Build it on a Mac, or \
             set CC to a cross compiler that has the SDK",
            target.id,
            host_os()
        )
    }
    let Some(triple) = zig_triple(target) else {
        bail!(
            "product `{name}` targets {} and this is a {} machine, and there is no \
             cross compiler configured for that pair. Set CC to one",
            target.id,
            host_os()
        )
    };
    if std::process::Command::new("zig").arg("version").output().is_err() {
        bail!(
            "product `{name}` targets {} and this is a {} machine, so it has to be \
             cross-compiled. `zig` is what this uses and it is not on PATH -- install \
             it, or set CC to a cross compiler for {triple}",
            target.id,
            host_os()
        )
    }
    Ok(Toolchain {
        program: "zig".to_owned(),
        leading: vec!["cc".to_owned(), "-target".to_owned(), triple],
    })
}

fn run(mut command: std::process::Command, what: &str) -> Result<()> {
    let output = command.output().with_context(|| {
        format!("running the C compiler for {what}. Set CC to name one")
    })?;
    if !output.status.success() {
        bail!("{what} failed:\n{}", String::from_utf8_lossy(&output.stderr));
    }
    Ok(())
}

/// Compile and link what `emit_c` wrote into the artifact the product names.
///
/// **The flags are the product's, not a person's.** A shared library needs
/// `-fPIC` and this is not a preference: `nts_env` is thread-local, the default
/// TLS model is local-exec, and linking that into a `.so` fails with
/// `relocation R_X86_64_TPOFF32 ... local-exec is incompatible with -shared`.
/// Twenty-two `build.sh` in this tree each carry their own answer to that.
///
/// The published surface becomes a linker version script rather than
/// `-fvisibility=hidden`, because the emitted headers carry no visibility
/// attributes -- hiding by default would hide the exports too. Without it a
/// two-function library exported 318 symbols, every internal of the runtime and
/// of the vendored dtoa among them, which is the collision
/// `apps/linux-brownfield` describes in a comment and had no field to prevent.
/// Compile the witness, where the program bound something native.
///
/// **Sixteen `build.sh` in this tree do this by hand**, each with its own copy of
/// `-Wall -Wextra -Werror -fsyntax-only`, and it is the check that makes a
/// generated binding a claim rather than an assertion: the witness declares no
/// symbol and defines no function, includes the real headers itself, and fails
/// to compile when what `nts` believes about a struct disagrees with them.
///
/// A build that links a program against a binding it has not checked has skipped
/// the one step that would catch a wrong offset, and a wrong offset is a silently
/// wrong answer rather than a link error.
fn check_witness(
    name: &str,
    out: &Utf8Path,
    native: &[(Utf8PathBuf, Utf8PathBuf)],
    tools: &Toolchain,
    cflags: &[String],
) -> Result<()> {
    let witness = out.join(nts_codegen_c::NATIVE_WITNESS_NAME);
    if !witness.exists() {
        return Ok(());
    }
    let mut command = tools.command();
    command
        .args(["-std=c11", "-Wall", "-Wextra", "-Werror", "-fsyntax-only"])
        .arg("-I")
        .arg(out.as_str());
    // **The package's own headers too.** The witness includes what the binding
    // named, and a binding over a package's own header names a file in that
    // package -- `native_witness.c` for `native-copy` includes `point.h`, which
    // is beside `point.c`. Only the generated headers were on the path, so the
    // check failed to compile for a reason that was not what it checks.
    let mut seen: Vec<&Utf8Path> = Vec::new();
    for (directory, _) in native {
        if !seen.contains(&directory.as_path()) {
            command.arg("-I").arg(directory.as_str());
            seen.push(directory.as_path());
        }
    }
    // **And a dependency's `--cflags`**, which the program and the package's C
    // are compiled with. Without them a header including `<gtk/gtk.h>` failed
    // here as a mismatch, in a build whose every other compile found it.
    command.args(cflags);
    command.arg(witness.as_str());
    let output = command
        .output()
        .with_context(|| format!("compiling the native witness for `{name}`"))?;
    if output.status.success() {
        return Ok(());
    }
    bail!(
        "the binding `{name}` was built against does not match the headers on this \
         machine:\n{}",
        String::from_utf8_lossy(&output.stderr)
    )
}

/// Compile everything this product is made of and link it into one artifact.
///
/// **Eight arguments, and they are eight different things**: what it is called,
/// what it declares, where it goes, what the emitter wrote, the native roots,
/// where objects are kept, the target, and what its packages pinned. A struct
/// grouping them would exist to satisfy a lint rather than to name anything --
/// which is the test the `Compiling` bundle passes and this does not.
#[allow(clippy::too_many_arguments)]
fn link_c(
    name: &str,
    product: &nts_build::config::Product,
    out: &Utf8Path,
    wrote: &Wrote,
    native: &[(Utf8PathBuf, Utf8PathBuf)],
    cache_dir: Option<&Utf8Path>,
    target: &nts_build::config::Target,
    needs: &nts_build::dependencies::Resolution,
) -> Result<Utf8PathBuf> {
    // **Before the witness, because the witness is compiled too.** A native
    // root is checked against the headers of the platform it will run on, and
    // doing that with the host compiler asks the wrong question.
    let tools = toolchain_for(name, target)?;
    check_witness(name, out, native, &tools, &needs.cflags)?;
    let addon = product.kind == "node-addon";
    let shared = product.kind == "shared-library" || addon;
    let library = product.kind == "shared-library" || product.kind == "static-library";
    let pic = library || addon;
    // An addon needs one header and no library. Asked before anything is
    // compiled, so a missing toolchain is a message rather than forty
    // `node_api.h: No such file` lines.
    let napi = if addon {
        // **Absolute before walking up**, because this climbs four levels out of
        // the output directory to find the project, and `nts build` with no
        // argument makes that `.nts/build/<product>/<target>` -- whose fourth
        // parent is `""`, not the project. So the search for `node_api.h` began
        // and ended in the current directory, and every addon in this tree
        // refused with "add `node-api-headers` to the project" on a checkout
        // that vendors the headers. The same build with an absolute project
        // path worked, which is the fourth time tonight that sentence has been
        // the diagnosis.
        let from = absolute(out);
        let directory = from.parent().and_then(Utf8Path::parent).and_then(Utf8Path::parent);
        let project = directory.and_then(Utf8Path::parent).unwrap_or_else(|| Utf8Path::new("."));
        Some(napi_include(project).ok_or_else(|| {
            anyhow!(
                "product `{name}` is a Node addon and `node_api.h` was not found. It is a \
                 build dependency: add `node-api-headers` to the project, or set \
                 NTS_NAPI_INCLUDE to a directory holding it"
            )
        })?)
    } else {
        None
    };

    // **A library initialises itself.**
    //
    // Module-level state is set by `module__init`, and a library that leaves
    // that to its consumer has an ABI whose first rule is unenforceable: forget
    // the call and `greeting` is null, which is a wrong answer rather than a
    // link error. The version script below then makes it worse by hiding the
    // symbol, so the consumer could not call it even knowing to.
    //
    // `.init_array` is what the platform provides for exactly this, it runs
    // before any consumer code, and it works the same in an archive. An
    // executable does not get one: `main.c` already calls it, and two calls
    // would evaluate the module twice.
    let mut sources = wrote.sources.clone();
    if library && wrote.initializes {
        let initialiser = out.join(AUTO_INIT_NAME);
        std::fs::write(
            &initialiser,
            "/* Generated by nts. Runs module evaluation when the library loads. */\n\
             extern void module__init(void);\n\
             __attribute__((constructor)) static void nts_auto_init(void) { module__init(); }\n",
        )
        .with_context(|| format!("writing {initialiser}"))?;
        sources.push(AUTO_INIT_NAME.to_owned());
    }

    // **Before anything is compiled**, because the alternative is what this
    // replaced: a raw `fatal error: 'uv.h' file not found` out of clang, forty
    // lines into a build, about a library the reader never named.
    if sources.iter().any(|source| source == nts_codegen_c::UV_HOST_SOURCE_NAME) {
        refuse_without_libuv(name, out, &tools, target, native, napi.as_deref(), &needs.cflags)?;
    }
    let cache = ObjectCache::new(cache_dir, &tools);
    let mut objects = Vec::new();
    let with = Compiling { cache: &cache, tools: &tools, cflags: &needs.cflags };
    compile_native(name, out, native, pic, &mut objects, &with)?;
    compile_program(name, out, &sources, native, pic, napi.as_deref(), &with, &mut objects)?;

    let artifact = out.join(artifact_name(name, product, target));
    if product.kind == "static-library" {
        {
            let mut command = std::process::Command::new("ar");
            command.arg("rcs").arg(artifact.as_str());
            for object in &objects {
                command.arg(object.as_str());
            }
            run(command, &format!("archiving `{name}`"))?;
        }
    } else {
        {
            let mut command = tools.command();
            if shared {
                command.arg("-shared");
                // **A Windows DLL is half an artifact without its import
                // library.** The linker emits one either way; unnamed, it takes
                // the first object's name -- this produced `program.c.lib`
                // beside `sdk.dll`, which is the file a consumer links against
                // under a name they could not guess. Named here so the two
                // agree, and reported below because an output nobody is told
                // about reads later as one that was never generated.
                if target.os == "windows" {
                    command.arg(format!(
                        "-Wl,--out-implib={}",
                        out.join(format!("{name}.lib"))
                    ));
                }
                if !addon {
                    hide_all_but_the_exports(&mut command, out, wrote)?;
                }
                if let Some(soname) = &product.soname {
                    command.arg(format!("-Wl,-soname,{soname}"));
                }
            }
            for object in &objects {
                command.arg(object.as_str());
            }
            command.args(["-Wl,--gc-sections", "-lm"]);
            // **After our own objects and before `-o`.** A static archive is
            // consumed left to right by the linker, so a `-l` that precedes the
            // objects needing it resolves nothing -- which is the failure mode
            // that reads as "the dependency did not work" rather than as an
            // ordering rule.
            for flag in &needs.libs {
                command.arg(flag);
            }
            // The libuv host is a translation unit like any other, so its
            // presence in what was written is the question -- not the product
            // kind, and not a flag somebody remembers.
            if sources.iter().any(|s| s == nts_codegen_c::UV_HOST_SOURCE_NAME) {
                command.arg("-luv");
            }
            // **`--no-undefined` where it can be used**, which is the earliest
            // an unresolved symbol can be caught and the cheapest place to say
            // so. Not for an addon: a `.node` resolves `napi_*` out of the host
            // process at load, so those are legitimately unresolved at link time
            // and there is no library to satisfy them from.
            if shared && !addon {
                command.arg("-Wl,--no-undefined");
            }
            command.arg("-o").arg(artifact.as_str());
            run(command, &format!("linking `{name}`"))?;
            if addon {
                refuse_unresolved(name, &artifact)?;
            }
        }
    }
    Ok(artifact)
}

/// An addon that would fail to load is not an artifact.
///
/// The linker cannot enforce this one -- see above -- so it is checked after the
/// fact, and it is worth checking rather than trusting: `emit-c --napi` emits a
/// call to `nts_napi_set_env`, which is **defined in `runtime/node/internal`**
/// and so is present for every node module in this tree and absent from a
/// standalone addon. The `.node` linked, exited zero, and died on `require` with
/// `symbol lookup error: undefined symbol: nts_napi_set_env`.
///
/// A build that writes a file nothing can load has half-emitted, which is the
/// one thing this command must not do.
fn refuse_unresolved(name: &str, artifact: &Utf8Path) -> Result<()> {
    let Ok(listed) = std::process::Command::new("nm").args(["-D", "-u"]).arg(artifact.as_str()).output()
    else {
        // No `nm` is not a build failure. It is one fewer check, said once.
        eprintln!("no `nm`, so `{name}` was not checked for unresolved symbols");
        return Ok(());
    };
    let text = String::from_utf8_lossy(&listed.stdout);
    let unresolved: Vec<&str> = text
        .lines()
        .filter_map(|line| line.split_whitespace().nth(1))
        // A versioned symbol names the library it comes from, so it is resolved.
        // The `napi_` family comes from the host, and the rest are the weak
        // symbols every shared object on this platform carries.
        .filter(|symbol| {
            !symbol.contains('@')
                && !symbol.starts_with("napi_")
                && !symbol.starts_with("node_api")
                && !symbol.starts_with("__")
                && !symbol.starts_with("_ITM_")
                && !symbol.starts_with("_Jv_")
                && !symbol.starts_with("_Unwind")
        })
        .collect();
    if unresolved.is_empty() {
        return Ok(());
    }
    bail!(
        "`{name}` links but cannot load: {} unresolved symbol(s), starting with `{}`. \
         A `.node` resolves the `napi_` family out of the host process; anything else \
         undefined is missing from the build",
        unresolved.len(),
        unresolved[0]
    )
}


/// Where artifacts land: `--out <dir>`, or `.nts/build` beside the project.
///
/// **Where output goes is the caller's business** in a way that backend, shape
/// and surface are not -- those are the config's. Every `build.sh` in this tree
/// takes an output directory as `$1` so a gate run can put one example's results
/// somewhere of its own, and a build tool insisting on `.nts/build` would be
/// telling its caller where its own scratch space is.
fn output_root(rest: &[String], tsconfig: &Utf8Path) -> Utf8PathBuf {
    rest.iter()
        .position(|arg| arg == "--out")
        .and_then(|at| rest.get(at + 1))
        .map_or_else(
            || tsconfig.parent().unwrap_or_else(|| Utf8Path::new(".")).join(".nts").join("build"),
            Utf8PathBuf::from,
        )
}

/// Where compiled objects are kept between builds.
///
/// **On unless turned off**, which is the opposite of how this started. `§34`
/// reserved `build.cache` and nothing read it, so a config declaring nothing got
/// no cache -- and the common project paid 0.96s per build to recompile a
/// runtime that had not changed. A build tool whose caching is opt-in is one
/// whose default is the slow one.
///
/// `local: false` turns it off, which is what a build that must not reuse
/// anything needs.
fn cache_directory(
    tsconfig: &Utf8Path,
    resolved: &nts_build::config::Resolved,
) -> Option<Utf8PathBuf> {
    let settings = resolved.build.as_ref().and_then(|build| build.cache.as_ref());
    (settings.and_then(|cache| cache.local) != Some(false)).then(|| {
        tsconfig
            .parent()
            .unwrap_or_else(|| Utf8Path::new("."))
            .join(settings.and_then(|cache| cache.directory.as_deref()).unwrap_or(".nts/cache"))
    })
}

/// A compiled object kept between builds, and what decides it is still valid.
///
/// **Measured before built.** A build of `examples/library` is 1.10s, of which
/// compiling `nts_runtime.c` is **0.96s** -- the emit is 0.06, the config
/// evaluation 0.02, the program's own compile 0.02 and the link 0.02. The
/// runtime is the same translation unit on every build of every project, and
/// recompiling it was the whole cost. Nothing else here was worth caching, and a
/// general action cache would have been the wrong shape for what the numbers
/// said.
///
/// **Re-measured on 2026-09-17 and the claim holds**: the same project builds
/// cold in **1.109s** and, with this cache warm and the snapshot cache hitting,
/// in **0.060s**. Recorded because a dated number that nobody re-runs becomes a
/// claim about a tree that no longer exists -- and this one turned out to be
/// still true, which is worth writing down for the same reason a refutation
/// would be.
///
///     cold                 1.109s    neither cache
///     objects only         0.074s    this cache
///     both                 0.060s
///
/// The decomposition on a *larger* project is the one that shows what each is
/// worth, because `examples/library` is small enough that the frontend is
/// cheap: `examples/workspace/apps/linux` goes 1.416s cold, 0.291s on this
/// cache alone, 0.112s on both.
///
/// # What makes an entry valid
///
/// The key is the source, the command line, and the compiler's version string,
/// which stands for the system headers. **Not the project's headers**, and the
/// first version's mistake was including them: it hashed every `.h` beside the
/// output, so adding one function to `main.ts` changed `program.h`, changed the
/// key of *every* object, and recompiled a runtime that does not include
/// `program.h` at all. A rebuild after a one-line edit cost the full 1.14s.
///
/// So validity is a **dependency list**, recorded beside the entry the first
/// time it is built: `-MMD` names exactly the headers that translation unit
/// read, and the entry is good while each still hashes to what it did. That is
/// the question "has anything this file reads changed", asked of the files it
/// actually reads.
struct ObjectCache {
    directory: Option<Utf8PathBuf>,
    /// The compiler's version string, standing in for the system headers.
    compiler: u64,
}

/// One cached compile: where the object is, and what it was built against.
struct Entry {
    object: Utf8PathBuf,
    deps: Utf8PathBuf,
}

fn hash_of(bytes: &[u8]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = rustc_hash::FxHasher::default();
    bytes.hash(&mut hasher);
    hasher.finish()
}

impl ObjectCache {
    /// **Keyed on the toolchain's identity as well as its version banner.**
    /// `zig cc -target x86_64-windows-gnu --version` and `zig cc -target
    /// aarch64-linux-gnu --version` print the same string, so hashing the
    /// banner alone would let an object built for Windows answer for Linux --
    /// a cache hit across platforms, which is the worst kind because the
    /// artifact links and is wrong.
    fn new(enabled: Option<&Utf8Path>, tools: &Toolchain) -> Self {
        let banner = tools
            .command()
            .arg("--version")
            .output()
            .map_or(0, |output| hash_of(&output.stdout));
        let compiler = banner ^ hash_of(tools.key().as_bytes());
        Self { directory: enabled.map(Utf8Path::to_path_buf), compiler }
    }

    fn entry(&self, source: &Utf8Path, arguments: &[String]) -> Option<Entry> {
        use std::hash::{Hash, Hasher};
        let directory = self.directory.as_ref()?;
        let mut hasher = rustc_hash::FxHasher::default();
        self.compiler.hash(&mut hasher);
        std::fs::read(source).ok()?.hash(&mut hasher);
        arguments.hash(&mut hasher);
        let key = format!("{:016x}", hasher.finish());
        Some(Entry {
            object: directory.join(format!("{key}.o")),
            deps: directory.join(format!("{key}.deps")),
        })
    }

    /// Whether every file the entry was built against still hashes the same.
    fn current(entry: &Entry) -> bool {
        let Ok(recorded) = std::fs::read_to_string(&entry.deps) else { return false };
        recorded.lines().all(|line| {
            line.split_once(' ').is_some_and(|(hash, path)| {
                std::fs::read(path).is_ok_and(|bytes| format!("{:016x}", hash_of(&bytes)) == hash)
            })
        })
    }

    /// Record what a compile read, from the depfile `-MMD` wrote.
    fn record(entry: &Entry, depfile: &Utf8Path) {
        let Ok(text) = std::fs::read_to_string(depfile) else { return };
        // Make syntax: `target: a b \<newline> c`. The target half is before
        // the first colon and is not a dependency.
        let listed = text.split_once(':').map_or("", |(_, rest)| rest);
        let mut recorded = String::new();
        for path in listed.split_whitespace().filter(|word| *word != "\\") {
            if let Ok(bytes) = std::fs::read(path) {
                use std::fmt::Write;
                let _ = writeln!(recorded, "{:016x} {path}", hash_of(&bytes));
            }
        }
        drop(std::fs::create_dir_all(entry.object.parent().unwrap_or(Utf8Path::new("."))));
        drop(std::fs::write(&entry.deps, recorded));
    }
}

/// Compile one translation unit, reusing the object when nothing it reads has
/// changed.
///
/// A hit is a copy rather than a hardlink: a hardlinked object shares inodes
/// with the cache, and a later build writing through the link would corrupt an
/// entry every other project reads.
fn compile_one(
    cache: &ObjectCache,
    tools: &Toolchain,
    source: &Utf8Path,
    object: &Utf8Path,
    arguments: &[String],
    what: &str,
) -> Result<()> {
    let entry = cache.entry(source, arguments);
    if let Some(entry) = &entry
        && entry.object.exists()
        && ObjectCache::current(entry)
    {
        std::fs::copy(&entry.object, object).with_context(|| format!("reusing {}", entry.object))?;
        return Ok(());
    }
    let depfile = Utf8PathBuf::from(format!("{object}.d"));
    let mut command = tools.command();
    command.args(arguments);
    if entry.is_some() {
        command.args(["-MMD", "-MF"]).arg(depfile.as_str());
    }
    run(command, what)?;
    if let Some(entry) = &entry {
        drop(std::fs::create_dir_all(entry.object.parent().unwrap_or(Utf8Path::new("."))));
        // A cache that cannot be written is not a build failure. It is the
        // build it would have been without one.
        if std::fs::copy(object, &entry.object).is_ok() {
            ObjectCache::record(entry, &depfile);
        }
    }
    Ok(())
}

/// Compile the package's own C alongside the program's.
///
/// `sources({ dir })` is a directory of translation units a person wrote, and
/// the only thing separating them from the generated ones is that. Its own
/// directory is on the include path, because a header beside a `.c` is how C is
/// written.
fn compile_native(
    name: &str,
    out: &Utf8Path,
    native: &[(Utf8PathBuf, Utf8PathBuf)],
    pic: bool,
    objects: &mut Vec<Utf8PathBuf>,
    with: &Compiling<'_>,
) -> Result<()> {

    for (directory, source) in native {
        let object = out.join(format!("{}.o", source.file_name().unwrap_or("native")));
        let mut arguments: Vec<String> = ["-std=c11", "-O2", "-ffunction-sections", "-fdata-sections"]
            .iter()
            .map(|flag| (*flag).to_owned())
            .collect();
        arguments.push("-I".to_owned());
        arguments.push(directory.to_string());
        arguments.push("-I".to_owned());
        arguments.push(out.to_string());
        if pic {
            arguments.push("-fPIC".to_owned());
        }
        // A dependency's include directories, which is the half of `pkg-config`
        // that a compile needs and a link does not.
        arguments.extend(with.cflags.iter().cloned());
        arguments.extend(["-c".to_owned(), source.to_string(), "-o".to_owned(), object.to_string()]);
        compile_one(
            with.cache,
            with.tools,
            source,
            &object,
            &arguments,
            &format!("compiling {source} for `{name}`"),
        )?;
        objects.push(object);
    }
    Ok(())
}

/// What the file is called.
///
/// `soname` overrides it where a library must match a name it did not choose;
/// otherwise it is derived, which is what that field's documentation promises.
/// **The extension is the target's, not the host's.** A `windows` product built
/// here used to come out `libsdk.so` -- an ELF shared object under a Linux
/// name, for a platform that loads neither. That was invisible while
/// `target.windows()` defaulted to the llvm backend and refused before reaching
/// this, which is the shape of a bug kept alive by an unrelated refusal.
///
/// `soname` still wins where it is given: a library that must match a name it
/// did not choose is exactly what that field is for.
fn artifact_name(
    name: &str,
    product: &nts_build::config::Product,
    target: &nts_build::config::Target,
) -> String {
    let windows = target.os == "windows";
    let apple = matches!(target.os.as_str(), "macos" | "ios");
    match product.kind.as_str() {
        "shared-library" => product.soname.clone().unwrap_or_else(|| {
            if windows {
                format!("{name}.dll")
            } else if apple {
                format!("lib{name}.dylib")
            } else {
                format!("lib{name}.so")
            }
        }),
        "static-library" if windows => format!("{name}.lib"),
        "static-library" => format!("lib{name}.a"),
        "node-addon" => format!("{name}.node"),
        _ if windows => format!("{name}.exe"),
        _ => name.to_owned(),
    }
}

/// Narrow a shared library's dynamic symbol table to what the entry exports.
///
/// **An addon is not given this treatment**, which is why the caller decides
/// rather than this function. What an addon publishes is
/// `napi_register_module_v1`, which node looks up by name after `dlopen`; its
/// TypeScript exports are reached through the registration rather than as
/// symbols, so hiding everything but the entry's exports would hide exactly the
/// one that matters.
fn hide_all_but_the_exports(
    command: &mut std::process::Command,
    out: &Utf8Path,
    wrote: &Wrote,
) -> Result<()> {
    let script = out.join("exports.map");
    std::fs::write(&script, version_script(&wrote.published))
        .with_context(|| format!("writing {script}"))?;
    command.arg(format!("-Wl,--version-script={script}"));
    // **A name in the script that no symbol answers to is an error, not a
    // no-op.** By default `ld` accepts an unmatched pattern silently, which is
    // how `global: Counter;` and a doubled `global: stdin_;` both went
    // unnoticed: the script looked like it published two things, `local: *` hid
    // the real symbol, and the `.so` came out short with no message. This turns
    // the next such disagreement into a link failure naming the symbol.
    //
    // It catches a name nothing answers to. It cannot catch a name answering to
    // the *wrong* symbol -- `stdin_` for a global whose symbol is `stdin__` --
    // because both exist; that one is closed by `published` coming from the
    // emitter, which is the same place the header's "C symbol:" comment does.
    command.arg("-Wl,--no-undefined-version");
    // **Said out loud, because from the outside it looks like an export.** The
    // product's manifest promises "publishes what `./src/main.ts` exports" and
    // the header carries the name; only the symbol table disagrees, and nobody
    // reads that.
    //
    // Reported from here rather than beside the emission: a static archive does
    // keep a class's methods as symbols, so there the name is undeclared rather
    // than absent. It is this branch, where `local: *` is about to hide
    // everything unnamed, that turns "no declaration" into "not in the artifact".
    for name in &wrote.published_without_a_symbol {
        println!(
            "  `{name}` is exported but crosses no C symbol: \
             the header carries its layout, not a way to call it"
        );
    }
    Ok(())
}

/// A version script naming exactly what crosses the ABI.
fn version_script(published: &[String]) -> String {
    // **An empty `global:` is a syntax error, not an empty set.** `ld` reads
    // `global:` immediately followed by `local:` as a malformed script and says
    // `syntax error in VERSION script` naming the `local:` line, which is not
    // where the problem is. A program whose every export lowering refused has
    // nothing to publish and still has to link.
    if published.is_empty() {
        return String::from("{\n  local:\n    *;\n};\n");
    }
    let mut text = String::from("{\n  global:\n");
    for symbol in published {
        text.push_str("    ");
        text.push_str(symbol);
        text.push_str(";\n");
    }
    text.push_str("  local:\n    *;\n};\n");
    text
}

/// The products this run builds: one by name, or all of them.
fn chosen_products(
    resolved: &nts_build::config::Resolved,
) -> Result<Vec<(&str, &nts_build::config::Product)>> {
    let named = requested_product()?;
    Ok(match named.as_deref() {
        // One product by name, and `product` reports what a config declares when
        // the name is not one of them.
        Some(_) => nts_build::config::product(resolved, named.as_deref())?.into_iter().collect(),
        // Every product. A config with several is the normal case -- a shared
        // library beside a static archive of the same code is two -- and
        // building all of them is what "build this project" means.
        None => resolved.products.iter().map(|(k, v)| (k.as_str(), v)).collect(),
    })
}

/// Stop where a package this product depends on does not claim the target.
fn refuse_unclaimed_target(
    name: &str,
    config_roots: &[Utf8PathBuf],
    target: &nts_build::config::Target,
    tsconfig: &Utf8Path,
) -> Result<()> {
    let unsatisfied = unsatisfied_claims(config_roots, target, tsconfig);
    if unsatisfied.is_empty() {
        return Ok(());
    }
    bail!(
        "product `{name}` targets {} and {} package(s) it depends on do not claim it: \
         {}. A package's `targets` is what it says it supports, so either this product \
         is not for that platform or the package's claim is out of date",
        target.id,
        unsatisfied.len(),
        unsatisfied.join("; ")
    )
}

/// A package whose support claim does not cover the target being built.
///
/// **The check `tooling/config`'s own doc promised and nobody wrote.**
/// `Config.targets` is "a claim rather than a preference -- there is no
/// biometric prompt on a Linux server. A consumer whose target is outside this
/// set should fail at *configuration* time, naming the package and the target,
/// rather than at link time with a missing symbol." It was read in exactly one
/// place, to decide which bindings to generate for a package building itself.
///
/// `examples/workspace` is built around this: `biometrics` claims
/// `android-29` and `ios-17` only, `apps/linux` depends on it, and that is
/// described in the fixture as the constraint being *violated* there. Nothing
/// said so.
///
/// Compared with `claim_covers`, the same rule the native roots and the
/// manifests use -- a versioned claim is a floor -- so a package claiming
/// `android-29` covers an app compiling against `android-36` with a floor of 29
/// and does not cover one running back to 21.
fn unsatisfied_claims(
    config_roots: &[Utf8PathBuf],
    target: &nts_build::config::Target,
    tsconfig: &Utf8Path,
) -> Vec<String> {
    let own = nts_build::config::beside(tsconfig);
    let mut found = Vec::new();
    for config_path in config_roots {
        if own.as_ref() == Some(config_path) {
            continue;
        }
        let Ok(resolved) = nts_build::config::resolve(config_path) else { continue };
        // No claim is a package that runs anywhere, which is most of them.
        let Some(claims) = resolved.targets.as_ref().filter(|it| !it.is_empty()) else { continue };
        if claims.iter().any(|claim| {
            nts_build::config::claim_covers(
                claim,
                &target.id,
                target.minimum_version.as_deref(),
            )
        }) {
            continue;
        }
        let package = config_path.parent().unwrap_or_else(|| Utf8Path::new("."));
        found.push(format!("{package} claims {}", claims.join(", ")));
    }
    found.sort();
    found
}

/// The targets of a product this run should build.
///
/// **`--os` names the machine, because one product can declare several and a
/// machine can only build its own.** `apps/node-brownfield` fans an addon over
/// macOS, Linux and Windows; on a Linux box the macOS target is a refusal, and
/// that refusal is right -- but with no way to say which one you meant, the
/// correct refusal makes the whole product unbuildable everywhere.
///
/// A filter rather than skipping what cannot be built: silently dropping a
/// target reports success for an artifact that does not exist, and the count at
/// the end would be a true number about a smaller question.
fn targets_for<'a>(
    name: &str,
    product: &'a nts_build::config::Product,
    only_os: Option<&str>,
) -> Result<Vec<&'a nts_build::config::Target>> {
    let Some(os) = only_os else { return Ok(product.targets.iter().collect()) };
    let wanted: Vec<&nts_build::config::Target> =
        product.targets.iter().filter(|target| target.os == os).collect();
    if wanted.is_empty() {
        let available: Vec<&str> = product.targets.iter().map(|t| t.os.as_str()).collect();
        bail!(
            "product `{name}` has no target for `--os {os}`. It declares: {}",
            available.join(", ")
        )
    }
    Ok(wanted)
}

/// Emit the build-system hooks a config's `integrate` names.
///
/// **A hook is an adapter, and it has to declare inputs and outputs.** Every
/// ecosystem has a "run this before compiling" step and every one of them is
/// different; what they share is that a host which is not told what the step
/// consumes and produces re-runs it on every build. `apps/node-brownfield` says
/// so about its own: "`prepare` runs on install, there is no input/output
/// declaration, so every install rebuilds" -- which is a property of npm rather
/// than of this, and is written down rather than papered over.
///
/// **Two are emitted and five are refused by name.** `cmake` and `npm` are the
/// two whose host is installed here, so they are the two whose output could be
/// *run* rather than merely written. Emitting an adapter nobody can execute is
/// how a generated file that does not work gets shipped -- this lane has
/// already found one of those in a `.so` this month -- so the rest say they are
/// not written rather than producing text that looks like an answer.
fn emit_integrations(
    resolved: &nts_build::config::Resolved,
    tsconfig: &Utf8Path,
    root: &Utf8Path,
) -> Result<()> {
    if resolved.integrate.is_empty() {
        return Ok(());
    }
    let project = tsconfig.parent().unwrap_or_else(|| Utf8Path::new("."));
    for hook in &resolved.integrate {
        let written = match hook.as_str() {
            "cmake" => write_cmake_hook(resolved, project, root)?,
            "npm" => write_npm_hook(project, root)?,
            // Unreachable: `refuse_unwritable_integrations` runs before the
            // emitter and stops on exactly this. Kept rather than made
            // `unreachable!()` so the two cannot drift into disagreeing about
            // which hooks exist.
            other => bail!("no adapter for `{other}`"),
        };
        println!("  hook: {written}");
    }
    Ok(())
}

/// Stop at a hook this cannot write, **before anything is emitted**.
///
/// `emit_integrations` runs after the products, because a hook names the
/// artifacts they produce. That is the wrong place to *refuse* from: with the
/// check there, `apps/windows-brownfield` cross-compiled a DLL and then failed
/// on its `msbuild` hook, which is a build that half-emitted and said so
/// afterwards -- the thing `refuse_unpackaged` exists to prevent one layer up.
///
/// Deciding is cheap and writing is not, so they separate cleanly.
fn refuse_unwritable_integrations(resolved: &nts_build::config::Resolved) -> Result<()> {
    for hook in &resolved.integrate {
        if matches!(hook.as_str(), "cmake" | "npm") {
            continue;
        }
        bail!(
            "this project's `integrate` names `{hook}`, and the adapter for it is not \
             written. Emitting one that nobody here can run is how a generated file \
             that does not work gets shipped -- `cmake` and `npm` are the two this \
             emits, and they are the two whose host is here to run them. Remove it \
             from `integrate`, or invoke `nts build` from your {hook} build directly"
        )
    }
    Ok(())
}

/// An absolute, normalised path, for a file a *different* build system reads.
///
/// **Measured, not predicted.** The first `CMake` hook wrote the paths as this
/// build saw them -- `examples/workspace/apps/linux-brownfield/./nts/sdk.ts` --
/// and `CMake` resolves a relative path against its own build directory. It
/// *configured* cleanly and failed at build with `No rule to make target`,
/// which is the exact shape of an adapter that was written and never run.
///
/// `canonicalize` also removes the `./` a joined `entry` leaves behind.
fn absolute(path: &Utf8Path) -> Utf8PathBuf {
    // **The empty path is the current directory, not nothing.** `nts build
    // tsconfig.json` gives a parent of `""`, `canonicalize("")` fails, and the
    // fallback wrote an empty project into the hook -- so `CMake` ran `nts build
    // --out ...` with no project, in its own build directory, and got "no
    // `tsconfig.json` here". Found by running the test with a relative path,
    // which is the only reason it was reachable at all.
    let path = if path.as_str().is_empty() { Utf8Path::new(".") } else { path };
    std::fs::canonicalize(path)
        .ok()
        .and_then(|p| Utf8PathBuf::from_path_buf(p).ok())
        .unwrap_or_else(|| path.to_owned())
}

/// A `CMake` config package, so a consumer writes `find_package` and not a path.
///
/// `apps/linux-brownfield` states the shape: "an `add_custom_command` plus a
/// generated `CMake` config package, so a consumer writes `find_package(Acme)`
/// rather than a path". Both halves matter -- the imported target is what a
/// consumer links, and the custom command is what makes their build re-run ours
/// when a source changes instead of once at configure time.
///
/// **`DEPENDS` on the TypeScript, `OUTPUT` on the artifact**, which is the
/// input/output declaration the adapter exists to carry. Without it `CMake` has
/// no reason to re-run anything and a consumer's incremental build silently
/// compiles stale TypeScript.
fn write_cmake_hook(
    resolved: &nts_build::config::Resolved,
    project: &Utf8Path,
    root: &Utf8Path,
) -> Result<Utf8PathBuf> {
    let project = absolute(project);
    let root = absolute(root);
    let mut text = String::from(
        "# Generated by nts. Include this from your CMakeLists.txt:\n\
         #     include(${CMAKE_CURRENT_LIST_DIR}/nts.cmake)\n\
         # then link the targets it defines.\n\
         #\n\
         # Regenerated by `nts build`; edit the nts.config.ts instead.\n\n\
         find_program(NTS_EXECUTABLE nts REQUIRED)\n\n",
    );
    // **One rule per (product, target), not per product.** Taking
    // `targets.first()` names one artifact for a product that declares
    // several, so a consumer linking the second one would find a rule that
    // never builds it -- and `CMake` would report the missing file rather than
    // the missing rule. `apps/node-brownfield` declares four machines for one
    // addon, which is the ordinary case rather than the exotic one.
    for (name, product) in &resolved.products {
        for target in &product.targets {
        let artifact = root.join(name).join(target_directory(target)).join(artifact_name(
            name,
            product,
            target,
        ));
        // **The plain name where it is unambiguous.** `apps/linux-brownfield`
        // asks for a consumer writing `find_package(Acme)` rather than a path,
        // and `nts::sdk_linux_gnu_x86_64` is a path with underscores. A product
        // with one target gets `nts::sdk`; one with several has to say which,
        // because two targets cannot both answer to one name.
        let label = if product.targets.len() == 1 {
            name.clone()
        } else {
            format!("{name}_{}", target_directory(target).replace(['-', '.'], "_"))
        };
        let entry = absolute(&project.join(&product.entry));
        let kind = match product.kind.as_str() {
            "static-library" => "STATIC",
            _ => "SHARED",
        };
        // `IMPORTED GLOBAL` so a consumer can link it from any directory, and
        // the custom target is what carries the dependency: an imported target
        // cannot itself have a build rule.
        let _ = write!(
            text,
            "# --- {name} for {} ---\n\
             add_custom_command(\n\
             \x20 OUTPUT {artifact}\n\
             \x20 COMMAND ${{NTS_EXECUTABLE}} build {project} --out {root}\n\
             \x20 DEPENDS {entry}\n\
             \x20 COMMENT \"nts: building {name}\"\n\
             \x20 VERBATIM)\n\
             add_custom_target(nts_{label}_build DEPENDS {artifact})\n\
             add_library(nts::{label} {kind} IMPORTED GLOBAL)\n\
             set_target_properties(nts::{label} PROPERTIES IMPORTED_LOCATION {artifact})\n\
             add_dependencies(nts::{label} nts_{label}_build)\n\n",
            target.id
        );
        }
    }
    let path = root.join("nts.cmake");
    std::fs::create_dir_all(&root).with_context(|| format!("creating {root}"))?;
    std::fs::write(&path, text).with_context(|| format!("writing {path}"))?;
    Ok(path)
}

/// An npm lifecycle script, and the line to add to `package.json`.
///
/// **The weakest of the seven, and the fixture says so**: `prepare` runs on
/// install and npm has nowhere to declare inputs and outputs, so every install
/// rebuilds. That is a property of npm rather than of this, and writing it into
/// the generated file is better than a consumer discovering it.
fn write_npm_hook(project: &Utf8Path, root: &Utf8Path) -> Result<Utf8PathBuf> {
    // Absolute for the same reason `CMake`'s are: npm runs `prepare` with the
    // package root as the cwd, which is not where this build was invoked from.
    let project = absolute(project);
    let root = absolute(root);
    let path = root.join("nts-prepare.mjs");
    std::fs::create_dir_all(&root).with_context(|| format!("creating {root}"))?;
    std::fs::write(
        &path,
        format!(
            "// Generated by nts. Add to package.json:\n\
             //     \"scripts\": {{ \"prepare\": \"node {path}\" }}\n\
             //\n\
             // npm has nowhere to declare what this consumes or produces, so it runs\n\
             // on every install rather than when a source changed. That is npm's\n\
             // limitation and not one this can fix from here.\n\
             import {{ spawnSync }} from \"node:child_process\";\n\
             const nts = process.env.NTS_BIN ?? \"nts\";\n\
             // `prepare` runs on the machine installing the package, and a\n\
             // node addon is declared for several. node spells two of them its\n\
             // own way, so this is where that vocabulary is translated -- once,\n\
             // at the boundary where it arrives.\n\
             const here = {{ darwin: \"macos\", win32: \"windows\" }}[process.platform]\n\
             \x20 ?? process.platform;\n\
             const done = spawnSync(\n\
             \x20 nts,\n\
             \x20 [\"build\", {project:?}, \"--out\", {root:?}, \"--os\", here],\n\
             \x20 {{ stdio: \"inherit\" }},\n\
             );\n\
             if (done.error) {{\n\
             \x20 console.error(`nts: could not run ${{nts}} -- is it on PATH?`);\n\
             \x20 process.exit(1);\n\
             }}\n\
             process.exit(done.status ?? 1);\n"
        ),
    )
    .with_context(|| format!("writing {path}"))?;
    Ok(path)
}

/// Where one target's output goes, under a product's directory.
///
/// The id and the architecture, because the id alone does not separate them: a
/// Node addon for darwin-arm64 and one for linux-x64 share `node-api-8`, which
/// is the point of that id and exactly why it cannot be the directory name.
fn target_directory(target: &nts_build::config::Target) -> String {
    match &target.arch {
        Some(arch) => format!("{}-{arch}", target.id),
        None => target.id.clone(),
    }
}

/// What one emitter invocation has been told to produce.
///
/// **The product is passed, not re-derived.** `nts build` iterates a config's
/// products and calls an emitter for each; if the emitter then resolved the
/// config again and picked by `--product`, it would pick a *different* one --
/// or refuse as ambiguous -- while the loop thought it had said which. Two
/// answers to "which product", one of them wrong, in the same process.
///
/// `None` is a bare `emit-*`, which has no product and asks the config itself.
#[derive(Clone, Copy)]
struct Emission<'a> {
    shape: Shape,
    /// The product and the name it is declared under, when a build chose it.
    product: Option<(&'a str, &'a nts_build::config::Product)>,
    /// Whether the caller goes on to compile and link what is written.
    ///
    /// `emit-c --out` ends by printing the `cc` command a person now has to
    /// run, which is right for `emit-c` and is noise from `nts build` -- it
    /// prints a command it has already run, and a reader who pastes it gets a
    /// second, differently-flagged copy of the artifact they already have.
    linking: bool,
}

impl Emission<'_> {
    /// A bare `emit-*`: the flags are all it has to go on.
    fn from_flags() -> Self {
        Self { shape: Shape::from_flags(), product: None, linking: false }
    }
}

/// The name a `--product` flag selects, when a config declares more than one.
fn requested_product() -> Result<Option<String>> {
    let args: Vec<String> = std::env::args().collect();
    let Some(at) = args.iter().position(|arg| arg == "--product") else {
        return Ok(None);
    };
    // **A flag with no value is a mistake, not a default.** `--product` at the
    // end of the line selected nothing and the build quietly did every product,
    // which is the shape this lane keeps finding: a flag that parses, does
    // nothing, and reports success.
    match args.get(at + 1) {
        Some(name) if !name.starts_with("--") => Ok(Some(name.clone())),
        _ => bail!("`--product` needs the name of a product to build"),
    }
}

/// The reachability roots this invocation names, or `None` for every export.
///
/// Three sources, in this order, and the order is the claim:
///
/// 1. **`--entry`**, which names roots outright.
/// 2. **`--main`**, which says the product is an executable -- so a module's
///    exports are not roots, because nothing outside the program can call them,
///    and the entry is module evaluation, because that is what an executable is.
/// 3. **`exports:` in `nts.config.ts`**, which is the same claim written down
///    once instead of passed on every invocation.
///
/// `None` is `Roots::EveryExport`, which is what a library with no narrowing is:
/// every export is a root and every root's signature is its published ABI.
///
/// A flag beats the file because a flag is what you type to answer a question
/// about this run. The file is not a default the flag overrides so much as the
/// same statement made durably, and where both are present the transient one is
/// the one that was meant.
fn selected_roots(shape: Shape) -> Option<Vec<String>> {
    let named = entry_names();
    let mut roots = match (named.is_empty(), shape == Shape::Executable) {
        (false, _) => named,
        (true, true) => Vec::new(),
        // Nothing on the command line names roots. A configured product may
        // still narrow the surface, which `configured_surface` answers.
        (true, false) => return None,
    };
    // Module evaluation is a root in the same sense a named entry is: nothing
    // *calls* it, and the program is wrong without it. The no-`--entry` arm has
    // always known that; the named arm dropped it, and `nts-bench` had to push
    // it back with a comment saying why.
    //
    // It surfaces as a wrong **answer** rather than a link error, which is what
    // makes it worth fixing rather than documenting. The JVM lane found
    // `symbol-keyed-map --entry work` printing 32768 against node's 10240: five
    // module-level `const` symbols stayed null, five distinct map keys collapsed
    // into one, and every lookup hit it. 24 of the 60 bench cases have a
    // `module#init`.
    //
    // Worse, their sweep reported `agree` for two days -- `java` and `dalvikvm`
    // were bit-identical on a program that was not the benchmark. Two runtimes
    // agreeing is what a wrong program does too.
    if !roots.iter().any(|name| name == hir::lower::MODULE_INIT) {
        roots.push(hir::lower::MODULE_INIT.to_owned());
    }
    Some(roots)
}

/// The product this build is for, if a config beside the tsconfig declares one.
///
/// **Absent at every step is not an error.** Most projects have no config and a
/// config need not declare products -- both mean "nothing here says what is
/// being built", which is the case `Roots::EveryExport` is the safe answer to.
/// What *is* an error is a config that exists and cannot be read, or one with
/// several products and no `--product` to choose between them: emitting an
/// artifact nobody asked for, under a name that says otherwise, is worse than
/// stopping.
fn configured_product(tsconfig: &Utf8Path) -> Result<Option<(String, nts_build::config::Product)>> {
    let Some(path) = nts_build::config::beside(tsconfig) else { return Ok(None) };
    let resolved = nts_build::config::resolve(&path)?;
    let named = requested_product()?;
    let Some((name, product)) = nts_build::config::product(&resolved, named.as_deref())? else {
        return Ok(None);
    };
    Ok(Some((name.to_owned(), product.clone())))
}

/// What a configured product contributes to lowering: its entry file, and the
/// fact that its surface is that entry's.
///
/// **This is what `exports: [...]` used to do, without the list.** That field
/// was a hand-written set of the names crossing the ABI, and it was a second
/// statement of what the entry module already exports. It only had a question
/// to answer because the default root set is `EveryExport`, which is wider than
/// any artifact this compiler emits: a helper exported so a sibling module can
/// import it stayed a root, and getting it out needed a list. Naming the entry
/// -- which a product must do anyway, to be built at all -- says the same thing
/// and cannot disagree with the source.
///
/// A `--main` or `--entry` on the command line has already won by the time this
/// is asked; it returns `None` for an executable, whose roots are its entry
/// points rather than a published surface.
fn configured_surface(
    tsconfig: &Utf8Path,
    snapshot: &nts_semantic_schema::SemanticSnapshot,
    emission: Emission,
) -> Result<Option<Vec<String>>> {
    if !entry_names().is_empty() || emission.shape == Shape::Executable {
        return Ok(None);
    }
    // Told, or asked. `nts build` has already chosen; a bare `emit-*` has not.
    let chosen = match emission.product {
        Some((name, product)) => Some((name.to_owned(), product.clone())),
        None => configured_product(tsconfig)?,
    };
    let Some((name, product)) = chosen else { return Ok(None) };
    let directory = tsconfig.parent().unwrap_or_else(|| Utf8Path::new("."));
    let entry = directory.join(&product.entry);
    let matched = nts_frontend_ts::entry_uris_for(std::slice::from_ref(&entry), snapshot);
    if matched.is_empty() {
        bail!(
            "product `{name}` names `{}` as its entry and no source in this program is \
             that file. The tsconfig decides what the program contains; this decides which \
             of it is the product's surface, so the two have to agree",
            product.entry
        );
    }
    // Said out loud, because it changes what is emitted and was not asked for on
    // this command line. A narrowed surface that happens silently is
    // indistinguishable from a compiler that lost the function.
    eprintln!("{}: product `{name}` publishes what `{}` exports", FILE_LABEL, product.entry);
    Ok(Some(matched))
}

/// What the notice above calls the config, without re-deriving the path.
const FILE_LABEL: &str = nts_build::config::FILE_NAME;

fn foreign_tables(
    snapshot: &nts_semantic_schema::SemanticSnapshot,
) -> hir::runtime::ForeignTable {
    let mut out = rustc_hash::FxHashMap::default();
    for (index, source) in snapshot.sources.iter().enumerate() {
        let path = source.display_path.as_str();
        let Some(stem) = path.strip_suffix(".d.ts") else { continue };
        let Ok(text) = std::fs::read_to_string(format!("{stem}.bind")) else { continue };
        let rows = match nts_jvm_emitter::bind::read_table(&text) {
            Ok(rows) => rows,
            Err(why) => {
                eprintln!("{stem}.bind: {why}");
                continue;
            }
        };
        for row in rows {
            let kind = match row.call {
                nts_jvm_emitter::bind::Call::Static => hir::runtime::ForeignKind::Static,
                nts_jvm_emitter::bind::Call::Virtual => hir::runtime::ForeignKind::Virtual,
                nts_jvm_emitter::bind::Call::Interface => hir::runtime::ForeignKind::Interface,
                nts_jvm_emitter::bind::Call::Special => hir::runtime::ForeignKind::Special,
                nts_jvm_emitter::bind::Call::Field => hir::runtime::ForeignKind::Field,
                nts_jvm_emitter::bind::Call::StaticField => hir::runtime::ForeignKind::StaticField,
            };
            let Ok(index) = u32::try_from(index) else { continue };
            let Ok(end) = u32::try_from(row.end) else { continue };
            out.insert((index, end), hir::runtime::ForeignCall { key: row.key, kind });
        }
    }
    out
}

/// The memory provider this invocation selected.
///
/// **One answer, because two disagreeing is the failure it prevents.** `emit_c`
/// read `--rc` itself to decide whether to print the `-DNTS_PROVIDER_RC` note,
/// and `emit_options` read it to pick the provider. The note exists because
/// compiling the runtime without that define while the program counts references
/// balances every count and still grows the heap -- so a version of this where
/// the two reads drifted would print the wrong advice about the quiet failure it
/// was written to prevent.
fn selected_provider() -> hir::Provider {
    // NoGC stays the default: it is what RFC 9.1 says it is, and choosing a
    // provider silently is exactly what that section forbids.
    if std::env::args().any(|arg| arg == "--rc") {
        hir::Provider::ReferenceCounting
    } else {
        hir::Provider::NoGc
    }
}

fn emit_options<'a>(
    entry: Option<&'a [String]>,
    entry_files: &'a [String],
    foreign: &'a hir::runtime::ForeignTable,
    configured: Option<hir::reachable::Roots<'a>>,
) -> hir::Options<'a> {
    // **`!entry.is_empty()` was never false.** This read the flags itself and
    // asked `entry.is_empty()`, and the entry list always held at least
    // `MODULE_INIT` -- so the test was true on every invocation and the
    // *library* arm below was unreachable code. What that costs is the whole
    // surface: with `Roots::Entry(["module#init"])` the only functions kept are
    // the ones module evaluation reaches, so an exported function nothing calls
    // internally is pruned before any backend sees it.
    //
    // `None` now means every export, and it is a value rather than a predicate
    // over `std::env::args()` read from inside a function that has no other
    // business with the command line. `selected_roots` is the one place the
    // flags and the config are read.
    hir::Options {
        provider: selected_provider(),
        roots: entry.map_or_else(
            || configured.unwrap_or(hir::reachable::Roots::EveryExport),
            hir::reachable::Roots::Entry,
        ),
        // Two different questions that both read as "where does it start".
        // `roots` is what reachability keeps and is named in *functions*;
        // this is which source files the project called its product, and it
        // decides whose exports the addon publishes. A tsconfig with no
        // `files` array gives an empty slice and the old inference stands.
        entry_files,
        foreign,
        ..hir::Options::default()
    }
}

fn emit_llvm(tsconfig: &Utf8Path, emission: Emission) -> Result<()> {
    let tsgo_binary = frontend_binary();
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;
    report_snapshot_diagnostics(&snapshot)?;
    let entry = selected_roots(emission.shape);
    // The product's entry replaces the tsconfig's `files` when a config names
    // one, so `public_api` -- what `Roots::EntrySurface` roots at -- is computed
    // from the file the build says is the product.
    let (entry_files, configured) = match configured_surface(tsconfig, &snapshot, emission)? {
        Some(files) => (files, Some(hir::reachable::Roots::EntrySurface)),
        None => (nts_frontend_ts::entry_uris(tsconfig, &snapshot), None),
    };
    let prepared = match hir::prepare_with(
        &snapshot,
        &emit_options(entry.as_deref(), &entry_files, &foreign_tables(&snapshot), configured),
    ) {
        Ok(prepared) => prepared,
        Err(problems) => {
            for problem in &problems {
                eprintln!("invalid HIR: {problem:?}");
            }
            bail!("refusing to emit code from invalid HIR");
        }
    };
    // The lowering's refusals, not just the backend's. Printing only the
    // second is how this command answered an empty module for a program with
    // two refusals in it: `emit-c` reported them and this did not, so the
    // module looked like a backend that had rendered everything asked of it.
    for diagnostic in &prepared.diagnostics {
        eprintln!(
            "{}: {} {}",
            where_it_is(&snapshot, &diagnostic.primary),
            diagnostic.code,
            diagnostic.message
        );
    }
    let emitted = nts_codegen_llvm::emit(&prepared.program);
    for diagnostic in &emitted.diagnostics {
        eprintln!("  declined: {} {}", diagnostic.code, diagnostic.message);
    }
    print!("{}", emitted.text);
    Ok(())
}

/// `nts emit-jvm <tsconfig> [--out <dir>] [--text]` — the same program, as
/// class files.
///
/// `--out` writes the classes *and* the runtime jar, which is what it takes to
/// run anything: `java -cp <dir>:<dir>/nts-runtime.jar nts.gen.Program`.
/// Without it nothing is written, because a class file is bytes and printing
/// them to a terminal helps nobody -- `--text` is what to read instead.
/// Returns whether the program has module evaluation to run, which is what an
/// executable's launcher calls. Derived the same way `write_standalone` derives
/// it for the C lane, so the two cannot disagree about what an entry point is.
fn emit_jvm(
    tsconfig: &Utf8Path,
    out: Option<&Utf8Path>,
    text: bool,
    emission: Emission,
) -> Result<bool> {
    let tsgo_binary = frontend_binary();
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;
    report_snapshot_diagnostics(&snapshot)?;
    let entry = selected_roots(emission.shape);
    // The product's entry replaces the tsconfig's `files` when a config names
    // one, so `public_api` -- what `Roots::EntrySurface` roots at -- is computed
    // from the file the build says is the product.
    let (entry_files, configured) = match configured_surface(tsconfig, &snapshot, emission)? {
        Some(files) => (files, Some(hir::reachable::Roots::EntrySurface)),
        None => (nts_frontend_ts::entry_uris(tsconfig, &snapshot), None),
    };
    let prepared = match hir::prepare_with(
        &snapshot,
        &emit_options(entry.as_deref(), &entry_files, &foreign_tables(&snapshot), configured),
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
    // **The package the product declares, as a binary-name prefix.** A config
    // says `com.acme.sdk` because that is how Java spells a package; the class
    // file wants `com/acme/sdk`, and this is the one place the two meet.
    let package = emission
        .product
        .and_then(|(_, product)| product.java_package.as_deref())
        .map_or_else(|| nts_codegen_jvm::DEFAULT_PACKAGE.to_owned(), |named| named.replace('.', "/"));
    let emitted = nts_codegen_jvm::emit_into(&package, &prepared.program);
    for diagnostic in &emitted.diagnostics {
        eprintln!("  declined: {} {}", diagnostic.code, diagnostic.message);
    }
    if text {
        for class in &emitted.classes {
            println!("class {}", class.binary_name);
            for method in &class.lines {
                println!("  {}{}", method.name, method.descriptor);
            }
        }
    }
    if let Some(out) = out {
        for class in &emitted.classes {
            let path = out.join(class.path());
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&path, &class.bytes)?;
        }
        std::fs::write(
            out.join(nts_codegen_jvm::RUNTIME_JAR_NAME),
            nts_codegen_jvm::runtime_jar().as_ref(),
        )?;
        println!(
            "wrote {} class(es) and the runtime to {out}",
            emitted.classes.len()
        );
    }
    Ok(prepared
        .program
        .funcs
        .iter()
        .any(|func| func.name == hir::lower::MODULE_INIT))
}

/// The refusals from the emitter that make its output unusable.
///
/// The two are not the same kind of thing and used to share an exit code.
/// Lowering *drops* the function it refuses, so its output is consistent -- a
/// smaller program, which is the right behaviour for a surface still growing,
/// and `emit-c` exits 0 for it deliberately.
///
/// The emitter cannot drop anything: by then the body is written. So a program
/// declaring one C symbol two ways got `NTS2007 foreign symbol `collide` has
/// conflicting ABI declarations`, exit 0, and a `program.c` that **compiles** --
/// with both functions in it and one of them calling through the other's
/// prototype. Every `build.sh` here runs `set -e` against that exit code.
///
/// **Not every emitter diagnostic**, and the first version of this made that
/// mistake. Most of them are declines -- a type with no layout, which the node
/// profile reports 199 of -- and the program that remains is the one the tree
/// builds. Treating those as fatal turned sixteen node modules from building
/// into regressed. `nts_codegen_c::leaves_the_program_inconsistent` draws the
/// line, where the diagnostics are raised.
fn refuse_if_the_emitter_declined(diagnostics: &[nts_diagnostics::Diagnostic]) -> Result<()> {
    let fatal = diagnostics
        .iter()
        .filter(|d| nts_codegen_c::leaves_the_program_inconsistent(d))
        .count();
    if fatal == 0 {
        return Ok(());
    }
    bail!(
        "{fatal} emitter refusal(s) leave the C above inconsistent: it is not a \
         program to build. Unlike a lowering refusal, which drops the function it \
         names, these leave it in with something else's ABI"
    )
}

/// What a C emission produced, for whoever has to compile it.
///
/// **Returned rather than re-derived.** A build has to know which `.c` files to
/// compile and which symbols the artifact publishes, and both are decided here:
/// `support_files` is already "the one list, so that the several places which
/// build a program agree about it", and the published names are
/// `program.public_api`. The alternative is a linker script built by parsing
/// `program.h`, which is a second reading of something this function had in
/// hand.
#[derive(Debug, Default)]
struct Wrote {
    /// Translation units to compile, relative to the output directory.
    sources: Vec<String>,
    /// C symbols the artifact publishes.
    published: Vec<String>,
    /// Whether the program has module-level code to evaluate.
    ///
    /// **A program that is only declarations has nothing to evaluate**, so
    /// `module__init` is never emitted and referencing it is a link error --
    /// which `write_standalone` has always known and passes to
    /// `standalone_main`. The library initialiser needs the same fact, and
    /// found out by `--no-undefined` catching `undefined reference to
    /// module__init` on a fixture whose only function was refused.
    initializes: bool,
    /// Published API names that cross no C symbol, so nothing outside can reach
    /// them.
    ///
    /// **A build that publishes nothing for an export must say so.** An
    /// exported *class* is the whole of this set today: `program.h` emits its
    /// layout and its `_Static_assert`s and declares not one function, because
    /// its methods take `NtsObj_X *` -- a pointer to a struct the boundary hands
    /// out the definition of but no way to obtain. Before this field the name
    /// went into the linker version script as though it were a symbol, where it
    /// matched nothing and read, from the outside, exactly like an export.
    published_without_a_symbol: Vec<String>,
    /// Functions lowering refused, which are absent from the artifact.
    ///
    /// **Counted because a build that drops functions must say so.** `emit-c`
    /// prints each refusal to stderr and exits zero on purpose -- most are
    /// declines, and "the program that remains is the one the tree builds",
    /// which twenty-four node modules depend on. But a build whose last line is
    /// `1 artifact(s)` has told the reader the opposite of what happened. A
    /// probe here emitted an executable whose only statement was refused: it
    /// compiled, linked, ran, exited zero and did nothing.
    refused: usize,
}

fn emit_c(tsconfig: &Utf8Path, out: Option<&Utf8Path>, emission: Emission) -> Result<Wrote> {
    let tsgo_binary = frontend_binary();
    let mut source = TsgoApi::for_compilation(tsgo_binary);
    let snapshot = nts_frontend_ts::cache::snapshot(&mut source, tsconfig, "nts-build")?;
    report_snapshot_diagnostics(&snapshot)?;

    // **Through `emit_options`, like the other two emitters.**
    //
    // This had the provider and the roots written out again, and the copy had
    // drifted: `standalone` was `--main` alone, so `--entry` selected nothing
    // and the entry list was the constant `[MODULE_INIT]`. `emit-llvm` and
    // `emit-jvm` honoured the flag and this did not, silently -- a flag that is
    // accepted and ignored is worse than one that is rejected, because the
    // output looks like an answer.
    //
    // Measured on a two-export probe, where `published` and `diagnostic` each
    // call a private helper:
    //
    //     emit-llvm                      diagnostic onlyDiagnostic onlyPublished published
    //     emit-llvm --entry published                              onlyPublished published
    //     emit-c    --entry published    diagnostic onlyDiagnostic onlyPublished published
    //
    // The C column is the defect. It matters most on the one product that is
    // real today: a Node addon is the C backend, so `exports:` in a config --
    // whose whole job is to name fewer roots than the entry exports -- could
    // never have reached the artifact it was written for.
    let entry = selected_roots(emission.shape);
    let (entry_files, configured) = match configured_surface(tsconfig, &snapshot, emission)? {
        Some(files) => (files, Some(hir::reachable::Roots::EntrySurface)),
        None => (nts_frontend_ts::entry_uris(tsconfig, &snapshot), None),
    };
    let prepared = match hir::prepare_with(
        &snapshot,
        &emit_options(entry.as_deref(), &entry_files, &foreign_tables(&snapshot), configured),
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
    refuse_if_the_emitter_declined(&emitted.diagnostics)?;

    let initializes = program
        .funcs
        .iter()
        .any(|func| func.name == hir::lower::MODULE_INIT);
    let refused = prepared
        .diagnostics
        .iter()
        .filter(|d| d.code.starts_with("NTS1"))
        .count();
    // **From the emitter, not re-derived here.** This was
    // `c_identifier(emitted_name)` over `public_api`, which is a second
    // derivation of a fact `emit` already had -- and the two disagreed in both
    // directions. A program exporting `function stdin` and `const stdin_` gets
    // the symbols `stdin_` and `stdin__`, because a global whose spelling a
    // function already holds takes the trailing underscore (`c_global`); the old
    // expression wrote `stdin_` twice and never named `stdin__`, so `local: *`
    // hid the exported constant while `program.h` went on declaring it. In the
    // other direction an exported *class* has no C symbol at all -- the header
    // publishes its layout and nothing callable -- so the script named `Counter`,
    // which nothing answers to.
    let Some(out) = out else {
        print!("{}", emitted.writer.text());
        return Ok(Wrote { initializes, refused, ..Wrote::default() });
    };

    write_c_output(&program, &emitted, out, emission, refused, initializes)
}

/// Write the program, its runtime, and whatever the product's shape adds.
///
/// Split out of `emit_c` because that function was 112 lines and clippy says so
/// at 100. The seam is real rather than arbitrary: everything above decides
/// *what* the program is, and everything here decides what lands on disk.
fn write_c_output(
    program: &hir::Program,
    emitted: &nts_codegen_c::Emitted,
    out: &Utf8Path,
    emission: Emission,
    refused: usize,
    initializes: bool,
) -> Result<Wrote> {
    // Read off `emitted` rather than taken as parameters. They were threaded in
    // from the caller for one revision, which is how the fact got two owners in
    // the first place.
    let published = emitted.exported_symbols.clone();
    let published_without_a_symbol = emitted.published_without_a_symbol.clone();
    // **`--main` decides what is written, not what survives**, and the variable
    // it replaced answered both. Reachability read `--main` or `--entry` above;
    // the standalone `main()` and its libuv host below are a `--main` question
    // only.
    let standalone = emission.shape == Shape::Executable;
    // The runtime is a translation unit of its own, so a buildable output is
    // three files rather than one.
    std::fs::create_dir_all(out).with_context(|| format!("creating {out}"))?;
    let program_path = out.join("program.c");
    std::fs::write(&program_path, emitted.writer.text())
        .with_context(|| format!("writing {program_path}"))?;
    // The runtime, plus the Unicode tables when this program converts case.
    // `support_files` is the one list, so that the several places which build a
    // program agree about it rather than each remembering.
    let support = emitted.support_files();
    for file in &support {
        file.write(out.as_std_path())?;
    }
    let extra: Vec<&str> = support
        .iter()
        .filter(|file| file.compiled)
        .map(|file| file.name)
        .collect();
    // `--main` adds the entry point of a standalone program: evaluate the
    // module, run the loop until nothing is left, shut down. The libuv host
    // comes with it, because a program needs a loop and an embedder with its
    // own supplies a different one.
    if standalone {
        // **A standalone program whose module initialiser was declined does
        // nothing, and must say so.** Dropping the call from `main.c` above
        // makes the artifact *consistent* -- it links -- and consistency is not
        // the whole of the question: a program that evaluates none of its
        // top-level code and exits 0 is a quieter failure than one that will not
        // link, and the quiet one is the worse of the two.
        //
        // So the decline is fatal here rather than a note. `emit-c` printed
        // `NTS2008` on stderr and exited 0 while writing an unlinkable program;
        // the artifact is fixed above and the exit status is fixed here, because
        // either alone leaves a way to believe the build worked.
        if program
            .funcs
            .iter()
            .any(|func| func.name == hir::lower::MODULE_INIT)
            && emitted.refused.iter().any(|name| name == hir::lower::MODULE_INIT)
        {
            anyhow::bail!(
                "this program's top-level code was declined by the C backend, so a standalone \
                 build would evaluate none of it; the decline is reported above"
            );
        }
        write_standalone(
            program,
            out,
            &extra,
            emission.linking,
            !emitted.witness.is_empty(),
            &emitted.refused,
        )?;
        return Ok(Wrote {
            sources: std::iter::once("program.c".to_owned())
                .chain(extra.iter().map(|name| (*name).to_owned()))
                .chain(["main.c".to_owned(), nts_codegen_c::UV_HOST_SOURCE_NAME.to_owned()])
                .collect(),
            published,
            published_without_a_symbol,
            refused,
            initializes,
        });
    }

    // `--napi` adds the Node-API wrapper, which is what makes the compiled
    // program callable from JavaScript -- and therefore what lets node's own
    // test suite run against it. Node is a harness here, not a runtime: nothing
    // this writes enters a shipped binary.
    if emission.shape == Shape::Addon {
        let addon = nts_codegen_napi::emit_with(program, &emitted.refused);
        let addon_path = out.join(nts_codegen_napi::ADDON_SOURCE_NAME);
        std::fs::write(&addon_path, &addon.source)
            .with_context(|| format!("writing {addon_path}"))?;
        for skipped in &addon.skipped {
            eprintln!("no wrapper for {}: {}", skipped.function, skipped.reason);
        }
        println!(
            "wrote program.c, program.h, {}, {} to {out}",
            extra.join(", "),
            nts_codegen_napi::ADDON_SOURCE_NAME
        );
        return Ok(Wrote {
            sources: std::iter::once("program.c".to_owned())
                .chain(extra.iter().map(|name| (*name).to_owned()))
                .chain(std::iter::once(nts_codegen_napi::ADDON_SOURCE_NAME.to_owned()))
                .collect(),
            published,
            published_without_a_symbol,
            refused,
            initializes,
        });
    }

    // The witness is named rather than written silently. It is the only output
    // whose value depends on a consumer choosing to include it, and an artifact
    // nobody is told about reads, later, as one that was never generated.
    let witness = if emitted.witness.is_empty() {
        String::new()
    } else {
        format!(", {}", nts_codegen_c::NATIVE_WITNESS_NAME)
    };
    println!(
        "wrote program.c, program.h, {}{witness} to {out}",
        extra.join(", ")
    );
    // The provider is half a runtime decision. Reference counting needs each
    // object to be its own allocation so that the last release can hand it back;
    // the bump allocator the default uses cannot free anything. Compiling the
    // runtime without this define while the program counts references balances
    // the counts and still grows the heap, which is the quiet failure worth
    // spending two lines of output to prevent.
    if selected_provider() == hir::Provider::ReferenceCounting {
        println!("compile the runtime with -DNTS_PROVIDER_RC");
    }
    Ok(Wrote {
        sources: std::iter::once("program.c".to_owned())
            .chain(extra.iter().map(|name| (*name).to_owned()))
            .collect(),
        published,
        published_without_a_symbol,
        refused,
        initializes,
    })
}

/// `nts deps`: acquire dependency source, and report on what was not acquired.
fn deps(rest: &[String]) -> Result<()> {
    // `--help` must not fall through to a real run: this command *writes*, and
    // an accidental invocation once generated a config in a repository root
    // that nobody asked it about.
    if rest.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!(
            "nts deps [tsconfig] [--dry-run] [--verbose] [--json]\n\n\
             Acquires the TypeScript behind this project's dependencies and\n\
             reports what could not be acquired. Writes <workspace>/.nts/ and\n\
             <project>/tsconfig.nts.json; never touches anything else.\n\n\
             --dry-run   report only, write nothing\n\
             --verbose   show every specifier mapping\n\
             --json      the same report, for a machine"
        );
        return Ok(());
    }
    let tsconfig = named_project(rest)?;
    // The project is the directory holding `package.json`, which is where the
    // tsconfig lives in every layout this has been pointed at so far.
    let dir = tsconfig
        .parent()
        .map_or_else(|| Utf8PathBuf::from("."), Utf8Path::to_path_buf);
    let options = nts_deps::Options {
        dry_run: rest.iter().any(|arg| arg == "--dry-run"),
        tsgo: nts_frontend_ts::tsgo::locate(),
    };
    let acquisition = nts_deps::acquire(&dir, &tsconfig, &options)?;
    if rest.iter().any(|arg| arg == "--json") {
        println!("{}", nts_deps::report::json(&acquisition));
    } else {
        print!(
            "{}",
            nts_deps::report::render(&acquisition, rest.iter().any(|arg| arg == "--verbose"))
        );
    }
    Ok(())
}

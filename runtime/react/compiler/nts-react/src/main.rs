use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::{Context, Result, bail};

const USAGE: &str = "\
nts-react -- the React lane's compiler stage

USAGE
  nts-react compile-json <ast.json> <scope.json> <options.json>
      compile a program given in the compiler's own input format (a Babel
      AST and its scope information) and print the result as JSON
  nts-react convert <tsconfig.json> <out-dir>
      convert each of the project's own sources into the compiler's input
      format, writing <out-dir>/<file>.ast.json and <file>.scope.json, or
      <file>.unsupported.txt naming the construct that stopped it
  nts-react compile <tsconfig.json> <options.json> <out-dir>
      convert and compile each of the project's own sources with the React
      Compiler, given the plugin's resolved options, writing the result as
      <out-dir>/<file>.result.json";

fn main() -> ExitCode {
    // Deeply nested programs recurse deeply in the compiler; upstream's addon
    // runs it on a 64MB stack for the same reason.
    let run = std::thread::Builder::new().stack_size(64 * 1024 * 1024).spawn(run);
    match run.map_err(anyhow::Error::from).and_then(|handle| {
        handle.join().unwrap_or_else(|_| bail!("the compiler panicked"))
    }) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("nts-react: {error:#}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [command, ast, scope, options] if command == "compile-json" => {
            let read = |path: &str| {
                std::fs::read_to_string(PathBuf::from(path)).with_context(|| format!("cannot read {path}"))
            };
            let result = nts_react::babel::compile_json(&read(ast)?, &read(scope)?, &read(options)?)?;
            println!("{result}");
            Ok(())
        }
        [command, tsconfig, out] if command == "convert" => convert(tsconfig, out),
        [command, tsconfig, options, out] if command == "compile" => compile(tsconfig, options, out),
        _ => bail!("{USAGE}"),
    }
}

fn convert(tsconfig: &str, out: &str) -> Result<()> {
    let tsconfig = camino::Utf8PathBuf::from(tsconfig).canonicalize_utf8().with_context(|| format!("no {tsconfig}"))?;
    let project = tsconfig.parent().context("a tsconfig path has a directory")?.to_owned();
    let out = camino::Utf8PathBuf::from(out);
    std::fs::create_dir_all(&out).with_context(|| format!("cannot create {out}"))?;
    let snapshot = nts_react::project::snapshot(&tsconfig)?;
    let nodes = nts_react::tsgo::Nodes::new(&snapshot);
    let (mut converted, mut unsupported) = (0, 0);
    for source in nts_react::project::own_sources(&snapshot, &project) {
        let text = std::fs::read_to_string(&source.path).with_context(|| format!("cannot read {}", source.path))?;
        let text = nts_react::convert::text::SourceText::new(&text);
        let name = source.path.file_name().unwrap_or("source");
        match nts_react::convert::convert_file(nodes, source.root, &text) {
            Ok(file) => {
                let scope = nts_react::scope::build(&file);
                std::fs::write(out.join(format!("{name}.ast.json")), serde_json::to_string(&file)?)?;
                std::fs::write(out.join(format!("{name}.scope.json")), serde_json::to_string(&scope)?)?;
                converted += 1;
            }
            Err(why) => {
                std::fs::write(out.join(format!("{name}.unsupported.txt")), format!("node {}: {}\n", why.node.0, why.what))?;
                unsupported += 1;
            }
        }
    }
    eprintln!("converted {converted}, unsupported {unsupported}");
    Ok(())
}

fn compile(tsconfig: &str, options: &str, out: &str) -> Result<()> {
    let tsconfig = camino::Utf8PathBuf::from(tsconfig).canonicalize_utf8().with_context(|| format!("no {tsconfig}"))?;
    let project = tsconfig.parent().context("a tsconfig path has a directory")?.to_owned();
    let options: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(options).with_context(|| format!("cannot read {options}"))?)?;
    let out = camino::Utf8PathBuf::from(out);
    std::fs::create_dir_all(&out).with_context(|| format!("cannot create {out}"))?;
    let snapshot = nts_react::project::snapshot(&tsconfig)?;
    let nodes = nts_react::tsgo::Nodes::new(&snapshot);
    let (mut compiled, mut unsupported) = (0, 0);
    for source in nts_react::project::own_sources(&snapshot, &project) {
        let code = std::fs::read_to_string(&source.path).with_context(|| format!("cannot read {}", source.path))?;
        let text = nts_react::convert::text::SourceText::new(&code);
        let name = source.path.file_name().unwrap_or("source");
        let Ok(file) = nts_react::convert::convert_file(nodes, source.root, &text) else {
            unsupported += 1;
            continue;
        };
        let scope = nts_react::scope::build(&file);
        // The plugin's bridge hands the compiler the file's text beside its
        // options; so does this.
        let mut options = options.clone();
        options["__sourceCode"] = serde_json::Value::String(code);
        let options: react_compiler::entrypoint::PluginOptions = serde_json::from_value(options).context("the options are not `PluginOptions`")?;
        let result = react_compiler::entrypoint::compile_program(file, scope, options);
        std::fs::write(out.join(format!("{name}.result.json")), serde_json::to_string(&result)?)?;
        compiled += 1;
    }
    eprintln!("compiled {compiled}, unsupported {unsupported}");
    Ok(())
}

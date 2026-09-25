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
      <out-dir>/<file>.result.json and the program as <out-dir>/<file>";

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
    let out = camino::Utf8PathBuf::from(out);
    std::fs::create_dir_all(&out).with_context(|| format!("cannot create {out}"))?;
    let mut session = nts_react::project::Session::open(&tsconfig)?;
    let (mut converted, mut unsupported) = (0, 0);
    for path in session.own_sources()? {
        let tree = session.file(&path)?;
        let code = std::fs::read_to_string(&path).with_context(|| format!("cannot read {path}"))?;
        let text = nts_react::convert::text::SourceText::new(&code);
        let name = path.file_name().unwrap_or("source");
        let nodes = nts_react::tsgo::Nodes::new(&tree.nodes);
        match nts_react::convert::convert_file(nodes, nts_semantic_schema::NodeId(0), &text) {
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
    let options: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(options).with_context(|| format!("cannot read {options}"))?)?;
    let out = camino::Utf8PathBuf::from(out);
    std::fs::create_dir_all(&out).with_context(|| format!("cannot create {out}"))?;
    let mut session = nts_react::project::Session::open(&tsconfig)?;
    let (mut compiled, mut unsupported) = (0, 0);
    for path in session.own_sources()? {
        let tree = session.file(&path)?;
        let code = std::fs::read_to_string(&path).with_context(|| format!("cannot read {path}"))?;
        let text = nts_react::convert::text::SourceText::new(&code);
        let name = path.file_name().unwrap_or("source");
        let nodes = nts_react::tsgo::Nodes::new(&tree.nodes);
        let Ok(file) = nts_react::convert::convert_file(nodes, nts_semantic_schema::NodeId(0), &text) else {
            unsupported += 1;
            continue;
        };
        let scope = nts_react::scope::build(&file);
        // The plugin's bridge hands the compiler the file's text beside its
        // options; so does this.
        let mut options = options.clone();
        options["__sourceCode"] = serde_json::Value::String(code);
        let options: react_compiler::entrypoint::PluginOptions = serde_json::from_value(options).context("the options are not `PluginOptions`")?;
        let original = file.clone();
        let result = react_compiler::entrypoint::compile_program(file, scope, options);
        std::fs::write(out.join(format!("{name}.result.json")), serde_json::to_string(&result)?)?;
        // The program as TypeScript: the user's text wherever the compiler
        // changed nothing, which is the whole file when it compiled nothing.
        // The compiler's renames apply even when it compiled nothing, as the
        // Babel plugin applies them: a function that bailed out may still
        // have had a shadowing binding renamed while it was being lowered.
        let printed = match &result {
            react_compiler::entrypoint::CompileResult::Success { ast: Some(compiled), renames, .. } => {
                nts_react::print::print_file(&text, &original, compiled, renames)
            }
            react_compiler::entrypoint::CompileResult::Success { ast: None, renames, .. } if !renames.is_empty() => {
                nts_react::print::print_file(&text, &original, &original, renames)
            }
            _ => code_for_output(&text),
        };
        std::fs::write(out.join(name), printed)?;
        compiled += 1;
    }
    eprintln!("compiled {compiled}, unsupported {unsupported}");
    Ok(())
}

fn code_for_output(text: &nts_react::convert::text::SourceText) -> String {
    text.slice(0, text.len())
}

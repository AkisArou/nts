use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::{Context, Result, bail};

const USAGE: &str = "\
nts-react -- the React lane's compiler stage

USAGE
  nts-react compile-json <ast.json> <scope.json> <options.json>
      compile a program given in the compiler's own input format (a Babel
      AST and its scope information) and print the result as JSON";

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
        _ => bail!("{USAGE}"),
    }
}

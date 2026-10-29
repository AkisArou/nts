//! Raw checker diagnostics for `tooling/census/semantic-codes.ts`.
//! Build with `cargo build --release -p nts-frontend-tsrs --example diagnostics`.
//! No capture queries or nts early-error filtering participate in this audit.

use std::{num::NonZeroU16, process::ExitCode};

use nts_frontend_tsrs::{
    Diagnostic, DiagnosticCategory, DiagnosticScope, ProjectSpec, SessionOptions,
};
use serde_json::{Value, json};

fn diagnostic(value: &Diagnostic) -> Value {
    json!({
        "path": value.path.as_ref().map(|path| path.as_str()),
        "span": value.span.map(|span| [span.start.0, span.end.0]),
        "category": match value.category {
            DiagnosticCategory::Warning => "warning",
            DiagnosticCategory::Error => "error",
            DiagnosticCategory::Suggestion => "suggestion",
            DiagnosticCategory::Message => "message",
        },
        "code": value.code,
        "message": value.message,
        "chain": value.chain.iter().map(diagnostic).collect::<Vec<_>>(),
        "related": value.related.iter().map(diagnostic).collect::<Vec<_>>(),
    })
}

fn check() -> Result<bool, Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let (config, count) = match args.as_slice() {
        [config] => (config, NonZeroU16::MIN),
        [config, flag, count] if flag == "--checkers" => (config, count.parse::<NonZeroU16>()?),
        _ => return Err("usage: diagnostics <tsconfig.json> [--checkers N]".into()),
    };
    let cwd = std::env::current_dir()?;
    let mut options = SessionOptions::new(cwd.to_str().ok_or("working directory is not UTF-8")?);
    options.checker_count = Some(count);
    let errors = nts_frontend_tsrs::run(options, |session| {
        let checked = session.open(ProjectSpec::new(config))?;
        // Materialised census projects own all their non-default-library
        // files: the stand-in, test, includes and resolved fixture modules.
        // Config, option and global diagnostics remain in every Files scope.
        let files: Vec<_> = checked
            .projects()
            .flat_map(nts_frontend_tsrs::Project::files)
            .filter(|file| !file.is_default_library())
            .map(|file| file.path().to_owned())
            .collect();
        let finished = checked
            .start_diagnostics(DiagnosticScope::Files(&files))
            .finish();
        let diagnostics = finished.diagnostics();
        let errors = diagnostics
            .iter()
            .any(|value| value.category == DiagnosticCategory::Error);
        println!(
            "{}",
            json!({
                "status": "completed",
                "files": files.iter().map(|path| path.as_str()).collect::<Vec<_>>(),
                "checker_count": count.get(),
                "checker": {
                    "tsrs_commit": nts_frontend_tsrs::VERSION.tsrs_commit,
                    "typescript_commit": nts_frontend_tsrs::VERSION.typescript_commit,
                    "patches": nts_frontend_tsrs::VERSION.patches.iter()
                        .map(|patch| json!({"id": patch.id, "sha256": patch.sha256}))
                        .collect::<Vec<_>>(),
                },
                "diagnostics": diagnostics.iter().map(diagnostic).collect::<Vec<_>>(),
            })
        );
        Ok::<_, nts_frontend_tsrs::LoadError>(errors)
    })?;
    Ok(errors)
}

fn main() -> ExitCode {
    match check() {
        Ok(false) => ExitCode::SUCCESS,
        Ok(true) => ExitCode::from(2),
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

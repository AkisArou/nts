use std::{env, path::Path};

use anyhow::{Context, Result, bail};
use nts_suite::test262_runner::{
    ScheduleOutcome, TEST262_PIN, assemble_variant, discover_suite, schedule_strict_script, select,
};
use serde::Serialize;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PlanOutput {
    Planned {
        suite_pin: String,
        plan: nts_suite::test262_runner::AssemblyPlan,
    },
    NotPlanned {
        suite_pin: String,
        outcome: ScheduleOutcome,
    },
}

fn main() -> Result<()> {
    let arguments: Vec<_> = env::args().skip(1).collect();
    match arguments.as_slice() {
        [command, suite_root] if command == "inventory" => inventory(Path::new(suite_root)),
        [command, suite_root, test_path] if command == "plan" => {
            plan(Path::new(suite_root), test_path)
        }
        [command, suite_root, prefix] if command == "select" => {
            emit_selection(Path::new(suite_root), prefix)
        }
        [argument] if argument == "--help" || argument == "-h" => {
            print_usage();
            Ok(())
        }
        _ => {
            print_usage();
            bail!("invalid arguments")
        }
    }
}

fn inventory(suite_root: &Path) -> Result<()> {
    let (inventory, _) = discover_suite(suite_root, TEST262_PIN)
        .with_context(|| format!("discovering {}", suite_root.display()))?;
    println!("{}", serde_json::to_string_pretty(&inventory)?);
    Ok(())
}

fn plan(suite_root: &Path, test_path: &str) -> Result<()> {
    let (inventory, records) = discover_suite(suite_root, TEST262_PIN)
        .with_context(|| format!("discovering {}", suite_root.display()))?;
    let record = records
        .iter()
        .find(|record| record.path == test_path)
        .with_context(|| {
            format!("{test_path:?} is not a standalone test at the pinned revision")
        })?;

    let output = match schedule_strict_script(record) {
        ScheduleOutcome::Planned { plan } => PlanOutput::Planned {
            suite_pin: inventory.pin,
            plan: assemble_variant(suite_root, record, plan)?,
        },
        outcome => PlanOutput::NotPlanned {
            suite_pin: inventory.pin,
            outcome,
        },
    };
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}

/// Every test under `prefix`, one JSON object per line, for the gap census.
///
/// **JSON Lines rather than one document**, so a driver can stream 11,000
/// records without holding them, and so a truncated run is still parseable up
/// to the point it stopped rather than being a single unclosed array.
///
/// Every file under the prefix is emitted, including the ones the scheduler
/// excludes: an exclusion that is absent from the output is an exclusion nobody
/// can audit, which is the discipline `runtime/node/*/not-applicable` carries
/// for the other corpus.
fn emit_selection(suite_root: &Path, prefix: &str) -> Result<()> {
    let (_, records) = discover_suite(suite_root, TEST262_PIN)
        .with_context(|| format!("discovering {}", suite_root.display()))?;
    let chosen = select(&records, prefix);
    if chosen.is_empty() {
        // An empty selection and a wrong prefix look identical downstream, and
        // the driver would report a clean run over nothing.
        bail!("{prefix:?} selected no test at the pinned revision");
    }
    for selection in &chosen {
        println!("{}", serde_json::to_string(selection)?);
    }
    Ok(())
}

fn print_usage() {
    eprintln!(
        "Usage:\n  nts-test262-protocol inventory <test262-root>\n  nts-test262-protocol plan <test262-root> <suite-relative-test-path>\n  nts-test262-protocol select <test262-root> <suite-relative-directory>"
    );
}

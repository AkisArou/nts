use std::{env, path::Path};

use anyhow::{Context, Result, bail};
use nts_suite::test262_runner::{
    ScheduleOutcome, TEST262_PIN, assemble_variant, discover_suite, schedule_strict_script,
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

fn print_usage() {
    eprintln!(
        "Usage:\n  nts-test262-protocol inventory <test262-root>\n  nts-test262-protocol plan <test262-root> <suite-relative-test-path>"
    );
}

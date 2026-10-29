//! Inspect the exact `HostGc` program's frozen private string-carrier proof.
//! Usage: `cargo run -p nts-codegen-jvm --example string_chain_census -- <tsconfig> [repeat]`

use std::error::Error;
use std::io::{self, Write};
use std::num::NonZeroU16;
use std::time::Instant;

use camino::Utf8PathBuf;
use nts_core::hir::{
    self,
    string_accumulators::{self, chains::Plan},
};
use nts_frontend_ts::Frontend;

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let config =
        Utf8PathBuf::from(args.next().ok_or("expected a tsconfig path")?).canonicalize_utf8()?;
    let repeat: u32 = args.next().map_or(Ok(1), |value| value.parse())?;
    if repeat == 0 || args.next().is_some() {
        return Err("expected a positive repeat count".into());
    }
    let snapshot = Frontend::new(config.parent().ok_or("config has no parent")?.to_owned())
        .with_checkers(NonZeroU16::MIN)
        .snapshot(&config)?;
    if snapshot.has_errors() {
        return Err(format!("capture diagnostics: {:?}", snapshot.diagnostics).into());
    }
    let provider = nts_codegen_common::provider::host_gc("jvm", false)?;
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider,
            ..hir::Options::default()
        },
    )
    .map_err(|error| error.render(&snapshot.sources))?;
    if !prepared.diagnostics.is_empty() || prepared.program.refused_bodies().next().is_some() {
        return Err(format!("partial preparation: {:?}", prepared.diagnostics).into());
    }
    let program = prepared.program;
    let values: usize = program.funcs.iter().map(|func| func.values.len()).sum();
    let blocks: usize = program.funcs.iter().map(|func| func.blocks.len()).sum();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    writeln!(
        stdout,
        "PROGRAM\t{}\t{}\t{}\t{}",
        config,
        program.funcs.len(),
        values,
        blocks
    )?;
    let mut held = 0;
    let start = Instant::now();
    for _ in 0..repeat {
        held = program
            .funcs
            .iter()
            .map(|func| string_accumulators::local(func).len())
            .sum::<usize>();
        std::hint::black_box(held);
    }
    writeln!(
        stdout,
        "LOCAL\t{repeat}\t{}\t{held}",
        start.elapsed().as_nanos()
    )?;
    let start = Instant::now();
    let mut plan = Plan::new(&program);
    for _ in 1..repeat {
        plan = std::hint::black_box(Plan::new(&program));
    }
    writeln!(
        stdout,
        "SHARED\t{repeat}\t{}\t{}\t{}",
        start.elapsed().as_nanos(),
        plan.graph_work().0,
        plan.graph_work().1
    )?;
    for (name, slot) in plan.admitted() {
        writeln!(stdout, "ADMITTED\t{name}\t{slot}")?;
    }
    for (name, reason) in plan.rejected() {
        writeln!(stdout, "REJECTED\t{name}\t{reason:?}")?;
    }
    for func in &program.funcs {
        if let Some(values) = plan.values_in(func) {
            writeln!(stdout, "HELD\t{}\t{}", func.name, values.len())?;
        }
    }
    stdout.flush()?;
    Ok(())
}

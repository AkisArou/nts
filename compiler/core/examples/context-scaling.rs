//! Write the exact fresh populations measured by the shared-context work guard.
#![allow(clippy::expect_used)]
#[path = "../src/hir/lower/context_scaling/family.rs"]
mod family;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os().skip(1);
    let root = std::path::PathBuf::from(args.next().expect("output directory"));
    assert!(args.next().is_none(), "one output directory is required");
    let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for calls in family::Calls::ALL {
        for count in family::COUNTS {
            let dir = root.join(format!("{}-{count}", calls.name()));
            calls.write(&dir, count, &repository)?;
            println!("{}\t{count}\t{}", calls.name(), dir.display());
        }
    }
    Ok(())
}

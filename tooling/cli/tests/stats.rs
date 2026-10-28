//! `nts stats` prints what preparation did to a program as `key value` lines.
//!
//! The counters existed on `Prepared` and nothing printed them, so a
//! representation change could only be seen by reading listings. These tests
//! pin the format a run records per case -- every key once, in the documented
//! order, each value a number -- and one fact a key reports, so the numbers
//! cannot drift from what they name: two closures merged into one variable and
//! called through their signature take its typed entry, and nothing calls the
//! erased one.
//!
//! Native capture failures fail the test.

use std::path::{Path, PathBuf};
use std::process::Command;

/// closure-merge's shape: two closures of one signature merged into one
/// variable, called where the merge is visible and through a parameter.
const SOURCE: &str = r"
export function merged(seed: number): number {
  // Three closures at one signature: past the two a call is tested for
  // (`class_sets`), so the calls stay calls through the signature.
  let mix: (x: number) => number;
  if ((seed & 3) === 0) {
    mix = (x: number): number => (x * 3 + seed) | 0;
  } else if ((seed & 3) === 1) {
    mix = (x: number): number => (x * 7 + seed) | 0;
  } else {
    mix = (x: number): number => (x * 5 - seed) | 0;
  }
  let total = 0;
  for (let i = 0; i < 8; i++) total = (total ^ mix(i)) | 0;
  return total + drive(mix, 8);
}

function drive(f: (x: number) => number, times: number): number {
  let total = 0;
  for (let i = 0; i < times; i++) total = (total ^ f(i)) | 0;
  return total;
}
";

/// The keys, in the order `nts stats` prints them without `--rc`.
const KEYS: [&str; 29] = [
    "verified",
    "functions",
    "layouts",
    "ops",
    "refused",
    "pruned",
    "specialized",
    "conversions",
    "checks_removed",
    "checks_kept",
    "erased_reads_answered",
    "narrowed",
    "cloned",
    "copied",
    "devirtualized",
    "framed",
    "simplified",
    "erases",
    "unerases",
    "calls.direct",
    "calls.virtual",
    "calls.closure.typed",
    "calls.closure.uniform",
    "calls.external",
    "typed_signatures",
    "accumulators.candidates",
    "accumulators.rewritten",
    "accumulators.visits",
    "accumulators.budget_exhaustions",
];

fn fixture(name: &str) -> PathBuf {
    let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let src = root.join("src");
    std::fs::create_dir_all(&src).expect("creating the fixture");
    std::fs::write(src.join("main.ts"), SOURCE).expect("writing the source");
    std::fs::write(
        root.join("tsconfig.json"),
        r#"{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","strict":true,"noEmit":false},"include":["src/**/*"]}"#,
    )
    .expect("writing the tsconfig");
    root
}

/// `nts stats` on the fixture, as `(key, value)` pairs in printed order.
fn stats(root: &Path, extra: &[&str]) -> Vec<(String, u64)> {
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("stats")
        .arg(root.join("tsconfig.json"))
        .args(["--backend", "c"])
        .args(extra)
        .output()
        .expect("running nts stats");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "nts stats failed:\n{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    stdout
        .lines()
        .filter(|line| !line.starts_with("preparation:"))
        .map(|line| {
            let (key, value) = line
                .split_once(' ')
                .unwrap_or_else(|| panic!("`{line}` is not `key value`"));
            let value = value
                .parse()
                .unwrap_or_else(|_| panic!("`{line}`'s value is not a number"));
            (key.to_owned(), value)
        })
        .collect()
}

fn value(rows: &[(String, u64)], key: &str) -> u64 {
    rows.iter()
        .find(|(name, _)| name == key)
        .unwrap_or_else(|| panic!("no `{key}` in {rows:?}"))
        .1
}

#[test]
fn every_key_is_printed_once_in_order_and_names_what_it_counts() {
    let rows = stats(&fixture("stats-plain"), &[]);
    let keys: Vec<&str> = rows.iter().map(|(key, _)| key.as_str()).collect();
    assert_eq!(keys, KEYS, "the printed keys and their order");
    assert_eq!(value(&rows, "verified"), 1);
    assert_eq!(value(&rows, "refused"), 0);
    // The merged closures' signature is typed, so both calls through it take
    // the typed entry and nothing calls the erased one.
    assert_eq!(value(&rows, "typed_signatures"), 1);
    assert!(value(&rows, "calls.closure.typed") >= 2, "{rows:?}");
    assert_eq!(value(&rows, "calls.closure.uniform"), 0, "{rows:?}");
}

#[test]
fn counting_is_printed_only_where_the_provider_counts() {
    let root = fixture("stats-rc");
    let plain = stats(&root, &[]);
    assert!(plain.iter().all(|(key, _)| !key.starts_with("rc.")));
    let counted = stats(&root, &["--rc"]);
    let keys: Vec<&str> = counted
        .iter()
        .map(|(key, _)| key.as_str())
        .filter(|key| key.starts_with("rc."))
        .collect();
    assert_eq!(
        keys,
        [
            "rc.retains",
            "rc.releases",
            "rc.moves",
            "rc.move_budget_exhaustions",
            "rc.borrows"
        ]
    );
    assert_eq!(value(&counted, "rc.move_budget_exhaustions"), 0);
    // Regions are for the counting provider too, and printed only there.
    assert!(plain.iter().all(|(key, _)| !key.starts_with("regions.")));
    let regions: Vec<&str> = counted
        .iter()
        .map(|(key, _)| key.as_str())
        .filter(|key| key.starts_with("regions."))
        .collect();
    assert_eq!(
        regions,
        ["regions.candidates", "regions.sites", "regions.raising"]
    );
}

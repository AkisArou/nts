//! `nts expect-ir` passes only when every fact holds, and says which did not.
//!
//! Each arm differs from the passing one in one thing: a fact that is false,
//! one naming a function the program does not have, one that does not parse,
//! and a project with no fact at all. Each of the last four must fail, and
//! name its file and line where it has one: a checker that passed any of them
//! would let a fact rot into a check of nothing.
//!
//! Native capture failures fail the test.

use std::path::{Path, PathBuf};
use std::process::Command;

/// A source whose representation facts are known: an integer loop over an
/// `i32` count, and a direct call.
const SOURCE: &str = r"
function step(x: number): number {
  return (x * 3 + 1) | 0;
}

export function run(rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i = i + 1) {
    total = (total ^ step(i)) | 0;
  }
  return total;
}
";

fn fixture(name: &str, facts: &str) -> PathBuf {
    let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let src = root.join("src");
    std::fs::create_dir_all(&src).expect("creating the fixture");
    std::fs::write(src.join("main.ts"), format!("{SOURCE}{facts}")).expect("writing the source");
    std::fs::write(
        root.join("tsconfig.json"),
        r#"{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","strict":true,"noEmit":false},"include":["src/**/*"]}"#,
    )
    .expect("writing the tsconfig");
    root
}

/// `nts expect-ir` on a fixture: whether it passed, and what it printed.
fn expect_ir(root: &Path) -> (bool, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("expect-ir")
        .arg(root.join("tsconfig.json"))
        .output()
        .expect("running nts expect-ir");
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    (output.status.success(), text)
}

const TRUE_FACTS: &str = "
// expect-ir: all: block params in run#whole are integer
// expect-ir: all: no call.virtual in run
// expect-ir: c llvm: count call in run >= 1
// expect-ir: all: step returns i32
";

#[test]
fn facts_that_hold_pass_on_every_backend_they_name() {
    let (passed, text) = expect_ir(&fixture("expect-ir-holds", TRUE_FACTS));
    assert!(passed, "{text}");
    assert_eq!(text.matches("PASS").count(), 4, "{text}");
    assert!(
        text.contains("PASS        ") && text.contains("c llvm jvm: no call.virtual in run"),
        "one line per fact, naming its backends:\n{text}"
    );
}

#[test]
fn a_false_fact_fails_and_says_what_it_found() {
    let (passed, text) = expect_ir(&fixture(
        "expect-ir-false",
        &format!("{TRUE_FACTS}// expect-ir: c: step returns f64\n"),
    ));
    assert!(!passed, "{text}");
    assert!(
        text.contains("FAIL") && text.contains("step returns i32"),
        "{text}"
    );
}

#[test]
fn named_helper_counts_do_not_count_other_external_calls() {
    let root = fixture("expect-ir-helper-count", "");
    std::fs::write(
        root.join("src/main.ts"),
        "export function format(value: any): string { return String(value); }\n\
         // expect-ir: all: count call.extern(nts_value_to_string) in format == 1\n\
         // expect-ir: all: count call.extern(nts_raising) in format == 0\n\
         // expect-ir: all: count call.extern(nts_raising) in format == 1\n",
    )
    .expect("writing the helper count fixture");
    let (passed, text) = expect_ir(&root);
    assert!(!passed, "{text}");
    assert_eq!(text.matches("PASS").count(), 2, "{text}");
    assert_eq!(text.matches("FAIL").count(), 3, "{text}");
    assert!(text.contains("0 found:"), "{text}");
}

#[test]
fn a_fact_about_a_function_that_is_not_there_is_unresolved_and_fails() {
    let (passed, text) = expect_ir(&fixture(
        "expect-ir-unresolved",
        &format!("{TRUE_FACTS}// expect-ir: all: no erase in renamed\n"),
    ));
    assert!(!passed, "{text}");
    assert!(
        text.contains("UNRESOLVED") && text.contains("no function `renamed`"),
        "{text}"
    );
}

#[test]
fn a_fact_that_does_not_parse_fails_and_names_its_line() {
    let (passed, text) = expect_ir(&fixture(
        "expect-ir-unparsed",
        &format!("{TRUE_FACTS}// expect-ir: all: no erasure in run\n"),
    ));
    assert!(!passed, "{text}");
    assert!(
        text.contains("main.ts:") && text.contains("`erasure` is not an operation"),
        "{text}"
    );
}

#[test]
fn a_project_with_no_fact_fails() {
    let (passed, text) = expect_ir(&fixture("expect-ir-none", ""));
    assert!(!passed, "{text}");
    assert!(text.contains("a check of nothing is not a pass"), "{text}");
}

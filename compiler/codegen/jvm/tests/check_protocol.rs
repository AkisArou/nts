//! A JVM invocation target is independent of the source label compared to node.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fmt::Write as _;
use std::path::PathBuf;
use std::process::Output;

mod common;

const PROGRAM: &str = r#"package nts.gen;
import nts.rt.NtsPromise;
public final class Program {
  public static void main(String[] args) {
    System.out.println("charset:" + java.nio.charset.Charset.defaultCharset().name());
    nts.rt.Check.main(args);
  }
  public static double number(double n) { return n + 1; }
  public static int number(int n) { return n + 2; }
  public static double numberOther(double n) { return n + 3; }
  public static String text() { return "x"; }
  public static String absent() { return null; }
  public static NtsPromise fulfilledNumber() {
    NtsPromise p = NtsPromise.newPromise(); NtsPromise.fulfillNumber(p, 3); return p;
  }
  public static NtsPromise fulfilledString() {
    NtsPromise p = NtsPromise.newPromise(); NtsPromise.fulfillReference(p, "x"); return p;
  }
  public static NtsPromise fulfilledUndefined() {
    NtsPromise p = NtsPromise.newPromise(); NtsPromise.fulfillVoid(p); return p;
  }
  public static NtsPromise rejected() {
    NtsPromise p = NtsPromise.newPromise(); NtsPromise.reject(p, "reason"); return p;
  }
  public static NtsPromise pending() { return NtsPromise.newPromise(); }
}
"#;

struct Fixture {
    dir: PathBuf,
    classpath: std::ffi::OsString,
    java: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Option<Self> {
        let (Some(javac), Some(java)) = (common::tool("javac"), common::tool("java")) else {
            eprintln!("SKIP JVM check protocol: no JDK");
            return None;
        };
        let dir =
            std::env::temp_dir().join(format!("nts-check-protocol-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
        // Exercise the tracked/embedded artifact, including its Check class.
        std::fs::write(&jar, nts_codegen_jvm::RUNTIME_JAR).unwrap();
        let source = dir.join("Program.java");
        std::fs::write(&source, PROGRAM).unwrap();
        let classpath = std::env::join_paths([&dir, &jar]).unwrap();
        let built = nts_codegen_jvm::toolchain::command(javac)
            .args([
                "--release",
                "8",
                "-Xlint:-options",
                "-encoding",
                "UTF-8",
                "-cp",
            ])
            .arg(&classpath)
            .arg("-d")
            .arg(&dir)
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            built.status.success() && built.stderr.is_empty(),
            "{}",
            String::from_utf8_lossy(&built.stderr)
        );
        Some(Self {
            dir,
            classpath,
            java,
        })
    }

    fn run(&self, cases: &str, encoding: Option<&str>) -> (Output, String) {
        let input = self.dir.join("cases.txt");
        let results = self.dir.join("results.txt");
        std::fs::write(&input, cases).unwrap();
        let _ = std::fs::remove_file(&results);
        let mut command = nts_codegen_jvm::toolchain::command(&self.java);
        if let Some(encoding) = encoding {
            command.arg(format!("-Dfile.encoding={encoding}"));
        }
        let output = command
            .args(["-Xverify:all", "-cp"])
            .arg(&self.classpath)
            .arg("nts.gen.Program")
            .arg(&input)
            .env("NTS_DIFF_RESULTS", &results)
            .output()
            .unwrap();
        (output, std::fs::read_to_string(results).unwrap())
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

type Case = (
    &'static str,
    &'static str,
    usize,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);

const CASES: &[Case] = &[
    (
        "number",
        "$\u{200d}",
        0,
        "D",
        "-",
        "D",
        " 0000000000000000",
        "3ff0000000000000",
    ),
    (
        "number",
        "$\u{200c}",
        0,
        "I",
        "-",
        "I",
        " 0000000000000000",
        "4000000000000000",
    ),
    (
        "numberOther",
        "$\u{200d}",
        1,
        "D",
        "-",
        "D",
        " 0000000000000000",
        "4008000000000000",
    ),
    (
        "text",
        "$\u{200d}String",
        0,
        "Ljava/lang/String;",
        "-",
        "-",
        "",
        "str 1,120",
    ),
    (
        "absent",
        "$\u{200d}Null",
        0,
        "Ljava/lang/String;",
        "null",
        "-",
        "",
        "null",
    ),
    (
        "absent",
        "$\u{200d}Undefined",
        0,
        "Ljava/lang/String;",
        "-",
        "-",
        "",
        "undefined",
    ),
    (
        "fulfilledNumber",
        "$\u{200d}PromiseNumber",
        0,
        "Lnts/rt/NtsPromise;",
        "-",
        "-",
        "",
        "4008000000000000",
    ),
    (
        "fulfilledString",
        "$\u{200d}PromiseString",
        0,
        "Lnts/rt/NtsPromise;",
        "-",
        "-",
        "",
        "str 1,120",
    ),
    (
        "fulfilledUndefined",
        "$\u{200d}PromiseUndefined",
        0,
        "Lnts/rt/NtsPromise;",
        "-",
        "-",
        "",
        "undefined",
    ),
    (
        "rejected",
        "$\u{200d}PromiseRejected",
        0,
        "Lnts/rt/NtsPromise;",
        "-",
        "-",
        "",
        "rejected",
    ),
    (
        "pending",
        "$\u{200d}PromisePending",
        0,
        "Lnts/rt/NtsPromise;",
        "-",
        "-",
        "",
        "pending",
    ),
];

#[test]
fn result_labels_are_independent_of_the_invocation_cache() {
    let Some(fixture) = Fixture::new("labels") else {
        return;
    };
    // Same target/different descriptors and same source/different targets
    // independently pin both dimensions of the invocation cache.
    let mut cases = String::new();
    let mut expected = String::new();
    for (target, source, at, returns, absent, params, args, result) in CASES {
        writeln!(
            cases,
            "nts-check v2 {target} {source} {at} {returns} {absent} {params}{args}"
        )
        .unwrap();
        writeln!(expected, "{source} {at} {result}").unwrap();
    }
    writeln!(expected, "done {}", CASES.len()).unwrap();
    for encoding in [None, Some("ISO-8859-1")] {
        let (ran, results) = fixture.run(&cases, encoding);
        assert!(
            ran.status.success() && ran.stderr.is_empty(),
            "{}",
            String::from_utf8_lossy(&ran.stderr)
        );
        let observed = String::from_utf8(ran.stdout).unwrap();
        if encoding.is_some() {
            // Assert the actual default charset: passing a property alone is
            // not evidence that this JVM exercised a non-UTF-8 file reader.
            assert_eq!(observed, "charset:ISO-8859-1\n");
        } else {
            assert!(observed.starts_with("charset:"));
        }
        eprintln!("JVM check protocol observed {observed:?}");
        assert_eq!(results, expected);
    }
}

#[test]
fn an_old_case_header_is_rejected_without_a_result_or_done_marker() {
    let Some(fixture) = Fixture::new("old-header") else {
        return;
    };
    let (ran, results) = fixture.run("number 0 D - D 0000000000000000\n", None);
    assert!(!ran.status.success());
    assert!(String::from_utf8_lossy(&ran.stdout).starts_with("charset:"));
    assert_eq!(results, "");
    assert!(
        String::from_utf8_lossy(&ran.stderr)
            .contains("incompatible JVM check case protocol: expected nts-check v2")
    );
}

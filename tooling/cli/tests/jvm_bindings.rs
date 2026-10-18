//! Declaration contracts survive source edits and select the actual JVM ABI.
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn output(command: &mut Command) -> Output {
    command.output().expect("runs")
}

fn success(result: &Output) {
    assert!(
        result.status.success(),
        "stdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}

fn project(name: &str) -> Option<PathBuf> {
    if std::env::var_os("NTS_TSGO").is_none() {
        assert!(
            std::env::var_os("NTS_TESTS_REQUIRE_TOOLING").is_none(),
            "NTS_TSGO required"
        );
        eprintln!("SKIP JVM bindings: no NTS_TSGO");
        return None;
    }
    let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("project");
    std::fs::write(root.join("tsconfig.json"), r#"{"compilerOptions":{"target":"ESNext","module":"ESNext","strict":true,"skipLibCheck":true},"include":["*.ts"]}"#).expect("config");
    Some(root)
}

fn emit(root: &Path, directory: &str) -> Output {
    output(
        Command::new(env!("CARGO_BIN_EXE_nts"))
            .arg("emit-jvm")
            .arg(root.join("tsconfig.json"))
            .arg("--out")
            .arg(root.join(directory)),
    )
}

#[test]
fn annotations_select_overloads_after_unicode_and_formatting_edits() {
    let Some(root) = project("jvm-annotated-overloads") else {
        return;
    };
    std::fs::write(
        root.join("Probe.java"),
        r"
package foreign;
public final class Probe {
    public int x;
    public static int X = 7;
    public Probe(int x) { this.x = x; }
    public int choose(int n) { return x + n; }
    public int choose(String s) { return x + s.length() + 100; }
    public static int score(int n) { return n * 2; }
    public interface Fn { int apply(int n); }
    public static Fn callback() { return n -> n + 20; }
}",
    )
    .expect("Java");
    success(&output(
        Command::new("javac")
            .arg("--release")
            .arg("8")
            .arg("-d")
            .arg(root.join("java"))
            .arg(root.join("Probe.java")),
    ));
    let generated = root.join("generated");
    success(&output(
        Command::new(env!("CARGO_BIN_EXE_nts"))
            .args(["bind", "--classes"])
            .arg(root.join("java"))
            .args(["--package", "foreign", "--out"])
            .arg(&generated),
    ));
    let artifacts: Vec<_> = std::fs::read_dir(&generated)
        .expect("generated files")
        .map(|entry| entry.expect("entry").file_name())
        .collect();
    assert_eq!(artifacts, ["foreign.d.ts"]);
    let generated_text = std::fs::read_to_string(generated.join("foreign.d.ts")).expect("bindings");
    assert!(generated_text.contains("@ntsJvm virtual foreign/Probe.choose:(I)I"));
    assert!(generated_text.contains("@ntsJvm virtual foreign/Probe.choose:(Ljava/lang/String;)I"));
    let declarations = r#"
declare module "java:foreign" {
  export class Probe {
    /** @ntsJvm special foreign/Probe.<init>:(I)V */
    constructor(x: number);
    /** @ntsJvm field foreign/Probe.x:I */
    x: number;
    /** @ntsJvm staticfield foreign/Probe.X:I */
    static X: number;
    /** @ntsJvm virtual foreign/Probe.choose:(I)I */
    choose(n: number): number;
    /** @ntsJvm virtual foreign/Probe.choose:(Ljava/lang/String;)I */
    choose(s: string): number;
    /** @ntsJvm static foreign/Probe.score:(I)I
     * @ntsJvmKeeps none
     */
    static score(n: number): number;
    /** @ntsJvm static foreign/Probe.callback:()Lforeign/Probe$Fn; */
    static callback(): Fn;
  }
  export interface Fn {
    /** @ntsJvm interface foreign/Probe$Fn.apply:(I)I */
    apply(n: number): number;
  }
}
"#;
    std::fs::write(
        root.join("main.ts"),
        r#"
import { Probe } from "java:foreign";
export function run(): string {
  const p = new Probe(3);
  p.x = 4;
  Probe.X = 9;
  return p.choose(2) + ":" + p.choose("ab") + ":" + Probe.score(5)
    + ":" + p.x + ":" + Probe.X + ":" + Probe.callback().apply(1);
}
"#,
    )
    .expect("TS");
    // No sidecar exists. A second run moves every declaration and changes byte
    // offsets with non-ASCII text; the checker must still select the same ABI.
    for (directory, text) in [
        ("first", declarations.to_owned()),
        (
            "edited",
            format!(
                "// λ 🦀 binding edits\n\n{}",
                declarations.replace("    ", "\t\t")
            ),
        ),
    ] {
        std::fs::write(root.join("foreign.d.ts"), text).expect("declarations");
        let result = emit(&root, directory);
        success(&result);
        let stderr = String::from_utf8_lossy(&result.stderr);
        assert!(!stderr.contains("NTS"), "{stderr}");
        let classes = root.join(directory);
        std::fs::write(root.join("Driver.java"), "class Driver { public static void main(String[] a) { System.out.println(nts.gen.Program.run()); } }").expect("driver");
        let classpath = format!(
            "{}:{}:{}",
            classes.display(),
            classes.join("nts-runtime.jar").display(),
            root.join("java").display()
        );
        success(&output(
            Command::new("javac")
                .arg("-cp")
                .arg(&classpath)
                .arg("-d")
                .arg(&classes)
                .arg(root.join("Driver.java")),
        ));
        let result = output(
            Command::new("java")
                .arg("-Xverify:all")
                .arg("-cp")
                .arg(classpath)
                .arg("Driver"),
        );
        success(&result);
        assert_eq!(
            String::from_utf8_lossy(&result.stdout).trim(),
            "6:106:10:4:9:21"
        );
    }
}

#[test]
fn malformed_jvm_descriptor_fails_the_build_at_its_declaration() {
    let Some(root) = project("jvm-malformed-contract") else {
        return;
    };
    std::fs::write(
        root.join("foreign.d.ts"),
        r#"declare module "java:foreign" {
/** @ntsJvm static foreign/Probe.score:(I) */
export function score(n: number): number;
}"#,
    )
    .expect("declarations");
    std::fs::write(root.join("main.ts"), r#"import { score } from "java:foreign"; export function run(n: number): number { return score(n); }"#).expect("source");
    let result = emit(&root, "out");
    assert!(
        !result.status.success(),
        "a malformed descriptor must fail, not disappear"
    );
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(
        stderr.contains("foreign.d.ts")
            && stderr.contains("@ntsJvm method descriptor")
            && stderr.contains("(I)"),
        "{stderr}"
    );
}

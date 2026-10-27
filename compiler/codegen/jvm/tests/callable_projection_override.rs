//! A structural callable view keeps an existing Java subclass's plain override.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::Frontend;
use nts_jvm_emitter::{class::access, read};
use std::process::Command;

mod common;
#[path = "../../../test-support/scratch.rs"]
mod scratch;

const CLASS: &str = r"
export interface Entry { run(by: number): number; }
export class Counter implements Entry {
  value: number = 7;
  run(by: number): number { this.value += by; return this.value; }
}
export class CounterChild extends Counter {}
export function ownedCounter(n: number): Counter {
  return n > 0 ? new CounterChild() : new Counter();
}
export function entryControl(value: Entry, n: number): number {
  return value.run(n);
}
";
const CONTROL: &str = r"
export function through(value: Entry, n: number): number {
  return value.run(n);
}
";
const SUBJECT: &str = r"
interface Sink { run?: ((by: number) => number) | undefined; }
function projected(value: Counter, n: number): number {
  const target: Sink = value;
  return target.run?.(n) ?? -1;
}
export function through(value: Entry, n: number): number {
  if (value instanceof Counter) return projected(value as unknown as Counter, n);
  return -1;
}
";
const IMPLEMENTER: &str = r"
package nts.gen;
public final class OldCounterSubclass extends Counter {
  @Override public double run(double n) { return 1000 + n; }
}
";
const DRIVER: &str = r#"
package nts.gen;
public final class CallableOverrideDriver {
  public static void main(String[] args) {
    Counter value = new OldCounterSubclass();
    if (value.run(7) != 1007) throw new AssertionError("invalid plain override control");
    double result = Program.through(value, 7);
    if (result != 1007) throw new AssertionError("plain override bypassed: " + result);
    System.out.println("CALLABLE_OLD_OVERRIDE_PASS");
  }
}
"#;

fn preserve(path: &Utf8Path, source: &str, projected: bool, root: &Utf8Path) {
    std::fs::create_dir_all(path).unwrap();
    std::fs::write(path.join("main.ts"), format!("{CLASS}{source}")).unwrap();
    std::fs::write(
        path.join("tsconfig.json"),
        format!("{{\"extends\":\"{root}/tsconfig.fixtures.json\",\"files\":[\"main.ts\"]}}"),
    )
    .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&path.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = common::prepare(&snapshot).unwrap();
    assert!(
        prepared.program.uncompiled.is_empty(),
        "{:?}",
        prepared.program.uncompiled
    );
    assert_eq!(
        !prepared.program.interface_access.callable.is_empty(),
        projected
    );
    std::fs::write(
        path.join("program.debug"),
        format!("{:#?}", prepared.program),
    )
    .unwrap();
    let emitted = nts_codegen_jvm::emit(&prepared.program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let counter = emitted
        .classes
        .iter()
        .find(|c| c.binary_name == "nts/gen/Counter")
        .unwrap();
    let parsed = read::class_file(&counter.bytes).unwrap();
    assert_eq!(parsed.access & (access::FINAL | access::ABSTRACT), 0);
    assert!(parsed.methods.iter().any(|m| m.name == "run"
        && m.descriptor == "(D)D"
        && m.access & (access::STATIC | access::ABSTRACT | access::FINAL) == 0));
    for class in emitted.classes {
        let file = path.join(class.path());
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, class.bytes).unwrap();
    }
    std::fs::write(path.join("nts-runtime.jar"), nts_codegen_jvm::runtime_jar()).unwrap();
}

fn command(path: &Utf8Path, name: &str, cmd: &mut Command) {
    let result = cmd.current_dir(path).output().unwrap();
    std::fs::write(path.join(format!("{name}.stdout")), &result.stdout).unwrap();
    std::fs::write(path.join(format!("{name}.stderr")), &result.stderr).unwrap();
    std::fs::write(
        path.join(format!("{name}.status")),
        format!("{:?}\n", result.status),
    )
    .unwrap();
    assert!(
        result.status.success(),
        "{name}: {}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn projected_callable_keeps_old_plain_virtual_override() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let dir =
        scratch::ScratchDir::new(&root.join("target/callable-override-tests"), "old-subclass");
    let old = dir.join("old");
    let new = dir.join("new");
    preserve(&old, CONTROL, false, &root);
    preserve(&new, SUBJECT, true, &root);
    std::fs::write(old.join("OldCounterSubclass.java"), IMPLEMENTER).unwrap();
    std::fs::write(old.join("CallableOverrideDriver.java"), DRIVER).unwrap();
    command(
        &old,
        "javac",
        nts_codegen_jvm::toolchain::command(common::tool("javac").expect("javac required")).args([
            "-cp",
            ".:nts-runtime.jar",
            "-d",
            ".",
            "OldCounterSubclass.java",
            "CallableOverrideDriver.java",
        ]),
    );
    for name in ["OldCounterSubclass", "CallableOverrideDriver"] {
        let relative = format!("nts/gen/{name}.class");
        let bytes = std::fs::read(old.join(&relative)).unwrap();
        std::fs::write(new.join(&relative), &bytes).unwrap();
        assert_eq!(std::fs::read(new.join(relative)).unwrap(), bytes);
    }
    for (path, name) in [(&old, "old-java"), (&new, "new-java")] {
        command(
            path,
            name,
            nts_codegen_jvm::toolchain::command(common::tool("java").expect("java required")).args(
                [
                    "-Xverify:all",
                    "-cp",
                    ".:nts-runtime.jar",
                    "nts.gen.CallableOverrideDriver",
                ],
            ),
        );
        assert_eq!(
            std::fs::read_to_string(path.join(format!("{name}.stdout"))).unwrap(),
            "CALLABLE_OLD_OVERRIDE_PASS\n"
        );
    }
}

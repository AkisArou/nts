//! Java calls through a signature's typed face, with arguments.
//!
//! A written signature publishes a typed `call` to Java (`face::typed_call`):
//! it boxes each argument and calls the uniform erased entry, which takes the
//! closure, then the call's `this`, then the arguments (`hir::UNIFORM_THIS`).
//! A `this` pushed in the wrong place shifts every argument by one, which still
//! verifies and answers wrong. Nothing crossed this path until the JVM lane's
//! review of the receiver work asked for it.
//!
//! **What reaches it.** Only the signature class has the typed `call`. A
//! closure TypeScript made extends the callable root, so Java cannot call one
//! through the interface; a Java lambda handed to TypeScript is wrapped in the
//! signature's adapter (`Fn…$Lambda`), which inherits the typed `call`. So a
//! lambda handed in and handed back crosses both halves: `typed_call` boxing
//! the arguments behind an `undefined` `this`, and the adapter reading them
//! from the locals after it.
//!
//! Two strings joined in order make both failures visible: a swap answers
//! `right|left`, and a shift moves `undefined` into one of the places. A sum
//! would hide the swap.
//!
//! And the lambda's name, asked from TypeScript: to the program a Java lambda
//! is an anonymous function, so `""` -- the adapter's `nts$name` -- where a
//! missing one would refuse.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::process::Command;

mod common;

const SOURCE: &str = "\
export type Pair = (a: string, b: string) => void;
export function keep(f: Pair): Pair {
  return f;
}
// A call through the signature from TypeScript, of a closure TypeScript made:
// with neither, the program has no closure slot and the signature no entry, and
// the typed face goes with them, since a Java caller is not something the
// program can see.
export function callFromTypeScript(f: Pair): void {
  f(\"x\", \"y\");
}
export function callOne(): void {
  callFromTypeScript((a: string, b: string) => {});
}
export function nameOf(f: Pair): string {
  return \"[\" + f.name + \"]\";
}
// A signature-typed value handed to a runtime helper keeps the signature's
// slot declaration, which once displaced the face's concrete `call` with an
// abstract one: the adapter then threw `AbstractMethodError`.
export function textOf(f: Pair): string {
  return \"[\" + String(f).length + \"]\";
}
";

const DRIVE: &str = "\
public class Drive { public static void main(String[] a) {
  StringBuilder seen = new StringBuilder();
  nts.rt.NtsTextPairCallback back =
    (nts.rt.NtsTextPairCallback) nts.gen.Program.keep(
      (nts.rt.NtsTextPairCallback) (x, y) -> seen.append(x).append(\"|\").append(y));
  back.call(\"left\", \"right\");
  System.out.println(seen);
  System.out.println(nts.gen.Program.nameOf(back));
}}
";

#[test]
fn a_java_caller_passes_arguments_through_the_typed_face_in_order() {
    let Ok(tsgo) = std::env::var("NTS_TSGO").map(Utf8PathBuf::from) else {
        eprintln!("SKIP typed_face: NTS_TSGO is not set");
        return;
    };
    let (Some(javac), Some(java)) = (common::tool("javac"), common::tool("java")) else {
        eprintln!("SKIP typed_face: no JDK");
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-typed-face-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("main.ts"), SOURCE).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        "{\"compilerOptions\": {\"target\": \"ESNext\", \"module\": \"ESNext\", \"strict\": true}, \"files\": [\"main.ts\"]}\n",
    )
    .unwrap();
    let config = Utf8PathBuf::from_path_buf(dir.join("tsconfig.json")).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let program = hir::prepare(&snapshot).expect("prepared").program;
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(
        emitted.is_complete(),
        "{:?}",
        emitted
            .diagnostics
            .iter()
            .map(|d| &d.message)
            .collect::<Vec<_>>()
    );
    let out = dir.join("out");
    for class in &emitted.classes {
        let path = out.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &class.bytes).unwrap();
    }
    let jar = out.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    std::fs::write(out.join("Drive.java"), DRIVE).unwrap();
    let cp = format!("{}:{}", out.display(), jar.display());
    let compiled = Command::new(&javac)
        .args(["-cp", &cp, "-d"])
        .arg(&out)
        .arg(out.join("Drive.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let ran = Command::new(&java)
        .args(["-Xverify:all", "-cp", &cp, "Drive"])
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "{}{}",
        String::from_utf8_lossy(&ran.stdout),
        String::from_utf8_lossy(&ran.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&ran.stdout).trim(),
        "left|right\n[]"
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

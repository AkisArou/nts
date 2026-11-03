//! Every on-device initializer emitter is also checked on the host JVM.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use camino::Utf8Path;
use nts_frontend_ts::Frontend;
use std::process::Command;
mod common;
#[path = "../../../test-support/scratch.rs"]
mod scratch;

const HARNESSES: [(&str, &str, &str); 4] = [
    (
        "agrees-on-device.sh",
        "classes",
        include_str!("../../../../tooling/android/agrees-on-device.sh"),
    ),
    (
        "bytes-on-device.sh",
        "classes",
        include_str!("../../../../tooling/android/bytes-on-device.sh"),
    ),
    (
        "times-on-device.sh",
        "nts/classes",
        include_str!("../../../../tooling/android/times-on-device.sh"),
    ),
    (
        "aot-on-device.sh",
        "nts-classes",
        include_str!("../../../../tooling/android/aot-on-device.sh"),
    ),
];

fn command(path: &Utf8Path, label: &str, command: &mut Command) -> Vec<u8> {
    let result = command.current_dir(path).output().unwrap();
    std::fs::write(path.join(format!("{label}.stdout")), &result.stdout).unwrap();
    std::fs::write(path.join(format!("{label}.stderr")), &result.stderr).unwrap();
    assert!(result.status.success(), "{label}: {result:?}");
    result.stdout
}

fn emit(root: &Utf8Path, path: &Utf8Path, invocation: &str) -> nts_codegen_jvm::Emitted {
    std::fs::create_dir_all(path).unwrap();
    std::fs::write(
        path.join("main.ts"),
        format!("export function read(n: number): number {{ return n; }} {invocation}"),
    )
    .unwrap();
    let config = path.join("tsconfig.json");
    std::fs::write(
        &config,
        format!("{{\"extends\":\"{root}/tsconfig.fixtures.json\",\"files\":[\"main.ts\"]}}"),
    )
    .unwrap();
    let snapshot = Frontend::new(root)
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = common::prepare(&snapshot).unwrap();
    assert_eq!(prepared.program.refused_bodies().count(), 0);
    let emitted = nts_codegen_jvm::emit(&prepared.program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    emitted
}

fn classes(path: &Utf8Path, emitted: &nts_codegen_jvm::Emitted) {
    for class in &emitted.classes {
        let file = path.join(class.path());
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, &class.bytes).unwrap();
    }
}

fn initializer(root: &Utf8Path, path: &Utf8Path, script: &str) -> String {
    let (_, tail) = script
        .split_once("# nts-module-initializer: begin\n")
        .expect("actual emitter begin");
    let (block, _) = tail
        .split_once("# nts-module-initializer: end")
        .expect("actual emitter end");
    // Run the exact production block with its real class-path variables. This
    // path never enters the scripts' device admission or timing loops.
    let script = format!("{block}\nprintf '%s' \"$init\"\n");
    let flags = std::fs::read_to_string(root.join("runtime/jvm/test-vm-flags.txt")).unwrap();
    let flags = flags
        .lines()
        .map(|line| format!("-J{line}"))
        .collect::<Vec<_>>()
        .join(" ");
    String::from_utf8(command(
        path,
        "emitter",
        Command::new("sh")
            .args(["-eu", "-c", &script])
            .env("root", root)
            .env("out", path)
            .env("work", path)
            .env("nts_jdk_flags", flags),
    ))
    .unwrap()
}

fn launcher(path: &Utf8Path, jar: &Utf8Path, runtime: &Utf8Path, init: &str, expected: &[u8]) {
    std::fs::write(path.join("Launcher.java"), format!(
        "public final class Launcher {{ {init}\npublic static void main(String[] args) {{ System.out.println(nts.gen.Program.read(1)); }} }}"
    )).unwrap();
    let classpath = std::env::join_paths([jar, runtime]).unwrap();
    command(
        path,
        "javac",
        nts_codegen_jvm::toolchain::command(common::tool("javac").expect("javac required"))
            .args(["--release", "8", "-encoding", "UTF-8", "-cp"])
            .arg(&classpath)
            .arg("Launcher.java"),
    );
    let classpath = std::env::join_paths([path, jar, runtime]).unwrap();
    assert_eq!(
        command(
            path,
            "java",
            nts_codegen_jvm::toolchain::command(common::tool("java").expect("java required"))
                .args(["-Xverify:all", "-cp"])
                .arg(classpath)
                .arg("Launcher")
        ),
        expected
    );
}

#[test]
fn every_android_initializer_emitter_resolves_without_a_device() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let scratch =
        scratch::ScratchDir::new(&root.join("target/member-name-tests"), "android-emitters");
    for (case, invocation, expected) in [
        ("absent", "", &b"1.0\n"[..]),
        (
            "present",
            "console.log('module initialized');",
            &b"module initialized\n1.0\n"[..],
        ),
    ] {
        let path = scratch.join(case);
        let emitted = emit(&root, &path, invocation);
        let program = emitted
            .classes
            .iter()
            .find(|class| class.binary_name == "nts/gen/Program")
            .expect("actual Program class");
        let parsed = nts_jvm_emitter::read::class_file(&program.bytes).unwrap();
        let init = parsed
            .methods
            .iter()
            .find(|method| method.name == nts_codegen_jvm::generated_members::MODULE_INIT);
        assert_eq!(init.is_some(), case == "present", "actual module-root twin");
        if let Some(init) = init {
            assert_eq!(init.descriptor, "()V");
            assert!(
                init.code
                    .as_ref()
                    .is_some_and(|code| !code.bytes.is_empty())
            );
        }
        let compiled = path.join("compiled");
        classes(&compiled, &emitted);
        let jar = path.join("program.jar");
        command(
            &path,
            "jar",
            nts_codegen_jvm::toolchain::command(common::tool("jar").expect("jar required"))
                .args(["--create", "--file"])
                .arg(&jar)
                .arg("-C")
                .arg(&compiled)
                .arg("."),
        );
        let runtime = path.join("nts-runtime.jar");
        std::fs::write(&runtime, nts_codegen_jvm::runtime_jar()).unwrap();
        for (harness, directory, script) in HARNESSES {
            let working = path.join(harness);
            classes(&working.join(directory), &emitted);
            let init = initializer(&root, &working, script);
            eprintln!("{case}/{harness}: actual emitted initializer {init:?}");
            launcher(&working, &jar, &runtime, &init, expected);
            assert_eq!(
                !init.is_empty(),
                case == "present",
                "{harness} discarded the actual module initializer"
            );
            if case == "present" {
                assert!(
                    init.contains(nts_codegen_jvm::generated_members::MODULE_INIT),
                    "{harness}: {init}"
                );
            }
            eprintln!(
                "{case}/{harness}: actual emitter target {init:?}; launcher compiled and returned {:?}",
                String::from_utf8_lossy(expected)
            );
        }
    }
}

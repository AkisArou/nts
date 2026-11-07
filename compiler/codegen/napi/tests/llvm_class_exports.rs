//! Before-evidence: an LLVM addon names a class allocator it does not define.
//! The identical C addon is the executing control. When LLVM publishes the
//! allocator, replace the recorded failure below with the same value check.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![cfg(all(target_os = "linux", target_arch = "x86_64"))]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::{Command, Output};

#[path = "../../../test-support/scratch.rs"]
mod scratch;

const SOURCE: &str = r"
export const scalar: number = 17;
export function declaredFactory(n: number): number { return n + 1; }
export class Counter {
    value: number;
    constructor(n: number) { this.value = n; }
    read(): number { return this.value + 1; }
}
";

const ANSWER: &str = "{\"scalar\":17,\"declared\":18,\"method\":18}";
const OBSERVE: &str = r"
const answer = a => ({scalar: a.scalar, declared: a.declaredFactory(17), method: new a.Counter(17).read()});
";

#[test]
fn an_llvm_addon_class_has_no_published_allocation_entry() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/llvm-addon-class"), "before");
    std::fs::write(dir.join("main.ts"), SOURCE).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    let oracle = node_oracle(&dir.join("main.ts"));
    assert!(oracle.status.success(), "{}", text(&oracle));
    assert_eq!(String::from_utf8_lossy(&oracle.stdout).trim(), ANSWER);

    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            roots: hir::reachable::Roots::EntrySurface,
            ..hir::Options::default()
        },
    )
    .unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    let addon = nts_codegen_napi::emit(&prepared.program);
    assert!(addon.skipped.is_empty(), "{:?}", addon.skipped);
    let control = build_and_load(
        &root,
        &dir.join("c"),
        "program.c",
        c.writer.text(),
        &c,
        &addon,
    );
    assert!(control.status.success(), "C control: {}", text(&control));
    assert_eq!(String::from_utf8_lossy(&control.stdout).trim(), ANSWER);

    let subject = build_and_load(
        &root,
        &dir.join("llvm"),
        "program.ll",
        &llvm.text,
        &c,
        &addon,
    );
    let failure = String::from_utf8_lossy(&subject.stderr);
    assert!(
        !subject.status.success(),
        "LLVM allocator is now available: {}",
        text(&subject)
    );
    assert!(failure.contains("ERR_DLOPEN_FAILED"), "{}", text(&subject));
    assert!(
        failure.contains("undefined symbol: nts_construct_NtsObj_Counter"),
        "{}",
        text(&subject)
    );
    println!(
        "C agrees with node; LLVM eager load lacks its class allocator; artifacts: {}",
        dir.as_str()
    );
}

fn build_and_load(
    root: &Utf8Path,
    out: &Utf8Path,
    body: &str,
    source: &str,
    support: &nts_codegen_c::Emitted,
    addon: &nts_codegen_napi::Addon,
) -> Output {
    std::fs::create_dir_all(out).unwrap();
    std::fs::write(out.join(body), source).unwrap();
    addon.write_into(out.as_std_path()).unwrap();
    let mut sources = vec![
        out.join(body).into_std_path_buf(),
        out.join("addon.c").into_std_path_buf(),
    ];
    for file in support.support_files() {
        let path = file.write(out.as_std_path()).unwrap();
        if file.compiled {
            sources.push(path);
        }
    }
    let headers = root.join("third_party/node/src");
    assert!(
        headers.join("node_api.h").is_file(),
        "Node-API headers required"
    );
    let binary = out.join("probe.node");
    let linked = Command::new("clang")
        .args(["-std=c11", "-O1", "-shared", "-fPIC", "-I"])
        .arg(headers)
        .arg("-I")
        .arg(out)
        .args(sources)
        .args(["-lm", "-o"])
        .arg(&binary)
        .output()
        .unwrap();
    assert!(linked.status.success(), "{}", text(&linked));
    let script = format!(
        "const m={{exports:{{}}}};process.dlopen(m,process.argv[1],require('node:os').constants.dlopen.RTLD_NOW);{OBSERVE}console.log(JSON.stringify(answer(m.exports))); "
    );
    Command::new("node")
        .args(["-e", &script])
        .arg(binary)
        .output()
        .unwrap()
}

fn node_oracle(source: &Utf8Path) -> Output {
    let script = format!(
        "{OBSERVE}import(require('node:url').pathToFileURL(process.argv[1]).href).then(a=>console.log(JSON.stringify(answer(a)))).catch(e=>{{console.error(e);process.exitCode=1;}});"
    );
    Command::new("node")
        .args(["--no-warnings", "-e", &script])
        .arg(source)
        .output()
        .unwrap()
}

fn text(output: &Output) -> String {
    format!(
        "status={}; stdout={}; stderr={}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

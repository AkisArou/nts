//! A dynamic import's singleton keeps the imported module's source owner.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::scratch;

use camino::Utf8PathBuf;
use nts_core::hir::{HirType, ManagedType, OpKind, StaticDeclaration, StaticValueKind};
use nts_frontend_ts::Frontend;

use crate::common;

const DYNAMIC: &str = "(await import(\"./value.ts\"))";
const SOURCE: &str = r#"
import * as ns from "./value.ts";
export async function read(n: number): Promise<number> {
  return RECEIVER.value + n;
}
// Module jobs use the existing closure protocol. Keep its written signature
// in both arms, independently of the import expression under test.
export function invoke(callback: (n: number) => number): number {
  return callback(1);
}
"#;

fn project(arm: &str, source: &str) -> scratch::StdScratchDir {
    let path = scratch::StdScratchDir::in_std_target(&format!("module-namespace-{arm}"));
    std::fs::create_dir_all(path.join("src")).unwrap();
    let fixtures = common::repository().join("tsconfig.fixtures.json");
    std::fs::write(
        path.join("tsconfig.json"),
        format!(
            "{{\"extends\": {:?}, \"include\": [\"src\"]}}\n",
            fixtures.display().to_string()
        ),
    )
    .unwrap();
    std::fs::write(path.join("package.json"), "{\"type\":\"module\"}\n").unwrap();
    std::fs::write(path.join("src/main.ts"), source).unwrap();
    std::fs::write(path.join("src/value.ts"), "export const value = 41;\n").unwrap();
    path
}

fn imported_root(snapshot: &nts_semantic_schema::SemanticSnapshot) -> nts_semantic_schema::NodeId {
    snapshot
        .modules
        .iter()
        .find(|module| {
            let root = &snapshot.nodes[module.root.0 as usize];
            snapshot.sources[root.origin.location.file.0 as usize]
                .uri
                .ends_with("/src/value.ts")
        })
        .expect("the actual imported module")
        .root
}

fn namespace_ids(
    snapshot: &nts_semantic_schema::SemanticSnapshot,
    program: &nts_core::hir::Program,
) -> std::collections::BTreeSet<nts_semantic_schema::TypeId> {
    let symbol = snapshot.nodes[imported_root(snapshot).0 as usize]
        .symbol
        .unwrap();
    program
        .funcs
        .iter()
        .flat_map(|func| {
            func.blocks
                .iter()
                .flat_map(|block| &block.ops)
                .map(|value| &func.values[value.0 as usize])
        })
        .filter_map(|value| {
            let HirType::Managed(ManagedType::Object(id)) = value.ty else {
                return None;
            };
            (matches!(value.kind, OpKind::ClosureStatic)
                && snapshot
                    .types
                    .get(id.0 as usize)
                    .is_some_and(|record| record.symbol == Some(symbol)))
            .then_some(id)
        })
        .collect()
}

fn run_java(path: &std::path::Path, emitted: &nts_codegen_jvm::Emitted) {
    let out = path.join("out");
    std::fs::create_dir_all(&out).unwrap();
    for class in &emitted.classes {
        let file = out.join(class.path());
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, &class.bytes).unwrap();
    }
    let jar = out.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar()).unwrap();
    let driver = path.join("NamespaceDriver.java");
    std::fs::write(
        &driver,
        r#"import nts.gen.Program;
import nts.rt.*;
public final class NamespaceDriver {
  public static void main(String[] args) {
    NtsPromise promise = Program.read(1);
    NtsEnv.drain(NtsEnv.current());
    if (!NtsPromise.isSettled(promise) || NtsPromise.isRejected(promise))
      throw new AssertionError("read did not fulfil");
    if (NtsPromise.number(promise) != 42) throw new AssertionError("read lost its value");
    System.out.println("42");
  }
}
"#,
    )
    .unwrap();
    let classpath = format!("{}:{}", out.display(), jar.display());
    let compiled =
        nts_codegen_jvm::toolchain::command(common::tool("javac").expect("JDK required"))
            .args(["-encoding", "UTF-8", "-cp"])
            .arg(&classpath)
            .arg("-d")
            .arg(&out)
            .arg(&driver)
            .output()
            .unwrap();
    assert!(compiled.status.success(), "{compiled:?}");
    let ran = nts_codegen_jvm::toolchain::command(common::tool("java").expect("JDK required"))
        .args(["-Xverify:all", "-cp"])
        .arg(&classpath)
        .arg("NamespaceDriver")
        .output()
        .unwrap();
    assert!(ran.status.success(), "{ran:?}");
    assert_eq!(ran.stdout, b"42\n");
    println!("JAVA {}: 42", path.display());
}

#[test]
fn dynamic_and_static_imports_share_the_real_module_source() {
    let dynamic = SOURCE.replace("RECEIVER", DYNAMIC);
    let control = SOURCE.replace("RECEIVER", "ns");
    assert_eq!(dynamic.replace(DYNAMIC, "ns"), control);
    for (arm, source, dynamic) in [("static", control, false), ("dynamic", dynamic, true)] {
        let path = project(arm, &source);
        let node = std::process::Command::new("node")
            .args(["--experimental-strip-types", "--input-type=module", "-e"])
            .arg("const {read} = await import(process.argv[1]); console.log(await read(1));")
            .arg(path.join("src/main.ts"))
            .output()
            .unwrap();
        assert!(node.status.success(), "{node:?}");
        assert_eq!(node.stdout, b"42\n");
        println!("NODE {arm}: 42");
        let config = Utf8PathBuf::from_path_buf(path.join("tsconfig.json")).unwrap();
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .unwrap();
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let prepared = common::prepare(&snapshot).expect("actual exported library HIR");
        assert!(prepared.program.closure_slot.is_some());
        std::fs::write(
            path.join("preparation.debug"),
            format!(
                "modules: {:#?}\ndiagnostics: {:#?}\nuncompiled: {:#?}\nfunctions: {:#?}\n",
                snapshot.modules,
                prepared.diagnostics,
                prepared.program.uncompiled,
                prepared.program.funcs
            ),
        )
        .unwrap();
        let ids = namespace_ids(&snapshot, &prepared.program);
        assert_eq!(!ids.is_empty(), dynamic);
        println!("NAMESPACE {arm}: {ids:?}");
        let emitted = nts_codegen_jvm::emit(&prepared.program);
        assert!(
            emitted.is_complete(),
            "{arm} lost its namespace source: {:?}",
            emitted.diagnostics
        );
        assert!(
            emitted
                .classes
                .iter()
                .any(|c| c.binary_name == "nts/gen/Program")
        );
        let program_class = emitted
            .classes
            .iter()
            .find(|c| c.binary_name == "nts/gen/Program")
            .unwrap();
        let parsed = nts_jvm_emitter::read::class_file(&program_class.bytes).unwrap();
        assert!(
            parsed.methods.iter().any(|method| {
                method.name == "read"
                    && method
                        .code
                        .as_ref()
                        .is_some_and(|body| !body.bytes.is_empty())
            }),
            "actual read export missing: {:?}; uncompiled: {:?}; methods: {:?}",
            prepared.diagnostics,
            prepared.program.uncompiled,
            parsed.methods
        );
        for id in ids {
            let source = prepared.program.member_origins.values.get(&id).unwrap();
            let StaticDeclaration::Site(site) = &source.declaration else {
                panic!("namespace must retain its actual module root: {source:?}");
            };
            let mut locations = nts_diagnostics::SourceLocations::new(&snapshot.sources);
            let expected = locations
                .source_position(
                    &snapshot.nodes[imported_root(&snapshot).0 as usize]
                        .origin
                        .location,
                )
                .unwrap();
            assert_eq!(
                (&site.module, site.line, site.column),
                (&expected.0, expected.1, expected.2)
            );
            let job = prepared
                .program
                .member_origins
                .values
                .values()
                .find(|value| matches!(value.kind, StaticValueKind::ModuleJob)
                    && matches!(&value.declaration, StaticDeclaration::Site(root) if root == site))
                .expect("the job and namespace have the same actual module source");
            assert_ne!(
                std::mem::discriminant(&source.kind),
                std::mem::discriminant(&job.kind)
            );
            println!("NAMESPACE_SOURCE {id:?}: {source:?}");
        }
        run_java(&path, &emitted);
    }
}

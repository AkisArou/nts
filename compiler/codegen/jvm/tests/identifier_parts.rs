//! Identifier-part escapes must agree in declarations, JVM calls and Java source.
//!
//! The original two-export program used to decline its whole Program class as
//! duplicate `$$(D)D`. Raw HIR below keeps direct calls present so inlining cannot
//! make the reference check vacuous. Written escape lookalikes are separate names.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::process::Command;

use camino::Utf8Path;
use nts_core::hir::{self, HirType, OpKind, ValueId};
use nts_frontend_ts::Frontend;

mod common;

const CASES: &[(&str, &str, f64)] = &[
    ("$\u{200d}", "viaJoiner", 1.0),
    ("$\u{200c}", "viaNonJoiner", 2.0),
    ("$\u{00a2}u200d$", "viaLiteralJoiner", 3.0),
    ("$\u{00a2}u200c$", "viaLiteralNonJoiner", 4.0),
    ("$$", "viaDollars", 5.0),
    ("$a", "viaAscii", 6.0),
];

fn origin() -> nts_semantic_schema::Origin {
    nts_semantic_schema::Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span::new(0, 1),
    })
}

fn function(name: &str, kind: OpKind) -> hir::Func {
    hir::Func {
        name: name.to_owned(),
        params: Vec::new(),
        return_type: HirType::NUMBER,
        values: vec![hir::Op {
            kind,
            ty: HirType::NUMBER,
            origin: origin(),
        }],
        blocks: vec![hir::Block {
            params: Vec::new(),
            ops: vec![ValueId(0)],
            terminator: hir::Terminator::Return(Some(ValueId(0))),
        }],
        origin: origin(),
        exported: true,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: hir::ExactArithmetic::default(),
        written_return: None,
        result_absent: hir::Absent::Impossible,
        written_return_elements: Vec::new(),
    }
}

fn program_methods(emitted: &nts_codegen_jvm::Emitted) -> BTreeSet<String> {
    assert!(
        emitted.is_complete(),
        "{:?}",
        emitted
            .diagnostics
            .iter()
            .map(|d| &d.message)
            .collect::<Vec<_>>()
    );
    let class = emitted
        .classes
        .iter()
        .map(|class| nts_jvm_emitter::read::class_file(&class.bytes).unwrap())
        .find(|class| class.binary_name == "nts/gen/Program")
        .expect("the program class is emitted, rather than agreed by omission");
    class
        .methods
        .into_iter()
        .map(|method| method.name)
        .collect()
}

#[test]
fn the_original_joiner_exports_and_ascii_control_all_emit() {
    for (example, expected) in [
        (
            "an-identifier-part-keeps-its-c-spelling",
            ["$\u{00a2}u200d$", "$\u{00a2}u200c$"],
        ),
        (
            "an-identifier-part-keeps-its-c-spelling-control",
            ["$a", "$b"],
        ),
    ] {
        let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../../tests/programs/{example}/tsconfig.json"))
            .canonicalize_utf8()
            .unwrap();
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .unwrap();
        assert!(
            !snapshot.has_errors(),
            "{example}: {:?}",
            snapshot.diagnostics
        );
        let prepared = common::prepare(&snapshot).expect("valid prepared HIR");
        assert!(
            prepared.program.uncompiled.is_empty(),
            "unexpected refused functions: {:?}",
            prepared.program.uncompiled
        );
        let exports = prepared
            .program
            .funcs
            .iter()
            .filter(|func| func.exported && func.name != hir::lower::MODULE_INIT)
            .count();
        assert_eq!(exports, 2, "both original exports must survive preparation");
        let emitted = nts_codegen_jvm::emit(&prepared.program);
        let methods = program_methods(&emitted);
        for name in expected {
            assert!(
                methods.contains(name),
                "{example}: missing {name:?} in {methods:?}"
            );
        }
    }
}

fn java_source() -> String {
    let mut source = String::from(
        r#"public class Drive {
  public static void main(String[] args) throws Exception {
    if (!Character.isJavaIdentifierStart('\u00a2') || !Character.isJavaIdentifierPart('\u00a2'))
      throw new AssertionError("escape marker is not a Java identifier character");
"#,
    );
    for &(raw, caller, result) in CASES {
        let expected_name = nts_codegen_jvm::body::method_name(raw);
        let direct = format!(
            "nts.gen.Program.{}()",
            nts_codegen_jvm::body::method_name(raw)
        );
        writeln!(
            source,
            "    if ({direct} != {result:?}) throw new AssertionError(\"Java source {caller}\");"
        )
        .unwrap();
        writeln!(
            source,
            "    if (nts.gen.Program.{caller}() != {result:?}) throw new AssertionError(\"bytecode reference {caller}\");"
        )
        .unwrap();
        writeln!(
            source,
            "    if (((Double) nts.gen.Program.class.getDeclaredMethod({expected_name:?}).invoke(null)).doubleValue() != {result:?}) throw new AssertionError(\"reflection {caller}\");"
        )
        .unwrap();
    }
    source.push_str("    System.out.println(\"PASS\");\n  }\n}\n");
    source
}

fn run_java(emitted: &nts_codegen_jvm::Emitted, source: &str) -> Option<String> {
    let (Some(javac), Some(java)) = (common::tool("javac"), common::tool("java")) else {
        eprintln!("SKIP identifier_parts Java-source/reference execution: no JDK");
        return None;
    };
    let dir = std::env::temp_dir().join(format!("nts-identifier-parts-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &class.bytes).unwrap();
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    let driver = dir.join("Drive.java");
    std::fs::write(&driver, source).unwrap();
    let cp = std::env::join_paths([&dir, &jar]).unwrap();
    let compiled = Command::new(javac)
        .args([
            "--release",
            "8",
            "-encoding",
            "UTF-8",
            "-Xlint:all,-options",
            "-Werror",
            "-cp",
        ])
        .arg(&cp)
        .arg("-d")
        .arg(&dir)
        .arg(&driver)
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let ran = Command::new(java)
        .args(["-Xverify:all", "-cp"])
        .arg(&cp)
        .arg("Drive")
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(
        ran.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    let output = String::from_utf8(ran.stdout).unwrap();
    std::fs::remove_dir_all(&dir).unwrap();
    Some(output)
}

#[test]
fn declarations_direct_refs_and_generated_java_calls_keep_escape_identity() {
    let mut funcs = Vec::new();
    for &(raw, caller, result) in CASES {
        funcs.push(function(raw, OpKind::ConstFloat(result)));
        funcs.push(function(
            caller,
            OpKind::Call {
                callee: hir::Callee::Direct(raw.to_owned()),
                args: Vec::new(),
                frame: None,
            },
        ));
    }
    let program = hir::Program {
        funcs,
        ..hir::Program::default()
    };
    hir::verify::verify(&program).expect("the direct-call control is valid HIR");
    let emitted = nts_codegen_jvm::emit(&program);
    let methods = program_methods(&emitted);
    for &(raw, caller, _) in CASES {
        let expected = nts_codegen_jvm::body::method_name(raw);
        assert!(
            methods.contains(&expected),
            "missing {expected:?} in {methods:?}"
        );
        assert!(
            methods.contains(caller),
            "missing direct-call wrapper {caller}"
        );
    }
    // The source uses the same direct-call interpolation as tooling/bench. A
    // punctuation marker reaches javac and fails there; hardcoded namespace
    // assertions in the other test cannot make this boundary pass vacuously.
    let source = java_source();
    let Some(output) = run_java(&emitted, &source) else {
        return;
    };
    assert_eq!(output, "PASS\n");
}

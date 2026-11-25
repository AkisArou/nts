//! Intrinsic recognition consumes checked global identity, including provenance.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fmt::Write as _;

use super::{FuncBuilder, LoweringSnapshot, NodeId, OpKind, UnOp, syntax};

fn with_source(source: &str, check: impl FnOnce(&nts_semantic_schema::SemanticSnapshot)) {
    with_options(source, &serde_json::json!({}), check);
}

fn with_options(
    source: &str,
    options: &serde_json::Value,
    check: impl FnOnce(&nts_semantic_schema::SemanticSnapshot),
) {
    let dir = crate::scratch::StdScratchDir::path_in_std_target("builtin-identity");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let config = dir.join("tsconfig.json");
    std::fs::write(
        &config,
        serde_json::json!({
            "extends": root.join("tsconfig.fixtures.json"),
            "files": ["main.ts".to_owned(), root.join("runtime/native/libc.d.ts").to_string()],
            "compilerOptions": options,
        })
        .to_string(),
    )
    .unwrap();
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(camino::Utf8Path::from_path(&config).unwrap())
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    check(&snapshot);
}

#[test]
fn source_and_ambient_builtin_names_are_not_global_intrinsics() {
    with_source(
        r"
declare var Math: { floor(x: number): number };
declare const JSON: { stringify(x: number): string };
export function ambientMath(n: number) { return Math.floor(n); }
export function ambientJSON(n: number) { return JSON.stringify(n); }
export function parameter(Math: { floor(x: number): number }, n: number) { return Math.floor(n); }
export function local(n: number) {
  const Number = { isNaN: (x: number) => x === x };
  return Number.isNaN(n);
}
",
        |semantic| {
            let snapshot = LoweringSnapshot::new(semantic);
            let probe = FuncBuilder::probe(&snapshot);
            let mut calls = 0;
            for (index, node) in snapshot.nodes.iter().enumerate() {
                if node.kind != super::NodeKind::Syntax(syntax::CALL_EXPRESSION) {
                    continue;
                }
                let id = NodeId(u32::try_from(index).unwrap());
                let callee = probe.children(id)[0];
                assert!(probe.builtin_global_member(callee).is_none());
                assert!(probe.intrinsic_of(callee).is_none());
                assert!(!probe.is_json_stringify(callee));
                calls += 1;
            }
            assert_eq!(calls, 4);
        },
    );
}

#[test]
fn a_local_math_uses_its_binding_and_the_global_keeps_its_intrinsic() {
    with_source(
        r"
export function local(n: number): number {
  const Math = { floor: (x: number): number => x + 1 };
  return Math.floor(n);
}

export function global(n: number): number { return Math['floor'](n); }
",
        |semantic| {
            let lowered = super::lower(semantic);
            assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
            for (name, floor) in [("local", false), ("global", true)] {
                let func = lowered
                    .program
                    .funcs
                    .iter()
                    .find(|f| f.name == name)
                    .unwrap();
                assert_eq!(
                    func.values.iter().any(|value| matches!(
                        value.kind,
                        OpKind::Unary {
                            op: UnOp::Floor,
                            ..
                        }
                    )),
                    floor,
                    "{name}: {:?}",
                    func.values
                );
            }
        },
    );
}

#[test]
fn a_real_global_alias_retains_its_initialization_obligation() {
    with_source(
        "export function alias(n: number): number { const M = Math; return M.floor(n); }",
        |semantic| {
            let snapshot = LoweringSnapshot::new(semantic);
            let probe = FuncBuilder::probe(&snapshot);
            let alias = snapshot
                .nodes
                .iter()
                .enumerate()
                .find_map(|(index, node)| {
                    (node.text.as_ref().and_then(|text| text.as_utf8()) == Some("M")
                        && node.parent.is_some_and(|parent| {
                            probe.kind_of(parent) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
                        }))
                    .then(|| NodeId(u32::try_from(index).unwrap()))
                })
                .unwrap();
            let global = probe.builtin_global_reference(alias).unwrap();
            assert_eq!(global.name, "Math");
            assert_eq!(
                global.bindings.len(),
                1,
                "alias initialization remains an obligation"
            );
        },
    );
}

#[test]
fn uninitialized_variables_and_catch_parameters_create_source_bindings() {
    with_source(
        r"
export function variable(n: number): number {
    var Math: { floor(n: number): number };
    Math = { floor: n => n + 1 };
    return Math.floor(n);
}
export function caught(n: number): number {
    try { throw { floor: (n: number) => n + 1 }; }
    catch (Math) { return (Math as { floor(n: number): number }).floor(n); }
}",
        |semantic| {
            let snapshot = LoweringSnapshot::new(semantic);
            let probe = FuncBuilder::probe(&snapshot);
            let mut calls = 0;
            for (index, node) in snapshot.nodes.iter().enumerate() {
                if node.kind == super::NodeKind::Syntax(syntax::CALL_EXPRESSION) {
                    let callee = probe.children(NodeId(u32::try_from(index).unwrap()))[0];
                    assert!(probe.builtin_global_member(callee).is_none());
                    calls += 1;
                }
            }
            assert_eq!(calls, 2);
        },
    );
}

#[test]
fn all_static_families_reject_source_receivers() {
    let mut source = String::new();
    for (global, member) in [
        ("Math", "floor"),
        ("Number", "parseInt"),
        ("String", "fromCharCode"),
        ("JSON", "stringify"),
        ("console", "log"),
        ("Array", "isArray"),
        ("ArrayBuffer", "isView"),
        ("Object", "keys"),
        ("Symbol", "for"),
        ("BigInt", "asIntN"),
        ("Promise", "resolve"),
        ("Uint8Array", "of"),
    ] {
        let (parameters, arguments) = if global == "BigInt" {
            ("x: number, y: number", "n, 1")
        } else {
            ("x: number", "n")
        };
        writeln!(source, "export function own{global}(n: number): number {{ const {global} = {{ {member}: ({parameters}): number => x + 1 }}; return {global}.{member}({arguments}); }}").unwrap();
    }
    with_source(&source, |semantic| {
        let snapshot = LoweringSnapshot::new(semantic);
        let mut probe = FuncBuilder::probe(&snapshot);
        let mut calls = 0;
        for (index, node) in snapshot.nodes.iter().enumerate() {
            if node.kind != super::NodeKind::Syntax(syntax::CALL_EXPRESSION) {
                continue;
            }
            let id = NodeId(u32::try_from(index).unwrap());
            let callee = probe.children(id)[0];
            assert!(
                probe
                    .lower_special_call(id, callee, &probe.arguments_of(id))
                    .is_none()
            );
            calls += 1;
        }
        assert_eq!(calls, 12);
    });
}

#[test]
fn real_global_members_keep_their_declaring_library_identity() {
    with_source(
        r#"
export function globals() {
  Math.floor(1); Number.parseInt("1"); String.fromCharCode(65);
  JSON.stringify(1); console.log(1); Array.isArray(1);
  ArrayBuffer.isView(1); Object.keys({}); Symbol.for("x");
  BigInt.asIntN(8, 1n); Promise.resolve(1); Uint8Array.of(1);
}
"#,
        |semantic| {
            let snapshot = LoweringSnapshot::new(semantic);
            let probe = FuncBuilder::probe(&snapshot);
            let mut calls = 0;
            for (index, node) in snapshot.nodes.iter().enumerate() {
                if node.kind != super::NodeKind::Syntax(syntax::CALL_EXPRESSION) {
                    continue;
                }
                let id = NodeId(u32::try_from(index).unwrap());
                let callee = probe.children(id)[0];
                assert!(probe.builtin_global_member(callee).is_some(), "{node:?}");
                calls += 1;
            }
            assert_eq!(calls, 12);
        },
    );
}

#[test]
fn native_intrinsic_binding_is_independent_of_global_identity() {
    with_source(
        r#"
import { sizeof } from "c:memory";
import type { Float64 } from "@nts/scalars";
/** @ntsSymbol nts_probe_isnan */
declare function isNaN(n: Float64): boolean;
export function nativeSize(): number { return sizeof<Float64>(); }
export function nativePredicate(n: Float64): boolean { return isNaN(n); }
"#,
        |semantic| {
            let lowered = super::lower(semantic);
            assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
            let func = lowered
                .program
                .funcs
                .iter()
                .find(|f| f.name == "nativeSize")
                .unwrap();
            assert!(
                func.values
                    .iter()
                    .any(|value| matches!(value.kind, OpKind::NativeSizeOf(_)))
            );
            let predicate = lowered
                .program
                .funcs
                .iter()
                .find(|function| function.name == "nativePredicate")
                .unwrap();
            assert!(predicate.values.iter().any(|value| {
                matches!(&value.kind, OpKind::Call { callee: super::Callee::Native(function), .. } if function.name == "nts_probe_isnan")
            }));
        },
    );
}

#[test]
fn a_node_library_global_keeps_the_same_runtime_intrinsic_without_dom() {
    let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    with_options(
        "export function nodeGlobal(n: number): number { console.log(n); return Math.floor(n); }",
        &serde_json::json!({
            "types": ["node"], "lib": ["ESNext"],
            "typeRoots": [root.join("node_modules/@types")],
        }),
        |semantic| {
            assert!(semantic.symbols.iter().any(|record| {
                record.name.is_name("console")
                    && record.library == Some(nts_semantic_schema::Library::Node)
                    && record
                        .flags
                        .contains(nts_semantic_schema::SymbolFlags::GLOBAL_VALUE)
            }));
            let lowered = super::lower(semantic);
            assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
            let func = lowered
                .program
                .funcs
                .iter()
                .find(|func| func.name == "nodeGlobal")
                .unwrap();
            assert!(func.values.iter().any(|value| {
                matches!(&value.kind, OpKind::Call { callee: super::Callee::External(name), .. } if name == "nts_console_write")
            }));
        },
    );
}

#[test]
fn type_augmentation_and_compatible_ambient_declarations_keep_global_values() {
    for source in [
        r"declare global {
            interface Number { readonly tag?: undefined; }
            interface ArrayBuffer { readonly tag?: undefined; }
            var Math: Math;
            function isNaN(n: number): boolean;
        }
        export function floor(n: number): number { return Math.floor(n) + Number.EPSILON; }
        export function view(v: Uint8Array): boolean { return ArrayBuffer.isView(v); }
        export function predicate(n: number): boolean { return isNaN(n); }",
        r"declare const Math: typeof globalThis.Math;
        declare const JSON: typeof globalThis.JSON;
        declare const Number: typeof globalThis.Number;
        export function floor(n: number): number { return Math.floor(n) + Number.EPSILON; }
        export function json(n: number): string { return JSON.stringify(n); }",
    ] {
        with_source(source, |semantic| {
            let lowered = super::lower(semantic);
            assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
            assert!(
                lowered.program.refused_bodies().next().is_none(),
                "{:?}",
                lowered.program.uncompiled
            );
            assert!(
                lowered
                    .program
                    .funcs
                    .iter()
                    .find(|function| function.name == "floor")
                    .unwrap()
                    .values
                    .iter()
                    .any(|value| matches!(
                        value.kind,
                        OpKind::Unary {
                            op: UnOp::Floor,
                            ..
                        }
                    ))
            );
        });
    }
}

#[test]
fn incompatible_ambient_bindings_and_missing_value_provenance_refuse_by_name() {
    with_source(
        r"declare const Math: { floor(n: number): number };
        export function floor(n: number): number { return Math.floor(n); }",
        |semantic| {
            let lowered = super::lower(semantic);
            let refusals = format!("{:?}", lowered.program.uncompiled);
            assert!(
                refusals.contains("ambient re-declaration of builtin `Math` with a different type"),
                "{refusals}"
            );
        },
    );
    with_source(
        "export function floor(n: number): number { return Math.floor(n); }",
        |semantic| {
            let mut broken = semantic.clone();
            let math = broken
                .symbols
                .iter_mut()
                .find(|symbol| {
                    symbol.name.is_name("Math")
                        && symbol
                            .flags
                            .contains(nts_semantic_schema::SymbolFlags::GLOBAL_VALUE)
                })
                .unwrap();
            math.value_provenance = None;
            let error = broken.validate().unwrap_err().to_string();
            assert!(
                error.contains("Math") && error.contains("missing checker value provenance"),
                "{error}"
            );
            let lowered = super::lower(&broken);
            let refusals = format!("{:?}", lowered.program.uncompiled);
            assert!(
                refusals.contains("Math") && refusals.contains("missing checker value provenance"),
                "{refusals}"
            );
        },
    );
}

#[test]
fn a_compatible_ambient_length_resolves_to_the_dom_global() {
    with_source(
        "declare const length: number; export function read(): number { return length; }",
        |semantic| {
            let snapshot = LoweringSnapshot::new(semantic);
            let probe = FuncBuilder::probe(&snapshot);
            let at = snapshot
                .nodes
                .iter()
                .enumerate()
                .find_map(|(index, node)| {
                    (node.text.as_ref().and_then(|text| text.as_utf8()) == Some("length")
                        && node.parent.is_some_and(|parent| {
                            probe.kind_of(parent) == Some(syntax::RETURN_STATEMENT)
                        }))
                    .then(|| NodeId(u32::try_from(index).unwrap()))
                })
                .unwrap();
            let global = probe.checked_global_reference(at).unwrap();
            assert_eq!(global.name, "length");
            assert_eq!(global.library, nts_semantic_schema::Library::Dom);
            assert_ne!(Some(global.symbol), probe.node(at).symbol);
            let lowered = super::lower(semantic);
            assert!(lowered.program.refused_bodies().next().is_some());
            assert!(lowered.diagnostics.iter().any(|diagnostic| {
                diagnostic
                    .message
                    .contains("a declared `const` no one gives a value")
            }));
        },
    );
}

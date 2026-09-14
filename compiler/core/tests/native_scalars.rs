//! Native brands change boundary types, never ordinary TypeScript arithmetic
//! or the representation of arbitrary object intersections.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir::{self, HirType};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn snapshot(name: &str, source: &str) -> Option<nts_semantic_schema::SemanticSnapshot> {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("SKIP native scalars: tsgo is required");
        return None;
    };
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .unwrap();
    let dir: Utf8PathBuf = root.join(format!(
        "target/native-scalar-tests/{}-{name}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("tsconfig.json"), format!(
        r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","{root}/runtime/native/libc.d.ts"]}}"#
    )).unwrap();
    std::fs::write(dir.join("main.ts"), format!("{}{}", "import type { c_int, c_uint, c_int8, c_uint8, c_int16, c_uint16, c_int32, c_uint32, c_int64, c_uint64, c_long, c_ulong, c_size_t, c_ptrdiff_t, c_float, c_double } from \"c:types\";\n", source)).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some(snapshot)
}

#[test]
fn every_brand_has_number_semantics_in_both_signature_positions() {
    for name in [
        "c_int",
        "c_uint",
        "c_int8",
        "c_uint8",
        "c_int16",
        "c_uint16",
        "c_int32",
        "c_uint32",
        "c_int64",
        "c_uint64",
        "c_long",
        "c_ulong",
        "c_size_t",
        "c_ptrdiff_t",
        "c_float",
        "c_double",
    ] {
        let Some(snapshot) = snapshot(
            name,
            &format!(
                "export function argument(n: {name}): number {{ return n + 0.25; }}\n\
             export function result(n: number): {name} {{ return (n + 0.5) as {name}; }}"
            ),
        ) else {
            return;
        };
        let lowered = hir::lower::lower(&snapshot);
        assert!(
            lowered.diagnostics.is_empty(),
            "{name}: {:?}",
            lowered.diagnostics
        );
        let argument = lowered
            .program
            .funcs
            .iter()
            .find(|f| f.name == "argument")
            .unwrap();
        let result = lowered
            .program
            .funcs
            .iter()
            .find(|f| f.name == "result")
            .unwrap();
        assert_eq!(argument.params[0].ty, HirType::NUMBER, "{name}");
        assert_eq!(argument.return_type, HirType::NUMBER, "{name}");
        assert_eq!(result.return_type, HirType::NUMBER, "{name}");
    }
}

#[test]
fn brand_support_does_not_admit_structural_intersection_reads() {
    let Some(snapshot) = snapshot(
        "structural-control",
        r#"
        export function branded(n: c_int): c_int { return (n + 0.5) as c_int; }
        export function structural(v: object): unknown {
            if ("href" in v) return v.href;
            return undefined;
        }
        export function arbitrary(n: number & { readonly q: symbol }): number { return n; }
    "#,
    ) else {
        return;
    };
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.program.funcs.iter().any(|f| f.name == "branded"));
    assert!(!lowered.program.funcs.iter().any(|f| f.name == "structural"));
    assert!(!lowered.program.funcs.iter().any(|f| f.name == "arbitrary"));
    assert_eq!(lowered.diagnostics.len(), 2, "{:?}", lowered.diagnostics);
}

#[test]
fn phantom_brand_property_reads_are_explicitly_refused() {
    for (name, read) in [
        ("dot", "n.__c_int"),
        ("index", "n['__c_int']"),
        ("optional", "n?.__c_int"),
    ] {
        let Some(snapshot) = snapshot(
            name,
            &format!("export function read(n: c_int): symbol {{ return {read}; }}"),
        ) else {
            return;
        };
        let lowered = hir::lower::lower(&snapshot);
        assert!(lowered.program.funcs.is_empty());
        assert_eq!(lowered.diagnostics.len(), 1);
        assert!(
            format!("{:?}", lowered.diagnostics).contains("reading a native ABI brand"),
            "{name}: {:?}",
            lowered.diagnostics
        );
    }
}

#[test]
fn managed_abi_belongs_only_to_the_annotated_declaration() {
    let Some(snapshot) = snapshot(
        "managed-annotation",
        r"
        // Unicode before the annotation exercises UTF-16 source positions: α😀
        /** @ntsAbi managed */
        declare function bridge(n: number, s: string): string;
        declare function unmarked(n: number): number;
        /**
         * @ntsAbi nonsense
         */
        declare function invalid(n: number): number;
        export function good(n: number, s: string): string { return bridge(n, s); }
        export function bad(n: number): number { return unmarked(n); }
        export function wrong(n: number): number { return invalid(n); }
    ",
    ) else {
        return;
    };
    let annotations: Vec<_> = snapshot
        .nodes
        .iter()
        .filter_map(|node| node.native_abi.as_deref())
        .collect();
    assert_eq!(annotations, ["managed", "nonsense"]);
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.program.funcs.iter().any(|f| f.name == "good"));
    assert!(
        !lowered
            .program
            .funcs
            .iter()
            .any(|f| f.name == "bad" || f.name == "wrong")
    );
    assert_eq!(lowered.diagnostics.len(), 2, "{:?}", lowered.diagnostics);
    assert!(format!("{:?}", lowered.diagnostics).contains("unknown @ntsAbi `nonsense`"));
}

#[test]
fn opaque_pointers_reject_boxing_forgery_and_numeric_containers() {
    let declarations = "import type { Opaque } from \"c:types\"; type Counter = Opaque<\"Counter\">; declare function make(): Counter; declare function read(c: Counter): c_int;\n";
    for (name, body) in [
        ("pointer-array", "export function bad(): number { const a = [make()]; return read(a[0]!); }"),
        ("pointer-erased", "export function bad(): unknown { return make(); }"),
        ("pointer-field", "export function bad(): string { return make().__c_opaque; }"),
        ("pointer-in", "export function bad(): boolean { return \"__c_opaque\" in make(); }"),
        ("pointer-index", "export function bad(): string { return make()[\"__c_opaque\"]; }"),
        ("pointer-forged", "export function bad(): Counter { return { __c_opaque: \"Counter\" }; }"),
        ("pointer-cast", "export function bad(n: number): Counter { return n as unknown as Counter; }"),
        ("pointer-brand-cast", "type Other = Opaque<\"Other\">; export function bad(): Other { return make() as unknown as Other; }"),
        ("pointer-undefined", "export function bad(n: number): Counter | undefined { return n ? make() : undefined; }"),
    ] {
        // The valid arm is present in the same program as every rejected arm.
        let source = format!("{declarations} export function good(): number {{ return read(make()); }} {body}");
        let Some(snapshot) = snapshot(name, &source) else { return; };
        let prepared = hir::prepare(&snapshot).unwrap();
        assert!(!prepared.diagnostics.is_empty(), "{name} must refuse");
        assert!(prepared.program.funcs.iter().any(|f| f.name == "good"), "{name}: valid arm lost");
        assert!(!prepared.program.funcs.iter().any(|f| f.name == "bad"), "{name}: rejected function emitted");
    }
}

#[test]
fn opaque_pointee_identity_does_not_depend_on_signature_position() {
    for (name, declaration, body) in [
        ("result", "declare function create(): Handle;", "export function run(): Handle { return create(); }"),
        ("parameter", "declare function consume(p: Handle): c_int;", "export function run(p: Handle): number { return consume(p); }"),
    ] {
        for witness in ["", "type Unused = Opaque<\"Different\">;"] {
            let source = format!("import type {{ Opaque }} from \"c:types\"; type Handle = Opaque<\"_Counter\">; {declaration} {body} {witness}");
            let Some(snapshot) = snapshot(&format!("opaque-position-{name}"), &source) else { return; };
            let prepared = hir::prepare(&snapshot).unwrap();
            assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
            let run = prepared.program.funcs.iter().find(|f| f.name == "run").unwrap();
            let pointer = HirType::NativePointer("_Counter".to_owned());
            if name == "result" { assert_eq!(run.return_type, pointer); }
            else { assert_eq!(run.params[0].ty, pointer); }
        }
    }
}

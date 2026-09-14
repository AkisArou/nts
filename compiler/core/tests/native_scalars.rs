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

/// The brands a `number` can carry, in both signature positions.
///
/// This used to name every brand, which recorded a policy rather than a fact:
/// the 64-bit spellings were `number`-based and so `INT64_MAX` came back as
/// `INT64_MIN`. They are `bigint`-based now and have their own test below --
/// the two families are asserted separately because a test spanning both
/// would have to be written in whichever semantics they share, and they share
/// none.
#[test]
fn a_narrow_brand_has_number_semantics_in_both_signature_positions() {
    for name in [
        "c_int",
        "c_uint",
        "c_int8",
        "c_uint8",
        "c_int16",
        "c_uint16",
        "c_int32",
        "c_uint32",
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
        // Assert attachment within this fixture, independent of tags on the
        // imported library's own declarations.
        .filter(|node| snapshot.sources[node.origin.location.file.0 as usize].display_path.file_name() == Some("main.ts"))
        .filter_map(|node| node.native.as_ref().and_then(|n| n.abi.as_deref()))
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
            let pointer = HirType::NativePointer(hir::native::Pointee::Opaque("_Counter".to_owned()));
            if name == "result" { assert_eq!(run.return_type, pointer); }
            else { assert_eq!(run.params[0].ty, pointer); }
        }
    }
}

#[test]
fn scalar_pointer_access_does_not_admit_object_or_pointer_forgery() {
    let declarations = "import type { Ptr } from \"c:types\"; type Bytes = Ptr<c_uint8>; declare function make(): Bytes;";
    for (name, body) in [
        ("erase", "export function bad(): unknown { return make(); }"),
        ("brand", "export function bad(): c_uint8 { return make().__c_pointer; }"),
        ("in", "export function bad(): boolean { return '__c_pointer' in make(); }"),
        // The forgery has to carry `__c_writable` too, or TypeScript refuses it
        // before lowering is reached and this arm stops testing the lowering
        // guard it exists for.
        ("forged", "export function bad(): Bytes { return { __c_pointer: 0 as c_uint8, __c_writable: true }; }"),
        ("cast", "export function bad(n: number): Bytes { return n as unknown as Bytes; }"),
        ("reinterpret", "export function bad(): Ptr<c_double> { return make() as unknown as Ptr<c_double>; }"),
        ("array", "export function bad(): number { const a = [make()]; return a[0]![0]; }"),
    ] {
        let source = format!("{declarations} export function good(): number {{ const p = make(); p[0] = 42; return p[0]; }} {body}");
        let Some(snapshot) = snapshot(&format!("scalar-pointer-{name}"), &source) else { return; };
        let prepared = hir::prepare(&snapshot).unwrap();
        assert!(!prepared.diagnostics.is_empty(), "{name} must refuse");
        assert!(prepared.program.funcs.iter().any(|f| f.name == "good"), "{name}: valid arm lost");
        assert!(!prepared.program.funcs.iter().any(|f| f.name == "bad"), "{name}: rejected function emitted");
    }
}

#[test]
fn native_memory_verifier_rejects_corrupted_widths_and_indices() {
    let Some(snapshot) = snapshot("native-memory-verifier", "import type { Ptr } from \"c:types\"; export function run(p: Ptr<c_uint8>, n: number): number { p[0] = n; return p[1]; }") else { return; };
    let prepared = hir::prepare(&snapshot).unwrap();
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let function = prepared.program.funcs.iter().position(|f| f.name == "run").unwrap();
    for arm in ["read", "store", "index", "opaque"] {
        let mut program = prepared.program.clone();
        let func = &mut program.funcs[function];
        let (load, pointer, index) = func.values.iter().enumerate().find_map(|(at, op)| match op.kind {
            hir::OpKind::NativeLoad { pointer, index } => Some((at, pointer, index)),
            _ => None,
        }).unwrap();
        match arm {
            "read" => func.values[load].ty = HirType::NUMBER,
            "index" => func.values[index.0 as usize].ty = HirType::NUMBER,
            "opaque" => func.values[pointer.0 as usize].ty = HirType::NativePointer(hir::native::Pointee::Opaque("Hidden".to_owned())),
            _ => {
                let stored = func.values.iter().find_map(|op| match op.kind {
                    hir::OpKind::NativeStore { value, .. } => Some(value), _ => None,
                }).unwrap();
                func.values[stored.0 as usize].ty = HirType::NUMBER;
            }
        }
        assert!(hir::verify::verify(&program).is_err(), "{arm} corruption must fail");
    }
}

#[test]
fn scalar_pointees_survive_return_only_declarations_and_unrelated_types() {
    for brand in ["c_int", "c_uint", "c_int8", "c_uint8", "c_int16", "c_uint16", "c_int32", "c_uint32", "c_int64", "c_uint64", "c_long", "c_ulong", "c_size_t", "c_ptrdiff_t", "c_float", "c_double"] {
        for witness in ["", "type Unused = Ptr<c_double>;"] {
            let source = format!("import type {{ Ptr }} from \"c:types\"; declare function make(): Ptr<{brand}>;
                // `void` rather than `number`: an element of a 64-bit brand is a
                // bigint, and this test is about the *pointee* surviving, not
                // about what the element projects to.
                export function run(): void {{ void make()[1]; }} {witness}");
            let Some(snapshot) = snapshot(&format!("pointer-result-{brand}"), &source) else { return; };
            let prepared = hir::prepare(&snapshot).unwrap();
            assert!(prepared.diagnostics.is_empty(), "{brand}: {:?}", prepared.diagnostics);
            let expected = HirType::NativePointer(hir::native::Pointee::Scalar(hir::native::Scalar::from_brand(&format!("__{brand}")).unwrap()));
            let run = prepared.program.funcs.iter().find(|f| f.name == "run").unwrap();
            let call = run.values.iter().find(|op| matches!(op.kind, hir::OpKind::Call { .. })).unwrap();
            assert_eq!(call.ty, expected, "{brand}");
        }
    }
}

#[test]
fn local_storage_and_sizeof_lower_from_the_authored_types() {
    let Some(snapshot) = snapshot("local-storage", r#"
        import { local, sizeof, addrOf } from "c:memory";
        import { malloc, free } from "c:stdlib";
        import type { Ptr, Struct } from "c:types";
        type Request = Struct<{ fd: c_int; events: c_int16; revents: c_int16 }, "pollfd">;
        /** Poll only borrows the request array.
         * @ntsNoEscape p
         */
        declare function poll(p: Ptr<Request>, count: c_ulong, timeout: c_int): c_int;
        function read(p: Ptr<c_int>): number { return p[0]; }
        export function run(): number {
            const p = local<Request>(2);
            p[0].fd = -1 as c_int; p[1].fd = -1 as c_int;
            const r = poll(p, 2n as c_ulong, 0 as c_int);
            return r + read(addrOf(p[0].fd)) + sizeof<Request>() + sizeof<c_int>();
        }
        export function heap(bytes: number): number {
            const p = malloc<c_int>(bytes);
            if (p === null) return -1;
            p[0] = 31;
            const result = p[0];
            free(p);
            return result;
        }
    "#) else { return; };
    let prepared = hir::prepare(&snapshot).unwrap();
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    assert!(prepared.program.funcs.iter().any(|f| f.name == "run"));
    assert!(prepared.program.funcs.iter().any(|f| f.name == "heap"));
}

#[test]
fn local_addresses_cannot_outlive_or_free_their_storage() {
    for (name, body, reason) in [
        ("return", "export function bad(): Ptr<c_int> { return local<c_int>(); }", "escapes"),
        ("field-return", "export function bad(): Ptr<c_int> { return addrOf(local<S>().x); }", "escapes"),
        ("join-return", "export function bad(n: number): Ptr<c_int> { const p = local<c_int>(); const q = n > 0 ? p : local<c_int>(); return q; }", "escapes"),
        ("global", "let held: Ptr<c_int> | null = null; export function heldValue(): Ptr<c_int>|null { return held; } export function bad(): void { held = local<c_int>(); }", "module-scope variable"),
        ("object", "export function bad(): {p: Ptr<c_int>} { return {p: local<c_int>()}; }", "escapes"),
        ("closure", "export function bad(): () => number { const p = local<c_int>(); return () => p[0]; }", "escapes"),
        ("store", "export function bad(out: Ptr<Ptr<c_int>>): void { out[0] = local<c_int>(); }", "escapes"),
        ("unknown-call", "declare function consume(p: Ptr<c_int>): void; export function bad(): void { consume(local<c_int>()); }", "escapes"),
        ("return-helper", "function alias(p: Ptr<c_int>): Ptr<c_int> { return p; } export function bad(): number { return alias(local<c_int>())[0]; }", "escapes"),
        ("store-helper", "let held: Ptr<c_int> | null = null; export function heldValue(): Ptr<c_int>|null { return held; } function keep(p: Ptr<c_int>): void { held = p; } export function bad(): void { keep(local<c_int>()); }", "module-scope variable"),
        ("free", "export function bad(): void { const p = local<c_int>(2); const q = addrOf(p[0]); free(q); }", "escapes"),
        ("async", "export async function bad(): Promise<number> { const p = local<c_int>(); return p[0]; }", "suspending"),
        ("generator", "export function* bad(): Generator<number> { const p = local<c_int>(); yield p[0]; }", "suspending"),
        ("loop", "export function bad(n: number): number { let r=0; for(let i=0;i<n;i++) r+=local<c_int>()[0]; return r; }", "inside a loop"),
        ("budget", "export function bad(): number { const a=local<c_int>(10000); const b=local<c_int>(10000); return a[0]+b[0]; }", "budget"),
        ("dynamic", "export function bad(n: number): number { return local<c_int>(n)[0]; }", "compile-time constant"),
        ("zero", "export function bad(): number { return local<c_int>(0)[0]; }", "positive fixed count"),
        ("fraction", "export function bad(): number { return local<c_int>(1.5)[0]; }", "positive fixed count"),
        ("size-managed", "export function bad(): number { return sizeof<{x:number}>(); }", "complete native storage"),
    ] {
        let source = format!(r#"
            import {{ local, sizeof, addrOf }} from "c:memory";
            import {{ free }} from "c:stdlib";
            import type {{ Ptr, Struct }} from "c:types";
            type S = Struct<{{x:c_int}}>;
            export function good(): number {{ const p = local<c_int>(); p[0]=23; return p[0]; }}
            {body}
        "#);
        let Some(snapshot) = snapshot(&format!("local-{name}"), &source) else { return; };
        let prepared = hir::prepare(&snapshot).unwrap();
        assert!(prepared.program.funcs.iter().any(|f| f.name == "good"), "{name}: {:?}", prepared.diagnostics);
        assert!(!prepared.program.funcs.iter().any(|f| f.name == "bad"), "{name} was accepted: {:?}", prepared.diagnostics);
        assert!(prepared.diagnostics.iter().any(|d| d.message.contains(reason)), "{name}: {:?}", prepared.diagnostics);
    }
}

#[test]
fn no_escape_annotations_are_checked_and_scoped_to_their_declaration() {
    for (name, tag, signature, expected) in [
        ("documented", "/** Reads synchronously.\n * @ntsNoEscape p\n */", "p: Ptr<c_int>", true),
        ("empty", "/** @ntsNoEscape */", "p: Ptr<c_int>", false),
        ("missing", "", "p: Ptr<c_int>", false),
        ("ordinary-comment", "/* @ntsNoEscape p */", "p: Ptr<c_int>", false),
        ("misspelled", "/** @ntsNoEscape absent */", "p: Ptr<c_int>", false),
        ("duplicate", "/** @ntsNoEscape p p */", "p: Ptr<c_int>", false),
    ] {
        let Some(snapshot) = snapshot(&format!("no-escape-{name}"), &format!(r#"
            import {{ local }} from "c:memory";
            import type {{ Ptr }} from "c:types";
            {tag}
            declare function consume({signature}): c_int;
            export function run(): number {{ return consume(local<c_int>()); }}
        "#)) else { return; };
        let prepared = hir::prepare(&snapshot).unwrap();
        assert_eq!(prepared.diagnostics.is_empty(), expected, "{name}: {:?}", prepared.diagnostics);
        assert_eq!(prepared.program.funcs.iter().any(|f| f.name == "run"), expected, "{name}");
    }
}

#[test]
fn prepared_storage_verifier_catches_corrupted_counts_and_borrow_contracts() {
    let Some(snapshot) = snapshot("local-verifier", r#"
        import { local } from "c:memory";
        import type { Ptr } from "c:types";
        /** @ntsNoEscape p */
        declare function consume(p: Ptr<c_int>): c_int;
        export function run(): number { return consume(local<c_int>()); }
    "#) else { return; };
    let prepared = hir::prepare(&snapshot).unwrap();
    assert!(prepared.diagnostics.is_empty());
    for kind in 0..4 {
        let mut program = prepared.program.clone();
        let mut changed = false;
        for func in &mut program.funcs {
            for op in &mut func.values {
                match &mut op.kind {
                    hir::OpKind::NativeLocal { count } if kind < 2 => {
                        *count = if kind == 0 { 0 } else { u32::MAX };
                        changed = true;
                    }
                    hir::OpKind::Call { callee: hir::Callee::Native(target), .. } if kind >= 2 => {
                        let target = std::sync::Arc::make_mut(target);
                        if kind == 2 { target.retention.fill(hir::native::Retention::Unknown); } else { target.retention.clear(); }
                        changed = true;
                    }
                    _ => {},
                }
            }
        }
        assert!(changed);
        assert!(hir::verify::verify(&program).is_err(), "mutation {kind}");
    }
}

/// What `addrOf` accepts, and the two different ways it refuses.
///
/// C takes an address with a prefix operator on an lvalue. TypeScript has no
/// lvalues and no such operator, so `addrOf(p.fd)` is a call -- and a call's
/// signature cannot, on its own, say that only some expressions are places.
///
/// Two mechanisms carry that between them, and the split is the point:
///
/// - A native slot's type carries an **optional** phantom naming what it is a
///   slot of. Optional, so a plain `number` still assigns to it and `p[i] += 1`
///   stays arithmetic; present, so `addrOf` can infer the declared C type an
///   address must know. Nothing else in the language has that phantom, so
///   `addrOf(42)`, `addrOf(f())` and a managed object's field are rejected by
///   **TypeScript**, before the compiler is consulted.
/// - What types cannot see is a conditional: `c ? p.x : q.x` is a slot, and is
///   not a place. That is refused at **lowering**, by looking at the syntax.
///
/// Each arm below is labelled with which mechanism must catch it. A mechanism
/// that stops working shows up as an arm caught by the other one, so the labels
/// are asserted rather than described.
#[test]
fn addrof_takes_a_native_place_and_nothing_else() {
    #[derive(PartialEq, Debug)]
    enum Caught {
        Nothing,
        Typescript,
        Lowering,
    }
    let header = "import type { Ptr, Struct } from \"c:types\";\n\
         import { addrOf, local } from \"c:memory\";\n\
         type S = Struct<{ x: c_int; y: c_int }, \"\">;\n\
         declare function f(): number;\n\
         /** @ntsNoEscape p */\n\
         declare function want(p: Ptr<c_int>): void;\n";
    for (name, body, expected) in [
        (
            "field",
            "export function go(): void { const p = local<S>(); want(addrOf(p.x)); }",
            Caught::Nothing,
        ),
        (
            "element",
            "export function go(): void { const b = local<c_int>(4); want(addrOf(b[1])); }",
            Caught::Nothing,
        ),
        (
            "element-then-field",
            "export function go(): void { const p = local<S>(3); want(addrOf(p[2].y)); }",
            Caught::Nothing,
        ),
        (
            "literal",
            "export function go(): number { return addrOf(42)[0]; }",
            Caught::Typescript,
        ),
        (
            "arithmetic",
            "export function go(): number { return addrOf(1 + 1)[0]; }",
            Caught::Typescript,
        ),
        (
            "call-result",
            "export function go(): number { return addrOf(f())[0]; }",
            Caught::Typescript,
        ),
        (
            "managed-object-field",
            "export function go(): number { const o = { count: 1 }; return addrOf(o.count)[0]; }",
            Caught::Typescript,
        ),
        (
            "conditional",
            "export function go(c: boolean): void { const p = local<S>(); const q = local<S>(); want(addrOf(c ? p.x : q.x)); }",
            Caught::Lowering,
        ),
    ] {
        let Some((snapshot, typescript)) = snapshot_allowing_errors(
            &format!("addrof-{name}"),
            &format!("{header}{body}"),
        ) else {
            return;
        };
        let caught = if typescript {
            Caught::Typescript
        } else {
            let prepared = hir::prepare(&snapshot).unwrap();
            if prepared.diagnostics.is_empty() {
                Caught::Nothing
            } else {
                Caught::Lowering
            }
        };
        assert_eq!(caught, expected, "{name}");
    }
}

/// `snapshot`, but a TypeScript error is an answer rather than a panic.
fn snapshot_allowing_errors(
    name: &str,
    source: &str,
) -> Option<(nts_semantic_schema::SemanticSnapshot, bool)> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .unwrap();
    let dir: Utf8PathBuf = root.join(format!(
        "target/native-scalar-tests/{}-{name}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","{root}/runtime/native/libc.d.ts"]}}"#
        ),
    )
    .unwrap();
    std::fs::write(
        dir.join("main.ts"),
        format!("import type {{ c_int }} from \"c:types\";\n{source}"),
    )
    .unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    let errors = snapshot.has_errors();
    Some((snapshot, errors))
}

/// What a `const` native view permits, and which mechanism refuses the rest.
///
/// `const` in C restricts the holder of a pointer; it does not claim the
/// storage is immutable or unaliased, and nothing here promises that. What it
/// must do is refuse a write through this view and refuse becoming a writable
/// view, in the one direction C converts and not the other.
///
/// Most of that is TypeScript's own assignability: the writable marker sits on
/// `Ptr`, so `ConstPtr` is the smaller type, a `Ptr<T>` satisfies it, and a
/// `ConstPtr<T>` does not satisfy a `Ptr<T>`. Writing through one is `TS2542`.
///
/// The arms are labelled with which mechanism must catch them, because a
/// mechanism that stops working otherwise hides behind the other.
#[test]
fn a_const_view_reads_and_does_not_write() {
    let header = "import type { ConstPtr, Ptr, c_uint8, c_size_t } from \"c:types\";\n\
         import { addrOf, local } from \"c:memory\";\n\
         /** @ntsNoEscape p */\n\
         declare function wantsConst(p: ConstPtr<unknown>, n: c_size_t): void;\n\
         /** @ntsNoEscape p */\n\
         declare function wantsMutable(p: Ptr<c_uint8>, n: c_size_t): void;\n";
    for (name, body, expected) in [
        (
            "mutable-satisfies-const",
            "export function go(): void { const b = local<c_uint8>(4); wantsConst(b, 4n as c_size_t); }",
            None,
        ),
        (
            "read-through-const",
            "export function go(p: ConstPtr<c_uint8>): number { return p[0]; }",
            None,
        ),
        (
            "const-does-not-satisfy-mutable",
            "export function go(p: ConstPtr<c_uint8>): void { wantsMutable(p, 4n as c_size_t); }",
            Some("typescript"),
        ),
        (
            "write-through-const",
            "export function go(p: ConstPtr<c_uint8>): void { p[0] = 1; }",
            Some("typescript"),
        ),
        // An address taken out of a const view would have to carry the
        // qualifier; `addrOf` hands back a writable pointer, so it is refused
        // rather than laundering it.
        (
            "address-of-a-const-member",
            "export function go(p: ConstPtr<c_uint8>): void { wantsMutable(addrOf(p[1]), 1n as c_size_t); }",
            Some("lowering"),
        ),
    ] {
        let Some((snapshot, typescript)) =
            snapshot_allowing_errors(&format!("const-{name}"), &format!("{header}{body}"))
        else {
            return;
        };
        let mut why = String::new();
        let caught = if typescript {
            why = format!("{:?}", snapshot.diagnostics);
            Some("typescript")
        } else {
            let prepared = hir::prepare(&snapshot).unwrap();
            if prepared.diagnostics.is_empty() {
                None
            } else {
                why = format!("{:?}", prepared.diagnostics);
                Some("lowering")
            }
        };
        assert_eq!(caught, expected, "{name}: {why}");
    }
}

/// A `declare`d C function contributes what its declaration says to escape
/// analysis, instead of being treated as reaching anything at all.
///
/// `escape.rs` answers for two foreign populations through one path. A runtime
/// helper or a bound Java member answers from `runtime::keeps`, keyed by name; a
/// native declaration answers from itself. `None` there means *unknown*, and
/// unknown means every argument escapes -- keeping that distinct from "nothing
/// escapes" is the whole content of the function, since collapsing them hands an
/// optimizer a permission nobody established.
///
/// The two arms differ in one line of `JSDoc` and nothing else, so a verdict that
/// is the same for both means the declaration is not being read.
///
/// This changes no placement today, and the test does not claim it does:
/// `@ntsNoEscape` is accepted only on native pointer parameters, and those never
/// reach `place_allocations`. It is the attachment point the effect work needs,
/// asserted at the level where it is actually decided.
#[test]
fn a_native_declaration_contributes_its_no_escape_contract() {
    let program = |tag: &str| {
        format!(
            "import type {{ Ptr }} from \"c:types\";\n\
             {tag}declare function f(p: Ptr<c_int>): void;\n\
             export function go(p: Ptr<c_int>): void {{ f(p); }}\n"
        )
    };
    let escaping = |name: &str, tag: &str| -> Option<bool> {
        let snapshot = snapshot(name, &program(tag))?;
        let prepared = hir::prepare(&snapshot).unwrap();
        assert!(prepared.diagnostics.is_empty(), "{name}: {:?}", prepared.diagnostics);
        let escapes = hir::escape::analyze_program(&prepared.program);
        let at = prepared
            .program
            .funcs
            .iter()
            .position(|f| f.name == "go")
            .expect("go was not lowered");
        // The argument is `go`'s own parameter, which is value 0.
        Some(escapes[at].escapes(hir::ValueId(0)))
    };
    let Some(without) = escaping("no-escape-absent", "") else { return };
    let with = escaping("no-escape-present", "/** @ntsNoEscape p */\n").unwrap();
    assert!(
        without,
        "an unclassified foreign callee must be assumed to keep its arguments"
    );
    assert!(
        !with,
        "an authored @ntsNoEscape must reach escape analysis; if this fails the \
         declaration is being ignored and the contract exists only in lowering"
    );
}

/// The brands a `number` cannot carry, in both signature positions.
///
/// `bigint` all the way through: arithmetic on one is bigint arithmetic, and
/// the brand selects the C boundary type rather than wrapping each
/// intermediate. There is no `+ 0.25` arm because there is no such expression
/// -- mixing the two is a type error, which is the property that makes the
/// exactness hold rather than a restriction imposed beside it.
#[test]
fn a_wide_brand_has_bigint_semantics_in_both_signature_positions() {
    for name in ["c_int64", "c_uint64", "c_long", "c_ulong", "c_size_t", "c_ptrdiff_t"] {
        let Some(snapshot) = snapshot(
            &format!("wide-{name}"),
            &format!(
                "export function argument(n: {name}): bigint {{ return n + 1n; }}\n\
             export function result(n: bigint): {name} {{ return (n + 1n) as {name}; }}"
            ),
        ) else {
            return;
        };
        let lowered = hir::lower::lower(&snapshot);
        assert!(lowered.diagnostics.is_empty(), "{name}: {:?}", lowered.diagnostics);
        for which in ["argument", "result"] {
            let func = lowered.program.funcs.iter().find(|f| f.name == which).unwrap();
            let seen: Vec<_> = func
                .params
                .iter()
                .map(|p| p.ty.clone())
                .chain(std::iter::once(func.return_type.clone()))
                .collect();
            assert!(
                seen.iter().all(|ty| *ty == hir::HirType::BigInt),
                "{name}/{which}: a wide brand reached a non-bigint representation: {seen:?}"
            );
            // The one that matters: nothing routed through a double. A `f64`
            // anywhere here is the loss this family exists to prevent, and it
            // would still emit a correct `int64_t` prototype.
            assert!(
                !func.values.iter().any(|v| v.ty == hir::HirType::Float { bits: 64 }),
                "{name}/{which}: a value passed through a double"
            );
        }
    }
}

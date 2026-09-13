//! Compile independent C callers against the generated interface, including controls
//! that must fail at compile time instead of reaching the linker with a wrong ABI.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::process::Command;

fn toolchain() -> Option<Utf8PathBuf> {
    let tsgo = nts_frontend_ts::tsgo::locate();
    if tsgo.is_none() || Command::new("clang").arg("--version").output().is_err() {
        eprintln!("SKIP generated header: tsgo and clang are required");
        return None;
    }
    tsgo
}

fn emit(tsgo: &Utf8Path, name: &str, source: &str) -> (Utf8PathBuf, nts_codegen_c::Emitted) {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = root.join(format!("target/header-tests/{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/examples/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo.to_owned())
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    let prepared = hir::prepare_with(&snapshot, &hir::Options::default()).unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    (dir, emitted)
}

fn run(dir: &Utf8Path, caller: &str, runtime: bool) {
    std::fs::write(dir.join("caller.c"), caller).unwrap();
    let mut cc = Command::new("clang");
    cc.current_dir(dir).args([
        "-std=c11",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-O2",
        "-I.",
        "caller.c",
        "program.c",
    ]);
    if runtime {
        cc.args(["nts_runtime.c", "-lm"]);
    }
    let compiled = cc.args(["-o", "caller"]).output().unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let result = Command::new(dir.join("caller")).output().unwrap();
    assert!(
        result.status.success(),
        "caller: {:?}\n{}",
        result.status,
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn scalar_header_links_without_runtime_and_rejects_wrong_prototypes() {
    let Some(tsgo) = toolchain() else {
        return;
    };
    let (dir, _) = emit(
        &tsgo,
        "scalars",
        "export function add(a: number, b: number): number { return a + b; }\nexport function bool(v: boolean): boolean { return !v; }\nexport function answer(): number { return 42; }",
    );
    run(
        &dir,
        "#include \"program.h\"\n#include \"program.h\"\nint main(void) { return add(2, 3) != 5 || !bool_(false) || answer() != 42; }",
        false,
    );
    std::fs::write(
        dir.join("wrong.c"),
        "#include \"program.h\"\nint add(int, int);\n",
    )
    .unwrap();
    let control = Command::new("clang")
        .current_dir(&dir)
        .args(["-std=c11", "-Werror", "-fsyntax-only", "wrong.c"])
        .output()
        .unwrap();
    assert!(!control.status.success(), "wrong ABI must be rejected");
    assert!(String::from_utf8_lossy(&control.stderr).contains("conflicting types"));
}

#[test]
fn anonymous_alias_survives_type_renumbering_and_named_layout_merging() {
    let Some(tsgo) = toolchain() else {
        return;
    };
    let body = "export function sumOf(o: { a: number; b: number }): number { return o.a + o.b; }";
    let prefixes = [
        "",
        "interface Pair { a: number; b: number }\n",
        "interface Pair { a: number; b: number }\nexport function sumOfNamed(o: Pair): number { return o.a + o.b; }\n",
    ];
    let mut aliases = Vec::new();
    for (at, prefix) in prefixes.iter().enumerate() {
        let (dir, emitted) = emit(
            &tsgo,
            &format!("anonymous-{at}"),
            &format!("{prefix}{body}"),
        );
        aliases.push(
            emitted
                .header
                .lines()
                .find(|line| line.ends_with(" sumOf_o_t;"))
                .unwrap()
                .to_owned(),
        );
        // This accessor never retains, allocates, or reads the managed header.
        // A stack value is sufficient to test its field ABI without an allocator.
        run(
            &dir,
            "#include \"program.h\"\nint main(void) { sumOf_o_t o = {0}; o.a = 2.25; o.b = 3.5; return sumOf(&o) != 5.75; }",
            false,
        );
    }
    assert_ne!(
        aliases[0], aliases[1],
        "control must actually renumber the anonymous type"
    );
    assert_ne!(
        aliases[1], aliases[2],
        "used named type must change the internal layout name"
    );
    assert!(aliases[2].contains("NtsObj_Pair"));
}

#[test]
fn managed_returns_and_promises_are_callable_from_the_header() {
    let Some(tsgo) = toolchain() else {
        return;
    };
    let (dir, _) = emit(
        &tsgo,
        "managed",
        "export class Point { constructor(public x: number, public y: number) {} }\nexport function makePoint(n: number): Point { return new Point(n, n * 2); }\nexport async function later(n: number): Promise<number> { const v = await Promise.resolve(n); return v + 1; }",
    );
    run(
        &dir,
        "#include \"program.h\"\nint main(void) { makePoint_return_t *p = makePoint(7); if (p->x != 7 || p->y != 14) return 1; NtsPromise *q = later(41); if (nts_promise_state(q) != 0) return 2; nts_checkpoint(); return nts_promise_state(q) != 1 || nts_value_number(nts_promise_value(q)) != 42; }",
        true,
    );
}

#[test]
fn a_local_function_published_under_an_alias_has_external_linkage() {
    let Some(tsgo) = toolchain() else {
        return;
    };
    let (dir, emitted) = emit(
        &tsgo,
        "local-alias",
        "function local(o: { x: number }): number { return o.x; }\nexport { local as read };\nfunction privateHelper(): number { return 0; }",
    );
    assert!(!emitted.header.contains("privateHelper("));
    run(
        &dir,
        "#include \"program.h\"\nint main(void) { read_o_t o = {0}; o.x = 7; return local(&o) != 7; }",
        false,
    );
}

#[test]
fn nested_objects_returned_to_c_remain_mutable_between_calls() {
    let Some(tsgo) = toolchain() else {
        return;
    };
    let (dir, _) = emit(
        &tsgo,
        "nested",
        "interface Inner { value: number }\ninterface Outer { inner: Inner }\nexport function make(): Outer { return { inner: { value: 1 } }; }\nexport function read(o: Outer): number { return o.inner.value; }",
    );
    run(
        &dir,
        "#include \"program.h\"\nint main(void) { make_return_t *o = make(); if (read_(o) != 1) return 1; o->inner->value = 7.25; return read_(o) != 7.25; }",
        true,
    );
}

#[test]
fn module_initialization_is_declared_and_callable() {
    let Some(tsgo) = toolchain() else {
        return;
    };
    let (dir, emitted) = emit(
        &tsgo,
        "initializer",
        "let text = String(12);\nexport function length(): number { return text.length; }",
    );
    let init = nts_codegen_c::c_identifier(hir::lower::MODULE_INIT);
    assert!(emitted.header.contains(&format!("void {init}(void);")));
    run(
        &dir,
        &format!("#include \"program.h\"\nint main(void) {{ {init}(); return length() != 2; }}"),
        true,
    );
}

#[test]
fn object_aliases_do_not_collide_with_exported_functions() {
    let Some(tsgo) = toolchain() else {
        return;
    };
    let (dir, _) = emit(
        &tsgo,
        "alias-collision",
        "export function sumOf(o: { a: number }): number { return o.a; }\nexport function sumOf_o_t(): number { return 42; }",
    );
    run(
        &dir,
        "#include \"program.h\"\nint main(void) { sumOf_o_t_2 o = {0}; o.a = 3.5; return sumOf(&o) != 3.5 || sumOf_o_t() != 42; }",
        false,
    );
}

#[test]
fn exposed_and_internal_fields_keep_distinct_facts_in_one_program() {
    let Some(tsgo) = toolchain() else {
        return;
    };
    let (dir, _) = emit(
        &tsgo,
        "mixed-field-boundaries",
        r"
export function sumOf(o: { a: number; b: number }): number { return o.a + o.b; }
class Counter {
    count = 0;
    advance(): void { this.count = (this.count + 1) | 0; }
}
export function internalOnly(n: number): number {
    const counter = new Counter();
    for (let i = 0; i < (n & 15); i++) counter.advance();
    return counter.count;
}
",
    );
    // Both layouts must satisfy their different storage contracts in this one
    // translation unit. The private class name is used only to inspect that
    // optimization; callers use the stable public alias for the exported shape.
    run(
        &dir,
        r#"#include "program.h"
_Static_assert(_Generic(((sumOf_o_t *)0)->a, double: 1, default: 0), "external field must stay double");
_Static_assert(_Generic(((NtsObj_Counter *)0)->count, int32_t: 1, default: 0), "internal field must still narrow");
int main(void) {
    sumOf_o_t o = {0};
    o.a = 2.25; o.b = 3.5;
    return sumOf(&o) != 5.75 || internalOnly(11) != 11;
}
"#,
        true,
    );
}

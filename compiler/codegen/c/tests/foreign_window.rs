//! A global DOM call uses the chosen binding overload's written parameters.
//! Preparation and C emission observe the boundary; no browser code executes.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::Frontend;
use scratch::ScratchDir;

fn assert_style_call(program: &hir::Program, caller: &str, symbol: &str, arity: usize) {
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == caller)
        .unwrap_or_else(|| panic!("missing {caller}; refused: {:?}", program.uncompiled));
    assert!(func.exported, "the source export {caller} was not retained");
    assert!(
        !program
            .uncompiled
            .iter()
            .map(|entry| (&entry.name, &entry.reason))
            .any(|(name, _)| name == caller),
        "the source export {caller} was refused: {:?}",
        program.uncompiled
    );
    let calls: Vec<_> = func
        .blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter_map(|id| {
            let OpKind::Call {
                callee: Callee::Native(target),
                args,
                ..
            } = &func.values[id.0 as usize].kind
            else {
                return None;
            };
            target
                .name
                .starts_with("nts_dom_Window_getComputedStyle_")
                .then_some((target, args))
        })
        .collect();
    assert_eq!(calls.len(), 1, "{caller}: {calls:?}");
    let (target, args) = calls[0];
    println!("{caller}: {symbol}, actual {target:?}, arguments {args:?}");
    assert_eq!(target.name, symbol);
    assert_eq!(target.parameters.len(), arity, "{target:?}");
    assert_eq!(args.len(), arity, "{caller}: {args:?}");
    assert!(
        args.iter()
            .all(|id| !matches!(func.values[id.0 as usize].kind, OpKind::ConstUndefined)),
        "no source-global optional tail belongs to this chosen C binding: {caller} {args:?}"
    );
}

#[test]
fn global_window_overloads_use_the_selected_binding_argument_contract() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(
        &root.join("target/native-c-tests"),
        "window-argument-contract",
    );
    // Keep the complete original guard, including its nested createElement
    // call and other globals. Add the two-argument neighbour and the fixture's
    // explicit-module control; no original fixture bytes are changed.
    let original = include_str!("../../../../tests/refusals/lib-dom-globals-of-window/src/main.ts");
    let neighbours = r#"
import { document as boundDocument, window as boundWindow } from "nts:dom";
export function two(): number {
  return getComputedStyle(document.createElement("div"), null).color.length;
}
export function moduleControl(): number {
  const style = boundWindow().getComputedStyle(boundDocument().createElement("div"));
  const narrow = boundWindow().matchMedia("(max-width: 600px)").matches ? 1 : 0;
  boundWindow().history.scrollRestoration = "manual";
  return boundWindow().innerWidth + boundWindow().innerHeight + boundWindow().location.href.length + style.color.length + narrow;
}
"#;
    std::fs::write(dir.join("main.ts"), format!("{original}\n{neighbours}")).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","{root}/runtime/chromium/dom/types/dom-idl.d.ts","{root}/runtime/chromium/dom/types/dom-abi.d.ts","{root}/runtime/chromium/dom/types/lib-dom-bindings.d.ts","{root}/runtime/native/libc.d.ts"]}}"#
        ),
    )
    .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Provider::ReferenceCounting,
            ..hir::Options::default()
        },
    )
    .unwrap_or_else(|why| panic!("{}", why.render(&snapshot.sources)));
    // Ambient binding interfaces have no TypeScript implementation bodies.
    // Keep their refusals observable; require each source export below rather
    // than treating unused declaration-only methods as this guard's callers.
    std::fs::write(dir.join("prepared.txt"), format!("{:#?}", prepared.program)).unwrap();
    println!(
        "ambient/source refusals retained: {}",
        prepared.program.uncompiled.len()
    );
    for (name, symbol, arity) in [
        ("go", "nts_dom_Window_getComputedStyle_1", 2),
        ("two", "nts_dom_Window_getComputedStyle_2", 3),
        ("moduleControl", "nts_dom_Window_getComputedStyle_1", 2),
    ] {
        assert_style_call(&prepared.program, name, symbol, arity);
    }
    let emitted = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
    assert!(
        emitted
            .writer
            .text()
            .contains("nts_dom_Window_getComputedStyle_1(")
    );
    assert!(
        emitted
            .writer
            .text()
            .contains("nts_dom_Window_getComputedStyle_2(")
    );
}

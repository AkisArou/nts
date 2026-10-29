//! The private carrier convention is a proof over actual uses and call edges.
#![allow(clippy::expect_used, clippy::unwrap_used)]

#[path = "../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8PathBuf;
use nts_core::hir::{self, string_accumulators::chains::Plan};
use nts_frontend_ts::Frontend;

fn lower(source: &str) -> hir::Program {
    let parent = Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap();
    let root = scratch::ScratchDir::new(&parent, "string-carrier-proof");
    std::fs::write(root.join("tsconfig.json"), r#"{"compilerOptions":{"strict":true,"target":"es2022","noEmit":true,"types":[]},"files":["main.ts"]}"#).unwrap();
    std::fs::write(root.join("main.ts"), source).unwrap();
    let snapshot = Frontend::new(root.to_owned())
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&root.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.rejected.is_empty(), "{:?}", lowered.rejected);
    assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
    assert_eq!(lowered.program.refused_bodies().count(), 0);
    lowered.program
}

fn parameter(plan: &Plan<'_>, program: &hir::Program, name: &str) -> Option<u32> {
    program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .and_then(|func| plan.parameter_of(func))
}

#[test]
fn closed_private_writers_share_one_proved_carrier() {
    let program = lower(
        r#"
function leaf(out: string, n: number): string { return out + String(n); }
function outer(out: string, n: number): string { return leaf(out, n) + "!"; }
export function work(n: number): string {
  let out = "";
  for (let at = 0; at < n; at++) out = outer(out, at);
  return out;
}
export function measured(n: number): number { return outer("", n).length; }
"#,
    );
    let plan = Plan::new(&program);
    assert_eq!(parameter(&plan, &program, "leaf"), Some(0), "{plan:?}");
    assert_eq!(parameter(&plan, &program, "outer"), Some(0), "{plan:?}");
    let copied = program.clone();
    let copied_leaf = copied
        .funcs
        .iter()
        .find(|func| func.name == "leaf")
        .unwrap();
    assert_eq!(
        plan.parameter_of(copied_leaf),
        None,
        "an identical name in another IR arena is not this proof's subject"
    );
    let (charged, available) = plan.graph_work();
    assert!(charged > 0 && charged <= available, "{plan:?}");
    assert_eq!(
        parameter(&plan, &program, "work"),
        None,
        "the public ABI stays String"
    );
    for name in ["leaf", "outer", "work", "measured"] {
        let func = program.funcs.iter().find(|func| func.name == name).unwrap();
        assert!(
            plan.values_in(func)
                .is_some_and(|values| !values.is_empty()),
            "{name}: {plan:?}"
        );
    }
}

#[test]
fn an_old_version_and_a_duplicate_sink_reject_the_whole_family() {
    let program = lower(
        r#"
function old(out: string): string { return out + "!"; }
function duplicate(out: string, piece: string): string { return out + piece; }
function prepend(out: string): string { return "!" + out; }
function reset(out: string, replace: boolean): string { return replace ? "new" : out + "!"; }
export function observed(n: number): number {
  let out = "";
  for (let at = 0; at < n; at++) out += "a";
  const result = old(out);
  return out.length + result.length;
}
export function repeated(n: number): string {
  let out = "";
  for (let at = 0; at < n; at++) out = duplicate(out, out);
  return out;
}
export function prepended(n: number): string { return prepend(String(n)); }
export function replaced(n: number): string { return reset("", n > 0); }
"#,
    );
    let plan = Plan::new(&program);
    for name in ["old", "duplicate", "prepend", "reset"] {
        assert_eq!(parameter(&plan, &program, name), None, "{name}: {plan:?}");
        assert!(
            plan.rejected().any(|(found, _)| found == name),
            "missing census: {name}"
        );
    }
}

#[test]
fn a_recursive_family_is_unknown_rather_than_optimistically_linear() {
    let program = lower(
        r#"
function recursive(out: string, n: number): string {
  if (n > 0) return recursive(out + "a", n - 1);
  return out + "!";
}
export function work(n: number): string { return recursive("", n); }
"#,
    );
    let plan = Plan::new(&program);
    assert_eq!(parameter(&plan, &program, "recursive"), None, "{plan:?}");
}

#[test]
fn publishing_a_version_and_an_indirect_entry_keep_the_string_abi() {
    let program = lower(
        r#"
let published = "";
function publish(out: string): string { published = out; return out + "!"; }
function indirect(out: string): string { return out + "!"; }
const callback = indirect;
export function work(n: number): number {
  const text = publish(String(n));
  return callback(text).length + published.length;
}
"#,
    );
    let plan = Plan::new(&program);
    assert_eq!(parameter(&plan, &program, "publish"), None, "{plan:?}");
    assert_eq!(parameter(&plan, &program, "indirect"), None, "{plan:?}");
}

#[test]
fn an_old_value_read_by_a_handler_is_not_a_unique_carrier() {
    let program = lower(
        r#"
function update(out: string, fail: boolean): string {
  const grown = out + "!";
  if (fail) throw new Error(grown);
  return grown;
}
export function work(n: number): number {
  let out = "";
  for (let at = 0; at < n; at++) out += "a";
  try { return update(out, n > 1).length; }
  catch { return out.length; }
}
"#,
    );
    let plan = Plan::new(&program);
    assert_eq!(
        parameter(&plan, &program, "update"),
        None,
        "the old value survives a throw: {plan:?}"
    );
}

#[test]
fn real_layout_slots_are_outside_the_closed_static_ingress_set() {
    let program = lower(
        r#"
interface Writer { append(out: string): string; }
class First implements Writer { append(out: string): string { return out + "a"; } }
class Second implements Writer { append(out: string): string { return out + "b"; } }
export function work(n: number): string {
  const writer: Writer = n > 0 ? new First() : new Second();
  return writer.append("");
}
"#,
    );
    let targets: Vec<_> = program.dispatch_targets().collect();
    assert!(
        !targets.is_empty(),
        "the control must reach real dispatch slots"
    );
    let plan = Plan::new(&program);
    for target in targets {
        assert_eq!(
            parameter(&plan, &program, target),
            None,
            "{target}: {plan:?}"
        );
    }
}

#[test]
fn a_foreign_published_entry_cannot_change_its_parameter_convention() {
    let mut program = lower(
        r#"
function append(out: string): string { return out + "!"; }
export function work(n: number): string {
  let out = "";
  for (let at = 0; at < n; at++) out += "a";
  return append(out);
}

"#,
    );
    // This is an ownership-entry metadata control: adding a foreign callback
    // must remove admission even though the source body and direct call agree.
    // Native emitter/linker behavior is not under test here.
    let before = Plan::new(&program);
    assert_eq!(
        parameter(&before, &program, "append"),
        Some(0),
        "{before:?}"
    );
    drop(before);
    program.foreign_classes.push(hir::ForeignClass {
        family: hir::native::Family::Objc,
        name: "Published".into(),
        type_name: None,
        superclass: "NSObject".into(),
        methods: vec![hir::ForeignMethod {
            dispatch: hir::Dispatch::Selector("append:".into()),
            function: "append".into(),
            signature: std::sync::Arc::new(hir::native::FnPointer {
                name: "StringCallback".into(),
                parameters: vec![hir::native::Type::Managed(hir::ManagedType::String)],
                result: Box::new(hir::native::Type::Managed(hir::ManagedType::String)),
            }),
            declared_at: None,
        }],
        protocols: Vec::new(),
        state: None,
        composition: None,
        signals: Vec::new(),
        properties: Vec::new(),
        template: None,
    });
    let after = Plan::new(&program);
    assert_eq!(parameter(&after, &program, "append"), None, "{after:?}");
}

#[test]
fn a_caller_publishing_its_previous_version_does_not_publish_the_carrier() {
    let program = lower(
        r#"
let saved = "";
function append(out: string): string { return out + "!"; }
export function work(n: number): number {
  let out = "";
  for (let at = 0; at < n; at++) out += "a";
  saved = out;
  return append(out).length + saved.length;
}
"#,
    );
    let plan = Plan::new(&program);
    assert_eq!(parameter(&plan, &program, "append"), None, "{plan:?}");
}

#[test]
fn a_transitive_source_throw_keeps_every_writer_in_the_string_convention() {
    let program = lower(
        r#"
function trap(n: number): void { if (n > 0) throw new Error("stop"); }
function writer(out: string, n: number): string { const grown = out + "!"; trap(n); return grown; }
function outer(out: string, n: number): string { return writer(out, n); }
export function work(n: number): number {
  const out = "before";
  try { return outer(out, n).length; } catch { return out.length; }
}
"#,
    );
    let plan = Plan::new(&program);
    for name in ["writer", "outer"] {
        assert_eq!(parameter(&plan, &program, name), None, "{name}: {plan:?}");
        assert!(
            plan.rejected().any(|(found, why)| found == name
                && why == hir::string_accumulators::chains::Rejection::UnsupportedContinuation),
            "{plan:?}"
        );
    }
}

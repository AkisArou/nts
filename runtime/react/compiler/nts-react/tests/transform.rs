//! The stage as nts runs it: through the frontend's source-transform driver,
//! and its revision -- a compiled function an error falls inside is given
//! back as the user wrote it. Skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::tsgo::transform::{NodeTypes, SourceTransform, TransformInput};
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_react::project::Session;
use nts_react::stage::{self, FunctionState};
use nts_react::transform::ReactTransform;
use nts_semantic_schema::{NodeId, NodeKind};

fn tsgo() -> Option<Utf8PathBuf> {
    let path = Utf8PathBuf::from(std::env::var("NTS_TSGO").ok()?);
    path.exists().then_some(path)
}

fn fixtures() -> Utf8PathBuf {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/jsx-lowering/tsconfig.json").canonicalize_utf8().expect("checked in")
}

/// tsgo's `JsxElement`, `JsxSelfClosingElement` and `JsxFragment` kinds.
fn is_jsx(kind: u16) -> bool {
    use nts_react::tsgo::kinds as k;
    matches!(kind, k::JSX_ELEMENT | k::JSX_SELF_CLOSING_ELEMENT | k::JSX_FRAGMENT)
}

#[test]
fn nts_reads_the_project_compiled_and_without_jsx() {
    let Some(tsgo) = tsgo() else { return };
    let plain = TsgoApi::new(&tsgo).snapshot(&fixtures()).unwrap();
    assert!(plain.nodes.iter().any(|n| matches!(n.kind, NodeKind::Syntax(kind) if is_jsx(kind))), "the control: the fixtures are JSX");

    let (transform, report) = ReactTransform::new(stage::default_options());
    let snapshot = TsgoApi::new(&tsgo).with_transform(Box::new(transform)).snapshot(&fixtures()).unwrap();
    assert!(!snapshot.nodes.iter().any(|n| matches!(n.kind, NodeKind::Syntax(kind) if is_jsx(kind))), "every file nts read had its JSX lowered");

    // The compiler's bailout on `Conditional` is a warning in the snapshot,
    // on the file, naming the function by its line.
    let bailout = snapshot.diagnostics.iter().find(|d| d.code == "NTS0005").expect("the bailout is reported");
    assert_eq!(snapshot.sources[bailout.primary.file.0 as usize].display_path.file_name(), Some("bailout.tsx"));
    assert!(bailout.message.contains("left the function at ") && bailout.message.contains("/fixtures/jsx-lowering/bailout.tsx:5 as written") && bailout.message.contains("Hooks"), "{}", bailout.message);
    assert_eq!(snapshot.diagnostics.iter().filter(|d| d.code == "NTS0005").count(), 1, "and nothing else bailed out");

    let report = report.lock().unwrap();
    let keys = report.iter().find(|(path, _)| path.file_name() == Some("keys.tsx")).map(|(_, r)| r).expect("keys.tsx was offered");
    let component = keys.functions.iter().find(|f| f.name.as_deref() == Some("Keys")).expect("Keys is reported");
    assert_eq!(component.state, FunctionState::Compiled);
    assert!(keys.fell_back.is_empty() && keys.refused.is_none(), "{keys:?}");
}

/// No checker: a revision re-prints from what the first print learned.
struct NoTypes;

impl NodeTypes for NoTypes {
    fn type_at(&mut self, _: NodeId) -> Option<String> {
        None
    }
}

#[test]
fn an_error_inside_a_compiled_function_gives_it_back_as_written() {
    if tsgo().is_none() {
        return;
    }
    let mut session = Session::open(&fixtures()).unwrap();
    let path = session.own_sources().unwrap().into_iter().find(|p| p.file_name() == Some("keys.tsx")).unwrap();
    let tree = session.file(&path).unwrap();
    let code = std::fs::read_to_string(&path).unwrap();

    let (mut transform, report) = ReactTransform::new(stage::default_options());
    assert!(transform.diagnostics(&path).is_empty(), "nothing to say before the file is offered");
    let compiled = transform.transform(&TransformInput { path: &path, text: &code, tree: &tree }, &mut NoTypes).expect("keys.tsx is rewritten");
    let keys = report.lock().unwrap()[&path].functions.iter().find(|f| f.name.as_deref() == Some("Keys")).cloned().unwrap();
    let (start, end) = keys.output.expect("compiled");
    assert!(compiled.encode_utf16().count() >= end as usize);

    // An error outside every compiled function is the build's, not a reason
    // to give anything back.
    assert_eq!(transform.revise(&path, &[(0, 1)]), None);

    let revised = transform.revise(&path, &[(start + 1, start + 2)]).expect("Keys is given back");
    let written: Vec<u16> = code.encode_utf16().collect();
    let keys_as_written = String::from_utf16_lossy(&written[keys.span.0 as usize..keys.span.1 as usize]);
    // As written, with its JSX still lowered: the text between `function
    // Keys(` and its first JSX is the user's.
    let head = keys_as_written.split('<').next().unwrap();
    assert!(revised.contains(head) && !revised.contains("$[0]"), "Keys as the user wrote it");
    assert_eq!(report.lock().unwrap()[&path].fell_back, vec![keys.span]);
    let said: Vec<_> = transform.diagnostics(&path).into_iter().map(|d| (d.code, d.message)).collect();
    assert_eq!(said.len(), 1, "{said:?}");
    assert_eq!(said[0].0, "NTS0004");
    assert!(said[0].1.starts_with(&format!("`Keys` ({path}:6) is built as written")), "{}", said[0].1);
    // Nothing more to give back.
    assert_eq!(transform.revise(&path, &[(start + 1, start + 2)]), None);
}

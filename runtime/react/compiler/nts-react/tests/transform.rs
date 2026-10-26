//! The stage as nts runs it: through the frontend's source-transform driver,
//! and its revision -- a compiled function an error falls inside is given
//! back as the user wrote it.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::Frontend;
use nts_frontend_ts::transform::{NodeTypes, SourceTransform, TransformInput};
use nts_react::stage::{self, FunctionState};
use nts_react::transform::ReactTransform;
use nts_semantic_schema::NodeKind;

fn frontend() -> Frontend {
    Frontend::new(env!("CARGO_MANIFEST_DIR")).with_checkers(std::num::NonZeroU16::MIN)
}

fn inspect_file<R: Send>(
    project: &Utf8Path,
    name: &str,
    visitor: impl FnOnce(&TransformInput<'_>, &NodeTypes<'_>) -> R + Send,
) -> R {
    let directory = project.parent().unwrap();
    let mut visitor = Some(visitor);
    frontend()
        .inspect(
            project,
            |file, types| -> Result<_, nts_semantic_schema::SnapshotError> {
                Ok(
                    if file.path.starts_with(directory) && file.path.file_name() == Some(name) {
                        Some(visitor.take().expect("one selected source")(file, types))
                    } else {
                        None
                    },
                )
            },
        )
        .unwrap()
        .into_iter()
        .flatten()
        .next()
        .expect("the checked-in source is loaded")
}

fn fixtures() -> Utf8PathBuf {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures/jsx-lowering/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked in")
}

/// tsgo's `JsxElement`, `JsxSelfClosingElement` and `JsxFragment` kinds.
fn is_jsx(kind: u16) -> bool {
    use nts_react::syntax::kinds as k;
    matches!(
        kind,
        k::JSX_ELEMENT | k::JSX_SELF_CLOSING_ELEMENT | k::JSX_FRAGMENT
    )
}

#[test]
fn nts_reads_the_project_compiled_and_without_jsx() {
    let plain = frontend().snapshot(&fixtures()).unwrap();
    assert!(
        plain
            .nodes
            .iter()
            .any(|n| matches!(n.kind, NodeKind::Syntax(kind) if is_jsx(kind))),
        "the control: the fixtures are JSX"
    );

    let (transform, report) = ReactTransform::new(stage::default_options());
    let snapshot = frontend()
        .with_transform(Box::new(transform))
        .snapshot(&fixtures())
        .unwrap();
    assert!(
        !snapshot
            .nodes
            .iter()
            .any(|n| matches!(n.kind, NodeKind::Syntax(kind) if is_jsx(kind))),
        "every file nts read had its JSX lowered"
    );

    // The compiler's bailout on `Conditional` is a warning in the snapshot,
    // on the file, naming the function by its line.
    let bailout = snapshot
        .diagnostics
        .iter()
        .find(|d| d.code == "NTS0005")
        .expect("the bailout is reported");
    assert_eq!(
        snapshot.sources[bailout.primary.file.0 as usize]
            .display_path
            .file_name(),
        Some("bailout.tsx")
    );
    assert!(
        bailout.message.contains("left the function at ")
            && bailout
                .message
                .contains("/fixtures/jsx-lowering/bailout.tsx:5 as written")
            && bailout.message.contains("Hooks"),
        "{}",
        bailout.message
    );
    assert_eq!(
        snapshot
            .diagnostics
            .iter()
            .filter(|d| d.code == "NTS0005")
            .count(),
        1,
        "and nothing else bailed out"
    );

    let report = report.lock().unwrap();
    let keys = report
        .iter()
        .find(|(path, _)| path.file_name() == Some("keys.tsx"))
        .map(|(_, r)| r)
        .expect("keys.tsx was offered");
    let component = keys
        .functions
        .iter()
        .find(|f| f.name.as_deref() == Some("Keys"))
        .expect("Keys is reported");
    assert_eq!(component.state, FunctionState::Compiled);
    assert!(
        keys.fell_back.is_empty() && keys.refused.is_none(),
        "{keys:?}"
    );
}

#[test]
fn an_error_inside_a_compiled_function_gives_it_back_as_written() {
    let (mut transform, report) = ReactTransform::new(stage::default_options());
    let (path, code, compiled) = inspect_file(&fixtures(), "keys.tsx", |file, types| {
        assert!(
            transform.diagnostics(file.path).is_empty(),
            "nothing to say before the file is offered"
        );
        let compiled = transform
            .transform(file, types)
            .expect("keys.tsx is rewritten");
        (file.path.to_owned(), file.text.to_owned(), compiled)
    });
    let keys = report.lock().unwrap()[&path]
        .functions
        .iter()
        .find(|f| f.name.as_deref() == Some("Keys"))
        .cloned()
        .unwrap();
    let (start, end) = keys.output.expect("compiled");
    assert!(compiled.encode_utf16().count() >= end as usize);

    // An error outside every compiled function is the build's, not a reason
    // to give anything back.
    assert_eq!(transform.revise(&path, &[(0, 1)]), None);

    let revised = transform
        .revise(&path, &[(start + 1, start + 2)])
        .expect("Keys is given back");
    let written: Vec<u16> = code.encode_utf16().collect();
    let keys_as_written =
        String::from_utf16_lossy(&written[keys.span.0 as usize..keys.span.1 as usize]);
    // As written, with its JSX still lowered: the text between `function
    // Keys(` and its first JSX is the user's.
    let head = keys_as_written.split('<').next().unwrap();
    assert!(
        revised.contains(head) && !revised.contains("$[0]"),
        "Keys as the user wrote it"
    );
    assert_eq!(report.lock().unwrap()[&path].fell_back, vec![keys.span]);
    let said: Vec<_> = transform
        .diagnostics(&path)
        .into_iter()
        .map(|d| (d.code, d.message))
        .collect();
    assert_eq!(said.len(), 1, "{said:?}");
    assert_eq!(said[0].0, "NTS0004");
    assert!(
        said[0]
            .1
            .starts_with(&format!("`Keys` ({path}:6) is built as written")),
        "{}",
        said[0].1
    );
    // Nothing more to give back.
    assert_eq!(transform.revise(&path, &[(start + 1, start + 2)]), None);
}

#[test]
fn a_typed_cache_that_does_not_typecheck_steps_down_to_the_array_before_giving_the_function_back() {
    // The TSX probe: it resolves our React, so its JSX is typed and so are
    // its caches. (The JSX fixtures do not resolve `react`: their caches hold
    // `any`, and stay the compiler's array.)
    let probe = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../native/compiled/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked in");
    let (mut transform, report) = ReactTransform::new(stage::default_options());
    let (path, typed) = inspect_file(&probe, "main.tsx", |file, types| {
        (
            file.path.to_owned(),
            transform.transform(file, types).expect("rewritten"),
        )
    });
    let item = |report: &nts_react::transform::Report| {
        report.lock().unwrap()[&path]
            .functions
            .iter()
            .find(|f| f.name.as_deref() == Some("Item"))
            .cloned()
            .unwrap()
    };
    let first = item(&report);
    assert!(
        first.typed_cache && typed.contains("_cacheOf("),
        "with the checker, Item's cache is typed"
    );

    // An error inside it: the array cache, still memoized, and not given back.
    let (start, _) = first.output.unwrap();
    let array = transform
        .revise(&path, &[(start + 1, start + 2)])
        .expect("revised");
    let second = item(&report);
    assert!(
        !second.typed_cache && second.output.is_some(),
        "Item is compiled, on the array cache"
    );
    assert!(
        array.contains("_c(") && report.lock().unwrap()[&path].fell_back.is_empty(),
        "memoized, not given back"
    );

    // An error inside it again: now it is given back as written.
    let (start, _) = second.output.unwrap();
    transform
        .revise(&path, &[(start + 1, start + 2)])
        .expect("revised again");
    assert_eq!(report.lock().unwrap()[&path].fell_back, vec![first.span]);
}

fn rewritten_files(
    project: &Utf8Path,
    names: &[&str],
) -> std::collections::BTreeMap<String, String> {
    frontend()
        .inspect(
            project,
            |file, types| -> Result<_, nts_semantic_schema::SnapshotError> {
                let Some(name) = file.path.file_name().filter(|name| names.contains(name)) else {
                    return Ok(None);
                };
                let (mut transform, _) = ReactTransform::new(stage::default_options());
                Ok(Some((
                    name.to_owned(),
                    transform
                        .transform(file, types)
                        .expect("fixture is rewritten"),
                )))
            },
        )
        .unwrap()
        .into_iter()
        .flatten()
        .collect()
}

#[test]
fn a_member_tag_lowers_to_its_own_host_type() {
    // react-gtk declares a widget with slot or child elements as an
    // intersection, `HostComponent<"GtkPaned", ...> & PanedSlots`, and each
    // element as a member of it: both the widget and `Paned.StartChild` lower
    // to host types.
    let project = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures/host-components/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked in");
    let results = rewritten_files(&project, &["members.tsx", "members-untyped.tsx"]);
    let lowered = &results["members.tsx"];
    let written = &results["members-untyped.tsx"];
    for host in [
        "GtkPaned",
        "GtkPaned.StartChild",
        "GtkPaned.EndChild",
        "GtkGrid",
        "GtkGrid.Child",
        "GtkLabel",
    ] {
        assert!(
            lowered.contains(&format!("_jsx(\"{host}\""))
                || lowered.contains(&format!("_jsxs(\"{host}\"")),
            "{host} in {lowered}"
        );
    }
    assert!(
        !lowered.contains("Paned.StartChild,") && !lowered.contains("Grid.Child,"),
        "no member tag is a component: {lowered}"
    );

    // The real checker sees the same spelling with `any` widget declarations.
    assert!(
        written.contains("Paned.StartChild") && !written.contains("\"GtkPaned.StartChild\""),
        "{written}"
    );
}

#[test]
fn text_outside_ascii_keeps_every_span() {
    // The frontend and the compiler both count UTF-16 units (src/convert/text.rs).
    // Greek and an astral emoji before the component shift every later span
    // by a different amount in UTF-8 bytes than in UTF-16 units, so a span
    // counted in the wrong unit would cut the printed text or miss a tag.
    let project = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures/host-components/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked in");
    let (mut transform, _) = ReactTransform::new(stage::default_options());
    let lowered = inspect_file(&project, "unicode.tsx", |file, types| {
        transform
            .transform(file, types)
            .expect("unicode.tsx is rewritten")
    });
    for text in [
        "\"Καλημέρα κόσμε 🌍\"",
        "`Μετρητής 🌍 ${count}`",
        "\"Πρόσθεσε\"",
        "\"Γειά σου 🌍 κόσμε\"",
    ] {
        assert!(lowered.contains(text), "{text} in {lowered}");
    }
    for host in [
        "_jsxs(\"GtkBox\"",
        "_jsx(\"GtkLabel\"",
        "_jsx(\"GtkButton\"",
    ] {
        assert!(lowered.contains(host), "{host} in {lowered}");
    }
}

#[test]
fn a_host_component_tag_lowers_to_its_host_type() {
    let project = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures/host-components/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked in");
    let results = rewritten_files(&project, &["app.tsx", "app-untyped.tsx"]);
    let lowered = &results["app.tsx"];
    let written = &results["app-untyped.tsx"];
    for host in ["\"GtkBox\"", "\"GtkLabel\"", "\"GtkButton\""] {
        assert!(
            lowered.contains(&format!("_jsx(\"{}", &host[1..]))
                || lowered.contains(&format!("_jsxs({host}")),
            "{host} in {lowered}"
        );
    }
    assert!(
        !lowered.contains("_jsx(Button") && !lowered.contains("_jsxs(Box"),
        "no tag is a component: {lowered}"
    );

    // The real checker sees the same spelling with `any` widget declarations.
    assert!(
        written.contains("_jsx(Button") && !written.contains("\"GtkButton\""),
        "{written}"
    );
}

use std::num::NonZeroU16;

use crate::*;

fn options(count: u16) -> SessionOptions {
    let mut options = SessionOptions::new("/__nts_js_diagnostics_test__");
    options.checker_count = NonZeroU16::new(count);
    options
}
fn spec(check_js: Option<bool>, source: &str) -> ProjectSpec {
    let mut spec = ProjectSpec::new("tsconfig.json");
    let setting = check_js
        .map(|value| format!(",\"checkJs\":{value}"))
        .unwrap_or_default();
    spec.overlays.insert("tsconfig.json".into(), format!(r#"{{"compilerOptions":{{"allowJs":true,"noEmit":true,"target":"ESNext"{setting}}},"files":["index.js"]}}"#));
    spec.overlays.insert("index.js".into(), source.to_owned());
    spec
}

#[test]
fn explicit_unchecked_js_does_not_report_semantic_errors() {
    for count in [1, 4] {
        run(options(count), |session| {
            let checked = session
                .open(spec(Some(false), "const value = 0n === 1n;"))
                .expect("unchecked JS");
            {
                let file = checked
                    .projects()
                    .next()
                    .expect("program")
                    .files()
                    .find(|file| file.path().ends_with("index.js"))
                    .expect("JS source");
                let mut pending = vec![file.root()];
                while let Some(node) = pending.pop() {
                    if node.native.kind() == tsrs_ast::Kind::BinaryExpression {
                        let _ = node.ty(); // capture may already compute the checker error
                    }
                    for edge in node.edges() {
                        match edge {
                            Edge::Node { node, .. } => pending.push(node),
                            Edge::List { list, .. } => pending.extend(list.iter()),
                        }
                    }
                }
            }
            let finished = checked.finish();
            assert_eq!(finished.diagnostics(), []);
        });
    }
}

fn facts(count: u16, setting: Option<bool>, source: &str) -> (Vec<i32>, Vec<i32>) {
    run(options(count), |session| {
        let finished = session
            .open(spec(setting, source))
            .expect("JS project")
            .finish();
        let project = finished.projects().next().expect("requested project");
        assert_eq!(finished.diagnostics(), project.diagnostics());
        assert_eq!(
            finished.plain_js_unfiltered(),
            project.plain_js_unfiltered()
        );
        (
            project
                .diagnostics()
                .iter()
                .map(|diagnostic| diagnostic.code)
                .collect(),
            project
                .plain_js_unfiltered()
                .iter()
                .map(|diagnostic| diagnostic.code)
                .collect(),
        )
    })
}

#[test]
fn plain_js_assignment_early_error_is_a_separate_raw_fact() {
    let source = "function f() { return 0; }\nf() = 1;";
    for count in [1, 4] {
        let (ordinary, raw) = facts(count, None, source);
        assert_eq!(ordinary, []);
        assert!(raw.contains(&2364), "{raw:?}");
        assert_eq!(facts(count, Some(false), source), (vec![], vec![]));
        let (ordinary, raw) = facts(count, Some(true), source);
        assert!(ordinary.contains(&2364), "{ordinary:?}");
        assert_eq!(raw, []);
    }
}

#[test]
fn type_only_plain_js_diagnostics_never_become_ordinary_program_errors() {
    let one = facts(1, None, "const value = 0n === 1n;");
    assert_eq!(one.0, []);
    assert!(one.1.contains(&2367), "{:?}", one.1);
    assert_eq!(one, facts(4, None, "const value = 0n === 1n;"));
    let checked = facts(1, Some(true), "const value = 0n === 1n;");
    assert!(checked.0.contains(&2367));
    assert_eq!(checked.1, []);
}

#[test]
fn native_nocheck_ignore_and_check_directives_keep_their_own_policy() {
    for count in [1, 4] {
        assert_eq!(
            facts(
                count,
                None,
                "// @ts-nocheck\nfunction f() { return 0; }\nf() = 1;"
            ),
            (vec![], vec![])
        );
        assert_eq!(
            facts(
                count,
                Some(true),
                "// @ts-nocheck\nconst value = 0n === 1n;"
            ),
            (vec![], vec![])
        );
        assert_eq!(
            facts(
                count,
                Some(true),
                "/** @type {number} */ let value = 1;\n// @ts-ignore\nvalue = 'text';"
            ),
            (vec![], vec![])
        );
        let checked = facts(count, Some(false), "// @ts-check\nconst value = 0n === 1n;");
        assert!(checked.0.contains(&2367));
        assert_eq!(checked.1, []);
    }
}

#[test]
fn native_no_check_option_skips_the_raw_plain_js_view_too() {
    run(options(1), |session| {
        let mut project = spec(None, "function f() { return 0; }\nf() = 1;");
        let config = project
            .overlays
            .get_mut(&camino::Utf8PathBuf::from("tsconfig.json"))
            .expect("inline config");
        *config = config.replace("\"allowJs\":true", "\"allowJs\":true,\"noCheck\":true");
        let finished = session.open(project).expect("noCheck project").finish();
        assert_eq!(finished.diagnostics(), []);
        assert_eq!(finished.plain_js_unfiltered(), []);
    });
}

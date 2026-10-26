use std::num::NonZeroU16;

use camino::Utf8PathBuf;

use crate::*;

#[derive(Debug, PartialEq, Eq)]
struct OwnedResolution {
    specifier: Vec<u16>,
    path: Option<Utf8PathBuf>,
    version: Option<Vec<u16>>,
}
fn records<S: ViewPhase>(file: File<'_, S>) -> Vec<OwnedResolution> {
    file.resolved_imports()
        .map(|resolution| OwnedResolution {
            specifier: resolution.specifier.utf16().to_vec(),
            path: resolution.resolved_path.map(ToOwned::to_owned),
            version: resolution.package_version.map(|text| text.utf16().to_vec()),
        })
        .collect()
}
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}

fn project() -> ProjectSpec {
    let mut spec = ProjectSpec::new("tsconfig.json");
    for (path, content) in [
        (
            "tsconfig.json",
            r#"{"compilerOptions":{"noLib":true,"module":"NodeNext","moduleResolution":"NodeNext","paths":{"mapped":["./local.ts"]}},"files":["main.ts"]}"#,
        ),
        (
            "main.ts",
            r#"import type { Value } from "pkg"; export { local } from "./local"; import type { Types } from "only-types"; import type { Missing } from "missing"; export { local as alias } from "mapped"; import type { NoId } from "no-id"; import "./\ud800"; export type { Nested } from "outer";"#,
        ),
        ("local.ts", "export const local = 1;"),
        (
            "node_modules/pkg/package.json",
            r#"{"name":"pkg","version":"1.2.3","types":"index.d.ts"}"#,
        ),
        ("node_modules/pkg/index.d.ts", "export interface Value {}"),
        (
            "node_modules/@types/only-types/package.json",
            r#"{"name":"@types/only-types","version":"4.5.6","types":"index.d.ts"}"#,
        ),
        (
            "node_modules/@types/only-types/index.d.ts",
            "export interface Types {}",
        ),
        (
            "node_modules/no-id/package.json",
            r#"{"version":"9.9.9","types":"index.d.ts"}"#,
        ),
        ("node_modules/no-id/index.d.ts", "export interface NoId {}"),
        (
            "node_modules/outer/package.json",
            r#"{"name":"outer","version":"7.8.9","types":"index.d.ts"}"#,
        ),
        (
            "node_modules/outer/index.d.ts",
            "export type { Nested } from 'nested';",
        ),
        (
            "node_modules/outer/node_modules/nested/package.json",
            r#"{"name":"nested","version":"2.0.0","types":"index.d.ts"}"#,
        ),
        (
            "node_modules/outer/node_modules/nested/index.d.ts",
            "export interface Nested {}",
        ),
    ] {
        spec.overlays.insert(path.into(), content.to_owned());
    }
    spec
}

fn assert_main_records(actual: &[OwnedResolution]) {
    let expected = [
        (
            text("pkg"),
            Some("node_modules/pkg/index.d.ts"),
            Some("1.2.3"),
        ),
        (text("./local"), Some("local.ts"), None),
        (
            text("only-types"),
            Some("node_modules/@types/only-types/index.d.ts"),
            Some("4.5.6"),
        ),
        (text("missing"), None, None),
        (text("mapped"), Some("local.ts"), None),
        (text("no-id"), Some("node_modules/no-id/index.d.ts"), None),
        (vec![u16::from(b'.'), u16::from(b'/'), 0xd800], None, None),
        (
            text("outer"),
            Some("node_modules/outer/index.d.ts"),
            Some("7.8.9"),
        ),
    ]
    .into_iter()
    .map(|(specifier, path, version)| OwnedResolution {
        specifier,
        path: path.map(|path| Utf8PathBuf::from("/__nts_resolution_test__").join(path)),
        version: version.map(text),
    })
    .collect::<Vec<_>>();
    assert_eq!(actual, expected);
}

#[test]
fn native_resolutions_preserve_order_paths_versions_and_unresolved_inputs_in_both_phases() {
    fn capture(count: u16) -> Vec<OwnedResolution> {
        let mut options = SessionOptions::new("/__nts_resolution_test__");
        options.checker_count = NonZeroU16::new(count);
        run(options, |session| {
            let checked = session.open(project()).expect("resolution project");
            let project = checked.projects().next().expect("program");
            let file = project
                .files()
                .find(|file| file.path().ends_with("main.ts"))
                .expect("root source");
            let before = records(file);
            let specifiers: Vec<_> = file
                .imports()
                .map(|specifier| specifier.utf16().to_vec())
                .collect();
            assert_main_records(&before);
            assert_eq!(
                before
                    .iter()
                    .map(|record| record.specifier.clone())
                    .collect::<Vec<_>>(),
                specifiers
            );
            let nested = project
                .files()
                .find(|file| {
                    file.path()
                        .as_str()
                        .ends_with("node_modules/outer/index.d.ts")
                })
                .expect("outer declarations");
            let nested = records(nested);
            assert_eq!(nested.len(), 1);
            assert_eq!(nested[0].specifier, text("nested"));
            assert_eq!(nested[0].version, Some(text("2.0.0")));
            assert!(
                nested[0]
                    .path
                    .as_ref()
                    .expect("resolved nested package")
                    .as_str()
                    .ends_with("node_modules/outer/node_modules/nested/index.d.ts")
            );
            let finished = checked.diagnose_fixture_files().finish();
            let project = finished.projects().next().expect("finished program");
            let after = records(
                project
                    .files()
                    .find(|file| file.path().ends_with("main.ts"))
                    .expect("finished source"),
            );
            assert_eq!(before, after);
            assert!(
                project
                    .diagnostics()
                    .iter()
                    .any(|diagnostic| diagnostic.code == 2307)
            );
            after
        })
    }
    assert_eq!(capture(1), capture(4));
}

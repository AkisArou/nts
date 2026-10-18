//! JVM contracts follow declarations through a real tsgo snapshot, including
//! declaration files that TypeScript itself skips checking.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_semantic_schema::SemanticSnapshot;

fn snapshot(name: &str, declarations: &str) -> Option<SemanticSnapshot> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let root = Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .unwrap()
        .join(format!("nts-jvm-attributes-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("api.d.ts"), declarations).unwrap();
    std::fs::write(root.join("main.ts"), "export const value = 1;\n").unwrap();
    std::fs::write(root.join("tsconfig.json"), r#"{
      "compilerOptions": { "strict": true, "skipLibCheck": true, "target": "es2022", "noEmit": true },
      "files": ["main.ts", "api.d.ts"]
    }"#).unwrap();
    let result = TsgoApi::for_compilation(tsgo).snapshot(&root.join("tsconfig.json"));
    std::fs::remove_dir_all(&root).unwrap();
    Some(result.expect("the frontend reports annotation errors in the snapshot"))
}

#[test]
fn declaration_contracts_keep_unknown_empty_and_known_retention() {
    let Some(snapshot) = snapshot(
        "retention",
        r#"
declare module "java:p" {
  export class C {
    /** @ntsJvm special p/C.<init>:()V */
    constructor();
    /** @ntsJvm virtual p/C.unknown:(Ljava/lang/Object;)V */
    unknown(x: unknown): void;
    /**
     * @ntsJvm virtual p/C.borrow:(Ljava/lang/Object;)V
     * @ntsJvmKeeps none
     */
    borrow(x: unknown): void;
    /**
     * @ntsJvm virtual p/C.keep:(Ljava/lang/Object;Ljava/lang/Object;)V
     * @ntsJvmKeeps 0 1
     */
    keep(x: unknown, y: unknown): void;
  }
}
"#,
    ) else {
        return;
    };
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let contracts: Vec<_> = snapshot
        .nodes
        .iter()
        .filter_map(|node| node.native.as_ref()?.jvm.as_ref())
        .collect();
    assert_eq!(
        contracts.len(),
        4,
        "a file/module must not inherit its first member's tags"
    );
    let by_name = |name: &str| contracts.iter().find(|a| a.binding.contains(name)).unwrap();
    assert_eq!(by_name(".unknown:").keeps, None);
    assert_eq!(by_name(".borrow:").keeps, Some(vec![]));
    assert_eq!(by_name(".keep:").keeps, Some(vec![0, 1]));
}

#[test]
fn malformed_binding_docs_fail_even_when_skip_lib_check_is_enabled() {
    let Some(snapshot) = snapshot(
        "errors",
        r"
/** @ntsJvm sideways p/C.first:()V */
declare function first(): void;
/**
 * @ntsJvm static p/C.second:()V
 * @ntsJvm static p/C.second:()V
 */
declare function second(): void;
/**
 * @ntsJvm static p/C.third:()V
 * @ntsJvmKeeps none
 * @ntsJvmKeeps 0
 */
declare function third(): void;
",
    ) else {
        return;
    };
    assert!(snapshot.has_errors());
    let errors: Vec<_> = snapshot
        .diagnostics
        .iter()
        .filter(|d| d.code == "NTS0005")
        .collect();
    assert_eq!(errors.len(), 3, "{:?}", snapshot.diagnostics);
    for name in ["first", "second", "third"] {
        let error = errors
            .iter()
            .find(|d| d.message.contains(name))
            .expect("error names declaration");
        assert!(
            snapshot.sources[error.primary.file.0 as usize]
                .display_path
                .ends_with("api.d.ts")
        );
        assert!(error.primary.span.end > error.primary.span.start);
    }
}

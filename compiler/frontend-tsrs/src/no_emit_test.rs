//! nts checks source semantics and owns emission independently of TypeScript.
use std::num::NonZeroU16;
use std::sync::atomic::{AtomicU64, Ordering};

use super::*;
use crate::run;

fn options(count: u16) -> SessionOptions {
    let mut options = SessionOptions::new("/__nts_no_emit_test__");
    options.checker_count = NonZeroU16::new(count);
    options
}

fn diagnostics(count: u16, settings: &str, source: &str) -> Vec<Diagnostic> {
    let mut spec = ProjectSpec::new("tsconfig.json");
    spec.overlays.insert("tsconfig.json".into(), format!(r#"{{"compilerOptions":{{"target":"ESNext","types":[],"noEmit":false{settings}}},"files":["main.ts"]}}"#));
    spec.overlays.insert("main.ts".into(), source.to_owned());
    run(options(count), |session| {
        session
            .open(spec)
            .expect("source project")
            .diagnose_fixture_files()
            .finish()
            .diagnostics()
    })
}

#[test]
fn import_extensions_do_not_require_typescripts_emitter() {
    // Declared noEmit:false previously produced TS5096 (paired audit control).
    for count in [1, 4] {
        assert_eq!(
            diagnostics(
                count,
                ",\"module\":\"ESNext\",\"moduleResolution\":\"bundler\",\"allowImportingTsExtensions\":true",
                "export const value = 1;"
            ),
            []
        );
    }
}

#[test]
fn a_commonjs_generated_name_is_not_an_nts_source_error() {
    // TypeScript emission reserves `require` and used to produce TS2441 here.
    for count in [1, 4] {
        assert_eq!(
            diagnostics(
                count,
                ",\"module\":\"CommonJS\"",
                "export const require = 1;"
            ),
            []
        );
    }
}

#[test]
fn no_emit_does_not_hide_a_real_type_error() {
    for count in [1, 4] {
        let errors = diagnostics(
            count,
            ",\"module\":\"ESNext\"",
            "export const wrong: number = 'wrong';",
        );
        assert_eq!(
            errors.iter().map(|error| error.code).collect::<Vec<_>>(),
            [2322]
        );
    }
}

struct Directory(Utf8PathBuf);
impl Drop for Directory {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).expect("remove only test directory");
    }
}

#[test]
fn effective_no_emit_stays_true_through_checking_without_rewriting_the_config() {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    for count in [1, 4] {
        let root = Directory(
            Utf8PathBuf::from(std::env::var("HOME").expect("home"))
                .join(".cache/nts-no-emit-tests")
                .join(format!(
                    "{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                )),
        );
        std::fs::create_dir_all(&root.0).expect("test directory");
        let config = r#"{"compilerOptions":{"noEmit":false,"types":[],"target":"ESNext"},"files":["main.ts"]}"#;
        let path = root.0.join("tsconfig.json");
        std::fs::write(&path, config).expect("test config");
        std::fs::write(root.0.join("main.ts"), "export const value = 1;").expect("test source");
        let mut options = options(count);
        options.cwd.clone_from(&root.0);
        run(options, |session| {
            let checked = session
                .open(ProjectSpec::new(path.clone()))
                .expect("disk project");
            assert!(
                checked
                    .projects()
                    .next()
                    .expect("program")
                    .native
                    .program
                    .options()
                    .no_emit
                    .is_true()
            );
            let finished = checked.diagnose_fixture_files().finish();
            assert_eq!(finished.diagnostics(), []);
            let project = finished.projects().next().expect("program");
            assert!(project.native.program.options().no_emit.is_true());
        });
        assert_eq!(
            std::fs::read_to_string(&path).expect("original config"),
            config
        );
    }
}

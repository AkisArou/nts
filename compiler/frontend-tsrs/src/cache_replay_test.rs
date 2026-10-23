use std::collections::BTreeMap;
use std::num::NonZeroU16;
use std::sync::atomic::{AtomicU64, Ordering};

use camino::Utf8PathBuf;
use tsrs_vfs::FS;

use crate::*;

struct Scratch(Utf8PathBuf);
impl Scratch {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = Utf8PathBuf::from(std::env::var("HOME").expect("test cache home"))
            .join(".cache/nts-tsrs-input-tests")
            .join(format!(
                "{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
        std::fs::create_dir_all(&root).expect("scratch directory");
        Self(root)
    }
    fn options(&self) -> SessionOptions {
        let mut options = SessionOptions::new(self.0.clone());
        options.checker_count = NonZeroU16::new(1);
        options
    }
    fn write(&self, name: &str, text: &str) {
        let path = self.0.join(name);
        std::fs::create_dir_all(path.parent().expect("file parent")).expect("parent directory");
        std::fs::write(path, text).expect("scratch file");
    }
    fn project(&self, config: &str, source: &str) -> ProjectSpec {
        self.write("tsconfig.json", config);
        self.write("main.ts", source);
        ProjectSpec::new("tsconfig.json")
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).expect("remove only test scratch");
    }
}

#[test]
fn a_previously_missing_module_index_invalidates_native_inputs() {
    let scratch = Scratch::new();
    std::fs::create_dir(scratch.0.join("lib")).expect("module directory");
    let project = scratch.project(r#"{"compilerOptions":{"noLib":true,"module":"NodeNext","moduleResolution":"NodeNext"},"files":["main.ts"]}"#, "export { value } from './lib';");
    run(scratch.options(), |session| {
        let inputs = session
            .open(project.clone())
            .expect("project")
            .finish()
            .inputs();
        assert_eq!(session.inputs_match(&project, &inputs), Ok(()));
        scratch.write("lib/index.ts", "export const value = 1;");
        let changed = session
            .inputs_match(&project, &inputs)
            .expect_err("new module must invalidate cache");
        assert!(
            changed.path.to_string().contains("lib/index.ts"),
            "{changed}"
        );
        assert_eq!(changed.recorded, InputObservation::Missing);
        assert!(matches!(changed.current, InputObservation::Present { .. }));
        assert!(changed.to_string().contains("missing → present"));
    });
}

#[test]
fn a_previously_missing_types_package_invalidates_native_inputs() {
    let scratch = Scratch::new();
    std::fs::create_dir_all(scratch.0.join("node_modules/@types")).expect("type root");
    let project = scratch.project(
        r#"{"compilerOptions":{"noLib":true,"types":["ghost"]},"files":["main.ts"]}"#,
        "export const value = 1;",
    );
    run(scratch.options(), |session| {
        let checked = session.open(project.clone()).expect("project").finish();
        assert!(checked.diagnostics().iter().any(|d| d.code == 2688));
        let inputs = checked.inputs();
        assert_eq!(session.inputs_match(&project, &inputs), Ok(()));
        scratch.write(
            "node_modules/@types/ghost/index.d.ts",
            "declare const ghost: number;",
        );
        let changed = session
            .inputs_match(&project, &inputs)
            .expect_err("new types must invalidate cache");
        assert!(changed.path.to_string().contains("ghost"), "{changed}");
        assert_eq!(changed.recorded, InputObservation::Missing);
        assert!(matches!(changed.current, InputObservation::Present { .. }));
    });
}

#[test]
fn physical_reads_before_transformed_overlays_are_a_separate_revision_group() {
    let scratch = Scratch::new();
    scratch.write("main.ts", "original");
    run(scratch.options(), |session| {
        let original = ProjectSpec::new("tsconfig.json");
        let original_host = crate::host::Host::new(scratch.0.as_str(), &original.overlays);
        assert_eq!(
            original_host
                .read_file(scratch.0.join("main.ts").as_str())
                .as_deref(),
            Some("original")
        );
        let original_inputs = original_host.inputs();
        let mut rewritten = original.clone();
        rewritten
            .overlays
            .insert("main.ts".into(), "transformed".to_owned());
        let rewrite_host = crate::host::Host::new(scratch.0.as_str(), &rewritten.overlays);
        assert_eq!(
            rewrite_host
                .read_file(scratch.0.join("main.ts").as_str())
                .as_deref(),
            Some("transformed")
        );
        let rewrite_inputs = rewrite_host.inputs();
        scratch.write("main.ts", "changed physical source");
        assert_eq!(session.inputs_match(&rewritten, &rewrite_inputs), Ok(()));
        assert!(session.inputs_match(&original, &original_inputs).is_err());
        rewritten
            .overlays
            .insert("main.ts".into(), "changed transform".to_owned());
        assert!(session.inputs_match(&rewritten, &rewrite_inputs).is_err());
    });
}

#[test]
fn every_observation_is_replayed_through_its_original_host_method() {
    for kind in [
        InputKind::File,
        InputKind::FileExists,
        InputKind::DirectoryExists,
        InputKind::DirectoryEntries,
        InputKind::Metadata,
        InputKind::RealPath,
    ] {
        let scratch = Scratch::new();
        let target = scratch.0.join("value");
        scratch.write("value", "old");
        run(scratch.options(), |session| {
            let host = crate::host::Host::new(scratch.0.as_str(), &BTreeMap::new());
            let observed = match kind {
                InputKind::File => {
                    let _ = host.read_file(target.as_str());
                    target.clone()
                }
                InputKind::FileExists => {
                    assert!(host.file_exists(target.as_str()));
                    target.clone()
                }
                InputKind::DirectoryExists => {
                    assert!(host.directory_exists(scratch.0.as_str()));
                    scratch.0.clone()
                }
                InputKind::DirectoryEntries => {
                    let _ = host.get_accessible_entries(scratch.0.as_str());
                    scratch.0.clone()
                }
                InputKind::Metadata => {
                    assert!(host.stat(target.as_str()).is_some());
                    target.clone()
                }
                InputKind::RealPath => {
                    let _ = host.realpath(target.as_str());
                    target.clone()
                }
            };
            let inputs = host.inputs();
            let spec = ProjectSpec::new("unused.json");
            assert_eq!(session.inputs_match(&spec, &inputs), Ok(()));
            match kind {
                InputKind::File | InputKind::Metadata => {
                    scratch.write("value", "changed source text");
                }
                InputKind::FileExists => std::fs::remove_file(&target).expect("remove file"),
                InputKind::DirectoryExists => {
                    std::fs::remove_file(&target).expect("remove file");
                    std::fs::remove_dir(&scratch.0).expect("remove empty directory");
                }
                InputKind::DirectoryEntries => scratch.write("extra", "new entry"),
                InputKind::RealPath => {
                    #[cfg(unix)]
                    {
                        std::fs::rename(&target, scratch.0.join("elsewhere")).expect("move target");
                        std::os::unix::fs::symlink(scratch.0.join("elsewhere"), &target)
                            .expect("symlink");
                    }
                }
            }
            if kind != InputKind::RealPath || cfg!(unix) {
                let changed = session
                    .inputs_match(&spec, &inputs)
                    .expect_err("changed observation");
                assert_eq!(changed.kind, kind);
                assert_eq!(changed.path.utf8(), Some(observed.as_path()));
            }
            if kind == InputKind::DirectoryExists {
                std::fs::create_dir(&scratch.0).expect("restore scratch for its owner");
            }
        });
    }
}

#[test]
fn non_unicode_observations_remain_permanently_absent_on_replay() {
    let scratch = Scratch::new();
    let project = scratch.project(
        r#"{"compilerOptions":{"noLib":true},"files":["main.ts"]}"#,
        r"import { value } from './\ud800'; export { value };",
    );
    run(scratch.options(), |session| {
        let inputs = session
            .open(project.clone())
            .expect("project")
            .finish()
            .inputs();
        assert!(inputs.iter().any(|i| i.path.utf8().is_none()));
        assert_eq!(session.inputs_match(&project, &inputs), Ok(()));
    });
}

#[test]
fn a_missing_sibling_module_outside_the_config_directory_invalidates_reuse() {
    let scratch = Scratch::new();
    scratch.write("app/tsconfig.json", r#"{"compilerOptions":{"noLib":true,"module":"NodeNext","moduleResolution":"NodeNext"},"files":["main.ts"]}"#);
    scratch.write("app/main.ts", "export { value } from '../shared';");
    std::fs::create_dir(scratch.0.join("shared")).expect("sibling directory");
    let mut options = scratch.options();
    options.cwd = scratch.0.join("app");
    run(options, |session| {
        let project = ProjectSpec::new("tsconfig.json");
        let checked = session.open(project.clone()).expect("project").finish();
        assert!(checked.diagnostics().iter().any(|d| d.code == 2307));
        let inputs = checked.inputs();
        assert_eq!(session.inputs_match(&project, &inputs), Ok(()));
        scratch.write("shared/index.ts", "export const value = 1;");
        let changed = session
            .inputs_match(&project, &inputs)
            .expect_err("new sibling module");
        assert!(
            changed
                .path
                .utf8()
                .is_some_and(|p| p.ends_with("shared/index.ts")),
            "{changed}"
        );
        assert_eq!(changed.recorded, InputObservation::Missing);
        assert!(matches!(changed.current, InputObservation::Present { .. }));
        let revised = session.open(project).expect("reopened project").finish();
        assert!(!revised.diagnostics().iter().any(|d| d.code == 2307));
    });
}

#[test]
fn a_new_file_takes_precedence_over_a_directory_from_a_sibling_importer() {
    let scratch = Scratch::new();
    scratch.write("app/tsconfig.json", r#"{"compilerOptions":{"noLib":true,"module":"NodeNext","moduleResolution":"NodeNext"},"files":["main.ts"]}"#);
    scratch.write("app/main.ts", "export { value } from '../shared/importer';");
    scratch.write("shared/importer.ts", "export { value } from './x';");
    scratch.write("shared/x/index.ts", "export const value = 1;");
    let mut options = scratch.options();
    options.cwd = scratch.0.join("app");
    run(options, |session| {
        let project = ProjectSpec::new("tsconfig.json");
        let checked = session.open(project.clone()).expect("project").finish();
        assert!(!checked.diagnostics().iter().any(|d| d.code == 2307));
        assert!(
            checked
                .projects()
                .next()
                .expect("program")
                .files()
                .any(|f| f.path().ends_with("shared/x/index.ts"))
        );
        let inputs = checked.inputs();
        assert_eq!(session.inputs_match(&project, &inputs), Ok(()));
        scratch.write("shared/x.ts", "export const value = 2;");
        let changed = session
            .inputs_match(&project, &inputs)
            .expect_err("higher-precedence sibling file");
        assert!(
            changed
                .path
                .utf8()
                .is_some_and(|p| p.ends_with("shared/x.ts")),
            "{changed}"
        );
        assert_eq!(changed.recorded, InputObservation::Missing);
        assert!(matches!(changed.current, InputObservation::Present { .. }));
        let revised = session.open(project).expect("reopened project").finish();
        let files: Vec<_> = revised
            .projects()
            .next()
            .expect("program")
            .files()
            .map(File::path)
            .collect();
        assert!(files.iter().any(|p| p.ends_with("shared/x.ts")));
        assert!(!files.iter().any(|p| p.ends_with("shared/x/index.ts")));
    });
}

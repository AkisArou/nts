//! Reuse diagnostic facts only after replaying the native host's observations.
//!
//! Admission always resolves the current roots first. This memo never supplies
//! modules or packages, and never fingerprints filesystem answers itself.

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_tsrs::{Input, InputKind, InputPath, ProjectSpec, Session};
use serde::{Deserialize, Serialize};

use crate::resolution::Diagnostic;

#[derive(Debug, Serialize, Deserialize)]
struct Memo {
    // Bump when the consumer's diagnostic filtering or scope policy changes.
    version: u32,
    identity: String,
    config: Utf8PathBuf,
    inputs: Vec<RecordedInput>,
    diagnostics: Vec<Diagnostic>,
}

/// Serialization only: all fingerprints originate in the adapter's Host.
#[derive(Debug, Serialize, Deserialize)]
struct RecordedInput {
    path: RecordedPath,
    kind: RecordedKind,
    fingerprint: u128,
}

#[derive(Debug, Serialize, Deserialize)]
enum RecordedPath {
    Utf8(Utf8PathBuf),
    Utf16(Vec<u16>),
}

#[derive(Debug, Serialize, Deserialize)]
enum RecordedKind {
    File,
    FileExists,
    DirectoryExists,
    DirectoryEntries,
    Metadata,
    RealPath,
}

impl From<Input> for RecordedInput {
    fn from(input: Input) -> Self {
        Self {
            path: match input.path {
                InputPath::Utf8(path) => RecordedPath::Utf8(path),
                InputPath::Utf16(path) => RecordedPath::Utf16(path),
            },
            kind: match input.kind {
                InputKind::File => RecordedKind::File,
                InputKind::FileExists => RecordedKind::FileExists,
                InputKind::DirectoryExists => RecordedKind::DirectoryExists,
                InputKind::DirectoryEntries => RecordedKind::DirectoryEntries,
                InputKind::Metadata => RecordedKind::Metadata,
                InputKind::RealPath => RecordedKind::RealPath,
            },
            fingerprint: input.fingerprint,
        }
    }
}

impl From<RecordedInput> for Input {
    fn from(input: RecordedInput) -> Self {
        Self {
            path: match input.path {
                RecordedPath::Utf8(path) => InputPath::Utf8(path),
                RecordedPath::Utf16(path) => InputPath::Utf16(path),
            },
            kind: match input.kind {
                RecordedKind::File => InputKind::File,
                RecordedKind::FileExists => InputKind::FileExists,
                RecordedKind::DirectoryExists => InputKind::DirectoryExists,
                RecordedKind::DirectoryEntries => InputKind::DirectoryEntries,
                RecordedKind::Metadata => InputKind::Metadata,
                RecordedKind::RealPath => InputKind::RealPath,
            },
            fingerprint: input.fingerprint,
        }
    }
}

pub(super) fn identity(session: &Session) -> String {
    format!(
        "{}:{}",
        env!("NTS_DEPS_BUILD_HASH"),
        session.cache_identity()
    )
}

pub(super) fn path(workspace: &Utf8Path, config: &Utf8Path) -> Utf8PathBuf {
    workspace.join(".nts/checks").join(format!(
        "{:032x}.json",
        xxhash_rust::xxh3::xxh3_128(config.as_str().as_bytes())
    ))
}

/// Create the memo's output names before the checker observes directories.
/// Filling an existing non-source JSON file then cannot invalidate that same
/// check's directory listing. No observation is filtered out of replay.
pub(super) fn prepare(path: &Utf8Path) {
    if let Some(parent) = path.parent()
        && std::fs::create_dir_all(parent).is_ok()
    {
        let _ = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path);
    }
}

pub(super) fn read(
    path: &Utf8Path,
    session: &Session,
    spec: &ProjectSpec,
) -> Option<Vec<Diagnostic>> {
    let memo: Memo = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    if memo.version != 1
        || memo.identity != identity(session)
        || memo.config != spec.config_path
        || !spec.roots.is_empty()
        || !spec.overlays.is_empty()
    {
        return None;
    }
    let inputs: Vec<_> = memo.inputs.into_iter().map(Input::from).collect();
    session.inputs_match(spec, &inputs).ok()?;
    Some(memo.diagnostics)
}

pub(super) fn write(
    path: &Utf8Path,
    identity: String,
    spec: &ProjectSpec,
    inputs: Vec<Input>,
    diagnostics: &[Diagnostic],
) {
    let memo = Memo {
        version: 1,
        identity,
        config: spec.config_path.clone(),
        inputs: inputs.into_iter().map(RecordedInput::from).collect(),
        diagnostics: diagnostics.to_vec(),
    };
    // A lost or corrupt memo costs another check; it never costs evidence.
    if let Ok(bytes) = serde_json::to_vec(&memo)
        && let Some(parent) = path.parent()
        && std::fs::create_dir_all(parent).is_ok()
    {
        let _ = std::fs::write(path, bytes);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Fixture(Utf8PathBuf);
    impl Fixture {
        fn new(main: &str) -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let root = Utf8PathBuf::from_path_buf(std::env::temp_dir())
                .unwrap()
                .join(format!(
                    "nts-deps-complaints-{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                ));
            let fixture = Self(root);
            fixture.write("project/tsconfig.json", r#"{"compilerOptions":{"types":[],"target":"esnext","module":"esnext","moduleResolution":"bundler"},"include":["**/*.ts"]}"#);
            fixture.write("project/main.ts", main);
            fixture
        }
        fn write(&self, at: &str, text: &str) {
            let at = self.0.join(at);
            std::fs::create_dir_all(at.parent().unwrap()).unwrap();
            std::fs::write(at, text).unwrap();
        }
        fn memo(&self) -> Utf8PathBuf {
            path(
                &self.0.join("project"),
                &self.0.join("project/tsconfig.json"),
            )
        }
        fn check(&self) -> (Vec<Diagnostic>, bool) {
            crate::resolution::check(
                &self.0.join("project/tsconfig.json"),
                Some(std::num::NonZeroU16::MIN),
                &self.memo(),
                true,
            )
            .unwrap()
        }
        fn codes(&self, hit: bool) -> Vec<String> {
            let (diagnostics, reused) = self.check();
            assert_eq!(reused, hit);
            diagnostics
                .into_iter()
                .map(|diagnostic| diagnostic.code)
                .collect()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn settled_complaints_are_reused_without_starting_diagnostics() {
        let fixture = Fixture::new("export const n: number = 'wrong';");
        assert_eq!(fixture.codes(false), ["TS2322"]);
        assert_eq!(fixture.codes(true), ["TS2322"]);
    }

    #[test]
    fn editing_an_ambient_declaration_rechecks_and_clears_the_complaint() {
        let fixture = Fixture::new("export const n: number = ambient;");
        fixture.write("project/ambient.d.ts", "declare const ambient: string;");
        assert_eq!(fixture.codes(false), ["TS2322"]);
        assert_eq!(fixture.codes(true), ["TS2322"]);
        fixture.write("project/ambient.d.ts", "declare const ambient: number;");
        assert_eq!(fixture.codes(false), [] as [String; 0]);
        assert_eq!(fixture.codes(true), [] as [String; 0]);
    }

    #[test]
    fn changing_an_inherited_compiler_option_rechecks() {
        let fixture = Fixture::new("export const n: number = undefined;");
        fixture.write("project/tsconfig.json", r#"{"extends":"./base.json","compilerOptions":{"types":[],"target":"esnext"},"files":["main.ts"]}"#);
        fixture.write(
            "project/base.json",
            r#"{"compilerOptions":{"strictNullChecks":false}}"#,
        );
        assert_eq!(fixture.codes(false), [] as [String; 0]);
        assert_eq!(fixture.codes(true), [] as [String; 0]);
        fixture.write(
            "project/base.json",
            r#"{"compilerOptions":{"strictNullChecks":true}}"#,
        );
        assert_eq!(fixture.codes(false), ["TS2322"]);
    }

    #[test]
    fn editing_recovered_source_rechecks() {
        let fixture =
            Fixture::new("import {value} from './vendor/p'; export const n: number = value;");
        fixture.write("project/vendor/p.ts", "export const value = 1;");
        assert_eq!(fixture.codes(false), [] as [String; 0]);
        assert_eq!(fixture.codes(true), [] as [String; 0]);
        fixture.write("project/vendor/p.ts", "export const value = 'changed';");
        assert_eq!(fixture.codes(false), ["TS2322"]);
    }

    #[test]
    fn a_new_resolution_winner_rechecks() {
        let fixture = Fixture::new("import {value} from './x'; export const n: number = value;");
        fixture.write("project/x/index.ts", "export const value = 1;");
        assert_eq!(fixture.codes(false), [] as [String; 0]);
        assert_eq!(fixture.codes(true), [] as [String; 0]);
        fixture.write("project/x.ts", "export const value = 'new winner';");
        assert_eq!(fixture.codes(false), ["TS2322"]);
    }

    #[test]
    fn a_different_checker_identity_rechecks() {
        let fixture = Fixture::new("export const n: number = 'wrong';");
        assert_eq!(fixture.codes(false), ["TS2322"]);
        let path = fixture.memo();
        let mut memo: Memo = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        memo.identity.push_str("-other-build");
        std::fs::write(path, serde_json::to_vec(&memo).unwrap()).unwrap();
        assert_eq!(fixture.codes(false), ["TS2322"]);
    }
}

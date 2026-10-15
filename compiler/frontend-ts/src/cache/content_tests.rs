//! Capture counts distinguish a working cache from correct repeated computation.

use super::*;
use crate::FrontendStats;
use nts_diagnostics::{Digest, SourceFile};

struct Project {
    root: Utf8PathBuf,
    config: Utf8PathBuf,
    cache: Utf8PathBuf,
}

impl Project {
    fn new(name: &str) -> Self {
        let root = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .expect("utf8 temp")
            .join(format!("nts-content-cache-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("project")).expect("project");
        let config = root.join("project/tsconfig.json");
        std::fs::write(&config, "{\"files\":[\"main.ts\"]}").expect("config");
        std::fs::write(root.join("project/main.ts"), "export const a = 1;").expect("source");
        Self {
            cache: root.join("cache"),
            root,
            config,
        }
    }

    fn source(&self) -> CountingSource {
        CountingSource {
            captures: 0,
            files: vec![self.root.join("project/main.ts")],
            identity: Some("counting-source-v1".into()),
        }
    }

    fn ask(&self, source: &mut CountingSource) -> SemanticSnapshot {
        snapshot_in(source, &self.config, "test", &self.cache).expect("snapshot")
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

struct CountingSource {
    captures: usize,
    files: Vec<Utf8PathBuf>,
    identity: Option<String>,
}

impl SemanticSource for CountingSource {
    fn snapshot(&mut self, _: &Utf8Path) -> Result<SemanticSnapshot, SnapshotError> {
        self.captures += 1;
        Ok(SemanticSnapshot {
            schema_version: SCHEMA_VERSION,
            sources: self
                .files
                .iter()
                .map(|path| SourceFile {
                    uri: format!("test://{}", path.file_name().expect("file")),
                    digest: Digest(hash_of(&std::fs::read(path).expect("input")).to_le_bytes()),
                    display_path: path.clone(),
                    rewritten_by: None,
                    rewritten_map: vec![],
                })
                .collect(),
            ..SemanticSnapshot::default()
        })
    }

    fn stats(&self) -> FrontendStats {
        FrontendStats::default()
    }
    fn identity(&self) -> String {
        self.identity.clone().unwrap_or_default()
    }
    fn cache_identity(&self) -> Option<String> {
        self.identity.clone()
    }
}

#[test]
fn unchanged_control_captures_once() {
    let project = Project::new("unchanged");
    let mut source = project.source();
    let first = project.ask(&mut source);
    let second = project.ask(&mut source);
    assert_eq!(source.captures, 1);
    assert_eq!(first.digest(), second.digest());
}

#[test]
fn restored_local_input_reuses_the_original_capture() {
    let project = Project::new("local-aba");
    let mut source = project.source();
    let first = project.ask(&mut source);
    let input = &source.files[0];
    let original = std::fs::read(input).expect("original");
    std::fs::write(input, "export const a = 2;").expect("B");
    let changed = project.ask(&mut source);
    assert_ne!(first.digest(), changed.digest());
    std::fs::write(&source.files[0], original).expect("restore A");
    let restored = project.ask(&mut source);
    assert_eq!(first.digest(), restored.digest());
    assert_eq!(source.captures, 2, "A/B/A must retain both content entries");
}

#[test]
fn restored_external_input_reuses_the_original_capture() {
    let project = Project::new("external-aba");
    let mut source = project.source();
    let external = project.root.join("outside.ts");
    std::fs::write(&external, "export const b = 1;").expect("external");
    source.files.push(external.clone());
    let first = project.ask(&mut source);
    std::fs::write(&external, "export const b = 2;").expect("B");
    assert_ne!(first.digest(), project.ask(&mut source).digest());
    std::fs::write(&external, "export const b = 1;").expect("restore A");
    assert_eq!(first.digest(), project.ask(&mut source).digest());
    assert_eq!(
        source.captures, 2,
        "external bytes belong to the full content key"
    );
}

#[test]
fn an_unidentifiable_producer_never_uses_persistent_answers() {
    let project = Project::new("no-identity");
    let mut source = project.source();
    source.identity = None;
    project.ask(&mut source);
    project.ask(&mut source);
    assert_eq!(source.captures, 2, "unknown producer must bypass caching");
}

#[test]
fn executable_bytes_belong_to_the_producer_identity() {
    let project = Project::new("tool-identity");
    let tool = project.root.join("tsgo");
    let copy = project.root.join("tsgo-copy");
    std::fs::write(&tool, "tool A").expect("tool");
    std::fs::copy(&tool, &copy).expect("copy");
    let first = crate::TsgoApi::new(tool.clone()).cache_identity();
    assert!(first.is_some());
    assert_eq!(first, crate::TsgoApi::new(copy).cache_identity());
    std::fs::write(&tool, "tool B").expect("replace same path, same length");
    assert_ne!(first, crate::TsgoApi::new(tool).cache_identity());
    assert_eq!(
        crate::TsgoApi::new(project.root.join("missing")).cache_identity(),
        None
    );
}

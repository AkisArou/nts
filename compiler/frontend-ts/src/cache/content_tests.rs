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
            mutate: None,
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
    mutate: Option<String>,
}

impl SemanticSource for CountingSource {
    fn snapshot(&mut self, _: &Utf8Path) -> Result<SemanticSnapshot, SnapshotError> {
        self.captures += 1;
        let snapshot = SemanticSnapshot {
            schema_version: SCHEMA_VERSION,
            sources: self
                .files
                .iter()
                .map(|path| {
                    Ok(SourceFile {
                        uri: format!("test://{}", path.file_name().expect("file")),
                        digest: Digest(
                            hash_of(
                                &std::fs::read(path)
                                    .map_err(|error| SnapshotError::Transport(error.to_string()))?,
                            )
                            .to_le_bytes(),
                        ),
                        display_path: path.clone(),
                        rewritten_by: None,
                        rewritten_map: vec![],
                    })
                })
                .collect::<Result<_, SnapshotError>>()?,
            ..SemanticSnapshot::default()
        };
        if let Some(text) = self.mutate.take() {
            std::fs::write(&self.files[0], text).expect("concurrent edit");
        }
        Ok(snapshot)
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
    assert_eq!(
        first.digest().expect("digest"),
        second.digest().expect("digest")
    );
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
    assert_ne!(
        first.digest().expect("digest"),
        changed.digest().expect("digest")
    );
    std::fs::write(&source.files[0], original).expect("restore A");
    let restored = project.ask(&mut source);
    assert_eq!(
        first.digest().expect("digest"),
        restored.digest().expect("digest")
    );
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
    assert_ne!(
        first.digest().expect("digest"),
        project.ask(&mut source).digest().expect("digest")
    );
    std::fs::write(&external, "export const b = 1;").expect("restore A");
    assert_eq!(
        first.digest().expect("digest"),
        project.ask(&mut source).digest().expect("digest")
    );
    assert_eq!(
        source.captures, 2,
        "external bytes belong to the full content key"
    );
}

#[test]
fn a_missing_external_input_cannot_reuse_a_previous_success() {
    let project = Project::new("missing-dependency");
    let mut source = project.source();
    let external = project.root.join("dependency.ts");
    std::fs::write(&external, "export const x = 1;").expect("dependency");
    source.files.push(external.clone());
    let first = project.ask(&mut source);
    std::fs::remove_file(&external).expect("remove dependency");
    assert!(snapshot_in(&mut source, &project.config, "test", &project.cache).is_err());
    assert_eq!(
        source.captures, 2,
        "the failed manifest read must ask the producer"
    );
    std::fs::write(external, "export const x = 1;").expect("restore dependency");
    assert_eq!(
        first.digest().expect("digest"),
        project.ask(&mut source).digest().expect("digest")
    );
    assert_eq!(
        source.captures, 2,
        "the unchanged original content entry survives the failed attempt"
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
    let modified = std::fs::metadata(&tool)
        .expect("metadata")
        .modified()
        .expect("mtime");
    std::fs::write(&tool, "tool B").expect("replace same path, same length");
    std::fs::File::options()
        .write(true)
        .open(&tool)
        .expect("open")
        .set_modified(modified)
        .expect("restore mtime");
    assert_ne!(first, crate::TsgoApi::new(tool).cache_identity());
    assert_eq!(
        crate::TsgoApi::new(project.root.join("missing")).cache_identity(),
        None
    );
}

#[test]
fn independent_configuration_and_producer_variants_survive() {
    for dimension in ["config", "base-config", "identity", "tool"] {
        let project = Project::new(dimension);
        let mut source = project.source();
        if dimension == "base-config" {
            std::fs::write(&project.config, "{\"extends\":\"./base.json\"}").expect("extends");
            std::fs::write(project.root.join("project/base.json"), "{}").expect("base");
        }
        project.ask(&mut source);
        let path = if dimension == "base-config" {
            project.root.join("project/base.json")
        } else {
            project.config.clone()
        };
        let original = std::fs::read(&path).expect("config");
        match dimension {
            "identity" => source.identity = Some("different transform or generated surface".into()),
            "tool" => {
                snapshot_in(&mut source, &project.config, "other tool", &project.cache)
                    .expect("other tool");
            }
            _ => std::fs::write(&path, "{\"compilerOptions\":{\"strict\":true}}")
                .expect("new config"),
        }
        if dimension != "tool" {
            project.ask(&mut source);
        }
        source.identity = Some("counting-source-v1".into());
        std::fs::write(path, original).expect("restore config");
        project.ask(&mut source);
        assert_eq!(source.captures, 2, "{dimension}: A/B/A captures twice");
    }
}

#[test]
fn incomplete_configs_bypass_reuse_instead_of_hiding_options() {
    let project = Project::new("incomplete-configs");
    let mut source = project.source();
    for config in [
        "{\"extends\":\"missing-package\"}",
        "{\"extends\":\"./missing.json\"}",
        "{\"extends\":\"./tsconfig.json\"}",
        "{bad json}",
    ] {
        std::fs::write(&project.config, config).expect("config");
        let before = source.captures;
        project.ask(&mut source);
        project.ask(&mut source);
        assert_eq!(source.captures - before, 2, "{config}");
    }
    std::fs::write(&project.config, "{/* comment with an ignored \\\"extends\\\" */ \"compilerOptions\": {\"paths\":{\"x\":[\"//string\",],},},}").expect("JSONC");
    let before = source.captures;
    project.ask(&mut source);
    project.ask(&mut source);
    assert_eq!(
        source.captures - before,
        1,
        "supported JSONC must still hit"
    );
}

#[test]
fn truncated_entries_and_hints_cost_captures_not_wrong_hits() {
    let project = Project::new("corruption");
    let mut source = project.source();
    let original = project.ask(&mut source).digest().expect("digest");
    let entry = std::fs::read_dir(&project.cache)
        .expect("cache")
        .map(Result::unwrap)
        .find(|e| e.path().extension().is_some_and(|ext| ext == "postcard"))
        .expect("entry")
        .path();
    std::fs::write(entry, [0, 1, 2]).expect("truncate");
    assert_eq!(project.ask(&mut source).digest().expect("digest"), original);
    assert_eq!(source.captures, 2);
    let hint = std::fs::read_dir(project.cache.join("manifests"))
        .expect("hints")
        .next()
        .expect("hint")
        .expect("file")
        .path();
    std::fs::write(hint, [255]).expect("truncate hint");
    assert_eq!(project.ask(&mut source).digest().expect("digest"), original);
    assert_eq!(source.captures, 3);
}

#[test]
fn a_hint_cannot_hide_a_snapshots_external_dependency() {
    let project = Project::new("hint-validation");
    let mut source = project.source();
    let external = project.root.join("external.ts");
    std::fs::write(&external, "export const x = 1").expect("external");
    source.files.push(external);
    project.ask(&mut source);
    let asked = question(&source, &absolute(&project.config), "test").expect("question");
    let mut paths = required_paths(&project.ask(&mut source), &asked);
    paths.retain(|p| !p.ends_with("external.ts"));
    let read = manifest(paths.clone()).expect("incomplete manifest");
    let key = encoded_hash(&(&asked, &read)).expect("key");
    let snapshot = project.ask(&mut source);
    let entry = Entry {
        question: asked.clone(),
        read,
        snapshot,
    };
    atomic_write(
        &entry_path(&project.cache, key),
        &postcard::to_allocvec(&entry).expect("encode"),
    )
    .expect("forged entry");
    let local = encoded_hash(&asked).expect("local");
    let hint = project
        .cache
        .join("manifests")
        .join(format!("{local:032x}.manifest"));
    atomic_write(
        &hint,
        &postcard::to_allocvec(&Hint {
            format: FORMAT,
            paths,
        })
        .expect("hint"),
    )
    .expect("forged hint");
    project.ask(&mut source);
    assert_eq!(
        source.captures, 2,
        "a hint chooses a candidate but cannot grant freshness"
    );
}

#[test]
fn concurrent_publications_leave_complete_entries_and_no_partials() {
    let project = Project::new("publication-race");
    let mut threads = Vec::new();
    for _ in 0..8 {
        let config = project.config.clone();
        let cache = project.cache.clone();
        let mut source = project.source();
        threads.push(std::thread::spawn(move || {
            snapshot_in(&mut source, &config, "test", &cache)
                .expect("capture")
                .digest()
                .expect("digest")
        }));
    }
    let results: Vec<_> = threads
        .into_iter()
        .map(|t| t.join().expect("thread"))
        .collect();
    assert!(results.iter().all(|r| *r == results[0]));
    let mut source = project.source();
    project.ask(&mut source);
    assert_eq!(source.captures, 0, "a completed publication is reusable");
    for entry in std::fs::read_dir(&project.cache).expect("cache") {
        let entry = entry.expect("file");
        assert_ne!(
            entry.path().extension().and_then(|s| s.to_str()),
            Some("partial")
        );
        if entry.path().extension().is_some_and(|e| e == "postcard") {
            let entry: Entry = postcard::from_bytes(&std::fs::read(entry.path()).expect("read"))
                .expect("whole entry");
            entry.snapshot.validate().expect("valid snapshot");
        }
    }
}

#[test]
fn an_input_edited_during_capture_is_not_published_under_the_old_question() {
    let project = Project::new("concurrent-edit");
    let mut source = project.source();
    source.mutate = Some("export const a = 2;".into());
    let captured = project.ask(&mut source);
    assert!(
        !project.cache.exists(),
        "an unstable local question is not stored"
    );
    let current = project.ask(&mut source);
    assert_ne!(
        captured.digest().expect("digest"),
        current.digest().expect("digest")
    );
    project.ask(&mut source);
    assert_eq!(
        source.captures, 2,
        "the stable second capture becomes reusable"
    );
}

#[test]
fn failed_publication_keeps_the_fresh_answer_and_costs_only_reuse() {
    let project = Project::new("unwritable-cache");
    std::fs::write(&project.cache, "not a directory").expect("blocked cache");
    let mut source = project.source();
    let first = project.ask(&mut source);
    assert_eq!(
        first.digest().expect("digest"),
        project.ask(&mut source).digest().expect("digest")
    );
    assert_eq!(source.captures, 2);
}

fn age(path: &Utf8Path, now: std::time::SystemTime) {
    std::fs::File::options()
        .write(true)
        .open(path)
        .expect("open")
        .set_modified(now - std::time::Duration::from_hours(8 * 24))
        .expect("age");
}

#[test]
fn unused_entries_hints_and_partials_are_collected_by_age() {
    let project = Project::new("age-collection");
    std::fs::create_dir_all(project.cache.join("manifests")).expect("hints");
    let now = std::time::SystemTime::now();
    let old = [
        project.cache.join("old.postcard"),
        project.cache.join("abandoned.partial"),
        project.cache.join("manifests/old.manifest"),
    ];
    for path in &old {
        std::fs::write(path, "old").expect("file");
        age(path, now);
    }
    let fresh = project.cache.join("fresh.postcard");
    std::fs::write(&fresh, "recent").expect("file");
    collect_old(&project.cache, now);
    assert!(old.iter().all(|p| !p.exists()));
    assert!(fresh.exists());
}

#[test]
fn collection_claim_is_shared_between_short_lived_processes() {
    const CHILD: &str = "NTS_CACHE_COLLECTION_TEST_ROOT";
    const CLOCK: &str = "NTS_CACHE_COLLECTION_TEST_TIME";
    if let Some(dir) = std::env::var_os(CHILD) {
        let seconds = std::env::var(CLOCK)
            .expect("clock")
            .parse()
            .expect("seconds");
        bound_the_cache_at(
            &Utf8PathBuf::from_path_buf(dir.into()).expect("utf8"),
            std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds),
        );
        return;
    }
    let project = Project::new("collection-claim");
    std::fs::create_dir_all(&project.cache).expect("cache");
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_secs();
    let now = std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds);
    let first = project.cache.join("first-collection.postcard");
    std::fs::write(&first, "old").expect("file");
    age(&first, now);
    let run = || {
        let output = std::process::Command::new(std::env::current_exe().expect("test binary"))
            .args([
                "--exact",
                "cache::content_tests::collection_claim_is_shared_between_short_lived_processes",
            ])
            .env(CHILD, &project.cache)
            .env(CLOCK, seconds.to_string())
            .output()
            .expect("child");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("1 passed;"),
            "the child must execute exactly one test"
        );
    };
    run();
    assert!(!first.exists(), "the first process must actually collect");
    let old = project.cache.join("miss-after-collection.postcard");
    std::fs::write(&old, "old").expect("file");
    age(&old, now);
    run();
    assert!(
        old.exists(),
        "the second process must not sweep again in this hour"
    );
}

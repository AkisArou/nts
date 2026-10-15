//! Content-addressed snapshots: namespace the producer, hash the question,
//! validate every dependency, and retain independent input variants.

use camino::{Utf8Path, Utf8PathBuf};
use nts_semantic_schema::{SCHEMA_VERSION, SemanticSnapshot, SnapshotError};
use serde::{Deserialize, Serialize};

use crate::source::SemanticSource;

const FORMAT: u32 = 1;
type Manifest = Vec<(String, u128)>;

mod budget;
use budget::touch;
#[cfg(test)]
use budget::{collect_at as bound_the_cache_at, collect_old, sweep};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Question {
    format: u32,
    schema: u32,
    built_by: u128,
    tool: String,
    identity: String,
    config: String,
    listing: Manifest,
    configs: Manifest,
}

#[derive(Serialize, Deserialize)]
struct Entry {
    question: Question,
    read: Manifest,
    snapshot: SemanticSnapshot,
}

/// A hint only chooses which content entry to validate. It never supplies an
/// answer or bypasses the complete entry's question and dependency checks.
#[derive(Serialize, Deserialize)]
struct Hint {
    format: u32,
    paths: Vec<String>,
}

/// Take a snapshot, reusing a stored answer only after validating its inputs.
/// An unavailable producer identity or incomplete file/config read bypasses reuse.
pub fn snapshot<S: SemanticSource>(
    source: &mut S,
    tsconfig: &Utf8Path,
    tool: &str,
) -> Result<SemanticSnapshot, SnapshotError> {
    let Some(dir) = cache_dir() else {
        return source.snapshot(tsconfig);
    };
    snapshot_in(source, tsconfig, tool, &dir)
}

fn question<S: SemanticSource>(source: &S, config: &Utf8Path, tool: &str) -> Option<Question> {
    Some(Question {
        format: FORMAT,
        schema: SCHEMA_VERSION,
        built_by: crate::FRONTEND_STAMP,
        tool: tool.to_owned(),
        identity: source.cache_identity()?,
        config: config.to_string(),
        listing: manifest(checked_project_listing(config)?)?,
        configs: manifest(config_chain(config)?)?,
    })
}

fn snapshot_in<S: SemanticSource>(
    source: &mut S,
    tsconfig: &Utf8Path,
    tool: &str,
    dir: &Utf8Path,
) -> Result<SemanticSnapshot, SnapshotError> {
    let canonical = absolute(tsconfig);
    let Some(asked) = question(source, &canonical, tool) else {
        return source.snapshot(tsconfig);
    };
    let Some(local_key) = encoded_hash(&asked) else {
        return source.snapshot(tsconfig);
    };
    let hint_path = dir
        .join("manifests")
        .join(format!("{local_key:032x}.manifest"));
    if let Some(hint) = read_value::<Hint>(&hint_path)
        && hint.format == FORMAT
        && let Some(read) = manifest(hint.paths)
        && let Some(key) = encoded_hash(&(&asked, &read))
    {
        let path = entry_path(dir, key);
        if let Some(entry) = read_entry(&path)
            && entry.question == asked
            && entry.read == read
            && required_paths(&entry.snapshot, &asked)
                == read.iter().map(|(p, _)| p.clone()).collect::<Vec<_>>()
            && entry.snapshot.validate().is_ok()
        {
            touch(&path);
            touch(&hint_path);
            return Ok(entry.snapshot);
        }
    }

    let snapshot = source.snapshot(tsconfig)?;
    // Files can change while the checker runs. Never publish an answer under
    // the local question we observed before such a change.
    if question(source, &canonical, tool).as_ref() != Some(&asked) {
        return Ok(snapshot);
    }
    let paths = required_paths(&snapshot, &asked);
    if let Some(read) = manifest(paths.clone())
        && let Some(key) = encoded_hash(&(&asked, &read))
    {
        let entry = Entry {
            question: asked,
            read,
            snapshot: snapshot.clone(),
        };
        if let Ok(bytes) = postcard::to_allocvec(&entry)
            && let Ok(hint) = postcard::to_allocvec(&Hint {
                format: FORMAT,
                paths,
            })
        {
            let _ = budget::publish(dir, (&entry_path(dir, key), &bytes), (&hint_path, &hint));
        }
    }
    Ok(snapshot)
}

fn required_paths(snapshot: &SemanticSnapshot, question: &Question) -> Vec<String> {
    let mut paths: Vec<_> = snapshot
        .sources
        .iter()
        .map(|s| s.display_path.to_string())
        .chain(question.configs.iter().map(|(path, _)| path.clone()))
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

fn manifest(mut paths: Vec<String>) -> Option<Manifest> {
    paths.sort();
    paths.dedup();
    paths
        .into_iter()
        .map(|path| {
            let bytes = std::fs::read(&path).ok()?;
            Some((path, hash_of(&bytes)))
        })
        .collect()
}

fn encoded_hash(value: &impl Serialize) -> Option<u128> {
    Some(hash_of(&postcard::to_allocvec(value).ok()?))
}

fn entry_path(dir: &Utf8Path, key: u128) -> Utf8PathBuf {
    dir.join(format!("content-v{FORMAT}-{key:032x}.postcard"))
}

fn read_value<T: serde::de::DeserializeOwned>(path: &Utf8Path) -> Option<T> {
    postcard::from_bytes(&std::fs::read(path).ok()?).ok()
}

/// A unique sibling followed by rename: readers see a complete value or a miss.
pub(crate) fn atomic_write(path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::other("no cache parent"))?;
    std::fs::create_dir_all(parent)?;
    let partial = path.with_extension(format!(
        "{}-{}.partial",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = std::fs::File::options()
            .write(true)
            .create_new(true)
            .open(&partial)?;
        file.write_all(bytes)?;
        file.flush()?;
        std::fs::rename(&partial, path)
    })();
    let _ = std::fs::remove_file(partial);
    result
}

/// Where entries live, or `None` when the cache is switched off.
///
/// `NTS_NO_SNAPSHOT_CACHE=1` turns it off, which is what to reach for when a
/// stale entry is ever suspected: the answer should not change.
pub(crate) fn cache_dir() -> Option<Utf8PathBuf> {
    if std::env::var("NTS_NO_SNAPSHOT_CACHE").is_ok_and(|value| value != "0") {
        return None;
    }
    if let Ok(named) = std::env::var("NTS_SNAPSHOT_CACHE") {
        return Some(Utf8PathBuf::from(named));
    }
    // **A cache belongs in the cache directory, not in the temporary one**, and
    // this one is the reason that distinction is not academic here:
    // `/tmp/nts-snapshots` reached **8.4 GiB in 16,891 entries**, two thirds of a
    // per-user quota, on a `/tmp` that is tmpfs.
    //
    // Three things make that worse than an ordinary full directory. The quota is
    // a *block* quota keyed on UID, so every session and every agent shares one
    // budget; its soft and hard limits are equal, so there is **no grace period**
    // and a write fails with `EDQUOT` the instant it is reached; and `df` cannot
    // predict it, because the free space it reports lies outside the quota. On
    // top of that, tmpfs pages are RAM that can only be *relocated to swap* and
    // never dropped, so the cache was holding some 40% of memory unreclaimably
    // on a machine that was OOM-killing.
    //
    // `tooling/conformance/snapshot-cache.mjs` -- the step that checks this very
    // cache -- has said so beside its own scratch directory all along: "Under
    // `~/.cache`, never `/tmp`: a tmpfs that fills."
    //
    // Resolved the way `tooling/differential/src/objects.rs`'s `cache_dir` does,
    // which is the same function under the same name for the object cache, so the
    // two answer XDG identically rather than each having a theory about it. The
    // `temp_dir` fallback stays for the one environment with neither
    // `XDG_CACHE_HOME` nor `HOME`, where there is no cache directory to prefer
    // and `/tmp` is the only answer -- silently switching the cache *off* there
    // would be a performance cliff with no diagnostic.
    //
    // This move is mandatory rather than a tidy-up: `std::env::temp_dir()`
    // consults `TMPDIR`-or-`/tmp` and knows nothing of systemd's disk-backed
    // `temporary-large` tier, so no environment change reaches this line. Only
    // this does.
    let base = std::env::var("XDG_CACHE_HOME")
        .ok()
        .filter(|dir| !dir.is_empty())
        .map(Utf8PathBuf::from)
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|home| Utf8PathBuf::from(home).join(".cache"))
        });
    base.map(|dir| dir.join("nts/snapshots")).or_else(|| {
        Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .ok()
            .map(|dir| dir.join("nts-snapshots"))
    })
}

/// The path a cache entry is named by, resolved once.
///
/// **An empty parent is the current directory, not nothing** -- the third time
/// that sentence has been the fix in this repository, after `absolute()` in the
/// CLI and the `jar --extract` working directory. `canonicalize` on a path that
/// cannot be resolved falls back to the path itself, which keys no worse than
/// before.
fn absolute(path: &Utf8Path) -> Utf8PathBuf {
    let path = if path.as_str().is_empty() {
        Utf8Path::new(".")
    } else {
        path
    };
    std::fs::canonicalize(path)
        .ok()
        .and_then(|resolved| Utf8PathBuf::from_path_buf(resolved).ok())
        .unwrap_or_else(|| path.to_owned())
}

/// Complete local config ancestry. Unsupported package resolution, unreadable
/// parents, malformed JSONC or a cycle bypass caching rather than hide options.
fn config_chain(tsconfig: &Utf8Path) -> Option<Vec<String>> {
    fn visit(path: &Utf8Path, active: &mut Vec<String>, chain: &mut Vec<String>) -> Option<()> {
        let path = Utf8PathBuf::from_path_buf(std::fs::canonicalize(path).ok()?).ok()?;
        if active.len() >= 64 || active.contains(&path.to_string()) {
            return None;
        }
        if chain.contains(&path.to_string()) {
            return Some(());
        }
        active.push(path.to_string());
        let value: serde_json::Value =
            serde_json::from_slice(&jsonc(&std::fs::read(&path).ok()?)?).ok()?;
        let object = value.as_object()?;
        chain.push(path.to_string());
        let parents = match object.get("extends") {
            None => Vec::new(),
            Some(serde_json::Value::String(s)) => vec![s.as_str()],
            Some(serde_json::Value::Array(values)) => values
                .iter()
                .map(serde_json::Value::as_str)
                .collect::<Option<Vec<_>>>()?,
            _ => return None,
        };
        for name in parents {
            if !name.starts_with('.') && !Utf8Path::new(name).is_absolute() {
                return None;
            }
            let joined = path.parent()?.join(name);
            let parent = [joined.clone(), Utf8PathBuf::from(format!("{joined}.json"))]
                .into_iter()
                .find(|p| p.is_file())?;
            visit(&parent, active, chain)?;
        }
        active.pop();
        Some(())
    }
    let mut chain = Vec::new();
    visit(tsconfig, &mut Vec::new(), &mut chain)?;
    Some(chain)
}

/// Strip JSONC comments and trailing commas while preserving every string byte.
fn jsonc(input: &[u8]) -> Option<Vec<u8>> {
    let mut bytes = input.to_vec();
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'"' => {
                at += 1;
                loop {
                    match *bytes.get(at)? {
                        b'\\' => at += 2,
                        b'"' => {
                            at += 1;
                            break;
                        }
                        _ => at += 1,
                    }
                }
            }
            b'/' if bytes.get(at + 1) == Some(&b'/') => {
                while at < bytes.len() && bytes[at] != b'\n' {
                    bytes[at] = b' ';
                    at += 1;
                }
            }
            b'/' if bytes.get(at + 1) == Some(&b'*') => {
                bytes[at] = b' ';
                bytes[at + 1] = b' ';
                at += 2;
                while !(bytes.get(at) == Some(&b'*') && bytes.get(at + 1) == Some(&b'/')) {
                    *bytes.get_mut(at)? = b' ';
                    at += 1;
                }
                bytes[at] = b' ';
                bytes[at + 1] = b' ';
                at += 2;
            }
            _ => at += 1,
        }
    }
    at = 0;
    while at < bytes.len() {
        if bytes[at] == b'"' {
            at += 1;
            while *bytes.get(at)? != b'"' {
                at += if bytes[at] == b'\\' { 2 } else { 1 };
            }
        } else if bytes[at] == b',' {
            let mut next = at + 1;
            while bytes.get(next).is_some_and(u8::is_ascii_whitespace) {
                next += 1;
            }
            if matches!(bytes.get(next), Some(b']' | b'}')) {
                bytes[at] = b' ';
            }
        }
        at += 1;
    }
    Some(bytes)
}

fn checked_project_listing(tsconfig: &Utf8Path) -> Option<Vec<String>> {
    fn walk(dir: &Utf8Path, into: &mut Vec<String>, depth: u32) -> Option<()> {
        if depth > 64 {
            return None;
        }
        for entry in std::fs::read_dir(dir).ok()? {
            let path = Utf8PathBuf::from_path_buf(entry.ok()?.path()).ok()?;
            let meta = std::fs::metadata(&path).ok()?;
            if meta.is_dir() {
                walk(&path, into, depth + 1)?;
            } else if matches!(
                path.extension(),
                Some("ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs")
            ) {
                into.push(path.into_string());
            }
        }
        Some(())
    }
    let root = tsconfig.parent()?;
    let root = if root.as_str().is_empty() {
        Utf8Path::new(".")
    } else {
        root
    };
    let mut found = Vec::new();
    walk(root, &mut found, 0)?;
    found.sort();
    Some(found)
}

#[cfg(test)]
fn project_listing(tsconfig: &Utf8Path) -> Vec<String> {
    checked_project_listing(tsconfig).unwrap_or_default()
}

fn hash_of(bytes: &[u8]) -> u128 {
    xxhash_rust::xxh3::xxh3_128(bytes)
}

fn read_entry(path: &Utf8Path) -> Option<Entry> {
    read_value(path)
}

#[cfg(test)]
#[path = "cache/content_tests.rs"]
mod content_tests;

#[cfg(test)]
mod tests {
    use super::*;

    /// The listing is what notices a source being **added**.
    ///
    /// `entry.read` hashes every file tsgo read, so an edit to an existing
    /// source invalidates on its own. A new file was read by nobody, so it is
    /// in no hash, and the listing is the only thing that can see it.
    ///
    /// It walked `.ts` and `.tsx` only, which was correct until `allowJs` made
    /// a `.js` file part of a program. Reproduced before this test existed: one
    /// `.ts` project compiled to populate the cache, then given a JSDoc-typed
    /// `.js` beside it, reported `1 function(s)` with the cache and `2` without.
    #[test]
    fn the_listing_sees_a_javascript_file_added_beside_a_typescript_one() {
        let dir = std::env::temp_dir().join(format!("nts-listing-{}", std::process::id()));
        let src = dir.join("src");
        std::fs::create_dir_all(&src).expect("a scratch project");
        std::fs::write(dir.join("tsconfig.json"), "{}").expect("a config");
        std::fs::write(src.join("main.ts"), "export const a = 1;\n").expect("a source");
        let config = Utf8PathBuf::from_path_buf(dir.join("tsconfig.json")).expect("utf8");

        let before = project_listing(&config);
        std::fs::write(src.join("extra.js"), "export const b = 2;\n").expect("a second source");
        let after = project_listing(&config);

        std::fs::remove_dir_all(&dir).ok();
        assert_ne!(
            before, after,
            "a `.js` file added to the project must change the listing, or the \
             cache serves a program with a source missing and says nothing"
        );
        assert!(after.iter().any(|path| path.ends_with("extra.js")));
    }

    /// The other direction, so the change is not simply "list everything".
    #[test]
    fn the_listing_ignores_a_file_that_is_not_a_source() {
        let dir = std::env::temp_dir().join(format!("nts-listing-other-{}", std::process::id()));
        let src = dir.join("src");
        std::fs::create_dir_all(&src).expect("a scratch project");
        std::fs::write(dir.join("tsconfig.json"), "{}").expect("a config");
        std::fs::write(src.join("main.ts"), "export const a = 1;\n").expect("a source");
        let config = Utf8PathBuf::from_path_buf(dir.join("tsconfig.json")).expect("utf8");

        let before = project_listing(&config);
        std::fs::write(src.join("notes.md"), "not a source\n").expect("a note");
        std::fs::write(src.join("data.json"), "{}\n").expect("some data");
        let after = project_listing(&config);

        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(before, after, "only sources belong in the listing");
    }
}

#[cfg(test)]
mod bounding {
    use super::sweep;
    use camino::Utf8PathBuf;
    use std::time::{Duration, SystemTime};

    /// A directory of this test's own, named after it so two cannot share one.
    /// The `tempfile` crate is not a dependency here and a test is not a reason to
    /// make it one.
    fn scratch(name: &str) -> Utf8PathBuf {
        let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .expect("a utf8 temporary directory")
            .join(format!("nts-cache-sweep-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create");
        dir
    }

    /// Four entries of 100 bytes, staggered an hour apart so the order is
    /// unambiguous: entry 0 is the oldest, entry 3 the newest.
    fn four(dir: &Utf8PathBuf) -> Vec<Utf8PathBuf> {
        let now = SystemTime::now();
        let mut made = Vec::new();
        for index in 0_u64..4 {
            let path = dir.join(format!("{index}.postcard"));
            std::fs::write(&path, vec![0_u8; 100]).expect("write");
            let file = std::fs::File::options()
                .write(true)
                .open(&path)
                .expect("open");
            let last_use = now - Duration::from_secs(3600 * (4 - index));
            file.set_times(
                std::fs::FileTimes::new()
                    .set_modified(last_use)
                    .set_accessed(last_use),
            )
            .expect("stamp");
            made.push(path);
        }
        made
    }

    #[test]
    fn the_least_recently_used_go_first() {
        let dir = scratch("lru");
        let paths = four(&dir);
        // 400 bytes held, 250 allowed: the two oldest go and the two newest stay.
        sweep(&dir, 250);
        assert!(!paths[0].exists(), "the oldest entry should be gone");
        assert!(!paths[1].exists(), "the second-oldest entry should be gone");
        assert!(paths[2].exists(), "a recent entry should be kept");
        assert!(paths[3].exists(), "the newest entry should be kept");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn under_the_cap_nothing_moves() {
        // The control, and the arm that matters most: a sweep that evicts while
        // under its cap is a cache that never hits, which passes every other test
        // in this module and every test outside it.
        let dir = scratch("under");
        let paths = four(&dir);
        sweep(&dir, 4096);
        for path in &paths {
            assert!(path.exists(), "{path} should survive a cap it is under");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_directory_that_is_not_there_is_not_an_error() {
        sweep(
            &Utf8PathBuf::from("/nonexistent/nts-snapshots-should-not-exist"),
            0,
        );
    }
}

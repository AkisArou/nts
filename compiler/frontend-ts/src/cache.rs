//! A snapshot remembered on disk, so a project nobody has touched is not asked
//! about twice.
//!
//! # What it is for
//!
//! Asking tsgo costs about 170ms for a small project, which is roughly a
//! quarter of a whole `nts check` — and the gate asks the same question about
//! the same 89 examples twice over, once for the differential and once again
//! under reference counting, on byte-identical input. That second pass learns
//! nothing.
//!
//! # Why not `SemanticSnapshot::digest`
//!
//! Because it hashes the snapshot, which is the answer. A cache key has to be
//! made of the *question*: the files, the tool and the schema.
//!
//! # What makes an entry valid
//!
//! Three things, and the third is the one that is easy to forget:
//!
//! - every file the snapshot says it read still hashes the same. The snapshot
//!   records them, which is what makes an import outside the project directory
//!   -- and the node profile is full of them -- part of the key rather than a
//!   hole in it;
//! - the tool and the schema version are the ones that produced it;
//! - the *set* of `.ts` files under the project has not changed. A file added
//!   beside the others is picked up by a `tsconfig` glob without any existing
//!   file changing a byte, so content hashes alone would not see it.
//!
//! A miss costs a read and a few hashes. A wrong hit would cost a green gate on
//! code that no longer exists, so the checks lean that way.

use camino::{Utf8Path, Utf8PathBuf};
use nts_semantic_schema::{SCHEMA_VERSION, SemanticSnapshot, SnapshotError};
use serde::{Deserialize, Serialize};

use crate::source::SemanticSource;

/// What was true when the snapshot was taken.
#[derive(Serialize, Deserialize)]
struct Entry {
    schema: u32,
    /// The compiler binary that decomposed this snapshot; see `compiler_stamp`.
    ///
    /// A field of its own rather than folded into `tool`, for the reason the
    /// `configs` comment below gives about itself: an entry written before this
    /// existed has no such field, `postcard` refuses it, and it is recomputed
    /// rather than trusted.
    built_by: u128,
    tool: String,
    /// Every file the snapshot read, and what its bytes hashed to.
    read: Vec<(String, u128)>,
    /// The `.ts` files under the project, so an addition is not invisible.
    listing: Vec<String>,
    /// The tsconfig and everything it `extends`, hashed in `read` beside the
    /// sources. See [`config_chain`].
    ///
    /// Recorded separately as well, and the redundancy is the point: an entry
    /// written before this existed has no such field, `postcard` refuses it,
    /// and it is recomputed rather than trusted. Without that, every cache on
    /// every machine would keep answering from entries that never checked a
    /// configuration -- which is the bug, surviving its own fix.
    configs: Vec<String>,
    snapshot: SemanticSnapshot,
}

/// Take a snapshot, reusing a stored one where nothing has changed.
///
/// Falls back to asking `source` for anything it cannot prove: an unreadable
/// cache, an entry from another tool, a file it cannot hash.
///
/// # Errors
///
/// Whatever `source` returns when the snapshot has to be taken.
pub fn snapshot<S: SemanticSource>(
    source: &mut S,
    tsconfig: &Utf8Path,
    tool: &str,
) -> Result<SemanticSnapshot, SnapshotError> {
    let Some(dir) = cache_dir() else {
        return source.snapshot(tsconfig);
    };
    // A source transform answers too: its version and options decide the
    // snapshot as much as the files do, so they are part of the question.
    let identity = source.identity();
    let tool = &*if identity.is_empty() { tool.to_owned() } else { format!("{tool}+{identity}") };
    // **The key is a path, so it has to be *the* path.**
    //
    // It was `tsconfig.as_str()` verbatim, and `nts build` run from a project
    // directory passes the relative `tsconfig.json` -- so every project on the
    // machine invoked that way hashed to one entry. Worse, the `listing` guard
    // that would have caught the collision was vacuous for exactly those calls:
    // `Utf8Path::new("tsconfig.json").parent()` is `""`, `read_dir("")` fails,
    // and an empty listing matches an empty listing.
    //
    // Reproduced from a cleared cache with two projects, each built as
    // `nts build tsconfig.json` from its own directory: the first succeeded and
    // the second was handed the first's program. It surfaced as "no source in
    // this program is that file" -- the product-entry check catching it, which
    // is luck rather than protection, because a project whose entry happened to
    // match would have compiled the wrong sources and said nothing.
    //
    // Canonicalised rather than merely made absolute: two paths reaching one
    // config through different symlinks are one project and must be one entry.
    let canonical = absolute(tsconfig);
    let listing = project_listing(&canonical);
    // **`tool` is part of the file name, not only of the entry.** It carries
    // which questions were asked (`TsgoApi::identity`), and two commands asking
    // different ones build different snapshots. Validating it on *read* is
    // enough for correctness -- a mismatch is a miss -- but the miss then
    // overwrites the other command's entry, so `nts frontend P` and a build of
    // `P` evicted each other and both ran cold every time. Hashed into the name,
    // each keeps its own entry and both hit. The `entry.tool` check below stays
    // as what it now is: a guard against a hash collision rather than the key.
    let path = dir.join(format!(
        "{:032x}.postcard",
        hash_of(&[canonical.as_str().as_bytes(), b"\0", tool.as_bytes()].concat())
    ));
    // The compiler that *built* the snapshot, beside the tool that answered the
    // questions. `tool` stamps `tsgo`; the decomposer turning tsgo's answers
    // into a `SemanticSnapshot` lives here, and nothing recorded it.
    //
    // **That is not a refinement, it is the hole this module's own argument
    // leaves open.** The header above says a wrong hit "would cost a green
    // gate", and then proves freshness of the *sources*, the *configs*, the
    // *listing* and *tsgo* -- everything except the code that reads them. On
    // 2026-09-12 one line was added to `decompose.rs` naming `AsyncGenerator`
    // as natively represented, and 8581 stored entries went on answering
    // without it: `emit-c` compiled the program and `nts check` refused it, in
    // the same tree, from the same source, in the same second.
    //
    // `schema` does not cover it and should not be made to: the snapshot's
    // *shape* was unchanged, and a version number bumped by hand is a step that
    // gets forgotten exactly when it matters.
    //
    // The granularity is right rather than merely safe. This changes only when
    // the binary is relinked, so a gate whose `build` step is a no-op keeps
    // every entry, and a gate that rebuilt the compiler retakes them once --
    // which is the run whose answers were going to be wrong.
    let built_by = compiler_stamp();

    if let Some(entry) = read_entry(&path)
        && entry.schema == SCHEMA_VERSION
        && entry.built_by == built_by
        && entry.tool == tool
        && entry.listing == listing
        && entry.configs == config_chain(&canonical)
        && entry.read.iter().all(|(file, seen)| {
            std::fs::read(file).is_ok_and(|bytes| hash_of(&bytes) == *seen)
        })
    {
        // **Touched, which is what makes the sweep an LRU rather than a cull by
        // age.** An entry is written once and then only *read*, so its mtime is
        // its creation time and a hot entry looks exactly as old as a dead one.
        // Without this, `bound_the_cache` would evict whatever happened to be
        // compiled first, which for this tree is the same handful of fixtures on
        // every gate run.
        //
        // **At most hourly, and that is the granularity rather than a dodge.** A
        // cap measured in gigabytes needs to tell "used this week" from "compiled
        // once in June"; recording access to the *second* is precision it cannot
        // spend, bought with a write on every hit. And a write on every hit is
        // exactly what `a_second_build_hits_the_snapshot_cache_rather_than_
        // rewriting_it` forbids: that test proves a hit by the entry's timestamp
        // not moving between two builds a second apart, and it cannot prove it by
        // content, because a *miss* now rewrites byte-identical content -- the
        // digest was made deterministic in `05ecc8ed1`. So an unconditional touch
        // would take away the only signal that test has, and an hourly one leaves
        // it untouched while still answering the question the sweep asks.
        //
        // Failure is ignored on purpose: a cache whose timestamps cannot be
        // updated should still answer, and the only cost is that the sweep falls
        // back to by-age for that entry.
        const REFRESH_AFTER: std::time::Duration = std::time::Duration::from_hours(1);
        let stale = std::fs::metadata(&path)
            .and_then(|meta| meta.modified())
            .is_ok_and(|at| {
                std::time::SystemTime::now()
                    .duration_since(at)
                    .is_ok_and(|since| since > REFRESH_AFTER)
            });
        if stale && let Ok(file) = std::fs::File::options().write(true).open(&path) {
            let _ = file.set_modified(std::time::SystemTime::now());
        }
        return Ok(entry.snapshot);
    }

    let snapshot = source.snapshot(tsconfig)?;
    // **The canonical path here too.** This read `tsconfig` while the check
    // above reads `canonical`, so a relative invocation stored
    // `["tsconfig.json"]` and compared it against `["/abs/.../tsconfig.json"]`
    // -- never equal, so the entry was rewritten on every run and the cache
    // never hit at all. Introduced by the canonicalisation that fixed the key:
    // one of the two derivations moved.
    //
    // Found by measuring. The cache and no-cache arms came back identical --
    // 0.445s against 0.442s -- which is exactly what a cache that never hits
    // looks like, and is why the null result was worth chasing rather than
    // reporting.
    //
    // **What it is worth, on the same project and the same rounds once it hits
    // again**: `examples/workspace/apps/linux`, five alternating rounds, warm,
    // under the gate lock, artifact verified rather than only the exit status --
    //
    //     cache      best 0.088s  median 0.099s
    //     no cache   best 0.384s  median 0.393s
    //
    // Four times, and three quarters of a warm rebuild. The object cache
    // already covers the C, so what is left is almost all frontend.
    let configs = config_chain(&canonical);
    let wanted = snapshot.sources.len() + configs.len();
    let recorded = configs.clone();
    let read: Vec<(String, u128)> = snapshot
        .sources
        .iter()
        .map(|file| file.display_path.as_str().to_owned())
        .chain(configs)
        .filter_map(|path| {
            let bytes = std::fs::read(&path).ok()?;
            Some((path, hash_of(&bytes)))
        })
        .collect();
    // Only when every file it read could be hashed. One that could not is a
    // dependency the entry would not be able to check, and an entry that cannot
    // check itself is worse than no entry.
    if read.len() == wanted {
        let entry = Entry {
            schema: SCHEMA_VERSION,
            built_by,
            tool: tool.to_owned(),
            read,
            listing,
            configs: recorded,
            snapshot: snapshot.clone(),
        };
        if let Ok(bytes) = postcard::to_allocvec(&entry) {
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(&path, bytes);
        }
    }
    // After the store, so this run's own entry carries a current stamp and is the
    // last thing a sweep would take rather than the first.
    bound_the_cache(&dir);
    Ok(snapshot)
}

/// Hold the cache under a size cap, least-recently-used first.
///
/// **An entry's path is keyed by the project and the questions asked, so a miss
/// *overwrites* rather than adds** -- which is why the count is not bounded by how
/// often the compiler is rebuilt, and is bounded by how many distinct projects have
/// ever been compiled. That is the growth nobody was watching: one-off projects.
/// Probes, reductions, fixtures and test262 cases are each their own project,
/// compiled once and never again, and each leaves an entry that no run will ever
/// read. `/tmp/nts-snapshots` reached **8.4 GiB in 17,095 entries** that way, on a
/// per-UID quota with no grace period, and `c7856d689` moved the cache somewhere
/// with room rather than giving it a bound. That commit said so in as many words:
/// the move makes the growth *survivable, not safe*.
///
/// **Eviction by stale schema was the obvious policy and is not available.** A
/// schema-stale entry can never be read by any binary, so it looks like the safe
/// thing to delete -- but the schema is *inside* the entry, and finding it means
/// deserialising every file in the directory. Seventeen thousand postcard decodes
/// on the path of a compile is not a cache, it is a tax. The name carries a hash
/// and nothing else, deliberately, so the cheap questions are size and time.
///
/// **And eviction by compiler stamp would be wrong rather than merely slow.**
/// `built_by` changes on every relink, so "not mine" is most of the directory --
/// and the binaries sharing this cache are not one compiler over time but several
/// at once: `pin.mjs` builds one per revision, and a differential runs two arms
/// against each other. Evicting the other arm's entries would make every
/// comparison cold in the direction it was just measured in.
///
/// So: a size cap, oldest-accessed first, once per process and only after a miss.
/// A hit already cost nothing and should keep costing nothing; a miss has just run
/// the whole frontend, and a directory scan beside that is not measurable.
///
/// The default is 2 GiB, against the 8.4 GiB observed and the ~170 MiB a full
/// corpus run leaves. `NTS_SNAPSHOT_CACHE_MAX` overrides it, in bytes, for a
/// machine where either number is the wrong one.
fn bound_the_cache(dir: &Utf8Path) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static SWEPT: AtomicBool = AtomicBool::new(false);
    if SWEPT.swap(true, Ordering::Relaxed) {
        return;
    }
    let cap: u64 = std::env::var("NTS_SNAPSHOT_CACHE_MAX")
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(2 * 1024 * 1024 * 1024);
    sweep(dir, cap);
}

/// The sweep itself, separated from the once-per-process guard and the environment
/// so that it can be *run* by a test.
///
/// A policy behind a `static` that fires once is a policy no test can call twice,
/// and a cap read from the environment is one a test has to mutate a global to
/// choose. Both are the wrapper's business; this takes the directory and the number.
fn sweep(dir: &Utf8Path, cap: u64) {
    let Ok(listing) = std::fs::read_dir(dir) else {
        return;
    };
    let mut found: Vec<(std::time::SystemTime, u64, std::path::PathBuf)> = Vec::new();
    let mut total: u64 = 0;
    for entry in listing.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let when = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        total = total.saturating_add(meta.len());
        found.push((when, meta.len(), entry.path()));
    }
    if total <= cap {
        return;
    }
    found.sort_by_key(|(when, _, _)| *when);
    for (_, size, path) in found {
        if total <= cap {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

/// What identifies the compiler that built a snapshot.
///
/// The running executable's length and modification time, hashed. Not its
/// contents: the binary is ~100MB and this is on the path of every compile,
/// where the metadata read is two syscalls and changes on exactly the events
/// that matter -- a relink.
///
/// Zero when the executable cannot be found or stat'd, which fails *closed* in
/// the sense that matters: every run that cannot identify itself agrees on one
/// stamp, so entries are shared between them rather than an unreadable
/// compiler silently getting its own cache.
fn compiler_stamp() -> u128 {
    let Ok(exe) = std::env::current_exe() else {
        return 0;
    };
    let Ok(meta) = std::fs::metadata(&exe) else {
        return 0;
    };
    let modified = meta
        .modified()
        .ok()
        .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_nanos());
    hash_of(&format!("{}:{}:{modified}", exe.display(), meta.len()).into_bytes())
}

/// Where entries live, or `None` when the cache is switched off.
///
/// `NTS_NO_SNAPSHOT_CACHE=1` turns it off, which is what to reach for when a
/// stale entry is ever suspected: the answer should not change.
fn cache_dir() -> Option<Utf8PathBuf> {
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
        .or_else(|| std::env::var("HOME").ok().map(|home| Utf8PathBuf::from(home).join(".cache")));
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
    let path = if path.as_str().is_empty() { Utf8Path::new(".") } else { path };
    std::fs::canonicalize(path)
        .ok()
        .and_then(|resolved| Utf8PathBuf::from_path_buf(resolved).ok())
        .unwrap_or_else(|| path.to_owned())
}

/// The tsconfig and everything it `extends`, so a change to one invalidates.
///
/// The entry checked every `.ts` the snapshot read and **not the configuration
/// that decided which they were**. A tsconfig is not a source file, so it was
/// in neither `read` nor `listing`, and the key is the config's *path* -- which
/// does not move when its contents do. Changing only `rootDir` and re-running
/// returned the previous answer: a `TS6059` about a directory the config no
/// longer had.
///
/// That is the worst shape a caching bug takes. A slow cache annoys someone
/// into looking; a stale entry is a plausible answer to a question nobody asked,
/// and the npm lane was running with `NTS_NO_SNAPSHOT_CACHE=1` permanently
/// rather than trust it.
///
/// Textual rather than parsed, and deliberately: a tsconfig is JSONC, so a
/// parser has to accept comments and trailing commas to be right about a file
/// this only needs one field from -- and being wrong about the field means
/// *missing* a config, which is the failure being fixed. Anything this cannot
/// resolve is simply not added, and an unhashable entry already makes the whole
/// entry unwritable above.
fn config_chain(tsconfig: &Utf8Path) -> Vec<String> {
    let mut chain = Vec::new();
    let mut at = Some(tsconfig.to_owned());
    // A config chain is two or three deep in practice. The bound is against a
    // cycle rather than a limit anyone should reach.
    for _ in 0..8 {
        let Some(path) = at.take() else { break };
        let Ok(text) = std::fs::read_to_string(&path) else {
            break;
        };
        if !chain.contains(&path.as_str().to_owned()) {
            chain.push(path.as_str().to_owned());
        }
        at = extends_of(&text).and_then(|named| {
            let parent = path.parent()?;
            let joined = parent.join(&named);
            // `extends` names a file, a file without its extension, or a
            // package. Only the first two are resolved here; a package's
            // config lives under `node_modules` and is not something a project
            // edits between runs, which is the case this exists for.
            [joined.clone(), Utf8PathBuf::from(format!("{joined}.json"))]
                .into_iter()
                .find(|candidate| candidate.is_file())
        });
    }
    chain
}

/// The value of a top-level `"extends"`, if the text has one.
fn extends_of(text: &str) -> Option<String> {
    let at = text.find("\"extends\"")?;
    let rest = &text[at + "\"extends\"".len()..];
    let open = rest.find('"')?;
    let after = &rest[open + 1..];
    let close = after.find('"')?;
    Some(after[..close].to_owned())
}

fn hash_of(bytes: &[u8]) -> u128 {
    xxhash_rust::xxh3::xxh3_128(bytes)
}

/// Every `.ts` under the project directory, sorted.
///
/// Names only: what the bytes say is already covered by `read` above, and this
/// is here for the file that appears without anything else changing.
fn project_listing(tsconfig: &Utf8Path) -> Vec<String> {
    let Some(root) = tsconfig.parent() else {
        return Vec::new();
    };
    // Defence in depth for the bug above: a caller reaching this with a bare
    // relative path got an empty listing, and an empty listing is a guard that
    // passes for everything rather than a project with no sources in it.
    let root = if root.as_str().is_empty() { Utf8Path::new(".") } else { root };
    let mut found = Vec::new();
    walk(root, &mut found, 0);
    found.sort_unstable();
    found
}

fn walk(dir: &Utf8Path, into: &mut Vec<String>, depth: u32) {
    // A project is a handful of directories deep. The bound is a guard against
    // a symlink loop rather than a limit anyone should reach.
    if depth > 16 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(path) = Utf8PathBuf::from_path_buf(entry.path()) else {
            continue;
        };
        if path.is_dir() {
            walk(&path, into, depth + 1);
        } else if matches!(
            path.extension(),
            // **The JavaScript family too, and unconditionally.**
            //
            // `entry.read` hashes every file tsgo actually read, so an *edit*
            // to a `.js` file was already caught. What this listing catches is
            // a file being **added** -- a program can grow a source without any
            // existing source changing, and then nothing else notices.
            //
            // Under `allowJs` that was a stale hit rather than a slow one.
            // Reproduced: a project with one `.ts`, compiled once to populate
            // the cache, then given a new JSDoc-typed `.js` beside it. With the
            // cache it reported `1 function(s)`; with `NTS_NO_SNAPSHOT_CACHE=1`
            // it reported `2`. The second function was simply absent, and
            // nothing said so.
            //
            // Two derivations of one fact: tsgo resolves a project's files from
            // the tsconfig and includes `.js` when `allowJs` is on, and this
            // walk did not. They agreed only while both meant `.ts`.
            //
            // Unconditional rather than read off `allowJs`, because reading the
            // option here would make this a *third* derivation of the project's
            // shape. Over-invalidating is the safe direction -- a needless miss
            // costs a recompile, a wrong hit costs a wrong program -- and it is
            // cheap: the largest project in this tree gains 25 paths, and `.js`
            // is 6% of the repository's `.ts` count.
            Some("ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs")
        ) {
            into.push(path.into_string());
        }
    }
}

fn read_entry(path: &Utf8Path) -> Option<Entry> {
    let bytes = std::fs::read(path).ok()?;
    postcard::from_bytes(&bytes).ok()
}

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
            let file = std::fs::File::options().write(true).open(&path).expect("open");
            file.set_modified(now - Duration::from_secs(3600 * (4 - index)))
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
        sweep(&Utf8PathBuf::from("/nonexistent/nts-snapshots-should-not-exist"), 0);
    }
}

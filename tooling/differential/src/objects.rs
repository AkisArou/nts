//! The runtime's object files, compiled once per content rather than once per
//! check.
//!
//! # Why
//!
//! Every `check` built its program as one `clang` command over the generated C
//! *and* the whole runtime, at `-O1`. The runtime is the same bytes in nearly
//! every one of them, and it was the cost: in one `nts check examples/math`,
//! clang took 2.03 s of 2.06. The differential runs over every example on
//! every backend in the gate, and `tooling/differential/agree.mjs` is only
//! worth running before a commit if it is quick.
//!
//! # The key is everything the compile reads
//!
//! The compiler's identity (`clang --version`, and its path), the flags and
//! defines in order, the source's bytes, and the name and bytes of every
//! header it includes with `#include "..."` -- followed transitively, resolved
//! the way clang resolves them (beside the including file, then each `-I`
//! directory), and a name that resolves nowhere is keyed as absent. A key that
//! read only the source would hand back a stale object the day a header
//! changed and nothing else did; the test262 census, which keeps the same
//! cache, found its runtime including a per-program header exactly that way.
//!
//! **Do not narrow this key to make it cheaper.** Hashing the headers is the
//! part that makes this a cache rather than a bug.
//!
//! The bytes hashed are the ones in the check's own directory -- what the
//! *binary* wrote there from its `include_str!` copy of the runtime, never
//! `runtime/c` on disk. Two binaries that differ only in their runtime C
//! therefore never share an object; were they keyed by path or by the tree,
//! a peer's runtime change would be cached away and an `rc` arm would pass
//! for the wrong reason, silently.
//!
//! Conditional inclusion is not evaluated: a header behind an `#if` is in the
//! key whether or not the compile read it, which can only make a miss more
//! likely. System headers (`<...>`) are covered by the compiler's identity and
//! nothing else, which is the same trust the build already places in them.
//!
//! # Concurrency and storage
//!
//! An object is compiled into the cache directory under a name private to this
//! process and renamed onto its key, so eight workers missing on one key at
//! once each produce a whole object and the last rename wins with identical
//! bytes. Never through the temporary directory: that is often a different
//! filesystem, and a rename across one fails.
//!
//! `NTS_DIFF_OBJECT_CACHE` names the directory; the default is
//! `$XDG_CACHE_HOME/nts/differential-objects`, else `~/.cache/...`.
//! `NTS_DIFF_NO_OBJECT_CACHE=1` compiles every object afresh, into the check's
//! own directory, which is the arm to run when this module is the suspect.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use xxhash_rust::xxh3::Xxh3;

/// Beyond this many objects, a miss removes those unused for a week. Each is
/// about a megabyte, and every runtime edit makes a new set.
const KEEP: usize = 512;
const WEEK: std::time::Duration = std::time::Duration::from_hours(7 * 24);
/// Names each partial object this process writes apart from the others.
static PARTIALS: AtomicU64 = AtomicU64::new(0);

/// Compile `source` with `flags` (each `-I` directory as its own `-I`, `dir`
/// pair) and return the object file: the cached one when an identical compile
/// already ran, else a fresh one, cached for the next check.
///
/// # Errors
///
/// If clang cannot run, or rejects the source; the message is clang's.
pub(crate) fn object(
    source: &Utf8Path,
    flags: &[&str],
    includes: &[&Utf8Path],
    scratch: &Utf8Path,
) -> Result<Utf8PathBuf> {
    let Some(cache) = cache_dir() else {
        let object = scratch.join(format!("{}.o", source.file_name().unwrap_or("source")));
        compile(source, flags, includes, &object)?;
        return Ok(object);
    };
    let object = cache.join(format!("{:032x}.o", key(source, flags, includes)?));
    if object.exists() {
        // Marked used, for `prune`; a failure only makes it look older.
        let _ = std::fs::File::options()
            .write(true)
            .open(&object)
            .and_then(|file| file.set_modified(std::time::SystemTime::now()));
        return Ok(object);
    }
    std::fs::create_dir_all(&cache).with_context(|| format!("creating {cache}"))?;
    let partial = cache.join(format!(
        "{}.{}.{}.partial.o",
        object.file_stem().unwrap_or("object"),
        std::process::id(),
        PARTIALS.fetch_add(1, Ordering::Relaxed)
    ));
    compile(source, flags, includes, &partial)?;
    std::fs::rename(&partial, &object)
        .with_context(|| format!("renaming {partial} to {object}"))?;
    prune(&cache);
    Ok(object)
}

fn compile(
    source: &Utf8Path,
    flags: &[&str],
    includes: &[&Utf8Path],
    object: &Utf8Path,
) -> Result<()> {
    let mut command = std::process::Command::new("clang");
    command.args(flags);
    for dir in includes {
        command.arg("-I").arg(dir);
    }
    let build = command
        .arg("-c")
        .arg(source)
        .arg("-o")
        .arg(object)
        .output()
        .context("running clang")?;
    if !build.status.success() {
        let _ = std::fs::remove_file(object);
        bail!("clang: {}", String::from_utf8_lossy(&build.stderr));
    }
    Ok(())
}

fn cache_dir() -> Option<Utf8PathBuf> {
    if std::env::var("NTS_DIFF_NO_OBJECT_CACHE").is_ok_and(|value| value != "0") {
        return None;
    }
    if let Ok(named) = std::env::var("NTS_DIFF_OBJECT_CACHE") {
        return Some(Utf8PathBuf::from(named));
    }
    let base = std::env::var("XDG_CACHE_HOME")
        .ok()
        .filter(|dir| !dir.is_empty())
        .map(Utf8PathBuf::from)
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|home| Utf8PathBuf::from(home).join(".cache"))
        })?;
    Some(base.join("nts/differential-objects"))
}

/// `clang --version` and the path it resolved from, asked once per process.
fn compiler_identity() -> Result<&'static str> {
    static IDENTITY: OnceLock<Option<String>> = OnceLock::new();
    IDENTITY
        .get_or_init(|| {
            let run = std::process::Command::new("clang")
                .arg("--version")
                .output()
                .ok()?;
            run.status
                .success()
                .then(|| String::from_utf8_lossy(&run.stdout).into_owned())
        })
        .as_deref()
        .context("running `clang --version`")
}

/// Everything the compile of `source` reads, hashed. See the module header.
fn key(source: &Utf8Path, flags: &[&str], includes: &[&Utf8Path]) -> Result<u128> {
    let mut hash = Xxh3::new();
    let mut field = |bytes: &[u8]| {
        hash.update(&(bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    };
    field(compiler_identity()?.as_bytes());
    for flag in flags {
        field(flag.as_bytes());
    }
    field(b"--");
    let mut seen = std::collections::HashSet::new();
    // Named by its file name, never its path: every check builds in a
    // directory of its own, and a key holding that path never hits. The
    // first version did, and a full run left 1,392 objects and no speedup.
    let mut pending = vec![(
        source.file_name().unwrap_or_default().to_owned(),
        Some(source.to_owned()),
    )];
    // Depth-first in include order, so the stream is deterministic.
    while let Some((name, path)) = pending.pop() {
        field(name.as_bytes());
        let Some(path) = path else {
            field(b"\0absent");
            continue;
        };
        if !seen.insert(path.clone()) {
            field(b"\0seen");
            continue;
        }
        let text = std::fs::read(&path).with_context(|| format!("reading {path}"))?;
        field(&text);
        let here = path.parent().unwrap_or(Utf8Path::new("."));
        let named = quoted_includes(&String::from_utf8_lossy(&text));
        for included in named.into_iter().rev() {
            let found = std::iter::once(here)
                .chain(includes.iter().copied())
                .map(|dir| dir.join(&included))
                .find(|candidate| candidate.is_file());
            pending.push((included, found));
        }
    }
    Ok(hash.digest128())
}

/// The names in a file's `#include "..."` lines, in order.
fn quoted_includes(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let rest = line
                .trim_start()
                .strip_prefix('#')?
                .trim_start()
                .strip_prefix("include")?;
            let rest = rest.trim_start().strip_prefix('"')?;
            Some(rest[..rest.find('"')?].to_owned())
        })
        .collect()
}

/// When the cache holds more than [`KEEP`] objects, remove those unused for a
/// week, and any partial object a killed run left behind for as long.
fn prune(cache: &Utf8Path) {
    let Ok(entries) = std::fs::read_dir(cache) else {
        return;
    };
    let entries: Vec<_> = entries.filter_map(Result::ok).collect();
    if entries.len() <= KEEP {
        return;
    }
    let now = std::time::SystemTime::now();
    for entry in entries {
        let stale = entry
            .metadata()
            .and_then(|data| data.modified())
            .is_ok_and(|at| now.duration_since(at).is_ok_and(|age| age > WEEK));
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{key, quoted_includes};
    use camino::Utf8PathBuf;

    #[test]
    fn includes_are_read_as_the_preprocessor_reads_them() {
        let text = "#include \"a.h\"\n  #  include \"quickjs/dtoa.c\"\n#include <stdio.h>\n// #include \"no.h\"\n#define include \"x\"\n";
        assert_eq!(quoted_includes(text), ["a.h", "quickjs/dtoa.c"]);
    }

    /// The failure this key exists to prevent: a header changes, the source
    /// does not, and a stale object is handed back.
    /// The failure on the other side: a key that never hits passes every
    /// test of correctness. Each check builds in a fresh directory.
    #[test]
    fn the_same_files_in_another_directory_have_the_same_key() {
        let scratch = |name: &str| {
            let dir = std::env::temp_dir()
                .join(format!("nts-objects-same-{name}-{}", std::process::id()));
            let dir = Utf8PathBuf::from_path_buf(dir).expect("utf-8 temp dir");
            std::fs::create_dir_all(&dir).expect("temp dir");
            std::fs::write(dir.join("r.h"), "#define R 1\n").expect("temp file");
            std::fs::write(
                dir.join("r.c"),
                "#include \"r.h\"\nint r(void) { return R; }\n",
            )
            .expect("temp file");
            dir
        };
        let (one, two) = (scratch("one"), scratch("two"));
        let keys = (
            key(&one.join("r.c"), &["-O1"], &[&one]),
            key(&two.join("r.c"), &["-O1"], &[&two]),
        );
        std::fs::remove_dir_all(&one).expect("temp dir");
        std::fs::remove_dir_all(&two).expect("temp dir");
        if let (Ok(first), Ok(second)) = keys {
            assert_eq!(
                first, second,
                "a check in another directory would never hit"
            );
        }
    }

    #[test]
    fn a_header_two_levels_down_changes_the_key() {
        let dir = std::env::temp_dir().join(format!("nts-objects-key-{}", std::process::id()));
        let dir = Utf8PathBuf::from_path_buf(dir).expect("utf-8 temp dir");
        std::fs::create_dir_all(dir.join("sub")).expect("temp dir");
        let include = dir.join("inc");
        std::fs::create_dir_all(&include).expect("temp dir");
        std::fs::write(
            dir.join("main.c"),
            "#include \"sub/a.h\"\nint main(void) { return B; }\n",
        )
        .expect("temp file");
        std::fs::write(dir.join("sub/a.h"), "#include \"b.h\"\n").expect("temp file");
        std::fs::write(include.join("b.h"), "#define B 1\n").expect("temp file");
        let source = dir.join("main.c");
        let flags = ["-O1"];
        let Ok(first) = key(&source, &flags, &[&include]) else {
            // No clang here: the cache is never used without one, so there is
            // nothing to key.
            std::fs::remove_dir_all(&dir).expect("temp file");
            return;
        };
        assert_eq!(
            key(&source, &flags, &[&include]).expect("key"),
            first,
            "the key is not deterministic"
        );
        std::fs::write(include.join("b.h"), "#define B 2\n").expect("temp file");
        let changed = key(&source, &flags, &[&include]).expect("key");
        assert_ne!(
            changed, first,
            "a header reached through `-I` from an included header changed and the key did not"
        );
        assert_ne!(
            key(&source, &["-O1", "-DNTS_PROVIDER_RC"], &[&include]).expect("key"),
            changed,
            "a define is not in the key"
        );
        // The runtime reaches clang as bytes a binary wrote from its own copy,
        // at the same path for every binary: the path must not be the key.
        std::fs::write(
            &source,
            "#include \"sub/a.h\"\nint main(void) { return B + 1; }\n",
        )
        .expect("temp file");
        let rewritten = key(&source, &flags, &[&include]).expect("key");
        assert_ne!(
            rewritten, changed,
            "the same path with different bytes kept its key"
        );
        std::fs::remove_file(include.join("b.h")).expect("temp file");
        assert_ne!(
            key(&source, &flags, &[&include]).expect("key"),
            rewritten,
            "a header that disappeared kept its key"
        );
        std::fs::remove_dir_all(&dir).expect("temp file");
    }
}

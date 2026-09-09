//! The TypeScript frontend.
//!
//! Owns the boundary RFC §7.1 draws: everything that knows what a TypeScript
//! checker is lives here, and nothing downstream of [`nts_semantic_schema`] does.
//!
//! The semantic authority is `tsgo` — the Go implementation of TypeScript, pinned
//! by [`tsgo::PINNED_TSGO`]. We speak its API protocol over a pipe rather than
//! linking it, so the checker's memory, GC, and crashes stay in another process.

pub mod cache;
pub mod source;
pub mod tsgo;

pub use source::{FrontendStats, SemanticSource};
pub use tsgo::TsgoApi;

/// The source files a project named as its roots, as `SourceFile::uri`.
///
/// TypeScript's `files` array is the only place a project says which modules
/// *are* the product, as opposed to which are in the program. `include` says
/// the second and is what every tsconfig here used until it turned out the
/// difference matters: `hir::lower::public_api` has to know where a module's
/// public surface starts, and with no roots named it falls back to inferring
/// one from the import graph, which cannot be done correctly. `fs` lost all 303
/// of its exports to that fallback, silently, because a module in its own cone
/// imports its entry back.
///
/// # Why this takes the snapshot rather than composing a URI
///
/// The obvious version formats `nts-workspace:///{file}` and hands that over,
/// and it matched nothing. `SourceFile::uri` is `workspace_uri(cwd, path)`,
/// which strips the tsconfig's directory off an absolute path from tsgo -- and
/// `cwd` is `tsconfig.parent()`, so it is *relative* whenever the tsconfig
/// argument was. `strip_prefix` then fails, `unwrap_or(path)` keeps the whole
/// thing, and every URI in the snapshot reads
/// `nts-workspace:////home/someone/proj/src/main.ts`. A composed URI is a
/// guess about a normalization that does not always happen.
///
/// So the match is made here, where both halves are in hand, and what goes back
/// is whatever string that source actually carries. Callers compare it for
/// equality and need to know nothing about how it was spelled.
///
/// Canonical paths for the comparison itself, because the two sides genuinely
/// differ: `files` is relative to the tsconfig and tsgo's paths are absolute,
/// and `../..` appears in both. A file that cannot be canonicalized -- named
/// but absent -- matches nothing, which is the same outcome as not naming it.
///
/// An empty vector for a project with no `files`, a malformed one, or one that
/// cannot be read. All three mean the same thing to the caller: nothing was
/// named, so nothing can be concluded from the tsconfig and the import graph is
/// all there is. `extends` is deliberately not followed: a `files` array is
/// relative to the tsconfig holding it, so one inherited from a shared base
/// would name paths relative to the base's directory and be wrong for every
/// project that inherited it.
#[must_use]
pub fn entry_uris(
    tsconfig: &camino::Utf8Path,
    snapshot: &nts_semantic_schema::SemanticSnapshot,
) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(tsconfig) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    let directory = tsconfig
        .parent()
        .unwrap_or_else(|| camino::Utf8Path::new("."));
    let named: Vec<std::path::PathBuf> = parsed
        .get("files")
        .and_then(serde_json::Value::as_array)
        .map(|files| {
            files
                .iter()
                .filter_map(serde_json::Value::as_str)
                .filter_map(|file| std::fs::canonicalize(directory.join(file)).ok())
                .collect()
        })
        .unwrap_or_default();
    if named.is_empty() {
        return Vec::new();
    }
    snapshot
        .sources
        .iter()
        .filter(|source| {
            std::fs::canonicalize(&source.display_path)
                .is_ok_and(|at| named.contains(&at))
        })
        .map(|source| source.uri.clone())
        .collect()
}

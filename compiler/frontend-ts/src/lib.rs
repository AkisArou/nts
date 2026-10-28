//! The TypeScript frontend.
//!
//! Owns the boundary between TypeScript and the compiler: everything that knows
//! what a TypeScript checker is lives here, and nothing downstream of
//! [`nts_semantic_schema`] does.
//!
//! The native TypeScript checker is linked in process. The builder owns every
//! snapshot fact before returning across its scoped session boundary.

mod annotations;
mod bindings;
mod capture;
mod declaration;
mod early_errors;
mod frontend;
pub mod generated;
mod inclusion;
mod link;
mod native_ast;
pub mod native_syntax;
pub mod provided;
pub mod source;
pub mod transform;
mod tree;

pub use frontend::Frontend;
pub use source::FrontendStats;
pub use tree::SyntaxTree;

include!(concat!(env!("OUT_DIR"), "/frontend_stamp.rs"));

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
/// and it matched nothing. `SourceFile::uri` is relative to the requested
/// config's directory, including `..` for imported sources outside it. Callers
/// may supply absolute paths or paths relative to another working directory;
/// composing a URI from that spelling would guess at the source identity.
///
/// So the match is made here, where both halves are in hand, and what goes back
/// is whatever string that source actually carries. Callers compare it for
/// equality and need to know nothing about how it was spelled.
///
/// Canonical paths for the comparison itself, because the two sides genuinely
/// differ: `files` is relative to the tsconfig and checker paths are absolute,
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
    match_sources(&named, snapshot)
}

/// The same match, for entry files a caller names directly.
///
/// A build configuration names its product's `entry`, which is the same claim a
/// tsconfig's `files` array makes and is made by the side that knows what is
/// being built. Both go through one matcher, because the matching is the part
/// with the subtlety -- see the note above on why a URI cannot be composed --
/// and two copies of it would be two chances to get that wrong.
#[must_use]
pub fn entry_uris_for(
    paths: &[camino::Utf8PathBuf],
    snapshot: &nts_semantic_schema::SemanticSnapshot,
) -> Vec<String> {
    let named: Vec<std::path::PathBuf> = paths
        .iter()
        .filter_map(|path| std::fs::canonicalize(path).ok())
        .collect();
    if named.is_empty() {
        return Vec::new();
    }
    match_sources(&named, snapshot)
}

fn match_sources(
    named: &[std::path::PathBuf],
    snapshot: &nts_semantic_schema::SemanticSnapshot,
) -> Vec<String> {
    snapshot
        .sources
        .iter()
        .filter(|source| {
            std::fs::canonicalize(&source.display_path).is_ok_and(|at| named.contains(&at))
        })
        .map(|source| source.uri.clone())
        .collect()
}

//! Symbol resolution and module exports.
//!
//! # Why this is not optional
//!
//! Without symbols a snapshot is a tree, not a program. Nothing says that the
//! `a` declared as a parameter and the `a` used in `a + b` are the same binding,
//! and every lowering needs that before it can do anything at all.
//!
//! # Cost
//!
//! `getSymbolsAtLocations` batches, exactly like `getTypeAtLocations`, so this
//! costs one exchange per file. Module exports cost one more. The frontend stays
//! linear in files — see [`docs/records/0001`] — which is the property that made
//! the transport viable and is worth not spending casually.
//!
//! [`docs/records/0001`]: https://github.com/AkisArou/nts/blob/main/docs/records/0001-frontend-transport-cost.md

use nts_diagnostics::SourceId;
use nts_semantic_schema::{
    ModuleRecord, NodeId, NodeKind, SemanticSnapshot, SymbolFlags, SymbolId, SymbolRecord,
};
use rustc_hash::FxHashMap;

use super::proto::{NodeHandle, ProjectHandle, SnapshotHandle, SymbolResponse};
use super::types::node_handle;
use super::{Client, TsgoError};

/// `ast.SymbolFlags`, from tsgo. Only the bits mapped into the schema are named.
mod bits {
    #![allow(unreachable_pub)]

    pub const VARIABLE: u32 = 1 << 0 | 1 << 1; // FunctionScopedVariable | BlockScopedVariable
    pub const PROPERTY: u32 = 1 << 2;
    pub const FUNCTION: u32 = 1 << 4;
    pub const CLASS: u32 = 1 << 5;
    pub const INTERFACE: u32 = 1 << 6;
    pub const ENUM: u32 = 1 << 7 | 1 << 8; // ConstEnum | RegularEnum
    pub const METHOD: u32 = 1 << 13;
    pub const TYPE_ALIAS: u32 = 1 << 19;
    pub const MODULE: u32 = 1 << 10 | 1 << 11; // ValueModule | NamespaceModule
}

fn schema_flags(raw: u32) -> SymbolFlags {
    let mut flags = SymbolFlags::default();
    for (bit, mapped) in [
        (bits::VARIABLE, SymbolFlags::VARIABLE),
        (bits::PROPERTY, SymbolFlags::PROPERTY),
        (bits::FUNCTION, SymbolFlags::FUNCTION),
        (bits::CLASS, SymbolFlags::CLASS),
        (bits::INTERFACE, SymbolFlags::INTERFACE),
        (bits::ENUM, SymbolFlags::ENUM),
        (bits::METHOD, SymbolFlags::METHOD),
        (bits::TYPE_ALIAS, SymbolFlags::TYPE_ALIAS),
        (bits::MODULE, SymbolFlags::MODULE),
    ] {
        if raw & bit != 0 {
            flags = flags.union(mapped);
        }
    }
    flags
}

/// Parse the node index back out of a handle.
///
/// Handles are `"{index}.{kind}.{path}"`. Only the index is needed here, and only
/// for handles naming a file already decoded — a declaration in another file is
/// dropped rather than mapped to a wrong node in this one.
fn declaration_index(handle: &NodeHandle, path: &str) -> Option<u32> {
    let rest = handle.0.strip_suffix(path)?.strip_suffix('.')?;
    let (index, _kind) = rest.split_once('.')?;
    index.parse::<u32>().ok()
}

/// Everything a per-file pass needs to address one file in a live session.
///
/// Bundled rather than threaded: the same six values are needed by symbol
/// resolution and by type resolution, and passing them separately made both
/// signatures long enough to hide a transposed argument.
#[derive(Debug, Clone, Copy)]
pub struct FileContext<'a> {
    /// The server-side program snapshot being read.
    pub handle: SnapshotHandle,
    pub project: &'a ProjectHandle,
    /// Workspace root, for stripping machine paths out of names.
    pub root: &'a camino::Utf8Path,
    /// Absolute path of the file, as tsgo knows it.
    pub path: &'a camino::Utf8Path,
    /// Where this file's nodes begin in the shared arena.
    pub base: u32,
    pub file: SourceId,
}

/// Resolve symbols for one file's nodes and record its exports.
#[allow(clippy::implicit_hasher)]
pub fn resolve(
    client: &mut Client,
    snapshot: &mut SemanticSnapshot,
    interned: &mut FxHashMap<u32, SymbolId>,
    ctx: FileContext<'_>,
) -> Result<(), TsgoError> {
    let FileContext {
        handle,
        project,
        root,
        path,
        base,
        file,
    } = ctx;
    let path = path.as_str();

    // Same filter as type resolution: a NodeList has no `*ast.Node`, so its
    // handle fails to resolve and one failure loses the whole batch.
    let addressable: Vec<(NodeId, NodeHandle)> = snapshot
        .nodes
        .iter()
        .enumerate()
        .skip(base as usize)
        .filter_map(|(index, node)| {
            let NodeKind::Syntax(kind) = node.kind else {
                return None;
            };
            let arena = u32::try_from(index).unwrap_or(u32::MAX);
            Some((
                NodeId(arena),
                NodeHandle(node_handle(arena - base + 1, kind, path)),
            ))
        })
        .collect();

    let handles = addressable.iter().map(|(_, h)| h.clone()).collect();
    let responses = client.symbols_at(handle, project, handles)?;

    let mut module_symbol = None;
    for ((node, _), response) in addressable.iter().zip(&responses) {
        let Some(response) = response else { continue };
        let id = intern(snapshot, interned, response, root, path, base, file);
        snapshot.nodes[node.0 as usize].symbol = Some(id);

        // The SourceFile node's symbol is the module symbol — present for a
        // module, absent for a plain script.
        if node.0 == base && snapshot.nodes[node.0 as usize].kind != NodeKind::List {
            module_symbol = Some(response.id);
        }
    }

    let exports = match module_symbol {
        Some(symbol) => client
            .exports_of_module(handle, project, symbol)?
            .iter()
            .map(|export| {
                let id = intern(snapshot, interned, export, root, path, base, file);
                (export.name.clone(), id)
            })
            .collect(),
        // A script exports nothing. That is a fact about the file, not a failure.
        None => Vec::new(),
    };

    snapshot.modules.push(ModuleRecord {
        file,
        imports: Vec::new(),
        exports,
        root: NodeId(base),
    });

    Ok(())
}

/// Intern one symbol response into the arena.
fn intern(
    snapshot: &mut SemanticSnapshot,
    interned: &mut FxHashMap<u32, SymbolId>,
    response: &SymbolResponse,
    root: &camino::Utf8Path,
    path: &str,
    base: u32,
    _file: SourceId,
) -> SymbolId {
    // FxHashMap rather than a generic hasher: this map is hit once per node in a
    // program, and the point of choosing it is lost if a caller can substitute a
    // cryptographic one.
    if let Some(&existing) = interned.get(&response.id) {
        return existing;
    }

    let declarations = response
        .declarations
        .iter()
        .filter_map(|handle| declaration_index(handle, path))
        // Shift past the nil sentinel and onto the shared arena, the same way the
        // AST decoder does. A declaration in another file yields no index here.
        .filter_map(|index| index.checked_sub(1).map(|i| i + base))
        .filter(|index| (*index as usize) < snapshot.nodes.len())
        .map(NodeId)
        .collect();

    let id = SymbolId(u32::try_from(snapshot.symbols.len()).unwrap_or(u32::MAX));
    snapshot.symbols.push(SymbolRecord {
        name: normalize_name(&response.name, root),
        flags: schema_flags(response.flags),
        declarations,
        // Left unresolved: a symbol's type is reachable from its declaration
        // node through `node_types`, so asking for it again would be a round trip
        // for something the snapshot already knows.
        ty: None,
    });
    interned.insert(response.id, id);
    id
}

/// Strip an absolute workspace path out of a symbol name.
///
/// A module's own symbol is named by its path, so `/home/someone/proj/src/main`
/// would otherwise land in the snapshot and from there in every artifact derived
/// from it. RFC §20.4 forbids that for sources; a symbol name is no different.
fn normalize_name(name: &str, root: &camino::Utf8Path) -> String {
    let unquoted = name.trim_matches('"');
    match unquoted.strip_prefix(root.as_str()) {
        Some(relative) => format!("nts-workspace://{relative}"),
        None => name.to_owned(),
    }
}

/// Number of modules recorded so far, for the caller's stats.
#[must_use]
pub fn module_count(snapshot: &SemanticSnapshot) -> u32 {
    u32::try_from(snapshot.modules.len()).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_declaration_handle_yields_its_index() {
        let handle = NodeHandle("12.79./w/a.ts".to_owned());
        assert_eq!(declaration_index(&handle, "/w/a.ts"), Some(12));
    }

    #[test]
    fn a_handle_from_another_file_is_declined() {
        // Returning the raw index would map a declaration in `b.ts` onto whatever
        // node happens to sit at that index in `a.ts` — a wrong answer that looks
        // exactly like a right one.
        let handle = NodeHandle("12.79./w/b.ts".to_owned());
        assert_eq!(declaration_index(&handle, "/w/a.ts"), None);
    }

    #[test]
    fn a_path_containing_dots_still_parses() {
        let handle = NodeHandle("3.263./w/my.module.spec.ts".to_owned());
        assert_eq!(declaration_index(&handle, "/w/my.module.spec.ts"), Some(3));
    }

    #[test]
    fn a_module_symbol_name_is_remapped_off_the_machine() {
        let root = camino::Utf8Path::new("/home/someone/proj");
        assert_eq!(
            normalize_name("\"/home/someone/proj/src/main\"", root),
            "nts-workspace:///src/main",
        );
    }

    #[test]
    fn an_ordinary_symbol_name_is_left_alone() {
        let root = camino::Utf8Path::new("/home/someone/proj");
        assert_eq!(normalize_name("Point", root), "Point");
    }

    #[test]
    fn symbol_flags_map_onto_the_schema() {
        assert!(schema_flags(bits::FUNCTION).contains(SymbolFlags::FUNCTION));
        assert!(schema_flags(bits::INTERFACE).contains(SymbolFlags::INTERFACE));
        // TypeScript merges kinds; so must the mapping.
        let merged = schema_flags(bits::CLASS | bits::INTERFACE);
        assert!(merged.contains(SymbolFlags::CLASS));
        assert!(merged.contains(SymbolFlags::INTERFACE));
    }

    #[test]
    fn unmapped_flags_produce_no_kind_rather_than_a_wrong_one() {
        assert_eq!(schema_flags(1 << 30), SymbolFlags::default());
    }
}

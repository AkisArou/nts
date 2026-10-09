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
    /// `ast.SymbolFlagsValueModule` and `NamespaceModule`, `symbolflags.go:18-19`.
    ///
    /// Was `1 << 10 | 1 << 11`, which is `NamespaceModule | TypeLiteral`: an
    /// instantiated module did not answer to this, and every type literal did.
    pub const MODULE: u32 = 1 << 9 | 1 << 10;
    /// `ast.SymbolFlagsAlias`, `symbolflags.go:30`. Not mapped into the schema
    /// -- it is asked here and answered here -- but load-bearing: tsgo's
    /// `getAliasedSymbol` *panics* on a symbol that is not one ("Should only
    /// get alias here"), so this is the test that has to happen first.
    pub const ALIAS: u32 = 1 << 21;
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

/// Declaration handles that pointed into a file this pass had not decoded yet.
///
/// **A dropped handle is not the same as "no declaration", and `declaration_index`
/// cannot tell them apart.** It keeps a handle only when the handle's path is
/// *this* file, because the per-file loop in `mod.rs` decodes, interns and
/// resolves one file at a time: when `main.ts` is the first file to mention a
/// symbol declared in `thrower.ts`, that file has no base in the arena yet and
/// there is nothing to map the handle onto.
///
/// `intern_declared` fills such a record in later, from whichever file *does*
/// hold the declaration -- and that is enough only while something in the
/// declaring file asks the checker for the same symbol. A class member is where
/// it is not: a method is not an export, so the export walk never names it, and
/// nothing else in its own file need mention it at all. The checker is then free
/// to answer an importing file with a *second* symbol for the same method (it
/// does, for one whose signature it has to instantiate -- a parameter typed
/// `number | null` is enough), and that second symbol keeps an empty
/// declarations list for the whole compilation.
///
/// What that cost, before this existed: `throwing_symbols` finds a function's
/// `throw`s by walking its symbol's declarations, so the method's body was never
/// looked at, `calls_compiled_code` answered "cannot raise" for a call to it, and
/// a `try` around that call was **dropped** -- no handler edge, no diagnostic,
/// the exception abandoning the program. The React lane reduced it to two files
/// and eleven probes; `blockers/a-cross-module-throw-a-nullable-parameter-hides`
/// is the fixture.
///
/// Every file's base is known once the loop ends, which is where `attach` runs --
/// the same reason `link_modules` cannot run inside the loop either.
#[derive(Debug, Default)]
pub struct Deferred(FxHashMap<SymbolId, Vec<NodeHandle>>);

impl Deferred {
    /// Remember the handles one file could not map for a symbol: every
    /// declaration of it in another file. Each is kept once, however many
    /// files decline it.
    fn remember(&mut self, symbol: SymbolId, handles: Vec<NodeHandle>) {
        let kept = self.0.entry(symbol).or_default();
        for handle in handles {
            if !kept.contains(&handle) {
                kept.push(handle);
            }
        }
    }

    /// Map what was declined, now that every file has a base, adding each
    /// declaration a record does not have yet.
    ///
    /// **A record with declarations is not a complete one.** One symbol can be
    /// declared in two files -- a class and an interface merging into it, a
    /// module augmented from another file, a namespace in two -- and this
    /// filled only an empty record, on the rule that two files cannot hold the
    /// declarations of one symbol. That rule was false: `objc:Foundation`'s
    /// class `NSString` extended by `AppKit`'s `interface NSString` kept only the
    /// interface, and the class was then refused as unrepresentable. Adding a
    /// declaration already present changes nothing, so attaching twice is
    /// harmless.
    #[allow(clippy::implicit_hasher)]
    pub fn attach(self, snapshot: &mut SemanticSnapshot, file_bases: &[(String, u32)]) {
        let nodes = snapshot.nodes.len();
        for (symbol, handles) in self.0 {
            let mapped: Vec<NodeId> = handles
                .iter()
                .filter_map(|handle| super::decompose::declaration_node(handle, file_bases))
                // The same bound the per-file mapping applies. A handle naming a
                // node past the end of the arena would otherwise index whatever
                // a later file put there, which is a wrong answer wearing the
                // shape of a right one.
                .filter(|node| (node.0 as usize) < nodes)
                .collect();
            if let Some(record) = snapshot.symbols.get_mut(symbol.0 as usize) {
                add_declarations(&mut record.declarations, mapped);
            }
        }
    }
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
    deferred: &mut Deferred,
    ctx: FileContext<'_>,
) -> Result<(), TsgoError> {
    let FileContext {
        handle,
        project,
        path,
        base,
        file,
        ..
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
            // And the node tsgo asserts nothing will ask about. Filtered here
            // rather than handled at the response, because the failure is a
            // *panic* -- there is no response to handle.
            if !super::types::tsgo_will_answer(&snapshot.nodes, index) {
                return None;
            }
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
    // An import specifier binds a symbol of its own, and every reference to the
    // imported name resolves to that one rather than to the declaration it
    // stands for. Collected here and resolved below in one pass: the same alias
    // is the symbol of every node that reads it, so resolving on sight would
    // ask the checker the same question once per reference.
    let mut aliases: Vec<(SymbolId, u32)> = Vec::new();
    for ((node, _), response) in addressable.iter().zip(&responses) {
        let Some(response) = response else { continue };
        let fresh = !interned.contains_key(&response.id);
        let id = intern(snapshot, interned, deferred, response, ctx);
        snapshot.nodes[node.0 as usize].symbol = Some(id);
        if fresh && response.flags & bits::ALIAS != 0 {
            aliases.push((id, response.id));
        }

        // The SourceFile node's symbol is the module symbol — present for a
        // module, absent for a plain script.
        if node.0 == base && snapshot.nodes[node.0 as usize].kind != NodeKind::List {
            module_symbol = Some(response.id);
        }
    }

    for (id, tsgo) in aliases {
        // Gated on the flag rather than tried and caught: `getAliasedSymbol`
        // panics on a symbol that is not an alias ("Should only get alias
        // here"), and a panic in the checker takes the whole snapshot.
        let Some(target) = client.aliased_symbol(handle, project, tsgo).ok().flatten() else {
            continue;
        };
        let target = intern(snapshot, interned, deferred, &target, ctx);
        // A symbol is not its own alias. `export { x }` with no `from` clause
        // is an alias whose target is the local declaration, and the two are
        // the same symbol -- following that would be a self-loop for any
        // consumer that walks the chain.
        if target != id {
            snapshot.symbols[id.0 as usize].aliased = Some(target);
        }
    }

    let exports = match module_symbol {
        Some(symbol) => exports_of(client, snapshot, interned, deferred, ctx, symbol)?,
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

/// What one module publishes, each name resolved to the symbol it stands for.
#[allow(clippy::implicit_hasher)]
fn exports_of(
    client: &mut Client,
    snapshot: &mut SemanticSnapshot,
    interned: &mut FxHashMap<u32, SymbolId>,
    deferred: &mut Deferred,
    ctx: FileContext<'_>,
    module: u32,
) -> Result<Vec<(String, SymbolId)>, TsgoError> {
    Ok(client
        .exports_of_module(ctx.handle, ctx.project, module)?
        .iter()
        .map(|export| {
            // A re-export yields an *alias* symbol declared at the
            // re-export site, which says nothing about where the thing came
            // from. `export { two } from "./base.js"` has to resolve to
            // `base.ts`'s `two` or the export list names a symbol with no
            // declaration anyone can use -- and `node:path` is nothing but
            // `export *` and `export * as`, so this is the flagship module
            // rather than an edge case.
            //
            // The exported *name* is unchanged: `export { two as pair }`
            // publishes `pair` and resolves to `two`.
            let declaring = if export.flags & bits::ALIAS == 0 {
                None
            } else {
                client
                    .aliased_symbol(ctx.handle, ctx.project, export.id)
                    .ok()
                    .flatten()
            };
            let target = declaring.as_ref().unwrap_or(export);
            let id = intern(snapshot, interned, deferred, target, ctx);
            (super::decompose::written_name(&export.name).to_owned(), id)
        })
        .collect())
}

/// Intern one symbol response into the arena.
fn intern(
    snapshot: &mut SemanticSnapshot,
    interned: &mut FxHashMap<u32, SymbolId>,
    deferred: &mut Deferred,
    response: &SymbolResponse,
    ctx: FileContext<'_>,
) -> SymbolId {
    let (root, path, base) = (ctx.root, ctx.path.as_str(), ctx.base);
    let declarations: Vec<NodeId> = response
        .declarations
        .iter()
        .filter_map(|handle| declaration_index(handle, path))
        // Shift past the nil sentinel and onto the shared arena, the same way the
        // AST decoder does. A declaration in another file yields no index here.
        .filter_map(|index| index.checked_sub(1).map(|i| i + base))
        .filter(|index| (*index as usize) < snapshot.nodes.len())
        .map(NodeId)
        .collect();

    // Every declaration in another file, whether or not this file has some:
    // one symbol can be declared in several (see `Deferred::attach`).
    let declined: Vec<NodeHandle> = response
        .declarations
        .iter()
        .filter(|handle| declaration_index(handle, path).is_none())
        .cloned()
        .collect();

    let id = intern_declared(snapshot, interned, response, root, declarations);
    if !declined.is_empty() {
        deferred.remember(id, declined);
    }
    id
}

/// Add `more` to a symbol's declarations: each once, in node order, which is
/// the order of the files and of the declarations in each -- stable however
/// the files were visited.
fn add_declarations(declarations: &mut Vec<NodeId>, more: Vec<NodeId>) {
    let before = declarations.len();
    for node in more {
        if !declarations.contains(&node) {
            declarations.push(node);
        }
    }
    if declarations.len() != before {
        declarations.sort_unstable_by_key(|node| node.0);
    }
}

/// Intern a symbol with declarations already mapped to the shared node arena.
/// Used for symbols discovered through types as well as through source nodes.
pub(super) fn intern_declared(
    snapshot: &mut SemanticSnapshot,
    interned: &mut FxHashMap<u32, SymbolId>,
    response: &SymbolResponse,
    root: &camino::Utf8Path,
    declarations: Vec<NodeId>,
) -> SymbolId {
    // FxHashMap rather than a generic hasher: this map is hit once per node in a
    // program, and the point of choosing it is lost if a caller can substitute a
    // cryptographic one.
    //
    // **Interning is first-come-first-served and the first comer may be a file
    // that only mentions the symbol.** `declaration_index` keeps the
    // declarations that are in *this* file, so a symbol first reached from an
    // importer was recorded with none, and the cache then handed that empty
    // record back when its own file was interned.
    //
    // The symbols that go wrong are therefore decided by module order, which is
    // why it looked like a property of particular classes. `Readable` is
    // declared in `stream/src/readable.ts` and first seen from `duplex.ts`, so
    // it had no declarations -- and `decompose`'s library boundary is
    // `is_ours`, which is exactly "does this symbol have any declarations".
    // Every member of `Readable` was refused as "a class this compiler has no
    // type for", 110 of them in `stream` alone, and 187 more classes were
    // refused for having a base that was.
    if let Some(&existing) = interned.get(&response.id) {
        // Add those this file holds: a symbol can be declared in several
        // files, so a record that has some may still lack this file's.
        if let Some(record) = snapshot.symbols.get_mut(existing.0 as usize) {
            add_declarations(&mut record.declarations, declarations);
        }
        return existing;
    }

    let id = SymbolId(u32::try_from(snapshot.symbols.len()).unwrap_or(u32::MAX));
    snapshot.symbols.push(SymbolRecord {
        name: normalize_name(&response.name, root),
        flags: schema_flags(response.flags),
        declarations,
        // Left unresolved: a symbol's type is reachable from its declaration
        // node through `node_types`, so asking for it again would be a round trip
        // for something the snapshot already knows.
        ty: None,
        // Filled by `resolve_aliases` once the whole file is interned. Not
        // here, because resolving needs the client and interning is also done
        // from the export walk, where the target is already in hand.
        aliased: None,
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
    // **The private-name counter first, because it is not reproducible.** A
    // private member is interned as `__#21@#encoding`: the number is there
    // because a file's private names share one symbol table and two classes may
    // both declare `#encoding`. tsgo assigns it in an order that varies between
    // runs, so the same field came back `__#21@#encoding` one run and
    // `__#1@#encoding` the next -- and `SemanticSnapshot::digest` serialises
    // every symbol, so the snapshot cache key changed on every build and the
    // cache **never hit**.
    //
    // Three measurements found it, each doing what the others could not. The
    // Apple lane saw it from outside, and their detail that *their own programs
    // were stable* is what made it tractable. The Assistant lane bounded the
    // population: unstable in exactly the 15 projects that include
    // web-platform's 70 files, stable in the 12 that include at most 4, and
    // stable across 595 examples and blockers -- `url` being mid-sized and
    // stable killed "it is a size effect" before anyone spent time on it. A
    // per-field digest probe then put it in `symbols` alone, every other field
    // byte-stable, and a per-record one in 436 of 19,207 records, each differing
    // only in this number.
    //
    // **`emit-c` is byte-identical across runs**, which is why nothing caught it:
    // a cache that never hits passes every correctness test.
    //
    // `written_name` is the normaliser `decompose` already applies to a *member*
    // name, and its doc states why this is safe in as many words: "a layout is
    // per type, so nothing downstream needs it and everything downstream is
    // looking for what the program wrote". Applying it here makes that true of
    // the record too, which also keeps the mangling out of diagnostics --
    // `lower.rs` records 16 `test/language` files once refused as ``  `name`,
    // which `__#1@#method` does not declare ``, a sentence naming the frontend's
    // mangling of the very declaration that answers the question.
    let name = super::decompose::written_name(name);
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
    fn a_private_members_mangled_counter_is_not_kept() {
        // tsgo numbers a file's private names in an order that varies between
        // runs, so keeping the number made the snapshot's digest -- and with it
        // the cache key -- change on every build. Two runs' spellings of one
        // field must normalise to one name.
        let root = camino::Utf8Path::new("/w");
        assert_eq!(normalize_name("__#21@#encoding", root), "#encoding");
        assert_eq!(normalize_name("__#1@#encoding", root), "#encoding");
        // And an ordinary name is untouched, including one that merely begins
        // with underscores or carries a number that is not the counter.
        assert_eq!(normalize_name("encoding", root), "encoding");
        assert_eq!(normalize_name("__proto__", root), "__proto__");
        // An escaped program name, which the checker interns with one more `_`,
        // and the checker's own names, which it does not.
        assert_eq!(normalize_name("___proto__", root), "__proto__");
        assert_eq!(normalize_name("___snapshot", root), "__snapshot");
        assert_eq!(normalize_name("____three", root), "___three");
        assert_eq!(normalize_name("__function", root), "__function");
        assert_eq!(normalize_name("__#notanumber@#x", root), "__#notanumber@#x");
    }

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

    /// Every constant in `bits`, against the pinned `ast.SymbolFlags`.
    ///
    /// Two derivations of one fact, made to disagree out loud. `MODULE` read
    /// `1 << 10 | 1 << 11` under a comment saying `ValueModule |
    /// NamespaceModule`, and the comment was the correct one: the constant
    /// computed `NamespaceModule | TypeLiteral`, so an instantiated module
    /// answered to nothing and *every type literal* answered to `MODULE`.
    ///
    /// Nothing local could catch that. Each constant is self-consistent, and
    /// the one cross-check available -- the comment -- is prose. Only the pin
    /// settles it, and the pin moves whenever the submodule does, which is
    /// exactly when a hand-copied bit goes stale without being touched.
    #[test]
    fn every_flag_matches_the_pinned_tsgo_source() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../third_party/typescript-go/internal/ast/symbolflags.go"
        );
        // Not skipped when absent: a check that passes because it could not run
        // is the failure this test exists to prevent.
        let source = std::fs::read_to_string(path).unwrap_or_else(|error| {
            panic!(
                "the pin is what this is checked against, and it did not read: {path}: {error}\n\
                 a fresh worktree has no submodules -- `git submodule update --init \
                 third_party/typescript-go`. Not skipped when absent, because a check \
                 that passes by not running is the failure this test exists to prevent."
            )
        });

        // `\tSymbolFlagsValueModule    SymbolFlags = 1 << 9  // Instantiated module`
        let mut shifts: FxHashMap<&str, u32> = FxHashMap::default();
        for line in source.lines() {
            let Some((name, rest)) = line.split_once(" SymbolFlags = 1 << ") else {
                continue;
            };
            let Some(name) = name.trim().strip_prefix("SymbolFlags") else {
                continue;
            };
            let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
            if let Ok(shift) = digits.parse::<u32>() {
                shifts.insert(name, shift);
            }
        }
        assert!(
            shifts.len() > 20,
            "parsed {} flags out of the pin, so the shape it is parsed with has moved",
            shifts.len()
        );

        let bit = |name: &str| -> u32 {
            let shift = shifts
                .get(name)
                .unwrap_or_else(|| panic!("`SymbolFlags{name}` is not in the pin any more"));
            1u32 << shift
        };

        assert_eq!(
            bits::VARIABLE,
            bit("FunctionScopedVariable") | bit("BlockScopedVariable")
        );
        assert_eq!(bits::PROPERTY, bit("Property"));
        assert_eq!(bits::FUNCTION, bit("Function"));
        assert_eq!(bits::CLASS, bit("Class"));
        assert_eq!(bits::INTERFACE, bit("Interface"));
        assert_eq!(bits::ENUM, bit("ConstEnum") | bit("RegularEnum"));
        assert_eq!(bits::METHOD, bit("Method"));
        assert_eq!(bits::TYPE_ALIAS, bit("TypeAlias"));
        assert_eq!(bits::MODULE, bit("ValueModule") | bit("NamespaceModule"));
        assert_eq!(bits::ALIAS, bit("Alias"));
    }
}

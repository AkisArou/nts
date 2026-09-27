//! Declaration reachability over a semantic snapshot.
//!
//! # What this answers
//!
//! Which declarations a product can actually reach from its roots, and therefore
//! which types are worth resolving in depth.
//!
//! # Why it exists now
//!
//! Every deep frontend pass — type decomposition, call resolution, constant
//! folding — costs round trips per item, with no batch form. Seeded with
//! everything, the type closure does not stop at the program: measured on a
//! single 180-node file, decomposition reached **5,773 distinct types** and
//! exhausted its budget, because `Promise<void>` and a class prototype pull the
//! standard library's type graph in transitively.
//!
//! Reachability is what gives that walk an edge to stop at.
//!
//! # Why it lives in the schema crate
//!
//! It is a pure query over a [`SemanticSnapshot`] and nothing else, and its
//! caller is the *frontend* — which produces the snapshot and must not depend
//! on the IR crate. It was written in `nts-core` and re-exported from there, so
//! nothing that used it has to change.
//!
//! # This is not the RFC §7 reachability
//!
//! RFC §7 places reachability in the HIR analysis block, over *operations*, for
//! dead-code elimination during lowering. This is coarser and earlier: it works
//! on declarations and needs no IR, because the question it answers — what should
//! the frontend bother resolving — has to be answered before there is an IR.
//! The two are complementary; this one does not replace it.

use crate::{NodeId, NodeKind, SemanticSnapshot, SymbolId, TypeId, syntax};
use rustc_hash::FxHashSet;

/// What a walk from a set of roots reached.
#[derive(Debug, Clone, Default)]
pub struct Reachability {
    /// Nodes reachable from the roots.
    pub nodes: FxHashSet<NodeId>,
    /// Symbols named by a reachable node.
    pub symbols: FxHashSet<SymbolId>,
    /// Types of reachable nodes — the seed set for deep resolution.
    pub types: FxHashSet<TypeId>,
}

impl Reachability {
    /// Whether a node was reached.
    #[must_use]
    pub fn contains(&self, node: NodeId) -> bool {
        self.nodes.contains(&node)
    }

    /// Reachable types, as a seed set for the frontend's deep passes.
    #[must_use]
    pub fn seeds(&self) -> Vec<TypeId> {
        let mut seeds: Vec<TypeId> = self.types.iter().copied().collect();
        // Sorted so a build is reproducible: the walk uses hash sets, and an
        // unordered seed list would make cache keys differ run to run.
        seeds.sort_unstable();
        seeds
    }
}

/// Walk outward from every exported declaration.
///
/// The right roots for a library product: RFC §27.1 makes a shared library's
/// exports its public surface, so anything not reachable from them cannot be
/// called from outside and need not be resolved.
#[must_use]
pub fn from_exports(snapshot: &SemanticSnapshot) -> Reachability {
    let roots = snapshot
        .modules
        .iter()
        .flat_map(|module| module.exports.iter().map(|(_, symbol)| *symbol));
    from_symbols(snapshot, roots)
}

/// The roots the *frontend* must use: every export, plus every module's
/// top-level statements.
///
/// [`from_exports`] alone is the right answer for a library's public surface
/// and the wrong one for seeding the frontend, because module evaluation is
/// reachable from nothing. A program whose entry module exports nothing at all
/// is legal — an executable is exactly that — and seeding from its exports
/// would decompose no types, leaving every construct in it unrepresentable.
///
/// Statements only. Seeding the module's *root* would reach every node in the
/// file including the declarations already covered, which is the "seed with
/// everything" this exists to replace.
///
/// **Modules with code only.** A declaration file evaluates nothing and
/// exports nothing a product publishes: what it declares matters where code
/// names it, and is reached from there. Rooting at one reached all of it --
/// a platform package's `declare module "objc:AppKit"` is one statement
/// holding the whole framework -- and seeded 40,665 types for a program that
/// touches a few dozen.
#[must_use]
pub fn for_frontend(snapshot: &SemanticSnapshot) -> Reachability {
    let with_code = || {
        snapshot.modules.iter().filter(|module| {
            snapshot
                .sources
                .get(module.file.0 as usize)
                .is_none_or(|source| !is_declaration_file(&source.uri))
        })
    };
    let exports = with_code().flat_map(|module| module.exports.iter().map(|(_, symbol)| *symbol));
    let statements = with_code().flat_map(|module| {
        snapshot
            .nodes
            .get(module.root.0 as usize)
            .into_iter()
            .flat_map(|root| root.children.iter().copied())
    });
    from_roots(snapshot, exports, statements.chain(foreign_functions(snapshot)))
}

/// Every function a declaration file declares: a foreign function, which
/// lowering may call without the program naming it.
///
/// Lowering finds one **by name** -- a tag (`@ntsConstruct gtk_label_new`,
/// a class's `_get_type`) or the runtime itself (`g_type_check_instance_is_a`)
/// names a function no reference in the program reaches, and lowering takes
/// any symbol of that name with a bodiless function declaration. So every
/// such declaration is a root, which is that lookup's whole domain, rather
/// than an edge per tag, which would miss the names only lowering knows. A
/// function's signature is small; what it names is reached from it without
/// the members of the classes it names.
fn foreign_functions(snapshot: &SemanticSnapshot) -> impl Iterator<Item = NodeId> + '_ {
    let declaration_files: FxHashSet<u32> = declaration_files(snapshot);
    snapshot.nodes.iter().enumerate().filter_map(move |(index, node)| {
        (matches!(node.kind, NodeKind::Syntax(syntax::FUNCTION_DECLARATION))
            && declaration_files.contains(&node.origin.location.file.0))
        .then(|| u32::try_from(index).ok().map(NodeId))
        .flatten()
    })
}

/// The class and interface declarations a heritage clause's types name: the
/// symbols of each `Base<T>`'s expression, not of its type arguments.
fn inherited(snapshot: &SemanticSnapshot, types: &[NodeId]) -> Vec<NodeId> {
    let mut named = Vec::new();
    let mut stack: Vec<NodeId> = types
        .iter()
        .filter_map(|ty| snapshot.nodes.get(ty.0 as usize)?.children.first().copied())
        .collect();
    while let Some(node) = stack.pop() {
        let Some(record) = snapshot.nodes.get(node.0 as usize) else { continue };
        stack.extend(record.children.iter().copied());
        // Through an import to what it imports: `import { Application }`
        // names the class by an alias, whose declaration is the specifier.
        let Some(mut declared) = record.symbol.and_then(|symbol| snapshot.symbols.get(symbol.0 as usize)) else { continue };
        while let Some(aliased) = declared.aliased.and_then(|symbol| snapshot.symbols.get(symbol.0 as usize)) {
            declared = aliased;
        }
        named.extend(declared.declarations.iter().copied().filter(|declaration| {
            snapshot
                .nodes
                .get(declaration.0 as usize)
                .is_some_and(|node| matches!(node.kind, NodeKind::Syntax(syntax::CLASS_DECLARATION | syntax::INTERFACE_DECLARATION)))
        }));
    }
    named
}

/// The sources that are declaration files, by id.
fn declaration_files(snapshot: &SemanticSnapshot) -> FxHashSet<u32> {
    snapshot
        .sources
        .iter()
        .enumerate()
        .filter(|(_, source)| is_declaration_file(&source.uri))
        .filter_map(|(index, _)| u32::try_from(index).ok())
        .collect()
}

/// Whether a source is a declaration file -- `.d.ts`, or its module-kind
/// forms `.d.mts` and `.d.cts` -- which declares and holds no code.
#[must_use]
pub fn is_declaration_file(uri: &str) -> bool {
    [".d.ts", ".d.mts", ".d.cts"].iter().any(|suffix| uri.ends_with(suffix))
}

/// Walk outward from a given set of root symbols.
#[must_use]
pub fn from_symbols(
    snapshot: &SemanticSnapshot,
    roots: impl IntoIterator<Item = SymbolId>,
) -> Reachability {
    from_roots(snapshot, roots, std::iter::empty())
}

/// Walk outward from root symbols *and* root nodes.
///
/// Nodes as well as symbols because not everything worth reaching is named:
/// a module's top-level statements have no symbol to start from.
#[must_use]
pub fn from_roots(
    snapshot: &SemanticSnapshot,
    roots: impl IntoIterator<Item = SymbolId>,
    nodes: impl IntoIterator<Item = NodeId>,
) -> Reachability {
    let mut result = Reachability::default();
    let mut worklist: Vec<NodeId> = nodes.into_iter().collect();
    let declaration_files = declaration_files(snapshot);
    // Classes and interfaces of declaration files walked whole: see below.
    let mut whole: FxHashSet<NodeId> = FxHashSet::default();

    for symbol in roots {
        if result.symbols.insert(symbol)
            && let Some(record) = snapshot.symbols.get(symbol.0 as usize)
        {
            worklist.extend(record.declarations.iter().copied());
        }
    }

    while let Some(node) = worklist.pop() {
        if !result.nodes.insert(node) {
            continue;
        }
        let Some(record) = snapshot.nodes.get(node.0 as usize) else {
            continue;
        };

        if let Some(&ty) = snapshot.node_types.get(&node) {
            result.types.insert(ty);
        }

        // A node's subtree is part of its declaration -- except a class,
        // interface, enum or module a declaration file declares, whose
        // members are each reached by a reference to that member. Such a
        // declaration is a list of what a library has, not code that runs,
        // and walking all of it walked the library: a platform package's
        // `NSWindow` names `NSScreen` and `NSToolbar`, whose members name
        // more, and 117,459 nodes were reached from a program using a few
        // dozen of them.
        let declares_members = matches!(
            record.kind,
            NodeKind::Syntax(syntax::CLASS_DECLARATION | syntax::INTERFACE_DECLARATION | syntax::ENUM_DECLARATION | syntax::MODULE_DECLARATION)
        );
        if !(declares_members && declaration_files.contains(&record.origin.location.file.0)) || whole.contains(&node) {
            worklist.extend(record.children.iter().copied());
        }

        // **Except a class or interface the program extends or implements.**
        // Its members are matched by name, not reached by reference: an
        // override is found against the base's declaration of that name, and
        // a Windows Runtime override reads the base member's signature. So
        // what a heritage clause names is walked whole, reached before or
        // after.
        if matches!(record.kind, NodeKind::Syntax(syntax::HERITAGE_CLAUSE)) {
            for base in inherited(snapshot, &record.children) {
                if whole.insert(base) && result.nodes.contains(&base) {
                    worklist.extend(snapshot.nodes.get(base.0 as usize).into_iter().flat_map(|base| base.children.iter().copied()));
                } else {
                    worklist.push(base);
                }
            }
        }

        // A reference names a symbol; following it to that symbol's declarations
        // is what makes this a graph walk rather than a subtree walk. Without this
        // edge, a function's body would be reached but nothing it calls would be.
        if let Some(symbol) = record.symbol
            && result.symbols.insert(symbol)
            && let Some(declared) = snapshot.symbols.get(symbol.0 as usize)
        {
            worklist.extend(declared.declarations.iter().copied());
        }

        // A resolved call reaches its callee even when nothing else does — the
        // callee may be a private helper that no export names directly.
        if let Some(target) = snapshot.call_targets.get(&node)
            && let Some(callee) = target.callee
        {
            worklist.push(callee);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DeclarationModifiers, ModuleRecord, NodeData, NodeKind, NodeRecord, Origin, SymbolFlags,
        SymbolRecord, TypeKind, TypeRecord,
    };
    use nts_diagnostics::{Location, SourceId, Span};

    fn node(children: Vec<NodeId>, symbol: Option<SymbolId>) -> NodeRecord {
        NodeRecord {
            kind: NodeKind::Syntax(0),
            origin: Origin::source(Location {
                file: SourceId(0),
                span: Span::new(0, 1),
            }),
            parent: None,
            children,
            symbol,
            flags: 0,
            modifiers: DeclarationModifiers::default(),
            native: None,
            data: NodeData::Children {
                present: 0,
                small: 0,
            },
            text: None,
        }
    }

    fn symbol(name: &str, declarations: Vec<NodeId>) -> SymbolRecord {
        SymbolRecord {
            name: name.to_owned(),
            flags: SymbolFlags::default(),
            declarations,
            ty: None,
            aliased: None,
        }
    }

    /// Two declarations: node 0 (exported, references symbol 1) and node 2
    /// (private helper). Node 3 is unreferenced by anything.
    fn snapshot() -> SemanticSnapshot {
        let mut snapshot = SemanticSnapshot {
            schema_version: crate::SCHEMA_VERSION,
            nodes: vec![
                node(vec![NodeId(1)], None),
                node(vec![], Some(SymbolId(1))),
                node(vec![], None),
                node(vec![], None),
            ],
            symbols: vec![
                symbol("exported", vec![NodeId(0)]),
                symbol("helper", vec![NodeId(2)]),
                symbol("unused", vec![NodeId(3)]),
            ],
            types: vec![
                TypeRecord {
                    kind: TypeKind::Number,
                    symbol: None,
                },
                TypeRecord {
                    kind: TypeKind::String,
                    symbol: None,
                },
            ],
            modules: vec![ModuleRecord {
                file: SourceId(0),
                imports: Vec::new(),
                exports: vec![("exported".to_owned(), SymbolId(0))],
                root: NodeId(0),
            }],
            ..SemanticSnapshot::default()
        };
        snapshot.node_types.insert(NodeId(1), TypeId(0));
        snapshot.node_types.insert(NodeId(3), TypeId(1));
        snapshot
    }

    #[test]
    fn an_exported_declaration_is_reached() {
        let reached = from_exports(&snapshot());
        assert!(reached.contains(NodeId(0)));
    }

    #[test]
    fn a_reference_reaches_the_declaration_it_names() {
        // The edge that makes this a graph walk. Node 1 sits inside the export and
        // names `helper`; without following symbol references, node 2 — where
        // `helper` is actually declared — would never be reached, and a build
        // would decide the function it calls is dead.
        let reached = from_exports(&snapshot());
        assert!(
            reached.contains(NodeId(2)),
            "the referenced helper is reachable"
        );
    }

    #[test]
    fn an_unreferenced_declaration_is_not_reached() {
        let reached = from_exports(&snapshot());
        assert!(!reached.contains(NodeId(3)), "nothing names `unused`");
    }

    #[test]
    fn only_reachable_types_become_seeds() {
        // The whole point: TypeId(1) belongs to the unreachable node, so resolving
        // it in depth would be round trips spent on a type the build cannot use.
        let reached = from_exports(&snapshot());
        assert_eq!(reached.seeds(), vec![TypeId(0)]);
    }

    #[test]
    fn seeds_are_ordered_so_a_build_is_reproducible() {
        let mut snapshot = snapshot();
        snapshot.node_types.insert(NodeId(0), TypeId(1));
        let seeds = from_exports(&snapshot).seeds();
        let mut sorted = seeds.clone();
        sorted.sort_unstable();
        assert_eq!(
            seeds, sorted,
            "an unordered seed list would churn cache keys"
        );
    }

    #[test]
    fn a_cyclic_reference_graph_terminates() {
        // Mutual recursion is ordinary; a walk that revisits would not return.
        let mut snapshot = snapshot();
        snapshot.nodes[2].symbol = Some(SymbolId(0));
        let reached = from_exports(&snapshot);
        assert!(reached.contains(NodeId(2)));
    }

    #[test]
    fn a_symbol_declared_outside_the_decoded_set_is_skipped() {
        // An imported symbol has no declaration node here. Reaching for one would
        // be an index into another file's nodes.
        let mut snapshot = snapshot();
        snapshot.symbols[1].declarations.clear();
        let reached = from_exports(&snapshot);
        assert!(reached.symbols.contains(&SymbolId(1)));
        assert!(!reached.contains(NodeId(2)));
    }

    #[test]
    fn nothing_exported_reaches_nothing() {
        let mut snapshot = snapshot();
        snapshot.modules[0].exports.clear();
        assert!(from_exports(&snapshot).nodes.is_empty());
    }

    fn source(uri: &str) -> nts_diagnostics::SourceFile {
        nts_diagnostics::SourceFile {
            uri: uri.to_owned(),
            digest: nts_diagnostics::Digest([0; 16]),
            display_path: uri.into(),
            rewritten_by: None,
            rewritten_map: Vec::new(),
        }
    }

    fn declared(kind: u16, file: u32, children: Vec<NodeId>, symbol: Option<SymbolId>) -> NodeRecord {
        let mut record = node(children, symbol);
        record.kind = NodeKind::Syntax(kind);
        record.origin.location.file = SourceId(file);
        record
    }

    /// A program (`main.ts`) using one member of a class a declaration file
    /// (`lib.d.ts`) declares, which has another member naming a second class:
    ///
    /// ```text
    /// 0 main.ts statement -> 1 reference to Window, 2 reference to Window#title
    /// 3 class Window (lib.d.ts)   -> 4 title, 5 screen -> 6 reference to Screen
    /// 7 class Screen (lib.d.ts)
    /// 8 function gtk_label_new (lib.d.ts), named by nothing
    /// 9 lib.d.ts's root           -> 3, 7, 8
    /// ```
    fn a_program_over_a_library() -> SemanticSnapshot {
        SemanticSnapshot {
            schema_version: crate::SCHEMA_VERSION,
            sources: vec![source("nts-workspace:///main.ts"), source("nts-workspace:///lib.d.ts")],
            nodes: vec![
                declared(0, 0, vec![NodeId(1), NodeId(2)], None),
                declared(0, 0, vec![], Some(SymbolId(0))),
                declared(0, 0, vec![], Some(SymbolId(1))),
                declared(syntax::CLASS_DECLARATION, 1, vec![NodeId(4), NodeId(5)], None),
                declared(0, 1, vec![], None),
                declared(0, 1, vec![NodeId(6)], None),
                declared(0, 1, vec![], Some(SymbolId(2))),
                declared(syntax::CLASS_DECLARATION, 1, vec![], None),
                declared(syntax::FUNCTION_DECLARATION, 1, vec![], None),
                declared(syntax::SOURCE_FILE, 1, vec![NodeId(3), NodeId(7), NodeId(8)], None),
            ],
            symbols: vec![
                symbol("Window", vec![NodeId(3)]),
                symbol("title", vec![NodeId(4)]),
                symbol("Screen", vec![NodeId(7)]),
                symbol("gtk_label_new", vec![NodeId(8)]),
            ],
            modules: vec![
                ModuleRecord { file: SourceId(0), imports: Vec::new(), exports: Vec::new(), root: NodeId(0) },
                ModuleRecord {
                    file: SourceId(1),
                    imports: Vec::new(),
                    exports: vec![("Window".to_owned(), SymbolId(0)), ("Screen".to_owned(), SymbolId(2))],
                    root: NodeId(9),
                },
            ],
            ..SemanticSnapshot::default()
        }
    }

    /// **A declaration file's class reaches only the members named.** Its
    /// declaration is a list of what a library has; walking all of it walked
    /// the library, every class a member names and theirs in turn.
    #[test]
    fn a_declared_class_reaches_only_the_members_the_program_names() {
        let reached = for_frontend(&a_program_over_a_library());
        assert!(reached.contains(NodeId(3)), "the class the program names");
        assert!(reached.contains(NodeId(4)), "the member the program names");
        assert!(!reached.contains(NodeId(5)), "a member nothing names");
        assert!(!reached.contains(NodeId(7)), "a class only that member names");
    }

    /// The same class in a file with code is walked whole, as before: its
    /// members are code that runs.
    #[test]
    fn a_class_with_code_is_walked_whole() {
        let mut snapshot = a_program_over_a_library();
        snapshot.sources[1].uri = "nts-workspace:///lib.ts".to_owned();
        let reached = for_frontend(&snapshot);
        assert!(reached.contains(NodeId(5)) && reached.contains(NodeId(7)));
    }

    /// **Every function a declaration file declares is reached**, named or
    /// not: lowering calls one by name for a tag or for the runtime
    /// (`@ntsConstruct gtk_label_new`), and no reference leads there.
    #[test]
    fn a_declared_function_is_reached_without_a_reference() {
        let reached = for_frontend(&a_program_over_a_library());
        assert!(reached.contains(NodeId(8)));
    }

    /// **A class the program extends is walked whole**, through the import
    /// that names it: an override is matched against the base's members by
    /// name, and no reference reaches a member only an override matches.
    #[test]
    fn a_class_the_program_extends_is_walked_whole() {
        let mut snapshot = a_program_over_a_library();
        // 10 class App extends Window (main.ts) -> 11 heritage clause
        //   -> 12 `Window` with its arguments -> 13 `Window`, an import of it
        snapshot.nodes.extend([
            declared(syntax::CLASS_DECLARATION, 0, vec![NodeId(11)], None),
            declared(syntax::HERITAGE_CLAUSE, 0, vec![NodeId(12)], None),
            declared(syntax::EXPRESSION_WITH_TYPE_ARGUMENTS, 0, vec![NodeId(13)], None),
            declared(0, 0, vec![], Some(SymbolId(4))),
        ]);
        let mut import = symbol("Window", vec![]);
        import.aliased = Some(SymbolId(0));
        snapshot.symbols.push(import);
        snapshot.nodes[0].children.push(NodeId(10));
        let reached = for_frontend(&snapshot);
        assert!(reached.contains(NodeId(5)), "a member only an override would match");
        assert!(reached.contains(NodeId(7)), "what that member names");
    }

    /// A declaration file's exports are not roots: `Screen` is exported and
    /// nothing the program runs names it.
    #[test]
    fn a_declaration_files_exports_are_not_roots() {
        let reached = for_frontend(&a_program_over_a_library());
        assert!(!reached.symbols.contains(&SymbolId(2)));
    }
}

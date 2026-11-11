//! Read source, node, and binding facts from the semantic snapshot.

use super::{
    FuncBuilder, Location, Nameless, NodeData, NodeId, NodeKind, Origin, SemanticSnapshot,
    SymbolFlags, SymbolId, TypeId, feature_of, syntax,
};

/// Whether a node in an arrow's subtree reads a *name* at all.
///
/// The name after a dot is a property, not a binding, and so is the key of
/// `{ x: 1 }`. Both have symbols, and both are declared outside the arrow, so
/// without this they would look like captures.
pub(super) fn reads_a_name(probe: &FuncBuilder, read: NodeId) -> bool {
    probe.kind_of(read) == Some(syntax::IDENTIFIER) && !probe.names_a_member(read)
}

/// Whether a name is a **type parameter** and so never a value to capture.
///
/// An annotation inside an arrow mentions one by name like anything else:
/// `(...args: Arguments) => void` written inside `asRequest<Arguments>` put
/// `Arguments` in the capture list, and the closure refused with
/// "`Arguments`, captured above its own declaration, where it has no value
/// yet" -- a sentence about a binding, for a thing that never had one.
///
/// Invisible until a closure inside a generic *function* copy was lowered
/// under that copy's substitution, because before that the arrow stopped one
/// link earlier, on the rest parameter's element type.
///
/// Every declaration rather than any: a name is a type only if nothing under
/// it declares a value.
pub(super) fn names_only_a_type_parameter(
    probe: &FuncBuilder,
    record: &nts_semantic_schema::SymbolRecord,
) -> bool {
    !record.declarations.is_empty()
        && record
            .declarations
            .iter()
            .all(|declaration| probe.kind_of(*declaration) == Some(syntax::TYPE_PARAMETER))
}

/// Every descendant of one syntax kind, in source order.
pub(super) fn collect_kind(
    snapshot: &SemanticSnapshot,
    id: NodeId,
    kind: u16,
    into: &mut Vec<NodeId>,
) {
    let Some(node) = snapshot.nodes.get(id.0 as usize) else {
        return;
    };
    if node.kind == NodeKind::Syntax(kind) {
        into.push(id);
    }
    for child in &node.children {
        collect_kind(snapshot, *child, kind, into);
    }
}

/// The initializer in a variable declaration: the last child that is neither
/// the name nor a type annotation.
///
/// One derivation, asked twice. `collect_module_scope` needs it to decide
/// whether a global is deferred, and `lower_module_binding` needs the node to
/// lower -- and while those agreed for a symbol declared once, `deferred` is
/// keyed by **symbol** and a module-scope `var` may be declared more than once.
/// Reading the map there gave every declaration of one symbol the *last*
/// declaration's initializer.
pub(super) fn declaration_initializer(
    children: &[NodeId],
    name_node: NodeId,
    kind_of: impl Fn(NodeId) -> Option<u16>,
) -> Option<NodeId> {
    children
        .iter()
        .rev()
        .find(|child| {
            **child != name_node && !syntax::is_type_node(kind_of(**child).unwrap_or_default())
        })
        .copied()
}

/// The calls a function's body makes, in source order -- the closures in it
/// included, and not a nested function declaration or class.
///
/// A closure inside a copy is lowered in the copy's context (`closure_variants`
/// gives it a closure of its own where it captures a re-typed parameter), so
/// its calls are decided here with the copy's: the captured symbol is the
/// parameter's symbol, so `actual` sees it the same way. A nested *function
/// declaration* is a function of its own with its own copies, and a class's
/// methods are lowered by the class.
/// The children of a node that can actually run.
///
/// **`if (isDevelopment)` is a dead branch and the raise analysis walked it.** The
/// React lane's port writes every DEV call that way -- `export const isDevelopment =
/// false` in `shared/Build.native.ts`, whose checker type is the literal `false` --
/// and after `1962b826c` named the leaf, **nine** `try`s in
/// `ReactFiberCommitEffects.ts` turned out to be refused because of
/// `runWithFiberInDEV`, a generic reached only from inside such a branch. Production
/// never calls it.
///
/// `lower_if` has pruned these since `folded_branch`, so the *code* was never
/// emitted; what walked in anyway were the analyses that decide whether a `try` can
/// be given a handler. So a program was refused for a call it does not make.
///
/// `statically_decided` is the same primitive `folded_branch` reads, deliberately:
/// two derivations of "is this branch dead" would let the analysis and the lowering
/// disagree about which half of an `if` exists. Where it answers `None` every child
/// is kept, so the analyses stay conservative -- being *less* precise than the
/// lowering is safe here, being more precise is not.
pub(super) fn children_that_run(probe: &FuncBuilder, id: NodeId) -> Vec<NodeId> {
    let children = probe.children(id);
    if probe.kind_of(id) != Some(syntax::IF_STATEMENT) {
        return children;
    }
    // The condition is kept either way: `if (check())` decides nothing about the
    // call inside it, which runs whichever branch is taken.
    match children.as_slice() {
        [condition, then_branch, rest @ ..] => match probe.statically_decided(*condition) {
            Some(true) => vec![*condition, *then_branch],
            Some(false) => {
                let mut kept = vec![*condition];
                kept.extend(rest.iter().copied());
                kept
            }
            None => children,
        },
        _ => children,
    }
}

/// Whether `module` is a declaration file -- `.d.ts`, `.d.mts`, `.d.cts` --
/// which declares and never runs.
pub(super) fn is_declaration_file(
    snapshot: &SemanticSnapshot,
    module: &nts_semantic_schema::ModuleRecord,
) -> bool {
    snapshot
        .sources
        .get(module.file.0 as usize)
        .is_some_and(|source| is_a_declaration_path(&source.uri))
}

/// Whether a source path is a declaration file's: `.d.ts`, `.d.mts`, `.d.cts`.
pub(super) fn is_a_declaration_path(path: &str) -> bool {
    [".d.ts", ".d.mts", ".d.cts"]
        .iter()
        .any(|suffix| path.ends_with(suffix))
}

/// A node's syntax kind, without building a `FuncBuilder` per question.
pub(super) fn probe_kind(snapshot: &SemanticSnapshot, id: NodeId) -> Option<u16> {
    match snapshot.nodes.get(id.0 as usize)?.kind {
        NodeKind::Syntax(kind) => Some(kind),
        NodeKind::List => None,
    }
}

/// The declared name of a type, where it has one.
pub(super) fn named(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<&str> {
    let symbol = snapshot.types.get(ty.0 as usize)?.symbol?;
    snapshot.symbols.get(symbol.0 as usize)?.name.public_name()
}

/// The library type `ty` is, by name, where it is one -- and not a class of the
/// program's that happens to share the name. What every "is this the provided
/// `Map` / `Promise` / `Date` / error class" question asks; [`named`] is for
/// messages and for whether a type has a name at all.
///
/// A module's own `class Set` was read as the library's `Set`: its members were
/// looked up in the built-in table and refused ("`Set#size`, which this table
/// has not"), which is what kept Are We Fast Yet's Havlak, whose `som` library
/// declares one, from compiling. See [`SemanticSnapshot::provided_name`].
pub(super) fn provided(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<&str> {
    snapshot.provided_name(ty)
}

/// The syntax kind of a node, or `None` for a list.
pub(super) fn kind_at(snapshot: &SemanticSnapshot, id: NodeId) -> Option<u16> {
    match snapshot.nodes.get(id.0 as usize)?.kind {
        NodeKind::Syntax(kind) => Some(kind),
        NodeKind::List => None,
    }
}

pub(super) fn direct_children(snapshot: &SemanticSnapshot, id: NodeId) -> Vec<NodeId> {
    let Some(node) = snapshot.nodes.get(id.0 as usize) else {
        return Vec::new();
    };
    node.children
        .iter()
        .flat_map(|child| match snapshot.nodes.get(child.0 as usize) {
            Some(record) if record.kind == NodeKind::List => record.children.clone(),
            _ => vec![*child],
        })
        .collect()
}

pub(super) fn contains_kind(snapshot: &SemanticSnapshot, id: NodeId, kind: u16) -> bool {
    let mut found = false;
    walk(snapshot, id, &mut |child| {
        if kind_at(snapshot, child) == Some(kind) {
            found = true;
        }
    });
    found
}

/// Every node under `id`, itself included.
pub(super) fn walk(snapshot: &SemanticSnapshot, id: NodeId, visit: &mut impl FnMut(NodeId)) {
    visit(id);
    for child in direct_children(snapshot, id) {
        walk(snapshot, child, visit);
    }
}

impl<'a> FuncBuilder<'a> {
    pub(super) fn node(&self, id: NodeId) -> &'a nts_semantic_schema::NodeRecord {
        &self.snapshot.nodes[id.0 as usize]
    }

    /// Whether `id` is in a file the program runs, not a declaration file's
    /// (`lib.d.ts`'s `valueOf` is every object's and no program's).
    pub(super) fn declared_in_program_source(&self, id: NodeId) -> bool {
        self.snapshot
            .nodes
            .get(id.0 as usize)
            .and_then(|node| {
                self.snapshot
                    .sources
                    .get(node.origin.location.file.0 as usize)
            })
            .is_some_and(|source| !is_a_declaration_path(&source.uri))
    }

    pub(super) fn origin(&self, id: NodeId) -> Origin {
        self.node(id).origin.clone()
    }

    pub(super) fn location(&self, id: NodeId) -> Location {
        self.node(id).origin.location
    }

    /// Children, with list nodes flattened away.
    ///
    /// A `NodeList` is an encoding artifact rather than a construct, so it is not
    /// something the lowering should have to know about at every step.
    pub(super) fn children(&self, id: NodeId) -> Vec<NodeId> {
        // **One allocation, not one per child.** The `flat_map` this replaces
        // returned a `Vec` from every closure call -- `node.children.clone()`
        // for a list and `vec![*child]` for everything else -- so a node of N
        // children cost N+1 allocations, and nearly every arm of lowering asks
        // this.
        //
        // The GTK lane profiled it and then measured it: on a one-button GTK
        // program, whose 650-odd functions are mostly generated bindings, a warm
        // `emit-c` goes from 52.78 G instructions to 29.64 G -- **-43.8%**,
        // repeatable to 0.01%, emitting the identical program. On
        // `runtime/node/http` the same change is -0.19%. Both are right: a
        // `List` node is what makes this clone rather than push, so a program
        // whose declarations are mostly generated argument lists pays N+1
        // almost everywhere and hand-written code pays it rarely. The magnitude
        // is a property of the program's shape, not of the corpus chosen.
        //
        // The capacity is the child count, exact whenever no child is a list --
        // the common case -- and grown once otherwise. Returning a slice or an
        // iterator would remove the last allocation too, and is a change to
        // several hundred call sites rather than to this one; this is the part
        // that can be had for nothing.
        let children = &self.node(id).children;
        let mut flat = Vec::with_capacity(children.len());
        for child in children {
            let node = self.node(*child);
            if node.kind == NodeKind::List {
                flat.extend_from_slice(&node.children);
            } else {
                flat.push(*child);
            }
        }
        flat
    }

    /// The parent a child would name, with list nodes stepped over.
    ///
    /// [`Self::children`] flattens a `List` -- an argument list, a parameter
    /// list -- so a call's children are its callee and its arguments. The
    /// `parent` link does not: an argument's parent is the list, whose kind is
    /// no syntax at all. Anything that asks what encloses a node and then looks
    /// for it among that node's children has to agree with `children` about
    /// which node that is, and this is the half that was missing: every
    /// argument's parent was a `List`, so `f(null)` matched no arm of
    /// [`Self::contextual_type`] and the `null` was refused for standing in for
    /// nothing.
    pub(super) fn syntactic_parent(&self, id: NodeId) -> Option<NodeId> {
        let mut at = self.node(id).parent?;
        while self.node(at).kind == NodeKind::List {
            at = self.node(at).parent?;
        }
        Some(at)
    }

    /// Every enclosing piece of this binding's declaration grammar. Nested
    /// patterns have no fixed depth. Stop at the first owning construct so a
    /// parameter or body local cannot inherit an outer loop's binding kind.
    pub(super) fn binding_parents(&self, declaration: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        let mut seen = rustc_hash::FxHashSet::default();
        std::iter::successors(self.node(declaration).parent, |parent| {
            let node = self.node(*parent);
            if node.kind == NodeKind::List
                || matches!(
                    self.kind_of(*parent),
                    Some(
                        syntax::BINDING_ELEMENT
                            | syntax::OBJECT_BINDING_PATTERN
                            | syntax::ARRAY_BINDING_PATTERN
                            | syntax::VARIABLE_DECLARATION
                            | syntax::VARIABLE_DECLARATION_LIST
                    )
                )
            {
                node.parent
            } else {
                None
            }
        })
        .take_while(move |parent| seen.insert(*parent))
    }

    /// Every node at or below `id`, in source order.
    pub(super) fn subtree(&self, id: NodeId, into: &mut Vec<NodeId>) {
        into.push(id);
        for child in self.children(id) {
            self.subtree(child, into);
        }
    }

    /// Whether an identifier names a member rather than a binding.
    ///
    /// `p.x` and `{ x: 1 }` both put a symbol on `x`, and that symbol is
    /// declared wherever the type is -- outside whatever is being scanned. So a
    /// scan for free variables has to know the difference, and the difference
    /// is entirely positional.
    pub(super) fn names_a_member(&self, id: NodeId) -> bool {
        let Some(parent) = self.node(id).parent else {
            return false;
        };
        match self.kind_of(parent) {
            // `a.b` — the second child is the member. The first is an ordinary
            // read of `a`, which may well be a capture.
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => self.children(parent).first() != Some(&id),
            // `{ x: v }` — the first child is the key. `{ x }` is both at once,
            // so it is not a member: it reads `x`.
            Some(syntax::PROPERTY_ASSIGNMENT) => self.children(parent).first() == Some(&id),
            _ => false,
        }
    }

    pub(super) fn kind_of(&self, id: NodeId) -> Option<u16> {
        match self.node(id).kind {
            NodeKind::Syntax(kind) => Some(kind),
            NodeKind::List => None,
        }
    }

    /// Whether a node's subtree contains one of a kind.
    ///
    /// Bounded by the subtree rather than by depth: a function body is the only
    /// thing this is asked about, and it is asked once, on a path that is about
    /// to refuse anyway.
    pub(super) fn mentions(&self, id: NodeId, kind: u16) -> bool {
        if self.kind_of(id) == Some(kind) {
            return true;
        }
        self.children(id)
            .into_iter()
            .any(|child| self.mentions(child, kind))
    }

    /// The symbol a name ultimately denotes, following an import alias.
    ///
    /// Every reference to an imported name resolves to a symbol declared at the
    /// *import site*, not to the declaration it stands for. Module scope is
    /// keyed by the declaration, so a read of an imported value used to look
    /// itself up, find nothing, and be refused as a name from an enclosing
    /// scope -- the refusal that made the temporal dead zone unreachable.
    ///
    /// The frontend follows the whole chain, so this is one hop in every case
    /// it has produced. The loop is a bound rather than an algorithm: a
    /// self-referential chain would be a bug in the frontend, and a lowering
    /// should refuse such a program rather than hang on it.
    pub(super) fn denoted_symbol(&self, symbol: SymbolId) -> SymbolId {
        let mut at = symbol;
        for _ in 0..8 {
            match self
                .snapshot
                .symbols
                .get(at.0 as usize)
                .and_then(|record| record.aliased)
            {
                Some(next) => at = next,
                None => return at,
            }
        }
        at
    }

    /// Whether `id` names a namespace -- `declare namespace JsonValue`, or an
    /// import of one -- which is a scope and not a value.
    pub(super) fn names_a_namespace(&self, id: NodeId) -> bool {
        let Some(symbol) = self.node(id).symbol else {
            return false;
        };
        let symbol = self.denoted_symbol(symbol);
        self.snapshot
            .symbols
            .get(symbol.0 as usize)
            .is_some_and(|record| {
                record.flags.contains(SymbolFlags::MODULE)
                    && ![
                        SymbolFlags::VARIABLE,
                        SymbolFlags::FUNCTION,
                        SymbolFlags::CLASS,
                        SymbolFlags::ENUM,
                    ]
                    .into_iter()
                    .any(|value| record.flags.contains(value))
            })
    }

    /// Whether `function` is declared in a namespace `id` names, when `id` names
    /// something else as well: `Application` is a class and, merged with it,
    /// a namespace of its statics (`Application.Start`), and the class
    /// declares no static of that name -- so the call is to the namespace's
    /// function, as it is when the namespace stands alone.
    pub(super) fn declared_in_namespace_of(&self, id: NodeId, function: NodeId) -> bool {
        let Some(namespace) = self.ancestor(function, syntax::MODULE_DECLARATION) else {
            return false;
        };
        let Some(symbol) = self.node(id).symbol else {
            return false;
        };
        let symbol = self.denoted_symbol(symbol);
        self.snapshot
            .symbols
            .get(symbol.0 as usize)
            .is_some_and(|record| {
                record.flags.contains(SymbolFlags::MODULE)
                    && record.declarations.contains(&namespace)
            })
    }

    /// A library global reaching a refusal, by whether this compiler provides
    /// it (`builtin::provides_global`): one it does not is NTS1100, member or
    /// not; one it does was reached in a form its lowering does not take.
    pub(super) fn library_global(
        &self,
        id: NodeId,
        record: &nts_semantic_schema::SymbolRecord,
    ) -> Nameless {
        let Some(name) = record.name.public_name() else {
            return Nameless::Unsupported(format!(
                "a symbol-keyed member `{}` used as an identifier",
                record.name
            ));
        };
        // `arguments` is the language's own, which no library declares a
        // provider for: what has no lowering is the object.
        if name == "arguments" {
            return Nameless::Unsupported(match self.member_read_from(id) {
                Some(member) => format!("`arguments.{member}`, a read of the `arguments` object"),
                None => "the `arguments` object".to_owned(),
            });
        }
        let provided = crate::hir::builtin::provides_global(name);
        let answer = match self.member_read_from(id) {
            Some(member) if provided => self.provided_global_member(id, name, &member),
            Some(member) => Nameless::unprovided(format!("`{name}.{member}`")),
            None if provided => Nameless::Unsupported(format!(
                "`{name}`, a builtin this compiler provides, read as a value"
            )),
            None => Nameless::unprovided(format!("`{name}`")),
        };
        answer.of_feature(feature_of(record))
    }

    /// A member of a library global this compiler provides
    /// (`builtin::provides_global`), reaching a refusal. Called, it is a
    /// member with no lowering -- every member that has one is lowered before
    /// a call falls through to here -- so `Math.acosh(x)` is a builtin not
    /// provided. Read as a value, the member may well be provided when called
    /// (`console.log` handed on as a function), and what has no lowering is
    /// the read.
    pub(super) fn provided_global_member(
        &self,
        id: NodeId,
        global: &str,
        member: &str,
    ) -> Nameless {
        let access = self.node(id).parent;
        if access.is_some_and(|access| self.is_callee(access)) {
            Nameless::unprovided(format!("`{global}.{member}`"))
        } else {
            Nameless::Unsupported(format!(
                "`{global}.{member}`, a member of `{global}` read as a value"
            ))
        }
    }

    /// Whether a declaration sits at module scope.
    ///
    /// A module-scope name is never captured. There is one of it for the whole
    /// program and every function already reaches it by name, so copying it
    /// into a closure would be storage for nothing -- the same reason a
    /// function, a class and an import are skipped.
    ///
    /// It also puts the refusal in the right place when the module scope cannot
    /// represent the name. At the arrow all that can be said is how far away it
    /// was declared; at the read, `lower_identifier` can say what it *is* --
    /// a module-scope variable holding a function, an enum, a builtin this
    /// compiler does not provide.
    pub(super) fn is_module_scope(&self, declaration: NodeId) -> bool {
        self.snapshot.scopes.is_module_scope(declaration)
    }

    /// `var`, `let` or `const`, from the list the declaration sits in.
    ///
    /// The kind lives on the enclosing `VariableDeclarationList` and the
    /// encoder sometimes wraps that in a `VariableStatement`, so it is taken
    /// from whichever ancestor is the list -- the same way `lower_variable`
    /// takes it, and for the same reason.
    pub(super) fn declaration_kind(
        &self,
        declaration: NodeId,
    ) -> nts_semantic_schema::VariableKind {
        self.ancestor(declaration, syntax::VARIABLE_DECLARATION_LIST)
            .map_or(nts_semantic_schema::VariableKind::Var, |list| {
                nts_semantic_schema::VariableKind::from_flags(self.node(list).flags)
            })
    }

    /// Whether anything in the loop's **body** writes this name.
    ///
    /// The head is every child but the last: `for (init; cond; incr) body` puts
    /// the body last whichever of the other three the program wrote, so this
    /// needs no count of them and no schema knowledge beyond that.
    pub(super) fn written_in_the_body_of(&self, loop_node: NodeId, symbol: u32) -> bool {
        let children = self.children(loop_node);
        let Some(body) = children.last() else {
            return false;
        };
        let mut written = Vec::new();
        self.assigned_symbols(*body, &mut written);
        written.contains(&symbol)
    }

    /// Whether this name is the thing being *called* rather than a value.
    ///
    /// `finish(x)` calls it and needs no function object at all; `f(finish)`
    /// passes it and does. The distinction is what keeps a program of ordinary
    /// calls free of a closure table.
    pub(super) fn is_callee(&self, id: NodeId) -> bool {
        let Some(parent) = self.node(id).parent else {
            return false;
        };
        if self.kind_of(parent) != Some(syntax::CALL_EXPRESSION) {
            return false;
        }
        self.children(parent).first() == Some(&id)
    }

    /// The nearest ancestor of a given kind.
    pub(super) fn ancestor(&self, id: NodeId, kind: u16) -> Option<NodeId> {
        let mut at = self.node(id).parent;
        while let Some(parent) = at {
            if self.kind_of(parent) == Some(kind) {
                return Some(parent);
            }
            at = self.node(parent).parent;
        }
        None
    }

    /// Whether a node has a function or method above it.
    /// Whether a `function` declaration is a **closure** rather than a function
    /// of this program.
    ///
    /// A nested `function` declaration is a hoisted `const` holding a function
    /// expression, and that is not an analogy: written either of the other two
    /// ways the same body lowers and agrees with node. Only the declaration
    /// form was refused, for reading a local of the function that declares it.
    ///
    /// At **module scope** it stays a plain function -- there is one of it for
    /// the whole program and every caller reaches it by name, so a closure
    /// would be storage for nothing, which is the rule [`reached_by_name`](super::capture_discovery::reached_by_name)
    /// states for exactly that case. One that reads its own `this` is a closure
    /// too, taking the call's as a `function` expression does
    /// (`ClosureInfo::reads_this`); it was excluded while neither could.
    pub(super) fn is_nested_closure(&self, id: NodeId) -> bool {
        self.is_within_a_function(id)
    }

    pub(super) fn is_within_a_function(&self, id: NodeId) -> bool {
        self.snapshot.scopes.is_within_a_function(id)
    }

    /// Whether `node` is the identifier `undefined` naming the value -- `x =
    /// undefined`, a default that gives back the value it replaces, so testing
    /// for it is work with no effect. The type as well as the spelling, because
    /// a function scope may declare a binding of its own called `undefined`.
    pub(super) fn builtin_binding_at(
        &self,
        node: NodeId,
    ) -> Option<nts_semantic_schema::BuiltinBinding> {
        if self.kind_of(node) != Some(syntax::IDENTIFIER) {
            return None;
        }
        self.node(node)
            .symbol
            .and_then(|id| self.snapshot.symbols.get(id.0 as usize))
            .and_then(|symbol| symbol.builtin)
    }

    /// `constructor(private x: number)`: the store the modifier implies.
    ///
    /// A parameter property is two things wearing one syntax -- a parameter,
    /// and a member of the class initialised from it. The checker reports the
    /// member like any other, so the layout already has the slot; only the
    /// assignment was missing, which is why this was a refusal rather than a
    /// gap.
    ///
    /// Before the body, because that is where JavaScript puts it and the body
    /// may read `this.x` on its first line. In declaration order, because the
    /// initialisers of two of them can be told apart by a getter.
    ///
    /// Node cannot run this in strip-only mode -- a parameter property is not
    /// erasable, so the oracle refuses the program rather than disagreeing with
    /// it. The differential passes `--experimental-transform-types` for exactly
    /// this and for `enum`, the other non-erasable construct.
    /// The symbol a node *declares*, where the node carries none itself.
    ///
    /// The forward direction — `node.symbol` — is what almost everything wants
    /// and is one load. A `PARAMETER` that is also a property is the case that
    /// has no forward answer: its name node carries the property's symbol and
    /// the parameter's is reachable only from the symbol side.
    ///
    /// **Both symbols name the same declaration**, so `other_than` is not a
    /// convenience: a scan without it returns whichever comes first in the
    /// table, which was the property's — the one already bound, and the one
    /// this exists to be different from.
    pub(super) fn symbol_declared_by(
        &self,
        declaration: NodeId,
        other_than: Option<u32>,
    ) -> Option<u32> {
        self.snapshot
            .symbols
            .iter()
            .enumerate()
            .find_map(|(at, record)| {
                let at = u32::try_from(at).ok()?;
                (record.declarations.contains(&declaration) && Some(at) != other_than).then_some(at)
            })
    }

    /// Symbols assigned anywhere inside a subtree.
    ///
    /// Collected before a loop body is lowered, because the header needs a
    /// parameter for each of them *before* the body can refer to it — the body
    /// reads the value the previous iteration produced, which does not exist yet.
    /// Whether a symbol is a module-scope binding rather than a local.
    ///
    /// A global is *memory*. It is read with `GlobalGet` and written with
    /// `GlobalSet`, so a loop that assigns one needs no block parameter to
    /// carry it: the next iteration reads the slot the last one wrote. An `if`
    /// that assigns a global has always worked for exactly this reason -- it
    /// carries nothing.
    pub(super) fn is_a_global(&self, symbol: u32) -> bool {
        self.module.variables.contains_key(&symbol)
    }

    /// Whether an expression is the whole of an expression statement.
    pub(super) fn is_a_statement(&self, id: NodeId) -> bool {
        self.snapshot
            .nodes
            .get(id.0 as usize)
            .and_then(|node| node.parent)
            .is_some_and(|parent| self.kind_of(parent) == Some(syntax::EXPRESSION_STATEMENT))
    }

    /// The first object type declared with this name.
    pub(super) fn type_named(&self, wanted: &str) -> Option<TypeId> {
        // No filter on the type's *kind*. `Error` reaches the compiler as
        // whatever `lib.d.ts` declares it as, which is not the object kind a
        // class declaration produces -- and the name is what identifies these
        // four everywhere else here.
        (0..self.snapshot.types.len())
            .filter_map(|at| u32::try_from(at).ok().map(TypeId))
            .find(|ty| self.name_of_type(*ty) == Some(wanted))
    }

    /// Whether any expression in the program has this type.
    ///
    /// The question underneath `Declares::Optionally`, which refuses because
    /// `{}` and `{ k: undefined }` are one layout with one erased slot and no
    /// test of a *value* can tell them apart. That is true of a value — and a
    /// type nothing can be is not a value.
    ///
    /// Sound because a value's runtime shape is decided where it is allocated,
    /// and an allocation is an expression with a type. An object literal takes
    /// its contextual type, so `{ other: 1 }` written as a `Maybe` **is** a
    /// `Maybe` here and keeps the refusal; a struct built by the Node-API
    /// wrapper takes the published signature's type, which is written on a
    /// parameter. Every shape a value can have is some node's type, and a type
    /// that is no node's type is a shape nothing holds.
    ///
    /// # Why this and not the two cheaper questions
    ///
    /// **"Does it have a layout" is the exact question and cannot be asked
    /// here.** A layout is discovered by whichever function first needs one, so
    /// the set is not complete until every function has been lowered — which is
    /// why `prune_class_tests` runs afterwards and why this cannot.
    ///
    /// **"Does it have a symbol" is cheap and wrong.** It was the first attempt:
    /// the type that poisons `"length" in value` under `Buffer.from` has none,
    /// which made it look like the rule. Twelve of `buffer`'s 144 laid-out
    /// types have no symbol either — `Type190`, `Type410`, `Type796`, two
    /// closures, a signature and the four error constructors — so "no symbol"
    /// would have answered for shapes values really do have.
    ///
    /// The type in question is `{ length?, toString?, toLocaleString?, pop?,
    /// push?, concat?, ... }`: `Array` with every member optional, no symbol, no
    /// declaration, no layout, and **the type of no node**. It reached the
    /// candidate list because the list is every object type in the snapshot,
    /// and a type table holds more than a program builds.
    ///
    /// Linear in the node count, and paid only where a candidate declares the
    /// key optionally — 208 sites across `runtime/node`, against sites that
    /// answer without asking. Not cached: a cache would be per-builder and a
    /// builder is one function, so it would pay for itself only in a function
    /// with several such sites, and none has more than two.
    pub(super) fn is_the_type_of_some_node(&self, ty: TypeId) -> bool {
        self.snapshot.node_types.values().any(|at| *at == ty)
    }

    /// A type's declared name, where it has one.
    pub(super) fn name_of_type(&self, ty: TypeId) -> Option<&str> {
        let symbol = self.snapshot.types.get(ty.0 as usize)?.symbol?;
        self.snapshot
            .symbols
            .get(symbol.0 as usize)
            .and_then(|record| record.name.public_name())
    }

    pub(super) fn child_slots<const N: usize>(&self, id: NodeId) -> Option<[Option<NodeId>; N]> {
        let NodeData::Children { present, .. } = self.node(id).data else {
            return None;
        };
        let mut children = self.children(id).into_iter().peekable();
        let mut slots = [None; N];
        for (bit, slot) in slots.iter_mut().enumerate() {
            if present & (1 << bit) == 0 {
                continue;
            }
            *slot = children.next();
            // The modifiers are **one slot and any number of children**. Taking
            // one shifted every slot after it, so `public readonly b = "22"`
            // read `readonly` as the name, looked up a field of that name,
            // found none, and dropped the initialiser in silence.
            //
            // One modifier worked and none worked, which is why nothing caught
            // it: every fixture used at most one. `internal/errors.ts` writes
            // `override readonly code = "ERR_..."` on ninety-four classes, and
            // that is where the missing `code` on every compiled error came
            // from -- 792 of node's tests assert one.
            //
            // Only the first slot, and only while the *next* child is also a
            // modifier: a `readonly` in any other position is not one of these.
            if bit == 0
                && slot.is_some_and(|first| self.kind_of(first).is_some_and(syntax::is_modifier))
            {
                while children
                    .peek()
                    .and_then(|next| self.kind_of(*next))
                    .is_some_and(syntax::is_modifier)
                {
                    children.next();
                }
            }
        }
        Some(slots)
    }

    /// The function, method or arrow a node sits inside.
    pub(super) fn enclosing_callable(&self, id: NodeId) -> Option<NodeId> {
        let mut at = self.node(id).parent;
        for _ in 0..64 {
            let here = at?;
            if matches!(
                self.kind_of(here),
                Some(
                    syntax::FUNCTION_DECLARATION
                        | syntax::METHOD_DECLARATION
                        | syntax::ARROW_FUNCTION
                        | syntax::CONSTRUCTOR
                        // An accessor and a function expression are callables
                        // too, and leaving them out did not make this answer
                        // `None` -- it made it answer for the *next* function
                        // outwards.
                        //
                        // `get n(): number | undefined { return c ? this.n :
                        // undefined; }` refused with "`null` or `undefined`
                        // where what it stands in for is not a reference",
                        // while the identical body written as a method
                        // compiled. The Node lane counted 59 occurrences in
                        // `fs` and reduced it to exactly that pair: same body,
                        // same return type, same class, and a getter that never
                        // mentions `this` refuses too.
                        //
                        // The message sends the reader to widen a
                        // representation that was already wide enough. There
                        // was no representation: `contextual_type` walked past
                        // the getter, found no enclosing callable, and returned
                        // `None` -- so `undefined` had nothing to stand in for
                        // rather than the wrong thing.
                        //
                        // `first_this` forty lines up already spells the whole
                        // set, accessors and function expressions included. Two
                        // lists of one fact, and this was the short one.
                        | syntax::GET_ACCESSOR
                        | syntax::SET_ACCESSOR
                        | syntax::FUNCTION_EXPRESSION
                )
            ) {
                return Some(here);
            }
            at = self.node(here).parent;
        }
        None
    }
}

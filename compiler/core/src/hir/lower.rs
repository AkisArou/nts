//! Lowering a semantic snapshot into HIR.
//!
//! # Scope
//!
//! The first slice: functions, parameters, literals, binary arithmetic, and
//! `return`. Enough to carry a program end to end through a backend, which is
//! what makes the next design decisions answerable by a consumer rather than
//! guessed at.
//!
//! Anything outside it is refused rather than approximated. RFC §4.1 requires
//! that unsupported *reachable* behavior produce a precise diagnostic, and a
//! lowering that silently emits nothing for a statement it did not understand
//! produces a program that runs and is wrong.

use nts_diagnostics::{Diagnostic, Location};
use nts_semantic_schema::{
    LiteralValue, NodeData, NodeId, NodeKind, Origin, SemanticSnapshot, TypeId, TypeKind, syntax,
};

use super::facts::Facts;
use super::{
    BinOp, Block, BlockId, Callee, Field, Func, HirType, Layout, ManagedType, Op, OpKind, Param,
    Program, Terminator, UnOp, ValueId,
};

/// What a lowering produced, and what it could not.
#[derive(Debug, Default)]
pub struct Lowered {
    pub program: Program,
    /// Constructs the lowering did not understand.
    ///
    /// Collected rather than returned as an error so one run reports every
    /// unsupported construct instead of the first.
    pub diagnostics: Vec<Diagnostic>,
}

impl Lowered {
    /// Whether anything was refused.
    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.diagnostics.is_empty()
    }
}

/// What a module declares outside any function.
///
/// Two maps rather than one, because the two are not the same thing. A `const`
/// with a constant initializer is resolved to its value at each use, so it costs
/// nothing and reads like an immediate; a `let` is storage that every function
/// shares.
#[derive(Debug, Clone, Default)]
struct ModuleScope {
    /// Symbol to value, for a `const` this could evaluate.
    constants: rustc_hash::FxHashMap<u32, f64>,
    /// Symbol to index in [`Program::globals`].
    variables: rustc_hash::FxHashMap<u32, u32>,
    /// The type of each global, by the same index.
    types: Vec<HirType>,
    /// The globals themselves, handed to the program once collection is done.
    globals: Vec<super::Global>,
    /// Symbols this declares but cannot represent, and why.
    ///
    /// Kept rather than refused on sight. A module-scope variable no function
    /// reads costs nothing and should be refused by nothing -- and a corpus of
    /// real files is mostly declarations that the file under test never touches.
    /// Reporting them eagerly took the share of TypeScript's own test cases that
    /// lower completely from 54 files to 25.
    unsupported: rustc_hash::FxHashMap<u32, String>,
}

/// The class hierarchy, as far as method dispatch needs it.
///
/// The checker's property list is flattened, so a derived type's members give no
/// hint which class declared them -- and the name of the function to call is
/// exactly "the class that declared it". This recovers that, and answers the
/// other question a call site has to ask: whether anything overrides the method,
/// because a method nothing overrides is a static call and a method something
/// overrides is not.
#[derive(Debug, Clone, Default)]
struct Hierarchy {
    /// A class's superclass, by instance type.
    base: rustc_hash::FxHashMap<TypeId, TypeId>,
    /// The methods a class declares itself, as opposed to inherits.
    declares: rustc_hash::FxHashMap<TypeId, Vec<String>>,
    /// A class's name, which is half of the function name a call emits.
    name: rustc_hash::FxHashMap<TypeId, String>,
    /// The dispatch slot of each overridden method, keyed by the class that
    /// *first* declares it.
    ///
    /// Keyed by the root rather than by the overrider, because a slot has to
    /// mean the same thing everywhere in a hierarchy: a `Shape*` and a
    /// `Square*` both look up `area` at the same index, which is the whole
    /// mechanism.
    slots: rustc_hash::FxHashMap<(TypeId, String), u32>,
    /// The classes that declare a constructor.
    ///
    /// A class without one has nothing to run at `new`: the allocation is
    /// zeroed and that is the whole of it. Calling a constructor that was never
    /// declared is a link error, and an implicit one that forwards to a base's
    /// is a call to *the base's* rather than to a function of its own.
    constructs: rustc_hash::FxHashSet<TypeId>,
    /// The one slot every closure's `call` goes in, where the program has
    /// closures at all.
    ///
    /// One rather than one per function type, because there is nothing to tell
    /// apart: a class is never also a closure, and a call through the slot
    /// spells the signature it is making, so two closure types sharing an index
    /// cannot be confused for each other. A slot per type would make every
    /// dispatch table in the program as long as the number of function types in
    /// it, for no distinction anyone can observe.
    closure_slot: Option<u32>,
}

impl Hierarchy {
    /// The nearest class at or above `ty` that declares `member`.
    fn declaring(&self, ty: TypeId, member: &str) -> Option<TypeId> {
        let mut at = Some(ty);
        // Bounded, because a hierarchy that contains a cycle is not one and
        // walking it would not stop.
        for _ in 0..64 {
            let here = at?;
            if self
                .declares
                .get(&here)
                .is_some_and(|names| names.iter().any(|name| name == member))
            {
                return Some(here);
            }
            at = self.base.get(&here).copied();
        }
        None
    }

    /// The highest class at or above `ty` that declares `member`.
    ///
    /// The slot belongs to this one. `declaring` finds the *implementation* to
    /// call; this finds the class the slot is numbered against.
    fn root_declaring(&self, ty: TypeId, member: &str) -> Option<TypeId> {
        let mut found = None;
        let mut at = Some(ty);
        for _ in 0..64 {
            let Some(here) = at else { break };
            if self
                .declares
                .get(&here)
                .is_some_and(|names| names.iter().any(|name| name == member))
            {
                found = Some(here);
            }
            at = self.base.get(&here).copied();
        }
        found
    }

    /// How many slots a dispatch table has.
    fn table_size(&self) -> usize {
        self.slots.len() + usize::from(self.closure_slot.is_some())
    }

    /// The nearest class at or above `ty` that declares a constructor.
    fn constructor(&self, ty: TypeId) -> Option<TypeId> {
        let mut at = Some(ty);
        for _ in 0..64 {
            let here = at?;
            if self.constructs.contains(&here) {
                return Some(here);
            }
            at = self.base.get(&here).copied();
        }
        None
    }

    /// The dispatch slot a call on `ty` would use, if it needs one.
    fn slot_for(&self, ty: TypeId, member: &str) -> Option<u32> {
        let root = self.root_declaring(ty, member)?;
        self.slots.get(&(root, member.to_owned())).copied()
    }

    /// Whether `ty` is `ancestor` or descends from it.
    fn descends_from(&self, ty: TypeId, ancestor: TypeId) -> bool {
        let mut at = Some(ty);
        for _ in 0..64 {
            let Some(here) = at else { return false };
            if here == ancestor {
                return true;
            }
            at = self.base.get(&here).copied();
        }
        false
    }

    /// Whether a call on a receiver of type `ty` could reach more than one
    /// implementation of `member`.
    ///
    /// True exactly when some class below `ty` declares it and is not the one
    /// `ty` itself would reach. That is the whole condition for needing dynamic
    /// dispatch, and it is why a class hierarchy with no overriding costs
    /// nothing: every call in it is static.
    fn overridden(&self, ty: TypeId, member: &str) -> bool {
        let Some(target) = self.declaring(ty, member) else {
            return false;
        };
        self.declares.iter().any(|(class, names)| {
            *class != target
                && names.iter().any(|name| name == member)
                && self.descends_from(*class, ty)
        })
    }
}

/// Which class declarations are generic, and what each was instantiated at.
///
/// Keyed by the declaration rather than by its symbol, because the lowering
/// walks nodes.
fn generic_classes(
    snapshot: &SemanticSnapshot,
) -> rustc_hash::FxHashMap<NodeId, Vec<super::generics::Instantiation>> {
    let by_symbol = super::generics::instantiations(snapshot);
    let probe = FuncBuilder::new(snapshot);
    snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| node.kind == NodeKind::Syntax(syntax::CLASS_DECLARATION))
        .filter_map(|(index, _)| {
            let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
            let symbol = probe
                .children(id)
                .into_iter()
                .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
                .and_then(|child| probe.node(child).symbol)?;
            Some((id, by_symbol.get(&symbol)?.clone()))
        })
        .collect()
}

/// Read every class declaration's name, base and own methods.
fn collect_hierarchy(snapshot: &SemanticSnapshot, closures: &[ClosureInfo]) -> Hierarchy {
    let mut hierarchy = Hierarchy::default();
    let probe = FuncBuilder::new(snapshot);
    let instantiations = super::generics::instantiations(snapshot);

    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::CLASS_DECLARATION) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let Some(declared) = snapshot.node_types.get(&id).copied() else {
            continue;
        };
        // A generic class's facts belong to each *instantiation*, because that
        // is the type a `new` and a method call name. The declaration's own type
        // is never constructed and never laid out.
        let types: Vec<TypeId> = probe
            .children(id)
            .into_iter()
            .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| probe.node(child).symbol)
            .and_then(|symbol| instantiations.get(&symbol))
            .map_or_else(
                || vec![declared],
                |instances| instances.iter().map(|instance| instance.ty).collect(),
            );

        for ty in types {
            if let Some(name) = probe
                .children(id)
                .into_iter()
                .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
                .and_then(|child| probe.node(child).text.clone())
            {
                // Qualified for an instantiation, by the same construction
                // `layout_of` uses: a call site names its callee through this
                // map and the function was named through that one, so the two
                // have to agree letter for letter.
                hierarchy
                    .name
                    .insert(ty, format!("{name}{}", instantiation_suffix(snapshot, ty)));
            }
            // `extends` first, then `implements`, and a class extends at most one
            // class. An interface contributes no implementation, so it is not a
            // base for dispatch even though it is one for assignability.
            if let Some(base) = snapshot.base_types.get(&ty).and_then(|bases| bases.first()) {
                hierarchy.base.insert(ty, *base);
            }

            let declared_methods: Vec<String> = probe
                .children(id)
                .into_iter()
                .filter(|child| probe.kind_of(*child) == Some(syntax::METHOD_DECLARATION))
                .filter_map(|child| {
                    probe
                        .children(child)
                        .into_iter()
                        .find(|part| probe.kind_of(*part) == Some(syntax::IDENTIFIER))
                        .and_then(|part| probe.node(part).text.clone())
                })
                .collect();
            if probe
                .children(id)
                .into_iter()
                .any(|child| probe.kind_of(child) == Some(syntax::CONSTRUCTOR))
            {
                hierarchy.constructs.insert(ty);
            }
            hierarchy.declares.insert(ty, declared_methods.clone());
        }
    }

    // A slot for every method something overrides, numbered against the class
    // that first declares it. A method nothing overrides gets none, which is why
    // a hierarchy with no overriding pays nothing: every call in it is static
    // and no class carries a table.
    let mut roots: Vec<(TypeId, String)> = Vec::new();
    for (class, names) in &hierarchy.declares {
        for name in names {
            let Some(root) = hierarchy.root_declaring(*class, name) else {
                continue;
            };
            if hierarchy.overridden(root, name) && !roots.contains(&(root, name.clone())) {
                roots.push((root, name.clone()));
            }
        }
    }
    // Sorted, so one compiler on one input numbers the slots one way.
    roots.sort_by(|a, b| a.0.0.cmp(&b.0.0).then_with(|| a.1.cmp(&b.1)));
    for (at, key) in roots.into_iter().enumerate() {
        hierarchy
            .slots
            .insert(key, u32::try_from(at).unwrap_or(u32::MAX));
    }
    // One more slot on the end, if anything in the program is a closure. A
    // program with none carries no table at all, which is what it should carry.
    if closures.iter().any(|closure| closure.refusal.is_none()) {
        hierarchy.closure_slot = Some(u32::try_from(hierarchy.slots.len()).unwrap_or(u32::MAX));
    }
    hierarchy
}

/// One arrow function, and what its body reads from the scope around it.
///
/// # Why a closure is an object
///
/// A closure is captured state plus code. So is an object. Saying so rather
/// than inventing a second mechanism means a closure gets the object machinery
/// exactly as written: a base-first layout, escape analysis that leaves it in
/// the frame when it does not outlive the call, reference counting with the
/// same rules as everything else, and dispatch through a slot. None of the four
/// needed a line of new code.
///
/// The class is the compiler's own -- the checker has a type for the
/// *signature*, which is what a value holding the closure is declared as, but
/// nothing for the thing that carries the captures.
#[derive(Clone, Debug)]
struct ClosureInfo {
    /// The arrow function node.
    node: NodeId,
    /// What the body reads from outside itself, in a fixed order.
    captures: Vec<Capture>,
    /// Why it cannot be lowered, if it cannot.
    ///
    /// Recorded here rather than raised here, so that a program containing one
    /// closure this does not handle still compiles the rest -- and so the
    /// reason is reported at the arrow rather than at whatever read it.
    refusal: Option<&'static str>,
}

/// A name the closure body reads and the enclosing scope binds.
#[derive(Clone, Debug)]
struct Capture {
    symbol: u32,
    /// The field name, which is the source name: a dump of the layout should
    /// read like the program.
    name: String,
    /// A node that reads it, for the type and for a diagnostic's location.
    at: NodeId,
}

/// The type id of the `n`th closure class.
///
/// Synthetic. The checker's type for an arrow is its signature; the class that
/// carries what it captured is this compiler's own construction and needs an
/// identity to hang a layout on. Numbered down from the top, so it cannot
/// collide with anything the snapshot assigned.
fn closure_type(index: usize) -> TypeId {
    let id = u32::MAX - u32::try_from(index).unwrap_or(0);
    debug_assert!(
        id >= super::SYNTHETIC_TYPE_FLOOR,
        "more closures than the synthetic id space holds",
    );
    TypeId(id)
}

/// The name of the `n`th closure's class, and of its one method.
fn closure_names(index: usize) -> (String, String) {
    let class = format!("Closure{index}");
    let method = format!("{class}#call");
    (class, method)
}

/// The class name behind a synthetic closure type id.
///
/// The inverse of [`closure_type`], for the passes that meet the id rather than
/// the arrow it came from.
#[must_use]
pub fn closure_class(ty: TypeId) -> String {
    closure_names((u32::MAX - ty.0) as usize).0
}

/// The one method a closure class implements.
#[must_use]
pub fn closure_method(ty: TypeId) -> String {
    closure_names((u32::MAX - ty.0) as usize).1
}

/// Find every arrow function and work out what it captures.
///
/// This runs before any lowering because both sides have to agree: the
/// enclosing function writes the captures into the object in this order, and
/// the closure body reads them back from the same fields.
fn collect_closures(snapshot: &SemanticSnapshot) -> Vec<ClosureInfo> {
    let probe = FuncBuilder::new(snapshot);

    // A variable that is *ever* assigned cannot be captured, because this
    // captures by value and JavaScript captures by reference. For a name
    // nothing writes to the two are the same thing; for one something writes to
    // they are observably different, and quietly picking the wrong one would
    // make a program compute a stale answer rather than fail to compile.
    let mut assigned = Vec::new();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind == NodeKind::Syntax(syntax::SOURCE_FILE) {
            probe.assigned_symbols(
                NodeId(u32::try_from(index).unwrap_or(u32::MAX)),
                &mut assigned,
            );
        }
    }

    let mut closures = Vec::new();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::ARROW_FUNCTION) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let mut info = ClosureInfo {
            node: id,
            captures: Vec::new(),
            refusal: None,
        };

        let mut subtree = Vec::new();
        probe.subtree(id, &mut subtree);
        for read in &subtree {
            let Some(symbol) = probe.node(*read).symbol else {
                continue;
            };
            if probe.kind_of(*read) != Some(syntax::IDENTIFIER) {
                continue;
            }
            // The name after a dot is a property, not a binding, and so is the
            // key of `{ x: 1 }`. Both have symbols, and both are declared
            // outside the arrow, so without this they would look like captures.
            if probe.names_a_member(*read) {
                continue;
            }
            if info.captures.iter().any(|had| had.symbol == symbol.0) {
                continue;
            }
            let Some(record) = snapshot.symbols.get(symbol.0 as usize) else {
                continue;
            };
            // Nothing to capture: a name declared outside the decoded files, or
            // one the arrow declares itself.
            if record.declarations.is_empty()
                || record
                    .declarations
                    .iter()
                    .any(|declaration| subtree.contains(declaration))
            {
                continue;
            }
            // A function or a class is reached by name, not through a field.
            // There is one of it for the whole program, so copying a pointer to
            // it into every closure would be storage for nothing.
            if record.declarations.iter().any(|declaration| {
                matches!(
                    probe.kind_of(*declaration),
                    Some(syntax::FUNCTION_DECLARATION | syntax::CLASS_DECLARATION)
                )
            }) {
                continue;
            }
            if assigned.contains(&symbol.0) {
                info.refusal = Some(
                    "a closure over a variable something assigns to; this captures \
                     by value and JavaScript captures by reference, and for a name \
                     something writes to those differ",
                );
                break;
            }
            info.captures.push(Capture {
                symbol: symbol.0,
                name: record.name.clone(),
                at: *read,
            });
        }
        closures.push(info);
    }
    closures
}

/// Collect what a module declares outside any function.
///
/// Scalars only. A managed global is a *root* -- reachable without being on any
/// stack -- so a collector has to be told about it, and RFC §10.2 puts root
/// registration in the memory provider rather than in a backend. Until that
/// exists, refusing is better than a global nothing traces.
///
/// An initializer that is not a constant is refused for a different reason:
/// running it needs a module initializer, which is a real thing to design (what
/// order, and what happens when one throws) rather than something to improvise
/// here.
fn collect_module_scope(snapshot: &SemanticSnapshot) -> ModuleScope {
    let mut scope = ModuleScope::default();
    let probe = FuncBuilder::new(snapshot);

    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::VARIABLE_DECLARATION) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        // Inside a function, and therefore an ordinary local.
        if probe.is_within_a_function(id) {
            continue;
        }

        let children = probe.children(id);
        let Some(name_node) = children
            .iter()
            .find(|child| probe.kind_of(**child) == Some(syntax::IDENTIFIER))
        else {
            continue;
        };
        let Some(symbol) = probe.node(*name_node).symbol else {
            continue;
        };
        let Some(initializer) = children.iter().rev().find(|child| {
            **child != *name_node && probe.kind_of(**child) != Some(syntax::IDENTIFIER)
        }) else {
            scope.unsupported.insert(
                symbol.0,
                "a module-scope variable with no initializer".to_owned(),
            );
            continue;
        };

        let Some(value) = probe.constant_value(*initializer, &scope.constants) else {
            scope.unsupported.insert(
                symbol.0,
                "a module-scope variable whose initializer is not constant".to_owned(),
            );
            continue;
        };
        let Some(ty) = probe.type_of(*name_node) else {
            scope.unsupported.insert(
                symbol.0,
                "a module-scope variable of unrepresentable type".to_owned(),
            );
            continue;
        };
        if !ty.is_scalar() {
            scope.unsupported.insert(
                symbol.0,
                "a module-scope variable holding a reference".to_owned(),
            );
            continue;
        }

        // `const` is a value, not storage. The kind lives on the enclosing
        // `VariableDeclarationList`, which is the declaration's parent -- except
        // when the encoder wraps the list in a `VariableStatement`, so the flags
        // are taken from whichever ancestor is the list.
        let kind = probe
            .ancestor(id, syntax::VARIABLE_DECLARATION_LIST)
            .map_or(nts_semantic_schema::VariableKind::Var, |list| {
                nts_semantic_schema::VariableKind::from_flags(probe.node(list).flags)
            });
        if kind == nts_semantic_schema::VariableKind::Const {
            scope.constants.insert(symbol.0, value);
            continue;
        }

        let global = u32::try_from(scope.globals.len()).unwrap_or(u32::MAX);
        scope.globals.push(super::Global {
            name: probe
                .node(*name_node)
                .text
                .clone()
                .unwrap_or_else(|| format!("global{global}")),
            ty: ty.clone(),
            initial: value,
            exported: false,
            origin: probe.origin(*name_node),
        });
        scope.variables.insert(symbol.0, global);
        scope.types.push(ty);
    }
    scope
}

/// Lower every function declaration in a snapshot.
#[must_use]
pub fn lower(snapshot: &SemanticSnapshot) -> Lowered {
    let mut lowered = Lowered::default();
    let module = collect_module_scope(snapshot);
    let closures = collect_closures(snapshot);
    let hierarchy = collect_hierarchy(snapshot, &closures);
    lowered.program.globals.clone_from(&module.globals);
    let mut wanted: std::collections::BTreeSet<usize> = std::collections::BTreeSet::new();

    let generic = generic_classes(snapshot);

    for (index, node) in snapshot.nodes.iter().enumerate() {
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));

        // A class contributes one function per method and constructor, each
        // taking the instance as its first parameter. There is no dispatch to
        // arrange: the checker resolved every call site, so a method call is a
        // static call and `this` is an ordinary argument.
        if node.kind == NodeKind::Syntax(syntax::CLASS_DECLARATION) {
            let members: Vec<NodeId> = {
                let probe = FuncBuilder::new(snapshot);
                probe
                    .children(id)
                    .into_iter()
                    .filter(|child| {
                        matches!(
                            probe.kind_of(*child),
                            Some(syntax::METHOD_DECLARATION | syntax::CONSTRUCTOR)
                        )
                    })
                    .collect()
            };
            // A generic class is lowered once per instantiation and not at all
            // as itself: a field of type `T` has no width, and `Vector<Body>`
            // and `Vector<double>` are two classes that happen to share a
            // source. A class with type parameters that nothing instantiates is
            // dead, and lowering it would report a refusal for a program nobody
            // wrote.
            let copies: Vec<(Option<TypeId>, Substitution)> = generic.get(&id).map_or_else(
                || vec![(None, Substitution::default())],
                |instances| {
                    instances
                        .iter()
                        .map(|instance| (Some(instance.ty), instance.substitution.clone()))
                        .collect()
                },
            );

            for (instance, substitution) in copies {
                for &member in &members {
                    let mut builder = FuncBuilder::instantiating(
                        snapshot,
                        module.clone(),
                        hierarchy.clone(),
                        closures.clone(),
                        substitution.clone(),
                    );
                    match builder.lower_method_of(id, member, instance) {
                        Ok(func) => lowered.program.funcs.push(func),
                        Err(diagnostic) => lowered.diagnostics.push(diagnostic),
                    }
                    wanted.extend(builder.used_closures.iter().copied());
                    collect_layouts(&mut lowered.program, builder.layouts);
                }
            }
            continue;
        }

        if node.kind != NodeKind::Syntax(syntax::FUNCTION_DECLARATION) {
            continue;
        }
        // `declare function f(): number` has no body because it is *external*,
        // not because this lowering failed to understand it. Refusing it says
        // the opposite, and -- since a caller of a refused function is refused
        // too -- took every function that reaches the platform with it. An
        // overload signature has the same shape and the same answer: the
        // implementation that follows is the one to lower.
        if !FuncBuilder::new(snapshot).has_a_body(id) {
            continue;
        }
        let mut builder = FuncBuilder::within(
            snapshot,
            module.clone(),
            hierarchy.clone(),
            closures.clone(),
        );
        match builder.lower_function(id) {
            Ok(func) => lowered.program.funcs.push(func),
            Err(diagnostic) => lowered.diagnostics.push(diagnostic),
        }
        wanted.extend(builder.used_closures.iter().copied());
        collect_layouts(&mut lowered.program, builder.layouts);
    }

    // Each closure something allocated, and each as a function of its own.
    // Nothing about it depends on the function that allocates it -- that is the
    // point of putting the captures in an object rather than on a chain of
    // frames.
    //
    // A worklist rather than a pass, because a closure body can allocate
    // another one. Taken in index order, so one compiler on one input emits its
    // functions in one order.
    let mut done: rustc_hash::FxHashSet<usize> = rustc_hash::FxHashSet::default();
    while let Some(index) = wanted.iter().copied().find(|at| !done.contains(at)) {
        done.insert(index);
        let mut builder = FuncBuilder::within(
            snapshot,
            module.clone(),
            hierarchy.clone(),
            closures.clone(),
        );
        match builder.lower_closure(index, &closures[index]) {
            Ok(func) => lowered.program.funcs.push(func),
            Err(diagnostic) => lowered.diagnostics.push(diagnostic),
        }
        wanted.extend(builder.used_closures.iter().copied());
        collect_layouts(&mut lowered.program, builder.layouts);
    }

    canonicalize_objects(&mut lowered.program);
    lowered
}

/// Merge a function's discovered layouts into the program's.
///
/// A layout is a property of the type, not of the function that happened to
/// mention it first.
fn collect_layouts(program: &mut Program, layouts: Vec<Layout>) {
    for layout in layouts {
        if let Some(existing) = program
            .layouts
            .iter_mut()
            .find(|known| known.same_shape(&layout.fields, &layout.methods))
        {
            for ty in layout.types {
                if !existing.types.contains(&ty) {
                    existing.types.push(ty);
                }
            }
            // A declared name beats a generated one, and the two functions that
            // mention a type may be discovered in either order.
            if existing.name.starts_with("Type") && !layout.name.starts_with("Type") {
                existing.name = layout.name;
            }
        } else {
            program.layouts.push(layout);
        }
    }
}

/// Give structurally identical object types one identity.
///
/// TypeScript is structurally typed, so `Point` and the anonymous
/// `{ x: number; y: number }` of a literal returned as one *are* the same type
/// — but the checker gives them different ids, and `HirType` compares by id.
/// Left alone, a `return { x, y }` from a function declared to return `Point`
/// looks like a representation change and earns a conversion between two
/// pointers to the same struct.
///
/// Rewriting every object type to its layout's representative makes `HirType`
/// equality mean what it should: *the same representation*.
fn canonicalize_objects(program: &mut Program) {
    let representatives: Vec<(Vec<TypeId>, TypeId)> = program
        .layouts
        .iter()
        .filter_map(|layout| Some((layout.types.clone(), *layout.types.first()?)))
        .collect();

    let canonical = |ty: &mut HirType| {
        if let HirType::Managed(ManagedType::Object(id)) = ty
            && let Some((_, representative)) = representatives
                .iter()
                .find(|(members, _)| members.contains(id))
        {
            *id = *representative;
        }
    };

    for func in &mut program.funcs {
        canonical(&mut func.return_type);
        for param in &mut func.params {
            canonical(&mut param.ty);
        }
        for value in &mut func.values {
            canonical(&mut value.ty);
        }
    }
}

/// Choose a representation for a source type.
///
/// The decision the whole layer exists to make. Unspecialized, so `number`
/// becomes `f64` — correct, and the thing specialization improves on once
/// analysis can show a value is integral and in range.
/// A JavaScript numeric literal, as the double it denotes.
///
/// Every spelling the language has: decimal with an optional exponent, and
/// `0x`/`0o`/`0b` integers. Numeric separators are removed first — `1_000_000`
/// is the same literal as `1000000`, and only the reader was meant to notice
/// the difference.
///
/// Returns `None` rather than guessing. A `1n` is a `BigInt` and not this, and a
/// spelling that is not here should reach the fallback rather than a wrong
/// number.
#[must_use]
pub fn parse_number(text: &str) -> Option<f64> {
    let text = text.replace('_', "");
    if text.ends_with('n') {
        // A BigInt literal, which is a different type with different arithmetic.
        return None;
    }
    // `get(..2)` and not `[..2]`: `0` is a whole literal and is one byte long.
    let radix = match text
        .get(..2)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "0x" => 16,
        "0o" => 8,
        "0b" => 2,
        _ => {
            // Decimal, where Rust's parser is correctly rounded and is the whole
            // of the answer.
            return text.parse::<f64>().ok();
        }
    };
    // An integer literal in another base. `u128` because `0x` literals wider
    // than `u64` are legal to write; the conversion to `f64` rounds, which is
    // exactly what JavaScript does with an integer above 2^53.
    #[expect(
        clippy::cast_precision_loss,
        reason = "rounding a large integer to the nearest double is the semantics"
    )]
    u128::from_str_radix(&text[2..], radix)
        .ok()
        .map(|value| value as f64)
}

/// A short name for a type, for a diagnostic to quote.
///
/// A refusal that says only "unrepresentable" is not a work queue. Run over a
/// corpus, "a parameter of an unrepresentable type" was the largest bar in the
/// histogram by a factor of two, and it said nothing about what to build. The
/// checker's own rendering is in the snapshot for exactly this.
#[must_use]
/// Whether a union member means "there is no value here".
///
/// All three spellings, because TypeScript uses them interchangeably at a
/// boundary: `void` is what a function returns when it returns nothing, and it
/// appears in a union for the same reason `undefined` does.
fn is_absent(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    snapshot.types.get(ty.0 as usize).is_some_and(|record| {
        matches!(
            record.kind,
            TypeKind::Undefined | TypeKind::Null | TypeKind::Void
        )
    })
}

/// A union member's name, short enough to put several on one line.
fn short(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    let Some(record) = snapshot.types.get(ty.0 as usize) else {
        return "?".to_owned();
    };
    match &record.kind {
        TypeKind::Void => "void".to_owned(),
        TypeKind::Undefined => "undefined".to_owned(),
        TypeKind::Never => "never".to_owned(),
        TypeKind::Boolean => "boolean".to_owned(),
        TypeKind::Number => "number".to_owned(),
        TypeKind::String => "string".to_owned(),
        // A literal's *value* is not what makes a union hard; its
        // representation is. `1 | 2 | 3` and `1 | 2 | 4` are one problem.
        TypeKind::Literal(LiteralValue::Number(_)) => "a number literal".to_owned(),
        TypeKind::Literal(LiteralValue::String(_)) => "a string literal".to_owned(),
        TypeKind::Literal(LiteralValue::Boolean(_)) => "a boolean literal".to_owned(),
        TypeKind::Object { .. } => "an object".to_owned(),
        TypeKind::Array(_) => "an array".to_owned(),
        _ => describe(snapshot, ty),
    }
}

#[must_use]
pub fn describe(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    let Some(record) = snapshot.types.get(ty.0 as usize) else {
        return "an unknown type".to_owned();
    };
    match &record.kind {
        TypeKind::Any => "any".to_owned(),
        TypeKind::Unknown => "unknown".to_owned(),
        TypeKind::Null => "null".to_owned(),
        TypeKind::BigInt => "bigint".to_owned(),
        TypeKind::Symbol => "symbol".to_owned(),
        // Named by its members, because "a union" is a category and the work
        // queue is ordered by what is actually in the corpus. `number |
        // undefined` and `string | number` want different representations, and
        // one refusal message cannot tell them apart.
        TypeKind::Union(members) => {
            let mut named: Vec<String> = members
                .iter()
                .map(|member| short(snapshot, *member))
                .collect();
            named.sort();
            named.dedup();
            format!("a union of {}", named.join(" | "))
        }
        TypeKind::Intersection(_) => "an intersection".to_owned(),
        TypeKind::Tuple(_) => "a tuple".to_owned(),
        TypeKind::Function(_) => "a function type".to_owned(),
        TypeKind::TypeParameter { name, .. } => format!("the type parameter `{name}`"),
        TypeKind::Conditional { .. } => "a conditional type".to_owned(),
        TypeKind::IndexedAccess { .. } => "an indexed access".to_owned(),
        TypeKind::TemplateLiteral { .. } => "a template literal type".to_owned(),
        TypeKind::Object { .. } => "an object type".to_owned(),
        // Worth distinguishing, because the two are refused for entirely
        // different reasons and only one of them is about *this* type. An
        // ordinary array is refused when its element is; `type Tree = Tree[]`
        // is refused because there is no finite `HirType` that spells it.
        TypeKind::Array(_) => {
            if contains_a_cycle(snapshot, ty, &mut Vec::new()) {
                "a recursive array type".to_owned()
            } else {
                "an array type".to_owned()
            }
        }
        TypeKind::Structured { flags } => format!("a structured type (flags {flags:#x})"),
        TypeKind::Unsupported { rendered, .. } => format!("`{rendered}`"),
        TypeKind::Void
        | TypeKind::Undefined
        | TypeKind::Never
        | TypeKind::Boolean
        | TypeKind::Number
        | TypeKind::String
        | TypeKind::Literal(_) => "a representable type".to_owned(),
    }
}

/// Whether following element and member types from here ever revisits a type.
///
/// A *cycle* rather than a return to the starting type: `type Tree = Tree[]`
/// reaches this compiler as an instantiation whose element is the alias whose
/// element is the alias, so the loop that has no finite representation need not
/// pass through the type being asked about. `type A = B[]; type B = A[]` is the
/// same shape with the ids spelled out.
///
/// Only through arrays and unions, which are the two kinds whose representation
/// is built out of another's. An object stops the walk for the reason it
/// terminates in [`representation`]: its representation is a pointer, and a
/// pointer to something that leads back here is an ordinary linked list.
fn contains_a_cycle(snapshot: &SemanticSnapshot, ty: TypeId, path: &mut Vec<TypeId>) -> bool {
    if path.contains(&ty) {
        return true;
    }
    path.push(ty);
    let found = match snapshot.types.get(ty.0 as usize).map(|record| &record.kind) {
        Some(TypeKind::Array(element)) => contains_a_cycle(snapshot, *element, path),
        Some(TypeKind::Union(members)) => members
            .iter()
            .any(|member| contains_a_cycle(snapshot, *member, path)),
        _ => false,
    };
    path.pop();
    found
}

/// `<id>` where a type is a generic *instantiation*, and nothing otherwise.
///
/// The declaration is not one: its arguments are its own type parameters, and
/// it is never laid out — a field of type `T` has no width.
fn instantiation_suffix(snapshot: &SemanticSnapshot, ty: TypeId) -> String {
    let arguments = snapshot.type_arguments.get(&ty);
    let instantiated = arguments.is_some_and(|arguments| {
        !arguments.is_empty()
            && !arguments.iter().all(|argument| {
                matches!(
                    snapshot.types.get(argument.0 as usize).map(|r| &r.kind),
                    Some(TypeKind::TypeParameter { .. })
                )
            })
    });
    if instantiated {
        format!("<{}>", ty.0)
    } else {
        String::new()
    }
}

#[must_use]
pub fn representation(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<HirType> {
    representation_with(snapshot, ty, &Substitution::default())
}

/// What a type parameter stands for, while lowering one instantiation.
///
/// Keyed by the *type parameter's* own [`TypeId`], which is what a body's nodes
/// resolve to: the AST inside a generic method is shared by every
/// instantiation, so the checker leaves `T` there and this is what turns it
/// into the machine type for the copy being lowered.
pub type Substitution = rustc_hash::FxHashMap<TypeId, HirType>;

/// [`representation`], resolving type parameters through a substitution.
#[must_use]
pub fn representation_with(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    subst: &Substitution,
) -> Option<HirType> {
    representation_within(snapshot, ty, &mut Vec::new(), subst)
}

/// [`representation`], refusing a type that contains itself.
///
/// # Why a type can do that at all
///
/// `class Node { next: Node }` is fine and common, and it terminates here
/// because an object's representation is a *pointer* — the arm returns without
/// looking at the fields. `type Tree = Tree[]` does not: an array's
/// representation names its element type, and the element is the array. There
/// is no finite `HirType` for it, so building one recurses until the stack ends.
///
/// # Why refusing is the answer for now and not forever
///
/// The runtime is already more relaxed than this: an array of references uses
/// one descriptor for all of them, because *every* reference is a pointer and
/// the descriptor describes the element's shape rather than what it points at.
/// So a representation exists; what is missing is a way to *spell* it, which
/// means a recursion marker in `HirType` and every pass agreeing about what it
/// means. That is a type-system change and is refused rather than guessed at.
///
/// The list is a path rather than a set: two sibling fields of the same array
/// type are not a cycle, and treating them as one would refuse ordinary code.
fn representation_within(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    path: &mut Vec<TypeId>,
    subst: &Substitution,
) -> Option<HirType> {
    if path.contains(&ty) {
        return None;
    }
    path.push(ty);
    let result = representation_of(snapshot, ty, path, subst);
    path.pop();
    result
}

fn representation_of(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    path: &mut Vec<TypeId>,
    subst: &Substitution,
) -> Option<HirType> {
    let record = snapshot.types.get(ty.0 as usize)?;
    Some(match &record.kind {
        TypeKind::Void | TypeKind::Undefined => HirType::Void,
        TypeKind::Never => HirType::Never,
        // A literal shares its widened type's representation. The literal *value*
        // is still known and can become an immediate; what it cannot have is a
        // representation narrower than the type it widens to.
        TypeKind::Boolean | TypeKind::Literal(LiteralValue::Boolean(_)) => HirType::Bool,
        TypeKind::Number | TypeKind::Literal(LiteralValue::Number(_)) => HirType::NUMBER,
        TypeKind::String | TypeKind::Literal(LiteralValue::String(_)) => {
            HirType::Managed(ManagedType::String)
        }
        TypeKind::Array(element) => {
            let element = representation_within(snapshot, *element, path, subst)?;
            HirType::Managed(ManagedType::Array(Box::new(element)))
        }
        // A function value is an object with one method, which is why it shares
        // this arm rather than getting one. That is not a trick to make it fit:
        // a closure *is* captured state plus code, which is what an object is,
        // and saying so means it gets the object machinery -- a base-first
        // layout, escape analysis that keeps it in the frame when it does not
        // escape, reference counting, and dispatch -- rather than a second
        // mechanism that would need all four again.
        //
        // The layout for the function type itself has no fields. What varies
        // between two closures of one type is what they captured, and that
        // belongs to the closure's own class, which has this one as its base.
        TypeKind::Object { .. } | TypeKind::Function(_) => {
            HirType::Managed(ManagedType::Object(ty))
        }

        // A union whose members all share one representation has that
        // representation. `0 | 1 | 2` is three literal types and one machine
        // type, and refusing it would reject the most useful thing TypeScript
        // can tell this compiler about a parameter.
        //
        // `T | undefined` and `T | null` are what real TypeScript is made of,
        // and for a managed `T` they cost nothing: a reference already has a
        // value that is not an object, and the null pointer is it. So the
        // absent members are dropped and what is left has to agree.
        //
        // A number has no spare value. `number | undefined` needs a tag beside
        // it or a NaN payload inside it, and both change the representation of
        // every number that could reach the slot — so it is refused rather than
        // guessed at, as is any union whose members genuinely disagree.
        TypeKind::Union(members) => {
            let mut shared: Option<HirType> = None;
            let mut absent = false;
            for member in members {
                if is_absent(snapshot, *member) {
                    absent = true;
                    continue;
                }
                let member = representation_within(snapshot, *member, path, subst)?;
                match &shared {
                    Some(existing) if *existing != member => return None,
                    _ => shared = Some(member),
                }
            }
            let shared = shared?;
            // `null | undefined` on its own, or `number | undefined`: nothing
            // left to be, or nowhere to put the absence.
            if absent && !shared.is_managed() {
                return None;
            }
            shared
        }

        // A type parameter has no representation of its own -- that is what
        // makes it one. It has the representation of whatever this instantiation
        // put there, and outside an instantiation there is nothing to say.
        TypeKind::TypeParameter { .. } => subst.get(&ty)?.clone(),

        // `any` and `unknown` fall here and are refused, which is right for one
        // of them and wrong for the other.
        //
        // `docs/any-unknown.md` settles it: `any` is not a runtime type at all
        // and none may reach MIR — application `any` is rejected, while
        // declaration-originated `any` (from `lib.*.d.ts` or `@types`) is tracked
        // as *unchecked* rather than rejected, so the ecosystem stays usable.
        // `unknown`, by contrast, is a fully supported top type that "must not be
        // rejected merely because it requires an erased representation", and its
        // representation is chosen by whole-program analysis — a primitive, a
        // managed reference, a closed union, a handle, or a general erased value,
        // whichever is cheapest across all reachable uses.
        //
        // Refusing `unknown` therefore rejects valid programs today. Implementing
        // it needs the provenance tracking and representation analysis that
        // document describes, not another arm in this match.
        _ => return None,
    })
}

/// A block under construction.
struct PartialBlock {
    params: Vec<ValueId>,
    ops: Vec<ValueId>,
    /// `None` until the block is terminated. A block that reaches its end without
    /// one is still open and will be given a jump or a return.
    terminator: Option<Terminator>,
}

/// Builds one function.
struct FuncBuilder<'a> {
    snapshot: &'a SemanticSnapshot,
    /// Every value the function defines.
    values: Vec<Op>,
    blocks: Vec<PartialBlock>,
    current: BlockId,
    /// Symbol index → the value holding it.
    ///
    /// This is what makes two identifiers with one symbol become one value
    /// rather than two loads.
    bindings: rustc_hash::FxHashMap<u32, ValueId>,
    /// Layouts discovered while lowering this function.
    layouts: Vec<Layout>,
    /// The receiver, in a method.
    this: Option<ValueId>,
    /// What the module declares outside any function.
    module: ModuleScope,
    /// What every class in the program declares, and what it extends.
    hierarchy: Hierarchy,
    /// The class this method's own class extends, if it extends one.
    ///
    /// `super(...)` and `super.m()` name it, and nothing else can: the checker
    /// resolves a `super` call to the base's declaration, but the *name* of the
    /// function to emit is this compiler's own construction.
    base: Option<String>,
    /// Every arrow function in the program, so that one written here can be
    /// matched to the class that was collected for it.
    closures: Vec<ClosureInfo>,
    /// What each type parameter stands for, while lowering one instantiation of
    /// a generic class. Empty everywhere else, which is every function that is
    /// not one of those copies.
    substitution: Substitution,
    /// The type a bare `null` should take, where the caller knows it.
    ///
    /// `contextual_type` recovers this from the tree for the shapes the tree
    /// describes. What it cannot reach is a call whose signature the checker
    /// resolved into `lib.d.ts` -- `piles.fill(null)` is an array method, and
    /// the parameter type is the element type this compiler decided rather
    /// than one any node carries.
    expecting: Option<HirType>,
    /// How many names this lowering has invented.
    ///
    /// A `for...of` needs an index the source does not name, and the loop
    /// machinery is keyed by symbol. Numbering down from the top keeps a
    /// synthetic name from colliding with one the checker assigned.
    synthetic: u32,
    /// Which of them this function allocated.
    ///
    /// A closure nobody creates is not lowered at all. That is the rule
    /// module-scope declarations already follow, for the same reason: a file
    /// that declares one thing this compiler cannot represent should not be
    /// reported as failing on it unless something reaches it.
    used_closures: Vec<usize>,
}

impl<'a> FuncBuilder<'a> {
    fn new(snapshot: &'a SemanticSnapshot) -> Self {
        Self {
            snapshot,
            values: Vec::new(),
            blocks: vec![PartialBlock {
                params: Vec::new(),
                ops: Vec::new(),
                terminator: None,
            }],
            current: BlockId(0),
            bindings: rustc_hash::FxHashMap::default(),
            layouts: Vec::new(),
            this: None,
            hierarchy: Hierarchy::default(),
            base: None,
            module: ModuleScope::default(),
            closures: Vec::new(),
            expecting: None,
            synthetic: 0,
            used_closures: Vec::new(),
            substitution: Substitution::default(),
        }
    }

    /// The same, knowing what the module and its classes declare.
    fn within(
        snapshot: &'a SemanticSnapshot,
        module: ModuleScope,
        hierarchy: Hierarchy,
        closures: Vec<ClosureInfo>,
    ) -> Self {
        Self {
            module,
            hierarchy,
            closures,
            ..Self::new(snapshot)
        }
    }

    /// The same, lowering one instantiation of a generic class.
    fn instantiating(
        snapshot: &'a SemanticSnapshot,
        module: ModuleScope,
        hierarchy: Hierarchy,
        closures: Vec<ClosureInfo>,
        substitution: Substitution,
    ) -> Self {
        Self {
            substitution,
            ..Self::within(snapshot, module, hierarchy, closures)
        }
    }

    /// Add a parameter to a block and return the value it defines.
    ///
    /// A block parameter is a value like any other, but it belongs to the block
    /// rather than to the operation list — nothing computes it, a predecessor
    /// supplies it.
    fn push_block_param(&mut self, block: BlockId, ty: HirType, origin: Origin) -> ValueId {
        let index = u32::try_from(self.blocks[block.0 as usize].params.len()).unwrap_or(0);
        let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op {
            kind: OpKind::BlockParam(index),
            ty,
            origin,
        });
        self.blocks[block.0 as usize].params.push(id);
        id
    }

    /// Start a new block and return its id. Does not switch to it.
    fn new_block(&mut self) -> BlockId {
        self.blocks.push(PartialBlock {
            params: Vec::new(),
            ops: Vec::new(),
            terminator: None,
        });
        BlockId(u32::try_from(self.blocks.len() - 1).unwrap_or(u32::MAX))
    }

    fn switch_to(&mut self, block: BlockId) {
        self.current = block;
    }

    /// Whether the current block has already ended.
    ///
    /// A `return` inside a branch terminates its block, and appending a jump
    /// after it would put two terminators in one block.
    fn is_terminated(&self) -> bool {
        self.blocks[self.current.0 as usize].terminator.is_some()
    }

    /// End the current block, unless something already did.
    fn terminate(&mut self, terminator: Terminator) {
        let block = &mut self.blocks[self.current.0 as usize];
        if block.terminator.is_none() {
            block.terminator = Some(terminator);
        }
    }

    fn node(&self, id: NodeId) -> &'a nts_semantic_schema::NodeRecord {
        &self.snapshot.nodes[id.0 as usize]
    }

    fn origin(&self, id: NodeId) -> Origin {
        self.node(id).origin.clone()
    }

    fn location(&self, id: NodeId) -> Location {
        self.node(id).origin.location
    }

    /// Children, with list nodes flattened away.
    ///
    /// A `NodeList` is an encoding artifact rather than a construct, so it is not
    /// something the lowering should have to know about at every step.
    fn children(&self, id: NodeId) -> Vec<NodeId> {
        self.node(id)
            .children
            .iter()
            .flat_map(|child| {
                let node = self.node(*child);
                if node.kind == NodeKind::List {
                    node.children.clone()
                } else {
                    vec![*child]
                }
            })
            .collect()
    }

    /// Every node at or below `id`, in source order.
    fn subtree(&self, id: NodeId, into: &mut Vec<NodeId>) {
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
    fn names_a_member(&self, id: NodeId) -> bool {
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

    fn kind_of(&self, id: NodeId) -> Option<u16> {
        match self.node(id).kind {
            NodeKind::Syntax(kind) => Some(kind),
            NodeKind::List => None,
        }
    }

    /// What a function declaration returns.
    ///
    /// From its *signature*, not from an annotation node. Reading the annotation
    /// works for `function f(): number` and silently gives `void` for
    /// `function f()` -- so an un-annotated function had its result dropped, in
    /// the generated C and in every analysis. TypeScript infers a return type
    /// whether or not one is written down, and the inferred one is in the
    /// snapshot exactly like the written one.
    fn declared_return(&self, id: NodeId) -> Option<HirType> {
        if let Some(ty) = self.snapshot.node_types.get(&id)
            && let Some(record) = self.snapshot.types.get(ty.0 as usize)
            && let nts_semantic_schema::TypeKind::Function(signature) = record.kind
            && let Some(signature) = self.snapshot.signatures.get(signature.0 as usize)
            && let Some(returned) = self.represent(signature.return_type)
        {
            return Some(returned);
        }

        // No decomposed signature. That does not happen under the frontend
        // configuration the compiler uses, and does happen under a lighter one,
        // so the written annotation is read instead -- which is what this did
        // before, and is right whenever there is one.
        let body = self
            .children(id)
            .into_iter()
            .rev()
            .find(|child| self.kind_of(*child) == Some(syntax::BLOCK));
        self.children(id)
            .into_iter()
            .filter(|child| {
                !matches!(
                    self.kind_of(*child),
                    Some(syntax::PARAMETER | syntax::IDENTIFIER)
                ) && Some(*child) != body
            })
            .find_map(|child| self.type_of(child))
    }

    /// Make sure an object type has a layout, because a signature mentions it.
    ///
    /// A layout is otherwise discovered by whatever *constructs* the object,
    /// and a function that only receives or returns one constructs nothing. A
    /// function type is the case that made this visible: no program ever
    /// constructs a signature, only closures that have it as their base.
    fn materialize(&mut self, at: NodeId, ty: &HirType) -> Result<(), Diagnostic> {
        if let HirType::Managed(ManagedType::Object(object)) = ty {
            self.layout_of(at, *object)?;
        }
        Ok(())
    }

    /// Whether an expression's type is a signature -- so its value is a closure.
    fn is_function_typed(&self, id: NodeId) -> bool {
        self.snapshot
            .node_types
            .get(&id)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .is_some_and(|record| matches!(record.kind, TypeKind::Function(_)))
    }

    /// Whether a callee names a function or class declaration rather than a
    /// value that happens to hold one.
    ///
    /// This is what separates `f(x)` the static call from `f(x)` the dispatch,
    /// and it is a question about the *declaration*, not about the spelling. A
    /// name with no declaration at all is one this compilation cannot see, which
    /// means an import: a direct call to a definition the linker supplies.
    fn names_a_declared_function(&self, id: NodeId) -> bool {
        let Some(symbol) = self.node(id).symbol else {
            return false;
        };
        // A local binding shadows nothing here -- a parameter and a function
        // declaration never share a symbol -- but if the name is bound to a
        // value in this frame, that value is what is being called.
        if self.bindings.contains_key(&symbol.0) {
            return false;
        }
        let Some(record) = self.snapshot.symbols.get(symbol.0 as usize) else {
            return false;
        };
        record.declarations.is_empty()
            || record.declarations.iter().any(|declaration| {
                matches!(
                    self.kind_of(*declaration),
                    Some(
                        syntax::FUNCTION_DECLARATION
                            | syntax::CLASS_DECLARATION
                            | syntax::METHOD_DECLARATION
                            | syntax::METHOD_SIGNATURE
                    )
                )
            })
    }

    fn type_of(&self, id: NodeId) -> Option<HirType> {
        let ty = self.snapshot.node_types.get(&id)?;
        self.represent(*ty)
    }

    /// A type's machine representation, with this instantiation's substitution
    /// applied. The one place the two are combined.
    fn represent(&self, ty: TypeId) -> Option<HirType> {
        representation_with(self.snapshot, ty, &self.substitution)
    }

    fn push(&mut self, kind: OpKind, ty: HirType, origin: Origin) -> ValueId {
        let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op { kind, ty, origin });
        self.blocks[self.current.0 as usize].ops.push(id);
        id
    }

    /// Refuse, naming the type that could not be represented.
    fn unrepresentable(&self, id: NodeId, what: &str) -> Diagnostic {
        let named = self.snapshot.node_types.get(&id).map_or_else(
            || "an untyped node".to_owned(),
            |ty| describe(self.snapshot, *ty),
        );
        self.unsupported(id, &format!("{what} of unrepresentable type ({named})"))
    }

    /// The nearest ancestor of a given kind.
    fn ancestor(&self, id: NodeId, kind: u16) -> Option<NodeId> {
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
    fn is_within_a_function(&self, id: NodeId) -> bool {
        let mut at = self.node(id).parent;
        while let Some(parent) = at {
            if matches!(
                self.kind_of(parent),
                Some(
                    syntax::FUNCTION_DECLARATION | syntax::METHOD_DECLARATION | syntax::CONSTRUCTOR
                )
            ) {
                return true;
            }
            at = self.node(parent).parent;
        }
        false
    }

    /// An expression's value, when it is one the checker or this compiler can
    /// work out without running anything.
    /// What an expression is worth at compile time, if anything.
    ///
    /// `known` is the module-scope constants declared *before* this one, and
    /// that is the right set rather than a convenient one: JavaScript gives
    /// `const` a temporal dead zone, so an initializer naming a later `const` is
    /// a run-time error rather than a program with a value to fold. Empty for
    /// every caller that is not collecting module scope.
    fn constant_value(&self, id: NodeId, known: &rustc_hash::FxHashMap<u32, f64>) -> Option<f64> {
        match self.kind_of(id) {
            // A boolean's storage is its truth value. `Global::ty` says which of
            // the two a zero means.
            Some(syntax::TRUE_KEYWORD) => Some(1.0),
            Some(syntax::FALSE_KEYWORD) => Some(0.0),
            Some(syntax::NUMERIC_LITERAL) => self
                .node(id)
                .text
                .as_deref()
                .and_then(parse_number)
                .or_else(|| match self.snapshot.constants.get(&id) {
                    Some(nts_semantic_schema::ConstantValue::Number(value)) => Some(*value),
                    _ => None,
                }),
            Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                let NodeData::Children { small, .. } = self.node(id).data else {
                    return None;
                };
                let inner = self.constant_value(*self.children(id).first()?, known)?;
                match small & syntax::prefix_operator::MASK {
                    syntax::prefix_operator::MINUS => Some(-inner),
                    syntax::prefix_operator::PLUS => Some(inner),
                    _ => None,
                }
            }
            // Arithmetic on two constants is a constant. Worth folding here
            // because a module-scope initializer has nowhere to run: it is a
            // static initializer in the emitted C, so `4 * PI * PI` is either
            // computed now or refused, and refusing it means a program cannot
            // name a derived constant.
            //
            // In `f64` and in the source's order, because that is what the
            // program would compute at run time -- floating-point addition does
            // not reassociate, and a fold that gets a different answer than the
            // code it replaces is not a fold.
            Some(syntax::BINARY_EXPRESSION) => {
                let children = self.children(id);
                let [lhs, operator, rhs] = children.as_slice() else {
                    return None;
                };
                let lhs = self.constant_value(*lhs, known)?;
                let rhs = self.constant_value(*rhs, known)?;
                match self.kind_of(*operator)? {
                    syntax::PLUS_TOKEN => Some(lhs + rhs),
                    syntax::MINUS_TOKEN => Some(lhs - rhs),
                    syntax::ASTERISK_TOKEN => Some(lhs * rhs),
                    syntax::SLASH_TOKEN => Some(lhs / rhs),
                    _ => None,
                }
            }
            // A name that is itself a module-scope constant. `SOLAR_MASS` is
            // `4 * PI * PI`, and a compiler that folds arithmetic but not names
            // folds nothing anyone writes.
            Some(syntax::IDENTIFIER) => self
                .node(id)
                .symbol
                .and_then(|symbol| known.get(&symbol.0).copied()),
            _ => match self.snapshot.constants.get(&id) {
                Some(nts_semantic_schema::ConstantValue::Number(value)) => Some(*value),
                _ => None,
            },
        }
    }

    /// Whether a declaration carries an implementation.
    ///
    /// What separates a function this program *defines* from one it only names:
    /// an ambient `declare`, an overload signature, and a method signature on an
    /// interface all lack one.
    fn has_a_body(&self, id: NodeId) -> bool {
        self.children(id)
            .into_iter()
            .any(|child| self.kind_of(child) == Some(syntax::BLOCK))
    }

    fn unsupported(&self, id: NodeId, what: &str) -> Diagnostic {
        Diagnostic::error(
            "NTS1001",
            format!("{what} is not supported by this lowering yet"),
            self.location(id),
        )
    }

    /// One method or constructor of a class, as a function taking the instance.
    ///
    /// There is no dispatch to arrange. The checker resolved every call site, so
    /// `c.advance()` names one target and lowers to a static call with `c` as
    /// the first argument — which is what a method *is* once the receiver is
    /// explicit. A vtable only becomes necessary where a call site has more than
    /// one possible target, and TypeScript tells us when that is.
    /// One method, of one class — or of one *instantiation* of a generic class,
    /// which is a different class with the same source.
    ///
    /// `instance` is the instantiated object type. Its properties the checker
    /// already substituted, so the layout needs nothing; what needs the
    /// substitution this builder carries is the body, whose nodes are shared
    /// with every other copy.
    fn lower_method_of(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<Func, Diagnostic> {
        let class_name = match instance {
            // The layout's name rather than the declaration's, because two
            // instantiations of one class must not produce one function.
            Some(ty) => self.layout_of(class, ty)?.name,
            None => self
                .children(class)
                .into_iter()
                .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
                .and_then(|child| self.node(child).text.clone())
                .ok_or_else(|| self.unsupported(class, "an anonymous class"))?,
        };

        // A static method has no receiver: it is a namespaced function, and its
        // call sites name the class rather than an instance. So it is lowered
        // without the `this` parameter, and without a slot -- nothing overrides
        // a static method, because a call site names the class it is written on.
        let modifiers = self.node(member).modifiers;
        let is_static = modifiers.contains(nts_semantic_schema::DeclarationModifiers::STATIC);
        if modifiers.contains(nts_semantic_schema::DeclarationModifiers::ABSTRACT) {
            return Err(self.unsupported(member, "an abstract method"));
        }

        let is_constructor = self.kind_of(member) == Some(syntax::CONSTRUCTOR);
        let member_name = if is_constructor {
            "constructor".to_owned()
        } else {
            self.children(member)
                .into_iter()
                .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
                .and_then(|child| self.node(child).text.clone())
                .ok_or_else(|| self.unsupported(member, "a method with a computed name"))?
        };

        // Neither `#` nor `.` can appear in a TypeScript identifier, so a
        // qualified name cannot collide with a plain function's -- and the two
        // spellings keep `static foo()` and `foo()` apart, which one class is
        // allowed to declare together.
        let name = if is_static {
            format!("{class_name}.{member_name}")
        } else {
            format!("{class_name}#{member_name}")
        };

        let origin = self.origin(member);
        let mut params = Vec::new();
        if is_static {
            // No receiver, so no `this` and no base to resolve `super` against.
            // Reaching either inside a static method is a TypeScript error, so
            // there is nothing to refuse here that the checker has not.
            self.this = None;
            self.base = None;
        } else {
            // `this` is parameter zero. Its type is the class's instance type,
            // which is what the checker gives the class declaration's name --
            // or, for one copy of a generic class, the instantiation's.
            let instance = match instance {
                Some(ty) => HirType::Managed(ManagedType::Object(ty)),
                None => self
                    .type_of(class)
                    .ok_or_else(|| self.unrepresentable(class, "a class"))?,
            };
            // `this` is a parameter like any other and needs its layout to
            // exist. Nothing else builds it for a class nothing constructs --
            // an abstract base whose only role is to be extended is exactly
            // that.
            self.materialize(class, &instance)?;
            let receiver = self.push(OpKind::Param(0), instance.clone(), origin.clone());
            self.this = Some(receiver);
            self.base = self.base_class(class);
            params.push(Param {
                name: "this".to_owned(),
                ty: instance,
                origin: origin.clone(),
                known: Facts::TOP,
            });
        }

        for child in self.children(member) {
            if self.kind_of(child) != Some(syntax::PARAMETER) {
                continue;
            }
            let index = u32::try_from(params.len()).unwrap_or(0);
            params.push(self.lower_param(child, index)?);
        }

        let body = self
            .children(member)
            .into_iter()
            .rev()
            .find(|child| self.kind_of(*child) == Some(syntax::BLOCK))
            .ok_or_else(|| self.unsupported(member, "a method without a body"))?;

        // A constructor returns nothing. It could return the instance -- it has
        // one in hand -- but the caller allocated that instance and already
        // names it, so returning it hands the caller a second reference to an
        // object it is already holding. Under reference counting that is a
        // retain and a release per construction for no gain, and under any
        // provider it is a copy the C compiler has to see through.
        let return_type = if is_constructor {
            HirType::Void
        } else {
            self.declared_return(member).unwrap_or(HirType::Void)
        };
        self.materialize(member, &return_type)?;

        self.lower_block(body)?;
        self.terminate(Terminator::Return(None));

        // A method is reachable from outside exactly when its class is, so the
        // class's `export` is what makes it a root.
        let exported = self
            .node(class)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::EXPORT);
        let mut func = self.finish(name, params, return_type, origin, exported);
        // A constructor runs over an object `new` allocated a moment ago, so
        // every field it writes is writing over a zero.
        func.initializes_receiver = is_constructor;
        Ok(func)
    }

    fn lower_function(&mut self, id: NodeId) -> Result<Func, Diagnostic> {
        let children = self.children(id);

        let name = children
            .iter()
            .find(|child| self.kind_of(**child) == Some(syntax::IDENTIFIER))
            .and_then(|child| self.node(*child).text.clone())
            .ok_or_else(|| self.unsupported(id, "an anonymous function"))?;

        let mut params = Vec::new();
        for child in &children {
            if self.kind_of(*child) != Some(syntax::PARAMETER) {
                continue;
            }
            params.push(self.lower_param(*child, u32::try_from(params.len()).unwrap_or(0))?);
        }

        // The return type comes from the annotation when there is one. Without it
        // the checker's inferred type is on the signature, not on any node, so an
        // unannotated function is refused rather than guessed at.
        let body = children
            .iter()
            .rev()
            .find(|child| self.kind_of(**child) == Some(syntax::BLOCK))
            .copied()
            .ok_or_else(|| self.unsupported(id, "a function without a body"))?;

        let return_type = self.declared_return(id).unwrap_or(HirType::Void);
        self.materialize(id, &return_type)?;

        self.lower_block(body)?;

        // A body that falls off its end returns nothing. TypeScript already
        // rejects that for a non-void function, so reaching it means void.
        self.terminate(Terminator::Return(None));

        let origin = self.origin(id);
        let exported = self
            .node(id)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::EXPORT);
        Ok(self.finish(name, params, return_type, origin, exported))
    }

    /// One arrow function, as the `call` method of a class.
    ///
    /// The class's fields are what the body reads from the scope around it, in
    /// the order `collect_closures` fixed -- the same order the allocating side
    /// writes them in. `this` is the closure, so a free variable becomes a
    /// field read on parameter zero and everything downstream sees an ordinary
    /// object.
    fn lower_closure(&mut self, index: usize, info: &ClosureInfo) -> Result<Func, Diagnostic> {
        if let Some(reason) = info.refusal {
            return Err(self.unsupported(info.node, reason));
        }
        let id = info.node;
        let (_, name) = closure_names(index);
        let receiver_ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(id);

        let receiver = self.push(OpKind::Param(0), receiver_ty.clone(), origin.clone());
        self.this = Some(receiver);
        let mut params = vec![Param {
            name: "this".to_owned(),
            ty: receiver_ty,
            origin: origin.clone(),
            known: Facts::TOP,
        }];
        for child in self.children(id) {
            if self.kind_of(child) != Some(syntax::PARAMETER) {
                continue;
            }
            let at = u32::try_from(params.len()).unwrap_or(0);
            params.push(self.lower_param(child, at)?);
        }

        // The captures, read back and bound to the names the body writes. A
        // field read rather than a copy into a local: the value is already
        // there, and `FieldGet` is what every other object read is.
        let mut fields = Vec::new();
        for (at, capture) in info.captures.iter().enumerate() {
            let ty = self
                .type_of(capture.at)
                .ok_or_else(|| self.unrepresentable(capture.at, "a captured variable"))?;
            let field = u32::try_from(at).unwrap_or(0);
            let value = self.push(
                OpKind::FieldGet {
                    object: receiver,
                    field,
                },
                ty.clone(),
                origin.clone(),
            );
            self.bindings.insert(capture.symbol, value);
            // Captured by value and never written again -- that is the whole
            // condition `collect_closures` checked before allowing the capture.
            fields.push(Field {
                name: capture.name.clone(),
                ty,
                readonly: true,
            });
        }
        self.layouts.push(self.closure_layout(index, fields));

        let return_type = self.declared_return(id).unwrap_or(HirType::Void);
        self.materialize(id, &return_type)?;

        // `x => x * 2` and `x => { return x * 2; }` are the same function, and
        // the first is much the more common. The body is the last child either
        // way: parameters and a return annotation both precede it.
        let body = self
            .children(id)
            .last()
            .copied()
            .ok_or_else(|| self.unsupported(id, "an arrow function with no body"))?;
        if self.kind_of(body) == Some(syntax::BLOCK) {
            self.lower_block(body)?;
            self.terminate(Terminator::Return(None));
        } else {
            let value = self.lower_expression(body)?;
            self.terminate(Terminator::Return(Some(value)));
        }

        // Not exported: a closure has no name to import. It stays only because
        // something dispatches through its slot, which `hir::reachable` decides
        // the same way it decides an override's fate.
        Ok(self.finish(name, params, return_type, origin, false))
    }

    /// The class a closure allocates, with its one method in the shared slot.
    fn closure_layout(&self, index: usize, fields: Vec<Field>) -> Layout {
        let (class, method) = closure_names(index);
        let mut methods = vec![None; self.hierarchy.table_size()];
        if let Some(slot) = self.hierarchy.closure_slot {
            methods[slot as usize] = Some(method);
        }
        Layout {
            types: vec![closure_type(index)],
            name: class,
            fields,
            methods,
        }
    }

    /// Assemble what has been built into a function.
    fn finish(
        &mut self,
        name: String,
        params: Vec<Param>,
        return_type: HirType,
        origin: Origin,
        exported: bool,
    ) -> Func {
        let blocks = std::mem::take(&mut self.blocks)
            .into_iter()
            .map(|block| Block {
                params: block.params,
                ops: block.ops,
                // Every block is terminated by construction: an open one is only
                // possible if a lowering forgot, and Unreachable states that
                // rather than leaving a malformed function.
                terminator: block.terminator.unwrap_or(Terminator::Unreachable),
            })
            .collect();

        Func {
            name,
            params,
            return_type,
            values: std::mem::take(&mut self.values),
            blocks,
            origin,
            exported,
            // Set by the caller: `finish` does not know what it is assembling,
            // and a seventh positional bool next to `exported` would be a
            // parameter waiting to be passed in the wrong order.
            initializes_receiver: false,
        }
    }

    fn lower_param(&mut self, id: NodeId, index: u32) -> Result<Param, Diagnostic> {
        let children = self.children(id);
        let name_node = children
            .iter()
            .find(|child| self.kind_of(**child) == Some(syntax::IDENTIFIER))
            .copied()
            .ok_or_else(|| self.unsupported(id, "a destructured parameter"))?;

        let name = self
            .node(name_node)
            .text
            .clone()
            .unwrap_or_else(|| format!("arg{index}"));
        let ty = self
            .type_of(name_node)
            .ok_or_else(|| self.unrepresentable(name_node, "a parameter"))?;
        self.materialize(name_node, &ty)?;

        let origin = self.origin(name_node);
        // What the declared type says, before anything in the body is seen.
        let known = self
            .snapshot
            .node_types
            .get(&name_node)
            .map_or(Facts::TOP, |declared| {
                known_values(self.snapshot, *declared, 0)
            });
        let value = self.push(OpKind::Param(index), ty.clone(), origin.clone());
        // Bound by symbol, so every later mention of this name resolves to the
        // same value rather than to a fresh load.
        if let Some(symbol) = self.node(name_node).symbol {
            self.bindings.insert(symbol.0, value);
        }

        Ok(Param {
            name,
            ty,
            origin,
            known,
        })
    }

    fn lower_block(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        for statement in self.children(id) {
            // Everything after a `return` in the same block is dead. Lowering it
            // would put operations in a block that has already ended.
            if self.is_terminated() {
                break;
            }
            self.lower_statement(statement)?;
        }
        Ok(())
    }

    /// Symbols assigned anywhere inside a subtree.
    ///
    /// Collected before a loop body is lowered, because the header needs a
    /// parameter for each of them *before* the body can refer to it — the body
    /// reads the value the previous iteration produced, which does not exist yet.
    fn assigned_symbols(&self, root: NodeId, into: &mut Vec<u32>) {
        // Every form that writes to a name, not just `=`. Missing one does not
        // fail loudly: the header simply gets no parameter for that name, the
        // loop reads the value it had on entry, and the back edge never passes
        // the update. `for (let i = 0; i < n; i++)` then runs forever, and the
        // only thing that catches it is the SSA verifier noticing that the exit
        // reads a value the body defined.
        let written = match self.kind_of(root) {
            Some(syntax::BINARY_EXPRESSION) => {
                let children = self.children(root);
                match children.as_slice() {
                    [target, operator, _] => {
                        let token = self.kind_of(*operator).unwrap_or(0);
                        if token == syntax::EQUALS_TOKEN || compound_operator(token).is_some() {
                            Some(*target)
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            }
            Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                let NodeData::Children { small, .. } = self.node(root).data else {
                    return;
                };
                matches!(
                    small & syntax::prefix_operator::MASK,
                    syntax::prefix_operator::PLUS_PLUS | syntax::prefix_operator::MINUS_MINUS
                )
                .then(|| self.children(root).first().copied())
                .flatten()
            }
            // Every postfix operator is a step, so no operator check is needed.
            Some(syntax::POSTFIX_UNARY_EXPRESSION) => self.children(root).first().copied(),
            _ => None,
        };

        // Only a bare name is carried. `box.cell = c` and `xs[i] = c` write
        // *through* a reference and leave the reference itself alone, so they
        // need no loop parameter -- and taking the target's symbol anyway would
        // pick up the class member `cell`, a symbol no local scope declares,
        // which then looks like an assignment to a name from an enclosing scope
        // and gets the loop refused.
        if let Some(target) = written
            && self.kind_of(target) == Some(syntax::IDENTIFIER)
            && let Some(symbol) = self.node(target).symbol
            && !into.contains(&symbol.0)
        {
            into.push(symbol.0);
        }

        for child in &self.node(root).children {
            self.assigned_symbols(*child, into);
        }
    }

    /// Symbols *declared* anywhere inside a subtree.
    ///
    /// A name declared inside a loop body is fresh on every iteration, so it is
    /// not carried across the back edge however often the body assigns it.
    /// Treating it as carried asks the header for a value that does not exist
    /// before the loop — which is the shape of `let x = 0` inside an outer loop,
    /// and therefore of every nested loop written the obvious way.
    fn declared_symbols(&self, root: NodeId, into: &mut Vec<u32>) {
        if self.kind_of(root) == Some(syntax::VARIABLE_DECLARATION)
            && let Some(name) = self.children(root).first()
            && let Some(symbol) = self.node(*name).symbol
        {
            into.push(symbol.0);
        }
        for child in &self.node(root).children {
            self.declared_symbols(*child, into);
        }
    }

    /// `while (c) { .. }`.
    ///
    /// # Where block parameters earn their keep
    ///
    /// A variable the body assigns has a different value on each iteration, and
    /// the header has to see whichever one the previous iteration produced. That
    /// is exactly a block parameter: the entry passes the initial value, the back
    /// edge passes the updated one, and the body reads the parameter.
    ///
    /// The parameters are created before the body is lowered, because the body
    /// refers to them. Which variables need one is a syntactic question —
    /// [`Self::assigned_symbols`] — answered by scanning the body first.
    fn lower_while(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let [condition, body] = children.as_slice() else {
            return Err(self.unsupported(id, "a `while` of unexpected shape"));
        };

        let mut carried = Vec::new();
        self.assigned_symbols(*body, &mut carried);
        let mut declared = Vec::new();
        self.declared_symbols(*body, &mut declared);
        carried.retain(|symbol| !declared.contains(symbol));

        let header = self.new_block();
        let origin = self.origin(id);
        let (params, exit) = self.enter_loop(id, header, &carried, Some(*condition), &origin)?;

        self.lower_statement(*body)?;
        self.close_loop(header, &carried, &params, exit);
        Ok(())
    }

    /// Open a loop: jump to the header, give it a parameter per carried name,
    /// test the condition, and leave the builder positioned in the body.
    ///
    /// Returns the header's parameters and the exit block.
    /// Jump into a loop's header and give it a parameter per carried name.
    ///
    /// Stops there, in the header, because what comes next is the *test* --
    /// and a test is lowered where its operations belong, which is the header
    /// rather than the block before it. A `while` lowers an expression there; a
    /// `for...of` builds a comparison there that no source node describes.
    fn open_loop(
        &mut self,
        id: NodeId,
        header: BlockId,
        carried: &[u32],
        origin: &Origin,
    ) -> Result<Vec<ValueId>, Diagnostic> {
        // The values entering the loop, in the order the parameters take them.
        let mut incoming = Vec::new();
        for symbol in carried {
            let value = *self.bindings.get(symbol).ok_or_else(|| {
                self.unsupported(id, "a loop assigning a name declared outside it")
            })?;
            incoming.push(value);
        }
        self.terminate(Terminator::Jump {
            target: header,
            args: incoming.clone(),
        });

        // Inside the loop, each carried name *is* its parameter.
        self.switch_to(header);
        let mut params = Vec::new();
        for (symbol, entering) in carried.iter().zip(&incoming) {
            let ty = self.values[entering.0 as usize].ty.clone();
            let param = self.push_block_param(header, ty, origin.clone());
            self.bindings.insert(*symbol, param);
            params.push(param);
        }
        Ok(params)
    }

    fn enter_loop(
        &mut self,
        id: NodeId,
        header: BlockId,
        carried: &[u32],
        condition: Option<NodeId>,
        origin: &Origin,
    ) -> Result<(Vec<ValueId>, BlockId), Diagnostic> {
        let params = self.open_loop(id, header, carried, origin)?;
        let (body_block, exit) = self.loop_blocks();
        match condition {
            Some(condition) => {
                let cond = self.lower_expression(condition)?;
                let cond = self.truthy(condition, cond);
                self.test_loop(cond, body_block, exit);
            }
            // `for (;;)`. The exit block stays reachable only through a `return`
            // inside the body, which is exactly what the source says.
            None => self.terminate(Terminator::Jump {
                target: body_block,
                args: Vec::new(),
            }),
        }

        self.switch_to(body_block);
        Ok((params, exit))
    }

    /// The body and exit blocks a loop needs, allocated in that order.
    fn loop_blocks(&mut self) -> (BlockId, BlockId) {
        (self.new_block(), self.new_block())
    }

    /// End a loop header on its test.
    fn test_loop(&mut self, cond: ValueId, body: BlockId, exit: BlockId) {
        self.terminate(Terminator::Branch {
            cond,
            then_target: body,
            then_args: Vec::new(),
            else_target: exit,
            else_args: Vec::new(),
        });
    }

    /// Close a loop: take the back edge, restore the carried names, and continue
    /// after the loop.
    fn close_loop(&mut self, header: BlockId, carried: &[u32], params: &[ValueId], exit: BlockId) {
        if !self.is_terminated() {
            // The back edge carries whatever the body left in each name.
            let updated: Vec<ValueId> =
                carried.iter().map(|symbol| self.bindings[symbol]).collect();
            self.terminate(Terminator::Jump {
                target: header,
                args: updated,
            });
        }

        // After the loop the live value of a carried name is the header
        // parameter, and the bindings must be put back to it. The body
        // overwrote them with values defined in the body block — which the exit
        // does not dominate, so using one after the loop is invalid SSA that
        // reads whatever the last iteration happened to leave.
        for (symbol, param) in carried.iter().zip(params) {
            self.bindings.insert(*symbol, *param);
        }
        self.switch_to(exit);
    }

    /// `for (init; cond; update) body`.
    ///
    /// The same shape as a `while`, with two differences that matter. The
    /// initializer runs once *before* the header, so a name it declares is in
    /// scope at the header and is carried across the back edge — unlike a name
    /// declared in the body, which is fresh each iteration. And the update runs
    /// at the end of the body, so the back edge carries what it produced.
    ///
    /// A missing condition is `for (;;)`: the loop is entered unconditionally.
    fn lower_for(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let Some([initializer, condition, update, body]) = self.child_slots::<4>(id) else {
            return Err(self.unsupported(id, "a `for` of unexpected shape"));
        };
        let Some(body) = body else {
            return Err(self.unsupported(id, "a `for` without a body"));
        };

        if let Some(initializer) = initializer {
            if self.kind_of(initializer) == Some(syntax::VARIABLE_DECLARATION_LIST) {
                self.lower_variable_statement(initializer)?;
            } else {
                self.lower_expression(initializer)?;
            }
        }

        // The update assigns the loop variable too, so it counts toward what is
        // carried. Missing it is how `i` ends up defined in the body and read
        // from the header.
        let mut carried = Vec::new();
        self.assigned_symbols(body, &mut carried);
        if let Some(update) = update {
            self.assigned_symbols(update, &mut carried);
        }
        let mut declared = Vec::new();
        self.declared_symbols(body, &mut declared);
        carried.retain(|symbol| !declared.contains(symbol));

        let header = self.new_block();
        let origin = self.origin(id);
        let (params, exit) = self.enter_loop(id, header, &carried, condition, &origin)?;

        self.lower_statement(body)?;
        if let Some(update) = update
            && !self.is_terminated()
        {
            self.lower_expression(update)?;
        }
        self.close_loop(header, &carried, &params, exit);
        Ok(())
    }

    /// A node's children assigned to their declared property slots.
    ///
    /// [`Self::children`] returns only the children that are *present*, so
    /// nothing about a position identifies which property it is. The node's
    /// presence bitmask does, one bit per property in visitor order.
    ///
    /// Reading positionally instead is wrong in two different ways, both of
    /// which happened: `for (;; i++)` becomes an infinite loop with `i++` as its
    /// condition, and `c ? a : b` picks up the `:` token as its true branch —
    /// which at least fails loudly, being a token where an expression belongs.
    /// `for (const x of xs)` over an array.
    ///
    /// Desugared to an index loop, which is what it is: the source names the
    /// element and this names the index. There is no iterator protocol here --
    /// `Symbol.iterator` is a dynamic dispatch through a property, and an array
    /// is the one case where the answer is known and the loop is a counter.
    fn lower_for_of(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let [initializer, sequence, body] = children.as_slice() else {
            // An `await` modifier makes four. `for await` needs the async
            // machinery rather than a different loop shape.
            return Err(self.unsupported(id, "a `for...of` of unexpected shape"));
        };
        let (initializer, sequence, body) = (*initializer, *sequence, *body);

        // The element name. One declaration, one identifier: a destructuring
        // pattern is a separate feature and refusing it says so.
        let element_name = self
            .children(initializer)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::VARIABLE_DECLARATION))
            .map(|declaration| self.children(declaration))
            .and_then(|parts| {
                parts
                    .into_iter()
                    .find(|part| self.kind_of(*part) == Some(syntax::IDENTIFIER))
            })
            .ok_or_else(|| self.unsupported(initializer, "a `for...of` binding of this shape"))?;
        let element_symbol = self
            .node(element_name)
            .symbol
            .ok_or_else(|| self.unsupported(element_name, "a `for...of` name with no symbol"))?
            .0;

        let sequence_value = self.lower_expression(sequence)?;
        let HirType::Managed(ManagedType::Array(element_ty)) =
            self.values[sequence_value.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(sequence, "a `for...of` over something not an array"));
        };

        let origin = self.origin(id);
        // The index. A double, like the counter a hand-written `for` produces,
        // so that specialization decides its machine type by the same rule
        // rather than by which loop it came from.
        let index = self.synthetic_symbol();
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.bindings.insert(index, zero);

        let mut carried = vec![index];
        self.assigned_symbols(body, &mut carried);
        let mut declared = vec![element_symbol];
        self.declared_symbols(body, &mut declared);
        carried.retain(|symbol| *symbol == index || !declared.contains(symbol));

        let header = self.new_block();
        let params = self.open_loop(id, header, &carried, &origin)?;
        let (body_block, exit) = self.loop_blocks();

        // `index < xs.length`, built rather than lowered: the source has no node
        // for it.
        let at = self.bindings[&index];
        let length = self.push(
            OpKind::Length(sequence_value),
            HirType::NUMBER,
            origin.clone(),
        );
        let cond = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: at,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.test_loop(cond, body_block, exit);
        self.switch_to(body_block);

        // `const x = xs[index]`, checked: the length was read once and the
        // bounds pass is what proves the index inside it.
        let at = self.bindings[&index];
        let value = self.push(
            OpKind::ArrayGet {
                array: sequence_value,
                index: at,
                checked: true,
            },
            *element_ty,
            origin.clone(),
        );
        self.bindings.insert(element_symbol, value);

        self.lower_statement(body)?;
        if !self.is_terminated() {
            let at = self.bindings[&index];
            let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
            let next = self.push(
                OpKind::Binary {
                    op: BinOp::Add,
                    lhs: at,
                    rhs: one,
                },
                HirType::NUMBER,
                origin.clone(),
            );
            self.bindings.insert(index, next);
        }
        self.close_loop(header, &carried, &params, exit);
        Ok(())
    }

    /// `throw new Error("...")`.
    ///
    /// # A throw is a termination, for now
    ///
    /// There is no `try`/`catch`, so every throw in a compiled program is
    /// uncaught by construction -- and an uncaught throw *is* a termination.
    /// So this reports the message and stops, which is what the program means
    /// and what node does with the same code. RFC §17 has the real thing;
    /// when handlers arrive this becomes the last resort rather than the only
    /// one, and no program that compiles today changes behaviour.
    ///
    /// What it will not do is guess at a value it cannot print. `throw x` where
    /// `x` is an object would need the object's `message`, which means knowing
    /// it has one.
    fn lower_throw(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let thrown = *self
            .children(id)
            .first()
            .ok_or_else(|| self.unsupported(id, "a `throw` with nothing to throw"))?;

        // `new Error(m)` is the shape every one of these has. The class is not
        // one this compiler can construct -- it is `lib.d.ts`'s -- so what is
        // taken from it is the argument.
        let message = if self.kind_of(thrown) == Some(syntax::NEW_EXPRESSION) {
            self.children(thrown).get(1).copied()
        } else {
            Some(thrown)
        };
        let origin = self.origin(id);
        let message = match message {
            Some(node) => {
                let value = self.lower_expression(node)?;
                if !matches!(
                    self.values[value.0 as usize].ty,
                    HirType::Managed(ManagedType::String)
                ) {
                    return Err(self.unsupported(node, "a `throw` of something that is not text"));
                }
                value
            }
            // `throw new Error()`. Nothing to say, and saying nothing is right.
            None => self.push(
                OpKind::ConstString(String::new()),
                HirType::Managed(ManagedType::String),
                origin.clone(),
            ),
        };

        self.push(
            OpKind::Call {
                callee: Callee::External("nts_thrown".to_owned()),
                args: vec![message],
                frame: None,
            },
            HirType::Void,
            origin,
        );
        // Control does not continue. Saying so is what lets the C compiler
        // treat the code after a throw as unreachable, which it is.
        self.terminate(Terminator::Unreachable);
        Ok(())
    }

    /// Lower an expression knowing what type a bare `null` in it should take.
    fn lower_expecting(&mut self, id: NodeId, ty: &HirType) -> Result<ValueId, Diagnostic> {
        let saved = self.expecting.replace(ty.clone());
        let value = self.lower_expression(id);
        self.expecting = saved;
        value
    }

    /// A name no source can have, for a value only the lowering knows about.
    fn synthetic_symbol(&mut self) -> u32 {
        self.synthetic += 1;
        u32::MAX - self.synthetic
    }

    fn child_slots<const N: usize>(&self, id: NodeId) -> Option<[Option<NodeId>; N]> {
        let NodeData::Children { present, .. } = self.node(id).data else {
            return None;
        };
        let mut children = self.children(id).into_iter();
        let mut slots = [None; N];
        for (bit, slot) in slots.iter_mut().enumerate() {
            if present & (1 << bit) != 0 {
                *slot = children.next();
            }
        }
        Some(slots)
    }

    /// `i++` / `i--`, whose value is what the name held *before* the step.
    fn lower_postfix_unary(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let NodeData::Children { small, .. } = self.node(id).data else {
            return Err(self.unsupported(id, "a step expression without operator data"));
        };
        let children = self.children(id);
        let [operand] = children.as_slice() else {
            return Err(self.unsupported(id, "a step expression of unexpected shape"));
        };
        // One bit, not the prefix table: `++` is 0 and `--` is 1.
        let op = if small & syntax::postfix_operator::MASK == syntax::postfix_operator::MINUS_MINUS
        {
            BinOp::Sub
        } else {
            BinOp::Add
        };
        let (before, _) = self.step(id, *operand, op)?;
        Ok(before)
    }

    /// `target = value`, for each kind of target.
    ///
    /// Three different operations wear one spelling. A name rebinds, which
    /// emits nothing at all -- the binding *is* the assignment. A field or an
    /// element writes through a reference, where there is no name to rebind and
    /// the store is the whole of the effect.
    fn lower_assignment(
        &mut self,
        id: NodeId,
        target: NodeId,
        source: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        // The place first, then the value: `xs[i()] = v()` evaluates the array,
        // then the index, then the value, and JavaScript says so.
        let place = self.place_of(target)?;
        let value = self.lower_expression(source)?;
        self.write_place(id, &place, value);
        Ok(value)
    }

    /// Work out *where* an assignment writes, evaluating the parts that decide
    /// it exactly once.
    ///
    /// Once is the whole point. `xs[next()] += 1` calls `next` a single time in
    /// JavaScript, so the index cannot be lowered again for the store -- and a
    /// compound assignment that re-lowered its target would call it twice.
    fn place_of(&mut self, target: NodeId) -> Result<Place, Diagnostic> {
        if self.kind_of(target) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            let children = self.children(target);
            let [object_node, member] = children.as_slice() else {
                return Err(self.unsupported(target, "a property of unexpected shape"));
            };
            let object = self.lower_expression(*object_node)?;
            let HirType::Managed(ManagedType::Object(type_id)) =
                self.values[object.0 as usize].ty.clone()
            else {
                return Err(self.unsupported(target, "assigning to this property"));
            };
            let layout = self.layout_of(target, type_id)?;
            let name = self
                .node(*member)
                .text
                .clone()
                .ok_or_else(|| self.unsupported(*member, "a computed property name"))?;
            let field = layout
                .index_of(&name)
                .ok_or_else(|| self.unsupported(target, "a property the type does not declare"))?;
            if layout.fields[field as usize].readonly {
                return Err(self.unsupported(target, "assigning to a readonly property"));
            }
            return Ok(Place::Field { object, field });
        }

        if self.kind_of(target) == Some(syntax::ELEMENT_ACCESS_EXPRESSION) {
            let (array, index) = self.element_access_parts(target)?;
            return Ok(Place::Element { array, index });
        }

        let symbol = self
            .node(target)
            .symbol
            .ok_or_else(|| self.unsupported(target, "assignment to a computed target"))?;
        // A module-scope variable is a store, not a rebinding: every function
        // sees the same one, so there is nothing to shadow.
        if !self.bindings.contains_key(&symbol.0)
            && let Some(global) = self.module.variables.get(&symbol.0).copied()
        {
            return Ok(Place::Global(global));
        }
        if self.module.constants.contains_key(&symbol.0) {
            return Err(self.unsupported(target, "assigning to a `const`"));
        }
        Ok(Place::Binding(symbol.0))
    }

    /// What a place currently holds. Only a compound assignment and a step ask.
    fn read_place(&mut self, id: NodeId, place: &Place) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        Ok(match *place {
            Place::Field { object, field } => {
                let layout = match self.values[object.0 as usize].ty.clone() {
                    HirType::Managed(ManagedType::Object(ty)) => self.layout_of(id, ty)?,
                    _ => return Err(self.unsupported(id, "reading a field of something else")),
                };
                let ty = layout.fields[field as usize].ty.clone();
                self.push(OpKind::FieldGet { object, field }, ty, origin)
            }
            Place::Element { array, index } => {
                let HirType::Managed(ManagedType::Array(element)) =
                    self.values[array.0 as usize].ty.clone()
                else {
                    return Err(self.unsupported(id, "indexing something that is not an array"));
                };
                self.push(
                    OpKind::ArrayGet {
                        array,
                        index,
                        checked: true,
                    },
                    *element,
                    origin,
                )
            }
            Place::Global(global) => {
                let ty = self.module.types[global as usize].clone();
                self.push(OpKind::GlobalGet(global), ty, origin)
            }
            Place::Binding(symbol) => *self
                .bindings
                .get(&symbol)
                .ok_or_else(|| self.unsupported(id, "reading a name before it is bound"))?,
        })
    }

    /// Put a value into a place.
    fn write_place(&mut self, id: NodeId, place: &Place, value: ValueId) {
        let origin = self.origin(id);
        match *place {
            Place::Field { object, field } => {
                self.push(
                    OpKind::FieldSet {
                        object,
                        field,
                        value,
                    },
                    HirType::Void,
                    origin,
                );
            }
            Place::Element { array, index } => {
                self.push(
                    OpKind::ArraySet {
                        array,
                        index,
                        value,
                        checked: true,
                    },
                    HirType::Void,
                    origin,
                );
            }
            Place::Global(global) => {
                self.push(OpKind::GlobalSet { global, value }, HirType::Void, origin);
            }
            Place::Binding(symbol) => {
                self.bindings.insert(symbol, value);
            }
        }
    }

    fn push_bitwise(
        &mut self,
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
        ty: HirType,
        origin: &Origin,
    ) -> ValueId {
        let left_coercion = if matches!(op, BinOp::UShr) {
            UnOp::ToUint32
        } else {
            UnOp::ToInt32
        };
        let left = self.push(
            OpKind::Unary {
                op: left_coercion,
                operand: lhs,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let right = self.push(
            OpKind::Unary {
                op: UnOp::ToInt32,
                operand: rhs,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.push(
            OpKind::Binary {
                op,
                lhs: left,
                rhs: right,
            },
            ty,
            origin.clone(),
        )
    }

    /// The shared half of `++`/`--`: add or subtract one and rebind the name.
    /// `x++`, `++x`, and their decrementing halves.
    ///
    /// Returns the value before the step and the value after it, because the
    /// prefix and postfix forms differ in exactly which one they evaluate to.
    /// The place is read and written *once*, which is what a step is.
    fn step(
        &mut self,
        id: NodeId,
        target: NodeId,
        op: BinOp,
    ) -> Result<(ValueId, ValueId), Diagnostic> {
        let place = self.place_of(target)?;
        let current = self.read_place(target, &place)?;
        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a step"))?;
        let one = self.push(OpKind::ConstFloat(1.0), ty.clone(), origin.clone());
        let stepped = self.push(
            OpKind::Binary {
                op,
                lhs: current,
                rhs: one,
            },
            ty,
            origin,
        );
        self.write_place(id, &place, stepped);
        Ok((current, stepped))
    }

    /// `if (c) { .. } else { .. }`.
    ///
    /// # The merge is where the arms have to agree
    ///
    /// Each arm may leave a different value in the same name. After the `if`,
    /// which one is live depends on the edge taken — which is precisely what a
    /// block parameter is for, and the same mechanism a loop header uses.
    ///
    /// Without it, the name keeps whatever value the last-lowered arm produced,
    /// defined in a block the merge does not dominate. That is invalid SSA. It
    /// also *compiles*, to code that reads a variable the other path never wrote,
    /// which is why the verifier exists rather than a code review.
    ///
    /// Only names the arms disagree about become parameters. One they agree on is
    /// already defined before the branch — two arms cannot produce the same
    /// [`ValueId`] otherwise — so it dominates the merge, and a parameter for it
    /// would be a copy carrying no information.
    fn lower_if(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let (condition, then_branch, else_branch) = match children.as_slice() {
            [condition, then_branch] => (*condition, *then_branch, None),
            [condition, then_branch, else_branch] => (*condition, *then_branch, Some(*else_branch)),
            _ => return Err(self.unsupported(id, "an `if` of unexpected shape")),
        };

        let origin = self.origin(id);
        let cond = self.lower_expression(condition)?;
        // `if (x)` takes any value, not just a boolean, and JavaScript decides
        // which are false. An empty string and a NaN are, which is why this
        // cannot be left to C's own idea of a condition.
        let cond = self.truthy(condition, cond);
        let then_block = self.new_block();

        // With no `else`, the false edge goes straight to the merge. Allocating an
        // else block for it would leave a block whose only content is a jump —
        // once per `if` without an else, which is most of them.
        let (else_block, preallocated) = if else_branch.is_some() {
            (self.new_block(), None)
        } else {
            let merge = self.new_block();
            (merge, Some(merge))
        };

        // Remembered because the false edge's arguments are not known until the
        // merge has parameters, which is after both arms are lowered.
        let branch_block = self.current;
        self.terminate(Terminator::Branch {
            cond,
            then_target: then_block,
            then_args: Vec::new(),
            else_target: else_block,
            else_args: Vec::new(),
        });

        // What each name held on entry: the baseline the arms are compared
        // against, and what the false edge carries when there is no `else`.
        let entry = self.bindings.clone();

        self.switch_to(then_block);
        self.lower_statement(then_branch)?;
        // The block the arm *ended* in, which nested control flow moves away from
        // the block it started in. Terminating `then_block` instead would leave
        // the real tail without a terminator.
        let then_tail = self.current;
        let then_open = !self.is_terminated();
        let then_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        let (else_tail, else_open, else_bindings) = match else_branch {
            Some(else_branch) => {
                self.switch_to(else_block);
                self.lower_statement(else_branch)?;
                let tail = self.current;
                let open = !self.is_terminated();
                let bindings = std::mem::replace(&mut self.bindings, entry.clone());
                (tail, open, bindings)
            }
            // The false edge is the merge, which is open by construction and
            // changes nothing.
            None => (else_block, true, entry.clone()),
        };

        if !then_open && !else_open {
            // Both arms ended. Anything after the `if` is unreachable, and the
            // enclosing block is already closed.
            return Ok(());
        }

        let merge = preallocated.unwrap_or_else(|| self.new_block());

        let mut merged: Vec<(u32, ValueId, ValueId)> = Vec::new();
        if then_open && else_open {
            for (symbol, entering) in &entry {
                let from_then = then_bindings.get(symbol).copied().unwrap_or(*entering);
                let from_else = else_bindings.get(symbol).copied().unwrap_or(*entering);
                if from_then != from_else {
                    merged.push((*symbol, from_then, from_else));
                }
            }
            // Sorted because the source is a hash map: without this the parameter
            // list would vary between runs of one compiler on one input, and the
            // snapshot digest would stop being a cache key.
            merged.sort_unstable();
        }

        let mut params = Vec::new();
        for (symbol, from_then, _) in &merged {
            let ty = self.values[from_then.0 as usize].ty.clone();
            params.push((*symbol, self.push_block_param(merge, ty, origin.clone())));
        }

        if then_open {
            self.switch_to(then_tail);
            let args = merged.iter().map(|(_, from_then, _)| *from_then).collect();
            self.terminate(Terminator::Jump {
                target: merge,
                args,
            });
        }
        if else_branch.is_some() {
            if else_open {
                self.switch_to(else_tail);
                let args = merged.iter().map(|(_, _, from_else)| *from_else).collect();
                self.terminate(Terminator::Jump {
                    target: merge,
                    args,
                });
            }
        } else if let Some(Terminator::Branch { else_args, .. }) =
            &mut self.blocks[branch_block.0 as usize].terminator
        {
            // The false edge points at the merge directly, so its arguments live
            // on the branch rather than on a jump of its own.
            *else_args = merged.iter().map(|(_, _, from_else)| *from_else).collect();
        }

        self.switch_to(merge);
        self.bindings = match (then_open, else_open) {
            // Only one arm reaches the merge, so its bindings are the live ones
            // outright — no parameter is needed to choose between them.
            (true, false) => then_bindings,
            (false, true) => else_bindings,
            _ => {
                let mut live = entry;
                for (symbol, param) in params {
                    live.insert(symbol, param);
                }
                live
            }
        };
        Ok(())
    }

    fn lower_statement(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        match self.kind_of(id) {
            Some(syntax::RETURN_STATEMENT) => {
                let value = match self.children(id).first().copied() {
                    Some(expression) => Some(self.lower_expression(expression)?),
                    None => None,
                };
                self.terminate(Terminator::Return(value));
                Ok(())
            }
            Some(syntax::BLOCK) => self.lower_block(id),
            Some(syntax::IF_STATEMENT) => self.lower_if(id),
            Some(syntax::WHILE_STATEMENT) => self.lower_while(id),
            Some(syntax::FOR_STATEMENT) => self.lower_for(id),
            Some(syntax::FOR_OF_STATEMENT) => self.lower_for_of(id),
            Some(syntax::THROW_STATEMENT) => self.lower_throw(id),
            Some(syntax::EXPRESSION_STATEMENT) => {
                let Some(expression) = self.children(id).first().copied() else {
                    return Ok(());
                };
                self.lower_expression(expression)?;
                Ok(())
            }
            Some(syntax::VARIABLE_STATEMENT) => self.lower_variable_statement(id),
            _ => Err(self.unsupported(id, "this statement")),
        }
    }

    fn lower_expression(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        match self.kind_of(id) {
            Some(syntax::IDENTIFIER) => self.lower_identifier(id),
            Some(syntax::NUMERIC_LITERAL) => self.lower_number(id),
            Some(syntax::STRING_LITERAL) => self.lower_string(id),
            Some(syntax::BINARY_EXPRESSION) => self.lower_binary(id),
            Some(syntax::CALL_EXPRESSION) => self.lower_call(id),
            // Parentheses group; they compute nothing. Lowering the inner
            // expression is the whole of it — the grouping already happened when
            // the parser built the tree this shape.
            Some(syntax::PARENTHESIZED_EXPRESSION) => {
                let children = self.children(id);
                let [inner] = children.as_slice() else {
                    return Err(
                        self.unsupported(id, "a parenthesized expression of unexpected shape")
                    );
                };
                self.lower_expression(*inner)
            }
            Some(syntax::CONDITIONAL_EXPRESSION) => self.lower_conditional(id),
            Some(syntax::ARRAY_LITERAL_EXPRESSION) => self.lower_array_literal(id),
            Some(syntax::OBJECT_LITERAL_EXPRESSION) => self.lower_object_literal(id),
            Some(syntax::NEW_EXPRESSION) => self.lower_new(id),
            Some(syntax::ARROW_FUNCTION) => self.lower_arrow(id),
            Some(syntax::NULL_KEYWORD) => self.lower_absent(id),
            // `this` is parameter zero of a method. Outside one there is no
            // receiver to name.
            Some(syntax::THIS_KEYWORD) => self
                .this
                .ok_or_else(|| self.unsupported(id, "`this` outside a method")),
            Some(syntax::ELEMENT_ACCESS_EXPRESSION) => self.lower_element_access(id),
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => self.lower_property_access(id),
            // `x!`, `x as T` and `x satisfies T` are claims about types. The
            // first two narrow what the checker believes; the third asserts
            // without narrowing. None of them computes anything, so each lowers
            // to its operand — but the *claim* is not free: an `x!` on an
            // element access is the author asserting the index is in bounds, and
            // the bounds check is what makes that assertion checked rather than
            // assumed. `docs/any-unknown.md` calls this out as the general rule
            // for assertions.
            Some(
                syntax::NON_NULL_EXPRESSION | syntax::AS_EXPRESSION | syntax::SATISFIES_EXPRESSION,
            ) => {
                let children = self.children(id);
                let Some(inner) = children.first() else {
                    return Err(self.unsupported(id, "an assertion with no operand"));
                };
                self.lower_expression(*inner)
            }
            Some(syntax::PREFIX_UNARY_EXPRESSION) => self.lower_prefix_unary(id),
            Some(syntax::POSTFIX_UNARY_EXPRESSION) => self.lower_postfix_unary(id),
            Some(syntax::TRUE_KEYWORD) => {
                let origin = self.origin(id);
                Ok(self.push(OpKind::ConstBool(true), HirType::Bool, origin))
            }
            Some(syntax::FALSE_KEYWORD) => {
                let origin = self.origin(id);
                Ok(self.push(OpKind::ConstBool(false), HirType::Bool, origin))
            }
            _ => Err(self.unsupported(id, "this expression")),
        }
    }

    /// `const x = expr` / `let x = expr`.
    ///
    /// A declaration with an initializer binds its symbol to the initializer's
    /// value — no slot and no store, because nothing here can reassign it yet.
    /// When assignment arrives, a `let` will need one and a `const` still will
    /// not, which is what the snapshot's variable kind is for.
    /// `[a, b, c]`.
    ///
    /// An allocation and a store per element. The length is known here, so it
    /// is a constant, which is what lets the analysis prove that every one of
    /// these stores is in bounds — the checks below are elided before they cost
    /// anything.
    fn lower_array_literal(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "an array literal"))?;
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(self.unsupported(id, "an array literal that is not an array"));
        }
        let origin = self.origin(id);
        let elements = self.children(id);

        #[allow(clippy::cast_precision_loss)]
        let count = elements.len() as f64;
        let length = self.push(OpKind::ConstFloat(count), HirType::NUMBER, origin.clone());
        let array = self.push(OpKind::ArrayNew { length }, ty, origin.clone());

        for (index, element) in elements.iter().enumerate() {
            let value = self.lower_expression(*element)?;
            #[allow(clippy::cast_precision_loss)]
            let position = index as f64;
            let index = self.push(
                OpKind::ConstFloat(position),
                HirType::NUMBER,
                origin.clone(),
            );
            self.push(
                OpKind::ArraySet {
                    array,
                    index,
                    value,
                    checked: true,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(array)
    }

    /// `[]`, with the element type supplied from outside.
    fn lower_empty_array(&mut self, id: NodeId, ty: HirType) -> Result<ValueId, Diagnostic> {
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(self.unsupported(id, "an empty array literal that is not an array"));
        }
        let origin = self.origin(id);
        let length = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        Ok(self.push(OpKind::ArrayNew { length }, ty, origin))
    }

    /// `{ x: 1, y }`.
    ///
    /// An allocation and a store per field. The fields are written in *layout*
    /// order rather than source order, so two literals of one type produce the
    /// same stores — which is what lets a later pass recognize them as the same
    /// shape.
    fn lower_object_literal(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "an object literal"))?;
        let HirType::Managed(ManagedType::Object(type_id)) = ty else {
            return Err(self.unsupported(id, "an object literal that is not an object"));
        };
        let layout = self.layout_of(id, type_id)?;
        let origin = self.origin(id);
        let object = self.push(OpKind::ObjectNew { frame: false }, ty, origin.clone());

        // Source order, since an initializer may have effects and they happen
        // where the author wrote them. The *field index* is what puts them in
        // layout order.
        for property in self.children(id) {
            let (name, value) = self.property_parts(property)?;
            let Some(field) = layout.index_of(&name) else {
                return Err(self.unsupported(property, "a property the type does not declare"));
            };
            self.push(
                OpKind::FieldSet {
                    object,
                    field,
                    value,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(object)
    }

    /// The name and value of one property in an object literal.
    fn property_parts(&mut self, id: NodeId) -> Result<(String, ValueId), Diagnostic> {
        match self.kind_of(id) {
            Some(syntax::PROPERTY_ASSIGNMENT) => {
                let children = self.children(id);
                let [name, initializer] = children.as_slice() else {
                    return Err(self.unsupported(id, "a property of unexpected shape"));
                };
                let text = self
                    .node(*name)
                    .text
                    .clone()
                    .ok_or_else(|| self.unsupported(*name, "a computed property name"))?;
                let value = self.lower_expression(*initializer)?;
                Ok((text, value))
            }
            // `{ x }` — one node serving as both the field name and a reference
            // to a variable, and the checker gives it the *property's* symbol.
            // The variable's symbol is what `getShorthandAssignmentValueSymbol`
            // answers, which the snapshot does not carry yet; until it does, the
            // reference is resolved by name against what is in scope.
            //
            // That is sound only while the name is unambiguous, so a shadowed
            // one is refused rather than guessed at.
            Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
                let children = self.children(id);
                let [name] = children.as_slice() else {
                    return Err(self.unsupported(id, "a shorthand property of unexpected shape"));
                };
                let text = self
                    .node(*name)
                    .text
                    .clone()
                    .ok_or_else(|| self.unsupported(*name, "a shorthand without a name"))?;

                let mut found = self.bindings.iter().filter(|(symbol, _)| {
                    self.snapshot
                        .symbols
                        .get(**symbol as usize)
                        .is_some_and(|record| record.name == text)
                });
                let value = match (found.next(), found.next()) {
                    (Some((_, value)), None) => *value,
                    (Some(_), Some(_)) => {
                        return Err(
                            self.unsupported(*name, "a shorthand naming a shadowed binding")
                        );
                    }
                    _ => return Err(self.unsupported(*name, "a shorthand naming nothing in scope")),
                };
                Ok((text, value))
            }
            _ => Err(self.unsupported(id, "this kind of property")),
        }
    }

    /// The layout of an object type, computed once and remembered.
    ///
    /// Declaration order, which is the order the checker reports members in.
    /// When classes arrive this becomes base-first (RFC §8.1), so that a
    /// subclass's prefix is its base's layout and an upcast is free.
    /// The member names a type inherits, in the order its bases declare them.
    ///
    /// `extends` comes before `implements` in `base_types`, and a class extends
    /// at most one class, so the first base is the superclass and its order is
    /// the one that has to be a prefix. An interface listed after it contributes
    /// only names already placed.
    fn inherited_order(&self, ty: TypeId, into: &mut Vec<String>, depth: u32) {
        // A type that reaches itself through its bases is not a hierarchy, and
        // recursing on one would not stop.
        if depth > 32 {
            return;
        }
        let Some(bases) = self.snapshot.base_types.get(&ty) else {
            return;
        };
        for base in bases {
            self.inherited_order(*base, into, depth + 1);
            let Some(TypeKind::Object { properties }) = self
                .snapshot
                .types
                .get(base.0 as usize)
                .map(|record| &record.kind)
            else {
                continue;
            };
            for property in properties {
                if !into.contains(&property.name) {
                    into.push(property.name.clone());
                }
            }
        }
    }

    fn layout_of(&mut self, id: NodeId, ty: TypeId) -> Result<Layout, Diagnostic> {
        if let Some(known) = self
            .layouts
            .iter()
            .find(|layout| layout.types.contains(&ty))
        {
            return Ok(known.clone());
        }
        let record =
            self.snapshot.types.get(ty.0 as usize).ok_or_else(|| {
                self.unsupported(id, "an object type that is not in the snapshot")
            })?;
        // A function type has no fields: two closures of one type differ by what
        // they captured, and that is their own class's business.
        if matches!(record.kind, TypeKind::Function(_)) {
            let layout = Layout {
                types: vec![ty],
                name: format!("Fn{}", ty.0),
                fields: Vec::new(),
                methods: Vec::new(),
            };
            self.layouts.push(layout.clone());
            return Ok(layout);
        }
        let TypeKind::Object { properties } = &record.kind else {
            return Err(self.unsupported(id, "an object type that was not decomposed"));
        };

        let mut fields = Vec::new();
        for property in properties {
            if property.accessor.is_some() {
                return Err(self.unsupported(id, "an object with an accessor"));
            }
            // A method is a member of the type but not a field of the object.
            // It has no storage: the checker resolved every call site, so it is
            // a function the call names directly rather than a slot to load
            // from. This is where a vtable would go if dispatch needed one.
            if matches!(
                self.snapshot
                    .types
                    .get(property.ty.0 as usize)
                    .map(|record| &record.kind),
                Some(TypeKind::Function(_))
            ) {
                continue;
            }
            if property.optional {
                // An optional field needs a presence bit, which changes the
                // layout rather than adding to it.
                return Err(self.unsupported(id, "an object with an optional property"));
            }
            // A reference field is a pointer. Under NoGC nothing is ever freed,
            // so it costs neither a write barrier nor a trace; which fields are
            // references is recorded on the layout for the collector that comes
            // later, because that is a fact about the layout and the layout is
            // decided here.
            let field_ty = self
                .represent(property.ty)
                .ok_or_else(|| self.unrepresentable(id, "a property"))?;
            fields.push(Field {
                name: property.name.clone(),
                ty: field_ty,
                readonly: property.readonly,
            });
        }

        // Base first, so a derived object's fields start with exactly the base's
        // and a pointer to one is a pointer to the other. That is what makes an
        // upcast free: `Square#area` and `Shape#doubled` read the same offsets
        // for the fields they share, so passing a `Square*` where a `Shape*` is
        // expected needs no work at all.
        //
        // The checker's property list is flattened -- it already contains the
        // inherited members with nothing to say where they came from -- so the
        // order has to be recovered from the base chain rather than read off.
        let mut order = Vec::new();
        self.inherited_order(ty, &mut order, 0);
        fields.sort_by_key(|field| {
            order
                .iter()
                .position(|name| *name == field.name)
                .unwrap_or(usize::MAX)
        });

        // The declared name where there is one. An anonymous object type —
        // `{ x: number }` written inline — has no symbol, so it is named after
        // its type id, which is at least stable and unique.
        let name = record
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .map_or_else(|| format!("Type{}", ty.0), |symbol| symbol.name.clone());
        // `Vector<Body>` and `Vector<double>` share the declaring symbol and so
        // share this name, and they are different classes with different field
        // widths. The type id tells them apart, and `<>` cannot appear in a
        // TypeScript identifier so the qualified name cannot collide with a
        // plain one. `nts types` is what reads the number back.
        let name = format!("{name}{}", instantiation_suffix(self.snapshot, ty));
        // What this class does for each dispatch slot. Empty where nothing in
        // the hierarchy is overridden, which is most classes.
        let mut methods = vec![None; self.hierarchy.table_size()];
        for ((root, member), slot) in &self.hierarchy.slots {
            if !self.hierarchy.descends_from(ty, *root) {
                continue;
            }
            let Some(owner) = self.hierarchy.declaring(ty, member) else {
                continue;
            };
            if let Some(name) = self.hierarchy.name.get(&owner) {
                methods[*slot as usize] = Some(format!("{name}#{member}"));
            }
        }

        // Structural, so a type whose shape is already laid out joins that
        // layout rather than getting one of its own. The first name wins, which
        // is usually the declared one -- an anonymous literal type tends to be
        // discovered second.
        if let Some(existing) = self
            .layouts
            .iter_mut()
            .find(|layout| layout.same_shape(&fields, &methods))
        {
            existing.types.push(ty);
            // A declared name beats a generated one, whichever was seen first.
            // The anonymous type of a literal is usually discovered before the
            // interface it is assigned to, and `NtsObj_Point` reads better than
            // `NtsObj_Type5`.
            if existing.name.starts_with("Type") && !name.starts_with("Type") {
                existing.name = name;
            }
            return Ok(existing.clone());
        }

        let layout = Layout {
            types: vec![ty],
            name,
            fields,
            methods,
        };
        self.layouts.push(layout.clone());
        Ok(layout)
    }

    /// `(x) => x * n` — allocate the closure and write what it captured.
    ///
    /// The same two operations `new C(...)` lowers to, for the same reason: an
    /// allocation and the stores that fill it. Everything after this treats the
    /// result as the object it is, so a closure that does not outlive the call
    /// ends up in the frame and one that does gets a reference count.
    fn lower_arrow(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let index = self
            .closures
            .iter()
            .position(|closure| closure.node == id)
            .ok_or_else(|| self.unsupported(id, "an arrow function the collector did not see"))?;
        let info = self.closures[index].clone();
        if let Some(reason) = info.refusal {
            return Err(self.unsupported(id, reason));
        }

        self.used_closures.push(index);

        let ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(id);
        let object = self.push(OpKind::ObjectNew { frame: false }, ty, origin.clone());

        let mut fields = Vec::new();
        for (at, capture) in info.captures.iter().enumerate() {
            // The value the enclosing scope holds. It is in `bindings` because
            // the collector only allowed a capture of something declared
            // outside the arrow and never assigned -- so by the time the arrow
            // is reached, the binding exists and is final.
            let value = *self.bindings.get(&capture.symbol).ok_or_else(|| {
                self.unsupported(
                    capture.at,
                    "a closure over a name from more than one scope up",
                )
            })?;
            let field_ty = self.values[value.0 as usize].ty.clone();
            self.push(
                OpKind::FieldSet {
                    object,
                    field: u32::try_from(at).unwrap_or(0),
                    value,
                },
                HirType::Void,
                origin.clone(),
            );
            fields.push(Field {
                name: capture.name.clone(),
                ty: field_ty,
                readonly: true,
            });
        }
        // The same layout the body's side builds. Both are pushed, and
        // `collect_layouts` merges them -- which is also the check that the two
        // sides agree, because a disagreement would be two layouts for one type
        // rather than one.
        self.layouts.push(self.closure_layout(index, fields));
        Ok(object)
    }

    /// `new C(a, b)` — allocate, then run the constructor over it.
    ///
    /// The allocation is the value. The constructor writes through the pointer
    /// it is handed and returns nothing, so `new` is an allocation and a call
    /// rather than an allocation, a call, and a pointer round-trip that every
    /// stage downstream has to prove is the identity.
    /// The children of a call or `new` that are *arguments*.
    ///
    /// Explicit type arguments are flattened in among them --
    /// `new Box<number>(xs)` arrives as `[Box, number, xs]` -- so they are
    /// dropped by asking the same question tsgo asks. Nothing structural
    /// distinguishes them: a list is not a node here.
    fn arguments_of(&self, id: NodeId) -> Vec<NodeId> {
        self.children(id)
            .into_iter()
            .skip(1)
            .filter(|child| !syntax::is_type_node(self.kind_of(*child).unwrap_or(0)))
            .collect()
    }

    fn lower_new(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let callee = *children
            .first()
            .ok_or_else(|| self.unsupported(id, "a `new` with no callee"))?;
        let class = self
            .node(callee)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(callee, "a computed constructor"))?;

        // `new Array(n)` is an allocation with a length, which is what
        // `ArrayNew` already is. It is worth taking rather than asking authors
        // to write `[]` and push: an array made at its final size allocates
        // once, and a benchmark that pre-sizes its array is measuring that.
        //
        // The type comes from where the result goes, because the constructor's
        // own type is a union of the overloads in `lib.d.ts` and says nothing
        // about the element.
        if class == "Array" {
            let ty = self
                .type_of(id)
                .filter(|ty| matches!(ty, HirType::Managed(ManagedType::Array(_))))
                .or_else(|| self.contextual_type(id, 0))
                .ok_or_else(|| self.unrepresentable(id, "a `new Array`"))?;
            if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
                return Err(self.unsupported(id, "a `new Array` that is not an array"));
            }
            let origin = self.origin(id);
            let arguments = self.arguments_of(id);
            let Some(count) = arguments.first() else {
                return self.lower_empty_array(id, ty);
            };
            let length = self.lower_expression(*count)?;
            return Ok(self.push(OpKind::ArrayNew { length }, ty, origin));
        }

        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `new`"))?;
        let HirType::Managed(ManagedType::Object(type_id)) = ty else {
            return Err(self.unsupported(id, "a `new` that does not produce an object"));
        };
        // Laying the class out here is what makes its fields addressable; the
        // constructor is about to write every one of them.
        self.layout_of(id, type_id)?;

        let origin = self.origin(id);
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            ty.clone(),
            origin.clone(),
        );

        // The nearest declared constructor, which may be a base's: a class
        // that declares none has an implicit one that forwards, and forwarding
        // to it directly is the same call with one frame fewer. A class with no
        // constructor anywhere in its chain has nothing to run at all -- the
        // allocation is zeroed and that is the whole of `new C()`.
        let arguments = self.arguments_of(id);
        let Some(declaring) = self.hierarchy.constructor(type_id) else {
            if !arguments.is_empty() {
                return Err(self.unsupported(id, "a `new` with arguments and no constructor"));
            }
            return Ok(object);
        };
        let owner = self
            .hierarchy
            .name
            .get(&declaring)
            .cloned()
            .unwrap_or(class);

        let mut args = vec![object];
        for argument in &arguments {
            args.push(self.lower_expression(*argument)?);
        }
        self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{owner}#constructor")),
                args,
                frame: None,
            },
            HirType::Void,
            origin,
        );
        Ok(object)
    }

    /// `xs[i]`, as a read. Writes are handled by the assignment lowering.
    fn lower_element_access(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let (array, index) = self.element_access_parts(id)?;
        // The element's representation comes from the *array*, not from the
        // access node's type. Under `noUncheckedIndexedAccess` — which is what
        // TypeScript actually knows — that type is `number | undefined`, and
        // there is no `undefined` to put in a double. What is stored in the
        // slot is a number; the `!` the author wrote is the claim that one is
        // there, and the bounds test is what checks it.
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[array.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(id, "indexing something that is not an array"));
        };
        let ty = *element;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::ArrayGet {
                array,
                index,
                checked: true,
            },
            ty,
            origin,
        ))
    }

    /// The array and index of an `xs[i]`, lowered in source order.
    fn element_access_parts(&mut self, id: NodeId) -> Result<(ValueId, ValueId), Diagnostic> {
        let children = self.children(id);
        let [array, index] = children.as_slice() else {
            return Err(self.unsupported(id, "an element access of unexpected shape"));
        };
        let array_value = self.lower_expression(*array)?;
        if !matches!(
            self.values[array_value.0 as usize].ty,
            HirType::Managed(ManagedType::Array(_))
        ) {
            return Err(self.unsupported(id, "indexing something that is not an array"));
        }
        let index_value = self.lower_expression(*index)?;
        Ok((array_value, index_value))
    }

    /// `xs.length`. Other members are not lowered yet.
    fn lower_property_access(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let [object, member] = children.as_slice() else {
            return Err(self.unsupported(id, "a property access of unexpected shape"));
        };
        let member_name = self
            .node(*member)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(id, "a computed property name"))?;
        let value = self.lower_expression(*object)?;

        if let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[value.0 as usize].ty.clone()
        {
            let layout = self.layout_of(id, type_id)?;
            let field = layout
                .index_of(&member_name)
                .ok_or_else(|| self.unsupported(id, "a property the type does not declare"))?;
            let ty = layout.fields[field as usize].ty.clone();
            let origin = self.origin(id);
            return Ok(self.push(
                OpKind::FieldGet {
                    object: value,
                    field,
                },
                ty,
                origin,
            ));
        }

        if member_name != "length" {
            return Err(self.unsupported(id, "this property"));
        }
        if !matches!(
            self.values[value.0 as usize].ty,
            HirType::Managed(ManagedType::Array(_) | ManagedType::String)
        ) {
            return Err(self.unsupported(id, "`length` of something without one"));
        }
        let origin = self.origin(id);
        Ok(self.push(OpKind::Length(value), HirType::NUMBER, origin))
    }

    /// `c ? a : b`, and the short-circuiting `a && b` / `a || b`.
    ///
    /// All three are one shape: evaluate a condition, take one of two paths, and
    /// arrive at a value that depends on which. That is a merge block with a
    /// parameter — the same mechanism an `if` uses for a name the two arms
    /// disagree about, applied to a value with no name.
    ///
    /// The point of doing it this way rather than evaluating both sides is that
    /// both sides *must not* be evaluated: `a && expensive()` does not call
    /// `expensive` when `a` is falsy, and in a language with side effects that
    /// is a semantic difference rather than an optimization.
    fn lower_branching_value(
        &mut self,
        id: NodeId,
        condition: ValueId,
        then_branch: Branch,
        else_branch: Branch,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a conditional"))?;

        let then_block = self.new_block();
        let else_block = self.new_block();
        self.terminate(Terminator::Branch {
            cond: condition,
            then_target: then_block,
            then_args: Vec::new(),
            else_target: else_block,
            else_args: Vec::new(),
        });

        let entry = self.bindings.clone();
        self.switch_to(then_block);
        let then_value = self.evaluate(then_branch)?;
        let then_tail = self.current;
        let then_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        self.switch_to(else_block);
        let else_value = self.evaluate(else_branch)?;
        let else_tail = self.current;
        let else_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        // The two arms must agree about representation, since one parameter
        // receives both. They do whenever the checker gave the expression a type
        // at all; a `number | string` would not be lowerable in the first place.
        let merge = self.new_block();
        let result = self.push_block_param(merge, ty, origin.clone());

        let mut merged = Vec::new();
        for (symbol, entering) in &entry {
            let from_then = then_bindings.get(symbol).copied().unwrap_or(*entering);
            let from_else = else_bindings.get(symbol).copied().unwrap_or(*entering);
            if from_then != from_else {
                merged.push((*symbol, from_then, from_else));
            }
        }
        merged.sort_unstable();

        let mut params = Vec::new();
        for (symbol, from_then, _) in &merged {
            let carried = self.values[from_then.0 as usize].ty.clone();
            params.push((
                *symbol,
                self.push_block_param(merge, carried, origin.clone()),
            ));
        }

        self.switch_to(then_tail);
        let mut args = vec![then_value];
        args.extend(merged.iter().map(|(_, from_then, _)| *from_then));
        self.terminate(Terminator::Jump {
            target: merge,
            args,
        });

        self.switch_to(else_tail);
        let mut args = vec![else_value];
        args.extend(merged.iter().map(|(_, _, from_else)| *from_else));
        self.terminate(Terminator::Jump {
            target: merge,
            args,
        });

        self.switch_to(merge);
        self.bindings = entry;
        for (symbol, param) in params {
            self.bindings.insert(symbol, param);
        }
        Ok(result)
    }

    /// Produce a branch's value: either an expression to lower here, or one
    /// already computed before the branch.
    fn evaluate(&mut self, branch: Branch) -> Result<ValueId, Diagnostic> {
        match branch {
            Branch::Expression(node) => self.lower_expression(node),
            Branch::Value(value) => Ok(value),
        }
    }

    /// `c ? a : b`.
    fn lower_conditional(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // condition, `?`, whenTrue, `:`, whenFalse — the punctuation is made of
        // children too, so the slots come from the presence bitmask.
        let Some([Some(condition), _, Some(when_true), _, Some(when_false)]) =
            self.child_slots::<5>(id)
        else {
            return Err(self.unsupported(id, "a conditional of unexpected shape"));
        };
        let condition = self.lower_expression(condition)?;
        let condition = self.truthy(id, condition);
        self.lower_branching_value(
            id,
            condition,
            Branch::Expression(when_true),
            Branch::Expression(when_false),
        )
    }

    /// `a && b` and `a || b`, which do not evaluate `b` unless they have to.
    fn lower_logical(
        &mut self,
        id: NodeId,
        and: bool,
        left: NodeId,
        right: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let first = self.lower_expression(left)?;
        let condition = self.truthy(id, first);
        // `a && b` is `b` when `a` is truthy and `a` otherwise; `a || b` is the
        // other way round. Neither yields a bool in general — `0 || 5` is `5`.
        let (then_branch, else_branch) = if and {
            (Branch::Expression(right), Branch::Value(first))
        } else {
            (Branch::Value(first), Branch::Expression(right))
        };
        self.lower_branching_value(id, condition, then_branch, else_branch)
    }

    /// A value as a condition, by JavaScript's rules.
    fn truthy(&mut self, id: NodeId, value: ValueId) -> ValueId {
        // A bool is already its own condition; anything else needs the rule.
        if matches!(self.values[value.0 as usize].ty, HirType::Bool) {
            return value;
        }
        let origin = self.origin(id);
        self.push(
            OpKind::Unary {
                op: UnOp::Truthy,
                operand: value,
            },
            HirType::Bool,
            origin,
        )
    }

    /// `-x`, `+x`, `!x`.
    ///
    /// # The operator is not a child
    ///
    /// A `BinaryExpression` holds its operator as a real token node, so
    /// [`Self::children`] returns it. A `PrefixUnaryExpression` does not: tsgo
    /// stores the operator as a `Kind` *field*, which the encoder packs into the
    /// node's small data as a dense index — see
    /// [`syntax::prefix_operator`] for why that index is not a `SyntaxKind`
    /// however firmly the encoder's documentation says it is. The only child is
    /// the operand.
    ///
    /// Unary `+` is `ToNumber`, which on something already typed `number` is the
    /// identity — including on `-0`, so it is dropped rather than lowered to an
    /// operation that would then have to preserve the sign of zero.
    fn lower_prefix_unary(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let NodeData::Children { small, .. } = self.node(id).data else {
            return Err(self.unsupported(id, "a unary expression without operator data"));
        };
        let children = self.children(id);
        let [operand] = children.as_slice() else {
            return Err(self.unsupported(id, "a unary expression of unexpected shape"));
        };

        // `++i` and `--i` step the name and evaluate to the *new* value, which
        // is the only way they differ from the postfix forms.
        if matches!(
            small & syntax::prefix_operator::MASK,
            syntax::prefix_operator::PLUS_PLUS | syntax::prefix_operator::MINUS_MINUS
        ) {
            let op =
                if small & syntax::prefix_operator::MASK == syntax::prefix_operator::MINUS_MINUS {
                    BinOp::Sub
                } else {
                    BinOp::Add
                };
            let (_, after) = self.step(id, *operand, op)?;
            return Ok(after);
        }

        // `~x` is `ToInt32(x) ^ -1`, which is what the specification says it is
        // and what makes it a bitwise operator rather than an arithmetic one:
        // the coercion is the whole of its behaviour on a non-integer, and
        // `~3.7` is `-4` for that reason rather than by rounding.
        if small & syntax::prefix_operator::MASK == syntax::prefix_operator::TILDE {
            let value = self.lower_expression(*operand)?;
            let origin = self.origin(id);
            let ones = self.push(OpKind::ConstFloat(-1.0), HirType::NUMBER, origin.clone());
            return Ok(self.push_bitwise(BinOp::BitXor, value, ones, HirType::NUMBER, &origin));
        }

        let op = match small & syntax::prefix_operator::MASK {
            syntax::prefix_operator::PLUS => None,
            syntax::prefix_operator::MINUS => Some(UnOp::Neg),
            syntax::prefix_operator::EXCLAMATION => Some(UnOp::Not),
            // `++`/`--` assign, and are handled above.
            _ => return Err(self.unsupported(id, "this unary operator")),
        };

        let value = self.lower_expression(*operand)?;
        let Some(op) = op else { return Ok(value) };
        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a unary expression"))?;
        Ok(self.push(OpKind::Unary { op, operand: value }, ty, origin))
    }

    fn lower_variable_statement(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        // A `VariableDeclarationList` is an ordinary syntax node, not a NodeList,
        // so `children` does not flatten it away — the declarations sit one level
        // further down than they appear to.
        let declarations: Vec<NodeId> = self
            .children(id)
            .into_iter()
            .flat_map(|child| {
                if self.kind_of(child) == Some(syntax::VARIABLE_DECLARATION_LIST) {
                    self.children(child)
                } else {
                    vec![child]
                }
            })
            .collect();

        for declaration in declarations {
            if self.kind_of(declaration) != Some(syntax::VARIABLE_DECLARATION) {
                continue;
            }
            // name, `!`, type, initializer — the annotation is a child too, so
            // `const scale: number = 3` has three where `const scale = 3` has
            // two. Destructuring positionally refused every annotated local.
            let Some([Some(name), _, _, initializer]) = self.child_slots::<4>(declaration) else {
                return Err(self.unsupported(declaration, "a declaration of unexpected shape"));
            };
            let Some(initializer) = initializer else {
                return Err(self.unsupported(declaration, "a declaration without an initializer"));
            };
            // An empty array literal has type `never[]`: with no elements the
            // checker has nothing to infer from. The declaration does know —
            // `const out: number[] = []` says so — so the annotation supplies
            // what the literal cannot.
            let value = if self.kind_of(initializer) == Some(syntax::ARRAY_LITERAL_EXPRESSION)
                && self.children(initializer).is_empty()
            {
                let declared = self
                    .type_of(name)
                    .ok_or_else(|| self.unrepresentable(declaration, "an empty array"))?;
                self.lower_empty_array(initializer, declared)?
            } else {
                self.lower_expression(initializer)?
            };
            let symbol = self
                .node(name)
                .symbol
                .ok_or_else(|| self.unsupported(name, "an unresolved declaration"))?;
            self.bindings.insert(symbol.0, value);
        }
        Ok(())
    }

    fn lower_string(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let text = self
            .snapshot
            .node_types
            .get(&id)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .and_then(|record| match &record.kind {
                TypeKind::Literal(LiteralValue::String(text)) => Some(text.clone()),
                _ => None,
            })
            .ok_or_else(|| self.unsupported(id, "a string literal with no known value"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::ConstString(text),
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// A call to a statically resolved target.
    ///
    /// Requires the frontend's call resolution: without it there is no way to
    /// know *which* function a call site reaches, and guessing from the callee's
    /// spelling would pick the wrong overload silently. Refusing is the honest
    /// answer, and the diagnostic says what is missing rather than what is
    /// unsupported.
    fn lower_call(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let Some(target) = self.snapshot.call_targets.get(&id) else {
            return Err(Diagnostic::error(
                "NTS1002",
                "this call was not resolved to a target; the frontend's call \
                 resolution pass has to run before lowering",
                self.location(id),
            ));
        };

        let children = self.children(id);
        let callee_node = *children
            .first()
            .ok_or_else(|| self.unsupported(id, "a call with no callee"))?;
        // Explicit type arguments are flattened in among the arguments, so
        // `f<number>(x)` would otherwise lower `number` as a value.
        let arguments = self.arguments_of(id);

        // `super(...)` and `super.method()`. The base is known statically -- a
        // class extends at most one -- so both are ordinary static calls with
        // `this` as the receiver, which is what they are once `this` is
        // explicit.
        if self.kind_of(callee_node) == Some(syntax::SUPER_KEYWORD) {
            return self.lower_super(id, "constructor", &arguments);
        }
        if self.kind_of(callee_node) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            let parts = self.children(callee_node);
            if let [target, member] = parts.as_slice()
                && self.kind_of(*target) == Some(syntax::SUPER_KEYWORD)
            {
                let name = self
                    .node(*member)
                    .text
                    .clone()
                    .ok_or_else(|| self.unsupported(*member, "a computed method name"))?;
                return self.lower_super(id, &name, &arguments);
            }
        }

        // `Math.floor(x)` and friends are operations, not calls. Lowering them
        // as operations is what lets the analysis see that the result is a whole
        // number — which is the entire reason an author writes `Math.floor`
        // rather than a division.
        if let Some(intrinsic) = self.math_intrinsic(callee_node) {
            return self.lower_math(id, intrinsic, &arguments);
        }

        // `Body.jupiter()` — a *static* method. It looks like a method call and
        // is not one: the thing before the dot is a class, which is a type
        // rather than a value, so lowering it as a receiver would ask for the
        // value of something that has none.
        //
        // Recognized from the checker's resolved target rather than from the
        // syntax, so an aliased import resolves the same as a plain name.
        if let Some(callee) = target.callee
            && self
                .node(callee)
                .modifiers
                .contains(nts_semantic_schema::DeclarationModifiers::STATIC)
            && let Some(class_name) = self.declaring_class_name(callee)
        {
            return self.lower_static_call(id, &class_name, callee, &arguments);
        }

        // `c.advance()` — a method call. The receiver becomes the first
        // argument, which is what a method is once it is explicit.
        if self.kind_of(callee_node) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            let parts = self.children(callee_node);
            let [receiver_node, member] = parts.as_slice() else {
                return Err(self.unsupported(callee_node, "a method call of unexpected shape"));
            };
            let receiver = self.lower_expression(*receiver_node)?;

            // A string's methods are the runtime's, not the program's: there is
            // no `String` class here to resolve a call against.
            if matches!(
                self.values[receiver.0 as usize].ty,
                HirType::Managed(ManagedType::String)
            ) {
                return self.lower_string_method(id, receiver, *member, &arguments);
            }
            if let HirType::Managed(ManagedType::Array(element)) =
                self.values[receiver.0 as usize].ty.clone()
            {
                return self.lower_array_method(id, receiver, &element, *member, &arguments);
            }

            let HirType::Managed(ManagedType::Object(type_id)) =
                self.values[receiver.0 as usize].ty.clone()
            else {
                return Err(self.unsupported(id, "a method call on something without methods"));
            };
            return self.lower_object_method(id, receiver, type_id, *member, &arguments);
        }

        // `f(x)` where `f` is a parameter, a local, or `pick(1)(x)` where it is
        // another call's result: the callee is a *value*, not a function, so
        // there is nothing to call directly. It holds a closure, which is an
        // object with one method, and this is a dispatch through that method's
        // slot with the closure itself as the receiver.
        if self.is_function_typed(callee_node) && !self.names_a_declared_function(callee_node) {
            return self.lower_closure_call(id, callee_node, &arguments);
        }

        let name = self
            .node(callee_node)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(callee_node, "a computed callee"))?;

        // A callee inside the compiled program becomes a static call; one outside
        // it is still typed exactly, and the definition comes from elsewhere.
        //
        // "Inside" means *defined* here, not merely declared here. A
        // `declare function` has a declaration node and no body, and calling it
        // directly would name a function this program never emits.
        let defined = target
            .callee
            .is_some_and(|declaration| self.has_a_body(declaration));
        let callee = if defined {
            Callee::Direct(name)
        } else {
            Callee::External(name)
        };

        let mut args = Vec::new();
        for argument in &arguments {
            args.push(self.lower_expression(*argument)?);
        }

        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a call returning an unrepresentable type"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee,
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// The name of the class a member is declared on.
    ///
    /// By walking to the declaration's parent rather than reading the name
    /// before the dot: `import { Body as B }` puts `B` at the call site and
    /// `Body` on the function, and the two have to agree.
    fn declaring_class_name(&self, member: NodeId) -> Option<String> {
        let class = self.ancestor(member, syntax::CLASS_DECLARATION)?;
        self.children(class)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| self.node(child).text.clone())
    }

    /// `Class.member(...)`: an ordinary direct call to a function with no
    /// receiver.
    fn lower_static_call(
        &mut self,
        id: NodeId,
        class_name: &str,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let member_name = self
            .children(member)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| self.node(child).text.clone())
            .ok_or_else(|| self.unsupported(member, "a static method with a computed name"))?;

        let mut args = Vec::new();
        for argument in arguments {
            args.push(self.lower_expression(*argument)?);
        }
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a call returning an unrepresentable type"))?;
        self.materialize(id, &ty)?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{class_name}.{member_name}")),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// `f(x)` where `f` holds a closure.
    ///
    /// The receiver goes first, exactly as it does for a method, and the slot
    /// is the one every closure's `call` occupies. What makes the single slot
    /// safe is that the call spells its own signature: two closure types
    /// sharing an index are never confused, because neither call site consults
    /// the other's types.
    fn lower_closure_call(
        &mut self,
        id: NodeId,
        callee_node: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let receiver = self.lower_expression(callee_node)?;
        let HirType::Managed(ManagedType::Object(receiver_ty)) =
            self.values[receiver.0 as usize].ty
        else {
            return Err(self.unsupported(callee_node, "a call of something that is not a function"));
        };
        // A closure class is final: nothing extends it, and only the arrow it
        // was made for fills its slot. So where the receiver's static type *is*
        // the closure class rather than the signature, which body runs is known
        // here, and the call is a direct one.
        //
        // This is not a nicety, because clang cannot recover it: to fold the
        // table load it would have to prove the callee does not write the
        // receiver's descriptor, and it cannot know the callee without folding
        // the load. What is left is an indirect call per iteration where there
        // should be an inlined multiply.
        let callee = if receiver_ty.0 >= super::SYNTHETIC_TYPE_FLOOR {
            Callee::Direct(closure_names((u32::MAX - receiver_ty.0) as usize).1)
        } else if let Some(slot) = self.hierarchy.closure_slot {
            Callee::Closure { slot }
        } else {
            return Err(self.unsupported(
                id,
                "a call of a function value in a program with no closures",
            ));
        };

        let mut args = vec![receiver];
        for argument in arguments {
            args.push(self.lower_expression(*argument)?);
        }
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a call returning an unrepresentable type"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee,
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// The `Math` member a callee names, if it names one.
    ///
    /// Recognized by shape rather than by symbol identity, which is a
    /// simplification: a program that shadowed the global `Math` with its own
    /// object would be mis-read. It cannot be shadowed by a *function* in the
    /// compiled program — that call would resolve to a direct target and never
    /// reach here — so the remaining case is an import named `Math` with
    /// matching method names.
    ///
    /// `docs/any-unknown.md` describes the principled version: profiles that
    /// associate trusted *declaration identities* with a closed set of
    /// compiler-owned semantics, so the core never matches on a name at all.
    /// This is the shape that becomes.
    fn math_intrinsic(&self, callee: NodeId) -> Option<MathIntrinsic> {
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let children = self.children(callee);
        let object = *children.first()?;
        let member = *children.last()?;
        if self.kind_of(object) != Some(syntax::IDENTIFIER)
            || self.node(object).text.as_deref() != Some("Math")
        {
            return None;
        }
        match self.node(member).text.as_deref()? {
            "floor" => Some(MathIntrinsic::Unary(UnOp::Floor)),
            "ceil" => Some(MathIntrinsic::Unary(UnOp::Ceil)),
            "trunc" => Some(MathIntrinsic::Unary(UnOp::Trunc)),
            "round" => Some(MathIntrinsic::Unary(UnOp::Round)),
            "abs" => Some(MathIntrinsic::Unary(UnOp::Abs)),
            "sqrt" => Some(MathIntrinsic::Unary(UnOp::Sqrt)),
            "min" => Some(MathIntrinsic::Binary(BinOp::Min)),
            "max" => Some(MathIntrinsic::Binary(BinOp::Max)),
            _ => None,
        }
    }

    fn lower_math(
        &mut self,
        id: NodeId,
        intrinsic: MathIntrinsic,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a `Math` call of unrepresentable type"))?;
        let origin = self.origin(id);

        match (intrinsic, arguments) {
            (MathIntrinsic::Unary(op), [argument]) => {
                let operand = self.lower_expression(*argument)?;
                Ok(self.push(OpKind::Unary { op, operand }, ty, origin))
            }
            (MathIntrinsic::Binary(op), [left, right]) => {
                let lhs = self.lower_expression(*left)?;
                let rhs = self.lower_expression(*right)?;
                Ok(self.push(OpKind::Binary { op, lhs, rhs }, ty, origin))
            }
            // `Math.min()` is `Infinity` and `Math.min(a, b, c)` folds, but both
            // are shapes this lowering does not accept yet, and quietly
            // producing the two-argument answer for a three-argument call would
            // be wrong in a way nothing downstream could detect.
            _ => Err(self.unsupported(id, "a `Math` call with this many arguments")),
        }
    }

    /// A method on a string.
    ///
    /// Every one of these is a runtime call, because a string has no layout to
    /// resolve a member against and no class the program declares. The set is
    /// deliberately the operations that are *exactly* expressible over UTF-16
    /// code units, which is what a `NtsString` holds -- so each is the same
    /// function JavaScript specifies rather than an approximation of it.
    ///
    /// `toUpperCase`, `toLowerCase` and `trim` are absent for that reason. All
    /// three are defined over Unicode, not over ASCII, and an ASCII version
    /// would be right for most inputs and quietly wrong for the rest. Refusing
    /// beats that.
    fn lower_string_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self
            .node(member)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(member, "a computed method name"))?;

        // (runtime function, how many arguments after the receiver, result)
        let string = HirType::Managed(ManagedType::String);
        // `charCodeAt` is an operation rather than a call: as a call its index
        // would have to match a C signature, which pins the loop counter that
        // produces it to a `double` and makes every step downstream floating
        // point.
        if name == "charCodeAt"
            && let [argument] = arguments
        {
            let index = self.lower_expression(*argument)?;
            let origin = self.origin(id);
            return Ok(self.push(
                OpKind::StringUnitAt {
                    string: receiver,
                    index,
                    checked: true,
                },
                HirType::NUMBER,
                origin,
            ));
        }

        let (helper, arity, ty) = match name.as_str() {
            "codePointAt" => ("nts_str_code_point_at", 1, HirType::NUMBER),
            "indexOf" => ("nts_str_index_of", 1, HirType::NUMBER),
            "lastIndexOf" => ("nts_str_last_index_of", 1, HirType::NUMBER),
            "includes" => ("nts_str_includes", 1, HirType::Bool),
            "startsWith" => ("nts_str_starts_with", 1, HirType::Bool),
            "endsWith" => ("nts_str_ends_with", 1, HirType::Bool),
            "charAt" => ("nts_str_char_at", 1, string.clone()),
            "repeat" => ("nts_str_repeat", 1, string.clone()),
            "slice" => ("nts_str_slice", 2, string.clone()),
            "substring" => ("nts_str_substring", 2, string.clone()),
            "concat" => ("nts_concat", 1, string),
            _ => return Err(self.unsupported(member, "this string method")),
        };

        let mut args = vec![receiver];
        for argument in arguments {
            args.push(self.lower_expression(*argument)?);
        }
        let origin = self.origin(id);

        // An omitted trailing argument becomes the default the specification
        // gives it, which for every two-argument member here is "to the end".
        // Passing it explicitly means the runtime has one signature rather than
        // two, and the default is written down once.
        while args.len() < arity + 1 {
            let end = self.push(
                OpKind::ConstFloat(f64::INFINITY),
                HirType::NUMBER,
                origin.clone(),
            );
            args.push(end);
        }
        if args.len() != arity + 1 {
            return Err(self.unsupported(id, "a string method with this many arguments"));
        }

        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// A method on an array.
    ///
    /// The same shape as a string's: a runtime call, because an array has no
    /// layout to resolve a member against. The set is what can be done *without
    /// growing* the array and without a callback -- `push`, `splice` and the
    /// rest change the length, which the current representation cannot do
    /// because the elements are inline and growing would move the object;
    /// `map`, `filter` and `forEach` take a function, which needs closures.
    /// Both are real extensions rather than oversights.
    ///
    /// Elements must be numbers. A reference array's `indexOf` compares by
    /// identity and its `slice` has to retain what it copies, and neither is
    /// something to guess at.
    fn lower_array_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        element: &HirType,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self
            .node(member)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(member, "a computed method name"))?;

        // `xs.forEach(v => ...)` is a loop written as a call, and it is
        // compiled as the loop. See [`Self::lower_for_each`].
        if name == "forEach"
            && let [callback] = arguments
            && self.kind_of(*callback) == Some(syntax::ARROW_FUNCTION)
        {
            return self.lower_for_each(id, receiver, element, *callback);
        }

        // `fill` is the one method whose element type does not have to be a
        // number: it writes a value it was given rather than comparing or
        // arithmetic-ing one, so the only thing that changes is how wide the
        // write is. `new Array(n).fill(true)` is how three of the Are We Fast
        // Yet benchmarks make their working set.
        if name == "fill" && !matches!(element, HirType::Float { .. } | HirType::Int { .. }) {
            return self.lower_wide_fill(id, receiver, element, arguments);
        }
        if !matches!(element, HirType::Float { .. } | HirType::Int { .. }) {
            return Err(self.unsupported(member, "an array method on a non-numeric array"));
        }
        let array = HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER)));

        // (runtime function, arguments after the receiver, result)
        let (helper, arity, ty) = match name.as_str() {
            // `push` returns the new length, which is what the expression is
            // worth in JavaScript, and `pop` returns what it removed -- NaN from
            // an empty array, because that is what `undefined` is for a number.
            "push" => ("nts_array_push", 1, HirType::NUMBER),
            "pop" => ("nts_array_pop", 0, HirType::NUMBER),
            "indexOf" => ("nts_array_index_of", 1, HirType::NUMBER),
            "lastIndexOf" => ("nts_array_last_index_of", 1, HirType::NUMBER),
            "includes" => ("nts_array_includes", 1, HirType::Bool),
            "at" => ("nts_array_at", 1, HirType::NUMBER),
            "fill" => ("nts_array_fill", 1, array.clone()),
            "reverse" => ("nts_array_reverse", 0, array.clone()),
            "slice" => ("nts_array_slice", 2, array),
            _ => return Err(self.unsupported(member, "this array method")),
        };

        let mut args = vec![receiver];
        for argument in arguments {
            args.push(self.lower_expression(*argument)?);
        }
        let origin = self.origin(id);
        while args.len() < arity + 1 {
            let end = self.push(
                OpKind::ConstFloat(f64::INFINITY),
                HirType::NUMBER,
                origin.clone(),
            );
            args.push(end);
        }
        if args.len() != arity + 1 {
            return Err(self.unsupported(id, "an array method with this many arguments"));
        }

        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// A method call on an object, once the receiver is lowered.
    ///
    /// Two questions, and they are different. Which class *declares* the method
    /// is not always the receiver's -- `new Square(n).describe()` calls
    /// `Shape#describe` when only `Shape` declares one. And whether the call is
    /// static is decided by whether anything *below* the receiver's type
    /// overrides it, which the compiler can answer because TypeScript closes the
    /// hierarchy.
    ///
    /// So a call on a `Square` is static even where the same method on a `Shape`
    /// dispatches: nothing below `Square` overrides anything.
    /// `xs.fill(v)` where the elements are not numbers.
    ///
    /// A boolean is a byte and a reference is a pointer, so each has its own
    /// entry point rather than one taking a width -- the compiler knows the
    /// element type, and a runtime that had to be told it would be told it
    /// wrongly one day. The reference one counts what it stores.
    fn lower_wide_fill(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        element: &HirType,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let helper = match element {
            HirType::Bool => "nts_array_fill_bool",
            HirType::Managed(_) => "nts_array_fill_ref",
            _ => return Err(self.unsupported(id, "a `fill` on an array of this element type")),
        };
        let [value] = arguments else {
            return Err(self.unsupported(id, "a `fill` with a range on this array"));
        };
        let value = self.lower_expecting(*value, element)?;
        let origin = self.origin(id);
        let ty = HirType::Managed(ManagedType::Array(Box::new(element.clone())));
        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args: vec![receiver, value],
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// `xs.forEach(v => ...)` over an array, with the arrow written at the call.
    ///
    /// # Why a desugaring rather than a call
    ///
    /// Compiled as a closure it would allocate an object, pass it to a runtime
    /// helper, and dispatch through a slot once per element. Every one of those
    /// is machinery for a question the source has already answered: which body
    /// runs is written right there.
    ///
    /// Compiled as a loop it is [`Self::lower_for_of`] with the element name
    /// coming from the arrow's parameter instead of from a binding form, and it
    /// costs exactly what the hand-written loop costs.
    ///
    /// # What it also fixes
    ///
    /// `collect_closures` refuses to capture a variable something *assigns* to,
    /// because this compiler captures by value and JavaScript captures by
    /// reference. So the shape Are We Fast Yet's nbody uses --
    ///
    /// ```text
    /// bodies.forEach((b) => { px += b.vx * b.mass; });
    /// ```
    ///
    /// -- could not be compiled at all. Inlined there is no capture: `px` is an
    /// ordinary local the loop body assigns, and the loop carries it the way it
    /// carries any other. The refusal is right about closures and simply does
    /// not apply.
    ///
    /// Only for an arrow written at the call site. `xs.forEach(f)` where `f` is
    /// a variable is a genuine dispatch, and monomorphization is the answer to
    /// that one.
    fn lower_for_each(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        element_ty: &HirType,
        callback: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let parts = self.children(callback);
        let element_name = parts
            .iter()
            .find(|child| self.kind_of(**child) == Some(syntax::PARAMETER))
            .map(|parameter| self.children(*parameter))
            .and_then(|fields| {
                fields
                    .into_iter()
                    .find(|field| self.kind_of(*field) == Some(syntax::IDENTIFIER))
            })
            .ok_or_else(|| self.unsupported(callback, "a `forEach` callback of this shape"))?;
        let element_symbol = self
            .node(element_name)
            .symbol
            .ok_or_else(|| self.unsupported(element_name, "a `forEach` name with no symbol"))?
            .0;
        // The index parameter every `forEach` callback may take. Refused rather
        // than bound, because binding it would need the loop counter's identity
        // to survive into the body and this has no test for that yet.
        if parts
            .iter()
            .filter(|child| self.kind_of(**child) == Some(syntax::PARAMETER))
            .count()
            > 1
        {
            return Err(self.unsupported(callback, "a `forEach` callback taking the index"));
        }
        let body = *parts
            .last()
            .ok_or_else(|| self.unsupported(callback, "a `forEach` callback with no body"))?;

        let origin = self.origin(id);
        let index = self.synthetic_symbol();
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.bindings.insert(index, zero);

        let mut carried = vec![index];
        self.assigned_symbols(body, &mut carried);
        let mut declared = vec![element_symbol];
        self.declared_symbols(body, &mut declared);
        carried.retain(|symbol| *symbol == index || !declared.contains(symbol));

        let header = self.new_block();
        let params = self.open_loop(id, header, &carried, &origin)?;
        let (body_block, exit) = self.loop_blocks();

        let at = self.bindings[&index];
        let length = self.push(OpKind::Length(receiver), HirType::NUMBER, origin.clone());
        let cond = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: at,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.test_loop(cond, body_block, exit);
        self.switch_to(body_block);

        let at = self.bindings[&index];
        let value = self.push(
            OpKind::ArrayGet {
                array: receiver,
                index: at,
                checked: true,
            },
            element_ty.clone(),
            origin.clone(),
        );
        self.bindings.insert(element_symbol, value);

        // A concise body is an expression rather than a block, and its value is
        // discarded -- `forEach` returns nothing whatever the callback does.
        if self.kind_of(body) == Some(syntax::BLOCK) {
            self.lower_statement(body)?;
        } else {
            self.lower_expression(body)?;
        }
        if !self.is_terminated() {
            let at = self.bindings[&index];
            let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
            let next = self.push(
                OpKind::Binary {
                    op: BinOp::Add,
                    lhs: at,
                    rhs: one,
                },
                HirType::NUMBER,
                origin.clone(),
            );
            self.bindings.insert(index, next);
        }
        self.close_loop(header, &carried, &params, exit);

        // `forEach` evaluates to `undefined`, which is `void` here. Nothing
        // reads it -- an expression statement is the only place this appears --
        // but the caller wants a value.
        Ok(self.push(OpKind::ConstFloat(0.0), HirType::Void, origin))
    }

    fn lower_object_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        type_id: TypeId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let member_name = self
            .node(member)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(member, "a computed method name"))?;

        let declaring = self
            .hierarchy
            .declaring(type_id, &member_name)
            .unwrap_or(type_id);
        let owner = match self.hierarchy.name.get(&declaring) {
            Some(name) => name.clone(),
            None => self.layout_of(id, declaring)?.name,
        };

        let callee = if self.hierarchy.overridden(type_id, &member_name)
            && let Some(slot) = self.hierarchy.slot_for(type_id, &member_name)
        {
            Callee::Virtual {
                slot,
                declared: format!("{owner}#{member_name}"),
            }
        } else {
            Callee::Direct(format!("{owner}#{member_name}"))
        };

        let mut args = vec![receiver];
        for argument in arguments {
            args.push(self.lower_expression(*argument)?);
        }
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a call returning an unrepresentable type"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee,
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// A call into the base class, with `this` as the receiver.
    fn lower_super(
        &mut self,
        id: NodeId,
        member: &str,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let base = self
            .base
            .clone()
            .ok_or_else(|| self.unsupported(id, "`super` outside a derived class"))?;
        let receiver = self
            .this
            .ok_or_else(|| self.unsupported(id, "`super` outside a method"))?;

        // Which class above this one actually has the thing being called. Not
        // necessarily the immediate base: a method declared on a grandparent
        // and inherited through the parent is the grandparent's function, and a
        // constructor a base does not declare is one further up still.
        let above = match self.values[receiver.0 as usize].ty {
            HirType::Managed(ManagedType::Object(ty)) => self.hierarchy.base.get(&ty).copied(),
            _ => None,
        };
        let declaring = above.and_then(|base| {
            if member == "constructor" {
                self.hierarchy.constructor(base)
            } else {
                self.hierarchy.declaring(base, member)
            }
        });
        let base = match declaring.and_then(|ty| self.hierarchy.name.get(&ty)) {
            Some(name) => name.clone(),
            // Nothing above declares it. For a constructor that is ordinary --
            // a base class with only methods has none, and `super()` in a
            // derived one has nothing to run. The receiver stands in as the
            // expression's value, which no `super()` statement looks at.
            None if member == "constructor" => return Ok(receiver),
            None => base,
        };

        let mut args = vec![receiver];
        for argument in arguments {
            args.push(self.lower_expression(*argument)?);
        }
        let origin = self.origin(id);
        // A `super(...)` produces nothing; `super.m()` produces whatever `m`
        // does, and the checker typed the call node accordingly.
        let ty = if member == "constructor" {
            HirType::Void
        } else {
            self.type_of(id).unwrap_or(HirType::Void)
        };
        Ok(self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{base}#{member}")),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// The name of the class a class extends.
    fn base_class(&self, class: NodeId) -> Option<String> {
        let ty = self.snapshot.node_types.get(&class)?;
        // `extends` first, then `implements`, and a class extends at most one
        // class -- so the first base is the superclass when there is one.
        let base = *self.snapshot.base_types.get(ty)?.first()?;
        let symbol = self.snapshot.types.get(base.0 as usize)?.symbol?;
        Some(self.snapshot.symbols.get(symbol.0 as usize)?.name.clone())
    }

    fn lower_identifier(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // `Infinity`, `NaN` and `undefined` are global bindings that no scope in
        // the program declares, and each is a constant. Resolving them by name
        // is safe for a reason worth stating: all three are non-writable,
        // non-configurable properties of the global object, so unlike an
        // ordinary global they cannot have been reassigned. A local named
        // `NaN` would shadow them, and is caught before this by the binding
        // lookup below coming first.
        if let Some(symbol) = self.node(id).symbol
            && self.bindings.contains_key(&symbol.0)
        {
            return Ok(self.bindings[&symbol.0]);
        }
        let origin = self.origin(id);
        match self.node(id).text.as_deref() {
            Some("Infinity") => {
                return Ok(self.push(OpKind::ConstFloat(f64::INFINITY), HirType::NUMBER, origin));
            }
            Some("NaN") => {
                return Ok(self.push(OpKind::ConstFloat(f64::NAN), HirType::NUMBER, origin));
            }
            // `undefined` is not a keyword in an expression -- it is an
            // identifier bound to a non-writable property of the global object.
            // A local of that name would shadow it, and the binding lookup
            // above is what catches one.
            Some("undefined") => return self.lower_absent(id),
            _ => {}
        }

        let symbol = self
            .node(id)
            .symbol
            .ok_or_else(|| self.unsupported(id, "an unresolved name"))?;
        if let Some(value) = self.bindings.get(&symbol.0) {
            return Ok(*value);
        }

        // Declared at module scope. A constant is its value; a variable is a
        // load.
        let origin = self.origin(id);
        if let Some(constant) = self.module.constants.get(&symbol.0) {
            return Ok(self.push(OpKind::ConstFloat(*constant), HirType::NUMBER, origin));
        }
        if let Some(global) = self.module.variables.get(&symbol.0) {
            let ty = self.module.types[*global as usize].clone();
            return Ok(self.push(OpKind::GlobalGet(*global), ty, origin));
        }
        // Declared at module scope and not representable. Saying which is worth
        // more than "a name declared outside this function", and it is only said
        // for a name something actually reads.
        if let Some(reason) = self.module.unsupported.get(&symbol.0) {
            return Err(self.unsupported(id, reason));
        }
        Err(self.unsupported(id, "a name declared outside this function"))
    }

    /// `null` and `undefined`, which are one value in a compiled program.
    ///
    /// A reference has a value that is not an object, so the absence needs no
    /// tag beside it. What it does need is a *type*: C tells a null
    /// `NtsString *` from a null `NtsObj_Point *` even though both are the same
    /// address, and the literal itself has neither -- the checker types it
    /// `null`. So the type comes from where the literal sits.
    fn lower_absent(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let ty = self
            .contextual_type(id, 0)
            .or_else(|| self.expecting.clone())
            .filter(HirType::is_managed);
        let Some(ty) = ty else {
            return Err(self.unsupported(
                id,
                "`null` or `undefined` where what it stands in for is not a reference",
            ));
        };
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstNull, ty, origin))
    }

    /// The type an expression is expected to have, from where it sits.
    ///
    /// Only for the literals that have no type of their own. The checker types
    /// `null` as `null`, which is true and useless: what a backend needs is the
    /// reference type the absence is standing in for, and that is a property of
    /// the position rather than of the token.
    fn contextual_type(&self, id: NodeId, depth: u32) -> Option<HirType> {
        if depth > 8 {
            return None;
        }
        let parent = self.node(id).parent?;
        match self.kind_of(parent) {
            // `return null` — whatever the enclosing function promised.
            Some(syntax::RETURN_STATEMENT) => {
                let owner = self.enclosing_callable(parent)?;
                self.declared_return(owner)
            }
            // `const x: Element | null = null`, `next: Element | null = null`,
            // and a parameter default. The declaration names the type.
            Some(
                syntax::VARIABLE_DECLARATION | syntax::PROPERTY_DECLARATION | syntax::PARAMETER,
            ) => self
                .children(parent)
                .into_iter()
                // The written annotation, which is every child but the name and
                // the initializer this came from. Not the *name's* type: the
                // checker narrows it by the initializer, so `let head: Element
                // | null = null` types `head` as `null` right there -- true,
                // and not what the storage is.
                .filter(|child| *child != id && self.kind_of(*child) != Some(syntax::IDENTIFIER))
                .find_map(|child| self.type_of(child))
                .or_else(|| {
                    self.children(parent)
                        .into_iter()
                        .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
                        .and_then(|name| self.type_of(name))
                }),
            // `x = null`, `p.next = null` — what the left side holds. And
            // `at !== null` — whatever the other side is, since a comparison
            // against the absent value is a comparison in that side's type.
            Some(syntax::BINARY_EXPRESSION) => {
                let parts = self.children(parent);
                let [left, operator, right] = parts.as_slice() else {
                    return None;
                };
                match self.kind_of(*operator) {
                    Some(syntax::EQUALS_TOKEN) => self.type_of(*left),
                    Some(
                        syntax::EQUALS_EQUALS_TOKEN
                        | syntax::EQUALS_EQUALS_EQUALS_TOKEN
                        | syntax::EXCLAMATION_EQUALS_TOKEN
                        | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN,
                    ) => {
                        let other = if *left == id { *right } else { *left };
                        self.type_of(other)
                    }
                    _ => None,
                }
            }
            // `f(null)` and `new Element(v, null)` — the parameter it fills.
            // The signature is the checker's answer after overload resolution,
            // so this is exact rather than a guess at which overload.
            Some(syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION) => {
                let at = self
                    .children(parent)
                    .iter()
                    .position(|child| *child == id)?;
                // The callee rather than an argument: `new Array(6).fill(0)`
                // reaches here from the `new`, and what the whole call is
                // expected to be is what its receiver is expected to be. A
                // fallback only -- a caller that asked for something specific
                // rejects an answer that is not it.
                let Some(argument) = at.checked_sub(1) else {
                    return self.contextual_type(parent, depth + 1);
                };
                let target = self.snapshot.call_targets.get(&parent)?;
                let signature = self.snapshot.signatures.get(target.signature.0 as usize)?;
                let parameter = signature.parameters.get(argument)?;
                self.represent(parameter.ty)
            }
            // The receiver of `x.m()`, for the same reason.
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => {
                if self.children(parent).first() != Some(&id) {
                    return None;
                }
                self.contextual_type(parent, depth + 1)
            }
            // Grouping and assertions carry the context through unchanged.
            Some(
                syntax::PARENTHESIZED_EXPRESSION
                | syntax::AS_EXPRESSION
                | syntax::SATISFIES_EXPRESSION
                | syntax::CONDITIONAL_EXPRESSION,
            ) => self.contextual_type(parent, depth + 1),
            _ => None,
        }
    }

    /// The function, method or arrow a node sits inside.
    fn enclosing_callable(&self, id: NodeId) -> Option<NodeId> {
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
                )
            ) {
                return Some(here);
            }
            at = self.node(here).parent;
        }
        None
    }

    fn lower_number(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // The source text first, parsed here.
        //
        // The checker's value is a convenience and is not always right: tsgo
        // returns `1` for `0.9999999999999999`, because a mantissa of sixteen
        // nines is above 2^53 and rounds up before the division by a power of
        // ten. `0.9999999999999998` survives, because that mantissa is even.
        // test262 found it.
        //
        // Rust's float parser is correctly rounded, and the literal's own text
        // is the authority on what the literal is -- so there is no reason to
        // ask anyone else. The checker's value stays as the fallback for a
        // spelling this does not read.
        if let Some(text) = self.node(id).text.as_deref()
            && let Some(value) = parse_number(text)
        {
            let origin = self.origin(id);
            return Ok(self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin));
        }

        let value = match self.snapshot.constants.get(&id) {
            Some(nts_semantic_schema::ConstantValue::Number(value)) => *value,
            _ => self
                .snapshot
                .node_types
                .get(&id)
                .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
                .and_then(|record| match &record.kind {
                    TypeKind::Literal(LiteralValue::Number(value)) => Some(*value),
                    _ => None,
                })
                .ok_or_else(|| self.unsupported(id, "a numeric literal with no known value"))?,
        };
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin))
    }

    fn lower_binary(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let [lhs_node, operator, rhs_node] = children.as_slice() else {
            return Err(self.unsupported(id, "a binary expression of unexpected shape"));
        };

        // Assignment is not arithmetic on a location: it rebinds a name to a
        // value. With the name bound directly there is no slot to store into and
        // nothing to emit — the rebinding *is* the assignment.
        if self.kind_of(*operator) == Some(syntax::EQUALS_TOKEN) {
            return self.lower_assignment(id, *lhs_node, *rhs_node);
        }

        // `&&` and `||` must not evaluate their right operand unless the left
        // one requires it, so they are taken before the ordinary path lowers
        // both.
        let token = self.kind_of(*operator).unwrap_or(0);
        if token == syntax::AMPERSAND_AMPERSAND_TOKEN || token == syntax::BAR_BAR_TOKEN {
            return self.lower_logical(
                id,
                token == syntax::AMPERSAND_AMPERSAND_TOKEN,
                *lhs_node,
                *rhs_node,
            );
        }

        // `x += e` is `x = x + e`: the operator applies, and the name rebinds.
        // Spelling it out here rather than in a desugaring keeps one place that
        // knows a bitwise operator needs its coercions.
        if let Some(op) = compound_operator(self.kind_of(*operator).unwrap_or(0)) {
            let place = self.place_of(*lhs_node)?;
            let current = self.read_place(*lhs_node, &place)?;
            let addend = self.lower_expression(*rhs_node)?;
            let ty = self.type_of(id).ok_or_else(|| {
                self.unsupported(id, "a compound assignment of unrepresentable type")
            })?;
            let origin = self.origin(id);
            let updated = if bitwise_operator_of(op) {
                self.push_bitwise(op, current, addend, ty, &origin)
            } else {
                self.push(
                    OpKind::Binary {
                        op,
                        lhs: current,
                        rhs: addend,
                    },
                    ty,
                    origin,
                )
            };
            self.write_place(id, &place, updated);
            return Ok(updated);
        }

        let lhs = self.lower_expression(*lhs_node)?;
        let rhs = self.lower_expression(*rhs_node)?;
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a binary expression of unrepresentable type"))?;

        let token = self
            .kind_of(*operator)
            .ok_or_else(|| self.unsupported(id, "a binary expression with no operator"))?;

        // A bitwise operator is `ToInt32`, the machine operation, and back. The
        // coercion is made explicit rather than folded into the operator so the
        // analysis can see it: `ToInt32` is where "this value is an integer"
        // stops being a hope and becomes a fact, and `x | 0` is how a TypeScript
        // author writes exactly that.
        if let Some(op) = bitwise_operator(token) {
            let origin = self.origin(id);
            return Ok(self.push_bitwise(op, lhs, rhs, ty, &origin));
        }

        // `+` is not one operator. On numbers it is arithmetic; on strings it is
        // concatenation, and the two lower to nothing alike. Resolving it here
        // against the result type means no backend has to ask again.
        let op = match token {
            syntax::EQUALS_TOKEN => unreachable!("assignment is handled before this"),
            syntax::PLUS_TOKEN if ty.is_managed() => BinOp::Concat,
            syntax::PLUS_TOKEN => BinOp::Add,
            syntax::MINUS_TOKEN => BinOp::Sub,
            syntax::ASTERISK_TOKEN => BinOp::Mul,
            syntax::SLASH_TOKEN => BinOp::Div,
            syntax::PERCENT_TOKEN => BinOp::Rem,
            syntax::LESS_THAN_TOKEN => BinOp::Lt,
            syntax::LESS_THAN_EQUALS_TOKEN => BinOp::Le,
            syntax::GREATER_THAN_TOKEN => BinOp::Gt,
            syntax::GREATER_THAN_EQUALS_TOKEN => BinOp::Ge,
            // `==` and `===` differ only by coercion, and both operands are
            // already known to be numbers here — where the two agree. A `==`
            // between different types would not reach this lowering, because
            // the checker rejects it under `strict`.
            syntax::EQUALS_EQUALS_TOKEN | syntax::EQUALS_EQUALS_EQUALS_TOKEN => BinOp::Eq,
            syntax::EXCLAMATION_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN => BinOp::Ne,
            _ => return Err(self.unsupported(*operator, "this operator")),
        };

        let origin = self.origin(id);
        Ok(self.push(OpKind::Binary { op, lhs, rhs }, ty, origin))
    }
}

/// The bitwise operator a token spells, if it spells one.
const fn bitwise_operator(token: u16) -> Option<BinOp> {
    Some(match token {
        syntax::AMPERSAND_TOKEN => BinOp::BitAnd,
        syntax::BAR_TOKEN => BinOp::BitOr,
        syntax::CARET_TOKEN => BinOp::BitXor,
        syntax::LESS_THAN_LESS_THAN_TOKEN => BinOp::Shl,
        syntax::GREATER_THAN_GREATER_THAN_TOKEN => BinOp::Shr,
        syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_TOKEN => BinOp::UShr,
        _ => return None,
    })
}

/// The operator a compound-assignment token applies.
const fn compound_operator(token: u16) -> Option<BinOp> {
    Some(match token {
        syntax::PLUS_EQUALS_TOKEN => BinOp::Add,
        syntax::MINUS_EQUALS_TOKEN => BinOp::Sub,
        syntax::ASTERISK_EQUALS_TOKEN => BinOp::Mul,
        syntax::SLASH_EQUALS_TOKEN => BinOp::Div,
        syntax::PERCENT_EQUALS_TOKEN => BinOp::Rem,
        syntax::AMPERSAND_EQUALS_TOKEN => BinOp::BitAnd,
        syntax::BAR_EQUALS_TOKEN => BinOp::BitOr,
        syntax::CARET_EQUALS_TOKEN => BinOp::BitXor,
        syntax::LESS_THAN_LESS_THAN_EQUALS_TOKEN => BinOp::Shl,
        syntax::GREATER_THAN_GREATER_THAN_EQUALS_TOKEN => BinOp::Shr,
        syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_EQUALS_TOKEN => BinOp::UShr,
        _ => return None,
    })
}

/// Whether an operator needs the `ToInt32` coercions.
const fn bitwise_operator_of(op: BinOp) -> bool {
    matches!(
        op,
        BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr
    )
}

/// The values a declared type admits.
///
/// Only literal types and unions of them say anything useful; everything else
/// is as wide as its representation. Bounded so that a self-referential union
/// cannot make this recurse forever — the checker should not produce one, but a
/// stack overflow is a poor way to find out.
fn known_values(snapshot: &SemanticSnapshot, ty: TypeId, depth: u32) -> Facts {
    const MAX_DEPTH: u32 = 8;
    if depth > MAX_DEPTH {
        return Facts::TOP;
    }
    let Some(record) = snapshot.types.get(ty.0 as usize) else {
        return Facts::TOP;
    };
    match &record.kind {
        TypeKind::Literal(LiteralValue::Number(value)) => Facts::constant(*value),
        TypeKind::Union(members) => members.iter().fold(Facts::BOTTOM, |accumulated, member| {
            accumulated.join(known_values(snapshot, *member, depth + 1))
        }),
        _ => Facts::TOP,
    }
}

/// A `Math` member the compiler implements directly.
#[derive(Debug, Clone, Copy)]
enum MathIntrinsic {
    Unary(UnOp),
    Binary(BinOp),
}

/// Where an assignment writes.
///
/// Named rather than re-derived, because a compound assignment reads and writes
/// *the same* place: `xs[next()] += 1` calls `next` once in JavaScript, and
/// lowering the target twice would call it twice.
#[derive(Debug, Clone, Copy)]
enum Place {
    Field { object: ValueId, field: u32 },
    Element { array: ValueId, index: ValueId },
    Global(u32),
    Binding(u32),
}

/// One side of a branching expression.
///
/// A ternary's arms are expressions to lower inside their own blocks; a
/// short-circuit's "untaken" arm is the left operand, already evaluated before
/// the branch.
#[derive(Debug, Clone, Copy)]
enum Branch {
    Expression(NodeId),
    Value(ValueId),
}

#[cfg(test)]
mod tests {
    use super::parse_number;

    /// Every spelling a JavaScript numeric literal has.
    #[test]
    fn a_literal_parses_as_the_double_it_denotes() {
        assert_eq!(parse_number("0"), Some(0.0));
        assert_eq!(parse_number("1_000_000"), Some(1_000_000.0));
        assert_eq!(parse_number("1e-320"), Some(1e-320));
        assert_eq!(parse_number("0x1f"), Some(31.0));
        assert_eq!(parse_number("0o17"), Some(15.0));
        assert_eq!(parse_number("0b1011"), Some(11.0));
        assert_eq!(parse_number(".5"), Some(0.5));
        assert_eq!(parse_number("1.7976931348623157e308"), Some(f64::MAX));

        // A BigInt is a different type with different arithmetic, and is not
        // this. Saying so beats parsing off the `n` and being quietly wrong.
        assert_eq!(parse_number("1n"), None);
    }

    /// The reason this function exists rather than trusting the checker.
    ///
    /// tsgo returns `1` for this literal: a mantissa of sixteen nines is above
    /// 2^53 and rounds up before the division by a power of ten. The neighbour
    /// below survives, because that mantissa is even. Rust's parser is correctly
    /// rounded and the literal's own text is the authority on what it says.
    #[test]
    fn seventeen_significant_digits_survive() {
        assert_eq!(
            parse_number("0.9999999999999999"),
            Some(0.999_999_999_999_999_9)
        );
        assert_ne!(parse_number("0.9999999999999999"), Some(1.0));
        assert_eq!(
            parse_number("0.9999999999999998"),
            Some(0.999_999_999_999_999_8)
        );
        assert_eq!(
            parse_number("1.9999999999999998"),
            Some(1.999_999_999_999_999_8)
        );
    }
}

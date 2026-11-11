//! Collect module globals, lexical bindings, destructuring declarations, and static fields before bodies borrow the scope.

use super::{
    ClosureInfo, Diagnostic, FuncBuilder, Hierarchy, HirType, Layout, LazyModule, LoweringSnapshot,
    ModuleRoles, Naming, NodeId, NodeKind, SemanticSnapshot, SymbolId, add_lazy_modules,
    ambient_handle, closure_typed_global, declaration_initializer, declaration_is_exported,
    declared_literal, declared_string_literal, global_object, instance_type_of,
    no_initializer_for_an_erased_slot, nominal_or_stand_in, settle_by_binding, settled_global_type,
    storable, syntax, unshared_name,
};

/// A binding's constant outside JavaScript's floating-point evaluator.
#[derive(Debug, Clone)]
pub(super) enum BindingConstant {
    Pointer { bits: u64, ty: HirType },
    BigInt(i128),
}

/// What a module declares outside any function.
///
/// Two maps rather than one, because the two are not the same thing. A `const`
/// with a constant initializer is resolved to its value at each use, so it costs
/// nothing and reads like an immediate; a `let` is storage that every function
/// shares.
#[derive(Debug, Default)]
pub(super) struct ModuleScope {
    /// Computed once; cooked-only templates need a boundary for erased reflection.
    pub(super) templates: bool,
    /// Symbol to readiness flag, only where an executable access can be early.
    pub(super) initialized: rustc_hash::FxHashMap<u32, u32>,
    /// Symbol to value, for a `const` this could evaluate.
    pub(super) constants: rustc_hash::FxHashMap<u32, f64>,
    /// Symbol to text, for a declared `const` whose type is a string literal
    /// -- a binding's `export const G_KEY_FILE_DESKTOP_GROUP: "Desktop
    /// Entry";` -- folded to the string wherever it is read, as a number's
    /// literal type is ([`declared_literal`]). Not storage: there is no value
    /// for a global to start from, and the type is the whole of it.
    pub(super) string_constants: rustc_hash::FxHashMap<u32, String>,
    /// Symbol to its initializer, for a `const` that asks whether the target
    /// provides a runtime helper -- `const KERNEL = typeof nts_json_quote ===
    /// "function"` -- lowered where it is read, so that each read is the
    /// question itself and folds for the backend being prepared
    /// ([`super::features`](crate::hir::features)), as the inline `typeof` does. Not storage: the
    /// answer is a constant of the backend, and a slot `module#init` writes
    /// would hide it from the fold. Hosts ask once, at module load, where a
    /// bare `typeof` of an undeclared name in every call cost Bun 130 ns and
    /// the optimisation of the function asking.
    pub(super) questions: rustc_hash::FxHashMap<u32, NodeId>,
    /// A binding's exact integers and native pointers. Kept out of
    /// `constant_value`, which computes JavaScript number arithmetic.
    pub(super) binding_constants: rustc_hash::FxHashMap<u32, BindingConstant>,
    /// Symbol to the foreign function a read of it calls, for a global the
    /// program does not own and a binding implements: lib.dom.d.ts's `declare
    /// var document`, `@ntsBoundBy "nts:dom" document`, is a call of
    /// `nts:dom`'s `document()`. Not storage, so not in `variables`.
    pub(super) bound: rustc_hash::FxHashMap<u32, (NodeId, String)>,
    /// The global object, where a binding implements it (`/** @ntsBoundBy
    /// "nts:dom" window */ declare var window`): the foreign function a bare
    /// lib.dom global's call reaches it through ([`FuncBuilder::window_global`]).
    /// Found by the declaration's name, **not** through `bound`: `bound` is
    /// keyed by symbol, and a name the program never writes has none, so bare
    /// `fetch(url)` was "a builtin this compiler does not provide" until the
    /// program mentioned `window` somewhere else.
    pub(super) global_object: Option<(NodeId, String)>,
    /// Symbol to index in [`Program::globals`](crate::hir::Program::globals).
    pub(super) variables: rustc_hash::FxHashMap<u32, u32>,
    /// The type of each global, by the same index.
    pub(super) types: Vec<HirType>,
    /// The globals themselves, handed to the program once collection is done.
    pub(super) globals: Vec<crate::hir::Global>,
    /// Symbols whose initializer is not a constant, and the expression that
    /// computes it.
    ///
    /// A module-scope binding is a global, and a global's `initial` has to be a
    /// number the artifact can carry. `let total = bump(41)` is not one -- so
    /// the whole declaration used to be refused, which is why `export const
    /// derived = imported + 1`, the most ordinary line in a module, did not
    /// compile. It is a global whose initial value is zero and whose real value
    /// is assigned by `module#init`, in evaluation order with everything else.
    pub(super) deferred: rustc_hash::FxHashMap<u32, NodeId>,

    /// Declarations whose name is a **binding pattern**, by declaration node.
    ///
    /// Keyed by the declaration rather than by a symbol, because the whole
    /// point is that there is no single one: `const [a, b] = pair` is one
    /// initializer and two names. [`Self::deferred`] cannot carry it for that
    /// reason, and [`FuncBuilder::lower_module_binding`] asks this first.
    pub(super) destructured: rustc_hash::FxHashSet<u32>,
    /// Symbols this declares but cannot represent, and why.
    ///
    /// Kept rather than refused on sight. A module-scope variable no function
    /// reads costs nothing and should be refused by nothing -- and a corpus of
    /// real files is mostly declarations that the file under test never touches.
    /// Reporting them eagerly took the share of TypeScript's own test cases that
    /// lower completely from 54 files to 25.
    pub(super) unsupported: rustc_hash::FxHashMap<u32, String>,
    /// The layouts the globals need.
    ///
    /// A global of object type is a `struct` in the emitted C, and naming one
    /// requires its layout. Every other layout is built by the *function* that
    /// uses the type -- so a global whose initializer was refused had none
    /// built for it by anybody, and the backend failed with `an object type
    /// with no layout` on a program the lowering had called clean.
    pub(super) layouts: Vec<Layout>,
    /// Which modules run at startup and which only when `import()` first reaches
    /// them. See [`module_roles`](super::module_roles).
    pub(super) roles: ModuleRoles,
    /// By module index, for each lazy module: the globals its evaluation keeps --
    /// whether it has run, and what it threw. See [`LazyModule`].
    pub(super) evaluated: Vec<Option<LazyModule>>,
    /// Declarations refused on sight rather than on use.
    ///
    /// The laziness above is right for *data* — a constant nothing reads is not
    /// a problem — and wrong for *code*. `export const bag = { f() {…} }` is a
    /// function the author wrote, and it was neither lowered nor reported:
    /// nothing walks into an object literal looking for methods, and the
    /// declaration itself is only refused if something reads the name. The file
    /// compiled to "0 functions, nothing refused".
    pub(super) refusals: Vec<Diagnostic>,
}

impl ModuleScope {
    fn for_snapshot(snapshot: &SemanticSnapshot) -> Self {
        let templates = snapshot
            .nodes
            .iter()
            .any(|node| node.kind == NodeKind::Syntax(syntax::TAGGED_TEMPLATE_EXPRESSION));
        Self {
            templates,
            ..Self::default()
        }
    }
}

/// Whether a name has exactly one declaration: `var f = a; var f = b` is two,
/// and the second is a write no reference shows.
pub(super) fn declared_once(probe: &FuncBuilder, name_node: NodeId) -> bool {
    probe
        .node(name_node)
        .symbol
        .and_then(|symbol| probe.snapshot.symbols.get(symbol.0 as usize))
        .is_some_and(|record| record.declarations.len() == 1)
}

/// Whether every possible read occurs after initialization. A `var` closure
/// needs this proof because its representation cannot hold hoisted `undefined`.
/// Import cycles keep their existing conservative boundary.
pub(super) fn initialized_before_use(probe: &FuncBuilder, name_node: NodeId) -> bool {
    probe
        .node(name_node)
        .symbol
        .is_some_and(|symbol| probe.initialization.proven_ready(symbol.0))
}

/// Whether anything but its own declaration can write this name.
///
/// Asked of a module-scope `let` holding an arrow, where the answer decides
/// whether the slot has one closure layout or an unknown number of them.
///
/// **Every reference, not every assignment.** The available walk --
/// [`FuncBuilder::assigned_symbols`] -- takes an assignment and reports the
/// names it writes, and it reports a bare identifier only: `[f] = pair` writes
/// `f` through an array literal and that walk says nothing was written. Reading
/// it that way would have widened a slot the program does reassign, which is
/// the one direction that turns a clean refusal into a build the backend
/// cannot type. So this starts from the *references* and asks whether each one
/// stands on the target side of something, which covers destructuring at any
/// depth for free.
///
/// Unrecognised positions are writes. The cost of a false positive is that a
/// refusal stays, and the cost of a false negative is a miscompile.
///
/// **One pass for the program, not one per question.** Every reference that
/// stands on a target side is indexed by its symbol the first time this is
/// asked (`LoweringSnapshot::written_references`); a question is then whether
/// any of its symbol's is not the name itself. Walking every node per
/// question made `initializer_settles` 68% of lowering `perf_hooks`, whose
/// planner asks it of every call through a `let`.
pub(super) fn reassigned_anywhere(probe: &FuncBuilder, name_node: NodeId) -> bool {
    let Some(symbol) = probe.node(name_node).symbol else {
        return true;
    };
    let written = probe.snapshot.written_references(|| {
        let mut written: rustc_hash::FxHashMap<SymbolId, Vec<NodeId>> =
            rustc_hash::FxHashMap::default();
        for id in
            (0..probe.snapshot.nodes.len()).filter_map(|at| u32::try_from(at).ok().map(NodeId))
        {
            if let Some(symbol) = probe.node(id).symbol
                && probe.stands_on_the_target_side(id)
            {
                written.entry(symbol).or_default().push(id);
            }
        }
        written
    });
    written
        .get(&symbol)
        .is_some_and(|references| references.iter().any(|id| *id != name_node))
}

/// Declare a global holding a closure, with the initializer deferred to
/// `module#init` -- an arrow is code, never a constant to fold.
fn declare_a_closure_global(
    scope: &mut ModuleScope,
    probe: &mut FuncBuilder,
    name_node: NodeId,
    symbol: SymbolId,
    ty: HirType,
    initializer: Option<NodeId>,
) {
    let global = u32::try_from(scope.globals.len()).unwrap_or(u32::MAX);
    let spelling = probe
        .node(name_node)
        .text
        .as_ref()
        .and_then(|text| text.as_utf8())
        .map(str::to_owned);
    scope.globals.push(crate::hir::Global {
        name: unshared_name(&scope.globals, spelling, global),
        ty: ty.clone(),
        initial: 0.0,
        exported: false,
        // A closure global always is: an arrow is code, never a constant.
        deferred: initializer.is_some(),
        origin: probe.origin(name_node),
        written: None,
        constant: false,
    });
    scope.variables.insert(symbol.0, global);
    scope.types.push(ty);
    if let Some(initializer) = initializer {
        scope.deferred.insert(symbol.0, initializer);
    }
}

fn module_scope_probe<'a>(
    snapshot: &'a LoweringSnapshot<'a>,
    foreign: &'a crate::hir::runtime::ForeignTable,
    hierarchy: &'a Hierarchy,
    naming: &'a Naming,
) -> FuncBuilder<'a> {
    let mut probe = FuncBuilder::new(snapshot, foreign);
    probe.hierarchy = hierarchy;
    probe.initialization = naming.initialization.clone();
    probe.written_order = &naming.written_order;
    probe
}

#[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
pub(super) fn collect_module_scope(
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    closures: &[ClosureInfo],
    hierarchy: &Hierarchy,
    naming: &Naming,
) -> ModuleScope {
    let mut scope = ModuleScope::for_snapshot(snapshot);
    // With the hierarchy, and that is the whole of a silent wrong answer.
    //
    // This probe lays out every class a module-scope binding mentions, and its
    // layouts reach the program *first*, so they win the merge in
    // `collect_layouts`. Built with `Hierarchy::default()` it did not know that
    // `Request extends Body`, so `layout_of` skipped the "inherited fields
    // first, then this class's own" construction and produced the checker's
    // flattened order instead -- `bodyState` last where every function lowered
    // afterwards indexed it first.
    //
    // Identical field *sets* in two orders, and the merge keeps one and
    // discards the other without comparing them. So every accessor on `Request`
    // read one field late: `get method` returned `requestHeaders`. Three of the
    // four the Node lane found were caught by clang only because the neighbour
    // had a different type; `NtsObj_Request` has eight consecutive
    // `NtsString *` members, where the same defect compiles clean and returns
    // the wrong value.
    let mut probe = module_scope_probe(snapshot, foreign, hierarchy, naming);
    // **And with the written field order, for the same reason as the hierarchy.**
    // Without it this probe laid `interface R extends Required<Omit<O, …>> { … }`
    // out in the checker's own-members-first order while every function indexed
    // it in the order the program's literal writes -- so `url`'s
    // `inspectDefaultOptions` shipped `colors` true and `maxArrayLength` false on
    // every backend, and the reduction is invalid HIR.
    //
    // The comment above says a layout built without the hierarchy is a different
    // layout; this is the same sentence about a different input, and the site had
    // one of the two. `wire_naming`'s doc predicted exactly that: *a site that
    // copies two of the four has that same problem for the other two, and says
    // nothing about it.*

    scope.global_object = global_object(&probe);
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::VARIABLE_DECLARATION) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        // The same storage decision capture discovery uses.
        if !probe.is_module_scope(id) {
            continue;
        }
        // **A loop head's variable is not a module binding**, and it got a
        // global that nothing ever wrote.
        //
        // `lower_for` binds the head variable as a **block parameter**,
        // whatever keyword declared it, so the global sat unwritten while a
        // closure in the body resolved the same name through module scope --
        // `reached_by_name` says a name with a global needs no capture -- and
        // emitted `global.get` against it. So
        //
        // ```js
        // let total = 0;
        // for (let i = 0; i < 3; i++) { const f = () => i; total += f(); }
        // ```
        //
        // answered **0** at module scope where node answers 3, and the
        // identical loop *inside a function* was always right: there the
        // collector never looked, so the ordinary capture path ran. Two
        // derivations of where `i` lives, agreeing everywhere except the one
        // place one of them had no business answering.
        //
        // A wrong answer that runs, found by a probe sweep against node.
        // `nts check` cannot see it -- its harness drives exported functions
        // and this is a statement -- and neither can the test262 census, which
        // ranks refusals and this compiled and returned a number.
        //
        // Lexicals in a loop body are excluded by that same decision: their
        // declarations execute per iteration and the body writes local storage.
        // `var` retains its module route; this does not change its head writes.

        let children = probe.children(id);
        // The *first* child, and only when it is a name. A declaration's name
        // comes before everything else in it, so searching for "the first
        // identifier" instead found the initializer whenever the name was a
        // pattern: `export const [a, b] = arr` declared a global called `arr`,
        // beside the real one, and the emitted C said `redefinition of 'arr'`.
        //
        // A **destructuring** declaration takes the branch below instead: its
        // names are the pattern's, and each one needs storage of its own.
        let Some(first) = children.first().copied() else {
            continue;
        };
        if matches!(
            probe.kind_of(first),
            Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN)
        ) {
            declare_a_destructured_module_binding(&mut scope, &mut probe, id, first, &children);
            continue;
        }
        let Some(name_node) = children
            .first()
            .filter(|child| probe.kind_of(**child) == Some(syntax::IDENTIFIER))
        else {
            continue;
        };
        let Some(symbol) = probe.node(*name_node).symbol else {
            continue;
        };
        // The last child that is neither the name nor the type annotation.
        //
        // By what it *is*, not by what it is not: skipping identifiers took
        // `let held: Box | undefined = undefined` to mean the type annotation,
        // which `module#init` then tried to lower as an expression -- and it
        // made `let x = y` a declaration with no initializer at all, because
        // `y` is an identifier too.
        let initializer = declaration_initializer(&children, *name_node, |c| probe.kind_of(c));

        // **A second declaration of one symbol is a store, not an initial
        // value.** `var` may be declared more than once at module scope, and
        // `Global.initial` is written once, before any statement runs -- so
        // folding a redeclaration's constant into it applied the value *before*
        // the statements between the two declarations, instead of at the
        // declaration's own position.
        //
        //   var x = 5;
        //   x = 99;
        //   var x = 5;   // node: 5.  ours, until this: 99
        //
        // Silently, on every backend, with no diagnostic: the second
        // declaration emitted no code at all. Found by running
        // `language/expressions/addition/S11.6.1_A2.4_T1.js`, which is a test
        // about `+` and never mentions redeclaration.
        let redeclared = scope.variables.contains_key(&symbol.0);

        // An erased global's initial value needs a *tag*, and `Global.initial`
        // is one `f64` with no room for one. So a constant initializer is not
        // taken as one here: the declaration is deferred to `module#init`,
        // where lowering erases it and the tag comes from the value's own
        // type. Folding it instead put `0` in the payload with the tag left at
        // `undefined`, and `typeof` then answered "undefined" for a global the
        // source initialised to a number -- which the differential caught
        // against node.
        let erased = probe.type_of(*name_node) == Some(HirType::Erased);

        // `let x: number;` -- declared here, written later. There is nothing to
        // fold and nothing to defer, and the storage starts at the type's zero,
        // which is what `hir::fields` already does for a class field written in
        // its constructor: "zero, because that is what the allocator leaves".
        //
        // An *erased* one is refused, and now says which of the two it is. Its
        // initial value would have to be `undefined`, which is a tag, and there
        // is nowhere to put one -- so this is the representation talking rather
        // than a lowering nobody wrote yet.
        if initializer.is_none() && erased {
            scope
                .unsupported
                .insert(symbol.0, no_initializer_for_an_erased_slot());
            continue;
        }

        let constant = match initializer {
            Some(initializer) if !erased => probe.constant_value(initializer, &scope.constants),
            _ => None,
        };
        // **A declared constant's type *is* its value.** `declare const MAX:
        // 512` has no initializer, so `constant` is `None` and `initial`
        // became `0` -- and `globals::analyze` seeds a non-exported numeric
        // global with `Facts::constant(initial)`, so every read folded to
        // zero. `Catalog.MAX` printed `0` where Java says `512`, on this
        // backend and on C, with no diagnostic on either.
        //
        // The value was always there: the checker resolves the annotation to
        // `TypeKind::Literal`, which is the one place a declaration can carry
        // one. Read here rather than special-cased later, so the global is
        // right for every pass and every backend at once.
        let declared = declared_literal(&probe, *name_node);
        let value = constant.or(declared).unwrap_or(0.0);
        // **`or_else(evolved_type)`, the way a local has always done it.**
        // `var x;` with no annotation has no type *at the declaration* -- the
        // checker fills it in from the assignments that follow, and every later
        // mention of the name carries what it settled on. `evolved_type` reads
        // one back, and the two sites in `lower_variable_statement` have asked
        // it from the beginning. This one asked `type_of` alone, so the same
        // declaration was an ordinary local inside a function and refused at
        // module scope:
        //
        //     var x;
        //     x = -1;
        //     x += -1;   // fine in a function, refused at module scope
        //
        // Two derivations of one question, and the narrower one was here. It is
        // 36 files of the 413 that reach lowering in the slice-1 test262
        // population -- and they rank under *two* headings, because the read
        // that follows the missing global refuses again as `reading a name
        // before it is bound`, which is the cascade rather than the cause.
        let Some(ty) = settled_global_type(&probe, *name_node, initializer.is_some()) else {
            // **Named, because a refusal that does not name its type cannot be
            // counted by kind.** That is `describe_node`'s whole reason for
            // existing, and this message predated it: 29 files of the slice-1
            // `test/language` population carry it, and opening them showed most
            // are `var x = new Boolean(true)` — the wrapper objects, which have
            // a ✗ row of their own and 26 more files under *a `X` of
            // unrepresentable type*. One cause, two messages, and only one of
            // them said so.
            scope.unsupported.insert(
                symbol.0,
                format!(
                    "a module-scope variable of unrepresentable type ({})",
                    probe.describe_node(*name_node)
                ),
            );
            continue;
        };
        // `const` is a value, not storage. The kind lives on the enclosing
        // `VariableDeclarationList`, which is the declaration's parent -- except
        // when the encoder wraps the list in a `VariableStatement`, so the flags
        // are taken from whichever ancestor is the list.
        let kind = probe
            .ancestor(id, syntax::VARIABLE_DECLARATION_LIST)
            .map_or(nts_semantic_schema::VariableKind::Var, |list| {
                nts_semantic_schema::VariableKind::from_flags(probe.node(list).flags)
            });
        // A declared string constant is its literal type's text, folded at
        // each read, and needs no global: nothing could give one a value to
        // start from. Only a declaration -- an initializer, even of the same
        // literal, is the program's own and lowers as one.
        if kind == nts_semantic_schema::VariableKind::Const
            && initializer.is_none()
            && let Some(text) = declared_string_literal(&probe, *name_node)
        {
            scope.string_constants.insert(symbol.0, text);
            continue;
        }
        if settle_by_binding(
            &probe,
            &mut scope,
            (id, symbol),
            (kind, initializer.is_none() && declared.is_none(), &ty),
        ) {
            continue;
        }
        // **Refused, because accepting it was worse.** Nothing in this compiler
        // had heard of `using`, so the declaration lowered as an ordinary
        // binding and `[Symbol.dispose]` was **never called** -- the program
        // compiled, ran, and silently did nothing at scope exit.
        //
        //     let disposed = 0;
        //     class R { [Symbol.dispose]() { disposed = 1; } }
        //     function f() { using r = new R(); }
        //     f();                    // node: disposed is 1.  this: 0
        //
        // `docs/records/notebooks/typescript-ledger.md` listed `using` among shapes "probed and passing",
        // which it is only if the probe stops at whether the program builds.
        if kind.disposes() {
            scope.unsupported.insert(
                symbol.0,
                "a `using` declaration, whose scope-exit disposal".to_owned(),
            );
            continue;
        }
        // A `const` whose initializer folds is a value rather than storage: the
        // reader gets the number and nothing is allocated. One whose
        // initializer is code is storage like any other, written once by
        // `module#init`.
        //
        // Unless it is **exported**, and then it needs both. A reader inside
        // this module still gets the number; a reader outside needs something
        // to name, and `publish_surface` publishes a *global* -- so folding an
        // exported constant away left nothing for the export table to point at
        // and the name was silently absent from the artifact.
        //
        // The asymmetry is what makes it a defect rather than a policy:
        // `export const a = 50` vanished and `export const b = 50 + 0` did not,
        // differing only in whether the value was written down or arrived at. A
        // backend declining to export values would decline both. `buffer`
        // published one of its fifteen exports and two of the missing fourteen
        // were this -- `kStringMaxLength` and `INSPECT_MAX_BYTES`, both read by
        // node's own tests.
        //
        // Both, not one: the constant keeps folding for every use this module
        // makes of it, and the global costs one static whose initial value is
        // the number and which nothing ever writes.
        if kind == nts_semantic_schema::VariableKind::Const && constant.is_some() {
            scope.constants.insert(symbol.0, value);
            if !declaration_is_exported(&probe, id) {
                continue;
            }
        }
        // A `const` that asks whether the target provides a runtime helper is
        // that question wherever it is read (`ModuleScope::questions`), and
        // needs a global only to be exported, as a folded constant does.
        if kind == nts_semantic_schema::VariableKind::Const
            && let Some(initializer) = initializer
            && probe.asks_what_is_provided(initializer)
        {
            scope.questions.insert(symbol.0, initializer);
            if !declaration_is_exported(&probe, id) {
                continue;
            }
        }

        if let Some(ty) = closure_typed_global(&mut probe, closures, kind, *name_node, initializer)
        {
            declare_a_closure_global(&mut scope, &mut probe, *name_node, symbol, ty, initializer);
            continue;
        }

        if let Err(reason) = storable(&mut probe, *name_node, &ty) {
            scope.unsupported.insert(symbol.0, reason);
            continue;
        }
        // **A `const` with no initializer is ambient** -- TypeScript accepts
        // one nowhere else -- and so has no value: nothing assigns the global,
        // and a read would answer null. A native handle is made by a call or
        // named by a binding that knows how to (an Objective-C class); a
        // declaration alone names nothing. This was refused, by accident, as
        // a global having no storage for a handle, and a handle global made
        // the accident the only thing standing in front of a silent null.
        if let Some(reason) = ambient_handle(kind, initializer.is_some(), &ty) {
            scope.unsupported.insert(symbol.0, reason);
            continue;
        }
        // One condition, asked once and recorded in two places: on the global,
        // where a backend and a later pass can see it, and in `scope.deferred`,
        // which is the set `lower_module_binding` walks.
        //
        // A declaration with no initializer needs no code — its storage is
        // already the type's zero. One whose value folds needs none either,
        // because the number is in `initial`. A *re*declaration always does,
        // since `initial` is written before any statement runs and cannot
        // express a value that arrives partway through the module.
        let needs_code = initializer.is_some() && (constant.is_none() || redeclared);
        declare_a_module_global(
            &mut scope, &probe, *name_node, symbol, &ty, value, needs_code,
        );
        if let Some(initializer) = initializer
            && needs_code
        {
            scope.deferred.insert(symbol.0, initializer);
        }
    }
    collect_static_fields(snapshot, &mut probe, &mut scope);
    add_initialized_flags(&probe, &mut scope);
    // What materializing the globals' types produced. Nothing else collects
    // from this walk, which is why they were missing.
    scope.layouts = probe.layouts.into_layouts();
    // Which modules run at startup and which only when `import()` reaches them,
    // and the globals each lazy one keeps: part of the scope, because every
    // builder reads it and a global must exist before a function names it.
    add_lazy_modules(snapshot, &mut scope);
    scope
}

/// Readiness storage is independent of value storage: a folded constant and a
/// class binding need a flag as surely as a mutable global does.
fn add_initialized_flags(probe: &FuncBuilder, scope: &mut ModuleScope) {
    let mut flagged: Vec<_> = probe.initialization.flagged().collect();
    flagged.sort_unstable_by_key(|(symbol, _)| *symbol);
    for (symbol, name) in flagged {
        let flag = u32::try_from(scope.globals.len()).unwrap_or(u32::MAX);
        let spelling = probe
            .snapshot
            .symbols
            .get(symbol as usize)
            .map(|record| format!("{}#initialized", record.name));
        scope.globals.push(crate::hir::Global {
            name: unshared_name(&scope.globals, spelling, flag),
            ty: HirType::Bool,
            initial: 0.0,
            exported: false,
            deferred: false,
            origin: probe.origin(name),
            written: None,
            constant: false,
        });
        scope.types.push(HirType::Bool);
        scope.initialized.insert(symbol, flag);
    }
}

/// The property, binding and optional default of one binding element. The
/// checker's declaration identity distinguishes `{ a: b }` from `{ a = b }`.
pub(super) fn binding_element_parts(
    probe: &FuncBuilder,
    element: NodeId,
) -> Option<(NodeId, NodeId, Option<NodeId>)> {
    let parts: Vec<_> = probe
        .children(element)
        .into_iter()
        .filter(|at| probe.kind_of(*at) != Some(syntax::DOT_DOT_DOT_TOKEN))
        .collect();
    let binds = |at| {
        probe.declared_by(element, at)
            || matches!(
                probe.kind_of(at),
                Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN)
            )
    };
    match parts.as_slice() {
        [only] => Some((*only, *only, None)),
        [first, second] if binds(*second) => Some((*first, *second, None)),
        [first, second] => Some((*first, *first, Some(*second))),
        [first, second, third] => Some((*first, *second, Some(*third))),
        _ => None,
    }
}

/// `const [a, b] = pair` at module scope: storage for every name the pattern
/// declares, and the declaration recorded so `module#init` destructures it.
///
/// This was refused, and the refusal read as though the *construct* were
/// unsupported: *a name from an enclosing scope*, because the collector
/// declared no global and the read then found no binding either. It is 37 files
/// of the slice-1 `test/language` population, every one of them a
/// `const`/`let`/`var` `dstr` test, and it works one scope in: inside a
/// function `bind_pattern` binds the names as ordinary locals.
///
/// **Every name or none.** A pattern that cannot be stored refuses all of its
/// names rather than some, because a half-bound pattern is a program where one
/// name holds a value and its neighbour silently holds zero — and the read that
/// would tell you is the one nobody wrote. `unsupported` is keyed by symbol and
/// reported where the name is read, so each gets its own entry.
///
/// The value always needs code: a destructured name's value comes from reads of
/// the initializer, never from a constant this could fold into `initial`.
fn declare_a_destructured_module_binding(
    scope: &mut ModuleScope,
    probe: &mut FuncBuilder,
    declaration: NodeId,
    pattern: NodeId,
    children: &[NodeId],
) {
    // Nothing to destructure *from*. `let [a, b];` is not legal JavaScript, and
    // a declaration with no initializer has no reads for the names to take.
    if declaration_initializer(children, pattern, |c| probe.kind_of(c)).is_none() {
        return;
    }
    let mut names = Vec::new();
    probe.pattern_names(pattern, &mut names);

    // Resolved before anything is declared, so that a name this cannot store
    // refuses the whole pattern rather than leaving its neighbours holding a
    // zero nobody wrote.
    let mut storage = Vec::with_capacity(names.len());
    for name in names {
        let resolved = probe.node(name).symbol.and_then(|symbol| {
            probe
                .type_of(name)
                .or_else(|| probe.evolved_type(name))
                .filter(|ty| storable(probe, name, ty).is_ok())
                .map(|ty| (name, symbol, ty))
        });
        let Some(resolved) = resolved else {
            refuse_the_whole_pattern(scope, probe, pattern);
            return;
        };
        storage.push(resolved);
    }
    // **A pattern that binds no names still evaluates**, and returning here for
    // want of storage meant it did not. `const [[] = init()] = []` declares
    // nothing, so `storage` is empty, so the declaration never joined
    // `destructured` -- and `lower_module_binding` then looked for a name it does
    // not have, found none, and skipped it. Its **initializer** was never lowered
    // and neither was the default, so `init()` was never called: 11 recorded
    // test262 language files, and `[[x] = init()]` one character over calls it.
    //
    // The language destructures for its effects as much as for its names:
    // `ArrayBindingPattern : [ ]` still performs `GetIterator` on the source, and a
    // nested element still evaluates its `Initializer` when the source has no
    // element there. `defaulted_array_element` already lowers exactly that -- a
    // source whose constant length is at or below the position takes the default and
    // only the default -- and nothing was reaching it.
    //
    // So the declaration is registered whatever its storage, and the loop below
    // declares as many globals as there are names, which may be none.
    for (name, symbol, ty) in storage {
        declare_a_module_global(scope, probe, name, symbol, &ty, 0.0, true);
    }
    scope.destructured.insert(declaration.0);
}

/// Refuse every name a pattern declares, under one reason.
///
/// **Every name or none.** A half-stored pattern is a program where one name
/// holds a value and its neighbour silently holds zero, and the read that would
/// tell you is the one nobody wrote. `unsupported` is keyed by symbol and
/// reported where a name is read, so each name needs its own entry for the
/// refusal to be reachable at all.
fn refuse_the_whole_pattern(scope: &mut ModuleScope, probe: &FuncBuilder, pattern: NodeId) {
    let mut names = Vec::new();
    probe.pattern_names(pattern, &mut names);
    for name in names {
        if let Some(symbol) = probe.node(name).symbol {
            scope.unsupported.insert(
                symbol.0,
                "a module-scope destructuring with a name of unrepresentable type".to_owned(),
            );
        }
    }
}

/// How a `[key, value]` pair hands over its two halves.
///
/// Two representations, because a tuple has two: members that *differ* are an
/// object layout with named fields, members that *agree* are an array of two
/// slots -- storage that needs no names. Both are `[K, V]` to the checker, and
/// handling only the first is what made `new Map<number, number>([[1, 2]])`
/// refuse beside three string-keyed arms that passed.
pub(super) enum Pair {
    Fields(Layout),
    Slots(HirType),
}

fn declare_a_module_global(
    scope: &mut ModuleScope,
    probe: &FuncBuilder,
    name_node: NodeId,
    symbol: nts_semantic_schema::SymbolId,
    ty: &HirType,
    initial: f64,
    needs_code: bool,
) {
    if let Some(existing) = scope.variables.get(&symbol.0).copied() {
        if needs_code {
            scope.globals[existing as usize].deferred = true;
        }
        return;
    }
    let global = u32::try_from(scope.globals.len()).unwrap_or(u32::MAX);
    let spelling = probe
        .node(name_node)
        .text
        .as_ref()
        .and_then(|text| text.as_utf8())
        .map(str::to_owned);
    scope.globals.push(crate::hir::Global {
        name: unshared_name(&scope.globals, spelling, global),
        ty: ty.clone(),
        initial,
        exported: false,
        deferred: needs_code,
        origin: probe.origin(name_node),
        written: probe.written_kind(name_node),
        constant: probe
            .syntactic_parent(name_node)
            .and_then(|declaration| probe.ancestor(declaration, syntax::VARIABLE_DECLARATION_LIST))
            .is_some_and(|list| {
                nts_semantic_schema::VariableKind::from_flags(probe.node(list).flags)
                    == nts_semantic_schema::VariableKind::Const
            }),
    });
    scope.variables.insert(symbol.0, global);
    scope.types.push(ty.clone());
}

fn collect_static_fields(
    snapshot: &SemanticSnapshot,
    probe: &mut FuncBuilder,
    scope: &mut ModuleScope,
) {
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::PROPERTY_DECLARATION)
            || !node
                .modifiers
                .contains(nts_semantic_schema::DeclarationModifiers::STATIC)
        {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        // `modifiers, name, ?/!, type, initializer`, which is the same slot
        // layout `initialize_fields` reads for an instance field.
        let Some([_, Some(name_node), _, _, initializer]) = probe.child_slots::<5>(id) else {
            continue;
        };
        let Some(symbol) = probe.node(name_node).symbol else {
            continue;
        };
        let Some(class) = probe.enclosing_class(id) else {
            continue;
        };
        let Some(field) = probe.literal_name(name_node) else {
            continue;
        };
        // Never defined: its class throws first. See
        // `FuncBuilder::static_named_prototype`.
        if field == "prototype" {
            continue;
        }
        let class_name = probe
            .children(class)
            .into_iter()
            .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| {
                probe
                    .node(child)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
            });
        // **An anonymous class takes the same stand-in its own methods do.**
        //
        // This refused, on the grounds that "a `static` is addressed by name
        // from source -- `C.s` -- and a number here is a name no source can be
        // traced back to", while noting that a *method* does take the numbered
        // stand-in because nothing outside the program names it.
        //
        // The same is true of the field. This name reaches exactly one place:
        // the label on a `Global`, which nothing outside the compiled program
        // reads and which `unshared_name` below already disambiguates. `C.s` is
        // resolved by *symbol* -- `scope.variables.insert(symbol.0, global)` on
        // the last lines here -- so the spelling decides nothing, and a reader
        // of a dump gets `Type17.s` beside the `Type17` layout and the
        // `Type17#m` methods rather than a name that is absent from all three.
        //
        // `nominal_or_stand_in` is that one derivation, and `instance_type_of`
        // is what turns a class *expression*'s constructor type into the
        // instance type the layout and the methods are named for -- asking the
        // node's type directly would name the field after `#2` while the
        // methods beside it say `#7`.
        //
        // 7 files of the slice-1 `test/language` population, all `static #$`
        // and friends in a `var C = class { … }`.
        let class_name = class_name.unwrap_or_else(|| {
            instance_type_of(snapshot, class).map_or_else(
                || "class".to_owned(),
                |ty| nominal_or_stand_in(snapshot, ty),
            )
        });
        let Some(ty) = probe.type_of(name_node) else {
            scope.unsupported.insert(
                symbol.0,
                "a static field of unrepresentable type".to_owned(),
            );
            continue;
        };
        if let Err(reason) = storable(probe, name_node, &ty) {
            scope.unsupported.insert(symbol.0, reason);
            continue;
        }
        // The same rule module-scope constants follow: an erased slot has no
        // room for the `undefined` tag its zero would need, so a declaration
        // with no initializer is refused rather than started wrong.
        let erased = ty == HirType::Erased;
        if initializer.is_none() && erased {
            scope.unsupported.insert(
                symbol.0,
                "a static field with no initializer, whose type has no representation \
                 for the `undefined` it starts as"
                    .to_owned(),
            );
            continue;
        }
        let constant = match initializer {
            Some(initializer) if !erased => probe.constant_value(initializer, &scope.constants),
            _ => None,
        };
        // The same as a module-scope `declare const`: a static declared with a
        // literal type carries its value there and nowhere else. `nts bind`
        // renders a Java `static final int MAX = 512` as `static readonly MAX:
        // 512` for exactly this reason.
        let declared = declared_literal(probe, name_node);
        let global = u32::try_from(scope.globals.len()).unwrap_or(u32::MAX);
        scope.globals.push(crate::hir::Global {
            name: unshared_name(
                &scope.globals,
                Some(format!("{class_name}.{field}")),
                global,
            ),
            ty: ty.clone(),
            initial: constant.or(declared).unwrap_or(0.0),
            exported: false,
            deferred: constant.is_none() && initializer.is_some(),
            origin: probe.origin(name_node),
            written: probe.written_kind(name_node),
            constant: false,
        });
        scope.variables.insert(symbol.0, global);
        scope.types.push(ty);
        if let (None, Some(initializer)) = (constant, initializer) {
            scope.deferred.insert(symbol.0, initializer);
        }
    }
}

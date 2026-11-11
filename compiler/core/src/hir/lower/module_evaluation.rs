//! Plan module evaluation order and state, probe cut initializers, and lower their evaluation bodies.

use super::{
    BinOp, Callee, Copy, Diagnostic, Exit, Func, FuncBuilder, Handler, HirType, LayoutCollector,
    Lowered, LoweringSnapshot, MODULE_INIT, ModuleScope, NO_FOREIGN, NodeId, OpKind, Origin,
    SemanticSnapshot, Shared, Terminator, TypeId, ValueId, dead_zone_reads, declares_a_class,
    dynamic_import_target, initialization, is_a_dynamic_import, is_declaration_file, spell, syntax,
};

/// Whether a class declaration has a `static` field to initialize at evaluation.
///
/// **Asked of the node rather than the kind**, and only classes that answer yes
/// join the ordered statement list. A `static` field is storage written at class
/// definition time, which is a point among the other statements and observable
/// from any of them -- so a class that has one belongs there.
///
/// A class that has none does not, and the difference is not cosmetic: putting
/// every class in the list gives a file that had no module evaluation an empty
/// `module#init`, which is a new exported function in every such program.
/// `tests/programs/delete` declares two classes, no statics, and went from eight
/// exports to nine -- caught by a test asserting the count exactly, which is the
/// kind of assertion that earns its keep here.
///
/// A field with no initializer is storage at its zero and needs no statement,
/// the same rule `collect_module_scope` follows for `let x: number;`. A static
/// member named `prototype` does need one, initializer or not: defining the
/// class throws (`FuncBuilder::static_named_prototype`). So does a member whose
/// name the program computes, so the class is refused where it is evaluated
/// (`FuncBuilder::member_named_at_run_time`).
pub(super) fn runs_a_static_initializer(probe: &FuncBuilder, id: NodeId) -> bool {
    if !probe.kind_of(id).is_some_and(declares_a_class) {
        return false;
    }
    probe.children(id).into_iter().any(|member| {
        // **A `static { … }` block counts too, and did not.** `lower_static_fields`
        // has lowered one since the day static blocks stopped being ignored, but
        // this predicate decides whether the class joins the ordered statement
        // list at all -- so a class with a block and *no static field* answered
        // false, never reached that code, and the block did not run:
        //
        //     let seen = 0;
        //     class C { static { seen = 1; } }   // node: 1.  this: 0
        //
        // Silently, on every backend. The field version worked, which is what
        // hid it: `class C { static n = 0; static { C.n = 5 } }` answers 5,
        // because the *field* put the class in the list and the block came along.
        // A class whose only static member is a block is the case nothing
        // covered.
        probe.kind_of(member) == Some(syntax::CLASS_STATIC_BLOCK)
            || (probe.kind_of(member) == Some(syntax::PROPERTY_DECLARATION)
                && probe
                    .node(member)
                    .modifiers
                    .contains(nts_semantic_schema::DeclarationModifiers::STATIC)
                && matches!(probe.child_slots::<5>(member), Some([_, _, _, _, Some(_)])))
    }) || probe.static_named_prototype(id).is_some()
        || probe.member_named_at_run_time(id).is_some()
}

/// Whether a node at module scope is a statement rather than a declaration.
///
/// An allow-list, and deliberately not the complement of one. A kind that is
/// neither is *refused* below rather than skipped, because skipping silently
/// is the defect this exists to fix: a `total = bump(41)` at module scope was
/// dropped, and the program compiled, ran, and answered as though the line
/// were not there.
///
/// `return`, `break` and `continue` are absent because they are illegal at
/// module scope, and `VariableStatement` because a module-scope declaration is
/// a global with a static initializer, which needs no code to run.
///
/// **The three at the bottom were absent for no reason anyone wrote down.**
/// `lower_statement` has always handled them -- `lower_try`, `lower_for_of` with
/// `Over::Keys`, `lower_labeled` -- so a `try` in a function body compiled while
/// the same `try` at module scope was refused as "a statement this lowering
/// does not run at module scope". An allow-list is right, and an allow-list
/// three entries short of its own lowering is just a gap.
///
/// (This doc comment was itself attached to `runs_a_static_initializer`, which
/// someone inserted between the comment and the function it describes. Rustdoc
/// put a paragraph about module statements at the top of a predicate about
/// static fields, and neither function had a reader who noticed.)
pub(super) fn is_module_statement(kind: u16) -> bool {
    matches!(
        kind,
        syntax::BLOCK
            | syntax::IF_STATEMENT
            | syntax::WHILE_STATEMENT
            | syntax::DO_STATEMENT
            | syntax::SWITCH_STATEMENT
            | syntax::FOR_STATEMENT
            | syntax::FOR_OF_STATEMENT
            | syntax::EMPTY_STATEMENT
            | syntax::THROW_STATEMENT
            | syntax::EXPRESSION_STATEMENT
            // A declaration whose initializer is code runs at evaluation time,
            // and its position among the other statements is observable.
            | syntax::VARIABLE_STATEMENT
            | syntax::TRY_STATEMENT
            | syntax::FOR_IN_STATEMENT
            | syntax::LABELED_STATEMENT
    )
}

/// Whether a node is a declaration the rest of the lowering already walks.
///
/// Its body is its own business, which is why [`carries_code`] stops at one: a
/// function inside a namespace is lowered by the loop in [`lower`](super::lower), and the
/// namespace has nothing to run because of it.
fn is_module_declaration(kind: u16) -> bool {
    matches!(
        kind,
        syntax::FUNCTION_DECLARATION
            | syntax::CLASS_DECLARATION
            | syntax::INTERFACE_DECLARATION
            | syntax::ENUM_DECLARATION
            | syntax::END_OF_FILE_TOKEN
    )
}

/// Whether a module-scope node has anything for module evaluation to run.
///
/// The alternative was a list of kinds to skip -- type alias, import, export
/// clause, ambient namespace -- read off real output and extended whenever a
/// program used something new. This asks the question directly instead, so a
/// construct nobody has seen yet is classified correctly the first time: it
/// carries a statement or it does not.
/// Whether a `VARIABLE_STATEMENT` has an initializer to run.
///
/// **An ambient one does not, and that is the whole difference.**
/// [`is_module_statement`] counts a variable statement as code because "a
/// declaration whose initializer is code runs at evaluation time, and its
/// position among the other statements is observable" -- which is exactly
/// right, and says nothing about a declaration that has no initializer.
///
/// A generated binding is full of them. An interface's `static final String
/// KIND` cannot be `static readonly` in TypeScript -- that is class syntax --
/// so it renders as `const KIND: "task";` inside a namespace, and one of those
/// anywhere made [`carries_code`] answer yes for the whole `declare module`.
/// `tests/interop/android-shape` was refused entire, at line 1 column 1, for
/// a constant that runs nothing.
///
/// The initializer is found the way `initializer_function` and
/// `collect_module_scope` find it: the last child that is neither the name nor
/// a type annotation, by what it *is* rather than by what it is not.
fn runs_an_initializer(probe: &FuncBuilder, statement: NodeId) -> bool {
    fn declarations(probe: &FuncBuilder, id: NodeId, into: &mut Vec<NodeId>) {
        for child in probe.children(id) {
            if probe.kind_of(child) == Some(syntax::VARIABLE_DECLARATION) {
                into.push(child);
            } else {
                declarations(probe, child, into);
            }
        }
    }
    let mut found = Vec::new();
    declarations(probe, statement, &mut found);
    found.iter().any(|declaration| {
        let children = probe.children(*declaration);
        let name = children.first().copied();
        children.iter().rev().any(|child| {
            Some(*child) != name && !syntax::is_type_node(probe.kind_of(*child).unwrap_or_default())
        })
    })
}

fn carries_code(probe: &FuncBuilder, id: NodeId) -> bool {
    probe.children(id).iter().any(|child| {
        let Some(kind) = probe.kind_of(*child) else {
            return false;
        };
        // A variable statement with nothing to run is a declaration, however
        // it is spelled; see `runs_an_initializer`.
        if kind == syntax::VARIABLE_STATEMENT && !runs_an_initializer(probe, *child) {
            return false;
        }
        if is_module_statement(kind) {
            return true;
        }
        if is_module_declaration(kind) {
            return false;
        }
        carries_code(probe, *child)
    })
}

/// The eager modules' statements in evaluation order, for `module#init`; and
/// each lazy module's own, for its `#evaluate`.
type ModuleStatements = (
    Option<(NodeId, Vec<NodeId>)>,
    Vec<(usize, Vec<NodeId>)>,
    Vec<Diagnostic>,
);

/// Every top-level statement in the program, in the order they must run.
///
/// Within a file that is source order. *Across* files it is the module graph,
/// and the body below computes it: `evaluation_order` gives a post-order walk
/// of the import graph, cycles are evaluated rather than refused because ES
/// modules specify them and node runs them, and the statements are concatenated
/// in that order into one `module#init`.
///
/// This comment said the opposite -- "a program with top-level statements in
/// more than one file is refused rather than run in an order this guessed at"
/// -- describing a state the function below has not been in for some time.
/// `tests/programs/module-order` is four files with top-level statements in each,
/// written to pin the order against node, and it has been green throughout.
#[must_use]
pub(super) fn module_statements(
    snapshot: &LoweringSnapshot<'_>,
    lazy: &[bool],
    initialization: &initialization::Analysis,
) -> ModuleStatements {
    let probe = FuncBuilder::probe(snapshot);
    let mut refusals = Vec::new();

    let mut per_module: Vec<Vec<NodeId>> = vec![Vec::new(); snapshot.modules.len()];
    for (at, module) in snapshot.modules.iter().enumerate() {
        // **A declaration file is never evaluated**, as TypeScript emits
        // nothing for one: `declare var document: Document` in lib.dom's
        // overlay is a statement in its syntax and none in its program, and
        // taking it for one gave every Chromium app an empty `module__init`,
        // which says the program has module state (`target.chromium()` puts
        // the overlay in every program).
        if is_declaration_file(snapshot, module) {
            continue;
        }
        for child in probe.children(module.root) {
            let Some(kind) = probe.kind_of(child) else {
                continue;
            };
            if probe.is_source_import(child)
                || is_module_statement(kind)
                || runs_a_static_initializer(&probe, child)
                || (kind == syntax::CLASS_DECLARATION && initialization.guards_declaration(child))
            {
                per_module[at].push(child);
            } else if !is_module_declaration(kind) && carries_code(&probe, child) {
                // Something with code in it that module evaluation does not
                // run -- a `namespace` with a statement in its body is the
                // shape. Refused rather than dropped, which is the whole point
                // of this pass.
                refusals.push(probe.unsupported(
                    child,
                    &format!(
                        "{}, which has code in it",
                        spell(kind, "a module-scope construct")
                    ),
                ));
            }
        }
    }

    let (order, cycles) = evaluation_order(snapshot, lazy);

    // Cycles are *evaluated*, not refused. ES modules specify them, node runs
    // them, and the post-order walk above already handles one the way
    // `InnerModuleEvaluation` does: a module still being visited is not
    // re-entered, so it keeps the position it already has.
    //
    // Nothing to collect from `cycles` itself: a cycle is evaluated rather than
    // refused, and the walk above already orders one the way
    // `InnerModuleEvaluation` does. What a cycle *does* enable is a read of a
    // binding whose module has not run, which is checked here rather than
    // there because the check needs the order and the cycle set does not.
    let _ = cycles;
    refusals.extend(dead_zone_reads(snapshot, &order));

    // Concatenated in evaluation order rather than emitted per module: with
    // top-level `await` refused, and a read across a cycle refused above, what
    // a program can observe of module evaluation is the order of its
    // statements -- and one function in that order says exactly that.
    let mut statements = Vec::new();
    let mut anchor = None;
    for at in order {
        if per_module[at].is_empty() {
            continue;
        }
        if anchor.is_none() {
            anchor = Some(snapshot.modules[at].root);
        }
        statements.extend(per_module[at].iter().copied());
    }
    // A lazy module keeps its statements to itself: they run when `import()`
    // first reaches it, by its `#evaluate`, and not in the order above.
    let deferred = (0..snapshot.modules.len())
        .filter(|at| lazy.get(*at).copied().unwrap_or(false))
        .map(|at| (at, std::mem::take(&mut per_module[at])))
        .collect();
    (anchor.map(|file| (file, statements)), deferred, refusals)
}

/// Evaluation order, and any cycles found on the way.
///
/// # Cycles are evaluated, not refused
///
/// ES modules specify them and node runs them, so refusing them was wrong --
/// and far too coarse. `node:fs` had four and every one was harmless: the only
/// thing crossing them was a *function*, which is hoisted and callable before
/// its module has evaluated. Refusing cost that module its whole
/// initialization to guard against something it was not doing.
///
/// The one thing a cycle can do that this compiler must not accept is a read of
/// a module-scope binding whose module has not evaluated -- a temporal dead
/// zone, where node throws a `ReferenceError` and this would quietly answer the
/// binding's static initializer. [`dead_zone_reads`] is that check, and the
/// order computed here is what makes it decidable: the violation is a read
/// whose declaring module sits *later* in this list than the module doing the
/// reading.
///
/// Post-order over each module's imports in source order, which is what
/// `InnerModuleEvaluation` specifies: a module's dependencies evaluate before
/// it, each exactly once. Verified against node with a diamond -- `d, a, b,
/// main`, and `d, b, a, main` when the entry's two import lines are swapped, so
/// the *order* of a module's imports is observable and the graph stores them
/// ordered.
///
/// Rooted at the modules nothing imports, then at every other module in index
/// order. The two-stage roll call matters: rooting at every module in index
/// order put `ex-cycle`'s `a` before `b` where node runs `b` first, because the
/// walk entered the cycle at whichever member the file order happened to reach
/// first rather than at the entry. Modules with no incoming edge are the
/// entries, and starting there is what makes the walk agree.
///
/// Every other module is still a root afterwards, because the frontend does not
/// know the product: a library's surface is its exports and an executable's is
/// its entry, and that choice is made after lowering. The cost is that an
/// executable may evaluate a module nothing imports, which node would not; the
/// alternative is not evaluating a library's modules at all.
#[must_use]
/// Which modules are evaluated at startup, and which only when an `import()`
/// first reaches them.
#[derive(Clone, Debug, Default)]
pub(super) struct ModuleRoles {
    /// By module index: reached only through `import()` -- and through the static
    /// imports of modules that are -- so evaluated by its own `#evaluate` the first
    /// time a dynamic import asks, and never by `module#init`.
    lazy: Vec<bool>,
    /// By module index: the namespace an `import()` naming it resolves with -- the
    /// checker's type for it, which is `Promise<namespace>`'s argument.
    pub(super) namespace: Vec<Option<TypeId>>,
}

/// The two globals a lazy module's evaluation keeps.
#[derive(Clone, Copy, Debug)]
pub(super) struct LazyModule {
    /// [`EVALUATING`], [`EVALUATED`] or [`FAILED`] once it has started; zero
    /// before.
    state: u32,
    /// What its evaluation threw, which every later `import()` of it rejects with:
    /// a module is evaluated once, and so fails once.
    pub(super) error: u32,
}

/// A lazy module's states, held in its [`LazyModule::state`] global.
const EVALUATING: i128 = 1;

const EVALUATED: i128 = 2;

const FAILED: i128 = 3;

/// The roles of every module: see [`ModuleRoles`].
///
/// **A dynamic import is an edge `link_modules` does not record** -- the module
/// graph holds static imports and re-exports only -- so a module reached only by
/// `import()` used to look like one nothing imports: a *root*, evaluated first,
/// at startup. The edge comes from the checker's type for the call,
/// `Promise<namespace>`, whose namespace's symbol is the imported module's root
/// symbol: the key `link_modules` resolves a static import by, so the two edges
/// cannot disagree about which module a specifier names.
///
/// Eager is the static closure of the static roots -- modules no static import
/// and no `import()` names. Lazy is what an `import()` target reaches through
/// static imports and the eager set does not. A module in neither (a component
/// with nothing outside it) stays as it was: evaluated at startup.
pub(super) fn module_roles(snapshot: &LoweringSnapshot<'_>) -> ModuleRoles {
    let probe = FuncBuilder::probe(snapshot);
    let count = snapshot.modules.len();
    let mut namespace: Vec<Option<TypeId>> = vec![None; count];
    for at in 0..snapshot.nodes.len() {
        let call = NodeId(u32::try_from(at).unwrap_or(u32::MAX));
        if !is_a_dynamic_import(&probe, call) {
            continue;
        }
        if let Some((module, target)) = dynamic_import_target(snapshot, call) {
            namespace[module].get_or_insert(target);
        }
    }
    let mut imported = vec![false; count];
    for module in &snapshot.modules {
        for target in &module.imports {
            if let Some(flag) = imported.get_mut(target.0 as usize) {
                *flag = true;
            }
        }
    }
    let closure_from = |starts: Vec<usize>, stop: &[bool]| {
        let mut reached = vec![false; count];
        let mut queue = starts;
        while let Some(at) = queue.pop() {
            if reached[at] || stop.get(at).copied().unwrap_or(false) {
                continue;
            }
            reached[at] = true;
            queue.extend(
                snapshot.modules[at]
                    .imports
                    .iter()
                    .map(|target| target.0 as usize),
            );
        }
        reached
    };
    let eager = closure_from(
        (0..count)
            .filter(|at| !imported[*at] && namespace[*at].is_none())
            .collect(),
        &[],
    );
    let lazy = closure_from(
        (0..count).filter(|at| namespace[*at].is_some()).collect(),
        &eager,
    );
    ModuleRoles { lazy, namespace }
}

/// The name a lazy module's evaluation is emitted under. By index, because two
/// modules may share a file name and `#` cannot appear in a declared one.
pub(super) fn module_evaluate_name(at: usize) -> String {
    format!("module{at}#evaluate")
}

/// Whether a function is module evaluation: `module#init`, or a lazy module's
/// `#evaluate` ([`module_evaluate_name`]). The question a pass asks when it means
/// "the code that writes module-scope bindings", which since dynamic `import()`
/// is no longer one function.
#[must_use]
pub fn evaluates_module_scope(name: &str) -> bool {
    name == MODULE_INIT
        || name
            .strip_prefix("module")
            .and_then(|rest| rest.strip_suffix("#evaluate"))
            .is_some_and(|index| !index.is_empty() && index.bytes().all(|b| b.is_ascii_digit()))
}

/// The two globals of every lazy module, appended to the module scope: see
/// [`LazyModule`]. At collection time, because every builder reads the scope and
/// a global has to exist before a function names it.
pub(super) fn add_lazy_modules(snapshot: &LoweringSnapshot<'_>, module: &mut ModuleScope) {
    let probe = FuncBuilder::probe(snapshot);
    module.roles = module_roles(snapshot);
    module.evaluated = vec![None; snapshot.modules.len()];
    for (at, lazy) in module.roles.lazy.iter().enumerate() {
        if !*lazy {
            continue;
        }
        let origin = probe.origin(snapshot.modules[at].root);
        let mut global = |name: String, ty: HirType| {
            let index = u32::try_from(module.globals.len()).unwrap_or(u32::MAX);
            module.globals.push(crate::hir::Global {
                name,
                ty: ty.clone(),
                initial: 0.0,
                exported: false,
                deferred: false,
                origin: origin.clone(),
                written: None,
                constant: false,
            });
            module.types.push(ty);
            index
        };
        let state = global(
            format!("module{at}#state"),
            HirType::Int {
                bits: 32,
                signed: true,
            },
        );
        let error = global(format!("module{at}#error"), HirType::Erased);
        module.evaluated[at] = Some(LazyModule { state, error });
    }
}

pub(super) fn evaluation_order(
    snapshot: &SemanticSnapshot,
    lazy: &[bool],
) -> (Vec<usize>, Vec<Vec<usize>>) {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        Unseen,
        OnStack,
        Done,
    }
    // A lazy module is evaluated by its own `#evaluate`, not here: marked done
    // before the walk, so it is neither a root nor a step of anyone's order.
    let mut marks: Vec<Mark> = (0..snapshot.modules.len())
        .map(|at| {
            if lazy.get(at).copied().unwrap_or(false) {
                Mark::Done
            } else {
                Mark::Unseen
            }
        })
        .collect();
    let mut order = Vec::new();
    let mut cycles = Vec::new();
    let mut path: Vec<usize> = Vec::new();

    // Entries first: a module nothing imports. That is what node starts from,
    // and inside a cycle it decides the answer -- for `b <-> a` reached from
    // `main`, node evaluates `b, a, main`, and starting the walk at `b` instead
    // gives `a, b, main`. Both are valid dependency orders and only one is
    // node's.
    //
    // The remaining modules are roots too, in index order, so a component
    // every member of which is imported -- a cycle with nothing outside it --
    // is still evaluated rather than skipped.
    let mut imported = vec![false; snapshot.modules.len()];
    for module in &snapshot.modules {
        for target in &module.imports {
            if let Some(flag) = imported.get_mut(target.0 as usize) {
                *flag = true;
            }
        }
    }
    let roots = (0..snapshot.modules.len())
        .filter(|at| !imported[*at])
        .chain(0..snapshot.modules.len());

    // An explicit stack rather than recursion: a module graph is program input,
    // and a deep one must not decide how much C stack this compiler has.
    let mut work: Vec<(usize, usize)> = Vec::new();
    for root in roots {
        if marks[root] != Mark::Unseen {
            continue;
        }
        work.push((root, 0));
        marks[root] = Mark::OnStack;
        path.push(root);
        while let Some((at, next)) = work.pop() {
            let imports = &snapshot.modules[at].imports;
            if next < imports.len() {
                work.push((at, next + 1));
                let target = imports[next].0 as usize;
                match marks.get(target) {
                    Some(Mark::Unseen) => {
                        marks[target] = Mark::OnStack;
                        path.push(target);
                        work.push((target, 0));
                    }
                    // A back edge: the target is still being visited, so the
                    // path from it to here closes a loop.
                    Some(Mark::OnStack) => {
                        if let Some(from) = path.iter().position(|on| *on == target) {
                            cycles.push(path[from..].to_vec());
                        }
                    }
                    _ => {}
                }
                continue;
            }
            marks[at] = Mark::Done;
            path.pop();
            order.push(at);
        }
    }
    (order, cycles)
}

/// The module initializer: every module-scope statement, in evaluation order,
/// as one function. Separate from `lower` because losing it has a consequence
/// worth stating at length, and because it is the one lowering that is about
/// the program rather than about a declaration in it.
/// Find the declarations whose initializer cannot lower, and record them on the
/// module so that reading one refuses.
///
/// All immutable planning is built once. This first walk adds only the
/// initializer refusal facts, before any body builder can borrow the context.
pub(super) fn mark_refused_initializers(
    snapshot: &LoweringSnapshot<'_>,
    shared: &mut Shared,
    lowered: &mut Lowered,
) -> rustc_hash::FxHashSet<u32> {
    let refused = refused_initializers(snapshot, shared, lowered);
    for symbol in &refused {
        shared.module.unsupported.entry(*symbol).or_insert_with(|| {
            "a module-scope variable whose initializer was refused above".to_owned()
        });
    }
    refused
}

/// Which module-scope declarations have an initializer that cannot lower.
///
/// A module-scope declaration whose initializer cannot lower has to be refused
/// *by itself*. It used to be, because it was never part of module evaluation;
/// now that it is, one unrepresentable declaration would take the whole
/// initializer with it -- every other module's evaluation included -- and `url`
/// has one, so this is not hypothetical. Trying it apart costs lowering these
/// expressions twice and buys a refusal that names the declaration rather than
/// the program.
///
/// Apart is also *equivalent*: a module-scope initializer reads globals and
/// constants, never a local, so it lowers the same alone as in sequence.
///
/// Asked *before* any function is lowered, which is the half that was missing.
/// The initializer was dropped and the variable kept, so every function that
/// read it was emitted against a global nothing had written -- a `let rendered:
/// string = String(source)` whose conversion is refused left `rendered` a null
/// pointer, and `rendered.length` was compiled and run. The refusal was
/// printed, the program was produced, and the harness called it agreed on
/// every case because every case had stopped.
fn refused_initializers(
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    lowered: &mut Lowered,
) -> rustc_hash::FxHashSet<u32> {
    let mut refused = rustc_hash::FxHashSet::default();
    for (symbol, initializer) in &shared.module.deferred {
        let mut probe = shared.builder(
            snapshot,
            NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default),
            Copy::default(),
        );
        // **At the slot it is going to fill**, which is how `lower_module_binding`
        // lowers the very same node. A bare `lower_expression` is a second
        // derivation of "can this initializer lower", and the two disagreed: a
        // `var xs = []` whose global the assignments settled to `number[]` was
        // refused *here* -- an empty array literal in a position that does not
        // say what it holds -- and the symbol marked unsupported, so the real
        // lowering, which would have known, never ran. 26 files of the slice-1
        // `test/language` population sat behind that one missing expectation.
        //
        // The global's type is the same `module.types` entry `lower_module_binding`
        // reads, so the two cannot drift again without drifting together.
        let want = shared
            .module
            .variables
            .get(symbol)
            .and_then(|global| shared.module.types.get(*global as usize))
            .cloned();
        let result = match &want {
            Some(want) => probe.lower_expecting(*initializer, want),
            None => probe.lower_expression(*initializer),
        };
        if let Err(diagnostic) = result {
            lowered.diagnostics.push(diagnostic);
            refused.insert(*symbol);
        }
    }
    refused
}

pub(super) fn lower_module_initializer(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
    refused: &rustc_hash::FxHashSet<u32>,
) {
    // Module-level statements. Nothing above walks them: the loop finds
    // declarations, and `total = bump(41)` is not one -- so it was dropped, and
    // the program compiled, ran, and answered as though the line were not
    // there. Lowered *after* the declarations so that a closure it allocates
    // joins the worklist below rather than missing it.
    let (initializer, deferred, refusals) = module_statements(
        snapshot,
        &shared.module.roles.lazy,
        &shared.naming.initialization,
    );
    lowered.diagnostics.extend(refusals);

    if let Some((file, mut statements)) = initializer {
        // And the same for whole statements, for the same reason at a larger
        // scale. One unsupported top-level statement used to cost the program
        // *every* top-level statement -- and it was not hypothetical either:
        // eighteen of the nineteen node profile modules lost all module
        // evaluation to a single `for...of` in `util/inspect`. When that one
        // was fixed the number stayed at eighteen, because the next
        // unsupported statement in the same file took over. It is a queue, and
        // one line of it darkens eighteen modules at a time.
        //
        // Statement-level granularity turns "this module is dark" into "this
        // line is dark", which is worth more than any individual lowering: it
        // is the difference between a diagnostic that names a construct and
        // one that names a program.
        //
        // Sound apart for the reason a declaration is: a module-scope
        // statement reads and writes *globals*, never a local of the
        // initializer, because a module-scope binding is a global. A block
        // that declares its own local also consumes it.
        drop_the_unlowerable(snapshot, shared, &mut statements, refused, lowered);

        let mut builder = shared.builder(
            snapshot,
            NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default),
            Copy::default(),
        );
        match builder.lower_module_init(file, &statements, refused) {
            Ok(func) => lowered.program.funcs.push(func),
            Err(diagnostic) => {
                // The consequence, said out loud. One refused statement loses
                // the *whole* initializer, and that does not stop the build:
                // the program is emitted, runs, and answers from static
                // initializers alone. A wrong answer with exit status 0.
                //
                // The refusal above names a construct; what a caller notices is
                // a number, so the two are worth separate sentences.
                //
                // Whether it should stop the build is a policy question about
                // what a refusal means -- `Severity::Error` is documented as
                // "the build cannot produce an artifact" and today does not --
                // and that is a decision about every refusal, not this one.
                let origin = diagnostic.primary;
                lowered.diagnostics.push(diagnostic);
                lowered.diagnostics.push(Diagnostic::error(
                "NTS1001",
                "module evaluation, which the refusal above loses in full and so will not run; \
                 the program still builds, and every module-scope value it would have computed \
                 stays at its static initializer"
                    .to_owned(),
                origin,
            ));
            }
        }
        builder.harvest(wanted, &mut lowered.arrivals);
        layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
    }

    // Each lazy module's evaluation, as a function of its own: see
    // `FuncBuilder::lower_module_evaluate`. A refusal there is the module's, so
    // it is recorded under the module's name and a call to it is refused by the
    // usual cascade rather than calling a function that is not there.
    for (at, mut statements) in deferred {
        drop_the_unlowerable(snapshot, shared, &mut statements, refused, lowered);
        let mut builder = shared.builder(
            snapshot,
            NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default),
            Copy::default(),
        );
        match builder.lower_module_evaluate(at, &statements, refused) {
            Ok(func) => lowered.program.funcs.push(func),
            Err(diagnostic) => {
                lowered
                    .program
                    .uncompiled
                    .push(crate::hir::Uncompiled::refused(
                        module_evaluate_name(at),
                        diagnostic.message.clone(),
                    ));
                lowered.diagnostics.push(diagnostic);
            }
        }
        builder.harvest(wanted, &mut lowered.arrivals);
        layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
    }
}

/// Keep the module-scope statements that lower, and refuse the rest one by one.
///
/// Each statement is tried alone, and one that cannot lower is dropped and named
/// rather than taking every other statement of the program with it. Asked of the
/// eager modules' statements for `module#init` and of each lazy module's for its
/// `#evaluate`: one filter, so the two cannot keep different statements.
fn drop_the_unlowerable(
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    statements: &mut Vec<NodeId>,
    refused: &rustc_hash::FxHashSet<u32>,
    lowered: &mut Lowered,
) {
    let mut lost = Vec::new();
    let mut stale = Vec::new();
    statements.retain(|statement| {
        let mut probe = shared.builder(
            snapshot,
            NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default),
            Copy::default(),
        );
        let attempt = if probe.kind_of(*statement) == Some(syntax::VARIABLE_STATEMENT) {
            probe.lower_module_binding(*statement, refused)
        } else if probe.kind_of(*statement) == Some(syntax::CLASS_DECLARATION) {
            // A class declaration evaluates its `static` initializers and
            // nothing else. `lower_statement` does nothing for one -- the
            // methods are lowered by their own walk -- so a static field
            // whose initializer is not a constant was never written, and
            // reading it reported "whose initializer was not compiled --
            // see the refusal above that says which" with no refusal above.
            probe.lower_static_fields(*statement)
        } else {
            probe.lower_statement(*statement)
        };
        match attempt {
            Ok(()) => true,
            Err(diagnostic) => {
                // The *statement's* span, not the cause's. The message
                // below says "this statement" and pointed at the
                // expression inside it, which is a different claim -- and
                // it also left every function declared in the statement
                // looking unaccounted for, because `super::unaccounted`
                // asks whether a refusal covers one. Fifty-one object
                // literal methods in the node profile were reported as
                // functions outside every walk for exactly that reason.
                // **And which names it leaves unwritten.** A reader of one
                // is told "whose initializer was not compiled -- see the
                // refusal above that says which", and nothing above named
                // it: the line below says "this statement" and the reader
                // has a *global* in hand. `console`'s `stdout` and six
                // `stderr` reads are that, pointing at one of thirty-seven
                // statement lines in the module with no way to tell which.
                //
                // Syntax answers it here and nothing else has to: a
                // variable statement's declarations are its children, and
                // the global a later pass finds unwritten is one of them.
                //
                // **Every binding a pattern declares**, not the declaration's
                // name: `const { a, b: { c } } = ...` has none, and leaves
                // `a` and `c` unwritten all the same. Property names and
                // defaults are not bindings; `pattern_names` is the walk that
                // knows. (Re-derived from Codex 84711414b.)
                let mut bindings = Vec::new();
                for declaration in probe
                    .children(*statement)
                    .into_iter()
                    .flat_map(|child| probe.children(child))
                    .filter(|at| probe.kind_of(*at) == Some(syntax::VARIABLE_DECLARATION))
                {
                    let Some(name) = probe.children(declaration).first().copied() else {
                        continue;
                    };
                    match probe.kind_of(name) {
                        Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN) => {
                            probe.pattern_names(name, &mut bindings);
                        }
                        Some(syntax::IDENTIFIER) => bindings.push(name),
                        _ => {}
                    }
                }
                let names: Vec<String> = bindings
                    .into_iter()
                    .filter_map(|name| {
                        probe
                            .node(name)
                            .text
                            .as_ref()
                            .and_then(|text| text.as_utf8())
                    })
                    .map(|name| format!("`{name}`"))
                    .collect();
                // And every global the statement assigns, in any form
                // (`assigned_symbols`), which keeps its old value now.
                let mut assigned = Vec::new();
                probe.assigned_symbols(*statement, &mut assigned);
                let assigned: Vec<u32> = assigned
                    .iter()
                    .filter_map(|symbol| probe.module.variables.get(symbol).copied())
                    .collect();
                stale.extend(assigned.iter().copied());
                lost.push((
                    probe.origin(*statement).location,
                    diagnostic,
                    names,
                    assigned,
                ));
                false
            }
        }
    });
    lowered.stale_globals.extend(stale);
    for (statement, diagnostic, names, assigned) in lost {
        lowered.diagnostics.push(diagnostic);
        // A *consequence*, and coded as one. The cause is the diagnostic
        // pushed just above; this says what losing the statement costs.
        // Sharing `NTS1001` with the causes made it the largest row in the
        // corpus histogram -- 37 of 184 files -- which read as a feature
        // thirty-seven programs were waiting on and was a tally of how
        // often anything at all went wrong at module scope.
        //
        // **And what it would have reassigned**, which keeps its old value: a
        // reader of one is refused or cut as reading a stale binding, and
        // without its name here nothing on the page said which line made it
        // stale -- `if (b instanceof Leaf) { viaNarrowedConst = ... }` names
        // no declaration.
        let reassigned: Vec<String> = assigned
            .iter()
            .filter_map(|global| lowered.program.globals.get(*global as usize))
            .map(|global| format!("`{}`", global.name))
            .filter(|name| !names.contains(name))
            .collect();
        let leaving = match (names.is_empty(), reassigned.is_empty()) {
            (true, true) => String::new(),
            (false, true) => format!(", leaving {} unwritten", names.join(", ")),
            (true, false) => format!(", leaving {} as it was", reassigned.join(", ")),
            (false, false) => format!(
                ", leaving {} unwritten and {} as it was",
                names.join(", "),
                reassigned.join(", ")
            ),
        };
        lowered.diagnostics.push(Diagnostic::error(
            "NTS1005",
            format!(
                "this statement, which module evaluation therefore skips{leaving}; the \
                 rest of the module's evaluation still runs, and every value this line \
                 would have computed keeps whatever it held before it"
            ),
            statement,
        ));
    }
}

/// The entry modules' exports, as `(emitted name, published name)`.
///
/// See [`super::Program::public_api`] for why a backend needs this and why
/// `Func::exported` cannot stand in for it.
///
/// "Entry" is `evaluation_order`'s rule -- a module with no incoming edge --
/// and it has to be, because it is the one this program already treats as the
/// thing node would run. Computed separately from that function rather than
/// returned by it: that one answers a question about *order* and this one
/// answers a question about *surface*, and they share only the edges.
///
/// The alias hop is what makes `export * from "./posix.ts"` work. The frontend
/// has already followed re-export chains to the end, so one `aliased` read
/// reaches the declaration however many files the name travelled through --
/// which is most of `runtime/node`, where a module's `main.ts` is usually a
/// list of re-exports and almost nothing is declared in the file that publishes
/// it. Without the hop this returns the entry's own declarations, which for
/// `path` is none of them.
/// The function declaration a `const` binding's initializer names, if it names
/// one.
///
/// `export const alias = impl.upper` and `export const upper = impl.upper` are
/// the same value under two names, and only the second used to reach the addon
/// -- because the emitted name was taken from the binding rather than from what
/// it was bound to, and one of the two happened to match.
pub(super) fn initializer_function(
    snapshot: &LoweringSnapshot<'_>,
    declaration: NodeId,
) -> Option<(NodeId, String)> {
    let probe = FuncBuilder::probe(snapshot);
    if probe.kind_of(declaration) != Some(syntax::VARIABLE_DECLARATION) {
        return None;
    }
    // The last child that is neither the name nor a type annotation, which is
    // how `collect_module_scope` finds an initializer -- by what it *is* rather
    // than by what it is not.
    let children = probe.children(declaration);
    let name = children.first().copied();
    let initializer = children.iter().rev().find(|child| {
        Some(**child) != name && !syntax::is_type_node(probe.kind_of(**child).unwrap_or_default())
    })?;
    // A call is not an alias for what it calls.
    //
    // `= f` and `= ns.f` bind the function; `= f()` binds its *result*, which is
    // an ordinary value however the callee is spelled. The two are told apart
    // here and nowhere else, because the fallback below asks the initializer's
    // last child for a symbol -- and a call with no arguments has exactly one
    // child, its callee, whose symbol is the function.
    //
    // `fs`'s `constants` is what found it: `export const O_CREAT = nts_fs_o_creat()`
    // resolved to `nts_fs_o_creat`, a native binding with no wrapper, so three
    // POSIX flags were reported as functions that failed to cross. They are
    // numbers.
    //
    // `NEW_EXPRESSION` for the same reason: `= new Thing()` binds an instance.
    if matches!(
        probe.kind_of(*initializer),
        Some(syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION)
    ) {
        return None;
    }
    // `impl.upper` is a property access and carries no symbol of its own -- the
    // member does. Asking the node and then its last child covers both `= f`
    // and `= ns.f` without asking which one this is.
    let symbol = probe.node(*initializer).symbol.or_else(|| {
        probe
            .children(*initializer)
            .last()
            .and_then(|member| probe.node(*member).symbol)
    })?;
    let record = snapshot.symbols.get(symbol.0 as usize)?;
    let record = record
        .aliased
        .and_then(|to| snapshot.symbols.get(to.0 as usize))
        .unwrap_or(record);
    // By what the symbol DECLARES rather than by its flags: an imported name
    // carries the import's flags and the declaration is what says it is a
    // function.
    // The name comes from the SYMBOL and the node from its declaration. A
    // `FUNCTION_DECLARATION` node carries no symbol of its own -- the name
    // identifier inside it does -- so reading one off the node returned the
    // binding's name and the whole resolution came out as a no-op.
    let name = record.name.public_name()?.to_owned();
    record
        .declarations
        .iter()
        .copied()
        .find(|at| probe.kind_of(*at) == Some(syntax::FUNCTION_DECLARATION))
        .map(|at| (at, name))
}

impl FuncBuilder<'_> {
    /// A module's top-level statements, as one function.
    ///
    /// Module evaluation is itself a job (`docs/records/notebooks/async.md` §3), so what this
    /// function queues is drained at the checkpoint after it rather than
    /// interleaved with it -- which is why it is an ordinary function the
    /// embedder calls, and not something the runtime runs implicitly.
    /// One module-scope statement, as module evaluation runs it -- `module#init`'s
    /// and a lazy module's `#evaluate` alike.
    fn lower_module_statement(
        &mut self,
        statement: NodeId,
        refused: &rustc_hash::FxHashSet<u32>,
    ) -> Result<(), Diagnostic> {
        if self.kind_of(statement) == Some(syntax::VARIABLE_STATEMENT) {
            return self.lower_module_binding(statement, refused);
        }
        // A class evaluates its `static` initializers here and nothing
        // else; `lower_statement` has no arm for one and refuses. The
        // `retain` pre-pass has the same branch, and having it in only one of
        // the two is why the first attempt reported "a `class declaration` is
        // not supported" from the emitter it had not been added to.
        if self.kind_of(statement) == Some(syntax::CLASS_DECLARATION) {
            self.lower_static_fields(statement)?;
            if let Some(symbol) = self
                .children(statement)
                .into_iter()
                .find(|at| self.kind_of(*at) == Some(syntax::IDENTIFIER))
                .and_then(|name| self.node(name).symbol)
            {
                self.mark_initialized(statement, symbol.0);
            }
            return Ok(());
        }
        self.lower_statement(statement)
    }

    /// A lazy module's evaluation: `module{at}#evaluate`, answering whether it
    /// succeeded.
    ///
    /// ```text
    /// state != 0      -> answer state != FAILED      already run, or running (a cycle)
    /// state = EVALUATING
    /// each lazy static import, in order: if !its #evaluate() -> take its error, FAILED, false
    /// the statements, in a handler: a throw -> error = thrown, FAILED, false
    /// state = EVALUATED, true
    /// ```
    ///
    /// **An answer rather than a raise**, because its callers are made by this
    /// compiler -- `import()`'s job and another lazy module's `#evaluate` -- and a
    /// raise reaches a caller only through a raising copy, which the copies'
    /// census makes from what a `try` written in the source reaches. The error
    /// lives in the module's own global, which is also what makes every later
    /// `import()` reject with the same one: a module is evaluated once, and so
    /// fails once.
    ///
    /// A call in a statement that can throw is carried to the handler where a
    /// raising copy of it exists, as `lower_try` carries one, and refused by name
    /// where none does -- an evaluation that ended the program on a throw node
    /// turns into a rejection would be a wrong answer, not a gap.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn lower_module_evaluate(
        &mut self,
        at: usize,
        statements: &[NodeId],
        refused: &rustc_hash::FxHashSet<u32>,
    ) -> Result<Func, Diagnostic> {
        let root = self.snapshot.modules[at].root;
        let origin = self.origin(root);
        let Some(lazy) = self.module.evaluated.get(at).copied().flatten() else {
            return Err(
                self.unsupported(root, "a lazily evaluated module with no evaluation state")
            );
        };
        let int = HirType::Int {
            bits: 32,
            signed: true,
        };
        let constant = |builder: &mut Self, value: i128| {
            builder.push(OpKind::ConstInt(value), int.clone(), origin.clone())
        };
        let state = self.push(OpKind::GlobalGet(lazy.state), int.clone(), origin.clone());
        let zero = constant(self, 0);
        let fresh = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: state,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let run = self.new_block();
        let settled = self.new_block();
        self.terminate(Terminator::Branch {
            cond: fresh,
            then_target: run,
            then_args: Vec::new(),
            else_target: settled,
            else_args: Vec::new(),
        });
        self.switch_to(settled);
        let failed = constant(self, FAILED);
        let succeeded = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: state,
                rhs: failed,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Return(Some(succeeded)));

        self.switch_to(run);
        let evaluating = constant(self, EVALUATING);
        self.push(
            OpKind::GlobalSet {
                global: lazy.state,
                value: evaluating,
            },
            HirType::Void,
            origin.clone(),
        );
        // Its lazy static imports first, in the order it writes them -- which is
        // the order `evaluation_order` gives an eager module's.
        let imports: Vec<usize> = self.snapshot.modules[at]
            .imports
            .iter()
            .map(|target| target.0 as usize)
            .collect();
        for dependency in imports {
            let Some(depended) = self.module.evaluated.get(dependency).copied().flatten() else {
                // Eager: it ran at startup, before anything could import this.
                continue;
            };
            let ok = self.push(
                OpKind::Call {
                    callee: Callee::Direct(module_evaluate_name(dependency)),
                    args: Vec::new(),
                    frame: None,
                },
                HirType::Bool,
                origin.clone(),
            );
            let next = self.new_block();
            let inherited = self.new_block();
            self.terminate(Terminator::Branch {
                cond: ok,
                then_target: next,
                then_args: Vec::new(),
                else_target: inherited,
                else_args: Vec::new(),
            });
            self.switch_to(inherited);
            let thrown = self.push(
                OpKind::GlobalGet(depended.error),
                HirType::Erased,
                origin.clone(),
            );
            self.fail_module_evaluation(lazy, thrown, &origin);
            self.switch_to(next);
        }

        // The statements, with a handler: a `throw` in one -- or in a call that
        // can carry it -- ends the evaluation with that error, not the program.
        let mut handled = Vec::new();
        for statement in statements {
            if let Some((call, why)) = self.call_within(*statement, &mut handled) {
                return Err(self.unsupported(
                    call,
                    &format!(
                        "a call in a dynamically imported module's evaluation whose `throw` would not reach the \
                         rejection: {why}"
                    ),
                ));
            }
        }
        self.raising_calls.extend(handled);
        let entry = self.bindings.clone();
        self.exits.push(Exit::Handler(Handler {
            block: None,
            edges: Vec::new(),
            rejections: Vec::new(),
        }));
        let mut lowered = Ok(());
        for statement in statements {
            if self.is_terminated() {
                break;
            }
            lowered = self.lower_module_statement(*statement, refused);
            if lowered.is_err() {
                break;
            }
        }
        let Some(Exit::Handler(frame)) = self.exits.pop() else {
            unreachable!("pushed immediately above")
        };
        lowered?;
        if !self.is_terminated() {
            let done = constant(self, EVALUATED);
            self.push(
                OpKind::GlobalSet {
                    global: lazy.state,
                    value: done,
                },
                HirType::Void,
                origin.clone(),
            );
            let yes = self.push(OpKind::ConstBool(true), HirType::Bool, origin.clone());
            self.terminate(Terminator::Return(Some(yes)));
        }
        if let Some(caught) = frame.block {
            let thrown = self.open_handler(caught, &frame, &entry, &origin);
            self.switch_to(caught);
            self.fail_module_evaluation(lazy, thrown, &origin);
        }
        Ok(self.finish(
            module_evaluate_name(at),
            Vec::new(),
            HirType::Bool,
            origin,
            false,
        ))
    }

    /// Record a lazy module's evaluation as failed with `thrown`, and answer
    /// `false` from its `#evaluate`.
    fn fail_module_evaluation(&mut self, lazy: LazyModule, thrown: ValueId, origin: &Origin) {
        self.push(
            OpKind::GlobalSet {
                global: lazy.error,
                value: thrown,
            },
            HirType::Void,
            origin.clone(),
        );
        let failed = self.push(
            OpKind::ConstInt(FAILED),
            HirType::Int {
                bits: 32,
                signed: true,
            },
            origin.clone(),
        );
        self.push(
            OpKind::GlobalSet {
                global: lazy.state,
                value: failed,
            },
            HirType::Void,
            origin.clone(),
        );
        let no = self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone());
        self.terminate(Terminator::Return(Some(no)));
    }

    fn lower_module_init(
        &mut self,
        file: NodeId,
        statements: &[NodeId],
        refused: &rustc_hash::FxHashSet<u32>,
    ) -> Result<Func, Diagnostic> {
        let origin = self.origin(file);
        for statement in statements {
            self.lower_module_statement(*statement, refused)?;
        }
        self.terminate(Terminator::Return(None));
        Ok(self.finish(
            MODULE_INIT.to_owned(),
            Vec::new(),
            HirType::Void,
            origin,
            true,
        ))
    }
}

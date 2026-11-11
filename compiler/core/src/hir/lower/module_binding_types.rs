//! Settled storage types for module bindings and their initializing writes.

use super::{
    BindingConstant, ClosureInfo, FuncBuilder, HirType, ManagedType, ModuleScope, NodeId, NodeKind,
    VALUELESS_DECLARED_CONST, binding_of, closure_type, compound_operator, declared_literal,
    declared_once, holds_only_absences, in_a_slot, initialized_before_use, is_scalar,
    logical_assignment, parse_bigint, parse_handle_constant, reassigned_anywhere,
    representation_word, syntax,
};

/// Why a module-scope `const` with no initializer -- ambient, since
/// TypeScript accepts one nowhere else -- cannot hold a native handle: it has
/// no value, and nothing assigns the global.
pub(super) fn ambient_handle(
    kind: nts_semantic_schema::VariableKind,
    initialized: bool,
    ty: &HirType,
) -> Option<String> {
    (kind == nts_semantic_schema::VariableKind::Const
        && !initialized
        && matches!(ty, HirType::NativePointer(_)))
    .then(|| {
        "an ambient constant holding a native handle, which has no value: nothing makes or names it"
            .to_owned()
    })
}

/// What a name's initializer settles about which function the name holds.
///
/// See [`FuncBuilder::initializer_settles`], which is the only thing that makes
/// one, and [`FuncBuilder::direct_callee`], which is why the three cases are
/// not two.
#[derive(Debug, Clone, Copy)]
pub(super) enum Settled {
    /// The name is not declared by a variable -- a function declaration, an
    /// import specifier, a parameter. The question belongs to whoever declared
    /// it, and the checker's resolved callee is as good as it ever was.
    NotAVariable,
    /// A variable whose initializer does not name a function: a call, a member
    /// read, a closure, or a conditional nothing has decided. **The checker's
    /// resolved callee is a coincidence here** -- two functions of one shape are
    /// one type and it kept one of them.
    Unsettled,
    /// A variable that names exactly one function declaration, and this is it.
    Names(NodeId),
}

/// Whether a module-scope variable can be a global, and why not.
///
/// One decision in three questions, together because the walk that asks them is
/// long enough without them and because each is a way the same thing goes
/// wrong: a global whose type the backend cannot emit.
pub(super) fn storable(
    probe: &mut FuncBuilder<'_>,
    name: NodeId,
    ty: &HirType,
) -> Result<(), String> {
    // **Named, because the sentence without it was about something else.**
    // `can_be_global` admits scalars, references and erased values, so what
    // reaches here is what is *none* of those -- and the message said "holding a
    // reference", which is the opposite of the condition. It sent a reader
    // looking for a reference in `let total: bigint = 1n`.
    if !ty.can_be_global() {
        return Err(format!(
            "a module-scope variable of {}, which a global has no storage for",
            representation_word(ty)
        ));
    }
    // A function type is `Managed(Object(..))` like any other object, and a
    // global of one holds a *closure* -- a different object, with its own
    // layout. Both are references, so nothing between here and the backend
    // objected: `coerce_to_slot` converts representations and the verifier asks
    // the same question. It surfaced as clang refusing to assign an
    // `NtsObj_Closure0 *` to an `NtsObj_Fn2 *`.
    //
    // Module state holding a closure is a feature rather than an oversight, so
    // it is refused in those words until it is one.
    if probe.is_function_typed(name) {
        // **Four conditions arrive here, and the message used to name one of
        // them -- the wrong one for three.** It said "a module-scope `let`",
        // and a reader of `const f = c.m` went looking for a `let`. The same
        // defect `storable`'s first refusal had, one branch up.
        //
        // What `closure_typed_global` takes is a name whose initializer *is* a
        // closure it can name, so the slot's layout is settled by construction.
        // What is left is every way that fails:
        //
        //     let f = a; f = b        two arrows, two layouts, one slot
        //     const f = c.m           some closure, layout unknown here
        //     const f = pick()        the same, from a call
        //     const f = function () { this.x }   binds `this`; not a closure
        //
        // The sentence now names what they share -- the initializer does not
        // fix the layout -- rather than the keyword three of them do not have.
        return Err(
            "a module-scope name holding a function, whose closure layout its initializer does not fix"
                .to_owned(),
        );
    }
    // The layout, here, because nothing else will build it: every other one is
    // built by a function that uses the type, and a global whose initializer
    // was refused is used by no function at all. That left the backend with
    // `an object type with no layout` on a program the lowering called clean.
    probe
        .materialize(name, ty)
        // The **noun phrase**, not the finished sentence. Everything stored in
        // `ModuleScope::unsupported` is handed back to `unsupported`, which
        // interpolates it into "… is not supported by this lowering yet" -- so
        // recycling a diagnostic's own message appended the tail twice:
        //
        //     ... unrepresentable type (`Map<string, WeakRef>`) is not
        //     supported by this lowering yet is not supported by this lowering yet
        //
        // and only on this path, so two refusals of one shape in one file read
        // differently. Every other producer of that map stores a phrase.
        .map_err(|diagnostic| {
            diagnostic
                .message
                .strip_suffix(" is not supported by this lowering yet")
                .map_or(diagnostic.message.clone(), str::to_owned)
        })
}

/// A name for a module global that no other module global has.
///
/// Two module-scope bindings can share a spelling and be different variables:
/// `for (let x of ...)` twice over declares two `x`, each scoped to its own
/// loop. They are separate symbols and need separate storage, and taking the
/// source text for both emitted a translation unit with `x` defined twice.
///
/// Latent until the declarations reached here at all -- a loop variable has no
/// initializer, and that was refused before it could collide.
pub(super) fn unshared_name(
    existing: &[crate::hir::Global],
    spelling: Option<String>,
    at: u32,
) -> String {
    let Some(spelling) = spelling else {
        return format!("global{at}");
    };
    if existing.iter().any(|global| global.name == spelling) {
        return format!("{spelling}{at}");
    }
    spelling
}

/// The type a module-scope binding takes when it holds an arrow.
///
/// A `const f = (x) => x * 2` holds the *closure* the arrow becomes, not a
/// value of its function type. Those are two different objects with two
/// different layouts, and typing the global by the declaration produced a slot
/// the initializer could not fill: clang refused to assign an
/// `NtsObj_Closure0 *` to an `NtsObj_Fn2 *`.
///
/// Both are references, so nothing between the lowering and the backend
/// objected -- the same coarse rule that let an array of `i32` into a slot of
/// `f64`, and the third time this week that "two pointers" answered a question
/// only the layout could.
///
/// `const` only, and that is the whole soundness argument: a slot typed by a
/// closure holds exactly the closure it was typed by. A `let` can be reassigned
/// with a *different* arrow, which is a different layout -- clang says so
/// directly, `assigning to 'NtsObj_Closure2 *' from 'NtsObj_Closure3 *'` -- so a
/// mutable one keeps the refusal in `storable`.
pub(super) fn closure_typed_global(
    probe: &mut FuncBuilder,
    closures: &[ClosureInfo],
    kind: nts_semantic_schema::VariableKind,
    name_node: NodeId,
    initializer: Option<NodeId>,
) -> Option<HirType> {
    let node = initializer
        .filter(|_| match kind {
            nts_semantic_schema::VariableKind::Const => true,
            // **A `let` nothing ever writes again is a `const` in the only way
            // that matters here.** The slot has to hold every closure that can
            // reach it, and a closure's layout is its captures -- so two arrows
            // are two layouts and the refusal below is right about `let f = a;
            // f = b`. It was also refusing `let f = a` on its own, where the
            // initializer builds the one object that can ever be in the slot.
            //
            nts_semantic_schema::VariableKind::Let => !reassigned_anywhere(probe, name_node),
            // **A `var` hoists**, so its global is readable before the initializer
            // runs, and a slot typed by a closure has no `undefined` to hold until
            // then. So it is taken only where nothing *can* read it then: one
            // declaration, nothing writing it again, and nothing that runs before
            // its statement -- see `initialized_before_use`. That is test262's
            // `var f = async function* () {}` followed by calls to `f`, which is
            // most of the 766 rows this sentence's refusal stood first in.
            nts_semantic_schema::VariableKind::Var => {
                declared_once(probe, name_node)
                    && !reassigned_anywhere(probe, name_node)
                    && initialized_before_use(probe, name_node)
            }
            _ => false,
        })
        // Through a conditional the checker has already decided, for the same
        // reason `initializer_settles` looks through one: `const f = DEV ? (x) =>
        // … : (y) => …` holds one closure, and which one is not a run-time
        // question. Without this the two paths disagree -- a decided choice
        // between two *declarations* would call directly while a decided choice
        // between two *arrows* refused -- and nothing about the slot explains the
        // difference.
        .map(|node| probe.decided_arm(node))
        .filter(|node| {
            matches!(
                probe.kind_of(*node),
                Some(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION)
            )
        })?;
    // A refused closure has no layout to name, so the binding falls through to
    // the ordinary path and is refused there with its own reason.
    //
    // **This lookup is also what makes admitting a `function` expression safe.**
    // One that mentions `this` binds its own, so `is_closure` never recorded it
    // and `position` finds nothing -- the same fall-through, reached without
    // asking about `this` a second time. Only the form that is already a
    // closure gets a global, which is the form an arrow always is.
    let index = closures
        .iter()
        .position(|closure| closure.node == node && closure.refusal.is_none())?;
    Some(HirType::Managed(ManagedType::Object(closure_type(index))))
}

/// [`ModuleScope::global_object`]: the binding of a module-scope `window`
/// declaration, looked for by its name rather than its symbol, since one the
/// program never writes has no symbol.
pub(super) fn global_object(probe: &FuncBuilder) -> Option<(NodeId, String)> {
    probe
        .snapshot
        .nodes
        .iter()
        .enumerate()
        .find_map(|(index, node)| {
            if node.kind != NodeKind::Syntax(syntax::VARIABLE_DECLARATION) {
                return None;
            }
            let id = NodeId(u32::try_from(index).ok()?);
            let name = *probe.children(id).first()?;
            (probe
                .node(name)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                == Some("window")
                && !probe.is_within_a_function(id))
            .then(|| binding_of(probe, id))
            .flatten()
        })
}

/// A module-scope declaration whose value is not the program's to compute,
/// settled into `scope`; `true` when it was, and it needs no global.
///
/// - **A binding's constant is the value its tag gives** (`/** @ntsConstant
///   1 */ export const WM_CREATE: c_uint;`, as Win32's are declared): folded
///   wherever it is read, like a folded `const` of the program's, and never a
///   global -- it is the platform's, not an export of this program's. A native
///   data pointer keeps its integer bits and declared type separately, never
///   entering JavaScript's numeric constant evaluator.
/// - A `valueless` scalar `const` with no binding tag at all is refused
///   ([`VALUELESS_DECLARED_CONST`]).
pub(super) fn settle_by_binding(
    probe: &FuncBuilder,
    scope: &mut ModuleScope,
    (id, symbol): (NodeId, nts_semantic_schema::SymbolId),
    (kind, valueless, ty): (nts_semantic_schema::VariableKind, bool, &HirType),
) -> bool {
    let native = probe.node(probe.tagged_statement(id)).native.as_deref();
    if let Some(binding) = native.and_then(|native| native.bound_by.as_deref()) {
        match binding_of(probe, id) {
            Some(bound) => drop(scope.bound.insert(symbol.0, bound)),
            None => drop(scope.unsupported.insert(
                symbol.0,
                format!(
                    "`@ntsBoundBy {binding}`, which names no foreign function that module declares"
                ),
            )),
        }
        return true;
    }
    if let Some(text) = native.and_then(|native| native.constant.as_deref()) {
        if let HirType::NativePointer(pointee) = ty {
            if !pointee.admits_constant_handle() {
                scope.unsupported.insert(
                    symbol.0,
                    format!("`@ntsConstant {text}` on a counted handle or a function pointer"),
                );
                return true;
            }
            match parse_handle_constant(text) {
                Some(0)
                    if !probe
                        .children(id)
                        .first()
                        .and_then(|name| probe.absences_of(*name))
                        .is_some_and(|absences| absences.contains(&crate::hir::tags::NULL)) =>
                {
                    scope.unsupported.insert(
                        symbol.0,
                        "a zero pointer constant on a type that excludes null".to_owned(),
                    );
                }
                Some(bits) => drop(scope.binding_constants.insert(
                    symbol.0,
                    BindingConstant::Pointer { bits, ty: ty.clone() },
                )),
                None => drop(scope.unsupported.insert(
                    symbol.0,
                    format!("`@ntsConstant {text}`, which needs an integer fitting a 64-bit uncounted data pointer"),
                )),
            }
            return true;
        }
        if *ty == HirType::BigInt {
            match parse_bigint(text) {
                Some(value) => drop(
                    scope
                        .binding_constants
                        .insert(symbol.0, BindingConstant::BigInt(value)),
                ),
                None => drop(scope.unsupported.insert(
                    symbol.0,
                    format!("`@ntsConstant {text}`, which needs an exact integer fitting 128 bits"),
                )),
            }
            return true;
        }
        if !is_scalar(ty) && !matches!(ty, HirType::BigInt | HirType::Erased) {
            scope.unsupported.insert(symbol.0, format!(
                "`@ntsConstant {text}`, whose declared type is neither a scalar nor an uncounted native data pointer"
            ));
            return true;
        }
        match text
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite())
        {
            Some(value) => drop(scope.constants.insert(symbol.0, value)),
            None => drop(scope.unsupported.insert(
                symbol.0,
                format!("`@ntsConstant {text}`, which is not a number"),
            )),
        }
        return true;
    }
    if kind == nts_semantic_schema::VariableKind::Const
        && valueless
        && native.is_none()
        && is_scalar(ty)
    {
        scope
            .unsupported
            .insert(symbol.0, VALUELESS_DECLARED_CONST.to_owned());
        return true;
    }
    false
}

/// Give a module-scope name storage, or re-use the storage it already has.
///
/// **One symbol is one storage location.** A redeclaration writes the global it
/// already has rather than pushing a second: `scope.variables` is what every
/// read and write resolves through, so a second push leaves the first as
/// storage nothing can reach.
///
/// `needs_code` is the single condition, stated on the global so a backend and
/// a later pass can ask it, and it is the same condition `scope.deferred` is
/// given. A declaration whose value folds needs none — the number is in
/// `initial` — unless it is a *re*declaration, because `initial` is written
/// once before any statement runs and cannot express a value that arrives
/// partway through the module.
/// `never[]` -- what the checker gives `[]` before anything says what it holds.
///
/// An **unsettled** observation rather than a wrong one: TypeScript's evolving
/// array type starts here and widens from the writes, so a node carrying it has
/// not yet been told what the array is for. Three readers ask, which is why it
/// is a function: `lower_array_literal` will not build one, `evolved_type` must
/// not let one veto a settled sibling, and `collect_module_scope` must not take
/// one as a global's type when a sibling settled it.
/// What a declared name settles on holding.
///
/// **The declaration's own type first, unless it is unsettled.** `var xs = []`
/// types the declaration `never[]`, which is a `Some`, so an `or_else` beside
/// it never ran and the name was declared to hold nothing -- and the empty
/// literal then refused for want of a type the assignments had already settled.
///
/// **Asked of a declaration and not of a scope**, because the question does not
/// depend on one. It was written for module scope, and the function-scope
/// spelling of the identical program asked a shorter question one file-section
/// away -- `type_of(name).or_else(|| evolved_type(name))`, missing exactly the
/// `is_an_unsettled_array` filter this exists for. So
/// `function f() { var xs = []; xs[0] = 7; }` refused where the module-scope
/// spelling lowered, and the refusal it gave named the empty literal rather
/// than the asymmetry. [`settled_global_type`] is this plus the one thing that
/// really is about slots.
///
/// The two filters are the price of taking the settled one. Every write that
/// settles an evolving array's type *grows* it, so the type is only usable
/// where those writes can actually be performed: not for a counted element
/// ([`growth_can_fill`]) and not out of order ([`dense_prefix_writes`]).
/// Failing either, the unsettled type is handed back rather than nothing, which
/// keeps the diagnostic the literal gives -- it names the construct, where a
/// global of unrepresentable type does not.
pub(super) fn settled_declaration_type(probe: &FuncBuilder, name_node: NodeId) -> Option<HirType> {
    let declared = probe.type_of(name_node);
    declared
        .clone()
        .filter(|ty| !is_an_unsettled_array(ty))
        .or_else(|| {
            // **`growth_can_fill` is a question about *indexed* writes**, and
            // its own doc says so: "those writes are `xs[0] = v` on an array
            // that does not have a slot 0 yet, so every one of them grows". A
            // name filled by `push` has no such write --- `nts_array_push_ref`
            // appends a reference perfectly well --- so requiring it there
            // rejects a type nothing was going to grow by index.
            //
            // `tests/programs/growable` is the case: `const parts = []` filled by
            // `parts.push("p" + String(i))` in a loop. It lowered until this
            // derivation was shared with locals, and then refused, because the
            // element is counted and the filter did not ask whether any indexed
            // write existed. `dense_prefix_writes` answers both halves at once
            // -- whether the indexed writes are an in-order prefix, and how
            // many there were.
            probe
                .evolved_type(name_node)
                .filter(|ty| match dense_prefix_writes(probe, name_node) {
                    None => false,
                    Some(writes) if writes.count == 0 => true,
                    Some(_) => growth_can_fill(ty),
                })
        })
        // **And failing that, what the pushes supply.** Reached only when no
        // reference carried a type at all, which is the evolving array the
        // checker never resolved; `pushed_element_type` carries why that
        // happens and why the arguments are the only place left to ask.
        //
        // Guarded on there being no indexed writes, for the reason the arm
        // above is: an array filled both ways is the mixed shape that stays
        // conservative, and `Some(0)` is exactly "filled by push alone".
        .or_else(|| {
            dense_prefix_writes(probe, name_node)
                .filter(|writes| writes.count == 0)
                .and_then(|_| pushed_element_type(probe, name_node))
        })
        // **And the same question of the indexed writes.** `xs[0] = 7` says
        // what the element is exactly as `xs.push(7)` does, and an evolving
        // array read only through `length` is unresolved either way:
        //
        //     const xs = []; xs[0] = 7; xs[1] = 8; xs[1];       lowered
        //     const xs = []; xs[0] = 7; xs[1] = 8; xs.length;   refused
        //
        // `growth_can_fill` applies here and not to the push arm, because
        // these writes really do grow by index -- which is the distinction
        // that whole function is about.
        .or_else(|| {
            dense_prefix_writes(probe, name_node)
                .filter(|writes| writes.count > 0)
                .and_then(|writes| writes.element)
                .map(|element| HirType::Managed(ManagedType::Array(Box::new(element))))
                .filter(growth_can_fill)
        })
        .or(declared)
        // **An evolving global initialised with an absence holds both.**
        // `var x = null; x = 2` settles on `f64` above, because that is what
        // every reference is; the `null` the slot carries until the assignment
        // is not a reference and is not in that answer. Storing an erased
        // `null` into an `f64` global is the mismatch that came back as "an
        // erased value where a concrete representation is wanted", one step
        // past the literal's own refusal.
        //
        // A *reference* evolution needs nothing: a nullable pointer already
        // holds the absence, which is why `string | null` is one pointer.
        .map(|ty| {
            if ty.is_scalar() && initialized_with_an_absence(probe, name_node) {
                HirType::Erased
            } else {
                ty
            }
        })
}

/// The same, for a name that is a **slot**.
///
/// `var a;` that nothing assigns is `HirType::Void` -- a type with no width --
/// and a global has to have one, so `storable` refused it. That is the sixth
/// position to ask this, and the only part of the question that is about being
/// a global rather than about being a declaration.
///
/// `Lowering::unwritten` reached the same answer for the function-scope
/// spelling of the identical program, through this same `in_a_slot`. The two
/// scopes disagreed because only one of them asked -- which is the whole reason
/// the rest of the derivation now lives in
/// [`settled_declaration_type`], where both can reach it.
///
/// 5 files of the slice-1 `test/language` population, and finding that they
/// were this took correcting the message first: they all read "a module-scope
/// variable holding a reference", which is the opposite of the condition and
/// gave no hint they were the `var g;` case one scope out.
pub(super) fn settled_global_type(
    probe: &FuncBuilder,
    name_node: NodeId,
    initialized: bool,
) -> Option<HirType> {
    settled_declaration_type(probe, name_node)
        .map(in_a_slot)
        .or_else(|| {
            // An ambient declaration supplies no value. Giving it a slot
            // would invent an undefined instead of the missing binding.
            if !initialized {
                return None;
            }
            // A null-only global is a slot too. Its declared type has no
            // ordinary representation, so it never reaches `in_a_slot`.
            // Answer only for this storage position: a narrowed nullable
            // field read still uses its declared pointer representation.
            probe
                .snapshot
                .node_types
                .get(&name_node)
                .filter(|ty| holds_only_absences(probe.snapshot, **ty))
                .map(|_| HirType::Erased)
        })
}

/// Are this name's indexed writes `[0]`, `[1]`, ... in that order?
///
/// **The second half of the question `growth_can_fill` asks**, and the half
/// that was missing. Every write that settles an evolving array's type grows it,
/// and growth is *by one* -- `xs[5] = v` on a length-1 array wants four holes,
/// a hole reads as `undefined`, and a dense array of numbers has no room for
/// one. So the runtime aborts, with no diagnostic and nothing naming the
/// construct.
///
/// Letting the type settle for such a name turns a refusal into an **abort**,
/// which is strictly worse. That is not hypothetical: six `test/language`
/// files went from `unsupported` to SIGABRT the first time a settled type
/// reached them -- `applying-the-exp-operator_A11.js` opens
/// `var exponents = []; exponents[3] = Infinity; exponents[2] = ...`, dense in
/// the end and sparse at every step of the way.
///
/// So the writes have to be a **prefix, in order**: each index a constant, and
/// each the next slot after the last. That is the shape the corpus writes --
/// `var bases = []; bases[0] = a; bases[1] = b` -- and every one of those is an
/// append. Anything else keeps the refusal it had before.
///
/// A name with no indexed writes at all passes: it is filled by `push`, which
/// appends by definition. Conservative where they are mixed, which is a shape
/// nothing in the corpus writes.
/// Whether this declaration's initializer is `null` or `undefined` written out.
///
/// The declaration's own observation, which [`Lowering::evolved_type`] does not
/// have: it walks the nodes carrying the symbol and skips the name, so
/// `var x = null; x = 2` settles on `f64` -- every *reference* is a number by
/// then -- and the absence the slot has to hold until the assignment is nowhere
/// in that answer.
fn initialized_with_an_absence(probe: &FuncBuilder, name_node: NodeId) -> bool {
    let Some(declaration) = probe.node(name_node).parent else {
        return false;
    };
    if probe.kind_of(declaration) != Some(syntax::VARIABLE_DECLARATION) {
        return false;
    }
    probe.children(declaration).into_iter().any(|child| {
        probe.kind_of(child) == Some(syntax::NULL_KEYWORD)
            || (probe.kind_of(child) == Some(syntax::IDENTIFIER)
                && probe.is_the_undefined_literal(child))
    })
}

/// What a name's indexed writes are, when they are a prefix at all.
///
/// One walk, two answers, because both are read off the same assignments and
/// a second walk over the same nodes is how this function ended up carrying a
/// third derivation of "which operators write".
///
/// `element` is `None` where the writes disagree about what they store, or
/// where the checker recorded no type for one of them. That is weaker than
/// `count` failing: the writes can still be a valid prefix whose element type
/// nobody can name.
struct IndexedWrites {
    count: u32,
    element: Option<HirType>,
}

fn dense_prefix_writes(probe: &FuncBuilder, name_node: NodeId) -> Option<IndexedWrites> {
    let symbol = probe.node(name_node).symbol?;
    let mut expected = 0.0_f64;
    let mut seen = 0_u32;
    let mut element: Option<HirType> = None;
    for at in 0..probe.snapshot.nodes.len() {
        let Ok(index) = u32::try_from(at) else {
            return None;
        };
        let id = NodeId(index);
        if id == name_node || probe.node(id).symbol != Some(symbol) {
            continue;
        }
        let Some(access) = probe.node(id).parent else {
            continue;
        };
        if probe.kind_of(access) != Some(syntax::ELEMENT_ACCESS_EXPRESSION) {
            continue;
        }
        let parts = probe.children(access);
        let [array, subscript] = parts.as_slice() else {
            continue;
        };
        // The name as the *subscript* of someone else's access is a read of it.
        if *array != id {
            continue;
        }
        let Some(assignment) = probe.node(access).parent else {
            continue;
        };
        if probe.kind_of(assignment) != Some(syntax::BINARY_EXPRESSION) {
            continue;
        }
        let operands = probe.children(assignment);
        let [target, operator, stored] = operands.as_slice() else {
            continue;
        };
        if *target != access {
            continue;
        }
        // **Which operators write is asked in one other place**, and this was
        // the second derivation of it. `stands_on_the_target_side` tests three
        // things -- `=`, [`compound_operator`], [`logical_assignment`] -- and
        // its doc says why: "derivations of `which operators write` would
        // eventually disagree, and this one is the safety-critical copy". This
        // copy tested `=` alone, so *every other binary operator* counted as a
        // write, and an ordinary **read** of the name as a left operand
        //
        //     const xs = []; xs[0] = 7; xs[1] = 8; return xs[0] + xs[1];
        //
        // was taken for a compound assignment and rejected the whole name. The
        // writes really are a dense prefix there; the `+` is not one of them.
        //
        // It looked like a scope asymmetry and is not: the module-scope
        // spelling of that same expression answers `false` too. The two probes
        // that suggested a scope difference differed in how they *read* the
        // array as well as in where it was declared.
        let token = probe.kind_of(*operator).unwrap_or(0);
        let writes = token == syntax::EQUALS_TOKEN
            || compound_operator(token).is_some()
            || logical_assignment(token).is_some();
        if !writes {
            continue;
        }
        // A compound assignment *reads* the slot before writing it, so it can
        // never be the write that creates one -- `xs[9] += 1` would settle a
        // type that the read itself aborts on. The same holds for `xs[9] ??= 1`,
        // which reads the slot to decide whether to write at all.
        //
        // **But only past the prefix.** Over a slot the writes before it have
        // already created, a read-modify-write is just a read, and rejecting it
        // outright cost two working programs:
        //
        //     const xs = []; xs[0] = 1; xs[0] += 4;     // 5, and lowered fine
        //     const xs = []; xs[0] = 1; xs[0] ??= 9;    // 1, and lowered fine
        //
        // Both were accepted before this function was asked about locals at
        // all, and a blanket rejection turned them into refusals. The index
        // decides: below `expected` the slot exists, at or above it the
        // assignment is the thing that would have to create one.
        if token != syntax::EQUALS_TOKEN {
            match declared_literal(probe, *subscript) {
                Some(value) if value < expected => continue,
                _ => return None,
            }
        }
        match declared_literal(probe, *subscript) {
            Some(value) if (value - expected).abs() < f64::EPSILON => {
                expected += 1.0;
                seen += 1;
            }
            _ => return None,
        }
        // **What the write stores**, collected on the walk that already has
        // the assignment in hand rather than by a second one over the same
        // nodes. Two walks deciding "is this an indexed write" is the shape
        // that put a third answer to "which operators write" in this very
        // function, and the comment above is what that cost.
        //
        // A disagreement between two writes leaves it unsettled rather than
        // failing the whole walk: the *prefix* is still a prefix, and it is
        // only the element type the caller cannot have. A dense array has
        // one width, so two writes of different types settle nothing.
        match (&element, probe.type_of(*stored)) {
            (_, None) => element = Some(HirType::Void),
            (None, Some(ty)) => element = Some(ty),
            (Some(known), Some(ty)) if *known != ty => element = Some(HirType::Void),
            (Some(_), Some(_)) => {}
        }
    }
    Some(IndexedWrites {
        count: seen,
        element: element.filter(|ty| *ty != HirType::Void),
    })
}

/// The element type an evolving array's `push` calls supply.
///
/// **The one place the information exists** for a name the checker has given
/// up on. `const xs = []` is TypeScript's *evolving* array and stays `any[]`
/// until a reference forces the element type to be resolved; `xs[0]` forces it
/// and `xs.join(",")` forces it, but `xs.length` does not --- `length` is on
/// the array whatever it holds --- and neither does the receiver of the `push`
/// that supplies the type. So
///
/// ```text
/// const xs = []; xs.push(7); xs[0];      lowered
/// const xs = []; xs.push(7); xs.length;  refused
/// ```
///
/// differed only in the expression that read the result, which is not a
/// property of the declaration at all. [`Lowering::evolved_type`] saw no type
/// at *any* reference in the second --- not an unsettled `never[]` it could
/// skip, which is the case its own comment is about, but nothing to settle
/// from.
///
/// Asked of the **arguments** rather than of any reference, which is where the
/// checker did record an answer. Every push must agree: two pushing different
/// types is a union, and a dense array has one width.
///
/// Only meaningful where the name has no indexed writes --- the caller checks
/// that with [`dense_prefix_writes`] --- because an array filled both ways is
/// the mixed shape that stays conservative.
fn pushed_element_type(probe: &FuncBuilder, name_node: NodeId) -> Option<HirType> {
    let symbol = probe.node(name_node).symbol?;
    let mut settled: Option<HirType> = None;
    for at in 0..probe.snapshot.nodes.len() {
        let id = NodeId(u32::try_from(at).ok()?);
        if id == name_node || probe.node(id).symbol != Some(symbol) {
            continue;
        }
        // The name as the *receiver* of `.push`, and not as its argument:
        // `ys.push(xs)` mentions `xs` too, and says nothing about what `xs`
        // holds.
        let Some(access) = probe.node(id).parent else {
            continue;
        };
        if probe.kind_of(access) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            continue;
        }
        let parts = probe.children(access);
        let [receiver, member] = parts.as_slice() else {
            continue;
        };
        if *receiver != id || probe.literal_name(*member).as_deref() != Some("push") {
            continue;
        }
        // And that access standing as the callee, so a `push` merely named --
        // `const f = xs.push` -- supplies nothing.
        let Some(call) = probe.node(access).parent else {
            continue;
        };
        if probe.kind_of(call) != Some(syntax::CALL_EXPRESSION) {
            continue;
        }
        let children = probe.children(call);
        let [callee, arguments @ ..] = children.as_slice() else {
            continue;
        };
        if *callee != access {
            continue;
        }
        for argument in arguments {
            // A type the checker did not record, or one that disagrees with a
            // sibling, leaves the name exactly as unrepresentable as it was.
            // Answering anything here would be inventing a width.
            let ty = probe.type_of(*argument)?;
            match &settled {
                Some(known) if *known != ty => return None,
                Some(_) => {}
                None => settled = Some(ty),
            }
        }
    }
    settled.map(|element| HirType::Managed(ManagedType::Array(Box::new(element))))
}

/// Can the writes that settled this type actually be performed?
///
/// Only asked of a type [`is_an_unsettled_array`] rejected -- one the *writes*
/// settled rather than the declaration. Those writes are `xs[0] = v` on an
/// array that does not have a slot 0 yet, so every one of them grows, and
/// growth is **not supported for a counted element**: `rc.rs` pairs each store
/// with a load of what the slot was holding, and at `index == length` there is
/// no such slot to load -- `array_write_may_grow` is where that is written
/// down, and the ledger row for `xs[xs.length] = v` carries why.
///
/// Without this the type would be settled, the literal would build, and the
/// first write would **abort** -- `nts: refused: index 0 is outside [0, 0)`,
/// exit 134, no diagnostic. Refusing the literal, which is what happens when
/// the type stays unsettled, names the construct instead. Measured: a
/// `var xs = []; xs[0] = "a"` at module scope did exactly that, one build after
/// the settled type started arriving.
///
/// Lifting this is one design rather than a patch -- an explicit reserve before
/// `rc.rs`'s load, so the slot exists by the time anything reads it.
///
/// # This guards one spelling of four, measured 2026-09-21
///
/// The sentence above used to end "and it lifts the annotated spelling at the
/// same time, which diverges from node today for the same reason". That is
/// true and it is a quarter of the picture. Growing an array of **references**
/// by an index write, with `xs[0] = "a"` on an empty one:
///
/// ```text
///     const xs = [];          at module scope   REFUSED here      <- this
///     const xs: string[] = []; at module scope  ABORTS at run time
///     const xs = [];          in a function     ABORTS at run time
///     const xs: string[] = []; in a function    ABORTS at run time
/// ```
///
/// The abort is `nts: refused: index 0 is outside [0, 0)`, exit 134, with
/// **zero compile-time refusals** -- which is the failure this function's third
/// paragraph describes and then guards against in one position out of four.
/// Pre-existing: a binary built 2026-09-18 aborts identically.
///
/// Two controls place it exactly. An array of **numbers** grows by index write
/// in every position and agrees with node, and `push` works in every position
/// for references too -- so what is unsupported is the *growing index write*
/// on a counted element, not growth and not references.
///
/// Extending this check is not the fix. It is asked of a declaration, and the
/// other three spellings have a perfectly good declared type; what distinguishes
/// them is what the program later *does* to the name. Either a program-wide
/// question like [`dense_prefix_writes`] asked of every array-typed
/// binding, or a bounds-analysis one -- refuse a write `bounds.rs` can prove is
/// past the end -- and the second is the one that would also catch `xs[9] = v`
/// on a populated array.
fn growth_can_fill(ty: &HirType) -> bool {
    let HirType::Managed(ManagedType::Array(element)) = ty else {
        return true;
    };
    !element.may_hold_a_reference()
}

/// `never[]` at any depth: the checker saying this literal decides nothing.
///
/// **At any depth, because `[[]]` decides nothing either.** The one-level
/// version read `Array(Array(Never))` as settled, so the outer literal kept a
/// type whose element cannot be represented and the refusal came out as
///
/// ```text
/// an array literal of unrepresentable type (an array of an array of a
/// representable type)
/// ```
///
/// which contradicts itself and sends its reader after a representation gap
/// that is not there. That is the exact failure the `empty` flag beside this
/// exists to avoid, one level in: what is missing is a type for the literal to
/// take, and only the branch that discarded `never[]` knows it.
///
/// 12 files of the slice-1 `test/language` population, all
/// `for (… of [[]])` — and they still refuse, because nothing in those
/// programs says what the inner array holds. The refusal names the empty
/// literal now instead of blaming the representation.
/// The same type with every uninhabited element replaced by a width.
///
/// The answer [`is_an_unsettled_array`] asks for. Recursive rather than one
/// level, because `never[][]` is reached through an array whose element is
/// itself unsettled and a one-level replacement would leave the inner one.
pub(super) fn settled(ty: &HirType) -> HirType {
    match ty {
        HirType::Managed(ManagedType::Array(element)) if **element == HirType::Never => {
            uninhabited_array()
        }
        HirType::Managed(ManagedType::Array(element)) => {
            HirType::Managed(ManagedType::Array(Box::new(settled(element))))
        }
        other => other.clone(),
    }
}

/// Storage for an array with no element to read. Empty tuples and uninhabited
/// array literals share this choice; a literal's contextual element type still
/// takes precedence when one is known.
pub(super) fn uninhabited_array() -> HirType {
    HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER)))
}

pub(super) fn is_an_unsettled_array(ty: &HirType) -> bool {
    match ty {
        HirType::Managed(ManagedType::Array(element)) => {
            **element == HirType::Never || is_an_unsettled_array(element)
        }
        _ => false,
    }
}

/// A `static` field is one storage location for the program, so it is a global.
///
/// ```text
/// class EventEmitter {
///   static readonly errorMonitor: unique symbol = Symbol("events.errorMonitor");
/// }
/// ```
///
/// Reading one was refused as "`EventEmitter`, a class used as a value", which
/// is the message for a *different* construct: producing the class object. A
/// static read does not want the class object, it wants the storage behind the
/// name -- which the Node lane established by measuring that a static **method**
/// call through a class name already lowers, so the lowering can resolve a
/// member through a class name when the result is consumed. See record 0269.
///
/// What it cost is the largest item on the compiled axis. `EventEmitter#emit`
/// reads `EventEmitter.errorMonitor`, and under `emit` sit `addListener`,
/// `EventEmitter#on`, `net.Server`'s constructor, `http.Server`'s, and
/// `createServer` -- **274 failing test files** by that lane's ranking.
///
/// A global is the right storage and not an approximation: a static field is
/// initialized once, at class definition time, which is during module
/// evaluation -- the same moment `module#init` writes every other deferred
/// global, and in the same source order. Everything that follows is
/// `collect_module_scope`'s machinery keyed on the property's own symbol, so a
/// read resolves exactly as a module-scope `const`'s does.
///
/// Named `Class.field`, which is what a static *method* is already called and
/// cannot collide with a plain declaration -- `.` is not a TypeScript
/// identifier character, which is why `c_identifier` reserves a spelling for it.
/// Why a binding with no initializer and an erased type has no storage.
///
/// One sentence, two callers: a module-scope `let` and a `static` field, which
/// share `ModuleScope` and therefore share this rule. Its initial value would
/// have to be `undefined`, which is a tag, and an erased slot's zero has
/// nowhere to put one -- so this is the representation talking rather than a
/// lowering nobody wrote.
pub(super) fn no_initializer_for_an_erased_slot() -> String {
    "a module-scope variable with no initializer, whose type has no representation \
     for the `undefined` it starts as"
        .to_owned()
}

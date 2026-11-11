//! Choose which bodies and dispatch slots get a raising copy and record the reason an eligible route is held.

use super::{
    FuncBuilder, Hierarchy, Lowered, LoweringSnapshot, MemberKey, MethodAccessor, Naming, NodeId,
    NodeKind, Program, Reached, SemanticSnapshot, Shared, Substitution, Throwing, TypeId,
    a_copy_can_contain, a_value_held_callee, calls_guarded_by_a_try, calls_in_the_body_of,
    close_over_callees, closure_bodies_that_can_raise, declared_base_class, function_behind_const,
    functions_used_as_values, instance_type_of, interface_member_of, is_generic_function,
    literal_methods, member_copy, member_dispatch_key, members_filling, names_a_body,
    raising_body_calls, syntax, the_constructor_declared_by, the_function_of,
};

/// A dispatch slot for the raising copy of an **overridden** member, and a copy for
/// every class that fills it -- or neither, where one of them cannot carry.
///
/// A member no subclass overrides is a `Callee::Direct` and its copy is that name with
/// the suffix, which is why a method needed no slot when it became copyable. Where the
/// dispatch *is* virtual there is no name to suffix, and `callee_for` refused: the slot
/// holds the ordinary entry, whose body ends the program on an uncaught `throw` while
/// the flag test the site emitted watches a flag nothing sets. This is the index that
/// makes the dispatch answerable.
///
/// **It is all of the family or none of it, and that is a soundness condition rather
/// than a simplification.** The site has a static receiver type and any subclass may
/// arrive, so `Base`'s copy being reachable at the slot means *every* overrider's is.
/// Two things can go wrong at one of them and the second is the one that bites:
///
/// * it **cannot raise** -- then it needs no copy at all and
///   [`fill_raising_member_slots`] gives its slot the ordinary entry, which runs and
///   never raises. Sound, and the common case;
/// * it can raise and **is not [`Naming::copyable`]** -- then no copy of it can be
///   built, and filling the slot with its ordinary entry is an escape. So the family
///   gets no slot, `Hierarchy::slot_for` answers `None`, and the two call sites keep
///   refusing. `runtime/node`'s `_read` family is exactly this: `DuplexSide#_read`
///   calls `release`, which calls a callback held in a field, and an indirect callee
///   is carried only where [`Naming::closures_carry`] is on.
///
/// **The first version asked neither question** and inserted every overrider into
/// `raising` outright. `Sub#raise@raises` was then *built* -- `function_copies` is
/// keyed on the set, not on the fixpoint -- and its indirect call went out at the
/// ordinary uniform entry, so the `throw` it exists to carry ended the program:
/// `nts: uncaught RangeError` on 8 of 29 cases where node answers `-1`. The copy
/// compiled, the `try` compiled, and nothing was refused. That is why the eligibility
/// `raising_copies` computes is published rather than re-derived here.
///
/// **Appended after the uniform entries, so nothing renumbers.** `collect_hierarchy`
/// numbers the ordinary members 0..n and then `closure_slot`, `erased_call_slot`,
/// `raising_call_slot` and `generator_slot` from `table_size()`; inserting a key in the
/// middle would move every index after it and the four uniform slots with them, which is
/// the renumbering the JVM lane asked to be warned about when `raising_call_slot` moved
/// `generator_slot`. Numbering from the current `table_size()` upward moves nothing, and
/// `table_size()` stays correct because the new keys occupy the indices above the four.
///
/// **Here rather than in `raising_copies`**, for the reason `closures_carry` is here:
/// overriding is a fact about the hierarchy and that function has none -- it runs before
/// `collect_hierarchy`'s answer exists and is asked by things that have no hierarchy
/// either. And as *one* function rather than two, because "this family dispatches
/// raising" and "every member of it has a copy" are one decision: two functions that
/// had to agree about the family is the shape this file has four defects from.
///
/// Sorted, so one compiler on one input numbers them one way.
pub(super) fn raising_member_slots(
    snapshot: &LoweringSnapshot<'_>,
    hierarchy: &mut Hierarchy,
    naming: &mut Naming,
) {
    let probe = FuncBuilder::probe(snapshot);
    // The `(root, key)` families a `try` already reaches: a member with a copy, whose
    // dispatch is virtual. `raising_copies` seeds from the callee the *checker*
    // resolved, which for a virtual call is always the declaration the receiver's
    // static type names -- so this set holds the bases, never the overriders.
    let mut families: Vec<(TypeId, MemberKey)> = Vec::new();
    for member in &naming.raising {
        let Some(key) = member_dispatch_key(&probe, *member) else {
            continue;
        };
        let Some(ty) = probe
            .enclosing_class(*member)
            .and_then(|class| instance_type_of(snapshot, class))
        else {
            continue;
        };
        let Some(root) = hierarchy.root_declaring(ty, &key) else {
            continue;
        };
        if hierarchy.overridden(root, &key) && !families.contains(&(root, key.clone())) {
            families.push((root, key));
        }
    }
    // **And the families a `try` reaches through an INTERFACE**, which the loop above
    // cannot find: `raising_copies` seeds from the callee the checker resolved, and for
    // `sink.take(n)` that is a body-less `MethodSignature` -- so no member of the family
    // is in `naming.raising` and there is nothing to work back from. The receiver's type
    // is what names the root ([`interface_member_of`]), and the implementors are what the
    // call reaches.
    //
    // An interface member is a dispatch root exactly as a base class's member is, and the
    // rest of this function never asked which: the carry condition, the numbering and the
    // per-class fill are the same three answers. So this is a second **seed**, not a
    // second mechanism -- which is why it is six lines rather than a sibling of
    // `raising_member_slots`.
    //
    // `blockers/a-try-around-a-call-on-an-interface-typed-receiver` is the witness, and
    // `runtime/node/timers`' `processImmediate` is why it matters: `9bd3eb1fc` made that
    // `try` refuse rather than lose a `throw`, and refusing it means the immediate queue
    // does not run compiled at all.
    // A raising copy propagates through every call in its body, even when
    // only its caller is inside a try. Closure variants need the same slots.
    // Naming publishes the bodies it actually offers, including the gate's
    // strict arm, rather than numbering unused families from every declaration.
    for call in naming
        .guarded_calls
        .iter()
        .chain(&naming.raising_body_calls)
    {
        for method in naming.iterators.at(*call) {
            if method.can_raise(&naming.throwing)
                && let Some(root) = hierarchy.root_declaring(method.receiver, &method.key)
                && hierarchy.overridden(root, &method.key)
            {
                families.push((root, method.key.clone()));
            }
        }
        let access_families: Vec<_> = hierarchy.access_families.at(*call).collect();
        if !access_families.is_empty() {
            for family in access_families {
                families.push((family.face, family.key(false)));
                if family.writes.is_some() {
                    families.push((family.face, family.key(true)));
                }
            }
            continue;
        }
        let Some((root, key)) = interface_member_of(snapshot, &probe, hierarchy, *call) else {
            continue;
        };
        if hierarchy.overridden(root, &key) && !families.contains(&(root, key.clone())) {
            families.push((root, key));
        }
    }
    families.sort_by(|a, b| a.0.0.cmp(&b.0.0).then_with(|| a.1.cmp(&b.1)));
    families.dedup();
    for (root, key) in families {
        let members = members_filling(snapshot, &probe, hierarchy, root, &key);
        // Every one of them, or the slot is not numbered. `copyable` says a copy can be
        // built and everything it calls has one; a member that cannot raise needs none.
        let withholders: Vec<String> = members
            .iter()
            .filter(|member| {
                !naming.copyable.contains(member)
                    && a_declaration_that_can_raise(snapshot, &naming.throwing, **member)
            })
            .map(|member| {
                let owner = probe
                    .enclosing_class(*member)
                    .and_then(|class| instance_type_of(snapshot, class))
                    .and_then(|ty| hierarchy.name.get(&ty).cloned())
                    .unwrap_or_else(|| "an unnamed class".to_owned());
                format!("{owner}#{}", key.emitted_name())
            })
            .collect();
        // **Which members withheld it**, so the refusal at the call site can say so --
        // `filter` rather than `all` for exactly that, over the same predicate.
        //
        // **All of them counted, not just the first.** Naming one of three would send a reader
        // to fix it and leave the slot withheld, which is a sentence that is true and
        // misleading at once. See [`Naming::withheld`].
        if !withholders.is_empty() {
            naming.withheld.insert((root, key.clone()), withholders);
            continue;
        }
        let raising_key = (root, key.clone(), true);
        if hierarchy.slots.contains_key(&raising_key) {
            continue;
        }
        let at = u32::try_from(hierarchy.table_size()).unwrap_or(u32::MAX);
        hierarchy.slots.insert(raising_key, at);
        for member in members {
            if naming.copyable.contains(&member) {
                naming.raising.insert(member);
            }
        }
    }
}

/// Whether a declaration can raise, which [`Throwing::any`] answers **by symbol**
/// because a declaration node carries none of its own.
///
/// One spelling, two readers: this and [`what_holds_the_gate_off`]'s wrapper arm,
/// which asked the same question of the same set with the same scan written out.
pub(super) fn a_declaration_that_can_raise(
    snapshot: &SemanticSnapshot,
    raises: &rustc_hash::FxHashSet<u32>,
    declaration: NodeId,
) -> bool {
    snapshot
        .symbols
        .iter()
        .position(|record| record.declarations.contains(&declaration))
        .and_then(|at| u32::try_from(at).ok())
        .is_some_and(|symbol| raises.contains(&symbol))
}

/// The greatest fixpoint [`Throwing::copyable`] describes.
///
/// Optimistic -- every raiser this compiler could copy at all -- and then
/// shrunk by removing any that reaches a raiser which is not itself in the set.
/// A function that only *passes a throw on* belongs here, provided what it
/// passes on from does, which is why the start is `raises` rather than
/// `throws`.
///
/// **An unresolved callee no longer costs the copy**, which is the same change
/// `a_copy_can_contain` records at the node level and for the same reason: inside
/// a raising copy a call through a function value names
/// `Hierarchy::raising_call_slot` and is followed by the flag test, so what it
/// reaches not being knowable is no longer a reason the copy cannot carry it. The
/// two are one decision asked twice -- once of a symbol here, once of a call there
/// -- and they have to give one answer or a `try` names a copy that was never
/// made.
///
/// **And a callee held in a value no longer costs it either**, for the same
/// reason one level down. `const reconcileChildFibers: ChildReconciler = (…) =>
/// …` is a name declaring a value that holds a closure, and the call site's own
/// rule ([`a_value_held_call`]) carries a call through it at the raising slot.
/// Here it was a raiser no copy can be made of, so every caller lost its copy:
/// React's whole render path, and the raising gate with it, which is what took
/// every native React program's `main`. Where the gate is off after all, the
/// strict node-level pass ([`eligible_declarations`]) still refuses the call, so
/// being optimistic here costs nothing.
pub(super) fn copyable_symbols(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    raises: &rustc_hash::FxHashSet<u32>,
    calls: &rustc_hash::FxHashMap<u32, Vec<Reached>>,
) -> (rustc_hash::FxHashSet<u32>, rustc_hash::FxHashMap<u32, u32>) {
    let mut copyable: rustc_hash::FxHashSet<u32> = raises
        .iter()
        .filter(|symbol| can_be_copied(snapshot, probe, **symbol))
        .copied()
        .collect();
    let mut uncopied_for = rustc_hash::FxHashMap::default();
    loop {
        let losing: Vec<(u32, u32)> = copyable
            .iter()
            .filter_map(|symbol| {
                calls.get(symbol)?.iter().find_map(|called| {
                    if matches!(called, Reached::Printer(_)) {
                        return None;
                    }
                    called
                        .body()
                        .filter(|called| {
                            raises.contains(called)
                                && !copyable.contains(called)
                                && !a_value_held_callee(snapshot, probe, *called)
                        })
                        .map(|called| (*symbol, called))
                })
            })
            .collect();
        if losing.is_empty() {
            return (copyable, uncopied_for);
        }
        for (symbol, called) in losing {
            copyable.remove(&symbol);
            uncopied_for.insert(symbol, called);
        }
    }
}

/// Why no raising copy can be made of `symbol` at all ([`can_be_copied`]), in
/// the words that name it.
fn why_it_cannot_be_copied(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    symbol: u32,
) -> &'static str {
    let declarations: Vec<NodeId> = snapshot
        .symbols
        .get(symbol as usize)
        .map(|record| {
            record
                .declarations
                .iter()
                .map(|at| the_function_of(probe, *at))
                .collect()
        })
        .unwrap_or_default();
    if declarations.iter().any(|declaration| {
        let modifiers = probe.node(*declaration).modifiers;
        modifiers.contains(nts_semantic_schema::DeclarationModifiers::ASYNC)
            && !modifiers.contains(nts_semantic_schema::DeclarationModifiers::GENERATOR)
    }) {
        "is `async`, so its `throw` rejects a promise rather than raising"
    } else if declarations
        .iter()
        .any(|declaration| is_generic_function(snapshot, *declaration))
    {
        "is a generic method, which has no copy per type it is called at"
    } else {
        "is not a function, method, accessor or constructor this compiler copies"
    }
}

/// Whether a raising copy can be made of this declaration: a plain function, a
/// **method** or an **accessor**, not `async`.
///
/// A generic function has one raising form per specialization. A method with its
/// own type parameters still has no such instantiation machinery. An `async`
/// function rejects its promise rather than raising synchronously.
///
/// **How the copy is reached depends on the dispatch, and both answers exist.** A
/// member no subclass overrides is already a `Callee::Direct`, so the copy is that
/// name with the suffix -- which is why a method needed no table index when it became
/// copyable. Where the dispatch *is* virtual the copy has a slot of its own, numbered
/// by [`number_raising_member_slots`] and filled per class by
/// [`fill_raising_member_slots`]. [`FuncBuilder::callee_for`] and
/// [`FuncBuilder::accessor_callee`] are the two places that know direct from virtual,
/// so they are the two places that choose -- rather than a second derivation at the
/// `try`.
///
/// 1,060 occurrences of "a method, and a raising copy is made of plain functions
/// only" and 705 of "an accessor, which is a call", across the runtime corpora, are
/// what this is for.
///
/// **And a constructor, which was the last of them.** The sentence that stood here --
/// *"it is reached by `new`, which names no function to suffix"* -- was false:
/// `lower_new` has always spelled `Callee::Direct("{owner}#constructor")`. What was
/// missing is that a class's *symbol* declares the **class**, so both sets that ask
/// what a copy can be made of were handed a `ClassDeclaration`;
/// [`the_constructor_declared_by`] is the one mapping from the one to the other, and
/// it resolves through [`FuncBuilder::implementation_of`] because the first
/// `constructor` child of an overloaded one is a signature `lower_class` skips.
///
/// **Not of an `async` function**, which never raises: its promise exists before
/// its parameters are bound. **An `async` generator is copied**, because it binds
/// its parameter patterns at the call and throws there, as a generator does
/// ([`throwing_symbols`](super::raising_reachability::throwing_symbols) puts it in the set for exactly that) -- and a copy
/// refused here left a call through it as a value, inside a `try`, refused as
/// having no raising copy.
pub(super) fn a_copy_can_be_made_of(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    declaration: NodeId,
) -> bool {
    let kind = probe.kind_of(declaration);
    let modifiers = probe.node(declaration).modifiers;
    matches!(
        kind,
        Some(
            syntax::FUNCTION_DECLARATION
                | syntax::METHOD_DECLARATION
                | syntax::GET_ACCESSOR
                | syntax::SET_ACCESSOR
                | syntax::CONSTRUCTOR
        )
    ) && (!is_generic_function(snapshot, declaration) || kind == Some(syntax::FUNCTION_DECLARATION))
        && (!modifiers.contains(nts_semantic_schema::DeclarationModifiers::ASYNC)
            || modifiers.contains(nts_semantic_schema::DeclarationModifiers::GENERATOR))
}

/// Whether a symbol has any declaration a copy can be made of, which is the
/// question `function_copies` asks about a callee it has only a symbol for.
fn can_be_copied(snapshot: &SemanticSnapshot, probe: &FuncBuilder, symbol: u32) -> bool {
    let Some(record) = snapshot.symbols.get(symbol as usize) else {
        return false;
    };
    // **A class's declaration is the class, and what a copy is made of is its
    // constructor** -- see [`the_constructor_declared_by`]. `throwing_symbols` gives a
    // class an entry whose meaning is construction, so a class that can raise arrives here
    // with a `ClassDeclaration` to be asked about, and asking that said no: `Constructed`
    // came out `any = true, copyable = false`, so `new Constructed(n)` inside a `try` was
    // refused however plainly its constructor threw. One mapping, two readers -- this and
    // [`eligible_declarations`] -- because the two disagreeing is a symbol the fixpoint
    // admits and the node set has no member for.
    record.declarations.iter().any(|at| {
        let declaration = the_function_of(probe, *at);
        a_copy_can_be_made_of(snapshot, probe, declaration)
            || the_constructor_declared_by(probe, declaration)
                .is_some_and(|ctor| a_copy_can_be_made_of(snapshot, probe, ctor))
    })
}

/// What a raising copy's name ends in.
///
/// Spelled once. The naming site composes it the same way a generic or a
/// structural copy's suffix is composed, through `generic_calls`, so a call
/// that names one takes the same path every other copy naming takes.
pub(super) const RAISING_SUFFIX: &str = "@raises";

/// A dispatch key split into the member the program declared and the suffix, if any:
/// `("get closed", "@raises")` for `get closed@raises`, and `("read", "")` for `read`.
///
/// **One rule with two readers**, because a raising slot is keyed under the suffixed
/// name while every answer about the member itself -- which class declares it, which
/// classes override it -- is keyed under the name the program wrote.
/// [`Hierarchy::slot_for`] strips it to find the root and [`FuncBuilder::layout_of`]
/// strips it to fill the slot and then puts it back on the emitted name. Two spellings
/// of that strip is a site naming an index the table does not carry, which is the
/// defect this file has had four of in a week.
pub(super) fn without_the_raising_suffix(member: &str) -> (&str, &str) {
    match member.strip_suffix(RAISING_SUFFIX) {
        Some(plain) => (plain, RAISING_SUFFIX),
        None => (member, ""),
    }
}

/// Why a call inside a `try` reaching a **function value** has nothing to name.
///
/// Named because three places need the same answer and they are in three passes:
/// [`FuncBuilder::reason_without_a_leaf`] gives it as a refusal,
/// [`FuncBuilder::call_within`] asks whether the raising uniform entry covers the
/// call instead, and [`FuncBuilder::dispatches_to_a_raising_entry`] asks it again at
/// the call to choose the slot -- both through [`FuncBuilder::calls_a_closure`],
/// which is where this sentence and [`A_FUNCTION_WRITTEN_AS_A_VALUE`] become one
/// question. A second spelling would let the walk that decides which calls a `try`
/// handles and the site that dispatches them disagree.
/// Why a call whose callee the checker resolves to an **arrow or a function
/// expression** had nothing to name, before the raising slot.
///
/// Distinct from [`THROUGH_A_FUNCTION_VALUE`] because the two are different facts
/// about the site -- there the callee arrived as a value the checker has no body
/// for; here it has the body and the body is a closure -- and
/// [`FuncBuilder::calls_a_closure`] is the one place that treats them as one, for
/// the one question where they are: at run time both are a closure object, and a
/// closure has a raising entry.
pub(super) const A_FUNCTION_WRITTEN_AS_A_VALUE: &str =
    "a function written as a value, which has no raising copy to call";

pub(super) const THROUGH_A_FUNCTION_VALUE: &str =
    "through a function value, which has no raising copy to call";

/// The declarations a [raising copy](FuncBuilder::raises) is emitted for.
///
/// A plain function whose every `throw` is its own and which calls nothing that
/// can raise -- `Throwing::self_contained` -- and which a copy can be made of
/// at all. `function_copies` is consulted for `FUNCTION_DECLARATION`s, so a
/// method, a constructor or an accessor is outside this and keeps the refusal;
/// `an-interface-reached-by-six-routes` records the same boundary for the other
/// copy kinds, and it is the same line of code drawing it.
///
/// Methods with their own type parameters are excluded until their instantiations
/// can be copied, and `async` functions because a `throw` in one rejects its promise.
///
/// **Only for a callee some `try` in the program actually calls.** "Every
/// qualifying function, and let `hir::dce` drop the rest" was the first version
/// and it is wrong twice over: a copy is a *body*, so one that is never named
/// is lowered, and every refusal in it is reported a second time. Over 25
/// `runtime/node` modules that was **+273 NTS1001 occurrences and +400
/// NTS1003** against zero change in definitions -- noise that reads exactly
/// like a regression, sitting above the gate's ceiling.
///
/// Reachability is a syntactic question and it is answerable here: a `try`
/// statement's body, the calls in it, the declarations those resolve to. The
/// same question `lower_try` asks per function, asked once for the program, and
/// the two agree because both start from [`a_raising_callee_of`].
/// Which declaration a call's raising copy is made of.
///
/// **`call_targets` answers with the declaration the *checker* resolved, and that is
/// not always the one a copy is made of.** For an overloaded function it is an
/// overload *signature*: the lowering skips those -- `has_a_body` is the test, and
/// the comment there says "the implementation that follows is the one to lower" --
/// so `function_copies` is only ever asked about the implementation. Keyed on the
/// resolved node, the seed held the signature, nothing lowered a copy of it, and the
/// site named `f@raises` anyway:
///
/// ```ts
/// export function decode(rows: number): number;
/// export function decode(rows: string): number;
/// export function decode(rows: number | string): number { ... }
/// try { decode(n) } catch { }
/// ```
///
/// gave `` `caught` cannot be compiled because it calls `decode@raises`, which
/// nothing in this program defines `` **even where the implementation compiles** --
/// a cascade with no root, and a `try` lost for a reason no reader could act on. It
/// stood on main from `ac1533ca4`; `runtime/node/fs` showed two of them once methods
/// had copies and the surrounding bodies lowered far enough to reach them.
///
/// `raising_copies`' own doc warned about this family -- "a symbol with two
/// declarations ... answers `copyable` for one of them" -- and being keyed by node
/// is what *creates* it rather than what avoids it, because the two sides then pick
/// different nodes. One function, so they cannot.
pub(super) fn a_raising_callee_of(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    call: NodeId,
) -> Option<NodeId> {
    // **A `super(…)` names no symbol, so the checker resolves it to nothing** -- and this
    // is the one resolver every reader asks, so answering here is answering for all of
    // them. The declaration it runs is the base class's constructor, which is what
    // `throwing_symbols`' own `super` arm records (as a *symbol*, for a different
    // question) and what `lower_new` would spell for a direct construction.
    //
    // Without it, a raising copy of a subclass constructor called the base's **ordinary**
    // entry: `func Calls#constructor@raises { %2 = call Base#constructor(%0, %1) }`, with
    // no flag test, so the base's `throw` left a `try` that compiled -- 10 of 29 cases.
    // `raising_suffix_of` asks `has_a_raising_copy`, which asks this, so a `None` here is
    // silently an unsuffixed name rather than a refusal.
    if probe
        .children(call)
        .first()
        .is_some_and(|callee| probe.kind_of(*callee) == Some(syntax::SUPER_KEYWORD))
    {
        return probe
            .enclosing_class(call)
            .and_then(|class| declared_base_class(snapshot, probe, class))
            .and_then(|base| snapshot.symbols.get(base as usize))
            .and_then(|record| {
                record
                    .declarations
                    .iter()
                    .find_map(|at| the_constructor_declared_by(probe, *at))
            });
    }
    // **A `const` naming a function calls that function**, as call lowering
    // resolves it -- and the checker's own callee for `typed(x)` with `const
    // typed: (n: number) => number = apply` is the annotation's signature, a
    // declaration with no copy, so a `try` around it named the ordinary entry
    // and lost the `throw`.
    if let Some(callee) = probe.children(call).first()
        && probe.kind_of(*callee) == Some(syntax::IDENTIFIER)
        && let Some(symbol) = probe.node(*callee).symbol
        && let Some(function) = function_behind_const(probe, probe.denoted_symbol(symbol).0)
    {
        return Some(probe.implementation_of(function));
    }
    let callee = snapshot
        .call_targets
        .get(&call)
        .and_then(|target| target.callee)?;
    Some(probe.implementation_of(callee))
}

/// Which declarations a site's raising copies belong to: one for a call, and the
/// **accessor or accessors** a member access runs.
///
/// [`a_raising_callee_of`] answers for a call, which has at most one callee. An access
/// is the other shape: `c.checked` runs a `get` and `c.checked = v` runs a `set`, and
/// nothing in the syntax of the access says which of the two the member declares -- so
/// a set keyed on "the declaration a copy belongs to" has to hold both, and is asked
/// about both. `accessor_callee` is the one place that knows which kind a *given* site
/// runs, because it is the place that spells `"get "` or `"set "`, and it asks about
/// that one alone.
///
/// Over-approximating here is the safe direction and the cheap one: a copy is named
/// only by a site that reaches it, so an accessor whose other half nobody runs is a
/// body `reachable::prune` drops.
pub(super) fn raising_callees_of(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    node: NodeId,
) -> Vec<NodeId> {
    let mut callees = probe.implicit_printer_callees(node);
    callees.extend(probe.implicit_iterator_callees(node));
    if !probe.printers.at(node).is_empty() || !probe.iterators.at(node).is_empty() {
        return callees;
    }
    if let Some(callee) = a_raising_callee_of(snapshot, probe, node) {
        callees.push(callee);
    } else {
        callees.extend(probe.accessors_run_by(node));
    }
    callees.sort();
    callees.dedup();
    callees
}

/// Every declaration a raising copy *can* be made of: the greatest fixpoint of "a copy of
/// this can be built and every callee of it that can raise has one too".
///
/// By node rather than by symbol, and that is not a detail: `function_copies` is keyed on
/// the node a call resolves to, and a symbol with two declarations -- an overload
/// signature and its implementation -- answers `copyable` for one of them. A copy whose
/// callee resolved to the other would be left calling the plain function, which ends the
/// program from inside a `try` that compiled.
///
/// Shrunk over the *bodies*, which is the same greatest fixpoint [`Throwing::copyable`]
/// runs one level up and the only one that can see what a declaration actually calls.
/// Asked with the predicate `calls_compiled_code` uses, so that what a copy may contain
/// and what a `try` may contain are one rule.
///
/// `value_held_is_carried` is [`a_copy_can_contain`]'s, and it is why this is a function
/// rather than a block: [`raising_copies`] runs it **twice**, once optimistically and,
/// where the program-global gate turns out to be off, once strictly.
///
/// Also answers, for each declaration the fixpoint drops, the call that dropped
/// it: a call whose callee fell in an earlier round or never stood, so following
/// them descends to a cause of its own ([`the_cause_below_the_gate`]).
fn eligible_declarations(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    throwing: &Throwing,
    value_held_is_carried: bool,
) -> (
    rustc_hash::FxHashSet<NodeId>,
    rustc_hash::FxHashMap<NodeId, NodeId>,
) {
    let mut eligible: rustc_hash::FxHashSet<NodeId> = rustc_hash::FxHashSet::default();
    let mut dropped_by: rustc_hash::FxHashMap<NodeId, NodeId> = rustc_hash::FxHashMap::default();
    for symbol in &throwing.copyable {
        let Some(record) = snapshot.symbols.get(*symbol as usize) else {
            continue;
        };
        for declaration in &record.declarations {
            // Through `implementation_of` for the reason [`a_raising_callee_of`]
            // gives: a body-less overload signature can never be *dis*qualified by
            // the fixpoint below either, because it has no body for
            // `calls_in_the_body_of` to walk, so it would survive as a member of
            // this set that nothing ever lowers.
            let declaration = probe.implementation_of(the_function_of(probe, *declaration));
            if a_copy_can_be_made_of(snapshot, probe, declaration) {
                eligible.insert(declaration);
            }
            // **A class's symbol declares the CLASS, and the body a copy is made of is
            // its constructor.** `throwing_symbols` gives a class an entry whose meaning
            // is its *construction* -- that is how `new X()` can raise at all -- so the
            // symbol that reaches this loop is the class's, and `a_copy_can_be_made_of`
            // asked about a `ClassDeclaration` and said no. The constructor is the
            // declaration `new` names (`lower_new` spells `{owner}#constructor`) and the
            // one `raising_method` builds a copy of, so it is the one this set owes.
            if let Some(constructor) = the_constructor_declared_by(probe, declaration)
                && a_copy_can_be_made_of(snapshot, probe, constructor)
            {
                eligible.insert(constructor);
            }
        }
    }
    loop {
        let losing: Vec<(NodeId, NodeId)> = eligible
            .iter()
            .filter_map(|declaration| {
                calls_in_the_body_of(probe, *declaration)
                    .into_iter()
                    .find(|call| {
                        !a_copy_can_contain(
                            snapshot,
                            probe,
                            throwing,
                            &eligible,
                            value_held_is_carried,
                            *call,
                        )
                    })
                    .map(|call| (*declaration, call))
            })
            .collect();
        if losing.is_empty() {
            return (eligible, dropped_by);
        }
        for (declaration, call) in losing {
            eligible.remove(&declaration);
            dropped_by.insert(declaration, call);
        }
    }
}

/// What [`raising_copies`] answers: which copies to emit, which declarations one
/// *could* be made of, and whether a site may dispatch at the closure raising slot.
///
/// A struct rather than a tuple because the second field exists to be asked a question
/// the first cannot answer -- `copies` is what a `try` reached, `eligible` is what the
/// fixpoint allows -- and a tuple of two sets of `NodeId` is two chances to read the
/// wrong one.
pub(super) struct RaisingCopies {
    /// The copies to emit: `eligible` members a `try` reaches, closed over callees.
    pub(super) copies: rustc_hash::FxHashSet<NodeId>,
    /// Every declaration a copy *can* be made of, whether or not one is wanted. See
    /// [`Naming::copyable`], whose doc says who reads it and why it is published.
    ///
    /// **The set the copies were actually built from**, which matters because
    /// [`eligible_declarations`] is run twice: optimistically, and again strictly where
    /// the program-global gate turns out to be off. Publishing the optimistic one there
    /// would tell `raising_member_slots` that an overrider has a copy when none was
    /// built -- the escape `blockers/a-callback-held-in-a-field-with-the-raising-gate-off`
    /// pins, arriving by a second route. Both arms of `raising_copies` return the
    /// `eligible` in scope at their own `return`, which is the strict one in the second.
    pub(super) eligible: rustc_hash::FxHashSet<NodeId>,
    /// [`Naming::closures_carry`].
    pub(super) closures_carry: bool,
    /// [`Naming::gate_holder`].
    pub(super) gate_holder: Option<String>,
    /// [`Naming::guarded_calls`].
    pub(super) guarded_calls: rustc_hash::FxHashSet<NodeId>,
    /// [`Naming::raising_body_calls`].
    pub(super) body_calls: rustc_hash::FxHashSet<NodeId>,
}

pub(super) fn raising_copies(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    throwing: &Throwing,
) -> RaisingCopies {
    // Optimistically: a call through a value is carried by the raising uniform entry,
    // which is true wherever `what_holds_the_gate_off` is. Recomputed strictly
    // below where it is not -- see the `carry` branch.
    let (eligible, dropped_by) = eligible_declarations(snapshot, probe, throwing, true);
    // Seeded by what a `try` reaches, then closed over what those reach: a copy
    // names its callees' copies, so a callee of a copy needs one too.
    let (guarded, guarded_a_call, guarded_calls) = calls_guarded_by_a_try(snapshot, probe);
    let mut copies: rustc_hash::FxHashSet<NodeId> = guarded
        .into_iter()
        .filter(|declaration| eligible.contains(declaration))
        .collect();
    // Descriptors call printers even with no source try. Their callback must
    // always return a pending raise, leaving the language boundary to throw it.
    copies.extend(probe.printers.targets.iter().filter_map(|target| {
        (throwing.any.contains(&target.symbol) && eligible.contains(&target.declaration))
            .then_some(target.declaration)
    }));
    // **And every eligible function, where this program has a `try` around a call at
    // all.** A closure's raising variant names its callees' raising copies exactly as
    // a plain copy does, and a closure is reached through a dispatch -- so which
    // closures arrive, and therefore which callees need copies, is the question
    // `erased_call` exists because nobody at the site can answer.
    //
    // Two narrower rules were tried and both were wrong. Seeding the *closure bodies*
    // misses the closure lowering **synthesises** for a function used as a value,
    // whose body is a call to that function and which is in no `ARROW_FUNCTION` node:
    // `tests/programs/a-callbacks-throw-inside-a-try`'s `call(thrower)` arm aborted at run
    // time on every backend. Filtering those bodies by "can this raise" then shrank
    // the set a *second* question was asked of, and turned the conformance lane's
    // guard fixture from FIXED to aborted in one line.
    //
    // **It costs nothing that is not reached**, which is what makes the blunt rule
    // affordable here: a `@raises` copy is named only by a raising call site, so
    // `reachable::prune` drops every one that no such site reaches. The emitted
    // figure is 2,900 copies across the 29 corpora, and it is the same figure the
    // narrow rules produced -- they were choosing which copies to *offer*, and prune
    // was already choosing which to keep.
    if guarded_a_call {
        // A function **used as a value** is lowered as a closure whose whole body is a
        // call to it, and that closure is synthesised rather than written -- it is in
        // no `ARROW_FUNCTION` node for the walk below to reach. So the function itself
        // needs the copy: `tests/programs/a-callbacks-throw-inside-a-try`'s `call(thrower)`
        // arm aborted at run time on every backend without this, while its three
        // sibling arms -- the same defect written as an arrow, an expression and a
        // held arrow -- were fine, because those bodies *are* nodes.
        copies.extend(functions_used_as_values(snapshot, probe, &eligible));
    }
    let mut pending: Vec<NodeId> = Vec::new();
    if guarded_a_call {
        // **And every closure body that can raise.** A closure's raising variant names
        // its callees' raising copies exactly as a plain copy does -- `raises` is one
        // flag and does not care which kind of body it is lowering -- and a closure is
        // in no `copies` set for the walk below to start from.
        //
        // `attempt(() => { f(); })` with `f` throwing is the shape, and it **escaped
        // the handler and ended the program** while `attempt(() => { throw … })`
        // beside it was caught: the variant called `f` through its plain entry, so the
        // `throw` never reached the flag the test after the dispatch was watching. The
        // conformance lane recorded it as `outcomes/a-throw-one-call-below-a-function-
        // value` before it was built, against test262's
        // `classelementname-abrupt-completion`.
        //
        // Only bodies that can raise, because only those get a variant that *differs*
        // -- where it does not, `declare_raising_entries` names the ordinary entry and
        // nothing ever names a copy of what the body calls. Copying every eligible
        // function instead was measured and is much worse: **+1,341 refusals** across
        // the 29 corpora, because a copy is a body and each one that cannot compile
        // reports its own cascade.
        pending.extend(closure_bodies_that_can_raise(snapshot, probe, throwing));
    }
    // The closure bodies are roots for the walk without being copies themselves: a
    // closure is not a `FUNCTION_DECLARATION` and `function_copies` is not what makes
    // it, so what it *calls* needs a copy and it does not.
    for root in &pending {
        for call in calls_in_the_body_of(probe, *root) {
            for callee in raising_callees_of(snapshot, probe, call) {
                if eligible.contains(&callee) {
                    copies.insert(callee);
                }
            }
        }
    }
    let copies = close_over_callees(snapshot, probe, &eligible, copies);
    // **And whether every raising body this program would build can carry what it
    // calls**, which decides whether a call inside a `try` may dispatch at the
    // raising slot at all. See `what_holds_the_gate_off`.
    let Some((holder, call)) = what_holds_the_gate_off(snapshot, probe, throwing, &copies) else {
        let body_calls = raising_body_calls(probe, &copies, &pending);
        return RaisingCopies {
            copies,
            eligible,
            closures_carry: true,
            gate_holder: None,
            guarded_calls,
            body_calls,
        };
    };
    let gate_holder = Some(describe_gate_holder(
        probe,
        holder,
        call,
        &the_cause_below_the_gate(probe, throwing, (&eligible, &dropped_by, &copies), call),
    ));
    // **Where it is off, the extra seeds are dropped with it.** They exist to serve
    // the raising variant of a *closure*, and no closure gets one when no site can
    // dispatch at the slot -- so keeping them would emit thousands of `@raises`
    // copies nothing reaches. What stays is the seed a *named* callee's copy needs,
    // which is the path that worked before any of this.
    //
    // **And the eligibility is recomputed strictly**, which is the half this branch was
    // missing. With no raising uniform entry to dispatch at, a copy holding a call
    // through a **value** -- a field, a parameter, a capture -- has nothing to carry the
    // raise: it goes out at the ordinary entry, whose body calls `nts_uncaught`. That is
    // the escape `blockers/a-callback-held-in-a-field-with-the-raising-gate-off` pins --
    // 8 of 29 cases ending the program where node answers `-1` -- and it was silent
    // because the optimistic answer was the only one this function ever computed. With
    // the gate *on* the same program is
    // `tests/programs/a-method-that-calls-a-callback-held-in-a-field-inside-a-try` and agrees
    // with node, which is why the two halves are two fixtures.
    //
    // Two passes rather than a fixpoint over the gate, because the gate is monotone in
    // one direction only: turning it off can never make a body *more* carriable, so the
    // strict set is a subset of the optimistic one and a third pass would find nothing.
    let (eligible, _) = eligible_declarations(snapshot, probe, throwing, false);
    let mut narrow: rustc_hash::FxHashSet<NodeId> = calls_guarded_by_a_try(snapshot, probe)
        .0
        .into_iter()
        .filter(|declaration| eligible.contains(declaration))
        .collect();
    narrow.extend(probe.printers.targets.iter().filter_map(|target| {
        (throwing.any.contains(&target.symbol) && eligible.contains(&target.declaration))
            .then_some(target.declaration)
    }));
    let copies = close_over_callees(snapshot, probe, &eligible, narrow);
    let body_calls = raising_body_calls(probe, &copies, &[]);
    RaisingCopies {
        copies,
        eligible,
        closures_carry: false,
        gate_holder,
        guarded_calls,
        body_calls,
    }
}

/// Whether every body this program would lower with [`FuncBuilder::raises`] can carry
/// the raises that cross it.
///
/// **Program-global, and it has to be, because a site knowing only a signature cannot
/// know which closure arrives** -- the sentence `erased_call` exists for. So the
/// question is asked of every closure at once and the answer gates the site.
///
/// Two kinds of body, and the second was missed once: an arrow or a function
/// expression, whose calls are nodes; and the wrapper lowering **synthesises** for a
/// function used as a value, which is in no `ARROW_FUNCTION` node and whose one call
/// is that function. `a_copy_can_contain` answers both, asked with the copies that
/// exist rather than with the eligible set -- "the copy it would name exists" is that
/// predicate's own sentence, and a closure has no later fixpoint to shrink.
///
/// **The alternative was measured and rejected.** Letting a non-carrying closure take
/// an entry that aborts by name gives **1,675 reachable aborts across 22 of the 29
/// runtime corpora** -- a compile-time refusal traded for a run-time crash, at scale,
/// which is the direction this work must not move in whatever `refuses_to_cross`'
/// precedent says at 0. With the gate, no site dispatches where any body cannot
/// carry, so those entries are unreachable by construction and the refusal stands.
///
/// What makes a body unable to carry today is almost always a **method** or an
/// **accessor**, which have no raising copies: 1,060 and 631 occurrences of exactly
/// that refusal across the corpora. Covering those is what turns this gate on for
/// `runtime/node`, and it is the next piece of the same work.
pub(super) fn what_holds_the_gate_off(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    throwing: &Throwing,
    copies: &rustc_hash::FxHashSet<NodeId>,
) -> Option<(NodeId, NodeId)> {
    // **A closure callee is carried by the closure it names**, which is why this is a
    // different predicate from the one `eligible` is shrunk with. Every closure body
    // in the program is in the conjunction below, so accepting one here discharges
    // itself: if all of them carry, the inner one does. A greatest fixpoint, the same
    // shape `Throwing::copyable`'s doc argues for, and the reason a *plain* copy may
    // not have this arm -- `a_copy_can_contain` stays strict there, because a plain
    // function is eligible whether or not the gate is on and a copy naming an entry
    // the gate withheld would dangle.
    // The first call a body cannot carry, rather than whether there is one: the
    // answer is also the refusal's cause, and a lane reducing it needs its name.
    let uncarried = |body: NodeId| {
        calls_in_the_body_of(probe, body).into_iter().find(|call| {
            !a_copy_can_contain(snapshot, probe, throwing, copies, true, *call)
                && !a_closure_callee(snapshot, probe, *call)
        })
    };
    let written = snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| {
            matches!(
                node.kind,
                NodeKind::Syntax(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION)
            )
        })
        .map(|(index, _)| NodeId(u32::try_from(index).unwrap_or(u32::MAX)))
        .find_map(|body| uncarried(body).map(|call| (body, call)));
    if written.is_some() {
        return written;
    }
    // A wrapper's one call is the function it stands for, so it carries exactly when
    // that function has a copy -- or cannot raise, which `throwing` answers through
    // the declaration list because a declaration node carries no symbol of its own.
    functions_used_as_values(snapshot, probe, &wrappable_functions(snapshot, probe))
        .into_iter()
        .find(|declaration| {
            let raises = snapshot
                .symbols
                .iter()
                .position(|record| record.declarations.contains(declaration))
                .and_then(|at| u32::try_from(at).ok())
                .is_some_and(|symbol| throwing.any.contains(&symbol));
            raises && !copies.contains(declaration)
        })
        .map(|declaration| (declaration, declaration))
}

/// Why the call holding the gate off cannot be carried, **as though the gate
/// were on**: the cause the gate's own refusals hide.
///
/// With the gate off, every body that calls through a function value loses its
/// copy, and each refusal it causes names that call -- "`callback`, through a
/// function value" -- as its leaf. That is the gate's symptom, not its cause: a
/// lane following the chain went round it, from `flushMutationEffects` back to
/// the closure holding the gate. So this walks the *optimistic* fixpoint, the
/// one where a value-held call is carried, down from the callee: each step is
/// the first call its declaration could not contain there, and the walk ends at
/// a call that fails for its own reason. Empty where nothing can be said.
fn the_cause_below_the_gate(
    probe: &FuncBuilder,
    throwing: &Throwing,
    (eligible, dropped_by, copies): (
        &rustc_hash::FxHashSet<NodeId>,
        &rustc_hash::FxHashMap<NodeId, NodeId>,
        &rustc_hash::FxHashSet<NodeId>,
    ),
    call: NodeId,
) -> String {
    let named = |at: NodeId| {
        probe
            .children(at)
            .into_iter()
            .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|name| {
                probe
                    .node(name)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| "a function".to_owned())
    };
    let callee_of = |call: NodeId| {
        probe
            .snapshot
            .call_targets
            .get(&call)
            .and_then(|target| target.callee)
            .map(|declaration| probe.implementation_of(the_function_of(probe, declaration)))
    };
    // A function used as a value holds the gate as itself (`holder == call`
    // in `what_holds_the_gate_off`), so the walk starts at it.
    let start = callee_of(call).or_else(|| {
        (probe.kind_of(call) == Some(syntax::FUNCTION_DECLARATION))
            .then(|| probe.implementation_of(call))
    });
    let Some(mut declaration) = start else {
        return String::new();
    };
    // Eligible, and still not copied: nothing below it is the cause, and the
    // seeding that should have reached it is.
    if eligible.contains(&declaration) {
        return if copies.contains(&declaration) {
            String::new()
        } else {
            format!(
                ": `{}` could have a raising copy and none was made",
                named(declaration)
            )
        };
    }
    // Each step is the call that dropped the declaration, whose callee fell in
    // an earlier round or never stood: the walk descends, and ends at a call
    // that fails for its own reason. `seen` only guards that argument.
    let mut path = Vec::new();
    let mut seen = rustc_hash::FxHashSet::default();
    while seen.insert(declaration) {
        let Some(&dropping) = dropped_by.get(&declaration) else {
            // Never in the node-level running: its symbol was dropped one level
            // up, for a raising callee by symbol, and that chain ends at one no
            // copy can be made of at all.
            return format!(
                "{}{}",
                via(&path),
                the_symbol_cause(probe, throwing, declaration, &named)
            );
        };
        path.push(named(declaration));
        match (probe.reason_without_a_leaf(dropping), callee_of(dropping)) {
            (None, Some(next)) if !eligible.contains(&next) => declaration = next,
            (why, _) => {
                let why = why.unwrap_or("its callee cannot be copied");
                return format!(
                    "{}: in `{}`, a call that cannot be carried: {why}",
                    via(&path[..path.len() - 1]),
                    named(declaration)
                );
            }
        }
    }
    format!("{}: the calls that dropped them form a cycle", via(&path))
}

/// Why `declaration`'s symbol is not copyable, followed down
/// [`Throwing::uncopied_for`] to a symbol no copy can be made of.
fn the_symbol_cause(
    probe: &FuncBuilder,
    throwing: &Throwing,
    declaration: NodeId,
    named: &dyn Fn(NodeId) -> String,
) -> String {
    let snapshot = probe.snapshot;
    let symbol_of = |declaration: NodeId| {
        snapshot
            .symbols
            .iter()
            .position(|record| record.declarations.contains(&declaration))
            .and_then(|at| u32::try_from(at).ok())
    };
    let name_of = |symbol: u32| {
        snapshot
            .symbols
            .get(symbol as usize)
            .map_or_else(|| "a function".to_owned(), |record| record.name.to_string())
    };
    let Some(mut symbol) = symbol_of(declaration) else {
        return format!(
            ": `{}` cannot have a raising copy made of it",
            named(declaration)
        );
    };
    let mut path = vec![name_of(symbol)];
    let mut seen = rustc_hash::FxHashSet::default();
    while seen.insert(symbol) {
        if let Some(&called) = throwing.uncopied_for.get(&symbol) {
            symbol = called;
            path.push(name_of(symbol));
        } else {
            let last = path.pop().unwrap_or_default();
            let why = if throwing.copyable.contains(&symbol) {
                "can be copied, and its copy is not one this body may name"
            } else {
                why_it_cannot_be_copied(snapshot, probe, symbol)
            };
            return format!("{}: `{last}` {why}", via(&path));
        }
    }
    format!("{}: the raisers that dropped them form a cycle", via(&path))
}

/// The declarations a cause was reached through, for the sentence.
fn via(path: &[String]) -> String {
    if path.is_empty() {
        String::new()
    } else {
        format!(
            ", through {}",
            path.iter()
                .map(|name| format!("`{name}`"))
                .collect::<Vec<_>>()
                .join(" -> ")
        )
    }
}

/// The sentence a refusal gives for a program whose raising gate is off: which
/// closure holds it off, and the call that does -- the names in backticks, so a
/// census grouping by message still sees one row -- then, after them, what
/// holds that call off even with the gate on ([`the_cause_below_the_gate`]). A
/// closure has no name of its own, so it is named by the function it is
/// written in; a function used as a value whose copy was not made
/// (`holder == call`) is named itself.
pub(super) fn describe_gate_holder(
    probe: &FuncBuilder,
    holder: NodeId,
    call: NodeId,
    cause: &str,
) -> String {
    let named = |at: NodeId| {
        probe
            .children(at)
            .into_iter()
            .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|name| {
                probe
                    .node(name)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
            })
    };
    if holder == call {
        let name = named(holder).unwrap_or_else(|| "a function".to_owned());
        return format!(
            "`{name}` is used as a value and can throw, and has no raising copy{cause}"
        );
    }
    let within = std::iter::successors(probe.node(holder).parent, |at| probe.node(*at).parent)
        .filter(|at| {
            names_a_body(probe.kind_of(*at)) || probe.kind_of(*at) == Some(syntax::CONSTRUCTOR)
        })
        .find_map(named)
        .map_or_else(|| "module scope".to_owned(), |name| format!("`{name}`"));
    // Through a cast or a `!`, and an element read by what it reads from: its last
    // child is the index, so `queue[i]()` was once named `i`.
    let callee = probe
        .children(call)
        .first()
        .map(|callee| probe.through_assertions(*callee))
        .and_then(|callee| {
            let last_text = |at: NodeId| {
                probe.children(at).last().and_then(|last| {
                    probe
                        .node(*last)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        .map(str::to_owned)
                })
            };
            if probe.kind_of(callee) == Some(syntax::ELEMENT_ACCESS_EXPRESSION) {
                let read = probe.children(callee).first().copied()?;
                return probe
                    .node(read)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
                    .or_else(|| last_text(read))
                    .map(|name| format!("{name}[…]"));
            }
            probe
                .node(callee)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                .map(str::to_owned)
                .or_else(|| last_text(callee))
        })
        .unwrap_or_else(|| "a function value".to_owned());
    format!("a closure in {within} calls `{callee}`, whose own `throw` cannot be carried{cause}")
}

/// Every declaration that lowering turns into a **wrapper** closure when it is used
/// as a value: a named function, or a method bound to a receiver.
///
/// **An arrow or a function expression is not one**, and taking every function-shaped
/// declaration instead was wrong in the direction that matters: `const mayThrow = (x)
/// => { throw … }` used as a value *is* the closure (`ClosureSource::Authored`), so
/// its raising variant covers it and there is no `function_copies` copy to look for --
/// but it can raise and is never `eligible`, so the wrapped test failed and turned the
/// gate off for two of the three examples this change exists for. They read "agreed on
/// every case" while comparing fewer of them, which is the same trap twice in one
/// session: see [`what_holds_the_gate_off`].
fn wrappable_functions(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
) -> rustc_hash::FxHashSet<NodeId> {
    snapshot
        .nodes
        .iter()
        .enumerate()
        .map(|(index, _)| NodeId(u32::try_from(index).unwrap_or(u32::MAX)))
        .filter(|id| {
            matches!(
                probe.kind_of(*id),
                Some(syntax::FUNCTION_DECLARATION | syntax::METHOD_DECLARATION)
            )
        })
        .collect()
}

/// Whether this call's callee is an arrow or a function expression -- a closure, whose
/// raising variant `lower_wanted_closures` builds.
///
/// The free-function half of [`FuncBuilder::calls_a_closure`], for the passes that run
/// before any builder exists. It answers only the *resolved* half: an unresolved callee
/// is already carried by `a_copy_can_contain`'s own arm for it.
fn a_closure_callee(snapshot: &SemanticSnapshot, probe: &FuncBuilder, call: NodeId) -> bool {
    snapshot
        .call_targets
        .get(&call)
        .and_then(|target| target.callee)
        .is_some_and(|declaration| {
            matches!(
                probe.kind_of(declaration),
                Some(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION)
            )
        })
}

/// Whether this call reaches a function held in a **value**, which is the only kind of
/// callee a copy cannot name: there is nothing to suffix, so the raise is carried by the
/// uniform raising entry or not at all. See [`a_value_held_callee`].
///
/// **An element read is one, and names no declaration at all.** `queue[i]!()` reads a
/// function out of an array, which is a value held exactly as a field's is -- but the
/// access has no symbol, so asking for one answered "not held", the call read as one
/// no entry could carry, and the closure making it held the program-wide gate off.
/// react-gtk's idle closure drains its restore queue that way, so every native React
/// program linking it lost the gate.
///
/// **Unless the read names a method**, which an element read can: `this[kReaderFail](e)`
/// calls a method under a computed key, and its access has no symbol either. Read as a
/// value it dispatched at the raising slot instead of naming the method's copy, and 26
/// raising copies left every `runtime/node` module -- the `definitions` floor caught
/// it. So the checker's target decides: a method's declaration or signature is a
/// method call, and anything else -- the function-type annotation `queue[i]!()`
/// resolves to, an arrow, a function stored as a value -- is a value.
///
/// **And so is a call's result.** `specialFiberFor(type)!(props, mode, lanes, key)`
/// calls the function another call returned: its access has no symbol, and the
/// checker's target is the function type the first call is declared to return, a
/// node with no body. Asked as neither, the call read as one no copy could
/// contain, `createFiberFromTypeAndProps` lost its copy, and React's render path
/// held the raising gate off below it. A function a call returns is a value
/// whatever its declared type, never a method call.
pub(super) fn a_value_held_call(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    call: NodeId,
) -> bool {
    if probe.reads_an_accessor(call) {
        return false;
    }
    // `f.call(r)` and `f.apply(r, list)` dispatch at the uniform entry whatever `f`
    // is, a declaration included: it is lowered as a value first
    // ([`FuncBuilder::through_call_or_apply`]).
    if probe.through_call_or_apply(call).is_some() {
        return true;
    }
    if literal_methods::stored_call(probe, call) {
        return true;
    }
    let Some(callee) = probe
        .children(call)
        .first()
        .map(|callee| probe.through_assertions(*callee))
    else {
        return false;
    };
    match probe.node(callee).symbol {
        Some(symbol) => a_value_held_callee(snapshot, probe, probe.denoted_symbol(symbol).0),
        None if probe.kind_of(callee) == Some(syntax::CALL_EXPRESSION) => true,
        None => {
            probe.kind_of(callee) == Some(syntax::ELEMENT_ACCESS_EXPRESSION)
                && !snapshot
                    .call_targets
                    .get(&call)
                    .and_then(|target| target.callee)
                    .is_some_and(|at| {
                        matches!(
                            probe.kind_of(at),
                            Some(syntax::METHOD_DECLARATION | syntax::METHOD_SIGNATURE)
                        )
                    })
        }
    }
}

/// The raising copy of one class member, where a `try` can reach it.
///
/// Its own function because it is its own step and because `lower_class` is a loop
/// over copies and members already. See [`a_copy_can_be_made_of`] for why a method
/// needs no dispatch slot of its own.
#[allow(clippy::too_many_arguments)]
pub(super) fn raising_method(
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    shared: &Shared,
    lowered: &mut Lowered,
    class: NodeId,
    member: NodeId,
    instance: Option<TypeId>,
    substitution: &Substitution,
    sources: &crate::hir::generics::Sources,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    // **And its raising copy, where a `try` can reach it.** Lowered a
    // second time with `raises` set, named with the suffix, and
    // emitted whether or not it differs -- the same addition-not-
    // replacement `function_copies` makes for a plain function, and
    // for the same reason: the call site names one or the other and
    // cannot know which bodies happen to be identical. One nothing
    // names is dead and `hir::dce` removes it.
    //
    // Renamed after the fact rather than threaded through
    // `lower_method_of`, because the name is built from the class and
    // the member there and a second spelling of that is how this file
    // has gone wrong before. A layout's method table holds the
    // *ordinary* entry, which is what a virtual dispatch needs and what
    // this copy is deliberately not.
    //
    // **What the builder recorded under the name moves with it, and is
    // harvested as the ordinary copy's is.** It was not harvested at
    // all, and the name it recorded was the ordinary one: a generator
    // method's parameter entry (`parameter_entries::Split`) was lost, so
    // the raising copy -- the one every call inside a `try` names --
    // bound its parameters at the first `next()` instead of at the call,
    // and test262's `assert.throws` around `c.method(null)` saw nothing
    // thrown (140 recorded cases across the destructuring families).
    if !shared.naming.raising.contains(&member) {
        return;
    }
    let copy = member_copy(snapshot, instance, substitution, sources, true);
    let mut second = shared.builder(snapshot, foreign, copy);
    match second.lower_method_of(class, member, instance) {
        Ok(mut raising) => {
            let ordinary = std::mem::take(&mut raising.name);
            raising.name = format!("{ordinary}{RAISING_SUFFIX}");
            second.rename_arrivals(&ordinary, &raising.name);
            // **Unless that name is taken**, which only an *object literal* can do: two
            // literals built at one named type each declaring the member are two
            // implementations with one name, and the ordinary member is refused by name
            // for exactly that (`blockers/two-literals-at-one-interface`). Pushing the
            // copy anyway would make the program invalid HIR, which `emit-c` reports by
            // writing nothing and exiting 0 -- the worst of the failure modes. Nothing
            // is recorded here because the ordinary member's refusal already names the
            // cause, and a second sentence about one cause is the weaker of the two.
            if !lowered
                .program
                .funcs
                .iter()
                .any(|known| known.name == raising.name)
            {
                lowered.program.funcs.push(raising);
                second.harvest(wanted, &mut lowered.arrivals);
            }
        }
        // Its diagnostics are the ordinary body's a second time, under a name no
        // source wrote. The `try` that would have named this copy then calls a
        // function nothing defines -- which `a_raising_body_carries_this_call` cannot
        // see, because it is about a call inside a raising body and not about the body
        // failing to exist. So the name is recorded as uncompiled, and the cascade
        // says so.
        Err(diagnostic) => {
            if let Ok((_, name)) = second.emitted_member_name(class, member, instance) {
                lowered
                    .program
                    .uncompiled
                    .push(crate::hir::Uncompiled::refused(
                        format!("{name}{RAISING_SUFFIX}"),
                        diagnostic.message.clone(),
                    ));
            }
        }
    }
}

/// Every **member** raising slot, filled with the copy where one exists and with the
/// ordinary entry where it does not.
///
/// `layout_of` writes `{owner}#{member}@raises` into the slot while lowering, because
/// that is where a layout is demanded -- and at that moment the copies are not all built.
/// An override that *cannot* raise gets no copy, so its slot would name a function
/// nothing defines, and the JVM lane's `SHADOWED` check reports exactly that: a class
/// inheriting its ancestor's copy runs **the ancestor's body** with no
/// `NoSuchMethodError` and a happy verifier, and C calls through a null entry.
///
/// So the fallback is the ordinary entry, on the same argument
/// `declare_raising_entries` makes for a closure whose variant is the same program: a
/// body with nothing to raise cannot end anything, so running it is right and the flag
/// the caller tests is simply never set.
pub(super) fn fill_raising_member_slots(program: &mut Program) {
    // Publish the semantic slot identity before choosing each receiver's body.
    // A fallback to a quiet ordinary entry must not erase this raising bit.
    program.raising_members.clear();
    // **Derived from each layout's own ORDINARY entry, which is how
    // `declare_raising_entries` does it for the closure slot.** Three cases, and they are
    // that function's three:
    //
    //   the suffixed name is a body       fill the raising slot with it
    //   the ordinary entry is a           declare a *second* declaration under the
    //     declaration with no body          suffixed name and fill with that -- an
    //                                       interface root, whose bodies are its
    //                                       implementors'
    //   neither                           fill with the ORDINARY entry, which runs and
    //                                       never raises: right for an override that
    //                                       cannot raise
    //
    // The first draft of this read the name out of `declaring()` in `layout_of` and
    // patched it here, which is a second derivation of "whose body answers for this class"
    // -- and it failed in the way that defect always does: the root's own entry was
    // downgraded to the ordinary name, so the declaration was reachable from nothing,
    // `prune` removed it, and the backend said `NTS2006 no declaration for
    // `Sink#take@raises` to take a signature from`. Reading the layout's own entry is one
    // derivation, and it is the one the closure path has had since `ac1533ca4`.
    let raising: Vec<(usize, usize)> = program
        .member_origins
        .dispatch
        .iter()
        .filter_map(|(&slot, row)| {
            if !row.raising {
                return None;
            }
            let accessor = match row.accessor {
                crate::hir::MemberAccessor::Method => MethodAccessor::Method,
                crate::hir::MemberAccessor::Get => MethodAccessor::Get,
                crate::hir::MemberAccessor::Set => MethodAccessor::Set,
            };
            let member = MemberKey {
                key: row.key.clone(),
                accessor,
            };
            program.raising_members.insert(
                slot,
                crate::hir::RaisingMember {
                    member: member.emitted_name(),
                    ordinary_slot: row.ordinary_slot,
                },
            );
            Some((slot as usize, row.ordinary_slot? as usize))
        })
        .collect();
    if raising.is_empty() {
        return;
    }
    let made: rustc_hash::FxHashMap<&str, bool> = program
        .funcs
        .iter()
        .map(|func| (func.name.as_str(), func.abstract_declaration))
        .collect();
    let mut fill: Vec<(usize, usize, String)> = Vec::new();
    let mut declare: Vec<String> = Vec::new();
    for (at, layout) in program.layouts.iter().enumerate() {
        for (slot, ordinary_slot) in &raising {
            let Some(Some(ordinary)) = layout.methods.get(*ordinary_slot) else {
                continue;
            };
            let with_suffix = format!("{ordinary}{RAISING_SUFFIX}");
            match made.get(with_suffix.as_str()) {
                Some(_) => fill.push((at, *slot, with_suffix)),
                None if made.get(ordinary.as_str()) == Some(&true) => {
                    declare.push(with_suffix.clone());
                    fill.push((at, *slot, with_suffix));
                }
                None => fill.push((at, *slot, ordinary.clone())),
            }
        }
    }
    for (at, slot, name) in fill {
        if let Some(entry) = program.layouts[at].methods.get_mut(slot) {
            *entry = Some(name);
        }
    }
    // Sorted and deduplicated, so one compiler on one input declares them in one order.
    declare.sort();
    declare.dedup();
    for name in declare {
        let Some(from) = name.strip_suffix(RAISING_SUFFIX) else {
            continue;
        };
        let Some(ordinary) = program.funcs.iter().find(|func| func.name == from) else {
            continue;
        };
        // **Cloned and renamed, and nothing else touched** -- which is exactly what
        // `declare_raising_entries` does for the closure slot, and the reason is the
        // raising row's invariant since `ac1533ca4`: a raising copy has the same ABI as
        // the original. Deriving the signature again here would be a second answer to a
        // question the ordinary declaration already gives.
        //
        // **Clearing `blocks` and `values` is what a first draft did, and it panicked
        // `verify` in seventeen of the twenty-nine corpora**: that walk starts at
        // `func.blocks[BlockId(0)]` unconditionally, so a function with no blocks is
        // `index out of bounds: the len is 0 but the index is 0`. An abstract declaration
        // is not a function with its body removed -- it is a function whose body was never
        // there, and whichever shape that is, the original already has it. `refusal-diff`
        // is what said so, as `NOT MEASURED ... printed no prepared listing` for every one
        // of those modules, while the refusal counts and `messages` read like small
        // improvements: a module that emits nothing has no refusals to count.
        let mut copy = ordinary.clone();
        copy.name = name;
        program.funcs.push(copy);
    }
}

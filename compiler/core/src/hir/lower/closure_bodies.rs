//! Emit wanted closure bodies and raising copies, with the generated ABI names and input setup they use.

use super::{
    Absent, Arrivals, Callee, ClassCopy, ClosureInfo, ClosureSource, Copy, Diagnostic, Facts, Func,
    FuncBuilder, HirType, Layout, LayoutCollector, Lowered, LoweringSnapshot, ManagedType, NodeId,
    OpKind, Origin, Param, ParamShape, ParameterNames, RAISING_SUFFIX, Shared, Terminator, TypeId,
    ValueId, closure_index, closure_result_absent, erased_call, generic_values, json,
    lower_conversions, lower_reject_error, parameter_entries, passing_undefined, syntax,
    uniform_inputs, with_const_aliases, without_the_raising_suffix,
};

/// The type id of the `n`th closure class.
///
/// Synthetic. The checker's type for an arrow is its signature; the class that
/// carries what it captured is this compiler's own construction and needs an
/// identity to hang a layout on.
///
/// **Upward from [`crate::hir::SYNTHETIC_CLOSURES`], not downward from the top.**
/// This counted down from `u32::MAX` and the comment said "so it cannot collide
/// with anything the snapshot assigned" -- true, and not the whole question,
/// because the top of the space is not the snapshot's. It is where
/// [`super::CONSTRUCTOR_TOKENS`](crate::hir::CONSTRUCTOR_TOKENS) lives, sixteen ids at `u32::MAX - 15`, whose
/// own comment says it is placed there *"because closures are numbered upward
/// from `SYNTHETIC_CLOSURES`"*.
///
/// Two comments, each true of the other's assumption, and the code followed the
/// one that made them share sixteen ids. So a program's fifteenth closure had
/// the id of `Ctor_Error` and its fourteenth `Ctor_TypeError`, and closures
/// sixteen through thirty-one landed in [`super::PROVIDED_ERRORS`](crate::hir::PROVIDED_ERRORS).
///
/// What that looked like: `runtime/node/async_hooks` emitted
/// `nts_node_enqueue_microtask(&nts_fnval_NtsObj_Ctor_TypeError)` for a call
/// whose HIR correctly says `const closure.static`. The C did not compile,
/// which is the good outcome -- `program.layout` returned whichever of the two
/// it found first, and in a program without a type clash it would have been a
/// wrong function silently called.
///
/// The old assertion could not catch it: it checked the *floor*, which a
/// descending counter passes for half a million closures, and never the ceiling
/// it was walking into.
pub(super) fn closure_type(index: usize) -> TypeId {
    let id = crate::hir::SYNTHETIC_CLOSURES + u32::try_from(index).unwrap_or(0);
    debug_assert!(
        id < crate::hir::SYNTHETIC_CLASS_TOKENS,
        "more closures than the synthetic id space holds",
    );
    TypeId(id)
}

pub(super) fn closure_names(index: usize) -> (String, String) {
    let class = format!("Closure{index}");
    let method = format!("{class}#call");
    (class, method)
}

/// The name of the body of a closure that reads its own `this`
/// (`ClosureInfo::reads_this`). It takes the call's `this` after the closure,
/// and the closure's `#call` is a wrapper passing `undefined` to it, for the
/// callers that have no `this` to give: the C runtime, the native bridges, the
/// JVM's callback interfaces.
pub(super) fn receiving_call_name(index: usize) -> String {
    format!("Closure{index}#call_this")
}

/// The uniform slot a function-value call takes before argument admission
/// has been proved. Preparation may recover its known typed implementation.
#[derive(Clone, Copy, Debug)]
pub(super) struct ClosureEntry(pub(super) u32);

/// The name of the function a closure's body is lowered as: its written
/// `#call`, or, for one that reads its own `this`, the body taking it.
pub(super) fn closure_body_name(index: usize, reads_this: bool) -> String {
    if reads_this {
        receiving_call_name(index)
    } else {
        closure_names(index).1
    }
}

/// The name the body of a `function` declaration that reads its own `this` is
/// lowered under ([`FuncBuilder::declaration_reads_this`]): the emitted name
/// with [`RECEIVING_SUFFIX`] before any raising suffix, so a raising copy's
/// body is still named as one (`plain@this@raises`) and a wrapper's raising
/// rename of `plain@this` reaches it. The emitted name itself is the entry
/// passing `undefined` ([`passing_undefined`]).
pub(super) fn receiving_function_name(emitted: &str) -> String {
    let (plain, raising) = without_the_raising_suffix(emitted);
    format!("{plain}{RECEIVING_SUFFIX}{raising}")
}

/// See [`receiving_function_name`].
const RECEIVING_SUFFIX: &str = "@this";

/// Whether a callee is a raising copy, named directly or through its raising
/// slot. A wrapper's call is built rather than lowered from a call node, so this
/// is how its body knows to test for a raise after it.
pub(super) fn names_a_raising_copy(callee: &Callee) -> bool {
    match callee {
        Callee::Direct(name) => name.ends_with(RAISING_SUFFIX),
        Callee::Virtual { declared, .. } => declared.ends_with(RAISING_SUFFIX),
        _ => false,
    }
}

/// The name of a closure's erased entry. See [`Hierarchy::erased_call_slot`](super::Hierarchy::erased_call_slot).
pub(super) fn erased_call_name(index: usize) -> String {
    format!("Closure{index}#erased_call")
}

/// The name of a closure's **raising** body and erased entry, for a call inside a
/// `try` that reaches it through a function value.
///
/// `RAISING_SUFFIX` is the one a plain function's raising copy already carries, so
/// the two kinds of copy are recognisable by one string rather than by two.
fn raising_closure_names(index: usize) -> (String, String) {
    (
        format!("Closure{index}#call{RAISING_SUFFIX}"),
        format!("Closure{index}#erased_call{RAISING_SUFFIX}"),
    )
}

/// Whether two bodies are the same program, ignoring where their ops came from.
///
/// **The criterion for emitting a raising copy of a closure at all.** A raising body
/// differs from the ordinary one only where an uncaught `throw` would end the
/// program, and measured over four runtime modules that is **2% of closures** -- 5 of
/// 81 in `assert`, 9 of 378 in `fs`, 5 of 298 in `http`, 5 of 202 in `stream`. Every
/// other closure's two bodies are the same program, and its ordinary entry can serve
/// the raising slot because nothing in it ends anything.
///
/// So the set is found by *building both and comparing*, not by a second fixpoint
/// over closure bodies. A predicate would be a third derivation of "can this raise"
/// beside `Throwing::any` and `Throwing::copyable`, and it would have to answer for
/// an inline arrow, which has no symbol for those to be keyed on.
///
/// Origins are excluded deliberately: they carry a span, and two bodies that run the
/// same ops in the same order are interchangeable whatever they point at.
fn the_same_program(left: &Func, right: &Func) -> bool {
    left.values.len() == right.values.len()
        && left.blocks.len() == right.blocks.len()
        && left
            .values
            .iter()
            .zip(&right.values)
            .all(|(a, b)| a.kind == b.kind && a.ty == b.ty)
        && left
            .blocks
            .iter()
            .zip(&right.blocks)
            .all(|(a, b)| a.terminator == b.terminator && a.ops == b.ops && a.params == b.params)
}

/// The class name behind a synthetic closure type id.
///
/// The inverse of [`closure_type`], for the passes that meet the id rather than
/// the arrow it came from.
#[must_use]
pub fn closure_class(ty: TypeId) -> String {
    closure_names(closure_index(ty)).0
}

/// The one method a closure class implements.
#[must_use]
pub fn closure_method(ty: TypeId) -> String {
    closure_names(closure_index(ty)).1
}

/// The same class's erased entry, for a pass that meets a call already made in
/// the uniform ABI. See [`Hierarchy::erased_call_slot`](super::Hierarchy::erased_call_slot).
#[must_use]
pub fn closure_erased_method(ty: TypeId) -> String {
    erased_call_name(closure_index(ty))
}

/// Lower every closure a function body asked for, and every closure those
/// ask for in turn, each once.
///
/// In the context of the copy it is a variant for, so the calls in its body
/// name what the copy's do -- and, for the closure as written, in the
/// original's, which every function body gets from `Shared::builder` and
/// closure bodies did not until the variants needed it. A closure body is a
/// function like any other and takes the whole of the naming; this site used
/// to take two of its four fields, see `wire_naming`, which `Shared::builder`
/// calls.
#[expect(
    clippy::too_many_lines,
    reason = "keep closure lowering and both ABI entries together"
)]
pub(super) fn lower_wanted_closures(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    shared: &Shared,
    closures: &[ClosureInfo],
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    let mut done: rustc_hash::FxHashSet<usize> = rustc_hash::FxHashSet::default();
    while let Some(index) = wanted.iter().copied().find(|at| !done.contains(at)) {
        done.insert(index);
        let within = closures[index].within_copy.as_ref();
        // **One description of the copy a closure's builder gets**, because the
        // raising variant below needs the same one with a single flag flipped and a
        // second spelling of it would drift: the substitution, the instance, the
        // sources and the declaration all have reasons stated here, and a copy that
        // had four of the five would read a capture at the wrong type.
        let copy_for = |raises: bool| Copy {
            suffix: closures[index].within.clone().unwrap_or_default(),
            // **Under the enclosing copy's substitution, where the closure is one of
            // a generic's.** Without it the body reads a capture at the
            // declaration's type while the copy stored the instantiation's, which
            // reaches C as an assignment between two structs.
            substitution: within
                .map(|copy| copy.substitution.clone())
                .unwrap_or_default(),
            instance: within.and_then(|copy| copy.instance),
            sources: within.map(|copy| copy.sources.clone()).unwrap_or_default(),
            // And the calls this closure makes name what the enclosing copy's do,
            // which for a generic function is keyed by the declaration and this
            // suffix together.
            declaration: within.and_then(ClassCopy::function),
            raises,
            ..Copy::default()
        };
        let aliases = || closure_aliases(snapshot, closures, index);
        let mut builder = shared.builder(snapshot, foreign, copy_for(false));
        builder.retyped_symbols = aliases();
        // A job or a resolving function has a body the compiler makes; every
        // other closure has one the program wrote.
        let made = generic_values::lower(
            &mut builder,
            index,
            &closures[index],
            &shared.generics,
            &lowered.program.funcs,
        )
        .or_else(|| builder.lower_made_closure(index, &closures[index]));
        match made.unwrap_or_else(|| builder.lower_closure(index, &closures[index])) {
            Ok(func) => {
                // The erased entry beside the body it wraps, built here because
                // this is the moment the body's own parameter and return types
                // exist: `coerce_arm` saw the slot and not the closure, and this
                // sees the closure and not the slot. See [`erased_call`].
                let inputs = builder.uniform_input_plan(&func, &closures[index]);
                let mut entry = inputs
                    .needed
                    .then(|| shared.builder(snapshot, foreign, copy_for(false)));
                if let Some(entry) = &mut entry {
                    entry.retyped_symbols = aliases();
                }
                if let Some(adapter) = erased_call(
                    erased_call_name(index),
                    &func,
                    shared.hierarchy.erased_call_arity,
                    None,
                    closure_result_absent(snapshot, closures[index].node, &func.return_type),
                    closures[index].reads_this,
                    entry
                        .as_mut()
                        .map(|entry| (entry, &closures[index], &inputs)),
                ) {
                    lowered.program.funcs.push(adapter);
                }
                if let Some(mut entry) = entry {
                    entry.harvest(wanted, &mut lowered.arrivals);
                    layout_collector.collect(&mut lowered.program, entry.layouts.into_layouts());
                }
                // **And the raising variant, where it is a different program.**
                // A call inside a `try` that reaches a closure through a function
                // value has nothing to name: a raising copy is made of plain
                // functions, and a closure's body is not one. So the body is lowered
                // a second time with `raises` set -- an uncaught `throw` then records
                // and returns rather than ending the program -- and `erased_call`
                // builds its entry from it exactly as it does for the ordinary one.
                //
                // Its own function because it is its own step, and because it is the
                // half with three outcomes in it.
                //
                // **And only where a site can dispatch at the slot.** With the gate
                // off nothing names these, and building them anyway emitted 1,675
                // abort shells and thousands of `@raises` bodies across the corpora
                // for a slot no call reaches. See `what_holds_the_gate_off`.
                lowered.program.funcs.push(func);
                let (raising, layouts) = raising_closure(
                    snapshot,
                    foreign,
                    shared,
                    closures,
                    index,
                    copy_for(true),
                    ClosureOutput {
                        kernels: &lowered.program.funcs,
                        inputs: &inputs,
                        wanted,
                        arrivals: &mut lowered.arrivals,
                    },
                );
                layout_collector.collect(&mut lowered.program, layouts);
                // **Pushed before the ordinary body, as they always were.** The
                // raising entry is built with the body last in `kernels`, and
                // then they go in front of it: a generator closure's two copies
                // share one generator class with one resume, and the first copy
                // `suspend` meets decides which (see the plan's note on giving
                // each copy its own class). Body first made the shared resume the
                // ordinary one, and a throw from a generator step inside a `try`
                // (17 test262 `...-elision-step-err` cases) aborted uncaught.
                let body = lowered.program.funcs.pop().expect("the body just pushed");
                lowered.program.funcs.extend(raising);
                // A body that takes the call's `this` is not the written
                // `#call`, which every caller with no `this` to give reaches by
                // its slot. That one passes `undefined`.
                if closures[index].reads_this {
                    let (_, written) = closure_names(index);
                    lowered
                        .program
                        .receiving
                        .insert(written.clone(), body.name.clone());
                    lowered.program.funcs.push(passing_undefined(
                        written,
                        &body,
                        crate::hir::UNIFORM_THIS,
                    ));
                }
                lowered.program.funcs.push(body);
            }
            // **A refused closure had no line of its own.** `uncompiled` is keyed
            // by a *declared* name and an arrow has none, so every cascade ending
            // in "it calls `Closure1#call`, which was refused above" had nothing
            // above: the diagnostic naming the cause is attributed to a source
            // position, and `nts refusals` -- a name-per-line view of
            // `uncompiled` -- drops it entirely.
            //
            // The React lane's reducer chain reads exactly that way, and so does
            // every other chain that ends in a closure's `#call`. It is the same
            // hole `f3df349a` closed one mechanism over: a cascade is only worth
            // printing if its last link names something a reader can look up.
            //
            // Under `closure_names`' own answer rather than a second spelling of
            // it, which is also the name the *caller's* cascade prints -- so the
            // two sides agree by construction rather than by coincidence.
            Err(diagnostic) => {
                let name = closure_names(index).1;
                if !lowered
                    .program
                    .uncompiled
                    .iter()
                    .map(|entry| (&entry.name, &entry.reason))
                    .any(|(had, _)| *had == name)
                {
                    lowered
                        .program
                        .uncompiled
                        .push(crate::hir::Uncompiled::refused(
                            name,
                            diagnostic.message.clone(),
                        ));
                }
                lowered.diagnostics.push(diagnostic);
            }
        }
        builder.harvest(wanted, &mut lowered.arrivals);
        layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
    }
    // And the functions bridges call to make an array of a sequence, which
    // a closure lowered just above may have asked for; and what a host
    // rejects a promise with.
    lower_conversions(layout_collector, snapshot, shared, lowered, wanted);
    lower_reject_error(layout_collector, snapshot, shared, lowered, wanted);
    json::lower_writers(layout_collector, snapshot, shared, lowered, wanted);
}

/// The `const` aliases a closure's body reads, which both of its builders need.
///
/// One derivation, because a raising variant that read its captures at different
/// types from the ordinary body is the mistake `Copy`'s own description exists to
/// prevent, one field over.
fn closure_aliases(
    snapshot: &LoweringSnapshot<'_>,
    closures: &[ClosureInfo],
    index: usize,
) -> std::collections::BTreeMap<u32, HirType> {
    with_const_aliases(
        &FuncBuilder::probe(snapshot),
        closures[index].node,
        closures[index].retyped_captures.clone(),
    )
}

struct ClosureOutput<'a> {
    kernels: &'a [Func],
    inputs: &'a uniform_inputs::Plan,
    wanted: &'a mut std::collections::BTreeSet<usize>,
    arrivals: &'a mut Arrivals,
}

/// The raising variant of one closure, and the entry that names it -- or the entry
/// that aborts by name where there cannot be one.
///
/// **Three outcomes, and they are why this is its own function.**
///
///   a different program   the variant, plus its own uniform entry. Measured over
///                         four runtime modules at about 2% of closures, which is
///                         the whole reason to build both and compare rather than
///                         predict: see [`the_same_program`].
///   the same program      nothing. `declare_raising_entries` then names the
///                         *ordinary* entry in the raising slot, because a body with
///                         nothing to raise cannot end anything.
///   refused               the entry that aborts by name.
///                         `FuncBuilder::a_raising_body_carries_this_call` is what
///                         refuses -- a body calling something whose own `throw`
///                         cannot be carried.
///
/// There was a fourth, "a return with no zero", for a body answering a `bigint`
/// or a native pointer: its raising path had nothing to return. It does --
/// [`FuncBuilder::raised_return`] gained both arms on 2026-10-03 -- and the
/// predicate that refused them kept refusing, so a handle-returning closure
/// called inside a `try` compiled to an aborting entry
/// (`blockers/a-raising-handle-returning-closure-called-as-void`).
///
/// **The abort rather than an unfilled slot**, because the slot is filled in
/// `declare_raising_entries` and the body is produced here: a hole would leave a
/// table naming nothing at a site that compiled. Measured at **0 reachable entries**
/// across all 29 runtime corpora, which is `refuses_to_cross`' standing exactly.
#[expect(
    clippy::too_many_lines,
    reason = "keep raising-copy comparison and its entry together"
)]
fn raising_closure(
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    shared: &Shared,
    closures: &[ClosureInfo],
    index: usize,
    copy: Copy,
    output: ClosureOutput<'_>,
) -> (Vec<Func>, Vec<Layout>) {
    let ClosureOutput {
        kernels,
        inputs,
        wanted,
        arrivals,
    } = output;
    // The ordinary closure was just appended; all its source kernels precede it.
    let func = kernels
        .last()
        .expect("ordinary closure before its raising entry");
    if !shared.hierarchy.closures_carry
        || shared.hierarchy.raising_call_slot.is_none()
        || closures[index].source.only_the_runtime_calls()
    {
        return (Vec::new(), Vec::new());
    }
    let (raising_body, raising_entry) = raising_closure_names(index);
    // Only the raising entry calls this body, so one that takes the call's
    // `this` keeps it, under its own name, and needs no wrapper.
    let takes_this = closures[index].reads_this;
    let raising_body = if takes_this {
        format!("{}{RAISING_SUFFIX}", receiving_call_name(index))
    } else {
        raising_body
    };
    let arity = shared.hierarchy.erased_call_arity;
    let abort = |because: String| {
        erased_call(
            raising_entry.clone(),
            func,
            arity,
            Some(&because),
            Absent::Impossible,
            takes_this,
            None,
        )
        .into_iter()
        .collect::<Vec<Func>>()
    };
    let mut second = shared.builder(snapshot, foreign, copy.clone());
    second.retyped_symbols = closure_aliases(snapshot, closures, index);
    let made = generic_values::lower(
        &mut second,
        index,
        &closures[index],
        &shared.generics,
        kernels,
    )
    .or_else(|| second.lower_made_closure(index, &closures[index]));
    match made.unwrap_or_else(|| second.lower_closure(index, &closures[index])) {
        Ok(raising) if the_same_program(func, &raising) && !inputs.binds_defaults => {
            (Vec::new(), Vec::new())
        }
        // **With the layouts its builder made**, which are not the ordinary
        // body's: a non-null assertion throws a `TypeError` here where the
        // ordinary body calls `nts_assertion_failed`, so the error's layout
        // exists only in this builder. Dropped with it, the raising body
        // allocated a type with no layout -- the LLVM backend declined it and the
        // C backend reported it (`tests/programs/an-element-assertion-in-a-raising-closure`).
        Ok(mut raising) => {
            for split in &mut second.arrivals.parameter_entries {
                if split.name == raising.name {
                    split.name.clone_from(&raising_body);
                }
            }
            for site in &mut second.arrivals.uniform_sites {
                if site.function == raising.name {
                    site.function.clone_from(&raising_body);
                }
            }
            for check in &mut second.arrivals.printer_checks {
                if check.function == raising.name {
                    check.function.clone_from(&raising_body);
                }
            }
            raising.name = raising_body;
            second.harvest(wanted, arrivals);
            let result_absent =
                closure_result_absent(snapshot, closures[index].node, &raising.return_type);
            let mut entry = inputs
                .needed
                .then(|| shared.builder(snapshot, foreign, copy));
            if let Some(entry) = &mut entry {
                entry.retyped_symbols = closure_aliases(snapshot, closures, index);
            }
            let mut produced = erased_call(
                raising_entry,
                &raising,
                arity,
                None,
                result_absent,
                takes_this,
                entry
                    .as_mut()
                    .map(|entry| (entry, &closures[index], inputs)),
            )
            .into_iter()
            .collect::<Vec<Func>>();
            if let Some(entry) = &mut entry {
                entry.harvest(wanted, arrivals);
            }
            produced.push(raising);
            let mut layouts = std::mem::take(&mut second.layouts).into_layouts();
            if let Some(entry) = entry {
                layouts.extend(entry.layouts.into_layouts());
            }
            (produced, layouts)
        }
        // **Refused where the ordinary body was not**, which reading the raising arm
        // says cannot happen: it is tested *before* every fallible arm of
        // `lower_throw` -- the `async` one refuses a thrown non-reference -- and adds
        // no fallible step of its own. Measured at 0 of 935 closures over four
        // runtime modules, which is the same sentence from the other side. Its own
        // diagnostics are dropped: they are the ordinary body's cascade a second
        // time, under a name no source wrote.
        Err(_) => (
            abort(format!(
                "calling `{}` from inside a `try`, whose raising copy this compiler could \
                 not build",
                func.name
            )),
            Vec::new(),
        ),
    }
}

impl FuncBuilder<'_> {
    /// One arrow function, as the `call` method of a class.
    ///
    /// The class's fields are what the body reads from the scope around it, in
    /// the order `collect_closures` fixed -- the same order the allocating side
    /// writes them in. `this` is the closure, so a free variable becomes a
    /// field read on parameter zero and everything downstream sees an ordinary
    /// object.
    /// A closure's parameter list, and the values a wrapper forwards.
    ///
    /// The receiver is first, so a closure's `#call` is `(this, ...written)` --
    /// which is what makes a slot's arity uniform.
    ///
    /// **`forwarded` is kept here rather than read back from a binding**, because
    /// a wrapper has no body to read one: `lower_param` pushed the value and bound
    /// it by symbol, and this is the only `Param(at)` such a function will hold.
    /// A fixed-arity rest expands to several, so the *range* is forwarded rather
    /// than the single index -- forwarding only `at` dropped every position after
    /// the first, silently, at the one site with no body to notice.
    fn closure_parameters(
        &mut self,
        id: NodeId,
        receiver_ty: HirType,
        origin: &Origin,
        binds: ParameterNames,
        takes_this: bool,
    ) -> Result<(Vec<Param>, Vec<ValueId>), Diagnostic> {
        let mut params = vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: receiver_ty,
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        // The call's `this`, where a uniform entry takes it, so the written
        // parameters are numbered after it (`ClosureInfo::reads_this`).
        if takes_this {
            params.push(Param {
                name: "this_argument".to_owned(),
                shape: ParamShape::Ordinary,
                ty: HirType::Erased,
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
        }
        let mut forwarded = Vec::new();
        for child in self.children(id) {
            if self.kind_of(child) != Some(syntax::PARAMETER) {
                continue;
            }
            let at = u32::try_from(params.len()).unwrap_or(0);
            let added = self.lower_param_binding(child, at, binds)?;
            for offset in 0..u32::try_from(added.len()).unwrap_or(1) {
                if let Some(value) = self.param_value(at + offset) {
                    forwarded.push(value);
                }
            }
            params.extend(added);
        }
        Ok((params, forwarded))
    }

    pub(super) fn reserved_return_type(
        &mut self,
        id: NodeId,
    ) -> Result<(Option<crate::hir::GeneratorFrame>, HirType), Diagnostic> {
        let generated = self.begin_generator(id)?;
        if let Some(frame) = &generated {
            let ty = HirType::Managed(ManagedType::Object(frame.ty));
            return Ok((generated, ty));
        }
        let return_type = self.return_type_of(id)?;
        self.materialize(id, &return_type)?;
        Ok((generated, return_type))
    }

    fn closure_inputs(
        &mut self,
        index: usize,
        info: &ClosureInfo,
        receiver: ValueId,
        this_argument: Option<ValueId>,
        origin: &Origin,
    ) -> Result<parameter_entries::ClosureInputs, Diagnostic> {
        let id = info.node;
        let receiver_ty = self.values[receiver.0 as usize].ty.clone();
        let parameters_of = if info.source.wraps() {
            self.implementation_of(id)
        } else {
            id
        };
        let parameter_entry = self.needs_parameter_entry(parameters_of);
        let authored_entry = parameter_entry && matches!(info.source, ClosureSource::Authored);
        let early_return = if authored_entry {
            let result = self.reserved_return_type(id)?;
            self.returns = result.1.clone();
            self.return_elements = self.written_tuple_return(id);
            Some(result)
        } else {
            None
        };
        if parameter_entry {
            self.parameter_entry = Some(parameters_of);
        }
        // An initializer may read an enclosing capture. Bind it before the
        // affected parameter list, rather than after that list has run.
        let early_fields = if authored_entry {
            Some(self.bind_captures(receiver, info, origin)?)
        } else {
            None
        };
        if authored_entry {
            self.prepare_parameter_cells(id);
        }
        if authored_entry && let Some(this_argument) = this_argument {
            self.this = Some(self.receive_this(id, this_argument)?);
        }
        let (params, forwarded) = self.closure_parameters(
            parameters_of,
            receiver_ty,
            origin,
            if matches!(info.source, ClosureSource::Authored) {
                ParameterNames::Bound
            } else {
                ParameterNames::Forwarded
            },
            info.reads_this,
        )?;

        // The captures, read back and bound to the names the body writes. A
        // field read rather than a copy into a local: the value is already
        // there, and `FieldGet` is what every other object read is.
        // **Field 0 is the receiver, and it comes before the captures.**
        // `ClosureSource::Method` guarantees `info.captures` is empty -- a method body
        // reaches its receiver through `this`, not through the enclosing scope
        // -- so the two never have to agree about an offset.
        let fields = if let Some(fields) = early_fields {
            fields
        } else if info.source.binds_receiver() {
            vec![self.bind_receiver(id, receiver, origin)?]
        } else {
            self.bind_captures(receiver, info, origin)?
        };
        self.layouts.push(self.closure_layout(index, fields));

        Ok(parameter_entries::ClosureInputs {
            params,
            forwarded,
            early_return,
            authored_entry,
        })
    }

    fn lower_closure(&mut self, index: usize, info: &ClosureInfo) -> Result<Func, Diagnostic> {
        if let Some(reason) = info.refusal {
            return Err(self.unsupported(info.node, reason));
        }
        let id = info.node;
        let name = closure_body_name(index, info.reads_this);
        let receiver_ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(id);

        let receiver = self.push(OpKind::Param(0), receiver_ty.clone(), origin.clone());
        let this_argument = info.reads_this.then(|| {
            let at = u32::try_from(crate::hir::UNIFORM_THIS).unwrap_or(u32::MAX);
            self.push(OpKind::Param(at), HirType::Erased, origin.clone())
        });
        self.this = Some(receiver);
        self.bind_own_name(id, receiver);
        self.in_closure = true;
        // A wrapper accepts the implementation's parameters. An overload
        // describes a particular source call; its literal parameter is no
        // proof about every value arriving through the uniform callable slot.
        // Keep the wrapper's identity and layout at `id`, while deriving the
        // forwarded values and their facts from the body it actually calls.
        let promised = self.promise_before_inputs(id, info)?;
        let parameter_entries::ClosureInputs {
            params,
            forwarded,
            early_return,
            authored_entry,
        } = self.closure_inputs(index, info, receiver, this_argument, &origin)?;

        // **Every parameter's layout, not only the return's.** A closure
        // restates the wrapped declaration's parameter list, and a type that
        // reaches HIR without a layout is *invalid HIR* rather than a refusal:
        // `emit-c` prints `refusing to emit code from invalid HIR`, writes
        // nothing and exits 0.
        //
        // `* #m([x = 4])` is the shape that found it. An untyped destructuring
        // parameter with a default has an anonymous tuple type that nothing
        // else in the program names, so reading the method as a value was the
        // first thing to ask for it -- and the pre-change compiler *refused*
        // that read, which is how this stayed invisible until the read landed.
        for param in &params {
            let ty = param.ty.clone();
            self.materialize(id, &ty)?;
        }
        // **A `function*` expression is a generator, and this was the third
        // lowering path to find out.** `begin_generator` had one caller and a
        // generator *method* reached its body with no frame reserved, so every
        // `yield` in it said "a `yield` outside a generator" -- true of the
        // lowering and false of the source; the comment at that second call site
        // records it. A generator function *expression* is the same discovery a
        // third time, and it is what test262's `dstr/` tests build every iterator
        // with: `var iter = function*() { yield 1; }();`. The conformance lane
        // counts **460 of the corpus's ~800 no-verdict rows** behind it --
        // `FellThrough { func: "Closure0#call" }` where the body was lowered as an
        // ordinary function, plus "a `yield` outside a generator" where it was not.
        //
        // The frame is the return type, for the reason `lower_function` gives: a
        // generator's *declared* `Generator<T, …>` has no representation and is
        // not what the compiled function hands back. And it is **not**
        // materialized -- `hir::suspend` builds a frame's layout and is the only
        // thing that can, because what goes in one is what survives a suspension.
        // **A wrapper forwards to a generator; it does not generate.** This is
        // the guard whose absence turned `test262-cases` red -- 4,632 to 4,520,
        // **112 regressed**, every one a class *private* generator method in
        // `{expressions,statements}/class/dstr`, and every one this shape:
        //
        //     var C = class {
        //       * #method([[x, y, z] = [4, 5, 6]]) { ... }
        //       get method() { return this.#method; }   // <- handed out as a VALUE
        //     };
        //     new C().method([]).next();
        //
        // The method itself lowers as a method and always did. What reaches here is
        // the **bound-method wrapper** `collect_closures` builds for `this.#method`
        // as a value (`wraps`, `binds_receiver`), and it has no body of its own: it
        // forwards. Reserving a frame for it made it *compile* down the closure path
        // where it had refused, and the field index and the pointer type then
        // disagreed -- 56 files refused at a field index outside its layout, 56 more
        // emitted C that does not compile.
        //
        // So the question is not "does the declaration have a `*`" but "is this the
        // generator's own body", and [`ClosureSource::Authored`] is exactly that:
        // every other variant forwards to something already lowered -- a named
        // function used as a value, a method used as a value, a promise job, a
        // settler -- and a forwarder has no `yield` of its own to reserve for. **None of the four
        // arms I measured that change with contained a method handed out as a
        // value**, which is why the recorded test262 set is the population for a
        // lowering change and `runtime/` is the narrow corpus.
        let (generated, return_type, promised) =
            if let Some((generated, ty, asynchronous)) = promised {
                (generated, ty, Some(asynchronous))
            } else if let Some((generated, ty)) = early_return {
                (generated, ty, None)
            } else if matches!(info.source, ClosureSource::Authored) {
                let (generated, ty) = self.reserved_return_type(id)?;
                (generated, ty, None)
            } else {
                (None, self.return_type_of(id)?, None)
            };

        // **An `async` arrow allocates its promise before its body runs**, for
        // the two reasons an `async` function does: every `return` needs one to
        // settle, and the allocation belongs on the one path in rather than on
        // each path out.
        //
        // This was never called here, and the whole of `async (a) => a + 1` was
        // the consequence. The body was lowered against a `returns` of
        // `Promise<f64>` with nothing to settle it, so `return a + 1` reported
        // `a value of type Float { bits: 64 } where Managed(Promise(Float {
        // bits: 64 })) is wanted`, and an `await` *inside* one reported `a
        // top-level await` -- because `async_result` was `None`, which is what
        // module scope looks like from here. The same two sentences an async
        // generator produced before `begin_async` learned about it, in a third
        // place.
        //
        // Found from the other end: the JVM lane reported four closures stored
        // where a signature layout was declared, and `relate_closures_to_signatures`
        // was innocent. An async arrow's `call` answered `f64` where the
        // declared signature said `Promise<f64>`, so the two signatures did not
        // match, so no layout claimed it and it got no base. `stream`'s `tap`
        // is the corpus instance.
        //
        // No state is saved around this: closures get a builder each, so an
        // `async` arrow inside a synchronous function cannot leak its result
        // into the function around it.
        let asynchronous = match promised {
            Some(asynchronous) => asynchronous,
            None => self.begin_async(id, &return_type)?,
        };

        // A wrapper has no body of its own. It forwards to the function it
        // stands for, which keeps that function's one definition the only one:
        // re-lowering the declaration's body here would compile it twice and
        // give recursion two things to mean. A `this` it takes is handed on as
        // it came, and the body it forwards to proves it.
        if info.source.wraps() {
            let carried = (this_argument, forwarded);
            return self.lower_wrapper_body(index, info, carried, params, return_type);
        }

        self.start_bound_body(id)?;
        // **The body's `this` is the call's**, proven at the declared type.
        if !authored_entry && let Some(this_argument) = this_argument {
            self.this = Some(self.receive_this(id, this_argument)?);
        }

        // `x => x * 2` and `x => { return x * 2; }` are the same function, and
        // the first is much the more common. The body is the last child either
        // way: parameters and a return annotation both precede it.
        let body = self
            .children(id)
            .last()
            .copied()
            .ok_or_else(|| self.unsupported(id, "an arrow function with no body"))?;
        // A closure's `return` is its own. This was never set here, so a
        // `return x` inside a closure coerced to whatever the function *around*
        // it returned -- latent for as long as the two agreed, and immediate
        // once a void function's `return f()` learned to drop its value: a
        // closure returning an array, inside a void function, dropped it.
        //
        // Saved and restored rather than assigned, because closures nest.
        let enclosing = std::mem::replace(&mut self.returns, return_type.clone());
        let elements = self.written_tuple_return(id);
        let enclosing_elements = std::mem::replace(&mut self.return_elements, elements);
        let lowered = if self.kind_of(body) == Some(syntax::BLOCK) {
            let outcome = self.lower_block(body);
            if outcome.is_ok() {
                if let Some(result) = &asynchronous {
                    // Falling off the end of an `async` arrow resolves it with
                    // `undefined`, which is what `return;` does -- so the two
                    // are one path rather than the second being a special case.
                    if !self.is_terminated() {
                        let result = result.clone();
                        self.settle_and_return(id, &result, None)?;
                    }
                } else if generated.is_some() {
                    // Falling off the end of a generator is the end of the walk,
                    // and `hir::suspend` turns it into the *done* a resumption
                    // answers -- the same exit `lower_function` gives one, for
                    // the same reason and in the same words.
                    if !self.is_terminated() {
                        self.terminate(Terminator::Return(None));
                    }
                } else {
                    // `close_body` rather than an unconditional `Return(None)`:
                    // a block reaching its end returns nothing only when
                    // nothing is what it owes, and `FellThrough` is what says
                    // the difference has not been proven. The unconditional
                    // form built closures that promised an array and returned
                    // none.
                    self.close_body(id, &return_type)?;
                }
            }
            outcome
        } else if let Some(result) = asynchronous.clone() {
            // `async x => x + 1`. The expression is what the promise settles
            // with, not what the function returns: an `async` arrow returns its
            // promise on every path, and the value is the argument to the
            // settlement.
            match self.lower_expression(body) {
                Ok(value) => self.settle_and_return(id, &result, Some(value)),
                Err(error) => Err(error),
            }
        } else {
            // **Lowered *expecting* the return type**, which is what a block
            // body's `return` already does and a concise body did not. A bare
            // `null` takes its representation from what it stands in for, so
            // `const f: (n: string) => Task | null = (_n) => null` refused --
            // `null` with nothing expected is not a reference -- while the same
            // body written `{ return null; }` compiled. The two spellings are the
            // same function, which is the sentence four lines above this one.
            self.lower_expecting(body, &return_type).map(|value| {
                // `x => f(x)` where `f` returns nothing. The call happens and
                // there is no value to carry: C cannot `return` one from a
                // void function, and the emitter declares no variable for a
                // void-typed value to live in.
                let carried = (!matches!(return_type, HirType::Void)).then_some(value);
                self.terminate(Terminator::Return(carried));
            })
        };
        self.returns = enclosing;
        self.return_elements = enclosing_elements;
        lowered?;

        // Not exported: a closure has no name to import. It stays only because
        // something dispatches through its slot, which `hir::reachable` decides
        // the same way it decides an override's fate.
        let mut func = self.finish(name, params, return_type, origin, false);
        func.written_return = self.written_return(id);
        func.result_absent = self.result_absent(id);
        func.written_return_elements = self.written_tuple_return(id);
        Ok(func)
    }

    /// Why a captured name holding a closure has no layout, where that is so.
    ///
    /// Only one shape reaches here, and it is the one [`Self::closure_bound_to`]
    /// declines: a **reassignable** variable holding an arrow. Two arrows are
    /// two layouts, so no single field type describes the slot, and clang says
    /// as much directly -- `assigning to 'NtsObj_Closure2 *' from
    /// 'NtsObj_Closure3 *'` -- which is the same argument `closure_typed_global`
    /// makes for a module-scope `const`.
    ///
    /// **Said here rather than left to the backend.** Without this the capture
    /// was typed from the checker and the C emitter refused with `an object
    /// type with no layout: type 4` -- a true sentence naming an internal id,
    /// for a program whose problem is one `let`. The export is dropped either
    /// way; only the reader's chance of acting on it differs.
    pub(super) fn why_the_closure_cannot_be_captured(&self, symbol: u32) -> Option<&'static str> {
        let declaration = self
            .snapshot
            .symbols
            .get(symbol as usize)?
            .declarations
            .iter()
            .copied()
            .find(|node| self.kind_of(*node) == Some(syntax::VARIABLE_DECLARATION))?;
        if self.declaration_kind(declaration) == nts_semantic_schema::VariableKind::Const {
            return None;
        }
        self.children(declaration)
            .into_iter()
            .any(|child| self.kind_of(child) == Some(syntax::ARROW_FUNCTION))
            .then_some(
                "a closure captured through a reassignable variable, where a second arrow \
                 would be a second layout",
            )
    }

    /// A closure whose body the compiler makes rather than the program
    /// writing one, or `None` for any other.
    fn lower_made_closure(
        &mut self,
        index: usize,
        info: &ClosureInfo,
    ) -> Option<Result<Func, Diagnostic>> {
        match info.source {
            ClosureSource::Job {
                calls,
                resolve,
                reject,
            } => Some(self.lower_thenable_job(index, info.node, calls, [resolve, reject])),
            ClosureSource::Resolving { rejects } => {
                Some(self.lower_resolving_function(index, info.node, rejects))
            }
            ClosureSource::Reaction => Some(self.lower_reaction(index, info)),
            ClosureSource::Bound => Some(self.lower_bound_function(index, info)),
            ClosureSource::ModuleJob { module } => Some(self.lower_module_job(index, module)),
            ClosureSource::Authored | ClosureSource::Function | ClosureSource::Method => None,
        }
    }
}

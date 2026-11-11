//! Publish callable signature layouts and entry bridges.

use super::{
    Absent, Arrival, Arrivals, Block, Callee, ClosureInfo, ClosureSource, Facts, Func, FuncBuilder,
    Hierarchy, HirType, Layout, LayoutCollector, Location, LoweringSnapshot, ManagedType, NodeId,
    NodeKind, Op, OpKind, Origin, Param, ParamShape, Program, RAISING_SUFFIX, SemanticSnapshot,
    Shared, Terminator, TypeId, TypeKind, ValueId, closure_names, declaration_shell, erasable,
    fill_raising_member_slots, is_a_declaration_path, is_signature_name, member_origins,
    objects_in, representation, result_crosses, shared_generator_result, signature_name, syntax,
    uniform_inputs, virtual_returns,
};

/// Closures whose `#call` disagrees with a slot they were admitted into.
///
/// **The comparison [`coerce_arm`] could not make.** By the time this runs,
/// `lower_wanted_closures` has given every closure a `#call` with real parameter
/// and return types, and each [`Arrival`] carries what its slot expected, resolved
/// where that was known. Neither half is available at the other's time, which is
/// the whole reason the pair is recorded rather than checked.
///
/// **Arity is not a disagreement** and is deliberately not compared. JavaScript
/// drops extra arguments and fills missing ones with `undefined`, so a closure
/// written at one arity and called at another is *correct*, and the React lane
/// measured it: `erased-fn-arity-only` agrees on both arms. Only overlapping
/// positions are compared -- which is also the mistake this function exists
/// downstream of, since "arity is free" was read as "parameters are free" and it
/// is not.
pub(super) fn disagreeing_arrivals(
    program: &Program,
    arrivals: &Arrivals,
) -> Vec<(String, String)> {
    let mut found = Vec::new();
    for arrival in &arrivals.at_signature {
        let Some(call) = program
            .layouts
            .iter()
            .find(|layout| layout.types.contains(&arrival.closure))
            .and_then(Layout::closure_call)
        else {
            continue;
        };
        let Some(func) = program.funcs.iter().find(|func| func.name == call) else {
            continue;
        };
        // The environment is the closure's own first parameter and the signature
        // does not name it, so the written parameters start at one.
        let written = func.params.get(1..).unwrap_or(&[]);
        for (at, want) in arrival.parameters.iter().enumerate() {
            let (Some(want), Some(param)) = (want.as_ref(), written.get(at)) else {
                continue;
            };
            // `verify::compatible`, not `!=`: two references are two pointers
            // however their types relate, so `Object(A)` where `Object(B)` is
            // passed is one address and no misread. Equality counted 61 in `zlib`
            // where the ABI disagrees on far fewer, and most of the difference
            // was that.
            //
            // **A rest slot is a shape difference and not a representation one.**
            // `(...args: unknown[])` passes one array where the closure declares
            // an element, which the existing rest machinery collects; comparing
            // position against position sees `Erased` against
            // `Array(Erased)` and calls it a mismatch. Skipped when the slot's
            // parameter is an array of something the closure's parameter is
            // compatible with.
            let rest = matches!(
                want,
                HirType::Managed(ManagedType::Array(element))
                    if crate::hir::verify::compatible(&param.ty, element)
            );
            if !rest && !crate::hir::verify::compatible(&param.ty, want) {
                found.push((
                    call.to_owned(),
                    format!(
                        "parameter {at} is {:?} and the slot passes {want:?}",
                        param.ty
                    ),
                ));
            }
        }
        if let Some(want) = arrival.returns.as_ref()
            && !crate::hir::verify::compatible(&func.return_type, want)
        {
            found.push((
                call.to_owned(),
                format!("returns {:?} and the slot reads {want:?}", func.return_type),
            ));
        }
    }
    found
}

/// Whether the program can hold a function value, and so carries the closure
/// slots: anything in it is a closure, or a class of it declares `then` (see
/// `Hierarchy::declares_a_then`), or it receives a function value it did not
/// make ([`receives_a_function_value`]). A program with none carries no table
/// at all, which is what it should carry.
pub(super) fn needs_closure_slots(
    snapshot: &SemanticSnapshot,
    closures: &[ClosureInfo],
    hierarchy: &Hierarchy,
) -> bool {
    closures.iter().any(|closure| closure.refusal.is_none())
        || hierarchy.declares_a_then()
        || receives_a_function_value(snapshot)
}

/// Whether the program declares a parameter or a field of a function type, so
/// a function value can arrive from outside it -- a Java lambda, a JavaScript
/// callback, a native one -- with no closure of the program's own.
///
/// Such a value is called, and handed back out, through the uniform entries,
/// so the program needs their slots although it makes no closure: without them
/// `f("x", "y")` on a `Pair` parameter was refused as "a call of a function
/// value in a program with no closures", and on the JVM the signature
/// published no face, so a Java caller could not pass a lambda at all
/// (`blockers/a-call-through-a-function-type-with-no-closure-in-the-program`).
/// A program with neither keeps carrying no table.
///
/// A declaration file's parameters are not counted: they describe a native or
/// library function, which receives the value, rather than the program.
fn receives_a_function_value(snapshot: &SemanticSnapshot) -> bool {
    snapshot.nodes.iter().enumerate().any(|(index, node)| {
        matches!(
            node.kind,
            NodeKind::Syntax(syntax::PARAMETER | syntax::PROPERTY_DECLARATION)
        ) && snapshot
            .node_types
            .get(&NodeId(u32::try_from(index).unwrap_or(u32::MAX)))
            .and_then(|ty| snapshot.types.get(ty.0 as usize))
            .is_some_and(|record| matches!(record.kind, TypeKind::Function(_)))
            && snapshot
                .sources
                .get(node.origin.location.file.0 as usize)
                .is_some_and(|source| !is_a_declaration_path(&source.uri))
    })
}

/// Argument provenance and routing live only while this one call is lowered.
/// A known reference input outside scalar admission keeps the previous typed
/// path, including caller-filled defaults; it must not gain an unchecked cast.
#[derive(Default)]
pub(super) struct UniformArguments {
    pub(super) sources: Vec<(NodeId, Option<TypeId>)>,
    pub(super) typed_references: Option<usize>,
}

impl UniformArguments {
    pub(super) fn new(sources: Vec<(NodeId, Option<TypeId>)>) -> Self {
        Self {
            sources,
            typed_references: None,
        }
    }
}

/// A `this`-reading function's written entry: its body, called with
/// `undefined`, the `this` JavaScript gives a plain call. `this_at` is where
/// the body takes it: after the closure for a closure's `#call`
/// ([`super::UNIFORM_THIS`](crate::hir::UNIFORM_THIS)), first for a declaration ([`receiving_function_name`](super::receiving_function_name)).
///
/// For the callers that reach a closure by its written slot, or a function by
/// its name, and have no `this` to give -- the C runtime's timers and
/// reactions, the native callback bridges, the JVM's callback interfaces, a
/// plain call, an importer, the export surface -- so none of them changes
/// shape for a function that reads one (`docs/records/notebooks/function-receivers.md`). A call
/// that has a `this` names the body.
pub(super) fn passing_undefined(name: String, body: &Func, this_at: usize) -> Func {
    let origin = Origin::generated(
        body.origin.location,
        nts_semantic_schema::GeneratedReason::ClosureLowering,
    );
    let params: Vec<Param> = body
        .params
        .iter()
        .enumerate()
        .filter(|(at, _)| *at != this_at)
        .map(|(_, param)| param.clone())
        .collect();
    let mut values: Vec<Op> = (0..params.len())
        .map(|at| Op {
            kind: OpKind::Param(u32::try_from(at).unwrap_or(u32::MAX)),
            ty: params[at].ty.clone(),
            origin: origin.clone(),
        })
        .collect();
    let id = |at: usize| ValueId(u32::try_from(at).unwrap_or(u32::MAX));
    let undefined = id(values.len());
    values.push(Op {
        kind: OpKind::ConstUndefined,
        ty: HirType::Erased,
        origin: origin.clone(),
    });
    let mut args: Vec<ValueId> = (0..params.len()).map(id).collect();
    args.insert(this_at, undefined);
    let answered = id(values.len());
    values.push(Op {
        kind: OpKind::Call {
            callee: Callee::Direct(body.name.clone()),
            args,
            frame: None,
        },
        ty: body.return_type.clone(),
        origin: origin.clone(),
    });
    let terminator = match body.return_type {
        HirType::Void => Terminator::Return(None),
        HirType::Never => Terminator::Unreachable,
        _ => Terminator::Return(Some(answered)),
    };
    Func {
        name,
        params,
        return_type: body.return_type.clone(),
        values,
        blocks: vec![Block {
            params: Vec::new(),
            ops: (0..=answered.0).map(ValueId).collect(),
            terminator,
        }],
        origin,
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: rustc_hash::FxHashMap::default(),
        written_return: body.written_return,
        result_absent: crate::hir::Absent::Impossible,
        validation: None,
        written_return_elements: body.written_return_elements.clone(),
    }
}

/// Complete the tables after declarations: fill raising slots, then adapt
/// interface entries and make class-chain results agree.
pub(super) fn finish_dispatch_tables(
    snapshot: &LoweringSnapshot<'_>,
    hierarchy: &Hierarchy,
    program: &mut Program,
) {
    // **After the interface declarations, and the order is the whole of it.** A member's
    // raising slot is filled from each layout's own ordinary entry, and for an *interface*
    // root that entry needs its interface declaration -- so filling first
    // found no `Sink#take` to suffix, fell back to the ordinary name, and left
    // `Sink#take@raises` reachable from nothing for `reachable::prune` to remove. The
    // backend then said `NTS2006 no declaration for `Sink#take@raises` to take a signature
    // from`, which is the sentence `declare_interface_methods` exists to prevent.
    member_origins::dispatch(snapshot, hierarchy, program);
    fill_raising_member_slots(program);
    // After both: a slot's entries -- the interface declarations and the raising
    // copies among them -- are final, and every call through one is lowered.
    virtual_returns::bridge(snapshot, hierarchy, program);
}

/// A function type's signature as the ids it is made of, or `None` when the
/// type is not a function.
///
/// Two type ids for one written signature compare equal here, which is the
/// whole point: the checker interns the parameter and return types, so the
/// inferred type of an arrow and the declared type of the variable it is
/// assigned to are different ids over the same contents.
pub(super) fn signature_key(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
) -> Option<(Vec<TypeId>, TypeId)> {
    let record = snapshot.types.get(ty.0 as usize)?;
    let TypeKind::Function(signature) = record.kind else {
        return None;
    };
    let signature = snapshot.signatures.get(signature.0 as usize)?;
    Some((
        signature.parameters.iter().map(|param| param.ty).collect(),
        signature.return_type,
    ))
}

/// A closure's `#call` in the one ABI a site that cannot know the closure is able
/// to spell: every written parameter erased, the result erased.
///
/// **Why this exists.** [`Hierarchy::closure_slot`]'s doc says one slot suffices
/// because "a call through the slot spells the signature it is making, so two
/// closure types sharing an index cannot be confused for each other". Spelling the
/// signature is *how* they are confused -- the call spells
/// `NtsValue (*)(NtsObj_Fn... *, ...)`, the closure at that index returns
/// `NtsString *`, and the spelling is the misread. `NTS_ARRIVALS` counts 25 of
/// `zlib`'s 240 admissions disagreeing, and
/// `outcomes/two-components-called-on-their-props-through-unknown` segfaults
/// seventeen times on it. A second entry, in the ABI every site can spell *without*
/// knowing, is what makes the spelling true.
///
/// **Three conversions, and the third had no witness until the corpus was
/// counted.** Unerase each parameter to what the real `#call` wants; erase the
/// result; and where the closure returns **nothing**, answer `undefined` -- a
/// `void` function called through a pointer typed as returning a value reads a
/// garbage return register. That is the majority case, 13 of `zlib`'s 25, and it
/// survives in the corpus only because such a result is nearly always discarded.
///
/// Arity is deliberately not adapted. JavaScript drops extra arguments and fills
/// missing ones, so a closure written at one arity and called at another is
/// correct, and `erased-fn-arity-only` agrees on both arms. Reading "arity is free"
/// as "parameters are free" is the mistake this function exists downstream of.
#[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
/// `takes_this` is whether `call` is the body of a closure that reads its own
/// `this` (`ClosureInfo::reads_this`), which takes the call's `this` after the
/// closure, as this entry does; the entry passes its own on.
pub(super) fn erased_call(
    name: String,
    call: &Func,
    width: usize,
    refusing: Option<&str>,
    result_absent: Absent,
    takes_this: bool,
    context: Option<(&mut FuncBuilder<'_>, &ClosureInfo, &uniform_inputs::Plan)>,
) -> Option<Func> {
    let origin = Origin::generated(
        call.origin.location,
        nts_semantic_schema::GeneratedReason::ClosureLowering,
    );
    // A closure's `#call` always has its receiver; this is the only shape that
    // could not be built, and no caller can produce it.
    let receiver = call.params.first()?.clone();
    let written = call
        .params
        .get(
            if takes_this {
                crate::hir::UNIFORM_ARGUMENTS
            } else {
                1
            }..,
        )?
        .to_vec();
    // **Every parameter and the result have to cross the erasure boundary, and
    // `erasable` is the one predicate that says so.** Not a second list: its own
    // doc records that it and the backends' `erased_tag` are "one decision
    // written twice" and have disagreed six times, always the same way -- a
    // variant taught to the backend that spells it and not to the predicate that
    // decides whether it may be asked about. A seventh would be this.
    //
    // A native record is the case the bridge tests found (a `bigint` was the
    // other, before it had an erased form): it carries no tag, so the
    // `Unerase` below would be `NTS2008 a value ... cannot be read back yet`
    // and the program would stop emitting.
    //
    // **Where they cannot cross the entry still exists, and aborts by name.**
    // Returning `None` here was the first attempt and it is the defect this file
    // has fixed three times this week: the layout fills the slot with
    // `erased_call_name(index)` in one place and the function is produced in
    // another, so a missing adapter leaves a table naming something nothing
    // defines -- `sumTo cannot be compiled because it calls
    // `Closure14#erased_call`, which nothing in this program defines`, which is
    // how the bridge tests read it. One fact, one place: the entry is always
    // emitted, and what it does is the question.
    //
    // A closure whose parameters cannot be erased cannot be *called* through an
    // erased receiver either, so this abort is unreachable in the same way
    // `nts_no_arm` is -- and it is here for the same reason: a tag switch with a
    // hole is worse than one with an answer that cannot be reached.
    //
    // **The arity is that same question in the other direction, so it takes that
    // same answer.** A site that knows only the signature pads to `width`, so a
    // closure writing more parameters cannot be reached this way either -- and
    // returning `None` for it was the very defect the paragraph above describes,
    // left standing one condition over.
    //
    // It is also the guard on [`Hierarchy::erased_call_arity`]'s derivation: that
    // width is the checker's count and this is the lowering's, and the two parting
    // company is the one way this abort is reachable from a program anybody wrote.
    //
    // **A parameter the body already reads `Erased` crosses by having nothing to
    // cross.** `erasable` answers "may this be boxed into an `unknown`", and for
    // `Erased` the answer is no -- it is already one, and `Unerase`ing it is what
    // the backends refuse as "a value of type Erased cannot be read back yet".
    // The body below has that case and this test did not, which made every async
    // arrow's entry a refusal: `an-async-arrow`'s `Closure5#call` takes a `double`
    // and an already-erased second parameter and returns a promise -- every part
    // of which crosses. The two were one fact written twice, twelve lines apart.
    let crosses = refusing.is_none()
        && written.len() <= width
        && written
            .iter()
            .all(|param| param.ty == HirType::Erased || erasable(&param.ty));

    // The parameters first, in order, because a `Param` op *is* the signature in
    // this IR, and a value id has to be its index.
    let (params, mut values) = uniform_params(&receiver, &written, &origin, width)?;

    // Then the body. Each written parameter is unerased to what the real `#call`
    // declared, which is the half a site cannot do because it does not know what
    // that is.
    let mut ops = Vec::new();
    if !crosses {
        let because = refusing.map_or_else(
            || {
                format!(
                    "calling `{}` through an erased receiver, whose parameters or result have \
                     no erased form, or which writes more parameters than an erased call carries",
                    call.name
                )
            },
            str::to_owned,
        );
        return Some(refuses_to_cross(name, params, values, &origin, &because));
    }
    if let Some((builder, info, inputs)) = context {
        return Some(
            match builder.uniform_entry(
                name.clone(),
                call,
                (params.clone(), values.clone()),
                (info, inputs),
                result_absent,
            ) {
                Ok(entry) => entry,
                Err(diagnostic) => {
                    refuses_to_cross(name, params, values, &origin, &diagnostic.message)
                }
            },
        );
    }
    // The `this` is passed on only to a body that takes one; a written `#call`
    // takes none.
    let mut args = vec![ValueId(0)];
    if takes_this {
        args.push(ValueId(u32::try_from(crate::hir::UNIFORM_THIS).ok()?));
    }
    for (at, param) in written.iter().enumerate() {
        let from = ValueId(u32::try_from(at + crate::hir::UNIFORM_ARGUMENTS).ok()?);
        // A parameter the body already reads erased needs nothing: unerasing
        // `Erased` to `Erased` is a no-op the backend rightly refuses, since
        // `erased_tag` has no tag to give for it -- "a value of type Erased
        // cannot be read back yet".
        if param.ty == HirType::Erased {
            args.push(from);
            continue;
        }
        let id = ValueId(u32::try_from(values.len()).ok()?);
        values.push(Op {
            kind: OpKind::unerase(from),
            ty: param.ty.clone(),
            origin: origin.clone(),
        });
        ops.push(id);
        args.push(id);
    }

    let answered = ValueId(u32::try_from(values.len()).ok()?);
    values.push(Op {
        kind: OpKind::Call {
            callee: Callee::Direct(call.name.clone()),
            args,
            frame: None,
        },
        ty: call.return_type.clone(),
        origin: origin.clone(),
    });
    ops.push(answered);

    // And the answer, in the ABI the site spelled.
    let answer = match &call.return_type {
        HirType::Erased => answered,
        // **A result with no erased form is dropped, as a `void` one is.** Only
        // a signature returning `void` admits such a closure:
        // `FuncBuilder::result_without_an_erased_form` refuses every other
        // admission where it is written. So a call reaching this entry discards
        // the answer, and `() => document().body` passed as a listener runs --
        // it had aborted here by name, at run time, behind a clean compile.
        //
        // Nothing to erase: a `void` body has no value, and `undefined` is what
        // JavaScript says such a call answers.
        returns
            if matches!(returns, HirType::Void | HirType::Never) || !result_crosses(returns) =>
        {
            let id = ValueId(u32::try_from(values.len()).ok()?);
            values.push(Op {
                kind: OpKind::ConstUndefined,
                ty: HirType::Erased,
                origin: origin.clone(),
            });
            ops.push(id);
            id
        }
        _ => {
            let id = ValueId(u32::try_from(values.len()).ok()?);
            values.push(Op {
                kind: OpKind::Erase {
                    value: answered,
                    // What a null pointer the closure returns means, from its
                    // own signature (`closure_result_absent`): a `string |
                    // null` result's absence is `null`. The `HirType` cannot
                    // say -- the two share a pointer -- and assuming none made
                    // a null result a string tag over a null pointer.
                    absent: result_absent,
                    slots: Absent::Impossible,
                },
                ty: HirType::Erased,
                origin: origin.clone(),
            });
            ops.push(id);
            id
        }
    };

    Some(Func {
        name,
        params,
        return_type: HirType::Erased,
        values,
        blocks: vec![Block {
            params: Vec::new(),
            ops,
            terminator: Terminator::Return(Some(answer)),
        }],
        origin,
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: rustc_hash::FxHashMap::default(),
        written_return: None,
        result_absent: crate::hir::Absent::Impossible,
        validation: None,
        written_return_elements: Vec::new(),
    })
}

/// The uniform signature every closure's erased entry has: the receiver (the
/// closure), the call's `this`, then `width` erased parameters -- see
/// [`Hierarchy::erased_call_arity`] -- and the `Param` op for each. Laid out by
/// [`crate::hir::UNIFORM_THIS`] and [`crate::hir::UNIFORM_ARGUMENTS`].
///
/// Fixed width rather than the closure's own, because the point of the entry is
/// that a call site which knows only the signature can make it. A site padding
/// with `undefined` is what JavaScript does for a missing argument anyway; a site
/// that had to know the arity would be back to knowing the body.
///
/// Shared with [`declare_erased_entries`], which builds the *declaration* a
/// signature layout carries, so a declaration and every body that overrides it
/// cannot drift apart.
fn uniform_params(
    receiver: &Param,
    written: &[Param],
    origin: &Origin,
    width: usize,
) -> Option<(Vec<Param>, Vec<Op>)> {
    let this = Param {
        name: "this_argument".to_owned(),
        ty: HirType::Erased,
        origin: origin.clone(),
        shape: ParamShape::Ordinary,
        known: Facts::TOP,
        written: None,
    };
    let mut params = vec![receiver.clone(), this];
    let mut values = vec![
        Op {
            kind: OpKind::Param(0),
            ty: receiver.ty.clone(),
            origin: origin.clone(),
        },
        Op {
            kind: OpKind::Param(u32::try_from(crate::hir::UNIFORM_THIS).ok()?),
            ty: HirType::Erased,
            origin: origin.clone(),
        },
    ];
    for at in 0..width {
        let index = u32::try_from(at + crate::hir::UNIFORM_ARGUMENTS).ok()?;
        // The name and shape survive, but an erased arrival has none of the
        // typed body's range or literal proofs. Past the written
        // ones the parameter exists only to make every entry one shape, so a site
        // can pass this many without knowing which closure it has.
        params.push(match written.get(at) {
            Some(param) => Param {
                ty: HirType::Erased,
                known: Facts::TOP,
                written: None,
                ..param.clone()
            },
            None => Param {
                name: format!("padding{at}"),
                ty: HirType::Erased,
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
                ..receiver.clone()
            },
        });
        values.push(Op {
            kind: OpKind::Param(index),
            ty: HirType::Erased,
            origin: origin.clone(),
        });
    }
    Some((params, values))
}

/// The entry for a closure no site can legally reach through it: it aborts by
/// name. See [`erased_call`], which states why it exists rather than being
/// absent.
///
/// **The sentence is the caller's**, because there are two reasons a uniform
/// entry can be a shell and they name different work: a parameter or result with
/// no erased form (`erased_call`'s own test), and a raising variant this compiler
/// could not build from a body it did build (`lower_wanted_closures`). One text
/// covering both would send a reader to the wrong half.
fn refuses_to_cross(
    name: String,
    params: Vec<Param>,
    mut values: Vec<Op>,
    origin: &Origin,
    because: &str,
) -> Func {
    let mut ops = Vec::new();
    let reason = ValueId(u32::try_from(values.len()).unwrap_or(u32::MAX));
    values.push(Op {
        kind: OpKind::ConstString(because.to_owned().into()),
        ty: HirType::Managed(ManagedType::String),
        origin: origin.clone(),
    });
    ops.push(reason);
    let stop = ValueId(u32::try_from(values.len()).unwrap_or(u32::MAX));
    values.push(Op {
        kind: OpKind::Call {
            callee: Callee::External("nts_refused".to_owned()),
            args: vec![reason],
            frame: None,
        },
        ty: HirType::Void,
        origin: origin.clone(),
    });
    ops.push(stop);
    Func {
        name,
        params,
        return_type: HirType::Erased,
        values,
        blocks: vec![Block {
            params: Vec::new(),
            ops,
            terminator: Terminator::Unreachable,
        }],
        origin: origin.clone(),
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: rustc_hash::FxHashMap::default(),
        written_return: None,
        result_absent: crate::hir::Absent::Impossible,
        validation: None,
        written_return_elements: Vec::new(),
    }
}

/// Where a signature layout was written, for a declaration this program generates.
///
/// The type's **symbol** first, which is what names a declaration and is the place
/// a reader would want a diagnostic to point at.
///
/// **And a mention when there is no symbol, which is the common case and was
/// measured.** A function type usually carries none: in `type Weigh = (a: number)
/// => number` the symbol belongs to the *alias*, and the `TypeKind::Function`
/// record the layout is built from has `symbol: None`. Asking only the symbol left
/// `Fn2_2__2` -- a signature `keyed-closures` mentions twice and implements never,
/// which is exactly the case this pass exists for -- with no declaration at all,
/// and two tests said so.
///
/// A mention is a true location and a useful one: "this signature, where the
/// program named it". `node_types` is walked once into the reverse index rather
/// than per layout, because it is the whole program's nodes and there is a layout
/// for every signature.
fn signature_locations(snapshot: &SemanticSnapshot) -> rustc_hash::FxHashMap<TypeId, Location> {
    let mut mentions: rustc_hash::FxHashMap<TypeId, Location> = rustc_hash::FxHashMap::default();
    for (node, ty) in &snapshot.node_types {
        if let Some(record) = snapshot.nodes.get(node.0 as usize) {
            mentions.entry(*ty).or_insert(record.origin.location);
        }
    }
    mentions
}

fn signature_origin(
    snapshot: &SemanticSnapshot,
    layout: &Layout,
    mentions: &rustc_hash::FxHashMap<TypeId, Location>,
) -> Origin {
    let declared = |ty: &TypeId| {
        let symbol = snapshot.types.get(ty.0 as usize)?.symbol?;
        let declaration = *snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .first()?;
        Some(snapshot.nodes.get(declaration.0 as usize)?.origin.location)
    };
    // **The declaration is never skipped for want of a place**, which is the
    // mistake this function was written with: returning `None` made a *location* a
    // precondition for a *declaration*, and the signatures with no syntax are
    // exactly the ones this pass exists for. `runtime/node/timers`'
    // `Fn1303_28__188` has neither symbol nor mention -- `materialize_within`
    // built it from a container's type argument -- and the effect was that my
    // change **removed** its entry: `abstract class ... extends Erased-Callable`
    // at the parent became a bare class, and `Closure5` stopped being assignable
    // where the signature was declared. One invalid class in `timers`, from a pass
    // whose whole purpose is to stop a layout having a hole.
    //
    // So the location degrades and the entry does not: the declaration, then a
    // mention, then the synthetic origin other passes here use for a value no
    // source produced. An abstract declaration is never a diagnostic's primary
    // position -- what a reader gets is its name -- so the third is a worse
    // location and not a worse program.
    let located = layout
        .types
        .iter()
        .find_map(declared)
        .or_else(|| layout.types.iter().find_map(|ty| mentions.get(ty).copied()))
        .unwrap_or(Location {
            file: nts_diagnostics::SourceId(0),
            span: nts_diagnostics::Span::new(0, 0),
        });
    Origin::generated(
        located,
        nts_semantic_schema::GeneratedReason::ClosureLowering,
    )
}

/// Declare `erased_call` on every signature layout.
///
/// A signature layout is empty until something *implements* it, and one exists
/// with nothing implementing it whenever a program reads a closure out of a
/// container it did not populate -- `materialize_within` gives `Map<string,
/// Weigh>` a layout for `Weigh` because the signature mentions it, and nothing
/// constructs one. The result is a layout that lies about itself, which is the
/// standing hazard with an empty shape.
///
/// **C and LLVM do not notice, and are not evidence.** A closure call dispatches
/// through the *receiver's* descriptor, so the static layout's table is never
/// read and the emitted code is correct. The JVM has to name a method and a
/// descriptor at the call site, reads the static layout, finds nothing, and
/// refuses with `NTS4001 a closure call through a slot its type declares nothing
/// for` -- the third backend doing the job it is kept for, since the first two
/// compiled a shape with a hole in it and said nothing.
///
/// # Every signature, and not only the ones something calls
///
/// This was first driven by call sites, which made "fills `erased_call_slot`" mean
/// *"is a signature something dispatches through"* -- two facts in one test, and
/// the JVM lane's `Erased-Callable` root needs the one. `assert`'s `Fn79__144`
/// declares only `call(NtsViewU8)`, because a view parameter cannot be erased, and
/// nothing dispatches through it; so it had no entry, and a backend asking "is
/// this callable" could not tell it from an ordinary record. Driven by the layouts
/// the answer is one fact, and it survives `closure_slot` being dropped.
///
/// **Including the signatures whose parameters cannot cross**, which is
/// [`erased_call`]'s argument unchanged: the entry exists rather than being
/// absent, because a layout naming something nothing defines is worse than an
/// entry nothing can reach, and `nts_no_arm` is the precedent. A declaration is
/// abstract in any case -- it has no body to be unreachable.
///
/// # It replaced a larger pass, and the difference is that this shape is inferred
/// from nothing
///
/// `declare_unfilled_signatures` reconstructed the *written* `#call` from a call
/// site, since that was the program's only description of a signature nothing
/// implements -- with an agreement check across the sites, because two that
/// disagree about a signature are a fact to refuse over rather than one to pick a
/// winner in. Since [`FuncBuilder::closure_callee`] sends every signature-typed
/// call through the erased entry, no call spells a written signature any more, so
/// that pass could not fire; and nothing is lost, because the erased entry is a
/// receiver, [`Hierarchy::erased_call_arity`] erased parameters and an erased
/// result **at every site by construction**. Nothing to reconstruct, so nothing
/// to disagree about, and no shape for this to be wrong about.
/// Both uniform entries, in the order the second one needs.
///
/// [`declare_raising_entries`] fills the raising slot for whatever
/// [`declare_erased_entries`] filled the ordinary one for -- including the
/// signature layouts that pass has just declared, whose ordinary entry is a named
/// abort and whose raising entry is the same abort for the same reason. So the
/// order is a precondition rather than a preference, and one function holding both
/// calls is where a precondition of that shape cannot be reordered by someone
/// reading only the call site.
pub(super) fn declare_uniform_entries(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    program: &mut Program,
    shared: &Shared,
) {
    let dispatches_raising = shared.hierarchy.closures_carry;
    declare_erased_entries(snapshot, hierarchy, program);
    // **Only where a site can dispatch at the raising slot.** Filling it otherwise
    // names an entry nothing reaches, and `reachable::prune` cannot drop what a
    // dispatch table holds. See `what_holds_the_gate_off`.
    if dispatches_raising {
        declare_raising_entries(hierarchy, program);
    }
}

#[expect(
    clippy::too_many_lines,
    reason = "keep semantic text and key projection beside its existing dispatch"
)]
fn declare_erased_entries(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    program: &mut Program,
) {
    let Some(slot) = hierarchy.erased_call_slot.map(|slot| slot as usize) else {
        return;
    };
    // **A signature is a function type, asked of the checker.** Not re-derived
    // from the layout's name (`Fn...`), which would be a second spelling of a
    // fact the snapshot holds, and not from what dispatches through it, which is
    // the conflation this pass was rewritten to remove. A closure class is a
    // synthetic id the snapshot has no record for, so it is not caught here --
    // and does not need to be, `closure_layout` having filled its slot already,
    // which the emptiness test below sees.
    let is_signature = |layout: &Layout| {
        layout.types.iter().any(|ty| {
            snapshot
                .types
                .get(ty.0 as usize)
                .is_some_and(|record| matches!(record.kind, TypeKind::Function(_)))
        })
    };
    // **The signature's own id, for the typed face.** `is_signature` above answers
    // whether *any* of a layout's ids is a function type, which is the right test
    // for declaring the entry; the face needs the one that *is* the signature, and
    // for a layout that carries several ids over one signature they agree.
    let signature_of = |layout: &Layout| {
        layout.types.iter().find_map(|ty| {
            match snapshot.types.get(ty.0 as usize).map(|record| &record.kind) {
                Some(TypeKind::Function(signature)) => Some((*ty, *signature)),
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => None,
                _ => None,
            }
        })
    };
    let mentions = signature_locations(snapshot);
    let mut found: Vec<(usize, Func)> = Vec::new();
    let mut faces: std::collections::BTreeMap<TypeId, crate::hir::SignatureFace> =
        std::collections::BTreeMap::new();
    for (at, layout) in program.layouts.iter().enumerate() {
        if !is_signature(layout) || layout.methods.get(slot).is_some_and(Option::is_some) {
            continue;
        }
        // The layout's own id, not a caller's. A signature the program wrote and
        // the type the checker inferred for an arrow are two ids over one
        // signature, and only the layout's is one any backend can resolve a class
        // from -- the same reasoning `relate_closures_to_signatures` gives for its
        // `base`.
        let Some(&base) = layout.types.first() else {
            continue;
        };
        // **The location is where the signature was written**, reached through
        // the type's symbol. A `Layout` carries no span -- it is a shape, not a
        // place -- and a declaration still owes a diagnostic somewhere real. Where
        // the checker interned the type without a symbol (an inferred function
        // type, which is the arrow's own rather than a written signature) there is
        // nothing to point at, and a layout of that kind is a closure's, whose
        // slot `closure_layout` filled already.
        let origin = signature_origin(snapshot, layout, &mentions);
        // **The typed face, recorded beside the erased declaration.** A backend
        // receives only a `Program`, so a Java-callable `call(double)` cannot ask
        // the checker for the parameter list -- and when A6 removed the typed slot
        // this surface was keyed on, the whole of it vanished with nothing red.
        // See `super::Program::signature_faces`, which carries that account.
        //
        // Keyed by the *signature's* id rather than by `base`, which is
        // `layout.types.first()` and need not be the function-typed one.
        if let Some((id, signature)) = signature_of(layout)
            && let Some(record) = snapshot.signatures.get(signature.0 as usize)
        {
            let params = record
                .parameters
                .iter()
                .map(|parameter| crate::hir::SignatureFacePart {
                    // `representation` and not `represent`: this runs after
                    // lowering and must not *create* a layout for a type the
                    // program does not carry -- the trap `presence_of_key` and
                    // `record_parents` both record.
                    ty: representation(snapshot, parameter.ty),
                    optional: parameter.optional,
                    rest: parameter.rest,
                })
                .collect();
            faces.insert(
                id,
                crate::hir::SignatureFace {
                    params,
                    returns: representation(snapshot, record.return_type),
                },
            );
        }
        let receiver = Param {
            name: "v0".to_owned(),
            ty: HirType::Managed(ManagedType::Object(base)),
            origin: origin.clone(),
            shape: ParamShape::Ordinary,
            known: Facts::TOP,
            written: None,
        };
        // The same builder the implementations use, so a declaration and every
        // body that overrides it cannot drift apart.
        let Some((params, values)) =
            uniform_params(&receiver, &[], &origin, hierarchy.erased_call_arity)
        else {
            continue;
        };
        found.push((
            at,
            Func {
                name: format!("{}#erased_call", layout.name),
                params,
                // A declaration is its signature: the parameters keep their value
                // ops because those *are* the signature in this IR, and the
                // single block says there is nothing else.
                return_type: HirType::Erased,
                values,
                blocks: vec![Block {
                    params: Vec::new(),
                    ops: Vec::new(),
                    terminator: Terminator::Unreachable,
                }],
                origin,
                exported: false,
                initializes_receiver: false,
                abstract_declaration: true,
                async_result: None,
                frame: None,
                obligations: Vec::new(),
                exact: rustc_hash::FxHashMap::default(),
                written_return: None,
                result_absent: crate::hir::Absent::Impossible,
                validation: None,
                written_return_elements: Vec::new(),
            },
        ));
    }
    // Sorted, so one compiler on one input emits them in one order.
    found.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    for (layout, shell) in found {
        let table = hierarchy.table_size();
        if program.layouts[layout].methods.len() < table {
            program.layouts[layout].methods.resize(table, None);
        }
        program.layouts[layout].methods[slot] = Some(shell.name.clone());
        program.funcs.push(shell);
    }
    program.signature_faces = faces;
}

/// Fill [`Hierarchy::raising_call_slot`] on every layout that fills the ordinary one.
///
/// **Every callable class must fill it or a call through it is an
/// `AbstractMethodError`** — the rule `refuses_to_cross` states for the entry beside
/// it, applied to the second slot. Two answers, and they are the two
/// `lower_wanted_closures` leaves behind:
///
///   a `@raises` entry exists  name it. Either it wraps a body that records an
///                             uncaught `throw` and returns, which is what a `try`
///                             needs, or it is the abort made where that body could
///                             not be — and the site that reached it is named.
///   none at all               name the **ordinary** entry. The raising body is the
///                             same program — measured at 98% of closures — so it
///                             has nothing to raise and cannot end anything.
///
/// **Two rather than three, and that is a property of the producer.** An absent
/// `@raises` entry used to mean either "the two are one program" or "it refused",
/// which are opposite treatments of one absence; the abort is made where the body
/// is, so nothing here has to tell them apart. See `lower_wanted_closures`.
///
/// Driven by what already fills `erased_call_slot` rather than by asking which
/// layouts are closures, so "is this callable" keeps the single answer
/// `declare_erased_entries` established — and a signature layout, whose ordinary
/// entry is a named abort, gets that same abort here for the same reason.
fn declare_raising_entries(hierarchy: &Hierarchy, program: &mut Program) {
    let (Some(erased), Some(raising)) = (
        hierarchy.erased_call_slot.map(|slot| slot as usize),
        hierarchy.raising_call_slot.map(|slot| slot as usize),
    ) else {
        return;
    };
    let made: rustc_hash::FxHashMap<&str, bool> = program
        .funcs
        .iter()
        .map(|func| (func.name.as_str(), func.abstract_declaration))
        .collect();
    let table = hierarchy.table_size();
    let mut fill: Vec<(usize, String)> = Vec::new();
    let mut declare: Vec<String> = Vec::new();
    for (at, layout) in program.layouts.iter().enumerate() {
        let Some(Some(ordinary)) = layout.methods.get(erased) else {
            continue;
        };
        let with_suffix = format!("{ordinary}{RAISING_SUFFIX}");
        if made.contains_key(with_suffix.as_str()) {
            fill.push((at, with_suffix));
            continue;
        }
        // **A declaration is declared twice, a body is named twice.** A signature
        // layout's ordinary entry is an `abstract_declaration` -- a shape with no
        // program in it -- and naming that one entry in both slots makes the two
        // slots one *member* on any backend that names a slot after the layout
        // that declares it. The JVM does, and said so: `NTS4004 `Closure0` could
        // not be written: this class declares the method
        // `erased_call(Lnts/rt/NtsValue;)Lnts/rt/NtsValue;` twice`, because
        // `declared_member` walked both slots up to the same `Fn3__3#erased_call`.
        //
        // So a declaration gets a second declaration under the raising name, and a
        // *body* is simply named again -- there is nothing to duplicate about a
        // body, and a closure whose raising variant is the same program genuinely
        // has one function serving both slots.
        if made.get(ordinary.as_str()) == Some(&true) {
            declare.push(ordinary.clone());
            fill.push((at, with_suffix));
        } else {
            fill.push((at, ordinary.clone()));
        }
    }
    // Sorted and deduplicated, so one compiler on one input emits them in one
    // order and a layout's declaration is written once however many layouts share
    // it.
    declare.sort();
    declare.dedup();
    for name in declare {
        let Some(shape) = program.funcs.iter().find(|func| func.name == name) else {
            continue;
        };
        let mut second = shape.clone();
        second.name = format!("{name}{RAISING_SUFFIX}");
        program.funcs.push(second);
    }
    for (at, name) in fill {
        if program.layouts[at].methods.len() < table {
            program.layouts[at].methods.resize(table, None);
        }
        program.layouts[at].methods[raising] = Some(name);
    }
}

pub(super) fn relate_closures_to_signatures(
    snapshot: &SemanticSnapshot,
    closures: &[ClosureInfo],
    hierarchy: &Hierarchy,
    program: &mut Program,
) {
    let Some(slot) = hierarchy.closure_slot.map(|slot| slot as usize) else {
        return;
    };
    // Collected first and applied after, because deciding needs the funcs and
    // the layouts at once and applying mutates both.
    let mut relate: Vec<(usize, TypeId, String)> = Vec::new();
    let mut declare: Vec<(usize, Func)> = Vec::new();
    // One declaration per signature, not per closure. Every closure of a type
    // queues the same relation, and the layout is only written after the loop,
    // so a test against the layout is a test against the state before any of
    // them -- sixteen `Fn2#call`s in `captured-by-reference`, which `verify`
    // caught as `DuplicateFunction` on the first run.
    let mut declared_for: rustc_hash::FxHashSet<usize> = rustc_hash::FxHashSet::default();
    // What each signature's closures return, beside the result the signature
    // declares: see [`shared_generator_result`].
    let mut returned: rustc_hash::FxHashMap<usize, (TypeId, Vec<HirType>)> =
        rustc_hash::FxHashMap::default();

    for (index, info) in closures.iter().enumerate() {
        // A job's node is the `then` it calls, whose type is `then`'s and not
        // the job's: a job takes nothing and is never a value the program
        // holds, so there is no signature for it to be related to.
        if matches!(info.source, ClosureSource::Job { .. }) {
            continue;
        }
        let (class, method) = closure_names(index);
        let Some(at) = program
            .layouts
            .iter()
            .position(|layout| layout.name == class)
        else {
            continue;
        };
        let Some(&ty) = snapshot.node_types.get(&info.node) else {
            continue;
        };
        let Some(record) = snapshot.types.get(ty.0 as usize) else {
            continue;
        };
        // A function type, and one the program named. See above.
        //
        // **Or a resolving function's, named or not.** The ambiguity that
        // keeps an unnamed type out -- two ids for one written signature --
        // cannot reach one: its node is the `then` parameter it is passed as,
        // so its type is that parameter's own id rather than one the checker
        // inferred, and the layout it has to extend is the one holding exactly
        // that id. Without the relation the JVM refuses the job, which stores
        // the closure where the parameter's class is declared; C and LLVM
        // accept it because a pointer is a pointer, which is not agreement.
        let exact = matches!(info.source, ClosureSource::Resolving { .. });
        if !matches!(record.kind, TypeKind::Function(_)) || (record.symbol.is_none() && !exact) {
            continue;
        }
        // *Not* the layout for this exact type id. The arrow's own type is the
        // signature the checker inferred for it, and the slot it is stored into
        // is declared with the type the program *wrote* -- two ids for one
        // signature, and only the second has a layout. `function-values` has
        // the arrow at type 1 and the declaration at type 8.
        //
        // So the two are related by their signatures rather than by their ids:
        // the parameter types and the return type, which are themselves ids the
        // checker has already interned. That is asking the checker whether two
        // function types are the same signature, which it can answer, rather
        // than guessing from a shape.
        let Some(key) = signature_key(snapshot, ty) else {
            continue;
        };
        // Any layout but *this closure's own*, which is not the same exclusion
        // as any id but this closure's type id.
        //
        // For an arrow they coincide, which is why the second was written and
        // why it stood: the arrow's inferred type is one id and the slot's
        // declared type is another, so excluding the id excluded the closure
        // and left the signature.
        //
        // For a named function used as a value they do not. `{ doubled }` has
        // one id for both -- the declaration *is* the written type -- so
        // excluding the id excluded the answer, and the closure got no base.
        // It looked like it worked, because a *second* function of the same
        // signature puts a second id in the signature's layout and the
        // exclusion then passes over it. One entry failed and two entries
        // passed, and the JVM said so as `Type 'Closure0' is not assignable to
        // 'Fn2__2'` at class load -- two unrelated final classes where the
        // field descriptor named the base.
        //
        // So the question is asked of the layout rather than of the id.
        let matching: Vec<usize> = program
            .layouts
            .iter()
            .enumerate()
            .filter(|(index, layout)| {
                *index != at
                    && layout.types.iter().any(|&other| {
                        if exact {
                            other == ty
                        } else {
                            signature_key(snapshot, other).is_some_and(|found| found == key)
                        }
                    })
            })
            .map(|(at, _)| at)
            .collect();
        // Exactly one, or leave it alone. Two layouts for one signature is the
        // case that would give two closures two different bases for the same
        // type, which is what this is forbidden from guessing at.
        let [signature] = matching[..] else {
            continue;
        };
        let Some(call) = program.funcs.iter().find(|func| func.name == method) else {
            continue;
        };
        // The id the *signature's layout* carries, not the arrow's. `base` is
        // resolved by finding the layout that holds the id, and no layout holds
        // the arrow's own -- which is the whole reason the two had to be
        // matched by signature rather than by identity a few lines up. The
        // declaration's receiver is typed with it for the same reason: a
        // parameter whose type no layout answers for has no representation,
        // and the backend refuses the dispatch rather than the type.
        let Some(&base) = program.layouts[signature].types.first() else {
            continue;
        };
        let declared = format!("{}#call", program.layouts[signature].name);
        if declared_for.insert(signature)
            && program.layouts[signature]
                .methods
                .get(slot)
                .is_none_or(Option::is_none)
        {
            declare.push((
                signature,
                declaration_shell(call, &declared, HirType::Managed(ManagedType::Object(base))),
            ));
        }
        returned
            .entry(signature)
            .or_insert_with(|| (key.1, Vec::new()))
            .1
            .push(call.return_type.clone());
        relate.push((at, base, declared));
    }

    for (signature, mut shell) in declare {
        if let Some((result, results)) = returned.get(&signature)
            && let Some(shared) = shared_generator_result(snapshot, *result, results)
        {
            shell.return_type = shared;
        }
        let table = hierarchy.table_size();
        if program.layouts[signature].methods.len() < table {
            program.layouts[signature].methods.resize(table, None);
        }
        program.layouts[signature].methods[slot] = Some(shell.name.clone());
        program.funcs.push(shell);
    }
    for (at, ty, _) in relate {
        program.layouts[at].base = Some(ty);
    }
}

/// Lay out every function type the program holds a value of.
///
/// A layout is discovered by whatever asks `layout_of`, and a signature is
/// asked about where a signature mentions it (`materialize`). A *value* can
/// have a function type no signature mentions: a generic call's erased result
/// unerased to `const functionIdentity: (value: (n: number) => number) => (n:
/// number) => number = identity`'s declared result type, one of three ids the
/// checker made for `(n: number) => number` in that program and the one
/// nothing asked about. The backend then declined the function -- "an object
/// type with no layout" -- and the JVM, given a layout, would still have
/// failed its `checkcast` had the closure's class not extended it.
///
/// So each such id gets [`signature_layout`] through `collect_layouts`, which
/// merges it into the layout already holding that signature -- they are named
/// by `signature_key` -- or adds it. Before `relate_closures_to_signatures`,
/// which then makes every closure of the signature extend it.
pub(super) fn lay_out_held_signatures(
    layout_collector: &mut LayoutCollector,
    snapshot: &SemanticSnapshot,
    program: &mut Program,
) {
    let laid: rustc_hash::FxHashSet<TypeId> = layout_collector
        .layouts()
        .iter()
        .flat_map(|layout| layout.types.iter().copied())
        .collect();
    let mut held: Vec<TypeId> = Vec::new();
    let mut note = |ty: &HirType| objects_in(ty, &mut held);
    for func in &program.funcs {
        note(&func.return_type);
        func.params.iter().for_each(|param| note(&param.ty));
        func.values.iter().for_each(|value| note(&value.ty));
    }
    for layout in layout_collector.layouts() {
        layout.fields.iter().for_each(|field| note(&field.ty));
    }
    held.sort_by_key(|ty| ty.0);
    held.dedup();
    let unlaid: Vec<Layout> = held
        .into_iter()
        .filter(|ty| !laid.contains(ty) && signature_key(snapshot, *ty).is_some())
        .map(|ty| signature_layout(snapshot, ty))
        .collect();
    layout_collector.collect(program, unlaid);
}

/// A function type's layout: no fields, and no methods until a closure
/// declares its `call` there (`relate_closures_to_signatures`).
///
/// A function type has no fields because two closures of one type differ by
/// what they captured, and that is their own class's business.
pub(super) fn signature_layout(snapshot: &SemanticSnapshot, ty: TypeId) -> Layout {
    Layout {
        types: vec![ty],
        name: signature_name(snapshot, ty),
        interfaces: Vec::new(),
        fields: Vec::new(),
        methods: Vec::new(),
        // A function type is a signature, not a class.
        base: None,
    }
}

impl FuncBuilder<'_> {
    /// Keep a closure admitted into a signature slot, for the comparison this
    /// cannot make yet. See [`Arrivals::at_signature`].
    ///
    /// Extracted when `coerce_arm` reached 117 lines, and the concept earns the
    /// name: this is the only place in the compiler where "this closure was let
    /// into that slot" is visible, and the arm it sits in returns the pointer
    /// unchanged a line later.
    pub(super) fn record_arrival(&mut self, have: &HirType, want: &HirType, id: NodeId) {
        let (
            HirType::Managed(ManagedType::Object(from)),
            HirType::Managed(ManagedType::Object(to)),
        ) = (have, want)
        else {
            return;
        };
        if from == to {
            return;
        }
        let Some((params, ret)) = signature_key(self.snapshot, *to) else {
            return;
        };
        if self
            .layouts
            .iter()
            .find(|layout| layout.types.contains(from))
            .is_some_and(|layout| is_signature_name(&layout.name))
        {
            self.arrivals.signature_flows.push((*from, *to));
            return;
        }
        let closure = self
            .layouts
            .iter()
            .find(|layout| layout.types.contains(from))
            .is_some_and(|layout| {
                !is_signature_name(&layout.name)
                    && layout
                        .methods
                        .iter()
                        .flatten()
                        .any(|m| m.ends_with("#call"))
            });
        if !closure {
            self.arrivals.opaque_arrivals.push(*to);
            return;
        }
        let parameters = params.iter().map(|t| self.represent(*t)).collect();
        let kinds = params
            .iter()
            .map(|t| crate::hir::native::scalar(self.snapshot, *t))
            .collect();
        let returns = self.represent(ret);
        let origin = self.origin(id);
        self.arrivals.at_signature.push(Arrival {
            closure: *from,
            signature: *to,
            origin,
            parameters,
            returns,
            kinds,
        });
    }
}

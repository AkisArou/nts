//! Emit the entry and suspension operations of generators and async bodies, including their frame and promise setup.

use super::{
    ClosureInfo, ClosureSource, DeclarationModifiers, Diagnostic, FuncBuilder, GeneratorKind,
    HirType, Layout, ManagedType, NodeId, OpKind, Representation, SemanticSnapshot, Step, TypeId,
    TypeKind, ValueId, Walk, provided, representation_within, syntax,
};

/// Which generator each `function*` is, in source order. See
/// [`Naming::generators`](super::Naming::generators), and [`class_token_indices`](super::class_token_indices) beside it -- the same
/// shape of walk, lifted out for the same reason.
pub(super) fn generator_indices(
    snapshot: &SemanticSnapshot,
) -> rustc_hash::FxHashMap<NodeId, usize> {
    let mut generators: rustc_hash::FxHashMap<NodeId, usize> = rustc_hash::FxHashMap::default();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::GENERATOR)
        {
            let next = generators.len();
            generators.insert(NodeId(u32::try_from(index).unwrap_or(u32::MAX)), next);
        }
    }
    generators
}

/// Every `Generator<T, …>` the program mentions, in type order.
///
/// Scanned over all types rather than over the `function*` declarations,
/// because a program may *name* one without declaring one -- `function
/// drain(g: Generator<number>)` in a file whose generator lives elsewhere. The
/// representation and the layout have to agree about which ids are abstract
/// generators, and the cheapest way to make them agree is to derive both from
/// the same scan.
fn abstract_generators(snapshot: &SemanticSnapshot) -> Vec<TypeId> {
    (0..snapshot.types.len())
        .map(|index| TypeId(u32::try_from(index).unwrap_or(u32::MAX)))
        .filter(|ty| abstract_generator_kind(snapshot, *ty).is_some())
        .collect()
}

/// Whether a type is an abstract generator, and which protocol it speaks.
///
/// **One derivation, used by all four places that ask.** The name was written
/// out at each of them -- the scan above, `represent`, the `for...of` arm and
/// the layout -- and the four had to keep agreeing about a string. Adding
/// `AsyncGenerator` to three of four would have produced a type that
/// represents as an object and then has no layout, which is an object type the
/// program cannot name.
///
/// `Generator` and `AsyncGenerator` **alone**, deliberately: `Iterator<T>`,
/// `IterableIterator<T>` and their async twins are satisfied by a hand-written
/// object with a `next`, and that shape already works as a protocol object with
/// a `{ value, done }` result. Representing those names as a frame would take
/// the working case and give it the wrong machine value.
pub(super) fn abstract_generator_kind(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
) -> Option<GeneratorKind> {
    match provided(snapshot, ty)? {
        "Generator" => Some(GeneratorKind::Sync),
        "AsyncGenerator" => Some(GeneratorKind::Async),
        _ => None,
    }
}

/// The class an abstract generator is emitted as, and the resumption it
/// declares.
fn abstract_generator_names(index: usize, kind: GeneratorKind) -> (String, String) {
    let class = match kind {
        GeneratorKind::Sync => format!("Generator{index}"),
        GeneratorKind::Async => format!("AsyncGenerator{index}"),
    };
    // **`step` for the async one, and the difference is load-bearing on one
    // backend.** The JVM gives every frame that a promise can resume a fixed
    // `Resumable.resume()V`, and it names a dispatch slot's forwarder after the
    // member the layout declares. A synchronous generator has no `Suspend`
    // operation -- a `yield` returns to a caller rather than subscribing -- so
    // it never has both, and `#resume` was free. An async generator has both,
    // and two `resume()V` in one class is `java.lang.ClassFormatError:
    // Duplicate method name`, which is a load failure rather than a compile
    // one: 17 aborts, on the lane that was green a minute earlier.
    //
    // It is also the better name. What the slot holds is what a consumer calls
    // to get the *next element*, and for an async generator that is a step
    // which may suspend several times before answering -- "resume" names what
    // happens to the frame, and this is named for what the caller asked.
    let method = match kind {
        GeneratorKind::Sync => format!("{class}#resume"),
        GeneratorKind::Async => format!("{class}#step"),
    };
    (class, method)
}

/// The result a signature's declaration gives when its closures are generators
/// returning different frames: the abstract generator every frame extends.
///
/// The declaration is otherwise the first closure's `call`, and a generator's
/// `call` returns that generator's own frame, a class no other closure's `call`
/// returns. A second generator's `call` then overrides nothing, and the JVM
/// declines it (NTS4009; tests/programs/two-generator-closures-called-through-
/// one-signature). Each frame extends the `Generator<T, …>` its closure
/// declares, which is the signature's own result, so the declaration takes that
/// and each `call` narrows it: the covariant override the JVM bridges.
///
/// Only then. One closure, or several returning one frame, keep the frame. It
/// is the stronger fact: whatever holds it reaches that frame's resumption
/// without a dispatch.
pub(super) fn shared_generator_result(
    snapshot: &SemanticSnapshot,
    result: TypeId,
    results: &[HirType],
) -> Option<HirType> {
    let mut frames = results
        .iter()
        .map(|returned| match returned {
            HirType::Managed(ManagedType::Object(ty)) if crate::hir::is_generator_frame(*ty) => {
                Some(*ty)
            }
            _ => None,
        })
        .collect::<Option<Vec<TypeId>>>()?;
    frames.sort_unstable_by_key(|ty| ty.0);
    frames.dedup();
    (frames.len() > 1 && abstract_generator_kind(snapshot, result).is_some())
        .then_some(HirType::Managed(ManagedType::Object(result)))
}

/// The types the runtime provides, rather than the program.
///
/// `Promise`, `Map`, `Set` and `Date` are one family by the standard this
/// module already applies: each has a fixed C struct rather than a generated
/// layout, so giving one an object layout would be a shape with fields nothing
/// may read. Grouped here because they are decided the same way — by the
/// declared name — and because `representation_of` is a single `match` that
/// this had grown past a hundred lines.
/// What a `Generator<T, …>` yields, at the representation the frame's field
/// holds — and `None` where the checker recorded no argument at all.
///
/// **A `void` element is a real answer and not a representable one.**
/// `Generator<void, void, string>` is a generator driven entirely by what the
/// caller passes to `next(v)`; it yields nothing, so the prefix's `yielded`
/// field has no type, and C says so exactly: `field has incomplete type 'void'`.
///
/// A concrete frame never met this, because a frame is only built for a
/// generator that lowers and none with a `void` element ever did. The abstract
/// generator is emitted whenever a *signature* names one, which is the first
/// time such a layout has existed. It cost the `fs` and `readline` addons their
/// build, and the refusal counts said nothing — the cascade was identical to the
/// byte and only the emitted C differed.
pub(super) fn generator_element_type(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    path: &mut Vec<TypeId>,
    subst: &Representation<'_>,
) -> Option<HirType> {
    let argument = *snapshot
        .type_arguments
        .get(&ty)
        .and_then(|arguments| arguments.first())?;
    // Through `yielded_slot`, which is where the uninhabited-element rule
    // lives. See its doc comment: four places derive this and a placeholder
    // applied to fewer than all of them is a store and a load that disagree.
    Some(crate::hir::suspend::yielded_slot(representation_within(
        snapshot, argument, path, subst,
    )?))
}

/// What an `async` function returns, and what it settles with.
#[derive(Clone)]
pub(super) struct AsyncResult {
    /// The promise allocated on entry. Every `return` settles this one and
    /// hands it back, so the function's HIR return type is the promise rather
    /// than the payload.
    pub(super) promise: ValueId,
    /// The payload's representation, which is what says whether settling emits
    /// `nts_promise_fulfill_number`, `_reference` or `_void`.
    pub(super) payload: HirType,
    /// The scalar kind the payload was written as (`Promise<c_long>`).
    pub(super) written: Option<crate::hir::native::Scalar>,
}

impl FuncBuilder<'_> {
    /// Reserve the frame a `function*` yields into, if this is one.
    ///
    /// Returns `None` for an ordinary function. The reservation is two facts --
    /// a synthetic type id and what `yield` produces -- and both are said
    /// *here* because two passes have to agree about them: [`crate::hir::suspend`]
    /// builds the layout, and the `for...of` that walks the generator reads the
    /// element out of it. A disagreement between those two is a load typed one
    /// way against a store typed the other, at the same offset of the same
    /// object, which is a wrong answer rather than an error.
    pub(super) fn begin_generator(
        &mut self,
        id: NodeId,
    ) -> Result<Option<crate::hir::GeneratorFrame>, Diagnostic> {
        if !self
            .node(id)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::GENERATOR)
        {
            return Ok(None);
        }
        let kind = if self
            .node(id)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::ASYNC)
        {
            GeneratorKind::Async
        } else {
            GeneratorKind::Sync
        };
        // `Generator<T, TReturn, TNext>` or `AsyncGenerator<…>`, and `T` is the
        // element in both. Read from the
        // checker's type arguments rather than from the annotation, so an
        // unannotated `function*` works the same way -- which is how the
        // promise's payload is read three functions below.
        let Some(returned) = self.snapshot.node_types.get(&id).copied() else {
            return Err(self.unsupported(id, "a generator whose type the checker did not give"));
        };
        let Some(TypeKind::Function(signature)) = self
            .snapshot
            .types
            .get(returned.0 as usize)
            .map(|r| &r.kind)
        else {
            return Err(self.unsupported(id, "a generator with no call signature"));
        };
        let signature = *signature;
        let Some(signature) = self.snapshot.signatures.get(signature.0 as usize) else {
            return Err(self.unsupported(id, "a generator with no call signature"));
        };
        let declared = self.generator_in_context(id, signature.return_type);
        let Some(argument) = self
            .snapshot
            .type_arguments
            .get(&declared)
            .and_then(|arguments| arguments.first())
            .copied()
        else {
            // No recorded argument is not `Generator<void>`: it means the
            // frontend stopped at the library boundary. Defaulting to `void`
            // would make every element nothing, and the walk would read a slot
            // no `yield` ever filled.
            return Err(self.unsupported(id, "a generator whose element type is not recorded"));
        };
        let Some(yields) = self.represent(argument) else {
            return Err(self.unrepresentable(id, "a generator's element"));
        };
        // A generator that yields *nothing*, in the two spellings the checker
        // uses for it.
        //
        // `Generator<void, …>` is one -- driven entirely by what the caller
        // passes to `next(v)` -- and **`never` is the other**, which is what a
        // `function*` with no `yield` statement in it infers. Either way there
        // is no element, so the frame's `yielded` slot has no type and the
        // abstract generator cannot be laid out: C answers `field has
        // incomplete type 'void'` for the first and `a value of type \`never\`
        // reached code generation` for the second.
        //
        // **The `never` half was missing**, and it was reachable: a `for...of`
        // over `function* g() {}` emitted nothing, exited 0 and left `cc` to
        // fail -- 119 files of the slice-1 `test/language` population reach it
        // through a class's generator method. Refused here rather than at the
        // layout, and rather than at either reader, because the honest sentence
        // is about the generator: a walk's would name a loop and a `next()`'s
        // would name a call, and both were written before this was found.
        // **Supporting the `never` half was attempted and reverted**, and what
        // it would take is worth writing down: the element has *at least three*
        // independent derivations, and a placeholder width applied to fewer
        // than all of them is a store and a load that disagree.
        //
        //   `begin_generator`      builds the concrete frame's slot
        //   `generator_element`    reads out of the frame, from the type
        //   `layout_of(declared)`  the abstract `Generator<…>` the frame
        //                          *extends*, whose own field comes from the
        //                          library type
        //
        // Patching the first two gave `BrokenBase { layout: "silent#frame",
        // base: "Generator0" }`; patching the second alone gave `StoreType
        // { expected: Int { bits: 32 }, found: Float { bits: 64 } }`. It is one
        // derivation's worth of refactor, not a placeholder.
        //
        // It is also worth knowing what it buys: 125 slice-1 files, all of them
        // one generated `class/dstr` matrix testing *destructuring in a
        // parameter*, where the `function*` is incidental. A count from one
        // matrix is not 125 language facts.
        let yields = crate::hir::suspend::yielded_slot(yields);
        let Some(index) = self.generators.get(&id).copied() else {
            return Err(self.unsupported(id, "a generator outside every walk"));
        };
        // Demanded here rather than left to whoever first names one in a
        // signature, because the frame this is about to reserve *extends* it.
        // A base naming a layout the program does not carry is a dangling
        // relation, and on a backend that relates classes by name rather than
        // by offset it is the difference between a subtype and a link error.
        self.layout_of(id, declared)?;
        let frame = crate::hir::GeneratorFrame {
            parameter_entry: None,
            ty: crate::hir::generator_frame(index),
            kind,
            yields,
            declared,
        };
        self.generator = Some(frame.clone());
        Ok(Some(frame))
    }

    /// Allocate the promise an `async` function settles, if this is one.
    ///
    /// Returns `None` for an ordinary function, which is the signal to close
    /// the body the ordinary way.
    pub(super) fn begin_async(
        &mut self,
        id: NodeId,
        return_type: &HirType,
    ) -> Result<Option<AsyncResult>, Diagnostic> {
        if !self
            .node(id)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::ASYNC)
        {
            return Ok(None);
        }
        // An `async function*` is `async` and settles **no** promise of its
        // own. Calling one runs none of its body and hands back a frame, so
        // there is nothing here to allocate: the promise an async generator
        // settles is per *step*, it belongs to whoever asked for that step, and
        // it is made at the consumer rather than at the declaration.
        //
        // Asked before the `Promise<T>` test below rather than after, because
        // the checker types an `async function*` as `AsyncGenerator<T, …>` --
        // not a promise -- so the test would report it as a result this
        // lowering could not represent. It said "a function type", which is
        // true of the declaration and says nothing about the generator.
        if self
            .node(id)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::GENERATOR)
        {
            return Ok(None);
        }
        // The checker gives an `async` function a `Promise<T>` return type
        // whether or not the source wrote one, so anything else here is a type
        // this lowering could not represent rather than a function that is not
        // async.
        let HirType::Managed(ManagedType::Promise(payload)) = return_type else {
            return Err(self.unrepresentable(id, "an `async` function's result"));
        };
        let origin = self.origin(id);
        let promise = self.runtime_call("nts_promise_new", Vec::new(), return_type.clone(), origin);
        let result = AsyncResult {
            promise,
            payload: (**payload).clone(),
            written: self.written_return(id),
        };
        self.async_result = Some(result.clone());
        Ok(Some(result))
    }

    /// The frame a generator reserves, and the type the function hands back.
    ///
    /// **One routine, because three lowering paths need it and each learned that
    /// separately.** A generator's *declared* `Generator<T, …>` has no
    /// representation and is not what the compiled function returns -- the frame
    /// is -- and the frame is deliberately **not** materialized, because
    /// `hir::suspend` builds its layout and is the only thing that can: what goes
    /// in one is what survives a suspension.
    ///
    /// `begin_generator` had one caller and then two, and each time the path that
    /// did not ask lowered a generator's body as an ordinary function, so every
    /// `yield` in it said "a `yield` outside a generator" -- true of the lowering
    /// and false of the source. A method was the second (the comment at that call
    /// site records it) and a `function*` **expression** was the third, which is
    /// what test262 builds every `dstr/` iterator with and which the conformance
    /// lane counts at 460 of the corpus's ~800 no-verdict rows. Written as a
    /// function the three share rather than as a third clause, so a fourth path
    /// gets it by calling this.
    /// **An authored `async` closure's promise comes before its parameters**, as
    /// an `async` function's does (see `lower_function`): binding them is part of
    /// the call the promise answers, so a pattern's `TypeError` rejects it. Its
    /// return type does not wait on the inputs -- only a generator's parameter
    /// entry answers one early, and an `async` closure that is not a generator
    /// has none. `None` for every other closure, which allocates after.
    #[expect(
        clippy::type_complexity,
        reason = "the three things lower_closure takes back"
    )]
    pub(super) fn promise_before_inputs(
        &mut self,
        id: NodeId,
        info: &ClosureInfo,
    ) -> Result<
        Option<(
            Option<crate::hir::GeneratorFrame>,
            HirType,
            Option<AsyncResult>,
        )>,
        Diagnostic,
    > {
        let modifiers = self.node(id).modifiers;
        if !matches!(info.source, ClosureSource::Authored)
            || !modifiers.contains(DeclarationModifiers::ASYNC)
            || modifiers.contains(DeclarationModifiers::GENERATOR)
        {
            return Ok(None);
        }
        let (generated, return_type) = self.reserved_return_type(id)?;
        let asynchronous = self.begin_async(id, &return_type)?;
        Ok(Some((generated, return_type, asynchronous)))
    }

    /// `yield e`.
    ///
    /// Lowered to [`OpKind::Yield`] and left there, for the reason `await` is:
    /// which values have to survive the suspension is a whole-function question
    /// and this walk cannot answer it. See [`super::suspend`](crate::hir::suspend).
    ///
    /// Two things are refused here rather than downstream, because both are
    /// about what the *walk* on the other end can do.
    ///
    /// `yield*` delegates to another iterable, which is a loop the caller
    /// cannot see -- one `next` on this generator is an unbounded number of
    /// steps on the inner one, and the state machine would need a nested cursor
    /// in the frame rather than a state number.
    ///
    /// The **value** of a `yield` is what the caller passed to `next(v)`, and a
    /// `for...of` never passes one: it calls `next()` with nothing, so the
    /// expression is always `undefined` there. Using it means the program
    /// expects a two-way conversation, and answering `undefined` to that is a
    /// wrong answer rather than a missing feature.
    pub(super) fn lower_yield(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        if self.generator.is_none() {
            return Err(self.unsupported(id, "a `yield` outside a generator"));
        }
        if self
            .children(id)
            .iter()
            .any(|child| self.kind_of(*child) == Some(syntax::ASTERISK_TOKEN))
        {
            if !self.is_a_statement(id) {
                // The *value* of a `yield*` is the inner iterator's return
                // value -- its `TReturn`, not any of its elements -- which is a
                // second feature wearing the same syntax. Refused separately so
                // the message says which one is missing.
                return Err(self.unsupported(id, "the value of a `yield*`"));
            }
            let operand = *self
                .children(id)
                .iter()
                .find(|child| self.kind_of(**child) != Some(syntax::ASTERISK_TOKEN))
                .ok_or_else(|| self.unsupported(id, "a `yield*` of nothing"))?;
            return self.lower_yield_star(id, operand);
        }
        if !self.is_a_statement(id) {
            return Err(self.unsupported(id, "the value of a `yield`"));
        }
        let operand = *self
            .children(id)
            .iter()
            .find(|child| self.kind_of(**child) != Some(syntax::ASTERISK_TOKEN))
            .ok_or_else(|| self.unsupported(id, "a `yield` of nothing"))?;
        let yields = self
            .generator
            .as_ref()
            .map_or(HirType::Void, |frame| frame.yields.clone());
        let value = self.lower_expression(operand)?;
        // At the frame's representation, exactly as a `return` is at the
        // function's: the store and the walk's load are the same field, and
        // coercing at one end only is how they come to disagree.
        let value = self.coerce(value, &yields, operand)?;
        let origin = self.origin(id);
        Ok(self.push(OpKind::Yield { value }, HirType::Void, origin))
    }

    /// `yield* e`: delegate to another iterable.
    ///
    /// It *is* a walk with a `yield` where the body would be, which is what
    /// `yield*` means — and building it that way rather than as a new kind of
    /// suspension is what makes the hard part disappear.
    ///
    /// The hard part, as this file described it for a long time: one `next` on
    /// the outer generator is an unbounded number of steps on the inner one, so
    /// the state machine needs a nested cursor in the frame rather than a state
    /// number. That is true, and **the frame already grows one**. The cursor is
    /// a value live across the `yield` in the body, so [`super::suspend`](crate::hir::suspend)'s
    /// spilling puts it in the frame with everything else that survives a
    /// suspension. Nothing here has to arrange it; the machinery that exists for
    /// ordinary locals is the machinery a nested walk needs.
    ///
    /// So the nesting has no fixed depth and needs none: each `yield*` is its
    /// own loop with its own spilled cursor, and two nested ones are two
    /// cursors, exactly as two nested `for...of` loops in one generator already
    /// were.
    ///
    /// Every shape `for...of` knows arrives for nothing — an array, a string by
    /// code point, a `Map` or `Set`, a user type with `[Symbol.iterator]`, and
    /// another generator, including one that arrived as a parameter. That last
    /// is why this could not have been built before `Generator<T, …>` had a
    /// representation: `yield* source` where `source` is a parameter is the
    /// commonest spelling in the corpus.
    ///
    /// The **statement** form only. A `yield*` used as a value answers the inner
    /// iterator's `TReturn`, which is a different feature and says so.
    fn lower_yield_star(&mut self, id: NodeId, operand: NodeId) -> Result<ValueId, Diagnostic> {
        let yields = self
            .generator
            .as_ref()
            .map_or(HirType::Void, |frame| frame.yields.clone());
        let (sequence, forced) = self.sequence_source(operand);
        let sequence_value = self.lower_expression(sequence)?;
        let walk = self.walk_of(sequence, sequence_value, forced, 1)?;
        let origin = self.origin(id);

        let (sequence_value, index, lent) = self.walk_start(&walk, sequence_value, &origin)?;
        let carried: Vec<u32> = index.into_iter().collect();
        // `steps: true` where there is a cursor, so the advance happens in a
        // latch of the loop's own rather than at the end of the body. The two
        // cursorless walks take `false` and make the header the latch, because
        // their step *is* the header.
        let steps = !matches!(walk, Walk::Protocol { .. } | Walk::Generator { .. });
        let record = self.begin_loop(id, &carried, steps, &origin)?;

        let (stepped, at) = if let Some(index) = index {
            (None, self.bindings[&index])
        } else {
            let (step, done) = self.protocol_step(id, &walk, &origin)?;
            (Some(step), done)
        };
        let cond = self.walk_condition(&walk, at, sequence_value, &origin)?;
        self.test_loop(cond, &record);
        self.switch_to(record.body);

        let element = self.walk_element(&walk, sequence_value, at, stepped, &origin)?;
        // At the outer frame's element representation, exactly as a plain
        // `yield` is: the store and the outer walk's load are the same field,
        // and coercing at one end only is how they come to disagree.
        let element = self.coerce(element, &yields, sequence)?;
        self.push(
            OpKind::Yield { value: element },
            HirType::Void,
            origin.clone(),
        );

        let step = match index {
            None => Step::None,
            Some(cursor) => Step::Walk {
                cursor,
                walk,
                sequence: sequence_value,
            },
        };
        self.end_loop(&record, step)?;
        self.unlend_walked(lent, &origin);
        Ok(self.push(OpKind::ConstFloat(0.0), HirType::Void, origin))
    }

    /// `await e`.
    ///
    /// Lowered to [`OpKind::Await`] and left there. Turning it into a
    /// suspension needs the frame layout, and the frame layout needs to know
    /// which values are live across *every* await in the function -- which is a
    /// whole-function question this walk is in no position to answer. See
    /// [`super::suspend`](crate::hir::suspend).
    ///
    /// `await` outside an `async` function is top-level await, which is a
    /// different thing again: the module becomes the suspending body and its
    /// exports settle when it finishes.
    pub(super) fn lower_await(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // An `async function*` is an async context with **no promise of its
        // own**, so `async_result` is `None` inside one and the test below read
        // its body as module scope: the first `await` in an async generator
        // reported `a top-level await`, which is a true sentence about a
        // different program. What makes a body async here is the declaration,
        // and the frame carries which kind it is.
        let inside_an_async_generator = self
            .generator
            .as_ref()
            .is_some_and(|frame| frame.kind == GeneratorKind::Async);
        if self.async_result.is_none() && !inside_an_async_generator {
            return Err(self.unsupported(id, "a top-level `await`"));
        }
        let operand = *self
            .children(id)
            .first()
            .ok_or_else(|| self.unsupported(id, "an `await` of nothing"))?;
        let promise = self.lower_expression(operand)?;
        // **`await 1` is legal and means `Promise.resolve(1)`**, which is a
        // suspension of one tick rather than none. This used to refuse rather
        // than treat it as the identity, and refusing was right for that
        // reason: the tick is observable, so a program that awaits a plain
        // value and one that does not are different programs.
        //
        // The tick is what `Promise.resolve` already builds, so the value is
        // wrapped in a settled promise and awaited -- the spelling the
        // specification gives it. Nothing here restates the ordering rule; the
        // runtime's queue does, as it does for every other resolved promise.
        let promise = match self.values[promise.0 as usize].ty.clone() {
            HirType::Managed(ManagedType::Promise(_)) => promise,
            // **What it settles with is what `then` delivers**, where the
            // operand can be a thenable -- and the checker already said what
            // that is, as the `await` expression's own type. Otherwise the
            // operand itself, as before: for a union that is the erased value
            // the checker's narrower answer would have to be unerased from.
            operand => {
                let payload = if self.thenable_candidates(&operand).is_empty()
                    && self.binding_thenable(id)?.is_none()
                {
                    operand
                } else {
                    self.type_of(id).unwrap_or(operand)
                };
                self.settled_around(id, promise, payload)?
            }
        };
        let HirType::Managed(ManagedType::Promise(payload)) =
            self.values[promise.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(id, "an `await` of something that is not a promise"));
        };
        let origin = self.origin(id);
        // Filled in by `open_handler` where this `await` is inside a `try`
        // with a `catch`: the handler's parameters are not known until the
        // whole guarded body has been lowered.
        let awaited = self.push(
            OpKind::Await {
                promise,
                rejects_to: None,
            },
            *payload,
            origin,
        );
        self.record_rejection(awaited);
        Ok(awaited)
    }

    /// The layout of `Generator<T, …>`: the class every frame yielding `T`
    /// extends.
    ///
    /// Its fields are [`crate::hir::suspend::generator_prefix`] and nothing else,
    /// from the one function that also lays out the frames — so the prefix
    /// cannot drift, and a frame reaches a parameter declared as one without a
    /// cast to relate. It *declares* the resumption and defines nothing:
    /// [`crate::hir::suspend`] builds the frames that override it and takes the
    /// declaration's signature from one of them, rather than inventing a third
    /// opinion none of them held.
    pub(super) fn abstract_generator_layout(&self, ty: TypeId) -> Option<Layout> {
        let slot = self.hierarchy.generator_slot?;
        let kind = abstract_generator_kind(self.snapshot, ty)?;
        // The element, from the checker's type arguments. A `Generator` with
        // none recorded is the frontend having stopped at the library boundary,
        // and a layout whose element were a guess would read a slot no `yield`
        // ever filled.
        let element = self
            .snapshot
            .type_arguments
            .get(&ty)
            .and_then(|arguments| arguments.first())
            .copied()
            .and_then(|argument| self.represent(argument))
            // Through `yielded_slot`, the same rule the frame's own slot takes.
            // This used to decline a `void` element outright, and
            // `representation_within` declined it in step -- a type that
            // represents as an object and then has no layout is an object type
            // the program cannot name, so the two had to agree. They still do,
            // one line further along: neither declines now.
            .map(crate::hir::suspend::yielded_slot)?;
        // Numbered over the program's generators rather than by the order
        // layouts happen to be demanded in, so one program names one class the
        // same way on every run and a dump can be diffed.
        let index = abstract_generators(self.snapshot)
            .iter()
            .position(|other| *other == ty)?;
        let (class, method) = abstract_generator_names(index, kind);
        let mut methods = vec![None; self.hierarchy.table_size()];
        methods[slot as usize] = Some(method);
        Some(Layout {
            types: vec![ty],
            name: class,
            interfaces: Vec::new(),
            // Four fields for an async generator and two for a synchronous
            // one, from the same function the frames are built from. A walk
            // reaching one through this class writes the step's promise by
            // slot number, and a class that stopped at the prefix put it past
            // the end.
            fields: match kind {
                GeneratorKind::Sync => crate::hir::suspend::generator_prefix(&element),
                GeneratorKind::Async => crate::hir::suspend::async_generator_prefix(&element),
            },
            methods,
            // The abstract generator is the root: a frame extends it, and it
            // extends nothing.
            base: None,
        })
    }

    /// A lowered call, at the type its result actually has.
    ///
    /// Calling a generator produces its **frame**, not the `Generator<T, ...>`
    /// the checker says: that interface describes an object this compiler does
    /// not build, and the frame is what the call actually hands back. The
    /// reservation is read from the declaration, which is the same authority
    /// `begin_generator` used.
    ///
    /// And the same question answers the other one nobody else can: whether
    /// *this* call is a generator's. `OpKind::Call` records that the call was
    /// direct and records nothing about what it called, so a walk reading the
    /// op cannot tell `count(n)` from a plain `relay(n)` that merely hands a
    /// generator back -- and naming the resumption after the callee emitted a
    /// call to `relay__resume`, which nothing declares. Recorded here because
    /// here is the only place the two facts are both in hand.
    /// Record a call whose result is a generator frame **this site made**.
    ///
    /// Beside [`Self::push_call`] rather than inside it because three places
    /// produce a frame and only one of them is a plain call: a generator
    /// *method* and an implicit `[Symbol.iterator]()` reach it through
    /// `member_declaration` instead. Each knows its own way to the declaration
    /// and they share what they do with the answer.
    pub(super) fn note_generator_call(
        &mut self,
        call: ValueId,
        reserved: Option<usize>,
    ) -> ValueId {
        if reserved.is_some() {
            self.generator_calls.insert(call);
        }
        call
    }
}

//! Construct and settle promises and capabilities, including static combinators and the foreign rejection helper.

use super::{
    Absent, ArrayFill, AsyncResult, Copy, Diagnostic, Facts, Func, FuncBuilder, HirType,
    LayoutCollector, Lowered, LoweringSnapshot, ManagedType, NO_FOREIGN, NodeId, NodeKind, OpKind,
    Param, ParamShape, SemanticSnapshot, Shared, Terminator, TypeKind, ValueId, provided,
    representation, syntax,
};

/// A resolving function's pair number, as `nts_promise_claim` takes it.
pub(super) const PAIR: HirType = HirType::Int {
    bits: 32,
    signed: false,
};

/// A promise whose payload this closure does not know.
///
/// **The job and the resolving functions are payload-generic**, one per
/// `then` rather than one per `then` and payload, so they hold the promise as
/// `Promise<unknown>`: the resolve site puts a `Promise<number>` there through
/// an erase and an unerase. Sound because a promise's representation does not
/// vary with its payload -- one `NtsPromise` on every backend. A resolving
/// function settles it at the type it delivers, relabelled back the same way;
/// `check_delivery` held the resolve site's payload to that type, so the
/// reader at the `await` reads what was stored.
pub(super) fn erased_promise() -> HirType {
    HirType::Managed(ManagedType::Promise(Box::new(HirType::Erased)))
}

/// Every symbol naming a `new Promise` executor's `resolve` or `reject`, and
/// which of the two it is.
///
/// Wanted by [`collect_closures`](super::collect_closures) rather than by lowering, for the reason
/// [`Capture::settles`](super::Capture::settles) gives: the closure table is built once and cloned, so
/// this has to be known before any body is lowered.
///
/// `Promise.withResolvers` settlers are deliberately **not** here. They are
/// settlers too and a closure capturing one refuses identically, but nothing in
/// the corpus writes that, and a name list that covers a shape no program uses
/// is a claim with no evidence behind it. The refusal names the construct, so
/// the day one appears it says so.
pub(super) fn settler_symbols(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
) -> rustc_hash::FxHashMap<u32, bool> {
    let mut found = rustc_hash::FxHashMap::default();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::NEW_EXPRESSION) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let children = probe.children(id);
        let Some(callee) = children.first().copied() else {
            continue;
        };
        if probe
            .node(callee)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            != Some("Promise")
        {
            continue;
        }
        // **`arguments_of`, not the remaining children.** `new Promise<number>(
        // (resolve, reject) => ...)` carries its type argument as a child too,
        // so the first thing after the callee is `number` and the arrow is
        // never reached. The first version of this walked raw children, found
        // no executor in any program, and every capture came back `settles:
        // None` -- a silent miss, because a settler that is not marked simply
        // takes the refusal it took before.
        //
        // `lower_new_promise` reads the executor the same way, which is the
        // point: two derivations of "which argument is the executor" would
        // disagree exactly here.
        let arguments = probe.arguments_of(id);
        let Some(executor) = arguments.first().copied() else {
            continue;
        };
        if probe.kind_of(executor) != Some(syntax::ARROW_FUNCTION) {
            continue;
        }
        // Position decides which is which, exactly as `lower_new_promise`
        // decides it: `rejects: at == 1`. One derivation would be better than
        // two, and this is the cheaper half to keep honest -- the two are
        // checked against each other by `a-promise-settler-captured-by-a-closure`
        // answering with the right word.
        let parameters = probe
            .children(executor)
            .into_iter()
            .filter(|child| probe.kind_of(*child) == Some(syntax::PARAMETER));
        for (at, parameter) in parameters.enumerate() {
            let Some(name) = probe
                .children(parameter)
                .into_iter()
                .find(|field| probe.kind_of(*field) == Some(syntax::IDENTIFIER))
            else {
                continue;
            };
            if let Some(symbol) = probe.node(name).symbol {
                found.insert(symbol.0, at == 1);
            }
        }
    }
    found
}

/// The C name a host rejects a promise with ([`FuncBuilder::lower_reject_error`]).
pub(crate) const REJECT_ERROR: &str = "nts_promise_reject_error";

/// `nts_promise_reject_error`, in a program declaring a foreign function that
/// answers a promise -- declaring, not calling: a host compiled once for every
/// program (the Chromium lane's adapter) refers to it from every promise
/// member it binds, so every program typed against that surface defines it,
/// and no other program does.
pub(super) fn lower_reject_error(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    let Some(site) = declared_promise_function(snapshot) else {
        return;
    };
    let mut builder = shared.builder(
        snapshot,
        NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default),
        Copy::default(),
    );
    match builder.lower_reject_error(site) {
        Ok(func) => lowered.program.funcs.push(func),
        Err(diagnostic) => lowered.diagnostics.push(diagnostic),
    }
    builder.harvest(wanted, &mut lowered.arrivals);
    layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
}

/// A foreign function a program declares -- a function or method signature
/// with a native symbol, or a function a scheme module (`c:`, `nts:dom`)
/// declares -- whose result is a `Promise`.
fn declared_promise_function(snapshot: &SemanticSnapshot) -> Option<NodeId> {
    snapshot.nodes.iter().enumerate().find_map(|(at, node)| {
        let id = NodeId(u32::try_from(at).ok()?);
        // A native symbol names one; and a function a scheme module declares
        // -- `c:later`, `nts:dom` -- is one by its own name.
        let foreign = matches!(
            node.kind,
            NodeKind::Syntax(syntax::FUNCTION_DECLARATION | syntax::METHOD_SIGNATURE)
        ) && (node
            .native
            .as_ref()
            .is_some_and(|native| native.symbol.is_some())
            || nts_semantic_schema::binding::enclosing_module(snapshot, id)
                .is_some_and(|module| module.contains(':')));
        let TypeKind::Function(signature) = snapshot
            .types
            .get(snapshot.node_types.get(&id)?.0 as usize)?
            .kind
        else {
            return None;
        };
        let returned = snapshot.signatures.get(signature.0 as usize)?.return_type;
        (foreign
            && matches!(
                representation(snapshot, returned),
                Some(HirType::Managed(ManagedType::Promise(_)))
            ))
        .then_some(id)
    })
}

/// What `resolve` or `reject` names inside a `new Promise` executor.
///
/// The executor runs *synchronously* -- `new Promise(f)` calls `f` before it
/// returns -- so its body is lowered at the construction site and these two
/// names are not values at all. A call to one is the settle it stands for.
#[derive(Clone)]
pub(super) struct Settler {
    /// The promise being constructed, and the payload it settles with.
    pub(super) result: AsyncResult,
    /// `reject` rather than `resolve`.
    pub(super) rejects: bool,
}

/// What one slot of a destructured promise capability binds.
///
/// `read` is the value for `promise` and `None` for `resolve` and `reject`,
/// which bind a [`Settler`] instead and have no value at all. A bare
/// `Option<ValueId>` would have said "no binding" and "a binding of nothing"
/// with the same word.
pub(super) struct CapabilityBinding {
    pub(super) read: Option<ValueId>,
}

impl FuncBuilder<'_> {
    /// The type of the promise a captured settler settles.
    ///
    /// Read from the `new Promise` the parameter belongs to, by walking up from
    /// the name to the `NewExpression` and taking the checker's type for it.
    /// The allocating side put that promise in the field; this is the same type
    /// arrived at from the declaration rather than from a value, because the
    /// body's builder has no value in hand.
    pub(super) fn settler_promise_type(&self, name: NodeId) -> Option<HirType> {
        // Bounded at 64 like every other parent walk here, and not at 8: the
        // read is inside a *nested* closure, so the chain to the
        // `NewExpression` runs call -> if -> block -> arrow -> declaration ->
        // block -> arrow -> new, and a program with one more `if` around it is
        // longer still. Eight hops missed the shape this exists for.
        let mut at = self.node(name).parent;
        for _ in 0..64 {
            let here = at?;
            if self.kind_of(here) == Some(syntax::NEW_EXPRESSION) {
                let ty = self.type_of(here)?;
                return matches!(ty, HirType::Managed(ManagedType::Promise(_))).then_some(ty);
            }
            at = self.node(here).parent;
        }
        None
    }

    pub(super) fn lower_promise_static(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let parts = self.children(callee);
        let object = *parts.first()?;
        let member = *parts.last()?;
        if self.kind_of(object) != Some(syntax::IDENTIFIER)
            || self
                .node(object)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                != Some("Promise")
        {
            return None;
        }
        let member = self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)?;
        Some(match member.as_str() {
            "resolve" => self.settled_promise(id, arguments, false),
            "reject" => self.settled_promise(id, arguments, true),
            "all" => self.combinator(id, arguments, true),
            "race" => self.combinator(id, arguments, false),
            "withResolvers" => self.promise_capability(id, arguments),
            _ => return None,
        })
    }

    /// `Promise.all(xs)` and `Promise.race(xs)`.
    ///
    /// One function because they are one machine with two dials, which is the
    /// same claim the runtime makes: both subscribe to every element in order
    /// before returning, and both settle their result once. What differs is
    /// whether the values are kept.
    ///
    /// `collecting` is `all`. The result array is allocated *here* rather than
    /// in the runtime: whether a payload is a double or a pointer is a fact
    /// about the type, and an array carries its own descriptor, so allocating
    /// it on this side says that fact once instead of passing it separately.
    ///
    /// A heterogeneous tuple -- `Promise.all([Promise<number>, Promise<string>])`,
    /// whose result is `Promise<[number, string]>` -- needs no rule here. A
    /// tuple whose elements do not share a representation has none either, so
    /// the type is refused before this is reached.
    fn combinator(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        collecting: bool,
    ) -> Result<ValueId, Diagnostic> {
        let [only] = arguments else {
            // `Promise.all()` and `Promise.all(a, b)` are both type errors, so
            // arriving here means the shape is not what this reads.
            return Err(self.unsupported(id, "a `Promise` combinator with these arguments"));
        };
        let promises = self.lower_expression(*only)?;
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[promises.0 as usize].ty.clone()
        else {
            // An iterable that is not an array: legal JavaScript, and it needs
            // the iteration protocol rather than a length and an index.
            return Err(self.unsupported(id, "a `Promise` combinator over a non-array"));
        };
        let HirType::Managed(ManagedType::Promise(settles)) = *element else {
            // `Promise.all([1, 2])` is legal and fulfils with the values
            // unchanged. Supporting it means a per-element test for whether a
            // value is a promise at all, which is a different mechanism from
            // this one rather than a bigger version of it.
            return Err(self.unsupported(id, "a `Promise` combinator over non-promises"));
        };
        // Asked of the promises, before the result type: a promise of a C
        // handle settles outside the value `all` collects
        // (`NtsPromise::native`), and the runtime's collector reads values.
        // Not left to `Array<NativePointer>` being unrepresentable -- the day
        // it represents, this still refuses.
        if collecting && matches!(*settles, HirType::NativePointer(_)) {
            return Err(self.unsupported(id, "`Promise.all` over promises of C handles, which settle outside the value it collects"));
        }
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `Promise` combinator result"))?;
        let HirType::Managed(ManagedType::Promise(payload)) = ty.clone() else {
            return Err(self.unrepresentable(id, "a `Promise` combinator result"));
        };
        let origin = self.origin(id);
        if !collecting {
            if *payload != *settles {
                return Err(self.unrepresentable(id, "a `Promise.race` result"));
            }
            return Ok(self.runtime_call("nts_promise_race", vec![promises], ty, origin));
        }
        // The checker's answer is `Promise<T[]>`; the argument's is `Promise<T>[]`.
        // They agree by construction, and disagreeing means this read one of
        // them wrong rather than that the program is unusual.
        let HirType::Managed(ManagedType::Array(collected)) = &*payload else {
            return Err(self.unrepresentable(id, "a `Promise.all` result"));
        };
        if **collected != *settles {
            return Err(self.unrepresentable(id, "a `Promise.all` result"));
        }
        let length = self.push(OpKind::Length(promises), HirType::NUMBER, origin.clone());
        let values = self.push(
            // Zeroed, because a rejection leaves it partly filled and a
            // collector that walked the rest would follow whatever was there.
            OpKind::ArrayNew {
                length,
                // Filled: the `Promise.all` result: the runtime fills it as the promises settle, and the program receives it only once every one has; a rejection delivers the reason instead.
                fill: ArrayFill::Filled,
            },
            HirType::Managed(ManagedType::Array(collected.clone())),
            origin.clone(),
        );
        Ok(self.runtime_call("nts_promise_all", vec![promises, values], ty, origin))
    }

    /// Whether this expression is a `PromiseWithResolvers<T>`.
    ///
    /// Asked of the **checker's** type rather than the representation, because
    /// the representation is deliberately the same as a plain `Promise<T>` --
    /// that is the whole trick -- and telling the two apart is exactly what
    /// decides whether `.resolve` is a member to settle through or a name this
    /// compiler does not have.
    pub(super) fn names_a_promise_capability(&self, node: NodeId) -> bool {
        self.snapshot
            .node_types
            .get(&node)
            .copied()
            .is_some_and(|ty| self.is_a_capability_type(ty))
    }

    /// The same question of a **type**, seeing through a union with an absence.
    ///
    /// A capability that may be missing is still a capability:
    /// `cap?.resolve(v)` types its receiver as
    /// `PromiseWithResolvers<T> | undefined`, and asking `named` of that union
    /// answers `None` -- so the settle was not recognised and the call fell all
    /// the way through to *``resolve`` on a promise, which has no method table
    /// here*, while the very same settle written without the `?.` lowered.
    ///
    /// Only an absence is looked past. A union of a capability with anything
    /// *else* is two things the settle cannot be written for, and the member
    /// read below has to refuse it rather than pick one.
    fn is_a_capability_type(&self, ty: nts_semantic_schema::TypeId) -> bool {
        if provided(self.snapshot, ty) == Some("PromiseWithResolvers") {
            return true;
        }
        let Some(TypeKind::Union(members)) =
            self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind)
        else {
            return false;
        };
        let mut capability = false;
        for member in members.iter().copied() {
            if matches!(
                self.snapshot.types.get(member.0 as usize).map(|r| &r.kind),
                Some(TypeKind::Void | TypeKind::Undefined | TypeKind::Null)
            ) {
                continue;
            }
            if provided(self.snapshot, member) == Some("PromiseWithResolvers") {
                capability = true;
                continue;
            }
            return false;
        }
        capability
    }

    /// `Promise.withResolvers<T>()`, which allocates a promise and nothing else.
    fn promise_capability(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if !arguments.is_empty() {
            return Err(self.unsupported(id, "a `Promise.withResolvers` with arguments"));
        }
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `Promise.withResolvers` result"))?;
        // The representation rule above is what makes this a promise. If it
        // did not fire -- an un-annotated `withResolvers()` whose payload the
        // checker never pinned -- refusing is the answer, for the reason
        // `Promise<T>` gives one argument up there: a guessed payload settles
        // into a slot of the wrong kind and the collector follows it.
        if !matches!(ty, HirType::Managed(ManagedType::Promise(_))) {
            return Err(self.unrepresentable(id, "a `Promise.withResolvers` result"));
        }
        let origin = self.origin(id);
        Ok(self.runtime_call("nts_promise_new", Vec::new(), ty, origin))
    }

    /// `capability.resolve(v)` and `capability.reject(e)`.
    ///
    /// Not a method call: there is no object with a `resolve` slot in it, so
    /// [`Self::lower_method_call`] would look for a layout that does not exist.
    /// The receiver *is* the promise, and these are the two settles the runtime
    /// already performs for an `async` function's `return` and for
    /// `Promise.reject`.
    pub(super) fn lower_capability_call(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let parts = self.children(callee);
        let [object, member] = parts.as_slice() else {
            return None;
        };
        let (object, member) = (*object, *member);
        if !self.names_a_promise_capability(object) {
            return None;
        }
        let rejecting = match self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
        {
            Some("resolve") => false,
            Some("reject") => true,
            _ => return None,
        };
        Some(self.settle_capability(id, object, arguments, rejecting))
    }

    /// The body of [`Self::lower_capability_call`], once the member is known.
    fn settle_capability(
        &mut self,
        id: NodeId,
        object: NodeId,
        arguments: &[NodeId],
        rejecting: bool,
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(object)
            .ok_or_else(|| self.unrepresentable(object, "a promise capability"))?;
        let HirType::Managed(ManagedType::Promise(payload)) = ty else {
            return Err(self.unrepresentable(object, "a promise capability"));
        };
        let promise = self.lower_expression(object)?;
        self.settle_lowered(id, promise, *payload, arguments, rejecting)
    }

    /// `cap.resolve(v)` and `cap.reject(e)` on a receiver already lowered.
    ///
    /// Reached from [`Self::lower_method_on`], which is where the *optional*
    /// spelling arrives: `lower_capability_call` recognises a settle
    /// syntactically and cannot see the three-child callee `a?.b()` has.
    ///
    /// Asked of the **checker's** type, because the representation of a
    /// capability is deliberately a plain `Promise<T>` -- that is the whole
    /// trick -- and telling the two apart is what decides whether `resolve` is
    /// a settle or a name this compiler does not have.
    pub(super) fn capability_settle(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        receiver_node: NodeId,
        member: NodeId,
        arguments: &[NodeId],
        held: &HirType,
    ) -> Option<Result<ValueId, Diagnostic>> {
        let HirType::Managed(ManagedType::Promise(payload)) = held else {
            return None;
        };
        if !self.names_a_promise_capability(receiver_node) {
            return None;
        }
        let rejecting = match self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
        {
            Some("resolve") => false,
            Some("reject") => true,
            _ => return None,
        };
        let payload = (**payload).clone();
        Some(self.settle_lowered(id, receiver, payload, arguments, rejecting))
    }

    /// The settle itself, on a receiver that is **already a value**.
    ///
    /// Split out of [`Self::settle_capability`] so the optional-chained form
    /// can reach it. `lower_capability_call` recognises the settle
    /// *syntactically* -- a two-child property-access callee -- and `a?.b()`
    /// has **three** children, the `?.` being a token of its own, so
    /// `cap?.resolve(v)` fell past it and out the bottom of `lower_method_on`
    /// as *`resolve` on a promise, which has no method table here* while
    /// `cap.resolve(v)` lowered. Nine distinct sites in `runtime/node` and
    /// `runtime/web-platform` are the optional spelling, all of the shape
    /// `this.#writeRequests.dequeue()?.reject(...)`.
    ///
    /// It cannot be fixed by teaching the syntactic path about three children:
    /// the settle must happen **inside the present arm**, and the arm is built
    /// by `lower_optional_method_call`, which hands a narrowed `ValueId` to
    /// `lower_method_on`. So this is where both spellings meet.
    fn settle_lowered(
        &mut self,
        id: NodeId,
        promise: ValueId,
        payload: HirType,
        arguments: &[NodeId],
        rejecting: bool,
    ) -> Result<ValueId, Diagnostic> {
        let value = match arguments {
            [] => None,
            [only] => Some(self.lower_expression(*only)?),
            _ => {
                return Err(self.unsupported(id, "a settle with this many arguments"));
            }
        };
        if rejecting {
            return self.reject_with(id, promise, value);
        }
        let result = AsyncResult {
            promise,
            payload,
            written: None,
        };
        self.settle(id, &result, value)
    }

    /// The body of [`Self::lower_promise_static`], once the shape is known.
    /// A promise already settled with `value`, for `await` to suspend on.
    ///
    /// The same two steps `Promise.resolve(v)` takes -- allocate, settle -- and
    /// deliberately not a shortcut past them: a reaction on a settled promise
    /// still runs one tick later, and that tick is the whole difference between
    /// `await v` and `v`.
    pub(super) fn settled_around(
        &mut self,
        id: NodeId,
        value: ValueId,
        payload: HirType,
    ) -> Result<ValueId, Diagnostic> {
        let ty = HirType::Managed(ManagedType::Promise(Box::new(payload.clone())));
        let origin = self.origin(id);
        let promise = self.runtime_call("nts_promise_new", Vec::new(), ty, origin);
        let result = AsyncResult {
            promise,
            payload,
            written: None,
        };
        self.settle(id, &result, Some(value))?;
        Ok(promise)
    }

    /// Write a value into a promise, through the helper its payload needs.
    ///
    /// Which one depends on the payload's representation, which is the whole
    /// reason [`ManagedType::Promise`] carries one. The runtime stores a tagged
    /// union and the tag has to be right: a number written into the reference
    /// slot is a pointer the collector would follow.
    pub(super) fn settle(
        &mut self,
        id: NodeId,
        result: &AsyncResult,
        value: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        // **Settling a promise with a promise is adoption**, and it is a
        // runtime operation rather than a copy here. The outer one does not
        // take the inner *promise* as its payload -- that would be a different
        // value of a different type -- it takes the inner's eventual
        // settlement, two microtasks later, and both halves are observable
        // through interleaving.
        //
        // The two hops are the specification's two jobs:
        // `NewPromiseResolveThenableJob` subscribes, and the subscription's
        // reaction settles. Measured against node before this was built, with a
        // chain of eight microtasks to count against, a `return g()` whose
        // `g()` has already settled lands exactly one tick after a
        // `return await g()` would. `nts_promise_adopt` carries that argument
        // in all three runtimes and they have to stay the same number of hops.
        if let Some(value) = value
            && let HirType::Managed(ManagedType::Promise(inner)) =
                self.values[value.0 as usize].ty.clone()
        {
            // **The payloads have to agree**, and the checker is not enough to
            // say so: `Promise<Buffer>` and `Promise<unknown>` are assignable
            // in TypeScript and are a pointer and a tagged value here. The
            // forward copies one `NtsValue` across, so a disagreement would put
            // the inner's spelling in a slot the outer's readers unpack
            // differently -- which is the shape the comment this replaced was
            // written about, one layer along.
            if *inner != result.payload {
                return Err(self.unsupported(
                    id,
                    "a promise settled with a promise whose payload is represented differently",
                ));
            }
            let origin = self.origin(id);
            return Ok(self.runtime_call(
                "nts_promise_adopt",
                vec![result.promise, value],
                HirType::Void,
                origin,
            ));
        }
        // **Then a thenable**, which is the other half of the specification's
        // resolve procedure: it reads `then` off whatever it is given, and
        // where there is one, the promise follows it instead of holding it.
        if let Some(value) = value
            && let Some(settled) = self.settle_through_thenables(id, result, value)?
        {
            return Ok(settled);
        }
        self.fulfil(id, result, value)
    }

    /// Settle with what is neither a promise nor a thenable: the
    /// specification's `FulfillPromise`, which `settle` reaches once it has
    /// asked both.
    pub(super) fn fulfil(
        &mut self,
        id: NodeId,
        result: &AsyncResult,
        value: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        // At the payload's own type before the helper is chosen from it. The
        // two were read independently, so a `Promise<Buffer>` settled from a
        // value the flow had erased picked `nts_promise_fulfill_tagged` -- from
        // the declared payload -- and handed it the erased value, which is a
        // struct where the helper wants a pointer. Five modules, one site each,
        // and the C was the only thing that objected.
        let value = match value {
            Some(value) => Some(self.coerce(value, &result.payload, id)?),
            None => None,
        };
        let origin = self.origin(id);
        let (helper, args) = match (&result.payload, value) {
            // A C handle -- `query_info_async`'s `GFileInfo *` -- into the
            // promise's own slot for one, never into its value, which the
            // collector reads.
            // A host's object as a tagged value, which the promise keeps alive
            // through the host's pair (`NTS_TAG_HANDLE_HOST`) -- the
            // representation a host settling one uses too, so an `await` reads
            // either the same way (`suspend::settled_reader`).
            (HirType::NativePointer(pointee), Some(value))
                if crate::hir::suspend::host_handle(pointee) =>
            {
                let erased = self.push(
                    OpKind::Erase {
                        value,
                        absent: Absent::Impossible,
                        slots: Absent::Impossible,
                    },
                    HirType::Erased,
                    origin.clone(),
                );
                ("nts_promise_fulfill_value", vec![result.promise, erased])
            }
            // A counted one boxed, so the promise holds a reference to it.
            (HirType::NativePointer(pointee), Some(value)) if pointee.counting().is_some() => {
                let (boxed, boxed_ty) = self.box_handle(id, value, pointee)?;
                let tag = crate::hir::tags::of_reference(&ManagedType::Object(boxed_ty));
                let tag = self.push(
                    OpKind::ConstInt(i128::from(tag)),
                    HirType::Int {
                        bits: 32,
                        signed: false,
                    },
                    self.origin(id),
                );
                (
                    "nts_promise_fulfill_tagged",
                    vec![result.promise, boxed, tag],
                )
            }
            (HirType::NativePointer(_), Some(value)) => {
                ("nts_promise_fulfill_pointer", vec![result.promise, value])
            }
            (HirType::Void, _) | (_, None) => ("nts_promise_fulfill_void", vec![result.promise]),
            (HirType::Float { .. } | HirType::Int { .. } | HirType::Bool, Some(value)) => {
                ("nts_promise_fulfill_number", vec![result.promise, value])
            }
            // Logical BigInt uses the existing tagged payload; late boxing
            // supplies its owned native reference before counting/emission.
            (HirType::BigInt | HirType::PossiblyUndefined(_), Some(value)) => {
                let erased = self.push(
                    OpKind::Erase {
                        value,
                        absent: Absent::Impossible,
                        slots: Absent::Impossible,
                    },
                    HirType::Erased,
                    origin.clone(),
                );
                ("nts_promise_fulfill_value", vec![result.promise, erased])
            }
            // The tag, supplied rather than derived. The compiler emitted the
            // type, so it knows whether this is a string; making the runtime
            // read the header back to find out is asking a question that was
            // already answered.
            (HirType::Managed(managed), Some(value)) => {
                let tag = crate::hir::tags::of_reference(managed);
                let origin = self.origin(id);
                let tag = self.push(
                    OpKind::ConstInt(i128::from(tag)),
                    HirType::Int {
                        bits: 32,
                        signed: false,
                    },
                    origin,
                );
                (
                    "nts_promise_fulfill_tagged",
                    vec![result.promise, value, tag],
                )
            }
            (HirType::Never, Some(_)) => {
                return Err(self.unrepresentable(id, "an `async` function returning `never`"));
            }
            // The runtime settles a promise with a number or with a reference,
            // and an erased value is neither: it is a tag beside a payload, so
            // fulfilling with one needs a third helper that knows the layout.
            // This was refused, on the argument that settling one through
            // whichever arm looks closest is how a reference payload goes out
            // as a double. The argument was right and one helper short: the
            // third one exists, all three backends already emit it, and it
            // needs no tag because the value carries its own.
            //
            // **Resolved, not fulfilled.** An erased value can hold a promise,
            // and resolving with a promise adopts it -- the arm above that
            // does so is chosen from the type, and here only the tag knows.
            // Fulfilling stored the inner promise *as* the payload, and a
            // reader expecting a number found a promise and aborted where node
            // answers the inner's value.
            (HirType::Erased, Some(value)) => {
                ("nts_promise_resolve_value", vec![result.promise, value])
            }
        };
        Ok(self.runtime_call(helper, args, HirType::Void, origin))
    }

    /// `new Promise<T>(executor)`.
    ///
    /// # The executor is not a function here
    ///
    /// `new Promise(f)` calls `f` *synchronously*, before the constructor
    /// returns. So when `f` is written at the call -- which is how essentially
    /// every one of them is written -- its body belongs at the construction
    /// site, and `resolve` and `reject` are not values that have to exist. A
    /// call to `resolve` is the settle it stands for, which is the same helper
    /// an `async` function's `return` emits.
    ///
    /// That is the whole reason this needs no closure over the promise, which
    /// is what made the feature look hard. The promise is a local, `resolve(v)`
    /// is `nts_promise_fulfill_*(p, v)`, and nothing is captured by anything.
    ///
    /// The same shape, and the same refusal, as an array method whose callback
    /// is not an arrow written at the call: an executor that arrives as a name
    /// is a genuine indirect call, and answering it needs a real closure over
    /// the promise rather than a harder version of this.
    pub(super) fn lower_new_promise(
        &mut self,
        id: NodeId,
        ty: &HirType,
        payload: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let arguments = self.arguments_of(id);
        let [executor] = arguments.as_slice() else {
            return Err(self.unsupported(id, "a `new Promise` with more than an executor"));
        };
        let executor = *executor;
        if self.kind_of(executor) != Some(syntax::ARROW_FUNCTION) {
            return Err(self.unsupported(
                id,
                "a `new Promise` whose executor is not an arrow written at the call",
            ));
        }
        let names = self.callback_parameters(executor, "Promise")?;
        if names.len() > 2 {
            return Err(self.unsupported(executor, "a `new Promise` executor of this shape"));
        }
        let Some(&body) = self.children(executor).last() else {
            return Err(self.unsupported(executor, "a `new Promise` executor with no body"));
        };

        let origin = self.origin(id);
        let promise = self.runtime_call("nts_promise_new", Vec::new(), ty.clone(), origin);
        let result = AsyncResult {
            promise,
            payload: payload.clone(),
            written: None,
        };

        // Saved and restored rather than inserted and removed: an executor
        // nested inside another one rebinds the same names, and the outer
        // meanings have to come back when it ends.
        let outer = self.settlers.clone();
        for (at, symbol) in names.into_iter().enumerate() {
            self.settlers.insert(
                symbol,
                Settler {
                    result: result.clone(),
                    rejects: at == 1,
                },
            );
        }
        // A concise body is an expression whose value the executor discards --
        // `new Promise(r => r(n))` is the shortest spelling there is.
        let lowered = if self.kind_of(body) == Some(syntax::BLOCK) {
            self.lower_statement(body)
        } else {
            self.lower_expression(body).map(|_| ())
        };
        self.settlers = outer;
        lowered?;

        Ok(promise)
    }

    /// `resolve(v)` or `reject(e)` inside a `new Promise` executor.
    ///
    /// `None` when this call is an ordinary one, which is every call in a
    /// program that is not inside an executor.
    pub(super) fn lower_settler_call(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        if self.settlers.is_empty() {
            return Ok(None);
        }
        let Some(&callee) = self.children(id).first() else {
            return Ok(None);
        };
        if self.kind_of(callee) != Some(syntax::IDENTIFIER) {
            return Ok(None);
        }
        let Some(symbol) = self.node(callee).symbol else {
            return Ok(None);
        };
        let Some(settler) = self.settlers.get(&symbol.0).cloned() else {
            return Ok(None);
        };

        let arguments = self.arguments_of(id);
        let value = match arguments.as_slice() {
            [] => None,
            [one] => Some(self.lower_expression(*one)?),
            _ => {
                return Err(self.unsupported(
                    id,
                    "a `resolve` or `reject` with more than one \
                                                 argument",
                ));
            }
        };

        // **Only while the pair is unspent.** The specification gives
        // `resolve` and `reject` one `alreadyResolved` flag between them, and
        // it is not the same as being settled: `resolve(p)` with a promise
        // leaves this one pending until `p` settles, and a `resolve(v)` or
        // `reject(e)` in that window is ignored. The settle helpers refuse only
        // a promise that has already settled, so without this
        // `r(later); r(1)` answered 1 where node waits for `later`.
        //
        // The argument is evaluated first either way, as a call's arguments
        // are before the callee runs. An executor's pair is the promise's
        // first, numbered 0 -- see `nts_promise_claim`.
        let origin = self.origin(id);
        let pair = self.push(
            OpKind::ConstInt(0),
            HirType::Int {
                bits: 32,
                signed: false,
            },
            origin.clone(),
        );
        let live = self.runtime_call(
            "nts_promise_claim",
            vec![settler.result.promise, pair],
            HirType::Bool,
            origin.clone(),
        );
        let settles = self.new_block();
        let join = self.new_block();
        self.terminate(Terminator::Branch {
            cond: live,
            then_target: settles,
            then_args: Vec::new(),
            else_target: join,
            else_args: Vec::new(),
        });
        self.switch_to(settles);
        if settler.rejects {
            self.reject_with(id, settler.result.promise, value)?;
        } else {
            self.settle(id, &settler.result, value)?;
        }
        self.terminate(Terminator::Jump {
            target: join,
            args: Vec::new(),
        });
        self.switch_to(join);
        Ok(Some(self.push(
            OpKind::ConstUndefined,
            HirType::Void,
            origin,
        )))
    }

    /// Reject `promise` with `reason`, or refuse.
    ///
    /// **One rejection path, because there were two and they disagreed.** A
    /// rejection reason is `any` and the runtime takes a reference:
    /// `reject(new Error(m))` and `reject("text")` are both one, and `reject(7)`
    /// is not. Refused rather than boxed, because a number written into the
    /// reason slot is a pointer the collector would follow.
    ///
    /// `Promise.withResolvers`'s settle was written as a second copy of this
    /// and left the check out. It did not refuse and it did not box: it emitted
    /// `nts_promise_reject(p, (NtsHeader *)v)` over a `NtsValue`, and clang said
    /// `operand of type 'NtsValue' where arithmetic or pointer type is
    /// required` -- eleven of them in `assert`, which is a module that does not
    /// write `withResolvers` at all and reaches one through `web-platform`.
    pub(super) fn reject_with(
        &mut self,
        id: NodeId,
        promise: ValueId,
        reason: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let Some(reason) = reason else {
            return Err(self.unsupported(id, "a `reject` with no reason"));
        };
        // **`Erased` needs the other helper, and saying so was missing here.**
        // `nts_promise_reject` takes an `NtsHeader *`; an erased value is an
        // `NtsValue`, a sixteen-byte tagged struct, and the emitter cast one to
        // the other -- `operand of type 'NtsValue' where arithmetic or pointer
        // type is required`, from clang, on C that `emit-c` had already exited
        // zero over. `nts_promise_reject_value` reads the reference out of the
        // tag, which is what an `async` function's `throw` of a rethrown
        // `catch (e)` has always done; this path listed `Erased` as acceptable
        // and then emitted the wrong call for it.
        //
        // Reachable before `Promise.withResolvers` existed, and measured on the
        // pinned binary: `Promise.reject(x)` and `new Promise((_, r) => r(x))`
        // with an `unknown` reason both emit C clang refuses. Nothing in the
        // corpus got that far, because `web-platform`'s streams -- where every
        // such reason lives -- were refused earlier for a different reason.
        let helper = match self.values[reason.0 as usize].ty {
            HirType::Erased => "nts_promise_reject_value",
            HirType::Managed(_) => "nts_promise_reject",
            _ => {
                return Err(
                    self.unsupported(id, "a `reject` with a reason that is not a reference")
                );
            }
        };
        Ok(self.runtime_call(helper, vec![promise, reason], HirType::Void, origin))
    }

    /// `nts_promise_reject_error(promise, name, message)`: what a host rejects
    /// a promise a foreign function answered with (`native::promised`) --
    /// the program's own `Error`, `name` and `message` copied from the C
    /// strings the host keeps, as an `@ntsThrows` call surfaces a synchronous
    /// one. A function of the program's, since only the program has its
    /// `Error`'s layout; declared by `nts_runtime.h` for the host to call.
    fn lower_reject_error(&mut self, site: NodeId) -> Result<Func, Diagnostic> {
        let origin = self.origin(site);
        let text = HirType::NativePointer(crate::hir::native::Pointee::Const(Box::new(
            crate::hir::native::Pointee::Scalar(crate::hir::native::Scalar::Char),
        )));
        let promise_ty = HirType::Managed(ManagedType::Promise(Box::new(HirType::Erased)));
        let param = |name: &str, ty: &HirType| Param {
            name: name.to_owned(),
            shape: ParamShape::Ordinary,
            ty: ty.clone(),
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        };
        let params = vec![
            param("promise", &promise_ty),
            param("name", &text),
            param("message", &text),
        ];
        let promise = self.push(OpKind::Param(0), promise_ty, origin.clone());
        let name = self.push(OpKind::Param(1), text.clone(), origin.clone());
        let message = self.push(OpKind::Param(2), text, origin.clone());
        let string = HirType::Managed(ManagedType::String);
        let name = self.runtime_call(
            "nts_string_from_required_cstring",
            vec![name],
            string.clone(),
            origin.clone(),
        );
        let message = self.runtime_call(
            "nts_string_from_required_cstring",
            vec![message],
            string,
            origin.clone(),
        );
        let (error, _) = self.provided_error_named(site, "Error", message, name)?;
        self.runtime_call(
            "nts_promise_reject",
            vec![promise, error],
            HirType::Void,
            origin.clone(),
        );
        self.terminate(Terminator::Return(None));
        Ok(self.finish(REJECT_ERROR.to_owned(), params, HirType::Void, origin, true))
    }
}

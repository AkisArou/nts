//! Evaluate and arrange arguments for the chosen parameter shape, including tuple/rest/spread gathering.

use super::{
    ArrayFill, Callee, Counts, Diagnostic, Facts, FuncBuilder, HirType, ManagedType, NodeId,
    Omitted, OpKind, Param, ParamShape, TypeId, TypeKind, ValueId, counted_helper, holds_counted,
    in_a_slot, syntax,
};

/// A supplied expression, or the implicit template array already computed at
/// the same call site. The node keeps coercion/default diagnostics at the source.
#[derive(Debug, Clone, Copy)]
pub(super) struct Argument {
    pub(super) node: NodeId,
    pub(super) value: Option<ValueId>,
}

impl Argument {
    pub(super) fn expression(node: NodeId) -> Self {
        Self { node, value: None }
    }
}

impl FuncBuilder<'_> {
    /// The arguments a call passes, with the defaults it leaves to the callee.
    ///
    /// JavaScript evaluates a default at the call, in the callee's scope, after
    /// every argument that *was* provided. Lowering it here, in that order, is
    /// the same program — and it costs nothing at run time, because the value
    /// arrives as an ordinary argument rather than as a test the callee makes
    /// on every call.
    ///
    /// Which parameters were omitted is read from the callee's declaration,
    /// which the checker resolved: `call_targets` answers for a method and a
    /// constructor as well as a plain function, so one helper covers every path
    /// that builds an argument list.
    pub(super) fn lower_arguments(
        &mut self,
        call: NodeId,
        arguments: &[NodeId],
    ) -> Result<Vec<ValueId>, Diagnostic> {
        self.lower_arguments_gathering(call, arguments, None, None)
    }

    /// The same, for a call that has a receiver.
    ///
    /// Only a *default* reads it, and only a default written `this`. See the
    /// `Omitted::Default` arm.
    pub(super) fn lower_arguments_on(
        &mut self,
        call: NodeId,
        arguments: &[NodeId],
        receiver: ValueId,
    ) -> Result<Vec<ValueId>, Diagnostic> {
        self.lower_arguments_gathering(call, arguments, None, Some(receiver))
    }

    /// The same, for a callee whose rest parameter is not a rest *array*.
    ///
    /// A C variadic tail is not one value. `open(path, flags, mode)` passes
    /// three arguments, and gathering the tail built an empty `NtsArray` and
    /// handed C its address cast to `uint32_t` -- a call that compiled, linked
    /// and was wrong, which is the family this whole lane exists to close.
    pub(super) fn lower_native_arguments(
        &mut self,
        call: NodeId,
        arguments: &[NodeId],
        tail: &HirType,
    ) -> Result<Vec<ValueId>, Diagnostic> {
        self.lower_arguments_gathering(call, arguments, Some(tail), None)
    }

    fn lower_arguments_gathering(
        &mut self,
        call: NodeId,
        arguments: &[NodeId],
        tail: Option<&HirType>,
        receiver: Option<ValueId>,
    ) -> Result<Vec<ValueId>, Diagnostic> {
        let arguments: Vec<Argument> = arguments
            .iter()
            .copied()
            .map(Argument::expression)
            .collect();
        self.lower_argument_values(call, &arguments, tail, receiver)
    }

    /// Evaluate every supplied argument before applying parameter defaults.
    /// A template contributes one already computed array, then ordinary source
    /// expressions; both use this same arity, coercion and rest convention.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn lower_argument_values(
        &mut self,
        call: NodeId,
        arguments: &[Argument],
        tail: Option<&HirType>,
        receiver: Option<ValueId>,
    ) -> Result<Vec<ValueId>, Diagnostic> {
        // Where the callee's rest parameter starts, if it has one. Everything
        // from there is one array rather than one argument each.
        //
        // The **implementation's** rest, where the call resolved to an overload
        // signature: `total(a: number, b: number)` sits beside
        // `total(a: number, ...rest: number[])` and has no rest of its own, so
        // asking the resolved signature gathered nothing and a bare number
        // reached a parameter wanting an array.
        let rest = self
            .parameter_shapes(call)
            .iter()
            .position(|(_, rest)| *rest);
        // A C variadic tail is not a rest array, so it is neither gathered nor
        // coerced to one. Each argument from there takes the tail's *element*
        // type, which is what the declaration names and what the callee is
        // told it will receive.
        let (rest, tail_from) = match tail {
            Some(_) => (None, rest),
            None => (rest, None),
        };
        // **An argument past the last parameter is evaluated and dropped**, as
        // JavaScript does: `function f() {}` called `f(1)` -- which a `.js` file
        // may write -- evaluates `1` and the callee never sees it. Passed along,
        // it was a call with more arguments than the function takes, and invalid
        // HIR rather than either an answer or a refusal.
        let arity = match tail {
            Some(_) => None,
            None => self.fixed_arity(call),
        };

        let mut args = Vec::new();
        let mut sources = Vec::new();
        for (at, argument) in arguments.iter().enumerate() {
            if rest == Some(args.len()) {
                let gathered = self.gather_rest(call, args.len(), &arguments[at..])?;
                args.push(gathered);
                break;
            }
            if arity.is_some_and(|arity| args.len() >= arity) {
                if argument.value.is_none() {
                    self.lower_for_its_effects(argument.node)?;
                }
                continue;
            }
            // **A spread of a fixed-arity tuple is that many arguments.**
            // `cb(...args)` inside a generic rest forwards to a callback whose
            // `call` is positional -- a lambda written `(a, b) => …` has two
            // parameters and never had a rest -- so leaving the spread as one
            // array is an argument-count mismatch, which is invalid HIR and not
            // a diagnostic.
            //
            // Only a *fixed* arity can be expanded. `...xs` for `xs: number[]`
            // has no count until run time and keeps the refusal, which is now
            // the only shape that message covers. The refusal is what made this
            // visible at all: expanding the declaration turned the old invalid
            // HIR into a named refusal here, and `agreed on every case` was
            // still printed over the two functions that survived it.
            if self.kind_of(argument.node) == Some(syntax::SPREAD_ELEMENT)
                && let Some(operand) = self
                    .children(argument.node)
                    .into_iter()
                    .find(|child| self.kind_of(*child) != Some(syntax::DOT_DOT_DOT_TOKEN))
                && let Some(positions) = self
                    .snapshot
                    .node_types
                    .get(&operand)
                    .copied()
                    .and_then(|ty| self.fixed_arity_positions(ty))
            {
                let array = self.lower_expression(operand)?;
                // A position past the last parameter is dropped like any other
                // excess argument; reading it has no effect to keep.
                let taken = arity.map_or(positions.len(), |arity| arity.saturating_sub(args.len()));
                for (offset, position) in positions.iter().enumerate().take(taken) {
                    let want = self
                        .represent(*position)
                        .ok_or_else(|| self.unrepresentable(operand, "a spread position"))?;
                    let value = self.read_a_position(array, offset, &want, operand)?;
                    let value = self.coerce_to_parameter(
                        call,
                        args.len(),
                        value,
                        operand,
                        Some(*position),
                    )?;
                    sources.push((operand, Some(*position)));
                    args.push(value);
                }
                continue;
            }
            // **Lowered knowing the parameter's representation**, not merely
            // coerced into it afterwards. An array literal decides its own
            // element width when it is built, and `coerce` can only reject the
            // result: `["close", "error"]` passed where `readonly EventName[]`
            // is wanted was built at `Managed(String)` and then refused, because
            // a pointer to an array of strings is not a pointer to an array of
            // erased values.
            //
            // The same channel `null` already uses -- `lower_expecting` was
            // written so a bare `null` in an argument takes the slot's type --
            // asked one question wider.
            // Except an array of handles lent to C (`CHandles`), which crosses
            // as whatever array of handles the program holds: see
            // `coerce_to_parameter`. `Role::Handles` checks what it is. And
            // an array the callee fills with records (`fills_records`).
            let want = match (tail, tail_from) {
                (Some(element), Some(from)) if args.len() >= from => Some((*element).clone()),
                _ if self.lends_handles(call, args.len())
                    || self.fills_records(call, args.len()) =>
                {
                    None
                }
                // A `Copied<T>` literal, which is the struct's storage.
                _ if self.copied_pending.contains_key(&argument.node) => None,
                _ => self.parameter_representation(call, args.len()),
            };
            let defaulted_undefined = self
                .undefined_argument(argument.node)
                .filter(|_| self.declared_default(call, args.len()).is_some());
            let value = if let Some(undefined) = defaulted_undefined {
                if self.kind_of(undefined) == Some(syntax::VOID_EXPRESSION) {
                    self.lower_for_its_effects(argument.node)?;
                }
                let origin = self.origin(argument.node);
                self.push(OpKind::ConstUndefined, HirType::Erased, origin)
            } else {
                match (argument.value, &want) {
                    (Some(value), _) => value,
                    (None, Some(want)) => self.lower_expecting(argument.node, want)?,
                    (None, None) => self.lower_expression(argument.node)?,
                }
            };
            let value = match &want {
                Some(want) if defaulted_undefined.is_none() => {
                    self.coerce(value, want, argument.node)?
                }
                _ => value,
            };
            sources.push((argument.node, self.read_type(argument.node)));
            args.push(value);
        }
        // Decide the legacy reference route before defaults: those sites
        // retain the old caller-filled path instead of acquiring entry ownership.
        let references =
            receiver.and_then(|receiver| self.known_reference_path(call, receiver, &args));
        if let Some(needed) = self.argument_sources.get_mut(&call) {
            needed.typed_references = references;
        }
        // Defaults run in parameter order, after all supplied expressions,
        // including excess expressions and the expressions gathered into rest.
        for (at, (node, ty)) in sources.iter().copied().enumerate() {
            args[at] = self.unless_undefined(call, node, ty, args[at], &args[..at], receiver)?;
        }
        for omitted in self.omitted_after(call, args.len()) {
            let value = match omitted {
                Omitted::Default(node, callee) => {
                    self.lower_parameter_default(call, node, callee, &args, receiver)?
                }
                Omitted::Absent => self.absent_argument(call, args.len())?,
            };
            args.push(value);
        }
        // An empty rest follows the supplied and defaulted fixed parameters.
        if rest == Some(args.len()) {
            let gathered = self.gather_rest(call, args.len(), &[])?;
            args.push(gathered);
        }
        if let Some(needed) = self.argument_sources.get_mut(&call) {
            needed.sources = sources;
        }
        Ok(args)
    }

    /// The trailing arguments of a call, as the array its callee declared.
    ///
    /// Built here rather than at the declaration because that is where the
    /// values are: `f(1, 2, 3)` and `f()` reach the same one-parameter function
    /// and differ only in what this puts in the array.
    fn gather_rest(
        &mut self,
        call: NodeId,
        at: usize,
        elements: &[Argument],
    ) -> Result<ValueId, Diagnostic> {
        // The declaration and the call have to agree, and they ask two different
        // questions to get there. `lower_param` decided this parameter is an
        // array of `element`; if the call did not apply the same rule it would
        // gather nothing and the callee would read a slot that was never
        // written. The first cut fixed only the declaration, and the call site
        // refused with a *different* message -- "a rest parameter that is not
        // an array" -- which is how the split showed up at all.
        //
        // **The tuple union is asked about first, and that order is the fix.**
        // Writing it as `represent(ty).or_else(...)` looks equivalent and is
        // not: `represent` does not answer `None` for these unions, it answers
        // `Erased`. A union of tuples has a perfectly good boxed representation,
        // so the fallback was never reached and the call went on refusing while
        // the declaration had already been fixed. Asking the narrower question
        // first is safe because a genuine array type is not a union, so
        // `tuple_union_as_array` declines it and `represent` answers exactly as
        // before.
        //
        // Found by making the refusal print what it had rather than by reading
        // the code again: `ty=Erased kind=Union([...])` said in one line what
        // two readings of `representation_within` had not.
        // **The same rule `lower_param` uses, written the same way.** An array
        // answer is taken; anything else falls back to the tuple derivation.
        //
        // Two earlier spellings of this were each wrong in one direction.
        // `represent(ty).or_else(fallback)` never fell back, because `represent`
        // answers `Erased` for a union of tuples rather than `None`. Reordering
        // it to try the tuple first then broke the other case: a bare tuple of
        // all-*managed* positions already represents as `Array(first)` on
        // purpose -- `element_of` restores the declared type on the way out --
        // so the declaration kept `Array(string)` while the call built
        // `Array(erased)`, and the verifier caught `CallArgumentType`.
        //
        // Falling back on "not an array" rather than on `None` covers both, and
        // is the one phrasing where the two sides cannot disagree.
        let ty = self
            .parameter_type_id(call, at)
            .and_then(|ty| match self.represent(ty) {
                Some(array @ HirType::Managed(ManagedType::Array(_))) => Some(array),
                _ => self.tuple_union_as_array(ty),
            })
            .ok_or_else(|| self.unsupported(call, "a rest parameter of unrepresentable type"))?;
        let HirType::Managed(ManagedType::Array(element)) = ty.clone() else {
            return Err(self.unsupported(call, "a rest parameter that is not an array"));
        };
        let origin = self.origin(call);
        // The spreads are set aside and folded on at the end. Everything before
        // the first one keeps its position; a spread in the *middle* would need
        // the elements after it placed at an offset this compiler does not know,
        // so it is refused by name rather than mis-placed.
        let (fixed, spreads): (Vec<Argument>, Vec<Argument>) = elements
            .iter()
            .copied()
            .partition(|argument| self.kind_of(argument.node) != Some(syntax::SPREAD_ELEMENT));
        if let Some(first) = elements
            .iter()
            .position(|argument| self.kind_of(argument.node) == Some(syntax::SPREAD_ELEMENT))
            && first != fixed.len()
        {
            return Err(self.unsupported(call, "a spread element before another argument"));
        }
        let elements = &fixed[..];
        #[allow(clippy::cast_precision_loss)]
        let count = elements.len() as f64;
        let length = self.push(OpKind::ConstFloat(count), HirType::NUMBER, origin.clone());
        let array = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            ty.clone(),
            origin.clone(),
        );
        for (index, argument) in elements.iter().enumerate() {
            let value = match argument.value {
                Some(value) => value,
                None => self.lower_expecting(argument.node, &element)?,
            };
            // At the element's type, like every other store into a slot.
            let value = self.coerce(value, &element, argument.node)?;
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
        if spreads.is_empty() {
            return Ok(array);
        }
        let spreads: Vec<NodeId> = spreads.into_iter().map(|argument| argument.node).collect();
        self.gather_rest_with_spreads(call, &element, &ty, array, &spreads)
    }

    /// `f(a, ...rest)` -- the rest array, built by concatenation.
    ///
    /// A rest parameter is one array parameter and a call site builds it, so a
    /// spread is a *length this compiler does not know*: `f(a, b)` allocates
    /// two slots and `f(a, ...rest)` allocates one plus however many `rest`
    /// holds. `nts_array_concat` already answers that and every backend already
    /// emits it, so this is the fixed part plus a fold rather than a loop
    /// this lowering has to build.
    ///
    /// **The concatenation is what makes it correct, not only what makes it
    /// short.** A rest array is fresh on every call in JavaScript, so passing
    /// the caller's array through would alias it -- `function f(...xs) {
    /// xs.push(1) }` would then reach back into the caller's. `concat` returns
    /// a new array, so even `f(...rest)` with nothing leading gets a copy, and
    /// the empty leading array it concatenates with is the thing that makes
    /// that fall out rather than be a special case.
    ///
    /// What it was under: `this.emit(EventEmitter.errorMonitor, ...args)` is
    /// the single spread refusal in `events`, and `EventEmitter#emit` is under
    /// `addListener`, `EventEmitter#on`, `net.Server`, `http.Server` and
    /// `createServer`. One refusal, 274 failing test files.
    fn gather_rest_with_spreads(
        &mut self,
        call: NodeId,
        element: &HirType,
        ty: &HirType,
        array: ValueId,
        spreads: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let sources: Vec<NodeId> = spreads
            .iter()
            .map(|spread| {
                self.children(*spread)
                    .first()
                    .copied()
                    .ok_or_else(|| self.unsupported(*spread, "a spread of nothing"))
            })
            .collect::<Result<_, _>>()?;
        self.concat_onto(call, element, ty, array, &sources)
    }

    /// Concatenate each source array onto `array`, at the parameter's element
    /// width.
    ///
    /// Takes the *expressions* rather than the spread nodes around them, because
    /// `apply` supplies its array directly and a spread supplies one wrapped.
    /// One copy of the width rule, which is the part worth not having twice.
    pub(super) fn concat_onto(
        &mut self,
        call: NodeId,
        element: &HirType,
        ty: &HirType,
        mut array: ValueId,
        sources: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        // `concat` reads its elements as doubles or as pointers, and a narrower
        // one is neither -- the same line `slice` and the array methods draw,
        // and drawn here rather than emitting a copy that would read the wrong
        // width.
        let helper = match element {
            counted if holds_counted(counted) => counted_helper(counted, Counts::Concat),
            HirType::Float { bits: 64 } => "nts_array_concat",
            // `unknown[]`, which is what a variadic forwarder takes:
            // `emit(type, ...args: unknown[])`. Sixteen bytes an element and a
            // reference only when the tag says so, so neither of the two above
            // can copy one -- the double form reads eight and the reference
            // form would retain a payload that may be a number.
            HirType::Erased => "nts_array_concat_value",
            // A narrower element is a typed array, whose storage is neither a
            // double nor a pointer nor a tagged value.
            _ => {
                return Err(self.unsupported(call, "a spread into a typed array's rest parameter"));
            }
        };
        for inner in sources {
            let inner = *inner;
            let source = self.lower_expression(inner)?;
            // The spread's own element type has to be the parameter's, because
            // the result is read at the parameter's width. Two arrays of one
            // representation are one storage under two names, which
            // `the_same_element` is the general form of.
            if self.values[source.0 as usize].ty != *ty {
                return Err(self.unsupported(
                    inner,
                    "a spread of an array whose elements are not the parameter's",
                ));
            }
            let origin = self.origin(inner);
            array = self.push(
                OpKind::Call {
                    callee: Callee::External(helper.to_owned()),
                    args: vec![array, source],
                    frame: None,
                },
                ty.clone(),
                origin,
            );
        }
        Ok(array)
    }

    /// The element type of a rest parameter written as a union of tuples.
    ///
    /// ```text
    /// constructor(...given: [] | [input: string, base?: string | URL])
    /// ```
    ///
    /// That is how this tree writes "and tell me whether I was called with no
    /// arguments at all". The union is what makes `given.length === 0` a type
    /// the checker can narrow, so the `ERR_MISSING_ARGS` branch is reachable
    /// without consulting `arguments`.
    ///
    /// `type_of` answers `None` for it -- a union of tuples is not an array --
    /// and the rest check read that as "the element type has no
    /// representation". **The message named the wrong half.** `[] | [number]`
    /// has element type `number` in both arms, nothing heterogeneous about it
    /// and nothing unrepresentable, and it refused exactly as
    /// `[] | [string, URL]` did. What was being asked was whether the
    /// *parameter's* type is an array, and a union never is, so the arms were
    /// never looked at.
    ///
    /// So look at them. Every arm must be a tuple or an array, and every
    /// position across every arm must represent the same way; then the rest is
    /// an array of that, which is what a rest parameter already is. The empty
    /// tuple contributes no positions, which is what makes `[] | [T]` work --
    /// it is `T[]` that happens to say "or nothing" in a way the checker can
    /// narrow on.
    ///
    /// **The count stays exact, which is the part that matters.** A rest
    /// parameter is gathered at the call site into a real array, so
    /// `given.length` is the number of arguments actually supplied -- not a
    /// count of leading non-`undefined` values, which is what treating the
    /// tuple as optional parameters would have given. `URLSearchParams#set("a")`
    /// throws where `set("a", undefined)` sets the string `"undefined"`, and
    /// six sites in `searchparams.ts` compare `given.length < 2` to tell those
    /// apart. `url.ts` only ever compares `=== 0`, so the shortcut would have
    /// looked correct in the module that motivated the work and been wrong six
    /// lines away.
    ///
    /// Returns `None` for a union whose positions disagree -- `URL`'s own
    /// `[] | [input: string, base?: string | URL]` is one, holding `string` at
    /// one position and `string | URL | undefined` at the other. There is no
    /// representation for that element and the refusal stands, now for the
    /// reason it names. `blockers/a-rest-parameter-that-is-a-union-of-tuples`
    /// carries both halves and the controls that separate them.
    pub(super) fn rest_element_of_a_tuple_union(&self, name_node: NodeId) -> Option<HirType> {
        self.element_of_a_tuple_union(
            self.after_substitution(*self.snapshot.node_types.get(&name_node)?),
        )
    }

    /// What a type stands for in this copy, as a type id.
    ///
    /// **In a generic's copy the node still reads `A`.** What it stands for
    /// lives in the builder's substitution, and `represent` is where that is
    /// applied -- but it answers an `HirType`, so the id has to be read back out
    /// of it. Asking `node_types` directly gets the type parameter, which is
    /// neither a tuple nor a union.
    ///
    /// One helper because both halves need it and they have to agree: the copy
    /// for `A = []` refused at its own *declaration* while `A = [number]`
    /// compiled beside it, and once that was fixed the same copy refused again
    /// at `cb(...args)` -- the identical mistake, one function along.
    pub(super) fn after_substitution(&self, ty: TypeId) -> TypeId {
        match self.represent(ty) {
            Some(HirType::Managed(ManagedType::Object(substituted))) => substituted,
            _ => ty,
        }
    }

    /// [`Self::rest_element_of_a_tuple_union`] as an array, which is what both
    /// the declaration and the call want.
    pub(super) fn tuple_union_as_array(&self, declared: TypeId) -> Option<HirType> {
        Some(HirType::Managed(ManagedType::Array(Box::new(
            self.element_of_a_tuple_union(self.after_substitution(declared))?,
        ))))
    }

    /// The one element type every position of every arm represents as, or
    /// nothing.
    fn element_of_a_tuple_union(&self, declared: TypeId) -> Option<HirType> {
        let record = self.snapshot.types.get(declared.0 as usize)?;
        // **A bare tuple is the same question with one arm.** `...args: [number,
        // string]` has no union to look at and was refused for it, while
        // `[] | [number, string]` lowered -- one construct, and the *presence of
        // an alternative* deciding whether it worked. A homogeneous bare tuple
        // never reaches here, because `type_of` already answers `Array` for it
        // and the caller takes that branch first.
        let arms: Vec<TypeId> = match &record.kind {
            TypeKind::Union(arms) => arms.clone(),
            TypeKind::Tuple(_) => vec![declared],
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            TypeKind::NonPrimitive | TypeKind::UniqueSymbol => return None,
            _ => return None,
        };
        let mut element: Option<HirType> = None;
        for arm in &arms {
            let arm = self.snapshot.types.get(arm.0 as usize)?;
            let positions = match &arm.kind {
                TypeKind::Tuple(tuple) => tuple.elements.clone(),
                TypeKind::Array(of) => vec![*of],
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                TypeKind::NonPrimitive | TypeKind::UniqueSymbol => return None,
                _ => return None,
            };
            for position in positions {
                // A position with no representation at all still refuses. What
                // follows is about positions that *have* one and disagree.
                let represented = self.represent(position)?;
                match &element {
                    None => element = Some(represented),
                    Some(seen) if *seen == represented => {}
                    // **Positions that disagree are erased, not refused.**
                    //
                    // `URL`'s `[] | [input: string, base?: string | URL]` holds
                    // `string` at one position and `string | URL | undefined`
                    // at the other, and no single concrete element is both. An
                    // erased element is: the general representation is what a
                    // tagged value is for, the call site erases each argument
                    // into the array, and a read comes back through the tag the
                    // checker already proved.
                    //
                    // Agreeing positions keep their concrete element rather
                    // than falling in here, which is not a nicety -- an erased
                    // array costs about 11% against a typed one, all of it the
                    // per-element tag test (`hir::unerase`). So the common case
                    // pays nothing and only the mixed one pays.
                    Some(_) => return Some(HirType::Erased),
                }
            }
        }
        // **Every arm empty: the array is always empty, so any element serves.**
        //
        // `A = []` is what a generic rest binds to when the call passes no extra
        // arguments, and it is the shape `nextTick(() => { … })` produces.
        // Returning nothing here refused the instantiation and left the other
        // one -- `A = [number]` -- compiling beside it, so one call site worked
        // and its neighbour did not.
        element.or(Some(HirType::Erased))
    }

    /// A rest parameter of fixed arity, as one parameter per position.
    ///
    /// See the comment at the call in [`Self::lower_param`] for why the
    /// declaration is the site that changed. This builds the array the name is
    /// bound to as well, which is what lets every other read site stay as it
    /// was.
    pub(super) fn lower_positional_rest(
        &mut self,
        name_node: NodeId,
        index: u32,
        positions: &[TypeId],
    ) -> Result<Vec<Param>, Diagnostic> {
        let origin = self.origin(name_node);
        let name = self
            .node(name_node)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map_or_else(|| format!("arg{index}"), str::to_owned);

        // **The array's element type is the declared one, not one derived from
        // the positions.** Deriving it here was a second derivation of a fact
        // that already had one, and it disagreed at the first shape that
        // captures the binder: `A = []` has no position to infer from, so the
        // invented rule said `Erased` while every other site -- the capture
        // field among them -- had the declared `Array(f64)`. The verifier
        // caught it as a `StoreType`, which is the good outcome of a bad
        // reason.
        let declared = match self.type_of(name_node) {
            Some(HirType::Managed(ManagedType::Array(element))) => Some(*element),
            _ => None,
        };

        let mut params = Vec::with_capacity(positions.len());
        let mut values = Vec::with_capacity(positions.len());
        let mut element: Option<HirType> = declared;
        for (offset, position) in positions.iter().enumerate() {
            let ty = self
                .represent(*position)
                .ok_or_else(|| self.unrepresentable(name_node, "a rest parameter position"))?;
            let ty = in_a_slot(ty);
            self.materialize(name_node, &ty)?;
            // Only where the declaration had nothing to say. Identical
            // positions keep their own type -- `[number, number]` stays an
            // array of numbers -- and anything else erases, which is the same
            // rule `element_of_a_tuple_union` applies across arms.
            element = Some(match element {
                None => ty.clone(),
                Some(seen) if seen == ty => seen,
                Some(_) => HirType::Erased,
            });
            let at = index + u32::try_from(offset).unwrap_or(0);
            values.push(self.push(OpKind::Param(at), ty.clone(), origin.clone()));
            params.push(Param {
                name: format!("{name}_{offset}"),
                ty,
                origin: origin.clone(),
                // Positional, so *ordinary*. Calling it a rest here would put
                // the arity back in dispute at the one place that now agrees.
                shape: ParamShape::Ordinary,
                known: Facts::TOP,
                written: None,
            });
        }

        // **The binding takes the representation its own type has**, and for a
        // tuple of mixed storage widths that is a struct rather than an array.
        //
        // `tuple_representation` sends `[string, number]` -- a pointer beside a
        // double -- to `Managed(Object(ty))`, because no array of one element
        // width holds both. This function ended with an unconditional
        // `Array(element)` whatever the type said, so the gather built an array
        // of erased values and handed it to a constructor declaring the struct:
        //
        //     func Held<13>#constructor(this: managed<obj#13>, args: managed<obj#16>)
        //     func hold<obj16x2>(args_0: managed<str>, args_1: i32)
        //       %3 = array.new 2 : managed<[erased]>
        //       %11 = call Held<13>#constructor(%10, %3)
        //
        // **One type id represented two ways**, which is this file's recurring
        // defect and was never a hard question here: id 16 was agreed, only its
        // width was not. `verify` said nothing because `compatible` accepts any
        // two references, so the JVM's class loader was the only thing that
        // noticed -- `Type 'nts/rt/NtsArrayL' is not assignable to
        // 'nts/gen/Tuple2164'', which blocked `setImmediate` and through it
        // seven runtime modules. On C the pointer was taken and the struct's
        // first field read out of an array header.
        if let Some(HirType::Managed(ManagedType::Object(tuple))) = self.type_of(name_node) {
            return self.gather_a_rest_into_a_struct(name_node, tuple, positions, values, params);
        }
        let element = element.unwrap_or(HirType::Erased);
        let array_ty = HirType::Managed(ManagedType::Array(Box::new(element.clone())));
        self.materialize(name_node, &array_ty)?;
        #[allow(clippy::cast_precision_loss)]
        let count = positions.len() as f64;
        let length = self.push(OpKind::ConstFloat(count), HirType::NUMBER, origin.clone());
        let array = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            array_ty,
            origin.clone(),
        );
        for (offset, value) in values.into_iter().enumerate() {
            let value = self.coerce(value, &element, name_node)?;
            #[allow(clippy::cast_precision_loss)]
            let at = offset as f64;
            let at = self.push(OpKind::ConstFloat(at), HirType::NUMBER, origin.clone());
            self.push(
                OpKind::ArraySet {
                    array,
                    index: at,
                    value,
                    checked: true,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        if let Some(symbol) = self.node(name_node).symbol {
            let array = self.open_cell(symbol.0, array, name_node);
            self.bindings.insert(symbol.0, array);
        }
        Ok(params)
    }

    /// The struct half of [`Self::lower_positional_rest`]'s gather.
    ///
    /// A tuple's layout is an object whose fields are named `0`, `1`, ... in
    /// position order -- `layout_of`'s own comment says `[string, number]` *is* a
    /// two-field struct -- so this is the object-literal construction with the
    /// positions as the keys, and it gets field access, escape analysis and
    /// reference counting from that rather than from a second mechanism.
    ///
    /// The field's own type is what each position is coerced to, read from the
    /// layout rather than from the position's type. Those are the same fact, and
    /// the layout is the one the *reader* will use: a value built at one and read
    /// at the other is the defect this function exists to remove, one level down.
    fn gather_a_rest_into_a_struct(
        &mut self,
        name_node: NodeId,
        tuple: TypeId,
        positions: &[TypeId],
        values: Vec<ValueId>,
        params: Vec<Param>,
    ) -> Result<Vec<Param>, Diagnostic> {
        let origin = self.origin(name_node);
        let ty = HirType::Managed(ManagedType::Object(tuple));
        self.materialize(name_node, &ty)?;
        // A layout with fewer fields than the tuple has positions would store
        // some of them nowhere, and a silent partial gather is how a wrong
        // answer looks. Resolved position by position through
        // [`Self::tuple_field_at`], which is also what the reader uses, so a
        // position with no field is a refusal here rather than a store that
        // goes nowhere.
        let mut slots = Vec::with_capacity(positions.len());
        for at in 0..positions.len() {
            let Some(slot) = self.tuple_field_at(name_node, tuple, at) else {
                return Err(self.unsupported(
                    name_node,
                    &format!(
                        "a rest parameter of {} position(s) whose tuple is not laid out with position {at}",
                        positions.len()
                    ),
                ));
            };
            slots.push(slot);
        }
        let object = self.push(OpKind::ObjectNew { frame: false }, ty, origin.clone());
        for (value, (field, slot)) in values.into_iter().zip(slots) {
            let value = self.coerce(value, &slot, name_node)?;
            self.field_set(object, field, value, &origin);
        }
        if let Some(symbol) = self.node(name_node).symbol {
            let object = self.open_cell(symbol.0, object, name_node);
            self.bindings.insert(symbol.0, object);
        }
        Ok(params)
    }
}

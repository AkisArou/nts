//! Determine written and emitted return types and their obligations.

use super::{
    Absence, Absent, CallbackReturn, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind,
    PropertyKey, SemanticSnapshot, Terminator, TypeId, TypeKind, ValueId, absence_of_member,
    closure_index, describe, erasable, generic_values, representation_word, signature_key, syntax,
};

/// The kinds of value an erased slot's tag tells apart, where reading one
/// kind's payload as another's is a wrong answer and not a conversion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AnswerFamily {
    Number,
    Boolean,
    BigInt,
    String,
    Reference,
    Native,
    Nothing,
}

/// Which kind of value `ty` is to a reader that unerases it, and `None` where
/// there is nothing to compare: an erased value carries its own tag for the
/// reader to test, and `never` is no value at all.
///
/// A function answering `never` does not return, so nothing ever reads its
/// answer -- `invoke(() => { throw new Error() })` into `callback: () =>
/// number` is TypeScript's own case, and a throw from a closure held in a
/// field (`outcomes/a-throw-from-a-closure-held-in-a-field-escapes-a-try`) is
/// that answer reaching a slot that reads a string. `void` is different: the
/// function returns, with `undefined`, and a reader of a number reads that.
///
/// Integers and doubles are one family: a number erases as a number whatever
/// its width, and unerasing it at another width converts. Every reference
/// other than a string is one family too; whether two object layouts agree is
/// a different question, with its own rule.
const fn answer_family(ty: &HirType) -> Option<AnswerFamily> {
    Some(match ty {
        HirType::Int { .. } | HirType::Float { .. } => AnswerFamily::Number,
        HirType::Bool => AnswerFamily::Boolean,
        HirType::BigInt => AnswerFamily::BigInt,
        HirType::Managed(ManagedType::String) => AnswerFamily::String,
        HirType::Managed(_) => AnswerFamily::Reference,
        HirType::NativePointer(_) => AnswerFamily::Native,
        HirType::Void => AnswerFamily::Nothing,
        HirType::Erased | HirType::Never | HirType::PossiblyUndefined(_) => return None,
    })
}

/// What a null pointer a closure returns means, read from the closure's own
/// signature: `null` where its result's absences are `null` alone,
/// `undefined` where `undefined` alone, and `Impossible` otherwise -- a
/// result that is not a reference, a closure with no signature of its own (one
/// the compiler makes), or both absences at once, which one pointer cannot
/// tell apart (see `FuncBuilder::absence_at_excluding`).
pub(super) fn closure_result_absent(
    snapshot: &SemanticSnapshot,
    closure: NodeId,
    returns: &HirType,
) -> Absent {
    if !crate::hir::tags::payload_is_a_reference(returns) {
        return Absent::Impossible;
    }
    let signature = snapshot
        .node_types
        .get(&closure)
        .and_then(|ty| snapshot.types.get(ty.0 as usize))
        .and_then(|record| match record.kind {
            TypeKind::Function(signature) => snapshot.signatures.get(signature.0 as usize),
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
            _ => None,
        });
    let Some(result) = signature.map(|signature| signature.return_type) else {
        return Absent::Impossible;
    };
    absent_of_result(snapshot, result)
}

/// What a null pointer standing for a value of the checker's type `result`
/// means: `null` where its absences are `null` alone, `undefined` where
/// `undefined` alone, and `Impossible` otherwise. A closure's signature and a
/// virtual bridge's method (`virtual_returns`) both ask it.
pub(super) fn absent_of_result(snapshot: &SemanticSnapshot, result: TypeId) -> Absent {
    let members = match snapshot
        .types
        .get(result.0 as usize)
        .map(|record| &record.kind)
    {
        Some(TypeKind::Union(members)) => members.clone(),
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => vec![result],
        _ => vec![result],
    };
    let absences: Vec<Absence> = members
        .iter()
        .filter_map(|member| absence_of_member(snapshot, *member))
        .collect();
    match (
        absences.contains(&Absence::Null),
        absences.contains(&Absence::Undefined),
    ) {
        (true, false) => Absent::Null,
        (false, true) => Absent::Undefined,
        _ => Absent::Impossible,
    }
}

/// Whether a closure's result crosses an erased call as itself: already
/// erased, nothing at all, or something with an erased form.
pub(in crate::hir) fn result_crosses(returns: &HirType) -> bool {
    matches!(returns, HirType::Erased | HirType::Void | HirType::Never) || erasable(returns)
}

impl FuncBuilder<'_> {
    /// What a function declaration returns.
    ///
    /// From its *signature*, not from an annotation node. Reading the annotation
    /// works for `function f(): number` and silently gives `void` for
    /// `function f()` -- so an un-annotated function had its result dropped, in
    /// the generated C and in every analysis. TypeScript infers a return type
    /// whether or not one is written down, and the inferred one is in the
    /// snapshot exactly like the written one.
    /// What a function returns, or a refusal naming what it declares.
    ///
    /// `declared_return` answers `None` to two different questions -- "declares
    /// nothing" and "declares something with no representation" -- and the
    /// callers used to default both to `void`. Only the first is void.
    ///
    /// The second built a function whose HIR said it returned nothing and whose
    /// body returned a value. `ref(): this` is the shape: TypeScript models the
    /// polymorphic `this` as a type parameter constrained to the class, which
    /// has no representation here, so the method lowered as `-> void` with `ret
    /// %0` in it and the C came out as `void FSWatcher__ref(...)` returning a
    /// pointer. Nothing caught it: the lowering reported the function as
    /// complete, and the verifier runs on the *pruned* program while an addon
    /// emits every export.
    pub(super) fn return_type_of(&mut self, id: NodeId) -> Result<HirType, Diagnostic> {
        if let Some(ty) = self.declared_return(id) {
            return Ok(ty);
        }
        // Nothing representable came back. A function that genuinely returns
        // nothing is void; anything else is refused, and named.
        if let Some(ty) = self.snapshot.node_types.get(&id).copied()
            && let Some(record) = self.snapshot.types.get(ty.0 as usize)
            && let TypeKind::Function(signature) = record.kind
            && let Some(signature) = self.snapshot.signatures.get(signature.0 as usize)
        {
            let returned = signature.return_type;
            let is_nothing = matches!(
                self.snapshot
                    .types
                    .get(returned.0 as usize)
                    .map(|r| &r.kind),
                Some(TypeKind::Void | TypeKind::Undefined)
            );
            // A generator returns a `Generator<...>`, which has no
            // representation -- but refusing it here names the *consequence*
            // and buries the cause. The body's `yield` is the cause, it is
            // refused by name, and its message is the one a work-list can
            // group by. So this defers, and the `void` below never survives:
            // the `yield` refuses the function before anything reads it.
            if !is_nothing && !self.mentions(id, syntax::YIELD_EXPRESSION) {
                let what = describe(self.snapshot, returned);
                return Err(self.unsupported(id, &format!("a function returning {what}")));
            }
        }
        // The same distinction one node kind over. A getter reaches here only
        // when `declared_return` could not represent its property type, and
        // `void` would be the wrong answer for exactly the reason above -- so
        // it is named instead of silently returning nothing.
        if self.kind_of(id) == Some(syntax::GET_ACCESSOR)
            && let Some(&ty) = self.snapshot.node_types.get(&id)
            && !matches!(
                self.snapshot
                    .types
                    .get(ty.0 as usize)
                    .map(|record| &record.kind),
                Some(TypeKind::Void | TypeKind::Undefined)
            )
        {
            let what = describe(self.snapshot, ty);
            return Err(self.unsupported(id, &format!("a getter returning {what}")));
        }
        Ok(HirType::Void)
    }

    /// What a call through this closure *value* produces.
    ///
    /// From the callee's own function type rather than from the call
    /// expression's type, and the difference is load-bearing for `f?.(x)`: the
    /// expression is `T | undefined`, because the `?.` can skip the call, and
    /// the call itself still returns `T`. Spelling the expression's type as the
    /// call's result cast a `double`-returning implementation to one returning
    /// `NtsValue`, and the answer came back as the bit pattern of a struct.
    pub(super) fn returned_by(&self, callee: ValueId) -> Option<HirType> {
        let HirType::Managed(ManagedType::Object(ty)) = self.values[callee.0 as usize].ty else {
            return None;
        };
        // **A closure class is not a function type in the snapshot**, so asking
        // the checker about the synthetic id answers nothing and this fell through
        // to the *expression's* type -- the very thing the caller's comment says
        // must not decide a call's result. Where the receiver has been narrowed to
        // one closure class the callee is that class's own `#call`, so its return
        // is the closure's own, which is a question the checker can answer about
        // the arrow it came from.
        //
        // It cost an uncompilable program: `const slot: () => unknown = aVoidOne;
        // slot()` narrowed to the class, called `Closure0#call` directly, took
        // `unknown` from the expression, and C emitted `v1 = <void call>` where
        // `v1` rightly has no declaration.
        if ty.0 >= crate::hir::SYNTHETIC_TYPE_FLOOR {
            let info = self.closures.get(closure_index(ty))?;
            if generic_values::is_canonical(self.snapshot, info) {
                return Some(HirType::Erased);
            }
            let declared = *self.snapshot.node_types.get(&info.node)?;
            return self.represent(signature_key(self.snapshot, declared)?.1);
        }
        let record = self.snapshot.types.get(ty.0 as usize)?;
        let nts_semantic_schema::TypeKind::Function(signature) = record.kind else {
            return None;
        };
        let signature = self.snapshot.signatures.get(signature.0 as usize)?;
        self.represent(signature.return_type)
    }

    /// The return type a function expression's **context** gives it, where its
    /// own inferred one has no representation.
    ///
    /// Contextual typing gives an arrow's *parameters* their types and leaves its
    /// return inferred from the body, so
    ///
    /// ```ts
    /// const make: (name: string) => Task | null = (_name) => null;
    /// ```
    ///
    /// has the checker answering `(_name: string) => null` for the arrow itself.
    /// `null` has no representation of its own, so `declared_return` came back
    /// `None` and `return_type_of` refused by name -- while the same arrow written
    /// `(_name): Task | null =>` compiles and agrees with node. The React lane
    /// reported it at 20 cascades; it is also what was left on the statement
    /// `7bee3c808` was about.
    ///
    /// **The contextual signature is already decomposed**, which is why this needs
    /// no `getContextualType` and no schema change. `nts types` on the line above
    /// prints the arrow's own `(_name: #4) -> #5` beside the annotation's
    /// `(name: #4) -> #1`, and `#1` represents.
    ///
    /// **Only the immediate context, named rather than searched.** Walking up for
    /// "the nearest function type" would find the *enclosing* function for an
    /// arrow written inside one, and take its return type -- a wrong answer rather
    /// than a refusal, in a function that compiles. So the parent must be a
    /// position that actually supplies a contextual type, and this admits one:
    /// a variable declaration whose initializer the function is. An argument at a
    /// parameter position is the other common one (`scheduleCallback(priority, ()
    /// => { ...; return null; })`) and is a second change, because it has to
    /// resolve the call's signature and the argument's index and can be wrong in
    /// ways this cannot.
    ///
    /// Taking a *wider* type than the body returns is the safe direction and the
    /// only one reachable: the body's value is coerced at the `return`, exactly as
    /// a written annotation already makes it, and a contextual type narrower than
    /// the body returns is an assignment the checker would have rejected.
    fn contextual_return(&self, id: NodeId) -> Option<HirType> {
        self.represent(self.contextual_return_type(id)?)
    }

    /// The type [`Self::contextual_return`] represents, as the checker's type:
    /// the one walk, for the reader that needs the type itself.
    /// [`Self::generator_declared`] takes it as the abstract generator a
    /// generator closure's frame extends.
    ///
    /// **And an element of a typed array**, the second position this admits:
    /// `const makers: Make[] = [function* () { ... }]` gives each element
    /// `Make`, as the declaration gives its initializer. Read from the
    /// declaration's type, `F[]`, rather than the literal's own, which the
    /// checker infers from the elements and so says what the function already
    /// does. A tuple's position, like an argument's, is a later change.
    pub(super) fn contextual_return_type(&self, id: NodeId) -> Option<TypeId> {
        if !matches!(
            self.kind_of(id),
            Some(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION)
        ) {
            return None;
        }
        // Through a conditional and through parentheses, because that is where
        // the shape this was written for actually lives:
        //
        //     const createTask: (name: string) => Task | null =
        //       isDevelopment && ... ? (name) => ... : (_name) => null;
        //
        // Both arms of a conditional have the conditional's own contextual type,
        // so recursing is sound and stopping at the immediate parent is what made
        // the first version of this clear **nothing** on the corpus it was written
        // for -- the arrow's parent there is the `?:`, not the declaration.
        // [`Self::contextual_type`] recurses through the same two node kinds for
        // the same reason.
        //
        // The *condition* is excluded: it has no contextual type from the
        // declaration, and an arrow written there would otherwise be given the
        // declaration's return type, which is a wrong answer rather than a
        // refusal.
        let mut child = id;
        let mut parent = self.syntactic_parent(id)?;
        for _ in 0..8 {
            match self.kind_of(parent) {
                Some(syntax::PARENTHESIZED_EXPRESSION) => {}
                Some(syntax::CONDITIONAL_EXPRESSION) => {
                    if self.children(parent).first().copied() == Some(child) {
                        return None;
                    }
                }
                _ => break,
            }
            child = parent;
            parent = self.syntactic_parent(parent)?;
        }
        let in_array = self.kind_of(parent) == Some(syntax::ARRAY_LITERAL_EXPRESSION);
        if in_array {
            child = parent;
            parent = self.syntactic_parent(parent)?;
        }
        if self.kind_of(parent) != Some(syntax::VARIABLE_DECLARATION) {
            return None;
        }
        // The initializer and not the name, so `const f = ...` cannot read its
        // own binding's type when the binding is what the arrow defines.
        if self.children(parent).last().copied() != Some(child) {
            return None;
        }
        let mut ty = self.snapshot.node_types.get(&parent).copied()?;
        if in_array {
            let nts_semantic_schema::TypeKind::Array(element) =
                self.snapshot.types.get(ty.0 as usize)?.kind
            else {
                return None;
            };
            ty = element;
        }
        let record = self.snapshot.types.get(ty.0 as usize)?;
        let nts_semantic_schema::TypeKind::Function(signature) = record.kind else {
            return None;
        };
        Some(
            self.snapshot
                .signatures
                .get(signature.0 as usize)?
                .return_type,
        )
    }

    pub(super) fn declared_return(&self, id: NodeId) -> Option<HirType> {
        if let Some((body, contract)) = self.selected_result
            && body == id
        {
            let signature = self.snapshot.signatures.get(contract.resolved.0 as usize)?;
            return self.represent(signature.return_type);
        }
        // **A `get` accessor's node type is the property it defines**, not a
        // function type, so the signature branch below can never match one and
        // the by-elimination branch under it is what answered for every getter
        // that worked. That branch finds the *written annotation*, so
        // `get v(): number` was right and `get v()` fell through both and came
        // back `None` -- which `return_type_of` reads as "returns nothing".
        //
        // The result was a getter lowered as `-> void` with its `return`
        // dropped, and a call site that read the property type and expected a
        // value. Two derivations of one fact, disagreeing, with nothing between
        // them: `v3 = Type4__get_double(v1)` where the callee returns `void`,
        // which is C that does not compile -- emitted after `nothing refused`.
        // An un-annotated getter is the ordinary way to write one, so this was
        // every inferred getter on a class and in an object literal alike.
        if self.kind_of(id) == Some(syntax::GET_ACCESSOR) {
            return self
                .snapshot
                .node_types
                .get(&id)
                .copied()
                .and_then(|ty| self.represent(ty));
        }
        if let Some(ty) = self.snapshot.node_types.get(&id)
            && let Some(record) = self.snapshot.types.get(ty.0 as usize)
            && let nts_semantic_schema::TypeKind::Function(signature) = record.kind
            && let Some(signature) = self.snapshot.signatures.get(signature.0 as usize)
            && let Some(returned) = self.represent(signature.return_type)
        {
            return Some(returned);
        }
        if let Some(returned) = self.contextual_return(id) {
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
        // Whatever is neither the name, a parameter, nor the body. By node
        // rather than by kind: `set ["size"](n: number)` has no return
        // annotation at all, and reading its name as one gave the setter a
        // `number` return it never produces -- which the emitter honestly
        // rendered as a store followed by `__builtin_unreachable()`, and the C
        // compiler then took as a licence to compute anything at all in the
        // caller.
        let name = self.name_node(id);
        self.children(id)
            .into_iter()
            .filter(|child| {
                self.kind_of(*child) != Some(syntax::PARAMETER)
                    && Some(*child) != body
                    && Some(*child) != name
            })
            .find_map(|child| self.type_of(child))
    }

    /// Make sure an object type has a layout, because a signature mentions it.
    ///
    /// A layout is otherwise discovered by whatever *constructs* the object,
    /// and a function that only receives or returns one constructs nothing. A
    /// function type is the case that made this visible: no program ever
    /// constructs a signature, only closures that have it as their base.
    ///
    /// Discover every layout the type needs, not only its own.
    ///
    /// An array of objects needs one for its element as much as for itself, and
    /// the layout it is missing belongs to a type no *function* mentioned. A
    /// `Map<string, Step>` and a `Set<Step>` are the same case one level in:
    /// `table.get(name)` hands back a `Step`, and until this walked into them
    /// the only way a signature type acquired a layout was by being the
    /// element of an array.
    ///
    /// Through *containers* and not through an object's fields. Recursing into
    /// fields as well demanded a layout for every field type whether or not
    /// anything reads it, which refused a class for holding a `Map` it never
    /// touches -- 81 functions in the node profile, to fix nothing: the case
    /// that prompted it was not reached this way either.
    ///
    /// This visits every payload in the finite container tree iteratively,
    /// including record tables and optional values. Objects are leaves: their
    /// fields are deliberately not part of this discovery request.
    pub(super) fn materialize(&mut self, at: NodeId, mut ty: &HirType) -> Result<(), Diagnostic> {
        let mut pending = Vec::new();
        loop {
            match ty {
                HirType::Managed(ManagedType::Object(object)) => {
                    self.layout_of(at, *object)?;
                }
                HirType::PossiblyUndefined(payload)
                | HirType::Managed(
                    ManagedType::Array(payload)
                    | ManagedType::Promise(payload)
                    | ManagedType::Set(payload),
                ) => {
                    ty = payload;
                    continue;
                }
                HirType::Managed(ManagedType::Map(key, value) | ManagedType::Table(key, value)) => {
                    // Only a fork needs a work stack. Scalar types and unary
                    // container chains retain the former allocation-free path.
                    pending.push(value.as_ref());
                    ty = key;
                    continue;
                }
                // Views have scalar elements, and object fields are handled
                // by their own layout request rather than this container walk.
                _ => {}
            }
            let Some(next) = pending.pop() else {
                return Ok(());
            };
            ty = next;
        }
    }

    /// A closure whose result has no erased form -- a host handle, today --
    /// admitted where a signature reads its result *as something else*.
    ///
    /// Where the signature's result is the closure's own representation, a
    /// call through it takes the closure's typed entry (or, specialized, the
    /// closure itself) and the handle passes unchanged: `const pick = ():
    /// Node => pool[0]; pick()` and `read(f: () => Node)` both compile to a
    /// direct typed call. Where the representations differ, the call adapts
    /// through the closure's erased entry, which answers its result erased;
    /// such a closure's entry drops the result instead ([`erased_call`](super::erased_call)),
    /// exactly right where the signature returns `void` and a wrong answer
    /// anywhere else. So only that admission is refused, here, where it is
    /// written, rather than reaching the entry at run time. Refusing every
    /// reading signature refused the local case too
    /// (`blockers/a-closure-returning-a-host-handle-is-refused-since-a2`).
    pub(super) fn result_without_an_erased_form(
        &self,
        have: &HirType,
        want: &HirType,
    ) -> Option<String> {
        let (returns, read) = self.closure_results(have, want)?;
        if matches!(read, HirType::Void | HirType::Never) {
            return None;
        }
        (!result_crosses(&returns) && returns != read).then(|| {
            "a closure whose result has no erased form, passed where a signature reads its result: \
             a call through the signature could not return it"
                .to_owned()
        })
    }

    /// A closure answering **another kind** of value than the signature it is
    /// admitted at reads.
    ///
    /// The call through the slot takes the closure's erased entry, which
    /// answers its result erased, and the call site unerases it at the
    /// signature's representation -- unchecked, as every `Unerase` is, because
    /// the checker said the two agree. In unchecked JavaScript they need not:
    ///
    /// ```text
    /// var object = { valueOf: function () { return 1; } };
    /// var object = { valueOf: function () { return "1"; } };
    /// ```
    ///
    /// is one variable typed by the first declaration, the second literal is
    /// built at that type, and its `valueOf` -- answering a string -- went into
    /// a field whose signature answers a number. `object.valueOf()` read the
    /// string pointer's bits as a double: a denormal near 4.66e-310 where node
    /// says `"1"` (`outcomes/a-var-redeclared-at-another-function-type`).
    ///
    /// Refused where the two are of different [`answer_family`]s. Admitted
    /// where the signature reads an erased value (its reader tests the tag) or
    /// nothing (the entry drops it), where the closure answers an erased value
    /// (the checker let `() => any` stand for anything, and the call trusts
    /// it as TypeScript does) or `never` (it does not return, so nothing reads
    /// an answer), and within one family: a number is a number at either
    /// width. A parameter needs no such rule: the erased entry admits
    /// each argument against the closure's own parameter and stops by name
    /// when one does not fit.
    pub(super) fn result_of_another_kind(&self, have: &HirType, want: &HirType) -> Option<String> {
        let (returns, read) = self.closure_results(have, want)?;
        let (Some(answers), Some(reads)) = (answer_family(&returns), answer_family(&read)) else {
            return None;
        };
        (answers != reads && reads != AnswerFamily::Nothing).then(|| {
            format!(
                "a function answering {} where a function answering {} is wanted -- a call \
                 through the slot would read its answer as {}",
                representation_word(&returns),
                representation_word(&read),
                representation_word(&read)
            )
        })
    }

    /// A closure answering an object of **another layout** than the one the
    /// signature it is admitted at reads.
    ///
    /// The same kind -- a reference -- so [`Self::result_of_another_kind`]
    /// admits it, and the same blind read: the call site unerases the answer
    /// at the signature's object type and reads its fields at that type's
    /// offsets. `var o = { make() { return { a: 1, b: "x" } } }` declared again
    /// with `make` answering `{ b: "y" }` read `b` from the second slot of a
    /// one-field object, and the program died on SIGSEGV where node says `"y0"`
    /// (`outcomes/a-var-redeclared-returning-another-object-layout`).
    ///
    /// Refused where the answer's layout is not a prefix of the read one, which
    /// is [`Self::not_a_prefix`]'s question and its sentence; a prefix -- a
    /// subclass, or the same shape -- reads every field where it is. Admitted,
    /// as a value of the type is ([`Self::native_field_view`]), where the read
    /// type is a face that carries the answer's: its reads find each carried
    /// owner's fields wherever that owner keeps them.
    pub(super) fn result_of_another_layout(
        &mut self,
        id: NodeId,
        have: &HirType,
        want: &HirType,
    ) -> Option<String> {
        let (
            HirType::Managed(ManagedType::Object(answers)),
            HirType::Managed(ManagedType::Object(reads)),
        ) = self.closure_results(have, want)?
        else {
            return None;
        };
        if answers == reads || self.hierarchy.access_families.carries(answers, reads) {
            return None;
        }
        let why = self.not_a_prefix(id, answers, reads)?;
        let (held, wanted) = (
            self.type_in_a_message(answers),
            self.type_in_a_message(reads),
        );
        Some(format!(
            "a function's answer: {}",
            why.spell(&held, &wanted)
        ))
    }

    /// What a closure answers and what the signature it is admitted at reads,
    /// each at its representation: the pair the closure-result rules above
    /// compare. `None` where `have` is not a closure arriving at another type,
    /// or either answer has no representation.
    fn closure_results(&self, have: &HirType, want: &HirType) -> Option<(HirType, HirType)> {
        let (
            HirType::Managed(ManagedType::Object(from)),
            HirType::Managed(ManagedType::Object(to)),
        ) = (have, want)
        else {
            return None;
        };
        if from == to || !crate::hir::is_closure_type(*from) {
            return None;
        }
        let (_, read) = signature_key(self.snapshot, *to)?;
        let read = self.represent(read)?;
        let node = self.closures.get(closure_index(*from))?.node;
        let ty = *self.snapshot.node_types.get(&node)?;
        let TypeKind::Function(signature) = self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        let returns = self.represent(
            self.snapshot
                .signatures
                .get(signature.0 as usize)?
                .return_type,
        )?;
        Some((returns, read))
    }

    /// Whether `declaration` -- a variable, a parameter, a property, a
    /// function -- has a type annotation: a type node among its own children,
    /// which for a function is its return type's.
    pub(super) fn annotated(&self, declaration: NodeId) -> bool {
        crate::hir::written_scalar::annotated(self.snapshot, declaration)
    }

    /// The scalar kind `name`'s declaration was **written** as
    /// (`docs/records/notebooks/scalar-numbers.md`, S3): the type its annotation names, or for a
    /// parameter with neither annotation nor default, the type its context
    /// declares -- a binding's callback, a declared function type. Never an
    /// inferred type: `let n = get_n_items()` holds a `number`, and what is
    /// later stored into it is the program's own business. Through the one
    /// recognizer, [`crate::hir::native::scalar`].
    pub(super) fn written_kind(&self, name: NodeId) -> Option<crate::hir::native::Scalar> {
        let declaration = self.syntactic_parent(name)?;
        let resolved = *self.snapshot.node_types.get(&name)?;
        crate::hir::written_scalar::parameter(self.snapshot, declaration, resolved)
    }

    /// The scalar kind `ty` is, an optional one's included: `T | undefined`
    /// of a scalar is written as `T` (S3), and the absence is the slot's own
    /// ([`crate::hir::native::present_scalar`]).
    pub(super) fn written_scalar(&self, ty: TypeId) -> Option<crate::hir::native::Scalar> {
        crate::hir::native::present_scalar(self.snapshot, ty)
    }

    /// A store of `value` into the local `symbol`: an obligation where its
    /// declaration was written as a kind (`let n: Uint8`), at its declaration
    /// and at every later assignment.
    pub(super) fn oblige_local(&mut self, symbol: u32, value: ValueId, at: NodeId) {
        if let Some(kind) = self.written_kind_of_symbol(symbol) {
            let local = self
                .snapshot
                .symbols
                .get(symbol as usize)
                .map(|record| record.name.to_string())
                .unwrap_or_default();
            self.oblige(
                value,
                kind,
                crate::hir::obligations::Into::Local { local },
                at,
            );
        }
    }

    /// The kind a local's declaration was written as.
    pub(super) fn written_kind_of_symbol(&self, symbol: u32) -> Option<crate::hir::native::Scalar> {
        let record = self.snapshot.symbols.get(symbol as usize)?;
        record.declarations.iter().find_map(|declaration| {
            let name = self.children(*declaration).into_iter().find(|child| {
                self.node(*child)
                    .symbol
                    .is_some_and(|named| named.0 == symbol)
            })?;
            self.written_kind(name)
        })
    }

    /// Record that `value` must fit `kind` (see [`crate::hir::obligations`]): a
    /// store the HIR keeps no slot for.
    pub(super) fn oblige(
        &mut self,
        value: ValueId,
        kind: crate::hir::native::Scalar,
        into: crate::hir::obligations::Into,
        at: NodeId,
    ) {
        let location = self.location(at);
        self.obligations
            .push(crate::hir::obligations::Obligation::new(
                value,
                self.current,
                (kind, None),
                into,
                location,
            ));
    }

    /// The kind each position of a tuple a function's return type was
    /// **written** as (`[c_int, c_int]`); empty for any other
    /// return type, or one not annotated.
    pub(super) fn written_tuple_return(
        &self,
        declaration: NodeId,
    ) -> Vec<Option<crate::hir::native::Scalar>> {
        if !self.annotated(declaration) {
            return Vec::new();
        }
        let elements = match self
            .declared_result_type(declaration)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
        {
            Some(record) => match &record.kind {
                TypeKind::Tuple(tuple) => tuple.elements.clone(),
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                TypeKind::NonPrimitive | TypeKind::UniqueSymbol => return Vec::new(),
                _ => return Vec::new(),
            },
            None => return Vec::new(),
        };
        let kinds: Vec<_> = elements
            .iter()
            .map(|element| self.written_scalar(*element))
            .collect();
        if kinds.iter().any(Option::is_some) {
            kinds
        } else {
            Vec::new()
        }
    }

    /// A `return` of a tuple the function was written to return with scalar
    /// kinds: each position is obliged to fit its kind, read from the value
    /// returned, so a caller may read that position as the kind's range.
    fn oblige_tuple_return(&mut self, value: ValueId, at: NodeId) -> Result<(), Diagnostic> {
        let kinds = self.return_elements.clone();
        let ty = self.values[value.0 as usize].ty.clone();
        for (position, kind) in kinds.iter().enumerate() {
            let Some(kind) = *kind else { continue };
            let element = self.tuple_element(at, value, &ty, kinds.len(), position)?;
            self.oblige(
                element,
                kind,
                crate::hir::obligations::Into::ReturnElement { position },
                at,
            );
        }
        Ok(())
    }

    /// An element of the tuple literal a `return` is lowering
    /// ([`Self::returned_literal`]), obliged to the kind its position was
    /// written as.
    pub(super) fn oblige_returned_element(
        &mut self,
        literal: NodeId,
        position: usize,
        value: ValueId,
        element: NodeId,
    ) {
        if self.returned_literal == Some(literal)
            && let Some(Some(kind)) = self.return_elements.get(position).copied()
        {
            self.oblige(
                value,
                kind,
                crate::hir::obligations::Into::ReturnElement { position },
                element,
            );
        }
    }

    /// The scalar kind a function's return type was **written** as: its
    /// annotation's, as [`Self::written_kind`] reads a variable's.
    ///
    /// An `async` function's is its promise's payload (`Promise<c_long>`): the
    /// value each `return` settles it with, and an `await` of the call reads.
    pub(super) fn written_return(&self, declaration: NodeId) -> Option<crate::hir::native::Scalar> {
        let returns = self.declared_result_type(declaration)?;
        crate::hir::written_scalar::returned(self.snapshot, declaration, returns)
    }

    /// A `return`, which has three destinations and a value for each.
    ///
    /// Its own function because it is the last statement kind that was not:
    /// `lower_if`, `lower_while`, `lower_switch`, `lower_for` and the rest are
    /// each one, and this arm had grown past all of them inside
    /// `lower_statement`'s match. Clippy's line count is what said so, and
    /// extracting the concept is the answer this file has taken for that signal
    /// three times now rather than an `allow`.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn lower_return(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let expression = self.children(id).first().copied();
        // **At the type the signature declares**, where that is this
        // function's own return. A local declaration lowers its
        // initializer at its annotation and a call argument at its
        // parameter, and a `return` did neither -- so
        // `function make(): Opts[] { return [{ a: 1 }] }` built the
        // literal at its *own* element type and met `coerce` one line
        // later, refused as *an array of ... where an array of ... is
        // wanted*: a cast this never had to make.
        //
        // Decided **before** lowering rather than at the coercion below,
        // because the three destinations a `return` can have want three
        // different types, and two of them are knowable here.
        //
        // A **callback** return hands the value to an iteration's
        // accumulator, whose type the loop decides and this cannot see,
        // so that one is left alone.
        //
        // An **`async`** settle hands it to a promise, and the payload
        // is written on `AsyncResult` for exactly the reason this needs
        // it. That was excluded at first, which left `async function
        // make(): Promise<P> { return { x: 1 } }` refusing — ``an
        // anonymous type` where a `P` is wanted` for a literal that
        // simply had not been told what it was, while the identical
        // `return` in a synchronous function lowered. One fact, and the
        // exclusion was mine.
        //
        // `Void` is excluded on both paths for the same reason the arm
        // below drops the value entirely.
        let want = if self.callback_returns.last().is_some() {
            None
        } else if let Some(result) = &self.async_result {
            Some(result.payload.clone())
        } else {
            Some(self.returns.clone())
        }
        .filter(|ty| !matches!(ty, HirType::Void));
        // **A constructor that returns an object replaces `this`, and this
        // cannot.** `[[Construct]]` takes the constructor's result when it is an
        // Object and `this` otherwise, so
        //
        //     class Returning { constructor() { return {} } }
        //     new Returning() instanceof Returning        // false in the language
        //
        // and nts answered `true`, having ignored the `return` -- a wrong answer
        // for `new`, for `instanceof`, and for every field read on the result,
        // which sees the class's layout over an object that does not have it.
        //
        // **Refused rather than honoured, because the layouts need not agree.**
        // The returned object is an ordinary object literal: its layout is
        // whatever it declares, not the class's, so handing it back as the
        // class's instance is exactly the pointer-into-a-disagreeing-struct
        // confusion this compiler refuses everywhere else. Replacing `this`
        // soundly means the `new` site reading the result and every later access
        // going through whatever it turns out to be -- an erased receiver, which
        // is the interface-indirection work rather than a clause here.
        //
        // `return;` and `return this` stay: the specification ignores a
        // non-Object result, and `this` is what `new` answers anyway, so a
        // constructor ending in `return this` is the common idiom and is exact.
        // Pinned as `outcomes/a-{base,derived}-constructor-returning-an-object`,
        // one cause across two fixtures.
        if self.in_constructor
            && let Some(expression) = expression
            && self.kind_of(expression) != Some(syntax::THIS_KEYWORD)
            && self
                .type_of(expression)
                .is_some_and(|ty| ty.holds_a_pointer() || ty == HirType::Erased)
        {
            return Err(self.unsupported(
                expression,
                "a constructor returning an object, which replaces the instance \
                     `new` would have answered",
            ));
        }
        // And `return;` in an `extends null` constructor returns the `this`
        // no `super()` bound -- the same `ReferenceError` as falling off the
        // end. `return undefined` is the same return; its operand still runs.
        if self.in_constructor
            && self.this_is_never_bound(id)
            && expression.is_none_or(|expression| self.type_of(expression) == Some(HirType::Void))
        {
            if let Some(expression) = expression {
                self.lower_expression(expression)?;
            }
            self.throw_unbound_this(id)?;
            self.terminate(Terminator::Unreachable);
            return Ok(());
        }
        // The function's own return of a tuple written with scalar kinds,
        // not an inlined callback's: a literal's elements are obliged as
        // they are lowered, anything else read back.
        let obliged = expression
            .filter(|_| self.callback_returns.is_empty() && !self.return_elements.is_empty());
        let literal = obliged
            .map(|expression| self.through_parentheses(expression))
            .filter(|node| self.kind_of(*node) == Some(syntax::ARRAY_LITERAL_EXPRESSION));
        let outer = std::mem::replace(&mut self.returned_literal, literal);
        let value = match (expression, &want) {
            (Some(expression), Some(want)) => self.lower_expecting(expression, want).map(Some),
            (Some(expression), None) => self.lower_expression(expression).map(Some),
            (None, _) => Ok(None),
        };
        self.returned_literal = outer;
        let value = value?;
        // An `async` function settles its promise rather than returning to
        // its caller, so its written payload is obliged here.
        if let (Some(value), Some(expression), Some(kind)) = (
            value,
            expression,
            self.async_result.as_ref().and_then(|result| result.written),
        ) && self.callback_returns.is_empty()
        {
            self.oblige(
                value,
                kind,
                crate::hir::obligations::Into::Return,
                expression,
            );
        }
        if let (Some(value), Some(expression), None) = (value, obliged, literal) {
            self.oblige_tuple_return(value, expression)?;
        }
        if let Some(target) = self.callback_returns.last().copied() {
            // Only the `try`s inside the callback. A `return` here means
            // "this element is done", so it leaves the `try`s written in
            // the callback body and *not* one the call itself is inside
            // -- the enclosing `try` is not being left at all.
            let floor = self.breakables[target.depth].continues_at;
            self.unwind_to(floor, None)?;
            if self.is_terminated() {
                return Ok(());
            }
            return self.return_from_callback(id, target, value);
        }
        if let Some(result) = self.async_result.clone() {
            // The whole function is being left, so every one of them.
            self.unwind_to(0, None)?;
            if self.is_terminated() {
                return Ok(());
            }
            return self.settle_and_return(id, &result, value);
        }
        // At the type the *signature* declares, and only on this path:
        // a callback return and an `async` settle both hand the value
        // somewhere else, at a type of their own. `function f():
        // unknown { return n }` returns an erased value, and returning
        // the raw double instead lowered with nothing refused and then
        // failed in C -- the verifier checks call arguments and not
        // returns, so this had nothing watching it.
        let value = match (value, expression) {
            // `return f();` where the function returns nothing. Legal
            // JavaScript -- the result is `undefined` either way -- and
            // the expression has already been lowered, so its effects
            // happen and its value is dropped.
            //
            // Keeping it produced `Return(Some(v))` on a function whose
            // C signature says `void`, and `v` was a call typed void,
            // which the emitter declares no variable for. `return v4;`
            // with no `v4`: uncompilable C from a function the lowering
            // called complete.
            (Some(_), _) if matches!(self.returns, HirType::Void) => None,
            (Some(value), Some(expression)) => {
                let want = self.returns.clone();
                Some(self.coerce(value, &want, expression)?)
            }
            // **A bare `return;` still produces a value**, wherever the
            // signature says the function returns one.
            //
            // `function maybe(): number | undefined { return; }` is
            // ordinary TypeScript -- a bare `return` is legal exactly
            // where the declared type admits `undefined` -- and it
            // terminated with `Return(None)` against a signature
            // returning `Erased`. `verify` refuses that (`ReturnType {
            // expected: Erased, found: None }`) and `emit-c` then writes
            // nothing for the **whole program**, so one such function
            // costs every other one beside it. The full test262 census
            // found one file in 29,586 doing it; the same shape reaches
            // `unknown`, `any` and a nullable class.
            //
            // **Both `Void` and `Never` are excluded here, and the arm
            // above is not what does it.** That arm drops a value a
            // `void` function's `return f();` produced, which needs an
            // expression to have produced one; `return;` has none, so it
            // falls straight through to this arm and a first version of
            // it gave a `void` function an operand -- `ReturnType {
            // expected: Void, found: Some(Void) }` on a bare `return`
            // inside an `if`. The comment here said the arm above
            // excluded it, which was a claim about a mechanism rather
            // than a reading of it. The fixture's `void` control is what
            // caught it.
            //
            // `Never` for the neighbouring reason: a function returning
            // `never` has no reachable `return` to give a value to, and
            // inventing one would put an operand on a terminator two
            // backends spell as `V`.
            //
            // **And a generator is excluded, which only the corpus could
            // say.** In a generator body `self.returns` is the *frame*
            // type, so this arm produced `ConstUndefined` at a frame
            // pointer -- a bare `return;` in a generator is not "return
            // undefined", it is the end of the walk, which is why the
            // fall-off arm terminates `Return(None)` there and lets
            // `hir::suspend` turn it into the *done* a resumption
            // answers. The only thing that made it harmless was `suspend`
            // discarding the operand afterwards.
            //
            // Found by comparing emitted C over both corpora, where the
            // counts were byte-for-byte identical and fifteen modules'
            // programs differed anyway: one function, `Headers#entrySteps`
            // in web-platform, gaining a value and renumbering every one
            // after it. No fixture of mine had a generator in it, and no
            // refusal, definition or occurrence count moved.
            //
            // The *value* is [`Self::absent_at`]'s to choose, not this
            // arm's, so a `return;` and a written `undefined` cannot
            // come to disagree about what an absence is at a nullable
            // pointer.
            // A constructor whose base made the instance answers it, so a
            // bare `return;` there is `return this`.
            (None, None) if self.made_by.is_some() => Some(self.this.ok_or_else(|| {
                self.unsupported(id, "a `return` before `super(...)` made the instance")
            })?),
            (None, None)
                if self.generator.is_none()
                    && !matches!(self.returns, HirType::Void | HirType::Never) =>
            {
                let want = self.returns.clone();
                Some(self.absent_at(OpKind::ConstUndefined, Some(want), id)?)
            }
            (value, _) => value,
        };
        // A `return` leaves every `try` it is inside, so every pending
        // `finally` runs before it -- after the returned expression has
        // been evaluated, which is the order the language specifies.
        self.unwind_to(0, None)?;
        if self.is_terminated() {
            // A `finally` returned or threw, which replaces this
            // return outright.
            return Ok(());
        }
        if let (Some(out), Some(value)) = (self.record_out, value) {
            let origin = self.origin(id);
            self.push(
                OpKind::NativeCopy {
                    destination: out,
                    source: value,
                },
                HirType::Void,
                origin,
            );
            self.terminate(Terminator::Return(None));
            return Ok(());
        }
        self.terminate(Terminator::Return(value));
        Ok(())
    }

    /// Terminate whatever block a body ended in.
    ///
    /// Falling off the end of a `void` function returns nothing, which is what
    /// it means.
    ///
    /// **The sentence that stood here said falling off the end of a function
    /// that returns a value "cannot happen: TypeScript rejects a function that
    /// might". That is not true of the language.** TypeScript rejects it only
    /// where the return type is *declared* and excludes `undefined`; where the
    /// type is inferred, falling off the end is what *puts* `undefined` in it.
    /// `function pick(c: boolean) { if (c) return 42; }` is ordinary TypeScript
    /// returning `number | undefined`, and it arrives here with nothing produced
    /// for the path that falls off. `tests/programs/
    /// a-function-that-can-fall-off-its-end` guards it, first found by the full
    /// test262 census in four `for-in/return` files.
    ///
    /// `FellThrough` stays, because **two different arrivals reach this and only
    /// one of them is that case.** `while (true) { ... return x; }` is the
    /// ordinary other one: the loop's exit is a real edge, the condition is
    /// constant but the branch is not folded when this runs, and nothing follows
    /// it -- so the point genuinely is dead and `FellThrough` is the assertion
    /// that says so, held by the verifier rather than asserted by
    /// `Unreachable`. And the unconditional `Return(None)` this once had "built
    /// closures that promised an array and returned none", which is the comment
    /// at the third call site.
    ///
    /// **What tells the two apart is the checker's type and not the
    /// representation**: a nullable class and a non-nullable one are one
    /// `HirType`, so "does an absence fit this representation" answers yes for
    /// a closure that owes a real array. The discriminator is whether the
    /// declared or inferred return type *includes* `undefined`, asked of
    /// `declaration`'s own signature. Where it does, falling off the end is
    /// `return undefined;` -- the same [`Self::absent_at`] a written `return;`
    /// at such a type takes -- and where it does not, or no signature is known,
    /// the end is `FellThrough` for the verifier to hold dead.
    /// `function f() { for (const k in o) return 42; }` is the first kind:
    /// TypeScript infers `number | undefined` for it, and an object with no keys
    /// returns `undefined` (test262's `for-in/return*` and `for-inof-finally`,
    /// found by the JVM lane's invalid-HIR census).
    pub(super) fn close_body(
        &mut self,
        declaration: NodeId,
        return_type: &HirType,
    ) -> Result<(), Diagnostic> {
        if matches!(return_type, HirType::Void) {
            self.terminate(Terminator::Return(None));
        } else if !self.is_terminated() && self.falls_off_to_undefined(declaration) {
            let undefined = self.absent_at(
                OpKind::ConstUndefined,
                Some(return_type.clone()),
                declaration,
            )?;
            self.terminate(Terminator::Return(Some(undefined)));
        } else {
            // Not `Unreachable`: this is an absence rather than a claim, and
            // the verifier holds it to being dead.
            self.terminate(Terminator::FellThrough);
        }
        Ok(())
    }

    /// Whether `declaration`'s signature, as the checker declared or inferred
    /// it, returns a type that *names* `undefined` -- a union with `undefined`
    /// or `void` in it, or `any` or `unknown` -- which is what an inferred type
    /// says when its body's end is reachable. `false` where there is no
    /// signature to ask, the side that keeps `FellThrough`.
    ///
    /// Not [`Self::admits_undefined`], which also answers yes for a type
    /// parameter: `function f<T>(g: () => T): T { while (true) { … return r; } }`
    /// has a dead end, and its `T` may be a `number` that no `undefined` fits,
    /// so asking that would refuse a function that compiles.
    fn falls_off_to_undefined(&self, declaration: NodeId) -> bool {
        let kind = |ty: TypeId| {
            self.snapshot
                .types
                .get(ty.0 as usize)
                .map(|record| &record.kind)
        };
        let Some(returned) = self
            .snapshot
            .node_types
            .get(&declaration)
            .and_then(|&ty| match kind(ty) {
                Some(TypeKind::Function(signature)) => {
                    self.snapshot.signatures.get(signature.0 as usize)
                }
                _ => None,
            })
            .map(|signature| signature.return_type)
        else {
            return false;
        };
        let parts = match kind(returned) {
            Some(TypeKind::Union(parts)) => parts.as_slice(),
            Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => {
                std::slice::from_ref(&returned)
            }
            _ => std::slice::from_ref(&returned),
        };
        parts.iter().any(|&part| {
            matches!(
                kind(part),
                Some(TypeKind::Undefined | TypeKind::Void | TypeKind::Any | TypeKind::Unknown)
            )
        })
    }

    /// `return` inside an inlined callback: end this iteration, not the
    /// function.
    ///
    /// The same jump `continue` makes, plus the binding of the value where the
    /// method reads one. Binding before taking the carried arguments is what
    /// makes the value arrive: the result name is one of the loop's carried
    /// symbols, so `carried_now` picks up what was just written.
    fn return_from_callback(
        &mut self,
        id: NodeId,
        target: CallbackReturn,
        value: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        self.deliver(id, &target.result, target.depth, value)?;
        let it = self.breakables[target.depth].clone();
        let args = self.carried_now(&it.carried);
        let latch = it
            .latch
            .expect("an inlined callback body is always inside a loop");
        self.terminate(Terminator::Jump {
            target: latch,
            args,
        });
        Ok(())
    }

    /// What a method declared on a type returns, as a representation.
    pub(super) fn member_returns(&self, ty: TypeId, member: &PropertyKey) -> Option<HirType> {
        self.represent(self.member_return_type(ty, member)?)
    }

    /// What a method declared on a type returns, as the checker's type.
    pub(super) fn member_return_type(&self, ty: TypeId, member: &PropertyKey) -> Option<TypeId> {
        let record = self.snapshot.types.get(ty.0 as usize)?;
        let TypeKind::Object { properties } = &record.kind else {
            return None;
        };
        let property = properties
            .iter()
            .find(|property| &property.name == member)?;
        let function = self.snapshot.types.get(property.ty.0 as usize)?;
        let TypeKind::Function(signature) = function.kind else {
            return None;
        };
        let signature = self.snapshot.signatures.get(signature.0 as usize)?;
        Some(signature.return_type)
    }

    /// The checker's `void`, which a setter's signature returns. Any program
    /// that binds a setter has one, since the binding module declares it.
    pub(super) fn void_type(&self) -> Result<TypeId, Diagnostic> {
        self.snapshot
            .types
            .iter()
            .position(|record| matches!(record.kind, TypeKind::Void))
            .and_then(|at| u32::try_from(at).ok())
            .map(TypeId)
            .ok_or_else(|| {
                Diagnostic::error(
                    "NTS1001",
                    "a property setter in a program the checker gave no `void`",
                    self.origin(NodeId(0)).location,
                )
            })
    }
}

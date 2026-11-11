//! Read or update array elements and lower array methods, choosing counted-element helpers where ownership requires them.

use super::{
    Absent, ArrayFill, BinOp, Branch, Callee, Diagnostic, FuncBuilder, HirType, ManagedType,
    MethodsOf, NodeId, NumericBuiltin, OpKind, Origin, Step, Terminator, TypeKind, UnOp, ValueId,
    access, claimed_reads, describe, iteration_method, numeric_array_method, property_keys, syntax,
};

/// An Objective-C property: its declaration, and the selectors that read and
/// write it. `setter` is `None` for a `readonly` one.
/// Whether an array's elements are counted -- a managed reference, or a
/// counted foreign object (`NTS_ARRAY_FOREIGN`) -- so that the runtime helpers
/// which move elements (`push`, `pop`, `shift`, `splice`, `reverse`) are the
/// `_ref` ones, a move changing no count.
pub(super) fn holds_counted(element: &HirType) -> bool {
    matches!(element, HirType::Managed(_)) || element.counting().is_some()
}

/// A runtime helper that duplicates or drops an array's counted elements.
#[derive(Clone, Copy)]
pub(super) enum Counts {
    At,
    Slice,
    Concat,
    Extend,
    Fill,
    SetLength,
}

/// The helper that performs `op` on an array of counted elements: the `_ref`
/// one for managed references, the `_foreign` one -- counting through the
/// family's `NtsFamilyOps` -- for foreign objects. One answer for every site
/// that duplicates or drops an element, so the two families cannot be told
/// apart differently in two places.
pub(super) fn counted_helper(element: &HirType, op: Counts) -> &'static str {
    let foreign = !matches!(element, HirType::Managed(_)) && element.counting().is_some();
    match (op, foreign) {
        (Counts::At, false) => "nts_array_at_ref",
        (Counts::At, true) => "nts_array_at_foreign",
        (Counts::Slice, false) => "nts_array_slice_ref",
        (Counts::Slice, true) => "nts_array_slice_foreign",
        (Counts::Concat, false) => "nts_array_concat_ref",
        (Counts::Concat, true) => "nts_array_concat_foreign",
        (Counts::Extend, false) => "nts_array_extend_ref",
        (Counts::Extend, true) => "nts_array_extend_foreign",
        (Counts::Fill, false) => "nts_array_fill_ref",
        (Counts::Fill, true) => "nts_array_fill_foreign",
        (Counts::SetLength, false) => "nts_array_set_length_ref",
        (Counts::SetLength, true) => "nts_array_set_length_foreign",
    }
}

/// One argument of a `push` or an `unshift`, evaluated before any insert.
pub(super) enum Pending {
    Value(ValueId),
    Spread(Spread),
}

/// A `...ys` argument as it was evaluated: the array and the length it had.
pub(super) struct Spread {
    node: NodeId,
    source: ValueId,
    slot: HirType,
    count: ValueId,
}

impl FuncBuilder<'_> {
    /// Whether this expression is a name already bound to an array value.
    ///
    /// Only a plain identifier, and only when the binding is in hand: this is
    /// asked *before* the receiver is lowered, so it answers for the case where
    /// the representation is already decided and says nothing otherwise.
    pub(super) fn holds_an_array(&self, object: NodeId) -> bool {
        self.kind_of(object) == Some(syntax::IDENTIFIER)
            && self
                .node(object)
                .symbol
                .and_then(|symbol| self.bindings.get(&symbol.0))
                .is_some_and(|value| {
                    matches!(
                        self.values[value.0 as usize].ty,
                        HirType::Managed(ManagedType::Array(_))
                    )
                })
    }

    /// `xs.length = n`: the runtime's helper for the array's elements, which
    /// knows whether a counted element dropped off the end is released.
    pub(super) fn set_array_length(
        &mut self,
        id: NodeId,
        array: ValueId,
        value: ValueId,
        origin: Origin,
    ) -> Result<(), Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[array.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(id, "an array length on something else"));
        };
        // A length that may grow makes holes, and a hole in an array of
        // `T | null` would read as `null` (`Self::null_only_element`). Emptying
        // it makes none.
        let emptied = matches!(
            self.values[value.0 as usize].kind,
            OpKind::ConstFloat(zero) if zero == 0.0
        ) || matches!(self.values[value.0 as usize].kind, OpKind::ConstInt(0));
        // `id` is the assignment or the `xs.length` it writes; the array is the
        // access's object either way.
        let access = if self.kind_of(id) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            Some(id)
        } else {
            self.children(id).first().copied()
        };
        if !emptied
            && access
                .and_then(|access| self.children(access).first().copied())
                .and_then(|object| self.read_type(object))
                .is_some_and(|ty| self.null_only_element(ty))
        {
            return Err(self.unsupported(
                id,
                "a length written to an array of `T | null`, which may leave holes that read \
                 as `undefined` where a null slot of it reads as `null`",
            ));
        }
        let helper = match *element {
            ref counted if holds_counted(counted) => counted_helper(counted, Counts::SetLength),
            HirType::Erased => "nts_array_set_length_value",
            _ => "nts_array_set_length",
        };
        self.runtime_call(helper, vec![array, value], HirType::Void, origin);
        Ok(())
    }

    /// `xs[i]`, as a read. Writes are handled by the assignment lowering.
    pub(super) fn lower_element_access(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        self.check_native_brand_read(id)?;
        // `xs?.[i]`, which is three children because the `?.` is a token of its
        // own between the receiver and the index -- the same shape `a?.b` has,
        // and it reaches here before the two-child forms below can fail on it.
        if let [object, dot, index] = self.children(id).as_slice()
            && self.kind_of(*dot) == Some(syntax::QUESTION_DOT_TOKEN)
        {
            return self.lower_optional_element(id, *object, *index);
        }
        // **An index link is a link, and this has to be asked before anything
        // decides what kind of index it is.** `a?.p[i]` reads the element after
        // the arms have merged, so the read happens on the absent path too --
        // on C that aborts, and on the JVM an element of `undefined` is
        // `undefined`, which a trailing `??` folds to the same answer the
        // short-circuit would have given. Agreement by coincidence of the
        // surrounding operator, on one backend.
        //
        // **It sat below `lower_string_index` and that left one shape out.** A
        // *string* index -- `a?.label[1]` -- was intercepted there and never
        // reached the question, so it was neither refused nor right: the
        // compiled program **segfaults**, signal 11, on 9 of 29 cases, on every
        // backend. Not a decline, not a wrong number, a crash, and it long
        // predates the guard -- the guard simply never covered it, because the
        // dispatch above it had already chosen a kind of index.
        //
        // So the chain question goes first. What kind of index it is only
        // matters once it is established that the index runs at all.
        if let Some(object) = self.children(id).first()
            && self.pending_chain(*object)
        {
            return self.lower_chain(id);
        }
        // A member named by a **string** is a forward lookup, and the checker has
        // already folded it -- so it is asked before the reverse mapping, whose
        // index is a value rather than a name.
        if let Some(folded) = self.folded_enum_member(id) {
            return Ok(folded);
        }
        if let Some(name) = self.enum_reverse_member(id)? {
            return Ok(name);
        }
        if self.names_a_property(id) {
            return self.lower_property_access(id);
        }
        if let Some(read) = self.lower_string_index(id)? {
            return Ok(read);
        }
        let (array, index, guard) = self.element_access_parts(id)?;
        if let Some(guard) = guard {
            let key = access::index_key(self, id, index);
            access::require(self, id, &guard, &key, false)?;
        }
        self.element_of(id, array, index)
    }

    /// Split out so that `xs?.[i]` can share it: the optional form lowers its
    /// receiver first, to ask whether it is absent, and then wants exactly this
    /// read in the arm where it is not.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn element_of(
        &mut self,
        id: NodeId,
        array: ValueId,
        index: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        if matches!(self.values[array.0 as usize].ty, HirType::NativePointer(_)) {
            return self.native_load(id, array, index);
        }
        // The element's representation comes from the *array*, not from the
        // access node's type. Under `noUncheckedIndexedAccess` — which is what
        // TypeScript actually knows — that type is `number | undefined`, and
        // there is no `undefined` to put in a double. What is stored in the
        // slot is a number; the `!` the author wrote is the claim that one is
        // there, and the bounds test is what checks it.
        // A view indexes exactly as an array does: same operation, different
        // storage, which is what lets the bounds check, its elimination and the
        // verifier go on working unchanged. The backends decide the addressing
        // from the receiver's type.
        // `table[key]` on a string-keyed table, which is a lookup rather than
        // an addressed slot. `V | undefined` is what the language says it
        // answers and what `nts_map_get` returns, so the erased result is the
        // honest one and `narrowed` puts it back where the checker has already
        // taken the `undefined` away.
        if matches!(
            self.values[array.0 as usize].ty,
            HirType::Managed(ManagedType::Table(_, _))
        ) {
            let source = *self
                .children(id)
                .last()
                .expect("element access has an index");
            let key = property_keys::capture(self, source, index)?;
            let read = property_keys::apply(self, id, array, key, property_keys::Action::Get);
            return claimed_reads::narrowed(self, id, read);
        }

        // An array the checker proved and the representation did not. There is
        // no element type to read a width from, so the width comes from the
        // descriptor at run time and the answer is erased -- which is also the
        // only type that can carry the `undefined` an out-of-range read gives,
        // and the reason this form does not need the bounds trap the static one
        // takes.
        if self.erased_but_proven_an_array(id, array) {
            let origin = self.origin(id);
            let null_slot = self.null_slot(self.children(id).first().copied(), &origin);
            return Ok(self.runtime_call(
                "nts_array_element",
                vec![array, index, null_slot],
                HirType::Erased,
                origin,
            ));
        }
        // **An out-of-range read the program is handling is `undefined`, not an
        // abort.**
        //
        // The trapping read below is right for the common case and its comment
        // says why: a `double` slot has nowhere to put an `undefined`, so the
        // representation comes from the array and the bounds test is what makes
        // that honest. What it cannot be is the answer when the *program* has
        // said it expects an absence.
        //
        // `type_of(id)` is exactly that question. Under
        // `noUncheckedIndexedAccess` the checker types every element access
        // `T | undefined` and then narrows it away at each `!`, each `?? d` and
        // each preceding length test -- so a still-erased access type is the
        // checker reporting that this program does not know the index is in
        // range, which is the one case where the language's `undefined` is
        // observable rather than a technicality.
        //
        //     const hexLow = unhexTable[nextChar] ?? -1;
        //     if (!(hexLow >= 0)) { ... }
        //
        // `querystring`'s table is 256 entries and `nextChar` is a
        // `charCodeAt`. `unescapeBuffer("%0<CJK>")` **aborted the process**
        // where node answers a replacement character, and the source was
        // already correct: the `??` is not the author being defensive, it is
        // the author doing what the type demands.
        //
        // `nts_array_element` is the read that answers `undefined` out of
        // range, and it already exists for the case a guard proved an array
        // without proving what it holds. Both other backends emit it, so this
        // is a routing decision rather than an ABI change.
        //
        // **Arrays only.** A view is an `NtsView` and `nts_array_element`
        // asserts `nts_is_array`, so routing one there would trade an abort for
        // a different abort. `blockers/an-out-of-range-read-that-still-traps`
        // carries that half; it is a smaller cone -- a typed array's length is nearly always
        // the thing the loop is bounded by -- and it wants a view-shaped helper
        // rather than a cast.
        // **`xs[i]!` keeps the trapping read**, which is what the comment above
        // means by "the claim that one is there". Under
        // `noUncheckedIndexedAccess` the checker types *every* element access
        // `T | undefined` and narrows at the parent, so `type_of(id)` alone
        // routes `xs[i]!` here too -- and that is every counted loop in the
        // corpus paying a call and a tag test for an index the author has
        // already sworn to.
        //
        // An abort on a violated `!` is the documented bargain and it stays.
        // What changes is only the access that made no such claim.
        let asserted = self
            .node(id)
            .parent
            .is_some_and(|parent| self.kind_of(parent) == Some(syntax::NON_NULL_EXPRESSION));
        // **And only where the slot itself cannot hold the absence.**
        //
        // That is the whole of the reason the trap exists -- "there is no
        // `undefined` to put in a double" -- so where the element type is
        // already erased the slot *can* hold one, and paying a call to learn
        // that is a cost with nothing bought. `unknown[]` is the case:
        // `benchmarks/cases/erasure-stored-unknown` reads `values[i]` 200,000
        // times in its inner loop, and routing it here turned a load into a
        // call in the hottest loop of a benchmark. Caught by emitting the bench
        // program and grepping for the call, before any timing.
        //
        // So the read stays an `ArrayGet`, and an out-of-range one is answered
        // after bounds elimination: `bounds::answer_erased_reads` gives what is
        // still checked `undefined` rather than a trap, and a read proven in
        // range keeps its load.
        let slot_holds_the_absence = matches!(
            self.values[array.0 as usize].ty,
            HirType::Managed(ManagedType::Array(ref element)) if **element == HirType::Erased
        );
        // **And an `any` read of a typed array is one too**, which is what a
        // copy re-typed from `any` reads: `xs[i]` is still `any` to the
        // checker, and `any` admits `undefined` -- JavaScript's answer past
        // the end, which the copy must give as its erased original would. So
        // it reads through `nts_array_element` like the rest. A copy takes an
        // array only where every such read feeds a number
        // (`ClosedParameters::admits`), and there `ToNumber` makes the absent
        // read NaN, as `undefined` is to every one of those consumers.
        let checked_any = self
            .snapshot
            .node_types
            .get(&id)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .is_some_and(|record| matches!(record.kind, TypeKind::Any));
        if !asserted
            && !slot_holds_the_absence
            && matches!(
                self.values[array.0 as usize].ty,
                HirType::Managed(ManagedType::Array(_))
            )
            && self.type_of(id) == Some(HirType::Erased)
        {
            let origin = self.origin(id);
            let numbers = matches!(
                self.values[array.0 as usize].ty,
                HirType::Managed(ManagedType::Array(ref element)) if **element == HirType::NUMBER
            );
            let erased = self.push(
                OpKind::Erase {
                    value: array,
                    absent: Absent::Impossible,
                    slots: Absent::Impossible,
                },
                HirType::Erased,
                origin.clone(),
            );
            let null_slot = self.null_slot(self.children(id).first().copied(), &origin);
            let read = self.runtime_call(
                "nts_array_element",
                vec![erased, index, null_slot],
                HirType::Erased,
                origin.clone(),
            );
            if checked_any && numbers {
                return Ok(self.runtime_call(
                    "nts_value_to_number",
                    vec![read],
                    HirType::NUMBER,
                    origin,
                ));
            }
            return Ok(read);
        }
        let ty = match self.values[array.0 as usize].ty.clone() {
            HirType::Managed(ManagedType::Array(element) | ManagedType::View(element)) => *element,
            HirType::Managed(ManagedType::Template) => HirType::Managed(ManagedType::String),
            _ => return Err(self.not_an_array(id)),
        };
        let origin = self.origin(id);
        let read = self.push(
            OpKind::ArrayGet {
                array,
                index,
                checked: true,
            },
            ty.clone(),
            origin.clone(),
        );
        // A typed array's element is narrower than the `number` every
        // expression around it is typed in -- TypeScript says `Uint8Array[i]`
        // is a `number`, and it is. Converting here keeps the HIR well typed
        // without asking the checker, which under `noUncheckedIndexedAccess`
        // would answer `number | undefined` and have no representation to give.
        //
        // It is not a cost so much as a statement of where the value is:
        // `hir::specialize` puts the arithmetic back into the narrow type where
        // that is what the program does, and `hir::simplify` drops a conversion
        // that turned out to be the identity.
        if matches!(ty, HirType::Int { .. } | HirType::Float { bits: 32 }) {
            return Ok(self.push(OpKind::Convert(read), HirType::NUMBER, origin));
        }
        // A heterogeneous tuple is an `NtsArray` of references, so its slots
        // agree on width and disagree on type: reading position 1 of
        // `[string[], number[]]` gives the *array's* element type, which is
        // position 0's. The access node's type is the declared one and this
        // restores it.
        //
        // Guarded on both being managed and on the access having a
        // representation at all, because the comment above says what the
        // access type is for an ordinary array under
        // `noUncheckedIndexedAccess`: `T | undefined`, which represents to
        // nothing. Where it does represent, a homogeneous array's access type
        // equals its element type and this is the identity, which
        // `hir::simplify` drops.
        // **An erased slot is read back through its tag, not cast.** The
        // paragraph above is right about a tuple whose slots are references --
        // they agree on width, so restoring the declared type is a cast. A
        // tuple-union rest parameter whose positions disagree is an array of
        // *erased* values instead, and its slots are `NtsValue`, so the same
        // `Convert` emitted `v17 = (NtsString *)v16;` against a struct:
        // ``operand of type 'NtsValue' where arithmetic or pointer type is
        // required``. One branch, two storage shapes, and only one of them is a
        // cast.
        //
        // Asked before the `Convert` and of the *position* rather than of the
        // access node, because under `noUncheckedIndexedAccess` the access type
        // is `T | undefined` and represents to nothing -- which is exactly the
        // guard the branch below carries, and why a scalar position fell
        // through it entirely.
        if ty == HirType::Erased
            && let Some(want) = self.tuple_position_representation(id)
            && want != HirType::Erased
        {
            return Ok(self.push(OpKind::unerase(read), want, origin));
        }
        if self.reads_a_tuple(id)
            && let Some(declared @ HirType::Managed(_)) = self.type_of(id)
            && declared != ty
        {
            return Ok(self.push(OpKind::Convert(read), declared, origin));
        }
        Ok(read)
    }

    /// The array and index of an `xs[i]`, lowered in source order.
    pub(super) fn element_access_parts(
        &mut self,
        id: NodeId,
    ) -> Result<(ValueId, ValueId, Option<access::Guard>), Diagnostic> {
        let children = self.children(id);
        let [array, index] = children.as_slice() else {
            return Err(self.unsupported(id, "an element access of unexpected shape"));
        };
        let (array_value, guard) = access::receiver(self, *array)?;
        if !matches!(
            self.values[array_value.0 as usize].ty,
            HirType::Managed(
                ManagedType::Array(_)
                    | ManagedType::Template
                    | ManagedType::View(_)
                    | ManagedType::Table(_, _)
            ) | HirType::NativePointer(_)
        ) && !self.erased_but_proven_an_array(id, array_value)
        {
            return Err(self.not_an_array(id));
        }
        let index_value = if property_keys::string_record(self, array_value) {
            // Null and undefined are key values, not absent string pointers.
            self.lower_expecting(*index, &HirType::Erased)?
        } else {
            self.lower_expression(*index)?
        };
        Ok((array_value, index_value, guard))
    }

    /// A receiver with no array *representation* that the checker nevertheless
    /// says is an array.
    ///
    /// `Array.isArray(xs)` is what produces one. The guard narrows `xs` to
    /// `any[]`, which is a fact about the value and not a representation for
    /// it: the value is still the sixteen erased bytes it arrived as, so every
    /// site that switches on a lowered type sees `Erased` and refuses. Thirty
    /// of those refusals read `indexing an array of any, which is not an
    /// array`, which is the two halves disagreeing in one sentence.
    ///
    /// Both halves are required, and the lowered half is the one that carries
    /// the weight. The checker's answer alone would also be `true` for a
    /// receiver that *does* have a representation, and this is a fallback for
    /// the one that does not.
    pub(super) fn erased_but_proven_an_array(&self, id: NodeId, receiver: ValueId) -> bool {
        matches!(self.values[receiver.0 as usize].ty, HirType::Erased)
            && self.receiver_is_an_array(id)
    }

    /// `xs[i]` where `xs` is not an array, named by what it is.
    ///
    /// From the checker rather than from the lowered value: a receiver with no
    /// representation has no lowered type to report, and those are most of
    /// these. Thirty-two instances read `indexing something that is not an
    /// array`, which says nothing about which thirty-two.
    pub(super) fn not_an_array(&self, id: NodeId) -> Diagnostic {
        let described = self
            .children(id)
            .first()
            .and_then(|object| self.snapshot.node_types.get(object))
            .map_or_else(
                || "an untyped receiver".to_owned(),
                |ty| describe(self.snapshot, *ty),
            );
        self.unsupported(id, &format!("indexing {described}, which is not an array"))
    }

    /// Why a member other than `length` is not readable here, in the words that
    /// send a reader to the right place.
    ///
    /// Three sentences and they are not interchangeable: an array has only a
    /// length, a union lays its fields out differently in each member, and
    /// anything else simply has none.
    pub(super) fn not_a_length(
        &mut self,
        id: NodeId,
        value: ValueId,
        member_name: &str,
        sequence: bool,
    ) -> Diagnostic {
        // `buffer`, `byteLength` and `byteOffset` land here: a typed array
        // is an array of a known width and not a view onto storage
        // something else can also see, so it has a length and nothing else.
        // Computed before the call rather than inside it: `why_not_shared` lays
        // out the arms it is asked about, so it needs `&mut self` where
        // `unsupported` is holding `&self`.
        let erased = self.values[value.0 as usize].ty == HirType::Erased;
        let asked = if sequence || !erased {
            None
        } else {
            self.why_not_shared(id, member_name)
        };
        let message = if sequence {
            format!("`{member_name}`, where an array has only `length`")
        } else if let Some(why) = asked {
            why
        } else if erased {
            // Erased, and `why_not_shared` could not say why -- it declined
            // rather than answered, which means the receiver's node carried no
            // union type to ask about. The old sentence, kept for exactly the
            // case it was ever true of.
            format!("`{member_name}` on a union, whose members lay their fields out differently")
        } else {
            format!("`{member_name}`, a property of a value with no fields")
        };
        self.unsupported(id, &message)
    }

    /// Whether this `.length` reads an erased value the checker has proved is
    /// an array.
    ///
    /// `Array.isArray` narrows an `unknown` to `any[]`, and `any` deliberately
    /// has no representation -- `docs/records/notebooks/any-unknown.md` forbids one, because it is
    /// the checker announcing it has stopped providing safety. So the narrowing
    /// lowered and **the `.length` it was performed in order to reach did not**,
    /// which is the wrong half to lose: the test is the thing that made the fact
    /// true.
    ///
    /// A length needs no element type. It is in the header every reference
    /// carries, so reading it through the tag is sound for exactly the value the
    /// guard proved -- and this gives a representation to the *result of a
    /// runtime array test*, not to `any`.
    ///
    /// Elements stay refused. Their **width** is unknown, so reading one would
    /// be a guess about storage rather than about type -- the line `AnyView`
    /// draws for views, drawn here for the same reason. `internal/errors.ts:520`
    /// indexes the same narrowed value two lines after the `.length` this
    /// clears, so the chain stops there rather than here.
    pub(super) fn proven_array_length(&self, id: NodeId, value: ValueId) -> bool {
        self.values[value.0 as usize].ty == HirType::Erased && self.receiver_is_an_array(id)
    }

    /// Whether the receiver of this member access is an array by the checker's
    /// reckoning, whatever its representation.
    ///
    /// The receiver rather than the access, for `reads_a_tuple`'s reason one
    /// file over: the access's own type is what `noUncheckedIndexedAccess` and
    /// narrowing leave behind, and the question here is what the value *is*.
    fn receiver_is_an_array(&self, id: NodeId) -> bool {
        let Some(receiver) = self.children(id).first().copied() else {
            return false;
        };
        let Some(ty) = self.snapshot.node_types.get(&receiver) else {
            return false;
        };
        matches!(
            self.snapshot
                .types
                .get(ty.0 as usize)
                .map(|record| &record.kind),
            Some(TypeKind::Array(_))
        )
    }

    /// The separator a `join` was given, or the comma it defaults to.
    ///
    /// `[1,2].join()` is `"1,2"` and not `"1Infinity2"`, which is what the
    /// numeric table's arity filling would supply -- so `join` is handled
    /// outside that table on all three receivers, and this is the one place
    /// that knows what the default is.
    ///
    /// **And a separator that may be `undefined` is the comma too**, decided
    /// here where its type is known: `[1,2].join(undefined)` and a
    /// `join(sep?: string)` called without one are `"1,2"`. Handed to the
    /// runtime as it was, it was a null string, which C dereferenced -- and
    /// the runtime cannot be the one to decide, because `null` joins as
    /// `"null"` and a null pointer is both. TypeScript's `separator?: string`
    /// admits `undefined` and never `null`, so a separator whose type admits
    /// `null` came past the checker and is refused rather than guessed at.
    pub(super) fn join_separator(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let text = HirType::Managed(ManagedType::String);
        let Some(argument) = arguments.first().copied() else {
            return Ok(self.push(OpKind::ConstString(",".into()), text, origin));
        };
        let separator = self.lower_expression(argument)?;
        // The type and not the representation: every string is a pointer that
        // may be null, and asking the value would test `","` too.
        match self.absences_of(argument) {
            Some(absences) if absences.is_empty() => return Ok(separator),
            Some(absences) if !absences.contains(&crate::hir::tags::NULL) => {}
            _ => {
                return Err(self.unsupported(
                    argument,
                    "a `join` separator that may be null, which joins as \"null\" where an absent one is a comma",
                ));
            }
        }
        let Some(absent) = self.absence_of(argument, separator) else {
            return Ok(separator);
        };
        let comma = self.push(OpKind::ConstString(",".into()), text.clone(), origin);
        self.lower_branching_value_at(
            id,
            text,
            absent,
            Branch::Value(comma),
            Branch::Present(separator),
        )
    }

    /// A method on an array.
    ///
    /// The same shape as a string's: a runtime call, because an array has no
    /// layout to resolve a member against. The set is what can be done *without
    /// growing* the array and without a callback -- `push`, `splice` and the
    /// rest change the length, which the current representation cannot do
    /// because the elements are inline and growing would move the object;
    /// `map`, `filter` and `forEach` take a function, which needs closures.
    /// Both are real extensions rather than oversights.
    ///
    /// Elements must be numbers. A reference array's `indexOf` compares by
    /// identity and its `slice` has to retain what it copies, and neither is
    /// something to guess at.
    pub(super) fn lower_array_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        element: &HirType,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        // [`Self::literal_name`] rather than the node's text, because the
        // decoder carries none on a literal: `o["twice"]()` names its method
        // with a `STRING_LITERAL`, and reading `.text` there answered `None`
        // for a name the program spells in full. Three call paths -- a string's
        // methods, an array's and an object's -- each read it the same wrong
        // way, so a bracketed method call was refused as "a computed method
        // name" on every receiver there is.
        let name = self
            .called_member_name(member)
            .ok_or_else(|| self.unsupported(member, "a computed method name"))?;

        // **`toString` on an array *is* `join()`**, and the specification says
        // so in as many words: `Array.prototype.toString` calls the array's
        // `join` when it is callable, which for an ordinary array it is. The
        // separator is the comma `join` already defaults to, so this is a
        // rename rather than a second implementation -- and the numeric and
        // reference paths below each get it, which is why the rename is here
        // and not in either of them.
        //
        // `[1, 2].toString()` is `"1,2"`, `[].toString()` is `""`, and a hole
        // or a `null` contributes nothing between its commas. All three are
        // whatever `join` answers, which is the point: one implementation
        // cannot disagree with itself.
        //
        // Only with no arguments. `Array.prototype.toString` takes none, and a
        // call that passes one is something else -- most likely a method on a
        // subclass -- which keeps its own refusal rather than being silently
        // reinterpreted.
        let name = if name == "toString" && arguments.is_empty() {
            "join".to_owned()
        } else {
            name
        };

        // The runtime's array helpers read the block at one width:
        // `nts_array_index_of` takes a `const double *`. A narrower element
        // means a typed array, and handing one to a helper compiled for doubles
        // makes it read pairs of elements as a single value -- which is not a
        // wrong answer so much as unrelated memory.
        //
        // `hir::elements` refuses to *narrow* an array that reaches a helper
        // for exactly this reason, having been caught by a benchmark that
        // returned -512 for 4864. This is the same rule from the other side:
        // an array that arrived narrow does not reach one.
        // **Two causes, and one sentence was naming only the first.** An
        // element that is not a double, a reference or a bool is *either* a
        // narrow integer — a typed array, which is what the paragraph above is
        // about — or an **erased** value, which is an array of a union, of
        // `unknown`, or of a type parameter nothing pinned. Those are different
        // shapes needing different work, and `on a typed array` was false for
        // every one of the second kind.
        //
        // It was false for **27 of the 29** distinct sites in the profile,
        // counted by splitting the message and re-running rather than by
        // reading them: `ctx.seen.includes(value)` in `util/inspect`,
        // `names.map(…)` in `internal/errors`, `enqueue(value: T)` in
        // `streams/fifo`. Two are genuinely typed arrays. A reader sent to look
        // for a typed array in the other twenty-seven finds nothing and has no
        // next step.
        //
        // What the erased case needs is the `_value` family — `nts_array_at_value`,
        // `_pop_value`, `_shift_value`, `_concat_value` and `_set_length_value`
        // exist; `push`, `slice`, `reverse`, `join`, `splice`, `fill`,
        // `index_of` and `includes` do not — so the message names that rather
        // than a shape the program does not have.
        if name == "with" {
            return self.lower_array_with(id, receiver, element, arguments);
        }

        if matches!(element, HirType::Erased) {
            return self.lower_erased_array_method(id, &name, receiver, arguments);
        }
        if !matches!(
            element,
            HirType::Float { bits: 64 } | HirType::Managed(_) | HirType::Bool
        ) && !holds_counted(element)
        {
            return Err(self.unsupported(id, &format!("`{name}` on a typed array")));
        }

        // `xs.forEach(v => ...)` is a loop written as a call, and so are `map`
        // and `reduce`. All three are compiled as the loop. See
        // [`Self::lower_iteration`].
        if let Some(walked) = iteration_method(&name) {
            let (callback, seed) = self.iteration_arguments(id, &name, walked, arguments)?;
            if self.kind_of(callback) != Some(syntax::ARROW_FUNCTION) {
                // `xs.map(f)` where `f` is a name is a genuine dispatch: which
                // body runs is not written at the call. Monomorphization is the
                // answer to that one, and it is a different lowering rather
                // than a harder version of this one -- so it says which.
                return Err(self.unsupported(
                    id,
                    &format!("a `{name}` whose callback is not an arrow written at the call"),
                ));
            }
            let seed = match seed {
                Some(seed) => Some(self.lower_expression(seed)?),
                None => None,
            };
            return self.lower_iteration(id, receiver, element, callback, walked, seed);
        }

        // `fill` is the one method whose element type does not have to be a
        // number: it writes a value it was given rather than comparing or
        // arithmetic-ing one, so the only thing that changes is how wide the
        // write is. `new Array(n).fill(true)` is how three of the Are We Fast
        // Yet benchmarks make their working set.
        if name == "fill" && !matches!(element, HirType::Float { .. } | HirType::Int { .. }) {
            return self.lower_wide_fill(id, receiver, element, arguments);
        }
        // An array of references, where the element is a pointer rather than a
        // double. Every one of the twenty-two profile sites that wanted a
        // method on a non-numeric array wanted this -- strings, objects,
        // closures, an `Int32Array` -- and not one wanted an array of
        // booleans, which is why there is no third family.
        //
        // `pop` and `at` answer the element type directly here rather than an
        // erased value: `T | undefined` for a reference *is* the null pointer.
        if holds_counted(element) {
            return self
                .lower_reference_array_method(id, member, &name, receiver, element, arguments);
        }
        if !matches!(element, HirType::Float { .. } | HirType::Int { .. }) {
            return Err(self.unsupported(member, "an array method on a non-numeric array"));
        }
        let array = HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER)));

        // `pop` and `at` answer `undefined` where there is nothing there, and
        // the checker says so: both are typed `T | undefined`, which for a
        // number is an *erased* value. They answered NaN instead, on the
        // written claim that "undefined is NaN for a number" -- which is not
        // true of anything the language does with it. `String([].pop())` is
        // "undefined" in node and was "NaN" here; `?? 0` takes the one and not
        // the other. Where a caller has narrowed the result back to a number,
        // or converts it through a `!` (`claimed_reads::read_as_number`), the
        // double-returning helper is still the one, and costs nothing.
        let absent_result =
            self.type_of(id) == Some(HirType::Erased) && !claimed_reads::read_as_number(self, id);

        // `push` returns the new length, which is what the expression is worth
        // in JavaScript, and takes as many elements as it was given.
        if name == "push" {
            return self.lower_pushes(id, "nts_array_push", receiver, arguments, &HirType::NUMBER);
        }
        if name == "unshift" {
            return self.lower_pushes(
                id,
                "nts_array_unshift",
                receiver,
                arguments,
                &HirType::NUMBER,
            );
        }

        // `join`, which is not in `numeric_array_method` because its one
        // argument defaults to a comma rather than to the `Infinity` that
        // table's arity filling supplies -- the same reason the reference path
        // handles it separately.
        //
        // The runtime formats each element the way `String(x)` does, which is
        // what `Array.prototype.join` says. That conversion is per element and
        // has to be, and it is the whole of what used to make this refuse.
        if name == "join" {
            let separator = self.join_separator(id, arguments)?;
            let origin = self.origin(id);
            return Ok(self.call_runtime(
                "nts_array_join_num",
                vec![receiver, separator],
                HirType::Managed(ManagedType::String),
                &origin,
            ));
        }
        if name == "toReversed" {
            return Ok(self.lower_to_reversed(id, receiver, &array, false));
        }
        // Refused here rather than falling through to `this array method is not
        // supported`, which says nothing about why a numeric `sort()` is a
        // different question from a string one.
        if matches!(name.as_str(), "sort" | "toSorted") {
            return self.lower_sort(id, (member, &name), (receiver, &array, false), arguments);
        }

        // `xs.concat()` concatenates nothing: a copy, which is `slice`'s.
        let name = if name == "concat" && arguments.is_empty() {
            "slice".to_owned()
        } else {
            name
        };
        let Some((helper, arity, ty)) = numeric_array_method(&name, absent_result, &array) else {
            return Err(self.unsupported(member, "this array method"));
        };

        let mut args = vec![receiver];
        self.lower_method_arguments(id, (MethodsOf::Array, &name), arguments, &mut args)?;
        let origin = self.origin(id);
        self.fill_array_arguments((id, &name), arity, &mut args, &origin)?;
        if args.len() != arity + 1 {
            return Err(self.unsupported(id, "an array method with this many arguments"));
        }

        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// `push` with more than one argument, which appends each in turn.
    ///
    /// `headers.push(name, value)` is how a flat key-value list is built and it
    /// appears twice in the node profile. The runtime helper takes one element,
    /// which is the right shape -- appending two is appending one twice -- so
    /// this is a loop here rather than a variadic there. The value of the
    /// expression is the length after the last, which is what the last call
    /// returns.
    /// `element` is what the array holds, and each argument is built at it.
    ///
    /// **The JVM is what said so.** `xs.push({ a: 1 })` into an `Opts[]` built
    /// the literal at its own one-field type and handed it to
    /// `nts_array_push_ref`, which takes a pointer and asks nothing. C and LLVM
    /// stored it and read field 1 off an object that has no field 1; the JVM
    /// relates classes by name and threw
    /// `ClassCastException: nts.gen.Type67 cannot be cast to nts.gen.Opts`.
    /// Two backends agreeing is not evidence when what they agree about is
    /// something neither of them looks at.
    fn lower_pushes(
        &mut self,
        id: NodeId,
        helper: &str,
        receiver: ValueId,
        arguments: &[NodeId],
        element: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let unshift = !helper.starts_with("nts_array_push");
        // **Every argument first, then the inserts.** JavaScript evaluates a
        // call's arguments before the call: `a.push(a.length, a.length)` reads
        // the length twice before either append, and `[9].unshift(1, 2)` puts
        // `1, 2` at the front in that order. Interleaved, the second read saw
        // the first append, and one-at-a-time unshifts reversed the run -- 86
        // of 116 cases wrong on every backend
        // (tests/programs/a-push-and-an-unshift-of-several-arguments).
        let mut pending = Vec::with_capacity(arguments.len());
        for argument in arguments {
            if self.kind_of(*argument) == Some(syntax::SPREAD_ELEMENT) {
                if unshift {
                    return Err(self.unsupported(
                        *argument,
                        "a spread into `unshift`, which keeps the spread's order at the front",
                    ));
                }
                pending.push(Pending::Spread(self.spread_source(*argument)?));
                continue;
            }
            // Coerced, not only lowered expecting: a value with a type of its
            // own -- a class instance pushed onto an interface-typed array --
            // was handed to the helper at the element's representation with
            // no question asked, which is the same pointer cast `coerce`
            // refuses at a parameter. See `lower_array_literal`, which had the
            // same hole and the same segfault.
            let value = self.lower_expecting(*argument, element)?;
            pending.push(Pending::Value(self.coerce(value, element, *argument)?));
        }
        // An unshift inserts its run last to first, so the run keeps its order
        // at the front. Each call answers the length after it, and the last
        // call made is the length the expression has.
        if unshift {
            pending.reverse();
        }
        let mut length = None;
        for item in pending {
            length = Some(match item {
                Pending::Value(value) => self.push(
                    OpKind::Call {
                        callee: Callee::External(helper.to_owned()),
                        args: vec![receiver, value],
                        frame: None,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                ),
                Pending::Spread(spread) => {
                    self.append_each(id, helper, receiver, spread, element)?
                }
            });
        }
        length.map_or_else(
            || {
                // `xs.push()` appends nothing and is the current length.
                Ok(self.push(OpKind::Length(receiver), HirType::NUMBER, origin))
            },
            Ok,
        )
    }

    /// The array a `...ys` argument spreads, and its length **read when the
    /// argument is evaluated** -- before any append, so `xs.push(...xs)`
    /// appends the elements `xs` had, and a loop re-reading the length would
    /// chase its own appends forever.
    fn spread_source(&mut self, spread: NodeId) -> Result<Spread, Diagnostic> {
        let node = *self
            .children(spread)
            .first()
            .ok_or_else(|| self.unsupported(spread, "a spread of nothing"))?;
        let source = self.lower_expression(node)?;
        let HirType::Managed(ManagedType::Array(slot)) = self.values[source.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(node, "a spread of something that is not an array"));
        };
        let origin = self.origin(spread);
        let count = self.push(OpKind::Length(source), HirType::NUMBER, origin);
        Ok(Spread {
            node,
            source,
            slot: *slot,
            count,
        })
    }

    /// `xs.push(...ys)`'s appends: every element of `ys` the argument saw, in
    /// order, through the helper one argument takes, each coerced to what `xs`
    /// holds. An earlier append only grows `xs` at its end, so the elements
    /// below `count` are still the ones the spread read.
    fn append_each(
        &mut self,
        id: NodeId,
        helper: &str,
        receiver: ValueId,
        spread: Spread,
        element: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let Spread {
            node: source_node,
            source,
            slot,
            count,
        } = spread;
        let origin = self.origin(id);
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let (header, body, done) = (self.new_block(), self.new_block(), self.new_block());
        let at = self.push_block_param(header, HirType::NUMBER, origin.clone());
        self.terminate(Terminator::Jump {
            target: header,
            args: vec![zero],
        });
        self.switch_to(header);
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: at,
                rhs: count,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: more,
            then_target: body,
            then_args: Vec::new(),
            else_target: done,
            else_args: Vec::new(),
        });
        self.switch_to(body);
        // In range by the loop's bound, which was the length when the
        // argument was evaluated and only grows if `xs` is `ys`.
        let read = self.push(
            OpKind::ArrayGet {
                array: source,
                index: at,
                checked: false,
            },
            slot,
            origin.clone(),
        );
        let value = self.coerce(read, element, source_node)?;
        self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args: vec![receiver, value],
                frame: None,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        let next = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: at,
                rhs: one,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: header,
            args: vec![next],
        });
        self.switch_to(done);
        Ok(self.push(OpKind::Length(receiver), HirType::NUMBER, origin))
    }

    /// Array.prototype.with: normalize and check the relative index before
    /// allocating a fresh array. The copy does not read the replaced slot.
    /// <https://tc39.es/ecma262/#sec-array.prototype.with>
    fn lower_array_with(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        element: &HirType,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if !matches!(
            element,
            HirType::Float { bits: 64 } | HirType::Managed(_) | HirType::Bool | HirType::Erased
        ) && !holds_counted(element)
        {
            return Err(self.unsupported(id, "`with` on a typed array"));
        }
        // Evaluate every argument before conversion can throw, including
        // ignored extra arguments. LengthOfArrayLike follows argument evaluation
        // but precedes ToNumber(index), which can itself have effects.
        let values = self.builtin_raw_arguments(
            NumericBuiltin::Method(MethodsOf::Array, "with"),
            arguments,
            None,
        )?;
        let origin = self.origin(id);
        let length = self.push(OpKind::Length(receiver), HirType::NUMBER, origin.clone());
        let index = match values.first().copied() {
            Some(value) => self.builtin_number_argument(
                (id, arguments[0]),
                NumericBuiltin::Method(MethodsOf::Array, "with"),
                1,
                value,
            )?,
            None => self.push(
                OpKind::ConstFloat(f64::NAN),
                HirType::NUMBER,
                origin.clone(),
            ),
        };
        let index = self.coerce(index, &HirType::NUMBER, id)?;
        let index = self.array_with_index(id, index, length)?;
        let replacement = match values.get(1).copied() {
            Some(value) => value,
            None => self.push(OpKind::ConstUndefined, HirType::Erased, origin.clone()),
        };
        let replacement = self.coerce(replacement, element, id)?;
        let ty = HirType::Managed(ManagedType::Array(Box::new(element.clone())));
        let copy = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Filled,
            },
            ty,
            origin.clone(),
        );
        self.copy_array_with_value(id, (receiver, copy), element, (index, replacement), &origin)?;
        Ok(copy)
    }

    fn array_with_index(
        &mut self,
        id: NodeId,
        index: ValueId,
        length: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let truncated = self.push(
            OpKind::Unary {
                op: UnOp::Trunc,
                operand: index,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let nan = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: truncated,
                rhs: truncated,
            },
            HirType::Bool,
            origin.clone(),
        );
        let whole = self.lower_branching_value_at(
            id,
            HirType::NUMBER,
            nan,
            Branch::Value(zero),
            Branch::Value(truncated),
        )?;
        let negative = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: whole,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let from_end = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: length,
                rhs: whole,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let actual = self.lower_branching_value_at(
            id,
            HirType::NUMBER,
            negative,
            Branch::Value(from_end),
            Branch::Value(whole),
        )?;
        for (op, limit) in [(BinOp::Lt, zero), (BinOp::Ge, length)] {
            let outside = self.push(
                OpKind::Binary {
                    op,
                    lhs: actual,
                    rhs: limit,
                },
                HirType::Bool,
                origin.clone(),
            );
            self.refuse_when(id, outside, "RangeError", "Invalid index")?;
        }
        Ok(actual)
    }

    fn copy_array_with_value(
        &mut self,
        id: NodeId,
        (source, target): (ValueId, ValueId),
        element: &HirType,
        (index, replacement): (ValueId, ValueId),
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        let length = self.push(OpKind::Length(target), HirType::NUMBER, origin.clone());
        let cursor = self.synthetic_symbol();
        self.bindings.insert(cursor, zero);
        let copying = self.begin_loop(id, &[cursor], false, origin)?;
        let at = self.bindings[&cursor];
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: at,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.test_loop(more, &copying);
        self.switch_to(copying.body);
        let replaced = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: at,
                rhs: index,
            },
            HirType::Bool,
            origin.clone(),
        );
        let reading = self.new_block();
        let writing = self.new_block();
        let value = self.push_block_param(writing, element.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: replaced,
            then_target: writing,
            then_args: vec![replacement],
            else_target: reading,
            else_args: Vec::new(),
        });
        self.switch_to(reading);
        // Conversion cannot change source length (objects refuse); revisit this bound with ToPrimitive.
        let original = self.push(
            OpKind::ArrayGet {
                array: source,
                index: at,
                checked: false,
            },
            element.clone(),
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: writing,
            args: vec![original],
        });
        self.switch_to(writing);
        self.push(
            OpKind::ArraySet {
                array: target,
                index: at,
                value,
                checked: false,
            },
            HirType::Void,
            origin.clone(),
        );
        let next = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: at,
                rhs: one,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.bindings.insert(cursor, next);
        self.end_loop(&copying, Step::None)
    }

    /// `toReversed()` — `reverse()` on a copy, which is what the specification
    /// says it is: *a new array with the elements in reverse order*.
    ///
    /// Composed from the two helpers that already exist rather than given a
    /// third of its own. A `nts_array_to_reversed` would be a second place that
    /// decides what copying and reversing mean, and the two could then disagree
    /// about a sparse array, a view, or a reference element — the shape this
    /// file has been bitten by repeatedly. It also costs no runtime surface, so
    /// C, LLVM and the JVM answer for it the day it lands instead of two of them
    /// answering and the third red-gating.
    ///
    /// `slice` takes a start and an end and its arity filling supplies the
    /// infinity for "to the end", so the copy is the whole array.
    fn lower_to_reversed(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        ty: &HirType,
        references: bool,
    ) -> ValueId {
        let origin = self.origin(id);
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let end = self.push(
            OpKind::ConstFloat(f64::INFINITY),
            HirType::NUMBER,
            origin.clone(),
        );
        let (slice, reverse) = if references {
            let slice = match ty {
                HirType::Managed(ManagedType::Array(element)) => {
                    counted_helper(element, Counts::Slice)
                }
                _ => "nts_array_slice_ref",
            };
            (slice, "nts_array_reverse_ref")
        } else {
            ("nts_array_slice", "nts_array_reverse")
        };
        let copy = self.call_runtime(slice, vec![receiver, zero, end], ty.clone(), &origin);
        self.call_runtime(reverse, vec![copy], ty.clone(), &origin)
    }

    /// An array method where the **elements** are erased.
    ///
    /// `unknown[]`, an array of a union, an array of an unpinned type parameter.
    /// The element is a sixteen-byte `NtsValue`, so every method that *writes* or
    /// *copies* one needs an entry point that knows that width -- reading needs
    /// none, because the emitter indexes `NTS_ITEMS(a, NtsValue)` directly. That
    /// is why an index read on an `unknown[]` has always worked where
    /// `xs.push(v)` had not.
    ///
    /// **`push` is the one that has its helper.** The React lane's runtime keeps
    /// `unknown[]` for children, logs and error lists, and `push` on one was 10
    /// root refusals there. `slice` and `splice` were written with it and
    /// withdrawn: `slice` needs a `nts_value_retain` per copied element and both
    /// need the argument defaults JavaScript gives them, and a helper nothing
    /// calls is scaffolding.
    ///
    /// The argument needs no conversion of its own: `lower_pushes` asks `coerce`
    /// per argument, and `coerce` of anything to `Erased` is the `Erase` it
    /// already emits.
    fn lower_erased_array_method(
        &mut self,
        id: NodeId,
        name: &str,
        receiver: ValueId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if name == "push" {
            return self.lower_pushes(
                id,
                "nts_array_push_value",
                receiver,
                arguments,
                &HirType::Erased,
            );
        }
        Err(self.unsupported(
            id,
            &format!(
                "`{name}` on an array of erased elements, which needs a `_value` helper this \
                 runtime does not have"
            ),
        ))
    }

    /// An array method where the elements are references.
    ///
    /// The same shape as the numeric family and a different set of helpers,
    /// because three of the questions change with the element:
    ///
    /// - `pop` and `at` answer `T | undefined`, which for a reference is the
    ///   null pointer -- so they return the element type and need no tag,
    ///   where the numeric pair had to return an erased value.
    /// - `indexOf` and `includes` compare by `===`, and `===` on a string is
    ///   *value* equality. `["a"].indexOf("a")` is 0 across two separately
    ///   built strings, so a shared identity comparison answers -1 for exactly
    ///   the case a string array is written for.
    /// - `slice` retains each element it copies, and `push` retains what it is
    ///   given. `pop` retains nothing: the array is handing over its own count
    ///   with the element.
    fn lower_reference_array_method(
        &mut self,
        id: NodeId,
        member: NodeId,
        name: &str,
        receiver: ValueId,
        element: &HirType,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let of_element = element.clone();
        let array = HirType::Managed(ManagedType::Array(Box::new(of_element.clone())));
        let text = matches!(element, HirType::Managed(ManagedType::String));
        if name == "push" {
            return self.lower_pushes(id, "nts_array_push_ref", receiver, arguments, &of_element);
        }
        if name == "unshift" {
            return self.lower_pushes(
                id,
                "nts_array_unshift_ref",
                receiver,
                arguments,
                &of_element,
            );
        }
        if name == "toReversed" {
            return Ok(self.lower_to_reversed(id, receiver, &array, true));
        }
        if matches!(name, "sort" | "toSorted") {
            return self.lower_sort(id, (member, name), (receiver, &array, text), arguments);
        }
        // `join`, whose separator defaults to a comma rather than to the
        // infinity the arity filling below supplies. Only on strings here:
        // this is the *reference* path, so the other elements are objects,
        // and `String(o)` is "[object Object]" rather than a conversion the
        // runtime can do from a pointer. Numbers are joined on the numeric
        // path, which has a helper that formats them.
        if name == "join" && text {
            let separator = self.join_separator(id, arguments)?;
            let origin = self.origin(id);
            return Ok(self.push(
                OpKind::Call {
                    callee: Callee::External("nts_array_join_str".to_owned()),
                    args: vec![receiver, separator],
                    frame: None,
                },
                HirType::Managed(ManagedType::String),
                origin,
            ));
        }
        // Lowered before the helper is chosen, because the choice now depends
        // on the needle's type and not only on the array's.
        let mut args = vec![receiver];
        self.lower_method_arguments(id, (MethodsOf::Array, name), arguments, &mut args)?;
        let needle_is_erased = args
            .get(1)
            .is_some_and(|value| self.values[value.0 as usize].ty == HirType::Erased);

        // `xs.concat()` concatenates nothing: a copy, which is `slice`'s.
        let name = if name == "concat" && arguments.is_empty() {
            "slice"
        } else {
            name
        };
        // **`at` on a `(T | null)[]` answers erased.** Its result can be the
        // stored `null` or `undefined` past the end, and one null pointer is
        // not both: `nts_array_at_ref`'s was read as `undefined` either way.
        // Only this element kind -- one with no absence, or `undefined` alone,
        // has one answer per null pointer and keeps the pointer.
        let null_only = name == "at"
            && matches!(element, HirType::Managed(_))
            && self
                .receiver_of_member(member)
                .and_then(|node| self.read_type(node))
                .is_some_and(|ty| self.null_only_element(ty));
        let (helper, arity, ty) = match name {
            "pop" => ("nts_array_pop_ref", 0, of_element),
            "shift" => ("nts_array_shift_ref", 0, of_element),
            "at" if null_only => ("nts_array_at_element", 1, HirType::Erased),
            "at" => (counted_helper(element, Counts::At), 1, of_element),
            // The needle's own type picks the variant, not only the array's.
            //
            // `validateOneOf(value: unknown, name: string, oneOf: string[])`
            // calls `oneOf.includes(value)`, and choosing from the *array*
            // alone handed `const NtsString *` an `NtsValue`. Four modules'
            // `program.c` stopped compiling the hour that validator first
            // became reachable, and the C compiler is what said so -- nothing
            // in the lowering checks an extern's arguments against the
            // signature table, because most of that table's entries are `None`.
            //
            // Not an unerase: an `unknown` that is not a string is not an error
            // here. SameValueZero says it is simply absent from an array of
            // strings, so the helper reads the tag and answers "not found".
            "indexOf" if text && needle_is_erased => {
                ("nts_array_index_of_str_value", 1, HirType::NUMBER)
            }
            "indexOf" if text => ("nts_array_index_of_str", 1, HirType::NUMBER),
            "indexOf" => ("nts_array_index_of_ref", 1, HirType::NUMBER),
            "includes" if text && needle_is_erased => {
                ("nts_array_includes_str_value", 1, HirType::Bool)
            }
            "includes" if text => ("nts_array_includes_str", 1, HirType::Bool),
            "includes" => ("nts_array_includes_ref", 1, HirType::Bool),
            "concat" => (counted_helper(element, Counts::Concat), 1, array.clone()),
            "slice" => (counted_helper(element, Counts::Slice), 2, array.clone()),
            "splice" => ("nts_array_splice_ref", 2, array),
            "reverse" => ("nts_array_reverse_ref", 0, array),
            _ => {
                return Err(
                    self.unsupported(member, &format!("`{name}` on an array of references"))
                );
            }
        };
        let origin = self.origin(id);
        self.fill_array_arguments((id, name), arity, &mut args, &origin)?;
        if args.len() != arity + 1 {
            return Err(self.unsupported(id, "an array method with this many arguments"));
        }
        if null_only {
            let tag = self.null_slot(self.receiver_of_member(member), &origin);
            args.push(tag);
        }
        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// Whether this node's type is an array whose element the checker could not
    /// name -- `any[]`, or the evolving `[]`.
    ///
    /// The width of such an array's elements is the runtime descriptor's fact, so
    /// a narrowing to it carries no information and must leave the value erased.
    /// See [`Self::narrowed`], which is the only caller and holds the reasoning.
    pub(super) fn element_says_nothing(&self, id: NodeId) -> bool {
        let Some(ty) = self.snapshot.node_types.get(&id) else {
            return false;
        };
        let Some(TypeKind::Array(element)) =
            self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind)
        else {
            return false;
        };
        matches!(
            self.snapshot.types.get(element.0 as usize).map(|r| &r.kind),
            Some(TypeKind::Any | TypeKind::Evolving)
        )
    }
}

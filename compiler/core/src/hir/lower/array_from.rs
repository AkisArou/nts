//! Collect an iterator into an array, with the length, fill, and mapping operations Array.from needs.

use super::{
    ArrayFill, BinOp, CallbackResult, Diagnostic, FuncBuilder, HirType, Iteration, Loop,
    ManagedType, NodeId, OpKind, Origin, Step, Terminator, ValueId, Walk, holds_counted,
    table_fill, walks_pairs,
};

/// An append either writes a new slot through a helper, or uses a known
/// append position for scalar storage. Counted elements require the helper:
/// a growing `ArraySet` would first load an old reference that does not exist.
#[derive(Clone, Copy)]
pub(super) enum CollectionAppend {
    Push(&'static str),
    Store(ValueId),
}

impl FuncBuilder<'_> {
    /// `Array.from(xs)`: the walk, appending.
    ///
    /// # Why this is the walk and not four special cases
    ///
    /// `Array.from` takes *anything iterable*, and this compiler already knows
    /// how to iterate five things -- an array, a typed array, a string by code
    /// point, a `Map` or `Set`, a user type with `[Symbol.iterator]`, and a
    /// generator. [`Self::walk_of`] is that knowledge, and it is the same
    /// function a `for...of` asks. So this is a loop over the walk with an
    /// append where the body would be, and every shape `for...of` learns
    /// afterwards arrives here for nothing.
    ///
    /// It replaced a version that handled one case: `Array.from(xs)` where
    /// `xs` was already an array, lowered as `slice`. That refused a typed
    /// array by name (`slice` reads doubles or pointers and a `Uint8Array` is
    /// neither), refused a string, and refused a `Set` -- which together are
    /// **eight of the ten `Array.from` calls in `runtime/node`**, and the copy
    /// it did handle is the one case that had `[...xs]` as an alternative.
    ///
    /// # What the loop looks like
    ///
    /// The array is allocated empty *before* the loop and appended to, so it
    /// dominates the body and is not a carried name -- only the cursor is. That
    /// is the same reason `for...of` does not carry the sequence.
    ///
    /// The length is not known in advance for three of the five shapes: a
    /// `Map` with holes, a string by code point, and a generator. Asking for it
    /// where it *is* known would size the allocation exactly and cost a second
    /// path through this function to be wrong in; the growth strategy record
    /// 0029 describes is what makes appending the right answer for all five.
    /// `Array.from(xs, f)` runs its callback between steps of this walk.
    ///
    /// **Two features wear this name and only one of them is here.** With an
    /// iterable the second argument is a mapping callback; with `{ length: n }`
    /// it is not an iteration at all -- an array-like is read by index, and
    /// `Array.from({ length: 4 })` builds four `undefined`s out of an object
    /// with no elements. That second one refuses, and refuses as itself: a
    /// `for...of` over an object type, which is what it is.
    ///
    /// The mapper runs before the next iterator step. Collecting first and
    /// applying `map` later loses additions, deletions and changes the mapper
    /// makes to the source, and reorders a generator's own effects. The source
    /// walk and callback-body delivery stay shared with their existing users.
    pub(super) fn lower_array_from_mapped(
        &mut self,
        id: NodeId,
        argument: NodeId,
        callback: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let (sequence, forced) = self.sequence_source(argument);
        let sequence_value = self.lower_expression(sequence)?;
        let walk = self.walk_of(sequence, sequence_value, forced, 1)?;
        if !self.inlines_as_a_callback(callback) {
            return Err(self.unsupported(
                callback,
                "a `map` callback that reads its own `this`, whose body is not inlined",
            ));
        }
        let (names, body) = self.callback_shape(callback, Iteration::Map, "map")?;
        self.map_a_walk(id, sequence_value, walk, &names, body)
    }

    /// Map one element before asking the source for its next one. A mapper
    /// can change the source, so the result starts empty and grows; its length
    /// is the callback index, independently of table holes or UTF-16 cursors.
    fn map_a_walk(
        &mut self,
        id: NodeId,
        sequence: ValueId,
        walk: Walk,
        names: &[u32],
        body: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let element_symbol = names.first().copied().ok_or_else(|| {
            self.unsupported(id, "an `Array.from` mapper without an element parameter")
        })?;
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `map` result"))?;
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(self.unsupported(id, "an `Array.from` that does not build an array"));
        }
        let origin = self.origin(id);
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let out = self.push(
            OpKind::ArrayNew {
                length: zero,
                fill: ArrayFill::Filled,
            },
            ty,
            origin.clone(),
        );
        let (sequence, cursor, lent) = self.walk_start(&walk, sequence, &origin)?;
        let synthetic: Vec<u32> = cursor.into_iter().collect();
        let carried = self.carried_across(body, &synthetic, names);
        let steps = !matches!(walk, Walk::Protocol { .. } | Walk::Generator { .. });
        let record = self.begin_loop(id, &carried, steps, &origin)?;
        let (stepped, at) = if let Some(cursor) = cursor {
            (None, self.bindings[&cursor])
        } else {
            let (step, done) = self.protocol_step(id, &walk, &origin)?;
            (Some(step), done)
        };
        let cond = self.walk_condition(&walk, at, sequence, &origin)?;
        self.test_loop(cond, &record);
        self.switch_to(record.body);
        let value = self.walk_element(&walk, sequence, at, stepped, &origin)?;
        self.bindings.insert(element_symbol, value);
        let position = self.push(OpKind::Length(out), HirType::NUMBER, origin.clone());
        if let Some(symbol) = names.get(1) {
            self.bindings.insert(*symbol, position);
        }
        let lower = |this: &mut Self| {
            this.lower_callback_body(
                id,
                body,
                CallbackResult::Append {
                    array: out,
                    index: position,
                },
                record.depth,
                "map",
            )
        };
        if let Walk::Protocol { iterator, .. } = &walk {
            self.lower_iterator_body(id, *iterator, record.depth, &[body], lower)?;
        } else {
            lower(self)?;
        }
        let step = cursor.map_or(Step::None, |cursor| Step::Walk {
            cursor,
            walk,
            sequence,
        });
        self.end_loop(&record, step)?;
        self.unlend_walked(lent, &origin);
        Ok(out)
    }

    pub(super) fn lower_array_from(
        &mut self,
        id: NodeId,
        argument: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        self.build_array_from(id, argument)
    }

    /// One append policy for collected and mapped walks. A mapper already
    /// has the private output's pre-call length, so scalar elements can use a
    /// growing store at that position. Counted and erased elements use push:
    /// its ownership contract knows the slot is new and loads no old value.
    pub(super) fn collection_append(
        &self,
        id: NodeId,
        element_ty: &HirType,
        position: Option<ValueId>,
    ) -> Result<CollectionAppend, Diagnostic> {
        let helper = match (element_ty, position) {
            (counted, _) if holds_counted(counted) => "nts_array_push_ref",
            (HirType::Erased, _) => "nts_array_push_value",
            (HirType::Float { .. } | HirType::Int { .. } | HirType::Bool, Some(index)) => {
                return Ok(CollectionAppend::Store(index));
            }
            (HirType::Float { bits: 64 }, None) => "nts_array_push",
            _ => {
                return Err(self.unsupported(
                    id,
                    "a walk collected into a typed array, whose elements are narrower than a \
                     double and are pushed one width at a time",
                ));
            }
        };
        Ok(CollectionAppend::Push(helper))
    }

    /// Apply the append policy after its caller has coerced the value to the
    /// array's element type. This is shared by ordinary and mapped walks.
    pub(super) fn append_collection_value(
        &mut self,
        append: CollectionAppend,
        array: ValueId,
        value: ValueId,
        origin: &Origin,
    ) {
        match append {
            CollectionAppend::Push(helper) => {
                self.runtime_call(helper, vec![array, value], HirType::Void, origin.clone());
            }
            CollectionAppend::Store(index) => {
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
        }
    }

    /// Keep the table cursor test, then test the output position on the body's
    /// incoming edge. Both comparisons read only compiler-owned values.
    ///
    /// Flow's relational facts describe the immediate guard, while its interval
    /// refinements survive both edges. The returned condition therefore places
    /// the length relation where bounds analysis can read it.
    fn collection_bound(
        &mut self,
        cursor_present: ValueId,
        position: ValueId,
        array: ValueId,
        record: &Loop,
        origin: &Origin,
    ) -> ValueId {
        let bounds_test = self.new_block();
        let (exit, _) = self.exit_of(record.depth);
        let reached = self.carried_now(&record.carried);
        self.terminate(Terminator::Branch {
            cond: cursor_present,
            then_target: bounds_test,
            then_args: Vec::new(),
            else_target: exit,
            else_args: reached,
        });
        self.switch_to(bounds_test);
        let length = self.push(OpKind::Length(array), HirType::NUMBER, origin.clone());
        self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: position,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        )
    }

    /// Walk a sequence and collect every element into a new array.
    ///
    /// The core of [`Self::build_array_from`], extracted so that a **rest element** can use it
    /// too: `const [...x] = iter` has to collect what the iterator yields, and before this it
    /// refused with a sentence naming this very feature -- *"a rest element over a value that is
    /// not an array, which needs it collected through its iterator first"*. 190 recorded test262
    /// cases, every one of them with the rest at position 0.
    ///
    /// **Why it takes a `ValueId` and a built `Walk`.** `Array.from(xs)` has its argument as a
    /// *node* and can lower it itself; a rest element's source is already lowered -- `bind_rest`
    /// receives a value -- so a shared core cannot start from an expression. And the `Walk` comes
    /// from the caller because the two reach it differently: `Array.from` reads a method name off
    /// `sequence_source` (`values()`, `keys()`, `entries()`) and a pattern never has one.
    ///
    /// Everything in here was measured where it stands and the comments are the measurements:
    /// the sizing branch is worth four allocations rather than any time, the `ArraySet` is checked
    /// because `hir::bounds` is what should prove it rather than this lowering asserting it, and
    /// `filled` is a second counter because a table's cursor is an entry index whose holes are not
    /// elements.
    pub(super) fn collect_a_walk(
        &mut self,
        id: NodeId,
        sequence: NodeId,
        sequence_value: ValueId,
        walk: Walk,
        ty: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let HirType::Managed(ManagedType::Array(element_ty)) = ty else {
            return Err(self.unsupported(id, "a walk collected into a value that is not an array"));
        };
        let element_ty = element_ty.as_ref();
        if let Some(out) = self.fill_from_table(&walk, sequence_value, element_ty, ty, &origin) {
            return Ok(out);
        }
        let append = self.collection_append(id, element_ty, None)?;

        // How many elements are coming, where that is known before the walk
        // starts. Three of the five shapes know: an array and a typed array
        // from their length, a `Map` or `Set` from its live entry count --
        // which is the same `Length`, because a table keeps it in the header
        // field an array uses.
        //
        // Two do not, and cannot. A string's code points are one or two units
        // each, so its `length` is an upper bound and not an answer; a
        // generator's elements do not exist until it is asked for them.
        //
        // The difference is worth a branch here, and the evidence is *not* the
        // timing: `Array.from(set)` over 256 elements two thousand times reads
        // 1.86 ms growing against 1.84 ms sized, which is no change. It is the
        // allocation count, which goes from nine to five for a sixteen-element
        // walk -- `tests/memory/array-from`. Doubling makes the copying
        // about one extra pass, and one extra pass over two kilobytes is not
        // what a timing harness can see.
        //
        // Measured twice, under both providers, because the sibling decision
        // above was measured under the wrong one and had to be retracted.
        let counted = matches!(
            walk,
            Walk::Counted { .. } | Walk::Table { .. } | Walk::Entries { .. }
        );
        let start = if counted {
            self.push(
                OpKind::Length(sequence_value),
                HirType::NUMBER,
                origin.clone(),
            )
        } else {
            self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone())
        };
        let out = self.push(
            OpKind::ArrayNew {
                length: start,
                // Filled: `Array.from`'s walk: a counted one stores exactly its length's elements, an uncounted one starts empty and appends, and no code the source wrote runs inside the loop.
                fill: ArrayFill::Filled,
            },
            ty.clone(),
            origin.clone(),
        );

        let (sequence_value, index, lent) = self.walk_start(&walk, sequence_value, &origin)?;
        // Where the *next element goes*, which is not the cursor: a table's
        // cursor is an entry index and its holes are not elements, so a walk
        // that wrote at the cursor would leave gaps and run off the end.
        let filled = self.synthetic_symbol();
        if counted {
            let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
            self.bindings.insert(filled, zero);
        }
        let mut carried: Vec<u32> = index.into_iter().collect();
        if counted {
            carried.push(filled);
        }
        let steps = !matches!(walk, Walk::Protocol { .. } | Walk::Generator { .. });
        let record = self.begin_loop(id, &carried, steps, &origin)?;

        let (stepped, at) = if let Some(index) = index {
            (None, self.bindings[&index])
        } else {
            let (step, done) = self.protocol_step(id, &walk, &origin)?;
            (Some(step), done)
        };
        let cond = self.walk_condition(&walk, at, sequence_value, &origin)?;
        let cond = if matches!(walk, Walk::Table { .. } | Walk::Entries { .. }) {
            // This walk invokes no source callback: its live entry count is
            // the number of slots allocated in `out`. Keep both halves of
            // `filled < out.length && cursor >= 0`: the first exposes the
            // output counter's bound to flow/bounds; the second still refuses
            // to read an exhausted table cursor. Mappers use `map_a_walk`,
            // whose result grows as its callback changes the source.
            self.collection_bound(cond, self.bindings[&filled], out, &record, &origin)
        } else {
            cond
        };
        self.test_loop(cond, &record);
        self.switch_to(record.body);

        let element = self.collected_element(
            &walk,
            sequence,
            sequence_value,
            (at, stepped),
            element_ty,
            &origin,
        )?;
        if counted {
            self.store_and_advance(out, filled, element, &origin);
        } else {
            self.append_collection_value(append, out, element, &origin);
        }

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
        Ok(out)
    }

    /// A table's keys or values, into an array of the type it stores them as:
    /// sized at the table's live count and filled by one call, in entry order
    /// and holes skipped, where the walk made a call pair per element
    /// (`nts_map_next`, `nts_map_key_at`) -- half of `Array.from`'s time on C.
    /// Only at the stored type, so no backend converts: an element type of the
    /// program's own choosing keeps the walk and its `coerce`. Asked before the
    /// walk's append, which a copy never makes, so a narrow element -- a
    /// boolean -- is copied too. None where the walk is not a table's.
    fn fill_from_table(
        &mut self,
        walk: &Walk,
        sequence_value: ValueId,
        element_ty: &HirType,
        ty: &HirType,
        origin: &Origin,
    ) -> Option<ValueId> {
        let Walk::Table { read, .. } = walk else {
            return None;
        };
        let fill = table_fill(&self.values[sequence_value.0 as usize].ty, read, element_ty)?;
        let live = self.push(
            OpKind::Length(sequence_value),
            HirType::NUMBER,
            origin.clone(),
        );
        let out = self.push(
            OpKind::ArrayNew {
                length: live,
                // Filled: the call writes every slot before anything reads one.
                fill: ArrayFill::Filled,
            },
            ty.clone(),
            origin.clone(),
        );
        self.call_runtime(fill, vec![sequence_value, out], HirType::Void, origin);
        Some(out)
    }

    /// The callback-free collection. A mapper has to run during iteration,
    /// which is `map_a_walk`; this path can retain its array-copy fast path.
    fn build_array_from(&mut self, id: NodeId, argument: NodeId) -> Result<ValueId, Diagnostic> {
        // An array source keeps its `slice`, and the reason is measured rather
        // than assumed. 256 elements copied two thousand times, against a C++
        // reference at 41.65 us:
        //
        //     walked   462.77 us   12.18x C++   3.80x node
        //     sliced    53.07 us    1.27x C++   0.45x node
        //
        // **8.7x**, and sliced it beats node. A `slice` is a memcpy of one run
        // of memory whose length is known before it starts; the walk is a
        // bounds check, a load and a store per element.
        //
        // This comment said 1.34x for a while, from a benchmark run under a
        // provider that never frees -- so both variants were measuring page
        // faults and the difference between them nearly vanished. Record 0102
        // is about that.
        //
        // Every other shape has no run of memory to copy: a `Set` with holes, a
        // string by code point, a generator. So this is one specialization with
        // a number on it rather than two paths kept in step.
        //
        // Exactly the two element widths `slice` reads -- a double and a
        // pointer. A **typed** array is `Array` too and is neither, and routing
        // one here refused it by name: `slice` moves eight bytes or a word, and
        // a `Uint8Array` holds one. That was a regression this file's own
        // example caught within the hour, and it is why the test asks for the
        // typed source rather than for "an array".
        if matches!(
            self.type_of(argument),
            Some(HirType::Managed(ManagedType::Array(element)))
                if matches!(*element, HirType::Float { bits: 64 } | HirType::Managed(_))
        ) && let Some(ty) = self.type_of(id)
        {
            let origin = self.origin(id);
            return self.lower_array_copy(argument, &ty, &origin);
        }
        let (sequence, forced) = self.sequence_source(argument);
        let sequence_value = self.lower_expression(sequence)?;
        let walk = self.collection_walk(sequence, sequence_value, forced)?;
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "what `Array.from` builds"))?;
        self.collect_a_walk(id, sequence, sequence_value, walk, &ty)
    }

    /// The walk a collection reads its source with: a pair per element where
    /// the source yields pairs -- a `Map` itself, and any `entries()` -- and
    /// the one-name walk otherwise.
    ///
    /// `Array.from`, a spread and a rest element all collect, and asking here
    /// is what keeps them building the same array. [`Self::pair_walk`] is the
    /// answer `for (const [k, v] of ...)` already uses, and it is the same
    /// set: a bare `Map` iterates its entries, a bare `Set` or array its
    /// elements.
    pub(super) fn collection_walk(
        &mut self,
        sequence: NodeId,
        value: ValueId,
        forced: Option<&'static str>,
    ) -> Result<Walk, Diagnostic> {
        match Self::pair_walk(&self.values[value.0 as usize].ty, forced) {
            Some(walk) => Ok(walk),
            None => self.walk_of(sequence, value, forced, 1),
        }
    }

    /// A counted collection's store: the element at the position `filled`
    /// holds, and the position advanced past it.
    fn store_and_advance(&mut self, out: ValueId, filled: u32, element: ValueId, origin: &Origin) {
        let position = self.bindings[&filled];
        self.push(
            OpKind::ArraySet {
                array: out,
                index: position,
                value: element,
                // Checked, and `hir::bounds` is what should remove it: the
                // array was allocated at the walk's own length and the
                // position advances once per element, so a proof exists.
                // Asserting it here instead would be this lowering
                // promising something no pass had verified.
                checked: true,
            },
            HirType::Void,
            origin.clone(),
        );
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        let next = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: position,
                rhs: one,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.bindings.insert(filled, next);
    }

    /// The element a collection stores for one turn of its walk, at the
    /// collected array's element type: the walk's one value, coerced, or --
    /// for a `Map`'s entries, a `Set`'s or an array's -- its two reads and the
    /// pair the language says the element is, built where it is stored.
    fn collected_element(
        &mut self,
        walk: &Walk,
        sequence: NodeId,
        sequence_value: ValueId,
        (at, stepped): (ValueId, Option<ValueId>),
        element_ty: &HirType,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        if walks_pairs(walk) {
            let read = self.read_element(walk, sequence_value, at, origin)?;
            let pair: [ValueId; 2] = read
                .try_into()
                .map_err(|_| self.unsupported(sequence, "a pair walk that read other than two"))?;
            return self.pair_of(sequence, element_ty, pair);
        }
        let element = self.walk_element(walk, sequence_value, at, stepped, origin)?;
        self.coerce(element, element_ty, sequence)
    }

    /// The one value a walk hands the body, whichever kind of walk it is.
    ///
    /// The two cursorless walks read theirs out of what the step returned --
    /// a generator's frame, or the `{ value, done }` an iterator built -- and
    /// the three with a cursor read the sequence at it. Written once because
    /// `for...of` and `Array.from` both need exactly this and had it inline.
    pub(super) fn walk_element(
        &mut self,
        walk: &Walk,
        sequence: ValueId,
        at: ValueId,
        stepped: Option<ValueId>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        Ok(match (walk, stepped) {
            (Walk::Generator { element, .. }, Some(frame)) => {
                let element = element.clone();
                self.push(
                    OpKind::FieldGet {
                        object: frame,
                        field: crate::hir::suspend::FIELD_YIELDED,
                    },
                    element,
                    origin.clone(),
                )
            }
            (Walk::Protocol { value, element, .. }, Some(step)) => {
                let (value, element) = (*value, element.clone());
                self.push(
                    OpKind::FieldGet {
                        object: step,
                        field: value,
                    },
                    element,
                    origin.clone(),
                )
            }
            _ => {
                let mut values = self.read_element(walk, sequence, at, origin)?;
                values.remove(0)
            }
        })
    }
}

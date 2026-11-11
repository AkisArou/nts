//! Lower array sorting and comparator dispatch, including sorting indices and writing the result back.

use super::{
    ArrayFill, BinOp, ClosureEntry, Counts, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId,
    OpKind, Origin, Step, Terminator, TypeId, TypeKind, UniformArguments, ValueId, counted_helper,
};

/// A `sort` comparator as the merge calls it: the function value, which body
/// that reaches, and the parameters its arguments are coerced to.
struct Comparator {
    node: NodeId,
    function: ValueId,
    callee: ClosureEntry,
    parameters: Vec<HirType>,
    argument_source: Option<(NodeId, Option<TypeId>)>,
    /// The immutable owner of managed elements. Merge buffers then contain
    /// uint32 indices into this snapshot, never managed references themselves.
    snapshot: Option<ValueId>,
}

impl FuncBuilder<'_> {
    pub(super) fn lower_sort(
        &mut self,
        id: NodeId,
        at: (NodeId, &str),
        receiver: (ValueId, &HirType, bool),
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let (member, name) = at;
        let (receiver, ty, text) = receiver;
        if let [compare] = arguments {
            return self.lower_sort_with(id, (member, name), (receiver, ty), *compare);
        }
        if !arguments.is_empty() {
            return Err(
                self.unsupported(member, &format!("a `{name}` with more than a comparator"))
            );
        }
        if !text {
            return Err(self.unsupported(
                member,
                &format!(
                    "a `{name}` with no comparator on an array that does not hold strings, \
                     whose default order is by the string each element converts to"
                ),
            ));
        }
        let origin = self.origin(id);
        let target = if name == "toSorted" {
            let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
            let end = self.push(
                OpKind::ConstFloat(f64::INFINITY),
                HirType::NUMBER,
                origin.clone(),
            );
            self.call_runtime(
                "nts_array_slice_ref",
                vec![receiver, zero, end],
                ty.clone(),
                &origin,
            )
        } else {
            receiver
        };
        // The receiver's node: `member` is the method's *name*, which has no
        // children, so asking it read every array as one whose null slots are
        // `undefined` and sorted a stored `null` last instead of as "null".
        let null_slot = self.null_slot(self.receiver_of_member(member), &origin);
        Ok(self.call_runtime(
            "nts_array_sort_str",
            vec![target, null_slot],
            ty.clone(),
            &origin,
        ))
    }

    /// `sort(compare)` and `toSorted(compare)`: a stable bottom-up merge sort,
    /// lowered here as loops, calling the comparator as the function value it
    /// is -- an arrow, a named function, or anything else that holds one.
    ///
    /// **Why not a runtime sort.** The comparator is the program's, so a C
    /// sort would have to call back into it through a pointer, which cannot
    /// carry a capturing arrow. Every other array callback is a loop the
    /// lowering writes, and this is one more; the merge is the specification's
    /// stability requirement (ES2019) made structural rather than hoped for.
    ///
    /// What the specification asks, and where it is kept:
    ///
    /// - **A snapshot.** The elements are read once into an array of this
    ///   function's own before anything is compared, and the sorted order is
    ///   written back at the end -- `SortIndexedProperties` then `Set`. A
    ///   comparator that pushes, pops or assigns to the array while it runs
    ///   changes the array and not the sort: its order is then unspecified,
    ///   but no index the merge reads can be out of bounds, because the merge
    ///   reads only its own two arrays. Writing back grows the array one slot
    ///   at a time where the comparator shrank it (`ArraySet` checked).
    /// - **Stable.** The left run's element goes first unless the comparator
    ///   says the right one is strictly less: `compare(left, right) > 0`.
    /// - **NaN is 0.** Which the same test gives: `NaN > 0` is false, so a
    ///   comparator answering NaN keeps the order, as one answering 0 does.
    /// - **`undefined` last, never compared.** An array whose elements may be
    ///   `undefined` is refused by name rather than compared: partitioning
    ///   them out is its own step, not written yet.
    ///
    /// `toSorted` sorts a copy (`slice`) the same way and answers it.
    fn lower_sort_with(
        &mut self,
        id: NodeId,
        (member, name): (NodeId, &str),
        (receiver, ty): (ValueId, &HirType),
        compare: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) = ty else {
            return Err(self.unsupported(
                member,
                &format!("a `{name}` with a comparator on this kind of array"),
            ));
        };
        let element = (**element).clone();
        let copy = match &element {
            HirType::Managed(_) => counted_helper(&element, Counts::Slice),
            _ if element == HirType::NUMBER => "nts_array_slice",
            _ => {
                return Err(self.unsupported(
                    member,
                    &format!("a `{name}` with a comparator on an array of this element type"),
                ));
            }
        };
        if self.sorted_may_hold_undefined(member) {
            return Err(self.unsupported(
                member,
                &format!("a `{name}` with a comparator over elements that may be `undefined`, which go last without being compared"),
            ));
        }
        // The comparator's own signature: what it takes, and that it answers a
        // number.
        let (parameters, returns) = self.comparator_signature(compare).ok_or_else(|| {
            self.unsupported(
                compare,
                &format!("a `{name}` comparator whose signature this lowering cannot read"),
            )
        })?;
        if returns != HirType::NUMBER || parameters.len() > 2 {
            return Err(self.unsupported(
                compare,
                &format!(
                    "a `{name}` comparator that does not take two elements and answer a number"
                ),
            ));
        }
        let function = self.lower_expression(compare)?;
        let callee = self.closure_callee(id, compare, function)?;
        let origin = self.origin(id);
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let end = self.push(
            OpKind::ConstFloat(f64::INFINITY),
            HirType::NUMBER,
            origin.clone(),
        );
        let target = if name == "toSorted" {
            self.call_runtime(copy, vec![receiver, zero, end], ty.clone(), &origin)
        } else {
            receiver
        };
        // Keep managed elements owned by one immutable snapshot throughout
        // comparisons and write-back. The comparator can mutate the original
        // array, retain an element, collect or throw; it cannot reach this
        // private owner. Merge passes move only uint32 indices, so their
        // partial results need no element counts, even on an exceptional exit.
        let snapshot = matches!(element, HirType::Managed(_))
            .then(|| self.call_runtime(copy, vec![target, zero, end], ty.clone(), &origin));
        let runs = if let Some(snapshot) = snapshot {
            self.sort_indices(id, snapshot, &origin)?
        } else {
            // Numeric sorts already move uncounted values; an index would add
            // an indirection without removing any count traffic.
            (
                self.call_runtime(copy, vec![target, zero, end], ty.clone(), &origin),
                self.call_runtime(copy, vec![target, zero, end], ty.clone(), &origin),
            )
        };
        let comparator = Comparator {
            node: compare,
            function,
            callee,
            parameters,
            argument_source: self.receiver_of_member(member).and_then(|receiver| {
                let array = self.read_type(receiver)?;
                match self.snapshot.types.get(array.0 as usize)?.kind {
                    TypeKind::Array(element) => Some((receiver, Some(element))),
                    _ => None,
                }
            }),
            snapshot,
        };
        let sorted = self.merge_passes(id, runs, &element, &comparator, &origin)?;
        self.write_back(id, (sorted, target), &element, snapshot, &origin)?;
        Ok(target)
    }

    /// Two private index buffers, initially `0..length` and zeros. An array's
    /// length is uint32, so every valid index fits exactly in four bytes. The
    /// second buffer is read only after a complete pass has filled it.
    fn sort_indices(
        &mut self,
        id: NodeId,
        snapshot: ValueId,
        origin: &Origin,
    ) -> Result<(ValueId, ValueId), Diagnostic> {
        let length = self.push(OpKind::Length(snapshot), HirType::NUMBER, origin.clone());
        let index_type = HirType::Int {
            bits: 32,
            signed: false,
        };
        let array_type = HirType::Managed(ManagedType::Array(Box::new(index_type.clone())));
        let mut allocate = || {
            self.push(
                OpKind::ArrayNew {
                    length,
                    fill: ArrayFill::Filled,
                },
                array_type.clone(),
                origin.clone(),
            )
        };
        let buffers = (allocate(), allocate());
        let at = self.synthetic_symbol();
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.bindings.insert(at, zero);
        let fill = self.begin_loop(id, &[at], true, origin)?;
        let index = self.bindings[&at];
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: index,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.test_loop(more, &fill);
        self.switch_to(fill.body);
        let value = self.push(OpKind::Convert(index), index_type, origin.clone());
        self.push(
            OpKind::ArraySet {
                array: buffers.0,
                index,
                value,
                checked: false,
            },
            HirType::Void,
            origin.clone(),
        );
        self.end_loop(&fill, Step::Count { name: at, by: 1.0 })?;
        Ok(buffers)
    }

    /// Read one merge element. Managed sorts read an index and then borrow
    /// from the private counted snapshot, which survives every comparator and
    /// every write-back. Both bounds follow from the index permutation.
    fn sort_element(
        &mut self,
        (array, index): (ValueId, ValueId),
        element: &HirType,
        snapshot: Option<ValueId>,
        origin: &Origin,
    ) -> ValueId {
        let stored = if snapshot.is_some() {
            HirType::Int {
                bits: 32,
                signed: false,
            }
        } else {
            element.clone()
        };
        let value = self.push(
            OpKind::ArrayGet {
                array,
                index,
                checked: false,
            },
            stored,
            origin.clone(),
        );
        if let Some(array) = snapshot {
            self.push(
                OpKind::ArrayGet {
                    array,
                    index: value,
                    checked: false,
                },
                element.clone(),
                origin.clone(),
            )
        } else {
            value
        }
    }

    /// The merge passes of [`Self::lower_sort_with`], over `runs` -- two arrays
    /// holding the same elements -- answering the one left sorted.
    ///
    /// `for (width = 1; width < n; width *= 2)`, then each pair of runs
    /// `[low, middle)` and `[middle, high)` merged from one array into the
    /// other, which then trade places.
    fn merge_passes(
        &mut self,
        id: NodeId,
        runs: (ValueId, ValueId),
        element: &HirType,
        comparator: &Comparator,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let constant = |this: &mut Self, value: f64| {
            this.push(OpKind::ConstFloat(value), HirType::NUMBER, origin.clone())
        };
        let binary = |this: &mut Self, op: BinOp, lhs: ValueId, rhs: ValueId, ty: HirType| {
            this.push(OpKind::Binary { op, lhs, rhs }, ty, origin.clone())
        };
        let (one, two) = (constant(self, 1.0), constant(self, 2.0));
        let length = self.push(OpKind::Length(runs.0), HirType::NUMBER, origin.clone());

        let (width, from, to) = (
            self.synthetic_symbol(),
            self.synthetic_symbol(),
            self.synthetic_symbol(),
        );
        self.bindings.insert(width, one);
        self.bindings.insert(from, runs.0);
        self.bindings.insert(to, runs.1);
        let passes = self.begin_loop(id, &[width, from, to], false, origin)?;
        let more = binary(
            self,
            BinOp::Lt,
            self.bindings[&width],
            length,
            HirType::Bool,
        );
        self.test_loop(more, &passes);
        self.switch_to(passes.body);

        let low = self.synthetic_symbol();
        let zero = constant(self, 0.0);
        self.bindings.insert(low, zero);
        let pairs = self.begin_loop(id, &[low], false, origin)?;
        let more = binary(self, BinOp::Lt, self.bindings[&low], length, HirType::Bool);
        self.test_loop(more, &pairs);
        self.switch_to(pairs.body);
        let run_width = self.bindings[&width];
        let start = self.bindings[&low];
        let middle_end = binary(self, BinOp::Add, start, run_width, HirType::NUMBER);
        let middle = binary(self, BinOp::Min, middle_end, length, HirType::NUMBER);
        let span = binary(self, BinOp::Mul, run_width, two, HirType::NUMBER);
        let high_end = binary(self, BinOp::Add, start, span, HirType::NUMBER);
        let high = binary(self, BinOp::Min, high_end, length, HirType::NUMBER);
        let arrays = (self.bindings[&from], self.bindings[&to]);
        self.merge_pair(
            id,
            arrays,
            (start, middle, high),
            element,
            comparator,
            origin,
        )?;
        let next_low = binary(self, BinOp::Add, self.bindings[&low], span, HirType::NUMBER);
        self.bindings.insert(low, next_low);
        self.end_loop(&pairs, Step::None)?;

        let doubled = binary(
            self,
            BinOp::Mul,
            self.bindings[&width],
            two,
            HirType::NUMBER,
        );
        let (was_from, was_to) = (self.bindings[&from], self.bindings[&to]);
        self.bindings.insert(width, doubled);
        self.bindings.insert(from, was_to);
        self.bindings.insert(to, was_from);
        self.end_loop(&passes, Step::None)?;
        Ok(self.bindings[&from])
    }

    /// One merge: `source[start..middle)` and `source[middle..high)` into
    /// `target[start..high)`. The left run's element goes first unless the
    /// comparator says the right one is strictly less -- `compare(left,
    /// right) > 0`, which a NaN is not -- and the comparator is called only
    /// while both runs have one.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn merge_pair(
        &mut self,
        id: NodeId,
        (source, target): (ValueId, ValueId),
        (start, middle, high): (ValueId, ValueId, ValueId),
        element: &HirType,
        comparator: &Comparator,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let binary = |this: &mut Self, op: BinOp, lhs: ValueId, rhs: ValueId, ty: HirType| {
            this.push(OpKind::Binary { op, lhs, rhs }, ty, origin.clone())
        };
        let (at, left, right) = (
            self.synthetic_symbol(),
            self.synthetic_symbol(),
            self.synthetic_symbol(),
        );
        self.bindings.insert(at, start);
        self.bindings.insert(left, start);
        self.bindings.insert(right, middle);
        let merge = self.begin_loop(id, &[at, left, right], true, origin)?;
        let more = binary(self, BinOp::Lt, self.bindings[&at], high, HirType::Bool);
        self.test_loop(more, &merge);
        self.switch_to(merge.body);
        let (left_at, right_at) = (self.bindings[&left], self.bindings[&right]);
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        let left_next = binary(self, BinOp::Add, left_at, one, HirType::NUMBER);
        let right_next = binary(self, BinOp::Add, right_at, one, HirType::NUMBER);
        // The index taken, and the runs' next positions: `(left, left + 1,
        // right)` or `(right, left, right + 1)`.
        let merged = self.new_block();
        let chosen = self.push_block_param(merged, HirType::NUMBER, origin.clone());
        let next_left = self.push_block_param(merged, HirType::NUMBER, origin.clone());
        let next_right = self.push_block_param(merged, HirType::NUMBER, origin.clone());
        let by_left = vec![left_at, left_next, right_at];
        let by_right = vec![right_at, left_at, right_next];
        let left_has = binary(self, BinOp::Lt, left_at, middle, HirType::Bool);
        let right_open = self.new_block();
        self.terminate(Terminator::Branch {
            cond: left_has,
            then_target: right_open,
            then_args: Vec::new(),
            else_target: merged,
            else_args: by_right.clone(),
        });
        self.switch_to(right_open);
        let right_has = binary(self, BinOp::Lt, right_at, high, HirType::Bool);
        let both = self.new_block();
        self.terminate(Terminator::Branch {
            cond: right_has,
            then_target: both,
            then_args: Vec::new(),
            else_target: merged,
            else_args: by_left.clone(),
        });
        self.switch_to(both);
        let first = self.sort_element((source, left_at), element, comparator.snapshot, origin);
        let second = self.sort_element((source, right_at), element, comparator.snapshot, origin);
        let mut args = vec![comparator.function];
        for (value, want) in [first, second].into_iter().zip(&comparator.parameters) {
            args.push(self.coerce(value, want, comparator.node)?);
        }
        // **Through [`Self::call_a_closure_entry`], because `closure_callee` may have
        // chosen a uniform slot for this call and a uniform entry takes erased
        // arguments.** Built by hand here it passed the comparator's *written* ones,
        // and the ordinary body survived only because `fields::devirtualize` rewrites a
        // known class back to the written `#call`.
        //
        // Keyed on `id`, the `sort` call: that is the node `closure_callee` chose the
        // slot for and the node `call_within` records, so the slot, the flag test and
        // the handler edge are one answer about one node.
        if let Some(source) = comparator.argument_source {
            self.argument_sources.insert(
                id,
                UniformArguments::new(vec![source; comparator.parameters.len()]),
            );
        }
        let answer =
            self.call_a_closure_entry(id, comparator.callee, None, args, &HirType::NUMBER)?;
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let right_first = binary(self, BinOp::Gt, answer, zero, HirType::Bool);
        // One block per answer rather than both arms into `merged`: an edge is
        // a (block, block) pair, and two of them between the same two blocks
        // with different arguments are one phi entry with two values.
        let (take_right, take_left) = (self.new_block(), self.new_block());
        self.terminate(Terminator::Branch {
            cond: right_first,
            then_target: take_right,
            then_args: Vec::new(),
            else_target: take_left,
            else_args: Vec::new(),
        });
        self.switch_to(take_right);
        self.terminate(Terminator::Jump {
            target: merged,
            args: by_right,
        });
        self.switch_to(take_left);
        self.terminate(Terminator::Jump {
            target: merged,
            args: by_left,
        });
        self.switch_to(merged);
        let stored = if comparator.snapshot.is_some() {
            HirType::Int {
                bits: 32,
                signed: false,
            }
        } else {
            element.clone()
        };
        let value = self.push(
            OpKind::ArrayGet {
                array: source,
                index: chosen,
                checked: false,
            },
            stored,
            origin.clone(),
        );
        let index = self.bindings[&at];
        self.push(
            OpKind::ArraySet {
                array: target,
                index,
                value,
                checked: false,
            },
            HirType::Void,
            origin.clone(),
        );
        self.bindings.insert(left, next_left);
        self.bindings.insert(right, next_right);
        self.end_loop(&merge, Step::Count { name: at, by: 1.0 })
    }

    /// The sorted elements written back in order into the array the program
    /// holds -- appended past its end, where the comparator shrank it: a store
    /// at the length grows only some arrays by one, and `push` grows any.
    fn write_back(
        &mut self,
        id: NodeId,
        (sorted, target): (ValueId, ValueId),
        element: &HirType,
        snapshot: Option<ValueId>,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let push = if *element == HirType::NUMBER {
            "nts_array_push"
        } else {
            "nts_array_push_ref"
        };
        let length = self.push(OpKind::Length(sorted), HirType::NUMBER, origin.clone());
        let back = self.synthetic_symbol();
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.bindings.insert(back, zero);
        let write = self.begin_loop(id, &[back], true, origin)?;
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: self.bindings[&back],
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.test_loop(more, &write);
        self.switch_to(write.body);
        let index = self.bindings[&back];
        let value = self.sort_element((sorted, index), element, snapshot, origin);
        let held = self.push(OpKind::Length(target), HirType::NUMBER, origin.clone());
        let inside = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: index,
                rhs: held,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (store, append, written) = (self.new_block(), self.new_block(), self.new_block());
        self.terminate(Terminator::Branch {
            cond: inside,
            then_target: store,
            then_args: Vec::new(),
            else_target: append,
            else_args: Vec::new(),
        });
        self.switch_to(store);
        self.push(
            OpKind::ArraySet {
                array: target,
                index,
                value,
                checked: true,
            },
            HirType::Void,
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: written,
            args: Vec::new(),
        });
        self.switch_to(append);
        self.call_runtime(push, vec![target, value], HirType::Void, origin);
        self.terminate(Terminator::Jump {
            target: written,
            args: Vec::new(),
        });
        self.switch_to(written);
        self.end_loop(
            &write,
            Step::Count {
                name: back,
                by: 1.0,
            },
        )
    }

    /// Whether the array a `sort` is called on may hold `undefined`, as the
    /// checker types it.
    fn sorted_may_hold_undefined(&self, member: NodeId) -> bool {
        let kind = |ty: TypeId| {
            self.snapshot
                .types
                .get(ty.0 as usize)
                .map(|record| &record.kind)
        };
        let Some(access) = self.node(member).parent else {
            return true;
        };
        let Some(array) = self
            .children(access)
            .first()
            .and_then(|receiver| self.snapshot.node_types.get(receiver))
            .copied()
        else {
            return true;
        };
        let elements: Vec<TypeId> = match kind(array) {
            Some(TypeKind::Array(element)) => vec![*element],
            Some(TypeKind::Tuple(tuple)) => tuple.elements.clone(),
            _ => return false,
        };
        elements.into_iter().any(|element| match kind(element) {
            Some(TypeKind::Undefined) => true,
            Some(TypeKind::Union(parts)) => parts
                .iter()
                .any(|part| matches!(kind(*part), Some(TypeKind::Undefined))),
            _ => false,
        })
    }

    /// A comparator's parameters and result, as its function type declares
    /// them.
    fn comparator_signature(&self, compare: NodeId) -> Option<(Vec<HirType>, HirType)> {
        let ty = *self.snapshot.node_types.get(&compare)?;
        let TypeKind::Function(signature) = self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        let signature = self.snapshot.signatures.get(signature.0 as usize)?;
        let parameters = signature
            .parameters
            .iter()
            .map(|parameter| self.represent(parameter.ty))
            .collect::<Option<Vec<_>>>()?;
        Some((parameters, self.represent(signature.return_type)?))
    }
}

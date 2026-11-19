//! Adaptive stable sorting of a private uint32 permutation.
//!
//! Natural runs and binary insertion supply minimum runs; powersort orders
//! their merges. The only managed owner is the immutable snapshot (toSorted's
//! private result itself). No partially merged buffer has a managed edge.

use super::{
    ArrayFill, BinOp, Comparator, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind,
    Origin, Step, Terminator, ValueId,
};

type Built<T = ()> = Result<T, Diagnostic>;
// JavaScript permits lengths through u32::MAX. Dense allocations currently
// stop at NTS_MAX_LENGTH=2147483646 (runtime/c/nts_runtime.h); the cursor proof
// uses the full JavaScript limit, independently of that physical cap. Backward
// cursors are exclusive ends, so neither direction needs a negative sentinel.
const INDEX: HirType = HirType::Int {
    bits: 32,
    signed: false,
};
const SLOT: HirType = INDEX;
const WIDE: HirType = HirType::Int {
    bits: 64,
    signed: true,
};

/// Emit the bounded expression itself, also evaluated by the boundary proof.
/// Subtract before adding: start+step can exceed u32 even though the result fits.
fn bounded_advance<V: Copy>(
    start: V,
    step: V,
    limit: V,
    mut emit: impl FnMut(BinOp, V, V) -> V,
) -> V {
    let remaining = emit(BinOp::Sub, limit, start);
    let step = emit(BinOp::Min, step, remaining);
    emit(BinOp::Add, start, step)
}

/// Offset from a forward start or a backward exclusive end. Callers prove
/// offset < the remaining run length before a backward element is read.
fn run_position<V: Copy>(
    start: V,
    offset: V,
    one: V,
    forward: bool,
    mut emit: impl FnMut(BinOp, V, V) -> V,
) -> V {
    if forward {
        emit(BinOp::Add, start, offset)
    } else {
        let last = emit(BinOp::Sub, start, one);
        emit(BinOp::Sub, last, offset)
    }
}

fn doubled_midpoints<V: Copy>(
    start: V,
    middle: V,
    end: V,
    mut emit: impl FnMut(BinOp, V, V) -> V,
) -> (V, V) {
    (
        emit(BinOp::Add, start, middle),
        emit(BinOp::Add, middle, end),
    )
}

impl FuncBuilder<'_> {
    pub(super) fn sort_managed(
        &mut self,
        id: NodeId,
        owner: ValueId,
        element: &HirType,
        comparator: &Comparator,
        origin: &Origin,
    ) -> Built<ValueId> {
        let raw_length = self.push(OpKind::Length(owner), HirType::NUMBER, origin.clone());
        let length = self.push(OpKind::Convert(raw_length), INDEX, origin.clone());
        let order = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Filled,
            },
            HirType::Managed(ManagedType::Array(Box::new(SLOT))),
            origin.clone(),
        );
        Sort {
            b: self,
            id,
            origin: origin.clone(),
            owner,
            element: element.clone(),
            comparator,
            length,
            order,
        }
        .run()?;
        Ok(order)
    }
}

struct Sort<'a, 's> {
    b: &'a mut FuncBuilder<'s>,
    id: NodeId,
    origin: Origin,
    owner: ValueId,
    element: HirType,
    comparator: &'a Comparator,
    length: ValueId,
    order: ValueId,
}

impl Sort<'_, '_> {
    fn push(&mut self, kind: OpKind, ty: HirType) -> ValueId {
        self.b.push(kind, ty, self.origin.clone())
    }
    fn int(&mut self, n: u32) -> ValueId {
        self.push(OpKind::ConstInt(i128::from(n)), INDEX)
    }
    fn boolean(&mut self, n: bool) -> ValueId {
        self.push(OpKind::ConstBool(n), HirType::Bool)
    }
    fn binary(&mut self, op: BinOp, lhs: ValueId, rhs: ValueId) -> ValueId {
        let ty = if op.is_comparison() {
            HirType::Bool
        } else {
            self.b.values[lhs.0 as usize].ty.clone()
        };
        self.push(OpKind::Binary { op, lhs, rhs }, ty)
    }
    fn offset(&mut self, value: ValueId, by: i32) -> ValueId {
        let ty = self.b.values[value.0 as usize].ty.clone();
        let amount = self.push(OpKind::ConstInt(i128::from(by.unsigned_abs())), ty);
        self.binary(if by < 0 { BinOp::Sub } else { BinOp::Add }, value, amount)
    }
    fn position(&mut self, start: ValueId, offset: ValueId, forward: bool) -> ValueId {
        let one = self.int(1);
        run_position(start, offset, one, forward, |op, a, b| {
            self.binary(op, a, b)
        })
    }
    fn var(&self, name: u32) -> ValueId {
        self.b.bindings[&name]
    }
    fn bind(&mut self, name: u32, value: ValueId) {
        self.b.bindings.insert(name, value);
    }
    fn variable(&mut self, value: ValueId) -> u32 {
        let name = self.b.synthetic_symbol();
        self.bind(name, value);
        name
    }
    fn advance(&mut self, name: u32, by: i32) {
        let next = self.offset(self.var(name), by);
        self.bind(name, next);
    }
    fn get(&mut self, array: ValueId, index: ValueId) -> ValueId {
        self.push(
            OpKind::ArrayGet {
                array,
                index,
                checked: false,
            },
            SLOT,
        )
    }
    fn get_index(&mut self, array: ValueId, index: ValueId) -> ValueId {
        let value = self.get(array, index);
        self.push(OpKind::Convert(value), INDEX)
    }
    fn put(&mut self, array: ValueId, index: ValueId, value: ValueId) {
        let value = if self.b.values[value.0 as usize].ty == SLOT {
            value
        } else {
            self.push(OpKind::Convert(value), SLOT)
        };
        self.push(
            OpKind::ArraySet {
                array,
                index,
                value,
                checked: false,
            },
            HirType::Void,
        );
    }
    fn allocate(&mut self, length: ValueId) -> ValueId {
        self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Filled,
            },
            HirType::Managed(ManagedType::Array(Box::new(SLOT))),
        )
    }
    fn jump(&mut self, target: super::super::BlockId, args: Vec<ValueId>) {
        self.b.terminate(Terminator::Jump { target, args });
    }

    /// Only the named synthetic bindings escape either arm. Source bindings
    /// keep their existing owners; comparator calls update cells, not this map.
    fn branch(
        &mut self,
        cond: ValueId,
        names: &[u32],
        yes: impl FnOnce(&mut Self) -> Built,
        no: impl FnOnce(&mut Self) -> Built,
    ) -> Built {
        let before = self.b.bindings.clone();
        let (taken, other, join) = (self.b.new_block(), self.b.new_block(), self.b.new_block());
        let params: Vec<_> = names
            .iter()
            .map(|name| {
                let ty = self.b.values[before[name].0 as usize].ty.clone();
                self.b.push_block_param(join, ty, self.origin.clone())
            })
            .collect();
        self.b.terminate(Terminator::Branch {
            cond,
            then_target: taken,
            then_args: Vec::new(),
            else_target: other,
            else_args: Vec::new(),
        });
        self.b.switch_to(taken);
        yes(self)?;
        self.jump(join, names.iter().map(|n| self.var(*n)).collect());
        self.b.bindings.clone_from(&before);
        self.b.switch_to(other);
        no(self)?;
        self.jump(join, names.iter().map(|n| self.var(*n)).collect());
        self.b.bindings = before;
        self.b.switch_to(join);
        for (&name, value) in names.iter().zip(params) {
            self.bind(name, value);
        }
        Ok(())
    }

    fn loop_while(
        &mut self,
        names: &[u32],
        test: impl FnOnce(&mut Self) -> ValueId,
        body: impl FnOnce(&mut Self) -> Built,
    ) -> Built {
        let record = self.b.begin_loop(self.id, names, false, &self.origin)?;
        let condition = test(self);
        self.b.test_loop(condition, &record);
        self.b.switch_to(record.body);
        body(self)?;
        self.b.end_loop(&record, Step::None)
    }

    /// Compare borrowed snapshot elements, never an index or a scratch slot.
    /// The ordered >0 test also gives the specified NaN-as-zero behavior.
    fn greater(&mut self, first: ValueId, second: ValueId) -> Built<ValueId> {
        let first = self.push(
            OpKind::ArrayGet {
                array: self.owner,
                index: first,
                checked: false,
            },
            self.element.clone(),
        );
        let second = self.push(
            OpKind::ArrayGet {
                array: self.owner,
                index: second,
                checked: false,
            },
            self.element.clone(),
        );
        let answer = self
            .b
            .sort_compare(self.id, (first, second), self.comparator)?;
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER);
        Ok(self.binary(BinOp::Gt, answer, zero))
    }
    fn greater_at(&mut self, a: (ValueId, ValueId), b: (ValueId, ValueId)) -> Built<ValueId> {
        let first = self.get(a.0, a.1);
        let second = self.get(b.0, b.1);
        self.greater(first, second)
    }

    fn run(&mut self) -> Built {
        let zero = self.int(0);
        let at = self.variable(zero);
        self.loop_while(
            &[at],
            |s| s.binary(BinOp::Lt, s.var(at), s.length),
            |s| {
                s.put(s.order, s.var(at), s.var(at));
                s.advance(at, 1);
                Ok(())
            },
        )?;
        let minrun = self.minrun()?;
        let first_end = self.next_run(zero, minrun)?;
        let multiple = self.binary(BinOp::Lt, first_end, self.length);
        // A whole natural run allocates neither a merge buffer nor a stack.
        self.branch(
            multiple,
            &[],
            |s| s.merge_runs(first_end, minrun),
            |_| Ok(()),
        )
    }

    /// `TimSort`'s minimum run in [16,32], or the whole input below 32. The
    /// remainder bit avoids a final tiny run just above a power of two.
    fn minrun(&mut self) -> Built<ValueId> {
        let n = self.variable(self.length);
        let zero = self.int(0);
        let remainder = self.variable(zero);
        self.loop_while(
            &[n, remainder],
            |s| {
                let limit = s.int(32);
                s.binary(BinOp::Ge, s.var(n), limit)
            },
            |s| {
                let one = s.int(1);
                let bit = s.binary(BinOp::BitAnd, s.var(n), one);
                let extra = s.binary(BinOp::BitOr, s.var(remainder), bit);
                s.bind(remainder, extra);
                let two = s.int(2);
                let half = s.binary(BinOp::Div, s.var(n), two);
                s.bind(n, half);
                Ok(())
            },
        )?;
        Ok(self.binary(BinOp::Add, self.var(n), self.var(remainder)))
    }

    /// Find a natural run, reversing only strict descending order. Equality
    /// (including a NaN comparator result) never reverses equal references.
    fn next_run(&mut self, start: ValueId, minrun: ValueId) -> Built<ValueId> {
        let next = self.offset(start, 1);
        let end = self.variable(next);
        let pair = self.binary(BinOp::Lt, next, self.length);
        self.branch(
            pair,
            &[end],
            |s| {
                // Everything at or beyond start is still the identity
                // permutation: completed runs only write their own prefix.
                let descending = s.greater(start, next)?;
                s.advance(end, 1);
                let yes = s.boolean(true);
                let open = s.variable(yes);
                s.loop_while(
                    &[end, open],
                    |s| {
                        let inside = s.binary(BinOp::Lt, s.var(end), s.length);
                        s.b.bool_join(inside, s.var(open), false, &s.origin)
                    },
                    |s| {
                        let previous = s.offset(s.var(end), -1);
                        let less = s.greater(previous, s.var(end))?;
                        let same = s.binary(BinOp::Eq, less, descending);
                        // Advance independently of the comparison. A
                        // conditional increment makes the next load's address
                        // wait for the previous comparator result.
                        s.advance(end, 1);
                        s.bind(open, same);
                        Ok(())
                    },
                )?;
                s.branch(
                    s.var(open),
                    &[end],
                    |_| Ok(()),
                    |s| {
                        s.advance(end, -1);
                        Ok(())
                    },
                )?;
                s.branch(
                    descending,
                    &[],
                    |s| s.reverse(start, s.var(end)),
                    |_| Ok(()),
                )
            },
            |_| Ok(()),
        )?;
        let minimum_end =
            bounded_advance(start, minrun, self.length, |op, a, b| self.binary(op, a, b));
        let finish = self.binary(BinOp::Max, minimum_end, self.var(end));
        self.binary_insert(start, self.var(end), finish)?;
        Ok(finish)
    }

    fn reverse(&mut self, start: ValueId, end: ValueId) -> Built {
        let left = self.variable(start);
        let last = self.offset(end, -1);
        let right = self.variable(last);
        self.loop_while(
            &[left, right],
            |s| s.binary(BinOp::Lt, s.var(left), s.var(right)),
            |s| {
                let first = s.get(s.order, s.var(left));
                let last = s.get(s.order, s.var(right));
                s.put(s.order, s.var(left), last);
                s.put(s.order, s.var(right), first);
                s.advance(left, 1);
                s.advance(right, -1);
                Ok(())
            },
        )
    }

    fn binary_insert(&mut self, start: ValueId, sorted: ValueId, end: ValueId) -> Built {
        let at = self.variable(sorted);
        self.loop_while(
            &[at],
            |s| s.binary(BinOp::Lt, s.var(at), end),
            |s| {
                // The unprocessed suffix has not been permuted yet.
                let pivot = s.var(at);
                let low = s.variable(start);
                let size = s.binary(BinOp::Sub, s.var(at), start);
                let remaining = s.variable(size);
                s.loop_while(
                    &[low, remaining],
                    |s| {
                        let zero = s.int(0);
                        s.binary(BinOp::Gt, s.var(remaining), zero)
                    },
                    |s| {
                        let one = s.int(1);
                        let half = s.binary(BinOp::UShr, s.var(remaining), one);
                        let middle = s.binary(BinOp::Add, s.var(low), half);
                        let item = s.get(s.order, middle);
                        let after = s.greater(item, pivot)?;
                        s.branch(
                            after,
                            &[low, remaining],
                            |s| {
                                s.bind(remaining, half);
                                Ok(())
                            },
                            |s| {
                                let next = s.offset(middle, 1);
                                let rest = s.binary(BinOp::Sub, s.var(remaining), half);
                                let rest = s.offset(rest, -1);
                                s.bind(low, next);
                                s.bind(remaining, rest);
                                Ok(())
                            },
                        )
                    },
                )?;
                let shift = s.variable(s.var(at));
                s.loop_while(
                    &[shift],
                    |s| s.binary(BinOp::Gt, s.var(shift), s.var(low)),
                    |s| {
                        let previous = s.offset(s.var(shift), -1);
                        let item = s.get(s.order, previous);
                        s.put(s.order, s.var(shift), item);
                        s.bind(shift, previous);
                        Ok(())
                    },
                )?;
                s.put(s.order, s.var(low), pivot);
                s.advance(at, 1);
                Ok(())
            },
        )
    }

    /// The first differing binary digit of the two run midpoints / N. Double
    /// the midpoints to keep odd run lengths exact; this is powersort's node
    /// power, not a floating-point approximation of its logarithm.
    fn power(&mut self, start: ValueId, middle: ValueId, end: ValueId) -> Built<ValueId> {
        let start = self.push(OpKind::Convert(start), WIDE);
        let middle = self.push(OpKind::Convert(middle), WIDE);
        let end = self.push(OpKind::Convert(end), WIDE);
        let length = self.push(OpKind::Convert(self.length), WIDE);
        let two = self.push(OpKind::ConstInt(2), WIDE);
        let (a, b) = doubled_midpoints(start, middle, end, |op, a, b| self.binary(op, a, b));
        let a = self.variable(a);
        let b = self.variable(b);
        let zero = self.push(OpKind::ConstInt(0), WIDE);
        let power = self.variable(zero);
        let no = self.boolean(false);
        let done = self.variable(no);
        self.loop_while(
            &[a, b, power, done],
            |s| {
                let no = s.boolean(false);
                s.binary(BinOp::Eq, s.var(done), no)
            },
            |s| {
                s.advance(power, 1);
                let both = s.binary(BinOp::Ge, s.var(a), length);
                s.branch(
                    both,
                    &[a, b, done],
                    |s| {
                        let next_a = s.binary(BinOp::Sub, s.var(a), length);
                        let next_b = s.binary(BinOp::Sub, s.var(b), length);
                        s.bind(a, next_a);
                        s.bind(b, next_b);
                        Ok(())
                    },
                    |s| {
                        let different = s.binary(BinOp::Ge, s.var(b), length);
                        s.bind(done, different);
                        Ok(())
                    },
                )?;
                let next_a = s.binary(BinOp::Mul, s.var(a), two);
                let next_b = s.binary(BinOp::Mul, s.var(b), two);
                s.bind(a, next_a);
                s.bind(b, next_b);
                Ok(())
            },
        )?;
        Ok(self.var(power))
    }

    /// Positive powers increase strictly and are at most 32 for N<=`u32::MAX`.
    /// The 33 rows include a zero-power sentinel; one further slot remembers
    /// min-gallop. Midpoints and the final doubling stay below 4*N < 2^34,
    /// so power arithmetic is i64. Stored node powers fit u32 exactly.
    /// Smaller-run scratch needs at most floor(N/2) u32 slots.
    fn merge_runs(&mut self, first_end: ValueId, minrun: ValueId) -> Built {
        let two = self.int(2);
        let capacity = self.binary(BinOp::Div, self.length, two);
        let scratch = self.allocate(capacity);
        let capacity = self.int(67);
        let stack = self.allocate(capacity);
        let threshold_slot = self.int(66);
        let seven = self.int(7);
        self.put(stack, threshold_slot, seven);
        let zero = self.int(0);
        let one = self.int(1);
        self.put(stack, zero, zero);
        self.put(stack, one, zero);
        // Row zero is a zero-power sentinel. Real node powers are positive;
        // a final zero-power boundary drains the stack through the same merge
        // kernel as ordinary boundaries, without duplicating comparator code.
        let power_zero = self.push(OpKind::ConstInt(0), WIDE);
        let top = self.variable(one);
        let base = self.variable(zero);
        let end = self.variable(first_end);
        self.loop_while(
            &[top, base, end],
            |s| {
                let more = s.binary(BinOp::Lt, s.var(end), s.length);
                let pending = s.binary(BinOp::Gt, s.var(top), one);
                s.b.bool_join(more, pending, true, &s.origin)
            },
            |s| {
                let more = s.binary(BinOp::Lt, s.var(end), s.length);
                let next = s.variable(s.var(end));
                let power = s.variable(power_zero);
                s.branch(
                    more,
                    &[next, power],
                    |s| {
                        let finish = s.next_run(s.var(end), minrun)?;
                        let boundary = s.power(s.var(base), s.var(end), finish)?;
                        s.bind(next, finish);
                        s.bind(power, boundary);
                        Ok(())
                    },
                    |_| Ok(()),
                )?;
                s.loop_while(
                    &[top, base],
                    |s| {
                        let row = s.offset(s.var(top), -1);
                        let slot = s.binary(BinOp::Mul, row, two);
                        let power_slot = s.offset(slot, 1);
                        let previous_power = s.get(stack, power_slot);
                        let previous_power = s.push(OpKind::Convert(previous_power), WIDE);
                        s.binary(BinOp::Gt, previous_power, s.var(power))
                    },
                    |s| {
                        s.advance(top, -1);
                        let slot = s.binary(BinOp::Mul, s.var(top), two);
                        let previous = s.get_index(stack, slot);
                        s.merge(scratch, stack, previous, s.var(base), s.var(end))?;
                        s.bind(base, previous);
                        Ok(())
                    },
                )?;
                s.branch(
                    more,
                    &[top, base, end],
                    |s| {
                        let slot = s.binary(BinOp::Mul, s.var(top), two);
                        let power_slot = s.offset(slot, 1);
                        s.put(stack, slot, s.var(base));
                        s.put(stack, power_slot, s.var(power));
                        s.advance(top, 1);
                        s.bind(base, s.var(end));
                        s.bind(end, s.var(next));
                        Ok(())
                    },
                    |_| Ok(()),
                )
            },
        )
    }

    fn copy(
        &mut self,
        source: ValueId,
        from: ValueId,
        target: ValueId,
        to: ValueId,
        n: ValueId,
    ) -> Built {
        let zero = self.int(0);
        let at = self.variable(zero);
        self.loop_while(
            &[at],
            |s| s.binary(BinOp::Lt, s.var(at), n),
            |s| {
                let read = s.binary(BinOp::Add, from, s.var(at));
                let write = s.binary(BinOp::Add, to, s.var(at));
                let value = s.get(source, read);
                s.put(target, write, value);
                s.advance(at, 1);
                Ok(())
            },
        )
    }

    fn merge(
        &mut self,
        scratch: ValueId,
        stack: ValueId,
        base: ValueId,
        middle: ValueId,
        end: ValueId,
    ) -> Built {
        let last = self.offset(middle, -1);
        let disorder = self.greater_at((self.order, last), (self.order, middle))?;
        self.branch(
            disorder,
            &[],
            |s| {
                let left = s.binary(BinOp::Sub, middle, base);
                let right = s.binary(BinOp::Sub, end, middle);
                let lower = s.binary(BinOp::Le, left, right);
                s.branch(
                    lower,
                    &[],
                    |s| s.merge_direction(scratch, stack, base, middle, end, true),
                    |s| s.merge_direction(scratch, stack, base, middle, end, false),
                )
            },
            |_| Ok(()),
        )
    }

    /// One lowering for the two stable merge directions. Forward takes equal
    /// left elements first; backward takes equal right elements last.
    #[expect(clippy::too_many_lines, reason = "one stable merge in two directions")]
    fn merge_direction(
        &mut self,
        scratch: ValueId,
        stack: ValueId,
        base: ValueId,
        middle: ValueId,
        end: ValueId,
        low: bool,
    ) -> Built {
        let zero = self.int(0);
        let (n, from) = if low {
            (self.binary(BinOp::Sub, middle, base), base)
        } else {
            (self.binary(BinOp::Sub, end, middle), middle)
        };
        self.copy(self.order, from, scratch, zero, n)?;
        let stride = if low { 1 } else { -1 };
        let (first, second) = if low {
            (scratch, self.order)
        } else {
            (self.order, scratch)
        };
        let (a, b, out, stop_a, stop_b) = if low {
            (zero, middle, base, n, end)
        } else {
            (middle, n, end, base, zero)
        };
        let a = self.variable(a);
        let b = self.variable(b);
        let out = self.variable(out);
        let wins_a = self.variable(zero);
        let wins_b = self.variable(zero);
        // The power stack's extra slot retains min-gallop across merges.
        let threshold_slot = self.int(66);
        let remembered = self.get_index(stack, threshold_slot);
        let threshold = self.variable(remembered);
        let names = [a, b, out, wins_a, wins_b, threshold];
        self.loop_while(
            &names,
            |s| s.both_present(a, stop_a, b, stop_b),
            |s| {
                let first_at = s.position(s.var(a), zero, low);
                let second_at = s.position(s.var(b), zero, low);
                let first_item = s.get(first, first_at);
                let second_item = s.get(second, second_at);
                let output_at = s.position(s.var(out), zero, low);
                let greater = s.greater(first_item, second_item)?;
                let take_a = if low {
                    let no = s.boolean(false);
                    s.binary(BinOp::Eq, greater, no)
                } else {
                    greater
                };
                s.branch(
                    take_a,
                    &[a, b, wins_a, wins_b],
                    |s| {
                        s.put(s.order, output_at, first_item);
                        s.advance(a, stride);
                        s.advance(wins_a, 1);
                        s.bind(wins_b, zero);
                        Ok(())
                    },
                    |s| {
                        s.put(s.order, output_at, second_item);
                        s.advance(b, stride);
                        s.advance(wins_b, 1);
                        s.bind(wins_a, zero);
                        Ok(())
                    },
                )?;
                s.advance(out, stride);
                // Taking one side resets the other's streak, so one is zero.
                // The usual galloping OR test needs no max comparison/select.
                let streak = s.binary(BinOp::BitOr, s.var(wins_a), s.var(wins_b));
                let ready = s.binary(BinOp::Ge, streak, s.var(threshold));
                let no = s.boolean(false);
                let gallop = s.variable(no);
                s.branch(
                    ready,
                    &[gallop],
                    |s| {
                        let present = s.both_present(a, stop_a, b, stop_b);
                        s.bind(gallop, present);
                        Ok(())
                    },
                    |_| Ok(()),
                )?;
                let gallop = s.var(gallop);
                s.branch(
                    gallop,
                    &names,
                    |s| {
                        let first_won = s.binary(BinOp::Gt, s.var(wins_a), zero);
                        s.branch(
                            first_won,
                            &[a, b, out, threshold],
                            |s| {
                                s.merge_gallop(
                                    (first, a, stop_a),
                                    (second, b),
                                    out,
                                    threshold,
                                    low,
                                    true,
                                )
                            },
                            |s| {
                                s.merge_gallop(
                                    (second, b, stop_b),
                                    (first, a),
                                    out,
                                    threshold,
                                    low,
                                    false,
                                )
                            },
                        )?;
                        s.bind(wins_a, zero);
                        s.bind(wins_b, zero);
                        Ok(())
                    },
                    |_| Ok(()),
                )
            },
        )?;
        self.put(stack, threshold_slot, self.var(threshold));
        if low {
            let remaining = self.binary(BinOp::Sub, n, self.var(a));
            self.copy(scratch, self.var(a), self.order, self.var(out), remaining)
        } else {
            let remaining = self.var(b);
            let begin = self.binary(BinOp::Sub, self.var(out), self.var(b));
            self.copy(scratch, zero, self.order, begin, remaining)
        }
    }

    fn both_present(&mut self, a: u32, stop_a: ValueId, b: u32, stop_b: ValueId) -> ValueId {
        let first = self.binary(BinOp::Ne, self.var(a), stop_a);
        let second = self.binary(BinOp::Ne, self.var(b), stop_b);
        self.b.bool_join(first, second, false, &self.origin)
    }

    fn merge_gallop(
        &mut self,
        (source, cursor, boundary): (ValueId, u32, ValueId),
        (other, other_cursor): (ValueId, u32),
        out: u32,
        threshold: u32,
        low: bool,
        first: bool,
    ) -> Built {
        let zero = self.int(0);
        let pivot_at = self.position(self.var(other_cursor), zero, low);
        let pivot = self.get(other, pivot_at);
        let available = if low {
            self.binary(BinOp::Sub, boundary, self.var(cursor))
        } else {
            self.binary(BinOp::Sub, self.var(cursor), boundary)
        };
        let n = self.gallop(source, self.var(cursor), available, pivot, low, first)?;
        let at = self.variable(zero);
        self.loop_while(
            &[at],
            |s| s.binary(BinOp::Lt, s.var(at), n),
            |s| {
                let from = s.position(s.var(cursor), s.var(at), low);
                let to = s.position(s.var(out), s.var(at), low);
                let item = s.get(source, from);
                s.put(s.order, to, item);
                s.advance(at, 1);
                Ok(())
            },
        )?;
        let movement = if low { BinOp::Add } else { BinOp::Sub };
        let next = self.binary(movement, self.var(cursor), n);
        self.bind(cursor, next);
        let next = self.binary(movement, self.var(out), n);
        self.bind(out, next);
        let seven = self.int(7);
        let productive = self.binary(BinOp::Ge, n, seven);
        self.branch(
            productive,
            &[threshold],
            |s| {
                let lower = s.offset(s.var(threshold), -1);
                let one = s.int(1);
                let lower = s.binary(BinOp::Max, lower, one);
                s.bind(threshold, lower);
                Ok(())
            },
            |s| {
                s.advance(threshold, 1);
                Ok(())
            },
        )
    }

    /// Exponential probes bracket the first losing element, then binary search
    /// completes the bound. Every probe is a borrowed original element and
    /// every cursor stays inside the unconsumed run, even for an inconsistent
    /// comparator. The strictness is the merge's stability rule in its direction.
    fn gallop(
        &mut self,
        source: ValueId,
        start: ValueId,
        n: ValueId,
        pivot: ValueId,
        low: bool,
        first: bool,
    ) -> Built<ValueId> {
        let zero = self.int(0);
        let left = self.variable(zero);
        let right = self.variable(n);
        let one = self.int(1);
        let probe = self.variable(one);
        let yes = self.boolean(true);
        let open = self.variable(yes);
        self.loop_while(
            &[left, right, probe, open],
            |s| s.var(open),
            |s| {
                let count = s.binary(BinOp::Min, s.var(probe), n);
                let at = s.offset(count, -1);
                let win = s.gallop_wins((source, start, at), pivot, low, first)?;
                s.branch(
                    win,
                    &[left, right, probe, open],
                    |s| {
                        s.bind(left, count);
                        let more = s.binary(BinOp::Lt, count, n);
                        s.bind(open, more);
                        let next = bounded_advance(count, count, n, |op, a, b| s.binary(op, a, b));
                        s.bind(probe, next);
                        Ok(())
                    },
                    |s| {
                        let bound = s.offset(count, -1);
                        s.bind(right, bound);
                        let no = s.boolean(false);
                        s.bind(open, no);
                        Ok(())
                    },
                )
            },
        )?;
        self.loop_while(
            &[left, right],
            |s| s.binary(BinOp::Lt, s.var(left), s.var(right)),
            |s| {
                let span = s.binary(BinOp::Sub, s.var(right), s.var(left));
                // The bracket is a nonnegative span below 2^32.
                let one = s.int(1);
                let half = s.binary(BinOp::UShr, span, one);
                let mid = s.binary(BinOp::Add, s.var(left), half);
                let win = s.gallop_wins((source, start, mid), pivot, low, first)?;
                s.branch(
                    win,
                    &[left, right],
                    |s| {
                        let next = s.offset(mid, 1);
                        s.bind(left, next);
                        Ok(())
                    },
                    |s| {
                        s.bind(right, mid);
                        Ok(())
                    },
                )
            },
        )?;
        Ok(self.var(left))
    }

    fn gallop_wins(
        &mut self,
        (source, start, at): (ValueId, ValueId, ValueId),
        pivot: ValueId,
        low: bool,
        first: bool,
    ) -> Built<ValueId> {
        let at = self.position(start, at, low);
        let item = self.get(source, at);
        let greater = if first {
            self.greater(item, pivot)?
        } else {
            self.greater(pivot, item)?
        };
        Ok(if first == low {
            let no = self.boolean(false);
            self.binary(BinOp::Eq, greater, no)
        } else {
            greater
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::{BinOp, bounded_advance, doubled_midpoints, run_position};

    fn checked_cursor(op: BinOp, a: u32, b: u32) -> u32 {
        match op {
            BinOp::Add => a.checked_add(b).expect("cursor addition fits u32"),
            BinOp::Sub => a
                .checked_sub(b)
                .expect("cursor subtraction stays nonnegative"),
            BinOp::Min => a.min(b),
            _ => unreachable!("cursor proof only uses add, sub and min"),
        }
    }

    #[test]
    fn emitted_cursor_bounds_cover_both_javascript_length_boundaries() {
        // Execute the production arithmetic emitters with checked u32
        // operations. These are scalar proof controls, with no element buffer
        // allocation, including at lengths the current dense runtime refuses.
        for n in [
            0,
            1,
            2,
            63,
            64,
            65,
            (1 << 31) - 2,
            (1 << 31) - 1,
            1 << 31,
            (1 << 31) + 1,
            u32::MAX - 1,
            u32::MAX,
        ] {
            for start in [0, n / 2, n.saturating_sub(65), n.saturating_sub(1), n] {
                for step in [0, 1, 2, 32, 64, n / 2, n] {
                    let end = bounded_advance(start, step, n, checked_cursor);
                    let exact = (u64::from(start) + u64::from(step)).min(u64::from(n));
                    assert_eq!(u64::from(end), exact, "minrun at {start}/{n}, step {step}");
                    assert!((start..=n).contains(&end));
                }
                let probe = bounded_advance(start, start, n, checked_cursor);
                assert_eq!(u64::from(probe), (2 * u64::from(start)).min(u64::from(n)));
            }
            if n == 0 {
                continue;
            }
            for at in [0, n / 2, n - 1] {
                assert_eq!(run_position(0, at, 1, true, checked_cursor), at);
                assert_eq!(run_position(n, at, 1, false, checked_cursor), n - 1 - at);
            }
            // The final active forward cursor advances to the exclusive end,
            // never past it; backward cursors stop at zero, not u32::MAX.
            assert_eq!(checked_cursor(BinOp::Add, n - 1, 1), n);
            assert_eq!(checked_cursor(BinOp::Sub, 1, 1), 0);
        }
    }

    #[test]
    fn emitted_midpoints_and_power_stack_cover_u32_maximum_length() {
        for n in [2_u32, 65, (1 << 31) - 1, 1 << 31, u32::MAX - 1, u32::MAX] {
            let n = u64::from(n);
            for (start, middle, end) in [(0, 1, n), (0, n / 2, n), (n - 2, n - 1, n)] {
                let (mut a, mut b) = doubled_midpoints(start, middle, end, |op, x, y| {
                    assert_eq!(op, BinOp::Add);
                    x.checked_add(y).expect("doubled midpoint fits i64")
                });
                let mut power = 0;
                loop {
                    power += 1;
                    let different = if a >= n {
                        a -= n;
                        b -= n;
                        false
                    } else {
                        b >= n
                    };
                    a = a.checked_mul(2).expect("power scaling fits i64");
                    b = b.checked_mul(2).expect("power scaling fits i64");
                    assert!(a < 4 * n && b < 4 * n);
                    assert!(power <= 32, "first differing digit within u32 domain");
                    if different {
                        break;
                    }
                }
                // 32 positive powers plus the zero-power sentinel use 66
                // u32 slots; slot 66 is exclusively the galloping threshold.
                assert!(2 * (power + 1) <= 66);
            }
        }
    }
}

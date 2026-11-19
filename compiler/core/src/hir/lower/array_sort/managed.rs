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
const INDEX: HirType = HirType::Int {
    bits: 64,
    signed: true,
};
const SLOT: HirType = HirType::Int {
    bits: 32,
    signed: false,
};

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
    fn int(&mut self, n: i64) -> ValueId {
        self.push(OpKind::ConstInt(i128::from(n)), INDEX)
    }
    fn boolean(&mut self, n: bool) -> ValueId {
        self.push(OpKind::ConstBool(n), HirType::Bool)
    }
    fn binary(&mut self, op: BinOp, lhs: ValueId, rhs: ValueId) -> ValueId {
        let ty = if op.is_comparison() {
            HirType::Bool
        } else {
            INDEX
        };
        self.push(OpKind::Binary { op, lhs, rhs }, ty)
    }
    fn offset(&mut self, value: ValueId, by: i64) -> ValueId {
        let by = self.int(by);
        self.binary(BinOp::Add, value, by)
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
    fn advance(&mut self, name: u32, by: i64) {
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

    /// `TimSort`'s minimum run in [32,64], or the whole input below 64. The
    /// remainder bit avoids a final tiny run just above a power of two.
    fn minrun(&mut self) -> Built<ValueId> {
        let n = self.variable(self.length);
        let zero = self.int(0);
        let remainder = self.variable(zero);
        self.loop_while(
            &[n, remainder],
            |s| {
                let limit = s.int(64);
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
                let descending = s.greater_at((s.order, start), (s.order, next))?;
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
                        let less = s.greater_at((s.order, previous), (s.order, s.var(end)))?;
                        let same = s.binary(BinOp::Eq, less, descending);
                        s.branch(
                            same,
                            &[end, open],
                            |s| {
                                s.advance(end, 1);
                                Ok(())
                            },
                            |s| {
                                let no = s.boolean(false);
                                s.bind(open, no);
                                Ok(())
                            },
                        )
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
        let minimum_end = self.binary(BinOp::Add, start, minrun);
        let minimum_end = self.binary(BinOp::Min, minimum_end, self.length);
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
                let pivot = s.get(s.order, s.var(at));
                let low = s.variable(start);
                let high = s.variable(s.var(at));
                s.loop_while(
                    &[low, high],
                    |s| s.binary(BinOp::Lt, s.var(low), s.var(high)),
                    |s| {
                        let span = s.binary(BinOp::Sub, s.var(high), s.var(low));
                        let two = s.int(2);
                        let half = s.binary(BinOp::Div, span, two);
                        let middle = s.binary(BinOp::Add, s.var(low), half);
                        let item = s.get(s.order, middle);
                        let after = s.greater(item, pivot)?;
                        s.branch(
                            after,
                            &[low, high],
                            |s| {
                                s.bind(high, middle);
                                Ok(())
                            },
                            |s| {
                                let next = s.offset(middle, 1);
                                s.bind(low, next);
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
        let a = self.binary(BinOp::Add, start, middle);
        let b = self.binary(BinOp::Add, middle, end);
        let a = self.variable(a);
        let b = self.variable(b);
        let zero = self.int(0);
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
                let both = s.binary(BinOp::Ge, s.var(a), s.length);
                s.branch(
                    both,
                    &[a, b, done],
                    |s| {
                        let next_a = s.binary(BinOp::Sub, s.var(a), s.length);
                        let next_b = s.binary(BinOp::Sub, s.var(b), s.length);
                        s.bind(a, next_a);
                        s.bind(b, next_b);
                        Ok(())
                    },
                    |s| {
                        let different = s.binary(BinOp::Ge, s.var(b), s.length);
                        s.bind(done, different);
                        Ok(())
                    },
                )?;
                let two = s.int(2);
                let next_a = s.binary(BinOp::Mul, s.var(a), two);
                let next_b = s.binary(BinOp::Mul, s.var(b), two);
                s.bind(a, next_a);
                s.bind(b, next_b);
                Ok(())
            },
        )?;
        Ok(self.var(power))
    }

    /// Stack powers increase strictly. A runtime array has length below 2^31,
    /// so powers are at most 31 and 32 rows (base,power) suffice. All cursors
    /// and doubled midpoints are nonnegative and below 4*N < 2^33; int64 is
    /// exact even on the terminating power-loop iteration. The scratch holds
    /// only the smaller run, at most floor(N/2) uint32 indices.
    fn merge_runs(&mut self, first_end: ValueId, minrun: ValueId) -> Built {
        let two = self.int(2);
        let capacity = self.binary(BinOp::Div, self.length, two);
        let scratch = self.allocate(capacity);
        let capacity = self.int(64);
        let stack = self.allocate(capacity);
        let zero = self.int(0);
        let top = self.variable(zero);
        let base = self.variable(zero);
        let end = self.variable(first_end);
        self.loop_while(
            &[top, base, end],
            |s| s.binary(BinOp::Lt, s.var(end), s.length),
            |s| {
                let next = s.next_run(s.var(end), minrun)?;
                let power = s.power(s.var(base), s.var(end), next)?;
                let yes = s.boolean(true);
                let open = s.variable(yes);
                s.loop_while(
                    &[top, base, open],
                    |s| {
                        let zero = s.int(0);
                        let nonempty = s.binary(BinOp::Gt, s.var(top), zero);
                        s.b.bool_join(nonempty, s.var(open), false, &s.origin)
                    },
                    |s| {
                        let row = s.offset(s.var(top), -1);
                        let two = s.int(2);
                        let slot = s.binary(BinOp::Mul, row, two);
                        let power_slot = s.offset(slot, 1);
                        let previous_power = s.get_index(stack, power_slot);
                        let deeper = s.binary(BinOp::Gt, previous_power, power);
                        s.branch(
                            deeper,
                            &[top, base, open],
                            |s| {
                                let previous = s.get_index(stack, slot);
                                s.merge(scratch, previous, s.var(base), s.var(end))?;
                                s.bind(base, previous);
                                s.bind(top, row);
                                Ok(())
                            },
                            |s| {
                                let no = s.boolean(false);
                                s.bind(open, no);
                                Ok(())
                            },
                        )
                    },
                )?;
                let two = s.int(2);
                let slot = s.binary(BinOp::Mul, s.var(top), two);
                let power_slot = s.offset(slot, 1);
                s.put(stack, slot, s.var(base));
                s.put(stack, power_slot, power);
                s.advance(top, 1);
                s.bind(base, s.var(end));
                s.bind(end, next);
                Ok(())
            },
        )?;
        self.loop_while(
            &[top, base],
            |s| {
                let zero = s.int(0);
                s.binary(BinOp::Gt, s.var(top), zero)
            },
            |s| {
                s.advance(top, -1);
                let two = s.int(2);
                let slot = s.binary(BinOp::Mul, s.var(top), two);
                let previous = s.get_index(stack, slot);
                s.merge(scratch, previous, s.var(base), s.var(end))?;
                s.bind(base, previous);
                Ok(())
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

    fn merge(&mut self, scratch: ValueId, base: ValueId, middle: ValueId, end: ValueId) -> Built {
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
                    |s| s.merge_low(scratch, base, middle, end),
                    |s| s.merge_high(scratch, base, middle, end),
                )
            },
            |_| Ok(()),
        )
    }

    fn merge_low(
        &mut self,
        scratch: ValueId,
        base: ValueId,
        middle: ValueId,
        end: ValueId,
    ) -> Built {
        let n = self.binary(BinOp::Sub, middle, base);
        let zero = self.int(0);
        self.copy(self.order, base, scratch, zero, n)?;
        let left = self.variable(zero);
        let right = self.variable(middle);
        let into = self.variable(base);
        self.loop_while(
            &[left, right, into],
            |s| {
                let a = s.binary(BinOp::Lt, s.var(left), n);
                let b = s.binary(BinOp::Lt, s.var(right), end);
                s.b.bool_join(a, b, false, &s.origin)
            },
            |s| {
                let a = s.get(scratch, s.var(left));
                let b = s.get(s.order, s.var(right));
                let right_first = s.greater(a, b)?;
                s.branch(
                    right_first,
                    &[left, right],
                    |s| {
                        s.put(s.order, s.var(into), b);
                        s.advance(right, 1);
                        Ok(())
                    },
                    |s| {
                        s.put(s.order, s.var(into), a);
                        s.advance(left, 1);
                        Ok(())
                    },
                )?;
                s.advance(into, 1);
                Ok(())
            },
        )?;
        let remaining = self.binary(BinOp::Sub, n, self.var(left));
        self.copy(
            scratch,
            self.var(left),
            self.order,
            self.var(into),
            remaining,
        )
    }

    fn merge_high(
        &mut self,
        scratch: ValueId,
        base: ValueId,
        middle: ValueId,
        end: ValueId,
    ) -> Built {
        let n = self.binary(BinOp::Sub, end, middle);
        let zero = self.int(0);
        self.copy(self.order, middle, scratch, zero, n)?;
        let last_left = self.offset(middle, -1);
        let last_right = self.offset(n, -1);
        let last_out = self.offset(end, -1);
        let left = self.variable(last_left);
        let right = self.variable(last_right);
        let into = self.variable(last_out);
        self.loop_while(
            &[left, right, into],
            |s| {
                let a = s.binary(BinOp::Ge, s.var(left), base);
                let b = s.binary(BinOp::Ge, s.var(right), zero);
                s.b.bool_join(a, b, false, &s.origin)
            },
            |s| {
                let a = s.get(s.order, s.var(left));
                let b = s.get(scratch, s.var(right));
                let left_last = s.greater(a, b)?;
                // Equal right elements go later: the mirror of left-first merge_low.
                s.branch(
                    left_last,
                    &[left, right],
                    |s| {
                        s.put(s.order, s.var(into), a);
                        s.advance(left, -1);
                        Ok(())
                    },
                    |s| {
                        s.put(s.order, s.var(into), b);
                        s.advance(right, -1);
                        Ok(())
                    },
                )?;
                s.advance(into, -1);
                Ok(())
            },
        )?;
        let remaining = self.offset(self.var(right), 1);
        let begin = self.binary(BinOp::Sub, self.var(into), self.var(right));
        self.copy(scratch, zero, self.order, begin, remaining)
    }
}

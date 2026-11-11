//! Lower callback-driven collection traversals, including callback binding, result delivery, reduction, and early exit.

use super::{
    ArrayFill, BinOp, Counts, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind,
    Origin, Step, Terminator, ValueId, absent_argument, counted_helper, holds_counted, syntax,
};

/// Whose built-in method a call is, where one name means two things:
/// `lastIndexOf` is an array's and a string's, and they disagree about
/// `undefined`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum MethodsOf {
    Array,
    String,
}

/// Which end of the array a walk starts from.
///
/// `findLast`, `findLastIndex` and `reduceRight` are `find`, `findIndex` and
/// `reduce` **walking the other way and nothing else**: same callback shape,
/// same delivery, same result, same seed. A variant of [`Iteration`] apiece
/// would have made every match on it three arms longer to say that they are not
/// different.
///
/// So the loop reads this in exactly three places -- where the cursor starts,
/// what stops it, and how it moves -- and everything else is blind to it, which
/// is the claim being made.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Direction {
    Forward,
    Backward,
}

/// The names one iteration of a compiled array method binds.
#[derive(Clone, Copy)]
struct StepNames {
    /// The synthetic cursor the loop carries.
    index: u32,
    /// The callback's element parameter.
    element: u32,
    /// Its index parameter, where the callback took one.
    position: Option<u32>,
    /// A fold's accumulator and the callback's name for it.
    fold: Option<(u32, u32)>,
}

/// Where a fold's cursor begins.
///
/// Two booleans about one question -- which element the accumulator starts as
/// and which end the walk runs from -- so they travel together rather than as
/// two positional flags a caller can swap.
#[derive(Clone, Copy)]
struct ReduceStart {
    /// No initial value was written, so the outermost element *becomes* the
    /// accumulator and the walk starts one step in from it.
    from_first: bool,
    backwards: bool,
}

/// An array method compiled as a loop.
#[derive(Clone, Copy)]
pub(super) struct Walked {
    kind: Iteration,
    direction: Direction,
    /// What the source called it. `findLast` is `find` reversed, and a
    /// diagnostic saying `find` would send a reader to a call they did not
    /// write.
    method: &'static str,
}

pub(super) fn iteration_method(name: &str) -> Option<Walked> {
    let (kind, direction, method) = match name {
        "forEach" => (Iteration::ForEach, Direction::Forward, "forEach"),
        "map" => (Iteration::Map, Direction::Forward, "map"),
        "reduce" => (Iteration::Reduce, Direction::Forward, "reduce"),
        "reduceRight" => (Iteration::Reduce, Direction::Backward, "reduceRight"),
        "some" => (Iteration::Any, Direction::Forward, "some"),
        "every" => (Iteration::All, Direction::Forward, "every"),
        "findIndex" => (Iteration::FindIndex, Direction::Forward, "findIndex"),
        "findLastIndex" => (Iteration::FindIndex, Direction::Backward, "findLastIndex"),
        "filter" => (Iteration::Filter, Direction::Forward, "filter"),
        "find" => (Iteration::Find, Direction::Forward, "find"),
        "findLast" => (Iteration::Find, Direction::Backward, "findLast"),
        _ => return None,
    };
    Some(Walked {
        kind,
        direction,
        method,
    })
}

/// An array method that is a loop with the callback's body inlined.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Iteration {
    ForEach,
    Map,
    Reduce,
    /// `some`. Spelled `Any` because `Some` is taken by the language.
    Any,
    /// `every`.
    All,
    /// `findIndex`.
    FindIndex,
    /// `filter`.
    Filter,
    /// `find`.
    Find,
}

impl Iteration {
    /// How many callback parameters this lowering binds.
    ///
    /// The index and the array are the ones every callback of these *may*
    /// take, and neither is bound: the index would need the loop counter's
    /// identity to survive into the body, and this has no test for that yet.
    const fn parameters(self) -> usize {
        match self {
            Self::ForEach
            | Self::Map
            | Self::Any
            | Self::All
            | Self::FindIndex
            | Self::Filter
            | Self::Find => 1,
            Self::Reduce => 2,
        }
    }
}

/// What becomes of the value an inlined callback body produces.
///
/// A return inside a block delivers through this policy before it jumps to
/// the iteration's latch, as a concise callback's value does.
#[derive(Clone, Copy)]
pub(super) enum CallbackResult {
    /// `forEach`, whose callback returns `void`. TypeScript still allows
    /// `return e` there, contextually typed as void, so the value is lowered
    /// for its effects and then dropped rather than refused.
    Discard,
    /// `reduce`: it becomes the accumulator, which the loop carries.
    Accumulate(u32),
    /// `map`: it is stored at the current index of the array allocated before
    /// the loop.
    Store { array: ValueId, index: u32 },
    /// `Array.from` maps during its source walk. The private output's length
    /// before the callback is its dense index; the append policy grows it.
    Append { array: ValueId, index: ValueId },
    /// `some` and `every`: it decides whether to stop.
    ///
    /// Both are the same loop asking the same question and differ only in
    /// which answer ends it -- `some` stops at the first `true` and is `false`
    /// if it never does, `every` stops at the first `false` and is `true`. So
    /// `exits_on` is both the value that breaks and the value the result takes
    /// when it breaks, and the seed is its negation.
    Decide { symbol: u32, exits_on: bool },
    /// `findIndex`: the index the first `true` was reached at.
    ///
    /// The seed is `-1`, which is the answer for an array that never decides
    /// and is what the method returns for one -- so the loop-carried name needs
    /// no separate "was it found" beside it.
    Locate { symbol: u32, index: u32 },
    /// `filter`: the element is kept when the value is true.
    ///
    /// `element` is the value itself rather than the name bound to it. A
    /// callback may assign to its own parameter, and `filter` keeps what the
    /// array held either way.
    ///
    /// `push` because the result is allocated with room and no length -- see
    /// [`FuncBuilder::iteration_result_array`] -- so appending is what writing
    /// a kept element *is*, and the count the two paths would otherwise
    /// disagree about lives in the array instead.
    Keep {
        array: ValueId,
        element: ValueId,
        push: &'static str,
    },
}

/// Where a `return` inside an inlined callback body goes.
#[derive(Clone, Copy)]
pub(super) struct CallbackReturn {
    /// The synthesized loop, as a depth into `breakables`. A `return` leaves
    /// the *iteration*, which is what `continue` does, so it goes to the latch.
    pub(super) depth: usize,
    /// What the method does with the value.
    pub(super) result: CallbackResult,
}

impl FuncBuilder<'_> {
    /// The trailing arguments an array method's call owes the runtime: each
    /// the number [`absent_argument`] says.
    pub(super) fn fill_array_arguments(
        &mut self,
        (id, method): (NodeId, &str),
        arity: usize,
        args: &mut Vec<ValueId>,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let given = args.len() - 1;
        while args.len() < arity + 1 {
            let value = absent_argument(method, args.len(), given)
                .map_err(|why| self.unsupported(id, why))?;
            let absent = self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin.clone());
            args.push(absent);
        }
        Ok(())
    }

    /// The trailing arguments a string method's call owes the runtime.
    ///
    /// `padStart(n)` and `padEnd(n)` pad with a single space, and every other
    /// omitted argument is the number [`absent_argument`] says. Passing them
    /// explicitly means the runtime has one signature rather than two and the
    /// default is written down once.
    pub(super) fn fill_string_arguments(
        &mut self,
        (id, method): (NodeId, &str),
        helper: &str,
        arity: usize,
        args: &mut Vec<ValueId>,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let given = args.len() - 1;
        while args.len() < arity + 1 {
            let position = args.len();
            if matches!(helper, "nts_str_pad_start" | "nts_str_pad_end") && position == 2 {
                let space = self.push(
                    OpKind::ConstString(" ".into()),
                    HirType::Managed(ManagedType::String),
                    origin.clone(),
                );
                args.push(space);
                continue;
            }
            let value = absent_argument(method, position, given)
                .map_err(|why| self.unsupported(id, why))?;
            let absent = self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin.clone());
            args.push(absent);
        }
        if args.len() != arity + 1 {
            return Err(self.unsupported(id, "a string method with this many arguments"));
        }
        Ok(())
    }

    /// The callback a compiled array method takes, and its seed where it has
    /// one.
    ///
    /// **`reduce` with no initial value is in the one-argument list**, which is
    /// not obvious: it starts from the first element and throws on an empty
    /// array, so it is a different loop and a different failure. But the
    /// difference is made in [`Self::lower_iteration`], where the loop is built
    /// — here it is one more kind arriving with a callback and no seed, and
    /// saying so twice would be two arms with one body.
    pub(super) fn iteration_arguments(
        &self,
        id: NodeId,
        name: &str,
        walked: Walked,
        arguments: &[NodeId],
    ) -> Result<(NodeId, Option<NodeId>), Diagnostic> {
        match (walked.kind, arguments) {
            (Iteration::Reduce, [callback, seed]) => Ok((*callback, Some(*seed))),
            (
                Iteration::ForEach
                | Iteration::Map
                | Iteration::Any
                | Iteration::All
                | Iteration::FindIndex
                | Iteration::Filter
                | Iteration::Find
                | Iteration::Reduce,
                [callback],
            ) => Ok((*callback, None)),
            _ => Err(self.unsupported(id, &format!("a `{name}` call with this many arguments"))),
        }
    }

    /// An array method whose callback is an arrow written at the call site.
    ///
    /// # Why a desugaring rather than a call
    ///
    /// Compiled as a closure it would allocate an object, pass it to a runtime
    /// helper, and dispatch through a slot once per element. Every one of those
    /// is machinery for a question the source has already answered: which body
    /// runs is written right there.
    ///
    /// Compiled as a loop it is [`Self::lower_for_of`] with the element name
    /// coming from the arrow's parameter instead of from a binding form, and it
    /// costs exactly what the hand-written loop costs.
    ///
    /// # What it also fixes
    ///
    /// `collect_closures` refuses to capture a variable something *assigns* to,
    /// because this compiler captures by value and JavaScript captures by
    /// reference. So the shape Are We Fast Yet's nbody uses --
    ///
    /// ```text
    /// bodies.forEach((b) => { px += b.vx * b.mass; });
    /// ```
    ///
    /// -- could not be compiled at all. Inlined there is no capture: `px` is an
    /// ordinary local the loop body assigns, and the loop carries it the way it
    /// carries any other. The refusal is right about closures and simply does
    /// not apply.
    ///
    /// Only for an arrow written at the call site. `xs.forEach(f)` where `f` is
    /// a variable is a genuine dispatch, and monomorphization is the answer to
    /// that one.
    ///
    /// # What the three have in common
    ///
    /// All of it except what happens to the value the body produces, which is
    /// [`CallbackResult`]: dropped, stored at the same index of a new array, or
    /// carried to the next iteration. That difference is the whole of `forEach`
    /// against `map` against `reduce`, and putting it in one place is what
    /// makes a `return` inside the body work the same in all three -- it has to
    /// deliver the value before it jumps, and there is one function that knows
    /// how.
    /// Where an iteration begins, and what its accumulator starts as.
    ///
    /// `(0, the seed)` for every kind but one. `reduce` with **no** initial
    /// value takes the first element as the accumulator and walks from the
    /// second, and raises where there is no first — so it is the same loop
    /// started one along, and these are the only three things that differ.
    ///
    /// The seed is read with the same `ArrayGet` the body reads every other
    /// element with, so the accumulator's first value and its later ones cannot
    /// disagree about what an element is.
    /// Bind what one iteration gives the callback: the element, the position
    /// where the callback asked for one, and the accumulator where there is
    /// one. Returns the element, which the delivery also needs.
    ///
    /// The position is the **same value** the element was just read with, so
    /// the body sees the index it is looking at rather than a second count that
    /// could drift from it. The refusal this replaced said the index "would
    /// need the loop counter's identity to survive into the body, and this has
    /// no test for that yet"; it survives, because `at` is read from the
    /// bindings *inside* the body block, after `begin_loop` has made the
    /// carried names block parameters.
    fn bind_step(
        &mut self,
        receiver: ValueId,
        element_ty: &HirType,
        names: StepNames,
        origin: &Origin,
    ) -> ValueId {
        let at = self.bindings[&names.index];
        let value = self.push(
            OpKind::ArrayGet {
                array: receiver,
                index: at,
                checked: true,
            },
            element_ty.clone(),
            origin.clone(),
        );
        self.bindings.insert(names.element, value);
        if let Some(position) = names.position {
            self.bindings.insert(position, at);
        }
        if let Some((accumulator, name)) = names.fold {
            self.bindings.insert(name, self.bindings[&accumulator]);
        }
        value
    }

    /// Whether a counted walk has an element left, from whichever end it runs.
    ///
    /// Forwards the cursor stops at the length; backwards it stops below zero.
    /// `Ge` against a fresh zero rather than `Gt` against minus one, because the
    /// second spells the same test in the constant that also means "not found"
    /// three functions down, and a reader meeting `-1` in this file should find
    /// one meaning for it.
    fn still_walking(
        &mut self,
        at: ValueId,
        length: ValueId,
        backwards: bool,
        origin: &Origin,
    ) -> ValueId {
        let (op, limit) = if backwards {
            (
                BinOp::Ge,
                self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone()),
            )
        } else {
            (BinOp::Lt, length)
        };
        self.push(
            OpKind::Binary {
                op,
                lhs: at,
                rhs: limit,
            },
            HirType::Bool,
            origin.clone(),
        )
    }

    fn reduce_start(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        element_ty: &HirType,
        length: ValueId,
        seed: Option<ValueId>,
        start: ReduceStart,
    ) -> Result<(ValueId, Option<ValueId>), Diagnostic> {
        let ReduceStart {
            from_first,
            backwards,
        } = start;
        let origin = self.origin(id);
        // The end the walk begins at: the first element going forwards, the last
        // going back. `reduceRight` starting anywhere else is the whole of what
        // makes it a different answer rather than a different spelling.
        let outermost = |lower: &mut Self| {
            if backwards {
                let one = lower.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
                lower.push(
                    OpKind::Binary {
                        op: BinOp::Sub,
                        lhs: length,
                        rhs: one,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                )
            } else {
                lower.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone())
            }
        };
        if !from_first {
            let start = outermost(self);
            return Ok((start, seed));
        }
        self.guard_reduce_has_elements(id, length, &origin)?;
        let edge = outermost(self);
        let first = self.push(
            OpKind::ArrayGet {
                array: receiver,
                index: edge,
                checked: true,
            },
            element_ty.clone(),
            origin.clone(),
        );
        // One step in from the element that became the accumulator.
        let step = self.push(
            OpKind::ConstFloat(if backwards { -1.0 } else { 1.0 }),
            HirType::NUMBER,
            origin.clone(),
        );
        let next = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: edge,
                rhs: step,
            },
            HirType::NUMBER,
            origin,
        );
        Ok((next, Some(first)))
    }

    pub(super) fn lower_iteration(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        element_ty: &HirType,
        callback: NodeId,
        walked: Walked,
        seed: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let Walked {
            kind,
            direction,
            method,
        } = walked;
        let backwards = direction == Direction::Backward;
        if !self.inlines_as_a_callback(callback) {
            return Err(self.unsupported(
                callback,
                &format!(
                    "a `{method}` callback that reads its own `this`, whose body is not inlined"
                ),
            ));
        }
        let (parameters, body) = self.callback_shape(callback, kind, method)?;
        let names = parameters.as_slice();
        // Where the element is, which is not "the last one" once an index may
        // follow it. `reduce` takes the accumulator first, everything else
        // takes the element first, and the index -- when the callback asks for
        // one -- is always after both.
        let element_at = usize::from(matches!(kind, Iteration::Reduce));
        let element_symbol = *names.get(element_at).ok_or_else(|| {
            self.unsupported(callback, &format!("a `{method}` callback of this shape"))
        })?;
        let index_symbol = names.get(element_at + 1).copied();

        let origin = self.origin(id);
        // **`reduce` with no initial value is the same loop started one along.**
        // The specification takes the first element as the accumulator and
        // walks from the second, and raises where there is no first -- so the
        // three differences from the seeded form are a guard, a seed read out
        // of the array, and an index that begins at one. Everything below is
        // shared, which is why this is a branch here rather than a second loop.
        let from_first = matches!(kind, Iteration::Reduce) && seed.is_none();
        let index = self.synthetic_symbol();
        let length = self.push(OpKind::Length(receiver), HirType::NUMBER, origin.clone());
        let (start, seed) = self.reduce_start(
            id,
            receiver,
            element_ty,
            length,
            seed,
            ReduceStart {
                from_first,
                backwards,
            },
        )?;
        self.bindings.insert(index, start);

        // What the loop carries: the index always, the accumulator when there
        // is one, and every name the body assigns that it did not declare.
        //
        // The accumulator is a loop-carried name like any other, which is what
        // keeps `reduce` free of an allocation: nothing about it escapes.
        let accumulator = self.iteration_answer(id, kind, seed, length, &origin)?;
        let mut synthetic = vec![index];
        synthetic.extend(accumulator);
        let carried = self.carried_across(body, &synthetic, names);

        let produced = self.iteration_result_array(id, kind, length, &origin)?;

        // `steps: true`, so the index moves in a latch block of its own. A
        // `return` inside the callback jumps there, the way `continue` does,
        // and a step written at the end of the body would be skipped by it --
        // which is a loop that never finishes.
        let record = self.begin_loop(id, &carried, true, &origin)?;

        let at = self.bindings[&index];
        let cond = self.still_walking(at, length, backwards, &origin);
        self.test_loop(cond, &record);
        self.switch_to(record.body);

        let step_names = StepNames {
            index,
            element: element_symbol,
            position: index_symbol,
            fold: matches!(kind, Iteration::Reduce)
                .then(|| accumulator.zip(names.first().copied()))
                .flatten(),
        };
        let value = self.bind_step(receiver, element_ty, step_names, &origin);

        let result =
            Self::iteration_delivery(kind, produced, accumulator, index, value, element_ty);
        self.lower_callback_body(id, body, result, record.depth, method)?;
        self.end_loop(
            &record,
            Step::Count {
                name: index,
                by: if backwards { -1.0 } else { 1.0 },
            },
        )?;

        self.iteration_result(id, receiver, kind, produced, accumulator, origin)
    }

    /// One callback body, shared by array methods and a mapped source walk.
    /// Both concise results and explicit returns deliver through the same
    /// result policy before the caller advances its own iteration.
    pub(super) fn lower_callback_body(
        &mut self,
        id: NodeId,
        body: NodeId,
        result: CallbackResult,
        depth: usize,
        method: &str,
    ) -> Result<(), Diagnostic> {
        self.callback_returns.push(CallbackReturn { depth, result });
        let concise = self.kind_of(body) != Some(syntax::BLOCK);
        let lowered = if concise {
            self.lower_expression(body).map(Some)
        } else {
            self.lower_statement(body).map(|()| None)
        };
        self.callback_returns.pop();
        let produced_value = lowered?;

        // A concise body *is* its value, so it is delivered here rather than by
        // a `return` that cannot appear in one.
        if let Some(value) = produced_value {
            self.deliver(id, &result, depth, Some(value))?;
        } else if !self.is_terminated() && !matches!(result, CallbackResult::Discard) {
            // A block body that can reach its end without returning has no
            // value for this iteration. TypeScript rejects it before this,
            // because the callback's inferred return type would include
            // `undefined`; refusing rather than trusting that keeps the
            // failure a diagnostic instead of a silently unchanged
            // accumulator.
            return Err(self.unsupported(
                body,
                &format!("a `{method}` callback that can finish without returning a value"),
            ));
        }
        Ok(())
    }

    /// What the whole call evaluates to, once the loop has run.
    ///
    /// Split out of [`Self::lower_iteration`] because it is a question about the
    /// *method* rather than about the loop -- every arm reads what the loop
    /// left behind and none of them can see how it walked, which is the claim
    /// `Direction` depends on.
    fn iteration_result(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        kind: Iteration,
        produced: Option<ValueId>,
        accumulator: Option<u32>,
        origin: Origin,
    ) -> Result<ValueId, Diagnostic> {
        match (kind, produced, accumulator) {
            // `forEach` evaluates to `undefined`, which is `void` here. Nothing
            // reads it -- an expression statement is the only place this
            // appears -- but the caller wants a value.
            (Iteration::ForEach, _, _) => {
                Ok(self.push(OpKind::ConstFloat(0.0), HirType::Void, origin))
            }
            // `map` filled every slot it allocated; `filter` appended to one
            // allocated empty. Either way the array is the answer.
            (Iteration::Map | Iteration::Filter, Some(array), _) => Ok(array),
            // The accumulator's binding after the loop is the exit block's
            // parameter for it, which `end_loop` has just installed.
            (
                Iteration::Reduce | Iteration::Any | Iteration::All | Iteration::FindIndex,
                _,
                Some(symbol),
            ) => Ok(self.bindings[&symbol]),
            // The element at the index the loop stopped at, or `undefined`
            // where it stopped because it ran out -- which is what `at` answers
            // for an index that is not there, and the reason the seed is the
            // length.
            (Iteration::Find, _, Some(symbol)) => {
                let at = self.bindings[&symbol];
                let ty = self
                    .type_of(id)
                    .ok_or_else(|| self.unrepresentable(id, "a `find` result"))?;
                let helper = match &ty {
                    HirType::Erased => "nts_array_at_value",
                    counted if holds_counted(counted) => counted_helper(counted, Counts::At),
                    _ => "nts_array_at",
                };
                Ok(self.runtime_call(helper, vec![receiver, at], ty, origin))
            }
            _ => unreachable!("the result of a kind is decided with the kind"),
        }
    }

    /// `map`'s result, allocated once before the loop.
    ///
    /// It exists before the loop and is never rebound, so it is not carried:
    /// it is one allocation the body writes into.
    ///
    /// Not zeroed. The loop runs every index from 0 to this very length,
    /// [`Self::deliver`] stores on every path through the body, and there is no
    /// early exit -- so nothing can read a slot this allocation did not fill.
    /// The claim is checked rather than argued: `NTS_POISON` fills an
    /// uninitialized allocation with a pattern that is not zero, and the whole
    /// example suite still agrees with node under it.
    fn iteration_result_array(
        &mut self,
        id: NodeId,
        kind: Iteration,
        length: ValueId,
        origin: &Origin,
    ) -> Result<Option<ValueId>, Diagnostic> {
        if !matches!(kind, Iteration::Map | Iteration::Filter) {
            return Ok(None);
        }
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `map` result"))?;
        let made = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Uninitialized,
            },
            ty.clone(),
            origin.clone(),
        );
        if !matches!(kind, Iteration::Filter) {
            return Ok(Some(made));
        }
        // `filter` keeps the *room* and gives back the length.
        //
        // `map` writes every slot it allocates and `filter` writes a prefix, so
        // the two differ in what the tail holds while the loop is running --
        // and the array is a live object throughout, with a length the
        // collector walks if the callback allocates. An array whose length says
        // `n` and whose slots hold whatever the allocator last left there is
        // one the collector reads as `n` references.
        //
        // Zeroing the tail answers that and was the first version. It costs a
        // `memset` of the whole input: 16.4% of `benchmarks/cases/array-predicates`
        // went to `__memset_avx2_unaligned_erms`.
        //
        // Saying the array is *empty* answers it for nothing. The capacity is
        // the input's length, so `push` never reallocates, and the length is
        // exactly what has been written -- so the collector never sees a slot
        // the loop has not reached, the result needs no shortening at the end,
        // and the two paths through the body no longer disagree about a count.
        let none = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.runtime_call(
            "nts_array_keep_first",
            vec![made, none],
            HirType::Void,
            origin.clone(),
        );
        Ok(Some(made))
    }

    /// What the callback produces, put where this method wants it.
    ///
    /// Called from two places that must agree: the end of a concise body, and
    /// a `return` in a block body, which has to do this *before* it jumps.
    pub(super) fn deliver(
        &mut self,
        id: NodeId,
        result: &CallbackResult,
        depth: usize,
        value: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        match result {
            CallbackResult::Discard => Ok(()),
            CallbackResult::Accumulate(symbol) => {
                let value = value.ok_or_else(|| {
                    self.unsupported(
                        id,
                        "a bare `return` in a callback that must produce a value",
                    )
                })?;
                self.bindings.insert(*symbol, value);
                Ok(())
            }
            // `some` and `every`: the callback's value is a question, and an
            // answer that ends the loop leaves through the same exit `break`
            // uses -- carrying what the loop carries, so the answer merges with
            // the one the header would have reached on its own.
            CallbackResult::Decide { symbol, exits_on } => {
                let value = value.ok_or_else(|| {
                    self.unsupported(
                        id,
                        "a bare `return` in a callback that must produce a value",
                    )
                })?;
                let origin = self.origin(id);
                let cond = self.truthy(id, value);
                let answer = self.push(OpKind::ConstBool(*exits_on), HirType::Bool, origin);
                self.stop_early(*symbol, answer, depth, cond, *exits_on);
                Ok(())
            }
            // `findIndex`: the same early exit `some` takes, carrying the
            // index it stopped at instead of the answer that stopped it.
            CallbackResult::Locate { symbol, index } => {
                let value = value.ok_or_else(|| {
                    self.unsupported(
                        id,
                        "a bare `return` in a callback that must produce a value",
                    )
                })?;
                let cond = self.truthy(id, value);
                let at = self.bindings[index];
                self.stop_early(*symbol, at, depth, cond, true);
                Ok(())
            }
            // `filter`: a store and a step, or neither.
            //
            // The two paths disagree about how many have been kept, so the
            // block they meet in takes it as a parameter -- which is what an
            // `if` does for any name its arms write, and the reason the cursor
            // cannot just be rebound the way `some`'s answer is.
            CallbackResult::Keep {
                array,
                element,
                push,
            } => {
                let value = value.ok_or_else(|| {
                    self.unsupported(
                        id,
                        "a bare `return` in a callback that must produce a value",
                    )
                })?;
                let cond = self.truthy(id, value);
                self.keep_element(id, *array, *element, push, cond);
                Ok(())
            }
            CallbackResult::Append { array, index } => {
                self.append_callback_value(id, *array, *index, value)
            }
            CallbackResult::Store { array, index } => {
                let value = value.ok_or_else(|| {
                    self.unsupported(
                        id,
                        "a bare `return` in a callback that must produce a value",
                    )
                })?;
                let origin = self.origin(id);
                let at = self.bindings[index];
                self.push(
                    OpKind::ArraySet {
                        array: *array,
                        index: at,
                        value,
                        checked: true,
                    },
                    HirType::Void,
                    origin,
                );
                Ok(())
            }
        }
    }

    /// The output array is private, so its pre-callback length is still the
    /// append position. The common policy chooses the new-slot helper for a
    /// counted value, and a checked growing store for a scalar value.
    fn append_callback_value(
        &mut self,
        id: NodeId,
        array: ValueId,
        index: ValueId,
        value: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        let value = value.ok_or_else(|| {
            self.unsupported(
                id,
                "a bare `return` in a callback that must produce a value",
            )
        })?;
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[array.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(id, "a mapping callback whose result is not an array"));
        };
        let value = self.coerce(value, &element, id)?;
        let append = self.collection_append(id, &element, Some(index))?;
        self.append_collection_value(append, array, value, &self.origin(id));
        Ok(())
    }

    /// What the body's value does, which is the whole difference between the
    /// seven methods this lowering serves.
    fn iteration_delivery(
        kind: Iteration,
        produced: Option<ValueId>,
        accumulator: Option<u32>,
        index: u32,
        value: ValueId,
        element: &HirType,
    ) -> CallbackResult {
        match (kind, produced, accumulator) {
            (Iteration::ForEach, _, _) => CallbackResult::Discard,
            (Iteration::Map, Some(array), _) => CallbackResult::Store { array, index },
            (Iteration::Reduce, _, Some(symbol)) => CallbackResult::Accumulate(symbol),
            (Iteration::Any, _, Some(symbol)) => CallbackResult::Decide {
                symbol,
                exits_on: true,
            },
            (Iteration::All, _, Some(symbol)) => CallbackResult::Decide {
                symbol,
                exits_on: false,
            },
            (Iteration::FindIndex | Iteration::Find, _, Some(symbol)) => {
                CallbackResult::Locate { symbol, index }
            }
            (Iteration::Filter, Some(array), _) => CallbackResult::Keep {
                array,
                element: value,
                push: if holds_counted(element) {
                    "nts_array_push_ref"
                } else {
                    "nts_array_push"
                },
            },
            _ => unreachable!("the result of a kind is decided with the kind"),
        }
    }

    /// The name a method's answer is carried in, and what it starts as.
    ///
    /// One loop-carried name serves five of the seven. `reduce` carries its
    /// accumulator, `some` and `every` carry the answer, `findIndex` carries the
    /// index it stopped at, and `filter` carries how many it has kept -- and in
    /// every case it is a scalar in a block parameter, which is why none of them
    /// allocates anything to hold it.
    ///
    /// The seed is the answer for an array the loop never decides anything
    /// about: `[].some(f)` is `false`, `[].every(f)` is `true`, `[].findIndex(f)`
    /// is `-1`, and a `filter` that keeps nothing has kept none.
    fn iteration_answer(
        &mut self,
        id: NodeId,
        kind: Iteration,
        seed: Option<ValueId>,
        length: ValueId,
        origin: &Origin,
    ) -> Result<Option<u32>, Diagnostic> {
        Ok(match kind {
            Iteration::Reduce => {
                let symbol = self.synthetic_symbol();
                let seed =
                    seed.ok_or_else(|| self.unsupported(id, "a `reduce` with no initial value"))?;
                self.bindings.insert(symbol, seed);
                Some(symbol)
            }
            // `some` and `every` carry their answer the way `reduce` carries
            // its accumulator, and for the same reason: it is a loop-carried
            // name, so nothing about it escapes and nothing is allocated for
            // it. The seed is the answer for an array that never decides --
            // `[].some(f)` is `false` and `[].every(f)` is `true`.
            Iteration::Any | Iteration::All => {
                let symbol = self.synthetic_symbol();
                let start = self.push(
                    OpKind::ConstBool(matches!(kind, Iteration::All)),
                    HirType::Bool,
                    origin.clone(),
                );
                self.bindings.insert(symbol, start);
                Some(symbol)
            }
            // `findIndex` carries an index rather than an answer, seeded with
            // the one it returns for an array that never decides.
            Iteration::FindIndex => {
                let symbol = self.synthetic_symbol();
                let start = self.push(OpKind::ConstFloat(-1.0), HirType::NUMBER, origin.clone());
                self.bindings.insert(symbol, start);
                Some(symbol)
            }
            // `find` carries the index it stopped at, seeded with the length
            // rather than with `-1`. Both say "nothing matched", and this one
            // says it in a number `at` already answers `undefined` for -- so
            // the value is read out by the helper `xs.at(i)` uses rather than
            // by a conditional this would have to build.
            Iteration::Find => {
                let symbol = self.synthetic_symbol();
                self.bindings.insert(symbol, length);
                Some(symbol)
            }
            Iteration::ForEach | Iteration::Map | Iteration::Filter => None,
        })
    }

    /// Append an element, or do not.
    ///
    /// `filter`'s body. The two paths used to disagree about how many had been
    /// kept, which made the block they meet in a merge and the count its
    /// parameter. They do not any more: the result is allocated with room and
    /// no length, so the count *is* the array's length and `push` is what
    /// maintains it. Nothing crosses the join.
    fn keep_element(
        &mut self,
        id: NodeId,
        array: ValueId,
        element: ValueId,
        push: &'static str,
        cond: ValueId,
    ) {
        let origin = self.origin(id);
        let keeping = self.new_block();
        let rest = self.new_block();
        self.terminate(Terminator::Branch {
            cond,
            then_target: keeping,
            then_args: Vec::new(),
            else_target: rest,
            else_args: Vec::new(),
        });
        self.switch_to(keeping);
        self.runtime_call(push, vec![array, element], HirType::NUMBER, origin);
        self.terminate(Terminator::Jump {
            target: rest,
            args: Vec::new(),
        });
        self.switch_to(rest);
    }

    /// Leave the loop with an answer, on the side of a test that decides.
    ///
    /// `some`, `every` and `findIndex` all stop before the end and all three
    /// stop the same way: branch on what the callback said, write the answer on
    /// the side that leaves, and go out through the block `break` goes out
    /// through -- carrying what the loop carries, so the answer merges with the
    /// one the header would have reached had it run out of elements instead.
    ///
    /// `exits_on` says which side of the test leaves. It is `true` for `some`
    /// and `findIndex`, which stop when the predicate holds, and `false` for
    /// `every`, which stops when it does not.
    ///
    /// # The binding, written twice
    ///
    /// `bindings` is one map and not one per block, so a name written on a path
    /// that ends in a jump is still written after it. Left that way the loop
    /// goes on reading a value defined in a block that no longer dominates it,
    /// which is what `NotDominated` says and what this got wrong first.
    fn stop_early(
        &mut self,
        symbol: u32,
        answer: ValueId,
        depth: usize,
        cond: ValueId,
        exits_on: bool,
    ) {
        let before = self.bindings[&symbol];
        let leaving = self.new_block();
        let staying = self.new_block();
        let (then_target, else_target) = if exits_on {
            (leaving, staying)
        } else {
            (staying, leaving)
        };
        self.terminate(Terminator::Branch {
            cond,
            then_target,
            then_args: Vec::new(),
            else_target,
            else_args: Vec::new(),
        });
        self.switch_to(leaving);
        self.bindings.insert(symbol, answer);
        let carried = self.breakables[depth].carried.clone();
        let args = self.carried_now(&carried);
        let (exit, _) = self.exit_of(depth);
        self.terminate(Terminator::Jump { target: exit, args });
        self.switch_to(staying);
        self.bindings.insert(symbol, before);
    }

    /// The names a callback binds and the body it runs, checked against what
    /// this method needs of them.
    ///
    /// The index and the array are the parameters every callback of these
    /// *may* take, and a callback taking one is refused rather than bound: the
    /// index would need the loop counter's identity to survive into the body,
    /// and this has no test for that yet.
    pub(super) fn callback_shape(
        &mut self,
        callback: NodeId,
        kind: Iteration,
        method: &str,
    ) -> Result<(Vec<u32>, NodeId), Diagnostic> {
        let parameters = self.callback_parameters(callback, method)?;
        // The element, plus the accumulator where the method has one, plus an
        // optional index. The third parameter every one of these callbacks may
        // take is the *array*, and that is still refused: handing the receiver
        // to the body would let it be stored somewhere the loop cannot see, and
        // the loop is what proves the array does not escape.
        let least = kind.parameters();
        if parameters.len() != least && parameters.len() != least + 1 {
            return Err(self.unsupported(
                callback,
                &format!(
                    "a `{method}` callback taking {} parameters, where it may take {least} or \
                     {} -- the element, the index, and for `reduce` the accumulator before them",
                    parameters.len(),
                    least + 1
                ),
            ));
        }
        let body = *self.children(callback).last().ok_or_else(|| {
            self.unsupported(callback, &format!("a `{method}` callback with no body"))
        })?;
        Ok((parameters, body))
    }

    /// The symbols an arrow's parameters bind, in order.
    pub(super) fn callback_parameters(
        &mut self,
        callback: NodeId,
        method: &str,
    ) -> Result<Vec<u32>, Diagnostic> {
        let parameters: Vec<NodeId> = self
            .children(callback)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
            .collect();
        let mut symbols = Vec::new();
        for parameter in parameters {
            let name = self
                .children(parameter)
                .into_iter()
                .find(|field| self.kind_of(*field) == Some(syntax::IDENTIFIER))
                .ok_or_else(|| {
                    self.unsupported(parameter, &format!("a `{method}` parameter of this shape"))
                })?;
            let symbol = self
                .node(name)
                .symbol
                .ok_or_else(|| {
                    self.unsupported(name, &format!("a `{method}` name with no symbol"))
                })?
                .0;
            symbols.push(symbol);
        }
        Ok(symbols)
    }
}

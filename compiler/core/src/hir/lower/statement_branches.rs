//! Lower if and switch statements, including case chains, narrowing, and join decisions.

use super::{
    BinOp, BlockId, Breakable, Connective, Diagnostic, FuncBuilder, HirType, JumpTarget,
    LiteralValue, ManagedType, NodeData, NodeId, ObjcProperty, OpKind, Origin, Place, Terminator,
    ThisPaths, TypeId, TypeKind, ValueId, callable_fields, compound_operator, logical_assignment,
    syntax,
};

/// The parts of a `switch` its test chain needs.
///
/// Bundled because they are one thing -- the switch being lowered -- and
/// passing them one at a time had grown to eight arguments, where a transposed
/// pair would still compile.
#[derive(Debug, Clone, Copy)]
struct CaseChain<'a> {
    clauses: &'a [NodeId],
    blocks: &'a [BlockId],
    carried: &'a [u32],
    origin: &'a Origin,
    depth: usize,
    /// Whether the labels cover every value the discriminant can hold, so that
    /// the chain's last `else` is a point control does not reach.
    exhaustive: bool,
}

/// One side of a branching expression.
///
/// A ternary's arms are expressions to lower inside their own blocks; a
/// short-circuit's "untaken" arm is the left operand, already evaluated before
/// the branch.
///
/// `Clone` and not `Copy`: `Member` carries a representation, which is a type
/// and owns a `Box` for an array's element. Every branch is built where it is
/// used and moved once, so nothing here wanted the copy.
#[derive(Clone)]
pub(super) enum Branch {
    CallableProjection(callable_fields::Projection),
    CallableSupplier(callable_fields::Projection),
    Expression(NodeId),
    Value(ValueId),
    /// A supplied parameter payload, read only in the arm whose undefined
    /// test established that its default is not needed.
    Unerased(ValueId, HirType),
    /// A parameter's default, in the arm where the argument a call passed for
    /// it is `undefined`: see [`FuncBuilder::lower_parameter_default`], whose
    /// arguments these are -- the call, the default, the callee, the arguments
    /// before it and the receiver.
    ParameterDefault {
        call: NodeId,
        default: NodeId,
        callee: NodeId,
        before: Vec<ValueId>,
        receiver: Option<ValueId>,
    },
    /// A logical assignment's right operand, evaluated *and written* here.
    ///
    /// Inside the arm rather than before it, for two reasons that happen to
    /// coincide. The evaluation must not happen on the other path -- `a ||=
    /// f()` does not call `f` when `a` is truthy -- and neither must the
    /// write: a logical assignment whose test goes the other way performs no
    /// store at all. The second is what distinguishes this from
    /// [`Self::Expression`], and it is observable rather than academic. A
    /// setter does not run, and a counted store does not release whatever the
    /// place was already holding.
    ///
    /// The place is lowered once, before the branch, so `xs[next()] ??= 1`
    /// calls `next` a single time whichever way the test goes.
    Assigned(NodeId, Place),
    /// `undefined`, at whatever type the whole expression has.
    ///
    /// What `a?.b` produces when `a` is absent -- and it is the *expression's*
    /// type rather than the member's, because the member is not read at all.
    Absent,
    /// An optional property requirement's getter, sent to a receiver that
    /// answered `respondsToSelector:` for it: inside the arm, so an object
    /// that does not implement it is never sent it.
    ObjcGetter(ValueId, NodeId, ObjcProperty),
    /// A member read from a receiver that is already lowered.
    ///
    /// The receiver is evaluated before the branch and read inside it, which is
    /// what keeps `a?.b` from evaluating `a` twice.
    ///
    /// The third field is what the receiver *is* once the branch has
    /// established it is present, and `None` where it was already that. A
    /// pointer carries its own absence, so a `string | null` receiver is a
    /// string in the arm that tested it and there is nothing to do; two
    /// absences needed a tag, and the payload has to be read back out of it
    /// before anything can ask for a member. See
    /// [`FuncBuilder::present_of`].
    Member(ValueId, NodeId, Option<HirType>),
    /// The rest of an optional chain, in the arm where the `?.` link `link`
    /// found its receiver present: the link is lowered as a plain one on that
    /// receiver (read back as the third field says, as [`Self::Member`]'s),
    /// and `rest` are the `?.` links above it still to test.
    Chain {
        link: NodeId,
        receiver: ValueId,
        present: Option<HirType>,
        rest: Vec<NodeId>,
    },
    /// `f?.(x)`'s call, in the arm where the callee is present.
    ///
    /// The arguments are lowered *here* rather than before the branch: `f?.(g())`
    /// must not call `g` when `f` is absent, which is what the specification
    /// says and what a branch taken earlier would get wrong.
    Invoke(ValueId, NodeId, Option<HirType>),
    /// `a?.b(...)`'s present arm: a method call on an already-lowered receiver.
    ///
    /// Carries the receiver's *node* as well as its value, because the dispatch
    /// inside asks the node for its type in several arms. The arguments are not
    /// here: they are lowered from `id` inside the arm, so that `a?.b(f())` does
    /// not call `f` on the absent path.
    MethodOn(ValueId, NodeId, NodeId, Option<HirType>),
    /// `xs?.[i]`'s read, in the arm where the receiver is present.
    ///
    /// The index is lowered *here* rather than before the branch, for the same
    /// reason [`Self::Member`]'s payload read is: `xs?.[next()]` must not call
    /// `next` when `xs` is absent, and the specification says so.
    Element(ValueId, NodeId, Option<HirType>),
    /// One element of an array, read in the arm where the index is in range.
    ///
    /// The read is **here** rather than before the branch, and that is the whole
    /// point of the variant. [`Self::Value`] and [`Self::Present`] both take a
    /// value the caller has already computed, and for a checked `ArrayGet` that
    /// means the abort has already happened -- which is precisely what a default
    /// on the element exists to prevent.
    ///
    /// Distinct from [`Self::Element`] because that one lowers an index
    /// *expression* from a node: `xs?.[next()]` must not call `next` on the
    /// absent path. A pattern's index is a position this compiler synthesised
    /// and there is no node to lower.
    ///
    /// Still `checked`. Inside the arm the index cannot be out of range, so the
    /// check costs a comparison that the optimiser can see through -- and if the
    /// guard is ever wrong, the program aborts where it would otherwise read
    /// past the end of the backing store.
    ArrayElement {
        array: ValueId,
        index: ValueId,
        ty: HirType,
    },
    /// A value the branch has established is neither `null` nor `undefined`.
    ///
    /// Distinct from [`Self::Value`] because the distinction is a soundness
    /// one. `a || b` takes its first arm when `a` is *truthy*, and truthy
    /// excludes both absences -- so an erased `a` may be read back at the type
    /// the whole expression has. `a && b` takes its second arm when `a` is
    /// *falsy*, and `undefined` is falsy, so the same read there would be a
    /// payload that is not present.
    Present(ValueId),
}

impl FuncBuilder<'_> {
    /// `switch (x) { case a: .. }`.
    ///
    /// # Two orders, and they are not the same order
    ///
    /// A `switch` is *tested* in source order until something matches, and it
    /// is *laid out* in source order so that a clause without a `break` falls
    /// into the next one. `default` takes part in the second and not the first:
    /// it is reached only when every case has been tried, wherever it was
    /// written. So the tests form a chain that skips it and ends at it, while
    /// the clause blocks are threaded together in the order they appear.
    ///
    /// # Why every clause block takes parameters
    ///
    /// A clause is a merge: control arrives either from its own test or by
    /// falling out of the clause above, and those two disagree about what the
    /// carried names hold. That is the same reason a loop's exit takes
    /// parameters, for the same kind of reason.
    ///
    /// The comparison is `===` on the discriminant, which for the numbers and
    /// strings this compiler represents is what the specification's
    /// `StrictEquals` reduces to.
    pub(super) fn lower_switch(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let [discriminant, case_block] = children.as_slice() else {
            return Err(self.unsupported(id, "a `switch` of unexpected shape"));
        };
        let (discriminant, case_block) = (*discriminant, *case_block);
        if self.kind_of(case_block) != Some(syntax::CASE_BLOCK) {
            return Err(self.unsupported(id, "a `switch` without a case block"));
        }
        let clauses = self.children(case_block);
        let origin = self.origin(id);

        let mut carried = Vec::new();
        let mut declared = Vec::new();
        for clause in &clauses {
            self.assigned_symbols(*clause, &mut carried);
            self.declared_symbols(*clause, &mut declared);
        }
        carried.retain(|symbol| !declared.contains(symbol));
        // A global carries nothing, and an unbound name is refused rather than
        // indexed. Before this a module-scope `switch` assigning a global
        // **panicked** -- see `carried_locals`.
        let carried = self.carried_locals(
            id,
            &carried,
            "a `switch` assigning a name declared outside it",
        )?;

        let subject = self.lower_expression(discriminant)?;

        // Every block a clause or the exit needs, with its parameters, before
        // anything is lowered into one -- a fall-through edge is written before
        // the block it lands in has been visited.
        let mut blocks = Vec::new();
        for _ in &clauses {
            blocks.push(self.new_block());
        }
        let entering = self.carried_now(&carried);
        let mut exit_types = Vec::new();
        let mut clause_params: Vec<Vec<ValueId>> = vec![Vec::new(); clauses.len()];
        for value in &entering {
            let ty = self.values[value.0 as usize].ty.clone();
            exit_types.push(ty.clone());
            for (clause, block) in clause_params.iter_mut().zip(&blocks) {
                clause.push(self.push_block_param(*block, ty.clone(), origin.clone()));
            }
        }

        let depth = self.breakables.len();
        self.breakables.push(Breakable {
            exit: None,
            exit_types,
            origin: origin.clone(),
            latch: None,
            carried: carried.clone(),
            label: self.pending_label.take(),
            exits_at: self.exits.len(),
            continues_at: self.exits.len(),
        });

        let chain = CaseChain {
            clauses: &clauses,
            blocks: &blocks,
            carried: &carried,
            origin: &origin,
            depth,
            exhaustive: self.covers_every_case(discriminant, &clauses),
        };
        self.lower_case_chain(&chain, subject)?;

        // The clauses, threaded in source order so a missing `break` falls
        // through -- which is what it means.
        for (at, clause) in clauses.iter().enumerate() {
            self.switch_to(blocks[at]);
            for (symbol, param) in carried.iter().zip(&clause_params[at]) {
                self.bindings.insert(*symbol, *param);
            }
            let statements: Vec<NodeId> = self
                .children(*clause)
                .into_iter()
                .skip(usize::from(
                    self.kind_of(*clause) == Some(syntax::CASE_CLAUSE),
                ))
                .collect();
            for statement in statements {
                if self.is_terminated() {
                    break;
                }
                self.lower_statement(statement)?;
            }
            if !self.is_terminated() {
                let reached = self.carried_now(&carried);
                let next = match blocks.get(at + 1) {
                    Some(block) => *block,
                    None => self.exit_of(depth).0,
                };
                self.terminate(Terminator::Jump {
                    target: next,
                    args: reached,
                });
            }
        }

        // A `switch` every clause returns from, with a `default` so nothing
        // falls past it, has nothing after it.
        let left = self.breakables[depth].exit.clone();
        self.breakables.pop();
        if let Some((exit, params)) = left {
            self.switch_to(exit);
            for (symbol, param) in carried.iter().zip(&params) {
                self.bindings.insert(*symbol, *param);
            }
        }
        Ok(())
    }

    /// The comparison chain a `switch` tests through, in source order.
    ///
    /// `default` is not in it. It is reached when every case has been tried,
    /// which is where the chain ends rather than somewhere along it — and that
    /// is true wherever in the source it was written.
    fn lower_case_chain(
        &mut self,
        chain: &CaseChain<'_>,
        subject: ValueId,
    ) -> Result<(), Diagnostic> {
        let CaseChain {
            clauses,
            blocks,
            carried,
            origin,
            depth,
            exhaustive,
        } = *chain;
        let default_at = clauses
            .iter()
            .position(|clause| self.kind_of(*clause) == Some(syntax::DEFAULT_CLAUSE));
        let cases: Vec<usize> = (0..clauses.len())
            .filter(|at| Some(*at) != default_at)
            .collect();

        // `switch (x) { }` and `switch (x) { default: }` have nothing to test.
        if cases.is_empty() {
            let reached = self.carried_now(carried);
            let target = match default_at {
                Some(at) => blocks[at],
                None => self.exit_of(depth).0,
            };
            self.terminate(Terminator::Jump {
                target,
                args: reached,
            });
            return Ok(());
        }

        // A `default` covers whatever the labels do not, so coverage only
        // matters where there is none.
        let exhaustive = exhaustive && default_at.is_none();
        let mut unreachable_tail = None;

        for (which, at) in cases.iter().enumerate() {
            let clause = clauses[*at];
            let label = *self
                .children(clause)
                .first()
                .ok_or_else(|| self.unsupported(clause, "a `case` with no label"))?;
            let label = self.lower_expression(label)?;
            // `Eq` on a string-typed operand reaches the backend as
            // `nts_string_eq`, so this one operation is `===` for every type
            // this compiler can switch on.
            let matched = self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs: subject,
                    rhs: label,
                },
                HirType::Bool,
                origin.clone(),
            );

            let reached = self.carried_now(carried);
            // A block in the middle of the chain is straight-line: control
            // arrives one way and the names are unchanged, so it takes no
            // parameters. Only the ends of the chain are merges.
            let chaining = which + 1 < cases.len();
            let (otherwise, otherwise_args) = if chaining {
                (self.new_block(), Vec::new())
            } else if let Some(at) = default_at {
                (blocks[at], reached.clone())
            } else if exhaustive {
                // Every value the discriminant can hold is a label, so the last
                // test's `else` is a point control does not reach. Saying so is
                // what keeps a `switch` whose every clause returns from looking
                // like a function that falls out of its end owing a value --
                // which is how `byteLengthIn` read, and TypeScript accepts it
                // precisely because the exit is unreachable.
                //
                // `Unreachable` rather than `FellThrough`: coverage is checked
                // below rather than assumed, so this is a claim with a proof.
                let nowhere = self.new_block();
                unreachable_tail = Some(nowhere);
                (nowhere, Vec::new())
            } else {
                (self.exit_of(depth).0, reached.clone())
            };
            self.terminate(Terminator::Branch {
                cond: matched,
                then_target: blocks[*at],
                then_args: reached,
                else_target: otherwise,
                else_args: otherwise_args,
            });
            if chaining {
                self.switch_to(otherwise);
            }
        }
        if let Some(nowhere) = unreachable_tail {
            let here = self.current;
            self.switch_to(nowhere);
            self.terminate(Terminator::Unreachable);
            self.switch_to(here);
        }
        Ok(())
    }

    /// Whether the `case` labels cover every value the discriminant can hold.
    ///
    /// Only where that is *decidable here*: a union of literal types, each of
    /// which some label matches. Anything else answers no, which costs a
    /// reachable exit and never costs a wrong one -- and a wrong one is a block
    /// the emitter fills with `__builtin_unreachable()`.
    ///
    /// TypeScript does this analysis too, and better; what it does not do is
    /// tell us the answer. So this is the narrow version of it, and the
    /// narrowness is the point.
    fn covers_every_case(&self, discriminant: NodeId, clauses: &[NodeId]) -> bool {
        let literal_of = |ty: &TypeId| -> Option<LiteralValue> {
            match &self.snapshot.types.get(ty.0 as usize)?.kind {
                TypeKind::Literal(value) => Some(value.clone()),
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
                _ => None,
            }
        };
        let Some(subject) = self.snapshot.node_types.get(&discriminant) else {
            return false;
        };
        let Some(record) = self.snapshot.types.get(subject.0 as usize) else {
            return false;
        };
        let TypeKind::Union(members) = &record.kind else {
            return false;
        };
        let Some(wanted) = members.iter().map(literal_of).collect::<Option<Vec<_>>>() else {
            return false;
        };
        let labels: Vec<LiteralValue> = clauses
            .iter()
            .filter_map(|clause| self.children(*clause).first().copied())
            .filter_map(|label| self.snapshot.node_types.get(&label))
            .filter_map(literal_of)
            .collect();
        !wanted.is_empty() && wanted.iter().all(|value| labels.contains(value))
    }

    /// Lower only the arm a decided condition reaches, and report having done it.
    ///
    /// **A branch nothing can enter is not lowered**, which is the difference
    /// between a program that compiles and one that refuses for a construct it
    /// never runs. `if (isDevelopment) { console.error(...) }` with
    /// `isDevelopment` a `const` bound to `false` is React's development-warning
    /// idiom, and in the React lane's runtime this one cause refused **86
    /// functions** -- every one for a line a production build cannot reach.
    /// Folding it is also the only way that code leaves the binary.
    ///
    /// `false` when the condition is not decided, or when the dead arm declares
    /// something that outlives it -- see [`Self::hoists_out_of`]. The caller then
    /// lowers the `if` as it always has.
    fn folded_branch(
        &mut self,
        condition: NodeId,
        then_branch: NodeId,
        else_branch: Option<NodeId>,
    ) -> Result<bool, Diagnostic> {
        let Some(taken) = self.statically_decided(condition) else {
            return Ok(false);
        };
        let live = if taken {
            Some(then_branch)
        } else {
            else_branch
        };
        let dead = if taken {
            else_branch
        } else {
            Some(then_branch)
        };
        if dead.is_some_and(|at| self.hoists_out_of(at)) {
            return Ok(false);
        }
        if let Some(live) = live {
            self.lower_statement(live)?;
        }
        Ok(true)
    }

    /// Re-type a binding the condition's `instanceof` proved, for the arm that
    /// runs when the answer was yes -- and what to put back afterwards.
    ///
    /// Every use of `b` inside `if (b instanceof Leaf)` has static type `Leaf`
    /// while the binding holds a `Base`, and that disagreement used to be
    /// resolved per *use*, from the checker's type for that node, by
    /// [`Self::narrowed`]. That path has an arm for a member read and none for an
    /// assignment, so `const alias = b` reached [`Self::coerce`] as a `Base`
    /// arriving where a `Leaf` is wanted, was refused, and its statement was cut
    /// -- the program then ran on with whatever the target held, which is a
    /// different answer from node's.
    ///
    /// Rebinding once fixes every use in the arm together, and needs no run-time
    /// check: **the licence is the test immediately above, not a relation between
    /// the two types.** An earlier attempt licensed the read on
    /// `descends_from(wanted, held)` instead and was unsound, because structural
    /// typing satisfies that with no test having run anywhere -- a `Slim` unerased
    /// to a `Both` reads a slot it does not have, which
    /// `compiler/core/tests/programs/copy-phantom` is the witness for. Such a site
    /// is undominated and keeps refusing.
    ///
    /// Spelled erase-then-unerase for the reason [`Self::narrowed`]'s
    /// `ArrayBufferView` arm gives: those two already mean "put it in the
    /// representation everything shares" and "read it back as this one". The
    /// precedent for a refinement licensed by this lowering's own control flow
    /// rather than by `node_types` is [`Self::present_of`], which says so in as
    /// many words.
    ///
    /// The caller is already in the arm's block, because both ops belong to it.
    /// The binding an `instanceof` in this condition proved, and **which arm** it
    /// proved it for.
    ///
    /// `x instanceof T` proves it for the arm the test guards. `!(x instanceof T)`
    /// proves it for the *other* one, which is the guard-clause idiom --
    /// `if (!(h instanceof Timer)) return;` and then read `h` -- and the shape
    /// `runtime/node/timers`' `listOnTimeout` is written in. The node-port lane
    /// reduced it, and their arms say the gap is the **sense** rather than
    /// anything about interfaces: narrowing from `unknown` and from a union of
    /// classes both work, and so does the positive `if`.
    ///
    /// The sense is **counted** rather than special-cased, so `!!(x instanceof T)`
    /// and a parenthesised test need no arms of their own. Bounded, because a walk
    /// that cannot end is worse than one that gives up.
    fn instanceof_proved_by(&self, condition: NodeId) -> Option<(u32, TypeId, bool)> {
        let mut node = condition;
        let mut when = true;
        for _ in 0..16 {
            if let Some((symbol, class)) = self.tested_by_instanceof.get(&node).copied() {
                return Some((symbol, class, when));
            }
            match self.kind_of(node) {
                Some(syntax::PARENTHESIZED_EXPRESSION) => {}
                Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                    let NodeData::Children { small, .. } = self.node(node).data else {
                        return None;
                    };
                    if small & syntax::prefix_operator::MASK != syntax::prefix_operator::EXCLAMATION
                    {
                        return None;
                    }
                    when = !when;
                }
                _ => return None,
            }
            node = *self.children(node).first()?;
        }
        None
    }

    /// Re-type a binding to the class an `instanceof` proved, here.
    ///
    /// Split out because **three** places need it and each decides *whether*
    /// differently: the arm a positive test guards, the `else` a negated one
    /// guards, and -- where one arm left and the other did not -- everything after
    /// the `if`. One rebind, three reasons to want it, so the cell guard and the
    /// already-narrowed check cannot come apart between them.
    fn narrow_binding(
        &mut self,
        symbol: u32,
        class: TypeId,
        at: NodeId,
    ) -> Option<(u32, ValueId, ValueId)> {
        if self.cell_of(symbol).is_some() {
            return None;
        }
        let held = self.bindings.get(&symbol).copied()?;
        let want = HirType::Managed(ManagedType::Object(class));
        if self.values[held.0 as usize].ty == want {
            return None;
        }
        let origin = self.origin(at);
        let erased = self.erased_from(held, at, &origin);
        let narrow = self.push(OpKind::unerase(erased), want, origin);
        self.bindings.insert(symbol, narrow);
        Some((symbol, held, narrow))
    }

    fn narrow_for_the_arm(
        &mut self,
        condition: NodeId,
        when: bool,
    ) -> Option<(u32, ValueId, ValueId)> {
        let (symbol, class, proved) = self.instanceof_proved_by(condition)?;
        if proved != when {
            return None;
        }
        // **Not a name bound to a cell.** A `let` a closure captures *and writes*
        // is bound to the cell holding it, and [`Self::lower_identifier`] reads
        // the value *out* of that cell through [`Self::read_cell`] -- so what
        // `bindings` holds is the cell object and not the value the test was
        // about. Rebinding the symbol to an unerase of it would read the class's
        // field out of the cell's own memory: signal 11 on seventeen cases of a
        // probe whose only difference from the fixture is a closure assigning to
        // the narrowed `let`, where the binding is honestly refused today.
        //
        // Skipped rather than narrowed through the load, because a `bindings`
        // entry holding a value where a cell belongs would make every later write
        // in the arm miss the cell. A captured-and-written name keeps the per-use
        // narrowing it has now.
        self.narrow_binding(symbol, class, condition)
    }

    /// Lower the arm a test guards, with the binding that test narrowed re-typed
    /// for the arm and no longer.
    ///
    /// The narrowing is put back where the arm did not reassign it, so the merge
    /// sees the value it saw on entry. Without that, every `if (x instanceof T)`
    /// would gain a merge parameter for a narrowing whose life ends with the
    /// branch -- which [`Self::merged_type`] then widens straight back to the
    /// declaration's type, so the parameter carries nothing and costs a phi. An
    /// assignment the arm made stands: the binding is then not the value
    /// [`Self::narrow_for_the_arm`] inserted, and the merge is the one place that
    /// can reconcile it.
    ///
    /// One function rather than a narrow and a restore the caller pairs, because
    /// a scope is what this is: saving and restoring around a single construct is
    /// the shape the argument-default shadowing uses, for the same reason.
    fn lower_narrowed_arm(
        &mut self,
        condition: NodeId,
        arm: NodeId,
        when: bool,
    ) -> Result<(), Diagnostic> {
        let narrowed = self.narrow_for_the_arm(condition, when);
        let lowered = self.lower_statement(arm);
        if let Some((symbol, held, narrow)) = narrowed
            && self.bindings.get(&symbol) == Some(&narrow)
        {
            self.bindings.insert(symbol, held);
        }
        lowered
    }

    /// An `if`'s test, and the blocks it leads to: the then block, the else
    /// block -- the merge itself where there is no `else`, which is then also
    /// returned as allocated -- and each block whose branch goes to them.
    ///
    /// A condition that assigns nothing is lowered as jumps
    /// ([`Self::lower_jumps`]): with no name rebound inside it, every edge into
    /// an arm leaves with the bindings the `if` began with, so the arms and
    /// their merge are an ordinary `if`'s.
    fn lower_if_test(
        &mut self,
        condition: NodeId,
        else_branch: Option<NodeId>,
    ) -> Result<(BlockId, BlockId, Option<BlockId>, Vec<BlockId>), Diagnostic> {
        // With no `else`, the false edge goes straight to the merge. Allocating an
        // else block for it would leave a block whose only content is a jump —
        // once per `if` without an else, which is most of them.
        let else_target = |this: &mut Self| {
            let block = this.new_block();
            (block, else_branch.is_none().then_some(block))
        };
        if self.connective(condition).is_some() && !self.assigns(condition) {
            let then_block = self.new_block();
            let (else_block, preallocated) = else_target(self);
            let mut tests = Vec::new();
            self.lower_jumps(
                condition,
                ((then_block, &[]), (else_block, &[])),
                &mut tests,
            )?;
            return Ok((then_block, else_block, preallocated, tests));
        }
        let cond = self.lower_expression(condition)?;
        // `if (x)` takes any value, not just a boolean, and JavaScript decides
        // which are false. An empty string and a NaN are, which is why this
        // cannot be left to C's own idea of a condition.
        let cond = self.truthy(condition, cond);
        let then_block = self.new_block();
        let (else_block, preallocated) = else_target(self);
        let branch_block = self.current;
        self.terminate(Terminator::Branch {
            cond,
            then_target: then_block,
            then_args: Vec::new(),
            else_target: else_block,
            else_args: Vec::new(),
        });
        Ok((then_block, else_block, preallocated, vec![branch_block]))
    }

    /// `condition` as jumps: to `when_true` where it holds and `when_false`
    /// where it does not, with `&&`, `||` and `!` as the branches they are
    /// rather than a merged boolean, each block that branches recorded in
    /// `tests`. Every test is then an edge the range analysis narrows on, as it
    /// narrows a nested `if` -- `x >= 0 && x <= 100` proves `[0, 100]` in the
    /// arm, and `x < 0 || x > 100` with an early exit proves it after -- and
    /// the arm costs no merged value.
    pub(super) fn lower_jumps(
        &mut self,
        condition: NodeId,
        (when_true, when_false): (JumpTarget<'_>, JumpTarget<'_>),
        tests: &mut Vec<BlockId>,
    ) -> Result<(), Diagnostic> {
        match self.connective(condition) {
            Some(Connective::And(left, right)) => {
                let next = self.new_block();
                self.lower_jumps(left, ((next, &[]), when_false), tests)?;
                self.switch_to(next);
                self.lower_jumps(right, (when_true, when_false), tests)
            }
            Some(Connective::Or(left, right)) => {
                let next = self.new_block();
                self.lower_jumps(left, (when_true, (next, &[])), tests)?;
                self.switch_to(next);
                self.lower_jumps(right, (when_true, when_false), tests)
            }
            Some(Connective::Not(operand)) => {
                self.lower_jumps(operand, (when_false, when_true), tests)
            }
            None => {
                let value = self.lower_expression(condition)?;
                let cond = self.truthy(condition, value);
                if !self.is_terminated() {
                    tests.push(self.current);
                    self.terminate(Terminator::Branch {
                        cond,
                        then_target: when_true.0,
                        then_args: when_true.1.to_vec(),
                        else_target: when_false.0,
                        else_args: when_false.1.to_vec(),
                    });
                }
                Ok(())
            }
        }
    }

    /// `condition`'s own `&&`, `||` or `!`, through parentheses.
    pub(super) fn connective(&self, condition: NodeId) -> Option<Connective> {
        let mut node = condition;
        while self.kind_of(node) == Some(syntax::PARENTHESIZED_EXPRESSION) {
            node = *self.children(node).first()?;
        }
        match self.kind_of(node) {
            Some(syntax::BINARY_EXPRESSION) => {
                let [left, operator, right] = self.children(node)[..] else {
                    return None;
                };
                match self.kind_of(operator) {
                    Some(syntax::AMPERSAND_AMPERSAND_TOKEN) => Some(Connective::And(left, right)),
                    Some(syntax::BAR_BAR_TOKEN) => Some(Connective::Or(left, right)),
                    _ => None,
                }
            }
            Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                let NodeData::Children { small, .. } = self.node(node).data else {
                    return None;
                };
                if small & syntax::prefix_operator::MASK != syntax::prefix_operator::EXCLAMATION {
                    return None;
                }
                self.children(node).first().copied().map(Connective::Not)
            }
            _ => None,
        }
    }

    /// Whether evaluating `node` may assign: an assignment, compound or
    /// logical, or a `++`/`--`, anywhere under it.
    pub(super) fn assigns(&self, node: NodeId) -> bool {
        let writes = match self.kind_of(node) {
            Some(syntax::BINARY_EXPRESSION) => self.children(node).get(1).is_some_and(|operator| {
                let token = self.kind_of(*operator).unwrap_or(0);
                token == syntax::EQUALS_TOKEN
                    || compound_operator(token).is_some()
                    || logical_assignment(token).is_some()
            }),
            Some(syntax::POSTFIX_UNARY_EXPRESSION) => true,
            Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                matches!(self.node(node).data, NodeData::Children { small, .. }
                if matches!(small & syntax::prefix_operator::MASK, syntax::prefix_operator::PLUS_PLUS | syntax::prefix_operator::MINUS_MINUS))
            }
            _ => false,
        };
        writes
            || self
                .children(node)
                .into_iter()
                .any(|child| self.assigns(child))
    }

    /// Lower one control-flow arm from the current bindings, then restore them.
    /// Its tail and resulting bindings belong only to that arm; the caller
    /// decides which of them can reach a merge, including when a finally ran
    /// on an abrupt exit. Restore even on a lowering error.
    pub(super) fn lower_arm(
        &mut self,
        lower: impl FnOnce(&mut Self) -> Result<(), Diagnostic>,
    ) -> Result<(BlockId, bool, rustc_hash::FxHashMap<u32, ValueId>), Diagnostic> {
        let entry = self.bindings.clone();
        let lowered = lower(self);
        let tail = self.current;
        let open = !self.is_terminated();
        let bindings = std::mem::replace(&mut self.bindings, entry);
        lowered.map(|()| (tail, open, bindings))
    }

    pub(super) fn lower_if(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let (condition, then_branch, else_branch) = match children.as_slice() {
            [condition, then_branch] => (*condition, *then_branch, None),
            [condition, then_branch, else_branch] => (*condition, *then_branch, Some(*else_branch)),
            _ => return Err(self.unsupported(id, "an `if` of unexpected shape")),
        };

        if self.folded_branch(condition, then_branch, else_branch)? {
            return Ok(());
        }

        let origin = self.origin(id);
        // Remembered because the false edges' arguments are not known until the
        // merge has parameters, which is after both arms are lowered.
        let (then_block, else_block, preallocated, tests) =
            self.lower_if_test(condition, else_branch)?;

        // What each name held on entry: the baseline the arms are compared
        // against, and what the false edge carries when there is no `else`.
        let entry = self.bindings.clone();
        // `this` is per path in a constructor whose base makes the instance:
        // a `super(...)` in an arm binds it there and nowhere else.
        let mut paths = ThisPaths::enter(self.this);

        self.switch_to(then_block);
        // The block the arm *ended* in, which nested control flow moves away from
        // the block it started in. Terminating `then_block` instead would leave
        // the real tail without a terminator.
        let (then_tail, then_open, then_bindings) =
            self.lower_arm(|this| this.lower_narrowed_arm(condition, then_branch, true))?;
        paths.arm(&mut self.this, then_open);

        let (else_tail, else_open, else_bindings) = match else_branch {
            Some(else_branch) => {
                self.switch_to(else_block);
                self.lower_arm(|this| this.lower_narrowed_arm(condition, else_branch, false))?
            }
            // The false edge is the merge, which is open by construction and
            // changes nothing.
            None => (else_block, true, entry.clone()),
        };
        paths.arm(&mut self.this, else_open);
        self.this = paths.rejoin().map_err(|why| self.unsupported(id, why))?;

        if !then_open && !else_open {
            // Both arms ended. Anything after the `if` is unreachable, and the
            // enclosing block is already closed.
            return Ok(());
        }

        let merge = preallocated.unwrap_or_else(|| self.new_block());

        let mut merged: Vec<(u32, ValueId, ValueId)> = Vec::new();
        if then_open && else_open {
            for (symbol, entering) in &entry {
                let from_then = then_bindings.get(symbol).copied().unwrap_or(*entering);
                let from_else = else_bindings.get(symbol).copied().unwrap_or(*entering);
                if from_then != from_else {
                    merged.push((*symbol, from_then, from_else));
                }
            }
            // Sorted because the source is a hash map: without this the parameter
            // list would vary between runs of one compiler on one input, and the
            // snapshot digest would stop being a cache key.
            merged.sort_unstable();
        }

        let mut params = Vec::new();
        for (symbol, from_then, from_else) in &merged {
            let ty = self.merged_type(id, *symbol, *from_then, *from_else);
            params.push((*symbol, self.push_block_param(merge, ty, origin.clone())));
        }

        if then_open {
            self.switch_to(then_tail);
            let args = merged.iter().map(|(_, from_then, _)| *from_then).collect();
            self.terminate(Terminator::Jump {
                target: merge,
                args,
            });
        }
        if else_branch.is_some() {
            if else_open {
                self.switch_to(else_tail);
                let args = merged.iter().map(|(_, _, from_else)| *from_else).collect();
                self.terminate(Terminator::Jump {
                    target: merge,
                    args,
                });
            }
        } else {
            // The false edges point at the merge directly, so their arguments
            // live on the branches rather than on a jump of their own.
            let args: Vec<ValueId> = merged.iter().map(|(_, _, from_else)| *from_else).collect();
            for test in tests {
                if let Some(Terminator::Branch {
                    then_target,
                    then_args,
                    else_target,
                    else_args,
                    ..
                }) = &mut self.blocks[test.0 as usize].terminator
                {
                    for (target, passed) in [(*then_target, then_args), (*else_target, else_args)] {
                        if target == merge {
                            passed.clone_from(&args);
                        }
                    }
                }
            }
        }

        self.switch_to(merge);
        self.bindings = match (then_open, else_open) {
            // Only one arm reaches the merge, so its bindings are the live ones
            // outright — no parameter is needed to choose between them.
            (true, false) => then_bindings,
            (false, true) => else_bindings,
            _ => {
                let mut live = entry;
                for (symbol, param) in params {
                    live.insert(symbol, param);
                }
                live
            }
        };
        self.narrow_after_the_if(condition, then_open, else_open);
        Ok(())
    }

    /// Carry the surviving arm's narrowing past the `if`.
    ///
    /// **Where one arm left and the other did not, what the test proved on the
    /// surviving edge holds for everything after the `if`.**
    /// `if (!(h instanceof Timer)) return;` is the guard clause every JavaScript
    /// program writes and the shape `runtime/node/timers`' `listOnTimeout` uses:
    /// the then arm is closed, so the merge is reached only by the false edge, and
    /// on that edge `h` **is** a `Timer`. The mirror holds too --
    /// `if (h instanceof Timer) { ... } else return;` reaches the merge only
    /// through the then arm -- so one condition covers both, and it is
    /// `proved == then_open`: the surviving arm is the then arm exactly when it is
    /// the open one, and it carries the narrowing exactly when the test proved it
    /// for the true side.
    ///
    /// Sound because the merge has that single predecessor precisely when the arms
    /// disagree about leaving, which is what `then_open != else_open` says. With
    /// **both** open the merge joins a narrowed path and an unnarrowed one, and
    /// [`Self::merged_type`] already reimposes the declaration's type on the
    /// parameter -- so the narrowing widens back on the way out and there is
    /// nothing to do here.
    ///
    /// **And it does need unwinding, which a first version claimed it did not.**
    /// The claim was that a rebind reaches the enclosing `if`'s merge as one side
    /// of a disagreement and widens there -- true of an `if`, and false of a
    /// **loop**: `for (...) { if (!(s instanceof Square)) continue; ... }` narrows
    /// a value declared outside the loop, the unerase sits in the loop body, and a
    /// read after the loop is not dominated by it. `verify` said so as
    /// `NotDominated { value, used_in }`, on an arm written because the rule looked
    /// like it needed one rather than because reading suggested it. So the rebind
    /// is recorded on [`Self::narrowed_past_an_if`] and undone at the end of the
    /// statement list, which is the scope the language gives it anyway.
    fn narrow_after_the_if(&mut self, condition: NodeId, then_open: bool, else_open: bool) {
        if then_open != else_open
            && let Some((symbol, class, proved)) = self.instanceof_proved_by(condition)
            && proved == then_open
            && let Some(rebind) = self.narrow_binding(symbol, class, condition)
        {
            self.narrowed_past_an_if.push(rebind);
        }
    }
}

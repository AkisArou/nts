//! Build value-producing joins and short-circuit branches, using static branch facts where proved.

use super::{
    Branch, Diagnostic, FuncBuilder, HirType, LiteralValue, ManagedType, NodeId, OpKind, Origin,
    Terminator, TypeId, TypeKind, UnOp, ValueId, an_unchosen_collection, chooses, syntax,
};

/// A condition's own logical connective, which [`FuncBuilder::lower_jumps`]
/// lowers as branches.
#[derive(Clone, Copy)]
pub(super) enum Connective {
    And(NodeId, NodeId),
    Or(NodeId, NodeId),
    Not(NodeId),
}

impl FuncBuilder<'_> {
    /// Add a parameter to a block and return the value it defines.
    ///
    /// A block parameter is a value like any other, but it belongs to the block
    /// rather than to the operation list — nothing computes it, a predecessor
    /// supplies it.
    /// What a merged binding is typed as where the two arms disagree.
    ///
    /// It used to be the *then* arm's type outright, and that is a wrong answer
    /// rather than an imprecision:
    ///
    /// `let f: Mapper = (v) => v + k; if (pick) { f = (v) => v * k; } f(5)`
    ///
    /// Two arrows are two closure classes, siblings with no relation. Typing
    /// the merge as one of them tells every later pass that the value *is* that
    /// class -- so `devirtualize_closures` turns the call into a direct call to
    /// that arm's body, reachability then finds nothing calling the other, and
    /// the other body is **deleted**. The program answers 15 where node answers
    /// 8, on both pointer backends, because there is only one body left to
    /// call. The JVM lane could not compile it at all, and that is how it was
    /// found: an upcast is a pointer on two lanes and a checked store on the
    /// third.
    ///
    /// So the merge takes the binding's *declared* type -- `Mapper`, whose
    /// layout every closure of that signature is given as a base by
    /// `relate_closures_to_signatures`. The call is then a dispatch through the
    /// slot, which is what "call this closure, whichever it is" means, and both
    /// bodies stay reachable.
    ///
    /// Where there is no declared object type to take, this keeps the old
    /// answer rather than refusing. Merges whose arms disagree are common --
    /// dozens across five `runtime/node` modules, mostly two object types or an
    /// erased value against a concrete one -- and making every one of them
    /// honest means inserting coercions on the edges, which is a larger change
    /// than this and is not what makes the program above wrong.
    pub(super) fn merged_type(
        &mut self,
        id: NodeId,
        symbol: u32,
        from_then: ValueId,
        from_else: ValueId,
    ) -> HirType {
        let then_ty = self.values[from_then.0 as usize].ty.clone();
        let else_ty = self.values[from_else.0 as usize].ty.clone();
        if then_ty == else_ty {
            return then_ty;
        }
        // Only where both arms are objects, which is where a sibling pair can
        // masquerade as one class. An erased arm is already the top and needs
        // no help; a numeric pair is a width question this does not answer.
        if !matches!(
            (&then_ty, &else_ty),
            (
                HirType::Managed(ManagedType::Object(_)),
                HirType::Managed(ManagedType::Object(_))
            )
        ) {
            return then_ty;
        }
        // From the binding's *declaration node* rather than from
        // `SymbolRecord::ty`, which the checker leaves empty for an ordinary
        // local. `let f: Mapper = ...` writes the type on the declaration, and
        // that node is what `declarations` points at.
        let declared = self
            .snapshot
            .symbols
            .get(symbol as usize)
            .and_then(|record| {
                record.ty.or_else(|| {
                    record
                        .declarations
                        .first()
                        .and_then(|at| self.snapshot.node_types.get(at).copied())
                })
            })
            .and_then(|ty| self.represent(ty));
        let Some(declared @ HirType::Managed(ManagedType::Object(at))) = declared else {
            return then_ty;
        };
        // Whenever it resolves, not only when it differs from both arms. An
        // `else if` nests a merge inside a merge, so the outer one sees the
        // inner merge's parameter -- already the declared type -- on one side
        // and a concrete closure on the other. Treating "equals one arm" as
        // "nothing to do" then took the *other* arm's concrete type and put the
        // bug back one level out: `threeWays` answered as though the first
        // branch had been taken, whichever it was.
        //
        // And the type has to have a layout, because a merge is the *first*
        // place this one is used as a value: a signature is written on a
        // declaration and never allocated, so nothing else would ask for one,
        // and a backend handed a type id with no layout declines the whole
        // function. The old answer is kept where it cannot be had -- a decline
        // is not an improvement on an imprecise type.
        if self.layout_of(id, at).is_err() {
            return then_ty;
        }
        declared
    }

    /// `first || second`, or `first && second`, over two booleans.
    ///
    /// A branch and **not** [`BinOp::BitOr`](crate::hir::BinOp::BitOr). Every backend routes the bitwise
    /// operators through `ToInt32` -- C casts both operands, the JVM narrows
    /// them with `d2i` -- because the language only ever produces one on
    /// numbers: TypeScript rejects `a | b` on two `boolean`s, so no program has
    /// ever put a bool on either side of one. Making this the first place would
    /// rest on three separate backends happening to do the right thing with an
    /// operand shape none of them was written for, and would fail silently in
    /// whichever one did not.
    ///
    /// Both operands are built before the branch rather than the second one
    /// inside it, which gives up the short circuit and buys the thing that
    /// matters here: every test this joins is `NTS_READS_ONLY`, allocates
    /// nothing and cannot throw, so *where* it runs is not observable -- and a
    /// value defined in the block that dominates both arms reaches them with no
    /// block parameter to carry it.
    pub(super) fn bool_join(
        &mut self,
        first: ValueId,
        second: ValueId,
        or: bool,
        origin: &Origin,
    ) -> ValueId {
        let taken = self.new_block();
        let other = self.new_block();
        let merge = self.new_block();
        self.terminate(Terminator::Branch {
            cond: first,
            then_target: if or { taken } else { other },
            then_args: Vec::new(),
            else_target: if or { other } else { taken },
            else_args: Vec::new(),
        });
        let answer = self.push_block_param(merge, HirType::Bool, origin.clone());
        // The arm the first operand settles on its own: `true` for `||` and
        // `false` for `&&`.
        self.switch_to(taken);
        let settled = self.push(OpKind::ConstBool(or), HirType::Bool, origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![settled],
        });
        self.switch_to(other);
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![second],
        });
        self.switch_to(merge);
        answer
    }

    /// `if (c) { .. } else { .. }`.
    ///
    /// # The merge is where the arms have to agree
    ///
    /// Each arm may leave a different value in the same name. After the `if`,
    /// which one is live depends on the edge taken — which is precisely what a
    /// block parameter is for, and the same mechanism a loop header uses.
    ///
    /// Without it, the name keeps whatever value the last-lowered arm produced,
    /// defined in a block the merge does not dominate. That is invalid SSA. It
    /// also *compiles*, to code that reads a variable the other path never wrote,
    /// which is why the verifier exists rather than a code review.
    ///
    /// Only names the arms disagree about become parameters. One they agree on is
    /// already defined before the branch — two arms cannot produce the same
    /// [`ValueId`] otherwise — so it dominates the merge, and a parameter for it
    /// would be a copy carrying no information.
    /// Whether this condition is decided before the program runs.
    ///
    /// Read off the **checker's** type and nothing else: `const x = false` has
    /// type `false`, `if (false)` has type `false`, and an import of either
    /// carries it across the module boundary. So the folding is already done and
    /// this reads the answer.
    ///
    /// **`const x: boolean = false` answers `None`, and that is not a gap this
    /// can close.** The annotation widens the type deliberately, so the checker
    /// says `boolean` and the initialiser is the only remaining evidence.
    /// Reading it would mean re-deciding a question the checker answered -- a
    /// second derivation of "what is this constant", and the one place the two
    /// could disagree is a program whose author widened the type *because* they
    /// intend to change the value.
    pub(super) fn statically_decided(&self, condition: NodeId) -> Option<bool> {
        self.decided_value(condition, 0)
    }

    /// The value a condition is decided to have, reading only the operands the
    /// decision actually depends on.
    ///
    /// **Short-circuiting is what makes this more than a tidy-up.** The guard below
    /// declines a condition that reads a mutable binding, because the checker's
    /// narrowed literal type is stale for one a closure assigns. Applied to the
    /// *whole* condition it is too blunt for the commonest real shape:
    ///
    /// ```ts
    /// if (isDevelopment && !hasLoggedError) { ... }
    /// ```
    ///
    /// where `isDevelopment` is a `const` the checker decided is `false` and
    /// `hasLoggedError` is a module-scope `let`. `false && x` is decided **without
    /// evaluating `x`**, so whether `x` is mutable cannot matter -- and declining
    /// here left the dead branch lowered and refusing. The React lane sampled the
    /// ten roots this guard cost them and **seven were this shape**.
    ///
    /// So each operator asks only what it needs: `a && b` is `false` when `a` is,
    /// whatever `b` says; `a || b` is `true` when `a` is; and only when the first
    /// operand does not decide it does the second get asked. A mutable read in an
    /// operand the decision never reaches is irrelevant by the language's own
    /// evaluation order, which is why this fails safe -- it needs no enumeration of
    /// assignment forms, because the operand it ignores is one nothing evaluates.
    ///
    /// `hasLoggedError && ...` on its own still declines, which is the case the
    /// guard exists for.
    fn decided_value(&self, condition: NodeId, depth: u32) -> Option<bool> {
        if depth > 16 {
            return None;
        }
        let parts = self.children(condition);
        if self.kind_of(condition) == Some(syntax::BINARY_EXPRESSION)
            && let [left, operator, right] = parts.as_slice()
        {
            let (left, operator, right) = (*left, *operator, *right);
            let and = match self.kind_of(operator) {
                Some(syntax::AMPERSAND_AMPERSAND_TOKEN) => true,
                Some(syntax::BAR_BAR_TOKEN) => false,
                _ => {
                    return self
                        .decided_typeof(condition)
                        .or_else(|| self.the_checker_decided(condition));
                }
            };
            // `false && b` is `false` and `true || b` is `true`, and neither reads
            // `b`. Otherwise the answer *is* `b`'s.
            return match self.decided_value(left, depth + 1) {
                Some(known) if known != and => Some(known),
                Some(_) => self.decided_value(right, depth + 1),
                None => None,
            };
        }
        self.the_checker_decided(condition)
    }

    /// `typeof value === "number"`, where this copy re-typed `value` to the one
    /// member of its union its callers pass (`union_member_retype`) and nothing
    /// assigns it: the member decides the test, and the other members'
    /// branches are dead here.
    fn decided_typeof(&self, condition: NodeId) -> Option<bool> {
        if self.retyped_symbols.is_empty()
            || self.kind_of(condition) != Some(syntax::BINARY_EXPRESSION)
        {
            return None;
        }
        let children = self.children(condition);
        let [left, operator, right] = children.as_slice() else {
            return None;
        };
        let equal = match self.kind_of(*operator)? {
            syntax::EQUALS_EQUALS_EQUALS_TOKEN | syntax::EQUALS_EQUALS_TOKEN => true,
            syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_TOKEN => false,
            _ => return None,
        };
        let (left, right) = (
            self.through_parentheses(*left),
            self.through_parentheses(*right),
        );
        let (tested, tag) = if self.kind_of(left) == Some(syntax::TYPE_OF_EXPRESSION) {
            (left, right)
        } else {
            (right, left)
        };
        if self.kind_of(tested) != Some(syntax::TYPE_OF_EXPRESSION) {
            return None;
        }
        let tag = self
            .snapshot
            .node_types
            .get(&tag)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .and_then(|record| match &record.kind {
                TypeKind::Literal(LiteralValue::String(text)) => text.as_utf8(),
                _ => None,
            })?;
        let operand = self.through_parentheses(*self.children(tested).first()?);
        if self.kind_of(operand) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let symbol = self.node(operand).symbol?.0;
        if !self.member_retyped.contains(&symbol) {
            return None;
        }
        let member = self.retyped_symbols.get(&symbol)?;
        let parameter = self
            .snapshot
            .symbols
            .get(symbol as usize)?
            .declarations
            .iter()
            .copied()
            .find(|at| self.kind_of(*at) == Some(syntax::PARAMETER))?;
        let mut function = self.node(parameter).parent?;
        while self.kind_of(function).is_none() {
            function = self.node(function).parent?;
        }
        let mut assigned = Vec::new();
        self.assigned_symbols(function, &mut assigned);
        if assigned.contains(&symbol) {
            return None;
        }
        Some((self.spelling_for(member)? == tag) == equal)
    }

    /// The checker's literal answer for a condition, where the condition reads
    /// nothing that can change under it.
    fn the_checker_decided(&self, condition: NodeId) -> Option<bool> {
        if self.initialization.can_raise_at(condition) {
            return None;
        }
        let ty = self.snapshot.node_types.get(&condition)?;
        match &self.snapshot.types.get(ty.0 as usize)?.kind {
            TypeKind::Literal(LiteralValue::Boolean(known)) => {
                (!self.reads_a_binding_that_can_change(condition)).then_some(*known)
            }
            _ => None,
        }
    }

    /// Whether an expression reads a binding whose value can change after the
    /// checker typed it.
    ///
    /// **The checker's narrowed literal type is not a fact about a mutable
    /// binding.** TypeScript's control-flow analysis does not see an assignment
    /// made inside a closure, so
    ///
    /// ```ts
    /// let called = false;
    /// const guard = (): void => { if (called) return; called = true; ... };
    /// twice(guard);
    /// if (called) { ... }          // the checker still says `false`
    /// ```
    ///
    /// types `called` as the literal `false` at the `if`, having watched nothing
    /// assign it in the enclosing function. Folding on that answer takes the
    /// wrong arm, and `tests/programs/captured-by-reference` disagrees with node on 28
    /// cases -- which it did from the day `folded_branch` landed until this guard,
    /// silently, because a refusal census cannot see a program that compiles and
    /// answers wrongly.
    ///
    /// A `const` is safe and is what every fold this is meant to keep reads:
    /// `isDevelopment` in React's development guard, and the `w` of `!!w &&
    /// w.writable !== false` in `Writable#get writable`. A `let`, a `var` and a
    /// parameter are not -- a parameter because a closure can assign one too, and
    /// refusing costs nothing since a parameter typed as a boolean *literal* is
    /// vanishingly rare.
    ///
    /// The whole subtree rather than the node itself, because the condition is
    /// usually an expression around the binding rather than the binding: `!flag`,
    /// `flag && other`, `!!w`.
    fn reads_a_binding_that_can_change(&self, id: NodeId) -> bool {
        if self.kind_of(id) == Some(syntax::IDENTIFIER)
            && let Some(symbol) = self.node(id).symbol
            && let Some(record) = self.snapshot.symbols.get(symbol.0 as usize)
            && record
                .declarations
                .iter()
                .any(|at| self.binding_can_be_written(*at))
        {
            return true;
        }
        self.children(id)
            .into_iter()
            .any(|child| self.reads_a_binding_that_can_change(child))
    }

    /// Whether a declaration binds a name something can assign to.
    ///
    /// The `let`/`var` answer comes from the **list's** flags and not the
    /// declaration's, which is the mistake a guard written for this one construct
    /// over already made: a declaration's immediate parent is the list's
    /// `NodeKind::List`, for which `kind_of` answers `None`, so every declaration
    /// looked non-writable and the guard could not fire. A guard that cannot fire
    /// is worse than no guard, because it reads as protection.
    fn binding_can_be_written(&self, at: NodeId) -> bool {
        match self.kind_of(at) {
            Some(syntax::PARAMETER) => true,
            Some(syntax::VARIABLE_DECLARATION) => self
                .ancestor(at, syntax::VARIABLE_DECLARATION_LIST)
                .is_some_and(|list| {
                    nts_semantic_schema::VariableKind::from_flags(self.node(list).flags)
                        != nts_semantic_schema::VariableKind::Const
                }),
            _ => false,
        }
    }

    /// Whether skipping this statement would lose a binding that outlives it.
    ///
    /// `var` hoists to the function and a nested `function` declaration is a
    /// hoisted binding, so either one inside a dead branch is still a name the
    /// code after the `if` can read. Folding the branch away would leave that
    /// name undeclared -- a refusal rather than a wrong answer, and a refusal
    /// pointing at the use rather than at the fold.
    ///
    /// A whole-subtree walk, because the declaration may be nested in a block.
    ///
    /// **I could not produce a program that reaches this, and that is worth
    /// writing down rather than leaving it to read as protection.** Under
    /// `strict` -- which `tsconfig.fixtures.json` sets and every program here
    /// inherits -- TypeScript rejects both shapes on its own: a `var` assigned
    /// only in a dead branch is "used before being assigned", and a `function`
    /// declaration in a block is block-scoped, so calling it outside is an error
    /// before this compiler sees the file. It stays because what it guards is a
    /// *language* rule and not a tsconfig setting: a project without `strict`
    /// can write either, and the cost of the guard is one subtree walk per
    /// folded branch.
    pub(super) fn hoists_out_of(&self, at: NodeId) -> bool {
        match self.kind_of(at) {
            Some(syntax::FUNCTION_DECLARATION) => return true,
            // From the list's own flags, which is where `const`/`let`/`var`
            // lives -- the same read `lower_variable_statement` makes.
            Some(syntax::VARIABLE_DECLARATION_LIST)
                if nts_semantic_schema::VariableKind::from_flags(self.node(at).flags)
                    == nts_semantic_schema::VariableKind::Var =>
            {
                return true;
            }
            _ => {}
        }
        self.children(at)
            .into_iter()
            .any(|child| self.hoists_out_of(child))
    }

    pub(super) fn lower_branching_value(
        &mut self,
        id: NodeId,
        condition: ValueId,
        then_branch: Branch,
        else_branch: Branch,
    ) -> Result<ValueId, Diagnostic> {
        // A merge's parameter is a slot: both arms have to arrive at one width.
        // `c ? null : null` has none, for the reason [`Self::holds_only_absences`]
        // carries, and `Erased` is the representation that holds the one value
        // such a merge can carry.
        let ty = match self.snapshot.node_types.get(&id).copied() {
            Some(ty) if self.holds_only_absences(ty) => HirType::Erased,
            _ => self
                .type_of(id)
                .ok_or_else(|| self.unrepresentable(id, "a conditional"))?,
        };
        let ty = self.instead_of_an_unchosen_collection(id, ty);
        self.lower_branching_value_at(id, ty, condition, then_branch, else_branch)
    }

    /// The collection `id` is, where its type is [`an_unchosen_collection`]
    /// only because a library overload answered for it: the collection where
    /// it goes, if that one [`chooses`] something.
    ///
    /// One rule at every place such a type arrives: the allocation itself
    /// (`new Array(n)` in [`Self::allocated_array_type`], `new Map()` and
    /// `new Set()` in [`Self::lower_new`]), the choice an allocation is an arm
    /// of, and what that choice tells its arms
    /// ([`Self::what_the_whole_expression_is`]), so all of them agree.
    ///
    /// `size === 0 ? null : new Array(size)` is typed `any[]`: the `null` is
    /// absorbed and `new Array`'s declared `any[]` is what is left, which is the
    /// library's overload and nothing the program chose. Where the choice is
    /// stored into a typed array -- a `Vector<E>`'s `E[] | null` storage -- that
    /// array is what the choice is. `seed ? undefined : new Map()` returned as
    /// a `Map<string, number> | undefined` is the same with the zero-argument
    /// `new (): Map<any, any>`, and Wasm, which builds a table's storage from
    /// its type, declined the erased one handed to the typed return.
    ///
    /// Where the expression is first, then past any choice that passes it on.
    /// Only from an unchosen collection to a chosen one of the same kind: a
    /// `const m = new Map()` with nothing around it keeps `Map<any, any>`, and
    /// an arm that really is erased then fails the width check and is refused,
    /// never reinterpreted.
    pub(super) fn instead_of_an_unchosen_collection(&self, id: NodeId, ty: HirType) -> HirType {
        if !an_unchosen_collection(&ty) {
            return ty;
        }
        let destination = self.past_the_choices(id);
        self.contextual_type(id, 0)
            .filter(|wanted| chooses(&ty, wanted))
            .or_else(|| {
                (destination != id)
                    .then(|| self.contextual_type(destination, 0))
                    .flatten()
                    .filter(|wanted| chooses(&ty, wanted))
            })
            .unwrap_or(ty)
    }

    /// The same, at a type the caller supplies rather than the node's own.
    ///
    /// A conditional written in the source has a type the checker gave it, and
    /// [`Self::lower_branching_value`] reads it off the node. A branch this
    /// compiler *synthesises* has no such node: `defaulted_array_element` builds
    /// one whose arms are an element read and `undefined`, and its merge is
    /// erased whatever the node it is anchored to happens to be.
    ///
    /// Anchoring it to a node with the wrong type would have merged two erased
    /// values into a concrete parameter, which is the shape the arm-reconciling
    /// below exists to catch in the other direction.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn lower_branching_value_at(
        &mut self,
        id: NodeId,
        ty: HirType,
        condition: ValueId,
        then_branch: Branch,
        else_branch: Branch,
    ) -> Result<ValueId, Diagnostic> {
        // The node each arm's *value* came from, where there is one. A merge's
        // own node carries the whole expression's type, which for an optional
        // chain is `T | null | undefined` -- both absences at once, and so no
        // answer about which a null pointer means. See `coerce_from`.
        let arm_node = |branch: &Branch| match branch {
            Branch::Expression(at) | Branch::Assigned(at, _) => Some(*at),
            _ => None,
        };
        let (then_node, else_node) = (arm_node(&then_branch), arm_node(&else_branch));
        // Whether each arm *is* the short-circuit's `undefined`, which the other
        // arm's absence has to set aside.
        let then_absent = matches!(then_branch, Branch::Absent);
        let else_absent = matches!(else_branch, Branch::Absent);
        let origin = self.origin(id);
        let then_block = self.new_block();
        let else_block = self.new_block();
        self.terminate(Terminator::Branch {
            cond: condition,
            then_target: then_block,
            then_args: Vec::new(),
            else_target: else_block,
            else_args: Vec::new(),
        });

        let entry = self.bindings.clone();
        self.switch_to(then_block);
        let then_value = self.evaluate(id, then_branch)?;
        let then_tail = self.current;
        let then_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        self.switch_to(else_block);
        let else_value = self.evaluate(id, else_branch)?;
        let else_tail = self.current;
        let else_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        // The two arms have to agree about representation, since one parameter
        // receives both -- and they are made to agree rather than assumed to.
        //
        // The assumption held while a union had no representation: `number |
        // string` was not lowerable, so a conditional that produced one was
        // refused before reaching here. Now it is an erased value, and
        // `n > 0 ? n : undefined` has a `double` on one arm and a tagged value
        // on the other. The join took the erased type and the first arm passed
        // the double straight through, which the C compiler reported as
        // assigning a `double` to an `NtsValue` -- with no source location and
        // nothing naming the join.
        // **Where both arms already agree on a concrete representation, that is
        // the merge type — whatever the checker called the conditional.**
        //
        //     interface Box { items?: number[] }
        //     const b: Box = cond ? { items: [1, 2] } : {};
        //
        // is a union of two literal shapes, so the checker's type erases, and
        // the erased value then met the declaration: `an erased value where a
        // concrete representation is wanted`. But both arms were lowered
        // *expecting* `Box` — every literal in this compiler now asks the slot —
        // so both are already a `Box` by the time they arrive here, and erasing
        // them to merge and unerasing to store is work to undo work.
        //
        // **Asked of the arms rather than of the slot**, which is the whole
        // correction: a first version took `expecting` when the checker's type
        // erased, and that is wrong for `h.fn?.(n)`, whose union contains a
        // genuine *absence*. The slot there is a number and the value may be
        // `undefined`; what resolves it is the `??` after it, not the slot. The
        // arms are the evidence and they disagree, so it stays erased.
        //
        // Only when the checker said `Erased`, so nothing that already lowered
        // can change.
        let ty = match (
            &ty,
            &self.values[then_value.0 as usize].ty,
            &self.values[else_value.0 as usize].ty,
        ) {
            (HirType::Erased, from_then, from_else)
                if from_then == from_else && *from_then != HirType::Erased =>
            {
                from_then.clone()
            }
            _ => ty,
        };
        let merge = self.new_block();
        // A conditional whose arms are two closures has the *signature* as its
        // type, which is the right answer and the one nothing else
        // materialises: a signature is written on a declaration and never
        // allocated, so this merge is the first place it is used as a value.
        //
        // **Through containers, not only at the top level.** This tested
        // `Managed(Object(_))` and nothing else, so an *array* of signatures
        // went unlaid: `cond ? [() => n] : []` merges at
        // `managed<[managed<obj#9>]>` while both arms built `obj#5`, two type
        // ids for one function type, and only the arms' one had a layout. The
        // C emitter then said `NTS2006 an object type with no layout: type 9`
        // -- a message about a type rather than about a line, from the backend,
        // on a program the lowering reported as clean.
        //
        // `materialize` is the walk that already answers this for an array's
        // element, a map's value and a set's member, and it is the same
        // question here one level in. `collect_layouts` merges the two by
        // shape once both exist.
        let _ = self.materialize(id, &ty);
        // **A `Void` conditional has no value to merge.** `x?.m()` for a `void`
        // `m` is `undefined | void`, one absence written twice, which represents
        // as `Void` -- and the C backend declares no variable for a value of
        // that type, so a block parameter carrying one is assigned from both
        // arms and read in the merge as an identifier nothing declared. Seven
        // `use of undeclared identifier` errors in one example, which is how
        // this was found: the change that gave the union a representation made
        // the compiler accept an expression it could not emit.
        //
        // The arms are still evaluated -- the call is the point of the
        // expression -- and only the *value* is dropped. What the expression
        // yields is `undefined`, which is what a `void` call yields anyway, so
        // it is materialized in the merge block rather than carried into it.
        let carries_a_value = !matches!(ty, HirType::Void);
        let merged_value =
            carries_a_value.then(|| self.push_block_param(merge, ty.clone(), origin.clone()));

        let mut merged = Vec::new();
        for (symbol, entering) in &entry {
            let from_then = then_bindings.get(symbol).copied().unwrap_or(*entering);
            let from_else = else_bindings.get(symbol).copied().unwrap_or(*entering);
            if from_then != from_else {
                merged.push((*symbol, from_then, from_else));
            }
        }
        merged.sort_unstable();

        let mut params = Vec::new();
        for (symbol, from_then, from_else) in &merged {
            let carried = self.merged_type(id, *symbol, *from_then, *from_else);
            params.push((
                *symbol,
                self.push_block_param(merge, carried, origin.clone()),
            ));
        }

        self.switch_to(then_tail);
        let mut args = Vec::new();
        if carries_a_value {
            // From the **arm's** node, not the merge's: see `coerce_from`.
            args.push(self.coerce_arm(
                then_value,
                &ty,
                id,
                then_node.unwrap_or(id),
                else_absent,
            )?);
        }
        args.extend(merged.iter().map(|(_, from_then, _)| *from_then));
        self.terminate(Terminator::Jump {
            target: merge,
            args,
        });

        self.switch_to(else_tail);
        let mut args = Vec::new();
        if carries_a_value {
            args.push(self.coerce_arm(
                else_value,
                &ty,
                id,
                else_node.unwrap_or(id),
                then_absent,
            )?);
        }
        args.extend(merged.iter().map(|(_, _, from_else)| *from_else));
        self.terminate(Terminator::Jump {
            target: merge,
            args,
        });

        self.switch_to(merge);
        self.bindings = entry;
        for (symbol, param) in params {
            self.bindings.insert(symbol, param);
        }
        Ok(match merged_value {
            Some(param) => param,
            None => self.push(OpKind::ConstUndefined, ty, origin),
        })
    }

    /// Produce a branch's value: either an expression to lower here, or one
    /// already computed before the branch.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn evaluate(&mut self, id: NodeId, branch: Branch) -> Result<ValueId, Diagnostic> {
        match branch {
            Branch::CallableProjection(projection) => self.project_callable(id, projection),
            Branch::CallableSupplier(projection) => self.callable_supplier(id, &projection),
            Branch::Expression(node) => self.lower_expression(node),
            Branch::Value(value) => Ok(value),
            Branch::ParameterDefault {
                call,
                default,
                callee,
                before,
                receiver,
            } => self.lower_parameter_default(call, default, callee, &before, receiver),
            Branch::Absent => {
                let ty = self
                    .type_of(id)
                    .ok_or_else(|| self.unrepresentable(id, "an optional access"))?;
                let origin = self.origin(id);
                Ok(self.push(OpKind::ConstUndefined, ty, origin))
            }
            Branch::Invoke(callee, callee_node, present) => {
                // Here and not before the branch, for the reason above.
                let callee = match present {
                    Some(ty) => {
                        let origin = self.origin(callee_node);
                        self.push(OpKind::unerase(callee), ty, origin)
                    }
                    None => callee,
                };
                let arguments = self.arguments_of(id);
                let this = self.read_from.get(&callee_node).copied();
                self.call_through_closure(id, callee_node, callee, this, &arguments)
            }
            Branch::MethodOn(receiver, receiver_node, member, present) => {
                // Here and not before the branch, for the reason above.
                let receiver = match present {
                    Some(ty) => {
                        let origin = self.origin(receiver_node);
                        self.push(OpKind::unerase(receiver), ty, origin)
                    }
                    None => receiver,
                };
                let arguments = self.arguments_of(id);
                self.lower_method_on(id, receiver, receiver_node, member, &arguments)
            }
            Branch::Element(receiver, index, present) => {
                // Here and not before the branch, for the reason above.
                let receiver = match present {
                    Some(ty) => {
                        let origin = self.origin(index);
                        self.push(OpKind::unerase(receiver), ty, origin)
                    }
                    None => receiver,
                };
                let index = self.lower_expression(index)?;
                self.element_of(id, receiver, index)
            }
            Branch::ArrayElement { array, index, ty } => {
                let origin = self.origin(id);
                Ok(self.push(
                    OpKind::ArrayGet {
                        array,
                        index,
                        checked: true,
                    },
                    ty,
                    origin,
                ))
            }
            Branch::Chain {
                link,
                receiver,
                present,
                rest,
            } => {
                let receiver = match present {
                    Some(ty) => {
                        let origin = self.origin(link);
                        self.push(OpKind::unerase(receiver), ty, origin)
                    }
                    None => receiver,
                };
                self.chain_present.insert(link, receiver);
                let value = self.chain_step(id, &rest);
                self.chain_present.remove(&link);
                value
            }
            Branch::Member(receiver, member, present) => {
                // Here and not before the branch. Reading the payload of a
                // value that may be absent is the thing the test exists to
                // prevent, and `evaluate` runs with the arm's block current.
                let receiver = match present {
                    Some(ty) => {
                        let origin = self.origin(member);
                        self.push(OpKind::unerase(receiver), ty, origin)
                    }
                    None => receiver,
                };
                let object = self.children(id).first().copied().unwrap_or(member);
                self.member_on_present(id, object, member, receiver)
            }
            // At the type the whole expression has, which is what `id` is.
            // Without this, `const chosen: number = limit || 1` handed a
            // `number` block parameter an erased value -- rejected by the
            // verifier, and before that check existed, by clang.
            Branch::Assigned(node, place) => {
                let value = self.lower_expression(node)?;
                // `write_place` coerces to what the slot holds; the value the
                // *expression* has is the one assigned, which the join then
                // coerces to the type of the whole thing. Those are the same
                // value at two representations, and conflating them would
                // store a `double` into an erased field.
                self.write_place(id, &place, value)?;
                Ok(value)
            }
            Branch::Present(value) => self.narrowed(id, value),
            Branch::Unerased(value, ty) => {
                let origin = self.origin(id);
                Ok(self.push(OpKind::unerase(value), ty, origin))
            }
            Branch::ObjcGetter(receiver, object, property) => {
                self.send_objc_getter(id, object, &property, Some(receiver))
            }
        }
    }

    /// `c ? a : b`.
    pub(super) fn lower_conditional(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // condition, `?`, whenTrue, `:`, whenFalse — the punctuation is made of
        // children too, so the slots come from the presence bitmask.
        let Some([Some(condition), _, Some(when_true), _, Some(when_false)]) =
            self.child_slots::<5>(id)
        else {
            return Err(self.unsupported(id, "a conditional of unexpected shape"));
        };
        // **A decided condition takes its arm, and the other is not lowered** --
        // [`Self::folded_branch`]'s rule for an `if`, and the same one
        // [`Self::lower_logical`] applies to a dead `&&` operand.
        //
        // This one is the load-bearing member of the three, and the measurement
        // that says so is a reverted commit. Folding `&&` alone turned
        //
        //     const createTask: (name: string) => Task | null =
        //       isDevelopment && typeof console.createTask === "function"
        //         ? (name) => console.createTask!(name)
        //         : (_name) => null;
        //
        // into `%0 = const false; br %0, b1, b2` with **both** arms still lowered,
        // both closures refused, and their values carried through block arguments
        // into a merge parameter -- which is the one thing
        // `excise_from_initializer` cannot cut, so module evaluation was dropped
        // *whole* rather than the binding cut. One statement left every
        // module-scope binding in the program unwritten, and 620 of the React
        // lane's cascades were one later module reading one of them.
        //
        // Folding here removes all three halves of that at once: the dead arm is
        // never lowered (so its `console` refusal never happens), there is no
        // branch and no block parameter (so the cut is narrow again), and the
        // `&&` fold becomes safe to keep.
        //
        // The condition is still lowered, for [`Self::lower_logical`]'s reason:
        // `f() ? a : b` where `f` returns `false` decides the arm and still makes
        // the call.
        if let Some(taken) = self.statically_decided(condition) {
            self.lower_expression(condition)?;
            return self.lower_expression(if taken { when_true } else { when_false });
        }
        let condition = self.lower_expression(condition)?;
        let condition = self.truthy(id, condition);
        self.lower_branching_value(
            id,
            condition,
            Branch::Expression(when_true),
            Branch::Expression(when_false),
        )
    }

    /// `a ?? b` -- `a` unless `a` is absent.
    ///
    /// The same shape as [`Self::lower_logical`] and deliberately not the same
    /// test. `||` asks whether the left operand is *truthy*, so `0 || 1` is
    /// `1`; `??` asks whether it is `null` or `undefined`, so `0 ?? 1` is `0`.
    /// Telling those apart is the whole reason the operator exists, which is
    /// why this is its own lowering rather than a desugaring to `||`.
    ///
    /// The left operand is lowered once, before the branch, so it is evaluated
    /// once however the test goes.
    pub(super) fn lower_nullish(
        &mut self,
        id: NodeId,
        left: NodeId,
        right: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let first = self.lower_expression(left)?;
        let Some(absent) = self.absence_of(left, first) else {
            // Nothing to test. A value with no room for an absence is never
            // absent, so the result is the left operand and the right one is
            // never evaluated -- which is what the specification says happens,
            // rather than an optimization of it. TypeScript permits the shape
            // and reports it as unnecessary.
            return self.narrowed(id, first);
        };
        self.lower_branching_value(
            id,
            absent,
            Branch::Expression(right),
            Branch::Present(first),
        )
    }

    /// `a && b` and `a || b`, which do not evaluate `b` unless they have to.
    pub(super) fn lower_logical(
        &mut self,
        id: NodeId,
        and: bool,
        left: NodeId,
        right: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let first = self.lower_expression(left)?;
        // **A dead operand is not lowered**, which is [`Self::folded_branch`]'s
        // rule one operator over and for the same reason: a construct the
        // program cannot reach should not decide whether it compiles.
        // `isDevelopment && typeof console.createTask === "function"` with
        // `isDevelopment` a `const` bound to `false` is React's own guard, and
        // the `if` spelling of it has folded since `7c3fc82f9` while this one
        // still refused -- for a `console` member on the side that never runs.
        //
        // It is a **lowering** change and not an analysis one, which is the part
        // that took a wrong turn first: the refusal is raised *while lowering*
        // the dead operand, so `children_that_run` -- which decides what a walk
        // over already-lowered code visits -- never sees it. There is nothing to
        // prune afterwards, because the diagnostic happens on the way in.
        //
        // No `hoists_out_of` guard, and that is a difference in the language
        // rather than an omission: a dead *statement* can declare a `var` or a
        // `function` that outlives it, and an expression has neither form to
        // declare. Skipping the operand is also exactly what JavaScript does --
        // `false && f()` never calls `f` -- so this is short-circuiting rather
        // than an optimisation, and the only thing it changes is what a program
        // has to be able to compile in order to run.
        //
        // `left` is still lowered. `f() && b` where `f` returns `false` decides
        // the operator and still makes the call.
        // An operand that is an object whatever runs decides it too: `obj &&
        // flag` is `flag`, and the other arm would be the object read as the
        // boolean the expression is typed (`blockers/an-object-and-a-boolean-as-a-value`).
        if let Some(known) = self
            .statically_decided(left)
            .or_else(|| self.never_falsy(left).then_some(true))
        {
            let short_circuits = if and { !known } else { known };
            // `false && b` is `false` and `true || b` is `true`: the answer is
            // the operand already lowered.
            if short_circuits {
                return Ok(first);
            }
            // `true && b` is `b`, and `false || b` is `b`, whatever `b`'s type.
            return self.lower_expression(right);
        }
        let condition = self.truthy(id, first);
        // `a && b` is `b` when `a` is truthy and `a` otherwise; `a || b` is the
        // other way round. Neither yields a bool in general — `0 || 5` is `5`.
        // `&&` keeps its first operand where it is *falsy*, and `undefined` is
        // falsy -- so that arm is `Value` and not `Present`.
        let (then_branch, else_branch) = if and {
            (Branch::Expression(right), Branch::Value(first))
        } else {
            (Branch::Present(first), Branch::Expression(right))
        };
        self.lower_branching_value(id, condition, then_branch, else_branch)
    }

    /// A value as a condition, by JavaScript's rules.
    /// Whether an expression is an object whatever runs, so never falsy: its
    /// type an object, an array, a tuple, a function or a symbol.
    ///
    /// **Read off the declared type where the expression reads a binding or a
    /// property**, never the narrowed one at the read: a `Foo | null` the checker
    /// narrowed to `Foo` is stale where a closure assigns the binding, which is
    /// the hazard [`Self::reads_a_binding_that_can_change`] records. Any other
    /// expression -- a call, a `new`, a literal -- is not a narrowing of
    /// anything, and its own type is the answer.
    fn never_falsy(&self, node: NodeId) -> bool {
        let declared = match self.kind_of(node) {
            Some(syntax::PARENTHESIZED_EXPRESSION) => {
                return self
                    .children(node)
                    .first()
                    .is_some_and(|inner| self.never_falsy(*inner));
            }
            Some(syntax::IDENTIFIER) => self
                .node(node)
                .symbol
                .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
                .and_then(|record| record.ty),
            // The property as its object's type declares it.
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => {
                let parts = self.children(node);
                let (Some(object), Some(member)) = (parts.first(), parts.last()) else {
                    return false;
                };
                let name = self.literal_name(*member);
                self.snapshot
                    .node_types
                    .get(object)
                    .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
                    .and_then(|record| match &record.kind {
                        TypeKind::Object { properties } => properties
                            .iter()
                            .find(|property| property.name.public_name() == name.as_deref())
                            .map(|property| property.ty),
                        #[expect(
                            clippy::match_same_arms,
                            reason = "keep audited semantic type variants explicit"
                        )]
                        TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
                        _ => None,
                    })
            }
            _ => self.snapshot.node_types.get(&node).copied(),
        };
        let Some(declared) = declared else {
            return false;
        };
        let always = |ty: TypeId| {
            matches!(
                self.snapshot
                    .types
                    .get(ty.0 as usize)
                    .map(|record| &record.kind),
                Some(
                    TypeKind::Object { .. }
                        | TypeKind::Array(_)
                        | TypeKind::Tuple(_)
                        | TypeKind::Function(_)
                        | TypeKind::Symbol
                        | TypeKind::UniqueSymbol
                        | TypeKind::NonPrimitive
                )
            )
        };
        match self
            .snapshot
            .types
            .get(declared.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Union(members)) => members.iter().all(|member| always(*member)),
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => always(declared),
            _ => always(declared),
        }
    }

    pub(super) fn truthy(&mut self, id: NodeId, value: ValueId) -> ValueId {
        // A bool is already its own condition; anything else needs the rule.
        if matches!(self.values[value.0 as usize].ty, HirType::Bool) {
            return value;
        }
        let origin = self.origin(id);
        self.push(
            OpKind::Unary {
                op: UnOp::Truthy,
                operand: value,
            },
            HirType::Bool,
            origin,
        )
    }

    /// The arm a conditional the checker has already decided actually reaches.
    ///
    /// Returns its argument when there is nothing to decide, so a caller can ask
    /// without first knowing whether it has a conditional in hand.
    ///
    /// `child_slots` rather than filtering the punctuation out of `children`,
    /// because `lower_conditional` reads the arms that way and a second spelling
    /// of "which child is `whenFalse`" is a second thing to get wrong. Nested
    /// conditionals resolve to the end -- `a ? b : c ? d : e` with both tests
    /// decided is one name -- and the loop is bounded because every step moves
    /// strictly into a child.
    pub(super) fn decided_arm(&self, at: NodeId) -> NodeId {
        let mut at = at;
        while self.kind_of(at) == Some(syntax::CONDITIONAL_EXPRESSION) {
            let Some([Some(condition), _, Some(when_true), _, Some(when_false)]) =
                self.child_slots::<5>(at)
            else {
                break;
            };
            let Some(known) = self.statically_decided(condition) else {
                break;
            };
            at = if known { when_true } else { when_false };
        }
        at
    }

    /// Whether an expression can be skipped when only its effects are wanted.
    ///
    /// Deliberately a short list of forms that *cannot* run anything rather
    /// than an analysis of which ones do: a name, `this`, and the literals. A
    /// form missing from it is lowered, which costs nothing but a value nobody
    /// reads, and a form wrongly added to it would silently drop a call.
    pub(super) fn cannot_have_effects(&self, id: NodeId) -> bool {
        matches!(
            self.kind_of(id),
            Some(
                syntax::IDENTIFIER
                    | syntax::THIS_KEYWORD
                    | syntax::NULL_KEYWORD
                    | syntax::STRING_LITERAL
                    | syntax::NUMERIC_LITERAL
                    | syntax::TRUE_KEYWORD
                    | syntax::FALSE_KEYWORD
            )
        )
    }
}

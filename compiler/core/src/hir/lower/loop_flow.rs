//! Build loop and labelled control edges, carrying the values assigned across iterations and exits.

use super::{
    BinOp, BlockId, Diagnostic, FuncBuilder, HirType, NodeData, NodeId, OpKind, Origin, Terminator,
    ValueId, Walk, compound_operator, logical_assignment, syntax,
};

/// What a loop does between one iteration and the next.
///
/// Three shapes rather than an `Option<NodeId>`, because an array method
/// compiled as a loop steps an index the source never wrote, and there is no
/// node to point at. It used to step at the end of the *body* instead, which
/// works right up until something jumps to the latch -- a `return` inside the
/// callback did, and the loop never finished.
#[derive(Clone)]
pub(super) enum Step {
    /// Nothing between iterations; the header is the latch.
    None,
    /// A source expression, as `for (;; i++)` writes it.
    Expression(NodeId),
    /// A carried name moved by a constant, for a loop this compiler
    /// synthesized.
    ///
    /// The delta rather than a `Decrement` beside this, because `reduceRight`
    /// and the two `findLast`s are the same loop walking the other way and a
    /// second variant would be these four lines with one operator changed.
    Count { name: u32, by: f64 },
    /// The cursor of a `for...of`, advanced the way its walk requires.
    ///
    /// In the latch rather than at the end of the body, which is the whole
    /// point: `continue` jumps to the latch, and a step written into the body
    /// is a step `continue` skips. That was true of `for...of` over an array
    /// from the beginning and nothing in the suite wrote one, so it hung
    /// rather than failed.
    Walk {
        cursor: u32,
        walk: Walk,
        sequence: ValueId,
    },
}

#[derive(Debug, Clone)]
pub(super) struct Breakable {
    /// The block after the construct, and its parameters — **created on first
    /// use**.
    ///
    /// A construct nothing leaves has no block after it. `for (;;) { return }`
    /// is the plain case, and a `switch` whose every clause returns is another.
    /// Allocating an exit for those would leave a block no edge reaches, which
    /// is invalid SSA rather than merely dead code — the verifier says so, and
    /// it was saying so about infinite loops before this was lazy.
    pub(super) exit: Option<(BlockId, Vec<ValueId>)>,
    /// What an exit parameter would be typed, per carried name, and where to
    /// say it came from when one is finally made.
    pub(super) exit_types: Vec<HirType>,
    pub(super) origin: Origin,
    /// Where `continue` goes, for the things that have one.
    pub(super) latch: Option<BlockId>,
    /// The symbols this construct carries, in parameter order.
    pub(super) carried: Vec<u32>,
    /// The label written on this construct, if it has one.
    ///
    /// `break outer` names a construct rather than taking the innermost one,
    /// and this is what it names. By text, because a label is not a binding:
    /// the checker gives it no symbol, so there is no id to match on. Nesting
    /// makes that safe -- the innermost construct carrying the name is the one
    /// the name refers to, which is what `rposition` finds.
    pub(super) label: Option<String>,
    /// How deep the exit stack was when this construct began.
    ///
    /// A `break` leaves every `try` between it and here, so it has to run the
    /// `finally` of each -- and this is what says which those are.
    pub(super) exits_at: usize,
    /// Continue stays inside this iterator; break leaves it.
    pub(super) continues_at: usize,
}

/// One loop under construction: where it jumps back to, where it leaves
/// through, and what it carries between the two.
#[derive(Debug, Clone)]
pub(super) struct Loop {
    header: BlockId,
    pub(super) body: BlockId,
    /// Where this loop sits on the enclosing-construct stack, which is how its
    /// exit is reached: the exit is created on demand and shared, so it lives
    /// there rather than here.
    pub(super) depth: usize,
    /// Where an iteration *ends*, and so where `continue` goes.
    ///
    /// The header for a loop with no update. For `for (;; i++)` it is a block
    /// of its own that runs the update before jumping back, because `continue`
    /// must not skip it — `for (;; i++) { continue; }` that jumped straight to
    /// the header would never step and never finish.
    latch: BlockId,
    /// The latch's parameters, when it is a block of its own.
    latch_params: Vec<ValueId>,
    /// The symbols the loop carries, in parameter order.
    pub(super) carried: Vec<u32>,
}

impl FuncBuilder<'_> {
    /// The names a construct actually has to carry, from the names it assigns.
    ///
    /// Drops globals, which need no block parameter: a global is memory, read
    /// with `GlobalGet` and written with `GlobalSet`, so the next reader reads
    /// the slot the last writer wrote. Refuses by name for a symbol that is
    /// neither bound nor a global, rather than letting the caller index the
    /// binding table and panic.
    ///
    /// **Three callers, and each learned this separately.** `begin_loop` had it
    /// from the day a loop assigning a global was fixed; `lower_switch` and
    /// `lower_labeled_block` did not, and both **panicked** -- `no entry found
    /// for key`, with no diagnostic and no artifact -- on a module-scope
    /// `switch` and a module-scope labelled block. Two of the three places that
    /// decide one question had the wrong answer, which is why it is one function
    /// now.
    ///
    /// Not folded into [`Self::assigned_symbols`], deliberately: a
    /// `for (let i = 0; …)` head at module scope is collected by
    /// `collect_module_scope` as a module binding, so filtering it there stopped
    /// `i` being carried and the loop never advanced. By the time a caller runs,
    /// the head has been lowered and `i` has a binding, which is the question
    /// that actually distinguishes them.
    pub(super) fn carried_locals(
        &self,
        id: NodeId,
        carried: &[u32],
        refusal: &str,
    ) -> Result<Vec<u32>, Diagnostic> {
        if carried
            .iter()
            .any(|symbol| !self.bindings.contains_key(symbol) && !self.is_a_global(*symbol))
        {
            return Err(self.unsupported(id, refusal));
        }
        Ok(carried
            .iter()
            .copied()
            .filter(|symbol| self.bindings.contains_key(symbol))
            .collect())
    }

    /// Whether a reference is written through, at any nesting depth.
    ///
    /// Walks *up* from the reference, because the thing that makes a name a
    /// target can be arbitrarily far above it: `f` in `[[f]] = pairs` is two
    /// literals below the `=`. The token test is
    /// [`Self::assigned_symbols`]'s, called rather than restated -- two
    /// derivations of "which operators write" would eventually disagree, and
    /// this one is the safety-critical copy.
    pub(super) fn stands_on_the_target_side(&self, reference: NodeId) -> bool {
        let mut child = reference;
        while let Some(parent) = self.node(child).parent {
            match self.kind_of(parent) {
                Some(syntax::BINARY_EXPRESSION) => {
                    if let [target, operator, _] = self.children(parent).as_slice() {
                        let token = self.kind_of(*operator).unwrap_or(0);
                        let writes = token == syntax::EQUALS_TOKEN
                            || compound_operator(token).is_some()
                            || logical_assignment(token).is_some();
                        if writes && *target == child {
                            return true;
                        }
                    }
                }
                Some(syntax::PREFIX_UNARY_EXPRESSION | syntax::POSTFIX_UNARY_EXPRESSION) => {
                    return true;
                }
                // A head writes its target once per iteration: the statement's
                // first child after `for await`'s keyword (`ForOfStatement` is
                // `awaitModifier?, initializer, expression, statement`). Only
                // that one -- the iterated expression and the body are read,
                // and answering yes for them kept every closure-typed `let` and
                // `var` a loop calls, `for (const v of upTo(n))`, out of a
                // global. A pattern target (`for ([f] of pairs)`) reaches here
                // through its literal, which *is* the first child.
                Some(syntax::FOR_IN_STATEMENT | syntax::FOR_OF_STATEMENT) => {
                    let head = self
                        .children(parent)
                        .into_iter()
                        .find(|part| self.kind_of(*part) != Some(syntax::AWAIT_KEYWORD));
                    if head == Some(child) {
                        return true;
                    }
                }
                // A second declaration of one symbol is `var`, which this is
                // not reached for -- but a name that acquires one later is a
                // name with two initializers, so it counts.
                Some(syntax::VARIABLE_DECLARATION)
                    if self.children(parent).first() == Some(&child) =>
                {
                    return true;
                }
                _ => {}
            }
            child = parent;
        }
        false
    }

    pub(super) fn assigned_symbols(&self, root: NodeId, into: &mut Vec<u32>) {
        // Every form that writes to a name, not just `=`. Missing one does not
        // fail loudly: the header simply gets no parameter for that name, the
        // loop reads the value it had on entry, and the back edge never passes
        // the update. `for (let i = 0; i < n; i++)` then runs forever, and the
        // only thing that catches it is the SSA verifier noticing that the exit
        // reads a value the body defined.
        // **Globals are not filtered here**, despite what this comment said
        // until 2026-09-18. They are filtered by the *consumers* --
        // `begin_loop` and `lower_switch` -- and deliberately: a `for (let i =
        // 0; ...)` head at module scope is picked up by `collect_module_scope`
        // as a module binding, so filtering it here stopped `i` being carried
        // and the loop never advanced. By the time a consumer runs, the head has
        // been lowered and `i` has a binding, which is the question that
        // actually distinguishes them.
        //
        // The claim cost a panic: `lower_switch` was written trusting it and
        // indexed the binding table directly.
        //
        // Before this, a loop assigning a module-scope binding was refused --
        // "a loop assigning a name declared outside it" -- because `begin_loop`
        // looks each carried symbol up in the binding table and a global is not
        // in it. The message named the wrong thing: every accumulator is
        // declared outside its loop, and what actually failed was that a global
        // has no binding to carry.
        //
        // The refusal was worse than a missing feature. Module evaluation skips
        // a refused statement and keeps going -- `NTS1005` says so, and says
        // "every value this line would have computed keeps whatever it held
        // before it" -- so the global kept its *initial* value and the export
        // reading it still compiled. `let total = 0; for (const v of table)
        // total = total + v;` answered 0 where node answers 10, with no
        // diagnostic on the export and nothing in a published-name count able
        // to see it.
        let written = self.written_target(root);

        // Only a bare name is carried. `box.cell = c` and `xs[i] = c` write
        // *through* a reference and leave the reference itself alone, so they
        // need no loop parameter -- and taking the target's symbol anyway would
        // pick up the class member `cell`, a symbol no local scope declares,
        // which then looks like an assignment to a name from an enclosing scope
        // and gets the loop refused.
        if let Some(target) = written {
            self.target_names(target, into);
        }

        for child in &self.node(root).children {
            self.assigned_symbols(*child, into);
        }
    }

    /// The target a node writes itself -- the left of an assignment, compound
    /// or logical, or the operand of `++`/`--` -- and `None` for any other node.
    /// Its subtree is not asked: [`Self::assigned_symbols`] walks that, and the
    /// throwing walk visits it node by node.
    pub(super) fn written_target(&self, root: NodeId) -> Option<NodeId> {
        match self.kind_of(root) {
            Some(syntax::BINARY_EXPRESSION) => {
                let children = self.children(root);
                match children.as_slice() {
                    [target, operator, _] => {
                        let token = self.kind_of(*operator).unwrap_or(0);
                        // A logical assignment writes on only one path, but
                        // "assigned anywhere in this subtree" is the question
                        // here, and a conditional write is still a write: the
                        // header needs the parameter or the merge has nothing
                        // to carry the updated value through.
                        if token == syntax::EQUALS_TOKEN
                            || compound_operator(token).is_some()
                            || logical_assignment(token).is_some()
                        {
                            Some(*target)
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            }
            Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                let NodeData::Children { small, .. } = self.node(root).data else {
                    return None;
                };
                matches!(
                    small & syntax::prefix_operator::MASK,
                    syntax::prefix_operator::PLUS_PLUS | syntax::prefix_operator::MINUS_MINUS
                )
                .then(|| self.children(root).first().copied())
                .flatten()
            }
            // Every postfix operator is a step, so no operator check is needed.
            Some(syntax::POSTFIX_UNARY_EXPRESSION) => self.children(root).first().copied(),
            _ => None,
        }
    }

    /// The names an assignment's target writes: the name itself, or every name
    /// a destructuring pattern binds -- `[line] = next()`, `({ a, k: b } = o)`,
    /// `[x, ...rest] = xs`, nested. A pattern's defaults (`[a = 1] = xs`) are
    /// `=` expressions of their own, which [`Self::assigned_symbols`] finds by
    /// walking into the target. Missing a pattern's names is the loop that
    /// never advances: `[line] = next()` wrote a value the header never saw.
    pub(super) fn target_names(&self, target: NodeId, into: &mut Vec<u32>) {
        match self.kind_of(target) {
            Some(syntax::IDENTIFIER) => {
                if let Some(symbol) = self.node(target).symbol
                    && !into.contains(&symbol.0)
                {
                    into.push(symbol.0);
                }
            }
            Some(
                syntax::PARENTHESIZED_EXPRESSION
                | syntax::ARRAY_LITERAL_EXPRESSION
                | syntax::OBJECT_LITERAL_EXPRESSION
                | syntax::SPREAD_ELEMENT
                | syntax::SPREAD_ASSIGNMENT,
            ) => {
                for child in self.children(target) {
                    self.target_names(child, into);
                }
            }
            // `({ line } = o)`: the node carries the *property's* symbol, so
            // the binding is found by name among the ones in scope, as
            // `shorthand_value_symbol` finds it when the store is lowered --
            // one local of that spelling, or none carried (the store itself
            // then refuses a shadowed name, and a global needs no carrying).
            Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
                let Some(text) = self.children(target).first().and_then(|name| {
                    self.node(*name)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                }) else {
                    return;
                };
                let mut local = self.bindings.keys().copied().filter(|symbol| {
                    self.snapshot
                        .symbols
                        .get(*symbol as usize)
                        .is_some_and(|record| record.name.is_name(text.as_ref()))
                });
                if let (Some(symbol), None) = (local.next(), local.next())
                    && !into.contains(&symbol)
                {
                    into.push(symbol);
                }
            }
            // `{ key: target }`: the key names a property, not a binding.
            Some(syntax::PROPERTY_ASSIGNMENT) => {
                if let Some(value) = self.children(target).last() {
                    self.target_names(*value, into);
                }
            }
            // `[a = 1]`: the name before the default.
            Some(syntax::BINARY_EXPRESSION) => {
                if let Some(name) = self.children(target).first() {
                    self.target_names(*name, into);
                }
            }
            _ => {}
        }
    }

    /// Symbols *declared* anywhere inside a subtree.
    ///
    /// A name declared inside a loop body is fresh on every iteration, so it is
    /// not carried across the back edge however often the body assigns it.
    /// Treating it as carried asks the header for a value that does not exist
    /// before the loop — which is the shape of `let x = 0` inside an outer loop,
    /// and therefore of every nested loop written the obvious way.
    pub(super) fn declared_symbols(&self, root: NodeId, into: &mut Vec<u32>) {
        if self.kind_of(root) == Some(syntax::VARIABLE_DECLARATION)
            && let Some(name) = self.children(root).first()
        {
            if matches!(
                self.kind_of(*name),
                Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN)
            ) {
                let mut names = Vec::new();
                self.pattern_names(*name, &mut names);
                into.extend(
                    names
                        .into_iter()
                        .filter_map(|name| self.node(name).symbol.map(|symbol| symbol.0)),
                );
            } else if let Some(symbol) = self.node(*name).symbol {
                into.push(symbol.0);
            }
        }
        for child in &self.node(root).children {
            self.declared_symbols(*child, into);
        }
    }

    /// `while (c) { .. }`.
    ///
    /// # Where block parameters earn their keep
    ///
    /// A variable the body or condition assigns can differ on each iteration, and
    /// the header has to see whichever one the previous iteration produced. That
    /// is exactly a block parameter: the entry passes the initial value, the back
    /// edge passes the updated one, and the body reads the parameter.
    ///
    /// The parameters are created before the body is lowered, because the body
    /// refers to them. Which variables need one is a syntactic question —
    /// [`Self::assigned_symbols`] — answered before either part is lowered.
    pub(super) fn lower_while(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let [condition, body] = children.as_slice() else {
            return Err(self.unsupported(id, "a `while` of unexpected shape"));
        };

        let mut carried = Vec::new();
        self.assigned_symbols(*body, &mut carried);
        self.assigned_symbols(*condition, &mut carried);
        let mut declared = Vec::new();
        self.declared_symbols(*body, &mut declared);
        carried.retain(|symbol| !declared.contains(symbol));

        let origin = self.origin(id);
        let record = self.begin_loop(id, &carried, false, &origin)?;
        self.enter_loop(&record, Some(*condition))?;

        self.lower_statement(*body)?;
        self.end_loop(&record, Step::None)
    }

    /// `do { .. } while (c)`.
    ///
    /// The same loop as `while`, entered at the body instead of at the test.
    /// The header still holds the parameters, because the back edge still
    /// arrives there — what changes is only that the first pass reaches the
    /// body without asking.
    pub(super) fn lower_do_while(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let [body, condition] = children.as_slice() else {
            return Err(self.unsupported(id, "a `do` of unexpected shape"));
        };
        let (body, condition) = (*body, *condition);

        let mut carried = Vec::new();
        self.assigned_symbols(body, &mut carried);
        self.assigned_symbols(condition, &mut carried);
        let mut declared = Vec::new();
        self.declared_symbols(body, &mut declared);
        carried.retain(|symbol| !declared.contains(symbol));

        let origin = self.origin(id);
        // A `do` loop tests at the *end*, so the header is where the test goes
        // and the body is entered from it unconditionally on every pass. The
        // first pass reaches the header through the entry edge like any other,
        // which is what makes "runs at least once" fall out rather than be
        // arranged: the header's only job is to hold the parameters.
        let record = self.begin_loop(id, &carried, true, &origin)?;
        self.enter_loop(&record, None)?;

        self.lower_statement(body)?;
        // The latch is where the test lives, so `continue` reaches it and the
        // condition is evaluated -- which is what `do { continue; } while (c)`
        // means.
        if !self.is_terminated() {
            let reached = self.carried_now(&record.carried);
            self.terminate(Terminator::Jump {
                target: record.latch,
                args: reached,
            });
        }
        self.switch_to(record.latch);
        for (symbol, param) in record.carried.iter().zip(&record.latch_params) {
            self.bindings.insert(*symbol, *param);
        }
        let cond = self.lower_expression(condition)?;
        let cond = self.truthy(condition, cond);
        let carried_here = self.carried_now(&record.carried);
        let (exit, exit_params) = self.exit_of(record.depth);
        self.terminate(Terminator::Branch {
            cond,
            then_target: record.header,
            then_args: carried_here.clone(),
            else_target: exit,
            else_args: carried_here,
        });

        self.breakables.pop();
        self.switch_to(exit);
        for (symbol, param) in record.carried.iter().zip(&exit_params) {
            self.bindings.insert(*symbol, *param);
        }
        Ok(())
    }

    /// Open a loop: jump to the header, give it a parameter per carried name,
    /// test the condition, and leave the builder positioned in the body.
    ///
    /// Returns the header's parameters and the exit block.
    /// Jump into a loop's header and give it a parameter per carried name.
    ///
    /// Stops there, in the header, because what comes next is the *test* --
    /// and a test is lowered where its operations belong, which is the header
    /// rather than the block before it. A `while` lowers an expression there; a
    /// `for...of` builds a comparison there that no source node describes.
    /// Begin a loop: the blocks, the parameters, and the record `break` and
    /// `continue` will look up.
    ///
    /// # Why the exit takes parameters
    ///
    /// A loop can be left two ways and they disagree about what its carried
    /// names hold. Leaving by the test means the *header's* parameters are the
    /// answer — the value at the top of the iteration that failed. Leaving by a
    /// `break` means whatever the body had reached at that point.
    ///
    /// So the exit is a merge, and a merge takes parameters here like any
    /// other. Before `break` existed there was one way out, the exit needed
    /// none, and the names were rebound to the header's — which was correct for
    /// exactly as long as it was the only way out.
    pub(super) fn begin_loop(
        &mut self,
        id: NodeId,
        carried: &[u32],
        steps: bool,
        origin: &Origin,
    ) -> Result<Loop, Diagnostic> {
        let header = self.new_block();
        let body = self.new_block();
        let latch = if steps { self.new_block() } else { header };

        // A global is *memory* and is not carried.
        //
        // It is read with `GlobalGet` and written with `GlobalSet`, so the next
        // iteration reads the slot the last one wrote and there is nothing for
        // a block parameter to hold. An `if` that assigns a global has always
        // worked for exactly this reason: it carries nothing.
        //
        // This used to be a refusal -- "a loop assigning a name declared
        // outside it" -- because the lookup below found no binding for a
        // global. The message named the wrong thing (every accumulator is
        // declared outside its loop) and the recovery was worse than the
        // refusal: module evaluation skips a refused statement and keeps going,
        // so the global kept its *initial* value and the export reading it
        // still compiled. `let total = 0; for (const v of table) total = total
        // + v;` answered 0 where node answers 10, with no diagnostic on the
        // export and nothing in a published-name count able to see it.
        //
        // `carried_locals` carries why this is decided here rather than where
        // the carried set is collected.
        let kept =
            self.carried_locals(id, carried, "a loop assigning a name declared outside it")?;
        let carried: &[u32] = &kept;

        // The values entering the loop, in the order the parameters take them.
        let mut incoming = Vec::new();
        for symbol in carried {
            let value = *self.bindings.get(symbol).ok_or_else(|| {
                self.unsupported(id, "a loop assigning a name declared outside it")
            })?;
            incoming.push(value);
        }
        self.terminate(Terminator::Jump {
            target: header,
            args: incoming.clone(),
        });

        // Inside the loop, each carried name *is* its header parameter.
        self.switch_to(header);
        let mut latch_params = Vec::new();
        let mut exit_types = Vec::new();
        for (symbol, entering) in carried.iter().zip(&incoming) {
            let ty = self.values[entering.0 as usize].ty.clone();
            let param = self.push_block_param(header, ty.clone(), origin.clone());
            self.bindings.insert(*symbol, param);
            exit_types.push(ty.clone());
            if latch != header {
                latch_params.push(self.push_block_param(latch, ty, origin.clone()));
            }
        }

        let depth = self.breakables.len();
        self.breakables.push(Breakable {
            exit: None,
            exit_types,
            origin: origin.clone(),
            latch: Some(latch),
            carried: carried.to_vec(),
            label: self.pending_label.take(),
            exits_at: self.exits.len(),
            continues_at: self.exits.len(),
        });
        Ok(Loop {
            header,
            body,
            depth,
            latch,
            latch_params,
            carried: carried.to_vec(),
        })
    }

    /// Emit the loop's test and switch to its body.
    ///
    /// `None` is `for (;;)`, whose exit is reachable only through a `break` or
    /// a `return` — which is what the source says.
    fn enter_loop(&mut self, record: &Loop, condition: Option<NodeId>) -> Result<(), Diagnostic> {
        match condition {
            // **A connective as jumps, as `if` lowers one.** Merged into a
            // boolean first, `while (at < s.length && s.charCodeAt(at) !== 32)
            // at++` reached the body through one branch on the merge, so the
            // range analysis never saw `at < s.length` on an edge into it:
            // `at++` was unbounded there, widening sent the cursor to
            // infinity, and json-scan's every cursor was a double on all four
            // backends (`tests/programs/a-string-scan-cursor-stays-integral` is
            // the reduction). Each test is an edge now. Every false edge goes
            // to the exit with the loop's carried values, which a condition
            // that assigns nothing holds unchanged at each of its tests.
            Some(condition) if self.connective(condition).is_some() && !self.assigns(condition) => {
                let (exit, _) = self.exit_of(record.depth);
                let reached = self.carried_now(&record.carried);
                let mut tests = Vec::new();
                self.lower_jumps(
                    condition,
                    ((record.body, &[]), (exit, &reached)),
                    &mut tests,
                )?;
            }
            Some(condition) => {
                let cond = self.lower_expression(condition)?;
                let cond = self.truthy(condition, cond);
                self.test_loop(cond, record);
            }
            None => self.terminate(Terminator::Jump {
                target: record.body,
                args: Vec::new(),
            }),
        }
        self.switch_to(record.body);
        Ok(())
    }

    /// Into the body, or out with the values reached after evaluating the test.
    pub(super) fn test_loop(&mut self, cond: ValueId, record: &Loop) {
        // A condition that is constantly true is `for (;;)` written another
        // way, and lowers the same way. The difference is not cosmetic: the
        // *test* is what creates the exit block, and a loop nothing leaves must
        // not have one -- `Breakable::exit` is lazy for exactly that reason,
        // and branching to it here defeats it. A `break` still makes one, which
        // is the only thing that should.
        //
        // Without this, `while (true)` left the function falling out of a block
        // it could never reach: `FellThrough` in a body that owes a value,
        // which the verifier rejects because nothing about the block tells it
        // apart from a wrong return type. It also emitted the dead branch.
        if matches!(self.values[cond.0 as usize].kind, OpKind::ConstBool(true)) {
            self.terminate(Terminator::Jump {
                target: record.body,
                args: Vec::new(),
            });
            return;
        }
        let (exit, _) = self.exit_of(record.depth);
        let reached = self.carried_now(&record.carried);
        self.terminate(Terminator::Branch {
            cond,
            then_target: record.body,
            then_args: Vec::new(),
            else_target: exit,
            else_args: reached,
        });
    }

    /// The block after an enclosing construct, made the first time something
    /// needs one.
    pub(super) fn exit_of(&mut self, depth: usize) -> (BlockId, Vec<ValueId>) {
        if let Some(made) = &self.breakables[depth].exit {
            return made.clone();
        }
        let types = self.breakables[depth].exit_types.clone();
        let origin = self.breakables[depth].origin.clone();
        let block = self.new_block();
        let params: Vec<ValueId> = types
            .into_iter()
            .map(|ty| self.push_block_param(block, ty, origin.clone()))
            .collect();
        let made = (block, params);
        self.breakables[depth].exit = Some(made.clone());
        made
    }

    /// Close the iteration, run the update where there is one, and leave the
    /// loop with its names bound to the exit's parameters — which is where
    /// every way out of it agrees.
    pub(super) fn end_loop(&mut self, record: &Loop, step: Step) -> Result<(), Diagnostic> {
        // The body falls into the latch, which is the header unless the loop
        // steps.
        if !self.is_terminated() {
            let reached = self.carried_now(&record.carried);
            self.terminate(Terminator::Jump {
                target: record.latch,
                args: reached,
            });
        }

        if record.latch != record.header {
            self.switch_to(record.latch);
            for (symbol, param) in record.carried.iter().zip(&record.latch_params) {
                self.bindings.insert(*symbol, *param);
            }
            match step {
                Step::None => {}
                Step::Expression(update) => {
                    self.lower_expression(update)?;
                }
                Step::Walk {
                    cursor,
                    walk,
                    sequence,
                } => {
                    let origin = self.breakables[record.depth].origin.clone();
                    let at = self.bindings[&cursor];
                    let next = self.advance(&walk, sequence, at, &origin)?;
                    self.bindings.insert(cursor, next);
                }
                Step::Count { name, by } => {
                    let origin = self.breakables[record.depth].origin.clone();
                    let at = self.bindings[&name];
                    let delta = self.push(OpKind::ConstFloat(by), HirType::NUMBER, origin.clone());
                    let next = self.push(
                        OpKind::Binary {
                            op: BinOp::Add,
                            lhs: at,
                            rhs: delta,
                        },
                        HirType::NUMBER,
                        origin,
                    );
                    self.bindings.insert(name, next);
                }
            }
            let stepped = self.carried_now(&record.carried);
            self.terminate(Terminator::Jump {
                target: record.header,
                args: stepped,
            });
        }

        // A loop nothing leaves has no exit, and what follows it is
        // unreachable -- so the enclosing block stays closed, exactly as it
        // does when both arms of an `if` end.
        let left = self.breakables[record.depth].exit.clone();
        self.breakables.pop();
        if let Some((exit, params)) = left {
            self.switch_to(exit);
            for (symbol, param) in record.carried.iter().zip(&params) {
                self.bindings.insert(*symbol, *param);
            }
        }
        Ok(())
    }

    /// What each carried name holds right here.
    pub(super) fn carried_now(&self, carried: &[u32]) -> Vec<ValueId> {
        carried.iter().map(|symbol| self.bindings[symbol]).collect()
    }

    /// `break` — leave the innermost loop or switch, carrying what has been
    /// reached.
    pub(super) fn lower_break(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let depth = self.enclosing(id, "break", |it| it.latch.is_some() || it.latch.is_none())?;
        // Every `try` between here and the loop is left, so each one's
        // `finally` runs -- before the carried names are read, because a
        // `finally` that assigns one of them assigns it before the loop ends.
        self.unwind_to(self.breakables[depth].exits_at, None)?;
        if self.is_terminated() {
            return Ok(());
        }
        let carried = self.breakables[depth].carried.clone();
        let args = self.carried_now(&carried);
        let (exit, _) = self.exit_of(depth);
        self.terminate(Terminator::Jump { target: exit, args });
        Ok(())
    }

    /// `continue` — begin the next iteration with what the body has reached.
    ///
    /// It looks past a `switch`, which is not a thing to continue.
    pub(super) fn lower_continue(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let depth = self.enclosing(id, "continue", |it| it.latch.is_some())?;
        // The same as `break`: an iteration that ends early still leaves every
        // `try` inside the loop that it was in.
        self.unwind_to(self.breakables[depth].continues_at, None)?;
        if self.is_terminated() {
            return Ok(());
        }
        let it = self.breakables[depth].clone();
        let args = self.carried_now(&it.carried);
        let latch = it.latch.expect("the predicate above admits only loops");
        self.terminate(Terminator::Jump {
            target: latch,
            args,
        });
        Ok(())
    }

    /// What a bare `break` or `continue` belongs to.
    ///
    /// A label is refused rather than ignored: `break outer` and `break` are
    /// different statements, and lowering one as the other would compile and
    /// leave the wrong construct.
    fn enclosing(
        &mut self,
        id: NodeId,
        what: &str,
        mut wanted: impl FnMut(&Breakable) -> bool,
    ) -> Result<usize, Diagnostic> {
        // `break outer` names the construct rather than taking the innermost
        // one. The name is the whole difference: everything below is the same
        // jump to the same block, with a different index chosen for it.
        if let Some(named) = self
            .children(id)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
        {
            let Some(name) = self
                .node(named)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                .map(str::to_owned)
            else {
                return Err(self.unsupported(id, &format!("a labelled `{what}` with no name")));
            };
            return self
                .breakables
                .iter()
                .rposition(|it| it.label.as_deref() == Some(name.as_str()) && wanted(it))
                .ok_or_else(|| {
                    self.unsupported(
                        id,
                        &format!("a `{what}` naming a label that is not on a loop around it"),
                    )
                });
        }
        self.breakables
            .iter()
            .rposition(&mut wanted)
            .ok_or_else(|| self.unsupported(id, &format!("a `{what}` outside a loop")))
    }

    /// `for (init; cond; update) body`.
    ///
    /// The same shape as a `while`, with two differences that matter. The
    /// initializer runs once *before* the header, so a name it declares is in
    /// scope at the header and is carried across the back edge — unlike a name
    /// declared in the body, which is fresh each iteration. And the update runs
    /// at the end of the body, so the back edge carries what it produced.
    ///
    /// A missing condition is `for (;;)`: the loop is entered unconditionally.
    pub(super) fn lower_for(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let Some([initializer, condition, update, body]) = self.child_slots::<4>(id) else {
            return Err(self.unsupported(id, "a `for` of unexpected shape"));
        };
        let Some(body) = body else {
            return Err(self.unsupported(id, "a `for` without a body"));
        };

        if let Some(initializer) = initializer {
            if self.kind_of(initializer) == Some(syntax::VARIABLE_DECLARATION_LIST) {
                self.lower_variable_statement(initializer)?;
            } else {
                self.lower_expression(initializer)?;
            }
        }

        // Every part evaluated repeatedly contributes writes. The initializer
        // runs once; the body, update and condition can each change a name the
        // next iteration must see.
        let mut carried = Vec::new();
        self.assigned_symbols(body, &mut carried);
        if let Some(update) = update {
            self.assigned_symbols(update, &mut carried);
        }
        if let Some(condition) = condition {
            self.assigned_symbols(condition, &mut carried);
        }
        let mut declared = Vec::new();
        self.declared_symbols(body, &mut declared);
        carried.retain(|symbol| !declared.contains(symbol));

        let origin = self.origin(id);
        let record = self.begin_loop(id, &carried, update.is_some(), &origin)?;
        self.enter_loop(&record, condition)?;

        self.lower_statement(body)?;
        self.end_loop(&record, update.map_or(Step::None, Step::Expression))
    }

    /// `outer: for (…) { … }`.
    ///
    /// The label is not a construct of its own: it names the loop written under
    /// it, so that a `break` or `continue` inside can say which loop it means.
    /// So this records the name and lowers the loop, and the loop takes the name
    /// when it pushes its [`Breakable`].
    ///
    /// A label on anything *other* than a loop or a `switch` is refused. `outer:
    /// { … break outer … }` is legal JavaScript -- a labelled block, where the
    /// `break` is a forward jump to the end of it -- and it needs a breakable
    /// with an exit and no latch, which is a block this does not build. Refusing
    /// it also keeps [`Self::pending_label`] honest: with nothing between the
    /// label and the loop, the next construct to push is always the one the
    /// label was written on, and the name cannot land on a loop nested inside
    /// something else.
    /// `outer: { … break outer … }`.
    ///
    /// A breakable with an exit and **no latch**, which is what a labelled block
    /// is: `break outer` is a forward jump to the end of it and there is nothing
    /// to continue. A `switch` pushes the same shape, and the two differ only in
    /// what sits between the push and the pop.
    ///
    /// **Falling off the end is the same jump.** A `break` reaches the exit and
    /// so does running out of statements, so the last thing here is the jump
    /// `lower_break` would have made -- which is also what allocates the exit at
    /// all when no `break` was written, and what leaves it unallocated when the
    /// block always returns.
    fn lower_labeled_block(
        &mut self,
        id: NodeId,
        label: String,
        block: NodeId,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let mut carried = Vec::new();
        let mut declared = Vec::new();
        self.assigned_symbols(block, &mut carried);
        self.declared_symbols(block, &mut declared);
        // A name the block declares is the block's own and cannot be carried
        // out of it, the same rule `lower_switch` applies to a clause.
        carried.retain(|symbol| !declared.contains(symbol));
        // A global carries nothing, and an unbound name is refused rather than
        // indexed. Before this a module-scope labelled block assigning a global
        // **panicked** -- see `carried_locals`.
        let carried = self.carried_locals(
            id,
            &carried,
            "a labelled block assigning a name declared outside it",
        )?;
        let exit_types: Vec<HirType> = self
            .carried_now(&carried)
            .into_iter()
            .map(|value| self.values[value.0 as usize].ty.clone())
            .collect();

        let depth = self.breakables.len();
        self.breakables.push(Breakable {
            exit: None,
            exit_types,
            origin,
            latch: None,
            carried: carried.clone(),
            label: Some(label),
            exits_at: self.exits.len(),
            continues_at: self.exits.len(),
        });
        // `lower_statement` rather than `lower_block`: this path now takes any
        // labelled statement, and `lower_statement` dispatches a `BLOCK` to
        // `lower_block` anyway.
        let lowered = self.lower_statement(block);
        if lowered.is_ok() && !self.is_terminated() {
            let args = self.carried_now(&carried);
            let (exit, _) = self.exit_of(depth);
            self.terminate(Terminator::Jump { target: exit, args });
        }
        let left = self.breakables[depth].exit.clone();
        self.breakables.pop();
        lowered?;
        if let Some((exit, params)) = left {
            self.switch_to(exit);
            for (symbol, param) in carried.iter().zip(&params) {
                self.bindings.insert(*symbol, *param);
            }
        }
        Ok(())
    }

    pub(super) fn lower_labeled(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let [name, statement] = children.as_slice() else {
            return Err(self.unsupported(id, "a labelled statement of unexpected shape"));
        };
        let (name, statement) = (*name, *statement);
        let Some(text) = self
            .node(name)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)
        else {
            return Err(self.unsupported(name, "a label with no name"));
        };
        // **A loop or a `switch` takes the label itself; anything else gets the
        // forward-jump shape.** The specification puts a label on *any*
        // statement — `lbl: n = 1;`, `lbl: if (c) { … }`, `lbl: try { … }` are
        // all legal, and `break lbl` leaves them. Only `continue` needs a loop,
        // and a non-loop breakable has no latch, so the checker's rejection of
        // `continue` to such a label is backed by this having nothing to
        // continue to.
        //
        // It was an allow-list of five kinds, and everything else refused as
        // "a label on something that is not a loop" — 14 files in the slice-1
        // `test/language` population, most of them in `asi` and `statementList`
        // where a label on an expression statement is the *subject*.
        //
        // `for…in` was missing from the list as well, so
        // `outer: for (const k in o) { continue outer; }` refused while the same
        // loop over `for…of` compiled. `lower_for_of` handles both — the
        // `Over::Keys` arm — and only this list did not say so.
        if matches!(
            self.kind_of(statement),
            Some(
                syntax::FOR_STATEMENT
                    | syntax::FOR_IN_STATEMENT
                    | syntax::FOR_OF_STATEMENT
                    | syntax::WHILE_STATEMENT
                    | syntax::DO_STATEMENT
                    | syntax::SWITCH_STATEMENT
            )
        ) {
            self.pending_label = Some(text);
            let lowered = self.lower_statement(statement);
            // Cleared whatever happened: a loop that refused never took it, and
            // a name left here would be picked up by the next loop in the
            // function.
            self.pending_label = None;
            return lowered;
        }
        // Everything else: an exit and no latch, which is the shape a labelled
        // block already had. The breakable carries the label, which is why this
        // is built here rather than by `lower_statement` — a statement is not a
        // construct that takes one.
        self.lower_labeled_block(id, text, statement)
    }

    /// The names an inlined callback's loop has to carry.
    ///
    /// The ones this lowering invented -- the index, and the accumulator where
    /// there is one -- and every name the body *assigns* that it did not also
    /// declare. A name declared inside the body is new on each iteration, and
    /// carrying it would be wrong as well as wasteful.
    pub(super) fn carried_across(
        &mut self,
        body: NodeId,
        synthetic: &[u32],
        names: &[u32],
    ) -> Vec<u32> {
        let mut carried = synthetic.to_vec();
        self.assigned_symbols(body, &mut carried);
        let mut declared = names.to_vec();
        self.declared_symbols(body, &mut declared);
        carried.retain(|symbol| synthetic.contains(symbol) || !declared.contains(symbol));
        carried
    }
}

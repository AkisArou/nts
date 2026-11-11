//! Build closure values and the storage for captures, late-bound cells, and hoisted closure bindings.

use super::{
    AsyncResult, Capture, ClosureInfo, Diagnostic, Field, FuncBuilder, HirType, Layout,
    ManagedType, NodeId, Op, OpKind, Origin, Settler, TypeId, ValueId, closure_names, closure_type,
    erased_call_name, syntax, taken_as_a_closure,
};

/// The symbol a captured `this` is filed under.
///
/// `this` is not a name a program declares, so it has no symbol of its own --
/// and it is captured for exactly the reasons every other free name is: an
/// arrow does not bind one, so the `this` in its body belongs to the enclosing
/// method and has to travel with the closure.
///
/// Reserved rather than synthesised, because both sides of a capture look it up
/// by symbol and one number has to mean the same thing in both. No real symbol
/// reaches `u32::MAX`: symbols index a table the frontend built.
pub(super) const THIS_CAPTURE: u32 = u32::MAX;

pub(super) fn cell_type(index: usize) -> TypeId {
    let id = crate::hir::SYNTHETIC_CELLS + u32::try_from(index).unwrap_or(0);
    debug_assert!(
        id < crate::hir::SYNTHETIC_OBJC_STATES,
        "more captured-by-reference variables than the synthetic id space holds"
    );
    TypeId(id)
}

fn cell_name(index: usize) -> String {
    format!("Cell{index}")
}

impl FuncBuilder<'_> {
    /// The type a closure's body reads a capture as -- before any cell it
    /// sits in.
    ///
    /// **One derivation for the two sides of a capture.** The body reads the
    /// field at this type (`bind_captures`), so the closure that builds the
    /// object has to store it at this type too (`lower_arrow`) -- and it did
    /// not: it stored the *value's* type, which agrees with this everywhere
    /// except inside a structural copy, where a parameter re-typed to `Thing`
    /// was stored into a field the body reads as `Named`. `s.name` in the
    /// arrow then read `id` as a string pointer: SIGSEGV where node answers
    /// 4, on the binary before this as well. The store is coerced to this
    /// now, and refuses where the cast is not a prefix, as a parameter would.
    ///
    /// **A settler's field holds the promise**, and the checker's type at the
    /// name is the settler's `(value: T) => void`. Asking `type_of` for it
    /// would read the field at a function type and the two sides of the
    /// layout would disagree about it -- invalid HIR rather than a refusal,
    /// so the special case comes before the general one. The promise type
    /// comes from the *declaration*, because the reading side has no value in
    /// hand: the allocating side put `settler.result.promise` in the field,
    /// and its type is the promise the enclosing executor is constructing.
    fn captured_as(&self, info: &ClosureInfo, capture: &Capture) -> Result<HirType, Diagnostic> {
        if capture.readiness_only {
            return Ok(HirType::Bool);
        }
        // A variant reads a re-typed capture at the copy's type: the same
        // answer the copy's own parameter has, which is what makes the field
        // agree with the value the copy stores in it.
        if let Some(ty) = info.retyped_captures.get(&capture.symbol) {
            return Ok(ty.clone());
        }
        if capture.settles.is_some() {
            return self
                .settler_promise_type(capture.at)
                .ok_or_else(|| self.unrepresentable(capture.at, "a captured promise settler"));
        }
        self.closure_bound_to(capture.symbol)
            .or_else(|| self.type_of(capture.at))
            .ok_or_else(|| self.unrepresentable(capture.at, "a captured variable"))
    }

    pub(super) fn bind_captures(
        &mut self,
        receiver: ValueId,
        info: &ClosureInfo,
        origin: &Origin,
    ) -> Result<Vec<Field>, Diagnostic> {
        let mut fields = Vec::new();
        for (at, capture) in info.captures.iter().enumerate() {
            if let Some(reason) = self.why_the_closure_cannot_be_captured(capture.symbol) {
                return Err(self.unsupported(capture.at, reason));
            }
            let held = self.captured_as(info, capture)?;
            // By reference, the field holds the *cell* rather than the value,
            // and the binding below is the cell -- so every read and write of
            // the name in this body goes through it, exactly as it does in the
            // function that opened it.
            let ty = match self.cell_of(capture.symbol) {
                Some(index) => {
                    self.layouts.push(self.cell_layout(index, held));
                    HirType::Managed(ManagedType::Object(cell_type(index)))
                }
                None => held,
            };
            let field = u32::try_from(at).unwrap_or(0);
            let value = self.push(
                OpKind::FieldGet {
                    object: receiver,
                    field,
                },
                ty.clone(),
                origin.clone(),
            );
            if capture.symbol == THIS_CAPTURE {
                // Not a name in `bindings` -- `this` is not looked up that way
                // -- but the receiver every `this` in this body means.
                self.this = Some(value);
            } else if let Some(rejects) = capture.settles {
                // **Re-derive the settler from the captured promise.** The name
                // is not a value in this body either, so it goes into
                // `settlers` rather than `bindings` -- and `lower_settler_call`
                // then works unchanged, which is the whole reason the field
                // holds a promise rather than anything cleverer.
                let HirType::Managed(ManagedType::Promise(payload)) = ty.clone() else {
                    return Err(self.unrepresentable(capture.at, "a captured promise settler"));
                };
                self.settlers.insert(
                    capture.symbol,
                    Settler {
                        result: AsyncResult {
                            promise: value,
                            payload: *payload,
                            written: None,
                        },
                        rejects,
                    },
                );
            } else if capture.readiness_only {
                self.class_cells.insert(capture.symbol, value);
            } else {
                self.bindings.insert(capture.symbol, value);
            }
            // The field itself is never reassigned either way: by value it is
            // the captured value, and by reference it is a pointer to storage
            // that is written *through* rather than replaced.
            fields.push(Field {
                name: (capture.name.clone()).into(),
                ty,
                readonly: true,
                declared_by: None,
                written: None,
            });
        }
        Ok(fields)
    }

    /// The cell a symbol lives in, where something captures it by reference.
    ///
    /// `None` is the ordinary case: the name is an SSA value like any other and
    /// costs nothing. That is what keeps a program full of locals free of cells.
    pub(super) fn cell_of(&self, symbol: u32) -> Option<usize> {
        self.boxed.iter().position(|held| *held == symbol)
    }

    /// A counted handle in a new box of its family's, which holds the count.
    pub(super) fn boxed(
        &mut self,
        value: ValueId,
        pointee: &crate::hir::native::Pointee,
        origin: &Origin,
    ) -> Option<ValueId> {
        let (ty, root) = self.handle_box_layout(pointee)?;
        let handle = self.push(
            OpKind::Convert(value),
            HirType::NativePointer(root),
            origin.clone(),
        );
        let boxed = self.push(
            OpKind::ObjectNew { frame: false },
            HirType::Managed(ManagedType::Object(ty)),
            origin.clone(),
        );
        self.field_set(boxed, 0, handle, origin);
        Some(boxed)
    }

    /// The one-field object a captured-and-written variable lives in.
    fn cell_layout(&self, index: usize, ty: HirType) -> Layout {
        let readiness_only = self
            .boxed
            .get(index)
            .is_some_and(|symbol| self.initialization.class_cell(*symbol));
        let mut fields = if readiness_only {
            Vec::new()
        } else {
            vec![Field {
                name: ("value".to_owned()).into(),
                ty,
                // Written by definition -- being written is why it exists.
                readonly: false,
                declared_by: None,
                // The local's written kind: a closure reads it through here, and
                // every assignment to the local was obliged to fit it.
                written: self
                    .boxed
                    .get(index)
                    .and_then(|symbol| self.written_kind_of_symbol(*symbol)),
            }]
        };
        // Zero until the declaration runs, which is what the guard reads. Only
        // on a cell that has the window; every other one carries nothing.
        if readiness_only || self.is_guarded(index) {
            fields.push(Field {
                name: ("ready".to_owned()).into(),
                ty: HirType::Bool,
                readonly: false,
                declared_by: None,
                written: None,
            });
        }
        Layout {
            types: vec![cell_type(index)],
            name: cell_name(index),
            interfaces: Vec::new(),
            fields,
            methods: vec![None; self.hierarchy.table_size()],
            // A cell is storage a closure shares, not a class.
            base: None,
        }
    }

    /// Whether the cell at `index` carries a `ready` flag.
    pub(super) fn is_guarded(&self, index: usize) -> bool {
        self.boxed.get(index).is_some_and(|symbol| {
            self.guarded.contains(symbol) && self.initialization.cell_needs_guard(*symbol)
        })
    }

    /// Move a name into its cell, and bind the name to the cell.
    ///
    /// Everything afterwards reads and writes through the cell, in this
    /// function and in every closure that captured it.
    pub(super) fn open_cell(&mut self, symbol: u32, value: ValueId, at: NodeId) -> ValueId {
        let Some(index) = self.cell_of(symbol) else {
            return value;
        };
        // A closure written above this declaration already opened the cell, so
        // this is a store into it rather than a new one -- which is the whole
        // point: the closure and the declaration have to name one cell.
        if let Some(cell) = self.opened_cell(symbol, index) {
            let origin = self.origin(at);
            self.field_set(cell, 0, value, &origin);
            // The cell was opened empty, above. This is the moment it stops
            // being, and the flag is what a closure's read consults.
            if self.is_guarded(index) {
                let ready = self.push(OpKind::ConstBool(true), HirType::Bool, origin.clone());
                self.field_set(cell, 1, ready, &origin);
            }
            return cell;
        }
        let ty = self.values[value.0 as usize].ty.clone();
        let origin = self.origin(at);
        let cell_ty = HirType::Managed(ManagedType::Object(cell_type(index)));
        self.layouts.push(self.cell_layout(index, ty));
        let cell = self.push(OpKind::ObjectNew { frame: false }, cell_ty, origin.clone());
        self.field_set(cell, 0, value, &origin);
        // Opened here, by its declaration, so written as it is made: a guarded
        // cell's flag says so at once. Until a nested function could be built
        // before its declaration's statement (`bind_later_siblings`), a guarded
        // cell was always opened empty by a closure above and written here
        // through the arm before this one, and this arm left the flag clear --
        // `first` calling `second` read "second" as not yet initialised.
        if self.is_guarded(index) {
            let ready = self.push(OpKind::ConstBool(true), HirType::Bool, origin.clone());
            self.field_set(cell, 1, ready, &origin);
        }
        cell
    }

    /// The cell already standing for this symbol, if one is.
    ///
    /// The type is the test rather than the binding's presence: a name from an
    /// enclosing scope can be bound to something that is not this cell, and
    /// storing into that would write to the wrong place.
    pub(super) fn opened_cell(&self, symbol: u32, index: usize) -> Option<ValueId> {
        let bound = self.bindings.get(&symbol).copied()?;
        let wanted = HirType::Managed(ManagedType::Object(cell_type(index)));
        (self.values[bound.0 as usize].ty == wanted).then_some(bound)
    }

    /// Refuse a `new` whose callee is a **value holding a class** rather than a
    /// class the compiler can see.
    ///
    /// `new Thing(n)` and `new C(n)` are the same syntax and not the same
    /// operation: the first names a class, the second reads a binding whose
    /// contents this compiler cannot know. The difference is exactly whether the
    /// callee's symbol is bound to a value here, which is what
    /// [`Self::bindings`] holds and a class declaration is not.
    ///
    /// # It was a wrong answer that ran
    ///
    /// The constructed type came from the *expression's* type, which the checker
    /// takes from the callee's declared type. For `function make(C: typeof
    /// Thing)`, `new C(n)` is typed `Thing` — so it built a `Thing`, called
    /// `Thing__constructor`, and discarded the class argument outright:
    ///
    /// ```text
    /// static int32_t make(NtsObj_Fn2__1 * v0, int32_t v1) {
    ///     (void)v0;
    ///     v2_frame.header.descriptor = &nts_desc_NtsObj_Thing__Thing;
    ///     Thing__constructor(v2, v1);
    /// ```
    ///
    /// One class reaching the site is correct, which is why it was invisible. A
    /// second assignable class is built **as the first**, at the first's size,
    /// running the first's constructor; `Other`'s was never emitted and its
    /// descriptor read `sizeof(NtsObj_Thing)` under the name `"Other"`. Two
    /// classes through one site disagreed with node on **18 of 58 cases** and
    /// produced a number for every one.
    ///
    /// # It was already the intent
    ///
    /// The class-token lowering says so: "`new` through such a value is a
    /// separate feature and still refuses, as `a computed constructor`". It did
    /// refuse a *computed* callee — `new things[0]()` has no identifier text. A
    /// **named** binding has text, so it was resolved by name instead and slipped
    /// past. This makes the behaviour match the sentence.
    ///
    /// Building it needs the token to carry the instance descriptor and the
    /// constructor, which is the generator's resumption slot with a different
    /// member. 29 sites in `runtime/node`, and no addon depends on them.
    pub(super) fn constructed_from_a_value(
        &self,
        id: NodeId,
        callee: NodeId,
        class: &str,
    ) -> Result<(), Diagnostic> {
        let Some(symbol) = self.node(callee).symbol else {
            return Ok(());
        };
        if !self.bindings.contains_key(&symbol.0) {
            return Ok(());
        }
        Err(self.unsupported(
            id,
            &format!(
                "a `new` through `{class}`, which holds a class rather than naming one -- the \
                 constructor would be chosen from the declared type and not from the value"
            ),
        ))
    }

    /// Open a cell in the *entry* block, for a name read above its declaration.
    ///
    /// In the entry block rather than beside the closure, because it has to
    /// dominate both the closure that reads it and the declaration that fills
    /// it, and those can be in different branches. The entry block dominates
    /// everything, so this is the one placement that always holds.
    ///
    /// The cell stays unready until the declaration runs. Its lexical reads
    /// throw `ReferenceError`; a forward var keeps the named representation
    /// stop until its cell can represent JavaScript's initial undefined.
    pub(super) fn open_cell_early(&mut self, symbol: u32, at: NodeId) -> Option<ValueId> {
        let index = self.cell_of(symbol)?;
        // **`closure_bound_to` first, exactly as `captured_as` asks it.** The
        // checker's type for a closure is its *signature* -- `__function` --
        // which no layout hangs on; a closure's layout is on the synthetic
        // closure class. Typing the cell from the signature built a cell whose
        // element type nothing had a layout for, and the backend said `an
        // object type with no layout` about a program the lowering had called
        // clean. Two derivations of one fact, and this was the narrow one.
        let ty = self.closure_bound_to(symbol).or_else(|| self.type_of(at))?;
        let origin = self.origin(at);
        self.layouts.push(self.cell_layout(index, ty));
        let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op {
            kind: OpKind::ObjectNew { frame: false },
            ty: HirType::Managed(ManagedType::Object(cell_type(index))),
            origin,
        });
        self.blocks[0].ops.insert(0, id);
        self.bindings.insert(symbol, id);
        Some(id)
    }

    /// One readiness cell per declaring invocation. An entry allocation
    /// dominates both a forward closure and the declaration that sets it.
    pub(super) fn open_class_cell(
        &mut self,
        symbol: u32,
        at: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        if let Some(cell) = self.class_cells.get(&symbol).copied() {
            return Ok(cell);
        }
        let index = self.cell_of(symbol).ok_or_else(|| {
            self.unsupported(at, "a class readiness capture with no cell identity")
        })?;
        self.layouts.push(self.cell_layout(index, HirType::Bool));
        let cell = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op {
            kind: OpKind::ObjectNew { frame: false },
            ty: HirType::Managed(ManagedType::Object(cell_type(index))),
            origin: self.origin(at),
        });
        self.blocks[0].ops.insert(0, cell);
        self.class_cells.insert(symbol, cell);
        Ok(cell)
    }

    /// Read a name that lives in a cell.
    pub(super) fn read_cell(
        &mut self,
        symbol: u32,
        cell: ValueId,
        at: NodeId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(index) = self.cell_of(symbol) else {
            return Ok(None);
        };
        let Some(ty) = self
            .program_layout_field(index)
            .or_else(|| self.type_of(at))
        else {
            return Ok(None);
        };
        let origin = self.origin(at);
        // Inside a closure only. A read before the declaration is the one thing
        // the typechecker cannot catch here, because the body runs later; a
        // direct one in the same scope it rejects itself.
        if self.in_closure && self.is_guarded(index) {
            let name = self
                .node(at)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                .map_or_else(|| "a name".to_owned(), str::to_owned);
            if self.initialization.lexical_cell(symbol) {
                self.check_lexical_cell_ready(at, symbol, cell)?;
            } else if self.initialization.var_cell(symbol) {
                self.check_var_ready(at, symbol, cell);
            } else {
                // Merged or otherwise unclassified bindings retain the
                // existing stop; the pure-var rule needs a declaration proof.
                self.push(
                    OpKind::CellReady { cell, name },
                    HirType::Void,
                    origin.clone(),
                );
            }
        }
        Ok(Some(self.push(
            OpKind::FieldGet {
                object: cell,
                field: 0,
            },
            ty,
            origin,
        )))
    }

    /// The class a closure allocates, with its one method in the shared slot.
    pub(super) fn closure_layout(&self, index: usize, fields: Vec<Field>) -> Layout {
        let (class, method) = closure_names(index);
        let mut methods = vec![None; self.hierarchy.table_size()];
        if let Some(slot) = self.hierarchy.closure_slot {
            methods[slot as usize] = Some(method);
        }
        if let Some(slot) = self.hierarchy.erased_call_slot {
            methods[slot as usize] = Some(erased_call_name(index));
        }
        Layout {
            types: vec![closure_type(index)],
            name: class,
            interfaces: Vec::new(),
            fields,
            methods,
            // Every closure is its own class and extends nothing.
            base: None,
        }
    }

    /// `(x) => x * n` — allocate the closure and write what it captured.
    ///
    /// The same two operations `new C(...)` lowers to, for the same reason: an
    /// allocation and the stores that fill it. Everything after this treats the
    /// result as the object it is, so a closure that does not outlive the call
    /// ends up in the frame and one that does gets a reference count.
    /// **A nested `function` declaration can call itself, and inside its own
    /// body its name is the closure.**
    ///
    /// The allocating side binds the name in the *enclosing* function, which is
    /// where the call `down(3)` resolves. A recursive `down(k - 1)` is inside
    /// this body, where that binding does not reach -- so without this, a
    /// capturing nested function that recurses refused as "Closure0#call ...
    /// calls `down`", which is the shape the row's own motivating case has: "a
    /// recursive matcher closing over `columns` and `memo`".
    ///
    /// The receiver *is* the closure, so the name and parameter zero are the
    /// same value and no field is needed for it. An arrow has no name to bind
    /// and a function expression's name is optional, which is why this sits
    /// here rather than beside the captures.
    ///
    /// **A named `function` expression is the same**: `function walk(k) {
    /// return walk(k - 1) }` names itself, and only inside its own body. It was
    /// refused as "a function used as a value" until a `function` that reads its
    /// own `this` became a closure and recursed through `walk.call(this, …)`.
    /// Its name is optional, and an unnamed one's first child is a parameter,
    /// which has a symbol too, so the child has to be the name.
    pub(super) fn bind_own_name(&mut self, id: NodeId, receiver: ValueId) {
        let names_itself = match self.kind_of(id) {
            Some(syntax::FUNCTION_DECLARATION) => true,
            Some(syntax::FUNCTION_EXPRESSION) => self
                .children(id)
                .first()
                .is_some_and(|name| self.kind_of(*name) == Some(syntax::IDENTIFIER)),
            _ => false,
        };
        if names_itself
            && let Some(name) = self.children(id).first()
            && let Some(symbol) = self.node(*name).symbol
        {
            self.bindings.insert(symbol.0, receiver);
        }
    }

    /// Whether this nested function's closure can be built at the top of its
    /// block rather than where it stands.
    ///
    /// **Only when everything it captures is declared outside the block**, and the
    /// arm that forced this is a wrong answer rather than a refusal:
    ///
    /// ```ts
    /// const got = run(inner);
    /// let later = n + 1;
    /// function inner(): number { return later * 3; }
    /// ```
    ///
    /// node throws `ReferenceError: Cannot access 'later' before initialization`
    /// -- `inner` is hoisted and `later` is in its temporal dead zone -- and a
    /// closure built at the top of the block reads the cell before anything wrote
    /// it and answers `NaN`. Before the hoist this shape *refused*, at the use,
    /// which is the honest answer and the one it keeps: a refusal turning into a
    /// wrong answer is the one direction a change must not go.
    ///
    /// `Capture::forward` is the wrong test and was the first one written: it says
    /// "declared below *this declaration*", and hoisting moves the closure above
    /// the whole list, so a capture declared **anywhere in the block** is one the
    /// top of the block cannot see. In the arm above `later` is declared before
    /// `inner` and `forward` is correctly false, so that guard did not fire and
    /// the answer stayed `NaN`. Measured, not reasoned -- the fixture had the arm
    /// and the guard did not stop it.
    ///
    /// By span rather than by walking the block's subtree: this runs once per
    /// declaration per block, and a containment test on two offsets answers the
    /// same question as a walk without being quadratic in a long body. A
    /// parameter and an outer local both start before the block's brace, which is
    /// what makes the comparison the right one.
    ///
    /// Answering the dead zone properly is a feature -- a check at the read
    /// against a cell that records whether anything has written it -- and this
    /// names it rather than guessing at it.
    pub(super) fn hoistable(&self, block: NodeId, id: NodeId) -> bool {
        let extent = self.node(block).origin.location.span;
        let inside = |at: NodeId| {
            let span = self.node(at).origin.location.span;
            span.start >= extent.start && span.start < extent.end
        };
        self.closures
            .iter()
            .filter(|closure| closure.node == id)
            .all(|closure| {
                closure.captures.iter().all(|capture| {
                    capture.readiness_only
                        || self
                            .snapshot
                            .symbols
                            .get(capture.symbol as usize)
                            .is_none_or(|record| !record.declarations.iter().copied().any(inside))
                })
            })
    }

    pub(super) fn bind_nested_function(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        if !taken_as_a_closure(&self.closures, id) {
            return Ok(());
        }
        // **The name child's symbol, not the declaration's.** A
        // `FUNCTION_DECLARATION` node carries no symbol of its own -- the
        // identifier inside it does, and that is the symbol every call site
        // resolves to. Binding under `self.node(id).symbol` bound under `None`
        // and returned before `lower_arrow` ever ran, so the closure body was
        // never requested either and the only visible symptom was a call to a
        // function that no longer existed.
        let Some(symbol) = self
            .children(id)
            .first()
            .and_then(|name| self.node(*name).symbol)
        else {
            return Ok(());
        };
        // Already hoisted by [`Self::lower_block`], which binds every function
        // declaration in a statement list before lowering any of them. Called
        // twice for the same declaration on purpose: this arm is what covers a
        // list that hoist does not walk.
        if self.bindings.contains_key(&symbol.0) {
            return Ok(());
        }
        let at = self.node(id).origin.location.span.start;
        self.bind_later_siblings(id, at, &mut vec![id])?;
        let value = self.lower_arrow(id)?;
        // Into its cell where a closure above captured it -- a sibling built
        // before it, which named the cell rather than the closure.
        let bound = self.open_cell(symbol.0, value, id);
        self.bindings.insert(symbol.0, bound);
        Ok(())
    }

    /// The function declarations below `id` in its statement list that it
    /// captures, built first, at `at` -- the position of the declaration being
    /// built -- so `first` calling `second`, declared after it, captures a
    /// closure rather than a name nothing has bound. JavaScript hoists both;
    /// `second` is callable from `first`'s first call.
    ///
    /// **Only a sibling that could stand at `at`**: one whose own captures are
    /// each declared before `at`, outside the list, or another such sibling.
    /// That is [`Self::hoistable`]'s rule moved down the list rather than to its
    /// top, for its reason: a closure built above a `let` it captures reads
    /// the cell before anything wrote it. A sibling that cannot stands where it
    /// is, and a capture of it is refused as before. So is a cycle -- `first`
    /// and `second` each calling the other -- which `visiting` stops.
    fn bind_later_siblings(
        &mut self,
        id: NodeId,
        at: u32,
        visiting: &mut Vec<NodeId>,
    ) -> Result<(), Diagnostic> {
        let list = self.node(id).parent;
        let captured: Vec<u32> = self
            .closures
            .iter()
            .filter(|closure| closure.node == id)
            .flat_map(|closure| closure.captures.iter().map(|capture| capture.symbol))
            .collect();
        for symbol in captured {
            let Some(sibling) = self.later_sibling_function(symbol, list, at) else {
                continue;
            };
            if visiting.contains(&sibling) || self.bindings.contains_key(&symbol) {
                continue;
            }
            // Refused here, by name, rather than left for the capture to find
            // unbound: that refusal blamed a closure with no refusal of its own.
            if !self.could_stand_at(sibling, list, at) {
                let name = self
                    .name_node(sibling)
                    .and_then(|name| {
                        self.node(name)
                            .text
                            .as_ref()
                            .and_then(|text| text.as_utf8())
                            .map(str::to_owned)
                    })
                    .unwrap_or_default();
                return Err(self.unsupported(
                    id,
                    &format!(
                        "a call of `{name}`, declared below this function, which captures a name declared after this \
                         function's declaration -- built here, it would read that name before anything wrote it"
                    ),
                ));
            }
            visiting.push(sibling);
            let built = self.bind_later_siblings(sibling, at, visiting);
            visiting.pop();
            built?;
            if !self.bindings.contains_key(&symbol) && taken_as_a_closure(&self.closures, sibling) {
                let value = self.lower_arrow(sibling)?;
                // A name a closure above captured is a cell: the capture
                // analysis boxed it for being read before its declaration.
                let bound = self.open_cell(symbol, value, sibling);
                self.bindings.insert(symbol, bound);
            }
        }
        Ok(())
    }

    /// The function declaration `symbol` names, where it is a statement of
    /// `list` declared after `at`.
    fn later_sibling_function(&self, symbol: u32, list: Option<NodeId>, at: u32) -> Option<NodeId> {
        self.snapshot
            .symbols
            .get(symbol as usize)?
            .declarations
            .iter()
            .copied()
            .find(|declaration| {
                self.kind_of(*declaration) == Some(syntax::FUNCTION_DECLARATION)
                    && self.node(*declaration).parent == list
                    && self.node(*declaration).origin.location.span.start > at
            })
    }

    /// Whether `sibling`'s closure could be built at `at` in `list`: each name
    /// it captures is declared before `at`, outside `list`, or is itself a
    /// later sibling function (built first, by the caller).
    fn could_stand_at(&self, sibling: NodeId, list: Option<NodeId>, at: u32) -> bool {
        let extent = list.map(|list| self.node(list).origin.location.span);
        self.closures
            .iter()
            .filter(|closure| closure.node == sibling)
            .all(|closure| {
                closure.captures.iter().all(|capture| {
                    capture.readiness_only
                        || self
                            .later_sibling_function(capture.symbol, list, at)
                            .is_some()
                        || self
                            .snapshot
                            .symbols
                            .get(capture.symbol as usize)
                            .is_none_or(|record| {
                                record.declarations.iter().all(|declaration| {
                                    let start = self.node(*declaration).origin.location.span.start;
                                    start < at
                                        || extent.is_none_or(|extent| {
                                            start < extent.start || start >= extent.end
                                        })
                                })
                            })
                })
            })
    }

    pub(super) fn lower_arrow(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // The variant for this copy where there is one, else the closure as
        // written. See `ClosureInfo::within`.
        let index = self
            .closures
            .iter()
            .position(|closure| {
                closure.node == id && closure.within.as_deref() == Some(self.suffix.as_str())
            })
            .or_else(|| {
                self.closures
                    .iter()
                    .position(|closure| closure.node == id && closure.within.is_none())
            })
            .ok_or_else(|| self.unsupported(id, "an arrow function the collector did not see"))?;
        let info = self.closures[index].clone();
        if let Some(reason) = info.refusal {
            return Err(self.unsupported(id, reason));
        }

        self.used_closures.push(index);

        let ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(id);
        let object = self.push(OpKind::ObjectNew { frame: false }, ty, origin.clone());

        let mut fields = Vec::new();
        for (at, capture) in info.captures.iter().enumerate() {
            // The value the enclosing scope holds. It is in `bindings` because
            // the collector only allowed a capture of something declared
            // outside the arrow and never assigned -- so by the time the arrow
            // is reached, the binding exists and is final.
            // `this` is not in `bindings` and never was: it is the enclosing
            // function's receiver, which is exactly what an arrow inherits.
            // **A settler captures the promise, not the settler.** `resolve`
            // and `reject` are not values -- a call to one is the settle it
            // stands for -- so there is nothing in `bindings` to copy. What the
            // body needs in order to settle is the promise, and that *is* a
            // value, held right here by the executor being lowered inline.
            //
            // The field is therefore a `Promise<T>` while the name in the
            // source is a function, which is why `Capture::settles` exists: the
            // body's side has to read the field at the same type, and re-derive
            // the settle from it.
            if capture.settles.is_some() {
                let settler = self.settlers.get(&capture.symbol).cloned().ok_or_else(|| {
                    // The collector saw a `new Promise` executor parameter and
                    // this builder is not lowering that executor -- which means
                    // the closure escaped the construction site, and the
                    // promise it would settle is not in hand.
                    self.unsupported(
                        capture.at,
                        "a promise settler captured outside the executor that names it",
                    )
                })?;
                let value = settler.result.promise;
                let field_ty = self.values[value.0 as usize].ty.clone();
                self.field_set(object, u32::try_from(at).unwrap_or(0), value, &origin);
                fields.push(Field {
                    name: (capture.name.clone()).into(),
                    ty: field_ty,
                    readonly: true,
                    declared_by: None,
                    written: None,
                });
                continue;
            }
            if capture.symbol == THIS_CAPTURE {
                let value = self
                    .this
                    .ok_or_else(|| self.unsupported(capture.at, "`this` outside a method"))?;
                // **The type the body will read it at, not the type in hand.**
                //
                // The two sides of a closure's layout are built by different
                // builders and merged, so they have to agree on every field's
                // type. The body takes `this` from `type_of(capture.at)` -- the
                // checker's type for `this` inside the arrow, which is the class
                // that *declares* the arrow. This side had been using whatever
                // the receiver happened to be.
                //
                // Those were the same thing for as long as a closure could only
                // be allocated in a method, where the receiver is the declaring
                // class. A field initializer is lowered at the *allocation
                // site* and its `this` is the object being constructed -- so
                // `class GlobalConsole extends Console` writing `Console`'s
                // arrow fields put a `GlobalConsole *` in a slot the body reads
                // as `NtsObj_Console *`, and clang refused the module with
                // `incompatible pointer types`. Seven of them in `console`,
                // which is the only inheritance in that file.
                //
                // The upcast is free -- base-first layout makes the pointers
                // equal -- so this is a type correction rather than a
                // conversion, and `coerce` emits nothing for it.
                let field_ty = self
                    .type_of(capture.at)
                    .unwrap_or_else(|| self.values[value.0 as usize].ty.clone());
                let value = self.coerce(value, &field_ty, capture.at)?;
                self.field_set(object, u32::try_from(at).unwrap_or(0), value, &origin);
                // The layout this side builds has to have the same fields in
                // the same order as the one the body builds, or every index
                // after this one is off by a field.
                fields.push(Field {
                    name: (capture.name.clone()).into(),
                    ty: field_ty,
                    readonly: true,
                    declared_by: None,
                    written: None,
                });
                continue;
            }
            let value = if capture.readiness_only {
                self.open_class_cell(capture.symbol, capture.at)?
            } else {
                if !self.bindings.contains_key(&capture.symbol) {
                    self.open_cell_early(capture.symbol, capture.at);
                }
                *self.bindings.get(&capture.symbol).ok_or_else(|| {
                    // Every name that is reached *by* name -- a function, a class,
                    // an import, a type, anything at module scope -- is excluded
                    // from captures before this. So a miss here is a local that has
                    // no value at the point the closure is built, which in practice
                    // means the closure was written above the declaration:
                    //
                    //     const onListening = () => { ...cleanup... };
                    //     const cleanup = ...;
                    //
                    // Legal, because the body runs later. Capturing it here would
                    // capture nothing, so it is refused rather than answered.
                    //
                    // **A `new Promise` settler is a different miss and said the
                    // wrong thing about itself.** `resolve` and `reject` are
                    // parameters of the executor arrow, declared as ordinarily as
                    // any parameter -- nothing about them is above its own
                    // declaration. They are absent from `bindings` because
                    // `Settler`'s doc says they are "not values at all": the
                    // executor is lowered at the construction site and a call to
                    // one is the settle it stands for.
                    //
                    // So a closure written *inside* the executor that captures one
                    // was told its program had a use-before-declaration, which it
                    // does not, and 41 of the 48 sites in that census row are this.
                    // The commonest shape in the corpus:
                    //
                    //     new Promise((resolve, reject) => {
                    //       const done = (e: Error | null): void => {
                    //         if (e !== null) { reject(e); return; }
                    //         resolve(v);
                    //       };
                    //       lookupService(host, done);
                    //     });
                    //
                    // Measured rather than assumed: the identical shape written as
                    // a *user* function with two callback parameters lowers, and so
                    // does `new Promise((resolve) => resolve(7))` with no inner
                    // closure. Only the pair refuses.
                    //
                    // **Not `new Promise` by name**, because the same map serves
                    // `Promise.withResolvers`: its destructured `resolve` and
                    // `reject` are settlers too, and a closure capturing one lands
                    // here identically. Saying `new Promise` would be right about
                    // 41 sites and wrong about whichever spelling a reader had in
                    // front of them.
                    if let Some(settler) = self.settlers.get(&capture.symbol) {
                        let which = if settler.rejects { "reject" } else { "resolve" };
                        return self.unsupported(
                            capture.at,
                            &format!(
                                "`{}`, a promise {which} captured by a closure -- a settler is a \
                             call this lowering rewrites rather than a value it can hold",
                                capture.name
                            ),
                        );
                    }
                    self.unsupported(
                        capture.at,
                        &format!(
                            "`{}`, captured above its own declaration, where it has \
                         no value yet",
                            capture.name
                        ),
                    )
                })?
            };
            let (value, field_ty) = self.stored_capture(&info, capture, value)?;
            self.field_set(object, u32::try_from(at).unwrap_or(0), value, &origin);
            fields.push(Field {
                name: (capture.name.clone()).into(),
                ty: field_ty,
                readonly: true,
                declared_by: None,
                written: None,
            });
        }
        // The same layout the body's side builds. Both are pushed, and
        // `collect_layouts` merges them -- which is also the check that the two
        // sides agree, because a disagreement would be two layouts for one type
        // rather than one.
        self.layouts.push(self.closure_layout(index, fields));
        Ok(object)
    }

    /// `new C(a, b)` — allocate, then run the constructor over it.
    ///
    /// The allocation is the value. The constructor writes through the pointer
    /// it is handed and returns nothing, so `new` is an allocation and a call
    /// rather than an allocation, a call, and a pointer round-trip that every
    /// stage downstream has to prove is the identity.
    /// The children of a call or `new` that are *arguments*.
    ///
    /// Explicit type arguments are flattened in among them --
    /// `new Box<number>(xs)` arrives as `[Box, number, xs]` -- so they are
    /// dropped by asking the frontend for its type-node classification. Nothing
    /// structural distinguishes them: a list is not a node here.
    /// What a closure stores for a capture, and at what type.
    ///
    /// A cell is stored as itself -- the body unwraps it -- and any other
    /// capture at the type the body will read it as. See `captured_as` for
    /// the crash this replaces.
    ///
    /// **Two different object types here is refused, not cast.** The value is
    /// a `Thing` and the body reads a `Named` only inside a structural copy
    /// that re-types a captured parameter, and `closure_variants` gives every
    /// such closure a variant whose field reads the copy's type -- so this
    /// fires only where no variant applies, which is a closure the collector
    /// and the copy disagree about. A prefix-compatible pair would pass
    /// `coerce` on C and LLVM by luck of layout and be declined on the JVM,
    /// which relates classes by name, so the three lanes would disagree about
    /// one program; refused the same way everywhere instead.
    fn stored_capture(
        &mut self,
        info: &ClosureInfo,
        capture: &Capture,
        value: ValueId,
    ) -> Result<(ValueId, HirType), Diagnostic> {
        let have = self.values[value.0 as usize].ty.clone();
        if self.cell_of(capture.symbol).is_some() {
            return Ok((value, have));
        }
        let held = self.captured_as(info, capture)?;
        // **Read it as a direct use reads it**, before asking whether it fits the
        // field.
        //
        // The field is typed at what the *body* will read it at, which for a
        // binding an `instanceof` narrowed is the narrowed type -- and the value in
        // hand is what the binding was declared as. So the store was a **downcast**,
        // and for a handle `coerce` refuses one: "an opaque C pointer converted to a
        // different representation". A direct use of the same binding in the same
        // branch is correct, because it goes through [`Self::narrowed`], which emits
        // the `Convert` a GObject or Objective-C narrowing needs and nothing at all
        // where the types already agree.
        //
        // So the capture asks the same function rather than a second rule about
        // which conversions a capture may make. The GTK lane's measurement is what
        // located it: the arrow's frame field was *already* `native<_GtkSwitch>` and
        // its body lowered clean; the refused function was the enclosing one, at the
        // store. It is the blocker for seven of nine of their Workbench demo ports,
        // and `const sw: GtkSwitch = box` beside the capture is the workaround that
        // shows what is missing -- that spelling emits exactly the `convert` this
        // now emits, because a declaration's initializer is a direct use.
        //
        // A cell returns above, and must: what `bindings` holds for a
        // captured-and-written name is the cell rather than the value, so narrowing
        // it would re-type the cell.
        let value = self.narrowed(capture.at, value)?;
        let have = self.values[value.0 as usize].ty.clone();
        if let (
            HirType::Managed(ManagedType::Object(have)),
            HirType::Managed(ManagedType::Object(want)),
        ) = (&have, &held)
            && have != want
        {
            return Err(self.unsupported(
                capture.at,
                &format!(
                    "`{}`, a `{}` captured by a closure that reads it as a `{}` -- a parameter \
                     this copy re-typed, in a closure the copy does not",
                    capture.name,
                    self.name_of_type(*have).unwrap_or("an anonymous type"),
                    self.name_of_type(*want).unwrap_or("an anonymous type"),
                ),
            ));
        }
        Ok((self.coerce(value, &held, capture.at)?, held))
    }

    pub(super) fn arguments_of(&self, id: NodeId) -> Vec<NodeId> {
        self.children(id)
            .into_iter()
            .skip(1)
            .filter(|child| !syntax::is_type_node(self.kind_of(*child).unwrap_or(0)))
            // `f?.(x)` puts the `?.` among the children the way `f<T>(x)` puts
            // its type argument there. Both are punctuation and neither is an
            // argument; lowering this one reported "a question dot token is not
            // supported", which is true and says nothing.
            .filter(|child| self.kind_of(*child) != Some(syntax::QUESTION_DOT_TOKEN))
            .collect()
    }
}

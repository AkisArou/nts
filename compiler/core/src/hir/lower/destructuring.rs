//! Extract, default, and bind or assign values of array and object patterns.

use super::{
    Absent, AsyncResult, BinOp, Branch, Callee, CapabilityBinding, Diagnostic, FuncBuilder,
    HirType, ManagedType, MethodAccessor, NodeId, OpKind, Place, Settler, SymbolId, Terminator,
    TypeKind, ValueId, a_pattern_that_requires_coercion, abstract_generator_kind,
    binding_element_parts, elision_patterns, in_javascript, syntax,
};

/// The caller knows whether a pattern initializes module storage or local
/// bindings. A declaration's AST ancestry alone cannot distinguish a loop
/// head lowered as local state from a top-level module declaration.
#[derive(Clone, Copy)]
pub(super) enum PatternScope {
    /// A parameter environment whose closures must share these bindings.
    Parameters,
    Local,
    Module,
}

/// Whether every member of this type is an absence.
///
/// `null`, `null | undefined`, `undefined | void` -- types whose whole
/// inhabitant set is `null` and `undefined`, both of which an erased value
/// carries a tag for.
///
/// A free function because `representation_within` has no `self` to ask, and
/// [`Lowering::holds_only_absences`] is the method that delegates here. One
/// derivation: the four positions that consult it -- an array's element, a
/// tuple's position, an object's field and a merge's parameter -- have to agree
/// about which types are answerable or a slot and the value put in it disagree.
/// Where one enumerable member's value comes from.
///
/// A field is a slot in the layout. An accessor is a **call**, and has no slot
/// --- which is the whole of why enumeration used to drop one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Enumerated {
    Slot(usize),
    Getter,
    /// A method written in an object literal. It **enumerates** --- node lists
    /// `m` in `Object.keys({ m() {}, v: 2 })` --- and its value is a function
    /// object, which is why it is a case of its own rather than a `Getter`:
    /// there is no getter to call, and building the closure needs a receiver
    /// and a name where `bound_method` wants a property-access node.
    Method,
}

impl FuncBuilder<'_> {
    /// Assign through a pattern written as a literal.
    ///
    /// The mirror of [`Self::bind_pattern`], and a separate function because
    /// the targets are *existing places* rather than new names: `[a, b] = …`
    /// writes to two locals, and `[o.x, xs[i]] = …` writes to a field and an
    /// element. So each target goes through `place_of` exactly as it would have
    /// on its own.
    ///
    /// The same shapes refuse, for the same reasons, and by the same names.
    /// Write one element of an assignment pattern that carries a **default**.
    ///
    /// `Ok(false)` when this element has none, so the caller's ordinary read
    /// runs. The value comes from `defaulted_array_element`, which the
    /// *binding* path already uses for `const [a = 7] = xs`: one derivation of
    /// when an element is absent and what happens then, asked by both.
    ///
    /// Array form only. An object assignment pattern's default is refused by
    /// the caller, and so is a rest.
    fn assign_with_a_default(
        &mut self,
        element: NodeId,
        object: bool,
        value: ValueId,
        position: usize,
    ) -> Result<bool, Diagnostic> {
        let Some((destination, default)) = self.assignment_default(element).filter(|_| !object)
        else {
            return Ok(false);
        };
        let read = self.defaulted_array_element(
            element,
            destination,
            destination,
            value,
            position,
            Some(default),
        )?;
        let Some(read) = read else {
            return Err(self.unsupported(
                element,
                "a default in an assignment pattern over something that is not an array, where \
                 there is no length to say whether the element is absent",
            ));
        };
        let place = self.place_of(destination)?;
        self.write_place(destination, &place, read)?;
        Ok(true)
    }

    /// `a = 7` inside an assignment pattern, split into where and what.
    ///
    /// Distinct from a *binding* pattern's default, which arrives as a
    /// `BindingElement` with an initializer child. An assignment pattern is
    /// made of expressions, so its default is an ordinary assignment
    /// expression -- and the whole of it is what `place_of` was being handed.
    fn assignment_default(&self, element: NodeId) -> Option<(NodeId, NodeId)> {
        if self.kind_of(element) != Some(syntax::BINARY_EXPRESSION) {
            return None;
        }
        let parts = self.children(element);
        let [target, operator, default] = parts.as_slice() else {
            return None;
        };
        (self.kind_of(*operator) == Some(syntax::EQUALS_TOKEN)).then_some((*target, *default))
    }

    /// One element of an assignment pattern, read out of the value.
    ///
    /// Three shapes and they are not interchangeable: an **object** pattern
    /// reads a named field, a **tuple** reads the field at that position, and
    /// an **array** reads the element at that index. A tuple is written like
    /// an array and read like an object, because that is what a tuple is here:
    /// the position is the field.
    fn pattern_element_read(
        &mut self,
        element: NodeId,
        property: NodeId,
        object: bool,
        value: ValueId,
        position: usize,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(element);
        if !object
            && let Some(absent) = self.exhausted_pattern_element(element, value, position, None)?
        {
            return Ok(absent);
        }
        Ok(if object {
            if let Some(key) = self.property_key(property)
                && let Some(read) = self.erased_cast_field_read(element, value, &key)?
            {
                return Ok(read);
            }
            let HirType::Managed(ManagedType::Object(type_id)) =
                self.values[value.0 as usize].ty.clone()
            else {
                return Err(self.unsupported(element, "destructuring something with no fields"));
            };
            let layout = self.layout_of(element, type_id)?;
            let key = self
                .property_key(property)
                .ok_or_else(|| self.unsupported(element, "a computed property name"))?;
            let name = key.to_string();
            if let Some(read) = self.interface_field_read(element, value, type_id, &key)? {
                return Ok(read);
            }
            let Some(field) = layout.index_of_key(&key) else {
                return Err(self.absent_member(element, type_id, &name));
            };
            let ty = layout.fields[field as usize].ty.clone();
            self.push(
                OpKind::FieldGet {
                    object: value,
                    field,
                },
                ty,
                origin,
            )
        } else if let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[value.0 as usize].ty.clone()
        {
            // `const [a, b] = pair` where `pair` is a tuple. Written like an
            // array and read like an object, because that is what a tuple
            // is here: the position is the field.
            let layout = self.layout_of(element, type_id)?;
            let field = u32::try_from(position).unwrap_or(0);
            let Some(slot) = layout.fields.get(position) else {
                return Err(self.unsupported(
                    element,
                    &format!(
                        "position {position} of a tuple with {} element(s)",
                        layout.fields.len()
                    ),
                ));
            };
            let ty = slot.ty.clone();
            self.push(
                OpKind::FieldGet {
                    object: value,
                    field,
                },
                ty,
                origin,
            )
        } else {
            let HirType::Managed(ManagedType::Array(element_ty)) =
                self.values[value.0 as usize].ty.clone()
            else {
                return Err(
                    self.unsupported(element, "destructuring something that is not an array")
                );
            };
            #[allow(clippy::cast_precision_loss)]
            let at = position as f64;
            let index = self.push(OpKind::ConstFloat(at), HirType::NUMBER, origin.clone());
            self.push(
                OpKind::ArrayGet {
                    array: value,
                    index,
                    checked: true,
                },
                *element_ty,
                origin,
            )
        })
    }

    pub(super) fn assign_pattern(
        &mut self,
        target: NodeId,
        value: ValueId,
    ) -> Result<(), Diagnostic> {
        let object = self.kind_of(target) == Some(syntax::OBJECT_LITERAL_EXPRESSION);
        for (position, element) in self.children(target).into_iter().enumerate() {
            // Set only by the shorthand arm below, where the node's own symbol
            // is the wrong one to write through.
            let mut shorthand: Option<nts_semantic_schema::SymbolId> = None;
            // `({ x = 1 } = o)`: the same node, plus a default to stand in
            // where the property read is `undefined`.
            let mut shorthand_default: Option<NodeId> = None;
            let (property, destination) = if object {
                let parts = self.children(element);
                match (self.kind_of(element), parts.as_slice()) {
                    // `{ x: o.y } = p`: the property, then where it goes.
                    (Some(syntax::PROPERTY_ASSIGNMENT), [from, to]) => (*from, *to),
                    // `({ x } = p)`: one identifier standing for both the
                    // property *and* the variable it writes to -- and the
                    // symbol on it is the **property's**, not the variable's.
                    // Assigning through it wrote to a symbol nothing reads, so
                    // `x` kept its old value and the compiler said nothing.
                    //
                    // Resolving it needs the checker's
                    // `getShorthandAssignmentValueSymbol`, which this frontend
                    // does not ask for. Until it does, the explicit form
                    // `({ x: x } = p)` is the one that works, and this is
                    // refused rather than guessed at by name -- a guess would
                    // be wrong exactly where a local shadows an outer one.
                    // `({ x } = p)`: one identifier standing for both the
                    // property and the variable it writes to. Resolved by
                    // `shorthand_value_symbol`, which is the lookup the object
                    // *literal* path has always used for the same node --- by
                    // name, local first because a local shadows, and refusing
                    // outright when two bindings of that name are in scope
                    // rather than tossing a coin that compiles.
                    //
                    // Writing through the node's own symbol is what this
                    // refused to do, and correctly: that symbol is the
                    // property's, so the store went somewhere nothing reads and
                    // `x` silently kept its old value.
                    (Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT), [name]) => {
                        let text = self
                            .node(*name)
                            .text
                            .as_ref()
                            .and_then(|text| text.as_utf8())
                            .map(str::to_owned)
                            .ok_or_else(|| {
                                self.unsupported(element, "a shorthand without a name")
                            })?;
                        let symbol = self.shorthand_value_symbol(*name, &text)?;
                        shorthand = Some(symbol);
                        (*name, *name)
                    }
                    // `({ x = 1 } = o)`. The encoder gives the name and the
                    // default as two children, and the name resolves the same
                    // way the one-child form does --- there is no second
                    // question here, only a second child.
                    //
                    // Six files of the census slice stopped here after the
                    // one-child form started working, which is the shape of
                    // every row this compiler clears: one blocker at a time,
                    // and the next one is only visible once the first is gone.
                    // **Three children, not two.** The encoder keeps the `=`:
                    // `[identifier, EqualsToken, initializer]`, which a probe
                    // said and reading the two-child form did not. Matching
                    // `[name, default]` compiled, ran, and refused every one of
                    // these exactly as before.
                    (Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT), [name, _equals, default]) => {
                        let text = self
                            .node(*name)
                            .text
                            .as_ref()
                            .and_then(|text| text.as_utf8())
                            .map(str::to_owned)
                            .ok_or_else(|| {
                                self.unsupported(element, "a shorthand without a name")
                            })?;
                        shorthand = Some(self.shorthand_value_symbol(*name, &text)?);
                        shorthand_default = Some(*default);
                        (*name, *name)
                    }
                    (Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT), _) => {
                        return Err(
                            self.unsupported(element, "a shorthand property of unexpected shape")
                        );
                    }
                    _ => {
                        return Err(self.unsupported(
                            element,
                            "an assignment pattern with a default or a rest",
                        ));
                    }
                }
            } else {
                (element, element)
            };

            // **A default in an assignment pattern**: `[a = 7] = xs`, and the
            // `for ([a = 7] of xss)` head that reaches the same code.
            //
            // The element node is a `BinaryExpression` with `=`, so the
            // destination is its left and the default its right --
            // `place_of(a = 7)` refused it as `assignment to a computed
            // target`, which is what the *whole element* looks like to
            // something expecting a target.
            //
            // The value comes from `defaulted_array_element`, which the
            // *binding* path already uses for `const [a = 7] = xs`: one
            // derivation of when an element is absent and what happens then,
            // asked by both. Only the array form -- an object assignment
            // pattern's default stays refused above, and so does a rest.
            if self.assign_with_a_default(element, object, value, position)? {
                continue;
            }

            // **A hole**: `[, a] = xs`. It binds nothing and still *occupies
            // a position*, and the two facts have to travel together -- the
            // count is what says `a` is the second element, which `enumerate`
            // above already keeps. Skipping without counting would write
            // `xs[0]` into `a`.
            //
            // The binding path learned this on 2026-09-17 (`const [, second] =
            // pair`), and `place_of` was being asked where an *omitted
            // expression* writes, answering `assignment to a computed target`.
            if self.kind_of(element) == Some(syntax::OMITTED_EXPRESSION) {
                continue;
            }

            // **A rest element**: `[a, ...rest] = xs`. The tail comes from
            // `rest_tail`, the same helper `bind_rest` uses, so a fresh array
            // is built here for the same reason it is there.
            //
            // Array form only. `({ a, ...rest } = o)` is a different operation
            // -- an object copy minus the named keys -- and stays refused
            // above, where the object arm says so.
            if !object && self.kind_of(element) == Some(syntax::SPREAD_ELEMENT) {
                let tail = self.rest_tail(element, value, position)?;
                let Some(target) = self.children(element).into_iter().next() else {
                    return Err(self.unsupported(element, "a rest element with no target"));
                };
                if matches!(
                    self.kind_of(target),
                    Some(syntax::ARRAY_LITERAL_EXPRESSION | syntax::OBJECT_LITERAL_EXPRESSION)
                ) {
                    self.assign_pattern(target, tail)?;
                } else {
                    let place = self.place_of(target)?;
                    self.write_place(target, &place, tail)?;
                }
                continue;
            }

            // **Read only for an element that takes a value.** A hole reads
            // nothing and a rest reads its tail, so the element read waits
            // until both have gone. Read first, it was dead for both, and only
            // dead-code removal kept `[,] = []` from stopping at a checked read
            // of index 0 -- until a checked read became an effect, since it may
            // stop, and `for ([,] of [[]])` aborted.
            let read = self.pattern_element_read(element, property, object, value, position)?;

            // **A nested pattern**: `[[a, b]] = xss`, `[{ x: a }] = rows`,
            // `({ p: [a, b] } = o)`. The element's destination is itself an
            // array or object literal, which is the same thing one level down
            // -- so it is the same function, handed the value just read.
            //
            // `place_of` was being asked where an *array literal* writes, and
            // answered truthfully: `assignment to a computed target`. The
            // binding path has always recursed here (`const [[a, b]] = xss`
            // works), and this is the assignment path learning the same shape
            // rather than a second rule that can drift from it.
            if matches!(
                self.kind_of(destination),
                Some(syntax::ARRAY_LITERAL_EXPRESSION | syntax::OBJECT_LITERAL_EXPRESSION)
            ) {
                self.assign_pattern(destination, read)?;
                continue;
            }
            // The default stands in where the read is `undefined`, and only
            // there --- the same two lines `bind_pattern` uses for
            // `const { a = d } = o`, asked of the same helpers, because it is
            // the same question about the same node.
            let read = match shorthand_default {
                Some(default) => match self.defaulted_when(element, property, read)? {
                    Some(absent) => self.lower_branching_value(
                        destination,
                        absent,
                        Branch::Expression(default),
                        Branch::Present(read),
                    )?,
                    // No room for an absence, so the default is unreachable and
                    // the language agrees: it is never evaluated.
                    None => read,
                },
                None => read,
            };
            let place = match shorthand {
                Some(symbol) => self.place_for_symbol(destination, symbol)?,
                None => self.place_of(destination)?,
            };
            self.write_place(destination, &place, read)?;
        }
        Ok(())
    }

    /// A nested JavaScript pattern whose array proves a present reference's type.
    /// This proof selects both the erased read and its checked reconstruction.
    fn reference_element_for_pattern(
        &self,
        binding: NodeId,
        array: ValueId,
        default: Option<NodeId>,
    ) -> Option<HirType> {
        if default.is_some()
            || !in_javascript(self, binding)
            || !matches!(
                self.kind_of(binding),
                Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN)
            )
        {
            return None;
        }
        match &self.values[array.0 as usize].ty {
            HirType::Managed(ManagedType::Array(ty)) if ty.is_managed() => Some((**ty).clone()),
            _ => None,
        }
    }

    /// An exhausted position of the pattern's own immediate array literal.
    ///
    /// The literal has already been evaluated, in order, including every
    /// element's effects. An absent position yields `undefined`, then its
    /// default runs, then the caller binds or assigns it. In particular a TDZ
    /// assignment must raise from `PutValue`, not abort on an earlier `ArrayGet`:
    /// test262's `staging/sm/expressions/destructuring-array-lexical.js`.
    ///
    /// Fold before building a branch: `const [[x] = [1]] = []` has no element
    /// arm, but building that arm would still reconcile the empty literal's
    /// numeric storage with the default's array storage and refuse it.
    ///
    /// An older `ArrayNew` is not proof: a local can grow before the pattern
    /// reads it. Require the pattern's literal RHS/initializer, and its origin
    /// on the allocation, rather than trusting a nominal tuple length.
    fn exhausted_pattern_element(
        &mut self,
        element: NodeId,
        value: ValueId,
        position: usize,
        default: Option<NodeId>,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(pattern) = self.syntactic_parent(element) else {
            return Ok(None);
        };
        let Some(parent) = self.syntactic_parent(pattern) else {
            return Ok(None);
        };
        let source = if self.kind_of(parent) == Some(syntax::VARIABLE_DECLARATION) {
            self.child_slots::<4>(parent)
                .and_then(|[name, _, _, initializer]| {
                    (name == Some(pattern)).then_some(initializer).flatten()
                })
        } else {
            self.assignment_default(parent)
                .filter(|(target, _)| *target == pattern)
                .map(|(_, source)| source)
        };
        let Some(source) = source else {
            return Ok(None);
        };
        let allocation = &self.values[value.0 as usize];
        if self.kind_of(source) != Some(syntax::ARRAY_LITERAL_EXPRESSION)
            || allocation.origin.location != self.origin(source).location
        {
            return Ok(None);
        }
        let OpKind::ArrayNew { length, .. } = allocation.kind else {
            return Ok(None);
        };
        let OpKind::ConstFloat(allocated) = self.values[length.0 as usize].kind else {
            return Ok(None);
        };
        #[allow(clippy::cast_precision_loss)]
        let at = position as f64;
        if allocated > at {
            return Ok(None);
        }
        match default {
            Some(default) => self.lower_expression(default).map(Some),
            None => Ok(Some(self.push(
                OpKind::ConstUndefined,
                HirType::Erased,
                self.origin(element),
            ))),
        }
    }

    /// Bind every name a destructuring pattern introduces.
    ///
    /// The initializer is lowered *once* and each name is a read of it, which
    /// is what the pattern means: `const { a, b } = f()` calls `f` once.
    ///
    /// Only the two plain shapes. A default (`{ a = 1 }`), a rest (`[a,
    /// ...tail]`), a nested pattern and a computed property name are each a
    /// separate feature and are refused by name rather than by falling through
    /// to something that looks close.
    /// One slot of a destructuring pattern, read from what it destructures.
    ///
    /// Three sources and one shape: a property by name for `{ a }`, a field by
    /// position for a tuple, and an indexed element for an array. Extracted
    /// from `bind_pattern` so that the loop there is about *binding* -- rests,
    /// nesting, symbols -- and this is about reading.
    /// `[a = 9]` over an array that may be too short: the default, no read.
    ///
    /// `function f([a = 9]) {}` called as `f([])` is 9 in every engine, and
    /// this compiler aborted the process:
    ///
    /// ```text
    /// nts: refused: index 0 is outside [0, 0)
    /// ```
    ///
    /// The default was applied *after* the read, by the branch in
    /// [`Self::bind_pattern`], so the read a default exists to avoid happened
    /// first and killed the program. Six files in the test262 corpus are this,
    /// every one named `-init-exhausted` -- the suite writes the case down
    /// precisely because it is the one an implementation gets wrong.
    ///
    /// `Ok(None)` when this is not that shape, and the caller falls through to
    /// the ordinary read:
    ///
    ///   * no default -- there is nothing to hand back, and an over-long
    ///     pattern is still a checked read that aborts;
    ///   * a tuple, which is read as an object because the position *is* the
    ///     field: its length is static, so an out-of-range element is already
    ///     refused when the program is compiled rather than when it runs.
    fn defaulted_array_element(
        &mut self,
        element: NodeId,
        property: NodeId,
        binding: NodeId,
        value: ValueId,
        position: usize,
        default: Option<NodeId>,
    ) -> Result<Option<ValueId>, Diagnostic> {
        if let Some(absent) = self.exhausted_pattern_element(element, value, position, default)? {
            return Ok(Some(absent));
        }
        let HirType::Managed(ManagedType::Array(element_ty)) =
            self.values[value.0 as usize].ty.clone()
        else {
            return Ok(None);
        };
        // Keep an inferred reference's absence until the nested pattern checks it.
        if self
            .reference_element_for_pattern(binding, value, default)
            .is_some()
        {
            let origin = self.origin(element);
            #[allow(clippy::cast_precision_loss)]
            let at = position as f64;
            let index = self.push(OpKind::ConstFloat(at), HirType::NUMBER, origin.clone());
            let array = self.push(
                OpKind::Erase {
                    value,
                    absent: Absent::Impossible,
                    slots: Absent::Impossible,
                },
                HirType::Erased,
                origin.clone(),
            );
            // A JavaScript pattern, whose element type is inferred: no
            // absence this could name, so a null slot stays `undefined`.
            let null_slot = self.null_slot(None, &origin);
            return Ok(Some(self.runtime_call(
                "nts_array_element",
                vec![array, index, null_slot],
                HirType::Erased,
                origin,
            )));
        }
        // **With no default, this still answers for an erased element**, and that is a
        // run-time decline closed rather than a conformance row gained: `const [a, b] = [1]`
        // stops the program -- *"an index its `!` promised was in range and was not"* -- where
        // node answers `undefined`. The machinery for it is the first branch below, built for
        // the default case and asking exactly the right question.
        //
        // **Only where the element has room for one.** A `number[]`'s element is a double and
        // `const [a, b]: number[]` declares `b: number`, so answering `undefined` there would
        // be a lie at the type the program wrote -- the decline is the honest answer and stays.
        // Which also means this costs nothing in the runtime corpora, whose arrays are typed,
        // and everything in test262, whose arrays are JavaScript's and erase.
        if default.is_none() && *element_ty != HirType::Erased {
            return Ok(None);
        }
        let origin = self.origin(element);
        #[allow(clippy::cast_precision_loss)]
        let at = position as f64;
        let index = self.push(OpKind::ConstFloat(at), HirType::NUMBER, origin.clone());
        // `OpKind::Length`, the plain read. `Place::ArrayLength` is the
        // *compound-assignment* path and refuses on sight -- "reading an array's
        // `length` as part of assigning to it" -- which is right for `xs.length
        // -= 1` and has nothing to do with this.
        let length = self.push(OpKind::Length(value), HirType::NUMBER, origin.clone());
        // The **absent** condition, matching what `defaulted_when` produces, so
        // that both paths hand `lower_branching_value` a test with one meaning:
        // true takes the default.
        let exhausted = self.push(
            OpKind::Binary {
                op: BinOp::Le,
                lhs: length,
                rhs: index,
            },
            HirType::Bool,
            origin.clone(),
        );
        // **An erased element can be present *and* `undefined`, and the default
        // applies to that too.** `f([undefined])` is `9` for `function f([a =
        // 9])`, exactly as `f([])` is: the language tests the value, and
        // exhaustion is only one way to get an absent one. test262 writes the
        // two as separate files, `-init-exhausted` and `-init-undef`.
        //
        // It is also the *common* case rather than a corner. An unannotated
        // `[a = 9]` is inferred as `(number | undefined)[]`, which represents as
        // erased -- so every untyped destructuring default in the corpus lands
        // here, and a rule that only tested the length would answer `undefined`
        // where the default was written.
        //
        // Two tests, so two branches, and the second one already exists. The
        // first produces the element *as an erased value*, `undefined` when the
        // array is too short -- both arms erased, so there is no representation
        // to reconcile. That value is then an ordinary read with a possible
        // absence, which is precisely what `defaulted_when` and `Branch::Present`
        // were built for: the one tests an erased value's tag for `undefined`,
        // the other reads it back at the type the branch has established.
        if *element_ty == HirType::Erased {
            let undefined = self.push(OpKind::ConstUndefined, HirType::Erased, origin.clone());
            let read = self.lower_branching_value_at(
                element,
                HirType::Erased,
                exhausted,
                Branch::Value(undefined),
                Branch::ArrayElement {
                    array: value,
                    index,
                    ty: HirType::Erased,
                },
            )?;
            // **No default means the read is the answer**, which is the whole of the
            // no-default case: an element that is there, `undefined` where the array ended.
            // The second branch below is what a default adds, and there is nothing for it to
            // choose between.
            let Some(default) = default else {
                return Ok(Some(read));
            };
            let Some(absent) = self.defaulted_when(element, property, read)? else {
                return Ok(Some(read));
            };
            return self
                .lower_branching_value(
                    binding,
                    absent,
                    Branch::Expression(default),
                    Branch::Present(read),
                )
                .map(Some);
        }
        // A concrete element type has no `undefined` to hold, so exhaustion is
        // the whole question and one branch answers it.
        //
        // The binding's node, not the element's, for the reason the ordinary
        // path gives: its type is the one the default has already been folded
        // into, and both arms have to produce it.
        let Some(default) = default else {
            unreachable!("a concrete element with no default returned above")
        };
        self.lower_branching_value(
            binding,
            exhausted,
            Branch::Expression(default),
            Branch::ArrayElement {
                array: value,
                index,
                ty: *element_ty,
            },
        )
        .map(Some)
    }

    fn read_for_pattern(
        &mut self,
        element: NodeId,
        property: NodeId,
        value: ValueId,
        position: usize,
        object: bool,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(element);
        let read = if object {
            if let Some(key) = self.property_key(property)
                && let Some(read) = self.erased_cast_field_read(element, value, &key)?
            {
                return Ok(read);
            }
            // **`length` off an array, in an object pattern.**
            // `function f([...{ length }])` is ordinary JavaScript and the tail
            // is an array, which has no *fields* — so this refused as
            // "destructuring something with no fields", true of the
            // representation and useless about the program.
            //
            // Only `length`, and only for an array. An object pattern over an
            // array can also name numeric keys (`{ 0: x }`), which is a
            // different read and stays refused rather than guessed at.
            if let HirType::Managed(ManagedType::Array(_)) = self.values[value.0 as usize].ty
                && self.literal_name(property).as_deref() == Some("length")
            {
                return Ok(self.push(OpKind::Length(value), HirType::NUMBER, origin));
            }
            let HirType::Managed(ManagedType::Object(type_id)) =
                self.values[value.0 as usize].ty.clone()
            else {
                return Err(self.unsupported(element, "destructuring something with no fields"));
            };
            let layout = self.layout_of(element, type_id)?;
            let key = self
                .property_key(property)
                .ok_or_else(|| self.unsupported(element, "a computed property name"))?;
            let name = key.to_string();
            if let Some(read) = self.interface_field_read(element, value, type_id, &key)? {
                return Ok(read);
            }
            let field = layout.index_of_key(&key);
            let Some(field) = field else {
                // **A getter has no slot, and destructuring is a read.**
                // `const { a } = o` where `a` is an accessor landed on
                // `absent_member`, which said the member had "a type that has
                // no representation (number)" --- false twice over: `number`
                // represents fine, and the member is not absent. The seventh
                // consumer of the same seam as `{ ...src }` and `Object.keys`,
                // and the same answer: call it.
                //
                // Only after the layout has been asked, so a plain field keeps
                // its `FieldGet` and nothing about the ordinary path changes.
                if let Some(callee) =
                    self.accessor_callee(element, type_id, &key, MethodAccessor::Get)?
                {
                    self.refuse_unguarded_iterator_value(element, value, &name)?;
                    let returns = self
                        .declared_type_of(type_id, &key)
                        .and_then(|declared| self.represent(declared))
                        .ok_or_else(|| self.absent_member(element, type_id, &name))?;
                    return Ok(self.push_an_accessor_call(
                        element,
                        callee,
                        vec![value],
                        returns,
                        origin,
                    ));
                }
                return Err(self.absent_member(element, type_id, &name));
            };
            // A binding element is not an access, so the proof below answers
            // `false` for it by construction rather than by assertion: a
            // destructuring has no receiver *expression* here -- the narrowed
            // type sits on the initialiser node and what arrives is the value
            // it produced. `if (!r.done) { const { value } = r; }` is therefore
            // refused along with the unprovable shapes: honest rather than
            // precise, and liftable the day a pattern carries that node.
            self.refuse_unguarded_iterator_value(element, value, &name)?;
            let ty = layout.fields[field as usize].ty.clone();
            self.push(
                OpKind::FieldGet {
                    object: value,
                    field,
                },
                ty,
                origin,
            )
        } else if let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[value.0 as usize].ty.clone()
        {
            // `const [a, b] = pair` where `pair` is a tuple: written like an
            // array and read like an object, because the position *is* the
            // field.
            let layout = self.layout_of(element, type_id)?;
            let Some(slot) = layout.fields.get(position) else {
                return Err(self.unsupported(
                    element,
                    &format!(
                        "position {position} of a tuple with {} element(s)",
                        layout.fields.len()
                    ),
                ));
            };
            let ty = slot.ty.clone();
            let field = u32::try_from(position).unwrap_or(0);
            self.push(
                OpKind::FieldGet {
                    object: value,
                    field,
                },
                ty,
                origin,
            )
        } else {
            let HirType::Managed(ManagedType::Array(element_ty)) =
                self.values[value.0 as usize].ty.clone()
            else {
                return Err(
                    self.unsupported(element, "destructuring something that is not an array")
                );
            };
            #[allow(clippy::cast_precision_loss)]
            let at = position as f64;
            let index = self.push(OpKind::ConstFloat(at), HirType::NUMBER, origin.clone());
            // Checked, like every other element read: a pattern longer than
            // its array is `undefined` in JavaScript and this compiler has
            // no `undefined` to hand back.
            //
            // An element with a **default** never reaches here:
            // `defaulted_array_element` takes that shape, because the read this
            // performs is the one the default exists to avoid.
            self.push(
                OpKind::ArrayGet {
                    array: value,
                    index,
                    checked: true,
                },
                *element_ty,
                origin,
            )
        };
        Ok(read)
    }

    /// `RequireObjectCoercible(value)`, which an object binding pattern runs **before** it
    /// reads anything: step 1 of `BindingInitialization` for an `ObjectBindingPattern`.
    ///
    /// `function fn({}) {}` called as `fn(null)` must throw a `TypeError`. This compiler
    /// bound nothing and went on -- `outcomes/a-parameter-pattern-given-null`, and most of
    /// test262's 147 `assert.throws: nothing was thrown` cases.
    ///
    /// **The check cannot live at the property read, which is why it is here.** A pattern
    /// with elements reads one, and a read of an erased value is already refused by name;
    /// the shape that *compiles and answers wrongly* is the **empty** pattern, which reads
    /// nothing at all. Measured on the materialised case: `fn({})` lowers to
    /// `func fn(arg0: erased)` with a body of `ret`, while `fn({ a })` refuses at the
    /// argument. So the silent half is exactly the half no read can guard.
    ///
    /// **Keyed on [`a_type_that_can_be_absent`] rather than on [`Self::absence_of`]**, and
    /// the difference is load-bearing: that one answers a *representation* question and says
    /// yes to every reference, so a guard keyed on it would throw inside a function
    /// [`walk_one_declaration`](super::raising_reachability::walk_one_declaration) never called a raiser. One predicate, two readers. The
    /// representation is consulted only to *build* the test, which is what `absence_of` is
    /// for -- a tag pair for an erased value, a null pointer for a reference.
    ///
    /// The block shape is [`Self::guard_code_point`]'s and the throw is
    /// [`Self::throw_provided_error`] -- the entry point that exists for *"a check the
    /// language specifies and a runtime helper cannot make"*, because a `TypeError` is laid
    /// out by the program rather than by the runtime.
    ///
    /// **An array pattern is a different step and is not this.** The specification runs
    /// `GetIterator` there and node says `null is not iterable`; over a null the argument is
    /// already refused as *"an erased value where a concrete representation is wanted"* -- a
    /// refusal rather than a wrong answer, so it belongs to the iterator item.
    fn require_object_coercible(
        &mut self,
        pattern: NodeId,
        value: ValueId,
    ) -> Result<(), Diagnostic> {
        if !a_pattern_that_requires_coercion(self, pattern) {
            return Ok(());
        }
        let Some(absent) = self.absence_of(pattern, value) else {
            return Ok(());
        };
        let throwing = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });
        self.switch_to(throwing);
        // Node's text is value-dependent -- `Cannot destructure 'object null' as it is
        // null.` for a parameter, `Cannot destructure property 'a' of 'undefined' as it is
        // undefined.` for a named one -- and test262 asserts the *type* alone. One sentence
        // naming the operation is the honest answer; a fixture printing the message would
        // diverge on wording nobody specified.
        let message = if self.kind_of(pattern) == Some(syntax::ARRAY_BINDING_PATTERN) {
            "a null or undefined value is not iterable"
        } else {
            "Cannot destructure a null or undefined value"
        };
        self.throw_provided_error(pattern, "TypeError", message)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }
        self.switch_to(carry_on);
        Ok(())
    }

    /// An array pattern over a **generator**: each element is one step of the iterator.
    ///
    /// `const [,] = iter` must *step* `iter` -- an elision is `IteratorStep` with the value
    /// discarded, which is `IteratorDestructuringAssignmentEvaluation`'s first clause -- and this
    /// compiler emitted **nothing**: `bind_pattern`'s `[] => continue` skips a hole, and for a
    /// source that is not an array no element is ever read, so the generator was never asked for
    /// anything. A generator whose body throws therefore threw nothing, which is **56 recorded
    /// test262 cases**, every one of them `*elision-step-err*` or `*elision-next-err*`.
    ///
    /// **Only a generator source, and only elisions, and both limits are measured.**
    ///
    /// An *array* source keeps its indexed read: `build_array_from`'s own comment prices a walk
    /// against `slice` at **8.7x** -- 462.77 us against 53.07 us over 256 elements -- and an
    /// array's steps have no observable side effect, so skipping an elision over one is
    /// observationally sound and free. A `Set`, a `Map` and a string are walkable too and are not
    /// here because nothing measured asks for them; they keep today's refusal, which names the
    /// source rather than guessing.
    ///
    /// A **binding** element in a walk refuses, and the sentence is the gap rather than the
    /// symptom: the element would have to be `undefined` where the step answered `done`, and a
    /// `Generator<number>`'s element is a double with no room for one -- the same wall the
    /// past-the-end item stops at for a concrete element type (`965962c4f`). Before this it refused as *"an object type that is not in the snapshot"*,
    /// which is true of a frame's synthetic id and says nothing about the program.
    ///
    /// A **rest** element refuses too, and that one is a feature with a plan entry of its own:
    /// `[...x]` over something iterable needs `collect_a_walk` extracted out of
    /// `build_array_from`, 190 recorded cases, and a step-per-element loop is not it.
    pub(super) fn bind_array_pattern_by_stepping(
        &mut self,
        pattern: NodeId,
        value: ValueId,
        scope: PatternScope,
    ) -> Result<(), Diagnostic> {
        let walk = self.walk_of(pattern, value, None, 1)?;
        let origin = self.origin(pattern);
        for element in self.children(pattern) {
            if self.kind_of(element) != Some(syntax::BINDING_ELEMENT) {
                return Err(self.unsupported(element, "a binding of unexpected shape"));
            }
            let parts = self.children(element);
            if parts
                .iter()
                .any(|part| self.kind_of(*part) == Some(syntax::DOT_DOT_DOT_TOKEN))
            {
                // **A rest element collects what is left**, through the same `collect_a_walk` a
                // `[...x]` over an `Iterable` uses -- and with the same walk this loop has been
                // stepping, which is what makes a rest after an elision correct: the iterator
                // has already advanced past the holes before it.
                return self.bind_rest(element, value, 0, scope);
            }
            // **The step comes first and happens for every element**, which is the whole of what
            // an elision means here: the specification steps the iterator and throws the value
            // away, and the body's `throw` is what that step is for.
            let (_cursor, _done) = self.protocol_step(pattern, &walk, &origin)?;
            if parts.is_empty() {
                continue;
            }
            return Err(self.unsupported(
                element,
                "a name bound from a pattern over a generator, whose element would have to be                  `undefined` where the iterator is done and has no room for one",
            ));
        }
        Ok(())
    }

    /// Publish a module pattern's value at this element, before the next
    /// default or getter can call a reader of it. Locals keep ordinary bindings.
    fn bind_pattern_value(
        &mut self,
        at: NodeId,
        symbol: u32,
        value: ValueId,
        scope: PatternScope,
    ) -> Result<(), Diagnostic> {
        if matches!(scope, PatternScope::Module)
            && let Some(global) = self.module.variables.get(&symbol).copied()
        {
            self.write_place(at, &Place::Global(global), value)?;
            self.mark_initialized(at, symbol);
        } else {
            let value = if matches!(scope, PatternScope::Parameters) {
                self.open_cell(symbol, value, at)
            } else {
                value
            };
            self.bindings.insert(symbol, value);
            self.mark_initialized(at, symbol);
        }
        Ok(())
    }

    pub(super) fn bind_pattern(
        &mut self,
        pattern: NodeId,
        value: ValueId,
        scope: PatternScope,
    ) -> Result<(), Diagnostic> {
        self.bind_pattern_from(pattern, value, scope, None)
    }

    fn bind_pattern_from(
        &mut self,
        pattern: NodeId,
        value: ValueId,
        scope: PatternScope,
        present: Option<HirType>,
    ) -> Result<(), Diagnostic> {
        let object = self.kind_of(pattern) == Some(syntax::OBJECT_BINDING_PATTERN);
        let source = present
            .as_ref()
            .unwrap_or(&self.values[value.0 as usize].ty);
        let steps = !object
            && matches!(source, HirType::Managed(ManagedType::Object(ty))
            if self.generator_declared(*ty).is_some() || abstract_generator_kind(self.snapshot, *ty).is_some());
        // **Step 1, before any element is read.** An object pattern over `null` or
        // `undefined` throws a `TypeError`, and an *empty* one reads nothing -- so this is
        // the only place the check can be. Which patterns ask is
        // [`a_pattern_that_requires_coercion`]'s. See [`Self::require_object_coercible`].
        // Direct generators retain their existing frame path. An erased
        // reference element still needs the guard before reconstruction.
        if !steps || present.is_some() {
            self.require_object_coercible(pattern, value)?;
        }
        // The source array proves a present element's representation. The
        // absence check must run before reading that payload back.
        let value = match present {
            Some(ty) => {
                let origin = self.origin(pattern);
                self.push(OpKind::unerase(value), ty, origin)
            }
            None => value,
        };
        // **Elisions over an erased value step whatever arrived** -- nothing for an array,
        // once per hole for a generator. See [`Self::step_what_arrived`].
        if !object
            && self.values[value.0 as usize].ty == HirType::Erased
            && elision_patterns::elisions_only(self, pattern)
        {
            return self.step_what_arrived(pattern, value, scope);
        }
        // **An array pattern over a generator is a step per element**, elisions included,
        // because a hole still asks the iterator for one. See
        // [`Self::bind_array_pattern_by_stepping`] -- including why an *array* source does not
        // come here.
        if steps {
            return self.bind_array_pattern_by_stepping(pattern, value, scope);
        }
        for (position, element) in self.children(pattern).into_iter().enumerate() {
            if self.kind_of(element) != Some(syntax::BINDING_ELEMENT) {
                return Err(self.unsupported(element, "a binding of unexpected shape"));
            }
            let parts = self.children(element);
            // `[a, ...tail]`: everything from here on, as a new array. An
            // object rest -- `{ a, ...others }` -- would have to *build* an
            // object out of the fields nobody named, which is a different
            // thing, and is refused.
            if parts
                .iter()
                .any(|part| self.kind_of(*part) == Some(syntax::DOT_DOT_DOT_TOKEN))
            {
                if object {
                    return Err(self.unsupported(element, "a rest element in an object pattern"));
                }
                self.bind_rest(element, value, position, scope)?;
                continue;
            }
            // One identifier for `{ a }` and `[a]`; two for `{ a: renamed }`,
            // the property first.
            // A binding element is one of four shapes, and the encoder gives
            // the fields it has and no tokens:
            //
            //     `{ a }`       [name]
            //     `{ a: b }`    [property, name]
            //     `{ a = d }`   [name, default]
            //     `{ a: b = d}` [property, name, default]
            //
            // Two children are ambiguous when both are identifiers, because
            // `{ a: b }` and `{ a = b }` encode identically. They are told
            // apart by which identifier is a *declaration*: the checker records
            // a binding's own identifier in its symbol's declaration list, and
            // a reference to something else is not in it.
            //
            // A nested *pattern* is a binding too, and declares no symbol of
            // its own -- `{ inner: { name } }` would otherwise read as a
            // property with the pattern as its default.
            let (property, binding, default) = match binding_element_parts(self, element) {
                // **A hole: `const [, second] = pair`.** The frontend gives an
                // elision as a binding element with no children at all, so it
                // has no name, no property and nothing to write to -- and the
                // enumeration above has already counted it, which is the whole
                // of what a hole means: the *next* element is one further
                // along. Skipping it here rather than refusing keeps that
                // counting in one place.
                None if parts.is_empty() => continue,
                Some(parts) => parts,
                None => return Err(self.unsupported(element, "a binding of unexpected shape")),
            };
            let symbol = self.binding_element_symbol(element, binding)?;

            // **A promise capability has no fields to read.** `{ promise,
            // resolve, reject }` over a `PromiseWithResolvers<T>` destructures
            // something represented as the promise itself, so `read_for_pattern`
            // would ask for a layout that does not exist and say "destructuring
            // something with no fields" -- true of the representation and
            // useless about the program.
            //
            // `promise` binds the value. The other two bind a [`Settler`],
            // which is the same thing a `new Promise` executor's parameters
            // bind: not a value, a *meaning* for calls to that name. The
            // executor saves and restores the map because its bindings end with
            // its body; these end with their scope, and a binding's symbol is
            // unique to it, so an entry that outlives the scope can never be
            // reached by a different `resolve`.
            if object
                && self.names_a_promise_capability(pattern)
                && let Some(bound) =
                    self.bind_capability_member(element, property, binding, value)?
            {
                if let (Some(symbol), Some(read)) = (symbol, bound.read) {
                    self.bind_pattern_value(binding, symbol.0, read, scope)?;
                }
                continue;
            }
            // **`const { y = 2 } = {}` is refused and the fix is not here.**
            //
            // It reads *"destructuring something with no fields"*, and the
            // checker types that `{}` as `Object { properties: [] }` --- so the
            // absence of `y` is a compile-time fact, the language says the read
            // is `undefined`, and the default is the only arm. `nts types` shows
            // the annotated spelling, `{} as { y?: number }`, carrying `y` as an
            // optional field, which is why that one has always worked.
            //
            // A guard here asking `declared_type_of` never fires, because the
            // value's *representation* is `Erased` rather than
            // `Managed(Object(..))` --- a literal with no members gets no
            // layout. Written, built, and measured: it changed nothing and
            // every control still passed, which is what a guard that never runs
            // looks like from the outside.
            //
            // What it needs is the source's **checker type** reaching this walk.
            // `bind_pattern` has a `ValueId` and no node, and its three callers
            // --- a declaration, a nested pattern, a `for...of` head --- name
            // the source differently, so threading it is a signature change
            // rather than a lookup. Three files of the census slice wait on it.
            //
            // Asked *before* the read, because for an array element with a
            // default the read is the thing being avoided.
            //
            // An **object** pattern never asks: a missing field is a
            // compile-time refusal rather than a runtime length, and
            // `{ length = 0 }` over an array would otherwise read index 0 where
            // it means the `length` field.
            let defaulted = if object {
                None
            } else {
                self.defaulted_array_element(element, property, binding, value, position, default)?
            };
            let read = if let Some(chosen) = defaulted {
                chosen
            } else {
                let read = self.read_for_pattern(element, property, value, position, object)?;
                // `{ a = d }`: the default stands in where the read is
                // `undefined`, and only there.
                match default {
                    Some(default) => match self.defaulted_when(element, property, read)? {
                        // The *binding's* node, not the element's: its type is
                        // the one the default has already been folded into,
                        // which is what both arms have to produce.
                        Some(absent) => self.lower_branching_value(
                            binding,
                            absent,
                            Branch::Expression(default),
                            Branch::Present(read),
                        )?,
                        // No room for an absence, so the default is
                        // unreachable. The language agrees: it is never
                        // evaluated.
                        None => read,
                    },
                    None => read,
                }
            };
            // `{ p: { x } }` is a read and then another pattern over what it
            // produced, which is the same function one level down.
            if let Some(symbol) = symbol {
                self.bind_pattern_value(binding, symbol.0, read, scope)?;
            } else {
                let present = if !object && self.values[read.0 as usize].ty == HirType::Erased {
                    self.reference_element_for_pattern(binding, value, default)
                } else {
                    None
                };
                self.bind_pattern_from(binding, read, scope, present)?;
            }
        }
        Ok(())
    }

    /// The symbol a binding element's `binding` declares: its identifier's, or
    /// none for a nested pattern, whose names are declared one level down.
    fn binding_element_symbol(
        &self,
        element: NodeId,
        binding: NodeId,
    ) -> Result<Option<SymbolId>, Diagnostic> {
        match self.kind_of(binding) {
            Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN) => Ok(None),
            Some(syntax::IDENTIFIER) => match self.node(binding).symbol {
                Some(symbol) => Ok(Some(symbol)),
                None => Err(self.unsupported(element, "an unresolved binding")),
            },
            _ => Err(self.unsupported(element, "a binding of unexpected shape")),
        }
    }

    /// One slot of `const { promise, resolve, reject } = Promise.withResolvers()`.
    ///
    /// `Ok(None)` when the name is not one of the three, which is a program the
    /// checker would already have rejected -- handled rather than assumed, so
    /// that a future member of this interface refuses by the ordinary route
    /// instead of being silently dropped.
    ///
    /// `read` is `Some` only for `promise`; the other two bind no value.
    fn bind_capability_member(
        &mut self,
        element: NodeId,
        property: NodeId,
        binding: NodeId,
        value: ValueId,
    ) -> Result<Option<CapabilityBinding>, Diagnostic> {
        let Some(name) = self.literal_name(property) else {
            return Ok(None);
        };
        let rejects = match name.as_str() {
            "promise" => return Ok(Some(CapabilityBinding { read: Some(value) })),
            "resolve" => false,
            "reject" => true,
            _ => return Ok(None),
        };
        let HirType::Managed(ManagedType::Promise(payload)) =
            self.values[value.0 as usize].ty.clone()
        else {
            return Err(self.unrepresentable(element, "a promise capability"));
        };
        // A renaming binds the *new* name: `const { resolve: settle } = ...`
        // means calls to `settle`, and `binding` is the identifier that
        // declares it -- the same node `bind_pattern` would have taken the
        // symbol from.
        let Some(symbol) = self.node(binding).symbol else {
            return Err(self.unsupported(element, "an unresolved binding"));
        };
        self.settlers.insert(
            symbol.0,
            Settler {
                result: AsyncResult {
                    promise: value,
                    payload: *payload,
                    written: None,
                },
                rejects,
            },
        );
        Ok(Some(CapabilityBinding { read: None }))
    }

    /// Whether this identifier is the name `element` *declares*.
    ///
    /// The checker records a binding's declaration as the **binding element**,
    /// not as the identifier inside it -- read off a real program, because the
    /// obvious guess is the identifier and it is wrong. So the question is
    /// asked of the element: `{ a: b }` has `b`'s symbol declared by this
    /// element, and in `{ a = b }` the `b` is a reference whose symbol was
    /// declared somewhere else entirely.
    ///
    /// That is the only thing telling the two apart: the encoder gives both as
    /// the same two identifiers, with no `=` token and no property-name slot to
    /// distinguish them.
    /// Every name a binding pattern declares, in the order the pattern writes
    /// them.
    ///
    /// The **declared** identifiers only. `{ a: b }` gives `b` and `{ a = b }`
    /// gives `a`, and the two encode identically — told apart by whose symbol
    /// lists this element among its declarations, which is exactly the question
    /// [`Self::declared_by`] answers and exactly what [`Self::bind_pattern`]
    /// asks when it binds them. Asking it twice in two ways is how the
    /// module-scope walk and the binder would come to disagree about which
    /// names exist, and a global declared for a name nothing binds is storage
    /// that reads as zero for ever.
    ///
    /// Nested patterns recurse; a rest element's name is declared by its
    /// element like any other and needs no case of its own.
    pub(super) fn pattern_names(&self, pattern: NodeId, into: &mut Vec<NodeId>) {
        for element in self.children(pattern) {
            if self.kind_of(element) != Some(syntax::BINDING_ELEMENT) {
                continue;
            }
            for part in self.children(element) {
                match self.kind_of(part) {
                    Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN) => {
                        self.pattern_names(part, into);
                    }
                    Some(syntax::IDENTIFIER) if self.declared_by(element, part) => {
                        into.push(part);
                    }
                    _ => {}
                }
            }
        }
    }

    pub(super) fn declared_by(&self, element: NodeId, node: NodeId) -> bool {
        self.node(node)
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .is_some_and(|record| record.declarations.contains(&element))
    }

    /// The condition under which a pattern's default applies.
    ///
    /// Not [`Self::absence_of`], which tests for `null` as well. `{ a = 5 }`
    /// where `a` is `null` keeps the `null` -- only `undefined` reaches a
    /// default. The two tests coincide for an *optional* property, whose type
    /// admits no null, and differ for `T | null`.
    ///
    /// `None` when the representation has no room for an absence at all, which
    /// makes the default unreachable. The language says the same thing: a
    /// default is evaluated only when the value is `undefined`.
    pub(super) fn defaulted_when(
        &mut self,
        at: NodeId,
        property: NodeId,
        value: ValueId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let ty = self.values[value.0 as usize].ty.clone();
        let origin = self.origin(at);
        match ty {
            // The tag is the answer, and only one of its values is the one.
            HirType::Erased => {
                let unsigned = HirType::Int {
                    bits: 32,
                    signed: false,
                };
                let tag = self.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
                let undefined = self.push(
                    OpKind::ConstInt(i128::from(crate::hir::tags::UNDEFINED)),
                    unsigned,
                    origin.clone(),
                );
                Ok(Some(self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: tag,
                        rhs: undefined,
                    },
                    HirType::Bool,
                    origin,
                )))
            }
            // One null pointer stands for both absences, so the representation
            // cannot tell them apart and the *type* has to. A property that can
            // only be missing is answered exactly; one that can also be `null`
            // is refused rather than answered by the nearest available test,
            // which would take the default for a `null` the language keeps.
            HirType::Managed(_) => {
                let only_missing = self
                    .absences_of(property)
                    .is_some_and(|tags| tags == vec![crate::hir::tags::UNDEFINED]);
                if only_missing {
                    Ok(self.absence_of(at, value))
                } else {
                    Err(self.unsupported(
                        at,
                        "a default on a property that can be `null` as well as missing",
                    ))
                }
            }
            _ => Ok(None),
        }
    }

    /// `[a, ...tail]`: everything from `position` on, as a new array.
    ///
    /// A slice rather than a view, which is what the language says: `tail` is a
    /// fresh array and writing to it does not touch the one it came from.
    /// The tail a rest element stands for: `xs.slice(position)`.
    ///
    /// **A fresh array, which is what the language says a rest element is** --
    /// writing to it must not touch the one it came from.
    ///
    /// One derivation, asked by the binding path (`const [a, ...rest] = xs`)
    /// and by the assignment path (`[a, ...rest] = xs`). The two differ only in
    /// where the tail ends up, which is the same split every other element of a
    /// pattern already has.
    fn rest_tail(
        &mut self,
        element: NodeId,
        value: ValueId,
        position: usize,
    ) -> Result<ValueId, Diagnostic> {
        let ty = self.values[value.0 as usize].ty.clone();
        // **A slice is an array operation, so the source has to be one.** It is
        // not always: an unannotated `([...x]) => f(x)` gives its parameter the
        // `Iterable` the pattern implies, and a `[...x]` over a generator gives a
        // `Generator`. Both used to reach the two pushes below, and then the C
        // backend's `length_expression` answered `x->length` for a struct that
        // has no such member -- **C that does not compile, from a program nothing
        // refused.** 23 of test262's built-ins `compareArray` files and 14 of
        // `test/language` are that, the conformance lane's
        // `outcomes/an-untyped-rest-passed-where-an-array-is-wanted` is the
        // record, and `verify::check_lengths` is the backstop that stops the
        // category being silent again.
        //
        // Refused rather than converted, for now. `[...x]` over something
        // iterable-but-not-an-array is a real construct and the machinery for it
        // exists -- it is what `for...of` already does -- so this names the
        // feature instead of guessing at it. Reading `x.length` directly is
        // already refused as "`length`, which `Iterable` does not declare", so
        // the sentences agree about the same program.
        //
        // **Sliced only from an array.** Carrying a length was the test, and a
        // string, a `Set`, a `Map` and an erased value carry one too: each went to
        // `nts_array_slice` as if it were an array, which C rejects -- 23 of
        // test262's `dstr/*-ary-rest-iter` cases, over an erased element. Each is
        // collected through its iterator now, as below, which is exactly the rest
        // since nothing before it reads such a source by position; an erased value
        // has no walk yet, so it is refused by name, as its spread is.
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            // **Collected through its iterator, which is what that sentence named.** The
            // refusal here said *"needs it collected through its iterator first"* and the
            // machinery it pointed at is `collect_a_walk`, extracted out of
            // `build_array_from` for exactly this: `Array.from(xs)` and `[...x]` are one
            // operation reached two ways, one from a node and one from a value.
            //
            // **The array to build is the TARGET's type, not the source's.** Everywhere else
            // in this function the two agree -- a slice of an array is an array of the same
            // element -- and here they cannot: the source is an `Iterable` or a generator and
            // the tail is whatever the binding declares.
            //
            // **No position check, and the reason is a refusal elsewhere rather than a rule
            // here.** A rest at position 1 over an iterator would have to consume element 0
            // first, and `pattern_element_read` refuses a non-array read before this is
            // reached -- so `[...x]` is the only shape that arrives, which is also what the
            // census found: every one of the 190 cases has the rest at position 0. Stated
            // rather than enforced, because enforcing it twice is how two rules come apart.
            let Some(target) = self.rest_target(element) else {
                return Err(self.unsupported(element, "a rest element with no name or pattern"));
            };
            let Some(built @ HirType::Managed(ManagedType::Array(_))) = self.type_of(target) else {
                return Err(self.unsupported(
                    element,
                    "a rest element over a value that is not an array, whose own type is not \
                     an array either, so there is nothing to collect the iterator into",
                ));
            };
            let walk = self.collection_walk(element, value, None)?;
            return self.collect_a_walk(element, element, value, walk, &built);
        }
        let origin = self.origin(element);
        // An exhausted tuple rest has type `[]`: build its empty array at the
        // target's representation. A slice keeps the source's element width,
        // which can differ -- an exhausted string tuple still binds `[]`,
        // whose uninhabited width is numeric. The source was evaluated already
        // and slicing an empty tail has no further effects.
        // This path was exposed by test262's `dstr/ary-ptrn-rest-id-exhausted`
        // (`var`, `let` and `const`): the verifier saw a module variable at `[]`'s
        // representation meet a slice at the source's array representation.
        if let Some(target) = self.rest_target(element)
            && let Some(tuple) = self.snapshot.node_types.get(&target)
            && matches!(
                self.snapshot.types.get(tuple.0 as usize).map(|record| &record.kind),
                Some(TypeKind::Tuple(tuple)) if tuple.elements.is_empty()
            )
            && let Some(empty @ HirType::Managed(ManagedType::Array(_))) = self.type_of(target)
        {
            return self.lower_empty_array(element, empty);
        }
        #[allow(clippy::cast_precision_loss)]
        let at = position as f64;
        let HirType::Managed(ManagedType::Array(items)) = &ty else {
            unreachable!("a rest over anything but an array is collected above");
        };
        let helper = self.slice_helper(element, items, "a rest element")?;
        let from = self.push(OpKind::ConstFloat(at), HirType::NUMBER, origin.clone());
        let to = self.push(OpKind::Length(value), HirType::NUMBER, origin.clone());
        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args: vec![value, from, to],
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// What a rest element binds: a name, or a pattern destructured again.
    fn rest_target(&self, element: NodeId) -> Option<NodeId> {
        self.children(element).into_iter().find(|part| {
            matches!(
                self.kind_of(*part),
                Some(
                    syntax::IDENTIFIER
                        | syntax::ARRAY_BINDING_PATTERN
                        | syntax::OBJECT_BINDING_PATTERN
                )
            )
        })
    }

    fn bind_rest(
        &mut self,
        element: NodeId,
        value: ValueId,
        position: usize,
        scope: PatternScope,
    ) -> Result<(), Diagnostic> {
        // **The rest target may be a pattern, not only a name.**
        // `function f([...[x, y]])` and `function f([...{ length }])` are both
        // ordinary JavaScript: the tail is built exactly as it is for a name and
        // then destructured again, one level down. Searching only for an
        // `IDENTIFIER` found neither, and the refusal said "a rest element with
        // no name" — true of what it looked for and misleading about the
        // program, which names the tail's *parts* rather than the tail.
        //
        // 20 of the 413 files that reach lowering in the slice-1 test262
        // population are this, all in the generated `class/dstr` family.
        //
        // The tail is built first either way, because both cases need it and the
        // slice is what the language says a rest element is: a fresh array, so
        // writing to it does not touch the one it came from.
        let Some(target) = self.rest_target(element) else {
            return Err(self.unsupported(element, "a rest element with no name or pattern"));
        };
        let nested = matches!(
            self.kind_of(target),
            Some(syntax::ARRAY_BINDING_PATTERN | syntax::OBJECT_BINDING_PATTERN)
        );
        let symbol = if nested {
            None
        } else {
            match self.node(target).symbol {
                Some(symbol) => Some(symbol),
                None => return Err(self.unsupported(element, "an unresolved binding")),
            }
        };
        let rest = self.rest_tail(element, value, position)?;
        match symbol {
            Some(symbol) => {
                self.bind_pattern_value(target, symbol.0, rest, scope)?;
                Ok(())
            }
            // `[...[x, y]]` is the tail and then another pattern over it, which
            // is the same function one level down — exactly what `bind_pattern`
            // already does for `{ p: { x } }`.
            None => self.bind_pattern(target, rest, scope),
        }
    }
}

//! Array's constructor contract, shared by calls and `new`.
//! <https://tc39.es/ecma262/#sec-array-constructor>

use super::{
    Absence, Callee, Counts, TypeId, TypeKind, absence_of_member, an_unchosen_collection,
    counted_helper, holds_counted, is_an_unsettled_array, settled, uninhabited_array,
};
use super::{
    ArrayFill, BinOp, Binds, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, Origin,
    Terminator, UnOp, ValueId, Walk, syntax,
};

enum Part {
    Value(NodeId, ValueId),
    Spread(NodeId, ValueId, HirType),
}

impl FuncBuilder<'_> {
    pub(super) fn is_standard_array_constructor(&self, callee: NodeId) -> bool {
        self.checked_global_reference(callee).is_some_and(|global| {
            global.library == nts_semantic_schema::Library::Es && global.name == "Array"
        })
    }

    pub(super) fn is_array_construction(&self, id: NodeId) -> bool {
        matches!(
            self.kind_of(id),
            Some(syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION)
        ) && self
            .children(id)
            .first()
            .is_some_and(|callee| self.is_standard_array_constructor(*callee))
    }

    /// The same singleton rule that emits the guard also seeds raising copies.
    /// Arguments are visited independently for their own throws.
    pub(super) fn array_constructor_may_raise(&self, id: NodeId) -> bool {
        if !self.is_array_construction(id) {
            return false;
        }
        let arguments = self.arguments_of(id);
        if arguments
            .iter()
            .any(|arg| self.kind_of(*arg) == Some(syntax::SPREAD_ELEMENT))
        {
            return arguments
                .iter()
                .filter(|arg| self.kind_of(**arg) != Some(syntax::SPREAD_ELEMENT))
                .count()
                < 2;
        }
        arguments.len() == 1
            && self.type_of(arguments[0]).is_none_or(|ty| {
                matches!(
                    ty,
                    HirType::Int { .. } | HirType::Float { .. } | HirType::Erased
                )
            })
    }

    /// `Array(...)` called rather than constructed: the same construction.
    pub(super) fn lower_array_call(
        &mut self,
        id: NodeId,
        callee: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        if let Some(global) = self.checked_global_reference(callee) {
            for binding in global.bindings {
                self.check_initialized(callee, binding)?;
            }
        }
        let ty = self.allocated_array_type(id)?;
        self.lower_array_construction(id, &ty)
    }

    /// An authentic `Array` construction at `id` -- a call, a `new`, or the
    /// `super(...)` of a subclass that is an array -- building `ty`.
    pub(super) fn lower_array_construction(
        &mut self,
        id: NodeId,
        ty: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) = ty else {
            return Err(
                self.unsupported(id, "an Array constructor without an array representation")
            );
        };
        let element = (**element).clone();
        let arguments = self.arguments_of(id);
        // With no arguments the element type is written down and nothing else
        // will mention it, so it is laid out here (`lower_empty_array` says
        // why). Elements are laid out as they are lowered, and a length
        // allocates holes: an element type with no layout of its own refuses
        // where an element is used, not the allocation.
        if arguments.is_empty() {
            self.materialize(id, ty)?;
        }
        let origin = self.origin(id);
        let parts = self.array_constructor_arguments(arguments, &element, &origin)?;
        if parts.iter().all(|part| matches!(part, Part::Value(..))) {
            let values = parts
                .into_iter()
                .filter_map(|part| match part {
                    Part::Value(node, value) => Some((node, value)),
                    Part::Spread(..) => None,
                })
                .collect::<Vec<_>>();
            if let [(node, value)] = values.as_slice() {
                return self.array_from_single(id, *node, *value, ty, None);
            }
            return self.array_from_values(id, values, ty);
        }
        let array = self.array_from_constructor_parts(id, parts, ty)?;
        if !matches!(
            element,
            HirType::Int { .. } | HirType::Float { .. } | HirType::Erased
        ) {
            return Ok(array);
        }
        let length = self.push(OpKind::Length(array), HirType::NUMBER, origin.clone());
        let one = self.array_constructor_number(1, &origin);
        let single = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: length,
                rhs: one,
            },
            HirType::Bool,
            origin.clone(),
        );
        let singleton = self.new_block();
        let ordinary = self.new_block();
        let merge = self.new_block();
        let result = self.push_block_param(merge, ty.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: single,
            then_target: singleton,
            then_args: Vec::new(),
            else_target: ordinary,
            else_args: Vec::new(),
        });
        self.switch_to(ordinary);
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![array],
        });
        self.switch_to(singleton);
        let zero = self.array_constructor_number(0, &origin);
        let value = self.push(
            OpKind::ArrayGet {
                array,
                index: zero,
                checked: true,
            },
            element,
            origin,
        );
        let made = self.array_from_single(id, id, value, ty, Some(array))?;
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![made],
        });
        self.switch_to(merge);
        Ok(result)
    }

    fn array_constructor_arguments(
        &mut self,
        arguments: Vec<NodeId>,
        element: &HirType,
        origin: &Origin,
    ) -> Result<Vec<Part>, Diagnostic> {
        let mut parts = Vec::new();
        // Capture each spread before evaluating a later argument.
        for argument in arguments {
            if self.kind_of(argument) == Some(syntax::SPREAD_ELEMENT) {
                parts.extend(self.array_constructor_spread(argument, element, origin)?);
            } else {
                let value = self.lower_expecting(argument, element)?;
                parts.push(Part::Value(argument, value));
            }
        }
        Ok(parts)
    }

    fn array_constructor_spread(
        &mut self,
        argument: NodeId,
        element: &HirType,
        origin: &Origin,
    ) -> Result<Vec<Part>, Diagnostic> {
        let inner = self
            .children(argument)
            .first()
            .copied()
            .ok_or_else(|| self.unsupported(argument, "an empty constructor spread"))?;
        let saved = self.expecting.take();
        let source = self.lower_expression(inner);
        self.expecting = saved;
        let source = source?;
        let source_ty = self.values[source.0 as usize].ty.clone();
        // Native arrays retain runtime arity even when a tuple view has only
        // required positions: push/pop or a writable alias can change length.
        // Only a tuple represented as fixed fields uses static positions.
        let positions = (!matches!(source_ty, HirType::Managed(ManagedType::Array(_))))
            .then(|| self.read_type(inner))
            .flatten()
            .and_then(|ty| self.tuple_shape(ty))
            .filter(|shape| {
                shape
                    .element_flags
                    .iter()
                    .all(|flag| *flag == nts_semantic_schema::TupleElementKind::Required)
            })
            .map(|shape| shape.elements.clone());
        if let Some(positions) = positions {
            let mut parts = Vec::new();
            for (offset, position) in positions.into_iter().enumerate() {
                let want = self
                    .represent(position)
                    .ok_or_else(|| self.unrepresentable(inner, "a constructor spread position"))?;
                let value = self.read_a_position(source, offset, &want, inner)?;
                parts.push(Part::Value(inner, value));
            }
            return Ok(parts);
        }
        if !matches!(source_ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(self.unsupported(
                argument,
                "an Array constructor spread without an array or fixed tuple",
            ));
        }
        // Indexed copying has the same admission authority as `for...of`.
        // A protocol walk must never silently become an indexed snapshot.
        let Walk::Counted {
            element: source_element,
            binds: Binds::Element,
        } = self.walk_of(inner, source, None, 1)?
        else {
            return Err(self.unsupported(
                argument,
                "an Array constructor spread without default array iteration",
            ));
        };
        if source_element == HirType::Erased && *element != HirType::Erased {
            return Err(self.unsupported(
                argument,
                "erased constructor spread elements in an unboxed array",
            ));
        }
        let copy =
            self.snapshot_constructor_array(argument, source, source_ty, &source_element, origin)?;
        Ok(vec![Part::Spread(inner, copy, source_element)])
    }

    fn snapshot_constructor_array(
        &mut self,
        argument: NodeId,
        source: ValueId,
        source_ty: HirType,
        source_element: &HirType,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let length = self.push(OpKind::Length(source), HirType::NUMBER, origin.clone());
        let copy = if let Ok(helper) =
            self.slice_helper(argument, source_element, "an Array constructor spread")
        {
            let zero = self.array_constructor_number(0, origin);
            self.runtime_call(
                helper,
                vec![source, zero, length],
                source_ty.clone(),
                origin.clone(),
            )
        } else {
            let copy = self.push(
                OpKind::ArrayNew {
                    length,
                    fill: ArrayFill::Filled,
                },
                source_ty,
                origin.clone(),
            );
            let zero = self.array_constructor_number(0, origin);
            self.copy_constructor_slots(
                argument,
                source,
                copy,
                zero,
                length,
                source_element,
                source_element,
            )?;
            copy
        };
        Ok(copy)
    }

    fn array_constructor_number(&mut self, value: u32, origin: &Origin) -> ValueId {
        self.push(
            OpKind::ConstFloat(f64::from(value)),
            HirType::NUMBER,
            origin.clone(),
        )
    }

    fn array_from_single(
        &mut self,
        id: NodeId,
        node: NodeId,
        value: ValueId,
        ty: &HirType,
        existing: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        match self.values[value.0 as usize].ty {
            HirType::Int { .. } | HirType::Float { .. } => {
                return self.array_from_length(id, value, ty);
            }
            HirType::Erased => {}
            _ => {
                return existing
                    .map_or_else(|| self.array_from_values(id, vec![(node, value)], ty), Ok);
            }
        }
        let HirType::Managed(ManagedType::Array(element)) = ty else {
            unreachable!()
        };
        if **element != HirType::Erased {
            return Err(self.unsupported(
                id,
                "an erased Array constructor argument in an unboxed array",
            ));
        }
        let origin = self.origin(id);
        let unsigned = HirType::Int {
            bits: 32,
            signed: false,
        };
        let tag = self.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
        let number = self.push(
            OpKind::ConstInt(i128::from(super::super::tags::NUMBER)),
            unsigned,
            origin.clone(),
        );
        let numeric = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: tag,
                rhs: number,
            },
            HirType::Bool,
            origin.clone(),
        );
        let length_case = self.new_block();
        let value_case = self.new_block();
        let merge = self.new_block();
        let answer = self.push_block_param(merge, ty.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: numeric,
            then_target: length_case,
            then_args: Vec::new(),
            else_target: value_case,
            else_args: Vec::new(),
        });
        self.switch_to(value_case);
        let values =
            existing.map_or_else(|| self.array_from_values(id, vec![(node, value)], ty), Ok)?;
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![values],
        });
        self.switch_to(length_case);
        let length = self.push(OpKind::unerase(value), HirType::NUMBER, origin);
        let array = self.array_from_length(id, length, ty)?;
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![array],
        });
        self.switch_to(merge);
        Ok(answer)
    }

    fn array_from_length(
        &mut self,
        id: NodeId,
        length: ValueId,
        ty: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let number = self.coerce(length, &HirType::NUMBER, id)?;
        let unsigned = self.push(
            OpKind::Unary {
                op: UnOp::ToUint32,
                operand: number,
            },
            HirType::Int {
                bits: 32,
                signed: false,
            },
            origin.clone(),
        );
        let length = self.coerce(unsigned, &HirType::NUMBER, id)?;
        let invalid = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: number,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.refuse_when(id, invalid, "RangeError", "Invalid array length")?;
        self.refuse_holes_that_read_as_null(id, ty)?;
        Ok(self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            ty.clone(),
            origin,
        ))
    }

    fn array_from_values(
        &mut self,
        id: NodeId,
        values: Vec<(NodeId, ValueId)>,
        ty: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) = ty else {
            unreachable!()
        };
        let values = values
            .into_iter()
            .map(|(node, value)| self.coerce(value, element, node))
            .collect::<Result<Vec<_>, _>>()?;
        let origin = self.origin(id);
        let count = u32::try_from(values.len())
            .map_err(|_| self.unsupported(id, "too many Array constructor arguments"))?;
        let length = self.array_constructor_number(count, &origin);
        let array = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Filled,
            },
            ty.clone(),
            origin.clone(),
        );
        for (index, value) in values.into_iter().enumerate() {
            let index =
                self.array_constructor_number(u32::try_from(index).unwrap_or(u32::MAX), &origin);
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
        Ok(array)
    }

    fn array_from_constructor_parts(
        &mut self,
        id: NodeId,
        parts: Vec<Part>,
        ty: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) = ty else {
            unreachable!()
        };
        // A sole spread is already a fresh snapshot. It is the result for
        // zero or several arguments, and the singleton dispatch can read it
        // directly without a second copy.
        if let [Part::Spread(_, array, source_element)] = parts.as_slice()
            && source_element == element.as_ref()
        {
            return Ok(*array);
        }
        let origin = self.origin(id);
        let mut total = self.array_constructor_number(0, &origin);
        for part in &parts {
            let more = match part {
                Part::Value(..) => self.array_constructor_number(1, &origin),
                Part::Spread(_, array, _) => {
                    self.push(OpKind::Length(*array), HirType::NUMBER, origin.clone())
                }
            };
            total = self.push(
                OpKind::Binary {
                    op: BinOp::Add,
                    lhs: total,
                    rhs: more,
                },
                HirType::NUMBER,
                origin.clone(),
            );
        }
        let array = self.push(
            OpKind::ArrayNew {
                length: total,
                fill: ArrayFill::Filled,
            },
            ty.clone(),
            origin.clone(),
        );
        let mut offset = self.array_constructor_number(0, &origin);
        for part in parts {
            match part {
                Part::Value(node, value) => {
                    let value = self.coerce(value, element, node)?;
                    self.push(
                        OpKind::ArraySet {
                            array,
                            index: offset,
                            value,
                            checked: true,
                        },
                        HirType::Void,
                        origin.clone(),
                    );
                    let one = self.array_constructor_number(1, &origin);
                    offset = self.push(
                        OpKind::Binary {
                            op: BinOp::Add,
                            lhs: offset,
                            rhs: one,
                        },
                        HirType::NUMBER,
                        origin.clone(),
                    );
                }
                Part::Spread(node, source, source_element) => {
                    let length = self.push(OpKind::Length(source), HirType::NUMBER, origin.clone());
                    self.copy_constructor_slots(
                        node,
                        source,
                        array,
                        offset,
                        length,
                        &source_element,
                        element,
                    )?;
                    offset = self.push(
                        OpKind::Binary {
                            op: BinOp::Add,
                            lhs: offset,
                            rhs: length,
                        },
                        HirType::NUMBER,
                        origin.clone(),
                    );
                }
            }
        }
        Ok(array)
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "source and destination storage plus one bounded copy interval"
    )]
    fn copy_constructor_slots(
        &mut self,
        id: NodeId,
        source: ValueId,
        target: ValueId,
        offset: ValueId,
        length: ValueId,
        source_element: &HirType,
        target_element: &HirType,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let zero = self.array_constructor_number(0, &origin);
        let header = self.new_block();
        let body = self.new_block();
        let done = self.new_block();
        let index = self.push_block_param(header, HirType::NUMBER, origin.clone());
        self.terminate(Terminator::Jump {
            target: header,
            args: vec![zero],
        });
        self.switch_to(header);
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: index,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: more,
            then_target: body,
            then_args: Vec::new(),
            else_target: done,
            else_args: Vec::new(),
        });
        self.switch_to(body);
        let value = self.push(
            OpKind::ArrayGet {
                array: source,
                index,
                checked: true,
            },
            source_element.clone(),
            origin.clone(),
        );
        let value = self.coerce(value, target_element, id)?;
        let at = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: offset,
                rhs: index,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.push(
            OpKind::ArraySet {
                array: target,
                index: at,
                value,
                checked: true,
            },
            HirType::Void,
            origin.clone(),
        );
        let one = self.array_constructor_number(1, &origin);
        let next = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: index,
                rhs: one,
            },
            HirType::NUMBER,
            origin,
        );
        self.terminate(Terminator::Jump {
            target: header,
            args: vec![next],
        });
        self.switch_to(done);
        Ok(())
    }
}

impl FuncBuilder<'_> {
    /// What actually gets stored into an array slot.
    ///
    /// For a `number[]` the value *is* what is stored. For a typed array it is
    /// not: `u8[i] = 300` stores 44, `i32[i] = 1.7` stores 1, and `u8[i] = NaN`
    /// stores 0 — ECMAScript truncates toward zero and takes the result modulo
    /// the width, with every non-finite case going to zero.
    ///
    /// C's `(uint8_t)someDouble` is *undefined behaviour* for all three, so the
    /// conversion is a named helper rather than a cast left to the backend. The
    /// helper is `static inline` and folds to nothing where the range is
    /// already known, which is the common case in a loop that built the value.
    pub(super) fn coerce_element(
        &mut self,
        id: NodeId,
        array: ValueId,
        value: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let numeric = |ty: &HirType| matches!(ty, HirType::Int { .. } | HirType::Float { .. });
        // A view coerces exactly as an array does. This is the site the
        // typed-array representation change would most easily have lost: the
        // pattern is a `let else`, so a view simply fails to match and the
        // store becomes a C assignment of a `double` into a `uint8_t` slot --
        // which is undefined behaviour rather than the modulo the language
        // specifies, and produces no diagnostic anywhere.
        let HirType::Managed(ManagedType::Array(element) | ManagedType::View(element)) =
            self.values[array.0 as usize].ty.clone()
        else {
            return Ok(value);
        };
        let held = self.values[value.0 as usize].ty.clone();
        // An erased element is the general case rather than a numeric
        // coercion: the value is tagged on the way in, whatever it was. It
        // comes first because the numeric guard below would return the value
        // unchanged, and a `double` stored into an `NtsValue` slot is what the
        // C compiler then reports -- which is how this was found, four
        // conversion sites after the first.
        if *element == HirType::Erased && held != HirType::Erased {
            return Ok(self.coerce(value, &HirType::Erased, id).unwrap_or(value));
        }
        if held == *element {
            return Ok(value);
        }
        // **Two references are `coerce`'s question, not a pass-through.** A
        // class instance stored at an interface-typed index --
        // `held[1] = new Thing()` on a `Named[]` -- went in unchanged, and a
        // read through the element's layout then read `id`, a `double`, as
        // the string pointer `name` is at in the other struct. `coerce`
        // refuses exactly that at a parameter; here it was the one slot that
        // never asked. Measured 2026-09-22: SIGSEGV where node answers 3.
        if !numeric(&element) || !numeric(&held) {
            return self.coerce(value, &element, id);
        }
        let origin = self.origin(id);
        Ok(match crate::hir::builtin::element_coercion(&element) {
            Some(helper) => self.push(
                OpKind::Call {
                    callee: Callee::External(helper.to_owned()),
                    args: vec![value],
                    frame: None,
                },
                (*element).clone(),
                origin,
            ),
            // A defined narrowing — `double` to `float` — or nothing at all.
            None => self.push(OpKind::Convert(value), (*element).clone(), origin),
        })
    }

    /// `const x = expr` / `let x = expr`.
    ///
    /// A declaration with an initializer binds its symbol to the initializer's
    /// value — no slot and no store, because nothing here can reassign it yet.
    /// When assignment arrives, a `let` will need one and a `const` still will
    /// not, which is what the snapshot's variable kind is for.
    /// `[a, b, c]`.
    ///
    /// An allocation and a store per element. The length is known here, so it
    /// is a constant, which is what lets the analysis prove that every one of
    /// these stores is in bounds — the checks below are elided before they cost
    /// anything.
    /// `[1, , 3]` and `[,]` -- an elision, named before the type is asked about.
    ///
    /// The hole an `OmittedExpression` stands for reads as `undefined`, which a
    /// dense array of numbers has no room for: the same wall `xs[5] = v` meets,
    /// and the same reason.
    ///
    /// **Refused before the literal's type, not where the child is lowered.**
    /// The child is only reached once the literal has a type, and `[,]`'s type
    /// is `undefined[]` -- refused a step earlier for a reason that says
    /// nothing about holes. That ordering turned `an omitted expression` into
    /// `an array literal of unrepresentable type`: a true sentence naming the
    /// wrong thing, and it only appeared when `undefined[]` started being
    /// refused at all.
    /// A hole is `undefined` at that index, so the element type must hold one.
    ///
    /// **Permitted where it does**, which is the condition this refusal has
    /// always named. `[1, , 3]` typed `number[]` has an `f64` element and a
    /// hole would have to be `0`, which is a wrong answer rather than a missing
    /// feature; `[,]` is typed `undefined[]`, whose element `in_a_slot` gives
    /// `Erased` — the one representation with an `undefined` in it — so the
    /// hole is an ordinary value there.
    ///
    /// Asked of the **element**, not of the literal, and asked before the type
    /// is resolved elsewhere, because the message has to name the elision
    /// rather than the representation: an earlier version let the
    /// `undefined[]` filter fire first and the sentence became "an array
    /// literal of unrepresentable type", which sends its reader after a
    /// representation gap instead of at the hole.
    fn holds_a_hole(&self, id: NodeId, ty: Option<&HirType>) -> Result<(), Diagnostic> {
        if !self
            .children(id)
            .into_iter()
            .any(|child| self.kind_of(child) == Some(syntax::OMITTED_EXPRESSION))
        {
            return Ok(());
        }
        if let Some(HirType::Managed(ManagedType::Array(element))) = ty
            && matches!(element.as_ref(), HirType::Erased)
        {
            return Ok(());
        }
        Err(self.unsupported(
            id,
            "an array literal with a hole in it, which reads as `undefined` and so needs an \
             element type with room for one",
        ))
    }

    /// Whether the **checker** typed this node `never[]` or evolving-`[]`, at any
    /// depth.
    ///
    /// The companion to [`is_an_unsettled_array`], which asks the same question
    /// of a representation. Both are needed and they answer for different
    /// nodes: a settled outer array of an unsettled inner one has no
    /// representation at all, so only this one can see it.
    fn checker_called_it_unsettled(&self, id: NodeId) -> bool {
        let mut ty = match self.snapshot.node_types.get(&id) {
            Some(ty) => *ty,
            None => return false,
        };
        // Bounded by the nesting depth a program can write, and every step is
        // strictly inwards, so this terminates without a visited set.
        for _ in 0..32 {
            match self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind) {
                Some(TypeKind::Array(element)) => ty = *element,
                // `Evolving` beside `Never`, because `c.autoArrayType` is an array
                // *of* `c.autoType`: `const xs = []` says nothing about its element
                // in exactly the way `never[]` does, and the slot it goes into is
                // what decides. Without this the literal's own `Array(Erased)` won
                // over the expected type and `path`'s `join@win32` refused
                // `parts.some(...)` on an array of erased elements where every
                // other reference said `string[]` -- 18 functions across 7
                // projects.
                Some(TypeKind::Never | TypeKind::Evolving) => return true,
                _ => return false,
            }
        }
        false
    }

    /// An array type for a literal the checker typed `never` all the way down.
    ///
    /// The companion to [`Self::checker_called_it_unsettled`], which decides
    /// *that* this happened; this decides what to do about it. Both walk the same
    /// two sources, because a representation exists for `never[]` (an array whose
    /// element is `HirType::Never`) and does not for `never[][]`, so neither
    /// source answers for both nodes on its own.
    ///
    /// Returns `None` for anything that is not uninhabited, so it can only ever
    /// decide a case the three sources above already refused.
    fn a_stand_in_for_nothing(&self, id: NodeId, own: Option<&HirType>) -> Option<HirType> {
        if let Some(ty) = own {
            return is_an_unsettled_array(ty).then(|| settled(ty));
        }
        // **A literal with no elements holds nothing, whatever it is typed.**
        //
        // The walk below needs the checker to have said `never`. `const [a = 5]
        // = []` gets no type on the `[]` at all -- the checker assigns none in a
        // destructuring initializer -- so `empty` was false, the branch above
        // reported *an array literal of unrepresentable type (an untyped node)*,
        // and a reader was sent after a representation gap for a literal with
        // nothing in it.
        //
        // Zero elements is syntactic and stronger than the type argument: there
        // is no element to read at any width, so any width is right. It cannot
        // reach an array that later grows, because an evolving array gives the
        // *variable* a type and the literal is lowered against it three sources
        // earlier -- measured, not assumed. And if it ever did, the consequence
        // is a store that fails to coerce, which is a refusal and not a wrong
        // answer.
        if !self.snapshot.node_types.contains_key(&id)
            && self.kind_of(id) == Some(syntax::ARRAY_LITERAL_EXPRESSION)
            && self.children(id).is_empty()
        {
            return Some(uninhabited_array());
        }
        let mut ty = *self.snapshot.node_types.get(&id)?;
        let mut depth = 0usize;
        // The same bound and the same reason as `checker_called_it_unsettled`:
        // every step is strictly inwards, so this terminates without a visited
        // set.
        for _ in 0..32 {
            match self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind) {
                Some(TypeKind::Array(element)) => {
                    depth += 1;
                    ty = *element;
                }
                Some(TypeKind::Never) => {
                    if depth == 0 {
                        return None;
                    }
                    let mut built = uninhabited_array();
                    for _ in 1..depth {
                        built = HirType::Managed(ManagedType::Array(Box::new(built)));
                    }
                    return Some(built);
                }
                _ => return None,
            }
        }
        None
    }

    /// The element type an array literal is built at.
    ///
    /// Its own question, and a long one: four sources are consulted in a fixed
    /// order and each is there because a different corpus needed it, so the
    /// reasons are longer than the code. Separated from [`Self::lower_array_literal`]
    /// so that the lowering reads as what it does -- decide a type, reject a
    /// hole, then build a tuple or an array -- rather than as a hundred lines of
    /// which ninety are about one `let`.
    fn array_literal_type(&mut self, id: NodeId) -> Result<HirType, Diagnostic> {
        // Whether the checker's own answer was `never[]`, which is the empty
        // literal. Held separately because it decides the *message*: when the
        // three sources below all fail, describing the node's type says "an
        // array of a representable type", which contradicts itself and sends
        // the reader after a representation gap that is not there. What is
        // missing is a type for the literal to take, and only the branch that
        // discarded `never[]` knows that.
        let own = self.type_of(id);
        // Kept because the chain below consumes `own`, and the last resort needs
        // to know whether there was a representation to settle or nothing at all.
        let own_shape = own.clone();
        // **Asked of the checker's type, not of the representation.** `[[]]` is
        // `never[][]`, whose *representation* is `None` -- an array of `never`
        // has no element storage -- so `own` is absent and the one-level test
        // over it could not fire. The message then came out as
        //
        //     an array literal of unrepresentable type (an array of an array of
        //     a representable type)
        //
        // which contradicts itself and sends its reader after a representation
        // gap that is not there. What is missing is a type for the literal to
        // take, and only the branch that knows the checker said `never` can say
        // so. 12 files of the slice-1 `test/language` population, all
        // `for (… of [[]])`.
        let empty =
            own.as_ref().is_some_and(is_an_unsettled_array) || self.checker_called_it_unsettled(id);
        own
            // `[]` is typed `never[]`, which is the checker saying the literal
            // decides nothing -- the slot it goes into does. So the expected
            // type wins over it.
            .filter(|ty| !is_an_unsettled_array(ty))
            // **And it wins over an array whose element is not the slot's**,
            // which is the other half of the same argument. "A literal with
            // elements knows what it holds" is true of the *values* and not of
            // the width they have to be stored at: `["close", "error"]` passed
            // where `readonly EventName[]` is wanted -- `EventName` being
            // `string | symbol` -- was built as `Managed(String)` and then
            // refused on assignment, because a pointer to an array of strings
            // is not a pointer to an array of erased values.
            //
            // Building it at the slot's element type costs nothing: the literal
            // is being constructed here, and each element goes through `coerce`
            // into whatever the array holds, exactly as it already did.
            //
            // **This is what makes an annotation work.** The Node lane tried
            // annotating the three `stream` shape constants `readonly
            // EventName[]` and measured the refusal *relocating* rather than
            // going -- 7 sites to 7, declines 65 to 65, `no wrapper for
            // Readable` byte-identical -- because the initializer was still
            // built at `Managed(String)` and rejected one line later. With this,
            // the annotation is the contextual type and the literal is built
            // right the first time.
            //
            // 129 failing test files across `Readable`, `Writable` and
            // `Transform` sit behind those three constructors.
            .filter(|ty| {
                let (
                    HirType::Managed(ManagedType::Array(mine)),
                    Some(HirType::Managed(ManagedType::Array(slot))),
                ) = (ty, self.expecting.as_ref())
                else {
                    return true;
                };
                mine == slot
            })
            // **And a tuple slot wins over the literal's own array.** A tuple
            // whose elements agree is an array (`[number, number]` is
            // `number[]`), and one whose elements do not is an object, so
            // `return [n, n * 10]` from a function returning `[number | null,
            // number]` built an array of doubles and returned it as the
            // tuple's struct -- and the caller read `_0_` out of the array's
            // memory. The literal is being built here; it can be built as the
            // slot's tuple, each element coerced to its position.
            .filter(|ty| match self.expecting.as_ref() {
                Some(slot @ HirType::Managed(ManagedType::Object(tuple)))
                    if self.is_tuple(*tuple) =>
                {
                    ty == slot
                }
                _ => true,
            })
            // Unfiltered, and the line below is why: a non-array expected type
            // is rejected there, with a message that names what went wrong.
            // Filtering it here refused the same programs one step earlier and
            // called them unrepresentable instead, which cost four functions in
            // the node profile to the cascade that followed.
            //
            // **Except an erased slot, which says nothing about what an array
            // holds.** An optional property is held erased, so `{ scores: [] }`
            // for `scores?: number[]` expected `Erased` and was refused as "an
            // array literal that is not an array"; the property's declared type,
            // which the contextual type below reads, is the answer, and the
            // array is erased into the slot as a non-empty literal already is.
            .or_else(|| self.expecting.clone().filter(|ty| *ty != HirType::Erased))
            // And where nothing is expecting it, what its *position* says --
            // the same question `null` asks, and the same answer. `expecting`
            // is set by whatever is lowering the enclosing expression, which a
            // class field's initializer has none of: `#calls: TrackedCall[] =
            // []` and `this.#calls = []` were both refused as unrepresentable
            // while `const calls: TrackedCall[] = []` was not. Eighteen sites,
            // and `xs: T[] = []` is how a class declares a list.
            //
            // Last, so this can only decide what was previously refused.
            .or_else(|| self.contextual_type(id, 0))
            // **And where every source above is silent because there is nothing
            // to say**, which is what `never` means rather than a gap.
            //
            // `[]` is typed `never[]` and `[[]]` is `never[][]`. No value of type
            // `never` exists, so no program can read an element out of either --
            // a read has type `never` and the checker refuses every use of it. An
            // element width is therefore unobservable here, and refusing for want
            // of one refuses a program that could not have told the difference.
            //
            // `suspend::yielded_slot` already made this choice and states the
            // argument: a generator that yields nothing still needs a slot with a
            // width, "sound because nothing can read it". This is the same
            // uninhabited element one container along, so it takes the same
            // `HirType::NUMBER` rather than a second answer to one question.
            //
            // **It cannot reach an evolving array**, which is the case where a
            // width would be observable: `const xs = []; xs[0] = "s"` gives the
            // *variable* an evolved type and the literal is lowered against it,
            // so all three of number, string and `push` already lowered before
            // this existed and none of them arrives here. Checked rather than
            // reasoned -- the arms are in `tests/programs/an-array-of-nothing`.
            //
            // 15 files of the slice-1 `test/language` population: 12 are
            // `for (... of [[]])` with a destructuring head, and 3 are a bare
            // `[];` whose value is discarded. **8 of them pass and 7 advance**,
            // which is the honest split and worth the qualification it forces.
            //
            // "Unobservable" is true of the *program* and not of this compiler.
            // No source can read an element of `never[]` -- the read has type
            // `never` and the checker refuses every use of it -- but the
            // lowering carries the element type into a destructuring pattern's
            // expectations, and a pattern that wants a shape rejects a width:
            //
            // ```js
            //   for (const [[x] = [1]] of [[]]) {}   // a number where an array is wanted
            //   for (const [{ q } = {}] of [[]]) {}  // a number where an object is wanted
            // ```
            //
            // Those six refuse with a message naming what the pattern wanted,
            // which is a better refusal than the one they had and still a
            // refusal. What would close them is taking the element type from the
            // pattern's own default -- the array is empty, so the default is the
            // only thing that ever runs -- and that is a different question from
            // this one.
            .or_else(|| self.a_stand_in_for_nothing(id, own_shape.as_ref()))
            .ok_or_else(|| {
                if empty {
                    self.unsupported(
                        id,
                        "an empty array literal in a position that does not say what it holds",
                    )
                } else {
                    self.unrepresentable(id, "an array literal")
                }
            })
    }

    pub(super) fn lower_array_literal(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let ty = self.array_literal_type(id)?;
        self.holds_a_hole(id, Some(&ty))?;
        // `[a, b]` where the slot is a tuple. Written the same way as an array
        // and meaning something else: a fixed number of slots of their own
        // types, which is an object, so this builds one rather than an
        // allocation with a length.
        if let HirType::Managed(ManagedType::Object(type_id)) = ty.clone()
            && matches!(
                self.snapshot.types.get(type_id.0 as usize).map(|r| &r.kind),
                Some(TypeKind::Tuple(_))
            )
        {
            return self.lower_tuple_literal(id, type_id, &ty);
        }
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(self.unsupported(id, "an array literal that is not an array"));
        }
        let origin = self.origin(id);
        let elements = self.children(id);

        // `[...xs]`, which is a copy of `xs` and nothing else -- fourteen of the
        // twenty-six spreads in `runtime/node` are exactly this shape, and a
        // copy is what `slice` already is.
        //
        // Only this shape. `[...a, ...b]` needs the lengths added before
        // anything is allocated and `[...a, x]` needs one more slot than the
        // spread has; both are a different lowering rather than a longer
        // version of this one, and are refused by name.
        if let [only] = elements.as_slice()
            && self.kind_of(*only) == Some(syntax::SPREAD_ELEMENT)
        {
            return self.lower_spread_copy(*only, &ty, &origin);
        }
        if elements
            .iter()
            .any(|element| self.kind_of(*element) == Some(syntax::SPREAD_ELEMENT))
        {
            return self.lower_mixed_literal(&elements, &ty, &origin);
        }

        // An object element needs a layout, and asking is what builds one.
        //
        // `[{ name: "r", size: 1 }]` typed `Row[]` refused at the **C emitter**
        // with `NTS2006 an object type with no layout`, one step past every
        // message that names a source line. The type is layable-out: nothing was
        // wrong with it except that nothing had asked, because a field of array
        // type forces its element's layout and a *returned* array does not.
        //
        // Found by accident and then made deliberate. A predicate added to
        // `coerce` happened to call `layout_of` on the element and this fixture
        // went green -- the second time in a night that a query with a side
        // effect changed a program, and the first time it changed one for the
        // better. The addon it produced answers
        // `[{"name":"r","size":1},{"name":"s","size":2}]`, which is node's
        // answer, so the fix is real and only its arrival was an accident.
        // Asking here means it does not depend on a coercion that may not
        // happen.
        if let HirType::Managed(ManagedType::Array(element)) = &ty
            && let HirType::Managed(ManagedType::Object(at)) = element.as_ref()
        {
            self.layout_of(id, *at)?;
        }
        // Kept before `ty` is handed to the allocation below, which moves it.
        let wanted_element = match &ty {
            HirType::Managed(ManagedType::Array(element)) => Some((**element).clone()),
            _ => None,
        };

        #[allow(clippy::cast_precision_loss)]
        let count = elements.len() as f64;
        let length = self.push(OpKind::ConstFloat(count), HirType::NUMBER, origin.clone());
        let array = self.push(
            OpKind::ArrayNew {
                length,
                // Filled: an array literal: no code the source wrote can name it until every element is stored -- an element that throws leaves it unreachable.
                fill: ArrayFill::Filled,
            },
            ty,
            origin.clone(),
        );

        for (index, element_node) in elements.iter().enumerate() {
            // **At the element type, not at the array's.** Nothing narrowed
            // `expecting` here, so a nested literal saw the *outer* array's
            // type in the slot: `const xs: number[][] = [[1, 2]]` built the
            // inner `[1, 2]` as a `number[][]`, because the literal's own
            // `number[]` is discarded above when it disagrees with the slot,
            // and the slot it was compared against was the wrong one.
            //
            // `verify` reported it as a `StoreType` -- after `emit-c` had
            // refused nothing, which is the only reason it stayed reachable.
            // A hole, stored as an `undefined`. `holds_a_hole` above has
            // already established that the element is `Erased`.
            //
            // **A hole is genuinely absent, not present-and-`undefined`**, and
            // the difference is observable: `1 in [1, , 3]` is `false`,
            // `Object.keys` gives `["0", "2"]`, and `forEach`, `map` and
            // `join` all skip it. This stores a value at that index, so every
            // one of those would disagree with node.
            //
            // It is sound today because **each of them refuses**, and measured
            // rather than assumed: `in` over an array refuses whatever the key
            // (a number is not a literal property name), and `forEach`, `map`,
            // `join`, `Object.keys` and `hasOwnProperty` all refuse on an array
            // of erased elements, which is what a literal with a hole in it
            // now is. `blockers/a-hole-is-absent-not-undefined` pins that, so
            // the day one of those lands the person landing it finds this.
            //
            // The alternative is a sparse representation, which is a different
            // data structure from the dense array this compiler has -- so the
            // approximation is the same one the array model already makes, and
            // the honest scope of it is: **right for an indexed read, wrong for
            // anything that asks whether the index exists.**
            let value = if self.kind_of(*element_node) == Some(syntax::OMITTED_EXPRESSION) {
                self.push(OpKind::ConstUndefined, HirType::Erased, origin.clone())
            } else {
                match &wanted_element {
                    // **And coerced to it, the way a parameter is.** Lowering
                    // *expecting* the element type shapes a nested literal and
                    // checks nothing about a value that arrived with a type of
                    // its own. `const held: Named[] = [lit, new Thing()]`
                    // stored a `Thing` at `Named`'s representation with no
                    // question asked, and `r.name` on it read `id` -- a
                    // `double` -- as a string pointer: the exact case `coerce`
                    // refuses at a parameter, reached one container along.
                    // Measured 2026-09-22: SIGSEGV where node answers 3.
                    Some(element) => {
                        let value = self.lower_expecting(*element_node, element)?;
                        self.coerce(value, element, *element_node)?
                    }
                    None => self.lower_expression(*element_node)?,
                }
            };
            self.oblige_returned_element(id, index, value, *element_node);
            #[allow(clippy::cast_precision_loss)]
            let position = index as f64;
            let index = self.push(
                OpKind::ConstFloat(position),
                HirType::NUMBER,
                origin.clone(),
            );
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
        Ok(array)
    }

    /// `[]`, with the element type supplied from outside.
    pub(super) fn lower_empty_array(
        &mut self,
        id: NodeId,
        ty: HirType,
    ) -> Result<ValueId, Diagnostic> {
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(self.unsupported(id, "an empty array literal that is not an array"));
        }
        // **The element type comes from the annotation and nothing else will
        // mention it.** `[]` has no elements to lay out, so a
        // `const fs: (() => number)[] = []` filled by `push` and then called
        // reached the backend with a signature no layout answered for:
        // `NTS2006 an object type with no layout`, at the call rather than at
        // the declaration. The non-empty literal works because its elements are
        // materialized on the way in, and a *parameter* of the same type works
        // because parameters are materialized too — this is the one position
        // where the type is written down and nothing walks it.
        //
        // Through `materialize`, so an array of arrays of signatures is reached
        // as well: it walks containers for exactly this reason.
        self.materialize(id, &ty)?;
        let origin = self.origin(id);
        let length = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        Ok(self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            ty,
            origin,
        ))
    }

    /// The array type a `new Array(n)` allocates at.
    ///
    /// **An erased element is not an element, so it does not out-rank the context.**
    /// [`Self::lower_new`]'s own paragraph states the rule -- *"the type comes from
    /// where the result goes, because the constructor's own type is a union of the
    /// overloads in `lib.d.ts` and says nothing about the element"* -- and the code
    /// that implemented it preferred the node's own type whenever that was *any*
    /// array. `new Array(n)` is declared `any[]` there, so once `any` represents as
    /// `Erased` the node's own type passes an `Array(_)` test while still saying
    /// nothing, and the code was a subset of the sentence above it.
    ///
    /// `tests/programs/objects` is what noticed: `const balls: Ball[] = new Array(count)`
    /// allocated an array of erased slots and then refused to be a `Ball[]`, which
    /// is the same pointer at two widths.
    ///
    /// The erased form stays as the last resort rather than being dropped, because
    /// `const xs: any[] = new Array(3)` has no better answer and is an ordinary
    /// thing to write.
    ///
    /// **And where the result goes is past any choice that passes it on.** In
    /// `this.storage = size === 0 ? null : new Array(size)` the arm's context is
    /// the conditional, whose own type the checker gives as `any[]` -- the
    /// `null` absorbed into `new Array`'s declared `any[]` -- so the arm was an
    /// erased array again, refused as "an array of Erased where an array of ...
    /// is wanted". The conditional chooses no type of its own; the field it is
    /// stored into does. Are We Fast Yet's `Vector` allocates exactly so, and
    /// four of its benchmarks stopped there.
    pub(super) fn allocated_array_type(&mut self, id: NodeId) -> Result<HirType, Diagnostic> {
        let concrete = |ty: &HirType| {
            matches!(ty, HirType::Managed(ManagedType::Array(_))) && !an_unchosen_collection(ty)
        };
        let unchosen = HirType::Managed(ManagedType::Array(Box::new(HirType::Erased)));
        self.type_of(id)
            .filter(concrete)
            .or_else(|| Some(self.instead_of_an_unchosen_collection(id, unchosen)).filter(concrete))
            .or_else(|| {
                self.contextual_type(id, 0)
                    .filter(|ty| matches!(ty, HirType::Managed(ManagedType::Array(_))))
            })
            .or_else(|| {
                self.type_of(id)
                    .filter(|ty| matches!(ty, HirType::Managed(ManagedType::Array(_))))
            })
            .ok_or_else(|| self.unrepresentable(id, "a `new Array`"))
    }

    /// The outermost expression `id`'s value reaches unchanged through choices:
    /// an arm of `c ? a : b`, either side of `a ?? b`, `a || b` or `a && b`, and
    /// parentheses. Each picks one operand and chooses no type of its own, so
    /// what the whole is heading for is what the operand is heading for.
    pub(super) fn past_the_choices(&self, id: NodeId) -> NodeId {
        let mut at = id;
        for _ in 0..8 {
            let Some(parent) = self.syntactic_parent(at) else {
                break;
            };
            let passes = match self.kind_of(parent) {
                Some(syntax::PARENTHESIZED_EXPRESSION) => true,
                // An arm, not the condition, which is the first child.
                Some(syntax::CONDITIONAL_EXPRESSION) => self.children(parent).first() != Some(&at),
                Some(syntax::BINARY_EXPRESSION) => {
                    let parts = self.children(parent);
                    matches!(
                        parts.get(1).and_then(|operator| self.kind_of(*operator)),
                        Some(
                            syntax::QUESTION_QUESTION_TOKEN
                                | syntax::BAR_BAR_TOKEN
                                | syntax::AMPERSAND_AMPERSAND_TOKEN
                        )
                    )
                }
                _ => false,
            };
            if !passes {
                break;
            }
            at = parent;
        }
        at
    }

    /// An array literal with a spread somewhere in it: `[...a, x, ...b]`.
    ///
    /// Everything is evaluated first, left to right, because that is the order
    /// JavaScript evaluates it in and the lengths are not known until it has
    /// been. Then the lengths are added -- one per plain element, the array's
    /// own for each spread -- and *then* the result is allocated, with the room
    /// it needs and no length.
    ///
    /// So `push` never reallocates and there is nothing to shorten at the end,
    /// which is the shape `filter` uses and for the same reasons.
    fn lower_mixed_literal(
        &mut self,
        elements: &[NodeId],
        ty: &HirType,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let element_ty = match ty {
            HirType::Managed(ManagedType::Array(element)) => (**element).clone(),
            _ => return Err(self.unrepresentable(elements[0], "an array literal")),
        };
        let (push, extend) = match &element_ty {
            counted if holds_counted(counted) => (
                "nts_array_push_ref",
                counted_helper(counted, Counts::Extend),
            ),
            HirType::Float { bits: 64 } => ("nts_array_push", "nts_array_extend"),
            _ => {
                return Err(self.unsupported(elements[0], "a spread into a typed array"));
            }
        };

        // Left to right, and before anything is allocated.
        let mut lowered = Vec::new();
        for element in elements {
            let spread = self.kind_of(*element) == Some(syntax::SPREAD_ELEMENT);
            let node = if spread {
                *self
                    .children(*element)
                    .first()
                    .ok_or_else(|| self.unsupported(*element, "a spread of nothing"))?
            } else {
                *element
            };
            let collected = if spread {
                self.collect_spread(*element, node, ty)?
            } else {
                None
            };
            let value = match collected {
                Some(collected) => collected,
                None if spread => self.lower_expression(node)?,
                // A written element, lowered expecting the element type and
                // coerced to it, as the literal without a spread lowers each
                // one. Lowered bare, an inner literal took the *outer* one's
                // expected type: `[["s", t], ...more]` built `["s", t]` as an
                // array of string arrays and stored strings in it, which one
                // pointer type hid on a native backend and Wasm's typed arrays
                // refused.
                None => {
                    let value = self.lower_expecting(node, &element_ty)?;
                    self.coerce(value, &element_ty, node)?
                }
            };
            if spread
                && !matches!(
                    self.values[value.0 as usize].ty,
                    HirType::Managed(ManagedType::Array(_))
                )
            {
                return Err(self.unsupported(node, "a spread of something that is not an array"));
            }
            lowered.push((spread, value));
        }

        let mut total = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        for (spread, value) in &lowered {
            let more = if *spread {
                self.push(OpKind::Length(*value), HirType::NUMBER, origin.clone())
            } else {
                self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone())
            };
            total = self.push(
                OpKind::Binary {
                    op: BinOp::Add,
                    lhs: total,
                    rhs: more,
                },
                HirType::NUMBER,
                origin.clone(),
            );
        }

        let out = self.push(
            OpKind::ArrayNew {
                length: total,
                fill: ArrayFill::Uninitialized,
            },
            ty.clone(),
            origin.clone(),
        );
        let none = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.runtime_call(
            "nts_array_keep_first",
            vec![out, none],
            HirType::Void,
            origin.clone(),
        );
        for (spread, value) in lowered {
            let helper = if spread { extend } else { push };
            let result = if spread {
                HirType::Void
            } else {
                HirType::NUMBER
            };
            self.runtime_call(helper, vec![out, value], result, origin.clone());
        }
        Ok(out)
    }

    /// `[...xs]`: the whole of `xs`, copied.
    ///
    /// A `slice` from nothing to the length, which is what the spread means and
    /// what `slice` already does -- including retaining each element where they
    /// are references, since both arrays hold them afterwards.
    fn lower_spread_copy(
        &mut self,
        spread: NodeId,
        ty: &HirType,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let inner = *self
            .children(spread)
            .first()
            .ok_or_else(|| self.unsupported(spread, "a spread of nothing"))?;
        if let Some(collected) = self.collect_spread(spread, inner, ty)? {
            return Ok(collected);
        }
        self.lower_array_copy(inner, ty, origin)
    }

    /// A spread of something that is not an array, collected into an array
    /// of `ty`: a `Set`, a `Map` (its pairs), or what `keys()`, `values()` or
    /// `entries()` yield. `[...x]` is `Array.from(x)` -- the same walk, which
    /// fills a table's keys or values in one call -- and inside a longer
    /// literal it is that array, extended like any other. Collected at the
    /// literal's own type, so a walked pair and a written one beside it share
    /// one representation.
    ///
    /// None where the source is an array itself, which is copied.
    fn collect_spread(
        &mut self,
        spread: NodeId,
        inner: NodeId,
        ty: &HirType,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let (sequence, forced) = self.sequence_source(inner);
        let collects = match self.type_of(sequence) {
            Some(HirType::Managed(ManagedType::Set(_) | ManagedType::Map(..))) => true,
            Some(HirType::Managed(ManagedType::Array(_) | ManagedType::View(_))) => {
                forced.is_some()
            }
            _ => false,
        };
        if !collects {
            return Ok(None);
        }
        let sequence_value = self.lower_expression(sequence)?;
        let walk = self.collection_walk(sequence, sequence_value, forced)?;
        self.collect_a_walk(spread, sequence, sequence_value, walk, ty)
            .map(Some)
    }

    /// The whole of an array, copied: `[...xs]` and `Array.from(xs)` alike.
    ///
    /// A `slice` from nothing to the length, which is what both mean and what
    /// `slice` already does -- including retaining each element where they are
    /// references, since both arrays hold them afterwards.
    pub(super) fn lower_array_copy(
        &mut self,
        inner: NodeId,
        ty: &HirType,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let source = self.lower_expression(inner)?;
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[source.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(inner, "a copy of something that is not an array"));
        };
        let helper = self.slice_helper(inner, &element, "a copy")?;
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let length = self.push(OpKind::Length(source), HirType::NUMBER, origin.clone());
        Ok(self.runtime_call(
            helper,
            vec![source, zero, length],
            ty.clone(),
            origin.clone(),
        ))
    }

    /// The runtime's slice of an array of `element`s: what a copy (`[...xs]`,
    /// `Array.from(xs)`) and a rest element (`[first, ...rest] = xs`) both are.
    ///
    /// One decision, because the slice helpers come in widths and a slice at
    /// the wrong one reads the elements wrongly: `nts_array_slice` copies eight
    /// bytes an element, and the rest element called it for every array, so a
    /// rest over an `unknown[]` held halves of sixteen-byte values (the Wasm
    /// lane's test262 parity run; tests/programs/a-rest-element-over-erased-
    /// elements is the guard).
    pub(super) fn slice_helper(
        &self,
        at: NodeId,
        element: &HirType,
        what: &str,
    ) -> Result<&'static str, Diagnostic> {
        Ok(match *element {
            ref counted if holds_counted(counted) => counted_helper(counted, Counts::Slice),
            HirType::Float { bits: 64 } => "nts_array_slice",
            // An erased element is an `NtsValue`, each retained as its tag says.
            HirType::Erased => "nts_array_slice_value",
            // `slice` reads the elements as doubles, pointers or values, and a
            // narrower one is none of them. The array methods refuse the same
            // shape for the same reason.
            _ => return Err(self.unsupported(at, &format!("{what} of a typed array"))),
        })
    }

    pub(super) fn null_slot(&mut self, array_node: Option<NodeId>, origin: &Origin) -> ValueId {
        let only_null = array_node
            .and_then(|node| self.read_type(node))
            .is_some_and(|ty| self.null_only_element(ty));
        let tag = if only_null {
            crate::hir::tags::NULL
        } else {
            crate::hir::tags::UNDEFINED
        };
        self.push(
            OpKind::ConstInt(i128::from(tag)),
            HirType::Int {
                bits: 32,
                signed: false,
            },
            origin.clone(),
        )
    }

    /// Whether `array` is an array type whose element admits `null` and not
    /// `undefined`: the one kind whose null slot reads as `null`.
    ///
    /// **Which is true only while the array has no holes.** A hole reads as
    /// `undefined` whatever the element type says -- `new Array<T | null>(3)`
    /// holds three -- and is the same null pointer as a stored `null`. So the
    /// two ways a compiled program makes holes are refused for exactly this
    /// kind ([`Self::refuse_holes_that_read_as_null`]), and for every other
    /// kind a hole and the null slot's absence agree.
    ///
    /// **Through a nullable array and a type parameter.** The context is often
    /// a field `E[] | null` -- a `Vector<E>` that allocates on first use -- so
    /// the array is the union's array member, and in a generic copy `E` is what
    /// the copy's sources say it stands for: the representation cannot say,
    /// since `JsonValue` and `JsonValue | null` are one pointer.
    pub(super) fn null_only_element(&self, array: TypeId) -> bool {
        let source = |ty: TypeId| *self.sources.get(&ty).unwrap_or(&ty);
        let array = source(array);
        let kind = self
            .snapshot
            .types
            .get(array.0 as usize)
            .map(|record| &record.kind);
        if let Some(TypeKind::Union(members)) = kind {
            return members.iter().any(|member| self.null_only_element(*member));
        }
        let Some(TypeKind::Array(element)) = kind else {
            return false;
        };
        let element = source(*element);
        let members = match self.snapshot.types.get(element.0 as usize).map(|r| &r.kind) {
            Some(TypeKind::Union(members)) => members.clone(),
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => vec![element],
            _ => vec![element],
        };
        let absences: Vec<Absence> = members
            .iter()
            .filter_map(|member| absence_of_member(self.snapshot, *member))
            .collect();
        absences.contains(&Absence::Null) && !absences.contains(&Absence::Undefined)
    }

    /// `new Array(n)` where the array's element admits `null` and not
    /// `undefined`, and nothing fills it at once: holes a read would answer
    /// `null` for, where JavaScript answers `undefined`. Refused rather than
    /// guessed -- see [`Self::null_only_element`]. `new Array(3).fill(null)`,
    /// which Are We Fast Yet's Towers writes, has no hole anyone can read.
    ///
    /// The element is the type arguments', or else that of what the array is
    /// given to ([`Self::hole_context`]); where neither can be read, an array of
    /// references is refused and any other kept, since only a reference slot's
    /// null can be taken for one.
    fn refuse_holes_that_read_as_null(
        &self,
        id: NodeId,
        allocated: &HirType,
    ) -> Result<(), Diagnostic> {
        let parent = self.syntactic_parent(id);
        let filled_at_once = parent.is_some_and(|access| {
            self.kind_of(access) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
                && self.children(access).get(1).and_then(|name| {
                    self.node(*name)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                }) == Some("fill")
                && self.syntactic_parent(access).is_some_and(|call| {
                    self.kind_of(call) == Some(syntax::CALL_EXPRESSION)
                        && self.arguments_of(call).len() == 1
                })
        });
        if filled_at_once {
            return Ok(());
        }
        // The element written in the type arguments, or else the type of what
        // the array is given to: `new Array(3)` alone is `any[]`.
        let own = self
            .snapshot
            .node_types
            .get(&id)
            .copied()
            .filter(|ty| !self.untyped_array(*ty));
        // Asked where the array ends up, past a choice that passes it on --
        // `size === 0 ? null : new Array(size)` -- as its type is.
        let destination = self.past_the_choices(id);
        let context = own.or_else(|| {
            self.syntactic_parent(destination)
                .and_then(|at| self.hole_context(destination, at))
        });
        let holed = match context {
            Some(ty) => self.null_only_element(ty),
            // Nowhere this can read: refused where a hole could be read as a
            // null, an array of references, and kept where it cannot.
            None => matches!(
                allocated,
                HirType::Managed(ManagedType::Array(element)) if element.is_managed()
            ),
        };
        if holed {
            return Err(self.unsupported(
                id,
                "a `new Array(n)` of `T | null` that is not filled at once, whose holes read as \
                 `undefined` where a null slot of it reads as `null`",
            ));
        }
        Ok(())
    }

    /// Whether `ty` is an array of `any` or `unknown`: what `new Array(n)`
    /// with no type argument is, and which says nothing of the element.
    fn untyped_array(&self, ty: TypeId) -> bool {
        let Some(TypeKind::Array(element)) = self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        else {
            return false;
        };
        matches!(
            self.snapshot
                .types
                .get(element.0 as usize)
                .map(|record| &record.kind),
            Some(TypeKind::Any | TypeKind::Unknown)
        )
    }

    /// The type an untyped `new Array(n)` (`id`) is given to, from its parent
    /// `at`: a declaration's or an assignment's target, the enclosing
    /// function's declared result for a `return`, the selected signature's
    /// parameter for an argument. `None` where the context is none of these.
    fn hole_context(&self, id: NodeId, at: NodeId) -> Option<TypeId> {
        let typed = |node: NodeId| self.snapshot.node_types.get(&node).copied();
        match self.kind_of(at) {
            Some(
                syntax::VARIABLE_DECLARATION
                | syntax::PROPERTY_DECLARATION
                | syntax::BINARY_EXPRESSION,
            ) => self.children(at).first().copied().and_then(typed),
            Some(syntax::RETURN_STATEMENT) => {
                let mut function = self.syntactic_parent(at);
                while let Some(node) = function {
                    if matches!(
                        self.snapshot
                            .types
                            .get(typed(node)?.0 as usize)
                            .map(|record| &record.kind),
                        Some(TypeKind::Function(_))
                    ) && matches!(
                        self.kind_of(node),
                        Some(
                            syntax::FUNCTION_DECLARATION
                                | syntax::FUNCTION_EXPRESSION
                                | syntax::ARROW_FUNCTION
                                | syntax::METHOD_DECLARATION
                        )
                    ) {
                        break;
                    }
                    function = self.syntactic_parent(node);
                }
                let TypeKind::Function(signature) =
                    self.snapshot.types.get(typed(function?)?.0 as usize)?.kind
                else {
                    return None;
                };
                Some(
                    self.snapshot
                        .signatures
                        .get(signature.0 as usize)?
                        .return_type,
                )
            }
            Some(syntax::CALL_EXPRESSION) => {
                let position = self.arguments_of(at).iter().position(|arg| *arg == id)?;
                let signature = self.snapshot.call_targets.get(&at)?.signature;
                let parameter = self
                    .snapshot
                    .signatures
                    .get(signature.0 as usize)?
                    .parameters
                    .get(position)?;
                (!parameter.rest).then_some(parameter.ty)
            }
            _ => None,
        }
    }
}

//! Array's constructor contract, shared by calls and `new`.
//! <https://tc39.es/ecma262/#sec-array-constructor>

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

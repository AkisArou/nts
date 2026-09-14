//! Native places are addresses. Member access and addrOf share this path so
//! evaluating a receiver never performs an accidental aggregate copy/load.
use super::{Diagnostic, FuncBuilder, HirType, NodeId, OpKind, Place, ValueId};
use crate::hir::native::Pointee;
use nts_semantic_schema::{LiteralValue, TypeKind, syntax};

impl FuncBuilder<'_> {
    pub(super) fn native_member_key(&self, access: NodeId, key: NodeId) -> Option<String> {
        if self.kind_of(access) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return self.literal_name(key);
        }
        match &self.snapshot.types[self.snapshot.node_types.get(&key)?.0 as usize].kind {
            TypeKind::Literal(LiteralValue::String(name)) => Some(name.clone()),
            _ => None,
        }
    }

    pub(super) fn native_element_type(&self, id: NodeId, pointer: ValueId) -> Result<HirType, Diagnostic> {
        match &self.values[pointer.0 as usize].ty {
            HirType::NativePointer(element) => element.element_type(),
            _ => None,
        }.ok_or_else(|| self.unsupported(id, "native memory access without a loadable scalar or pointer layout"))
    }

    pub(super) fn native_index_address(&mut self, id: NodeId, pointer: ValueId, index: ValueId) -> Result<ValueId, Diagnostic> {
        let ty = self.values[pointer.0 as usize].ty.clone();
        // Same reason as the field case: the element address of a `const T *`
        // is a `const T *`, and handing back a writable one would launder the
        // qualifier this view exists to carry.
        if matches!(&ty, HirType::NativePointer(Pointee::Const(_))) {
            return Err(self.unsupported(id, "the address of an element of a `const` native view"));
        }
        if !matches!(&ty, HirType::NativePointer(p) if !matches!(p, Pointee::Opaque(_))) {
            return Err(self.unsupported(id, "address arithmetic without a native element layout"));
        }
        let index = self.coerce(index, &HirType::Int { bits: 64, signed: true }, id)?;
        Ok(self.push(OpKind::NativeIndexAddress { pointer, index }, ty, self.origin(id)))
    }

    pub(super) fn native_load(&mut self, id: NodeId, pointer: ValueId, index: ValueId) -> Result<ValueId, Diagnostic> {
        if matches!(self.values[pointer.0 as usize].ty, HirType::NativePointer(Pointee::Struct(_))) {
            return self.native_index_address(id, pointer, index);
        }
        let ty = self.native_element_type(id, pointer)?;
        let number = matches!(ty, HirType::Int { .. } | HirType::Float { .. });
        let index = self.coerce(index, &HirType::Int { bits: 64, signed: true }, id)?;
        let read = self.push(OpKind::NativeLoad { pointer, index }, ty, self.origin(id));
        if number { self.coerce(read, &HirType::NUMBER, id) } else { Ok(read) }
    }

    pub(super) fn native_field_address(&mut self, id: NodeId, pointer: ValueId, name: &str) -> Result<ValueId, Diagnostic> {
        // Named before the general refusal, because "without a native struct
        // layout" is true of a const view and says nothing a reader can act on.
        //
        // The address of a member of a `const T *` is a `const U *` in C, and
        // that is what it would have to be here -- an address that dropped the
        // qualifier would launder it, and `addrOf` returns a writable pointer.
        // Giving it back as const needs the surface to tell a const slot from a
        // mutable one, and today `Slot<T>` is the same type in both, the
        // read-only-ness living on the container. Refused until it can be
        // returned with the qualifier it must carry.
        if let HirType::NativePointer(Pointee::Const(_)) = &self.values[pointer.0 as usize].ty {
            return Err(self.unsupported(id, "the address of a member of a `const` native view"));
        }
        let HirType::NativePointer(Pointee::Struct(layout)) = &self.values[pointer.0 as usize].ty else {
            return Err(self.unsupported(id, "a field address without a native struct layout"));
        };
        let (field, slot) = layout.fields.iter().enumerate().find(|(_, f)| f.name == name)
            .ok_or_else(|| self.unsupported(id, &format!("native struct `{}` has no field `{name}`", layout.name)))?;
        let field = u32::try_from(field).map_err(|_| self.unsupported(id, "too many native fields"))?;
        let ty = HirType::NativePointer(slot.ty.clone());
        Ok(self.push(OpKind::NativeFieldAddress { pointer, field }, ty, self.origin(id)))
    }

    pub(super) fn native_element_place(&mut self, id: NodeId, pointer: ValueId, index: ValueId) -> Result<Place, Diagnostic> {
        let index = self.coerce(index, &HirType::Int { bits: 64, signed: true }, id)?;
        Ok(Place::NativeElement { pointer, index })
    }

    pub(super) fn native_member_place(&mut self, id: NodeId, pointer: ValueId) -> Result<Place, Diagnostic> {
        let member = *self.children(id).last().ok_or_else(|| self.unsupported(id, "a missing native field name"))?;
        let name = self.native_member_key(id, member).ok_or_else(|| self.unsupported(id, "a computed native field name"))?;
        if self.kind_of(id) == Some(syntax::ELEMENT_ACCESS_EXPRESSION) { self.lower_expression(member)?; }
        self.native_field_place(id, pointer, &name)
    }

    pub(super) fn native_field_place(&mut self, id: NodeId, pointer: ValueId, name: &str) -> Result<Place, Diagnostic> {
        let pointer = self.native_field_address(id, pointer, name)?;
        let index = self.push(OpKind::ConstInt(0), HirType::Int { bits: 64, signed: true }, self.origin(id));
        Ok(Place::NativeElement { pointer, index })
    }

    /// `addrOf(p.fd)` and `addrOf(p[i])`, which are `&p->fd` and `&p[i]`.
    ///
    /// The argument is examined as *syntax*, because TypeScript has no lvalues
    /// and so a type cannot say whether an expression denotes storage:
    /// `addrOf(1 + 1)` and `addrOf(f())` typecheck exactly as `addrOf(p.fd)`
    /// does. Two shapes denote a place -- a member of native storage and an
    /// element of it -- and everything else is refused here, naming what was
    /// written rather than leaving a signature that promises more than it takes.
    ///
    /// A managed object is refused by the same path one step later: its receiver
    /// does not lower to a native pointer, so there is no place to address. That
    /// is deliberate and permanent rather than unimplemented. A TypeScript
    /// object's representation belongs to the compiler, and handing out an
    /// interior address would fix a layout that reference counting and
    /// specialization both expect to own.
    pub(super) fn native_address_of(&mut self, id: NodeId, arguments: &[NodeId]) -> Result<ValueId, Diagnostic> {
        let [place] = arguments else {
            return Err(self.unsupported(id, "addrOf takes one native place"));
        };
        let kind = self.kind_of(*place);
        let children = self.children(*place);
        if !matches!(
            kind,
            Some(syntax::PROPERTY_ACCESS_EXPRESSION | syntax::ELEMENT_ACCESS_EXPRESSION)
        ) || children.len() < 2
        {
            return Err(self.unsupported(id, "addrOf needs a field or an element of native storage"));
        }
        let (receiver, member) = (children[0], children[children.len() - 1]);
        let pointer = self.lower_expression(receiver)?;
        let index_type = self.type_of(member);
        let address = if kind == Some(syntax::ELEMENT_ACCESS_EXPRESSION)
            && matches!(index_type, Some(HirType::Int { .. } | HirType::Float { .. }))
        {
            let index = self.lower_expression(member)?;
            self.native_index_address(id, pointer, index)?
        } else {
            let name = self
                .native_member_key(*place, member)
                .ok_or_else(|| self.unsupported(id, "addrOf needs a constant field name"))?;
            // `p[key()]` names its field with an expression, and that expression
            // still runs. Only an element access has one: the member of a
            // property access is an identifier, not a value to evaluate. The
            // same split `native_member_place` makes, for the same reason -- a
            // key whose call was dropped is a side effect silently deleted, and
            // the layout is identical either way, so nothing else would notice.
            if kind == Some(syntax::ELEMENT_ACCESS_EXPRESSION) {
                self.lower_expression(member)?;
            }
            self.native_field_address(id, pointer, &name)?
        };
        // A tag cannot authorize lying about the returned pointer's pointee.
        if self.type_of(id).as_ref() != Some(&self.values[address.0 as usize].ty) {
            return Err(self.unsupported(id, "addrOf result does not match the addressed native storage"));
        }
        Ok(address)
    }
}

impl FuncBuilder<'_> {
    pub(super) fn native_storage(&mut self, id: NodeId, operation: &str, args: &[NodeId]) -> Result<ValueId, Diagnostic> {
        if operation == "sizeof" {
            if self.type_of(id) != Some(HirType::NUMBER) { return Err(self.unsupported(id, "sizeof must return a number")); }
            if !args.is_empty() { return Err(self.unsupported(id, "sizeof takes a type argument, not a value")); }
            // Type-argument lists precede argument lists in the raw call AST.
            let type_node = self.node(id).children.iter()
                .filter_map(|list| (self.node(*list).kind == nts_semantic_schema::NodeKind::List).then_some(*list))
                .find_map(|list| self.node(list).children.first().copied())
                .ok_or_else(|| self.unsupported(id, "sizeof needs one explicit native type argument"))?;
            let ty = *self.snapshot.node_types.get(&type_node).ok_or_else(|| self.unsupported(id, "sizeof type has no semantic type"))?;
            let storage = crate::hir::native::storage(self.snapshot, ty).ok_or_else(|| self.unsupported(id, "sizeof needs a complete native storage type"))?;
            let shape = crate::hir::layout::native_shape(&storage).ok_or_else(|| self.unsupported(id, "sizeof needs a complete native layout"))?;
            return Ok(self.push(OpKind::ConstFloat(f64::from(shape.size)), HirType::NUMBER, self.origin(id)));
        }
        if operation == "free" {
            let [arg] = args else { return Err(self.unsupported(id, "free needs one pointer")); };
            let expecting = self.expecting.replace(HirType::NativePointer(Pointee::Scalar(crate::hir::native::Scalar::UInt8)));
            let pointer = self.lower_expression(*arg);
            self.expecting = expecting;
            let pointer = pointer?;
            if !matches!(self.values[pointer.0 as usize].ty, HirType::NativePointer(_)) {
                return Err(self.unsupported(id, "free needs a typed native pointer (possibly null)"));
            }
            return Ok(self.push(OpKind::NativeFree { pointer }, HirType::Void, self.origin(id)));
        }
        let ty = self.type_of(id).ok_or_else(|| self.unsupported(id, "native allocation needs a complete native type argument"))?;
        let HirType::NativePointer(ref element) = ty else { return Err(self.unsupported(id, "native allocation must return a typed pointer")); };
        let shape = crate::hir::layout::native_shape(element).ok_or_else(|| self.unsupported(id, "native allocation needs a complete element layout"))?;
        let kind = if operation == "local" {
            let count = match args {
                [] => 1.0,
                [arg] => {
                    let value = self.lower_expression(*arg)?;
                    match self.values[value.0 as usize].kind {
                        OpKind::ConstFloat(n) => n,
                        OpKind::ConstInt(n) => f64::from(u32::try_from(n).map_err(|_| self.unsupported(id, "local needs a positive fixed count"))?),
                        _ => self.constant_value(*arg, &rustc_hash::FxHashMap::default())
                            .ok_or_else(|| self.unsupported(id, "local array count must be a compile-time constant"))?,
                    }
                }
                _ => return Err(self.unsupported(id, "local takes at most one constant element count")),
            };
            if !count.is_finite() || count < 1.0 || count.fract() != 0.0 || count * f64::from(shape.size) > f64::from(crate::hir::native_storage::STACK_LIMIT) {
                return Err(self.unsupported(id, "local needs a positive fixed count and at most 65536 bytes"));
            }
            // Positive, integral and bounded above by STACK_LIMIT above.
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let count = count as u32;
            OpKind::NativeLocal { count }
        } else {
            let [arg] = args else { return Err(self.unsupported(id, "malloc needs a byte count")); };
            let bytes = self.lower_expression(*arg)?;
            let bytes = self.coerce(bytes, &HirType::NUMBER, id)?;
            OpKind::NativeMalloc { bytes }
        };
        Ok(self.push(kind, ty, self.origin(id)))
    }
}

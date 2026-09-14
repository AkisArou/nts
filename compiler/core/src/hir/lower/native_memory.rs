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

    pub(super) fn native_address_of(&mut self, id: NodeId, arguments: &[NodeId]) -> Result<ValueId, Diagnostic> {
        let [storage, key] = arguments else { return Err(self.unsupported(id, "addrOf needs native storage and a field key or element index")); };
        let pointer = self.lower_expression(*storage)?;
        let index_type = self.type_of(*key);
        let address = if matches!(index_type, Some(HirType::Int { .. } | HirType::Float { .. })) {
            let index = self.lower_expression(*key)?;
            self.native_index_address(id, pointer, index)?
        } else {
            let name = self.native_member_key(id, *key).ok_or_else(|| self.unsupported(id, "addrOf needs a constant native field key"))?;
            self.lower_expression(*key)?;
            self.native_field_address(id, pointer, &name)?
        };
        // A tag cannot authorize lying about the returned pointer's pointee.
        if self.type_of(id).as_ref() != Some(&self.values[address.0 as usize].ty) {
            return Err(self.unsupported(id, "addrOf result does not match the addressed native storage"));
        }
        Ok(address)
    }
}

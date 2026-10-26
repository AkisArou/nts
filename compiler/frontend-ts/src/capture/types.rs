//! Direct checker types, with one owned arena slot before following any edge.

use nts_frontend_tsrs::{self as native, Type};
use nts_semantic_schema::{LiteralValue, SnapshotError, TypeId, TypeKind, TypeRecord};

use super::{Capture, arena_index};

impl<'p> Capture<'p, '_> {
    pub(super) fn intern_type(&mut self, ty: Type<'p>) -> Result<TypeId, SnapshotError> {
        if let Some(id) = self.types.get(&ty) {
            return Ok(*id);
        }
        let symbol = match ty.symbol() {
            Some(symbol)
                if !symbol.classification().type_literal
                    && !symbol.classification().object_literal =>
            {
                Some(self.intern_symbol(symbol)?)
            }
            _ => None,
        };
        let kind = if ty.evolving_any() {
            TypeKind::Evolving
        } else {
            match primitive(ty.kind()) {
                Some(kind) => kind,
                None if matches!(ty.kind(), native::TypeKind::Literal) => literal(ty.literal()),
                None => TypeKind::Unsupported {
                    rendered: "a native type whose graph has not been requested".into(),
                },
            }
        };
        let id = TypeId(arena_index(self.snapshot.types.len())?);
        self.snapshot.types.push(TypeRecord { kind, symbol });
        self.types.insert(ty, id);
        self.type_work.push(ty);
        if let Some(well_known) = ty.well_known_symbol()
            && let Some(previous) = self.snapshot.well_known_symbols.insert(well_known, id)
            && previous != id
        {
            return Err(SnapshotError::Project(format!(
                "the native checker supplied two identities for {well_known:?}"
            )));
        }
        Ok(id)
    }

    pub(super) fn shallow_type(&mut self, ty: Type<'p>) -> Result<TypeId, SnapshotError> {
        let id = self.intern_type(ty)?;
        if matches!(&self.snapshot.types[id.0 as usize].kind,
            TypeKind::Unsupported { rendered }
                if rendered == "a native type whose graph has not been requested")
        {
            self.snapshot.types[id.0 as usize].kind = TypeKind::Structured;
        }
        Ok(id)
    }

    pub(super) fn capture_node_types(&mut self) -> Result<(), SnapshotError> {
        for index in 0..self.native_nodes.len() {
            if !self.queries[index].types {
                continue;
            }
            let Some(node) = self.native_nodes[index] else {
                continue;
            };
            let ty = self.intern_type(node.ty())?;
            self.snapshot
                .node_types
                .insert(nts_semantic_schema::NodeId(arena_index(index)?), ty);
        }
        Ok(())
    }
}

/// Absence means a structured graph is needed. Other is deliberately a real
/// named unsupported type; it must never reach an Any/Unknown fallback.
fn primitive(kind: native::TypeKind) -> Option<TypeKind> {
    use native::TypeKind as N;
    Some(match kind {
        N::Any => TypeKind::Any,
        N::Unknown => TypeKind::Unknown,
        N::Never => TypeKind::Never,
        N::Void => TypeKind::Void,
        N::Undefined => TypeKind::Undefined,
        N::Null => TypeKind::Null,
        N::Boolean => TypeKind::Boolean,
        N::String => TypeKind::String,
        N::Number => TypeKind::Number,
        N::BigInt => TypeKind::BigInt,
        N::Symbol => TypeKind::Symbol,
        N::UniqueSymbol => TypeKind::UniqueSymbol,
        N::NonPrimitive => TypeKind::NonPrimitive,
        N::Other => TypeKind::Unsupported {
            rendered: "a native TypeScript type outside nts's semantic model".into(),
        },
        N::Literal
        | N::TypeParameter
        | N::Union
        | N::Intersection
        | N::Tuple
        | N::Reference
        | N::Object
        | N::Conditional
        | N::IndexedAccess
        | N::Template
        | N::Substitution => return None,
    })
}

fn literal(value: Option<native::TypeLiteral<'_>>) -> TypeKind {
    let value = match value {
        Some(native::TypeLiteral::Number(number)) => LiteralValue::Number(number),
        Some(native::TypeLiteral::Boolean(boolean)) => LiteralValue::Boolean(boolean),
        Some(native::TypeLiteral::BigInt { negative, digits }) => {
            LiteralValue::BigInt(format!("{}{digits}", if negative { "-" } else { "" }))
        }
        Some(native::TypeLiteral::String(text)) => LiteralValue::String(match text.utf8() {
            Some(text) => text.into(),
            None => nts_semantic_schema::JsText::from_utf16(text.utf16().to_vec()),
        }),
        None => {
            return TypeKind::Unsupported {
                rendered: "a native literal type without a literal value".into(),
            };
        }
    };
    TypeKind::Literal(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unmodelled_native_type_is_named_instead_of_erased() {
        assert_eq!(
            primitive(native::TypeKind::Other),
            Some(TypeKind::Unsupported {
                rendered: "a native TypeScript type outside nts's semantic model".into(),
            })
        );
    }
}

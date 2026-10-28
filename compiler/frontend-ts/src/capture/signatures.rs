//! Owned call contracts and the declaration selected by overload resolution.

use nts_frontend_tsrs::{self as native, Signature};
use nts_semantic_schema::{
    CallTarget, ConstantValue, NodeId, NodeKind, ParameterRecord, SignatureId, SignatureRecord,
    SnapshotError, TypePredicate, syntax,
};

use super::{Capture, arena_index, symbols::semantic_name};

impl<'p> Capture<'p, '_> {
    pub(super) fn intern_signature(
        &mut self,
        signature: Signature<'p>,
        construct: bool,
    ) -> Result<SignatureId, SnapshotError> {
        if let Some(id) = self.signatures.get(&(signature, construct)) {
            return Ok(*id);
        }
        let mut parameters = Vec::new();
        for parameter in signature.parameters() {
            parameters.push(ParameterRecord {
                name: semantic_name(parameter.name)?,
                ty: self.intern_type(parameter.ty)?,
                optional: parameter.optional || parameter.has_initializer,
                rest: parameter.rest,
            });
        }
        let mut type_parameters = Vec::new();
        for parameter in signature.type_parameters() {
            type_parameters.push(self.intern_type(parameter)?);
        }
        let return_type = self.intern_type(signature.return_type())?;
        let this_type = match signature.this_parameter() {
            Some(parameter) => Some(self.intern_type(parameter.ty)?),
            None => None,
        };
        let type_predicate = match signature.predicate() {
            Some(predicate) => Some(TypePredicate {
                narrowed_to: match predicate.narrowed_type {
                    Some(ty) => Some(self.intern_type(ty)?),
                    None => None,
                },
                asserts: predicate.asserts,
            }),
            None => None,
        };
        let id = SignatureId(arena_index(self.snapshot.signatures.len())?);
        self.snapshot.signatures.push(SignatureRecord {
            parameters,
            return_type,
            type_parameters,
            is_construct: construct,
            type_predicate,
            this_type,
        });
        self.signatures.insert((signature, construct), id);
        Ok(id)
    }

    pub(super) fn capture_calls_and_constants(&mut self) -> Result<(), SnapshotError> {
        for index in 0..self.native_nodes.len() {
            let Some(node) = self.native_nodes[index] else {
                continue;
            };
            let id = NodeId(arena_index(index)?);
            let kind = self.snapshot.nodes[index].kind;
            if matches!(
                kind,
                NodeKind::Syntax(
                    syntax::CALL_EXPRESSION
                        | syntax::NEW_EXPRESSION
                        | syntax::TAGGED_TEMPLATE_EXPRESSION
                )
            ) && let Some(signature) = node.resolved_signature()
            {
                let callee = signature
                    .declaration()
                    .and_then(|node| self.nodes.get(&node).copied());
                let declaration = signature
                    .declaration()
                    .map(|node| self.declaration_site(node))
                    .transpose()?
                    .flatten();
                let signature = self.intern_signature(
                    signature,
                    kind == NodeKind::Syntax(syntax::NEW_EXPRESSION),
                )?;
                self.snapshot.call_targets.insert(
                    id,
                    CallTarget {
                        signature,
                        callee,
                        declaration,
                    },
                );
            }
            if matches!(
                kind,
                NodeKind::Syntax(syntax::ENUM_MEMBER | syntax::PROPERTY_ACCESS_EXPRESSION)
            ) {
                let constant = match node.constant() {
                    Some(native::Constant::Number(number)) => Some(ConstantValue::Number(number)),
                    Some(native::Constant::String(text)) => {
                        Some(ConstantValue::String(match text.utf8() {
                            Some(text) => text.into(),
                            None => nts_semantic_schema::JsText::from_utf16(text.utf16().to_vec()),
                        }))
                    }
                    None => None,
                };
                if let Some(constant) = constant {
                    self.snapshot.constants.insert(id, constant);
                }
            }
        }
        Ok(())
    }
}

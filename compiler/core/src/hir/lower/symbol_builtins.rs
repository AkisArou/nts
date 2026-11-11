//! Lower Symbol values, registry operations, and their methods.

use super::{Callee, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, ValueId};

impl FuncBuilder<'_> {
    /// `Symbol()` and `Symbol(description)`: a fresh identity every call.
    ///
    /// The description is optional and takes no part in what a symbol *is* --
    /// `Symbol("a") === Symbol("a")` is **false**, because each call allocates
    /// a cell and a symbol's identity is its address. So this is one
    /// allocation and nothing else, and the null description is the ordinary
    /// absent pointer rather than a second entry point.
    pub(super) fn lower_symbol_new(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let description = match arguments {
            [] => self.push(
                OpKind::ConstNull,
                HirType::Managed(ManagedType::String),
                origin.clone(),
            ),
            [only] => {
                let value = self.lower_expression(*only)?;
                if !matches!(
                    self.values[value.0 as usize].ty,
                    HirType::Managed(ManagedType::String)
                ) {
                    return Err(self.unsupported(id, "a `Symbol` description that is not a string"));
                }
                value
            }
            _ => {
                return Err(self.unsupported(id, "a `Symbol` of more than one argument"));
            }
        };
        Ok(self.call_runtime(
            "nts_symbol_new",
            vec![description],
            HirType::Managed(ManagedType::Symbol),
            &origin,
        ))
    }

    /// `Symbol.for(key)`, which is the interning half of the feature.
    pub(super) fn lower_symbol_for(
        &mut self,
        id: NodeId,
        argument: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let key = self.lower_expression(argument)?;
        if !matches!(
            self.values[key.0 as usize].ty,
            HirType::Managed(ManagedType::String)
        ) {
            return Err(self.unsupported(id, "a `Symbol.for` key that is not a string"));
        }
        let origin = self.origin(id);
        Ok(self.call_runtime(
            "nts_symbol_for",
            vec![key],
            HirType::Managed(ManagedType::Symbol),
            &origin,
        ))
    }

    /// `Symbol.keyFor(sym)`, whose answer is a string or `undefined`.
    ///
    /// The runtime answers with a null `NtsString *` for an unregistered
    /// symbol, which is the representation `string | undefined` already has --
    /// a pointer with one absent value -- so nothing is erased here.
    pub(super) fn lower_symbol_key_for(
        &mut self,
        id: NodeId,
        argument: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let symbol = self.lower_expression(argument)?;
        if !matches!(
            self.values[symbol.0 as usize].ty,
            HirType::Managed(ManagedType::Symbol)
        ) {
            return Err(self.unsupported(id, "a `Symbol.keyFor` of something that is not a symbol"));
        }
        let origin = self.origin(id);
        Ok(self.call_runtime(
            "nts_symbol_key_for",
            vec![symbol],
            HirType::Managed(ManagedType::String),
            &origin,
        ))
    }

    /// A symbol's `description`, which is a **member read** where `String(sym)`
    /// is a conversion — the same helper family, reached from the other side of
    /// the language.
    ///
    /// The ledger row for this said `nts_symbol_description` and
    /// `nts_symbol_to_string` "exist and are tested, and nothing lowers a member
    /// access to them yet", and that was exactly true: both are in `runtime/c`,
    /// in `hir::runtime`'s table and in LLVM's signatures already. So this and
    /// [`Self::symbol_method`] are the whole of the feature — no runtime surface
    /// to add, nothing to regenerate, no backend to red-gate while it catches up.
    ///
    /// `description` is `string | undefined` and the helper returns a
    /// possibly-null `NtsString *`, which is what this compiler already means by
    /// an absent string: `null` and `undefined` are one value in a compiled
    /// program. So the representation is a nullable managed string and
    /// `d === undefined` is the null test it already lowers.
    pub(super) fn symbol_property(
        &mut self,
        id: NodeId,
        value: ValueId,
        member_name: &str,
    ) -> Result<ValueId, Diagnostic> {
        if member_name != "description" {
            return Err(self.unsupported(
                id,
                &format!(
                    "`{member_name}` on a symbol, where `description` is the one member \
                     this compiler reads"
                ),
            ));
        }
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee: Callee::External("nts_symbol_description".to_owned()),
                args: vec![value],
                frame: None,
            },
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// `sym.toString()`, the other half of the same row.
    ///
    /// Named rather than left to fall through, because the refusal below it
    /// would read "`toString` on a symbol, which has no method table here" and
    /// a symbol *has* two methods the language defines. Saying it has no method
    /// table would send its reader to the wrong file.
    pub(super) fn symbol_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self.literal_name(member);
        if name.as_deref() != Some("toString") {
            let what = name.unwrap_or_else(|| "a computed member".to_owned());
            return Err(self.unsupported(
                id,
                &format!(
                    "`{what}()` on a symbol, where `toString` is the one method this \
                     compiler calls"
                ),
            ));
        }
        if !arguments.is_empty() {
            return Err(self.unsupported(id, "`toString()` on a symbol with an argument"));
        }
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee: Callee::External("nts_symbol_to_string".to_owned()),
                args: vec![receiver],
                frame: None,
            },
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }
}

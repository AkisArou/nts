//! `String.prototype.split`, with a string separator or with none.
//!
//! A regular expression, or any other object with a `@@split`, is a different
//! feature: the separator is refused by name rather than split on its text.

use super::{
    Diagnostic, FuncBuilder, HirType, ManagedType, MethodsOf, NodeId, OpKind, UnOp, ValueId,
};

impl FuncBuilder<'_> {
    /// `s.split(separator, limit)`.
    ///
    /// **An absent or `undefined` separator answers `[s]`** (ECMA-262
    /// `String.prototype.split`, step 9), built here as a one-element array,
    /// so every backend has it without a runtime entry of its own. Before this
    /// the separator went to `nts_str_split` unchecked: an absent one was
    /// padded with a number and an `undefined` one passed as an erased value,
    /// where the helper takes `const NtsString *`. C refused to compile the
    /// call; LLVM compiled it, and the helper read whatever pointer was left
    /// in the register (#932). The LLVM emitter does not yet check a helper's
    /// arguments against its declared signature (#944).
    ///
    /// Any other separator must be a string whose argument, as written, cannot
    /// be absent: the helper has no answer for a null pointer, and an erased
    /// value may be an object whose `@@split` decides the answer. The argument
    /// is read as written, after any assertion on it: `s!` and `s as string`
    /// are checked for presence where they are lowered, so the type they
    /// assert is the one the helper receives. What that check does not see --
    /// a `string` parameter handed an unchecked `undefined!` -- belongs to the
    /// non-null assertion's lowering, not this call (#948).
    pub(super) fn lower_string_split(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let string = HirType::Managed(ManagedType::String);
        let ty = HirType::Managed(ManagedType::Array(Box::new(string)));
        let mut args = vec![receiver];
        self.lower_method_arguments(id, (MethodsOf::String, "split"), arguments, &mut args)?;
        if args.len() > 3 {
            return Err(self.unsupported(id, "a string method with this many arguments"));
        }
        let origin = self.origin(id);
        // A constant `null` separator is split on, as its `ToString`: `"null"`.
        if let Some(separator) = args.get_mut(1)
            && matches!(self.values[separator.0 as usize].kind, OpKind::ConstNull)
        {
            *separator = self.push(
                OpKind::ConstString("null".into()),
                HirType::Managed(ManagedType::String),
                origin.clone(),
            );
        }
        let whole = match (arguments.first(), args.get(1)) {
            (Some(&node), Some(&separator))
                if !matches!(
                    self.values[separator.0 as usize].kind,
                    OpKind::ConstUndefined
                ) =>
            {
                let Some(separator) = self.string_payload(separator).filter(|&separator| {
                    matches!(
                        self.values[separator.0 as usize].kind,
                        OpKind::ConstString(_)
                    ) || self
                        .absences_of(self.through_parentheses(node))
                        .is_some_and(|absent| absent.is_empty())
                }) else {
                    return Err(self.unsupported(
                        node,
                        "a `split` separator that is not a string or `undefined`",
                    ));
                };
                self.runtime_call(
                    "nts_str_split",
                    vec![receiver, separator],
                    ty.clone(),
                    origin.clone(),
                )
            }
            _ => self.array_from_values(id, vec![(id, receiver)], &ty)?,
        };
        let Some(&limit) = args.get(2) else {
            return Ok(whole);
        };

        // **The limit truncates the whole split.** Exact for a string
        // separator, or none: the specification stops early and a truncation
        // of the whole result is the same list, because a separator that is not
        // a regular expression cannot make the earlier elements depend on how
        // many are wanted. A zero limit keeps nothing (step 8), even of `[s]`.
        //
        // The limit goes through `ToUint32` first, and that is not decoration.
        // `split(",", -1)` means *no* limit -- `ToUint32(-1)` is 4294967295 --
        // while slicing to `-1` counts from the end and would drop the last
        // element.
        //
        // `UnOp::ToUint32` and not the `>>> 0` that spells it in source. The
        // idiom is two operands and a coercion on each, which the binary path
        // inserts and a hand-built op does not: writing the shift here gave
        // LLVM a raw double where it wanted a converted one, and `-1` came back
        // as a negative index that dropped the last element. The operation the
        // specification names is the one op this needs.
        let limit = self.push(
            OpKind::Unary {
                op: UnOp::ToUint32,
                operand: limit,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let from = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        Ok(self.runtime_call("nts_array_slice_ref", vec![whole, from, limit], ty, origin))
    }
}

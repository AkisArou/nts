//! String searches and relative indexing share the source argument boundary.
//!
//! Evaluate every argument before converting the position. The numeric builtin
//! catalog owns explicit `undefined`; omission selects the original helper.
//! Runtime helpers then apply `ToIntegerOrInfinity` and UTF-16 length clamping.

use super::{
    Diagnostic, FuncBuilder, HirType, ManagedType, MethodsOf, NodeId, NumericBuiltin, ValueId,
};

impl FuncBuilder<'_> {
    pub(super) fn lower_positioned_string_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        name: &str,
        arguments: &[NodeId],
    ) -> Result<Option<ValueId>, Diagnostic> {
        let (plain, positioned, ty) = match name {
            "indexOf" => ("nts_str_index_of", "nts_str_index_of_from", HirType::NUMBER),
            "lastIndexOf" => (
                "nts_str_last_index_of",
                "nts_str_last_index_of_from",
                HirType::NUMBER,
            ),
            "includes" => ("nts_str_includes", "nts_str_includes_from", HirType::Bool),
            "startsWith" => (
                "nts_str_starts_with",
                "nts_str_starts_with_at",
                HirType::Bool,
            ),
            "endsWith" => ("nts_str_ends_with", "nts_str_ends_with_at", HirType::Bool),
            "at" => (
                "nts_str_relative_at",
                "nts_str_relative_at",
                HirType::Managed(ManagedType::String),
            ),
            _ => return Ok(None),
        };
        let values = self.builtin_raw_arguments(
            NumericBuiltin::Method(MethodsOf::String, name),
            arguments,
            Some(if name == "at" { 1 } else { 2 }),
        )?;
        let mut args = vec![receiver];
        let position = if name == "at" {
            0
        } else {
            let Some(needle) = values.first() else {
                return Err(
                    self.unsupported(id, "a search with no argument, which looks for `undefined`")
                );
            };
            // Widening to any does not change an existing string payload.
            // Recovery establishes only representation: admission below still
            // checks the source's absences, independently of the erasure flag.
            let string = HirType::Managed(ManagedType::String);
            let needle = match self.values[needle.0 as usize].kind {
                super::OpKind::Erase {
                    value,
                    absent: super::Absent::Impossible,
                    ..
                } if self.values[value.0 as usize].ty == string => value,
                _ => *needle,
            };
            let source = self.through_parentheses(arguments[0]);
            let checked = super::assertions::checks_erased_primitive(self, source, &string);
            let source = if checked {
                source
            } else {
                self.through_assertions(source)
            };
            // The explicit String(value) printer also accepts Symbol, so it
            // cannot implement this builtin's implicit ToString conversion.
            if self.values[needle.0 as usize].ty != string
                || !self
                    .absences_of(source)
                    .is_some_and(|absent| absent.is_empty())
            {
                return Err(self.unsupported(
                    arguments[0],
                    "a string search needle without a known non-null string representation",
                ));
            }
            args.push(needle);
            1
        };
        let helper = if let Some(value) = values.get(position) {
            let value = self.builtin_number_argument(
                (id, arguments[position]),
                NumericBuiltin::Method(MethodsOf::String, name),
                position + 1,
                *value,
            )?;
            args.push(value);
            positioned
        } else if name == "at" {
            args.push(self.push(
                super::OpKind::ConstFloat(0.0),
                HirType::NUMBER,
                self.origin(id),
            ));
            plain
        } else {
            plain
        };
        Ok(Some(self.runtime_call(helper, args, ty, self.origin(id))))
    }
}

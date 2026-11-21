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
            let Some(needle) = self.proven_string(arguments[0], *needle) else {
                return Err(self.unsupported(
                    arguments[0],
                    "a string search needle without a known non-null string representation",
                ));
            };
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

    /// `value`, the lowered `argument`, as a string the runtime may read: one
    /// whose representation is a string and whose source cannot be absent.
    ///
    /// A string helper reads its string parameters through `const NtsString *`
    /// and has no answer for a null one, so anything less is `None` and the
    /// caller refuses by name. Recovery establishes only representation: the
    /// source's absences are read independently of the erasure flag, under
    /// any assertion unless that assertion is an erased-to-string check. The
    /// explicit `String(value)` printer also accepts Symbol, so it cannot
    /// stand in for a builtin's implicit `ToString`.
    pub(super) fn proven_string(&self, argument: NodeId, value: ValueId) -> Option<ValueId> {
        let value = self.string_payload(value)?;
        let string = HirType::Managed(ManagedType::String);
        let source = self.through_parentheses(argument);
        let source = if super::assertions::checks_erased_primitive(self, source, &string) {
            source
        } else {
            self.through_assertions(source)
        };
        self.absences_of(source)
            .is_some_and(|absent| absent.is_empty())
            .then_some(value)
    }

    /// `value` where its representation is a string. Widening to any does not
    /// change an existing string payload, so an `Erase` of a string is looked
    /// through.
    pub(super) fn string_payload(&self, value: ValueId) -> Option<ValueId> {
        let string = HirType::Managed(ManagedType::String);
        let value = match self.values[value.0 as usize].kind {
            super::OpKind::Erase {
                value,
                absent: super::Absent::Impossible,
                ..
            } if self.values[value.0 as usize].ty == string => value,
            _ => value,
        };
        (self.values[value.0 as usize].ty == string).then_some(value)
    }
}

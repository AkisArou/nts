//! Construct and call methods on the supplied Date representation.

use super::{Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, ValueId};

impl FuncBuilder<'_> {
    /// `new Date(ms)`.
    ///
    /// One argument and one allocation. The normalisation the specification
    /// calls `TimeClip` -- truncate toward zero, NaN outside +/-8.64e15 -- is
    /// the runtime's, done once at construction rather than at every read,
    /// because it is observable: `new Date(1.5).getTime()` is 1.
    ///
    /// **`new Date()` with no argument is refused**, and so is `Date.now()`.
    /// Both read a wall clock this runtime has no capability for, and neither
    /// could be checked if it did: the differential compares against node, and
    /// node would answer with its instant and this with a later one. That is
    /// the same reason `Math.random` is absent -- "the one member of the family
    /// no differential can check".
    pub(super) fn lower_new_date(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let arguments = self.arguments_of(id);
        let [only] = arguments.as_slice() else {
            return Err(self.unsupported(
                id,
                "a `new Date` with no argument, which reads a clock this compiler has no \
                 capability for and no differential could check",
            ));
        };
        let ms = self.lower_expression(*only)?;
        let ms = self.coerce(ms, &HirType::NUMBER, id)?;
        let origin = self.origin(id);
        Ok(self.call_runtime(
            "nts_date_new",
            vec![ms],
            HirType::Managed(ManagedType::Date),
            &origin,
        ))
    }

    pub(super) fn lower_date_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self
            .literal_name(member)
            .ok_or_else(|| self.unsupported(id, "a `Date` member the program computes"))?;
        if !arguments.is_empty() {
            return Err(self.unsupported(id, &format!("a `Date.{name}` with arguments")));
        }
        let origin = self.origin(id);
        match name.as_str() {
            "getTime" | "valueOf" => {
                Ok(self.call_runtime("nts_date_value", vec![receiver], HirType::NUMBER, &origin))
            }
            // Refused, and the reason is the oracle rather than the calendar.
            // `new Date(NaN).toISOString()` **throws a RangeError** in node,
            // and this compiler has no throw to give from a runtime helper --
            // so it would answer with a string where node raises, and the
            // differential cannot see that: it scores node's throw as a case
            // not reached rather than as a disagreement. A silent divergence
            // the oracle is blind to is the worst outcome available, so this is
            // refused until a helper can throw.
            //
            // Both call sites in `runtime/node` already guard it --
            // `Number.isNaN(d.getTime()) ? "Invalid Date" : d.toISOString()` --
            // and the guard is on the *value*, which the lowering cannot see.
            "toISOString" => Err(self.unsupported(
                id,
                "`Date.toISOString`, which throws a RangeError on an invalid date -- a \
                 runtime helper here has no way to throw, and answering with a string \
                 instead is a divergence the differential cannot see",
            )),
            // Named individually so the message says which family it is in.
            "getFullYear" | "getMonth" | "getDate" | "getHours" | "getMinutes" | "getSeconds"
            | "getMilliseconds" | "getDay" | "getTimezoneOffset" => Err(self.unsupported(
                id,
                &format!(
                    "`Date.{name}`, which reads a *local* calendar -- that needs a timezone \
                         database this compiler does not carry, and would make one program \
                         answer differently on two machines"
                ),
            )),
            _ => Err(self.unsupported(id, &format!("`Date.{name}`"))),
        }
    }
}

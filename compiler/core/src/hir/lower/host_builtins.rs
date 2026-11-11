//! Lower console inspection and timers into the supplied runtime operations.

use super::{
    Absent, BinOp, Branch, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, TypeKind,
    ValueId, syntax,
};

impl FuncBuilder<'_> {
    /// Whether `callee` is a member of the global `console` this compiler
    /// provides, and if so whether it writes to stderr: `log`, `info` and
    /// `debug` write to stdout, `error` and `warn` to stderr, as node's do.
    ///
    /// The library's `console`, which nothing compiled declares. A program's
    /// own binding of that name, such as an import, is the program's.
    /// `console.trace` prints a stack, and `console.table` and `console.dir`
    /// inspect structure, so they stay refused.
    pub(super) fn console_method(&self, callee: NodeId) -> Option<bool> {
        let (object, member) = self.member_access(callee)?;
        if self.kind_of(object) != Some(syntax::IDENTIFIER)
            || self
                .node(object)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                != Some("console")
        {
            return None;
        }
        let global = self
            .node(object)
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .is_some_and(|record| record.declarations.is_empty());
        if !global {
            return None;
        }
        match member.as_str() {
            "log" | "info" | "debug" => Some(false),
            "error" | "warn" => Some(true),
            _ => None,
        }
    }

    /// `console.log(a, b)`: each argument spelled as node's `util.inspect`
    /// spells it at the top level, joined by a space, and written with a
    /// newline by `nts_console_write`.
    ///
    /// The spelling is `String(v)` with two corrections, `-0` and `10n`.
    /// An object is refused: node prints its structure, with depth and
    /// colour rules, and a placeholder would look like it works. So is a
    /// first argument that can hold a `%` directive when others follow it,
    /// which node substitutes from them (`console.log("%d items", n)`). A
    /// literal with no `%` is spelled as written.
    ///
    /// Written with the program's other output in the order it happens, and
    /// with no promise about output the program makes some other way, such as
    /// a C `printf` holding its own buffer.
    pub(super) fn lower_console(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        to_stderr: bool,
    ) -> Result<ValueId, Diagnostic> {
        let text = HirType::Managed(ManagedType::String);
        if arguments.len() > 1
            && let Some(first) = arguments.first()
            && self.may_format(*first)
        {
            return Err(self.unsupported(
                *first,
                "a first argument of `console.log` that can hold a `%` directive, which node substitutes from the arguments after it",
            ));
        }
        let mut line = None;
        for (at, argument) in arguments.iter().enumerate() {
            if self.kind_of(*argument) == Some(syntax::SPREAD_ELEMENT) {
                return Err(self.unsupported(*argument, "a spread argument of `console.log`"));
            }
            // `null` and `undefined` as written, which have no value to lower.
            let spelled = if let Some(absent) = self.absence_written_at(*argument) {
                let origin = self.origin(*argument);
                let word = if absent == crate::hir::tags::NULL {
                    "null"
                } else {
                    "undefined"
                };
                self.push(
                    OpKind::ConstString(word.to_owned().into()),
                    text.clone(),
                    origin,
                )
            } else {
                let value = self.lower_expression(*argument)?;
                self.inspected(*argument, value)?
            };
            if at > 0 {
                let origin = self.origin(*argument);
                let space = self.push(OpKind::ConstString(" ".into()), text.clone(), origin);
                line = Some(self.join(*argument, line, space, &text));
            }
            line = Some(self.join(*argument, line, spelled, &text));
        }
        let origin = self.origin(id);
        let line = match line {
            Some(line) => line,
            None => self.push(OpKind::ConstString("".into()), text, origin.clone()),
        };
        let stream = self.push(OpKind::ConstBool(to_stderr), HirType::Bool, origin.clone());
        Ok(self.runtime_call(
            "nts_console_write",
            vec![line, stream],
            HirType::Void,
            origin,
        ))
    }

    /// Whether a first argument of `console.log` could hold a `%` directive:
    /// a literal that has one, a template with one in its text or in a
    /// substitution that could hold one, or a value whose type admits a
    /// string that is not a literal without one.
    fn may_format(&self, node: NodeId) -> bool {
        match self.kind_of(node) {
            Some(
                syntax::STRING_LITERAL
                | syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL
                | syntax::TEMPLATE_HEAD
                | syntax::TEMPLATE_MIDDLE
                | syntax::TEMPLATE_TAIL,
            ) => {
                return self
                    .node(node)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .is_some_and(|written| written.contains('%'));
            }
            Some(
                syntax::TEMPLATE_EXPRESSION
                | syntax::TEMPLATE_SPAN
                | syntax::PARENTHESIZED_EXPRESSION,
            ) => {
                return self
                    .children(node)
                    .into_iter()
                    .any(|part| self.may_format(part));
            }
            _ => {}
        }
        let Some(ty) = self.snapshot.node_types.get(&node) else {
            return true;
        };
        let members = match self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Union(members)) => members.clone(),
            _ => vec![*ty],
        };
        members.iter().any(|member| {
            match self
                .snapshot
                .types
                .get(member.0 as usize)
                .map(|record| &record.kind)
            {
                Some(TypeKind::Literal(nts_semantic_schema::LiteralValue::String(value))) => {
                    value.encode_utf16().any(|unit| unit == u16::from(b'%'))
                }
                Some(
                    TypeKind::Number
                    | TypeKind::Boolean
                    | TypeKind::BigInt
                    | TypeKind::Null
                    | TypeKind::Undefined
                    | TypeKind::Void
                    | TypeKind::Symbol
                    | TypeKind::UniqueSymbol
                    | TypeKind::Literal(_),
                ) => false,
                _ => true,
            }
        })
    }

    /// One argument of `console.log`, spelled as node's `util.inspect`
    /// spells it at the top level: a string as itself, and a primitive as
    /// `String` spells it, except that negative zero is `-0` and a bigint
    /// ends in `n`.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn inspected(&mut self, from: NodeId, value: ValueId) -> Result<ValueId, Diagnostic> {
        let text = HirType::Managed(ManagedType::String);
        // `undefined` is spelled by what it is, not by the type it was given:
        // `void expr` takes its context's type (`lower_void`), so as the first
        // argument of a `log(message: string, ...)` it is a string-typed
        // constant, and no arm below would read it as `undefined`.
        if matches!(self.values[value.0 as usize].kind, OpKind::ConstUndefined)
            || self.values[value.0 as usize].ty == HirType::Void
        {
            let origin = self.origin(from);
            return Ok(self.push(OpKind::ConstString("undefined".into()), text, origin));
        }
        match self.values[value.0 as usize].ty {
            HirType::Float { .. } => {
                let spelled = self.as_string(from, value)?;
                let origin = self.origin(from);
                let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
                let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
                let minus = self.push(
                    OpKind::ConstString("-0".into()),
                    text.clone(),
                    origin.clone(),
                );
                // `x === 0`, then which zero by its reciprocal's sign: `1/x`
                // alone is `-Infinity` for a subnormal too.
                let is_zero = self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: value,
                        rhs: zero,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                let inverse = self.push(
                    OpKind::Binary {
                        op: BinOp::Div,
                        lhs: one,
                        rhs: value,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                );
                let negative = self.push(
                    OpKind::Binary {
                        op: BinOp::Lt,
                        lhs: inverse,
                        rhs: zero,
                    },
                    HirType::Bool,
                    origin,
                );
                let zero_spelled = self.lower_branching_value_at(
                    from,
                    text.clone(),
                    negative,
                    Branch::Value(minus),
                    Branch::Value(spelled),
                )?;
                self.lower_branching_value_at(
                    from,
                    text,
                    is_zero,
                    Branch::Value(zero_spelled),
                    Branch::Value(spelled),
                )
            }
            HirType::BigInt => {
                let spelled = self.as_string(from, value)?;
                let origin = self.origin(from);
                let suffix = self.push(OpKind::ConstString("n".into()), text.clone(), origin);
                Ok(self.join(from, Some(spelled), suffix, &text))
            }
            HirType::Erased if self.spells_itself(from) => {
                let origin = self.origin(from);
                Ok(self.runtime_call("nts_value_inspect", vec![value], text, origin))
            }
            // **An `unknown` erased right here from a primitive is that
            // primitive.** `const value: unknown = n; console.log(value)` is an
            // `Erase` of a number in this function: what node prints is decided
            // by the operand, which is known. Only where the erase carries no
            // absence -- one that can be `null` or `undefined` is the runtime's
            // question again -- and only for what the arms below spell.
            HirType::Erased
                if let OpKind::Erase {
                    value: inner,
                    absent: Absent::Impossible,
                    ..
                } = self.values[value.0 as usize].kind
                    && matches!(
                        self.values[inner.0 as usize].ty,
                        HirType::Float { .. }
                            | HirType::Int { .. }
                            | HirType::Bool
                            | HirType::BigInt
                            | HirType::Managed(ManagedType::String | ManagedType::Symbol)
                    ) =>
            {
                self.inspected(from, inner)
            }

            HirType::Int { .. }
            | HirType::Bool
            | HirType::Managed(ManagedType::String | ManagedType::Symbol) => {
                self.as_string(from, value)
            }
            _ => {
                let named = self.describe_node(from);
                Err(self.unsupported(
                    from,
                    &format!(
                        "`console.log` of {named}, which node prints by inspecting its structure"
                    ),
                ))
            }
        }
    }

    /// `setTimeout(fn, ms)` and `setInterval(fn, ms)`.
    ///
    /// A *capability* over the host's `post_delayed` rather than part of the
    /// host contract, so both hosts have it and neither implements it -- which
    /// is what makes a `setTimeout` ordering testable against node, because the
    /// deterministic host runs the same code the libuv one does.
    ///
    /// The callback is a closure, and a closure in this compiler is an object
    /// with a method table, so the runtime is handed the object *and* the slot
    /// its call occupies. One slot serves every closure: what makes that safe
    /// is that the caller spells the signature, and a timer callback has one.
    pub(super) fn lower_set_timer(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        repeating: bool,
    ) -> Result<ValueId, Diagnostic> {
        let (callback, delay) = match arguments {
            [callback] => (*callback, None),
            [callback, delay] => (*callback, Some(*delay)),
            // `setTimeout(fn, ms, a, b)` forwards the extra arguments to the
            // callback. That is a different shape rather than a longer one:
            // the callback's signature stops being "takes nothing", and the
            // arguments have to outlive the call in something.
            _ => return Err(self.unsupported(id, "a timer that forwards arguments")),
        };
        // `@types/node` types this `NodeJS.Timeout`, an object with `unref`.
        // The default library says `number`, which is what the runtime returns,
        // and guessing across that difference would hand a program an object it
        // could not use.
        let returns = self.type_of(id).unwrap_or(HirType::Void);
        if !matches!(returns, HirType::Float { .. } | HirType::Int { .. }) {
            return Err(self.unsupported(id, "a timer whose id is not a number"));
        }
        let closure = self.lower_expression(callback)?;
        if !matches!(
            self.values[closure.0 as usize].ty,
            HirType::Managed(ManagedType::Object(_))
        ) {
            return Err(self.unsupported(id, "a timer callback that is not a function"));
        }
        let Some(slot) = self.hierarchy.closure_slot else {
            return Err(self.unsupported(id, "a timer in a program with no closures"));
        };
        let origin = self.origin(id);
        let slot = self.push(OpKind::DispatchSlot(slot), HirType::NUMBER, origin.clone());
        let delay = match delay {
            Some(node) => self.lower_expression(node)?,
            // `setTimeout(fn)` is `setTimeout(fn, 0)`.
            None => self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone()),
        };
        let repeating = self.push(OpKind::ConstBool(repeating), HirType::Bool, origin.clone());
        Ok(self.runtime_call(
            "nts_set_timeout",
            vec![closure, slot, delay, repeating],
            returns,
            origin,
        ))
    }

    /// `clearTimeout(id)` and `clearInterval(id)`, which are one operation.
    ///
    /// Clearing a timer that already fired is legal and does nothing, so this
    /// needs no test for whether the id is live -- the host's table knows, and
    /// it is the only thing that can.
    pub(super) fn lower_clear_timer(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let [timer] = arguments else {
            // `clearTimeout()` with no argument is legal and does nothing, but
            // it is also never what a program means.
            return Err(self.unsupported(id, "a `clearTimeout` with no timer"));
        };
        let timer = self.lower_expression(*timer)?;
        let origin = self.origin(id);
        Ok(self.runtime_call("nts_clear_timeout", vec![timer], HirType::Void, origin))
    }
}

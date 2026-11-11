//! Lower strings, string conversion and printing requests, and template literals and methods.

use super::{
    Absent, Argument, BinOp, Branch, Callee, Diagnostic, FuncBuilder, HirType, ManagedType,
    MethodsOf, NodeId, OpKind, Origin, Terminator, TypeId, TypeKind, UnOp, ValueId, access,
    claimed_reads, printed, syntax,
};

impl FuncBuilder<'_> {
    /// Cooked literal pieces and substitutions in source order. An empty piece
    /// is a real string; raw-string access remains a separate named boundary.
    fn template_cooked(&self, token: NodeId) -> Result<nts_semantic_schema::JsText, Diagnostic> {
        self.node(token).text.clone().ok_or_else(|| {
            self.unsupported(
                token,
                "a tagged template with an undefined cooked entry from an invalid escape",
            )
        })
    }

    fn template_parts(
        &mut self,
        template: NodeId,
    ) -> Result<(Vec<nts_semantic_schema::JsText>, Vec<NodeId>), Diagnostic> {
        let mut pieces = Vec::new();
        let mut substitutions: Vec<NodeId> = Vec::new();
        match self.kind_of(template) {
            Some(syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL) => {
                pieces.push(self.template_cooked(template)?);
            }
            Some(syntax::TEMPLATE_EXPRESSION) => {
                for part in self.children(template) {
                    match self.kind_of(part) {
                        Some(syntax::TEMPLATE_HEAD) => {
                            pieces.push(self.template_cooked(part)?);
                        }
                        Some(syntax::TEMPLATE_SPAN) => {
                            let inner = self.children(part);
                            let [expression, literal] = inner.as_slice() else {
                                return Err(
                                    self.unsupported(part, "a template span of unexpected shape")
                                );
                            };
                            substitutions.push(*expression);
                            pieces.push(self.template_cooked(*literal)?);
                        }
                        _ => {
                            return Err(
                                self.unsupported(part, "a template part of unexpected shape")
                            );
                        }
                    }
                }
            }
            _ => return Err(self.unsupported(template, "a tagged template over this literal")),
        }
        Ok((pieces, substitutions))
    }

    pub(super) fn lower_tagged_template(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let [tag, template] = children.as_slice() else {
            return Err(self.unsupported(id, "a tagged template of unexpected shape"));
        };
        let (tag, template) = (*tag, *template);
        self.a_raising_body_carries_this_call(id)?;
        let target = self
            .snapshot
            .call_targets
            .get(&id)
            .copied()
            .ok_or_else(|| self.unresolved_call(id))?;
        let declaration = self
            .direct_callee(target.callee, tag)
            .filter(|declaration| {
                self.kind_of(*declaration) == Some(syntax::FUNCTION_DECLARATION)
                    && self.defines(*declaration)
            })
            .filter(|_| {
                !self
                    .node(tag)
                    .symbol
                    .is_some_and(|symbol| self.bindings.contains_key(&symbol.0))
            })
            .ok_or_else(|| {
                self.unsupported(
                    id,
                    "a tagged template whose tag is not a plain declared function",
                )
            })?;

        let (pieces, substitutions) = self.template_parts(template)?;

        let origin = self.origin(id);
        let strings = self.push(
            OpKind::ConstTemplate {
                site: id.0,
                cooked: pieces,
            },
            HirType::Managed(ManagedType::Template),
            origin,
        );

        let arguments: Vec<Argument> = std::iter::once(Argument {
            node: template,
            value: Some(strings),
        })
        .chain(substitutions.into_iter().map(Argument::expression))
        .collect();
        let args = self.lower_argument_values(id, &arguments, None, None)?;
        let name = self.emitted_callee_name(Some(declaration), tag)?;
        let specialization = self.calls.suffix(id).map_or("", String::as_str);
        let name = format!("{name}{specialization}{}", self.raising_suffix_of(id));
        self.push_call(id, Callee::Direct(name), args, Some(declaration), None)
    }

    pub(super) fn lower_template(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let text = HirType::Managed(ManagedType::String);
        let mut result: Option<ValueId> = None;

        for part in self.children(id) {
            match self.kind_of(part) {
                Some(syntax::TEMPLATE_HEAD) => {
                    let literal = self.node(part).text.clone().unwrap_or_default();
                    if !literal.is_empty() {
                        let origin = self.origin(part);
                        result =
                            Some(self.push(OpKind::ConstString(literal), text.clone(), origin));
                    }
                }
                Some(syntax::TEMPLATE_SPAN) => {
                    let pieces = self.children(part);
                    let [expression, literal] = pieces.as_slice() else {
                        return Err(self.unsupported(part, "a template span of unexpected shape"));
                    };
                    let value = self.lower_expression(*expression)?;
                    let value = self.as_string(*expression, value)?;
                    result = Some(self.join(part, result, value, &text));

                    let literal_text = self.node(*literal).text.clone().unwrap_or_default();
                    if !literal_text.is_empty() {
                        let origin = self.origin(*literal);
                        let piece =
                            self.push(OpKind::ConstString(literal_text), text.clone(), origin);
                        result = Some(self.join(part, result, piece, &text));
                    }
                }
                _ => return Err(self.unsupported(part, "a template part of unexpected shape")),
            }
        }

        // `` `` `` has no parts at all, and a template of empty ones reduces to
        // the same nothing. Both are the empty string.
        if let Some(value) = result {
            return Ok(value);
        }
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstString("".into()), text, origin))
    }

    /// Concatenate onto what a template has built so far, or start it.
    pub(super) fn join(
        &mut self,
        at: NodeId,
        left: Option<ValueId>,
        right: ValueId,
        text: &HirType,
    ) -> ValueId {
        let Some(left) = left else {
            return right;
        };
        let origin = self.origin(at);
        self.push(
            OpKind::Binary {
                op: BinOp::Concat,
                lhs: left,
                rhs: right,
            },
            text.clone(),
            origin,
        )
    }

    pub(super) fn implicit_printer_callees(&self, node: NodeId) -> Vec<NodeId> {
        self.printers
            .at(node)
            .iter()
            .filter_map(|at| {
                let target = &self.printers.targets[*at];
                self.throwing
                    .contains(&target.symbol)
                    .then_some(target.declaration)
            })
            .collect()
    }

    /// A descriptor callback returns NULL with the original payload pending.
    /// This language boundary takes it exactly once and uses the ordinary
    /// throw path, including finally and an uncaught ordinary caller. Runtime
    /// forwarders never take it; `emit_the_raise_test`'s no-handler return is
    /// insufficient here because this function need not be a raising copy.
    pub(super) fn printer_text(
        &mut self,
        from: NodeId,
        value: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let mut represented = value;
        while let OpKind::Erase { value: inner, .. } = self.values[represented.0 as usize].kind {
            represented = inner;
        }
        let candidates =
            self.printers
                .for_conversion(self, from, &self.values[represented.0 as usize].ty);
        let entries = self.printers.raising_entries(&candidates, self.throwing);
        let origin = self.origin(from);
        let text = self.runtime_call(
            "nts_value_to_string",
            vec![value],
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        if !entries.is_empty() {
            let flag_type = HirType::Int {
                bits: 32,
                signed: true,
            };
            let flag =
                self.runtime_call("nts_raising", Vec::new(), flag_type.clone(), origin.clone());
            self.arrivals.pending_printer_checks.push(printed::Check {
                function: String::new(),
                flag,
                entries,
            });
            let zero = self.push(OpKind::ConstInt(0), flag_type, origin.clone());
            let raised = self.push(
                OpKind::Binary {
                    op: BinOp::Ne,
                    lhs: flag,
                    rhs: zero,
                },
                HirType::Bool,
                origin.clone(),
            );
            let took = self.new_block();
            let carry_on = self.new_block();
            self.terminate(Terminator::Branch {
                cond: raised,
                then_target: took,
                then_args: Vec::new(),
                else_target: carry_on,
                else_args: Vec::new(),
            });
            self.switch_to(took);
            self.lower_arm(|this| {
                let thrown =
                    this.runtime_call("nts_raise_take", Vec::new(), HirType::Erased, origin);
                this.throw_erased(from, thrown, thrown, &HirType::Erased)
            })?;
            self.switch_to(carry_on);
        }
        Ok(text)
    }

    pub(super) fn as_string(
        &mut self,
        from: NodeId,
        value: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let text = HirType::Managed(ManagedType::String);
        match self.values[value.0 as usize].ty {
            // A `string | null` is one pointer and the null in it is not a
            // string. Passing it through handed the concatenation a null
            // pointer, and the program aborted on the first thing that read it
            // -- which the differential reports as a *declined* case rather
            // than a disagreement, so "agreed on every case" was counting only
            // the runs that reached the end.
            //
            // `String(null)` is "null" and `String(undefined)` is "undefined".
            // Which one is a property of the type, exactly as it is for `===`.
            HirType::Managed(ManagedType::String)
                if matches!(self.absences_of(from).as_deref(), Some([_])) =>
            {
                let absent = self.absences_of(from).unwrap_or_default();
                let spelling = if absent.first() == Some(&crate::hir::tags::NULL) {
                    "null"
                } else {
                    "undefined"
                };
                let origin = self.origin(from);
                let when_absent = self.push(
                    OpKind::ConstString(spelling.to_owned().into()),
                    text,
                    origin,
                );
                // The type is that absence and nothing else -- what the checker
                // leaves a binding at after `v = null`. There is no branch to
                // build, and trying to build one asked for the representation
                // of `null`, which there is none of.
                if self.only_absences(from) {
                    return Ok(when_absent);
                }
                let Some(condition) = self.absence_of(from, value) else {
                    return Ok(value);
                };
                self.lower_branching_value(
                    from,
                    condition,
                    Branch::Value(when_absent),
                    Branch::Value(value),
                )
            }
            HirType::Managed(ManagedType::String) => Ok(value),
            // An erased value carries the tag that says which spelling it
            // wants, and the runtime spells every one: a primitive as itself,
            // an object or a function as its type says, off its descriptor
            // (`Program::printed`), and a tuple or a `Date` by a refusal naming
            // it. So `String(unknown)` converts, and what the value turns out
            // to be decides the text, as in node.
            //
            // `String(xs.pop())` -- `number | undefined` -- is the absent answer
            // surviving the conversion, which a typed `double` could not carry.
            HirType::Erased => self.printer_text(from, value),
            // A `bool` and a `bigint` each have an exact spelling of their
            // own: two words, and decimal with no exponent however large.
            // Neither is something a double's formatter can be handed.
            HirType::Float { .. } | HirType::Int { .. } | HirType::Bool | HirType::BigInt => {
                let helper = match self.values[value.0 as usize].ty {
                    HirType::Bool => "nts_bool_to_string",
                    HirType::BigInt => "nts_bigint_to_string",
                    _ => "nts_number_to_string",
                };
                let origin = self.origin(from);
                Ok(self.push(
                    OpKind::Call {
                        callee: Callee::External(helper.to_owned()),
                        args: vec![value],
                        frame: None,
                    },
                    text,
                    origin,
                ))
            }
            // `String(sym)` is `SymbolDescriptiveString` -- `"Symbol("`, the
            // description, `")"` -- and it is the one conversion the language
            // *only* allows through `String`: `sym + ""` throws a `TypeError`
            // by 13.15.3, which is why this arm exists and no implicit
            // coercion reaches it.
            //
            // `nts_symbol_to_string` already exists in all three backends --
            // the C runtime, `hir::runtime`'s table, LLVM's signatures and the
            // JVM's `ops` -- so this arm is the whole of the feature. It was
            // reached the moment `typeof v === "symbol"` on an `unknown`
            // stopped being refused, which is `determineSpecificType`'s next
            // link in `runtime/node/internal/errors.ts`.
            // **A class's own `toString`.** `${o}`, `"" + o` and `String(o)`
            // all convert through it -- `ToPrimitive` with hint string calls
            // it -- so the receiver's class decides what the conversion means,
            // and where the static type declares one the conversion is a
            // direct call. An object whose chain declares none prints
            // `"[object Object]"`, through the arm below. That used to be
            // refused, on the argument that eight constant characters would
            // make a missing method look like a working one; but it is what
            // node prints, and a compiler that differs from node to warn about
            // a program's design is the wrong place for the warning.
            HirType::Managed(ManagedType::Symbol) => {
                let origin = self.origin(from);
                Ok(self.push(
                    OpKind::Call {
                        callee: Callee::External("nts_symbol_to_string".to_owned()),
                        args: vec![value],
                        frame: None,
                    },
                    text,
                    origin,
                ))
            }
            // **Any other object prints as its type says**, read off its
            // descriptor at run time (`Program::printed`): `"[object Object]"`
            // for one whose chain adds nothing, the error rule for an `Error`,
            // the elements joined for an array, `"[object Map]"` and its kin.
            // Through the conversion an erased value takes, so a typed object
            // and the same object erased cannot print differently.
            HirType::Managed(_) if self.prints_off_its_descriptor(value) => {
                let erased = self.coerce(value, &HirType::Erased, from)?;
                self.printer_text(from, erased)
            }
            _ => {
                let named = self.describe_node(from);
                Err(self.unsupported(from, &format!("a conversion to string from {named}")))
            }
        }
    }

    /// Whether a typed object converts to a string through its descriptor, as
    /// an erased one does: every object but those the type proves the runtime
    /// would refuse, which are refused here instead -- a `Date`, whose text
    /// depends on the time zone, and a tuple, which is laid out as a record and
    /// not as the array node joins.
    fn prints_off_its_descriptor(&self, value: ValueId) -> bool {
        match &self.values[value.0 as usize].ty {
            HirType::Managed(ManagedType::Date) => false,
            HirType::Managed(ManagedType::Object(ty)) => !matches!(
                self.snapshot
                    .types
                    .get(ty.0 as usize)
                    .map(|record| &record.kind),
                Some(TypeKind::Tuple(_))
            ),
            HirType::Managed(_) => true,
            _ => false,
        }
    }

    /// Whether every member of a node's type prints the same under `String()`
    /// and `util.inspect`, which `console.log` uses: a number, a string, a
    /// boolean, a bigint, a symbol, `null` and `undefined`. An object's two
    /// texts differ -- `"[object Object]"` against `{ a: 1 }` -- so it is not
    /// one of them, and `nts_value_inspect` refuses it by name.
    pub(super) fn spells_itself(&self, node: NodeId) -> bool {
        let Some(ty) = self.snapshot.node_types.get(&node) else {
            return false;
        };
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        let members: Vec<TypeId> = match &record.kind {
            TypeKind::Union(members) => members.clone(),
            _ => vec![*ty],
        };
        members.iter().all(|member| {
            self.snapshot
                .types
                .get(member.0 as usize)
                .is_some_and(|record| {
                    matches!(
                        record.kind,
                        TypeKind::Number
                            | TypeKind::String
                            | TypeKind::Boolean
                            | TypeKind::BigInt
                            | TypeKind::Null
                            | TypeKind::Undefined
                            | TypeKind::Void
                            // `String(sym)` is `SymbolDescriptiveString`, and
                            // `nts_value_to_string` spells it from the tag like
                            // every other member here. Added when
                            // `String(type)` on a `string | symbol` turned out
                            // to be under `EventEmitter#on`.
                            //
                            | TypeKind::Symbol
        | TypeKind::UniqueSymbol
                            | TypeKind::Literal(_)
                    )
                })
        })
    }

    /// `String.fromCodePoint(x)` throws a `RangeError` for anything that is
    /// not a code point.
    ///
    /// The specification is: throw unless `x` is an integer in
    /// `[0, 0x10FFFF]`. Three tests, and the third earns its place twice --
    /// `NaN` fails every comparison, so `x < 0` and `x > 0x10FFFF` are both
    /// false for it, and only `x !== trunc(x)` catches it. `-0` is an integer
    /// and is not less than zero, which is the answer.
    ///
    /// Here rather than in the runtime, and that is the whole point: the C
    /// helper printed the value and called `abort()`, so `ucs2.encode([NaN])`
    /// took the process down where node throws something catchable. A runtime
    /// cannot fix that on its own -- a `RangeError` is laid out by the
    /// *program*, and the descriptor lives in the generated file -- so the
    /// check belongs where the class can be built. Putting it in HIR also
    /// means the JVM lane, which has its own `fromCodePoint`, is guarded by
    /// the same three tests rather than by a second copy of them.
    pub(super) fn guard_code_point(
        &mut self,
        id: NodeId,
        point: ValueId,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let below = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: point,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let throwing = self.new_block();
        let second = self.new_block();
        let third = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: below,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: second,
            else_args: Vec::new(),
        });

        self.switch_to(second);
        let ceiling = self.push(
            OpKind::ConstFloat(1_114_111.0),
            HirType::NUMBER,
            origin.clone(),
        );
        let above = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: point,
                rhs: ceiling,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: above,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: third,
            else_args: Vec::new(),
        });

        self.switch_to(third);
        let truncated = self.push(
            OpKind::Unary {
                op: UnOp::Trunc,
                operand: point,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let whole = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: point,
                rhs: truncated,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: whole,
            then_target: carry_on,
            then_args: Vec::new(),
            else_target: throwing,
            else_args: Vec::new(),
        });

        self.switch_to(throwing);
        // The value is in the message, because node's is: `Invalid code point
        // 1.5`, not a fixed sentence. That is the one place a provided error
        // needs a message it cannot spell as a constant, which is why
        // `throw_provided_error` grew a form taking the text as a value.
        let text = HirType::Managed(ManagedType::String);
        let prefix = self.push(
            OpKind::ConstString("Invalid code point ".into()),
            text.clone(),
            origin.clone(),
        );
        let printed = self.runtime_call(
            "nts_number_to_string",
            vec![point],
            text.clone(),
            origin.clone(),
        );
        let message = self.runtime_call("nts_concat", vec![prefix, printed], text, origin);
        self.throw_provided_error_text(id, "RangeError", message)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }
        self.switch_to(carry_on);
        Ok(())
    }

    /// `s[i]` where `s` is a string, which is a one-unit string rather than an
    /// element of anything.
    ///
    /// `None` where the receiver is not a string, so the array path runs
    /// unchanged. Decided from the *checker's* type rather than by lowering the
    /// receiver and looking, because the array path lowers it again and a
    /// receiver with a side effect would then have it twice.
    ///
    /// Two of the seven things `runtime/node/path` could not compile were this,
    /// both in the same shape: `path[i]` inside a loop bounded by
    /// `path.length`, and `ext[0]` guarded by `ext` being non-empty.
    pub(super) fn lower_string_index(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        let children = self.children(id);
        let [object, index] = children.as_slice() else {
            return Ok(None);
        };
        if !matches!(
            self.type_of(*object),
            Some(HirType::Managed(ManagedType::String))
        ) {
            return Ok(None);
        }
        let (receiver, guard) = access::receiver(self, *object)?;
        let at = self.lower_expression(*index)?;
        if let Some(guard) = guard {
            let key = access::index_key(self, id, at);
            access::require(self, id, &guard, &key, false)?;
        }
        let origin = self.origin(id);
        Ok(Some(self.runtime_call(
            "nts_str_at",
            vec![receiver, at],
            HirType::Managed(ManagedType::String),
            origin,
        )))
    }

    /// A method on a string.
    ///
    /// Every one of these is a runtime call, because a string has no layout to
    /// resolve a member against and no class the program declares. The set is
    /// deliberately the operations that are *exactly* expressible over UTF-16
    /// code units, which is what a `NtsString` holds -- so each is the same
    /// function JavaScript specifies rather than an approximation of it.
    ///
    /// `toUpperCase`, `toLowerCase` and `trim` are absent for that reason. All
    /// three are defined over Unicode, not over ASCII, and an ASCII version
    /// would be right for most inputs and quietly wrong for the rest. Refusing
    /// beats that.
    /// The string calls whose n-ary form is a fold, and the empty one.
    ///
    /// `None` where the helper is neither, which is every other one: the arity
    /// check is right about those, and the refusal it produces names the method.
    fn fold_string_call(
        &mut self,
        helper: &str,
        args: &[ValueId],
        ty: &HirType,
        origin: &Origin,
    ) -> Option<ValueId> {
        // **`s.split(sep, limit)` splits and then truncates.**
        //
        // Exact for a string separator: the specification stops early and a
        // truncation of the whole result is the same list, because a separator
        // that is not a regular expression cannot make the earlier elements
        // depend on how many are wanted.
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
        if helper == "nts_str_split" && args.len() == 3 {
            let whole = self.runtime_call(
                "nts_str_split",
                vec![args[0], args[1]],
                ty.clone(),
                origin.clone(),
            );
            let limit = self.push(
                OpKind::Unary {
                    op: UnOp::ToUint32,
                    operand: args[2],
                },
                HirType::NUMBER,
                origin.clone(),
            );
            let from = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
            return Some(self.runtime_call(
                "nts_array_slice_ref",
                vec![whole, from, limit],
                ty.clone(),
                origin.clone(),
            ));
        }

        // **`s.concat()` is `s`.** With no arguments there is nothing to join,
        // and the arity check would otherwise pad the missing one -- with a
        // *number*, because the filler does not know this parameter is a
        // string. That emitted `nts_concat(v0, v1)` with a `double` in the
        // second slot, which clang rejects, on the gated binary, with no
        // diagnostic from this compiler at all.
        if helper == "nts_concat" && args.len() == 1 {
            return Some(args[0]);
        }

        // **`s.concat(a, b, c)` is the fold**, for the reason
        // `String.fromCharCode` folds: concatenation is associative and exact
        // on strings, so pairing them left to right gives the string the n-ary
        // call gives. The runtime offers two at a time and the arity check
        // would otherwise refuse anything else as `a string method with this
        // many arguments`, which is true of the helper and not of the method.
        if helper == "nts_concat" && args.len() > 2 {
            let mut folded = args[0];
            for value in args.iter().skip(1) {
                folded = self.runtime_call(
                    "nts_concat",
                    vec![folded, *value],
                    ty.clone(),
                    origin.clone(),
                );
            }
            return Some(folded);
        }
        None
    }

    pub(super) fn lower_string_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        // [`Self::literal_name`] rather than the node's text, because the
        // decoder carries none on a literal: `o["twice"]()` names its method
        // with a `STRING_LITERAL`, and reading `.text` there answered `None`
        // for a name the program spells in full. Three call paths -- a string's
        // methods, an array's and an object's -- each read it the same wrong
        // way, so a bracketed method call was refused as "a computed method
        // name" on every receiver there is.
        let name = self
            .called_member_name(member)
            .ok_or_else(|| self.unsupported(member, "a computed method name"))?;

        // (runtime function, how many arguments after the receiver, result)
        let string = HirType::Managed(ManagedType::String);
        // `charCodeAt` is an operation rather than a call: as a call its index
        // would have to match a C signature, which pins the loop counter that
        // produces it to a `double` and makes every step downstream floating
        // point.
        if name == "charCodeAt"
            && let [argument] = arguments
        {
            return self.builtin_string_unit_at(id, receiver, *argument);
        }

        if let Some(value) = self.lower_positioned_string_method(id, receiver, &name, arguments)? {
            return Ok(value);
        }

        // `s.concat()` concatenates nothing: `s` itself, which is immutable.
        if name == "concat" && arguments.is_empty() {
            return Ok(receiver);
        }
        let (helper, arity, ty) = match name.as_str() {
            "codePointAt" => ("nts_str_code_point_at", 1, HirType::NUMBER),
            "charAt" => ("nts_str_char_at", 1, string.clone()),
            "repeat" => ("nts_str_repeat", 1, string.clone()),
            "slice" => ("nts_str_slice", 2, string.clone()),
            "substring" => ("nts_str_substring", 2, string.clone()),
            "concat" => ("nts_concat", 1, string.clone()),
            // `trim` and its two halves. The whitespace set is the
            // specification's rather than `isspace`'s -- it includes NBSP and
            // the byte order mark -- and lives in the runtime, where it can be
            // read as a list.
            "trim" => ("nts_str_trim", 0, string.clone()),
            // `padStart(n)` pads with a single space, which the filler below
            // supplies: every other omitted argument here is "to the end" and
            // is a number, and this one is a string.
            "padStart" => ("nts_str_pad_start", 2, string.clone()),
            "padEnd" => ("nts_str_pad_end", 2, string.clone()),
            // The only two members that are about surrogates rather than
            // characters. A one-byte string cannot hold a lone one, which is
            // most strings and the whole of the answer for them.
            "isWellFormed" => ("nts_str_is_well_formed", 0, HirType::Bool),
            "toWellFormed" => ("nts_str_to_well_formed", 0, string.clone()),

            // Case conversion, which is a table rather than an algorithm -- see
            // `runtime/c/quickjs`. The locale forms are deliberately *not*
            // aliased onto these: `toLocaleUpperCase` of `i` in Turkish is
            // `\u0130` and not `I`, so answering it with the
            // locale-independent mapping would be wrong rather than
            // approximate, and a wrong answer is worse than a named refusal.
            "toLowerCase" => ("nts_str_to_lower_case", 0, string.clone()),
            "toUpperCase" => ("nts_str_to_upper_case", 0, string.clone()),

            "trimStart" => ("nts_str_trim_start", 0, string.clone()),
            "trimEnd" => ("nts_str_trim_end", 0, string.clone()),
            // `split`, with a *string* separator. A regular expression is a
            // different feature and is refused below by falling through, which
            // names it rather than splitting on its source text.
            "split" => (
                "nts_str_split",
                1,
                HirType::Managed(ManagedType::Array(Box::new(string))),
            ),
            // `replace` takes the first match, `replaceAll` every one. The
            // difference is the whole of it, so they share a runtime function
            // and differ by which entry point calls it.
            //
            // Both expand `$` in the replacement, which is not optional: node
            // answers `"a-b".replace("-", "$&")` with `"a-b"`, not with
            // `"a$&b"`. A pattern that is a regular expression is refused just
            // below rather than here, because the member exists for it and it
            // is the *argument* that is not something this can do.
            "replace" => ("nts_str_replace", 2, string.clone()),
            "replaceAll" => ("nts_str_replace_all", 2, string.clone()),
            // Named, because twenty-eight instances of "this string method"
            // in the node profile is a bucket and not a work item.
            other => {
                return Err(self.unsupported(
                    member,
                    &format!("`{other}`, which a string does not have here"),
                ));
            }
        };

        let mut args = vec![receiver];
        self.lower_method_arguments(id, (MethodsOf::String, name.as_str()), arguments, &mut args)?;
        let origin = self.origin(id);

        if let Some(folded) = self.fold_string_call(helper, &args, &ty, &origin) {
            return Ok(folded);
        }
        // A count `repeat` will not accept throws before the helper is
        // reached. See `guard_repeat_count`.
        if helper == "nts_str_repeat" && args.len() == 2 {
            self.guard_repeat_count(id, args[1])?;
        }

        self.fill_string_arguments((id, name.as_str()), helper, arity, &mut args, &origin)?;

        // A regular expression is a pattern `String.prototype.replace` accepts
        // and this does not. It has to be named and refused *here*: everything
        // below spells a call handing a `NtsString *` to the runtime, so a
        // `RegExp` arriving at it is a wrong answer rather than a type error.
        if matches!(helper, "nts_str_replace" | "nts_str_replace_all")
            && args[1..].iter().any(|value| {
                self.values[value.0 as usize].ty != HirType::Managed(ManagedType::String)
            })
        {
            return Err(self.unsupported(id, "`replace` with a pattern that is not a string"));
        }

        // `codePointAt` answers **`undefined`** for an index that is not there
        // and the helper answers NaN, which is not the same value: `?? 0` takes
        // the one and not the other, and `String(v)` is `"undefined"` against
        // `"NaN"`. Every out-of-range case disagreed with node, silently.
        //
        // Its sibling `charCodeAt` answers NaN and is **right** to, which is why
        // this lasted: the helper is written in terms of that one, and the
        // sibling's answer reads as a precedent for it. They are different
        // questions with different answers, exactly as `at`, `charAt` and `s[i]`
        // are three answers for an index that is not there.
        //
        // Only where the result is erased -- where the caller has not narrowed
        // it away with a guard, or with a `!` its consumer converts
        // (`claimed_reads::read_as_number`) -- so a program that promised the
        // index was there pays nothing. That is the rule `pop` and `at`
        // already follow.
        if helper == "nts_str_code_point_at"
            && self.type_of(id) == Some(HirType::Erased)
            && !claimed_reads::read_as_number(self, id)
        {
            let value = self.push(
                OpKind::Call {
                    callee: Callee::External(helper.to_owned()),
                    args,
                    frame: None,
                },
                ty,
                origin.clone(),
            );
            return Ok(self.code_point_or_undefined(value, &origin));
        }

        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// A code point, or `undefined` where the helper answered NaN.
    ///
    /// **NaN is not a code point**, so a number-returning helper can carry the
    /// absence after all and no second helper is needed for it — which means C,
    /// LLVM and the JVM all get this the day it lands rather than two of them
    /// getting it and the third red-gating while it catches up.
    ///
    /// `v !== v` is true of NaN and of nothing else.
    fn code_point_or_undefined(&mut self, value: ValueId, origin: &Origin) -> ValueId {
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: value,
                rhs: value,
            },
            HirType::Bool,
            origin.clone(),
        );
        let missing = self.new_block();
        let present = self.new_block();
        let merge = self.new_block();
        let answer = self.push_block_param(merge, HirType::Erased, origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: missing,
            then_args: Vec::new(),
            else_target: present,
            else_args: Vec::new(),
        });
        self.switch_to(missing);
        let undefined = self.push(OpKind::ConstUndefined, HirType::Erased, origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![undefined],
        });
        self.switch_to(present);
        let erased = self.push(
            OpKind::Erase {
                value,
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            HirType::Erased,
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![erased],
        });
        self.switch_to(merge);
        answer
    }
}

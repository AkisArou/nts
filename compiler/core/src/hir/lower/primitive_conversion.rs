//! Lower JavaScript primitive and numeric conversions.

use super::{
    BinOp, BlockId, Diagnostic, FuncBuilder, HirType, LiteralValue, ManagedType, MemberKey, NodeId,
    NumericBuiltin, OpKind, Origin, PropertyKey, SemanticSnapshot, Terminator, TypeId, TypeKind,
    ValueId, iterator_calls,
};

/// What a foreign declaration's tags say about its parameters.
/// Which `ToNumber` an erased operand is converted for: the operator's, and
/// so what a value `nts_value_to_number` cannot answer becomes.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum NumberHint {
    /// Unary `+` and every implicit `ToNumber`: a bigint is a `TypeError`.
    Number,
    /// `++`, `--` and unary `-`, which are `ToNumeric`: a bigint is kept.
    Numeric,
    /// `Number(x)`, which converts a bigint.
    Explicit,
}

impl FuncBuilder<'_> {
    /// `BigInt.asIntN(bits, v)` and its unsigned twin.
    pub(super) fn decide_as_n(
        &mut self,
        id: NodeId,
        helper: &str,
        width: NodeId,
        value: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let width_node = width;
        let width = self.lower_expression(width)?;
        let value = self.lower_expression(value)?;
        if self.values[value.0 as usize].ty != HirType::BigInt {
            return Err(self.unsupported(id, "`BigInt.asIntN` of something that is not a `bigint`"));
        }
        // Both arguments are evaluated before ToIndex can throw. Keep its
        // comparisons in lowering so the caller can catch the RangeError.
        let width =
            self.builtin_number_argument((id, width_node), NumericBuiltin::BigIntWidth, 1, width)?;
        let width = self.coerce(width, &HirType::NUMBER, id)?;
        self.guard_buffer_length(
            id,
            width,
            "Invalid value: not (convertible to) a safe integer",
        )?;
        let origin = self.origin(id);
        Ok(self.call_runtime(helper, vec![width, value], HirType::BigInt, &origin))
    }

    /// `Array.isArray(x)`, from the checker's type rather than the machine one.
    /// Whether the checker's type for this node admits only primitives that
    /// carry their own value -- no object, no array, nothing with a prototype.
    ///
    /// The licence for `nts_value_to_number`, and it has to be the type rather
    /// than the tag: the tag is a run-time fact and this is a claim about every
    /// value that can arrive. A union of `string` and `boolean` qualifies; a
    /// union with `object` in it does not, because `ToNumber` of one is
    /// `ToPrimitive` and this compiler has no prototype chain to run.
    pub(super) fn only_primitives(&self, at: NodeId) -> bool {
        self.numeric_primitives(at, false)
    }

    fn numeric_primitives(&self, at: NodeId, allow_bigint: bool) -> bool {
        let Some(&ty) = self.snapshot.node_types.get(&at) else {
            return false;
        };
        let primitive = |snapshot: &SemanticSnapshot, id: TypeId| {
            match snapshot.types.get(id.0 as usize).map(|record| &record.kind) {
                Some(TypeKind::BigInt | TypeKind::Literal(LiteralValue::BigInt(_))) => allow_bigint,
                Some(
                    TypeKind::Number
                        | TypeKind::String
                        | TypeKind::Boolean
                        | TypeKind::Null
                        | TypeKind::Undefined
                        // A literal is its base type narrowed to one value, and
                        // `"7"` is as much a string as `string` is.
                        | TypeKind::Literal(_)
                ) => true,
                _ => false,
            }
        };
        match self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Union(members)) => members
                .iter()
                .all(|member| primitive(self.snapshot, *member)),
            _ => primitive(self.snapshot, ty),
        }
    }

    /// `ToNumber` of an erased value whose type admits an object, read off its
    /// tag, where the program declares no conversion of its own; `None` where
    /// it does, and the caller keeps its own answer.
    ///
    /// An object's `ToNumber` is `ToPrimitive` first: `valueOf`, then
    /// `toString`. With no program `valueOf` or `[Symbol.toPrimitive]`
    /// anywhere, every object's `valueOf` is `Object.prototype`'s, which
    /// answers the object itself and is skipped, so its number is its text
    /// parsed: the printer's text, which is what `toString` answers --
    /// `[5]` is "5" and 5, `[]` is "" and 0, `{}` is "[object Object]" and
    /// NaN. A function and a C library's handle are objects too. Everything
    /// else keeps `nts_value_to_number`'s tag switch.
    ///
    /// A symbol stops by name, as does a bigint under `++`, `--` and unary
    /// `-`, which keep one: both are answers this conversion cannot give.
    /// JavaScript throws a `TypeError` for the symbol. A throw here would make
    /// every function stepping an `any` one that can raise, which is its own
    /// change.
    pub(super) fn erased_to_number(
        &mut self,
        id: NodeId,
        value: ValueId,
        hint: NumberHint,
    ) -> Result<Option<ValueId>, Diagnostic> {
        if self.iterators.declares_a_conversion() {
            return Ok(None);
        }
        let origin = self.origin(id);
        let unsigned = HirType::Int {
            bits: 32,
            signed: false,
        };
        let tag = self.push(OpKind::TagOf { value }, unsigned, origin.clone());
        let symbol = self.compare_tag(tag, BinOp::Eq, crate::hir::tags::SYMBOL, &origin);
        self.stop_when(
            id,
            symbol,
            "a conversion to a number of a symbol held as `any`, which is a TypeError",
        );
        if hint == NumberHint::Numeric {
            let bigint = self.compare_tag(tag, BinOp::Eq, crate::hir::tags::BIGINT, &origin);
            self.stop_when(
                id,
                bigint,
                "an increment, decrement or negation of a bigint held as `any`",
            );
        }
        let object = self.new_block();
        let other = self.new_block();
        let merge = self.new_block();
        let number = self.push_block_param(merge, HirType::NUMBER, origin.clone());
        self.branch_on_an_object_tag(tag, object, other, &origin);
        self.switch_to(object);
        let text = self.printer_text(id, value)?;
        let parsed = self.call_runtime("nts_str_to_number", vec![text], HirType::NUMBER, &origin);
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![parsed],
        });
        self.switch_to(other);
        let helper = if hint == NumberHint::Explicit {
            "nts_value_to_number_explicit"
        } else {
            "nts_value_to_number"
        };
        let primitive = self.call_runtime(helper, vec![value], HirType::NUMBER, &origin);
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![primitive],
        });
        self.switch_to(merge);
        Ok(Some(number))
    }

    /// `tag op wanted`, a tag against one of [`super::tags`](crate::hir::tags)'s.
    fn compare_tag(&mut self, tag: ValueId, op: BinOp, wanted: u32, origin: &Origin) -> ValueId {
        let wanted = self.push(
            OpKind::ConstInt(i128::from(wanted)),
            HirType::Int {
                bits: 32,
                signed: false,
            },
            origin.clone(),
        );
        self.push(
            OpKind::Binary {
                op,
                lhs: tag,
                rhs: wanted,
            },
            HirType::Bool,
            origin.clone(),
        )
    }

    /// Branch to `object` where `tag` is an object's -- `OBJECT`, `FUNCTION`
    /// or the handle block -- and to `other` for the rest. `NULL` sits between
    /// `OBJECT` and the block and is a primitive here, whose number is 0.
    fn branch_on_an_object_tag(
        &mut self,
        tag: ValueId,
        object: BlockId,
        other: BlockId,
        origin: &Origin,
    ) {
        for wanted in [crate::hir::tags::OBJECT, crate::hir::tags::FUNCTION] {
            let is = self.compare_tag(tag, BinOp::Eq, wanted, origin);
            let next = self.new_block();
            self.terminate(Terminator::Branch {
                cond: is,
                then_target: object,
                then_args: Vec::new(),
                else_target: next,
                else_args: Vec::new(),
            });
            self.switch_to(next);
        }
        let from_block = self.compare_tag(tag, BinOp::Ge, crate::hir::tags::HANDLE_BLOCK, origin);
        let below_block = self.new_block();
        self.terminate(Terminator::Branch {
            cond: from_block,
            then_target: below_block,
            then_args: Vec::new(),
            else_target: other,
            else_args: Vec::new(),
        });
        self.switch_to(below_block);
        let in_block = self.compare_tag(
            tag,
            BinOp::Lt,
            crate::hir::tags::HANDLE_BLOCK + crate::hir::tags::HANDLE_BLOCK_SIZE,
            origin,
        );
        self.terminate(Terminator::Branch {
            cond: in_block,
            then_target: object,
            then_args: Vec::new(),
            else_target: other,
            else_args: Vec::new(),
        });
    }

    /// `ToNumber(v)`, which `Number(x)` and unary `+` are both spellings of.
    ///
    /// One function because they are one operation. Unary `+` used to be
    /// *dropped* -- correct on something already typed `number`, where it is
    /// the identity including on `-0`, and wrong on everything else: `+s` on a
    /// string returned the string, and the C backend then emitted
    /// `(double)v1` on a pointer. A conversion that is the identity for one
    /// type is not the identity, and writing it once is what keeps the other
    /// arms from being missing in one of the two places.
    ///
    /// Implicit `ToNumber` excludes `BigInt`. An assertion can hide its source
    /// type from the checker, so the compiler must preserve this distinction.
    pub(super) fn coerce_to_number(
        &mut self,
        id: NodeId,
        argument: NodeId,
        value: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        match self.values[value.0 as usize].ty {
            HirType::Float { .. } | HirType::Int { .. } => Ok(value),
            // ToNumber of a boolean is 1 or 0. Explicit Number's BigInt
            // conversion lives in coerce_explicit_number, not this path.
            HirType::Bool => Ok(self.push(OpKind::Convert(value), HirType::NUMBER, origin)),
            // An erased value whose type admits no object, which is
            // `typeof v === "string" || typeof v === "boolean"` -- a union
            // of two primitives, so the value keeps its tag and the tag is
            // what decides. `nts_value_to_number` is ToNumber over the tags
            // and reuses the string parse below rather than repeating it.
            //
            // Guarded on the *type* rather than emitted for any erased
            // value, because ToNumber of an object is ToPrimitive: it runs
            // `valueOf` and `toString` off a prototype chain, and
            // `Number([5])` is 5. Nothing here can produce that, so a value
            // that might be one is refused instead of answered wrongly.
            HirType::Erased if self.only_primitives(argument) => {
                Ok(self.call_runtime("nts_value_to_number", vec![value], HirType::NUMBER, &origin))
            }
            // One whose type admits an object: by its tag, where the program
            // declares no conversion of its own.
            HirType::Erased => match self.erased_to_number(id, value, NumberHint::Number)? {
                Some(number) => Ok(number),
                None => Err(self.unsupported(id, "a conversion to number from this type")),
            },
            // A string, which is a *parse* and not a conversion: the
            // specification's StringToNumber trims, accepts three radix
            // prefixes C does not and rejects three spellings C does, and
            // answers NaN for anything that is not a complete literal.
            // `nts_str_to_number` is that grammar; `strtod` is asked only
            // about a span it has already decided is decimal.
            //
            // The whole JSON parser is behind this one arm: `numberValueOf`
            // reads `Number(source.slice(start, end))`, and `readValue` and
            // `parseJsonText` are behind that.
            HirType::Managed(ManagedType::String) => {
                Ok(self.call_runtime("nts_str_to_number", vec![value], HirType::NUMBER, &origin))
            }
            _ => Err(self.unsupported(id, "a conversion to number from this type")),
        }
    }

    /// Number explicitly accepts `BigInt`; implicit `ToNumber` must never use
    /// this adapter. The erased helper reads the owned payload after its tag.
    pub(super) fn coerce_explicit_number(
        &mut self,
        id: NodeId,
        argument: NodeId,
        value: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        match self.values[value.0 as usize].ty {
            HirType::BigInt => Ok(self.push(OpKind::Convert(value), HirType::NUMBER, origin)),
            HirType::Erased if self.numeric_primitives(argument, true) => Ok(self.call_runtime(
                "nts_value_to_number_explicit",
                vec![value],
                HirType::NUMBER,
                &origin,
            )),
            HirType::Erased => match self.erased_to_number(id, value, NumberHint::Explicit)? {
                Some(number) => Ok(number),
                None => self.coerce_to_number(id, argument, value),
            },
            _ => self.coerce_to_number(id, argument, value),
        }
    }

    /// A 64-bit integer C hands the program as a `number` (`AsNumber<C>`), a
    /// call's result or a callback's argument: exactly, and a `RangeError`
    /// past 2^53, where no number holds every integer. `source` says where it
    /// came from, for the error's message.
    pub(super) fn exact_as_number(
        &mut self,
        id: NodeId,
        value: ValueId,
        source: &str,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let integer = self.values[value.0 as usize].ty.clone();
        let HirType::Int { signed, .. } = integer else {
            return Ok(value);
        };
        let (throws, fits) = (self.new_block(), self.new_block());
        let greatest = self.push(OpKind::ConstInt(1 << 53), integer.clone(), origin.clone());
        let above = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: value,
                rhs: greatest,
            },
            HirType::Bool,
            origin.clone(),
        );
        let below_or_fits = if signed { self.new_block() } else { fits };
        self.terminate(Terminator::Branch {
            cond: above,
            then_target: throws,
            then_args: Vec::new(),
            else_target: below_or_fits,
            else_args: Vec::new(),
        });
        if signed {
            self.switch_to(below_or_fits);
            let least = self.push(OpKind::ConstInt(-(1 << 53)), integer, origin.clone());
            let below = self.push(
                OpKind::Binary {
                    op: BinOp::Lt,
                    lhs: value,
                    rhs: least,
                },
                HirType::Bool,
                origin.clone(),
            );
            self.terminate(Terminator::Branch {
                cond: below,
                then_target: throws,
                then_args: Vec::new(),
                else_target: fits,
                else_args: Vec::new(),
            });
        }
        self.switch_to(throws);
        let message = format!("{source} an integer past 2^53, which a number cannot hold exactly");
        self.throw_provided_error(id, "RangeError", &message)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Unreachable);
        }
        self.switch_to(fits);
        Ok(self.push(OpKind::Convert(value), HirType::NUMBER, origin))
    }

    /// `OrdinaryToPrimitive(O, "number")` -- `valueOf` first, then `toString`
    /// -- for an operand of `+` (`ToPrimitive` with hint "default") or of a
    /// relational comparison (hint "number"). The two hints order the methods
    /// alike for every object but a `Date` and one with `Symbol.toPrimitive`,
    /// and neither reaches here: a `Date` has a representation of its own, and
    /// the symbol is refused by name.
    ///
    /// For a typed receiver it is a **static** dispatch: "does this object have
    /// a `valueOf`" is a question about the type rather than a prototype walk.
    /// That is what `blockers/a-relational-comparison-between-objects` predicted
    /// when it called this "reachable machinery wanting an ordering rather than
    /// missing machinery".
    ///
    /// A value that is already a primitive is returned unchanged, which is the
    /// specification's first step and also what makes `o > 1` work without a
    /// second path.
    ///
    /// **Each call is one the call analysis saw.** `site`, the operator, lists
    /// the members it may call among its implicit calls
    /// ([`iterator_calls::Plan`]), so a `valueOf` that throws inside a `try`
    /// takes its raising entry, and one reached only through `+` is not pruned
    /// as uncalled. Calling through `callee_for` instead, as this once did, had
    /// neither.
    ///
    /// **A member answering an object is still called.** `valueOf(): Point` is
    /// legal TypeScript and is *not* a conversion: the specification calls it,
    /// discards the object and tries the next, and the call's effects are the
    /// program's.
    ///
    /// **An object whose chain declares neither has `Object.prototype`'s**:
    /// `valueOf` answers the object and `toString` `"[object Object]"`, which is
    /// the printer's text -- so `m + ""` on a class with no conversion member
    /// prints as before, and two such objects compare as two equal strings, as
    /// in node. What is refused is a declared `toString` answering an object
    /// after `valueOf` did not answer a primitive: JavaScript throws a
    /// `TypeError` there.
    pub(super) fn ordinary_to_primitive(
        &mut self,
        site: NodeId,
        operand: NodeId,
        value: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[value.0 as usize].ty.clone()
        else {
            return Ok(value);
        };
        if self
            .well_known_property_key(type_id, nts_semantic_schema::WellKnownSymbol::ToPrimitive)
            .is_some()
        {
            return Err(self.unsupported(
                operand,
                "a conversion to a primitive of an object whose type declares \
                 `Symbol.toPrimitive`",
            ));
        }
        for member in ["valueOf", "toString"] {
            let Some((answers, returns)) =
                self.conversion_member(site, operand, type_id, member)?
            else {
                continue;
            };
            let (callee, raises) =
                self.implicit_method(site, type_id, &MemberKey::named(member))?;
            let origin = self.origin(operand);
            let answer = self.push(
                OpKind::Call {
                    callee,
                    args: vec![value],
                    frame: None,
                },
                returns,
                origin.clone(),
            );
            if raises {
                self.implicit_raise_test(site, &origin)?;
            }
            if answers {
                return Ok(answer);
            }
        }
        self.as_string(operand, value)
    }

    /// Whether [`Self::ordinary_to_primitive`] calls `member` on a `type_id`,
    /// and if so whether it answers a primitive and at what representation.
    /// `None` is a member the conversion after it stands for:
    /// `Object.prototype`'s, or a `toString` the printer calls.
    ///
    /// Refused by name, each where a static call would answer wrongly or not
    /// at all: a member held in a field (a function value, called through no
    /// method); a type with no `valueOf` while a class it may hold has one; a
    /// call the plan did not list; an answer that may be an object or a
    /// primitive, or a primitive with no one representation; and a `toString`
    /// answering an object after `valueOf` did not answer a primitive, which
    /// is JavaScript's `TypeError`.
    fn conversion_member(
        &mut self,
        site: NodeId,
        operand: NodeId,
        type_id: TypeId,
        member: &str,
    ) -> Result<Option<(bool, HirType)>, Diagnostic> {
        if iterator_calls::Method::resolve(self, type_id, &MemberKey::named(member))
            .is_none_or(|method| method.targets.is_empty())
        {
            if self
                .member_return_type(type_id, &PropertyKey::Name(member.to_owned()))
                .is_some()
                && self.layout_of(operand, type_id).is_ok_and(|layout| {
                    self.field_named(type_id, &layout, &PropertyKey::Name(member.to_owned()))
                        .is_some()
                })
            {
                return Err(self.unsupported(
                    operand,
                    &format!(
                        "a conversion to a primitive through a `{member}` held in a \
                         field, which is called implicitly"
                    ),
                ));
            }
            // The type's chain has none, but a value of it may be one whose
            // class does: `const a: A = new B()` with `valueOf` on `B` only.
            // A static dispatch would print `a` where node calls `B`'s. A
            // `toString` is the printer's, which dispatches at run time.
            if member == "valueOf" && self.a_holder_declares_value_of(type_id) {
                return Err(self.unsupported(
                    operand,
                    "a conversion to a primitive of a value whose type declares no \
                     `valueOf` while a class it may hold does",
                ));
            }
            return Ok(None);
        }
        // **A call the plan did not list** is one this site's source did not
        // spell: a copy re-typed `any` to the class, as `"" + value` in a
        // function taking `any` is in each instantiation. A `toString` is then
        // the printer's to make -- the conversion after the loop, which reads
        // the descriptor and carries its own raising entries, as it did before
        // this site learned to call members -- and a `valueOf` is refused,
        // having no such conversion to fall back on.
        if !self
            .iterators
            .at(site)
            .iter()
            .any(|method| method.receiver == type_id && method.key == MemberKey::named(member))
        {
            if member == "toString" {
                return Ok(None);
            }
            return Err(self.unsupported(
                operand,
                &format!("an implicit `{member}` call the call analysis did not see"),
            ));
        }
        let answers = self
            .member_return_type(type_id, &PropertyKey::Name(member.to_owned()))
            .and_then(|ty| self.answers_a_primitive(ty));
        let returns = self.member_returns(type_id, &PropertyKey::Name(member.to_owned()));
        let (Some(answers), Some(returns)) = (answers, returns) else {
            return Err(self.unsupported(
                operand,
                &format!(
                    "a conversion to a primitive through a `{member}` that may answer \
                     an object or a primitive"
                ),
            ));
        };
        if answers
            && !matches!(
                returns,
                HirType::Managed(ManagedType::String) | HirType::Bool | HirType::BigInt
            )
            && returns != HirType::NUMBER
        {
            return Err(self.unsupported(
                operand,
                &format!(
                    "a conversion to a primitive through a `{member}` whose answer has \
                     no single primitive representation"
                ),
            ));
        }
        if !answers && member == "toString" {
            return Err(self.unsupported(
                operand,
                "a conversion to a primitive where `valueOf` and `toString` both \
                 answer objects, which JavaScript answers with a `TypeError`",
            ));
        }
        Ok(Some((answers, returns)))
    }

    /// Whether a class that a value of `ty` may be declares `valueOf`: one
    /// whose base chain reaches `ty`, or, for an interface, any class at all,
    /// since a class need not name an interface to be one.
    fn a_holder_declares_value_of(&self, ty: TypeId) -> bool {
        let interface = self.hierarchy.faces.contains(&ty);
        self.iterators
            .declaring_value_of()
            .iter()
            .any(|&class| interface || self.hierarchy.descends(class, ty))
    }

    /// Whether every value of `ty` is a primitive (`Some(true)`), every one an
    /// object (`Some(false)`), or the type does not say.
    ///
    /// A `symbol` is neither here: `+` on one throws a `TypeError`, which a
    /// conversion through its descriptive string would not.
    fn answers_a_primitive(&self, ty: TypeId) -> Option<bool> {
        if self.is_the_object_type(ty) {
            return Some(false);
        }
        match &self.snapshot.types.get(ty.0 as usize)?.kind {
            TypeKind::Union(parts) => {
                let mut answers = parts.iter().map(|part| self.answers_a_primitive(*part));
                let first = answers.next()??;
                answers.all(|answer| answer == Some(first)).then_some(first)
            }
            TypeKind::Boolean
            | TypeKind::Number
            | TypeKind::BigInt
            | TypeKind::String
            | TypeKind::Literal(_)
            | TypeKind::TemplateLiteral { .. }
            | TypeKind::Null
            | TypeKind::Undefined
            | TypeKind::Void => Some(true),
            TypeKind::Object { .. }
            | TypeKind::Array(_)
            | TypeKind::Tuple(_)
            | TypeKind::Function(_) => Some(false),
            _ => None,
        }
    }
}

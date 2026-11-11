//! Lower typeof and related builtin classification predicates with their effect and initialization checks.

use super::{
    Absent, Branch, Diagnostic, FuncBuilder, HirType, LiteralValue, ManagedType, NodeId, OpKind,
    SymbolId, TypeKind, ValueId, claimed_reads, interfaces, literal_methods, syntax,
};

impl FuncBuilder<'_> {
    /// `typeof x`, where `x` has one known primitive type.
    ///
    /// In a typed compiler this is a constant. If `value` is a `number` then
    /// `typeof value` is `"number"` and there is nothing to evaluate -- the
    /// operand is not read at all, which is why this folds rather than emitting
    /// anything.
    ///
    /// Worth doing because real code is full of it. Node's validators open with
    /// `if (typeof value !== "number") throw ...` on a parameter already
    /// declared `number`, guarding against callers JavaScript allows and
    /// TypeScript does not. Eight distinct sites across the node profile were
    /// refused for it, each costing its module a statement or a function, and
    /// all eight were reported as "this expression" -- an anonymous refusal
    /// that no work-list could see.
    ///
    /// Restricted to a single known primitive, and the restriction is the whole
    /// of the correctness argument. `typeof` on a union, an object, `any` or
    /// `unknown` is a property of the *value* rather than of its type, and
    /// answering it needs a runtime tag this compiler has not decided on. Those
    /// stay refused, by name now.
    /// What the checker's type for a `typeof` operand answers, where it answers.
    ///
    /// A single primitive is a constant and no tag is read. Extracted so
    /// [`Self::lower_typeof`] reads as the two things it does -- find the answer,
    /// and run the operand -- rather than as one long match with a decision after.
    pub(super) fn typeof_from_the_checkers_type(&self, operand: NodeId) -> Option<&'static str> {
        if let Some(symbol) = self.node(operand).symbol
            && self.parameter_body_functions.contains_key(&symbol.0)
        {
            // A later body store can replace the function. That is the body's
            // current binding; the parameter environment keeps its own one.
            let Some(bound) = self.bindings.get(&symbol.0).copied() else {
                return Some("function");
            };
            let ty = self
                .cell_of(symbol.0)
                .filter(|index| self.opened_cell(symbol.0, *index).is_some())
                .and_then(|index| self.program_layout_field(index))
                .unwrap_or_else(|| self.values[bound.0 as usize].ty.clone());
            return self.spelling_for(&ty);
        }
        self.read_type(operand)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .and_then(|record| match &record.kind {
                TypeKind::Number | TypeKind::Literal(LiteralValue::Number(_)) => Some("number"),
                TypeKind::String
                | TypeKind::Literal(LiteralValue::String(_))
                | TypeKind::TemplateLiteral { .. } => Some("string"),
                TypeKind::Boolean | TypeKind::Literal(LiteralValue::Boolean(_)) => Some("boolean"),
                // A literal's type too: `0n === Symbol("1")` is test262's
                // bigint against a symbol, and the literal is what it spells.
                TypeKind::BigInt | TypeKind::Literal(LiteralValue::BigInt(_)) => Some("bigint"),
                TypeKind::Symbol | TypeKind::UniqueSymbol => Some("symbol"),
                // `const s = Symbol("s")` is a `unique symbol`, which is still
                // a symbol to `typeof`.
                // **`typeof null` is `"object"`**, which is the language's
                // oldest quirk and a constant either way. Both of these are
                // answered here rather than below, because below begins by
                // lowering the operand -- and a bare `null` has no
                // representation to lower into, so the expression was refused
                // as ``null` or `undefined` where what it stands in for is not
                // a reference`: a sentence about storage, for something with no
                // storage and a known answer.
                //
                // Nothing is skipped by not lowering *these two*, and the
                // sentence here used to stop at that -- "the operand here is a
                // keyword: the literal `null` and the literal `undefined` have
                // no effects to run" -- which is true of these two arms and was
                // **false of the function**: every arm that found an answer
                // returned the constant without lowering the operand at all, so
                // `typeof f()` folded to `"number"` and **never called `f`**.
                //
                // A silent dropped side effect wherever `typeof` is applied to a
                // call, and it made 9 recorded test262 built-ins files pass by
                // running nothing: `typeof new Temporal.Duration()
                // .toLocaleString()` compiled with no Temporal runtime present,
                // where node throws a `ReferenceError`. The conformance lane found
                // it looking at why an exclusion reported FIXED.
                //
                // So the answer is still a constant -- the checker's type decides
                // it and no tag is read -- and the operand is **evaluated for its
                // effects** below, with `null` and `undefined` exempt because a
                // keyword has none and no representation to lower into either.
                TypeKind::Null => Some("object"),
                TypeKind::Undefined => Some("undefined"),
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                TypeKind::NonPrimitive => None,
                _ => None,
            })
    }

    /// The expression inside any number of parentheses.
    ///
    /// `(((x)))` is `x` for every question this compiler asks of an operand, and a
    /// predicate that does not look through them answers about the parentheses.
    /// Bounded rather than recursive so a cycle in the node table cannot hang here.
    pub(super) fn through_parentheses(&self, mut node: NodeId) -> NodeId {
        for _ in 0..32 {
            if self.kind_of(node) != Some(syntax::PARENTHESIZED_EXPRESSION) {
                return node;
            }
            match self.children(node).first() {
                Some(inner) => node = *inner,
                None => return node,
            }
        }
        node
    }

    /// The expression inside any number of parentheses and type assertions --
    /// `as`, `!`, `satisfies` -- none of which changes the value it wraps.
    ///
    /// A question about *which value* an expression is -- a callee held in a field,
    /// say -- has the same answer for `(slot.handler as F)` as for `slot.handler`.
    /// The census asked the wrapper and found no symbol, so a call on a cast read as
    /// "a function value" no raising entry could carry, and held the program-wide
    /// raising gate off (`blockers/a-call-on-a-cast-in-a-closure-holds-the-raising-
    /// gate-off`, react-gtk's `connectController`).
    pub(super) fn through_assertions(&self, mut node: NodeId) -> NodeId {
        for _ in 0..32 {
            if !matches!(
                self.kind_of(node),
                Some(
                    syntax::PARENTHESIZED_EXPRESSION
                        | syntax::AS_EXPRESSION
                        | syntax::NON_NULL_EXPRESSION
                        | syntax::SATISFIES_EXPRESSION
                )
            ) {
                return node;
            }
            match self.children(node).first() {
                Some(inner) => node = *inner,
                None => return node,
            }
        }
        node
    }

    /// Whether a `typeof` operand has nothing to evaluate.
    ///
    /// A keyword, a name, or a literal. [`Self::lower_typeof`] runs everything else
    /// for its effects, and stops here for three reasons rather than one:
    ///
    /// * there is nothing to run -- reading a name is not an effect, where reading a
    ///   *property* may be a getter and so is deliberately absent from this list;
    /// * `null` and `undefined` have no representation to lower into, so lowering
    ///   them would refuse the expression rather than evaluate it;
    /// * and `typeof undeclaredGlobal === "undefined"` is the one idiom that depends
    ///   on the operand *not* being looked up. Lowering a name that resolves to
    ///   nothing refuses as "a global with no definition here", which would take a
    ///   working guard with it.
    ///
    /// It also keeps the corpus where it was: without the name and literal arms,
    /// 17 of 29 runtime projects emitted the same program renumbered -- a binding
    /// read pushed and then removed by DCE, which is churn for nothing.
    fn operand_has_no_effects(&self, operand: NodeId) -> bool {
        if self.initialization.can_raise_at(operand) {
            return false;
        }
        // **Through parentheses first.** `typeof(null)` is a
        // `ParenthesizedExpression` around the keyword, so without this it fell to
        // the effects path, lowered a bare `null`, and was refused as "`null` or
        // `undefined` where what it stands in for is not a reference" -- a sentence
        // about storage for something with no storage and a known answer. Caught by
        // the conformance lane on `types/null/S8.2_A3.js`, which is the one row of
        // theirs this change regressed rather than exposed.
        //
        // `typeof(undeclaredGlobal)` is the same hazard and the worse one: it is a
        // *working guard* whose whole point is that the operand is not looked up.
        let operand = self.through_parentheses(operand);
        matches!(
            self.kind_of(operand),
            Some(
                syntax::NULL_KEYWORD
                    | syntax::IDENTIFIER
                    | syntax::NUMERIC_LITERAL
                    | syntax::STRING_LITERAL
                    | syntax::BIGINT_LITERAL
                    | syntax::TRUE_KEYWORD
                    | syntax::FALSE_KEYWORD
                    | syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL
            )
        )
    }

    fn literal_method_typeof(
        &mut self,
        id: NodeId,
        operand: NodeId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some((receiver, member)) = self.member_access_key(self.through_parentheses(operand))
        else {
            return Ok(None);
        };
        let Some(face) = self.snapshot.node_types.get(&receiver).copied() else {
            return Ok(None);
        };
        if !literal_methods::supplies_method_value(self, face, &member)
            || !interfaces::property(self.snapshot, face, &member).is_some_and(|property| {
                !property.optional
                    && matches!(property.kind, nts_semantic_schema::MemberKind::Method)
            })
        {
            return Ok(None);
        }
        // Evaluate the receiver, without constructing an identity-changing
        // wrapper for a read whose only observable answer is its kind.
        self.lower_expression(receiver)?;
        Ok(Some(self.push(
            OpKind::ConstString("function".into()),
            HirType::Managed(ManagedType::String),
            self.origin(id),
        )))
    }

    /// A module name that is a value rather than storage, read: a binding's
    /// native constant, a string constant, or a `const` holding the question of
    /// what the target provides, which is that question asked here
    /// (`ModuleScope::questions`).
    pub(super) fn constant_name(
        &mut self,
        id: NodeId,
        symbol: SymbolId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        if let Some(value) = self
            .native_constant(id, symbol)
            .or_else(|| self.string_constant(id, symbol))
        {
            return Some(Ok(value));
        }
        let question = *self.module.questions.get(&symbol.0)?;
        Some(self.lower_expression(question))
    }

    /// Whether an expression is a question only the backend can answer:
    /// `typeof` of an intrinsic ([`Self::intrinsic_named_by`]), alone or
    /// compared with a string literal by `===`, `!==`, `==` or `!=`. Nothing in
    /// it has an effect, so it can be asked wherever a `const` holding it is
    /// read (`ModuleScope::questions`).
    pub(super) fn asks_what_is_provided(&self, expression: NodeId) -> bool {
        let asks = |node: NodeId| {
            let node = self.through_parentheses(node);
            self.kind_of(node) == Some(syntax::TYPE_OF_EXPRESSION)
                && self
                    .children(node)
                    .first()
                    .is_some_and(|operand| self.intrinsic_named_by(*operand).is_some())
        };
        let literal = |node: NodeId| {
            matches!(
                self.kind_of(self.through_parentheses(node)),
                Some(syntax::STRING_LITERAL | syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL)
            )
        };
        let expression = self.through_parentheses(expression);
        if asks(expression) {
            return true;
        }
        if self.kind_of(expression) != Some(syntax::BINARY_EXPRESSION) {
            return false;
        }
        let children = self.children(expression);
        let [lhs, operator, rhs] = children.as_slice() else {
            return false;
        };
        matches!(
            self.kind_of(*operator),
            Some(
                syntax::EQUALS_EQUALS_EQUALS_TOKEN
                    | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
                    | syntax::EQUALS_EQUALS_TOKEN
                    | syntax::EXCLAMATION_EQUALS_TOKEN
            )
        ) && ((asks(*lhs) && literal(*rhs)) || (literal(*lhs) && asks(*rhs)))
    }

    /// `typeof` of an intrinsic: whether the backend provides it, which only
    /// that backend's preparation can answer (`features`). The operand is not
    /// evaluated; a declaration has no effects. Every other `typeof` is
    /// [`Self::lower_typeof`]'s.
    pub(super) fn intrinsic_typeof(&mut self, id: NodeId) -> Option<ValueId> {
        let operand = *self.children(id).first()?;
        let helper = self.intrinsic_named_by(operand)?;
        Some(self.push(
            OpKind::Provided(helper),
            HirType::Managed(ManagedType::String),
            self.origin(id),
        ))
    }

    /// The runtime helper an expression names, where it is an identifier
    /// resolving to an `@ntsAbi intrinsic` declaration with no body: the
    /// declaration's `@ntsSymbol`, else its own name, as a call to it is
    /// lowered.
    fn intrinsic_named_by(&self, expression: NodeId) -> Option<String> {
        let name = self.through_parentheses(expression);
        if self.kind_of(name) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let symbol = self.node(name).symbol?;
        let declaration = *self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .first()?;
        self.intrinsic_declared_by(declaration)
    }

    /// The same backend-owned helper whether the declaration is called,
    /// probed with `typeof`, or passed as a function value.
    pub(super) fn intrinsic_declared_by(&self, declaration: NodeId) -> Option<String> {
        let native = self.node(declaration).native.as_ref()?;
        if native.abi.as_deref() != Some("intrinsic")
            || self.has_a_body(self.implementation_of(declaration))
        {
            return None;
        }
        native
            .symbol
            .clone()
            .or_else(|| self.declared_name(declaration))
    }

    pub(super) fn lower_typeof(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let operand = *self
            .children(id)
            .first()
            .ok_or_else(|| self.unsupported(id, "`typeof` with no operand"))?;
        if let Some(result) = self.guarded_var_typeof(id, operand) {
            return result;
        }
        if let Some(kind) = self.literal_method_typeof(id, operand)? {
            return Ok(kind);
        }
        // A read the checker calls a number -- a string record's entry, a
        // `!` -- is `undefined` where nothing is there: it arrives erased, and
        // the tag answers (`claimed_reads`).
        let answer = self
            .typeof_from_the_checkers_type(operand)
            .filter(|_| !claimed_reads::stays_erased(self, operand))
            .ok_or_else(|| {
                self.unsupported(
                    id,
                    "`typeof` on a value whose type is not a single primitive, which needs a \
                 runtime tag",
                )
            });
        // **The operand runs, whatever the answer is.** `typeof` evaluates it
        // (ECMA-262's `UnaryExpression : typeof UnaryExpression` begins by
        // evaluating the operand), and only a bare `null` or `undefined` keyword
        // has nothing to evaluate -- those two also having no representation to
        // lower into, which is why they are the exemption rather than a special
        // case. The value is discarded: the answer is the constant above, and DCE
        // removes the evaluation where it has no effects.
        if let Ok(answer) = answer {
            if !self.operand_has_no_effects(operand) {
                self.lower_expression(operand)?;
            }
            let origin = self.origin(id);
            return Ok(self.push(
                OpKind::ConstString(answer.to_owned().into()),
                HirType::Managed(ManagedType::String),
                origin,
            ));
        }
        // An erased value *has* the runtime tag the message above asks for, and
        // reading it is what `typeof` means. The tag is an integer and the
        // expression's type is a string, so it goes through `nts_tag_name`.
        //
        // Almost every use is `typeof v === "number"`, which this turns into a
        // string allocation and a string comparison where an integer compare
        // would do. That fold is a peephole -- match the comparison, replace it
        // with `TagOf == constant` -- and it is deliberately not here: it is an
        // optimization over correct code rather than a special case inside the
        // lowering, and doing it here would put the tag table in two places.
        if answer.is_err() {
            let value = self.lower_expression(operand)?;
            // A representation `typeof` can answer from, with no tag to read.
            //
            // A class instance is `"object"`, a closure is `"function"`, an
            // array is `"object"` -- the *representation* says which, and it
            // says so at compile time. This used to refuse anything the checker
            // did not call a single primitive, which meant refusing `typeof obj
            // === "object"` on an object.
            //
            // Only where the type admits no absence. A `T | undefined` is one
            // pointer whose answer differs by what it holds -- `"object"` or
            // `"undefined"` -- and that is a runtime question this cannot fold.
            if self.values[value.0 as usize].ty != HirType::Erased
                && self
                    .absences_of(operand)
                    .is_some_and(|absent| absent.is_empty())
                && let Some(spelling) = self.spelling_for(&self.values[value.0 as usize].ty)
            {
                let origin = self.origin(id);
                return Ok(self.push(
                    OpKind::ConstString(spelling.to_owned().into()),
                    HirType::Managed(ManagedType::String),
                    origin,
                ));
            }
            // One absence and a pointer: two answers, chosen by whether the
            // pointer is there. `typeof callback` on a `Callback | undefined`
            // is "undefined" or "function", and the profile asks it that way
            // twenty-odd times -- `if (typeof callback === "function")` is how
            // an optional callback is checked.
            //
            // A branch rather than a tag, because a pointer has no tag. Where
            // there are *two* absences the type is erased and the tag path
            // below answers it.
            if let Some(absent) = self.absences_of(operand)
                && let [only] = absent.as_slice()
                && let Some(present) = self.spelling_for(&self.values[value.0 as usize].ty)
                && self.values[value.0 as usize].ty != HirType::Erased
            {
                let missing = if *only == crate::hir::tags::NULL {
                    "object"
                } else {
                    "undefined"
                };
                let text = HirType::Managed(ManagedType::String);
                let origin = self.origin(id);
                let when_absent = self.push(
                    OpKind::ConstString(missing.to_owned().into()),
                    text.clone(),
                    origin.clone(),
                );
                let when_present =
                    self.push(OpKind::ConstString(present.to_owned().into()), text, origin);
                let Some(condition) = self.absence_of(id, value) else {
                    return Err(self.unsupported(id, "`typeof` on a value with no absence to test"));
                };
                return self.lower_branching_value(
                    id,
                    condition,
                    Branch::Value(when_absent),
                    Branch::Value(when_present),
                );
            }
            if self.values[value.0 as usize].ty == HirType::Erased {
                let origin = self.origin(id);
                let tag = self.push(
                    OpKind::TagOf { value },
                    HirType::Int {
                        bits: 32,
                        signed: false,
                    },
                    origin.clone(),
                );
                return Ok(self.runtime_call(
                    "nts_tag_name",
                    vec![tag],
                    HirType::Managed(ManagedType::String),
                    origin,
                ));
            }
        }
        let answer = answer?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::ConstString(answer.to_owned().into()),
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// `ArrayBuffer.isView(x)`: any typed array or a `DataView`.
    ///
    /// The sibling of [`FuncBuilder::decide_is_array`] and decided the same
    /// way, from the *representation* rather than from the syntax. A `View`, a
    /// `DataView` and an `AnyView` are true; every other representation is
    /// false; an erased value is a descriptor comparison at run time.
    ///
    /// Deciding it from `HirType` rather than from `TypeKind` as `isArray`
    /// does, because this family is exactly what `ManagedType` distinguishes
    /// and the schema's kinds do not: `Uint8Array` and `Float64Array` are two
    /// object types there and one answer here. `AnyView` is the case that makes
    /// the point -- the declaration says only `ArrayBufferView`, which is
    /// precisely the set this predicate is true of.
    pub(super) fn decide_is_view(
        &mut self,
        id: NodeId,
        argument: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let subject = self.lower_expression(argument)?;
        let origin = self.origin(id);
        let answer = match &self.values[subject.0 as usize].ty {
            HirType::Managed(
                ManagedType::View(_) | ManagedType::AnyView | ManagedType::DataView,
            ) => true,
            // Open, so the descriptor decides. An `unknown` holding a
            // `Uint8Array` is the shape `string_decoder` guards its input with,
            // and it is the whole reason this is not a constant.
            HirType::Erased => {
                return Ok(self.call_runtime(
                    "nts_value_is_view",
                    vec![subject],
                    HirType::Bool,
                    &origin,
                ));
            }
            _ => false,
        };
        Ok(self.push(OpKind::ConstBool(answer), HirType::Bool, origin))
    }

    /// `nts_is_array` on the erased value: the answer for every type that does
    /// not decide the question statically.
    ///
    /// One function because two arms ask it -- an open type (`any`, `unknown`, a
    /// union, a type parameter) and TypeScript's `object` -- and a second copy of
    /// the erase-then-call is how the two would come to disagree about which
    /// absence the erase carries.
    fn ask_the_runtime_is_array(&mut self, id: NodeId, subject: ValueId) -> ValueId {
        let origin = self.origin(id);
        let erased = match self.values[subject.0 as usize].ty {
            HirType::Erased => subject,
            _ => self.push(
                OpKind::Erase {
                    value: subject,
                    absent: Absent::Impossible,
                    slots: Absent::Impossible,
                },
                HirType::Erased,
                origin.clone(),
            ),
        };
        self.call_runtime("nts_is_array", vec![erased], HirType::Bool, &origin)
    }

    pub(super) fn decide_is_array(
        &mut self,
        id: NodeId,
        argument: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let subject = self.lower_expression(argument)?;
        let ty = self
            .snapshot
            .node_types
            .get(&argument)
            .copied()
            .ok_or_else(|| self.unsupported(id, "`Array.isArray` of a value with no type"))?;
        let record = self
            .snapshot
            .types
            .get(ty.0 as usize)
            .ok_or_else(|| self.unsupported(id, "`Array.isArray` of an unknown type"))?;
        let answer = match &record.kind {
            // A tuple *is* an Array: `Array.isArray([1, "a"])` is true, however
            // this compiler chooses to lay it out -- a heterogeneous one is a
            // struct here and still an Array in the language.
            TypeKind::Array(_) | TypeKind::Tuple(_) => true,
            // Open, and decided at runtime. An erased value carries a
            // reference tag, a header carries a descriptor, and the
            // descriptor's KIND is the fact: an ordinary array is
            // `NTS_KIND_ARRAY` and a typed array is an `NTS_KIND_OBJECT` named
            // "TypedArray", which is exactly the line node draws.
            //
            // This was refused for as long as it has existed, and the refusal
            // named its cause correctly: `number[]` and `Float64Array` were one
            // representation -- one `Managed(Array(Float { bits: 64 }))`, one
            // `nts_desc_double`, one address -- and node answers `true` for the
            // first and `false` for the second. It ended by saying that closing
            // it "means carrying the distinction into the HIR type, which is
            // what `ManagedType::Array` deliberately does not do".
            //
            // `ManagedType::View` does. The refusal became false the hour that
            // landed and stayed on the site for the rest of the day, which is
            // the fourth time a comment has outlived the condition it describes
            // and been found by something other than reading it -- here, a
            // build log from another session listing it as one of five roots
            // under `ERR_INVALID_ARG_TYPE`. A refusal is a claim and it ages.
            // **A type parameter, which specialization has already made
            // concrete.** The checker's type at this node is still `T`, so the
            // catch-all below answered `false` for every instantiation:
            //
            // ```ts
            // function check<T>(x: T): boolean { return Array.isArray(x); }
            // check([1])   // node says true, this said false
            // ```
            //
            // `Substitution` maps a `TypeId` to a *representation*, not to
            // another `TypeId`, so there is no concrete checker type to read
            // here — the representation is the only concrete thing, and by
            // this point it is `isArray<str>`'s or `isArray<[f64]>`'s rather
            // than the parameter's.
            //
            // A tuple is still an `Array` in the language and is an object
            // here, which is why the object arm asks the snapshot rather than
            // answering `false`: `Managed(Object(at))` carries the id, so the
            // one thing the representation cannot say on its own is available
            // one lookup away. A typed array is a `View` and is correctly not
            // an Array.
            //
            // Found by probing `instanceof Array` against node, which routes
            // here; the same defect was live in `Array.isArray` and had no
            // corpus file to report it.
            TypeKind::TypeParameter { .. }
                if !matches!(self.values[subject.0 as usize].ty, HirType::Erased) =>
            {
                match &self.values[subject.0 as usize].ty {
                    HirType::Managed(ManagedType::Array(_) | ManagedType::Template) => true,
                    HirType::Managed(ManagedType::Object(at)) => matches!(
                        self.snapshot.types.get(at.0 as usize).map(|r| &r.kind),
                        Some(TypeKind::Tuple(_))
                    ),
                    _ => false,
                }
            }
            // [`TypeKind::Evolving`] beside `Any`, because it was one of them until
            // the two were split and **nothing here may fold on a declaration the
            // checker has not settled**. Dropping it to the catch-all below is the
            // constant `false` the comment under this arm is about, 28 of 58 cases
            // differing from node -- and `const growing = []; ...; Array.isArray(
            // growing)` is the shape that reaches it. What the assignments settle on
            // could fold this to `true`, which is better and is a separate question:
            // asking the runtime is what it did before the split and is correct.
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            TypeKind::Any
            | TypeKind::Evolving
            | TypeKind::Unknown
            | TypeKind::Union(_)
            | TypeKind::TypeParameter { .. } => {
                return Ok(self.ask_the_runtime_is_array(id, subject));
            }
            // **TypeScript's `object`, which includes an array.** It is what
            // `typeof x === "object" && x !== null` narrows an `unknown` to, so
            // this is the type at every `Array.isArray` written after that
            // guard -- which is how React's reconciler asks the question, four
            // times, for every element with more than one child.
            //
            // It reached the catch-all below and folded to a **constant
            // `false`**, so an array child was read as an element at the
            // element's offsets: a silent miscompile, 28 of 58 cases differing
            // from node, and a segfault in `nts_retain` further down. The same
            // program with the `isArray` asked *before* the `typeof` is correct,
            // which is what makes it look like a narrowing bug and is not one --
            // the narrowed type simply is not one this arm knew.
            //
            // The fact is already written beside [`Self::is_the_object_type`]:
            // "`object` includes an array, a `Map`, a `Set`, a `Promise` and a
            // `Date`". Asked through that predicate rather than by testing the
            // flag a fourth time -- `NON_PRIMITIVE` is spelled out three times
            // in this compiler already.
            //
            // `{}` and an empty `interface` arrive as a *different* record --
            // `TypeKind::Object` with no properties -- and an array is assignable
            // to both, so they carry the same hazard and the same measurement: 28
            // of 29 cases differing from node through a `{}` parameter and through
            // an empty interface alike.
            //
            // **Where this stops, and why it is a stop rather than a line.** A
            // *non-empty* object type can be inhabited by an array too -- an array
            // satisfies `{ readonly length: number }`, and `runtime/node` reaches
            // that shape 212 times -- so `Array.isArray` of one is wrong here in
            // exactly the same way. It is not in this arm because widening to
            // every object type stops folding the question, and an
            // `if (Array.isArray(x))` that no longer folds has its branch
            // *lowered*: refusals can rise, which is a corpus measurement and not
            // a guess. The narrow arm is a fix; the wide one is a commit with a
            // census.
            TypeKind::NonPrimitive => {
                return Ok(self.ask_the_runtime_is_array(id, subject));
            }
            TypeKind::Object { properties } if properties.is_empty() => {
                return Ok(self.ask_the_runtime_is_array(id, subject));
            }
            // Everything else is not an Array, `Uint8Array` included -- which
            // the runtime test above now agrees with rather than contradicts.
            // While a typed array was represented as an array, this arm and
            // that one would have disagreed about the same value, and that
            // disagreement is what the refusal was protecting.
            _ => false,
        };
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstBool(answer), HirType::Bool, origin))
    }
}

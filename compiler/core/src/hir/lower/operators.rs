//! Lower unary, binary, numeric, bitwise, and comparison operators and their width/representation choices.

use super::{
    BinOp, Diagnostic, FuncBuilder, HirType, ManagedType, NodeData, NodeId, NumberHint, OpKind,
    Origin, UnOp, ValueId, compound_operator, logical_assignment, spelling, syntax,
};

/// Whether a comparison token is the strict one.
pub(super) const fn strict_operator(token: u16) -> bool {
    matches!(
        token,
        syntax::EQUALS_EQUALS_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
    )
}

/// The bitwise operator a token spells, if it spells one.
const fn bitwise_operator(token: u16) -> Option<BinOp> {
    Some(match token {
        syntax::AMPERSAND_TOKEN => BinOp::BitAnd,
        syntax::BAR_TOKEN => BinOp::BitOr,
        syntax::CARET_TOKEN => BinOp::BitXor,
        syntax::LESS_THAN_LESS_THAN_TOKEN => BinOp::Shl,
        syntax::GREATER_THAN_GREATER_THAN_TOKEN => BinOp::Shr,
        syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_TOKEN => BinOp::UShr,
        _ => return None,
    })
}

/// Whether `==` between these two representations is an honest comparison rather
/// than a coercion this compiler cannot perform.
///
/// The counterpart of `FuncBuilder::coercing_comparison`, which is where the
/// reasoning is. Equality is not enough -- `Int` against `Float` is two numbers --
/// and "both concrete" is far too much, because a coercion between a primitive and
/// a reference is exactly what `ToPrimitive` would do and there is none here.
fn comparable_without_coercing(left: &HirType, right: &HirType) -> bool {
    // **An erased value cannot be shown to agree with anything, including
    // another erased value.** Its representation is a tag and a payload, and the
    // tag is what decides at run time -- so two of them may hold a number and a
    // boolean, which is the case the whole refusal exists for: node answers `1 ==
    // true` with true and `nts_value_strict_eq` answers false.
    //
    // This clause is a **restoration**. The guard here used to be one line on the
    // caller -- `type_of(lhs) == Some(Erased) || type_of(rhs) == Some(Erased)`,
    // "only an erased side can surprise" -- and 093733f2d replaced it with this
    // function to catch four cases that sentence let through (`"1" == 1`, `true ==
    // 1`, `1n == 1`, `true == obj`). It widened the guard and **dropped the case
    // the old one already caught**, because the `discriminant` fallback below is
    // satisfied by two `Erased`s: they are one variant.
    //
    // The cost was 126 of `tooling/sweep`'s 12,093 cases answering as if `==` were
    // `===`, on C, LLVM and the JVM alike, and the `jvm` gate step red for every
    // lane. `outcomes/a-loose-equality-across-kinds-on-unknown` is the guard.
    //
    // Only `==` and `!=` reach here -- `===` is identity and coerces nothing, and
    // `x == null` is the *absence* question, answered before this by the tag pair.
    if matches!(left, HirType::Erased) || matches!(right, HirType::Erased) {
        return false;
    }
    let number = |ty: &HirType| matches!(ty, HirType::Float { .. } | HirType::Int { .. });
    if number(left) && number(right) {
        return true;
    }
    // A `String` is a reference in this representation and a primitive in the
    // language, so it agrees with another string and coerces against anything else
    // that is a reference.
    let string = |ty: &HirType| matches!(ty, HirType::Managed(ManagedType::String));
    if left.holds_a_pointer() && right.holds_a_pointer() {
        return string(left) == string(right);
    }
    // Two of the same scalar kind: `bool == bool`, `bigint == bigint`. Anything
    // else -- a scalar against a reference, a bool against a number, a bigint
    // against a number -- is a coercion.
    std::mem::discriminant(left) == std::mem::discriminant(right)
}

/// Whether an operator needs the `ToInt32` coercions.
pub(super) const fn bitwise_operator_of(op: BinOp) -> bool {
    matches!(
        op,
        BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr
    )
}

impl FuncBuilder<'_> {
    /// `i++` / `i--`, whose value is what the name held *before* the step.
    pub(super) fn lower_postfix_unary(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let NodeData::Children { small, .. } = self.node(id).data else {
            return Err(self.unsupported(id, "a step expression without operator data"));
        };
        let children = self.children(id);
        let [operand] = children.as_slice() else {
            return Err(self.unsupported(id, "a step expression of unexpected shape"));
        };
        // One bit, not the prefix table: `++` is 0 and `--` is 1.
        let op = if small & syntax::postfix_operator::MASK == syntax::postfix_operator::MINUS_MINUS
        {
            BinOp::Sub
        } else {
            BinOp::Add
        };
        let (before, _) = self.step(id, *operand, op)?;
        Ok(before)
    }

    /// A bitwise operator, with its `ToInt32`/`ToUint32` coercions made explicit.
    ///
    /// **Its operands go through [`Self::coerce`] rather than straight into the
    /// coercion op**, and that is not tidiness. TypeScript types `x >>> 4` as
    /// `number` **whatever `x` is**, so an `any` operand is invisible to everything
    /// downstream: the result coerces cleanly, the verifier's operand table does not
    /// know `ToUint32` cannot take an erased value, and the first thing to object is
    /// **clang** -- `incompatible type for argument 1 of 'nts_to_uint32'`, which is
    /// uncompilable C rather than a refusal. 80 recorded test262 built-ins files
    /// reached that state the day `any` gained a representation, every one of them
    /// through `decimalToHexString.js`'s untyped `n`.
    ///
    /// `n + 1` on the same `any` refuses, and only by luck: `any + 1` is `any`, so
    /// the *return* coercion catches it. A bitwise operator hands back a `number` and
    /// leaves nothing later to notice, so the operator is the only place that can --
    /// which is `docs/records/notebooks/any-unknown.md`'s requirement exactly: *"Checker-accepted `any`
    /// allows those operations syntactically, so Native TypeScript must legalize each
    /// one from independent representation evidence before lowering it."* A shift is
    /// one of those operations and the evidence is that the operand is a number.
    pub(super) fn push_bitwise(
        &mut self,
        id: NodeId,
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
        ty: HirType,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        // A `bigint`'s bitwise operators are not JavaScript's. `1n << 40n` is
        // 2^40, where `1 << 40` is 256 -- a number's shift count is masked to
        // five bits and its operands are truncated to int32, and a `bigint` has
        // neither rule. TypeScript will not let the two mix, so the operand type
        // is enough to tell which set applies.
        //
        // Caught by the differential: `x <<= 40n` came back as 1 where node said
        // 2^32, because 40 & 31 is 8.
        if matches!(ty, HirType::BigInt) {
            return Ok(self.push(OpKind::Binary { op, lhs, rhs }, ty, origin.clone()));
        }
        // Both operands, because either can be the erased one: `count >>> n` and
        // `n >>> count` are the same hazard at different indices.
        let lhs = self.coerce(lhs, &HirType::NUMBER, id)?;
        let rhs = self.coerce(rhs, &HirType::NUMBER, id)?;
        let left_coercion = if matches!(op, BinOp::UShr) {
            UnOp::ToUint32
        } else {
            UnOp::ToInt32
        };
        let left = self.push(
            OpKind::Unary {
                op: left_coercion,
                operand: lhs,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let right = self.push(
            OpKind::Unary {
                op: UnOp::ToInt32,
                operand: rhs,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        Ok(self.push(
            OpKind::Binary {
                op,
                lhs: left,
                rhs: right,
            },
            ty,
            origin.clone(),
        ))
    }

    /// What `a + b` is when the checker typed it `any`: decided by what the
    /// operands are, as JavaScript decides it. Two numbers add, a string on
    /// either side concatenates, two bigints add; anything else stays erased.
    /// One rule for `+` and `+=`.
    pub(super) fn plus_from_operands(&self, lhs: ValueId, rhs: ValueId) -> Option<HirType> {
        let (left, right) = (
            &self.values[lhs.0 as usize].ty,
            &self.values[rhs.0 as usize].ty,
        );
        let string = HirType::Managed(ManagedType::String);
        if *left == HirType::NUMBER && *right == HirType::NUMBER {
            Some(HirType::NUMBER)
        } else if *left == string || *right == string {
            Some(string)
        } else if *left == HirType::BigInt && *right == HirType::BigInt {
            Some(HirType::BigInt)
        } else {
            None
        }
    }

    /// `true + 1` is `2`: once both operands of `+` are primitives and
    /// neither is a string, `+` adds their numeric values (ECMA-262 13.15.3),
    /// and a boolean's is the `convert` that `Number(b)` lowers to. Booleans
    /// beside numbers or each other only: anything else is left for the
    /// operator to decide as before.
    pub(super) fn booleans_as_numbers(
        &mut self,
        at: NodeId,
        lhs: ValueId,
        rhs: ValueId,
    ) -> (ValueId, ValueId) {
        let ty = |value: ValueId| self.values[value.0 as usize].ty.clone();
        let numeric = |ty: &HirType| *ty == HirType::Bool || *ty == HirType::NUMBER;
        let (left, right) = (ty(lhs), ty(rhs));
        if !(numeric(&left) && numeric(&right)) || (left != HirType::Bool && right != HirType::Bool)
        {
            return (lhs, rhs);
        }
        let origin = self.origin(at);
        let mut number = |value: ValueId, ty: &HirType| {
            if *ty == HirType::Bool {
                self.push(OpKind::Convert(value), HirType::NUMBER, origin.clone())
            } else {
                value
            }
        };
        (number(lhs, &left), number(rhs, &right))
    }

    /// Whether a loose comparison between these two could coerce.
    ///
    /// It can when either side is erased: the runtime types are then not known
    /// to agree, and JavaScript's abstract equality converts before comparing.
    /// Where both sides have the same concrete representation there is nothing
    /// to convert and `==` is `===`.
    pub(super) fn coercing_comparison(&self, lhs: NodeId, rhs: NodeId) -> bool {
        // `x == null` and `x == undefined` are the *absence* question, whatever
        // the other side is represented as, and they are answered correctly
        // above -- by the tag pair for an erased value and by the null pointer
        // for a reference. They are also the only loose comparison real code
        // writes: 273 of them in the node profile.
        let absent = |node: NodeId| {
            self.kind_of(node) == Some(syntax::NULL_KEYWORD) || self.is_the_undefined_literal(node)
        };
        if absent(lhs) || absent(rhs) {
            return false;
        }
        // **"Two concrete representations that reach here already agree" was the
        // sentence here, and it is false.** It rested on the checker rejecting a
        // comparison between types that do not agree, which it does under `strict`
        // -- and a `@ts-expect-error`, a JavaScript file, or any of the coercion
        // tests test262 is full of goes straight past it. What arrives then is two
        // representations the language says to *coerce* between, and this compiler
        // has no `ToPrimitive`:
        //
        //     true == obj   a boolean against an object -- `Symbol.toPrimitive` is
        //                   never called, so the object's own answer is ignored and
        //                   the comparison is false. Silent.
        //     "1" == 1      a string against a number -- `nts_string_eq` given a
        //                   double, which the verifier passes and clang rejects.
        //     true == 1     a boolean against a number -- invalid HIR, MixedOperands.
        //     1n == 1       a bigint against a number -- invalid HIR.
        //
        // The first is the only *quiet* one and it is the one this sentence let
        // through; the other three are loud and were loud for the same reason. All
        // four are one question -- do the two sides share a representation -- so
        // they get one answer.
        //
        // What may be compared without coercing, which is narrower than "concrete"
        // and wider than "equal":
        //
        //   * two numbers, `Int` and `Float` together, because that pair is what
        //     `agree_on_one_integer_width` exists to reconcile;
        //   * two of the same scalar kind;
        //   * two **references**, which `==` compares by identity and never
        //     coerces -- a `Circle` against a `Square` is a pointer comparison and
        //     an honest `false`, and refusing it would take every `a === b` in the
        //     corpus with it. Except a `String`, which is a reference here and a
        //     *primitive* in the language: an object on the other side of it
        //     coerces.
        let side = |node: NodeId| self.type_of(node);
        let (Some(left), Some(right)) = (side(lhs), side(rhs)) else {
            // No representation at all for one side: it cannot be shown to agree,
            // so it is not compared without coercing. An *erased* side is no
            // longer this case -- it has a representation and is refused by
            // `comparable_without_coercing`'s first clause, which is where the
            // reason belongs now.
            return true;
        };
        !comparable_without_coercing(&left, &right)
    }

    /// `-x`, `+x`, `!x`.
    ///
    /// # The operator is not a child
    ///
    /// A `BinaryExpression` holds its operator as a real token node, so
    /// [`Self::children`] returns it. A `PrefixUnaryExpression` does not: the
    /// syntax adapter stores the operator as a `Kind` *field*, which the encoder packs into the
    /// node's small data as a dense index — see
    /// [`syntax::prefix_operator`] for why that index is not a `SyntaxKind`
    /// however firmly the encoder's documentation says it is. The only child is
    /// the operand.
    ///
    /// Unary `+` is `ToNumber`, which [`Self::coerce_to_number`] answers for
    /// every type rather than only for the one where it is the identity.
    pub(super) fn lower_prefix_unary(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let NodeData::Children { small, .. } = self.node(id).data else {
            return Err(self.unsupported(id, "a unary expression without operator data"));
        };
        let children = self.children(id);
        let [operand] = children.as_slice() else {
            return Err(self.unsupported(id, "a unary expression of unexpected shape"));
        };

        // `++i` and `--i` step the name and evaluate to the *new* value, which
        // is the only way they differ from the postfix forms.
        if matches!(
            small & syntax::prefix_operator::MASK,
            syntax::prefix_operator::PLUS_PLUS | syntax::prefix_operator::MINUS_MINUS
        ) {
            let op =
                if small & syntax::prefix_operator::MASK == syntax::prefix_operator::MINUS_MINUS {
                    BinOp::Sub
                } else {
                    BinOp::Add
                };
            let (_, after) = self.step(id, *operand, op)?;
            return Ok(after);
        }

        // `~x` is `ToInt32(x) ^ -1`, which is what the specification says it is
        // and what makes it a bitwise operator rather than an arithmetic one:
        // the coercion is the whole of its behaviour on a non-integer, and
        // `~3.7` is `-4` for that reason rather than by rounding.
        if small & syntax::prefix_operator::MASK == syntax::prefix_operator::TILDE {
            let value = self.lower_expression(*operand)?;
            let origin = self.origin(id);
            let ones = self.push(OpKind::ConstFloat(-1.0), HirType::NUMBER, origin.clone());
            return self.push_bitwise(id, BinOp::BitXor, value, ones, HirType::NUMBER, &origin);
        }

        let op = match small & syntax::prefix_operator::MASK {
            syntax::prefix_operator::PLUS => None,
            syntax::prefix_operator::MINUS => Some(UnOp::Neg),
            syntax::prefix_operator::EXCLAMATION => Some(UnOp::Not),
            // `++`/`--` assign, and are handled above.
            _ => return Err(self.unsupported(id, "this unary operator")),
        };

        let value = self.lower_expression(*operand)?;
        // Unary `+` is `ToNumber`, and `ToNumber` of a `number` is the identity
        // -- including on `-0`, which is why it is returned rather than lowered
        // to an operation that would have to preserve the sign of zero. That
        // identity is one arm of the conversion and not the whole of it:
        // returning the operand for *every* type answered a string with the
        // string, and the backend then emitted `(double)v1` on a pointer.
        let Some(op) = op else {
            if self.plus_of_a_bigint(id) {
                return self.throw_to_number_of_a_bigint(id);
            }
            return self.coerce_to_number(id, *operand, value);
        };
        // `!x` is `ToBoolean(x)` negated, and `ToBoolean` is a *rule* rather
        // than a representation change: `""`, `0`, `NaN`, `null` and
        // `undefined` are false and every other value is true.
        //
        // Lowering `Not` straight onto the operand left a `bool` operation over
        // whatever the operand was, and the passes below made the types agree
        // the only way they can -- by inserting a `Convert`. On an erased value
        // that is `(bool)v` over a sixteen-byte struct, which the C compiler
        // refuses: `operand of type 'NtsValue' where arithmetic or pointer type
        // is required`, eight times in `stream`, eight in `fs`, three each in
        // `events` and `assert`. It was the most common remaining error in the
        // node profile once the layout-name collisions stopped hiding it.
        //
        // `truthy` is the rule and is already emitted for `&&`, `||` and every
        // `if`; every backend has an arm for it. This operator was the one that
        // did not ask.
        let value = if op == UnOp::Not {
            self.truthy(id, value)
        } else if op == UnOp::Neg && !matches!(self.values[value.0 as usize].ty, HirType::BigInt) {
            // **`-x` is `ToNumeric(x)` negated**, and unary `+` two arms up is
            // the same conversion with nothing to do afterwards. It had the
            // coercion and this did not, so `-"3"` negated a *pointer*: the
            // backend emitted `(double)v0` on an `NtsString *`, which clang
            // rejects and `emit-c` refused nothing about. The comment above
            // describes that exact symptom, for `+`, one operator over.
            //
            // A `bigint` is the arm `ToNumeric` keeps: `-1n` is a bigint and
            // `ToNumber` of one is a `TypeError`, so it is negated as it is.
            // One held erased stops by name instead (`erased_to_number`).
            let erased_object = self.values[value.0 as usize].ty == HirType::Erased
                && !self.only_primitives(*operand);
            match erased_object
                .then(|| self.erased_to_number(id, value, NumberHint::Numeric))
                .transpose()?
                .flatten()
            {
                Some(number) => number,
                None => self.coerce_to_number(id, *operand, value)?,
            }
        } else {
            value
        };
        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a unary expression"))?;
        Ok(self.push(OpKind::Unary { op, operand: value }, ty, origin))
    }

    /// `void e`, which evaluates its operand and answers `undefined`.
    ///
    /// The operand is lowered for its effects and dropped: `void f()` calls `f`.
    /// Not folded away even where it cannot have any, because deciding that is
    /// dead-code elimination's job and it already does it -- this lowering
    /// stating "the value is discarded" is the whole of what `void` means.
    ///
    /// `void 0` is the idiom this exists for, and it is `undefined` rather than
    /// a number: the operand's *type* does not reach the result.
    /// `void e`: evaluate `e`, answer `undefined`.
    ///
    /// **The answer takes the slot's type where the slot has one**, which is
    /// the same rule `lower_absent` follows and for the same reason: `void 0`
    /// *is* the `undefined` literal in every program that writes it, and a
    /// `HirType::Void` cannot be concatenated. `void 0 + ""` refused with ``a
    /// conversion to string from a representable type`` -- a sentence about
    /// `Void`, which is a representation nothing can convert, rather than about
    /// the program.
    ///
    /// Only a *managed* expectation is taken. A numeric one would be a lie:
    /// `void 0` is not a number, and the checker will not have asked for one.
    pub(super) fn lower_void(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let operand = *self
            .children(id)
            .first()
            .ok_or_else(|| self.unsupported(id, "a `void` with no operand"))?;
        self.lower_expression(operand)?;
        let origin = self.origin(id);
        let ty = self
            .contextual_type(id, 0)
            .or_else(|| self.expecting.clone())
            .filter(|ty| matches!(ty, HirType::Erased) || ty.is_managed())
            .unwrap_or(HirType::Void);
        Ok(self.push(OpKind::ConstUndefined, ty, origin))
    }

    /// **A relational operator over objects compared their addresses**, and
    /// it was a wrong answer that ran rather than a refusal.
    ///
    /// `a > b` where both are class instances is `ToPrimitive` on each --
    /// `valueOf` first for a relational comparison, then `toString` -- and
    /// this compiler has neither. What it emitted was `gt %1, %7` on two
    /// `object.new` pointers: `class Celsius { valueOf() { return this.degrees } }`
    /// answered `a > b` **true for every input** where node answers from the
    /// degrees, disagreeing on 29 of 29 cases.
    ///
    /// TypeScript permits it -- `>` between two objects is not a type error
    /// the way `o + 1` (TS2365) and `"1" == 1` (TS2367) are -- so this is one
    /// of the few `ToPrimitive` shapes a checking program can even write, and
    /// the only one that was not already refused.
    ///
    /// Numbers, strings and `bigint` are untouched: they have no `valueOf`
    /// step to skip, and a string comparison is the one this table has always
    /// answered correctly.
    /// The operands a relational comparison actually compares.
    ///
    /// `a > b` where either side is an object is `ToPrimitive` on each, hint
    /// `number` -- and for a *typed* receiver that is a static dispatch,
    /// because `valueOf` and `toString` are members this compiler already puts
    /// on the descriptor. Everything else is returned unchanged.
    /// The operands of an operator that needs numbers, which have to be numbers.
    ///
    /// The sibling of [`Self::relational_operands`], and refusing here rather than
    /// later is the whole of it: `n + 1` on an `any` happens to refuse, because
    /// `any + 1` is `any` and the *return* coercion catches it, but that is luck.
    /// `let x = x + 1` assigns back into an `any` and there is no later coercion at
    /// all, so the `Add` reached `verify` as `OperandType { found: Erased }` -- which
    /// costs the **whole program** rather than one function, and took two recorded
    /// test262 negatives from a recorded `fail` to no verdict.
    ///
    /// `HirType::NUMBER` and **not** the result type, which was the first version
    /// and closed nothing: where both operands are erased the result is erased too,
    /// so coercing to it is a no-op. What an arithmetic operator needs is a number,
    /// whatever it happens to produce -- and that is the honest answer semantically
    /// as well, since JavaScript's `+` on two values of unknown type may be
    /// concatenation and `BinOp::Add` is not. The checker spells the provable case
    /// `Concat`; where it can prove neither, guessing is what a refusal is for.
    ///
    /// **The four relational operators are here beside the five arithmetic ones**,
    /// and for the same reason rather than by analogy: `n > 0` on an erased `n`
    /// reached `verify` as `OperandType { op: ">", found: Erased }`, which is invalid
    /// HIR and costs the whole program. The language compares two non-strings
    /// numerically, and an erased operand is not provably a string -- so asking for a
    /// number is both what the operator needs and what cannot be shown. A
    /// pair of concrete strings remains lexical, so `"a" < "b"` still lowers.
    ///
    /// `==` and `!=` are deliberately **not** here: an erased operand is answered
    /// there rather than refused, by the absence test and by
    /// `comparable_without_coercing`, which is a different and narrower question.
    ///
    /// Source copies can expose concrete strings in numeric operations. They use
    /// the existing `ToNumber`; other concrete operands keep their representation.
    /// `Concat` uses `as_string` before reaching this helper.
    fn numeric_operands(
        &mut self,
        id: NodeId,
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<(ValueId, ValueId), Diagnostic> {
        if !matches!(
            op,
            BinOp::Add
                | BinOp::Sub
                | BinOp::Mul
                | BinOp::Div
                | BinOp::Rem
                | BinOp::Lt
                | BinOp::Le
                | BinOp::Gt
                | BinOp::Ge
        ) {
            return Ok((lhs, rhs));
        }
        if matches!(op, BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge)
            && self.values[lhs.0 as usize].ty == HirType::Managed(ManagedType::String)
            && self.values[rhs.0 as usize].ty == HirType::Managed(ManagedType::String)
        {
            return Ok((lhs, rhs));
        }
        let numeric = |builder: &mut Self, value: ValueId| match builder.values[value.0 as usize].ty
        {
            HirType::Erased => builder.coerce(value, &HirType::NUMBER, id),
            // A scalar source copy can expose a string at an arithmetic
            // operand. Use the same ToNumber as Number() and unary +.
            HirType::Managed(ManagedType::String) => builder.coerce_to_number(id, id, value),
            _ => Ok(value),
        };
        let lhs = numeric(self, lhs)?;
        let rhs = numeric(self, rhs)?;
        Ok((lhs, rhs))
    }

    /// Which [`BinOp`] a binary token is, given what the expression produces.
    ///
    /// Two of these depend on more than the token, which is why it is not a `const`
    /// function over the token alone: `+` is arithmetic on numbers and concatenation
    /// on strings, and `==` is refused where the two sides would have to be coerced.
    fn binary_op_for(
        &mut self,
        id: NodeId,
        operator: NodeId,
        lhs_node: NodeId,
        rhs_node: NodeId,
        token: u16,
        ty: &HirType,
    ) -> Result<BinOp, Diagnostic> {
        Ok(match token {
            syntax::EQUALS_TOKEN => unreachable!("assignment is handled before this"),
            syntax::PLUS_TOKEN if ty.is_managed() => BinOp::Concat,
            syntax::PLUS_TOKEN => BinOp::Add,
            syntax::MINUS_TOKEN => BinOp::Sub,
            syntax::ASTERISK_TOKEN => BinOp::Mul,
            syntax::SLASH_TOKEN => BinOp::Div,
            syntax::PERCENT_TOKEN => BinOp::Rem,
            syntax::LESS_THAN_TOKEN => BinOp::Lt,
            syntax::LESS_THAN_EQUALS_TOKEN => BinOp::Le,
            syntax::GREATER_THAN_TOKEN => BinOp::Gt,
            syntax::GREATER_THAN_EQUALS_TOKEN => BinOp::Ge,
            // `==` and `===` differ only by coercion, and where both operands
            // have the same representation the two agree exactly -- number
            // against number, string against string. The checker rejects most
            // mismatches under `strict`, which is what made this safe.
            //
            // It does not reject `unknown == unknown`, and there the runtime
            // types can differ and coercion is the whole question: node answers
            // `1 == true` with true, `[1] == 1` with true, and `null ==
            // undefined` with true. This lowered all three to
            // `nts_value_strict_eq` and answered false. Refused rather than
            // answered wrongly -- see the loose-equality note in section 1.
            //
            // `x == null` does not come through here: it is the *absence*
            // question and `erased_absence_test` answered it above, correctly,
            // which is the one loose comparison real code writes.
            syntax::EQUALS_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_TOKEN
                if self.coercing_comparison(lhs_node, rhs_node) =>
            {
                return Err(self.unsupported(
                    id,
                    "`==` between values whose types are not known to agree, which \
                     coerces -- and this compiler has no `ToPrimitive` to coerce with",
                ));
            }
            syntax::EQUALS_EQUALS_TOKEN | syntax::EQUALS_EQUALS_EQUALS_TOKEN => BinOp::Eq,
            syntax::EXCLAMATION_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN => BinOp::Ne,
            kind => {
                return Err(self.unsupported(operator, &format!("the operator {}", spelling(kind))));
            }
        })
    }

    /// Preserve strict equality's erased contract when a positional copy
    /// recovers one side, or different primitive kinds. Written native integer
    /// types retain the existing width reconciliation in `relational_operands`.
    fn erased_equality_operands(
        &mut self,
        token: u16,
        nodes: [NodeId; 2],
        values: (ValueId, ValueId),
    ) -> Result<(ValueId, ValueId), Diagnostic> {
        let (lhs, rhs) = values;
        let strict = matches!(
            token,
            syntax::EQUALS_EQUALS_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
        );
        // **A bigint against an erased value is compared erased.** The backends
        // spell a mixed `Eq` for the primitives they have an arm for -- a
        // string, a number, a boolean against an `NtsValue` -- and a bigint is
        // not one of them: `items[1] === 1n << 100n` over an `unknown[]` emitted
        // C's `==` between an `NtsValue` and an `__int128`, which clang refuses.
        // Erasing the bigint makes it the erased comparison, which compares a
        // bigint by value.
        let (left, right) = (
            &self.values[lhs.0 as usize].ty,
            &self.values[rhs.0 as usize].ty,
        );
        if strict
            && matches!(
                (left, right),
                (HirType::Erased, HirType::BigInt) | (HirType::BigInt, HirType::Erased)
            )
        {
            return Ok((
                self.coerce(lhs, &HirType::Erased, nodes[0])?,
                self.coerce(rhs, &HirType::Erased, nodes[1])?,
            ));
        }
        // **Two values of different `typeof` kinds are compared erased too.**
        // Unchecked JavaScript reaches `===` with any pair -- test262 compares
        // a bigint with a symbol, and `1 === true` is a `number` against a
        // `boolean` -- and neither side is erased, so this returned them as
        // they were: an `Eq` the verifier refuses as mixed operands for the
        // scalars, and for a bigint against a reference one it accepted, which
        // C answered by luck and the JVM could not load. Erased, the comparison
        // reads the tags first and answers `false`, as node does.
        //
        // The kinds are the *checker's*, not the representations': a `c_long`
        // is a bigint held as an `i64`, which the representation calls a
        // number, and `slot.value === low` between one and a branded bigint is
        // a comparison of values that `relational_operands` widens. A branded
        // scalar is an intersection, which names no single kind, so it never
        // reaches this. Two pointers keep the identity comparison below.
        let kinds = (
            self.typeof_from_the_checkers_type(nodes[0]),
            self.typeof_from_the_checkers_type(nodes[1]),
        );
        let (left, right) = (
            &self.values[lhs.0 as usize].ty,
            &self.values[rhs.0 as usize].ty,
        );
        if strict
            && matches!(kinds, (Some(a), Some(b)) if a != b)
            && *left != HirType::Erased
            && *right != HirType::Erased
            && !(left.holds_a_pointer() && right.holds_a_pointer())
        {
            return Ok((
                self.coerce(lhs, &HirType::Erased, nodes[0])?,
                self.coerce(rhs, &HirType::Erased, nodes[1])?,
            ));
        }
        if !strict
            || self.values[lhs.0 as usize].ty == self.values[rhs.0 as usize].ty
            || self.values[lhs.0 as usize].ty == HirType::Erased
            || self.values[rhs.0 as usize].ty == HirType::Erased
            || (self.values[lhs.0 as usize].ty.holds_a_pointer()
                && self.values[rhs.0 as usize].ty.holds_a_pointer())
            || !nodes.into_iter().any(|node| {
                self.snapshot
                    .node_types
                    .get(&node)
                    .and_then(|ty| self.represent(*ty))
                    == Some(HirType::Erased)
            })
        {
            return Ok(values);
        }
        Ok((
            self.coerce(lhs, &HirType::Erased, nodes[0])?,
            self.coerce(rhs, &HirType::Erased, nodes[1])?,
        ))
    }

    fn relational_operands(
        &mut self,
        id: NodeId,
        op: BinOp,
        lhs_node: NodeId,
        rhs_node: NodeId,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<(ValueId, ValueId), Diagnostic> {
        // Widths first, and before the early return, because **every** binary
        // operation needs its two sides to be one type -- not only the relational
        // ones this function was written for. `Eq` took the early return and was
        // the case that broke.
        let (lhs, rhs) = self.agree_on_one_integer_width(id, lhs, rhs);
        if !matches!(op, BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge)
            || !self.compares_objects(lhs, rhs)
        {
            return Ok((lhs, rhs));
        }
        let converted = (
            self.ordinary_to_primitive(id, lhs_node, lhs)?,
            self.ordinary_to_primitive(id, rhs_node, rhs)?,
        );
        // Both sides have to land on one representation, and nothing here is
        // entitled to pick. `valueOf(): number` on one and `toString(): string`
        // on the other is a comparison between a double and a pointer, which
        // the specification answers by converting again and this does not do.
        let (left, right) = (
            self.values[converted.0.0 as usize].ty.clone(),
            self.values[converted.1.0 as usize].ty.clone(),
        );
        if left != right {
            return Err(self.unsupported(
                id,
                "a relational comparison whose two sides convert to different \
                 primitives, which needs the second conversion the specification \
                 does after the first",
            ));
        }
        Ok(converted)
    }

    fn compares_objects(&self, lhs: ValueId, rhs: ValueId) -> bool {
        [lhs, rhs].iter().any(|value| {
            matches!(
                self.values[value.0 as usize].ty,
                HirType::Managed(ManagedType::Object(_))
            )
        })
    }

    pub(super) fn lower_binary(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // Keep pending ordinary binary operands on the heap. A direct binary
        // child uses this loop; wrappers and special operators still use their
        // existing expression lowering and control-flow handlers.
        enum Pending {
            Left {
                id: NodeId,
                operands: [NodeId; 3],
            },
            Right {
                id: NodeId,
                operands: [NodeId; 3],
                lhs: ValueId,
            },
        }

        let mut pending = Vec::new();
        let mut current = id;
        'descend: loop {
            let children = self.children(current);
            let [lhs_node, operator, rhs_node] = children.as_slice() else {
                return Err(self.unsupported(current, "a binary expression of unexpected shape"));
            };
            let operands = [*lhs_node, *operator, *rhs_node];
            let [lhs_node, _, rhs_node] = operands;

            // Run this node's prefix before either operand, just as recursive
            // lowering does. A special case completes the node itself.
            let mut value = if let Some(result) = self.lower_binary_special(current, operands) {
                result?
            } else {
                if self.kind_of(lhs_node) == Some(syntax::BINARY_EXPRESSION) {
                    pending.push(Pending::Left {
                        id: current,
                        operands,
                    });
                    current = lhs_node;
                    continue;
                }
                let lhs = self.lower_expression(lhs_node)?;
                if self.kind_of(rhs_node) == Some(syntax::BINARY_EXPRESSION) {
                    pending.push(Pending::Right {
                        id: current,
                        operands,
                        lhs,
                    });
                    current = rhs_node;
                    continue;
                }
                let rhs = self.lower_expression(rhs_node)?;
                self.lower_binary_values(current, operands, lhs, rhs)?
            };

            loop {
                match pending.pop() {
                    None => return Ok(value),
                    Some(Pending::Left { id, operands }) => {
                        let rhs_node = operands[2];
                        if self.kind_of(rhs_node) == Some(syntax::BINARY_EXPRESSION) {
                            pending.push(Pending::Right {
                                id,
                                operands,
                                lhs: value,
                            });
                            current = rhs_node;
                            continue 'descend;
                        }
                        let rhs = self.lower_expression(rhs_node)?;
                        value = self.lower_binary_values(id, operands, value, rhs)?;
                    }
                    Some(Pending::Right { id, operands, lhs }) => {
                        value = self.lower_binary_values(id, operands, lhs, value)?;
                    }
                }
            }
        }
    }

    fn lower_binary_special(
        &mut self,
        id: NodeId,
        operands: [NodeId; 3],
    ) -> Option<Result<ValueId, Diagnostic>> {
        let [lhs_node, operator, rhs_node] = operands;
        // `a, b` sequences rather than combines: evaluate the left for its
        // effects, discard it, and answer the right. Handled before the operator
        // table below because it is not an operator over two values at all --
        // there is no result of `a` for anything to be applied to, which is why
        // it has no `BinOp` and could not have had one.
        if self.kind_of(operator) == Some(syntax::COMMA_TOKEN) {
            return Some(
                self.lower_expression(lhs_node)
                    .and_then(|_| self.lower_expression(rhs_node)),
            );
        }

        // Assignment is not arithmetic on a location: it rebinds a name to a
        // value. With the name bound directly there is no slot to store into and
        // nothing to emit — the rebinding *is* the assignment.
        if self.kind_of(operator) == Some(syntax::EQUALS_TOKEN) {
            return Some(self.lower_assignment(id, lhs_node, rhs_node));
        }

        let token = self.kind_of(operator).unwrap_or(0);

        // **Both sides absent is a constant**, and it goes first because it is
        // the most specific question here: neither `null` nor `undefined` has a
        // representation of its own, and `contextual_type` asks the *other*
        // side of a comparison — which here is the other absence, so the two
        // send each other in a circle and both are refused for standing in for
        // something that is not a reference.
        //
        // ```text
        // null !== null          false
        // undefined !== null     true    (strict)
        // undefined != null      false   (loose: they coerce to each other)
        // ```
        //
        // Not a fold for speed. A comparison between two absences is decided by
        // which absences they are and nothing else — there is no value to
        // compare at run time and no type for one to have. Placed above
        // `erased_absence_test` for exactly that reason: that one is a *tag*
        // test on a value that was read, and it tried to lower one of these
        // sides to have a tag to read.
        if let Some(answer) = self.comparison_of_two_absences(lhs_node, operator, rhs_node) {
            let origin = self.origin(id);
            return Some(Ok(self.push(
                OpKind::ConstBool(answer),
                HirType::Bool,
                origin,
            )));
        }

        // `v === undefined` on an erased value is a tag test, and neither
        // operand is ever built -- `undefined` has no representation of its
        // own, only a tag.
        // Before the erased test, because it is the more specific question: the
        // member is an optional *method*, whose absence is a fact about the
        // receiver's class rather than a tag on a value that was read.
        if let Some(result) = self.optional_method_presence(id, token, lhs_node, rhs_node) {
            return Some(result);
        }
        if let Some(result) = self.cast_member_presence(id, token, lhs_node, rhs_node) {
            return Some(result);
        }
        if let Some(result) = self.erased_absence_test(id, token, lhs_node, rhs_node) {
            return Some(result);
        }

        if token == syntax::INSTANCEOF_KEYWORD {
            return Some(self.lower_instanceof(id, lhs_node, rhs_node));
        }

        if token == syntax::IN_KEYWORD {
            return Some(self.lower_in(id, lhs_node, rhs_node));
        }

        // `&&` and `||` must not evaluate their right operand unless the left
        // one requires it, so they are taken before the ordinary path lowers
        // both.
        if token == syntax::AMPERSAND_AMPERSAND_TOKEN || token == syntax::BAR_BAR_TOKEN {
            return Some(self.lower_logical(
                id,
                token == syntax::AMPERSAND_AMPERSAND_TOKEN,
                lhs_node,
                rhs_node,
            ));
        }

        // `??` short-circuits for the same reason and on a different question.
        if token == syntax::QUESTION_QUESTION_TOKEN {
            return Some(self.lower_nullish(id, lhs_node, rhs_node));
        }

        // `x += e` is `x = x + e`: the operator applies, and the name rebinds.
        // Spelling it out here rather than in a desugaring keeps one place that
        // knows a bitwise operator needs its coercions.
        // `x += e` is `x = x + e`: the operator applies, and the name rebinds.
        // `a ||= b` short-circuits like `a || b` and additionally decides
        // whether to write at all, so it is taken before the compound path --
        // which would lower it as `a = a || b` and store on every path.
        if let Some(logical) = logical_assignment(token) {
            return Some(self.lower_logical_assignment(id, logical, lhs_node, rhs_node));
        }

        if let Some(compound) = compound_operator(token) {
            return Some(self.lower_compound(id, compound, lhs_node, rhs_node));
        }

        None
    }

    fn lower_binary_values(
        &mut self,
        id: NodeId,
        operands: [NodeId; 3],
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let [lhs_node, operator, rhs_node] = operands;
        let mut ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a binary expression"))?;

        let token = self
            .kind_of(operator)
            .ok_or_else(|| self.unsupported(id, "a binary expression with no operator"))?;

        // **ToPrimitive before anything asks what the operands are**, and
        // after both are evaluated, which is the specification's order (13.15.3).
        // `m + ""` where `Money`'s `valueOf` answers `5` is `"5"`: the string
        // conversion below calls `toString`, which is hint "string", and printed
        // `"[object Object]"` -- a silent wrong answer in typed code. An object
        // with no conversion member converts to its printed text here, so
        // `{} + 0` in JavaScript is `"[object Object]0"` rather than an `add` of
        // a pointer.
        let (lhs, rhs) = if token == syntax::PLUS_TOKEN {
            let lhs = self.ordinary_to_primitive(id, lhs_node, lhs)?;
            let rhs = self.ordinary_to_primitive(id, rhs_node, rhs)?;
            self.booleans_as_numbers(id, lhs, rhs)
        } else {
            (lhs, rhs)
        };

        // A source copy can give both operands concrete representations
        // where the shared AST still says any. Derive + from those produced
        // values; a use's demanded result type is not operand evidence.
        if token == syntax::PLUS_TOKEN && ty == HirType::Erased {
            ty = self.plus_from_operands(lhs, rhs).unwrap_or(ty);
        }

        // A bitwise operator is `ToInt32`, the machine operation, and back. The
        // coercion is made explicit rather than folded into the operator so the
        // analysis can see it: `ToInt32` is where "this value is an integer"
        // stops being a hope and becomes a fact, and `x | 0` is how a TypeScript
        // author writes exactly that.
        if let Some(op) = bitwise_operator(token) {
            let origin = self.origin(id);
            return self.push_bitwise(id, op, lhs, rhs, ty, &origin);
        }

        // `+` is not one operator. On numbers it is arithmetic; on strings it is
        // concatenation, and the two lower to nothing alike. Resolving it here
        // against the result type means no backend has to ask again.
        // `s + n` converts `n` before concatenating. Done here rather than in
        // the backend, because the conversion is a *call* and a backend that
        // synthesized one would be deciding a semantic question.
        let (lhs, rhs) = if token == syntax::PLUS_TOKEN && ty.is_managed() {
            (
                self.as_string(lhs_node, lhs)?,
                self.as_string(rhs_node, rhs)?,
            )
        } else {
            (lhs, rhs)
        };
        if token == syntax::ASTERISK_ASTERISK_TOKEN {
            return self.exponentiate(id, ty, lhs, rhs);
        }

        if let Some(equal) = self.lower_union_equality(id, [lhs_node, rhs_node], token, [lhs, rhs])
        {
            return equal;
        }

        let op = self.binary_op_for(id, operator, lhs_node, rhs_node, token, &ty)?;

        let (lhs, rhs) = self.erased_equality_operands(token, [lhs_node, rhs_node], (lhs, rhs))?;

        let (lhs, rhs) = self.relational_operands(id, op, lhs_node, rhs_node, lhs, rhs)?;

        if let Some(comparison) =
            self.bigint_string_comparison(id, op, lhs_node, rhs_node, lhs, rhs)
        {
            return Ok(comparison);
        }

        let (lhs, rhs) = self.numeric_operands(id, op, lhs, rhs)?;

        self.require_bigint_divisor(id, op, lhs, rhs)?;

        let origin = self.origin(id);
        Ok(self.push(OpKind::Binary { op, lhs, rhs }, ty, origin))
    }

    /// Widen a native integer to the bigint beside it, so both sides are one type.
    ///
    /// **A `c_long` field is `Int { bits: 64 }` and a `bigint` is `BigInt`,**
    /// which is `i128` — two representations of what TypeScript calls one type,
    /// because `c_long` is a branded `bigint` whose *storage* is eight bytes.
    /// `info.st_size === want` therefore produced a comparison between an `i64`
    /// and an `i128`, and nothing reconciled them.
    ///
    /// C hid it: the implicit conversion is the correct widening, so the emitted
    /// program worked. LLVM's own verifier rejected the module —
    /// *"'%v1' defined with type 'i128' but expected 'i64'"* — so the two
    /// backends disagreed, one of them silently, and `verify` was skipping the
    /// question for `Eq` and `Ne` (see [`Invalid::MixedOperands`]). Found by the
    /// Windows lane while writing an unrelated `c_long` test.
    ///
    /// Widening rather than truncating, and to the **bigint**: truncating would
    /// answer a different question — `2n ** 70n === someLong` must be `false`,
    /// not a comparison of low words — and it is the direction `conversion`
    /// already documents, taking its signedness from the source so `UINT64_MAX`
    /// widens to 18446744073709551615 rather than to -1.
    ///
    /// Only this one mix. Anything else left disagreeing is now a verifier
    /// error rather than a silent divergence, which is what the new rule is for:
    /// this fixes the case that exists and refuses to guess at cases that do not.
    fn agree_on_one_integer_width(
        &mut self,
        id: NodeId,
        lhs: ValueId,
        rhs: ValueId,
    ) -> (ValueId, ValueId) {
        let (left, right) = (
            self.values[lhs.0 as usize].ty.clone(),
            self.values[rhs.0 as usize].ty.clone(),
        );
        let origin = self.origin(id);
        match (&left, &right) {
            (HirType::Int { .. }, HirType::BigInt) => {
                let widened = self.push(OpKind::Convert(lhs), HirType::BigInt, origin);
                (widened, rhs)
            }
            (HirType::BigInt, HirType::Int { .. }) => {
                let widened = self.push(OpKind::Convert(rhs), HirType::BigInt, origin);
                (lhs, widened)
            }
            _ => (lhs, rhs),
        }
    }
}

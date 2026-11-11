//! Evaluate ordinary, compound, logical, and stepping assignments through their places.

use super::{
    BinOp, Branch, Diagnostic, FuncBuilder, HirType, NodeId, NumberHint, OpKind, ValueId,
    bitwise_operator_of, syntax,
};

/// The operator a compound-assignment token applies.
pub(super) const fn compound_operator(token: u16) -> Option<Compound> {
    Some(Compound::Op(match token {
        syntax::ASTERISK_ASTERISK_EQUALS_TOKEN => return Some(Compound::Exponentiate),
        syntax::PLUS_EQUALS_TOKEN => BinOp::Add,
        syntax::MINUS_EQUALS_TOKEN => BinOp::Sub,
        syntax::ASTERISK_EQUALS_TOKEN => BinOp::Mul,
        syntax::SLASH_EQUALS_TOKEN => BinOp::Div,
        syntax::PERCENT_EQUALS_TOKEN => BinOp::Rem,
        syntax::AMPERSAND_EQUALS_TOKEN => BinOp::BitAnd,
        syntax::BAR_EQUALS_TOKEN => BinOp::BitOr,
        syntax::CARET_EQUALS_TOKEN => BinOp::BitXor,
        syntax::LESS_THAN_LESS_THAN_EQUALS_TOKEN => BinOp::Shl,
        syntax::GREATER_THAN_GREATER_THAN_EQUALS_TOKEN => BinOp::Shr,
        syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_EQUALS_TOKEN => BinOp::UShr,
        _ => return None,
    }))
}

/// The test a logical assignment applies before it writes.
///
/// Separate from [`Compound`] rather than a fourth variant of it, because the
/// two differ in the thing that matters: a compound assignment always writes,
/// and these write only when the test says to.
#[derive(Clone, Copy)]
pub(super) enum Logical {
    /// `&&=`.
    And,
    /// `||=`.
    Or,
    /// `??=`, which asks a different question from `||=` and not a narrower
    /// one: `n ||= 1` overwrites a `0` and `n ??= 1` does not.
    Nullish,
}

/// The test a logical-assignment token applies.
pub(super) const fn logical_assignment(token: u16) -> Option<Logical> {
    Some(match token {
        syntax::AMPERSAND_AMPERSAND_EQUALS_TOKEN => Logical::And,
        syntax::BAR_BAR_EQUALS_TOKEN => Logical::Or,
        syntax::QUESTION_QUESTION_EQUALS_TOKEN => Logical::Nullish,
        _ => return None,
    })
}

/// What a compound assignment applies to the place it reads.
///
/// Two variants rather than one, because `**=` is the only compound assignment
/// whose operator is not an operator: exponentiation is a runtime call, so it
/// cannot be spelled as a [`BinOp`].
#[derive(Clone, Copy)]
pub(super) enum Compound {
    Op(BinOp),
    Exponentiate,
}

impl FuncBuilder<'_> {
    /// `target = value`, for each kind of target.
    ///
    /// Three different operations wear one spelling. A name rebinds, which
    /// emits nothing at all -- the binding *is* the assignment. A field or an
    /// element writes through a reference, where there is no name to rebind and
    /// the store is the whole of the effect.
    pub(super) fn lower_assignment(
        &mut self,
        id: NodeId,
        target: NodeId,
        source: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        // `[a, b] = [b, a]` and `({ x, y } = p)`. A pattern on the left is not
        // one place, so it cannot go through `place_of` at all: the value is
        // lowered *once* and each target is assigned a read of it, which is
        // what makes the swap idiom a swap rather than two copies of `b`.
        if matches!(
            self.kind_of(target),
            Some(syntax::ARRAY_LITERAL_EXPRESSION | syntax::OBJECT_LITERAL_EXPRESSION)
        ) {
            let value = self.lower_expression(source)?;
            self.assign_pattern(target, value)?;
            return Ok(value);
        }

        // The place first, then the value: `xs[i()] = v()` evaluates the array,
        // then the index, then the value, and JavaScript says so.
        //
        // Which is also what makes the slot's type available *before* the value
        // is built. `xs = [{ a: 1 }]` into an `Opts[]` used to build the array
        // at the literal's own element type and then fail to convert the
        // finished thing; asking the place first is the same order the
        // evaluation rule already imposed.
        if let Some(value) = self.lower_objc_property_set(id, target, source)? {
            return Ok(value);
        }
        // `label.label = text`: the call to the method the property's
        // `@ntsSet` names, with the value -- which is still what the
        // assignment evaluates to.
        if self.kind_of(target) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
            && let [object, member] = self.children(target).as_slice()
            && self.is_accessor_property(*member)
        {
            let method = self.accessor(*member, true).ok_or_else(|| {
                self.unsupported(
                    id,
                    "an assignment to a native property no @ntsSet names a method for",
                )
            })?;
            let value = self.lower_expression(source)?;
            self.lower_accessor(id, *object, *member, &method, Some(value))?;
            return Ok(value);
        }
        let place = self.place_of(target)?;
        let value = match self.slot_type(id, &place)? {
            Some(want) => self.lower_expecting(source, &want)?,
            None => self.lower_expression(source)?,
        };
        self.write_place(id, &place, value)?;
        Ok(value)
    }

    /// What a plain `=` assigns to `target`: the right side of
    /// `target = value`. `None` for anything else -- a compound assignment
    /// reads before it writes, and a destructuring target is not one place.
    pub(super) fn assigned_value(&self, target: NodeId) -> Option<NodeId> {
        let assignment = self.node(target).parent?;
        let [left, operator, right] = self.syntax_children_of(assignment)[..] else {
            return None;
        };
        (self.kind_of(assignment) == Some(syntax::BINARY_EXPRESSION)
            && left == target
            && self.kind_of(operator) == Some(syntax::EQUALS_TOKEN))
        .then_some(right)
    }

    /// The shared half of `++`/`--`: add or subtract one and rebind the name.
    /// `x++`, `++x`, and their decrementing halves.
    ///
    /// Returns the value before the step and the value after it, because the
    /// prefix and postfix forms differ in exactly which one they evaluate to.
    /// The place is read and written *once*, which is what a step is.
    pub(super) fn step(
        &mut self,
        id: NodeId,
        target: NodeId,
        op: BinOp,
    ) -> Result<(ValueId, ValueId), Diagnostic> {
        let place = self.place_of(target)?;
        let current = self.read_place(target, &place)?;
        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a step"))?;
        // `++x` is `ToNumeric(x) + 1`, and `ToNumeric` is `ToNumber` with one
        // exception: a BigInt stays a BigInt and steps by `1n`. So an operand
        // whose representation is *known* takes the conversion unary `+` already
        // applies, which is one function rather than a second rule about which
        // types a step may add one to.
        //
        // Without it the `Binary` below was pushed at the checker's type for the
        // *whole expression* -- `number` -- while the operand kept its own, and a
        // later pass made them agree the only way it can, by converting a pointer
        // to a double. `++{}` answered **1** where node answers `NaN`
        // (`outcomes/an-object-incremented`), silently, because the object became
        // a zero. `{} * 1` is refused, so `++` alone was converting.
        //
        // It also refuses the impossible case *where the conversion is
        // impossible*: `ToNumber` of an object is `ToPrimitive`, which runs
        // `valueOf` and `toString` off a prototype chain, and
        // `coerce_to_number`'s fallthrough says so by name. A string and an array
        // were already refused, but at the **write-back** a step later -- `a
        // number where a string is wanted` -- which names the store rather than
        // the conversion that cannot happen.
        //
        // # Where the conversion is sound, and what happens where it is not
        //
        // `coerce_to_number` answers for four representations and refuses the
        // rest, and `step` wants only the arms that are *right* -- so it asks
        // first rather than converting and reporting the refusal. Two arms it
        // must not take, for opposite reasons:
        //
        // **A BigInt, permanently, because the conversion gives the opposite
        // answer.** `++1n` is `2n` with `typeof === "bigint"`, while `+1n`
        // *throws* -- so routing one through the arm that rounds a BigInt to a
        // double would answer 2 where the language says 2n. Checked against node
        // rather than read off the specification. (`Number(x)`, which *does*
        // round a BigInt, has its own arm: `coerce_explicit_number`.)
        //
        // **An erased value whose type admits an object**, because `ToNumber` of
        // one is `ToPrimitive`: it runs `valueOf` and `toString` off a prototype
        // chain, so `++[5]` is 6 and no fixed layout can answer it.
        // `only_primitives` is the same question `coerce_to_number`'s own erased
        // arm asks, asked here so the answer decides rather than a refusal
        // travelling up.
        //
        // **And where it is not sound the operand is handed on untouched, which
        // is today's behaviour and today's recorded wrong answer.** That is
        // deliberate rather than timid, and the numbers are why. Refusing the
        // unsound case instead costs
        // `test/language/statements/function/S13_A4_T2.js`, where `function
        // __func(arg) { return ++arg }` called as `__func(1)` computes 2 today and
        // is not hollow -- an untyped parameter is an `any`, so it admits an
        // object and would refuse. Handing it on keeps that pass and leaves
        // `outcomes/an-object-incremented` exactly as it is: `var obj = {}` is
        // *erased*, because `{}` is the empty object type and not a layout, so it
        // was never the concrete-object case it reads as. One recorded failure
        // stays a recorded failure; no pass becomes a refusal.
        //
        // What removes that residue is a **tag dispatch**, not a wider rule here:
        // `nts_value_to_number` is already ToNumber over the tags and is right for
        // a number, a string, a boolean, `null`, `undefined` and a plain object.
        // What it owes first is its reference arm, which answers `NaN` on the
        // stated argument that lowering never emits the call where an object can
        // arrive -- so making it reachable would turn a documented unreachable
        // case into a silent one for an array. That is its own commit.
        //
        // Where the program declares no conversion of its own, the tag decides
        // instead (`erased_to_number`), and a bigint stops by name there.
        let convertible = match self.values[current.0 as usize].ty {
            HirType::BigInt => false,
            HirType::Erased => self.only_primitives(target),
            _ => true,
        };
        let current = if convertible {
            self.coerce_to_number(id, target, current)?
        } else if self.values[current.0 as usize].ty == HirType::Erased {
            self.erased_to_number(id, current, NumberHint::Numeric)?
                .unwrap_or(current)
        } else {
            current
        };
        // The `1` is one of the operand's own kind, which is the same rule the
        // conversion above is: a step reads the *operand's* representation and not
        // the checker's type for the whole expression. A BigInt steps by `1n`,
        // spelled `ConstInt` at `HirType::BigInt` -- what `lower_absent` uses for a
        // BigInt zero and what C emits as `__int128`.
        //
        // A `ConstFloat` there is **well-typed to C and invalid to the other two**,
        // which is why it stood: C spells a bigint `__int128` and converts the
        // double, LLVM types the constant `double` against an `i128` operand and
        // the module stops assembling, and the JVM's stack accounting disagrees
        // with its own emitter (`NTS4001 ... moved the operand stack from 0 to 1`).
        // Pre-existing -- the control pin fails identically on both -- and the
        // fixture's BigInt arms are what surfaced it. C agreed on every case.
        let one = if ty == HirType::BigInt {
            self.push(OpKind::ConstInt(1), ty.clone(), origin.clone())
        } else {
            self.push(OpKind::ConstFloat(1.0), ty.clone(), origin.clone())
        };
        let stepped = self.push(
            OpKind::Binary {
                op,
                lhs: current,
                rhs: one,
            },
            ty,
            origin,
        );
        self.write_place(id, &place, stepped)?;
        // The *converted* value is what a postfix step evaluates to, which is why
        // the conversion above shadows `current` rather than sitting beside it.
        // `let b = true; b++` is `1` and `let s = "41"; s++` is `41` -- a number
        // either way, because the specification's order is `oldValue =
        // ToNumeric(...)` and then `return oldValue`. Before the conversion this
        // handed back the raw `true` and the raw `"41"`, so that is a second wrong
        // answer this closes and an arm the fixture owes.
        Ok((current, stepped))
    }

    /// `x += e`, which is `x = x + e` with the target evaluated once.
    ///
    /// Spelled out rather than desugared, so that one place knows a bitwise
    /// operator needs its coercions and `+=` on strings is concatenation. The
    /// target goes through [`Self::place_of`], which is what makes
    /// `xs[next()] += 1` call `next` once rather than twice.
    pub(super) fn lower_compound(
        &mut self,
        id: NodeId,
        compound: Compound,
        lhs_node: NodeId,
        rhs_node: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let place = self.place_of(lhs_node)?;
        let current = self.read_place(lhs_node, &place)?;
        let addend = self.lower_expression(rhs_node)?;
        let mut ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a compound assignment"))?;
        // `s += o` converts `o` as `s + o` does: see `lower_binary`.
        let (current, addend) = if matches!(compound, Compound::Op(BinOp::Add)) {
            let current = self.ordinary_to_primitive(id, lhs_node, current)?;
            let addend = self.ordinary_to_primitive(id, rhs_node, addend)?;
            self.booleans_as_numbers(id, current, addend)
        } else {
            (current, addend)
        };
        if matches!(compound, Compound::Op(BinOp::Add)) && ty == HirType::Erased {
            ty = self.plus_from_operands(current, addend).unwrap_or(ty);
        }
        let updated = match compound {
            Compound::Exponentiate => self.exponentiate(id, ty, current, addend)?,
            Compound::Op(op) => {
                // `s += t` on strings is concatenation, not addition, and the
                // two lower to nothing alike -- `Add` on two `NtsString *`
                // reaches the backend as pointer arithmetic. `lower_binary`
                // resolves `+` against the result type for exactly this reason;
                // the compound form has to ask the same question rather than
                // assume the answer.
                let (op, current, addend) = if matches!(op, BinOp::Add) && ty.is_managed() {
                    (
                        BinOp::Concat,
                        self.as_string(lhs_node, current)?,
                        self.as_string(rhs_node, addend)?,
                    )
                } else {
                    (op, current, addend)
                };
                let origin = self.origin(id);
                if bitwise_operator_of(op) {
                    self.push_bitwise(id, op, current, addend, ty, &origin)?
                } else {
                    self.require_bigint_divisor(id, op, current, addend)?;
                    self.push(
                        OpKind::Binary {
                            op,
                            lhs: current,
                            rhs: addend,
                        },
                        ty,
                        origin,
                    )
                }
            }
        };
        self.write_place(id, &place, updated)?;
        Ok(updated)
    }

    /// `a ||= b`, `a &&= b`, `a ??= b`.
    ///
    /// Spelled as a branch around a write rather than as `a = a || b`, because
    /// the desugaring is wrong in a way that is easy to miss: it writes on
    /// every path. `a ||= b` where `a` is truthy performs no store, and the
    /// difference shows up twice -- a setter that does not run, and a counted
    /// store that does not release what the place already held. The
    /// specification is explicit about it, and so is this.
    ///
    /// The place is lowered once, before the test, for the reason
    /// [`Self::place_of`] exists at all.
    pub(super) fn lower_logical_assignment(
        &mut self,
        id: NodeId,
        logical: Logical,
        lhs_node: NodeId,
        rhs_node: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let place = self.place_of(lhs_node)?;
        let current = self.read_place(lhs_node, &place)?;
        let condition = match logical {
            Logical::Nullish => match self.absence_of(lhs_node, current) {
                Some(absent) => absent,
                // Nothing to test, so nothing is ever written. A value with no
                // room for an absence is never absent, so `n ??= 1` is `n` --
                // which is what the specification says happens rather than an
                // optimization of it. TypeScript permits the shape and reports
                // it as unnecessary.
                None => return self.narrowed(id, current),
            },
            Logical::And | Logical::Or => self.truthy(id, current),
        };
        let assign = Branch::Assigned(rhs_node, place);
        // Which arm keeps the current value, and at what type. Truthy excludes
        // both absences and so does the nullish test, so those arms may read an
        // erased value back at the type the whole expression has. `&&=` keeps
        // its value where it is *falsy*, and `undefined` is falsy -- so that
        // one is a `Value` and not a `Present`. The distinction is the same
        // soundness one [`Branch::Present`] documents, and getting it backwards
        // here would unerase a payload that is not there.
        let keep = match logical {
            Logical::Or | Logical::Nullish => Branch::Present(current),
            Logical::And => Branch::Value(current),
        };
        let (then_branch, else_branch) = match logical {
            Logical::And | Logical::Nullish => (assign, keep),
            Logical::Or => (keep, assign),
        };
        self.lower_branching_value(id, condition, then_branch, else_branch)
    }
}

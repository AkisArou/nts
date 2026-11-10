//! Decode and lower literal, constant, and enum values.

use super::{
    BindingConstant, Diagnostic, FuncBuilder, HirType, LiteralValue, ManagedType, NodeData, NodeId,
    OpKind, SymbolFlags, TypeId, TypeKind, ValueId, constant_fits, syntax,
};

/// The integer spelling of a pointer sentinel, without a floating-point step.
/// Negative values use their signed 64-bit representation; positive values may
/// use every bit. No arithmetic, exponent, fraction or `BigInt` suffix is a tag.
pub(super) fn parse_handle_constant(text: &str) -> Option<u64> {
    let text = text.trim();
    let (negative, digits) = text
        .strip_prefix('-')
        .map_or((false, text.strip_prefix('+').unwrap_or(text)), |digits| {
            (true, digits)
        });
    let (radix, digits) = digits
        .strip_prefix("0x")
        .or_else(|| digits.strip_prefix("0X"))
        .map_or((10, digits), |digits| (16, digits));
    if !digits.bytes().all(|byte| {
        if radix == 16 {
            byte.is_ascii_hexdigit()
        } else {
            byte.is_ascii_digit()
        }
    }) {
        return None;
    }
    let magnitude = u64::from_str_radix(digits, radix).ok()?;
    if negative {
        (magnitude <= 1 << 63).then(|| 0_u64.wrapping_sub(magnitude))
    } else {
        Some(magnitude)
    }
}

/// **A declared number or boolean nothing gives a value** -- a `const` with
/// no initializer, which only an ambient declaration may be, no literal type
/// and no binding tag -- read as the `0` its slot held, with no diagnostic.
/// Refused where it is read, saying what would give it one. Not an object's
/// or a string's: `declare const TextEncoder: ...` is a builtin the program
/// is given, and one a binding names otherwise (`@ntsSymbol`) has a tag.
pub(super) const VALUELESS_DECLARED_CONST: &str = "a declared `const` no one gives a value -- no initializer, no literal type, no `@ntsConstant` -- which the compiler cannot know; declare it with its value (`const x = 1`, or `const x: 1`)";

/// Whether a value of `ty` is a number or a boolean, which a slot nothing
/// writes holds as `0`.
pub(super) fn is_scalar(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Float { .. } | HirType::Int { .. } | HirType::Bool
    )
}

/// Choose a representation for a source type.
///
/// The decision the whole layer exists to make. Unspecialized, so `number`
/// becomes `f64` — correct, and the thing specialization improves on once
/// analysis can show a value is integral and in range.
/// A JavaScript numeric literal, as the double it denotes.
///
/// Every spelling the language has: decimal with an optional exponent, and
/// `0x`/`0o`/`0b` integers. Numeric separators are removed first — `1_000_000`
/// is the same literal as `1000000`, and only the reader was meant to notice
/// the difference.
///
/// Returns `None` rather than guessing. A `1n` is a `BigInt` and not this, and a
/// spelling that is not here should reach the fallback rather than a wrong
/// number.
#[must_use]
pub fn parse_number(text: &str) -> Option<f64> {
    let text = text.replace('_', "");
    if text.ends_with('n') {
        // A BigInt literal, which is a different type with different arithmetic.
        return None;
    }
    // `get(..2)` and not `[..2]`: `0` is a whole literal and is one byte long.
    let radix = match text
        .get(..2)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "0x" => 16,
        "0o" => 8,
        "0b" => 2,
        _ => {
            // Decimal, where Rust's parser is correctly rounded and is the whole
            // of the answer.
            return text.parse::<f64>().ok();
        }
    };
    // An integer literal in another base. `u128` because `0x` literals wider
    // than `u64` are legal to write; the conversion to `f64` rounds, which is
    // exactly what JavaScript does with an integer above 2^53.
    #[expect(
        clippy::cast_precision_loss,
        reason = "rounding a large integer to the nearest double is the semantics"
    )]
    u128::from_str_radix(&text[2..], radix)
        .ok()
        .map(|value| value as f64)
}

/// A source or checker `BigInt` spelling within the compiler's signed 128-bit
/// profile. Keep literal lowering and value-dispatch guards on the same parser.
pub(super) fn parse_bigint(text: &str) -> Option<i128> {
    let digits = text.trim().trim_end_matches('n');
    let (negative, digits) = digits
        .strip_prefix('-')
        .map_or((false, digits), |digits| (true, digits));
    let (radix, body) = match digits.get(..2) {
        Some("0x" | "0X") => (16, &digits[2..]),
        Some("0o" | "0O") => (8, &digits[2..]),
        Some("0b" | "0B") => (2, &digits[2..]),
        _ => (10, digits),
    };
    let cleaned: String = body.chars().filter(|c| *c != '_').collect();
    let magnitude = u128::from_str_radix(&cleaned, radix).ok()?;
    if negative && magnitude == 1_u128 << 127 {
        Some(i128::MIN)
    } else {
        let magnitude = i128::try_from(magnitude).ok()?;
        Some(if negative { -magnitude } else { magnitude })
    }
}

/// What `typeof` answers for a representation, where the representation alone
/// decides it -- `Self::spelling_for` wraps this with the one question that
/// needs the snapshot.
///
/// `None` for a value whose answer is not fixed by how it is stored: an erased
/// one carries a tag and is read at run time, and `void`/`never` have no value
/// to ask about.
pub(super) const fn spelling_of(ty: &HirType) -> Option<&'static str> {
    Some(match ty {
        HirType::Bool => "boolean",
        HirType::Int { .. } | HirType::Float { .. } => "number",
        HirType::BigInt => "bigint",
        HirType::Managed(ManagedType::String) => "string",
        // A closure is not the only reference `typeof` declines to call an
        // object: a symbol answers `"symbol"`. The wildcard below used to
        // catch it and answer `"object"`, which is the failure
        // `tooling/differential`'s own `c_type` comment describes -- a default
        // that is right for its neighbours is wrong for the newcomer, and the
        // newcomer is what nobody is looking at. 56 cases disagreed with node.
        HirType::Managed(ManagedType::Object(id)) if crate::hir::is_closure_type(*id) => "function",
        HirType::Managed(ManagedType::Symbol) => "symbol",
        HirType::Managed(_) => "object",
        HirType::Erased
        | HirType::Void
        | HirType::Never
        | HirType::NativePointer(_)
        | HirType::PossiblyUndefined(_) => {
            return None;
        }
    })
}

/// What an enum member access resolved to.
///
/// Two kinds because they need two emissions, not because they are two
/// features: a number is an immediate and a string is the interned static a
/// string literal gets.
#[derive(Clone)]
enum EnumMember {
    Number(f64),
    /// The member's text, which the checker has already interned as the
    /// access's literal type -- the same one it gives the literal itself.
    Text(nts_semantic_schema::JsText),
}

impl FuncBuilder<'_> {
    /// An expression's value, when it is one the checker or this compiler can
    /// work out without running anything.
    /// What an expression is worth at compile time, if anything.
    ///
    /// `known` is the module-scope constants declared *before* this one, and
    /// that is the right set rather than a convenient one: JavaScript gives
    /// `const` a temporal dead zone, so an initializer naming a later `const` is
    /// a run-time error rather than a program with a value to fold. Empty for
    /// every caller that is not collecting module scope.
    pub(super) fn constant_value(
        &self,
        id: NodeId,
        known: &rustc_hash::FxHashMap<u32, f64>,
    ) -> Option<f64> {
        match self.kind_of(id) {
            // A boolean's storage is its truth value. `Global::ty` says which of
            // the two a zero means.
            Some(syntax::TRUE_KEYWORD) => Some(1.0),
            Some(syntax::FALSE_KEYWORD) => Some(0.0),
            Some(syntax::NUMERIC_LITERAL) => self
                .node(id)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                .and_then(parse_number)
                .or_else(|| match self.snapshot.constants.get(&id) {
                    Some(nts_semantic_schema::ConstantValue::Number(value)) => Some(*value),
                    _ => None,
                }),
            Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                let NodeData::Children { small, .. } = self.node(id).data else {
                    return None;
                };
                let inner = self.constant_value(*self.children(id).first()?, known)?;
                match small & syntax::prefix_operator::MASK {
                    syntax::prefix_operator::MINUS => Some(-inner),
                    syntax::prefix_operator::PLUS => Some(inner),
                    _ => None,
                }
            }
            // Arithmetic on two constants is a constant. Worth folding here
            // because a module-scope initializer has nowhere to run: it is a
            // static initializer in the emitted C, so `4 * PI * PI` is either
            // computed now or refused, and refusing it means a program cannot
            // name a derived constant.
            //
            // In `f64` and in the source's order, because that is what the
            // program would compute at run time -- floating-point addition does
            // not reassociate, and a fold that gets a different answer than the
            // code it replaces is not a fold.
            Some(syntax::BINARY_EXPRESSION) => {
                let children = self.children(id);
                let [lhs, operator, rhs] = children.as_slice() else {
                    return None;
                };
                let lhs = self.constant_value(*lhs, known)?;
                let rhs = self.constant_value(*rhs, known)?;
                // A bitwise operator only where both sides are int32s already,
                // so `ToInt32` is the identity -- `(64 | 1 | 512)`, a flag set.
                #[allow(clippy::cast_possible_truncation)]
                let int32 = |value: f64| {
                    (value.fract() == 0.0 && (-2_147_483_648.0..=2_147_483_647.0).contains(&value))
                        .then_some(value as i32)
                };
                match self.kind_of(*operator)? {
                    syntax::PLUS_TOKEN => Some(lhs + rhs),
                    syntax::MINUS_TOKEN => Some(lhs - rhs),
                    syntax::ASTERISK_TOKEN => Some(lhs * rhs),
                    syntax::SLASH_TOKEN => Some(lhs / rhs),
                    syntax::BAR_TOKEN => Some(f64::from(int32(lhs)? | int32(rhs)?)),
                    syntax::AMPERSAND_TOKEN => Some(f64::from(int32(lhs)? & int32(rhs)?)),
                    syntax::CARET_TOKEN => Some(f64::from(int32(lhs)? ^ int32(rhs)?)),
                    _ => None,
                }
            }
            Some(syntax::PARENTHESIZED_EXPRESSION | syntax::SATISFIES_EXPRESSION) => {
                self.constant_value(*self.children(id).first()?, known)
            }
            // `10 as c_int` is 10: an `as` has no run-time effect. Folded only
            // where the claim holds for the constant -- otherwise the
            // initializer stays code, whose `as` the strict check reports.
            Some(syntax::AS_EXPRESSION) => {
                let value = self.constant_value(*self.children(id).first()?, known)?;
                let claimed = self
                    .snapshot
                    .node_types
                    .get(&id)
                    .and_then(|ty| self.written_scalar(*ty));
                claimed
                    .is_none_or(|kind| constant_fits(value, kind))
                    .then_some(value)
            }
            // A name that is itself a module-scope constant. `SOLAR_MASS` is
            // `4 * PI * PI`, and a compiler that folds arithmetic but not names
            // folds nothing anyone writes.
            Some(syntax::IDENTIFIER) => self
                .node(id)
                .symbol
                .and_then(|symbol| known.get(&symbol.0).copied()),
            _ => match self.snapshot.constants.get(&id) {
                Some(nts_semantic_schema::ConstantValue::Number(value)) => Some(*value),
                _ => None,
            },
        }
    }

    /// `Colour[1]`, which is the enum's **reverse mapping**.
    ///
    /// A numeric enum emits a table alongside its members mapping each value
    /// back to the member's name, so `Colour[1]` is `"Green"`. A *string* enum
    /// emits none -- the specification says so, and it is why the arm below
    /// tests the member's folded value rather than the enum's declaration.
    ///
    /// # The constant index only, and the reason is `undefined`
    ///
    /// At a constant index this is a string the compiler already knows, and
    /// folding it is exact. At a **computed** one it is not: `Colour[n]` for an
    /// `n` no member has answers `undefined` in JavaScript, and TypeScript
    /// types the expression `string` regardless -- so a lookup that answered
    /// the declared type would be wrong precisely where the program is asking
    /// the question. That half refuses by its own name.
    ///
    /// The same split as `Object.hasOwn` against `Object.keys`, and as
    /// `Array.from` over an iterable against over an array-like: the form that
    /// names its key is answerable and the form that computes one is a
    /// different feature.
    ///
    /// `None` rather than a refusal where this is not an enum at all, because
    /// every other element access reaches here too.
    /// The constant an enum member folds to, where this access names one.
    ///
    /// `None` where it does not -- including `E[n]` for a computed `n`, which the
    /// checker types `string` rather than a literal, and which is
    /// [`Self::enum_reverse_member`]'s question rather than this one.
    ///
    /// **One function because both spellings ask it.** `E.Forward` reached this
    /// fold and `E["Forward"]` did not: the element-access path asks
    /// `enum_reverse_member` first, whose index is a member's *value* rather than
    /// its name, and a string where it wanted a number refused as "an enum's
    /// reverse mapping at a computed index". The dot form compiled all along,
    /// which is what made it read as a gap in enums rather than in one spelling
    /// of them -- the same shape as `cde420c16`, where three readers each
    /// required a property access for something an element access says
    /// identically. The GTK lane found it on `SpinType["STEP_FORWARD"]`, with
    /// `E.B` compiling and `E["B"]` refusing as its two arms.
    ///
    /// A string member is a constant too, and a *managed* one: it wants the
    /// interned static a string literal gets rather than an immediate. That turns
    /// out to be the same emission, because the checker gives `Label.Short` the
    /// identical `Literal(String("s"))` type it gives the literal `"s"` -- so
    /// this is `lower_string` reading its text from the same place, and the two
    /// share an interned constant rather than each getting one.
    pub(super) fn folded_enum_member(&mut self, id: NodeId) -> Option<ValueId> {
        let member = self.enum_member(id)?;
        let origin = self.origin(id);
        Some(match member {
            EnumMember::Number(value) => {
                self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin)
            }
            EnumMember::Text(text) => self.push(
                OpKind::ConstString(text),
                HirType::Managed(ManagedType::String),
                origin,
            ),
        })
    }

    pub(super) fn enum_reverse_member(
        &mut self,
        id: NodeId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let [object, index] = self.children(id)[..] else {
            return Ok(None);
        };
        let Some(symbol) = self.node(object).symbol else {
            return Ok(None);
        };
        // Through the alias, for the reason `enum_member` gives: an import
        // names one at the use site. `declarations` below is read off this
        // record and has to be the enum's own, since the member values are
        // recovered by walking them -- an alias declares one import
        // specifier, which has no `ENUM_MEMBER` child and would reach the
        // `no member has` refusal for an index every member has.
        let symbol = self.denoted_symbol(symbol);
        let Some(record) = self.snapshot.symbols.get(symbol.0 as usize) else {
            return Ok(None);
        };
        if !record.flags.contains(SymbolFlags::ENUM) {
            return Ok(None);
        }
        // `constant_value` rather than `snapshot.constants`, and the difference
        // is the whole of what made this refuse its own motivating case:
        // `constants` holds enum members and the sites that *read* them, so a
        // plain `1` written at the access has no entry, and `Colour[1]`
        // reported itself as a computed index.
        let Some(wanted) = self.constant_value(index, &rustc_hash::FxHashMap::default()) else {
            return Err(self.unsupported(
                id,
                "an enum's reverse mapping at a computed index, which is `undefined` for a value no member has",
            ));
        };
        let declarations = record.declarations.clone();
        for declaration in declarations {
            // TypeScript's own numbering: a member with an initializer takes it,
            // and one without takes the previous value plus one, starting at
            // zero. So `enum E { A, B = 5, C }` is 0, 5, 6 -- which is why this
            // is a running total rather than a position.
            let mut next = 0.0;
            for member in self.children(declaration) {
                if self.kind_of(member) != Some(syntax::ENUM_MEMBER) {
                    continue;
                }
                let children = self.children(member);
                let Some(name) = children
                    .first()
                    .filter(|child| self.kind_of(**child) == Some(syntax::IDENTIFIER))
                    .and_then(|child| {
                        self.node(*child)
                            .text
                            .as_ref()
                            .and_then(|text| text.as_utf8())
                            .map(str::to_owned)
                    })
                else {
                    continue;
                };
                let value = match children.get(1) {
                    // **A string member means this enum has no reverse map at
                    // all**, and the specification says so rather than this
                    // being a limit: only a numeric member gets an entry, and an
                    // enum with a string member is one a program cannot index
                    // backwards. Refused here rather than skipped, because
                    // skipping would answer from the *other* members and be
                    // wrong about which enum this is.
                    Some(initializer) => {
                        match self.constant_value(*initializer, &rustc_hash::FxHashMap::default()) {
                            Some(value) => value,
                            None => {
                                return Err(self.unsupported(
                                    id,
                                    "an enum with a member this compiler cannot fold, which has \
                                     no reverse mapping",
                                ));
                            }
                        }
                    }
                    None => next,
                };
                next = value + 1.0;
                // Exact equality is the comparison this wants, and clippy's
                // objection is to the usual case rather than to this one: an
                // enum member's value is a number the checker folded and the
                // index is a number the program wrote, and JavaScript's own
                // property lookup is exact. A tolerance would answer `Red` to
                // `Colour[0.9999999]`.
                #[allow(clippy::float_cmp, reason = "a property key is matched exactly")]
                let found = value == wanted;
                if !found {
                    continue;
                }
                let origin = self.origin(id);
                return Ok(Some(self.push(
                    OpKind::ConstString(name.into()),
                    HirType::Managed(ManagedType::String),
                    origin,
                )));
            }
        }
        Err(self.unsupported(
            id,
            "an enum's reverse mapping at a value no member has, which is `undefined`",
        ))
    }

    /// The value of an enum member access, where that is what this is.
    ///
    /// Both halves are asked. The *object* has to be an enum -- otherwise any
    /// property access whose type happens to be a literal would fold, which is
    /// constant propagation and not this. And the access's own type has to be a
    /// numeric literal, which is where the value comes from.
    ///
    /// A string enum answers `LiteralValue::String` and falls through to the
    /// refusal, which is correct for now: `Colour.Red` as a string is a
    /// constant too, but it is a *managed* constant and wants the interned
    /// static a string literal gets rather than an immediate.
    fn enum_member(&self, id: NodeId) -> Option<EnumMember> {
        let object = *self.children(id).first()?;
        // Through the alias, because an import names one at the use site and
        // an alias carries no `ENUM` flag of its own. Without this an enum
        // read across a module edge folds in the file that declares it and
        // not in the file that imports it -- and the refusal it then reaches
        // says the enum is `wanted as an object ... which is the reverse
        // mapping`, because `describe_name` *does* resolve the alias and so
        // sees a genuine enum. That sentence named the one thing that was
        // working: the reverse mapping lowers, in the declaring module.
        let symbol = self.denoted_symbol(self.node(object).symbol?);
        let record = self.snapshot.symbols.get(symbol.0 as usize)?;
        if !record.flags.contains(SymbolFlags::ENUM) {
            return None;
        }
        let ty = self.snapshot.node_types.get(&id)?;
        match &self.snapshot.types.get(ty.0 as usize)?.kind {
            TypeKind::Literal(nts_semantic_schema::LiteralValue::Number(value)) => {
                Some(EnumMember::Number(*value))
            }
            TypeKind::Literal(nts_semantic_schema::LiteralValue::String(text)) => {
                Some(EnumMember::Text(text.clone()))
            }
            _ => None,
        }
    }

    pub(super) fn lower_string(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let text = self
            .snapshot
            .node_types
            .get(&id)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .and_then(|record| match &record.kind {
                TypeKind::Literal(LiteralValue::String(text)) => Some(text.clone()),
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
                _ => None,
            })
            .ok_or_else(|| self.unsupported(id, "a string literal with no known value"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::ConstString(text),
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// A binding's constant in its admitted exact representation.
    pub(super) fn native_constant(
        &mut self,
        id: NodeId,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Option<ValueId> {
        let (constant, ty) = match self.module.binding_constants.get(&symbol.0)?.clone() {
            BindingConstant::BigInt(value) => (OpKind::ConstInt(value), HirType::BigInt),
            BindingConstant::Pointer { bits, ty } => {
                // Admission proved the declaration includes null for zero.
                let constant = if bits == 0 {
                    OpKind::ConstNull
                } else {
                    OpKind::ConstHandle(bits)
                };
                (constant, ty)
            }
        };
        let origin = self.origin(id);
        Some(self.push(constant, ty, origin))
    }

    /// A declared string constant's text, where `symbol` is one
    /// ([`ModuleScope::string_constants`](super::ModuleScope::string_constants)).
    pub(super) fn string_constant(
        &mut self,
        id: NodeId,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Option<ValueId> {
        let text = self.module.string_constants.get(&symbol.0).cloned()?;
        let origin = self.origin(id);
        Some(self.push(
            OpKind::ConstString(text.into()),
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// The signature `typeof C` names, as a class token's base.
    ///
    /// A token is stored into slots declared `typeof TypeError`, and that type
    /// has a layout of its own — the fieldless `Fn{ty}` a function type gets. On
    /// a backend that lays out base-first the two coincide and nothing notices;
    /// on one that relates classes **by name**, storing one into the other is
    /// two unrelated final classes, and the JVM says so:
    ///
    /// ```text
    /// NTS4001 storing a `Ctor_TypeError` where a `Fn16__20` is declared,
    ///         and the first does not extend the second here
    /// ```
    ///
    /// which is the refusal `a-class-stored-and-compared` carried as that
    /// backend's last failing example. A closure already gets this relation
    /// from [`relate_closures_to_signatures`](super::relate_closures_to_signatures); a class token is the other thing
    /// that is a value of a function type, and was not getting it.
    ///
    /// The base alone, with no abstract declaration beside it — which is what a
    /// closure needs and a token does not. Nothing dispatches a call to one; it
    /// exists to have an address, so there is no slot to reach and no body to
    /// declare. **Calling** a class value is a separate feature, separately
    /// refused.
    ///
    /// Measured rather than argued, because a relation that states something
    /// true and changes nothing should be deleted: with the base suppressed the
    /// JVM declines a token stored where its own `typeof` is declared, and with
    /// it that case agrees on all three backends.
    ///
    /// It does **not** close every token, and the sentence that used to stand
    /// here about why was wrong for the case in front of it.
    ///
    /// This relation needs the program to *declare* the token's own `typeof`.
    /// `typeof Other` is declared nowhere in `a-class-stored-and-compared`, so
    /// `Ctor_Other` got nothing here and was declined on the JVM against the
    /// `Fn3__1` slot it is stored into. What closed that is
    /// [`crate::hir::relate_tokens_to_the_slot_they_reach`], which asks the opposite
    /// question — the signature the token is **stored into** rather than the one
    /// its own type names — and can only be asked once the whole program is
    /// known.
    ///
    /// The two rules **coincide** on `Ctor_Message`, whose own `typeof` and
    /// whose slot are both `Fn3__1`, which is why this one looked like the
    /// general answer and was the special case.
    ///
    /// What neither closes is the *union* — `cond ? TypeError : RangeError`,
    /// where a token must be two signatures at once. A base cannot relate
    /// those; what would is the thing that gives the token a representation of
    /// its own.
    ///
    /// One function for both arms below. They differ only in where the token's
    /// index comes from — a compile-time list for a provided error, the
    /// program's own count for a declared class — and the base is the same
    /// question for both. Written once because the first version was written
    /// into one arm, and the arm it was written into was not the one the
    /// failing example took.
    pub(super) fn token_base(&self, id: NodeId) -> Option<TypeId> {
        let declared = self
            .snapshot
            .node_types
            .get(&id)
            .copied()
            .filter(|declared| self.is_a_signature(*declared))?;
        // Looked up rather than demanded, and the difference is the one
        // `laid_out_as_a_prefix` documents two hundred lines up: **`layout_of`
        // is not a query, it creates**. Calling it here materialised a fieldless
        // `Fn{ty}` for a signature that had none, and the sweep answered
        // `NTS2006 closure class `Closure14` reached code generation with no
        // method to call` -- a closure that had been writing into a slot of its
        // own type now writing into a distinct one. The same sentence as the
        // `incompatible pointer types` that comment records.
        //
        // So the base is set where the program already carries the layout, and
        // left alone where it does not. A base naming a layout nothing carries
        // would be a dangling relation, which is the other half of the same
        // rule.
        self.layouts
            .iter()
            .any(|layout| layout.types.contains(&declared))
            .then_some(declared)
    }

    /// `123n`, `0xffn`, `0b1010n` -- a `bigint` literal.
    ///
    /// # The boundary, and why it is here
    ///
    /// A `bigint` is arbitrary precision in the specification. This compiler
    /// gives it 128 bits, and that is a real difference rather than an
    /// implementation detail -- so it is drawn where it can be *seen*: a
    /// literal that does not fit is refused at the place it is written, with
    /// its own digits in the message, and arithmetic that leaves the range
    /// aborts at run time rather than wrapping into a wrong answer.
    ///
    /// The trade is measured rather than assumed. Every `bigint` in the node
    /// profile is a 64-bit quantity -- `readBigUInt64BE`, an hrtime timestamp,
    /// `0xffffffffffffffffn` -- and the comment above the first of them says
    /// why: "`bigint` rather than `number`, because a `double` holds only 53
    /// bits". A true bignum would put a heap allocation in each of those,
    /// which is the opposite of what they are reaching for. 128 bits covers
    /// every one of them with 63 to spare, at the cost of one C type.
    ///
    /// What replaces it, when something needs it: the representation engines
    /// use, which is a small-integer fast path beside a heap bignum. That is a
    /// strictly larger piece of work than either half, and it belongs to the
    /// program that needs `2n ** 200n` rather than to this one.
    pub(super) fn lower_bigint(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // The literal's own text, for the reason `lower_number` reads it: the
        // spelling is the authority on what the literal is.
        let text = self
            .node(id)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)
            // No fallback to `snapshot.constants`: it holds a `Number` or a
            // `String`, and a `bigint` is neither -- folding one into a double
            // is exactly the precision this literal exists to avoid.
            .ok_or_else(|| self.unsupported(id, "a `bigint` literal with no digits"))?;

        let digits = text.trim().trim_end_matches('n');
        let Some(value) = parse_bigint(&text) else {
            return Err(self.unsupported(
                id,
                &format!(
                    "the `bigint` literal `{digits}`, which needs more than the 128 bits this \
                     compiler gives one"
                ),
            ));
        };

        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstInt(value), HirType::BigInt, origin))
    }

    pub(super) fn lower_number(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // The source text first, parsed here.
        //
        // The checker's value is a convenience: the pre-switch tsgo
        // returned `1` for `0.9999999999999999`, because a mantissa of sixteen
        // nines is above 2^53 and rounds up before the division by a power of
        // ten. `0.9999999999999998` survives, because that mantissa is even.
        // test262 found it.
        //
        // Rust's float parser is correctly rounded, and the literal's own text
        // is the authority on what the literal is -- so there is no reason to
        // ask anyone else. The checker's value stays as the fallback for a
        // spelling this does not read.
        if let Some(text) = self.node(id).text.as_ref().and_then(|text| text.as_utf8())
            && let Some(value) = parse_number(text)
        {
            let origin = self.origin(id);
            return Ok(self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin));
        }

        let value = match self.snapshot.constants.get(&id) {
            Some(nts_semantic_schema::ConstantValue::Number(value)) => *value,
            _ => self
                .snapshot
                .node_types
                .get(&id)
                .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
                .and_then(|record| match &record.kind {
                    TypeKind::Literal(LiteralValue::Number(value)) => Some(*value),
                    _ => None,
                })
                .ok_or_else(|| self.unsupported(id, "a numeric literal with no known value"))?,
        };
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin))
    }
}

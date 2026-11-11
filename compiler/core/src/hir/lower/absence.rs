//! Represent and test null, undefined, and omitted values in HIR.

use super::{
    Absent, BinOp, Diagnostic, FuncBuilder, HirType, LiteralValue, ManagedType, NodeId, OpKind,
    PropertyKey, SemanticSnapshot, TypeId, TypeKind, ValueId, claimed_reads, describe, named,
    provided, strict_operator, syntax,
};

/// A short name for a type, for a diagnostic to quote.
///
/// A refusal that says only "unrepresentable" is not a work queue. Run over a
/// corpus, "a parameter of an unrepresentable type" was the largest bar in the
/// histogram by a factor of two, and it said nothing about what to build. The
/// checker's own rendering is in the snapshot for exactly this.
#[must_use]
/// Whether a union member means "there is no value here".
///
/// All three spellings, because TypeScript uses them interchangeably at a
/// boundary: `void` is what a function returns when it returns nothing, and it
/// appears in a union for the same reason `undefined` does.
/// Which absent value a union member is, where it is one.
///
/// The distinction matters for exactly one decision -- whether a union's
/// absences fit in a pointer -- but it matters absolutely there: `null` and
/// `undefined` are different values and a program can compare them.
///
/// `void` is `undefined`. It is the type of an expression that produced no
/// value, and the value it did not produce is `undefined`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Absence {
    Null,
    Undefined,
}

pub(super) fn holds_only_absences(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    let Some(record) = snapshot.types.get(ty.0 as usize) else {
        return false;
    };
    let members: Vec<TypeId> = match &record.kind {
        TypeKind::Union(members) => members.clone(),
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        TypeKind::NonPrimitive | TypeKind::UniqueSymbol => vec![ty],
        _ => vec![ty],
    };
    !members.is_empty()
        && members
            .iter()
            .all(|member| absence_of_member(snapshot, *member).is_some())
}

pub(super) fn absence_of_member(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Absence> {
    match snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Null => Some(Absence::Null),
        TypeKind::Undefined | TypeKind::Void => Some(Absence::Undefined),
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
        _ => None,
    }
}

/// Whether a value of `ty` may be `null` or `undefined`: an absence itself, or
/// a union with one among its members.
pub(super) fn admits_absence(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    absence_of_member(snapshot, ty).is_some()
        || matches!(
            snapshot.types.get(ty.0 as usize).map(|record| &record.kind),
            Some(TypeKind::Union(members))
                if members.iter().any(|member| absence_of_member(snapshot, *member).is_some())
        )
}

/// What a built-in method's omitted argument is, where its runtime helper takes
/// every argument explicitly: `position` counts from 1 after the receiver, and
/// `given` is how many the call wrote. The language converts an absent
/// argument as it converts `undefined`, and this is that conversion, row by
/// row:
///
/// | method | position | an absence is | why |
/// |---|---|---|---|
/// | `slice`, `substring` | 1 | 0 | `ToIntegerOrInfinity(undefined)`: the start |
/// | `slice`, `substring` | 2 | Infinity | "to the end", clamped to the length |
/// | `at`, `charAt`, `codePointAt` | 1 | 0 | the first element or character |
/// | `repeat` | 1 | 0 | a count of 0: `""`, where Infinity throws a `RangeError` |
/// | `padStart`, `padEnd` | 1 | 0 | a length of 0: the string unchanged |
/// | `padStart`, `padEnd` | 2 | `" "` | the filler, supplied by `fill_string_arguments` |
/// | `splice` | 1 | 0 | the start |
/// | `splice` | 2 | 0 if nothing was given, else Infinity | `splice()` removes nothing; `splice(i)` removes to the end |
/// | `fill` | 1 | NaN | `undefined` stored in an array of numbers |
/// | `indexOf`, `lastIndexOf`, `includes`, `startsWith`, `endsWith` | 1 | refused | a search for `undefined` -- the string `"undefined"` in a string -- which no helper takes; refused rather than answered with a search for Infinity, which would say -1 forever |
/// | anything else | any | Infinity | "to the end" |
///
/// `concat()` with nothing never reaches this: it is `slice`'s copy for an
/// array and the string itself for a string, decided where the method is.
///
/// **Not "to the end" everywhere.** That was every row once, which is right
/// for a second argument and made `xs.slice()` `xs.slice(Infinity, Infinity)`,
/// an empty array, and `"abc".slice()` `""`. Three sites padded, and they
/// agreed on the wrong thing.
pub(super) fn absent_argument(
    method: &str,
    position: usize,
    given: usize,
) -> Result<f64, &'static str> {
    match (method, position) {
        (
            "slice" | "substring" | "at" | "charAt" | "codePointAt" | "repeat" | "padStart"
            | "padEnd" | "splice",
            1,
        ) => Ok(0.0),
        ("splice", 2) if given == 0 => Ok(0.0),
        ("fill", 1) => Ok(f64::NAN),
        ("indexOf" | "lastIndexOf" | "includes" | "startsWith" | "endsWith", 1) => {
            Err("a search with no argument, which looks for `undefined`")
        }
        _ => Ok(f64::INFINITY),
    }
}

impl FuncBuilder<'_> {
    pub(super) fn erased_slots_at(&self, source: NodeId, have: &HirType) -> Absent {
        match have {
            HirType::Managed(ManagedType::Array(element))
                if matches!(**element, HirType::Managed(_))
                    && self
                        .read_type(source)
                        .is_some_and(|ty| self.null_only_element(ty)) =>
            {
                Absent::Null
            }
            _ => Absent::Impossible,
        }
    }

    /// What a **null** pointer means for the value this node holds.
    ///
    /// A reference and its absence share one representation:
    /// `Managed(Object(id))` is `T`, `T | null` and `T | undefined` alike. So
    /// the tag an erasure should give a null operand is not a function of the
    /// HIR type, and asking the *source* type here is the only place it can be
    /// answered. See [`OpKind::Erase`] and `Absent`.
    ///
    /// **`T | null | undefined` answers `Impossible`**, which is the one case
    /// this cannot get right and does not pretend to: one null pointer cannot
    /// say which absence arrived, so the representation is genuinely unable to
    /// carry the program. It keeps today's behaviour rather than picking an
    /// arm, and is a gap to close with a representation and not with a guess.
    /// Where the **other arm of a merge supplies the `undefined`**.
    ///
    /// A chain's node carries the whole expression's type, and for `a?.b?.c`
    /// that is `T | null | undefined`: the `undefined` is what the
    /// short-circuit produces, on the *other* path, and the `null` is the
    /// field's. Asked flatly the answer is "both", which says nothing and is
    /// how `t?.mid?.leaf === null` stayed wrong after the tag was carried.
    ///
    /// Asked with the short-circuit's own absence set aside, what is left is
    /// what this arm's value can actually be -- which is the whole question.
    pub(super) fn absence_at_excluding(
        &self,
        id: NodeId,
        have: &HirType,
        undefined_is_the_other_arm: bool,
    ) -> Absent {
        let Some(&ty) = self.snapshot.node_types.get(&id) else {
            return Absent::Impossible;
        };
        self.absence_of_type(ty, have, undefined_is_the_other_arm)
    }

    /// [`Self::absence_at_excluding`]'s question asked of a checker type: what
    /// a null pointer of `have` means for a value written at `ty`. Asked
    /// directly where the value has no node of its own -- an array's element,
    /// a pair's half -- and through a node everywhere else.
    pub(super) fn absence_of_type(
        &self,
        ty: TypeId,
        have: &HirType,
        undefined_is_the_other_arm: bool,
    ) -> Absent {
        // **Only a reference can be the absence.** The question this answers is
        // what a *null pointer* means, and a `double` or a `bool` has no null:
        // zero bits are `+0` and `false`, values a program holds. Asked of the
        // source type alone this said `Undefined` for `let zero: number |
        // undefined = 0`, because the annotation is a union whatever the value
        // narrowed to -- and the LLVM backend, which tested the payload for zero
        // rather than testing the operand for being a reference, then tagged the
        // constant `0` as `undefined` and made `zero ??= 5` settle on 5.
        //
        // So the representation decides, here, once, and `verify` holds the IR
        // to it. See [`tags::payload_is_a_reference`].
        if !crate::hir::tags::payload_is_a_reference(have) {
            return Absent::Impossible;
        }
        // **An explicit absence is its own answer.** A `null` lowered at a
        // reference's type -- the first argument of `new Error(null as any)`,
        // typed `string` by its context -- is a null pointer whose node says
        // exactly which absence it is; asking only unions erased it as a
        // present string, and reading it crashed. (The repair rode in with
        // 86528f0c4 and was dropped with it; it does not depend on that
        // commit's array storage.)
        match absence_of_member(self.snapshot, ty) {
            Some(Absence::Null) => return Absent::Null,
            Some(Absence::Undefined) => return Absent::Undefined,
            None => {}
        }
        let Some(TypeKind::Union(members)) =
            self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind)
        else {
            return Absent::Impossible;
        };
        let mut null = false;
        let mut undefined = false;
        for member in members {
            match self.snapshot.types.get(member.0 as usize).map(|r| &r.kind) {
                Some(TypeKind::Null) => null = true,
                Some(TypeKind::Undefined | TypeKind::Void) => undefined = true,
                _ => {}
            }
        }
        if undefined_is_the_other_arm {
            undefined = false;
        }
        match (null, undefined) {
            (true, false) => Absent::Null,
            (false, true) => Absent::Undefined,
            _ => Absent::Impossible,
        }
    }

    /// A literal undefined or a void expression always takes a parameter's
    /// default. The supplied expression still runs with all other arguments,
    /// before defaults are evaluated; this predicate does not fold its effects.
    pub(super) fn undefined_argument(&self, mut argument: NodeId) -> Option<NodeId> {
        while self.kind_of(argument) == Some(syntax::PARENTHESIZED_EXPRESSION) {
            argument = *self.children(argument).first()?;
        }
        (self.is_the_undefined_literal(argument)
            || self.kind_of(argument) == Some(syntax::VOID_EXPRESSION))
        .then_some(argument)
    }

    /// The value a call passes for an optional parameter it did not reach.
    ///
    /// `f(a?: T)` called as `f()` still calls a function of one parameter, so
    /// the absence has to be a value -- and it is the same `undefined` the
    /// program could have written there, needing the same thing: a home in
    /// `T`'s representation. A reference has one, the null pointer; an erased
    /// value has one, its `undefined` tag; an `f64` has none.
    ///
    /// Before this the argument was simply not passed, and the call went out
    /// one short. That is only visible once `a?: string` has a representation
    /// at all: while the union was refused the declaration never lowered, so
    /// no call to it existed to be wrong.
    pub(super) fn absent_argument(
        &mut self,
        call: NodeId,
        at: usize,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(call);
        if let Some(value) = self.omitted_by_default(at, &origin) {
            return Ok(value);
        }
        match self.parameter_representation(call, at) {
            Some(HirType::Erased) => Ok(self.push(OpKind::ConstUndefined, HirType::Erased, origin)),
            Some(ty) if ty.is_managed() => Ok(self.push(OpKind::ConstUndefined, ty, origin)),
            // C's absence. Reached only by an `@ntsThrows` slot -- every other
            // optional native parameter is refused -- whose lowering asks
            // whether the argument was written, not what this is.
            Some(ty @ HirType::NativePointer(_)) => Ok(self.push(OpKind::ConstNull, ty, origin)),
            _ => Err(self.unsupported(
                call,
                "an omitted argument for a parameter with nowhere to put `undefined`",
            )),
        }
    }

    /// What a function's null result stands for, from its declared result
    /// type: see [`super::Func::result_absent`]. An `async` function's is its
    /// promise's payload's, as [`Self::written_return`] reads the kind.
    ///
    /// One absence only. A type admitting both `null` and `undefined` is not a
    /// nullable reference at all -- it is held erased, and its tag says which --
    /// so it answers `Impossible`, as a type admitting neither does.
    pub(super) fn result_absent(&self, declaration: NodeId) -> crate::hir::Absent {
        let Some(returns) = self.declared_result_type(declaration) else {
            return crate::hir::Absent::Impossible;
        };
        let returns = if self
            .node(declaration)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::ASYNC)
        {
            match self
                .snapshot
                .type_arguments
                .get(&returns)
                .and_then(|arguments| arguments.first())
            {
                Some(payload) => *payload,
                None => return crate::hir::Absent::Impossible,
            }
        } else {
            returns
        };
        let members = match self.snapshot.types.get(returns.0 as usize).map(|r| &r.kind) {
            Some(TypeKind::Union(members)) => members.clone(),
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => vec![returns],
            _ => vec![returns],
        };
        let absences: Vec<Absence> = members
            .iter()
            .filter_map(|member| absence_of_member(self.snapshot, *member))
            .collect();
        match (
            absences.contains(&Absence::Null),
            absences.contains(&Absence::Undefined),
        ) {
            (true, false) => crate::hir::Absent::Null,
            (false, true) => crate::hir::Absent::Undefined,
            _ => crate::hir::Absent::Impossible,
        }
    }

    /// A value as a string, converting a number the way JavaScript does.
    ///
    /// `+` resolves to concatenation from the *result* type, which is right —
    /// `"a" + "b"` is a string and `1 + 2` is not — and says nothing about the
    /// operands. `"" + n` is a string result with a `double` operand, and it
    /// used to reach the backend as `(NtsString *)v0`: a cast from a double to
    /// a pointer, which clang rejects.
    ///
    /// So the operands are converted here, by `nts_number_to_string` —
    /// ECMAScript's `Number::toString` rather than a `printf` conversion,
    /// because `%.17g` prints `0.1` as `0.10000000000000001` and switches to
    /// exponential notation at a threshold that is not JavaScript's.
    ///
    /// Everything else is refused. `String(true)` is `"true"` and an object's
    /// is `toString` off the prototype chain, and neither is a conversion this
    /// compiler has.
    /// Which absence a node *is*, where it is written as one.
    ///
    /// `null`, and `undefined` — the latter being an identifier bound to a
    /// non-writable property of the global object rather than a keyword, so a
    /// local of that name shadows it and the binding table is what says so.
    /// That is the same order `lower_identifier` takes before it reaches
    /// `lower_absent`, and asking it here keeps the two from disagreeing about
    /// what the word means.
    ///
    /// `void e` is deliberately not one: it has an operand to evaluate, and a
    /// fold that dropped it would drop its effects.
    /// Whether this expression computes nothing and cannot fail doing it.
    ///
    /// `void 0` is `undefined` and the commonest way to write it, but `void` is
    /// an operator over an arbitrary expression: `void f()` calls `f`. So the
    /// fold is allowed only where the operand is a literal, which is every
    /// spelling a program uses to mean the constant and none that does work.
    fn voids_a_literal(&self, node: NodeId) -> bool {
        self.kind_of(node) == Some(syntax::VOID_EXPRESSION)
            && self.children(node).first().is_some_and(|operand| {
                matches!(
                    self.kind_of(*operand),
                    Some(
                        syntax::NUMERIC_LITERAL
                            | syntax::STRING_LITERAL
                            | syntax::TRUE_KEYWORD
                            | syntax::FALSE_KEYWORD
                            | syntax::NULL_KEYWORD
                    )
                )
            })
    }

    pub(super) fn absence_written_at(&self, node: NodeId) -> Option<u32> {
        // **Parentheses around an absence change nothing about which one it is.**
        // `(null) !== null` is the grammar's cover production and ordinary
        // JavaScript, and the test the compiler makes here is on the node's
        // *kind*: a `PARENTHESIZED_EXPRESSION` is not a `NULL_KEYWORD`, so the
        // fold declined and the ordinary path then asked for a representation of
        // `null`, which there is none of.
        //
        // Only `null` was affected. The `undefined` branch below reads the
        // node's text rather than its kind, and a parenthesised `undefined`
        // still spells itself -- which is why `(undefined) !== undefined`
        // lowered beside `(null) !== null` refusing, and why this looked like a
        // question about `null` rather than about parentheses.
        //
        // Unwrapped here for the reason `place_of` gives for doing the same:
        // *which absence is written here* is one question and this is the
        // function that answers it. 12 files of the slice-1 `test/language`
        // population, all `expressions/grouping`.
        if self.kind_of(node) == Some(syntax::PARENTHESIZED_EXPRESSION)
            && let Some(inner) = self.children(node).into_iter().next()
        {
            return self.absence_written_at(inner);
        }
        if self.kind_of(node) == Some(syntax::NULL_KEYWORD) {
            return Some(crate::hir::tags::NULL);
        }
        // **`void 0` is `undefined` written the other way**, and folding it here
        // is what stops it being lowered at all.
        //
        // Without this the operands are lowered, and a `void` with no contextual
        // type takes `HirType::Void` -- which the C backend writes as `(void)0`
        // and then assigns to a variable:
        //
        // ```c
        //   v57 = (void)0;     /* 'v57' undeclared; invalid use of void expression */
        // ```
        //
        // A program that compiled and emitted C that does not. Pre-existing --
        // identical on the binary at 23666c14 -- and reached the moment the
        // parenthesis fixes above stopped refusing the file one line earlier,
        // which is the ordinary way a refusal hides the defect behind it.
        if self.voids_a_literal(node) {
            return Some(crate::hir::tags::UNDEFINED);
        }
        self.is_the_undefined_literal(node)
            .then_some(crate::hir::tags::UNDEFINED)
    }

    /// `null === undefined` and its family, answered without lowering either.
    ///
    /// `None` unless both sides are absences written in the source and the
    /// operator is an equality. Strict equality is "the same absence"; loose
    /// equality is "both are absences", because `null == undefined` is true and
    /// that is the one coercion this compiler is entitled to do — the two are
    /// the only values in the language that are loosely equal to each other and
    /// to nothing else.
    pub(super) fn comparison_of_two_absences(
        &self,
        lhs: NodeId,
        operator: NodeId,
        rhs: NodeId,
    ) -> Option<bool> {
        let left = self.absence_written_at(lhs)?;
        let right = self.absence_written_at(rhs)?;
        match self.kind_of(operator)? {
            syntax::EQUALS_EQUALS_EQUALS_TOKEN => Some(left == right),
            syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN => Some(left != right),
            syntax::EQUALS_EQUALS_TOKEN => Some(true),
            syntax::EXCLAMATION_EQUALS_TOKEN => Some(false),
            _ => None,
        }
    }

    pub(super) fn absent_member(&self, id: NodeId, ty: TypeId, member: &str) -> Diagnostic {
        let on_an_error = provided(self.snapshot, ty).is_some_and(crate::hir::builtin::is_error)
            || self.provided_error_base(ty).is_some();
        match crate::hir::builtin::omitted(member).filter(|_| on_an_error) {
            Some(reason) => self.unsupported(
                id,
                &format!("`{member}`, which this compiler's `Error` does not have — {reason}"),
            ),
            // Named, and named with the type it was looked for on. It is the
            // largest refusal in the node profile, and as `a property the type
            // does not declare` it was one bucket holding every cause at once:
            // a member of a library type this compiler does not model, a
            // property of a type whose decomposition stopped short, and an
            // actual absence all read the same. A refusal nobody can group by
            // is a refusal nobody can rank.
            // Declared, but not on the layout, which is a different failure
            // wearing the same words. `EventListenerSignal` declares
            // `subscribe(callback: () => void): () => void` and the refusal
            // read `which \`EventListenerSignal\` does not declare` -- a
            // sentence about the source that is false, and one that sends the
            // reader to look for a typo. What is missing is a representation
            // for the member's *type*, so that is what it says now.
            None => match self.declared_type_of(
                ty,
                &self
                    .access_key(id, member)
                    .unwrap_or_else(|| PropertyKey::Name(member.to_owned())),
            ) {
                Some(declared) => self.unsupported(
                    id,
                    &format!(
                        "`{member}`, declared by `{}` with a type that has no representation ({})",
                        named(self.snapshot, ty)
                            .map_or_else(|| "an anonymous type".to_owned(), ToOwned::to_owned),
                        describe(self.snapshot, declared)
                    ),
                ),
                None => self.unsupported(
                    id,
                    &format!(
                        "`{member}`, which `{}` does not declare",
                        named(self.snapshot, ty)
                            .map_or_else(|| "an anonymous type".to_owned(), ToOwned::to_owned)
                    ),
                ),
            },
        }
    }

    /// `c ? a : b`, and the short-circuiting `a && b` / `a || b`.
    ///
    /// All three are one shape: evaluate a condition, take one of two paths, and
    /// arrive at a value that depends on which. That is a merge block with a
    /// parameter — the same mechanism an `if` uses for a name the two arms
    /// disagree about, applied to a value with no name.
    ///
    /// The point of doing it this way rather than evaluating both sides is that
    /// both sides *must not* be evaluated: `a && expensive()` does not call
    /// `expensive` when `a` is falsy, and in a language with side effects that
    /// is a semantic difference rather than an optimization.
    /// Whether every member of this type is an absence.
    ///
    /// `null`, `null | undefined`, `undefined | void` -- types whose whole
    /// inhabitant set is `null` and `undefined`, both of which an erased value
    /// carries a tag for. [`Self::only_absences`] is the same question asked of
    /// a node.
    ///
    /// **`undefined` alone had a representation and `null` alone did not.**
    /// `representation_of` maps `Void | Undefined` to `HirType::Void` and has no
    /// arm for `TypeKind::Null`, so `{ attr: null }` and `c ? null : null` were
    /// refused while the `undefined` spelling of each compiled. The blocker
    /// fixture records why the name asymmetry exists: `undefined` doubles as the
    /// result of a function returning nothing, so returns forced an answer for
    /// it, and nothing forced one for `null`.
    ///
    /// Asked at the places a value needs a **width** -- an object's field and a
    /// merge's parameter -- and answered with `Erased`.
    ///
    /// **Deliberately not answered in `representation_of` itself, and that is
    /// the whole of why this is not the change that was reverted.**
    /// `TypeKind::Null => HirType::Erased` there was tried on 2026-09-13, agreed
    /// with node on every example, and broke on narrowing: after `b.f = null`
    /// the checker narrows a `string | null` *field read* to `null`, and a
    /// blanket answer sends the conversion down the tagged path while the
    /// storage is still a pointer. A declared field's type and a merge's
    /// parameter are positions the narrowing never reaches, and that reduction
    /// is `tests/programs/a-slot-that-can-only-be-null`'s `aNarrowedFieldIsNotThis`.
    pub(super) fn holds_only_absences(&self, ty: TypeId) -> bool {
        holds_only_absences(self.snapshot, ty)
    }

    /// The absent values a node's *type* admits, as tags.
    ///
    /// The representation has forgotten which: a `string | null` and a `string
    /// | undefined` are both one pointer. The type has not, and it is what says
    /// whether `v === undefined` can ever be true.
    pub(super) fn absences_of(&self, node: NodeId) -> Option<Vec<u32>> {
        if let Some(read) = self.actual_field_read(node) {
            return read.absences(self);
        }
        let ty = self.read_type(node)?;
        if self.hierarchy.cast_faces.contains(&ty) {
            return None;
        }
        let record = self.snapshot.types.get(ty.0 as usize)?;
        let members: Vec<TypeId> = match &record.kind {
            TypeKind::Union(members) => members.clone(),
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            TypeKind::NonPrimitive | TypeKind::UniqueSymbol => vec![ty],
            _ => vec![ty],
        };
        let mut carried: Vec<u32> = members
            .iter()
            .filter_map(|member| match absence_of_member(self.snapshot, *member)? {
                Absence::Null => Some(crate::hir::tags::NULL),
                Absence::Undefined => Some(crate::hir::tags::UNDEFINED),
            })
            .collect();
        // **Which absences, not how many members carry them.** `void` and
        // `undefined` are the same value -- `absence_of_member` maps both to
        // `Absence::Undefined` -- so `undefined | void` carries *one* absence,
        // written twice. The union's representation arm states exactly this rule
        // about itself and this function did not follow it.
        //
        // Undeduplicated the list had length two, which is neither "an absence
        // and nothing else" (`carried.len() == 1`) nor "never absent", so
        // `absence_the_type_decides` called it a real test and returned `None`.
        // The comparison then fell through to the *erased* path and emitted
        // `v22 = v20 == v21` against an `NtsValue`, where `v20` is a `Void` value
        // the C backend declares nothing for: `use of undeclared identifier`.
        //
        // The shape is `x?.m() === undefined` for a `void` `m`, and the answer is
        // `true` either way -- a void call returns `undefined`, so an optional
        // one cannot report whether it ran. node agrees, and the fixture asserts
        // it.
        carried.sort_unstable();
        carried.dedup();
        Some(carried)
    }

    /// Whether a lowered value is `null` or `undefined`.
    ///
    /// `None` where the type has no room for either, which is not a refusal:
    /// a `double` is never absent and there is nothing to compare it against.
    ///
    /// This is the *loose* question -- what `?.` and `??` ask, and what
    /// `== null` means. Both absent values answer it, which for an erased value
    /// is two tags. `===` is a different question and is answered by
    /// [`Self::erased_absence_test`].
    pub(super) fn absence_of(&mut self, at: NodeId, value: ValueId) -> Option<ValueId> {
        let ty = self.values[value.0 as usize].ty.clone();
        let origin = self.origin(at);
        match ty {
            // The tag is the answer, and it is already there.
            HirType::Erased => {
                let unsigned = HirType::Int {
                    bits: 32,
                    signed: false,
                };
                let tag = self.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
                // `undefined` is tag 0 and `null` is the highest tag, so
                // "either absence" is two comparisons however it is spelled.
                let undefined = self.push(
                    OpKind::ConstInt(i128::from(crate::hir::tags::UNDEFINED)),
                    unsigned.clone(),
                    origin.clone(),
                );
                let is_undefined = self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: tag,
                        rhs: undefined,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                let null = self.push(
                    OpKind::ConstInt(i128::from(crate::hir::tags::NULL)),
                    unsigned,
                    origin.clone(),
                );
                let is_null = self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: tag,
                        rhs: null,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                Some(self.push(
                    OpKind::Binary {
                        op: BinOp::BitOr,
                        lhs: is_undefined,
                        rhs: is_null,
                    },
                    HirType::Bool,
                    origin,
                ))
            }
            // A reference has one absent value and it is the null pointer. The
            // emitter compares addresses for this rather than reading through
            // them, which for a string is the difference between an answer and
            // a fault.
            HirType::Managed(_) | HirType::NativePointer(_) => {
                let null = self.push(OpKind::ConstNull, ty, origin.clone());
                Some(self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: value,
                        rhs: null,
                    },
                    HirType::Bool,
                    origin,
                ))
            }
            _ => None,
        }
    }

    /// Whether a type still admits `null` or `undefined`.
    ///
    /// Asked of the **type** rather than the representation, because the two
    /// disagree exactly where it matters: `F` and `F | undefined` are both a
    /// pointer, since a nullable reference is what the one spare pointer value
    /// is for. A caller that needs to know whether the checker *narrowed* an
    /// absence away cannot read that off the width.
    pub(super) fn admits_absence(&self, ty: TypeId) -> bool {
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return true;
        };
        match &record.kind {
            TypeKind::Union(members) => members
                .iter()
                .any(|member| absence_of_member(self.snapshot, *member).is_some()),
            _ => absence_of_member(self.snapshot, ty).is_some(),
        }
    }

    /// `null` and `undefined`, which are one value in a compiled program.
    ///
    /// A reference has a value that is not an object, so the absence needs no
    /// tag beside it. What it does need is a *type*: C tells a null
    /// `NtsString *` from a null `NtsObj_Point *` even though both are the same
    /// address, and the literal itself has neither -- the checker types it
    /// `null`. So the type comes from where the literal sits.
    pub(super) fn lower_absent(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let ty = self
            .contextual_type(id, 0)
            .or_else(|| self.expecting.clone());
        // Which of the two was written. An erased slot has a tag for each, so
        // the distinction survives into the emitted value; a pointer has room
        // for one, and a type carrying both is erased rather than a pointer
        // precisely so that this can never be lost.
        let literal = if self.kind_of(id) == Some(syntax::NULL_KEYWORD) {
            OpKind::ConstNull
        } else {
            OpKind::ConstUndefined
        };
        self.absent_at(literal, ty, id)
    }

    /// An absence at a representation somebody else chose.
    ///
    /// Split out of [`Self::lower_absent`] for a second caller with no literal
    /// to read a type from: a bare `return;` in a function whose declared return
    /// type is not `void`. That is legal TypeScript wherever the type admits
    /// `undefined` -- `function maybe(): number | undefined { return; }` -- and
    /// it produced `Terminator::Return(None)` against a signature returning
    /// `Erased`, which `verify` refuses as `ReturnType { expected: Erased, found:
    /// None }`. Invalid HIR costs the **whole program**, because `emit-c` writes
    /// nothing from a program that does not verify; found by the full test262
    /// census, one file in 29,586.
    ///
    /// One function rather than a rule of its own at the `return`, because
    /// "which op stands for an absence at this representation" is the fact
    /// `lower_absent` exists to answer, and a second answer to it is how
    /// `ConstNull` and `ConstUndefined` would come to disagree about a nullable
    /// pointer. The `return` supplies the type and asks; it decides nothing.
    pub(super) fn absent_at(
        &mut self,
        literal: OpKind,
        ty: Option<HirType>,
        id: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        if matches!(ty, Some(HirType::Erased | HirType::Void)) {
            let origin = self.origin(id);
            return Ok(self.push(literal, HirType::Erased, origin));
        }
        let ty = ty.filter(|ty| {
            ty.is_managed()
                || (matches!(literal, OpKind::ConstNull) && matches!(ty, HirType::NativePointer(_)))
        });
        let Some(ty) = ty else {
            return Err(self.unsupported(
                id,
                "`null` or `undefined` where what it stands in for is not a reference",
            ));
        };
        // A **signature** taken from a context is one nothing has laid out.
        //
        // Everywhere else a function type acquires its layout from a
        // declaration -- a parameter, a field, a variable's annotation -- and
        // `materialize` is called there. This arm invents a type from where the
        // literal *sits*, so no declaration was consulted and none will be:
        //
        //     const g: ((x: number) => number) | undefined =
        //       n > 0 ? (x) => x * 2 : undefined;
        //
        // The annotation is one type id and the union's function member is
        // another -- `signature_name` exists because two ids for one written
        // signature are ordinary here -- and only the annotation's was
        // materialized. So the `undefined` was pushed at a type no layout
        // answered for and the C backend refused the whole function with
        // `NTS2006 an object type with no layout`, naming the type rather than
        // the literal that produced it. `collect_layouts` merges the two by
        // name once both exist.
        //
        // Signatures only, and that is a totality argument rather than a
        // preference: `layout_of` answers unconditionally for a function type,
        // where for anything else it can refuse -- and refusing *here* would
        // stop a program whose value the later passes go on to eliminate.
        if let HirType::Managed(ManagedType::Object(object)) = ty
            && self.is_a_signature(object)
        {
            self.layout_of(id, object)?;
        }
        let origin = self.origin(id);
        Ok(self.push(literal, ty, origin))
    }

    /// `pointer === undefined` (or `null`, `!==`, `==`) where the pointer's
    /// type carries that absence as its null.
    fn pointer_absence_test(
        &mut self,
        id: NodeId,
        operator: u16,
        value: NodeId,
        ty: HirType,
    ) -> Result<ValueId, Diagnostic> {
        let value = self.lower_expression(value)?;
        let origin = self.origin(id);
        let null = self.push(OpKind::ConstNull, ty, origin.clone());
        let op = if matches!(
            operator,
            syntax::EXCLAMATION_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
        ) {
            BinOp::Ne
        } else {
            BinOp::Eq
        };
        Ok(self.push(
            OpKind::Binary {
                op,
                lhs: value,
                rhs: null,
            },
            HirType::Bool,
            origin,
        ))
    }

    fn absence_the_type_decides(
        &mut self,
        id: NodeId,
        operator: u16,
        value: NodeId,
        written: u32,
    ) -> Option<Result<ValueId, Diagnostic>> {
        let carried = self.absences_of(value)?;
        // Three ways the type settles it, and one way it does not.
        //
        // A type that is an absence and *nothing else* is the case the checker
        // hands back after `v = undefined`: every later read is typed
        // `undefined`, so `v !== undefined` is not a test, it is `false`. It
        // was refused, while the same comparison on the wider `number |
        // undefined` was answered — a value the checker knew *more* about
        // being the one that could not be compiled.
        let equal = if self.only_absences(value) && carried.len() == 1 {
            // `===` asks whether it is that absence; `==` accepts either,
            // since `null == undefined`.
            Some(!strict_operator(operator) || carried[0] == written)
        } else if carried.is_empty() || (strict_operator(operator) && !carried.contains(&written)) {
            // Never absent, or a pointer asked about the absence it does not
            // carry. Both are false.
            Some(false)
        } else {
            // A pointer asked about the absence it does carry: a real test.
            None
        };
        let Some(equal) = equal else {
            // A pointer asked about the absence it carries -- `NSObject |
            // undefined`, what `map.get(k)` answers, against `undefined` --
            // has room for that one absence only, as null: the test is its
            // null.
            if let Some(ty @ HirType::NativePointer(_)) =
                self.type_of(value).or_else(|| self.bound_type(value))
            {
                // Both absences, one null: a strict comparison asks which it
                // is, which the null does not say.
                if strict_operator(operator) && carried.len() > 1 {
                    return Some(Err(self.unsupported(
                        id,
                        "a strict comparison of a handle that may be `null` or `undefined` with one of them: both are its null here, as Swift's `nil` is -- compare with `== null`",
                    )));
                }
                return Some(self.pointer_absence_test(id, operator, value, ty));
            }
            return None;
        };
        // The answer is known; the operand is still evaluated. Folding it away
        // made `next() === undefined` skip the call to `next`, which node
        // makes -- a constant is what the *comparison* is, not what the
        // expression is.
        if let Err(diagnostic) = self.lower_expression(value) {
            return Some(Err(diagnostic));
        }
        let origin = self.origin(id);
        let negated = matches!(
            operator,
            syntax::EXCLAMATION_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
        );
        let answer = if negated { !equal } else { equal };
        Some(Ok(self.push(
            OpKind::ConstBool(answer),
            HirType::Bool,
            origin,
        )))
    }

    /// Whether `node` is a getter read the checker narrowed past an absence
    /// its declaration admits: [`Self::read_type`] says it can be absent and
    /// the checker's type says it cannot. Nothing tested that narrowing.
    pub(super) fn narrowed_past_absence(&self, node: NodeId) -> bool {
        let Some(narrowed) = self.snapshot.node_types.get(&node).copied() else {
            return false;
        };
        self.read_type(node)
            .is_some_and(|read| read != narrowed && self.admits_absence(read))
            && !self.admits_absence(narrowed)
    }

    /// Whether the expression at `node` is dereferenced where it stands: the
    /// object of a member or element access that is not an optional chain,
    /// through any parentheses.
    pub(super) fn dereferenced(&self, node: NodeId) -> bool {
        let mut at = node;
        while let Some(parent) = self.node(at).parent {
            match self.kind_of(parent) {
                Some(syntax::PARENTHESIZED_EXPRESSION) => at = parent,
                Some(syntax::PROPERTY_ACCESS_EXPRESSION | syntax::ELEMENT_ACCESS_EXPRESSION) => {
                    let children = self.children(parent);
                    return children.first() == Some(&at)
                        && !children
                            .iter()
                            .any(|child| self.kind_of(*child) == Some(syntax::QUESTION_DOT_TOKEN));
                }
                _ => return false,
            }
        }
        false
    }

    /// `o.m !== undefined` where `m` is an **optional method** on `o`'s type.
    ///
    /// # The shape the corpus actually writes
    ///
    /// `o.m?.()` was landed first and the ledger recorded the remainder as
    /// doubly-optional calls -- `this.socket?.cork?.()`. That was measured by
    /// reading, and it was wrong. With the doubly-optional form also lowering,
    /// **21 distinct sites** remain across `stream`, `http`, `net` and `fs` and
    /// **none of them is a call**. Nineteen are this test, in three spellings:
    ///
    /// ```text
    ///   12  if (writer.writeSync !== undefined) { ... }
    ///    6  if (typeof stream._construct === "function") { ... }
    ///    1  if (!this.push(chunk) && stream.pause) { ... }
    /// ```
    ///
    /// Which is the same question `o.m?.()` asks and `"m" in o` already
    /// answers: presence of an optional method varies per **class**, not per
    /// instance, so it is one descriptor comparison. Lowering the member read
    /// instead asks for a slot that a method does not have, and refuses with
    /// ``a union of a function type | undefined`` -- a layout question wearing
    /// a representation sentence, which is the same misattribution the call
    /// form had.
    ///
    /// This arm takes `!== undefined` and `=== undefined`. The other two
    /// spellings are their own shapes and are not folded in here on the
    /// strength of looking similar.
    /// Which member a presence test is about, and whether it asks for present.
    ///
    /// Three spellings of one question, and the two `typeof` ones are here
    /// rather than folded into the `undefined` arm because they are not the
    /// same comparison: `typeof o.m === "function"` compares a *string* to a
    /// string and would have to be recognised as a presence test before either
    /// side is lowered, which is exactly what this does.
    ///
    /// `typeof o.m === "object"` and the rest are **not** presence tests --
    /// they are constantly false for a method -- and fall through to the
    /// ordinary path rather than being folded to `false` here. Folding them
    /// would be answering a question this function was not asked.
    ///
    /// `value` is the side that might be the member, `against` the side that
    /// might be what it is compared to.
    pub(super) fn presence_operand(
        &self,
        value: NodeId,
        against: NodeId,
        positive: bool,
    ) -> Option<(NodeId, bool)> {
        // `o.m !== undefined`. An optional method is absent by being undefined
        // and never by being null, so `o.m !== null` is a different question
        // about a program that would not typecheck.
        if self.is_the_undefined_literal(against)
            && self.kind_of(value) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
        {
            return Some((value, !positive));
        }
        if self.kind_of(value) != Some(syntax::TYPE_OF_EXPRESSION) {
            return None;
        }
        // **Off the literal's type, the way `lower_string` reads one.** A
        // string literal's value is `TypeKind::Literal(LiteralValue::String)`;
        // `node.text` is not it, and reading it there matched nothing and
        // silently left every `typeof` site refused exactly as before.
        let named = self
            .snapshot
            .node_types
            .get(&against)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .and_then(|record| match &record.kind {
                TypeKind::Literal(LiteralValue::String(text)) => text.as_utf8(),
                _ => None,
            })?;
        let present = match named {
            "function" => positive,
            "undefined" => !positive,
            _ => return None,
        };
        let operand = *self.children(value).first()?;
        Some((operand, present))
    }

    pub(super) fn erased_absence_test(
        &mut self,
        id: NodeId,
        operator: u16,
        lhs: NodeId,
        rhs: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        if !matches!(
            operator,
            syntax::EQUALS_EQUALS_TOKEN
                | syntax::EQUALS_EQUALS_EQUALS_TOKEN
                | syntax::EXCLAMATION_EQUALS_TOKEN
                | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
        ) {
            return None;
        }
        let absent = |builder: &Self, node: NodeId| {
            if builder.kind_of(node) == Some(syntax::NULL_KEYWORD) {
                Some(crate::hir::tags::NULL)
            } else if builder.is_the_undefined_literal(node) {
                Some(crate::hir::tags::UNDEFINED)
            } else {
                None
            }
        };
        // Either order: `x === null` and `null === x` are the same question.
        let (value, written) = match (absent(self, rhs), absent(self, lhs)) {
            (Some(tag), _) => (lhs, tag),
            (None, Some(tag)) => (rhs, tag),
            (None, None) => return None,
        };
        // Erased by its type, or -- where the checker's type has no
        // representation, as `NSObject | undefined` from a map's `get` has
        // none -- by what the name is bound to. Or a read the checker calls
        // present -- a string record's entry, a `!` -- which may be `undefined`
        // all the same: it arrives erased here (`claimed_reads`).
        if self.type_of(value).or_else(|| self.bound_type(value)) != Some(HirType::Erased)
            && !claimed_reads::stays_erased(self, value)
        {
            return self.absence_the_type_decides(id, operator, value, written);
        }
        Some((|| {
            let value = self.lower_expression(value)?;
            let origin = self.origin(id);
            let tag_value = self.push(
                OpKind::TagOf { value },
                HirType::Int {
                    bits: 32,
                    signed: false,
                },
                origin.clone(),
            );
            let unsigned = HirType::Int {
                bits: 32,
                signed: false,
            };
            let positive = matches!(
                operator,
                syntax::EQUALS_EQUALS_TOKEN | syntax::EQUALS_EQUALS_EQUALS_TOKEN
            );
            let strict = matches!(
                operator,
                syntax::EQUALS_EQUALS_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
            );
            let op = if positive { BinOp::Eq } else { BinOp::Ne };

            // One comparison per tag the operator asks about. `===` asks about
            // the one that was written; `==` asks about both, because `null ==
            // undefined` is true and is the whole reason the loose operator is
            // still worth writing.
            let against = |builder: &mut Self, tag: u32| {
                let wanted = builder.push(
                    OpKind::ConstInt(i128::from(tag)),
                    unsigned.clone(),
                    origin.clone(),
                );
                builder.push(
                    OpKind::Binary {
                        op,
                        lhs: tag_value,
                        rhs: wanted,
                    },
                    HirType::Bool,
                    origin.clone(),
                )
            };
            if strict {
                return Ok(against(self, written));
            }
            let undefined = against(self, crate::hir::tags::UNDEFINED);
            let null = against(self, crate::hir::tags::NULL);
            // De Morgan rather than a negation: `x == null` is "either", and
            // `x != null` is "neither", so the same two comparisons combine
            // one way or the other.
            let join = if positive {
                BinOp::BitOr
            } else {
                BinOp::BitAnd
            };
            Ok(self.push(
                OpKind::Binary {
                    op: join,
                    lhs: undefined,
                    rhs: null,
                },
                HirType::Bool,
                origin,
            ))
        })())
    }
}

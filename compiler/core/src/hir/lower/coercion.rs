//! Coerce HIR values and check representation and layout compatibility.

use super::{
    Absent, Declares, Diagnostic, Field, FuncBuilder, HirType, ManagedType, NodeId, OpKind, Origin,
    Place, PropertyKey, TypeId, ValueId, assertions, callable_fields, class_symbol, erasable,
    is_a_generic_declaration, literal_methods, representation_mismatch, syntax,
};

pub(super) fn readable_back(ty: &HirType) -> bool {
    // Everything that can be erased, except `Void`. The two directions are one
    // fact and they had drifted: `View` and `Buffer` could be erased and not
    // read back, so `typeof v === "object"` on an `unknown` holding a
    // `Uint8Array` refused where the value was sitting right there.
    //
    // `Void` is the deliberate asymmetry and the reason this is not simply
    // `erasable`. `undefined` has no payload -- the tag *is* the whole value --
    // so there is something to erase and nothing to load.
    ty != &HirType::Void && erasable(ty)
}

/// Whether a base's field and a derived's are the same slot.
///
/// The same question `verify::check_layouts` asks, and it has to be asked the
/// same way, which is the only reason this is not two functions.
///
/// Member identity and type. [`Field::names_the_same_member`] carries the first
/// half and says why a public field's declaring class is not consulted.
///
/// Names as well as types, because a prefix of the right types and the wrong
/// fields is not a prefix; types as well as names, because a derived class may
/// narrow one.
pub(in crate::hir) fn same_slot(want: &Field, have: &Field) -> bool {
    want.names_the_same_member(have) && want.ty == have.ty
}

/// Why a pointer cast from one object layout to another is not a no-op.
///
/// **Three facts wore one sentence, and they have different repairs.** The
/// refusal used to read "a pointer cast between two structs that do not agree
/// about where their shared fields are" for all of them, and it describes the
/// last:
///
/// - the target declares *more* fields than the source holds, so the extra ones
///   have no storage at any offset. Nothing about ordering reaches it -- it is a
///   **widening**, and what it needs is a representation an interface can have
///   independently of the object that arrives at it;
/// - the target names a field the source does not hold at all, at a count that
///   does not say so -- two option bags of six fields each, four of them
///   shared. The same absence as a widening, arriving without the arithmetic;
/// - the two hold the same fields in a different order, which really is an
///   offset question, and laying the fields out the same way answers it. This
///   is the only one of the three a layout convention could reach, which is the
///   point of separating it from the two that look like it.
///
/// Reading the first as the second costs a day. `runtime/node/zlib` passes an
/// `IteratorZlibOptions` where an `IteratorEngineOptions` is wanted, and the
/// sentence sent the diagnosis into `record_structural_call` looking for a
/// missing copy -- when the target simply declares eight fields where the
/// source holds six, and every copy the machinery could make relocates the cast
/// rather than removing it. The census could not tell them apart either, so the
/// split is what makes "how much of this is cheap" a question with an answer.
/// See `tests/refusals/an-options-bag-widened-by-assignment`.
///
/// The sentences are deliberately *not* prefixes of one another: a fixture or a
/// census matching on text has to pick one.
pub(super) enum NotAPrefix {
    /// The target declares fields the source has no storage for.
    Widens {
        wanted: usize,
        held: usize,
        /// The first target field past the end of the source.
        first: String,
    },
    /// The source holds no field of this name and type anywhere, at a count
    /// that does not make it a widening.
    Missing { name: String },
    /// Every target field is in the source and the order is wrong -- and this
    /// is the only one of the three a layout convention could answer.
    Disagrees {
        at: usize,
        wanted: String,
        held: String,
    },
    /// The source has no layout to compare. The target has fields, so something
    /// will be read; a shape that cannot be established cannot be shown to hold
    /// them where the target expects.
    Unknown,
    /// One field is written as a scalar kind in one type and not, or as
    /// another, in the other: the same storage, and a fact one side's stores
    /// never proved.
    Kind {
        name: String,
        wanted: Option<crate::hir::native::Scalar>,
        held: Option<crate::hir::native::Scalar>,
    },
}

impl NotAPrefix {
    /// The refusal, given each type as [`FuncBuilder::type_in_a_message`] spells it.
    ///
    /// **The phrase arrives complete**, and this adds neither an article nor
    /// backticks. It used to do both -- `a `{from}`` -- which is right for a
    /// declared name and produces `a `an anonymous type`` for everything else. One
    /// contract instead: the helper owns the whole noun phrase, so `` `Bag` ``,
    /// `the anonymous `{ a, c }`` and `the tuple `[string, number]`` all read in
    /// this sentence and in `on {who}` next door.
    pub(super) fn spell(&self, from: &str, to: &str) -> String {
        match self {
            Self::Widens {
                wanted,
                held,
                first,
            } => format!(
                "{from} where {to} is wanted -- {to} declares {wanted} fields and {from} \
                 holds {held}, so `{first}` has no storage at any offset and a pointer \
                 cast cannot widen a struct"
            ),
            Self::Missing { name } => format!(
                "{from} where {to} is wanted -- {to} holds `{name}` and {from} \
                 has no field of that name and type, so a pointer cast leaves the read with \
                 nothing to land on"
            ),
            Self::Disagrees { at, wanted, held } => format!(
                "{from} where {to} is wanted, which is a pointer cast between two \
                 structs that do not agree about where their shared fields are -- {to} \
                 holds `{wanted}` in slot {at} where {from} holds `{held}`, and a base's \
                 fields keep their offsets in a subclass where a structural type's do not"
            ),
            Self::Unknown => format!(
                "{from} where {to} is wanted, and {from} has no layout here, so \
                 nothing can show it holds {to}'s fields where {to} expects them"
            ),
            Self::Kind { name, wanted, held } => {
                let kind = |kind: &Option<crate::hir::native::Scalar>| {
                    kind.map_or_else(
                        || "a plain `number`".to_owned(),
                        |kind| format!("`{}`", crate::hir::native::Type::Scalar(kind).c_type()),
                    )
                };
                format!(
                    "{from} where {to} is wanted -- `{name}` is {} in {to} and {} in {from}, \
                     and one object is both: a store through one type would be read through \
                     the other as a kind it was never proven to fit, so an object's scalar \
                     fields must be written alike",
                    kind(wanted),
                    kind(held),
                )
            }
        }
    }
}

impl FuncBuilder<'_> {
    /// A value where a slot of a possibly different type expects it.
    ///
    /// Only erasure today. Every other pair either already matches or is a
    /// mismatch the verifier now reports -- it checks call argument types as of
    /// this change, which is how the missing conversion was found rather than
    /// compiled: a `NtsString *` passed into a `NtsValue` parameter is a struct
    /// initialised from a pointer, and C accepts it.
    ///
    /// References are refused by name rather than erased. A payload that is
    /// sometimes a pointer needs retain and release that switch on the tag, and
    /// reference counting that is subtly wrong does not announce itself.
    pub(super) fn coerce(
        &mut self,
        value: ValueId,
        want: &HirType,
        id: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        self.coerce_from(value, want, id, id)
    }

    /// The same, told which node the **value** came from.
    ///
    /// They differ at a merge, and only there so far, but the difference is a
    /// wrong answer and not a nicety. A conditional's node carries the type of
    /// the *whole* expression, and for `a?.b?.c` that is `T | null | undefined`
    /// -- the `undefined` from the short-circuit and the `null` from the field.
    /// The value being erased is one **arm**, whose own type is `T | null`, and
    /// which absence a null pointer means is exactly what [`Self::absence_at`]
    /// is asking. Asked of the merge it reads "both", which says nothing;
    /// asked of the arm it reads "null", which is the answer.
    pub(super) fn coerce_from(
        &mut self,
        value: ValueId,
        want: &HirType,
        id: NodeId,
        source: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        self.coerce_arm(value, want, id, source, false)
    }

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn coerce_arm(
        &mut self,
        value: ValueId,
        want: &HirType,
        id: NodeId,
        source: NodeId,
        undefined_is_the_other_arm: bool,
    ) -> Result<ValueId, Diagnostic> {
        let have = self.values[value.0 as usize].ty.clone();
        if have == *want {
            return Ok(value);
        }
        if let (
            HirType::Managed(ManagedType::Object(owner)),
            HirType::Managed(ManagedType::Object(face)),
        ) = (&have, want)
            && literal_methods::uses_dispatch(self, *owner, *face)
            && !self.hierarchy.descends_from(*owner, *face)
        {
            return Err(self.unsupported(
                id,
                "a literal converted to a method interface without a complete dispatch table -- \
                 its method supplies or possible writes could not satisfy every slot contract",
            ));
        }
        // Erasure preserves the object's identity. Reading it back as writable
        // array storage checks immutability; a direct cast cannot forge either
        // representation's capability.
        if *want != HirType::Erased
            && (matches!(have, HirType::Managed(ManagedType::Template))
                || matches!(want, HirType::Managed(ManagedType::Template)))
            && !matches!(
                self.values[value.0 as usize].kind,
                OpKind::ConstNull | OpKind::ConstUndefined
            )
        {
            return Err(self.unsupported(id, "converting between an immutable template object and a different managed representation"));
        }
        if let Some(converted) = self.coerce_to_native_pointer(value, &have, want, id) {
            return converted;
        }
        if matches!(want, HirType::NativePointer(_)) && !matches!(have, HirType::NativePointer(_)) {
            return Err(self.unsupported(
                id,
                "a managed value where C takes a pointer: pass a handle, a `Ptr`, or `null`",
            ));
        }
        // A counted handle into an erased slot falls through to the erase
        // below, as its family's tag; every other conversion of a C pointer
        // stays refused.
        let tagged = *want == HirType::Erased && erasable(&have);
        if !tagged
            && (matches!(have, HirType::NativePointer(_))
                || matches!(want, HirType::NativePointer(_)))
        {
            return Err(self.unsupported(
                id,
                "an opaque C pointer converted to a different representation",
            ));
        }
        // A slot of type `never` cannot receive a value, and one is arriving.
        // `{ from: "x" as never }` is how a program gets here: the assertion
        // typechecks and is false, so the field's declared type says nothing
        // can be stored where a string is being stored. Refusing is the honest
        // answer -- the alternative is to represent the field by whatever the
        // first store happens to be, and a layout is shared by every value of
        // the type.
        if *want == HirType::Never {
            return Err(self.unsupported(id, "a value asserted to be `never`"));
        }
        if *want != HirType::Erased {
            // **Nothing has no representation but its own.** A `void` result
            // where anything else is wanted passed every check below -- it is
            // neither managed nor erased -- and arrived unchanged, so the
            // verifier stopped the whole program at its use. An erased slot
            // takes it as `undefined` (the arm after this branch); every other
            // slot has no `undefined` to hold, so it is refused here, by name.
            if have == HirType::Void {
                return Err(self.unsupported(id, &representation_mismatch(&have, want)));
            }
            // The absent constant is the one value that can be re-made at
            // another representation without asking what it holds: `null` is a
            // null pointer as a reference and a tag as an erased value, and it
            // is the same `null` either way.
            //
            // It arrives here because a conditional's own type can be narrower
            // than the declaration it flows into. `const v: string | null |
            // undefined = n < 10 ? null : "x"` types the conditional `string |
            // null` -- one absence, so a pointer -- while the literal took the
            // declaration's two-absence type, which is erased.
            if have == HirType::Erased
                && want.is_managed()
                && matches!(
                    self.values[value.0 as usize].kind,
                    OpKind::ConstNull | OpKind::ConstUndefined
                )
            {
                let kind = self.values[value.0 as usize].kind.clone();
                let origin = self.origin(id);
                return Ok(self.push(kind, want.clone(), origin));
            }
            // An erased union every arm of which is the wanted class.
            //
            // `const shape: Shape = n > 0 ? new Circle(n) : new Square(-n)` is
            // the shape, and it is how anyone writes a hierarchy. The
            // conditional's own type is `Circle | Square` -- two
            // representations, so an erased value -- and the declaration says
            // `Shape`, which both of them are.
            //
            // That is an *upcast*, and base-first layout makes it free: a
            // pointer to a `Circle` is a pointer to a `Shape` at the same
            // address with the base's fields at the same offsets. The tag is
            // read off and thrown away, which is what `Unerase` is.
            //
            // The license is the checker's rather than a narrowing's, and it is
            // the stronger of the two: narrowing licenses an unerase because a
            // tag was tested on the path that reaches it, and this licenses one
            // because *every* arm satisfies the target, so no path can arrive
            // with anything else. `descends_from` is asked of each arm rather
            // than of the union, because a union is not a class.
            if let (HirType::Erased, HirType::Managed(ManagedType::Object(target))) = (&have, want)
                && self.every_arm_descends_from(id, *target)
            {
                let origin = self.origin(id);
                return Ok(self.push(OpKind::unerase(value), want.clone(), origin));
            }
            // Anything else erased, arriving where something concrete is
            // wanted, is refused rather than passed through. Passing it through
            // is what put an `NtsValue` on a block edge declared as a pointer:
            // the verifier caught it, and nothing before the verifier did.
            if have == HirType::Erased {
                return Err(self.unsupported(
                    id,
                    "an erased value where a concrete representation is wanted",
                ));
            }
            // Two managed types is an upcast, which base-first layout makes a
            // no-op pointer cast -- the verifier accepts it for that reason,
            // and the typechecker already decided it was legal. A managed value
            // where a scalar is wanted, or a scalar where a reference is, is
            // not a conversion at all, and passing it through is what put a
            // `bool` on a block edge declared as an object pointer.
            //
            // `||` is where it comes from. `a || b || (typeof f === "function")`
            // has an object on one arm and a boolean on another, and the join
            // takes the whole expression's type -- so one arm agrees with it and
            // the other is handed over unchanged. It reached the verifier as
            // `EdgeType { expected: Managed(Object(606)), found: Bool }` and
            // nothing before the verifier said a word, because this line was
            // the last one and it said yes to everything left.
            if have.is_managed() != want.is_managed() {
                return Err(self.unsupported(id, &representation_mismatch(&have, want)));
            }
            // **And base-first layout is a fact about a base, not about every
            // pair of object types.** The sentence above was true of the case it
            // was written for -- a subclass reaching a base-typed slot -- and the
            // emitter writes `(NtsObj_Base *)derived` on the strength of it. A
            // *structural* target is the same operation with no such guarantee:
            //
            //     interface Named { name: string }
            //     class Thing { id: number; name: string }
            //     readName(new Thing(5))
            //
            // `Thing.name` is at offset 32 and `Named.name` at 24, so
            // `readName` reads `id` -- a `double` -- as an `NtsString *` and
            // dereferences it. **Measured: the addon exits on SIGSEGV where node
            // answers 6.** Writing the same class as `{ name; id }` puts the two
            // at the same offset and the program is correct, so *declaration
            // order* decided whether it crashed and nothing said so.
            //
            // Refused rather than converted, because a conversion would be a
            // copy and a copy is not the same object: `readName` writing through
            // its parameter has to be visible to the caller, which is what a
            // reference means. The prefix case is the one that is genuinely a
            // no-op and it is the one this admits.
            // **The same question one container along, and the verifier was
            // answering it.** `number[]` is assignable to `readonly unknown[]`
            // in TypeScript and the two are different arrays here: eight bytes
            // of `double` against a sixteen-byte `NtsValue`. Passing one as the
            // other reached `verify` as
            // `CallArgumentType { expected: Managed(Array(Erased)),
            // found: Managed(Array(Float { bits: 64 })) }` and stopped the
            // build with `refusing to emit code from invalid HIR` -- which is
            // the right outcome arriving at the wrong end, with no source
            // location and nothing naming the two element types.
            //
            // Refused rather than converted, for the reason the struct case
            // gives: a conversion is a copy and a copy is not the same object.
            // `readonly` promises the callee will not write, which makes a copy
            // *safe* and still leaves `===` answering differently.
            if let (
                HirType::Managed(ManagedType::Array(from)),
                HirType::Managed(ManagedType::Array(to)),
            ) = (&have, want)
                && from != to
                && !self.the_same_element(id, from, to)
            {
                let why = self.not_the_same_element(id, from, to);
                return Err(self.unsupported(id, &why));
            }
            let view = self.native_field_view(id, value, &have, want)?;
            if let Some(why) = self.crossing_storage(&have, want) {
                return Err(self.unsupported(id, &why));
            }
            if let Some(why) = self.result_without_an_erased_form(&have, want) {
                return Err(self.unsupported(id, &why));
            }
            if let Some(why) = self.result_of_another_kind(&have, want) {
                return Err(self.unsupported(id, &why));
            }
            if let Some(why) = self.result_of_another_layout(id, &have, want) {
                return Err(self.unsupported(id, &why));
            }
            self.record_arrival(&have, want, id);
            if Self::tagged_collection_view(&have, want) {
                return Ok(self.collection_view(id, value, want.clone()));
            }
            return Ok(view.map_or(value, |kind| self.push(kind, want.clone(), self.origin(id))));
        }
        // **A `void` value erases to `undefined`, because that is what it is.** A
        // function with no `return` completes with `undefined`, so
        //
        //     function counter(): void { initCount += 1 }
        //     function h({ w = counter() }) { … }
        //
        // has `w` as `undefined` -- and this erased the *call's* result, which in C
        // is nothing at all:
        //
        //     %5 = call counter() : void
        //     %7 = erase %5 : erased     ->  error: 'v5' undeclared
        //                                   error: invalid use of void expression
        //
        // Uncompilable C rather than a refusal, so `emit-c` wrote nothing for the
        // whole program: three recorded test262 files, and the conformance lane's
        // reduction reaches it with a plain function and no generator.
        //
        // **The call above this still runs**, which is the half that must not be
        // lost: node increments `initCount` too. Only the value it did not produce
        // is replaced.
        //
        // Here rather than in [`Self::erased`], which documents itself as owning the
        // *identity* case, because this is the one place that decides a coercion
        // **to** an erased value and `absent` is computed beside it. Two readers of
        // one rule is what that helper's own header is a complaint about.
        if matches!(have, HirType::Void) {
            let origin = self.origin(id);
            return Ok(self.push(OpKind::ConstUndefined, HirType::Erased, origin));
        }
        if !erasable(&have) {
            return Err(self.unsupported(
                id,
                &format!("a value of type {have:?} where `unknown` is expected"),
            ));
        }
        let origin = self.origin(id);
        let absent = self.absence_at_excluding(source, &have, undefined_is_the_other_arm);
        // What a null element slot of the array means, read off the array's
        // own type while it is still in hand -- the erased read that comes
        // later sees `any[]`. See `OpKind::Erase`.
        let slots = self.erased_slots_at(source, &have);
        Ok(self.push(
            OpKind::Erase {
                value,
                absent,
                slots,
            },
            HirType::Erased,
            origin,
        ))
    }

    /// One argument, at the type the callee's parameter declares.
    ///
    /// The parameter type comes from the checker's resolved signature rather
    /// than from the callee's lowered `Func`, because the callee may not be
    /// lowered yet: `lower` walks declarations in index order and a call can
    /// precede its target.
    /// Whether a value of one layout can be *read* as another by pointer cast.
    ///
    /// True when the target's fields are the source's first fields, in order,
    /// with the same names and the same representations -- which is exactly what
    /// makes `(NtsObj_Base *)derived` a no-op, and exactly what a subclass gets
    /// from base-first layout.
    ///
    /// Names **and** types, because either alone lets a wrong one through: two
    /// fields called `size` holding a `double` and an `NtsString *` are the same
    /// name and different loads, and two fields at the same offset with
    /// different names are the same load and a different program.
    ///
    /// A target with no fields is trivially a prefix, which is right: nothing
    /// can be read through it.
    fn laid_out_as_a_prefix(&mut self, id: NodeId, from: TypeId, to: TypeId) -> bool {
        self.not_a_prefix(id, from, to).is_none()
    }

    /// The same question, answered with *which* of the two facts said no.
    ///
    /// See [`NotAPrefix`] for why one sentence for both was worth splitting.
    /// Ask the existing prefix rule once. Only a transfer that rule would
    /// refuse may become an accessor-backed view; ordinary casts stay ordinary.
    fn native_field_view(
        &mut self,
        id: NodeId,
        value: ValueId,
        have: &HirType,
        want: &HirType,
    ) -> Result<Option<OpKind>, Diagnostic> {
        let (
            HirType::Managed(ManagedType::Object(source)),
            HirType::Managed(ManagedType::Object(face)),
        ) = (have, want)
        else {
            return Ok(None);
        };
        self.carried_owners_fit(id, *source, *face)?;
        // Asked only of a conversion the layouts admit: one they refuse
        // already says why, and that sentence stays the one a reader sees.
        let Some(why) = self.not_a_prefix(id, *source, *face) else {
            self.unrelated_class_keeps_its_methods(id, *source, *face)?;
            return Ok(None);
        };
        if !self.hierarchy.access_families.carries(*source, *face) {
            let (source, face) = (
                self.type_in_a_message(*source),
                self.type_in_a_message(*face),
            );
            return Err(self.unsupported(id, &why.spell(&source, &face)));
        }
        // A view fixes where fields are read, not which methods run.
        self.unrelated_class_keeps_its_methods(id, *source, *face)?;
        Ok(Some(OpKind::FieldView {
            value,
            source: *source,
            face: *face,
        }))
    }

    /// A value of a view-carrying face may hold an owner laid out otherwise,
    /// so the face's own layout does not decide where a second type finds that
    /// owner's fields. Each carried owner must be a prefix of the target, or be
    /// carried by the target's own accessors; otherwise this conversion is the
    /// one main refused at the view, and it refuses with the same sentence.
    ///
    /// `const f: Face = new S1(); g(f)` with `g(p: Plain)` and `Plain` laid out
    /// as `Face` was a no-op cast here, and `g` read `S1`'s `a` where `Plain`
    /// keeps `b` (`tests/programs/a-structural-alias-read-after-an-interface-view`).
    fn carried_owners_fit(
        &mut self,
        id: NodeId,
        source: TypeId,
        to: TypeId,
    ) -> Result<(), Diagnostic> {
        if source == to || !self.hierarchy.access_families.changes_transport(source) {
            return Ok(());
        }
        for owner in self.hierarchy.access_families.carried_by(source) {
            if owner == to || self.hierarchy.access_families.carries(owner, to) {
                continue;
            }
            if let Some(why) = self.not_a_prefix(id, owner, to) {
                let (owner, to) = (self.type_in_a_message(owner), self.type_in_a_message(to));
                return Err(self.unsupported(id, &why.spell(&owner, &to)));
            }
        }
        Ok(())
    }

    /// **An object keeps its own methods whatever type it is held at.**
    ///
    /// TypeScript lets an object of one class stand where an unrelated class
    /// of the same shape is wanted -- classes are structural -- and the
    /// layouts agree, so the conversion is a plain cast. But a call through
    /// the target class names the target's methods: `as2(new S1()).f()` ran
    /// `S2#f` on an `S1`, 28 of 29 cases wrong on every backend
    /// (`tests/outcomes/a-method-called-through-a-same-shape-unrelated-class`).
    ///
    /// Related means one extends the other, along the `extends` chain only:
    /// `class A implements B` with `B` a class gives `A` `B`'s shape and not
    /// its bodies. Two instantiations of one generic class are one class. A
    /// target with no methods of its own or inherited has nothing to misname,
    /// and its fields are the layout question `not_a_prefix` answers.
    fn unrelated_class_keeps_its_methods(
        &mut self,
        id: NodeId,
        source: TypeId,
        target: TypeId,
    ) -> Result<(), Diagnostic> {
        let (source, target) = (self.class_behind(source), self.class_behind(target));
        let (Some(from), Some(to)) = (
            class_symbol(self.snapshot, source),
            class_symbol(self.snapshot, target),
        ) else {
            return Ok(());
        };
        if from == to || self.extends(source, target) || self.extends(target, source) {
            return Ok(());
        }
        let methods = self.hierarchy.ancestors(target).any(|here| {
            self.hierarchy
                .declares
                .get(&here)
                .is_some_and(|declared| !declared.is_empty())
        });
        if !methods {
            return Ok(());
        }
        let (source, target) = (
            self.type_in_a_message(source),
            self.type_in_a_message(target),
        );
        Err(self.unsupported(
            id,
            &format!(
                "{source} where the unrelated class {target} is wanted -- a call through \
                 {target} names its methods, and this object's are its own class's"
            ),
        ))
    }

    /// Whether `ty` is `ancestor` or extends it, along `extends` alone.
    pub(super) fn extends(&self, ty: TypeId, ancestor: TypeId) -> bool {
        self.hierarchy.descends(ty, ancestor)
    }

    pub(super) fn not_a_prefix(
        &mut self,
        id: NodeId,
        from: TypeId,
        to: TypeId,
    ) -> Option<NotAPrefix> {
        // **A closure or a signature is not a field-layout question, and asking
        // is not free.** `apply(double, n)` passes a function value to a
        // signature-typed parameter: two object types, no fields on either, and
        // nothing to read at any offset.
        //
        // Answered before `layout_of` is called rather than after, because
        // `layout_of` is not a query -- it **creates** a layout for a type that
        // has none and pushes it into the function's list. For a signature that
        // is a fieldless `Fn__174`, and materialising one changed the emitted
        // program: assignments that had been writing a closure into a slot of
        // its own type started writing it into a distinct struct, and clang
        // said `incompatible pointer types assigning to 'NtsObj_Fn__174 *' from
        // 'NtsObj_Closure356 *'` in six modules. The gate's `addons` step caught
        // it; nothing earlier did, because every example and every test still
        // passed.
        //
        // A checking predicate with a side effect on the program it is checking
        // is the kind of thing that is obvious once it has cost twenty minutes.
        if crate::hir::is_closure_type(from)
            || crate::hir::is_closure_type(to)
            || self.is_a_signature(from)
            || self.is_a_signature(to)
        {
            return None;
        }
        // A generator frame is laid out as a prefix of its abstract generator
        // **by construction**, and cannot be checked by comparing layouts here:
        // the frame's does not exist yet. `hir::suspend` builds it long after
        // this runs, from the same `generator_prefix` that lays out the abstract
        // class, followed by the parameters and spills.
        //
        // So this is not an exception to the rule below, it is the same rule
        // answered from the one place that knows the answer early.
        if self.generator_declared(from) == Some(to) {
            return None;
        }
        // The **target** first, and its failure is an allow rather than an
        // error: nothing can be read through a type with no layout, so there is
        // nothing to be at the wrong offset.
        let Ok(to) = self.layout_of(id, to) else {
            return None;
        };
        // And a target with no fields, for the same reason stated the other way.
        if to.fields.is_empty() {
            return None;
        }
        // Only now is the source's layout needed, and here a failure is a
        // refusal: the target has fields, so something will be read, and a
        // source whose shape cannot be established cannot be shown to hold them
        // where the target expects.
        let Ok(from) = self.layout_of(id, from) else {
            return Some(NotAPrefix::Unknown);
        };
        // **Widening first, so that "they disagree about the order" is a claim a
        // reader can act on.** Where the target is wider *and* the overlap
        // disagrees, both are true and only one of them binds: no ordering makes
        // storage appear. Reporting that one leaves the other sentence meaning
        // exactly "same fields, wrong order", which is the cheap half.
        if to.fields.len() > from.fields.len() {
            return Some(NotAPrefix::Widens {
                wanted: to.fields.len(),
                held: from.fields.len(),
                first: to.fields[from.fields.len()].name.to_string(),
            });
        }
        // **A target field the source does not hold at all**, which the counts
        // above do not catch: two option bags of six fields each, four of them
        // shared, is not a widening and is not an ordering problem either.
        if let Some(absent) = to
            .fields
            .iter()
            .find(|want| !from.fields.iter().any(|have| self.one_slot(want, have)))
        {
            return Some(NotAPrefix::Missing {
                name: absent.name.to_string(),
            });
        }
        if let Some(disagrees) = to
            .fields
            .iter()
            .zip(from.fields.iter())
            .enumerate()
            .find_map(|(at, (want, have))| {
                (!self.one_slot(want, have)).then(|| NotAPrefix::Disagrees {
                    at,
                    wanted: want.name.to_string(),
                    held: have.name.to_string(),
                })
            })
        {
            return Some(disagrees);
        }
        // **And the kinds the fields were written as**, in both directions
        // (docs/records/notebooks/scalar-numbers.md, Q1): a read through a field written
        // `Uint8` is the kind's range, which every store into that field was
        // proven to fit -- and a store through the other type was not.
        to.fields
            .iter()
            .zip(from.fields.iter())
            .find_map(|(want, have)| {
                (want.written != have.written).then(|| NotAPrefix::Kind {
                    name: want.name.to_string(),
                    wanted: want.written,
                    held: have.written,
                })
            })
    }

    /// [`same_slot`], with two object-typed fields counted the same when the
    /// layouts the types name are **one shape**.
    ///
    /// # Why the type ids are not enough here
    ///
    /// The checker gives one written type several ids. `[number, () => number]`
    /// written once produces a tuple for the annotation and another for the
    /// literal, and each holds `_1` as `Managed(Object(_))` naming a *different*
    /// id for the same signature -- so the two tuples describe one shape and
    /// `same_slot` says no, because `Object(1) != Object(7)`.
    ///
    /// The cost is not a missed merge. A store of either tuple into the other is
    /// then a pointer cast between structs that disagree, and `[state, setState]`
    /// -- the shape `useState`, `useReducer`, `useTransition` and
    /// `useActionState` return -- refused with "holds `_1` and has no field of
    /// that name and type". It also stopped *instantiation*: the React lane
    /// measured `useState<f64>` and `updateState<bool>` appearing the moment the
    /// tuple was replaced by a record.
    ///
    /// **By the layouts' names, and they are structural.** A signature's layout
    /// is named after its shape (`is_signature_name`, and `may_merge`'s own
    /// comment says so: "The names are structural, so this still merges two ids
    /// for one written signature and separates two signatures"), so one name is
    /// one shape and two signatures keep two names. That is the same equivalence
    /// `collect_layouts` applies after lowering; this is it asked early enough
    /// for a coercion to use.
    ///
    /// **Looked up, never created.** `layout_of` *creates* a layout when it does
    /// not find one, and record 0199 is what creating one mid-lowering costs --
    /// it changes the order `collect_layouts` merges in. A field whose layout
    /// does not exist yet falls back to the type-id comparison, which refuses as
    /// before: conservative in the direction that cannot produce a wrong cast.
    pub(super) fn one_slot(&self, want: &Field, have: &Field) -> bool {
        if same_slot(want, have) {
            return true;
        }
        // A generic use and its concrete copy name the same private member
        // only when this body's source substitution makes every argument the
        // same type. Layout rows may keep them physically separate; neither a
        // different class nor a permuted generic use gains a positional proof.
        let template_member = want.name == have.name
            && matches!(want.name, PropertyKey::Private(_))
            && want
                .declared_by
                .zip(have.declared_by)
                .is_some_and(|(one, other)| {
                    class_symbol(self.snapshot, one)
                        .is_some_and(|symbol| class_symbol(self.snapshot, other) == Some(symbol))
                        && (is_a_generic_declaration(self.snapshot, one)
                            || is_a_generic_declaration(self.snapshot, other))
                        && self
                            .snapshot
                            .type_arguments
                            .get(&one)
                            .zip(self.snapshot.type_arguments.get(&other))
                            .is_some_and(|(one, other)| {
                                one.len() == other.len()
                                    && one.iter().zip(other).all(|(one, other)| {
                                        self.sources.get(one).unwrap_or(one)
                                            == self.sources.get(other).unwrap_or(other)
                                    })
                            })
                });
        if !want.names_the_same_member(have) && !template_member {
            return false;
        }
        if want.ty == have.ty {
            return true;
        }
        let named = |ty: &HirType| match ty {
            HirType::Managed(ManagedType::Object(id)) => self
                .layouts
                .iter()
                .find(|layout| layout.types.contains(id))
                .map(|layout| layout.name.as_str()),
            _ => None,
        };
        match (named(&want.ty), named(&have.ty)) {
            (Some(one), Some(other)) => one == other,
            _ => false,
        }
    }

    /// `x!`, `x as T` and `x satisfies T`.
    pub(super) fn lower_assertion(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let Some(inner) = self.children(id).first().copied() else {
            return Err(self.unsupported(id, "an assertion with no operand"));
        };
        let value = if self.type_of(inner) == Some(HirType::Void) {
            self.lower_expecting(inner, &HirType::Erased)?
        } else {
            self.lower_expression(inner)?
        };
        // `n as Uint16` keeps TypeScript's meaning -- no run-time effect --
        // and nts verifies it (D4): it must be proven.
        if self.kind_of(id) == Some(syntax::AS_EXPRESSION)
            && let Some(kind) = self
                .snapshot
                .node_types
                .get(&id)
                .and_then(|ty| crate::hir::native::scalar(self.snapshot, *ty))
        {
            self.oblige(value, kind, crate::hir::obligations::Into::Assertion, id);
        }
        assertions::lower(self, id, value)
    }

    /// A value as an erased one, which for an already-erased value is itself.
    ///
    /// **`Erase` of an `Erased` is the identity**, and saying so once is the
    /// point. Five sites wrote the `match` out and the sixth -- `throw` --
    /// did not, so `catch (e) { throw e; }` emitted an `Erase` over a value
    /// that already carried its tag. The C backend refuses that: `erased_tag`
    /// has no tag for "already erased", so it read as the unimplemented
    /// reference case and answered
    ///
    /// ```text
    /// NTS2008 a value of type Erased cannot be erased yet
    /// ```
    ///
    /// -- a true sentence about a conversion this was not asking for. A plain
    /// rethrow out of a function was refused by every backend, which is
    /// ordinary error handling.
    ///
    /// **`absent` is the caller's to answer, every time**: what a null pointer
    /// of `value` means, from [`Self::absence_at_excluding`] at the node it came
    /// from ([`Self::erased_from`]) or [`Self::absence_of_type`] at the type an
    /// array holds it as. This answered `Impossible` for everything it erased,
    /// and so did the table's own copy of it: a `Map<string | undefined, _>`
    /// key that was `undefined` crossed as a string with a null pointer and
    /// hashing it faulted, and a stored `null` read back through `unknown` was
    /// an "object". A value that cannot be absent -- a constant, a promise --
    /// says `Impossible`, which is its answer. A counted foreign object is
    /// erased as its family's tag, and the value owns the reference the box
    /// used to: one representation of a handle in any value, so
    /// `map.get(k) === widget`.
    pub(super) fn erased(&mut self, value: ValueId, absent: Absent, origin: &Origin) -> ValueId {
        if self.values[value.0 as usize].ty == HirType::Erased {
            return value;
        }
        self.push(
            OpKind::Erase {
                value,
                absent,
                slots: Absent::Impossible,
            },
            HirType::Erased,
            origin.clone(),
        )
    }

    /// [`Self::erased`] for a value lowered from `source`, whose node says
    /// which absence a null pointer of it is.
    pub(super) fn erased_from(
        &mut self,
        value: ValueId,
        source: NodeId,
        origin: &Origin,
    ) -> ValueId {
        let have = self.values[value.0 as usize].ty.clone();
        let absent = self.absence_at_excluding(source, &have, false);
        self.erased(value, absent, origin)
    }

    pub(super) fn coerce_to_slot(
        &mut self,
        id: NodeId,
        place: &Place,
        value: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        // A function into a function-pointer slot becomes a bridge, exactly as
        // it does at a call: `p.run = twice` and `apply_twice(twice, n)` want
        // the same thing, a real C function with the declared signature. The
        // closure's own value is a heap address and handing C that to call is
        // the miscompile bridges exist to prevent -- it was refused here as
        // "an opaque C pointer converted to a different type", which is true
        // and unhelpful.
        if let Place::Checked { place, .. } = place {
            return self.coerce_to_slot(id, place, value);
        }
        let value = match *place {
            Place::NativeElement { pointer, .. } => match self.native_element_type(id, pointer)? {
                HirType::NativePointer(crate::hir::native::Pointee::FnPointer(signature)) => {
                    self.bridged(id, value, &signature)?
                }
                _ => value,
            },
            // Every other place: nothing here is a function-pointer slot. A
            // bit-field is worth saying out loud, because it is the one that
            // looks like it might be -- it holds an integer and nothing else,
            // and a function pointer has an address and a width no bit-field
            // can have, so there is never a closure here to bridge.
            _ => value,
        };
        // An array or view element **narrows** rather than coercing -- a
        // `double` into a `uint8_t` slot is the language's modulo and not a C
        // assignment -- so it is answered here rather than through `want`.
        // [`Self::slot_type`] still names its type, for the caller that wants
        // to build a value at it before the value exists.
        if let Place::Element { array, .. } = *place {
            return self.coerce_element(id, array, value);
        }
        let Some(want) = self.slot_type(id, place)? else {
            return Ok(value);
        };
        // **A setter's parameter says what it wants, and where that came
        // from.** `coerce` refuses a `void` result where a value is wanted,
        // and for a setter the wanted type is often one nobody wrote: an
        // untyped `set #field(value)` takes its getter's type, so `this.#field
        // = doNotCall()` in unchecked JavaScript wants a `boolean` that
        // appears nowhere in the source. It reached the verifier as
        // `CallArgumentType { callee: "C#set #field", expected: Bool, found:
        // Void }`, and test262's logical assignments to a private accessor
        // (`||=`, `&&=`) are that.
        if let Place::Setter { at, ref getter, .. } = *place
            && self.values[value.0 as usize].ty == HirType::Void
            && !matches!(want, HirType::Void | HirType::Erased)
        {
            let why = self.void_where_a_setter_wants(at, getter.is_some());
            return Err(self.unsupported(id, &why));
        }
        // Unchanged where there is nothing to do, which is every store in a
        // program with no erased values in it -- `coerce` answers `Ok(value)`
        // for that and an `Err` only where it genuinely cannot get there.
        self.coerce(value, &want, id)
    }

    /// Whether two array element types are the same storage under two names.
    ///
    /// Element types are compared by `HirType`, and **two structurally identical
    /// object types have different ids**: `Point` and the anonymous
    /// `{ x: number; y: number }` of a literal are one layout and two `TypeId`s.
    /// So `Array(Object(88))` where `Array(Object(87))` is wanted is a pointer
    /// to exactly the right bytes, and refusing it took three cases of
    /// `tests/programs/destructuring` and one of `tests/programs/objects` — caught by
    /// `tooling/gate/example-refusals` on the first run after the check went in,
    /// which is the third thing that ledger has caught and the third that was
    /// mine.
    ///
    /// A **prefix each way is equality**, which is why this is two calls to
    /// [`Self::laid_out_as_a_prefix`] rather than a second comparison written
    /// out. An array needs exact agreement and not a prefix: element `i` is at
    /// `i * size`, so a shorter layout at the same offsets is still the wrong
    /// stride.
    ///
    /// Only where both are objects. A `double` element against an erased one is
    /// eight bytes against sixteen and has no layout to compare — and
    /// `laid_out_as_a_prefix` answers `true` for a target it cannot lay out,
    /// which is right for its own question and exactly wrong for this one.
    /// Why an array of `from` is not an array of `to`: the records' own
    /// reason where both hold records -- two that differ only in the kinds
    /// their fields were written as have the same widths -- and the widths
    /// where they do not.
    fn not_the_same_element(&mut self, id: NodeId, from: &HirType, to: &HirType) -> String {
        if let (
            HirType::Managed(ManagedType::Object(held)),
            HirType::Managed(ManagedType::Object(wanted)),
        ) = (from, to)
            && let Some(why) = self.not_a_prefix(id, *held, *wanted)
        {
            let (held, wanted) = (
                self.type_in_a_message(*held),
                self.type_in_a_message(*wanted),
            );
            return format!("as an array's elements, {}", why.spell(&held, &wanted));
        }
        format!(
            "an array of {from:?} where an array of {to:?} is wanted -- the two hold different widths, so a \
             pointer to one is not a pointer to the other"
        )
    }

    fn the_same_element(&mut self, id: NodeId, from: &HirType, to: &HirType) -> bool {
        let (
            HirType::Managed(ManagedType::Object(from)),
            HirType::Managed(ManagedType::Object(to)),
        ) = (from, to)
        else {
            return false;
        };
        self.laid_out_as_a_prefix(id, *from, *to) && self.laid_out_as_a_prefix(id, *to, *from)
    }

    /// `v === undefined` where `v` is erased, as the tag test it is.
    ///
    /// A `number | undefined` is one erased value, and its absence is the
    /// `undefined` tag rather than a null -- a double has no spare bit pattern
    /// to be absent in, which is exactly why the union needs a tag at all. So
    /// the comparison is between a tag and a constant, and neither operand is
    /// ever built.
    ///
    /// Handled here rather than in `lower_absent`, because `undefined` on its
    /// own has no representation to produce: it is only ever *compared*, and
    /// the comparison is the thing that means something.
    /// `(receiver, does its class have `key`)`, as one `InstanceOf`.
    ///
    /// **One copy, because there are two callers and a third shape coming.**
    /// `o.m?.()` and `o.m !== undefined` ask the identical question and the
    /// answer is identical machinery; written twice they would be two chances
    /// to disagree about which classes count.
    ///
    /// The class set is collected over the whole program rather than from the
    /// receiver's hierarchy, for the reason the `in` path collects it there: an
    /// object literal typed by an interface has a layout and no entry in the
    /// hierarchy. `Declares::Always` and not `Optionally` -- the question is
    /// which classes carry the slot, and a class that declares it optionally
    /// *and never defines it* does not.
    ///
    /// `Ok(None)` when nothing in the program declares it, which leaves the
    /// caller on whatever path it had.
    pub(super) fn has_the_slot(
        &mut self,
        id: NodeId,
        object: NodeId,
        key: &PropertyKey,
    ) -> Result<Option<(ValueId, ValueId)>, Diagnostic> {
        if let Some(contract) = self
            .snapshot
            .node_types
            .get(&object)
            .and_then(|face| self.projected_callable(*face, key))
        {
            let member = self
                .children(id)
                .iter()
                .copied()
                .find_map(|child| {
                    self.member_access_key(child)
                        .and_then(|(receiver, member)| {
                            (receiver == object && member == *key).then_some(child)
                        })
                })
                .and_then(|access| self.children(access).last().copied())
                .unwrap_or(object);
            let receiver = self.lower_expression(object)?;
            let present = self.start_callable(
                id,
                receiver,
                object,
                member,
                contract,
                callable_fields::Action::Present,
            )?;
            return Ok(Some((receiver, present)));
        }
        let mut declaring: Vec<TypeId> = (0..self.snapshot.types.len())
            .filter_map(|at| u32::try_from(at).ok().map(TypeId))
            .filter(|class| matches!(self.declares(*class, key), Declares::Always))
            .collect();
        declaring.sort_unstable_by_key(|ty| ty.0);
        declaring.dedup();
        if declaring.is_empty() {
            return Ok(None);
        }
        let receiver = self.lower_expression(object)?;
        let origin = self.origin(id);
        let have = self.values[receiver.0 as usize].ty.clone();
        let erased = if have == HirType::Erased {
            receiver
        } else {
            // What a null receiver means comes from its source type, as at
            // every other erase. `this.socket?.uncork?.()` reads a `Corkable |
            // undefined` field, whose null pointer is the `undefined` this test
            // must find no class in; `Impossible` said it could not be null,
            // which the Wasm backend refuses and C only survived by tagging it
            // an object no class matches.
            let absent = self.absence_at_excluding(object, &have, false);
            self.push(
                OpKind::Erase {
                    value: receiver,
                    absent,
                    slots: crate::hir::Absent::Impossible,
                },
                HirType::Erased,
                origin.clone(),
            )
        };
        let present = self.push(
            OpKind::InstanceOf {
                value: erased,
                classes: declaring,
                by_layout: false,
            },
            HirType::Bool,
            origin,
        );
        Ok(Some((receiver, present)))
    }
}

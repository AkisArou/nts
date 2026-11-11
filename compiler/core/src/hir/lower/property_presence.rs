//! Lower property existence and presence-bit tests for records, unions, and native class arms.

use super::{
    Absent, BinOp, Diagnostic, FuncBuilder, HirType, LiteralValue, ManagedType, MemberKind,
    NodeData, NodeId, OpKind, Origin, PropertyKey, PropertyRecord, SemanticSnapshot, Terminator,
    TypeId, TypeKind, UnOp, ValueId, access, class_symbol, compound_operator, logical_assignment,
    property_keys, syntax,
};

/// The property names a write may add to an object after it was made.
///
/// An object's own keys are in insertion order, so a property a program adds
/// later -- `o.note = "n"` on an object made without `note` -- comes after
/// every key already there, wherever the type or the layout puts it. That is
/// a fact about the program, not the type: a whole-program scan, by name, as
/// [`presence_keys`] is and for its reason. Over-approximate in the safe
/// direction: a name written to any object counts for every type holding it.
///
/// - `assigned`: a property assigned (`=`, compound, logical), `++`/`--`, a
///   `for (o.k of ...)` head, a destructuring target, or a source key of
///   `Object.assign`; a computed key names every property of the receiver's
///   type.
/// - `deleted`: a property `delete` removes, which a later write then adds
///   last even where construction defined it.
/// - `unknown`: a write whose names nothing here can list --
///   `Object.defineProperty`, `Reflect.set`, `Object.assign` from a value with
///   no object type.
#[derive(Debug, Clone, Default)]
pub(super) struct AddedKeys {
    pub(super) assigned: rustc_hash::FxHashSet<String>,
    pub(super) deleted: rustc_hash::FxHashSet<String>,
    pub(super) unknown: bool,
}

impl AddedKeys {
    /// The names `target`, written, may add: a property's, an element's, or
    /// any in a destructuring pattern.
    fn written_by(&mut self, probe: &FuncBuilder, target: NodeId) {
        let target = probe.through_parentheses(target);
        match probe.kind_of(target) {
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => {
                if let Some((_, name)) = probe.member_access(target) {
                    self.assigned.insert(name);
                }
            }
            Some(syntax::ELEMENT_ACCESS_EXPRESSION) => {
                let parts = probe.children(target);
                let [object, key] = parts.as_slice() else {
                    return;
                };
                if let Some(name) = probe.literal_key(*key) {
                    self.assigned.insert(name);
                    return;
                }
                // A computed key may be any of the receiver's own: every name
                // its type declares. An array's index is none of them.
                let properties = probe
                    .snapshot
                    .node_types
                    .get(object)
                    .and_then(|ty| probe.snapshot.types.get(ty.0 as usize))
                    .and_then(|record| match &record.kind {
                        TypeKind::Object { properties } => Some(properties),
                        #[expect(
                            clippy::match_same_arms,
                            reason = "keep audited semantic type variants explicit"
                        )]
                        TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
                        _ => None,
                    });
                for property in properties.into_iter().flatten() {
                    if let Some(name) = property.name.public_name() {
                        self.assigned.insert(name.to_owned());
                    }
                }
            }
            // A destructuring pattern, and its parts: `{ k: o.k }`, `{ ...o.rest }`,
            // `[o.k = 1]`.
            Some(
                syntax::OBJECT_LITERAL_EXPRESSION
                | syntax::ARRAY_LITERAL_EXPRESSION
                | syntax::PROPERTY_ASSIGNMENT
                | syntax::SHORTHAND_PROPERTY_ASSIGNMENT
                | syntax::SPREAD_ASSIGNMENT
                | syntax::SPREAD_ELEMENT
                | syntax::BINARY_EXPRESSION,
            ) => {
                for part in probe.children(target) {
                    self.written_by(probe, part);
                }
            }
            _ => {}
        }
    }
}

#[expect(
    clippy::too_many_lines,
    reason = "keep semantic text and key projection beside its existing dispatch"
)]
pub(super) fn added_keys(snapshot: &SemanticSnapshot, probe: &FuncBuilder) -> AddedKeys {
    let mut added = AddedKeys::default();
    for index in 0..snapshot.nodes.len() {
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let kind = probe.kind_of(id);
        if !matches!(
            kind,
            Some(
                syntax::BINARY_EXPRESSION
                    | syntax::POSTFIX_UNARY_EXPRESSION
                    | syntax::PREFIX_UNARY_EXPRESSION
                    | syntax::DELETE_EXPRESSION
                    | syntax::FOR_IN_STATEMENT
                    | syntax::FOR_OF_STATEMENT
                    | syntax::CALL_EXPRESSION
            )
        ) {
            continue;
        }
        let children = probe.children(id);
        match kind {
            Some(syntax::BINARY_EXPRESSION) => {
                let [target, operator, _] = children.as_slice() else {
                    continue;
                };
                let token = probe.kind_of(*operator).unwrap_or(0);
                if token == syntax::EQUALS_TOKEN
                    || compound_operator(token).is_some()
                    || logical_assignment(token).is_some()
                {
                    added.written_by(probe, *target);
                }
            }
            // `o.k++`, and a `for (o.k of ...)` head: the first child is written.
            Some(
                syntax::POSTFIX_UNARY_EXPRESSION
                | syntax::FOR_IN_STATEMENT
                | syntax::FOR_OF_STATEMENT,
            ) => {
                if let Some(target) = children.first() {
                    added.written_by(probe, *target);
                }
            }
            Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                let counts = matches!(probe.node(id).data, NodeData::Children { small, .. }
                    if matches!(small & syntax::prefix_operator::MASK, syntax::prefix_operator::PLUS_PLUS | syntax::prefix_operator::MINUS_MINUS));
                if counts && let Some(operand) = children.first() {
                    added.written_by(probe, *operand);
                }
            }
            Some(syntax::DELETE_EXPRESSION) => {
                let mut deleted = AddedKeys::default();
                if let Some(operand) = children.first() {
                    deleted.written_by(probe, *operand);
                }
                added.deleted.extend(deleted.assigned);
            }
            Some(syntax::CALL_EXPRESSION) => {
                let [callee, arguments @ ..] = children.as_slice() else {
                    continue;
                };
                let Some((object, member)) = probe.member_access(*callee) else {
                    continue;
                };
                match (
                    probe
                        .node(object)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8()),
                    member.as_str(),
                ) {
                    (Some("Object"), "assign") => {
                        for source in arguments.iter().skip(1) {
                            let properties = probe
                                .snapshot
                                .node_types
                                .get(source)
                                .and_then(|ty| probe.snapshot.types.get(ty.0 as usize))
                                .and_then(|record| match &record.kind {
                                    TypeKind::Object { properties } => Some(properties),
                                    #[expect(
                                        clippy::match_same_arms,
                                        reason = "keep audited semantic type variants explicit"
                                    )]
                                    TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
                                    _ => None,
                                });
                            match properties {
                                Some(properties) => added.assigned.extend(
                                    properties
                                        .iter()
                                        .filter_map(|p| p.name.public_name().map(str::to_owned)),
                                ),
                                None => added.unknown = true,
                            }
                        }
                    }
                    (Some("Object"), "defineProperty" | "defineProperties" | "setPrototypeOf")
                    | (Some("Reflect"), "set" | "defineProperty") => added.unknown = true,
                    _ => {}
                }
            }
            _ => {}
        }
    }
    added
}

/// Every property name an `in` in this program asks about.
///
/// A whole-program scan, because the question is whole-program: a presence bit
/// is written wherever the property is, and read wherever somebody tests it,
/// and the two are in different functions. See [`Naming::presence_keys`](super::Naming::presence_keys) for
/// why the key is a name rather than a (type, key) pair.
///
/// A `BinaryExpression` holds its operator as a real token node, so the `in` is
/// a child and this looks for it directly. A **computed** key contributes
/// nothing and needs to: that form is refused, so no bit it would have wanted
/// is ever read.
pub(super) fn presence_keys(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
) -> rustc_hash::FxHashSet<String> {
    let mut keys = rustc_hash::FxHashSet::default();
    for index in 0..snapshot.nodes.len() {
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        if probe.kind_of(id) != Some(syntax::BINARY_EXPRESSION) {
            continue;
        }
        let children = probe.children(id);
        let [lhs, operator, _] = children.as_slice() else {
            continue;
        };
        if probe.kind_of(*operator) != Some(syntax::IN_KEYWORD) {
            continue;
        }
        if let Some(key) = probe
            .private_name_key(*lhs)
            .or_else(|| probe.literal_key(*lhs))
        {
            keys.insert(key);
        }
    }
    // And every key `Object.hasOwn(o, "k")` names, which asks the same question
    // in the other spelling and reads the same bit.
    //
    // `Object.keys` and `for...in` are **not** here and cannot be: they name no
    // key, so tracking what they need means the receiver's whole optional set
    // rather than a name. Whoever lands those adds it; a reader added without a
    // matching producer is a bit that is read and never written, which answers
    // false for a property that is there and says nothing while doing it.
    for index in 0..snapshot.nodes.len() {
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        if probe.kind_of(id) != Some(syntax::CALL_EXPRESSION) {
            continue;
        }
        let children = probe.children(id);
        let [callee, rest @ ..] = children.as_slice() else {
            continue;
        };
        if probe.kind_of(*callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            continue;
        }
        let parts = probe.children(*callee);
        let [_, member] = parts.as_slice() else {
            continue;
        };
        if probe.literal_name(*member).as_deref() != Some("hasOwn") {
            continue;
        }
        if let Some(key) = rest.get(1).and_then(|key| probe.literal_key(*key)) {
            keys.insert(key);
        }
    }
    keys
}

/// Whether a type declares a property, and whether the answer is usable.
#[derive(PartialEq, Eq)]
pub(super) enum Declares {
    /// Declared, and always present.
    Always,
    /// Not declared, so `in` is false for a value of this type.
    Never,
    /// Declared `x?: T`. The slot exists here whether or not the program wrote
    /// it, and JavaScript can tell the difference -- `{}` and
    /// `{ a: undefined }` disagree about `"a" in o` -- so this is refused
    /// rather than answered by the slot.
    Optionally,
    /// Not an object type. `"a" in 5` is a `TypeError` in JavaScript, and a
    /// union arm that is not an object makes the whole test one.
    NotAnObject,
}

/// The type of a presence index or mask: `uint32_t`, as the runtime declares it.
///
/// Not `NUMBER`. C converts a double to a `uint32_t` at the call and the C
/// backend never had to notice, so the first version passed one and compiled
/// clean; LLVM has no implicit conversion and rejected the module outright --
/// `integer constant must have integer type`. The same sentence
/// `codegen/llvm/src/signatures.rs` opens with, about `nts_tag_name`.
///
/// Writing it here is necessary and was not sufficient: the *middle end* holds
/// its own table of what the runtime declares, and a helper missing from
/// `hir::runtime` had its argument widened to a double on the way out whatever
/// this said. Three tables have to name a new helper -- `hir::runtime` for the
/// conversion, `codegen/llvm`'s for the declaration, and the C backend's
/// `ERASES_CLASS` for the receiver cast -- and only the last two fail loudly
/// when they do not.
pub(super) const PRESENCE_INDEX: HirType = HirType::Int {
    bits: 32,
    signed: false,
};

impl FuncBuilder<'_> {
    /// The polymorphic `this` inside a **generic** class, which has no object
    /// representation to test.
    ///
    /// TypeScript models `this` as a type parameter named after its class and
    /// constrained to it. For a *non-generic* class the constraint decomposes
    /// into an object and `type_of` answers `Managed(Object(..))`, so the check
    /// beside this one passes. For a generic one the constraint is the
    /// **uninstantiated** form -- `Holder<T>` -- which frontend capture leaves
    /// as a `Structured` placeholder on the stated ground that "only
    /// instantiations are ever lowered, so the members of a form parameterised
    /// by one are members nothing can use".
    ///
    /// **That ground is true of a generic function and false here.** A method
    /// body reaches its own fields through `this`, and a placeholder has no
    /// members, so `this[kCount]` stopped naming a property and fell through to
    /// the array path -- `indexing `this`, which stands for `Holder` here,
    /// which is not an array`. `this.count` never did, because a property
    /// access does not consult the receiver's representation at all.
    ///
    /// The asymmetry is the whole defect: the same member, reached two ways,
    /// and only the computed spelling required a representation. Measured
    /// 2026-09-16: **299 sites** carry that sentence, the largest single
    /// refusal text in the corpus, and every one of them is a class member
    /// reached by a `unique symbol` key from inside its own class.
    pub(super) fn stands_for_its_own_class(&self, object: NodeId) -> bool {
        let Some(ty) = self.snapshot.node_types.get(&object) else {
            return false;
        };
        self.snapshot.polymorphic_this_constraint(*ty).is_some()
    }

    pub(super) fn names_a_property(&self, id: NodeId) -> bool {
        match self.kind_of(id) {
            // A module's member is not one: there is no receiver, so a call
            // through it is a plain call and an access is a plain name. Saying
            // so here is what lets `C.scale(n)` reach the direct-callee path,
            // which resolves it from the checker's target like any other.
            //
            // And a namespace *value* held in a name -- `ns.bump()` after `const ns
            // = await import("./m")` -- for the same reason: the checker resolves
            // the member to the export, and the call is a plain one. Only a name,
            // because the direct-callee path does not evaluate the receiver, and a
            // receiver with effects (`(await import("./m")).f()`) must run; that
            // shape stays a method call and refuses by name.
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => match self.children(id).as_slice() {
                [object, _] => !self.names_a_module_without_effects(*object),
                _ => true,
            },
            // **The index's *type*, not its text.**
            //
            // `literal_name` answers for any node carrying text, and an
            // identifier carries its own spelling -- so `source[i]` with an
            // ordinary `let i` was read as `source.i` and refused with
            // "`i`, which `UnknownArrayLike` does not declare". A sentence about
            // a variable, said of a type, at a computed index.
            //
            // What actually names a property is an index the checker has given
            // a *single* value: a string or numeric literal, or a
            // `unique symbol`, whose whole purpose is to be one member name.
            // `[kRefed]` is the shape `tests/programs/symbol-keys` is built on and it
            // has to keep resolving at compile time; `buf[i]` must not.
            //
            // What it cost: `fromArrayLike`'s loop is `source[i]`, so
            // `Buffer.from` refused, and under it `Buffer.alloc`, `Buffer#fill`,
            // `indexOf`, `lastIndexOf`, `includes`, `transcode`, and
            // `StringDecoder`'s constructor -- the whole of `string_decoder`,
            // which has no own-source refusal of its own.
            Some(syntax::ELEMENT_ACCESS_EXPRESSION) => match self.children(id).as_slice() {
                [object, index] => {
                    if matches!(
                        self.type_of(*object),
                        Some(HirType::NativePointer(crate::hir::native::Pointee::Record(
                            _
                        )))
                    ) {
                        return self.native_member_key(id, *index).is_some();
                    }
                    // **What the receiver is, not what the checker narrowed it
                    // to.** A rest parameter written as a union of tuples is
                    // represented here as an *array*, and after
                    // `given.length === 0` returns the checker narrows `given`
                    // to the remaining tuple -- an object type. So `given[0]`
                    // asked for a member named `0` and got ``\`0\`, where an
                    // array has only `length` ``: a true sentence about the
                    // value, produced by consulting the type.
                    //
                    // Where the value is already in hand, it decides. An index
                    // into something held as an array is an element, and no
                    // narrowing of the source type changes that.
                    !self.holds_an_array(*object)
                        && (matches!(
                            self.type_of(*object),
                            Some(HirType::Managed(ManagedType::Object(_)))
                        ) || self.stands_for_its_own_class(*object)
                            || self
                                .read_type(*object)
                                .is_some_and(|ty| self.hierarchy.cast_faces.contains(&ty)))
                        && self.names_one_member(*index)
                        && self.literal_name(*index).is_some()
                }
                _ => false,
            },
            _ => false,
        }
    }

    /// `Object.hasOwn(o, "k")`, which a layout answers with a constant.
    pub(super) fn decide_has_own(
        &mut self,
        id: NodeId,
        argument: NodeId,
        key: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let table = self.lower_expression(argument)?;
        // A table answers this at run time, and it is the only receiver that
        // can: a layout's names are fixed when it is laid out, and a `Record`'s
        // are whatever was put in it. So the computed key that a struct has to
        // refuse is ordinary here.
        if matches!(
            self.values[table.0 as usize].ty,
            HirType::Managed(ManagedType::Table(_, _))
        ) {
            let source = key;
            let key = self.lower_expecting(source, &HirType::Erased)?;
            let key = property_keys::capture(self, source, key)?;
            return Ok(property_keys::apply(
                self,
                id,
                table,
                key,
                property_keys::Action::Has,
            ));
        }
        let Some(wanted) = self.literal_name(key) else {
            // A computed key is a question about a *value*, and a layout cannot
            // answer it. Named rather than guessed.
            return Err(self.unsupported(key, "`Object.hasOwn` with a key the program computes"));
        };
        // An **optional** property is answered from the header, exactly as `"k"
        // in o` is. `own_names` refuses on one -- rightly, while a layout was
        // the only thing to ask -- so this asks the value first and falls
        // through to the layout for every property whose presence the type
        // settles.
        if let HirType::Managed(ManagedType::Object(ty)) = self.values[table.0 as usize].ty
            && self.declares(ty, &PropertyKey::Name(wanted.clone())) == Declares::Optionally
        {
            let origin = self.origin(id);
            let bit = match self.presence_of_key(ty, &PropertyKey::Name(wanted.clone())) {
                Some(crate::hir::presence::Presence::Bit(bit)) => bit,
                Some(crate::hir::presence::Presence::TooMany { optional }) => {
                    return Err(self.unsupported(
                        id,
                        &format!(
                            "`Object.hasOwn` naming `{wanted}` on a type with {optional} \
                             optional properties -- an object header records {}",
                            crate::hir::presence::BITS
                        ),
                    ));
                }
                _ => {
                    return Err(self.unsupported(
                        id,
                        &format!(
                            "`Object.hasOwn` naming `{wanted}` on a type with no layout in \
                             this program"
                        ),
                    ));
                }
            };
            let index = self.push(
                OpKind::ConstInt(i128::from(bit)),
                PRESENCE_INDEX,
                origin.clone(),
            );
            return Ok(self.call_runtime(
                "nts_presence_has",
                vec![table, index],
                HirType::Bool,
                &origin,
            ));
        }
        // One key, from the layout, without asking for the whole list.
        //
        // `own_names` refuses a type with *any* optional property, because
        // `Object.keys` has to name all of them and an optional one is a fact
        // about the value. Asking it here made `Object.hasOwn(b, "keep")` --
        // a **required** key -- refuse because some *other* property of the
        // type was optional, which is a question it never asked.
        //
        // `fields` rather than `declares`, and that is the distinction to keep:
        // a method is declared and is not an own property, so
        // `Object.hasOwn(o, "someMethod")` is false in JavaScript and a layout's
        // field list is what says so.
        let origin = self.origin(id);
        let present =
            if let HirType::Managed(ManagedType::Object(ty)) = self.values[table.0 as usize].ty {
                let layout = self.layout_of(id, ty)?;
                // An own **accessor** is a property and has no field, so the layout
                // alone answers `false` for `Object.hasOwn({ get a() {} }, "a")`.
                // `"a" in o` was right about the same object the whole time, because
                // it asks the type.
                //
                // Still `fields` rather than `declares` for everything else, and the
                // comment above says why: a method is declared and is not an own
                // property. `own` is what separates a literal's accessor from a
                // class's, which sits on the prototype and is not one either.
                layout
                    .fields
                    .iter()
                    .any(|field| field.name.is_name(&wanted))
                    || self.own_accessor(ty, &wanted)
            } else {
                self.own_names(id, argument)?.contains(&wanted)
            };
        Ok(self.push(OpKind::ConstBool(present), HirType::Bool, origin))
    }

    /// Whether this type declares this property `readonly`.
    ///
    /// From the snapshot rather than from the layout, because a layout is
    /// shared between every type of the same shape and this is not a question
    /// about shape. See the note at the one call site.
    ///
    /// A property the type does not have is not readonly: the caller has
    /// already resolved the field, so absence here means the name reached the
    /// layout by a route the type's own property list does not describe -- a
    /// tuple index, or a symbol-keyed member -- and none of those is written
    /// with the modifier.
    pub(super) fn property_is_readonly(&self, ty: TypeId, name: &str) -> bool {
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        let TypeKind::Object { properties } = &record.kind else {
            return false;
        };
        properties
            .iter()
            .find(|property| property.name.is_name(name.as_ref()))
            .is_some_and(|property| property.readonly)
    }

    /// `"k" in value` where the value is `object` and nothing narrower.
    ///
    /// Every class the program declares is a candidate, and the ones declaring
    /// `k` are the answer -- the same closed set `instanceof` compares against,
    /// computed from a wider starting point. A compiled program gains no
    /// classes, so the set is complete when the binary is built.
    ///
    /// The `typeof` guard in front of these sites is what makes it sound: `"k"
    /// in 5` throws in JavaScript, and a value that reached here has already
    /// been proved an object by the source. That is the *program's* proof
    /// rather than this compiler's, and it is why an unguarded `unknown` is
    /// still refused -- the type says so. A cast face instead carries a tag
    /// guard here: its asserted type supplies no such object proof.
    fn lower_in_over_every_class(
        &mut self,
        id: NodeId,
        lhs: NodeId,
        rhs: NodeId,
        key: &str,
        brand: bool,
        cast_face: Option<TypeId>,
    ) -> Result<ValueId, Diagnostic> {
        // `None` for an ordinary key, which is every key but a private name.
        let owner = self.brand_owner(lhs, brand)?;
        // Every object type the program has, not every *class*: an object
        // literal typed by an interface has a layout and no entry in the
        // hierarchy, and asking the hierarchy answered `false` for
        // `"label" in { label: "l" }` -- 20 of 29 cases against node, from a
        // fixture written to check exactly this.
        //
        // A type with no layout costs nothing: the emitter resolves each id to
        // a layout and drops the ones that have none, so an object type nothing
        // ever built contributes no comparison.
        let mut declaring: Vec<TypeId> = Vec::new();
        // Types that declare it *optionally*, which the presence bit makes
        // answerable: each contributes `is it a C` and `is C's bit set` rather
        // than making the whole question unanswerable.
        let mut optional: Vec<TypeId> = Vec::new();
        let candidates: Vec<TypeId> = (0..self.snapshot.types.len())
            .filter_map(|at| u32::try_from(at).ok().map(TypeId))
            .collect();
        for class in candidates {
            match self.declares(
                class,
                &if brand {
                    PropertyKey::Private(key.to_owned())
                } else {
                    PropertyKey::Name(key.to_owned())
                },
            ) {
                Declares::Always => declaring.push(class),
                // An optional property is refused for a *union* arm and is
                // refused here for the same reason: the slot exists whether or
                // not it was written, and `{}` and `{ k: undefined }` disagree.
                Declares::Optionally if !self.is_the_type_of_some_node(class) => {
                    // A shape no value can have, so its optionality is not a
                    // fact about this program. See
                    // [`Self::is_the_type_of_some_node`] -- this is the arm it
                    // exists for, and it is what stood under `Buffer.from`.
                }
                Declares::Optionally => {
                    // Answerable now, and it was the honest cost of the
                    // whole-program answer until it was not. The refusal here
                    // read: with the value typed `object` an instance of *any*
                    // type can reach the test, so one that declares the key
                    // optionally makes the question unanswerable -- including
                    // it answers true for a property never written and
                    // excluding it answers false for one that was.
                    //
                    // Both halves are true and the conclusion no longer
                    // follows: the object header records whether an optional
                    // property was written, so the arm is `is it a C` **and**
                    // `is C's bit set`. The class test was already being
                    // emitted for the arms that declare it always; this is the
                    // same test with a second conjunct.
                    //
                    // Collected rather than answered here, because a bit is a
                    // position in one layout and the caller has to see all the
                    // candidates before it can emit anything.
                    optional.push(class);
                }
                Declares::Never | Declares::NotAnObject => {}
            }
        }
        declaring.sort_unstable_by_key(|ty| ty.0);
        declaring.dedup();
        // **A private name is scoped to the class body that declares it.**
        //
        // `declares` matches on the name, and two classes may each write
        // `#list`. Those are *different names* by the language's own rule, so a
        // brand check must answer `false` for the other one -- and matching by
        // name alone answered `true` for both, in either direction.
        //
        // `tests/programs/a-private-name-is-a-brand` is the fixture that caught it,
        // on its first run, with 58 cases disagreeing: `Holder.brands(new
        // Decoy())` answered true where node answers false. Without the decoy
        // class the fixture would have passed and the defect would have been
        // that every brand check in the tree accepts the wrong receiver --
        // which is the failure a brand check exists to prevent.
        //
        // The owner is the class enclosing the `in`, which is the only place
        // the name is in scope. Subclasses stay: `Derived extends Holder` does
        // carry `#list`, and node agrees.
        if let Some(owner) = owner {
            declaring.retain(|ty| *ty == owner || self.descends_from(*ty, owner));
            // Refused rather than folded to `false`. For a public key an empty
            // set is the honest answer -- nothing declares it. A private name is
            // always declared by the class it is written in, so an empty set
            // here means this compiler failed to find something the language
            // guarantees, and answering `false` would make every brand check
            // throw on its own instances.
            if declaring.is_empty() {
                return Err(self.unsupported(
                    rhs,
                    &format!(
                        "an `in` on `{key}`, whose declaring class this compiler did not find"
                    ),
                ));
            }
        }
        let value = self.lower_expression(rhs)?;
        let origin = self.origin(id);
        // `in` over a value its type lets be absent does not typecheck.
        let value = self.erased(value, Absent::Impossible, &origin);
        let record_merge = if let Some(face) = cast_face {
            self.require_cast_membership_object(id, value, face, key);
            if !brand && property_keys::OBJECT_PROTOTYPE_MEMBERS.contains(&key) {
                return Ok(self.push(OpKind::ConstBool(true), HirType::Bool, origin));
            }
            Some(self.begin_cast_record_membership(id, value, face, key, brand))
        } else {
            None
        };
        if self.module.templates {
            self.call_runtime(
                "nts_template_reflection",
                vec![value],
                HirType::Void,
                &origin,
            );
        }
        // The classes first, and the natives folded onto it.
        //
        // A constant when no class declares the name, rather than an
        // `InstanceOf` against an empty list. The C backend emits `= false` for
        // one and the identity for `||` would have been correct there -- but an
        // `InstanceOf` naming nothing is an operation that asks no question,
        // and the JVM backend says so: `NTS4001 an instanceof against no class
        // at all`, which declined fourteen functions of the fixture written for
        // this change. The op was already reachable that way for any name the
        // program does not declare; folding the natives onto it would have made
        // it the *common* case, so what looked like an economy in one backend
        // was a decline in another.
        let mut answer = if declaring.is_empty() {
            self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone())
        } else {
            self.push(
                OpKind::InstanceOf {
                    value,
                    classes: declaring,
                    by_layout: false,
                },
                HirType::Bool,
                origin.clone(),
            )
        };
        for native in Self::natives_declaring(key) {
            let test = self.native_test(*native, value, &origin);
            answer = self.bool_join(test, answer, true, &origin);
        }
        answer = self.in_with_optional_memberships(id, value, key, answer, optional)?;
        if let Some((merge, result)) = record_merge {
            self.terminate(Terminator::Jump {
                target: merge,
                args: vec![answer],
            });
            self.switch_to(merge);
            Ok(result)
        } else {
            Ok(answer)
        }
    }

    /// Add the presence-bit test for each optional structural member.
    fn in_with_optional_memberships(
        &mut self,
        id: NodeId,
        value: ValueId,
        key: &str,
        mut answer: ValueId,
        optional: Vec<TypeId>,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        // And one arm per type that declares it optionally: the class test it
        // would have had, and the bit its writes recorded.
        //
        // A plain `and` rather than a branch. `nts_presence_has_value` answers
        // false for anything that is not a reference, so the arm that failed
        // the class test cannot fault in the second conjunct -- which is what
        // makes this a conjunction of two tests rather than a short circuit
        // the backend would have to build blocks for.
        for class in optional {
            let Some(bit) = self.presence_bit_named(id, class, key)? else {
                continue;
            };
            let is_a = self.push(
                OpKind::InstanceOf {
                    value,
                    classes: vec![class],
                    by_layout: false,
                },
                HirType::Bool,
                origin.clone(),
            );
            let index = self.push(
                OpKind::ConstInt(i128::from(bit)),
                PRESENCE_INDEX,
                origin.clone(),
            );
            let written = self.call_runtime(
                "nts_presence_has_value",
                vec![value, index],
                HirType::Bool,
                &origin,
            );
            let both = self.push(
                OpKind::Binary {
                    op: BinOp::BitAnd,
                    lhs: is_a,
                    rhs: written,
                },
                HirType::Bool,
                origin.clone(),
            );
            answer = self.bool_join(both, answer, true, &origin);
        }
        Ok(answer)
    }

    /// The presence bit for a named key on a type, for the whole-program `in`.
    ///
    /// **Builds the layout first, and the version that did not was silently
    /// wrong.** The comment here used to say `Ok(None)` for a type with no
    /// layout "costs nothing, because such a type contributes no comparison to
    /// the class test either" -- which is false: the class test calls
    /// `layout_of`, and `layout_of` *creates*. So the arms disagreed about
    /// which types exist, and an `Opts` whose layout had not been built when
    /// `has(given: object)` was lowered lost its arm entirely. `"port" in
    /// given` answered **false for an object that had one**, with nothing
    /// emitted to say so.
    ///
    /// The same trap `in_by_presence` hit an hour earlier, for the same reason
    /// and with the same fix. A non-creating lookup is right where the question
    /// is "does the program carry this layout" and wrong where the caller is
    /// about to emit something that needs one.
    ///
    /// `TooMany` is refused by name rather than dropped, because dropping it
    /// would answer `false` for a property that is there -- which is the defect
    /// above, arrived at deliberately.
    fn presence_bit_named(
        &mut self,
        at: NodeId,
        class: TypeId,
        key: &str,
    ) -> Result<Option<u32>, Diagnostic> {
        self.candidate_layout(at, class)?;
        match self.presence_of_key(class, &PropertyKey::Name(key.to_owned())) {
            Some(crate::hir::presence::Presence::Bit(bit)) => Ok(Some(bit)),
            Some(crate::hir::presence::Presence::TooMany { optional }) => {
                // Named, because the fix is at the declaration and "a type"
                // points at nothing. `type_in_a_message` is what answers for an
                // anonymous one -- an inline `{ k?: T }`, a `Partial<T>` -- and
                // it carries the `__object` filter this spelled out before the
                // `delete` refusal needed the same sentence.
                let who = self.type_in_a_message(class);
                Err(self.unsupported(
                    at,
                    &format!(
                        "an `in` naming `{key}` on {who}, which declares {optional} optional \
                         properties -- an object header records {}",
                        crate::hir::presence::BITS
                    ),
                ))
            }
            _ => Ok(None),
        }
    }

    /// A candidate's layout, built as the one context that can lay it out
    /// builds it.
    ///
    /// **An open type is laid out by an erased copy and by nothing else.** A
    /// typed copy materialises the instantiation it makes of every template it
    /// contains (`Substitution::instance_of`): `make<bool>` allocates
    /// `Box<boolean>`, never `Box<T>`. So a layout keyed by an open type is the
    /// one a copy binding its parameters to erased values gives it -- and asked
    /// from anywhere else, which binds none of them, it failed: `"reason" in
    /// settled` in a plain function was refused over `Box<T>`'s `value?: T`
    /// (`tests/outcomes/an-in-beside-a-generic-interface-of-the-same-shape`,
    /// which React's `trackUsedThenable<erased>` was refused with).
    ///
    /// **Built, not skipped.** Skipping it would answer from lowering order: an
    /// erased copy lowered first lays the type out and a value of it is a
    /// candidate, one lowered after is not. Built with its unbound parameters
    /// erased, it is the layout that copy finds already made, so the bit and
    /// the class test agree with any value that has the type -- and a type no
    /// value has costs a comparison that never matches.
    fn candidate_layout(&mut self, at: NodeId, class: TypeId) -> Result<(), Diagnostic> {
        let Err(refused) = self.layout_of(at, class) else {
            return Ok(());
        };
        let unbound: Vec<TypeId> = (0..self.snapshot.types.len())
            .filter_map(|at| u32::try_from(at).ok().map(TypeId))
            .filter(|ty| {
                matches!(
                    self.snapshot.types[ty.0 as usize].kind,
                    TypeKind::TypeParameter { .. }
                ) && !self.substitution.contains_key(ty)
            })
            .collect();
        if unbound.is_empty() {
            return Err(refused);
        }
        let bound = self.substitution.clone();
        for parameter in unbound {
            self.substitution.insert(parameter, HirType::Erased);
        }
        let erased = self.layout_of(at, class);
        self.substitution = bound;
        erased.map(|_| ()).map_err(|_| refused)
    }

    /// `"k" in o` where some arm of `o`'s type declares `k` optionally: the
    /// answer is the bit the writes recorded.
    ///
    /// A bit is a position in **one** layout, so every type the value can be has
    /// to number `k` the same way for a single test to be right. Base-first
    /// layout says a subclass and its base will -- and that is *checked* here
    /// rather than relied on, because it is a property of a pass that runs after
    /// this one and a wrong shared bit is a wrong answer rather than a failure.
    ///
    /// **The disagreement check is unreachable today and is written down as
    /// such rather than left looking load-bearing.** Two arms can only number a
    /// shared property differently by laying their fields out differently, and
    /// such a union is already refused one step earlier -- `a `Wide` where a
    /// `Narrow` is wanted, which is a pointer cast between two structs that do
    /// not agree about where their shared fields are`. Tried, and that is the
    /// refusal that came back. The two rest on different facts, field offsets
    /// against bit positions, and the cast refusal is the largest single item in
    /// the corpus census -- so the day it lifts is the day this stops being
    /// redundant, and it should not have to be rediscovered then.
    ///
    /// Every arm must also declare it optionally. An arm that declares it
    /// always and one that declares it optionally disagree about a value the
    /// test cannot see, and that is the class question the mixed path answers.
    fn in_by_presence(
        &mut self,
        id: NodeId,
        rhs: NodeId,
        members: &[TypeId],
        optional: &[TypeId],
        key: &str,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        if optional.len() != members.len() {
            return Err(self.unsupported(
                id,
                &format!(
                    "an `in` naming `{key}`, which {} of this union's {} arms declare optionally \
                     and the rest declare always -- which arm it is decides the answer",
                    optional.len(),
                    members.len()
                ),
            ));
        }
        let mut agreed: Option<u32> = None;
        for ty in optional {
            // Built rather than looked up, the same call the mixed path below
            // makes and for the same reason: a layout is what the bit is a
            // position *in*, and a function may be lowered before anything that
            // constructs the type it takes. `askAsBase(b: Base)` is that
            // function, and the lookup answered "no layout in this program" for
            // a class the program allocates two lines later.
            self.layout_of(id, *ty)?;
            let bit = match self.presence_of_key(*ty, &PropertyKey::Name(key.to_owned())) {
                Some(crate::hir::presence::Presence::Bit(bit)) => bit,
                Some(crate::hir::presence::Presence::TooMany { optional }) => {
                    return Err(self.unsupported(
                        id,
                        &format!(
                            "an `in` naming `{key}`, on a type with {optional} optional \
                             properties -- an object header records {}",
                            crate::hir::presence::BITS
                        ),
                    ));
                }
                // No layout here, or the property is not optional after
                // `declares` said it was. Neither is reachable from this arm and
                // both are answered rather than assumed away.
                _ => {
                    return Err(self.unsupported(
                        id,
                        &format!("an `in` naming `{key}` on a type with no layout in this program"),
                    ));
                }
            };
            if *agreed.get_or_insert(bit) != bit {
                return Err(self.unsupported(
                    id,
                    &format!(
                        "an `in` naming `{key}`, which this union's arms record in different \
                         bits -- one test cannot ask both"
                    ),
                ));
            }
        }
        let Some(bit) = agreed else {
            return Err(self.unsupported(id, &format!("an `in` naming `{key}` on no type at all")));
        };
        let object = self.lower_expression(rhs)?;
        let index = self.push(
            OpKind::ConstInt(i128::from(bit)),
            PRESENCE_INDEX,
            origin.clone(),
        );
        Ok(self.call_runtime(
            "nts_presence_has",
            vec![object, index],
            HirType::Bool,
            &origin,
        ))
    }

    pub(super) fn lower_in(
        &mut self,
        id: NodeId,
        lhs: NodeId,
        rhs: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        if self.private_name_key(lhs).is_none()
            && self.literal_key(lhs).is_none()
            && self
                .type_of(rhs)
                .is_some_and(|ty| property_keys::string_record_type(&ty))
        {
            // Evaluate both operands before applying ToPropertyKey to the left.
            let raw = self.lower_expecting(lhs, &HirType::Erased)?;
            let (table, guard) = access::receiver(self, rhs)?;
            if let Some(guard) = guard {
                access::require_record_membership(self, id, &guard);
            }
            let key = property_keys::capture(self, lhs, raw)?;
            return Ok(property_keys::apply(
                self,
                id,
                table,
                key,
                property_keys::Action::In,
            ));
        }
        if self.type_of(rhs) == Some(HirType::Managed(ManagedType::Template)) {
            return Err(
                self.unsupported(id, "property membership on a cooked-only template object")
            );
        }
        if matches!(self.type_of(rhs), Some(HirType::NativePointer(_))) {
            return Err(self.unsupported(id, "an `in` test through an opaque C pointer"));
        }
        // **Which spelling the key was written in**, which decides whether a
        // `#private` member can answer it. `#m in o` is the ergonomic brand
        // check; `"#m" in o` asks for a string-keyed property of that name, and
        // a `#private` member is not one. See [`Self::declares`].
        let brand = self.private_name_key(lhs).is_some();
        let Some(key) = self.private_name_key(lhs).or_else(|| self.literal_key(lhs)) else {
            return Err(self.unsupported(
                lhs,
                "an `in` whose key is not a literal the compiler can see",
            ));
        };
        let Some(ty) = self.snapshot.node_types.get(&rhs).copied() else {
            return Err(self.unsupported(rhs, "an `in` on a value with no type"));
        };
        // **Every object inherits `Object.prototype`, and `in` is defined over the
        // whole chain.** `"valueOf" in {}` is `true` in every engine and was
        // `false` here: every path below asks which members the *type* declares,
        // and an inherited one is declared by none of them. Measured by running
        // test262 `language/expressions/in/S8.12.6_A2_T1.js`, one of four files
        // in the 2,527-file slice-1 population that compiled, ran, and answered
        // wrongly.
        //
        // # The precondition, stated so it can be found again
        //
        // This is sound only because **no object in a program this compiler
        // accepts can have a null prototype**. `Object.create` and
        // `Object.setPrototypeOf` are both refused today -- checked, not assumed
        // -- so there is no way to write one. Whoever implements either must
        // come back here: `Object.create(null)` makes every answer below wrong,
        // silently, and nothing else in the compiler will notice.
        //
        // Strings are excluded deliberately, for the reason the `in`-on-a-native
        // path already records: `"length" in "abc"` **throws** a TypeError in
        // JavaScript rather than answering, so a string receiver must not take a
        // shortcut that answers.
        //
        // A *lying cast* defeats that, and is worth writing down rather than
        // discovering: `s as unknown as Record<string, number>` gives a string
        // the static type of a table, and this answers `true` where node throws.
        // The compiler cannot see through a double cast through `unknown` -- the
        // programmer has asserted something false and this trusts declared types
        // throughout. It is not a regression in reach: on the compiler before
        // this the same program emitted C that did not compile. It is a change
        // in *kind*, from a broken build to a wrong answer, and that direction
        // is the one to be uneasy about.
        //
        // The list is `Object.prototype`'s own property names -- the seven the
        // specification requires plus `__proto__` and the four Annex B
        // accessors, because node has them and node is the oracle. It does not
        // make the member *callable*: `Object.prototype.hasOwnProperty` is still
        // refused as a global member with no definition. `in` is the half the
        // specification is unambiguous about, and the two are separate work.
        // `object` is included by name. It is TypeScript's non-primitive type --
        // `is_the_object_type` tests exactly the `NON_PRIMITIVE` flag -- so a
        // value of that type cannot be a string, and the reason strings are
        // excluded above does not reach it. It is also the type these sites
        // narrow *to*: `value !== null && typeof value === "object" && "k" in
        // value` is how a program duck-types an `unknown`, and it is the most
        // common `in` receiver in `runtime/node`.
        //
        // TypeScript's `{}` is deliberately **not** included, and the difference
        // is not pedantry: `{}` accepts every value but `null` and `undefined`,
        // strings among them, so `"valueOf" in ("a" as {})` throws in node. A
        // receiver whose type admits a primitive has to keep taking the ordinary
        // path.
        if (matches!(
            self.represent(ty),
            Some(HirType::Managed(
                ManagedType::Object(_) | ManagedType::Array(_) | ManagedType::Table(_, _)
            ))
        ) || self.is_the_object_type(ty))
            && property_keys::OBJECT_PROTOTYPE_MEMBERS.contains(&key.as_str())
        {
            // **Lowered for its effect, even though the answer is a constant.**
            // `in` evaluates its right operand before it looks anything up, and
            // this branch used to answer `true` without touching it -- so
            // `"toString" in make()` never called `make`. Measured against node:
            // a counter the receiver incremented stayed at 0 where node had 1,
            // while the same program with a *declared* key agreed, because that
            // path lowers the receiver like everything else.
            //
            // A constant answer is not a reason to skip the operand. It is the
            // reason it is easy to.
            self.lower_expression(rhs)?;
            let origin = self.origin(id);
            return Ok(self.push(OpKind::ConstBool(true), HirType::Bool, origin));
        }
        // TypeScript's `object`, which is what every one of these sites narrows
        // to: `value !== null && typeof value === "object" && "message" in value`
        // is how a program duck-types an `unknown`, and it is 67 sites in
        // `runtime/node` -- the most of any refusal there.
        //
        // The candidate set is then **every class the program has**, which is
        // the same closed-world argument the arms get and for the same reason:
        // a compiled program gains no classes. So this is not a different
        // operation, it is the same one with a wider set.
        if self.is_the_object_type(ty) {
            return self.lower_in_over_every_class(id, lhs, rhs, &key, brand, None);
        }
        // A `Record<string, V>`, whose membership is a *runtime* question.
        //
        // Everything below asks which declared members a type has, and a table
        // declares none -- so `declaring` came out empty and the whole
        // expression folded to `false`. `"a" in o` answered no on a table that
        // had just been given `a`, unconditionally: the emitted C was `v7 =
        // false` with no use of the map after the `nts_map_set`. It did not
        // lower to a lookup that missed; it did not lower to a lookup.
        //
        // The absent case agreed, which is why nothing caught it -- `false` is
        // the right answer there. The Node lane's `agreement.mjs` found it with
        // `Object.hasOwn`, `o["a"]` and `Object.keys` as controls, all of which
        // were already right: the object was correct and only `in` was not.
        //
        // The key is erased on the way in for the reason every table key is:
        // entries are erased values, and `nts_map_has` reads the tag.
        if let Some(HirType::Managed(ManagedType::Table(_, _))) = self.represent(ty) {
            let receiver = self.lower_expression(rhs)?;
            let origin = self.origin(id);
            let text = self.push(
                OpKind::ConstString(key.clone().into()),
                HirType::Managed(ManagedType::String),
                origin.clone(),
            );
            let erased = self.push(
                OpKind::Erase {
                    value: text,
                    absent: Absent::Impossible,
                    slots: Absent::Impossible,
                },
                HirType::Erased,
                origin.clone(),
            );
            return Ok(property_keys::apply(
                self,
                id,
                receiver,
                erased,
                property_keys::Action::Has,
            ));
        }
        if let Some(answer) = self.in_on_a_native(id, rhs, &key, ty)? {
            return Ok(answer);
        }
        let members = match &self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind) {
            Some(TypeKind::Union(members)) => members.clone(),
            Some(_) => vec![ty],
            None => return Err(self.unsupported(rhs, "an `in` on a value with no type")),
        };
        if let Some(answer) =
            self.in_over_a_structural_arm(id, (lhs, rhs), &members, &key, brand)?
        {
            return Ok(answer);
        }

        let members = self.with_subclasses(members);
        let (declaring, optional) = self.arms_declaring(rhs, &members, &key, brand)?;
        let origin = self.origin(id);
        if !optional.is_empty() {
            return self.in_by_presence(id, rhs, &members, &optional, &key);
        }
        self.in_over_the_arms(id, rhs, &members, declaring, &origin)
    }

    /// `in` on a receiver with an interface arm, or `None` where every arm is
    /// a class and the arms and their subclasses answer it.
    ///
    /// **An interface arm holds any object of its shape, not only a class
    /// below it.** `const value: Short = long` keeps a `Long` -- a literal
    /// laid out with `extra`, or a class nothing declares related -- and
    /// `"extra" in value` folded to `false` from `Short`'s members, on main
    /// where the layouts are prefixes and through a field view where they
    /// are not (`tests/outcomes/an-in-test-on-an-interface-holding-a-wider-object`).
    /// The subclasses `lower_in` adds are a fact about classes; a structural
    /// arm's candidates are every object of the program, which is the
    /// `object` answer, read from the object's own layout at run time.
    ///
    /// Only the `false` direction needs them. An arm that requires the key
    /// holds nothing without it, so where every arm does, the answer is the
    /// constant it always was.
    fn in_over_a_structural_arm(
        &mut self,
        id: NodeId,
        (lhs, rhs): (NodeId, NodeId),
        members: &[TypeId],
        key: &str,
        brand: bool,
    ) -> Result<Option<ValueId>, Diagnostic> {
        // A cast face's required members are assertions, not presence proofs.
        // Ask the actual layouts even when every declared arm names the key.
        if let Some(face) = members
            .iter()
            .copied()
            .find(|member| self.hierarchy.cast_faces.contains(member))
            && members.iter().all(|member| {
                self.hierarchy.cast_faces.contains(member)
                    || matches!(
                        self.represent(*member),
                        Some(HirType::Managed(ManagedType::Object(_)))
                    )
            })
        {
            return self
                .lower_in_over_every_class(id, lhs, rhs, key, brand, Some(face))
                .map(Some);
        }
        if members.iter().all(|member| {
            matches!(
                self.represent(*member),
                Some(HirType::Managed(ManagedType::Object(_)))
            )
        }) && members.iter().any(|member| {
            class_symbol(self.snapshot, *member).is_none()
                && !crate::hir::is_closure_type(*member)
                && !self.is_a_signature(*member)
        }) {
            if !brand
                && members.iter().all(|member| {
                    matches!(
                        self.declares(
                            *member,
                            &if brand {
                                PropertyKey::Private(key.to_owned())
                            } else {
                                PropertyKey::Name(key.to_owned())
                            }
                        ),
                        Declares::Always
                    )
                })
            {
                self.lower_expression(rhs)?;
                let origin = self.origin(id);
                return Ok(Some(self.push(
                    OpKind::ConstBool(true),
                    HirType::Bool,
                    origin,
                )));
            }
            return self
                .lower_in_over_every_class(id, lhs, rhs, key, brand, None)
                .map(Some);
        }
        Ok(None)
    }

    /// Which arms of the receiver's type declare the key, and which single arm
    /// declares it optionally.
    fn arms_declaring(
        &mut self,
        rhs: NodeId,
        members: &[TypeId],
        key: &str,
        brand: bool,
    ) -> Result<(Vec<TypeId>, Vec<TypeId>), Diagnostic> {
        let mut declaring: Vec<TypeId> = Vec::new();
        let mut optional: Vec<TypeId> = Vec::new();
        for member in members {
            match self.declares(
                *member,
                &if brand {
                    PropertyKey::Private(key.to_owned())
                } else {
                    PropertyKey::Name(key.to_owned())
                },
            ) {
                Declares::Always => declaring.push(*member),
                Declares::Never => {}
                // Answered from the header rather than from the slot, which is
                // the whole of what the presence bit is for. Collected rather
                // than answered here: a bit is a position in *one* layout, so
                // whether the arms can share a test is a question about all of
                // them, and the caller asks it once they are known.
                Declares::Optionally => optional.push(*member),
                Declares::NotAnObject => {
                    return Err(self.unsupported(
                        rhs,
                        "an `in` on something that is not an object, which JavaScript throws for",
                    ));
                }
            }
        }
        Ok((declaring, optional))
    }

    /// `"k" in o` answered by which of the receiver's arms declare `k`: a
    /// constant when they agree, and the value's own class when they do not.
    fn in_over_the_arms(
        &mut self,
        id: NodeId,
        rhs: NodeId,
        members: &[TypeId],
        mut declaring: Vec<TypeId>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let origin = origin.clone();
        // Every arm declares it, or none does. The operand is still evaluated:
        // `in` has no short circuit and the left side of `&&` chains here often
        // has an effect.
        if declaring.len() == members.len() || declaring.is_empty() {
            let answer = declaring.len() == members.len();
            self.lower_expression(rhs)?;
            return Ok(self.push(OpKind::ConstBool(answer), HirType::Bool, origin));
        }

        // Mixed, so the answer is the value's own class. Every arm needs a
        // layout before the test can name it -- `layout_of` is what builds one,
        // and a type that reaches here without one would be an `InstanceOf`
        // against a class no backend has.
        for member in &declaring {
            self.layout_of(id, *member)?;
        }
        declaring.sort_unstable_by_key(|ty| ty.0);
        declaring.dedup();

        let value = self.lower_expression(rhs)?;
        // Erased first, for the reason `lower_instanceof` gives: the operation
        // asks an object for its class, and a value that might not be one has
        // to say so. `#x in` over one its type lets be absent does not
        // typecheck.
        let value = self.erased(value, Absent::Impossible, &origin);
        Ok(self.push(
            OpKind::InstanceOf {
                value,
                classes: declaring,
                by_layout: false,
            },
            HirType::Bool,
            origin,
        ))
    }

    /// Whether a type declares a property under this name.
    /// Whether a type declares a member, for `in`.
    ///
    /// **The polymorphic `this` type is resolved to its constraint first.**
    /// Inside a class body `this` is a *type parameter*, not the class -- so
    /// `#list in this` asked whether a parameter is an object, got
    /// `NotAnObject`, and refused with "an `in` on something that is not an
    /// object, which JavaScript throws for". A sentence about a receiver that
    /// is provably an object, said of a type variable.
    ///
    /// Three sites in `runtime/node/url/src/searchparams.ts` are written that
    /// way -- `URLSearchParams`'s inspect method and the iterator's `next` --
    /// against three more that use a parameter and were already answerable.
    /// One idiom, two spellings, and only the spelling decided whether it
    /// lowered.
    ///
    /// [`generics::concrete`] is the same substitution the call path already
    /// makes and is bounded the same way: a constraint that is itself a
    /// parameter stays unresolved and keeps refusing.
    /// Whether an **optional** property is written by the act of constructing
    /// the object, so that its presence bit starts set.
    ///
    /// A class field is. `class Box { maybe?: string }` is a field
    /// *declaration*, and under ES2022 class-field semantics -- which the
    /// fixtures' `target: ESNext` selects, so `useDefineForClassFields` is on --
    /// a declaration with no initialiser still defines the property as
    /// `undefined` at construction. `"maybe" in new Box()` is **true**, and it
    /// is true because something wrote it, not because optional means present.
    ///
    /// That distinction is the whole of why this is a *mask* and not an answer.
    /// The first version made `declares` report such a property as always
    /// present and skipped the bit entirely, which is right until the program
    /// writes `delete b.maybe` -- JavaScript removes a class field like any
    /// other, and a static answer cannot. `delete_expression.rs` said so.
    ///
    /// An **interface** or an anonymous object type is the other half: its
    /// values are object literals, `{}` and `{ maybe: undefined }` are both one,
    /// and nothing is written unless the literal writes it.
    ///
    /// `declare maybe?: string` emits nothing, so it defines nothing -- it is a
    /// promise about a property some other code creates. It is `PROPERTY_
    /// DECLARATION` like the field above and is the reason this asks the
    /// modifiers rather than the kind alone. The corpus has 411 `declare` fields
    /// and **none of them optional**, which is why a version that ignored the
    /// modifier would have passed every test here and been wrong in the first
    /// program that wrote one.
    pub(super) fn defined_at_construction(
        &self,
        property: &nts_semantic_schema::PropertyRecord,
    ) -> bool {
        let Some(declaration) = property.declaration else {
            return false;
        };
        if self.kind_of(declaration) != Some(syntax::PROPERTY_DECLARATION) {
            return false;
        }
        let modifiers = self.node(declaration).modifiers;
        !modifiers.contains(nts_semantic_schema::DeclarationModifiers::DECLARE)
            && !modifiers.contains(nts_semantic_schema::DeclarationModifiers::ABSTRACT)
    }

    /// Whether this property is a `#private` member rather than a string key.
    ///
    /// **The two are spelled identically in the snapshot.** `class C { #m }` and
    /// `{ "#m": 1 }` both produce a property named `"#m"`, and only the
    /// declaration tells them apart -- a `#private` member's declaration has a
    /// `PRIVATE_IDENTIFIER` child. The same test [`Self::enumerable_fields`]
    /// makes for `Object.keys`, which is where it was first needed.
    pub(super) fn declared_with_a_private_name(&self, property: &PropertyRecord) -> bool {
        let Some(declaration) = property.declaration else {
            return false;
        };
        // **The *name* child, not any child.** `any` here reads the initializer
        // too, and an initializer may mention a private name without the member
        // being one:
        //
        // ```js
        //   class C { #m = 44; ["#m"] = this.#m / 11; }
        // ```
        //
        // Both members are recorded as a property named `"#m"` -- the language
        // lets them coexist and they are different properties -- and the second
        // one's declaration carries `this.#m` in its initializer. Reading every
        // child called the computed one private too, so `hasOwnProperty("#m")`
        // and `"#m" in this` both answered `false` where node answers `true`.
        //
        // test262 writes three files for exactly this collision
        // (`*-is-not-clobbered-by-computed-property`), which is how it was
        // caught: two of them went from a refusal to a *wrong answer*, which the
        // census reports as `threw` and is the one direction not to trade in.
        self.children(declaration)
            .first()
            .is_some_and(|name| self.kind_of(*name) == Some(syntax::PRIVATE_IDENTIFIER))
    }

    /// Whether a type declares this key.
    ///
    /// `private_names_match` is **false where the key was written as a string**,
    /// and that is the whole of the difference between `#m in o` and
    /// `"#m" in o`. The first is the ergonomic brand check and is true; the
    /// second asks for a string-keyed property called `#m`, which a `#private`
    /// member is not -- `"#m" in this` answered **true** here and `false` in
    /// node, a wrong answer that compiled and ran.
    ///
    /// Rejecting a key that begins with `#` would not do, because `{ "#m": 1 }`
    /// is a legal object with a string key spelled that way and `"#m" in it` is
    /// true. The question is about the *property*, so it is asked of the
    /// declaration.
    ///
    /// The three callers that are not the `in` operator pass `true` and keep
    /// today's answer: two ask about an optional property's presence bit by its
    /// declared name, and `has_the_slot` is reached from `o.m?.()` and from a
    /// comparison, where a `#private` member named through `this.#m` does match.
    pub(super) fn declares(&self, ty: TypeId, key: &PropertyKey) -> Declares {
        let ty = crate::hir::generics::concrete(self.snapshot, ty);
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return Declares::NotAnObject;
        };
        let TypeKind::Object { properties } = &record.kind else {
            return Declares::NotAnObject;
        };
        match properties.iter().find(|property| property.name == *key) {
            Some(property) if property.optional => Declares::Optionally,
            Some(_) => Declares::Always,
            None => Declares::Never,
        }
    }

    /// The text of a string literal used as a key, where it is one.
    fn literal_key(&self, node: NodeId) -> Option<String> {
        match &self
            .snapshot
            .types
            .get(self.snapshot.node_types.get(&node)?.0 as usize)?
            .kind
        {
            TypeKind::Literal(LiteralValue::String(text)) => text.as_utf8().map(str::to_owned),
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
            _ => None,
        }
    }

    /// A method call whose receiver is already lowered.
    ///
    /// Split out of [`Self::lower_method_call`] so the optional-chained form can
    /// hand it a receiver that has been narrowed inside the present arm.
    /// `o.hasOwnProperty(k)`, answered from the layout.
    ///
    /// **It is `in` minus everything inherited**, which is the whole of the
    /// difference and the reason this cannot reuse `lower_in`. `in` walks the
    /// prototype chain -- `"valueOf" in {}` is true, and `lower_in` carries the
    /// list of `Object.prototype`'s names for it -- and `hasOwnProperty` asks
    /// only about the object's own storage. So a *method* answers `false`:
    /// `class C { m() {} }` puts `m` on the prototype, and
    /// `new C().hasOwnProperty("m")` is `false` in every engine.
    ///
    /// Three answers and one refusal, which is the honest split:
    ///
    /// ```text
    ///   a `Field` the type declares      true
    ///   a `Method` or an `Accessor`      false -- on the prototype, not the object
    ///   no property of that name         false
    ///   an optional field                refused; the answer is a presence bit
    /// ```
    ///
    /// A `#private` member answers `false` through the same test `declares`
    /// makes for `"#m" in o` and `enumerable_fields` makes for `Object.keys`: it
    /// is not a string-keyed property, and the snapshot spells it as though it
    /// were. `private-method-is-not-a-own-property.js` asserts exactly that and
    /// is one of the six files this closes.
    ///
    /// The optional case is refused rather than guessed because the object
    /// header records whether an optional property was written --
    /// `has_the_slot` reads that bit for `in` -- and answering from the type
    /// alone would be `true` for a property never assigned.
    /// The dispatch for [`Self::lower_has_own_property`], separated so that
    /// `lower_method_on` stays one screen of receiver arms.
    pub(super) fn own_property_call(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        held: &HirType,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        let HirType::Managed(ManagedType::Object(ty)) = held else {
            return None;
        };
        (self.literal_name(member).as_deref() == Some("hasOwnProperty"))
            .then(|| self.lower_has_own_property(id, receiver, *ty, arguments))
    }

    fn lower_has_own_property(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        type_id: TypeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let [argument] = arguments else {
            return Err(self.unsupported(id, "`hasOwnProperty` with no argument"));
        };
        let Some(key) = self.literal_key(*argument) else {
            return Err(self.unsupported(
                *argument,
                "`hasOwnProperty` whose key is not a literal the compiler can see",
            ));
        };
        let ty = crate::hir::generics::concrete(self.snapshot, type_id);
        let properties = match self.snapshot.types.get(ty.0 as usize).map(|it| &it.kind) {
            Some(TypeKind::Object { properties }) => properties.clone(),
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => Vec::new(),
            _ => Vec::new(),
        };
        let found = properties.iter().find(|property| {
            property.name.is_name(key.as_ref()) && !self.declared_with_a_private_name(property)
        });
        if let Some(property) = found
            && property.optional
        {
            return Err(self.unsupported(
                id,
                "`hasOwnProperty` of an optional property, whose answer is a presence bit",
            ));
        }
        // A field is an own property and a class's method is on the
        // prototype. That was the whole of the answer, and it was wrong for
        // the third case: an object *literal's* method is an own property of
        // the object -- node answers `true` for `{ read() {} }` -- and this
        // answered `false` for it, on every literal, since the day it was
        // written. Measured 2026-09-22 against the binary before the stored
        // members landed: both named and anonymous literals disagreed with
        // node. A member the type lays out as storage is the same case with
        // the same answer, since only a literal ever builds one.
        //
        // A method the type declares as a *signature* has no answer here: the
        // value is a literal or a class instance, and only the value knows.
        // Refused rather than guessed, because the guess was `false` and it
        // was a wrong answer rather than a missing one.
        let answer = match found {
            None => false,
            Some(property) if property.kind == MemberKind::Field => true,
            Some(property) if self.hierarchy.stores(ty, &property.name) => true,
            Some(property) if self.declared_in_an_object_literal(property) => true,
            Some(property) if self.declared_in_a_class(property) => false,
            Some(_) => {
                return Err(self.unsupported(
                    id,
                    "`hasOwnProperty` of a method the type declares as a signature, whose \
                     answer is whether the value is a literal or a class instance",
                ));
            }
        };
        // The receiver is still evaluated: `f().hasOwnProperty("x")` calls `f`,
        // and folding the answer must not fold the call away with it.
        let _ = receiver;
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstBool(answer), HirType::Bool, origin))
    }

    /// `(x as T).p !== undefined` over a union of objects, answered by which of
    /// `x`'s members declare `p` -- as `"p" in x` is, which is what it asks
    /// there.
    ///
    /// `as` has no run-time effect, so the read is of whatever object arrived:
    /// its field where its layout declares one, `undefined` where it does not.
    /// Reading through `T`'s offsets instead read another layout's field --
    /// `as` over a union now refuses that by name (`refuse_a_foreign_layout`)
    /// -- and this is node's answer for the idiom every user-defined type
    /// guard is written with, `return (shape as Square).side !== undefined`.
    ///
    /// Only where presence is the whole answer: every member is an object, and
    /// every member that declares `p` declares it a required *field* -- stored,
    /// so no accessor runs on the read -- of a type `undefined` is not in.
    /// Anything else returns `None` and is lowered as it was.
    pub(super) fn cast_member_presence(
        &mut self,
        id: NodeId,
        token: u16,
        lhs: NodeId,
        rhs: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        let absent = match token {
            syntax::EQUALS_EQUALS_EQUALS_TOKEN | syntax::EQUALS_EQUALS_TOKEN => true,
            syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_TOKEN => false,
            _ => return None,
        };
        let access = if self.is_the_undefined_literal(rhs) {
            self.through_parentheses(lhs)
        } else if self.is_the_undefined_literal(lhs) {
            self.through_parentheses(rhs)
        } else {
            return None;
        };
        if self.kind_of(access) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let parts = self.children(access);
        let [object, member] = parts.as_slice() else {
            return None;
        };
        let cast = self.through_parentheses(*object);
        if self.kind_of(cast) != Some(syntax::AS_EXPRESSION) {
            return None;
        }
        let operand = *self.children(cast).first()?;
        let operand_ty = *self.snapshot.node_types.get(&operand)?;
        let TypeKind::Union(members) = self.snapshot.types.get(operand_ty.0 as usize)?.kind.clone()
        else {
            return None;
        };
        let key = self.literal_name(*member)?;
        let mut declaring = Vec::new();
        for arm in &members {
            let concrete = crate::hir::generics::concrete(self.snapshot, *arm);
            let TypeKind::Object { properties } =
                &self.snapshot.types.get(concrete.0 as usize)?.kind
            else {
                return None;
            };
            match properties
                .iter()
                .find(|property| property.name.is_name(key.as_ref()))
            {
                None => {}
                Some(property)
                    if property.kind == nts_semantic_schema::MemberKind::Field
                        && !property.optional
                        && !self.admits_undefined(Some(property.ty)) =>
                {
                    declaring.push(*arm);
                }
                Some(_) => return None,
            }
        }
        let origin = self.origin(id);
        Some((|| {
            let present = self.in_over_the_arms(id, operand, &members, declaring, &origin)?;
            if !absent {
                return Ok(present);
            }
            Ok(self.push(
                OpKind::Unary {
                    op: UnOp::Not,
                    operand: present,
                },
                HirType::Bool,
                origin.clone(),
            ))
        })())
    }
}

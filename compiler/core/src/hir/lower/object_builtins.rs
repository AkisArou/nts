//! Lower Object operations and enumerate own keys, values, and entries in their declared order.

use super::{
    ArrayFill, BinOp, Branch, Callee, Diagnostic, Enumerated, FuncBuilder, HirType, Layout,
    ManagedType, MemberKind, MethodAccessor, NodeId, OpKind, Origin, PropertyKey, PropertyRecord,
    Terminator, TypeId, TypeKind, ValueId, Written, syntax,
};

/// Own property names in the order the language enumerates them, with the slot
/// each one came from.
///
/// **Array indices first, ascending numerically; then the rest in insertion
/// order.** That is `OrdinaryOwnPropertyKeys`, and this compiler gave the
/// layout's order for everything -- so
///
/// ```js
/// Object.keys({ b: 1, a: 2, 2: 3, 1: 4 })
/// ```
///
/// answered `["b", "a", "2", "1"]` where node answers `["1", "2", "b", "a"]`.
/// A wrong answer rather than a refusal, in a builtin ordinary code calls, and
/// **the comment on `decide_object_keys` named the exception without
/// implementing it**: "insertion order, which is what `Object.keys` is
/// specified to give for string keys *that are not array indices*".
///
/// Four consumers were wrong together -- `Object.keys`, `Object.entries`,
/// `Object.values` and `for...in`, the last through `decide_object_keys` --
/// which is why this returns the **permutation** rather than a name list: a
/// column reads its value from the layout's slot and writes it at the
/// enumeration position, and those are two different numbers.
///
/// An **array index** is the specification's `CanonicalNumericIndexString`
/// restricted to integers below 2^32 - 1, which is exactly "the decimal
/// spelling round-trips". `"01"`, `"1.0"` and `"-1"` are ordinary string keys
/// and stay where they were written, which the round-trip test says without a
/// second rule to keep in step.
///
/// Found by probing against node; no corpus file reported it.
/// The property names an object literal writes, in source order.
///
/// `None` where the literal says nothing about order:
///
/// - **a spread** contributes its source's fields under no name here, so a
///   literal containing one would be recorded short and claim an order it does
///   not have;
/// - **a computed key** is the same absence with a different spelling;
/// - **a repeated name** is not a shape. The second write wins in JavaScript
///   and nothing here can order the pair.
///
/// One derivation, two readers: `collect_naming` folds these into
/// `Naming::written_order` to decide a *layout's* field order, and
/// `FuncBuilder::as_that_literal_writes_them` asks the same question of one
/// literal to answer `Object.keys` at a use. The two disagreeing would be a
/// layout whose order no `Object.keys` agrees with, which is the failure record
/// 0258 is about.
pub(super) fn literal_field_names(probe: &FuncBuilder, literal: NodeId) -> Option<Vec<String>> {
    let mut names = Vec::new();
    for property in probe.children(literal) {
        let name = match probe.kind_of(property) {
            Some(syntax::PROPERTY_ASSIGNMENT) => probe
                .children(property)
                .first()
                .and_then(|name| probe.literal_name(*name)),
            Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
                probe.children(property).first().and_then(|name| {
                    probe
                        .node(*name)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        .map(str::to_owned)
                })
            }
            _ => None,
        };
        names.push(name?);
    }
    if names.is_empty() {
        return None;
    }
    let mut sorted = names.clone();
    sorted.sort();
    if sorted.windows(2).any(|pair| pair[0] == pair[1]) {
        return None;
    }
    Some(names)
}

pub(super) fn property_order<'a>(names: impl Iterator<Item = &'a str>) -> Vec<(usize, String)> {
    let mut indices: Vec<(u32, usize, String)> = Vec::new();
    let mut rest: Vec<(usize, String)> = Vec::new();
    for (slot, name) in names.enumerate() {
        match name.parse::<u32>() {
            // `u32::MAX` is not an array index: the specification stops one
            // short so that `length` can hold the count.
            Ok(index) if index != u32::MAX && index.to_string() == name => {
                indices.push((index, slot, name.to_owned()));
            }
            _ => rest.push((slot, name.to_owned())),
        }
    }
    indices.sort_unstable_by_key(|(index, _, _)| *index);
    indices
        .into_iter()
        .map(|(_, slot, name)| (slot, name))
        .chain(rest)
        .collect()
}

impl FuncBuilder<'_> {
    /// The field names of whatever the argument's layout is.
    /// `Object.values(o)` and `Object.entries(o)`, which a layout answers.
    ///
    /// The same walk `Object.keys` makes, one column over: its names are the
    /// layout's field names and these are the fields themselves, in the same
    /// order, which is the order the specification asks for and the order the
    /// program wrote. Nothing runs at run time to decide *which* -- the layout
    /// is fixed when it is laid out -- so this is a constant list of reads.
    ///
    /// `entries` builds a two-field object per property, which is what a
    /// `[string, T]` tuple is here. That makes
    /// `for (const [k, v] of Object.entries(o))` an ordinary destructuring walk
    /// over an array of tuples, which is the shape the idiom is written in and
    /// the reason to do both at once.
    ///
    /// **A value is coerced into the slot rather than stored raw.** The tuple's
    /// second field is the *union* of the property types where they differ, so
    /// `{ a: 1, b: "x" }` gives `[string, number | string]` and each read has to
    /// be erased on the way in. Storing the field's own representation was the
    /// first version and `verify` rejected it, which is the check earning its
    /// keep at the only place that could have got this wrong.
    #[expect(
        clippy::too_many_lines,
        reason = "keep semantic text and key projection beside its existing dispatch"
    )]
    pub(super) fn decide_object_columns(
        &mut self,
        id: NodeId,
        argument: NodeId,
        pairs: bool,
    ) -> Result<ValueId, Diagnostic> {
        // Lowered for its effects before anything else, exactly as
        // `Object.keys` does: `Object.values(f())` calls `f`.
        let object = self.lower_expression(argument)?;
        let (owner, layout) = self.own_layout(id, argument)?;
        let enumerable = self.enumerable_fields(owner, &layout);
        let what = if pairs {
            "`Object.entries`"
        } else {
            "`Object.values`"
        };
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, what))?;
        let HirType::Managed(ManagedType::Array(element)) = ty.clone() else {
            return Err(self.unsupported(id, &format!("{what} answering something not an array")));
        };
        let element = (*element).clone();
        let origin = self.origin(id);
        #[allow(clippy::cast_precision_loss)]
        let count = enumerable.len() as f64;
        let length = self.push(OpKind::ConstFloat(count), HirType::NUMBER, origin.clone());
        let array = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            ty,
            origin.clone(),
        );
        // **The output position and the field index are two different
        // numbers**, and they were one. `property_order` puts array indices
        // first, so `{ 2: 3, 1: 4 }` enumerates field 1 before field 0 -- the
        // slot a value is read from stays the layout's and only the position it
        // lands at changes.
        let ordered = property_order(enumerable.iter().map(|(_, name)| name.as_str()));
        for (position, (at, _)) in ordered.into_iter().enumerate() {
            let (source, name) = enumerable[at].clone();
            #[allow(clippy::cast_precision_loss)]
            let position = position as f64;
            let index = self.push(
                OpKind::ConstFloat(position),
                HirType::NUMBER,
                origin.clone(),
            );
            let read = match source {
                // Its value is a function object. `bound_method` builds one and
                // wants a property-access node to read the member off, which
                // this does not have --- so the name enumerates and the value
                // is refused, rather than the array quietly coming back one
                // element short, which is what it did before.
                Enumerated::Method => {
                    return Err(self.unsupported(
                        id,
                        &format!(
                            "`{name}`, a method of an object literal, in {what} -- it enumerates and its value is a function object"
                        ),
                    ));
                }
                Enumerated::Slot(slot) => {
                    let field = layout.fields[slot].clone();
                    self.push(
                        OpKind::FieldGet {
                            object,
                            field: u32::try_from(slot).unwrap_or(u32::MAX),
                        },
                        field.ty.clone(),
                        origin.clone(),
                    )
                }
                // The same call a property read makes, which is what a getter
                // *is*. `Object.values` runs them, in the order it reports them.
                Enumerated::Getter => {
                    let Some(callee) = self.accessor_callee(
                        argument,
                        owner,
                        &PropertyKey::Name(name.clone()),
                        MethodAccessor::Get,
                    )?
                    else {
                        // Set-only. The name is enumerable and its value is
                        // `undefined`, which this array's element has no width
                        // for -- so it is refused by name rather than answered
                        // with a zero, which is the thing this whole change is
                        // about.
                        return Err(self.unsupported(
                            id,
                            &format!(
                                "`{name}`, a set-only property, in {what} -- it enumerates and its value is `undefined`"
                            ),
                        ));
                    };
                    let returns = self
                        .declared_type_of(owner, &PropertyKey::Name(name.clone()))
                        .and_then(|declared| self.represent(declared))
                        .unwrap_or_else(|| element.clone());
                    self.push_an_accessor_call(
                        argument,
                        callee,
                        vec![object],
                        returns,
                        origin.clone(),
                    )
                }
            };
            let value = if pairs {
                self.object_entry(id, &element, &name, read)?
            } else {
                self.coerce(read, &element, id)?
            };
            self.push(
                OpKind::ArraySet {
                    array,
                    index,
                    value,
                    checked: false,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(array)
    }

    /// One `[name, value]` of `Object.entries`: the name a constant, the pair
    /// [`Self::pair_of`]'s.
    fn object_entry(
        &mut self,
        id: NodeId,
        element: &HirType,
        name: &str,
        read: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let key = self.push(
            OpKind::ConstString(name.to_owned().into()),
            HirType::Managed(ManagedType::String),
            origin,
        );
        self.pair_of(id, element, [key, read])
    }

    /// One pair, `[first, second]`, at the representation its array holds:
    /// `Object.entries`' `[name, value]`, and a collected `Map`'s `[key,
    /// value]`, `Set`'s `[v, v]` or array's `[index, element]`. One builder,
    /// so a pair walked out of a table and a pair written as a literal beside
    /// it are the same object.
    pub(super) fn pair_of(
        &mut self,
        id: NodeId,
        element: &HirType,
        pair: [ValueId; 2],
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        // **A pair of two like things is an array, not a struct.** `[string,
        // number]` is laid out as an object with two differently typed fields;
        // `[string, string]` is two strings in a row, which is an array of
        // strings, and the representation says so rather than the syntax. Both
        // are the same tuple to the checker and both have to be built here.
        if let HirType::Managed(ManagedType::Array(slot)) = element {
            let slot = (**slot).clone();
            let length = self.push(OpKind::ConstFloat(2.0), HirType::NUMBER, origin.clone());
            let built = self.push(
                OpKind::ArrayNew {
                    length,
                    fill: ArrayFill::Holes,
                },
                element.clone(),
                origin.clone(),
            );
            for (at, value) in pair.into_iter().enumerate() {
                let value = self.coerce(value, &slot, id)?;
                #[allow(clippy::cast_precision_loss)]
                let position = at as f64;
                let index = self.push(
                    OpKind::ConstFloat(position),
                    HirType::NUMBER,
                    origin.clone(),
                );
                self.push(
                    OpKind::ArraySet {
                        array: built,
                        index,
                        value,
                        checked: false,
                    },
                    HirType::Void,
                    origin.clone(),
                );
            }
            return Ok(built);
        }
        let HirType::Managed(ManagedType::Object(tuple)) = element else {
            return Err(self.unsupported(id, "a pair held as something that is not a tuple"));
        };
        let layout = self.layout_of(id, *tuple)?;
        let [first, second] = layout.fields.as_slice() else {
            return Err(self.unsupported(id, "a pair held as a tuple of other than two"));
        };
        let slots = [first.ty.clone(), second.ty.clone()];
        let built = self.push(
            OpKind::ObjectNew { frame: false },
            element.clone(),
            origin.clone(),
        );
        for (field, (value, slot)) in (0u32..).zip(pair.into_iter().zip(slots)) {
            let value = self.coerce(value, &slot, id)?;
            self.field_set(built, field, value, &origin);
        }
        Ok(built)
    }

    fn own_layout(&mut self, id: NodeId, argument: NodeId) -> Result<(TypeId, Layout), Diagnostic> {
        let own = self
            .node(argument)
            .symbol
            .and_then(|symbol| self.bindings.get(&symbol.0).copied())
            .and_then(|value| self.known_allocation(value));
        let type_id = if let Some(owner) = own {
            owner
        } else {
            let ty = self
                .snapshot
                .node_types
                .get(&argument)
                .copied()
                .map(|ty| self.class_behind(ty))
                .ok_or_else(|| self.unsupported(id, "a static over a value with no type"))?;
            let HirType::Managed(ManagedType::Object(type_id)) = self
                .represent(ty)
                .ok_or_else(|| self.unrepresentable(id, "the argument of an `Object` static"))?
            else {
                return Err(self.unsupported(
                    id,
                    "an `Object` static over something that is not an object here",
                ));
            };
            type_id
        };
        if own.is_none()
            && self.hierarchy.access_families.changes_transport(type_id)
            && !self.hierarchy.access_families.permits_spread(type_id)
        {
            return Err(self.unsupported(
                id,
                "an `Object` static through an interface whose concrete own properties, \
                 order or storage are not uniform -- field accessors do not supply \
                 own-property reflection",
            ));
        }
        // An **optional** property is not a name the layout can answer for.
        //
        // `Object.keys` and `Object.hasOwn` report what an object *has*, and an
        // optional property's slot exists whether or not it was written -- so
        // the declaration says `maybe` is there and the value may disagree.
        // `{ keep: 1 }` against `interface Bag { keep: number; maybe?: number }`
        // gave `["keep", "maybe"]` where node gives `["keep"]`, which the
        // differential reported on 29 of 29 cases once a fixture asked.
        //
        // Refused rather than answered from the tag, and the reason is the same
        // one `in` gives for the same property: an optional slot holds
        // `T | undefined` and a fresh allocation is zeroed, which is already the
        // `undefined` tag -- so `{}` and `{ maybe: undefined }` are one object
        // here and JavaScript says their key lists differ.
        //
        // A run-time answer is possible and is a different feature: a loop over
        // the layout testing each optional tag, producing an array whose length
        // is not known until it runs. Nothing in the profile asks for it.
        if let Some(optional) = self.optional_property_of(type_id) {
            return Err(self.unsupported(
                id,
                &format!(
                    "an `Object` static over a type with the optional property `{optional}`, \
                     whose presence is a fact about the value rather than the type"
                ),
            ));
        }
        let layout = self.layout_of(id, type_id)?;
        // **A function object's own properties are not its layout's fields.**
        //
        // `Object.keys(SomeClass)` answered `[]` where node answers
        // `["x","y"]`: a class value is function-typed, its layout is `Fn__1`
        // with no fields at all, and an empty field list walks to an empty
        // array. A wrong answer that compiled, and one indistinguishable from
        // the right answer for a plain function.
        //
        // Asked of the **type** rather than of the layout's name. The first
        // version tested `is_constructor_name(&layout.name)`, on the reasoning
        // that a class object is a `Ctor_` --- and the layout that arrives here
        // is `Fn__1`, so it never fired. A probe cannot tell that from a guard
        // whose controls all pass; an `eprintln!` in this function could, and
        // `nts types` says plainly that `Statics` is `Function(SignatureId(0))`.
        //
        // A plain function's `[]` was only accidentally right: `fn.foo = 1` is
        // an own enumerable property and nothing here models one, so what this
        // gives up is an answer that was never derived.
        if self.is_function_typed(argument) {
            return Err(self.unsupported(
                id,
                "an `Object` static over a function object, whose own properties are not \
                 fields of it -- a class's statics are globals",
            ));
        }
        Ok((type_id, layout))
    }

    /// The own property names an `Object` static answers about.
    pub(super) fn own_names(
        &mut self,
        id: NodeId,
        argument: NodeId,
    ) -> Result<Vec<String>, Diagnostic> {
        let (ty, layout) = self.own_layout(id, argument)?;
        let enumerable = self.enumerable_fields(ty, &layout);
        let enumerable = self.as_that_literal_writes_them(argument, enumerable);
        Ok(
            property_order(enumerable.iter().map(|(_, name)| name.as_str()))
                .into_iter()
                .map(|(at, _)| enumerable[at].1.clone())
                .collect(),
        )
    }

    /// Order the names by the literal **this value** was written as, where the
    /// lowering can see one.
    ///
    /// `Object.keys` answers own string keys in insertion order. A compiled
    /// object has no insertion order -- it has a layout, and the layout is one
    /// order for every object of the type. `as_the_program_writes_them` makes
    /// that one order the literals' where they all agree, and record 0258 is
    /// the measurement of what happens when the layout is asked to serve
    /// anything else: `{ c, a, b }` and `{ a, b, c }` are the same type, and
    /// whichever order the layout holds, the other one answers wrong.
    ///
    /// **So ask the value rather than the type.** The literal is right here in
    /// most of the cases that matter -- `Object.keys({ a, b })`, or a `const`
    /// whose initialiser is one -- and where it is, its order is the answer and
    /// no layout has to change to give it. Where it is not, the layout's order
    /// stands, which is exactly what this did before.
    ///
    /// A name the literal does not mention keeps the position it had, for the
    /// reason [`Self::as_the_program_writes_them`] gives: a literal that omits
    /// an optional field says nothing about where that field goes.
    ///
    /// Applied **before** `property_order`, so an integer-like key is still
    /// hoisted and sorted ascending afterwards. JavaScript's rule is that
    /// integer indices come first whatever order they were written in, and this
    /// is about the string keys that come after them.
    fn as_that_literal_writes_them(
        &self,
        argument: NodeId,
        mut fields: Vec<(Enumerated, String)>,
    ) -> Vec<(Enumerated, String)> {
        let Some(literal) = self.written_as_a_literal(argument) else {
            return fields;
        };
        let Some(written) = literal_field_names(self, literal) else {
            return fields;
        };
        let mut ordered: Vec<(Enumerated, String)> = Vec::with_capacity(fields.len());
        for name in written {
            if let Some(at) = fields.iter().position(|(_, held)| *held == name) {
                ordered.push(fields.remove(at));
            }
        }
        ordered.append(&mut fields);
        ordered
    }

    /// The object literal this expression is, or the one a `const` binds it to.
    ///
    /// **`const` only**, and that is the whole of the soundness argument: a
    /// `let` can be assigned a second object of the same type written the other
    /// way round, and then there is no single literal to answer for the name.
    /// A `const` has one initialiser and it is in the same function.
    ///
    /// Deliberately one hop. A chain of `const` aliases would work the same way
    /// and is not written here because nothing measured wants it -- see
    /// `with_const_aliases` for the walk if it ever does.
    fn written_as_a_literal(&self, argument: NodeId) -> Option<NodeId> {
        if self.kind_of(argument) == Some(syntax::OBJECT_LITERAL_EXPRESSION) {
            return Some(argument);
        }
        if self.kind_of(argument) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let symbol = self.node(argument).symbol?;
        let declaration = *self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .first()?;
        if self.kind_of(declaration) != Some(syntax::VARIABLE_DECLARATION)
            || self.declaration_kind(declaration) != nts_semantic_schema::VariableKind::Const
        {
            return None;
        }
        // `[name, initializer]` for `const o = {…}` and `[name, type,
        // initializer]` for an annotated one. A declaration with no initialiser
        // ends at its type, which the kind check below rejects.
        let children = self.children(declaration);
        let [_name, .., initializer] = children.as_slice() else {
            return None;
        };
        (self.kind_of(*initializer) == Some(syntax::OBJECT_LITERAL_EXPRESSION))
            .then_some(*initializer)
    }

    /// The layout's fields that are **properties**, each with the slot it sits in.
    ///
    /// A `#private` field is storage and is not a property: `Object.keys(new
    /// C())` does not mention it and `for...in` does not visit it. This listed
    /// it, which is a wrong answer rather than a refusal.
    ///
    /// **Asked of the declaration, not of the name.** `#h` and `"#h"` are two
    /// different members that a layout spells identically, and
    /// `class C { "#h" = 1 }` and `const o = { "#h": 1 }` are ordinary
    /// enumerable properties that both work today — so a prefix test would
    /// break two working cases to fix one broken one, which is measured rather
    /// than assumed. `PropertyRecord::declaration` points at the node, and a
    /// private member names itself with a `PRIVATE_IDENTIFIER`.
    ///
    /// A field the snapshot has no property for is **kept**: a tuple's `_0`, a
    /// closure's capture and an anonymous object type's member have no
    /// `PropertyRecord` to ask, and they reach here only through paths that
    /// have already decided they are enumerable.
    pub(super) fn enumerable_fields(
        &self,
        ty: TypeId,
        layout: &Layout,
    ) -> Vec<(Enumerated, String)> {
        let properties = match self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind) {
            Some(TypeKind::Object { properties }) => properties.clone(),
            _ => Vec::new(),
        };
        let keeps = |key: &PropertyKey| {
            let Some(name) = key.public_name() else {
                return false;
            };
            let mut named = properties
                .iter()
                .filter(|p| p.name.is_name(name.as_ref()))
                .peekable();
            if named.peek().is_none() {
                return true;
            }
            named.any(|property| !self.declared_with_a_private_name(property))
        };

        // **The layout's order is kept unless an accessor forces otherwise**,
        // and that is not tidiness: the checker's member list is *own-first*
        // and a layout is *base-first*, so walking properties unconditionally
        // renamed `Object.keys(new B())` from `a,b,c,d` to `c,d,a,b` for
        // `class B extends A`. Measured against the previous binary, and the
        // gate could not have said so --- no example enumerates an inherited
        // class, which is why one is in `an-accessor-that-enumerates` now.
        //
        // An accessor only ever reaches this list from an object *literal*,
        // where the layout order, the property order and the source order are
        // the same thing. So where there is none, this is the walk it always
        // was, bit for bit.
        // **One derivation of "a member with no storage".** It is asked twice
        // --- once to decide whether the order has to change at all, once per
        // member while walking --- and a getter and a method differ here only
        // in which variant they produce. Two copies of the condition would be
        // two places to forget that `own` is not what separates a literal's
        // accessor from a class's.
        //
        // **Where it is written, because `own` does not separate these.**
        // `Object.keys(new C())` must not name `get d()` and
        // `Object.keys({ get a() {} })` must name `a`, and `own` is `false` for
        // *both* --- measured, after it was assumed and the class control went
        // red one way and the literal consumers the other. A class's member
        // lives on the prototype; a literal's is a property of the object.
        let without_storage = |property: &PropertyRecord| match property.kind {
            MemberKind::Accessor(_) if self.declared_in_an_object_literal(property) => {
                Some(Enumerated::Getter)
            }
            MemberKind::Method if self.declared_in_an_object_literal(property) => {
                Some(Enumerated::Method)
            }
            _ => None,
        };

        if !properties
            .iter()
            .any(|property| without_storage(property).is_some())
        {
            return layout
                .fields
                .iter()
                .enumerate()
                .filter(|(_, field)| keeps(&field.name))
                .filter_map(|(at, field)| {
                    field
                        .name
                        .public_name()
                        .map(|name| (Enumerated::Slot(at), name.to_owned()))
                })
                .collect();
        }

        let mut out: Vec<(Enumerated, String)> = Vec::new();
        // **Walking the type, not the layout.**
        //
        // A getter is a call and a `Layout` holds storage, so it has no entry
        // there at all --- which is why every consumer of this list dropped one
        // silently. The names are on the *type*, which is where `lower_in` asks
        // and is why `"a" in src` was right while `Object.keys(src)` was not.
        //
        // In the type's order rather than appended, because appending gives
        // `["b", "a"]` for `{ get a() {}, b: 2 }` and node says `["a", "b"]`.
        // `property_order` reorders array indices afterwards either way.
        for property in &properties {
            if !keeps(&property.name) {
                continue;
            }
            if let Some(at) = layout.index_of_key(&property.name) {
                out.push((
                    Enumerated::Slot(at as usize),
                    property
                        .name
                        .public_name()
                        .expect("keeps selected a public name")
                        .to_owned(),
                ));
            } else if let Some(kind) = without_storage(property) {
                out.push((
                    kind,
                    property
                        .name
                        .public_name()
                        .expect("keeps selected a public name")
                        .to_owned(),
                ));
            }
        }
        // **A field the type has no property for is kept**, which is the case
        // this function has always had to carry: a tuple's `_0`, a closure's
        // capture and an anonymous object type's member reach here through
        // paths that have already decided they are enumerable, and a type with
        // no properties at all leaves the walk above empty.
        for (at, field) in layout.fields.iter().enumerate() {
            if out.iter().any(|(_, name)| field.name.is_name(name)) {
                continue;
            }
            if keeps(&field.name) {
                out.push((
                    Enumerated::Slot(at),
                    field
                        .name
                        .public_name()
                        .expect("keeps selected a public name")
                        .to_owned(),
                ));
            }
        }
        out
    }

    /// Whether a type declares this name as an accessor of its **own**.
    ///
    /// The distinction the layout cannot make: an accessor has no field, so
    /// "absent from the layout" covers a member that does not exist, a method,
    /// an inherited accessor, and an own one --- and only the last is an own
    /// property.
    pub(super) fn own_accessor(&self, ty: TypeId, wanted: &str) -> bool {
        // Named for the case it was written for; a literal's **method** is an
        // own property by the same rule and is answered here rather than in a
        // second walk that could disagree with this one.
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        let TypeKind::Object { properties } = &record.kind else {
            return false;
        };
        properties.iter().any(|property| {
            property.name.is_name(wanted.as_ref())
                && matches!(property.kind, MemberKind::Accessor(_) | MemberKind::Method)
                && self.declared_in_an_object_literal(property)
        })
    }

    /// Whether a member is written in an object literal rather than a class.
    ///
    /// The question `own` looked like it answered and does not: it is `false`
    /// for a literal's accessor and for a class's alike. What separates them is
    /// that a class's accessor is installed on the **prototype** --- not an own
    /// property, absent from `Object.keys(new C())` --- and a literal's is a
    /// property of the object itself.
    ///
    /// Syntactic on purpose, the same way [`Self::declared_with_a_private_name`]
    /// is: the distinction is about where the member was written, and the
    /// declaration node is the only thing that records it.
    pub(super) fn declared_in_an_object_literal(&self, property: &PropertyRecord) -> bool {
        self.declared_within(property) == Some(Written::InALiteral)
    }

    /// Whether a member is written in a class -- the other answer the walk
    /// behind [`Self::declared_in_an_object_literal`] gives. A member declared
    /// as a *signature* in an interface or a type literal is neither.
    pub(super) fn declared_in_a_class(&self, property: &PropertyRecord) -> bool {
        self.declared_within(property) == Some(Written::InAClass)
    }

    /// The nearest literal or class enclosing a member's declaration.
    ///
    /// One walk for both questions, so the two cannot disagree about where the
    /// boundary is: a literal inside a class method is a literal, and a class
    /// expression inside a literal is a class.
    ///
    /// **Whichever comes first going up**, rather than the immediate parent.
    /// The encoder puts members in a node list, so an accessor's parent is
    /// not the literal -- testing for it directly answered `false` for every
    /// literal and the consumers stayed broken while the class controls
    /// passed, which reads exactly like the guard working.
    fn declared_within(&self, property: &PropertyRecord) -> Option<Written> {
        let mut at = self.node(property.declaration?).parent;
        while let Some(node) = at {
            match self.kind_of(node) {
                Some(syntax::OBJECT_LITERAL_EXPRESSION) => return Some(Written::InALiteral),
                Some(syntax::CLASS_DECLARATION | syntax::CLASS_EXPRESSION) => {
                    return Some(Written::InAClass);
                }
                _ => {}
            }
            at = self.node(node).parent;
        }
        None
    }

    /// The first optional property a type declares, where it has one.
    fn optional_property_of(&self, ty: TypeId) -> Option<String> {
        let record = self.snapshot.types.get(ty.0 as usize)?;
        let TypeKind::Object { properties } = &record.kind else {
            return None;
        };
        properties
            .iter()
            .find(|property| property.optional)
            .map(|property| property.name.to_string())
    }

    /// `Object.is(a, b)` — `SameValue`, which is `===` with two corrections.
    ///
    /// `===` says `NaN !== NaN` and `0 === -0`; `SameValue` says the opposite of
    /// both. Everything else it agrees with, which is why this is `===` plus two
    /// tests rather than a comparison of its own.
    ///
    /// The specification's own phrasing is the implementation:
    ///
    /// ```text
    /// if (x === y) return x !== 0 || 1/x === 1/y;
    /// return x !== x && y !== y;
    /// ```
    ///
    /// `1/x === 1/y` is how the two zeroes are told apart without a sign test:
    /// `1/0` is `Infinity` and `1/-0` is `-Infinity`, and those are not equal.
    /// `x !== x` is true only of `NaN`.
    ///
    /// **Only where both sides are numbers.** A string, a boolean and a
    /// reference have neither a `NaN` nor a signed zero, so `SameValue` *is*
    /// `===` for them and the extra tests would be dead arms — and every arm
    /// here is a value rather than an expression, so they are evaluated
    /// eagerly and emitting them for a string would be emitting arithmetic on
    /// one.
    ///
    /// Both sides are coerced to a double first. An `i32` can hold neither of
    /// the two special cases, so the dance answers the same thing it would have
    /// without them — and narrowing decides the width afterwards, which is where
    /// that decision belongs.
    pub(super) fn decide_object_is(
        &mut self,
        id: NodeId,
        left: NodeId,
        right: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let a = self.lower_expression(left)?;
        let b = self.lower_expression(right)?;
        let origin = self.origin(id);
        let numeric = |ty: &HirType| matches!(ty, HirType::Float { .. } | HirType::Int { .. });
        let (a_ty, b_ty) = (&self.values[a.0 as usize].ty, &self.values[b.0 as usize].ty);
        if numeric(a_ty) && numeric(b_ty) {
            let a = self.coerce(a, &HirType::NUMBER, left)?;
            let b = self.coerce(b, &HirType::NUMBER, right)?;
            return self.object_is_numbers(id, a, b);
        }
        // A concrete non-number cannot contribute either exceptional case.
        // An erased value can, but its annotation proves neither its tag nor
        // the safety of reading a number payload.
        if !matches!(a_ty, HirType::Erased) && !numeric(a_ty)
            || !matches!(b_ty, HirType::Erased) && !numeric(b_ty)
        {
            return Ok(self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs: a,
                    rhs: b,
                },
                HirType::Bool,
                origin,
            ));
        }
        let a = self.coerce(a, &HirType::Erased, left)?;
        let b = self.coerce(b, &HirType::Erased, right)?;
        let check_b = self.new_block();
        let numbers = self.new_block();
        let ordinary = self.new_block();
        let merge = self.new_block();
        let answer = self.push_block_param(merge, HirType::Bool, origin.clone());
        let unsigned = HirType::Int {
            bits: 32,
            signed: false,
        };
        let number = self.push(
            OpKind::ConstInt(i128::from(crate::hir::tags::NUMBER)),
            unsigned.clone(),
            origin.clone(),
        );
        for (value, yes) in [(a, check_b), (b, numbers)] {
            let tag = self.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
            let is_number = self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs: tag,
                    rhs: number,
                },
                HirType::Bool,
                origin.clone(),
            );
            self.terminate(Terminator::Branch {
                cond: is_number,
                then_target: yes,
                then_args: Vec::new(),
                else_target: ordinary,
                else_args: Vec::new(),
            });
            self.switch_to(yes);
        }
        // Both tag tests dominate the payload reads, on every backend.
        let a_number = self.push(OpKind::unerase(a), HirType::NUMBER, origin.clone());
        let b_number = self.push(OpKind::unerase(b), HirType::NUMBER, origin.clone());
        let same_number = self.object_is_numbers(id, a_number, b_number)?;
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![same_number],
        });
        self.switch_to(ordinary);
        let equal = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: a,
                rhs: b,
            },
            HirType::Bool,
            origin,
        );
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![equal],
        });
        self.switch_to(merge);
        Ok(answer)
    }

    /// The numeric `SameValue` kernel, after static conversion or actual tag
    /// guards have supplied two doubles. No conversion of another JS type.
    fn object_is_numbers(
        &mut self,
        id: NodeId,
        a: ValueId,
        b: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let mut binary = |op, lhs, rhs, ty: HirType, origin: &Origin| {
            self.push(OpKind::Binary { op, lhs, rhs }, ty, origin.clone())
        };
        let equal = binary(BinOp::Eq, a, b, HirType::Bool, &origin);
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        // `x !== 0`, which is the cheap answer for every number but the zeroes.
        let nonzero = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: a,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        // `1/x === 1/y`, which separates `+0` from `-0` by their infinities.
        let over_a = self.push(
            OpKind::Binary {
                op: BinOp::Div,
                lhs: one,
                rhs: a,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let over_b = self.push(
            OpKind::Binary {
                op: BinOp::Div,
                lhs: one,
                rhs: b,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let same_sign = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: over_a,
                rhs: over_b,
            },
            HirType::Bool,
            origin.clone(),
        );
        let yes = self.push(OpKind::ConstBool(true), HirType::Bool, origin.clone());
        let no = self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone());
        let when_equal =
            self.lower_branching_value(id, nonzero, Branch::Value(yes), Branch::Value(same_sign))?;
        // `x !== x`, true of `NaN` and nothing else.
        let a_nan = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: a,
                rhs: a,
            },
            HirType::Bool,
            origin.clone(),
        );
        let b_nan = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: b,
                rhs: b,
            },
            HirType::Bool,
            origin,
        );
        let both_nan =
            self.lower_branching_value(id, a_nan, Branch::Value(b_nan), Branch::Value(no))?;
        self.lower_branching_value(
            id,
            equal,
            Branch::Value(when_equal),
            Branch::Value(both_nan),
        )
    }

    /// `Object.keys(o)`, as the array of names the layout already holds.
    ///
    /// Insertion order is declaration order, which is what a layout is: fields
    /// are laid out base-first and in the order the class declares them, and
    /// that is the order `Object.keys` is specified to produce for string keys
    /// that are not array indices.
    pub(super) fn decide_object_keys(
        &mut self,
        id: NodeId,
        argument: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        // Lowered for its effects even though the answer does not depend on it:
        // `Object.keys(f())` calls `f`.
        let table = self.lower_expression(argument)?;
        if matches!(
            self.values[table.0 as usize].ty,
            HirType::Managed(ManagedType::Table(_, _))
        ) {
            // A table's keys are what is in it, so this is a walk rather than
            // the layout's field names. Insertion order, which is what
            // `Object.keys` is specified to give for string keys that are not
            // array indices -- and for a struct that order is the layout's,
            // which is why the two paths agree about what they answer while
            // computing it completely differently.
            let origin = self.origin(id);
            return Ok(self.push(
                OpKind::Call {
                    callee: Callee::External("nts_map_keys_str".to_owned()),
                    args: vec![table],
                    frame: None,
                },
                HirType::Managed(ManagedType::Array(Box::new(HirType::Managed(
                    ManagedType::String,
                )))),
                origin,
            ));
        }
        let names = self.own_names(id, argument)?;
        let origin = self.origin(id);
        let element = HirType::Managed(ManagedType::String);
        let ty = HirType::Managed(ManagedType::Array(Box::new(element.clone())));
        #[allow(clippy::cast_precision_loss)]
        let count = names.len() as f64;
        let length = self.push(OpKind::ConstFloat(count), HirType::NUMBER, origin.clone());
        let array = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            ty.clone(),
            origin.clone(),
        );
        for (at, name) in names.into_iter().enumerate() {
            #[allow(clippy::cast_precision_loss)]
            let position = at as f64;
            let index = self.push(
                OpKind::ConstFloat(position),
                HirType::NUMBER,
                origin.clone(),
            );
            let value = self.push(
                OpKind::ConstString(name.into()),
                element.clone(),
                origin.clone(),
            );
            self.push(
                OpKind::ArraySet {
                    array,
                    index,
                    value,
                    checked: false,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(array)
    }

    /// `Object.assign(target, ...sources)`, where all of them are dictionaries.
    ///
    /// A table's entries are not known at compile time, so this is the runtime's
    /// loop rather than a sequence of stores -- unlike `Object.keys`, whose
    /// answer for a *struct* is a static list of names. `nts_map_extend` is that
    /// loop, and it is `nts_map_copy`'s against a table that already exists,
    /// which is the whole difference between a spread and an assign.
    ///
    /// **The target, answered back**, because that is what the expression
    /// evaluates to: `const merged = Object.assign(target, source)` and the
    /// statement form are the same call.
    ///
    /// **One call per source, left to right.** That order is what makes a later
    /// source win, and the count is read off the argument list -- so three named
    /// tables are three calls rather than a loop. The only variable-arity form
    /// is a spread, and a spread has no argument list to read; it arrives here
    /// as a single source whose type is not a table and is refused as one.
    ///
    /// Every source is lowered **before** the first merge, because a call
    /// evaluates all of its arguments before it runs and a source can be a call
    /// of its own. Merging as we lowered would run the second source's side
    /// effects after the first source's entries had already landed.
    ///
    /// A dictionary target keeps this runtime merge. A structured target uses
    /// [`Self::assign_to_fields`]: source keys select checked stores into its
    /// fixed slots, and an unrepresentable key declines instead of disappearing.
    /// `Object.create(null)`: an empty dictionary.
    ///
    /// **Only the `null` prototype.** Any other argument is a real prototype
    /// object, which a fixed layout has nowhere to put, and that keeps the
    /// refusal `refusal_for_a_global_member` already writes -- whose own text
    /// promised this one ("is a dictionary and is a different, buildable
    /// thing"). A promise in a diagnostic is a claim with an expiry date like
    /// any other; this is it being kept rather than removed.
    ///
    /// **The type comes from the context, and it has to.** `Object.create` is
    /// declared to return `any`, so the call's own type is erased and an empty
    /// table built at it would refuse on the first `r.x = "1"`. What a reader
    /// writes is `Object.create(null) as Record<string, string>` or
    /// `const r: Record<string, string[]> = Object.create(null)`, and
    /// `contextual_type` already answers for both -- it walks an
    /// `AS_EXPRESSION` and a `VARIABLE_DECLARATION`. Where there is no such
    /// context there is no dictionary type to build at, and the refusal stands.
    ///
    /// Node publishes null-prototype objects (`X509Certificate`'s
    /// `toLegacyObject`, `translatePeerCertificate`), and the node-port lane
    /// reports that a plain `{}` fails `deepStrictEqual` against them -- so
    /// before this there was no spelling correct on both lanes.
    pub(super) fn decide_object_create(
        &mut self,
        id: NodeId,
        prototype: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        if self.kind_of(prototype) != Some(syntax::NULL_KEYWORD) {
            return Err(self.unsupported(
                id,
                "`Object.create` of a prototype object, which a fixed layout has nowhere to put -- \
                 only `Object.create(null)`, a dictionary, is buildable here",
            ));
        }
        // The call's own type first, for a declaration that gives it one
        // directly, then the context. Both, because neither alone covers the
        // two spellings the corpus writes.
        let wanted = self
            .type_of(id)
            .filter(|ty| matches!(ty, HirType::Managed(ManagedType::Table(_, _))))
            .or_else(|| self.contextual_type(id, 0));
        let Some(ty @ HirType::Managed(ManagedType::Table(_, _))) = wanted else {
            return Err(self.unsupported(
                id,
                "`Object.create(null)` where nothing says what dictionary it is -- \
                 `Object.create` answers `any`, so the type has to come from an annotation \
                 or a cast, as in `Object.create(null) as Record<string, string>`",
            ));
        };
        let HirType::Managed(ManagedType::Table(key, _)) = &ty else {
            unreachable!()
        };
        let origin = self.origin(id);
        let kind = self.push(
            OpKind::ConstFloat(f64::from(crate::hir::tables::key_kind(key))),
            HirType::NUMBER,
            origin.clone(),
        );
        Ok(self.push(
            OpKind::Call {
                callee: Callee::External("nts_table_new".to_owned()),
                args: vec![kind],
                frame: None,
            },
            ty.clone(),
            origin,
        ))
    }

    pub(super) fn decide_object_assign(
        &mut self,
        id: NodeId,
        target: NodeId,
        sources: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if sources.is_empty() {
            // `Object.assign(x)` is `ToObject(x)`: for a primitive it answers a
            // wrapper object, and for anything else it answers the argument
            // unchanged. Neither is a merge, and the first is a boxing this
            // representation does not have, so it is named rather than treated
            // as the identity.
            return Err(self.unsupported(
                id,
                "`Object.assign` with no source, which converts its argument to an object rather \
                 than merging anything into it",
            ));
        }
        let target_node = target;
        let target = self.lower_expression(target)?;
        let ty = self.values[target.0 as usize].ty.clone();
        let dictionary = matches!(ty, HirType::Managed(ManagedType::Table(_, _)));
        let mut lowered = Vec::with_capacity(sources.len());
        for source in sources {
            let value = self.lower_expression(*source)?;
            if dictionary
                && !matches!(
                    self.values[value.0 as usize].ty,
                    HirType::Managed(ManagedType::Table(_, _))
                )
            {
                return Err(self.unsupported(
                    *source,
                    "`Object.assign` from something other than a dictionary",
                ));
            }
            lowered.push((*source, value));
        }
        if !dictionary {
            return self.assign_to_fields(id, target_node, target, &lowered);
        }
        let origin = self.origin(id);
        let mut into = target;
        for (_, value) in lowered {
            // The call's own result is the next call's target. It is the same
            // pointer either way -- `nts_map_extend` answers the table it wrote
            // into -- but threading it makes the order a data dependency rather
            // than a fact about the order these were pushed in.
            into = self.call_runtime("nts_map_extend", vec![into, value], ty.clone(), &origin);
        }
        Ok(into)
    }
}

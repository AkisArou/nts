//! Select tuple layouts and lower tuple construction and reads.

use super::{
    ArrayFill, Diagnostic, Field, FuncBuilder, HirType, Layout, LiteralValue, ManagedType, NodeId,
    OpKind, Representation, SemanticSnapshot, TypeId, TypeKind, ValueId, in_a_slot,
    representation_within, uninhabited_array,
};

pub(super) fn tuple_representation(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    elements: &[TypeId],
    path: &mut Vec<TypeId>,
    subst: &Representation<'_>,
) -> Option<HirType> {
    let mut shared: Option<HirType> = None;
    let mut mixed = false;
    for element in elements {
        // **`slot_for` deliberately not used here**, and the control that says
        // so is `[string | null, number]`. Giving `[null, number]` a
        // representation of its own means the literal `[null, 5]` builds *that*
        // layout and then needs a pointer cast to the annotated tuple's -- two
        // anonymous structs that do not agree about where their shared fields
        // are. It agreed with node before and refused after, which is the hazard
        // `array_literal_type` already records one container over: a literal's
        // own type wins over the slot's and should not.
        //
        // An array's element has no such pair, because an array of one
        // representation is one layout. The tuple position stays with
        // `in_a_slot` until the literal is taught to prefer the slot.
        let element = in_a_slot(representation_within(snapshot, *element, path, subst)?);
        match &shared {
            Some(existing) if *existing != element => mixed = true,
            _ => shared = Some(element),
        }
    }
    if mixed {
        // Elements that disagree but are **all references** are an array of
        // erased values. It was an array of the *first* element's type, on the
        // reading that a pointer-sized slot holds either -- true of C's bytes
        // and of the JVM's `Object[]`, and a lie in the type all the same:
        // `[string, Point]` claimed to hold strings and held a `Point`, which a
        // read converted back. Wasm types an array's element, so it could
        // neither store nor read one, and every pass trusting an element type
        // trusted that claim. A C binding that built such an array
        // (`nts_os_cpus`) was the reason; it no longer exists.
        //
        // An array rather than a struct, because a tuple's length may vary: a
        // pattern's defaults make its elements optional (`[a = f, b = g] =
        // []`), and a struct has a slot for every one. Erased is the type that
        // holds any reference truthfully, and a read unerases to its slot's.
        //
        // Mixed *storage* is the struct: `[string, number]` is a pointer beside
        // a double, and no array of one width holds both.
        if elements.iter().all(|element| {
            matches!(
                representation_within(snapshot, *element, path, subst),
                Some(HirType::Managed(_))
            )
        }) {
            return Some(HirType::Managed(ManagedType::Array(Box::new(
                HirType::Erased,
            ))));
        }
        return Some(HirType::Managed(ManagedType::Object(ty)));
    }
    if shared.is_none() {
        return Some(uninhabited_array());
    }
    Some(HirType::Managed(ManagedType::Array(Box::new(shared?))))
}

impl FuncBuilder<'_> {
    /// Element `at` of a tuple of `count` an override answers: the value
    /// itself for one, an array's element for a tuple of one type, and a
    /// field of its layout for a mixed one.
    pub(super) fn tuple_element(
        &mut self,
        id: NodeId,
        tuple: ValueId,
        ty: &HirType,
        count: usize,
        at: usize,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        if count == 1 {
            return Ok(tuple);
        }
        match ty {
            HirType::Managed(ManagedType::Array(element)) => {
                #[allow(clippy::cast_precision_loss)]
                let index = self.push(
                    OpKind::ConstFloat(at as f64),
                    HirType::NUMBER,
                    origin.clone(),
                );
                Ok(self.push(
                    OpKind::ArrayGet {
                        array: tuple,
                        index,
                        checked: false,
                    },
                    (**element).clone(),
                    origin,
                ))
            }
            HirType::Managed(ManagedType::Object(layout)) => {
                let layout = self.layout_of(id, *layout)?;
                let field = u32::try_from(at).unwrap_or(0);
                let element = layout
                    .fields
                    .get(at)
                    .map(|field| field.ty.clone())
                    .ok_or_else(|| {
                        self.unsupported(id, "a tuple shorter than the out parameters it answers")
                    })?;
                Ok(self.push(
                    OpKind::FieldGet {
                        object: tuple,
                        field,
                    },
                    element,
                    origin,
                ))
            }
            _ => Err(self.unsupported(
                id,
                "a virtual function answering its out parameters as something other than a tuple",
            )),
        }
    }

    /// The tuple `ty` made of `values` in order -- one value itself, an
    /// array for a tuple of one type, the tuple's layout otherwise -- each
    /// at its position's type.
    pub(super) fn make_tuple(
        &mut self,
        id: NodeId,
        ty: TypeId,
        values: Vec<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let represented = self
            .represent(ty)
            .ok_or_else(|| self.unrepresentable(id, "a virtual function's answer"))?;
        if let [value] = values.as_slice() {
            return self.coerce(*value, &represented, id);
        }
        match represented.clone() {
            HirType::Managed(ManagedType::Array(element)) => {
                #[allow(clippy::cast_precision_loss)]
                let length = self.push(
                    OpKind::ConstFloat(values.len() as f64),
                    HirType::NUMBER,
                    origin.clone(),
                );
                let array = self.push(
                    OpKind::ArrayNew {
                        length,
                        // Filled: a tuple literal: every element is stored before the tuple is bound to anything.
                        fill: ArrayFill::Filled,
                    },
                    represented,
                    origin.clone(),
                );
                for (at, value) in values.into_iter().enumerate() {
                    let value = self.coerce(value, &element, id)?;
                    #[allow(clippy::cast_precision_loss)]
                    let index = self.push(
                        OpKind::ConstFloat(at as f64),
                        HirType::NUMBER,
                        origin.clone(),
                    );
                    self.push(
                        OpKind::ArraySet {
                            array,
                            index,
                            value,
                            checked: true,
                        },
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Ok(array)
            }
            HirType::Managed(ManagedType::Object(layout_ty)) => {
                let layout = self.layout_of(id, layout_ty)?;
                let object = self.push(
                    OpKind::ObjectNew { frame: false },
                    represented,
                    origin.clone(),
                );
                for (at, value) in values.into_iter().enumerate() {
                    let want = layout
                        .fields
                        .get(at)
                        .map(|field| field.ty.clone())
                        .ok_or_else(|| {
                            self.unsupported(id, "a tuple shorter than the values made for it")
                        })?;
                    let value = self.coerce(value, &want, id)?;
                    self.field_set(object, u32::try_from(at).unwrap_or(0), value, &origin);
                }
                Ok(object)
            }
            _ => Err(self.unsupported(
                id,
                "a virtual function answering its out parameters as something other than a tuple",
            )),
        }
    }

    /// `[a, b]` where the slot is a tuple.
    ///
    /// One allocation and one store per slot, which is what building an object
    /// of that shape is. The element count has to match exactly: a tuple's
    /// length is part of its type, so a literal that is short or long is not
    /// the same tuple and saying so beats writing whatever fits.
    pub(super) fn lower_tuple_literal(
        &mut self,
        id: NodeId,
        type_id: TypeId,
        ty: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let layout = self.layout_of(id, type_id)?;
        let elements = self.children(id);
        if elements.len() != layout.fields.len() {
            return Err(self.unsupported(
                id,
                &format!(
                    "a tuple literal of {} element(s) where the type has {}",
                    elements.len(),
                    layout.fields.len()
                ),
            ));
        }
        let origin = self.origin(id);
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            ty.clone(),
            origin.clone(),
        );
        for (at, element) in elements.into_iter().enumerate() {
            let want = layout.fields[at].ty.clone();
            // At the position's type, not the tuple's: `[null, 0]` lowered
            // `null` expecting the whole tuple, typed it as the tuple's own
            // object, and erased it as an object-tagged NULL -- a value
            // `!== null` answered true for, so a loop waiting for it ran on.
            let value = self.lower_expecting(element, &want)?;
            self.oblige_returned_element(id, at, value, element);
            let stored = self.coerce(value, &want, element)?;
            let field = u32::try_from(at).unwrap_or(0);
            self.field_set(object, field, stored, &origin);
        }
        Ok(object)
    }

    /// Whether a type is a tuple, asked of the snapshot rather than of a name.
    ///
    /// The first version tested `layout.name.starts_with("Tuple")`, which is a
    /// string standing in for a fact the snapshot already holds -- and which a
    /// class the program happened to call `TupleRow` would have answered yes
    /// to.
    pub(super) fn is_tuple(&self, ty: TypeId) -> bool {
        matches!(
            self.snapshot
                .types
                .get(ty.0 as usize)
                .map(|record| &record.kind),
            Some(TypeKind::Tuple(_))
        )
    }

    /// The layout of a heterogeneous tuple: one field per position.
    ///
    /// `[string, number]` *is* a two-field struct, and saying so gives it the
    /// layout machinery, field access, escape analysis and reference counting
    /// rather than a second mechanism that would need all four again. A tuple
    /// whose elements agree never reaches here -- `representation_of` makes it
    /// an array, which is the older and better answer for that case.
    pub(super) fn tuple_layout(
        &mut self,
        id: NodeId,
        ty: TypeId,
        elements: &[TypeId],
    ) -> Result<Layout, Diagnostic> {
        let mut fields = Vec::with_capacity(elements.len());
        for (at, element) in elements.iter().enumerate() {
            // A slot, so `undefined` and `never` take storage. See the note
            // in `fields_of`: `NtsObj_Tuple249 { NtsValue _0_; void _1_; }` is
            // what a half-`undefined` tuple emitted, and clang rejects it.
            let field = match self.represent(*element) {
                Some(HirType::Void | HirType::Never) => HirType::Erased,
                Some(held) => held,
                None => return Err(self.unrepresentable(id, &format!("element {at} of a tuple"))),
            };
            // An element of object type needs that object's *layout*, not only
            // its representation: the tuple's struct has to name a member of
            // it. Asked for here, where the failure is still this tuple's, so
            // it is refused rather than emitted as a struct whose member the
            // backend cannot spell.
            //
            // The emitter drops a field it cannot type, silently, and the
            // descriptor beside it keeps the `offsetof` -- so without this the
            // corpus gained a file whose `struct { NtsHeader header; }` sat
            // next to a descriptor naming a member it did not have. That
            // silent drop is its own bug and its own commit.
            if let HirType::Managed(ManagedType::Object(inner)) = &field
                && *inner != ty
            {
                self.layout_of(id, *inner)?;
            }
            fields.push(Field {
                // `_0`, not `0`: the name reaches C as a struct member and
                // `v->1` is not C. Every lookup is by position anyway -- a
                // tuple has no names of its own -- so the spelling is free to
                // be whatever the backend can pronounce.
                name: format!("_{at}").into(),
                ty: field,
                // Writable: `const pair: [number, number] = [1, 2]; pair[0] = 5`
                // is legal TypeScript, and only `readonly [number, number]` is
                // not. Marking these `readonly` refused a program the checker
                // accepts.
                readonly: false,
                declared_by: None,
                // A tuple's element types are written by whoever wrote the
                // tuple type, an annotation or a binding's (S3).
                written: self.written_scalar(*element),
            });
        }
        let layout = Layout {
            types: vec![ty],
            name: format!("Tuple{}", ty.0),
            interfaces: Vec::new(),
            fields,
            methods: Vec::new(),
            // A tuple has no declaration to extend.
            base: None,
        };
        self.layouts.push(layout.clone());
        Ok(layout)
    }

    /// What every arm of a tuple union declares at the index this access reads.
    pub(super) fn tuple_position_representation(&self, id: NodeId) -> Option<HirType> {
        let [object, index] = self.children(id)[..] else {
            return None;
        };
        // A constant index, so the position is known. `given[i]` is not this.
        let TypeKind::Literal(LiteralValue::Number(written)) = &self
            .snapshot
            .types
            .get(self.snapshot.node_types.get(&index)?.0 as usize)?
            .kind
        else {
            return None;
        };
        // A tuple position is a small whole number and nothing else is one, so
        // the guard is what makes the conversion exact rather than the cast.
        if !written.is_finite() || *written < 0.0 || written.fract() != 0.0 {
            return None;
        }
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let at = *written as usize;
        let declared = *self.snapshot.node_types.get(&object)?;
        let record = self.snapshot.types.get(declared.0 as usize)?;
        // The checker narrows the union away once a length test has run, so a
        // single tuple arrives here as often as the union does.
        let arms: Vec<TypeId> = match &record.kind {
            TypeKind::Union(arms) => arms.clone(),
            TypeKind::Tuple(_) => vec![declared],
            _ => return None,
        };
        let mut found: Option<HirType> = None;
        for arm in arms {
            let TypeKind::Tuple(positions) = &self.snapshot.types.get(arm.0 as usize)?.kind else {
                return None;
            };
            let positions = &positions.elements;
            let Some(position) = positions.get(at) else {
                continue;
            };
            let represented = self.represent(*position)?;
            match &found {
                None => found = Some(represented),
                Some(seen) if *seen == represented => {}
                Some(_) => return None,
            }
        }
        found
    }

    /// Whether this element access reads a **tuple**, which is the only
    /// receiver whose slots disagree about type.
    ///
    /// The guard is the receiver rather than the access's own type, and the
    /// first version had it the other way round. Under
    /// `noUncheckedIndexedAccess` an ordinary `people[i]` is typed
    /// `Person | undefined`, whose representation is an object type with no
    /// layout -- so converting to it refused `tests/programs/objects` with
    /// `NTS2006 an object type with no layout`, and the test that catches that
    /// must execute even when no external checker is installed.
    ///
    /// A tuple's index is in bounds by construction, so its access type is the
    /// declared element type and nothing widens it.
    pub(super) fn reads_a_tuple(&self, id: NodeId) -> bool {
        let Some(receiver) = self.children(id).first().copied() else {
            return false;
        };
        let Some(ty) = self.snapshot.node_types.get(&receiver) else {
            return false;
        };
        self.snapshot
            .types
            .get(ty.0 as usize)
            .is_some_and(|record| matches!(record.kind, TypeKind::Tuple(_)))
    }
}

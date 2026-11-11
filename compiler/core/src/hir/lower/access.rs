//! Null receiver checks belong to the access, after its operands have run.
//!
//! Assertions along the receiver's transparent chain defer only presence to
//! this check. Other assertions keep establishing their native representation.

use super::{
    Absent, FieldArm, TypeId, TypeKind, access, class_symbol, closure_index, generic_values,
    is_static_member_symbol, named_constant, same_slot, uniform_inputs,
};
use super::{
    BinOp, BlockId, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, Place,
    Terminator, ValueId, syntax,
};
use crate::hir::tags;

#[derive(Debug)]
pub(super) struct Pending {
    node: NodeId,
    raw: Option<(NodeId, ValueId)>,
}

#[derive(Debug, Clone)]
pub(super) struct Guard {
    absent: ValueId,
    null: ValueId,
}

#[derive(Debug, Clone)]
pub(super) enum Key {
    Name(String),
    Index(ValueId, NodeId),
}

/// The index expression is already captured by the read/place lowering. Its
/// source node carries which absence a nullable string key's pointer means.
pub(super) fn index_key(probe: &FuncBuilder<'_>, access: NodeId, value: ValueId) -> Key {
    // element_access_parts/lower_string_index established the two-child shape.
    Key::Index(value, probe.children(access)[1])
}

/// A member's physical name is not necessarily its JavaScript property key.
/// Symbol fields use the checker's identity for lookup, but diagnostics read
/// the actual symbol, whose description may differ from the variable's name.
pub(super) fn named_key(
    builder: &mut FuncBuilder<'_>,
    access: NodeId,
    member: NodeId,
    name: String,
) -> Result<Key, Diagnostic> {
    if builder.kind_of(access) == Some(syntax::ELEMENT_ACCESS_EXPRESSION)
        && builder.type_of(member) == Some(HirType::Managed(ManagedType::Symbol))
    {
        return Ok(Key::Index(builder.lower_expression(member)?, member));
    }
    Ok(Key::Name(name))
}

fn transparent(probe: &FuncBuilder<'_>, node: NodeId) -> bool {
    matches!(
        probe.kind_of(node),
        Some(
            syntax::PARENTHESIZED_EXPRESSION
                | syntax::NON_NULL_EXPRESSION
                | syntax::AS_EXPRESSION
                | syntax::SATISFIES_EXPRESSION
        )
    )
}

fn source(probe: &FuncBuilder<'_>, mut node: NodeId) -> NodeId {
    while transparent(probe, node) {
        let Some(inner) = probe.children(node).first().copied() else {
            break;
        };
        node = inner;
    }
    node
}

fn nullable(probe: &FuncBuilder<'_>, receiver: NodeId) -> bool {
    let receiver = source(probe, receiver);
    if probe
        .read_type(receiver)
        .is_some_and(|ty| probe.hierarchy.cast_faces.contains(&ty))
    {
        return true;
    }
    (probe.type_of(receiver) == Some(HirType::Erased)
        && probe.read_type(receiver).is_none_or(|ty| {
            probe
                .snapshot
                .types
                .get(ty.0 as usize)
                .is_none_or(|record| {
                    matches!(
                        record.kind,
                        super::TypeKind::Any
                            | super::TypeKind::Unknown
                            | super::TypeKind::Evolving
                            | super::TypeKind::TypeParameter { .. }
                    )
                })
        }))
        || probe
            .absences_of(receiver)
            .is_some_and(|absent| !absent.is_empty())
}

/// The same licence for lowering and the walk that selects raising entries.
/// A non-null receiver costs no check. An optional link already handles absence.
pub(super) fn can_throw(probe: &FuncBuilder<'_>, access: NodeId) -> bool {
    if !matches!(
        probe.kind_of(access),
        Some(syntax::PROPERTY_ACCESS_EXPRESSION | syntax::ELEMENT_ACCESS_EXPRESSION)
    ) {
        return false;
    }
    let children = probe.children(access);
    children.len() == 2 && nullable(probe, children[0])
}

/// Save the pre-assertion value, including its erased absence tag. The node
/// check prevents a nested call argument's assertion inheriting this context.
pub(super) fn defer_presence(builder: &mut FuncBuilder<'_>, node: NodeId, value: ValueId) -> bool {
    let Some(pending) = &builder.access_receiver else {
        return false;
    };
    if source(builder, pending.node) != source(builder, node)
        || matches!(
            builder.values[value.0 as usize].ty,
            HirType::NativePointer(_)
        )
    {
        return false;
    }
    let node = source(builder, node);
    if let Some(pending) = &mut builder.access_receiver {
        pending.raw.get_or_insert((node, value));
    }
    true
}

pub(super) fn receiver(
    builder: &mut FuncBuilder<'_>,
    node: NodeId,
) -> Result<(ValueId, Option<Guard>), Diagnostic> {
    if !nullable(builder, node) {
        return Ok((builder.lower_expression(node)?, None));
    }
    let previous = builder.access_receiver.replace(Pending { node, raw: None });
    let value = builder.lower_expression(node);
    let pending = std::mem::replace(&mut builder.access_receiver, previous);
    let value = value?;
    let (at, raw) = pending
        .and_then(|pending| pending.raw)
        .unwrap_or((source(builder, node), value));
    let Some(absent) = builder.absence_of(at, raw) else {
        return Ok((value, None));
    };
    let origin = builder.origin(node);
    let null = if builder.values[raw.0 as usize].ty == HirType::Erased {
        let ty = HirType::Int {
            bits: 32,
            signed: false,
        };
        let tag = builder.push(OpKind::TagOf { value: raw }, ty.clone(), origin.clone());
        let null = builder.push(OpKind::ConstInt(i128::from(tags::NULL)), ty, origin.clone());
        builder.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: tag,
                rhs: null,
            },
            HirType::Bool,
            origin,
        )
    } else {
        let null = builder
            .absences_of(at)
            .is_some_and(|absent| absent.contains(&tags::NULL));
        builder.push(OpKind::ConstBool(null), HirType::Bool, origin)
    };
    Ok((value, Some(Guard { absent, null })))
}

pub(super) fn protect(place: Place, guard: Option<Guard>, key: Key) -> Place {
    match guard {
        Some(guard) => Place::Checked {
            place: Box::new(place),
            guard,
            key,
        },
        None => place,
    }
}

/// Computed record membership never treats a null table as an empty object.
/// The absent branch needs its own `TypeError` protocol in a later slice.
pub(super) fn require_record_membership(builder: &mut FuncBuilder<'_>, at: NodeId, guard: &Guard) {
    let rejected = builder.new_block();
    let accepted = builder.new_block();
    builder.terminate(Terminator::Branch {
        cond: guard.absent,
        then_target: rejected,
        then_args: Vec::new(),
        else_target: accepted,
        else_args: Vec::new(),
    });
    builder.switch_to(rejected);
    let origin = builder.origin(at);
    let message = builder.push(
        OpKind::ConstString(
            "property membership on an absent record, whose TypeError this compiler does not yet lower".to_owned().into(),
        ),
        HirType::Managed(ManagedType::String),
        origin.clone(),
    );
    builder.runtime_call("nts_refused", vec![message], HirType::Void, origin);
    builder.terminate(Terminator::Unreachable);
    builder.switch_to(accepted);
}

/// Deletion converts the receiver to an object but does not read a property.
/// Its absent-receiver diagnostic neither describes nor coerces the key.
pub(super) fn require_delete(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    guard: &Guard,
) -> Result<(), Diagnostic> {
    let rejected = builder.new_block();
    let accepted = builder.new_block();
    builder.terminate(Terminator::Branch {
        cond: guard.absent,
        then_target: rejected,
        then_args: Vec::new(),
        else_target: accepted,
        else_args: Vec::new(),
    });
    builder.switch_to(rejected);
    let origin = builder.origin(at);
    let message = builder.push(
        OpKind::ConstString("Cannot convert undefined or null to object".into()),
        HirType::Managed(ManagedType::String),
        origin,
    );
    builder.throw_provided_error_text(at, "TypeError", message)?;
    builder.switch_to(accepted);
    Ok(())
}

pub(super) fn require(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    guard: &Guard,
    key: &Key,
    write: bool,
) -> Result<(), Diagnostic> {
    let rejected = builder.new_block();
    let accepted = builder.new_block();
    builder.terminate(Terminator::Branch {
        cond: guard.absent,
        then_target: rejected,
        then_args: Vec::new(),
        else_target: accepted,
        else_args: Vec::new(),
    });
    builder.switch_to(rejected);
    let null = builder.new_block();
    let undefined = builder.new_block();
    builder.terminate(Terminator::Branch {
        cond: guard.null,
        then_target: null,
        then_args: Vec::new(),
        else_target: undefined,
        else_args: Vec::new(),
    });
    throw(builder, at, key, write, null, "null")?;
    throw(builder, at, key, write, undefined, "undefined")?;
    builder.switch_to(accepted);
    Ok(())
}

fn throw(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    key: &Key,
    write: bool,
    block: BlockId,
    receiver: &str,
) -> Result<(), Diagnostic> {
    builder.switch_to(block);
    let action = if write { "set" } else { "read" };
    let participle = if write { "setting" } else { "reading" };
    let message = format!("Cannot {action} properties of {receiver}");
    let origin = builder.origin(at);
    let text = HirType::Managed(ManagedType::String);
    match key {
        Key::Name(name) => {
            let message = builder.push(
                OpKind::ConstString(format!("{message} ({participle} '{name}')").into()),
                text,
                origin,
            );
            builder.throw_provided_error_text(at, "TypeError", message)
        }
        Key::Index(index, from) => throw_index(builder, at, *from, *index, &message, participle),
    }
}

/// Definitely-object keys cannot be described with the metadata we hold.
/// Any/unknown and mixed unions remain dynamic: rejecting those would reject
/// ordinary unchecked JavaScript whose key turns out to be a primitive.
fn definitely_object(builder: &FuncBuilder<'_>, at: NodeId) -> bool {
    fn object(snapshot: &super::SemanticSnapshot, ty: super::TypeId, depth: u8) -> bool {
        if depth == 0 {
            return false;
        }
        match snapshot.types.get(ty.0 as usize).map(|ty| &ty.kind) {
            Some(
                super::TypeKind::Object { .. }
                | super::TypeKind::Array(_)
                | super::TypeKind::Tuple(_)
                | super::TypeKind::Function(_),
            ) => true,
            Some(super::TypeKind::Union(members) | super::TypeKind::Intersection(members)) => {
                !members.is_empty() && members.iter().all(|ty| object(snapshot, *ty, depth - 1))
            }
            _ => false,
        }
    }
    builder
        .read_type(at)
        .is_some_and(|ty| object(builder.snapshot, ty, 64))
}

fn throw_index(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    from: NodeId,
    index: ValueId,
    message: &str,
    participle: &str,
) -> Result<(), Diagnostic> {
    if definitely_object(builder, from) {
        return Err(builder.unsupported(at, "a property access on a possibly-null receiver with an object-typed key: node's message would describe the key by its constructor, which this compiler does not record"));
    }
    let origin = builder.origin(at);
    let text = HirType::Managed(ManagedType::String);
    // Preserve a nullable primitive key's source absence when giving it a tag.
    let key = builder.coerce(index, &HirType::Erased, from)?;
    let key = builder.runtime_call(
        "nts_access_key_description",
        vec![key],
        text.clone(),
        origin.clone(),
    );
    let null = builder.push(OpKind::ConstNull, text.clone(), origin.clone());
    let omitted = builder.push(
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: key,
            rhs: null,
        },
        HirType::Bool,
        origin.clone(),
    );
    let without_key = builder.new_block();
    let with_key = builder.new_block();
    builder.terminate(Terminator::Branch {
        cond: omitted,
        then_target: without_key,
        then_args: Vec::new(),
        else_target: with_key,
        else_args: Vec::new(),
    });
    builder.switch_to(without_key);
    // A dynamic object key is never coerced for an error message. V8 can add
    // '#<Constructor>' for some objects or a function's source text; without
    // that metadata we omit it.
    // This text divergence is recorded, while the TypeError stays catchable.
    let plain = builder.push(
        OpKind::ConstString(message.to_owned().into()),
        text.clone(),
        origin.clone(),
    );
    builder.throw_provided_error_text(at, "TypeError", plain)?;
    builder.switch_to(with_key);
    let prefix = builder.push(
        OpKind::ConstString(format!("{message} ({participle} '").into()),
        text.clone(),
        origin.clone(),
    );
    let message = builder.push(
        OpKind::Binary {
            op: BinOp::Concat,
            lhs: prefix,
            rhs: key,
        },
        text.clone(),
        origin.clone(),
    );
    let suffix = builder.push(
        OpKind::ConstString("')".into()),
        text.clone(),
        origin.clone(),
    );
    let message = builder.push(
        OpKind::Binary {
            op: BinOp::Concat,
            lhs: message,
            rhs: suffix,
        },
        text,
        origin,
    );
    builder.throw_provided_error_text(at, "TypeError", message)
}

impl FuncBuilder<'_> {
    #[expect(
        clippy::too_many_lines,
        reason = "keep semantic text and key projection beside its existing dispatch"
    )]
    pub(super) fn lower_property_access(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        self.check_class_binding(id)?;
        if let Some(value) = self.foreign_property_read(id)? {
            return Ok(value);
        }
        self.check_native_brand_read(id)?;
        // `Colour.Red` is a constant, and the checker has already worked out
        // which one: it gives the access a *literal* type carrying the value.
        // So there is nothing to look up at run time and no object to look it
        // up in -- which is why an enum was refused as "used as a value rather
        // than as a type". It is not being used as a value; the member is.
        //
        // A `const enum` is the same thing said twice. TypeScript's own erasure
        // of one is exactly this substitution, and a plain `enum` differs only
        // in also emitting a reverse-mapping object, which nothing in a
        // compiled program can reach without `Colour[n]`.
        if let Some(folded) = self.folded_enum_member(id) {
            return Ok(folded);
        }
        let children = self.children(id);
        // `a?.b`, which is three children because the `?.` is a token of its
        // own between the receiver and the name.
        if let [object, dot, member] = children.as_slice()
            && self.kind_of(*dot) == Some(syntax::QUESTION_DOT_TOKEN)
        {
            return self.lower_optional_access(id, *object, *member);
        }
        let [object, member] = children.as_slice() else {
            return Err(self.unsupported(
                id,
                &format!(
                    "a property access of {} parts rather than an object and a name",
                    children.len()
                ),
            ));
        };
        // **`super.accessor`**, which is a call and not a slot.
        //
        // `super.m()` and `super.field` were already answered -- the first by
        // `lower_super` from the call path, the second because a field is
        // storage the receiver already has. A *getter* is neither: it is a
        // method on the base, reached by name, and reading it through `super`
        // means the base's implementation rather than the override. Without
        // this the receiver was lowered as an ordinary expression, `super` has
        // no value, and the refusal was the generic `a super keyword is not
        // supported by this lowering yet` -- a sentence about the token.
        //
        // Routed through `lower_super` with the accessor's own key rather than
        // rebuilt here, so which class a `super` resolves to is decided in one
        // place: that function already walks to the base, handles a receiver
        // that is a view, and names the owner from the hierarchy.
        if let Some(read) = self.super_getter_read(id, *object, *member) {
            return read;
        }
        // **A binding's property on a handle** -- `label.label` -- which is
        // the call to the method its `@ntsGet` names.
        if let Some(read) = self.accessor_read(id, *object, *member) {
            return read;
        }

        // **A promise capability's three members.** `PromiseWithResolvers<T>` is
        // represented as the promise itself, so `.promise` is the identity and
        // the other two are only reachable as calls -- which
        // `lower_capability_call` has already taken, before the receiver was
        // lowered. Reaching here with one of those names means it was used as a
        // *value*: `const r = d.resolve`, or `queue.push(d.reject)`. That needs
        // a real closure over the promise and this says so, rather than falling
        // through to a message about a layout with no `resolve` field in it.
        if self.names_a_promise_capability(*object) {
            match self
                .node(*member)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
            {
                Some("promise") => return self.lower_expression(*object),
                Some(name @ ("resolve" | "reject")) => {
                    return Err(self.unsupported(
                        id,
                        &format!(
                            "a promise capability's `{name}` used as a value rather than called"
                        ),
                    ));
                }
                _ => {}
            }
        }

        // **A `static` field, which is storage rather than a member.**
        //
        // `EventEmitter.errorMonitor` has no object to read from: a static field
        // is one location for the program, initialized once at class definition
        // time, and `collect_static_fields` gives it a global exactly as a
        // module-scope `const` gets one. So this resolves through the *member's*
        // own symbol, which is the same lookup `lower_identifier` does, and the
        // receiver is never lowered -- which is why it stopped reporting
        // "`EventEmitter`, a class used as a value", a message about a different
        // construct entirely.
        //
        // Before the receiver, deliberately. Lowering it first is what produced
        // that message: the class name has no value here and asking for one is
        // asking the wrong question.
        // The whole case, not only the part that succeeds: a static field the
        // collector could not represent belongs to this arm too, and falling
        // through sent it back to "a class used as a value" -- a message about
        // a construct the read never wanted, which is the thing this arm exists
        // to stop saying.
        if let Some(symbol) = self.node(*member).symbol
            && is_static_member_symbol(self.snapshot, symbol)
        {
            if let Some(reason) = self.module.unsupported.get(&symbol.0) {
                return Err(self.unsupported(id, reason));
            }
            if let Some(global) = self.module.variables.get(&symbol.0).copied() {
                let origin = self.origin(id);
                let ty = self.module.types[global as usize].clone();
                let read = self.push(OpKind::GlobalGet(global), ty, origin);
                return self.narrowed(id, read);
            }
            // A `static get` is not storage and never had any. It is the one
            // member that reaches here having been lowered successfully.
            if let Some(read) = self.static_accessor_read(id, *object, *member) {
                return read;
            }
            // **A static method read rather than called**: `C.twice`. It has no
            // receiver, so it is the free-function case under another name --
            // one static instance whose `call` forwards directly, and `C.twice
            // === C.twice` as JavaScript says.
            if let Some(closure) = self.wrapping_closure(symbol, id) {
                return Ok(closure);
            }
            let name = self.literal_name(*member).unwrap_or_default();
            return Err(self.unsupported(
                id,
                &format!("`{name}`, a static field this compiler gave no storage"),
            ));
        }
        // `a?.b.c` short-circuits the *whole* chain: when `a` is absent, `.c`
        // is not evaluated either. That is a property of the chain rather than
        // of either access, so a link after an optional one is refused instead
        // of being lowered as `(a?.b).c`, which would read a member of the
        // absent value. All twenty-six optional accesses in the node profile
        // are a single link.
        if self.pending_chain(*object) {
            return self.lower_chain(id);
        }
        // `C.x` where `C` is a module: the checker resolved the member to the
        // export's own symbol, so this is a name and lowers as one -- through
        // the same alias-following path `import { x }` already takes.
        if self.denotes_a_module(*object) {
            return self.lower_identifier(*member);
        }
        // And `ns.x` where `ns` is a namespace *value* -- what `import()`
        // resolves with. The checker resolves the member to the export's own
        // symbol exactly as it does for `C.x`, so it lowers the same way; the
        // receiver is still evaluated, as any receiver is.
        if self.holds_a_namespace(*object) {
            self.lower_expression(*object)?;
            return self.lower_identifier(*member);
        }
        // **In an index position, the name is the type's value, not the node's
        // text.**
        //
        //     const key: "highWaterMark" = "highWaterMark";
        //     options[key]
        //
        // `literal_name` answers for any node carrying text, and an identifier
        // carries its own -- so this looked for a member called `key` and said
        // "`key`, which `Options` does not declare", of a type that declares
        // nothing of the sort. The checker has already given `key` the type
        // `Literal(String("highWaterMark"))`, which is one name and the right
        // one.
        //
        // Only in an index position. A *shorthand* property `{ a }` is an
        // identifier whose text **is** the name while its type is whatever `a`
        // holds -- `const a: "x" = "x"; ({ a })` is a property called `a`, not
        // one called `x` -- so consulting the type there would be the same
        // mistake pointing the other way.
        //
        // `blockers/a-key-held-in-a-variable` is the fixture, and its second
        // control is this: a *single* literal type held in a variable, which
        // refused where the literal written in source compiled. Under it sit
        // `getHighWaterMark`, `ReadableState`, `Readable` and `Writable` -- 249
        // failing test files in `stream`, 59 of them stopping at
        // `Readable is not a constructor`.
        let member_name = self
            .indexed_member_name(id, *member)
            .or_else(|| self.literal_name(*member))
            .ok_or_else(|| self.unsupported(id, "a computed property name"))?;

        // The constants `Math` and `Number` hold, taken before the object is
        // lowered because neither is a value: both are namespaces, and lowering
        // one would fail on the name rather than on the member.
        if self.kind_of(*object) == Some(syntax::IDENTIFIER)
            && let Some(namespace) = self
                .node(*object)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
            && let Some(constant) = named_constant(namespace, &member_name)
        {
            let origin = self.origin(id);
            return Ok(self.push(OpKind::ConstFloat(constant), HirType::NUMBER, origin));
        }

        let (value, guard) = access::receiver(self, *object)?;
        if let Some(guard) = guard {
            let key = access::named_key(self, id, *member, member_name.clone())?;
            access::require(self, id, &guard, &key, false)?;
        }
        self.member_of(id, value, &member_name)
    }

    /// A member of a receiver that is already lowered.
    ///
    /// Split from [`Self::lower_property_access`] so `a?.b` can read the member
    /// without lowering `a` twice: the optional form has to test the receiver
    /// *and* read through it, and once is the difference between `a?.b` and
    /// something that calls a getter on the way in and again on the way out.
    /// Why [`Self::shared_field`] declined, in the words that are true of it.
    ///
    /// **The sentence this replaces asserted a cause it never tested.** Any
    /// member read on an erased receiver was reported as a union "whose members
    /// lay their fields out differently", and `present_of`'s own doc already
    /// records that being said of a union with exactly one object in it. A
    /// probe separating the shapes found the claim false for two more: a getter
    /// every arm declares is not a field anywhere, and a method call on a union
    /// does not reach this at all -- it reports `a method call on something
    /// without methods`, which is a different census row.
    ///
    /// That matters beyond the wording. This message is the refusal census's
    /// **number one row** -- 57 distinct things across all 23 modules -- and a
    /// row that names one cause while covering four cannot be ranked, because
    /// only one of the four is something to build. `shared_field` already
    /// distinguishes them and threw the distinction away; this asks it the same
    /// questions in the same order and keeps the answer.
    pub(super) fn why_not_shared(&mut self, id: NodeId, member_name: &str) -> Option<String> {
        let object = self.children(id).first().copied()?;
        let ty = *self.snapshot.node_types.get(&object)?;
        let kind = &self.snapshot.types.get(ty.0 as usize)?.kind;
        let TypeKind::Union(members) = kind else {
            // **Three quarters of this message's instances land here**, so it
            // has to say what the receiver *is* rather than what it is not. The
            // row was ranked first in the refusal census -- 57 distinct things
            // across all 23 modules -- while naming a disagreement between
            // union arms that 97 of its 133 sites in five modules did not have,
            // because they were not unions.
            let what = match kind {
                TypeKind::Any => "`any`",
                // Not "`any`": an evolving declaration's source says no such
                // word, and quoting one sends the reader looking for it. The
                // same sentence [`describe`] gives it.
                TypeKind::Evolving => "a type the checker had not yet settled",
                TypeKind::Unknown => "`unknown`",
                TypeKind::Intersection(_) => "an intersection",
                TypeKind::TypeParameter { .. } => "an uninstantiated type parameter",
                TypeKind::Object { .. } => "an object whose layout was erased",
                TypeKind::Function(_) => "a function type",
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                TypeKind::NonPrimitive | TypeKind::UniqueSymbol => "a type with no layout",
                _ => "a type with no layout",
            };
            return Some(format!("`{member_name}` on {what}, which is erased here"));
        };
        let members = members.clone();
        if members.len() < 2 {
            return Some(format!(
                "`{member_name}` on an erased value whose type has one member"
            ));
        }
        let mut arms = Vec::with_capacity(members.len());
        for member in &members {
            let Ok(layout) = self.layout_of(id, *member) else {
                return Some(format!(
                    "`{member_name}` on a union one of whose members has no layout"
                ));
            };
            arms.push(layout);
        }
        let (first, rest) = arms.split_first()?;
        let mut shared = first.fields.len();
        for other in rest {
            shared = shared.min(other.fields.len());
            let agreed = first
                .fields
                .iter()
                .zip(other.fields.iter())
                .take(shared)
                .take_while(|(want, have)| same_slot(want, have))
                .count();
            shared = shared.min(agreed);
        }
        // Declared by every arm and stored by none of them: an accessor or a
        // method. There is no offset to read and the arms do not disagree about
        // one -- what it needs is a *call*, through the slot each arm's
        // dispatch table already has.
        let Some(at) = first.index_of_key(&self.access_key(id, member_name)?) else {
            return Some(format!(
                "`{member_name}` on a union, which no member stores as a field"
            ));
        };
        if shared == 0 {
            return Some(format!(
                "`{member_name}` on a union whose members share no leading field"
            ));
        }
        if usize::try_from(at).ok()? >= shared {
            return Some(format!(
                "`{member_name}` on a union, past the fields its members agree about"
            ));
        }
        None
    }

    /// The layouts a value of a union can have: each arm, and for an arm that
    /// is a structural type, every object type of the program whose shape fits
    /// it.
    ///
    /// **An interface arm is not the layout of what it holds.** A conversion
    /// into a union erases, so nothing asked an object for a prefix of any arm:
    /// `class Both { side; kind; radius }` fits `Circle | Square` and holds
    /// `kind` at index 1 where both arms hold it at 0, and the read shared
    /// across the arms answered `side`
    /// (`tests/outcomes/a-union-of-interfaces-read-on-a-class-laid-out-as-neither-arm`).
    /// The arms come first, in their order: the shared index is read off the
    /// first.
    fn union_holders(&self, members: &[TypeId]) -> Vec<TypeId> {
        let mut holders = members.to_vec();
        for member in members {
            let structural = class_symbol(self.snapshot, *member).is_none()
                && !crate::hir::is_closure_type(*member)
                && !self.is_a_signature(*member)
                && matches!(
                    self.snapshot.types.get(member.0 as usize).map(|r| &r.kind),
                    Some(TypeKind::Object { .. })
                );
            if structural {
                holders.extend(
                    self.hierarchy
                        .access_families
                        .structural_owners(self, *member),
                );
            }
        }
        let mut seen = rustc_hash::FxHashSet::default();
        holders.retain(|holder| seen.insert(*holder));
        holders
    }

    /// A member every arm of a union places identically: the arms, its index,
    /// and what it reads as.
    ///
    /// The precondition `OpKind::SharedFieldGet` documents is established here
    /// and nowhere else, so it is worth stating in the same words: **every arm
    /// agrees about that field's name, index and representation.**
    ///
    /// `same_slot` -- names *and* representations -- because a rule matching
    /// names alone passes `{ at: number }` against `{ at: string }` and emits a
    /// load that reads a `double` out of a slot holding a pointer, with nothing
    /// refusing and nothing crashing.
    ///
    /// The agreement is a **prefix and not a set**. A field behind a
    /// disagreement has no known offset even where it agrees itself, because
    /// the fields before it decide where it starts. That is what makes the C
    /// pointer read sound and equally what makes the JVM's per-arm `getfield`
    /// sound.
    ///
    /// Every arm must have a layout, which is also the test for whether an arm
    /// can hold a field at all: an arm that is `null`, `undefined` or a
    /// primitive answers `None` and the read stays refused rather than becoming
    /// a load from a tag.
    pub(super) fn shared_field(
        &mut self,
        id: NodeId,
        member_name: &str,
    ) -> Option<(Vec<TypeId>, u32, HirType)> {
        let object = self.children(id).first().copied()?;
        let ty = *self.snapshot.node_types.get(&object)?;
        let TypeKind::Union(members) = &self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        let members = members.clone();
        if members.len() < 2 {
            return None;
        }
        let members = self.union_holders(&members);

        let mut arms = Vec::with_capacity(members.len());
        for member in &members {
            arms.push(self.layout_of(id, *member).ok()?);
        }
        let (first, rest) = arms.split_first()?;

        let mut shared = first.fields.len();
        for other in rest {
            shared = shared.min(other.fields.len());
            let agreed = first
                .fields
                .iter()
                .zip(other.fields.iter())
                .take(shared)
                .take_while(|(want, have)| same_slot(want, have))
                .count();
            shared = shared.min(agreed);
            if shared == 0 {
                return None;
            }
        }

        let at = first.index_of_key(&self.access_key(id, member_name)?)?;
        if usize::try_from(at).ok()? >= shared {
            return None;
        }
        let read = first.fields.get(at as usize)?.ty.clone();
        Some((members, at, read))
    }

    /// A member every arm of a union declares and **no two of them agree about
    /// where**: the arms with their own indices, and what it reads as.
    ///
    /// The sibling of [`Self::shared_field`], and the two cover the union between
    /// them: that one wants one index for every arm, which is what licenses C and
    /// LLVM to skip the tests and read; this one is the case it declines, in the
    /// two shapes `why_not_shared` names -- "share no leading field" and "past
    /// the fields its members agree about".
    ///
    /// # What still has to agree, and what no longer does
    ///
    /// The **representation** must: a rule matching names alone emits a load that
    /// reads a `double` out of a slot holding a pointer, which is the hazard
    /// `same_slot` exists for and it does not go away when the indices are
    /// allowed to differ. The **index** need not, and that is the whole point --
    /// each arm carries its own, and no arm's offset has to be derivable from
    /// another's.
    ///
    /// So the prefix condition disappears with it. `shared_field`'s agreement is
    /// "a prefix and not a set" because a field behind a disagreement has no
    /// known offset *through the first arm's layout*; here the offset is looked
    /// up in the arm's own layout, so a disagreement earlier in the struct costs
    /// nothing.
    ///
    /// Every arm must declare the member. One that does not is not an arm a test
    /// could read through, and the read stays refused by the sentence that names
    /// which arm -- rather than becoming a chain with a hole in it.
    pub(super) fn open_field(
        &mut self,
        id: NodeId,
        member_name: &str,
    ) -> Option<(Vec<FieldArm>, HirType)> {
        let object = self.children(id).first().copied()?;
        let ty = *self.snapshot.node_types.get(&object)?;
        let TypeKind::Union(members) = &self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        let members = members.clone();
        if members.len() < 2 {
            return None;
        }
        let members = self.union_holders(&members);
        let mut arms = Vec::with_capacity(members.len());
        let mut read: Option<HirType> = None;
        for member in &members {
            let layout = self.layout_of(id, *member).ok()?;
            let at = layout.index_of_key(&self.access_key(id, member_name)?)?;
            let slot = layout.fields.get(at as usize)?;
            match &read {
                Some(seen) if *seen != slot.ty => return None,
                _ => read = Some(slot.ty.clone()),
            }
            arms.push(FieldArm {
                ty: *member,
                field: at,
            });
        }
        Some((arms, read?))
    }

    /// A known identity proves the receiver, not reference storage. Until that
    /// admission contract is implemented, keep an unproved reference argument
    /// typed and visible to the same backend checks as the previous call path.
    /// The decision precedes defaults so a mixed site retains its old ownership.
    pub(super) fn known_reference_path(
        &self,
        call: NodeId,
        receiver: ValueId,
        arguments: &[ValueId],
    ) -> Option<usize> {
        if self.dispatches_to_a_raising_entry(call) {
            return None;
        }
        let HirType::Managed(ManagedType::Object(class)) = self.values[receiver.0 as usize].ty
        else {
            return None;
        };
        if !crate::hir::is_closure_type(class) {
            return None;
        }
        let index = closure_index(class);
        let info = self.closures.get(index)?;
        if generic_values::is_canonical(self.snapshot, info) {
            return None;
        }
        self.effective_parameters(call)
            .iter()
            .enumerate()
            .any(|(position, (ty, _, _))| {
                let Some(want) = ty.and_then(|ty| self.represent(ty)) else {
                    return false;
                };
                if !want.is_managed() || uniform_inputs::primitive(&want) {
                    return false;
                }
                let Some(argument) = arguments.get(position) else {
                    return true;
                };
                let (value, absent) = match self.values[argument.0 as usize].kind {
                    OpKind::Erase { value, absent, .. } => (value, absent),
                    _ => (*argument, Absent::Impossible),
                };
                self.values[value.0 as usize].ty != want || absent != Absent::Impossible
            })
            .then_some(index)
    }

    /// `sort()` and `toSorted()`, with **no comparator**.
    ///
    /// The default comparison is the specification's and not a natural one:
    /// every element is converted to a string and the strings are compared by
    /// UTF-16 code unit. For an array that already holds strings that
    /// conversion is the identity, which is the only case answered here.
    ///
    /// **A numeric array is refused by name rather than sorted numerically.**
    /// `[3, 1, 10].sort()` is `[1, 10, 3]` in JavaScript, and answering
    /// `[1, 3, 10]` would be a wrong answer where this is a missing one —
    /// which is the more expensive of the two. Building the right one means a
    /// string per element, which is a different helper rather than a different
    /// comparison, and nothing in the profile asks for it: all three sites are
    /// over strings.
    ///
    /// **A comparator is refused too**, and separately, because it is a
    /// different feature: the callback would have to be reached from inside the
    /// sort, which is neither the inlined-into-a-loop shape every other array
    /// callback takes nor something a C function pointer can carry once the
    /// arrow captures anything.
    ///
    /// `toSorted` is `sort` on a copy, composed from `slice` for the same
    /// reason `toReversed` is: no second place deciding what copying means, and
    /// no runtime surface for three backends to catch up with.
    /// The tag a null reference slot of the array `array_node` names reads
    /// as: the one absence its element type admits.
    ///
    /// A reference slot holds a null pointer for `null` or for `undefined` and
    /// never for both -- an element type admitting both is stored erased -- so
    /// the type answers what the pointer cannot, and every runtime reader that
    /// may meet a null slot is told (`nts_array_element`,
    /// `nts_array_sort_str`). Answering `undefined` for both read a stored
    /// `null` wrong and sorted one as a dereference. An element with no
    /// absence, or a type this cannot read, is `undefined`, which a slot of it
    /// never holds.
    /// The receiver of a method call whose name is `member`: `xs` in
    /// `xs.sort()` and in `xs["sort"]()`, the first child of the access.
    pub(super) fn receiver_of_member(&self, member: NodeId) -> Option<NodeId> {
        self.syntactic_parent(member)
            .and_then(|access| self.children(access).first().copied())
    }
}

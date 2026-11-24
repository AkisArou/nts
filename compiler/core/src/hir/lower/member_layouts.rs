//! Determine member storage, field order, and inherited slots.

use super::{
    ClosureInfo, Diagnostic, Field, FuncBuilder, Hierarchy, HirType, Layout, LoweringSnapshot,
    ManagedType, MemberKey, MemberKind, Naming, NodeId, NodeKind, OpKind, Place, PropertyKey,
    SemanticSnapshot, TypeId, TypeKind, ValueId, absent_of_result, access_families,
    access_family_functions, cell_type, class_symbol, interfaces, is_an_instantiation,
    is_anonymous_shape, literal_field_names, literal_methods, may_merge, named, syntax,
    wire_naming,
};

/// How the literals of a type supply one of its methods.
#[derive(Default)]
struct Supply {
    /// How many literals of the type write the member at all.
    literals: usize,
    /// Whether any of them gives it something a table method cannot hold: a
    /// body that captures, or a value.
    with_environment: bool,
    /// Whether any of them writes it as a method reading `this`, which a
    /// closure cannot be: it binds its own, the way a `function` does, and the
    /// collector left it a table method. One such literal settles the type.
    binds_this: bool,
}

/// Which of a type's methods an object literal supplies with an environment,
/// and so must be laid out as storage. See `Hierarchy::stored`.
///
/// A member is forced when the type declares it as a method and any literal
/// built at the type supplies it as
///
///   * a method whose body captures --- the collector knows, since a literal's
///     method is collected like a `function` expression;
///   * a value: `{ read: () => base + 1 }`, `{ read: function () {…} }`,
///     `{ read }`. Whatever the value, a table holds functions and not values;
///   * a second literal of the type supplying it at all. Two literals at one
///     interface are two implementations, and the table has room for one ---
///     `lower_object_literal_members` refused the second by name;
///   * any method at all, where the type is an *instantiation* of a generic
///     interface. An instantiation has no table -- the hierarchy registers the
///     declaration's id -- and a slot needs neither a table nor a name.
///
/// **Not where a literal of the type reads `this`.** Such a method binds its
/// own, a closure cannot be it, and one representation serves the type; that
/// literal keeps the table and a capturing literal beside it keeps its
/// refusal.
///
/// **Only for a type that stands alone.** A class implementing it, an
/// interface extending it, or a base it extends all mean a value of the type
/// can be an object its own layout did not build, or be read through a layout
/// that is not its own; a field in one and a slot in the other is a
/// `FieldGet` at an index that means something else. Such a type keeps the
/// refusal it has today. And a class is never one: a literal typed as a class
/// is structural, and forcing the class's method would break `new`.
pub(super) fn collect_stored_members(
    snapshot: &LoweringSnapshot<'_>,
    probe: &mut FuncBuilder,
    closures: &[ClosureInfo],
    hierarchy: &mut Hierarchy,
) {
    let mut supplied: rustc_hash::FxHashMap<(TypeId, PropertyKey), Supply> =
        rustc_hash::FxHashMap::default();
    let collected: rustc_hash::FxHashMap<NodeId, &ClosureInfo> = closures
        .iter()
        .map(|closure| (closure.node, closure))
        .collect();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::OBJECT_LITERAL_EXPRESSION) {
            continue;
        }
        let literal = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let Some(ty) = probe.literal_member_owner(literal) else {
            continue;
        };
        let stands_alone = hierarchy.stands_alone(ty);
        std::sync::Arc::make_mut(&mut hierarchy.literal_methods).register(
            ty,
            literal,
            stands_alone,
        );
        // An instantiation of a generic interface has no dispatch table: the
        // hierarchy registers the declaration's type id and a `Box<number>`
        // is another, so a literal's method there was `a method with no
        // declaration in the hierarchy` whether or not it captured. A slot
        // needs no table and no per-instantiation function name, so every
        // literal method at an instantiation is stored -- which is what
        // makes `Box<number>` and `Box<string>` two layouts rather than one
        // name.
        let instantiated = is_an_instantiation(snapshot, probe, ty);
        for member in probe.children(literal) {
            let (with_environment, binds_this) = match probe.kind_of(member) {
                Some(syntax::METHOD_DECLARATION) => match collected.get(&member) {
                    Some(closure) => (instantiated || !closure.captures.is_empty(), false),
                    // Not collected: it reads `this`, or is a generator.
                    None => (false, true),
                },
                Some(syntax::PROPERTY_ASSIGNMENT | syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
                    (true, false)
                }
                _ => continue,
            };
            let Some(name) = probe
                .name_node(member)
                .and_then(|node| probe.property_key(node))
            else {
                continue;
            };
            if !declares_a_method_alone(snapshot, probe, ty, &name) {
                continue;
            }
            let supply = supplied.entry((ty, name)).or_default();
            supply.literals += 1;
            supply.with_environment |= with_environment;
            supply.binds_this |= binds_this;
        }
    }
    // A literal reading `this` keeps the whole type on the table, and the
    // capturing literal beside it keeps the refusal it has today -- one
    // representation per type, and that one has a body a closure cannot hold.
    let mut forced: Vec<(TypeId, PropertyKey)> = supplied
        .into_iter()
        .filter(|(_, supply)| {
            (supply.with_environment || supply.literals > 1) && !supply.binds_this
        })
        .map(|(key, _)| key)
        .collect();
    // Sorted so the field order a layout gets does not depend on hash order.
    forced.sort_by(|a, b| a.0.0.cmp(&b.0.0).then_with(|| a.1.cmp(&b.1)));
    for (ty, name) in forced {
        if !hierarchy.stands_alone(ty) {
            continue;
        }
        if let Some(declared) = hierarchy.declares.get_mut(&ty) {
            declared.retain(|declared| declared != &MemberKey::method(name.clone()));
        }
        hierarchy.stored.entry(ty).or_default().push(name);
    }
}

/// Whether `ty` declares `member` as a method of its own: a signature written
/// on this very interface or type literal, or the method of the anonymous
/// type an object literal is.
///
/// Asked of the member's **declaration** rather than of `own`: the record is
/// the checker's flattened view, and what this needs is that the member is
/// written on this type --- inherited from a base, the base's layout holds the
/// slot and a field here would not be read through it. A class's method is
/// never one: a literal typed as a class is structural, and the class's `new`
/// builds a table.
fn declares_a_method_alone(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    ty: TypeId,
    member: &PropertyKey,
) -> bool {
    let Some(TypeKind::Object { properties }) =
        snapshot.types.get(ty.0 as usize).map(|it| &it.kind)
    else {
        return false;
    };
    let anonymous = named(snapshot, ty).is_none() || is_anonymous_shape(snapshot, ty);
    let declared_here = |owner: NodeId| {
        snapshot
            .node_types
            .get(&owner)
            .is_some_and(|declared| declares_or_instantiates(snapshot, ty, *declared))
    };
    properties.iter().any(|property| {
        &property.name == member
            && property.kind == nts_semantic_schema::MemberKind::Method
            && property
                .declaration
                .is_some_and(|declaration| match probe.kind_of(declaration) {
                    Some(syntax::METHOD_SIGNATURE) => {
                        probe.syntactic_parent(declaration).is_some_and(|owner| {
                            matches!(
                                probe.kind_of(owner),
                                Some(syntax::INTERFACE_DECLARATION | syntax::TYPE_LITERAL)
                            ) && declared_here(owner)
                        })
                    }
                    Some(syntax::METHOD_DECLARATION) => {
                        anonymous && probe.declared_in_an_object_literal(property)
                    }
                    _ => false,
                })
    })
}

/// Whether `ty` is the type a declaration carries, or an instantiation of it.
///
/// A generic interface's instantiations are their own type ids, each with its
/// own layout, and what they share with the declaration is its symbol. One
/// derivation, asked from both sides: `declares_a_method_alone` asks whether
/// a signature's owner declares `ty`, and `is_an_instantiation` whether `ty`
/// is such a copy rather than the declaration's own id.
pub(super) fn declares_or_instantiates(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    declared: TypeId,
) -> bool {
    let symbol_of = |ty: TypeId| {
        snapshot
            .types
            .get(ty.0 as usize)
            .and_then(|record| record.symbol)
    };
    declared == ty || (symbol_of(ty).is_some() && symbol_of(ty) == symbol_of(declared))
}

/// Every object literal's property names, in source order, keyed by the same
/// names sorted -- the order a *layout* of those fields is laid out in.
///
/// A type written two different ways is dropped from the agreed orders and kept
/// as disputed: a conflict has no answer and a guess would be a wrong one.
///
/// **A function rather than a block inside [`naming`](super::naming), because two places need
/// it and one of them runs before `Naming` exists.** `collect_module_scope`'s
/// probe lays out every type a module-scope binding mentions, and its layouts
/// reach `collect_layouts` *first*, so they win the merge -- which keeps the
/// existing field order and discards the incoming one without comparing them.
/// A probe that does not know the written order lays those types out in the
/// checker's, and every function lowered afterwards indexes them in the
/// program's. The field *sets* are identical, so nothing refuses and nothing
/// verifies differently until a neighbour's type happens to disagree.
///
/// That is the second time this probe has produced a layout in the wrong order
/// for want of something `Naming` holds -- `Hierarchy` was the first, and its
/// fix is the comment above the probe. Computed twice rather than threaded,
/// which is what `qualified_names` does three lines above for the same reason
/// and at the same cost: one pass over the nodes, against a whole lowering.
pub(super) fn written_field_orders(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
) -> WrittenOrders {
    let mut written_order: rustc_hash::FxHashMap<Vec<String>, Vec<String>> =
        rustc_hash::FxHashMap::default();
    let mut conflicting: rustc_hash::FxHashSet<Vec<String>> = rustc_hash::FxHashSet::default();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::OBJECT_LITERAL_EXPRESSION) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let Some(names) = literal_field_names(probe, id) else {
            continue;
        };
        let mut signature = names.clone();
        signature.sort();
        if conflicting.contains(&signature) {
            continue;
        }
        match written_order.get(&signature) {
            Some(already) if *already != names => {
                written_order.remove(&signature);
                conflicting.insert(signature);
            }
            Some(_) => {}
            None => {
                written_order.insert(signature, names);
            }
        }
    }
    WrittenOrders {
        agreed: written_order,
        disputed: conflicting,
    }
}

/// The key orders the program's object literals write, by field-name set
/// (sorted): [`written_field_orders`]'s answer.
#[derive(Debug, Clone, Default)]
pub(super) struct WrittenOrders {
    /// The one order every literal of a set writes, which its layout takes.
    pub(super) agreed: rustc_hash::FxHashMap<Vec<String>, Vec<String>>,
    /// The sets literals write in more than one order. A layout holds one
    /// order, so for these no layout order is every object's insertion order,
    /// and a consumer that writes keys in that order -- `JSON.stringify`'s
    /// writer -- refuses rather than answer one literal's order for another's.
    pub(super) disputed: rustc_hash::FxHashSet<Vec<String>>,
}

pub(super) fn field_aliases(
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    closures: &[ClosureInfo],
    hierarchy: &Hierarchy,
    naming: &Naming,
) -> Vec<Layout> {
    if hierarchy.access_families.licensed.is_empty() {
        return Vec::new();
    }
    let mut probe = FuncBuilder::new(snapshot, foreign);
    probe.hierarchy = hierarchy;
    probe.closures = closures.to_vec().into();
    wire_naming(&mut probe, naming);
    let targets: std::collections::BTreeSet<_> = hierarchy
        .faces
        .iter()
        .copied()
        .chain(
            hierarchy
                .access_families
                .licensed
                .iter()
                .flat_map(|family| {
                    family
                        .supplies
                        .iter()
                        .map(|supply| supply.owner)
                        .filter(|owner| class_symbol(snapshot, *owner).is_none())
                }),
        )
        .collect();
    for target in &targets {
        // Unrepresentable schemas remain refused at their actual use site.
        // This probe publishes geometry, never extra program layouts or bodies.
        let _ = probe.layout_of(NodeId(0), *target);
    }
    probe
        .layouts
        .into_layouts()
        .into_iter()
        .filter(|layout| layout.types.iter().any(|ty| targets.contains(ty)))
        .collect()
}

/// Two layouts for one type holding the same field *names* in a different
/// *order*, which is the shape [`super::DisputedLayout`](crate::hir::DisputedLayout) exists for.
///
/// Name sets rather than whole fields: a difference in a field's *type* is a
/// different question and one `same_shape` already decides. This asks only
/// whether two derivations of one type disagreed about **where** its fields go,
/// which is the disagreement no later pass can see.
pub(super) fn one_type_two_orders(
    kept: &[Field],
    incoming: &[Field],
) -> Option<(Vec<String>, Vec<String>)> {
    if kept.len() != incoming.len() {
        return None;
    }
    let order = |fields: &[Field]| -> Vec<PropertyKey> {
        fields.iter().map(|field| field.name.clone()).collect()
    };
    let (kept, incoming) = (order(kept), order(incoming));
    if kept == incoming {
        return None;
    }
    let (mut left, mut right) = (kept.clone(), incoming.clone());
    left.sort();
    right.sort();
    (left == right).then(|| {
        (
            kept.iter().map(ToString::to_string).collect(),
            incoming.iter().map(ToString::to_string).collect(),
        )
    })
}

impl FuncBuilder<'_> {
    /// The type a cell holds, from the layout this function already pushed.
    pub(super) fn program_layout_field(&self, index: usize) -> Option<HirType> {
        self.layouts
            .iter()
            .find(|layout| layout.types.contains(&cell_type(index)))
            .and_then(|layout| layout.fields.first())
            .map(|field| field.ty.clone())
    }

    /// Put a value into a place.
    /// A store converts, and which conversion it is depends on the *slot*.
    ///
    /// One function for every kind of place, because doing it per site is how
    /// this kept going wrong: an erased array element, then an erased field,
    /// then an erased global were each found separately, one C compile error
    /// or one rejected SSA form at a time. A store is the only thing that
    /// reaches a slot, and this is the only thing a store goes through.
    ///
    /// A setter is not a slot -- it is a call, and its parameter is converted
    /// where every other argument is.
    ///
    /// Two arms answer `None` for two different reasons and are kept apart for
    /// the reason [`super::super::codegen`]'s `cross` keeps its own apart: with
    /// the reasons merged, the next place to arrive would join a list instead
    /// of being decided about.
    #[allow(clippy::match_same_arms)]
    /// The value a store writes, at the slot's width.
    ///
    /// **Fallible, and it was not.** This ended in
    /// `self.coerce(value, &want, id).unwrap_or(value)`, which discarded the one
    /// answer that matters: `coerce` returns `Err` when it cannot represent the
    /// conversion, and swallowing that wrote the *uncoerced* value into the
    /// slot.
    ///
    /// For a field of a structural type that is the segfault. `class Holder {
    /// held: Named }` storing a `Thing` whose layout is not a prefix put a
    /// `Thing *` in a `Named *` slot, every later read was at the wrong offset,
    /// and the program died with signal 11 having refused nothing. The identical
    /// cast *into a parameter* was refused by name the whole time, because
    /// `coerce_to_parameter` propagates what this one dropped.
    /// The declared type a place holds, where it has one.
    ///
    /// Split out of [`Self::coerce_to_slot`] so an assignment can lower its
    /// right-hand side **at** the slot rather than lowering it and converting.
    /// A literal that decides nothing on its own -- `[]`, or `{ a: 1 }` where
    /// the slot also declares an optional property -- needs the slot to say
    /// what it is, and by the time `coerce_to_slot` runs the value has already
    /// been built at the wrong type and all that is left is a cast the compiler
    /// made necessary for itself.
    ///
    /// One derivation, asked twice: once before the value exists and once
    /// after. `coerce_to_slot` answering from a second copy of this match is
    /// exactly the shape that let a local declaration and a module-scope one
    /// disagree about the same fact.
    pub(super) fn slot_type(
        &mut self,
        id: NodeId,
        place: &Place,
    ) -> Result<Option<HirType>, Diagnostic> {
        Ok(match *place {
            Place::Checked { ref place, .. } => self.slot_type(id, place)?,
            Place::NativeBits { pointer, field } => Some(self.native_bit_unit(id, pointer, field)?),
            Place::NativeElement { pointer, .. } => Some(self.native_element_type(id, pointer)?),
            Place::Element { array, .. } => match self.values[array.0 as usize].ty.clone() {
                HirType::Managed(ManagedType::Array(element) | ManagedType::View(element)) => {
                    Some(*element)
                }
                _ => None,
            },
            // The runtime takes the new length as a `double`, like every other
            // array helper that carries an index or a count. `Some`, because
            // the arms here answer with an optional declared width.
            Place::ArrayLength(_) => Some(HirType::NUMBER),
            Place::Field { object, field } => {
                let HirType::Managed(ManagedType::Object(ty)) =
                    self.values[object.0 as usize].ty.clone()
                else {
                    return Ok(None);
                };
                match self.layout_of(id, ty) {
                    Ok(layout) => layout
                        .fields
                        .get(field as usize)
                        .map(|slot| slot.ty.clone()),
                    Err(_) => None,
                }
            }
            // A table has no slot until a key is written, so there is no
            // declared width to coerce toward -- `write_place` erases instead.
            Place::Entry { .. } | Place::UninitializedBinding { .. } | Place::Unwritable { .. } => {
                None
            }
            Place::Global(global) => self.module.types.get(global as usize).cloned(),
            // A binding is an SSA value rather than a slot, and it still has a
            // declared type that every assignment has to keep: `let held:
            // unknown = "text"; held = n` rebound `held` to an `f64`, and a
            // later `typeof held` then had no tag to read.
            Place::Binding { ref ty, .. } => ty.clone(),
            Place::Setter { ref wants, .. } => wants.clone(),
            // The setter's own parameter converts what it is given, as a
            // plain `=` does.
            Place::NativeAccessor { .. } | Place::NamedProperty { .. } => None,
        })
    }

    /// The fields of a class, from the checker's flattened property list.
    ///
    /// A method is a member of the type but not a field of the object: it has
    /// no storage, because the checker resolved every call site, so it is a
    /// function the call names directly rather than a slot to load from. This
    /// is where a vtable would go if dispatch needed one.
    pub(super) fn fields_of(
        &mut self,
        id: NodeId,
        ty: TypeId,
        properties: &[nts_semantic_schema::PropertyRecord],
    ) -> Result<Vec<Field>, Diagnostic> {
        // A class descending from a provided one takes *that* class's fields
        // rather than the checker's flattened view of them, because the view
        // includes members this compiler does not provide -- `stack?` and
        // `cause?` are in the list and are not fields here. What the class
        // declares itself is marked `own`, which is exactly the remainder.
        let provided = self.provided_error_base(ty);
        let mut fields = match provided.as_deref() {
            Some(base) => crate::hir::builtin::error_fields(base),
            None => Vec::new(),
        };
        // **A class defines its parameter properties first.** TypeScript emits
        // `constructor(public x: number)` as a field declared before every
        // other one the class writes (an assignment before every initializer,
        // without define semantics), so `class P { label = "p";
        // constructor(public x: number) {} }` is `x` then `label` -- and the
        // checker lists its own members in source order, `label` first. A
        // layout is the order `Object.keys` and `JSON.stringify` answer, so
        // the parameters are laid out first: after a provided base's fields,
        // in their own order.
        let prefix = fields.len();
        let mut parameters = Vec::new();
        for property in properties {
            if provided.is_some() && !property.own {
                continue;
            }

            // Only a field is laid out. An accessor looks like a property and
            // *is* a call -- `o.x` where `x` is a getter runs code -- and a
            // method is a call the dispatch table holds.
            //
            // What used to stand here skipped every property whose *type* was a
            // function type, which is a method and a function-valued field
            // together, because the type cannot tell them apart. Dropping the
            // field silently was worse than refusing it: the member the program
            // wrote was not in the layout, so reading it answered "`twice`,
            // which `Ops` does not declare" -- a message about the type, for a
            // field this compiler had removed.
            //
            // **Unless the type's literals made it one.** A method a literal
            // supplies with an environment is laid out as the field holding
            // the closure -- `Hierarchy::stored` is the decision, made once
            // from every literal of the type -- and its record's type is the
            // function type, which is what a `read: () => number` field has,
            // so it takes the representation that field would.
            if !property.kind.is_stored() && !self.hierarchy.stores(ty, &property.name) {
                continue;
            }
            // **A repeated `#private` name is one member; a `#private` name and
            // a string key spelled the same are two.**
            //
            // The rule here was "skip a `#`-named property when a field of that
            // name is already kept", which collapsed both. `class C { #m = 44;
            // ["#m"] = this.#m / 11 }` is legal and declares *two* properties --
            // the checker records both, with different declarations -- and this
            // dropped the computed one, so one slot answered for both and
            // `this.#m` read 4 where node reads 44. A wrong answer that compiled
            // and ran, on this binary and on 23666c14 alike.
            //
            // Asked of the whole property list rather than of the fields kept so
            // far, because the private half may not be a field at all: `get #m()`
            // is an accessor, `is_stored` skips it above, and `this.#m` then
            // resolved to the computed *slot* instead of dispatching to the
            // getter -- the `private-getter-is-not-clobbered-by-computed-property`
            // variant, which a fields-only test missed.
            //
            // **A private `Method` is excluded and that is not a loose end.** A
            // method is held by the dispatch table and never has a slot, so
            // `#m() {}` beside `["#m"] = 0` is two members this compiler already
            // keeps apart -- `private-method-is-not-clobbered-by-computed-property`
            // passes. Refusing it too was measured and cost that file, which is
            // how the line between the three kinds was found rather than
            // guessed.
            //
            // Refused rather than given two slots. Two slots means a name a
            // `#private` member can be addressed by and a string key cannot --
            // a mangling through the layout, both field paths and all three
            // backends -- and until that exists a refusal naming the collision
            // is the direction to trade in.
            if matches!(property.name, nts_semantic_schema::PropertyKey::Private(_))
                && !self.declared_with_a_private_name(property)
                && properties.iter().any(|other| {
                    other.name == property.name
                        && self.declared_with_a_private_name(other)
                        && !matches!(other.kind, MemberKind::Method)
                })
            {
                return Err(self.unsupported(
                    id,
                    &format!(
                        "a computed property `{}`, whose name is also a private member's",
                        property.name
                    ),
                ));
            }
            // The original rule, which survives inside the one above: a member
            // listed twice by the checker's flattened view -- a base's private
            // field seen again through a subclass -- is the same member both
            // times, and both sightings are `#private` declarations.
            if matches!(property.name, nts_semantic_schema::PropertyKey::Private(_))
                && fields.iter().any(|kept| kept.name == property.name)
            {
                continue;
            }
            // A reference field is a pointer. Under NoGC nothing is ever freed,
            // so it costs neither a write barrier nor a trace; which fields are
            // references is recorded on the layout for the collector that comes
            // later, because that is a fact about the layout and the layout is
            // decided here.
            // `undefined` is a value with a name, not an absence.
            // `representation_of` answers `Void` for it, which is right for a
            // return type -- a function returning `undefined` returns nothing
            // -- and is not a representation at all for a slot: C has no
            // zero-width member, so the emitter wrote `void value;` and clang
            // rejected the whole struct.
            //
            // Every field of the eight WHATWG stream dictionaries went that
            // way. `type?: undefined` compiles and `type: undefined` does not,
            // which is the control pair that placed it: optionality already
            // routes through `Erased` below and a *required* member of the same
            // type had no route at all. Two spellings of one set of values, two
            // answers, and one of them was not an answer.
            //
            // `Never` joins it. A field typed `never` can hold nothing, so any
            // read is unreachable -- and the struct still needs a member, or
            // every offset after it lands somewhere the layout does not say.
            // **`null` is the third of them and had no representation at all.**
            // `Void` and `Never` reach the arm below because `representation_of`
            // gives them one; `TypeKind::Null` has no arm there, so
            // `{ attr: null }` was refused as "a property of unrepresentable
            // type (null)" while `{ attr: undefined }` compiled -- the same
            // control pair as the paragraph above, one type over.
            //
            // The reasoning is the paragraph above's: a field typed `null` can
            // hold nothing but `null`, so no read of it can be anything else,
            // and the struct still needs a member or every offset after it
            // lands where the layout does not say. `Erased` has a null tag,
            // which makes it the slot that can hold the one value there is.
            //
            // Answered here rather than in `representation_of`, deliberately.
            // `null` alone as a *parameter* or a *result* is not this question
            // -- nothing reads those back -- and a representation given there
            // would change what a function returning `null` hands over, which is
            // a much larger claim than a field needing a width.
            // `Copied<T>`'s marker names the struct the object is copied to
            // and from, for the checker and a native call to read. It holds
            // nothing, so it has no field, and the object is laid out as the
            // plain object of its fields is.
            if property.name.is_name("__c_copied") && property.optional && property.readonly {
                continue;
            }
            let held = if self.holds_only_absences(property.ty) {
                HirType::Erased
            } else {
                // `represent_passed`, which the contextual type of a value
                // written into this field asks too: a `CStrings` field is the
                // `string[]` a construction lends.
                self.represent_passed(property.ty).ok_or_else(|| {
                    self.unrepresentable_member(
                        id,
                        "a property",
                        &property.name.to_string(),
                        property.ty,
                    )
                })?
            };
            let field_ty = match held {
                HirType::Void | HirType::Never => HirType::Erased,
                held => held,
            };
            // A field of object type needs that object's *layout*, not only its
            // representation: the struct has to name a member of it, and the
            // descriptor beside it takes an `offsetof` into it.
            //
            // Without this the emitter silently dropped the member -- it skips
            // a field whose C type it cannot compute -- and left the descriptor
            // naming one that was not there. Five corpus files emitted a
            // `struct { NtsHeader header; }` that way, and the two which
            // happened to be *read* were the two the ratchet had been counting.
            //
            // Confined to a *tuple* field, which is the shape this commit
            // introduced. Asking it of every object field is the honest rule
            // and costs 40 functions in the node profile -- a field whose type
            // has no layout but which nothing ever reads still emits and still
            // runs -- so the wider fix is its own decision, with the silent
            // drop in the emitter as its other half.
            //
            // A *function* type is asked for too, and safely: `layout_of`
            // constructs one for it rather than deriving it -- a signature has
            // no fields, because two closures of one type differ by what they
            // captured -- so the call cannot refuse anything. It is the general
            // rule for exactly the case where the general rule is free.
            if let HirType::Managed(ManagedType::Object(inner)) = &field_ty
                && *inner != ty
                && (self.is_tuple(*inner) || self.is_a_signature(*inner))
            {
                self.layout_of(id, *inner)?;
            }
            // An optional field's absence has to live somewhere, and a tag is
            // where. This used to be refused outright -- "an optional field
            // needs a presence bit, which changes the layout rather than adding
            // to it" -- and the tag *is* that presence bit, now that there is
            // one.
            //
            // The property's own type is `T` rather than `T | undefined`: the
            // checker records optionality beside the type instead of in it, so
            // the union has to be reconstructed here. A fresh allocation is
            // zeroed and zero is the `undefined` tag, which is what makes an
            // omitted property already correct.
            let field_ty = if property.optional && field_ty != HirType::Erased {
                HirType::Erased
            } else {
                field_ty
            };
            let parameter = property.own
                && property.declaration.is_some_and(|declaration| {
                    self.kind_of(declaration) == Some(syntax::PARAMETER)
                });
            (if parameter {
                &mut parameters
            } else {
                &mut fields
            })
            .push(Field {
                name: property.name.clone(),
                ty: field_ty,
                readonly: property.readonly,
                // Stated here because this is the only place that knows. See
                // `Field::declared_by`: two classes can declare one `#` name and
                // nothing else in a `Layout` separates them.
                //
                // **Only where the property is this type's own.** The checker
                // hands back a flattened member list, so a base's field appears
                // here too and claiming it would name the wrong class. The
                // inherited ones are replaced wholesale in `after_the_base`,
                // which holds the base's records and so holds the answer; a
                // class with no base has no inherited property to mistake.
                declared_by: property.own.then_some(ty),
                // Not one inferred from its initializer (S3), which holds
                // whatever the program later stores. One with no declaration
                // was made by a type -- a mapped type's, a tuple's -- whose
                // author wrote it.
                written: match property.declaration {
                    Some(declaration) if !self.annotated(declaration) => None,
                    _ => self.written_scalar(property.ty),
                },
            });
        }
        fields.splice(prefix..prefix, parameters);
        Ok(fields)
    }

    /// The base's fields first, then this class's own.
    ///
    /// Base-first layout is what makes an upcast a no-op pointer cast, and it is
    /// taken *from the base's layout* rather than sorted towards it — see the
    /// note inside, which is why.
    pub(super) fn after_the_base(
        &mut self,
        id: NodeId,
        base: TypeId,
        fields: Vec<Field>,
    ) -> Result<Vec<Field>, Diagnostic> {
        // The base's **type id**, not any name it has.
        //
        let inherited = self.layout_of(id, base)?.fields;
        let mut ordered = inherited;
        for field in fields {
            // **A `#` name is per class, so a shadowed one is two fields.**
            //
            // `class Base { #count = 0 }` and `class Derived extends Base
            // { #count = 100 }` are two fields in JavaScript -- that is what the
            // `#` is for -- and the dedup below matches by name, so the derived's
            // was dropped and both classes read and wrote the base's slot.
            // Measured against node: **28 of 28 cases disagreed**, node
            // answering 2102 where this answered 102502.
            //
            // Both are kept now, under their own names, told apart by
            // `declared_by`. An earlier version renamed the inherited copy
            // instead: correct on a lane that addresses a field by index, and
            // `NoSuchFieldError` on one that addresses it by name. A mangled
            // name in a shared `Layout` is a C-shaped answer, and each backend
            // spells the distinction its own way now.
            //
            // A *public* field redeclared by a derived class is the same
            // property and must go on sharing one slot, which is what the dedup
            // below is for and why this exempts only `#`.
            //
            // `declared_by` is the own-ness test, and the reason it has to be
            // one: an inherited `#count` is in the flattened list beside the
            // derived's own fields, and pushing it unconditionally gave
            // `Derived` a second `#count` slot that nothing ever read.
            // `tests/programs/a-private-name-inherited-not-redeclared` is that
            // control -- the program agreed with node either way, because a
            // phantom slot is wrong without being observable.
            if matches!(field.name, PropertyKey::Private(_)) && field.declared_by.is_some() {
                ordered.push(field);
                continue;
            }
            if !ordered.iter().any(|kept| kept.name == field.name) {
                ordered.push(field);
            }
        }
        Ok(ordered)
    }

    /// The fields in the order the program's literals write them, where they
    /// agree, and unchanged where they do not.
    ///
    /// **No base, so nothing constrains the order but the program, and the
    /// program has an opinion.** `Object.keys` walks the layout's field list,
    /// because a compiled object has no insertion order, and JavaScript orders
    /// own string keys by insertion. One layout is one order, so the two agree
    /// only when the layout *is* the order the literals are written in. The
    /// checker's order is not that: for `interface E extends B { c }` it puts
    /// `c` first, so `{ a, b, c }` answered `c, a, b`.
    ///
    /// It also makes the interface-extension case a genuine prefix of its base
    /// for free — which a rule that laid inherited fields first bought at the
    /// cost of exactly this key order, measured and reverted in record 0258.
    /// Both questions want the same order, and neither wants the declaration's.
    ///
    /// Looked up by the **field-name set** rather than by the type id, because
    /// an object literal has a type of its own and is merged into the declared
    /// type's layout later, structurally, by the same rule this key uses.
    /// Keying by the literal's id found nothing at all: the collector was right
    /// and the lookup missed.
    ///
    /// A field the order does not mention keeps the position it had — a literal
    /// that omits an optional field says nothing about where that field goes.
    pub(super) fn as_the_program_writes_them(&self, mut fields: Vec<Field>) -> Vec<Field> {
        let mut signature: Vec<String> = fields
            .iter()
            .filter_map(|field| field.name.public_name().map(str::to_owned))
            .collect();
        signature.sort();
        let Some(written) = self.written_order.agreed.get(&signature) else {
            return fields;
        };
        let mut ordered: Vec<Field> = Vec::with_capacity(fields.len());
        for name in written {
            if let Some(at) = fields.iter().position(|field| field.name.is_name(name)) {
                ordered.push(fields.remove(at));
            }
        }
        ordered.append(&mut fields);
        ordered
    }

    /// What `ty` does at each dispatch slot: the function that slot's member resolves
    /// to for this class, and `None` at every slot this class takes no part in -- which
    /// is all of them for most classes, since nothing in their hierarchy is overridden.
    ///
    /// **A raising slot is looked up by the member it copies.** `hierarchy.declares`
    /// holds the names the program wrote, so the suffixed key resolves through the plain
    /// one ([`without_the_raising_suffix`](super::without_the_raising_suffix), which [`Hierarchy::slot_for`] reads too) and
    /// the suffix goes back on the emitted name. Where that copy does not exist -- an
    /// override that cannot raise gets none -- [`fill_raising_member_slots`](super::fill_raising_member_slots) replaces it
    /// with the ordinary entry afterwards, which runs and never raises. It cannot be
    /// decided here: a layout is demanded while lowering and the copies are not all
    /// built yet, which is the ordering `declare_raising_entries` has for the uniform
    /// entries.
    ///
    /// Split out of [`Self::layout_of`] for the reason [`Self::foreign_owner`] was: that
    /// function's line limit, and "what does this class put in the table" is its own
    /// question.
    pub(super) fn overridden_entries(
        &self,
        ty: TypeId,
        fields: &[Field],
        base: Option<TypeId>,
        name: &str,
    ) -> Vec<Option<String>> {
        let mut methods = vec![None; self.hierarchy.table_size()];
        let mut reserved = Vec::new();
        for ((root, member, raising), slot) in &self.hierarchy.slots {
            if let Some((family, writes)) = self.hierarchy.access_families.for_key(*root, member) {
                let direct = family.supplies.iter().find(|supply| supply.owner == ty);
                let supply = direct.or_else(|| self.field_reservation(ty, fields, family));
                if let Some(supply) = supply {
                    if direct.is_none() {
                        reserved.push(*slot as usize);
                    }
                    methods[*slot as usize] = Some(access_family_functions::placeholder(
                        self.hierarchy,
                        family,
                        supply,
                        writes,
                        *raising,
                    ));
                }
                continue;
            }
            if !self.hierarchy.descends_from(ty, *root) {
                continue;
            }
            if let Some(target) = literal_methods::target(self, ty, *root, member, *raising, fields)
            {
                methods[*slot as usize] = Some(target.name(self));
            }
        }
        // Anonymous schemas acquire reservations only as an alias of declared
        // face or actual source-supplier storage, including the complete
        // method table. The fixed set was
        // computed before bodies: visiting an anonymous schema first must not
        // decide whether it shares a row. No new concrete supplier is licensed.
        if !self.hierarchy.faces.contains(&ty)
            && !reserved.is_empty()
            && !self.hierarchy.field_aliases.iter().any(|layout| {
                may_merge(&layout.name, name) && layout.same_shape(fields, &methods, base)
            })
        {
            for slot in reserved {
                methods[slot] = None;
            }
        }
        methods
    }

    /// A structural schema may have no allocation of its own, including an
    /// instantiated callback return record. Pure stored or missing reads
    /// still reserve the same entries as an equivalent literal layout;
    /// only actual suppliers fill that layout with an executable body later.
    fn field_reservation<'b>(
        &self,
        ty: TypeId,
        fields: &[Field],
        family: &'b access_families::Family,
    ) -> Option<&'b access_families::Supply> {
        if class_symbol(self.snapshot, ty).is_some()
            || !access_families::reserves(self, ty, family.face)
        {
            return None;
        }
        let property = interfaces::property(self.snapshot, ty, &family.member);
        if property.is_none()
            && family.writes.is_none()
            && !fields.iter().any(|field| field.name == family.member)
        {
            // A default getter reads no owner storage. Reserve it only where
            // the semantic and physical record both lack the property; a
            // prototype getter is present even though it occupies no field.
            return family.supplies.iter().find(|supply| {
                matches!(supply.reader, access_families::Reader::Undefined)
                    && supply.setter.is_none()
            });
        }
        let property = property?;
        if property.kind != MemberKind::Field {
            return None;
        }
        let field = fields.iter().find(|field| field.name == family.member)?;
        let absent = absent_of_result(self.snapshot, property.ty);
        family.supplies.iter().find(|supply| {
            matches!(supply.reader, access_families::Reader::Stored)
                && supply.setter.is_none()
                && supply.ty == field.ty
                && supply.absent == absent
        })
    }

    /// The field a member name reads, by every spelling a layout answers to.
    ///
    /// Three, and they are asked in this order:
    ///
    /// - **a tuple's position.** `pair[0]` arrives as a member named `0`, and the
    ///   layout spells its fields `_0`, `_1` -- because `v->1` is not C -- so the
    ///   number is turned back into the position it always was rather than looked
    ///   up as a name nobody wrote. Bounded here rather than at the indexing,
    ///   which would read past the layout: a tuple's length is part of its type,
    ///   so an index outside it is a program the checker should have rejected, and
    ///   one that arrives anyway is refused by name rather than answered with
    ///   whatever is adjacent in memory.
    /// - the **name**, which is every ordinary member.
    /// - a **symbol key**, whose spelling is not a name a program writes.
    ///
    /// **Extracted because two paths need it and only one had it.** This lived
    /// inside [`Self::member_of`], so a *read* of `t[1]` resolved and a **call**
    /// of `t[1]()` did not: `lower_object_method` asked the hierarchy for a method
    /// named `1`, found none, and refused with "a method `1` with no declaration
    /// in the hierarchy" -- for a tuple element holding a closure, which is what
    /// `[state, setState]` is. Two derivations of "which field is this name" would
    /// have differed on exactly the spelling neither author writes by hand.
    pub(super) fn field_named(
        &mut self,
        type_id: TypeId,
        layout: &Layout,
        member: &PropertyKey,
    ) -> Option<u32> {
        member
            .public_name()
            .and_then(|name| name.parse::<usize>().ok())
            .filter(|_| self.is_tuple(type_id))
            .filter(|at| *at < layout.fields.len())
            .and_then(|at| u32::try_from(at).ok())
            .or_else(|| layout.index_of_key(member))
    }

    pub(super) fn member_of(
        &mut self,
        id: NodeId,
        value: ValueId,
        member_name: &str,
    ) -> Result<ValueId, Diagnostic> {
        self.read_from.insert(id, value);
        let key = self.required_access_key(id, member_name)?;
        if let Some(read) = self.erased_cast_field_read(id, value, &key)? {
            return Ok(read);
        }
        self.member_storage_of(id, value, member_name)
    }

    #[expect(
        clippy::too_many_lines,
        reason = "keep semantic text and key projection beside its existing dispatch"
    )]
    fn member_storage_of(
        &mut self,
        id: NodeId,
        value: ValueId,
        member_name: &str,
    ) -> Result<ValueId, Diagnostic> {
        // The other half of the iterator-result decision, and the half that
        // makes the first one honest. See `refuse_unguarded_iterator_value`.
        self.refuse_unguarded_iterator_value(id, value, member_name)?;
        if let Some(child) = self.template_child(id, value, member_name) {
            return Ok(child);
        }
        if let Some(place) = self.program_objc_instance_place(id, value, member_name)? {
            return self.read_place(id, &place);
        }
        if matches!(self.values[value.0 as usize].ty, HirType::NativePointer(_)) {
            let place = self.native_member_place(id, value)?;
            return self.read_place(id, &place);
        }
        if matches!(
            self.values[value.0 as usize].ty,
            HirType::Managed(ManagedType::Buffer)
        ) {
            return self.buffer_property(id, value, member_name);
        }

        if matches!(
            self.values[value.0 as usize].ty,
            HirType::Managed(ManagedType::DataView)
        ) {
            return self.data_view_property(id, value, member_name);
        }

        if let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[value.0 as usize].ty.clone()
        {
            if let Some(read) = self.interface_field_read(
                id,
                value,
                type_id,
                &self.required_access_key(id, member_name)?,
            )? {
                return Ok(read);
            }
            let layout = self.layout_of(id, type_id)?;
            let Some(field) = self.field_named(
                type_id,
                &layout,
                &self.required_access_key(id, member_name)?,
            ) else {
                return self.member_that_is_not_a_field(id, value, type_id, member_name);
            };
            self.no_aggregate_errors_read(id, type_id, &layout, field, member_name)?;
            let ty = layout.fields[field as usize].ty.clone();
            let origin = self.origin(id);
            // An erased field read where the checker narrowed is the same
            // question an erased *binding* read is, and takes the same answer.
            // `if (o.limit !== undefined) o.limit * 2` reads a number, while
            // the declaration says the field may be absent.
            let read = self.push(
                OpKind::FieldGet {
                    object: value,
                    field,
                },
                ty,
                origin,
            );
            return self.narrowed(id, read);
        }

        if let HirType::Managed(ManagedType::Map(_, _) | ManagedType::Set(_)) =
            self.values[value.0 as usize].ty
        {
            return self.table_size(id, value, member_name);
        }

        if let HirType::Managed(ManagedType::Symbol) = self.values[value.0 as usize].ty {
            return self.symbol_property(id, value, member_name);
        }

        if let HirType::Managed(ManagedType::View(_) | ManagedType::AnyView) =
            self.values[value.0 as usize].ty
        {
            return self.any_view_property(id, value, member_name);
        }
        // **`t.a` on an index-signature type is `t["a"]`**, which already
        // lowers. They are one operation in JavaScript -- a property access
        // with a literal key -- and only the *spelling* differed here: the
        // bracketed form reached `element_of`'s table arm and the dotted form
        // fell through to "a property of a value with no fields", which is a
        // sentence about a `Record<string, T>` that has no fields *because that
        // is what an index signature is*.
        //
        //     const env: Readonly<Record<string, string | undefined>>
        //     env.NODE_USE_ENV_PROXY === "1"
        //
        // is `http`'s `useEnvironmentProxy`, and what it costs is not one
        // function. `globalAgent`'s initializer is a ternary on that call, so a
        // doomed value reaches a branch, so `excise_from_initializer` cannot cut
        // the statement -- and `module#init` is dropped **whole**, leaving every
        // deferred global in the program unwritten and every function reading
        // one refused with it. Two modules of fourteen lost their initializer
        // that way and `http` is one; see record 0272.
        //
        // The result is erased and `narrowed` puts back whatever the checker has
        // already taken away, exactly as the bracketed form does -- `V |
        // undefined` is what the language says a lookup answers and what
        // `nts_map_get` returns.
        if let HirType::Managed(ManagedType::Table(_, _)) = self.values[value.0 as usize].ty {
            return self.table_member(id, value, member_name);
        }
        let sequence = matches!(
            self.values[value.0 as usize].ty,
            HirType::Managed(ManagedType::Array(_) | ManagedType::Template | ManagedType::String)
        );
        // **A field every arm of a union puts in the same place.** A
        // discriminated union is written with the discriminant declared first
        // in every member -- that is what makes it discriminated -- so `kind`
        // is at offset zero in all of them however much they differ afterwards.
        // The union erases, because there is no single layout to represent it
        // as; the field is at one offset regardless.
        //
        // `OpKind::SharedFieldGet` carries the arms and the index rather than
        // an `Unerase` naming one of them, because the two backends need
        // different instructions and only one of them can reinterpret a
        // pointer. The first spelling of this was the unerase, and it threw
        // `ClassCastException` on the JVM seventeen times in one example --
        // record 0289.
        if member_name != "length"
            && self.values[value.0 as usize].ty == HirType::Erased
            && let Some((arms, field, ty)) = self.shared_field(id, member_name)
        {
            let origin = self.origin(id);
            return Ok(self.push(OpKind::SharedFieldGet { value, arms, field }, ty, origin));
        }
        // **And the case that one declines.** Every arm declares the member and
        // they disagree about where it sits, so there is no single index -- which
        // is a refusal only while the operation has to name one. `OpenFieldGet`
        // carries an index per arm and each backend tests which arrived, so the
        // two together cover a union whose members all store the member.
        //
        // After the shared attempt, never instead of it: agreeing arms cost a
        // pointer read on C and LLVM and this costs a test chain, so the cheaper
        // operation has to be tried first.
        if member_name != "length"
            && self.values[value.0 as usize].ty == HirType::Erased
            && let Some((arms, ty)) = self.open_field(id, member_name)
        {
            let origin = self.origin(id);
            return Ok(self.push(
                OpKind::OpenFieldGet {
                    object: value,
                    arms,
                },
                ty,
                origin,
            ));
        }
        if member_name != "length" {
            return Err(self.not_a_length(id, value, member_name, sequence));
        }
        if !sequence && self.proven_array_length(id, value) {
            let origin = self.origin(id);
            return Ok(self.push(OpKind::Length(value), HirType::NUMBER, origin));
        }
        if !sequence {
            return Err(self.unsupported(id, "`length` of something without one"));
        }
        let origin = self.origin(id);
        Ok(self.push(OpKind::Length(value), HirType::NUMBER, origin))
    }

    /// The declared type of the field an object literal's property fills.
    ///
    /// Split out of [`Self::contextual_type`] only for its length; the reason
    /// is in the comment there.
    pub(super) fn declared_field_type(&self, parent: NodeId, depth: u32) -> Option<HirType> {
        let owner = self.syntactic_parent(parent)?;
        let outer = self
            .contextual_type(owner, depth + 1)
            .or_else(|| self.type_of(owner))?;
        let type_id = match outer {
            // A record's literal: each property is an entry, held as the
            // record's value, as an assigned entry is, whatever its name.
            // Asked of an object type only, `{ held: null }` in a
            // `Record<string, number | null>` had nothing to stand in for and
            // became a null of the record's own table type.
            HirType::Managed(ManagedType::Table(_, value)) => return Some(*value),
            HirType::Managed(ManagedType::Object(type_id)) => type_id,
            _ => return None,
        };
        let name = self
            .children(parent)
            .first()
            .and_then(|at| self.literal_name(*at))?;
        let record = self.snapshot.types.get(type_id.0 as usize)?;
        let TypeKind::Object { properties } = &record.kind else {
            return None;
        };
        let declared = properties
            .iter()
            .find(|property| property.name.is_name(name.as_ref()))?;
        // **The same answer `fields_of` gave the slot**, which is the fix the
        // `a-property-typed-exactly-null` fixture asked for in as many words:
        // "the contextual type at the literal should come from the layout the
        // field path already decided, rather than from the checker's type a
        // second time. The field path maps `Void | Never` to `Erased` and
        // nothing tells the literal; two derivations of one fact, disagreeing in
        // the gap between them."
        //
        // So `{ value: null }` got a field and the `null` written into it was
        // still refused, because this asked the checker again and got nothing.
        if self.holds_only_absences(declared.ty) {
            return Some(HirType::Erased);
        }
        match self.represent_passed(declared.ty)? {
            HirType::Void | HirType::Never => Some(HirType::Erased),
            held => Some(held),
        }
    }
}

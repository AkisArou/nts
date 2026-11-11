//! Collect class ancestry and inherited dispatch and storage facts.

use super::{
    ClosureInfo, FuncBuilder, Layout, LoweringSnapshot, MemberKey, MemberKind, NodeId, NodeKind,
    Program, SemanticSnapshot, TypeId, TypeKind, access_families, collect_anonymous_objects,
    collect_interfaces, collect_stored_members, declares_a_class, generator_indices,
    hierarchy_class_name, infer_implements, instance_type_of, instantiation_suffix,
    literal_methods, member_dispatch_key, needs_closure_slots, nominal_or_stand_in,
    provided_error_identities, syntax, template_instances, widest_closure,
};

/// The class hierarchy, as far as method dispatch needs it.
///
/// The checker's property list is flattened, so a derived type's members give no
/// hint which class declared them -- and the name of the function to call is
/// exactly "the class that declared it". This recovers that, and answers the
/// other question a call site has to ask: whether anything overrides the method,
/// because a method nothing overrides is a static call and a method something
/// overrides is not.
#[derive(Debug, Default)]
pub(super) struct Hierarchy {
    /// A class's superclass, by instance type.
    pub(super) base: rustc_hash::FxHashMap<TypeId, TypeId>,
    /// Checker and synthesized identities for the runtime-provided errors.
    /// Their declarations in lib.d.ts do not express the nominal ancestry.
    pub(super) provided_errors: rustc_hash::FxHashMap<TypeId, usize>,
    /// The interfaces a class `implements`, and the interfaces an interface
    /// `extends`.
    ///
    /// Separate from [`Self::base`] because it is not one edge: a class
    /// implements as many interfaces as it likes, and none of them contributes
    /// storage. What they contribute is a *dispatch root* -- a method declared
    /// on an interface is a method every implementer must be reachable through,
    /// which is exactly what a slot is.
    ///
    /// What it contributes is a *dispatch root*. It does **not** follow that an
    /// interface has no fields, and this comment said it did.
    ///
    /// `interface Named { name: string }` is laid out with a `name` field like
    /// anything else, and `class Thing { id: number; name: string }` puts its
    /// `name` at a different offset. So an upcast to an interface is a pointer
    /// cast with a prefix to disagree about, and it disagreed: the compiled
    /// addon read a `double` as an `NtsString *` and exited on SIGSEGV where
    /// node answered 6. Record 0257.
    ///
    /// Base-first layout is what makes an upcast free, and it is a fact about a
    /// **base** -- `Layout.base`, one edge, contributing storage. This is the
    /// other edge, as many as you like, contributing none, and the sentence that
    /// used to be here borrowed the first one's guarantee for the second.
    /// `coerce` checks the prefix now instead of assuming it.
    pub(super) implements: rustc_hash::FxHashMap<TypeId, Vec<TypeId>>,
    /// The methods a class declares itself, as opposed to inherits.
    pub(super) declares: rustc_hash::FxHashMap<TypeId, Vec<crate::hir::member_key::MemberKey>>,
    /// Which of those types are **interfaces**: a shape with members and no
    /// body of its own, whether a program declared it or the frontend carried
    /// it in.
    ///
    /// Only used to tell a missing *implementation* from a missing
    /// *declaration*. A class's method that nothing declares is a compiler
    /// bug; an interface's method that nothing implements is a program with
    /// no implementer, and only the second has a sentence worth printing.
    pub(super) faces: rustc_hash::FxHashSet<TypeId>,
    /// The faces that are anonymous object types a cast reads an erased value
    /// as (`caught as { stack?: string }`), rather than declared interfaces:
    /// any object may arrive, so their field families are read-only and a
    /// write through one is refused (`access_families::family`).
    pub(super) cast_faces: rustc_hash::FxHashSet<TypeId>,
    /// Source spellings and locations, independent of selector ABI names.
    pub(super) cast_descriptions: rustc_hash::FxHashMap<TypeId, std::sync::Arc<str>>,
    /// The members a type declares as a *method* and lays out as **storage**
    /// -- a slot holding a closure -- because an object literal built at the
    /// type supplies them with an environment.
    ///
    /// `f(x): number` is a call the dispatch table holds and `f: (x) => number`
    /// is a field holding a closure; the checker says which, and `fields_of`
    /// lays out only the second. But a literal that writes
    /// `{ read() { return base + 1 } }` at `interface Reader { read(): number }`
    /// has given `read` an environment, and a table method has none. The only
    /// representation that can carry it is the field.
    ///
    /// **A property of the type, decided from every literal of it.** One
    /// layout serves every value of a type, so a member cannot be storage in
    /// one literal and a table entry in another; the question is *does any
    /// literal of this type supply this member with an environment*, and it
    /// is answered here, before the first layout is built, by
    /// [`collect_stored_members`]. Keyed by the type id
    /// `literal_member_owner` answers, which is the one `lower_object_method`
    /// lays out and asks.
    pub(super) stored: rustc_hash::FxHashMap<TypeId, Vec<nts_semantic_schema::PropertyKey>>,
    /// Every contextual owner actually constructed by an object literal.
    /// Collected with stored members, using the same owner decision as the
    /// literal's lowering. Inference needs the complete receiver set, including
    /// named owners whose structural table rows are not built yet.
    pub(super) literal_methods: std::sync::Arc<literal_methods::Supplies>,
    /// A complete, shared contract for reads and writes through a field face.
    pub(super) access_families: std::sync::Arc<access_families::Families>,
    /// Each instantiation of a declared generic interface, to the
    /// declaration's own type -- the one `faces` holds.
    ///
    /// **A field face too, but not a method face.** `faces` holds only the
    /// type of each `interface` node, which for `interface Lazy<T, P>` is the
    /// declaration: no value is ever typed by it. Its values are typed by
    /// `Lazy<unknown, unknown>` and `Lazy<string, string>`, so a read through
    /// one found no family and was the instance's own offset on whatever
    /// object arrived -- a crash when a literal of the other instantiation
    /// arrived through `unknown`. Kept apart from `faces`, which the method
    /// slots read: an instantiation declares its methods on the declaration.
    pub(super) face_instances: rustc_hash::FxHashMap<TypeId, TypeId>,
    /// Each type a generic body names, to every instance some copy of the body
    /// makes of it (`Substitution::instance_of`).
    ///
    /// A read in `resolveLazy<T>(lazy: Lazy<T, unknown>)` is typed by the
    /// checker as the open `Lazy<T, unknown>`, which no value ever has: the
    /// copy for `T = unknown` holds `Lazy<unknown, unknown>`. A family is
    /// keyed by what values have, so a site in a generic body names each
    /// instance its copies make.
    pub(super) template_instances: rustc_hash::FxHashMap<TypeId, Vec<TypeId>>,
    /// Declared-face and actual source-supplier storage after reservations,
    /// computed once before bodies.
    /// Anonymous schemas may reserve entries only to alias one of these rows.
    /// This set is independent of the order a body demands its layouts.
    pub(super) field_aliases: std::sync::Arc<Vec<Layout>>,
    /// A class's name, which is half of the function name a call emits.
    pub(super) name: rustc_hash::FxHashMap<TypeId, String>,
    /// The dispatch slot of each overridden method, keyed by the class that
    /// *first* declares it.
    ///
    /// Keyed by the root rather than by the overrider, because a slot has to
    /// mean the same thing everywhere in a hierarchy: a `Shape*` and a
    /// `Square*` both look up `area` at the same index, which is the whole
    /// mechanism.
    pub(super) slots: rustc_hash::FxHashMap<(TypeId, crate::hir::member_key::MemberKey, bool), u32>,
    /// The classes that declare a constructor.
    ///
    /// A class without one has nothing to run at `new`: the allocation is
    /// zeroed and that is the whole of it. Calling a constructor that was never
    /// declared is a link error, and an implicit one that forwards to a base's
    /// is a call to *the base's* rather than to a function of its own.
    pub(super) constructs: rustc_hash::FxHashSet<TypeId>,
    /// The one slot every closure's `call` goes in, where the program has
    /// closures at all.
    ///
    /// One rather than one per function type, because there is nothing to tell
    /// apart: a class is never also a closure, and a call through the slot
    /// spells the signature it is making, so two closure types sharing an index
    /// cannot be confused for each other. A slot per type would make every
    /// dispatch table in the program as long as the number of function types in
    /// it, for no distinction anyone can observe.
    pub(super) closure_slot: Option<u32>,
    /// The one slot every generator's resumption goes in, where the program has
    /// generators at all.
    ///
    /// One rather than one per element type, for the reason the closure slot
    /// gives: every resumption has the *same* signature — it takes the frame and
    /// answers whether the generator is done — because the element is read from
    /// the frame's `yielded` field afterwards and never returned. Two element
    /// types sharing this index cannot be confused for each other.
    ///
    /// Beside `closure_slot` rather than reusing it. A frame is not a closure:
    /// `is_closure_type` decides `typeof`, and a generator answers `"object"`.
    pub(super) generator_slot: Option<u32>,
    /// The slot every closure's **erased** `call` goes in: the same body reached
    /// through the one ABI a site that does not know the closure can spell.
    ///
    /// **Two, not one, and not one per function type.** `closure_slot`'s doc is
    /// right that a table as long as the program's function-type count is
    /// unaffordable, and right that one index is enough to *dispatch*. It is wrong
    /// that one index is enough to **agree**: its last clause says two closure
    /// types sharing an index "cannot be confused for each other" because the call
    /// spells the signature, and spelling the signature is how they are confused.
    /// `NTS_ARRIVALS` counts 25 of `zlib`'s 240 admissions disagreeing.
    ///
    /// So a receiver whose class is known keeps `closure_slot` and costs nothing,
    /// and a receiver known only as a signature uses this one, which is correct
    /// whatever arrived. Two entries per closure rather than N, which is the
    /// distinction that doc says nobody can observe.
    pub(super) erased_call_slot: Option<u32>,
    /// The slot holding a closure's **raising** uniform entry, for a call inside a
    /// `try` that reaches it through a function value.
    ///
    /// A raising copy is made of plain functions and a closure's body is not one, so
    /// such a call had nothing to name and was refused. This is the second index the
    /// uniform ABI needs: [`Self::erased_call_slot`]'s entry ends the program on an
    /// uncaught `throw`, and a `try` needs the opposite, which cannot be one body --
    /// the same argument [`FuncBuilder::raises`] makes for a plain function.
    ///
    /// Beside it rather than replacing it, because the ordinary path must stay free:
    /// making every erased entry raising would put a flag load and a branch after
    /// every closure call in the program, and A6's arity work exists to keep that
    /// path at one `double`.
    pub(super) raising_call_slot: Option<u32>,
    /// Whether a call inside a `try` may dispatch at [`Self::raising_call_slot`]:
    /// every raising body this program would build can carry what it calls.
    ///
    /// **Here rather than on `FuncBuilder`**, which every builder already carries a
    /// `Hierarchy` for, and which clippy counts bools in. Set by
    /// `Shared::whole_program` on its own clone, because the answer comes from
    /// `raising_copies` and that runs after `collect_hierarchy` -- so the field is
    /// `false` in the hierarchy the module-scope probe uses, which asks nothing of it.
    /// See [`what_holds_the_gate_off`](super::what_holds_the_gate_off).
    pub(super) closures_carry: bool,
    /// Where [`Self::closures_carry`] is off, which closure holds it off and the
    /// call that does: [`Naming::gate_holder`](super::Naming::gate_holder), carried here for the refusal.
    pub(super) gate_holder: Option<std::sync::Arc<str>>,
    /// How many erased parameters the entry in [`Self::erased_call_slot`] takes:
    /// **the widest closure in the program**, and not a constant.
    ///
    /// Fixed *per program* rather than per closure, because the point of the
    /// entry is that a site knowing only the signature can call it -- a site that
    /// had to know the arity would be back to knowing the body. But it does not
    /// have to be fixed across programs, and making it one was expensive: at a
    /// global eight, `benchmarks/cases/closure-merge` marshalled **nine** `NtsValue`s
    /// per call in a hot loop where the direct call passed one `double`, and the
    /// row went 22.25 us to 49.07 us. Its own header had predicted the shape of
    /// the objection -- "it should not be free ... what it should *not* be is
    /// proportional to the number of arms" -- and it was not the arms, it was this.
    ///
    /// **Why the widest is enough.** A closure assigned to a signature declares no
    /// more parameters than that signature does (a function wanting more is not
    /// assignable to one passing fewer), and a body reads no more than it writes.
    /// So a site passing this many always passes every parameter any admissible
    /// body reads; where the signature declares more, the extra arguments are ones
    /// JavaScript drops anyway.
    ///
    /// Read from the checker's signature for each closure's own type -- the same
    /// source the lowering builds `#call`'s parameters from. It is therefore one
    /// fact read twice, which this file has been bitten by four times this week,
    /// and the reason that is tolerable here is that the **disagreement cannot be
    /// silent**: [`erased_call`](super::erased_call) holds `written.len() <= width` and emits a named
    /// abort when it does not, so a program where the two part company says so.
    pub(super) erased_call_arity: usize,
    /// The classes the program writes over an Objective-C class that declare
    /// fields, by the name the runtime knows each by -- which is what a handle
    /// to one carries -- with each one's index into
    /// [`super::SYNTHETIC_OBJC_STATES`](crate::hir::SYNTHETIC_OBJC_STATES) and its own instance type. Numbered
    /// here, once, so every builder that reads a field names the same state
    /// type.
    pub(super) objc_states: rustc_hash::FxHashMap<String, (usize, TypeId)>,
    /// Each Windows Runtime interface's IID by its handle tag, as the
    /// bindings' `@ntsQuery` methods pair them: what a handle upcast to that
    /// interface asks its object for (`coerce_to_native_pointer`).
    pub(super) com_iids: rustc_hash::FxHashMap<String, String>,
    /// For each class in [`Self::objc_states`], by its instance type, the
    /// classes whose fields its state holds, root first: the program's
    /// classes it descends from, then itself. One object per instance, laid
    /// out base-first as a class of the program's is, so a field of `Base`
    /// is at one index whether the instance is a `Base` or a `Derived`.
    pub(super) objc_chains: rustc_hash::FxHashMap<TypeId, Vec<TypeId>>,
    /// Every class the program writes over an Objective-C class: the closed
    /// world a call to one of their methods dispatches over
    /// (`FuncBuilder::objc_dispatch`).
    pub(super) objc_classes: Vec<NodeId>,
}

/// Where a member's declaration was written, for the questions whose answer is
/// the prototype: a class's method lives there and a literal's does not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Written {
    InALiteral,
    InAClass,
}

impl Hierarchy {
    /// A type a field family can be keyed by: a declared interface, or an
    /// instantiation of one (`face_instances`).
    pub(super) fn is_field_face(&self, ty: TypeId) -> bool {
        self.faces.contains(&ty) || self.face_instances.contains_key(&ty)
    }
    /// The declaration an instantiated face's methods are declared on, and any
    /// other face itself.
    pub(super) fn declared_face(&self, ty: TypeId) -> TypeId {
        self.face_instances.get(&ty).copied().unwrap_or(ty)
    }
    /// Whether a type's method `member` is laid out as storage. See `stored`.
    pub(super) fn stores(&self, ty: TypeId, member: &nts_semantic_schema::PropertyKey) -> bool {
        self.stored
            .get(&ty)
            .is_some_and(|members| members.iter().any(|stored| stored == member))
    }

    /// Whether nothing but an object literal can be a value of `ty`, and
    /// nothing reads a value of `ty` as some other type.
    ///
    /// A class implementing it and an interface extending it are both written
    /// into `implements`, so one lookup covers both; a base `ty` itself
    /// extends is the same map's key. Any of the three means a value of the
    /// type may be an object the type's own layout did not build, or be read
    /// through a layout that is not its own -- and a member that is a field
    /// in one and a slot in the other is a `FieldGet` at an index that means
    /// something else.
    pub(super) fn stands_alone(&self, ty: TypeId) -> bool {
        !self.implements.contains_key(&ty)
            && !self.implements.values().any(|faces| faces.contains(&ty))
    }

    /// Whether any class declares `then`, and so may need a thenable job.
    ///
    /// A job is a closure the census in `Shared::whole_program` appends after
    /// the closure slot is numbered, so the slot is decided from this rather
    /// than from the census's answer, which needs the finished hierarchy. It is
    /// a superset of the census, so a job always has its slot; the price is one
    /// slot in a program whose `then` turned out to be refused.
    pub(super) fn declares_a_then(&self) -> bool {
        self.declares.iter().any(|(class, names)| {
            !self.faces.contains(class)
                && names
                    .iter()
                    .any(|name| name == &crate::hir::member_key::MemberKey::named("then"))
        })
    }

    /// The complete base chain, with each class visited once. A malformed cycle
    /// cannot turn a valid long hierarchy into a truncated search.
    pub(super) fn ancestors(&self, ty: TypeId) -> impl Iterator<Item = TypeId> + '_ {
        let mut seen = rustc_hash::FxHashSet::default();
        std::iter::successors(Some(ty), |here| self.base.get(here).copied())
            .take_while(move |here| seen.insert(*here))
    }

    /// Interfaces above `ty`, breadth first and once each, preserving written
    /// edge order for the nearest-declaration query.
    fn inherited_interfaces(&self, ty: TypeId) -> impl Iterator<Item = TypeId> + '_ {
        let mut pending: std::collections::VecDeque<_> = self
            .implements
            .get(&ty)
            .into_iter()
            .flatten()
            .copied()
            .collect();
        let mut seen = rustc_hash::FxHashSet::default();
        std::iter::from_fn(move || {
            while let Some(here) = pending.pop_front() {
                if seen.insert(here) {
                    pending.extend(self.implements.get(&here).into_iter().flatten().copied());
                    return Some(here);
                }
            }
            None
        })
    }

    /// Whether `ty` is `ancestor` or extends it, by the base chain alone: a
    /// class's subclasses, and nothing that merely implements an interface.
    pub(super) fn descends(&self, ty: TypeId, ancestor: TypeId) -> bool {
        self.ancestors(ty).any(|here| here == ancestor)
    }

    /// Whether `ty` is a provided error or a class whose chain reaches one: the
    /// `Error` family, whose instances print by `Error.prototype.toString`.
    pub(super) fn is_an_error(&self, ty: TypeId) -> bool {
        self.ancestors(ty)
            .any(|here| self.provided_errors.contains_key(&here))
    }

    /// The nearest class at or above `ty` that declares `member`.
    pub(super) fn declaring(
        &self,
        ty: TypeId,
        member: &crate::hir::member_key::MemberKey,
    ) -> Option<TypeId> {
        self.ancestors(ty)
            .find(|here| self.declares_itself(*here, member))
            // An interface inherits declarations from its written superinterfaces.
            // A class's implemented interfaces contribute no implementation.
            .or_else(|| self.declaring_above(ty, member))
    }

    /// The nearest interface above the interface `ty` that declares `member`.
    /// Equal declarations follow written edge order, as TypeScript requires.
    pub(super) fn declaring_above(
        &self,
        ty: TypeId,
        member: &crate::hir::member_key::MemberKey,
    ) -> Option<TypeId> {
        if !self.faces.contains(&ty) {
            return None;
        }
        self.inherited_interfaces(ty)
            .find(|here| self.declares_itself(*here, member))
    }

    /// The highest class at or above `ty` that declares `member`.
    ///
    /// The slot belongs to this one. `declaring` finds the *implementation* to
    /// call; this finds the class the slot is numbered against.
    /// An interface needs no special case here, which was measured rather than
    /// assumed. A version of this walked the implemented interfaces looking for
    /// the highest one declaring `member`, and sabotaging that walk to return
    /// nothing left every case in `tests/programs/interface-dispatch` agreeing --
    /// including a class that both extends a class and implements an interface
    /// that extends another, written specifically to reach it.
    ///
    /// It is unnecessary because the slot loop below iterates `declares`, and
    /// interfaces are in `declares`: the interface is asked about *itself*, so
    /// `root_declaring(Sink, "write")` answers `Sink` without anything walking
    /// up to it. The extra walk was a second route to an answer one route
    /// already gives, and a second route that agrees is not free -- it is a
    /// thing to keep agreeing.
    ///
    /// **Except for a member the interface does not declare.** A call through
    /// `Tagged` to the `label` it inherits from `Named` asks about `Tagged`,
    /// which the slot loop never numbered `label` against; the slot is
    /// `Named`'s, found by the one walk `declaring` also falls back to.
    pub(super) fn root_declaring(
        &self,
        ty: TypeId,
        member: &crate::hir::member_key::MemberKey,
    ) -> Option<TypeId> {
        let found = self
            .ancestors(ty)
            .filter(|here| self.declares_itself(*here, member))
            .last();
        // A member an interface inherits from one it extends: the slot is the
        // one the slot loop numbered against the interface that declares it
        // (`Self::declaring_above`), asked the same question.
        found.or_else(|| {
            self.declaring_above(ty, member)
                .and_then(|above| self.root_declaring(above, member))
        })
    }

    /// Whether this type declares `member` itself.
    pub(super) fn declares_itself(
        &self,
        ty: TypeId,
        member: &crate::hir::member_key::MemberKey,
    ) -> bool {
        self.declares
            .get(&ty)
            .is_some_and(|names| names.iter().any(|name| name == member))
    }

    /// The uniform entries' indices, carried onto the program.
    ///
    /// Published rather than derived, because the passes that need them -- `devirtualize`
    /// resolving a known closure class, the backends filling a null table entry -- run
    /// long after the hierarchy is gone, and deriving an index from an entry's *name*
    /// would be a second derivation of a table length.
    pub(super) fn publish_uniform_slots(&self, program: &mut Program) {
        program.closure_slot = self.closure_slot;
        program.erased_call_slot = self.erased_call_slot;
        program.raising_call_slot = self.raising_call_slot;
    }

    /// How many slots a dispatch table has.
    pub(super) fn table_size(&self) -> usize {
        self.slots.len()
            + usize::from(self.closure_slot.is_some())
            + usize::from(self.erased_call_slot.is_some())
            + usize::from(self.raising_call_slot.is_some())
            + usize::from(self.generator_slot.is_some())
    }

    /// The nearest class at or above `ty` that declares a constructor.
    pub(super) fn constructor(&self, ty: TypeId) -> Option<TypeId> {
        self.ancestors(ty)
            .find(|here| self.constructs.contains(here))
    }

    /// The dispatch slot a call on `ty` would use, if it needs one.
    pub(super) fn slot_for(
        &self,
        ty: TypeId,
        member: &crate::hir::member_key::MemberKey,
        raising: bool,
    ) -> Option<u32> {
        let root = self.root_declaring(ty, member)?;
        self.slots.get(&(root, member.clone(), raising)).copied()
    }

    /// Whether `ty` is `ancestor` or descends from it.
    pub(super) fn descends_from(&self, ty: TypeId, ancestor: TypeId) -> bool {
        self.ancestors(ty).any(|here| {
            here == ancestor
                || matches!(
                    (self.provided_errors.get(&here), self.provided_errors.get(&ancestor)),
                    (Some(child), Some(parent)) if *parent == 0 || child == parent
                )
                || self.implements_transitively(here, ancestor)
        })
    }

    /// Every interface `ty` implements, transitively and in a stable order.
    pub(super) fn interfaces_of(&self, ty: TypeId) -> Vec<TypeId> {
        let mut found: Vec<_> = self.inherited_interfaces(ty).collect();
        found.sort_unstable_by_key(|face| face.0);
        found
    }

    /// Whether `ty` implements `wanted`, directly or through an interface that
    /// extends it. The finite worklist visits every reachable interface once.
    pub(super) fn implements_transitively(&self, ty: TypeId, wanted: TypeId) -> bool {
        self.inherited_interfaces(ty).any(|face| face == wanted)
    }

    /// Whether a call on a receiver of type `ty` could reach more than one
    /// implementation of `member`.
    ///
    /// True exactly when some class below `ty` declares it and is not the one
    /// `ty` itself would reach. That is the whole condition for needing dynamic
    /// dispatch, and it is why a class hierarchy with no overriding costs
    /// nothing: every call in it is static.
    pub(super) fn overridden(&self, ty: TypeId, member: &MemberKey) -> bool {
        if let Some(root) = self.root_declaring(ty, member)
            && self.access_families.projects_method(root, member)
        {
            return true;
        }
        let Some(target) = self.declaring(ty, member) else {
            return false;
        };
        self.declares.iter().any(|(class, names)| {
            *class != target
                && (names.iter().any(|name| name == member)
                    // An interface needs a slot when a subclass supplies its
                    // inherited body, even if the base itself lacks the edge.
                    || (self.faces.contains(&ty)
                        && !self.faces.contains(class)
                        && self.base.contains_key(class)
                        && self.declaring(*class, member).is_some()))
                && self.descends_from(*class, ty)
        }) || self
            .literal_methods
            .owners()
            .any(|owner| owner != target && self.descends_from(owner, ty))
    }
}

/// The single interface a record declares as its parent.
///
/// **One predicate, two readers**, and the readers want it for two different
/// things: [`super::Program::record_parents`] publishes it so the JVM can answer
/// assignability, and `layout_of` uses it to lay the record out **parent-first**.
/// A third spelling of "which interface does this one extend" is how this file has
/// gone wrong four times in a week, so there is one.
///
/// Exactly one parent, both ends interfaces this program declares, and never
/// itself -- a type that is its own parent would not terminate either reader.
/// `snapshot.base_types` is the source, which `collect_interfaces` already
/// consults for the slot numbering.
pub(super) fn declared_record_parent(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    ty: TypeId,
) -> Option<TypeId> {
    if !hierarchy.faces.contains(&ty) {
        return None;
    }
    let [parent] = snapshot.base_types.get(&ty)?[..] else {
        return None;
    };
    (parent != ty && hierarchy.faces.contains(&parent)).then_some(parent)
}

/// Each record type's single declared parent. See [`crate::hir::Program::record_parents`]
/// for why this is a fact of its own and what may not read it.
///
/// Both ends must be interfaces this program declares. A parent that is a class
/// is `Layout.base`'s business and already recorded there; a parent nothing
/// declares -- a carried protocol, a library type with no node -- has no layout
/// for a consumer to resolve, so an entry naming it would be a name pointing at
/// nothing, which is the defect this file has fixed three times this week from
/// the other direction.
///
/// **Exactly one, or no entry.** Two or more parents is the case where a consumer
/// would have to choose, and choosing is what `relate_closures_to_signatures`
/// declines to do for closures on the same reasoning: its own comment, that two
/// candidates for one relation "would give two closures two different bases for
/// the same type", is this situation with the nouns changed.
pub(super) fn record_parents(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    program: &crate::hir::Program,
) -> std::collections::BTreeMap<TypeId, TypeId> {
    let layout_of = |ty: &TypeId| program.layouts.iter().position(|l| l.types.contains(ty));
    let mut parents = std::collections::BTreeMap::new();
    for ty in &hierarchy.faces {
        let Some(parent) = declared_record_parent(snapshot, hierarchy, *ty) else {
            continue;
        };
        // Both ends resolve to a layout, and to *different* layouts. See the
        // caller for what each half of that cost when it was missing.
        let (Some(child), Some(above)) = (layout_of(ty), layout_of(&parent)) else {
            continue;
        };
        if child != above {
            parents.insert(*ty, parent);
        }
    }
    parents
}

/// A slot for every method something overrides, numbered against the class
/// that first declares it. A method nothing overrides gets none, which is why
/// a hierarchy with no overriding pays nothing: every call in it is static and
/// no class carries a table.
fn number_slots(hierarchy: &mut Hierarchy) {
    let mut roots: Vec<(TypeId, MemberKey)> = Vec::new();
    for (class, names) in &hierarchy.declares {
        for name in names {
            let Some(root) = hierarchy.root_declaring(*class, name) else {
                continue;
            };
            if hierarchy.overridden(root, name) && !roots.contains(&(root, name.clone())) {
                roots.push((root, name.clone()));
            }
        }
    }
    // Sorted, so one compiler on one input numbers the slots one way.
    roots.sort_by(|a, b| a.0.0.cmp(&b.0.0).then_with(|| a.1.cmp(&b.1)));
    for (at, key) in roots.into_iter().enumerate() {
        hierarchy
            .slots
            .insert((key.0, key.1, false), u32::try_from(at).unwrap_or(u32::MAX));
    }
}

/// The iteration protocol's interfaces, whose members no node declares.
///
/// Every interface above is found by walking `INTERFACE_DECLARATION` nodes,
/// and `Iterable<T>` has none: it is declared in `lib.es2015.iterable.d.ts`,
/// which this snapshot carries as *types* and not as syntax. So the frontend
/// decomposes it -- see `nts_semantic_schema::protocol`, which is where the
/// same six names are decided -- and its `[Symbol.iterator]` arrived here as
/// a property of a type nothing said declared anything.
///
/// What that cost: `for (const n of it)` where `it` is a parameter declared
/// `Iterable<number>` refused with `a method __@iterator@3 with no
/// declaration in the hierarchy`, a sentence about the hierarchy for a type
/// the hierarchy had never been told about. A hand-written interface of
/// exactly the same shape refuses one link later instead, at `next`, because
/// *it* has a node and this walk finds it.
///
/// Read off the type record rather than a declaration, which is the only
/// source there is. `kind: Method` is what separates a member to dispatch
/// from a field holding a closure, and it is the same test the node walk
/// makes with `METHOD_SIGNATURE`.
pub(super) fn collect_carried_protocols(
    snapshot: &SemanticSnapshot,
    hierarchy: &mut Hierarchy,
) -> Carried {
    let mut carried = Carried::default();
    for (&ty, &count) in &snapshot.reference_parameter_counts {
        if nts_semantic_schema::iteration_protocol_of(snapshot, ty).is_some()
            && let Some(symbol) = snapshot.types[ty.0 as usize].symbol
        {
            carried
                .parameter_counts
                .entry(symbol)
                .and_modify(|known| {
                    if *known != Some(count) {
                        *known = None;
                    }
                })
                .or_insert(Some(count));
        }
    }
    for (at, record) in snapshot.types.iter().enumerate() {
        let ty = TypeId(u32::try_from(at).unwrap_or(u32::MAX));
        let Some(protocol) = nts_semantic_schema::iteration_protocol_of(snapshot, ty) else {
            continue;
        };
        let TypeKind::Object { properties } = &record.kind else {
            continue;
        };
        let Some(&arity) = snapshot.reference_parameter_counts.get(&ty) else {
            continue;
        };
        if record
            .symbol
            .and_then(|symbol| carried.parameter_counts.get(&symbol))
            != Some(&Some(arity))
        {
            continue;
        }
        let Some(arguments) = snapshot.type_arguments.get(&ty).cloned() else {
            continue;
        };
        // A receiver-bound heritage view can carry members as well. It is
        // not a distinct declared-parameter dispatch root: resolve its exact
        // declared prefix below, without guessing arity from discovery order.
        if arguments.len() != arity as usize {
            continue;
        }
        let declared: Vec<MemberKey> = properties
            .iter()
            .filter(|property| property.kind == MemberKind::Method)
            .map(|property| MemberKey::method(property.name.clone()))
            .collect();
        if declared.is_empty() {
            continue;
        }
        // Suffixed like any other instantiation: `Iterable<number>` and
        // `Iterable<string>` are two dispatch roots with two slots, and one
        // name for both would be one slot for two protocols.
        hierarchy
            .name
            .entry(ty)
            .or_insert_with(|| format!("{protocol}{}", instantiation_suffix(snapshot, ty)));
        hierarchy.declares.entry(ty).or_insert(declared);
        hierarchy.faces.insert(ty);
        if let Some(symbol) = record.symbol {
            carried
                .instances
                .entry((symbol, arguments))
                .or_default()
                .push(ty);
        }
    }
    carried
}

/// Which record of a carried protocol carries its members.
///
/// The checker writes more than one. `class S implements Iterable<Batch>`
/// records the heritage target as `Iterable<Batch, any, undefined, S>` --- the
/// declaration's parameters with the **`this` type appended**, the same shape
/// `instantiate::instantiation_arguments` truncates for a base. Either view can
/// carry members. The checker supplies declared arity explicitly; receiver-bound
/// views resolve to every canonical root at that exact declared prefix. A
/// declared argument can itself be `this`, so trailing types are not inspected
/// or stripped by kind. Contradictory or missing facts prove no dispatch root.
///
/// Left unresolved, the `implements` edge points at the placeholder: the class
/// descends from a type that is not the dispatch root, so
/// `declare_interface_methods` finds no implementer for the root and every
/// call through the interface reports a shell that was never declared. The
/// edge is recorded, the slot exists, and the two are about different ids.
#[derive(Default)]
pub(super) struct Carried {
    /// The records with the members, by symbol and their own arguments.
    ///
    /// **All of them, not the first.** The checker writes `Iterable<Batch>`
    /// more than once -- two decomposed records with identical arguments --
    /// and which one a call's receiver is typed with is not the one a
    /// heritage clause resolves to. An edge to one of the two leaves the
    /// other a dispatch root nothing implements, which is the same missing
    /// shell one identity further along.
    instances: rustc_hash::FxHashMap<(nts_semantic_schema::SymbolId, Vec<TypeId>), Vec<TypeId>>,
    /// Agreement of explicit declaration facts; None is a contradiction,
    /// never an observed-length guess. Missing metadata proves no contract.
    parameter_counts: rustc_hash::FxHashMap<nts_semantic_schema::SymbolId, Option<u32>>,
}

impl Carried {
    /// The member-carrying records `ty` names, where `ty` is a protocol at any
    /// arity. Empty for anything that is not one of them.
    pub(super) fn resolve(&self, snapshot: &SemanticSnapshot, ty: TypeId) -> &[TypeId] {
        let Some(symbol) = snapshot.types.get(ty.0 as usize).and_then(|r| r.symbol) else {
            return &[];
        };
        let Some(&arity) = snapshot.reference_parameter_counts.get(&ty) else {
            return &[];
        };
        if self.parameter_counts.get(&symbol) != Some(&Some(arity)) {
            return &[];
        }
        let Some(arguments) = snapshot.type_arguments.get(&ty) else {
            return &[];
        };
        if arguments.len() < arity as usize || arguments.len() > arity as usize + 1 {
            return &[];
        }
        let arguments = arguments[..arity as usize].to_vec();
        self.instances
            .get(&(symbol, arguments))
            .map_or(&[], Vec::as_slice)
    }
}

/// Each Windows Runtime interface's IID by its handle tag: the IID of every
/// `@ntsQuery` method, keyed by the tag of the interface it answers. The
/// bindings' one statement of an interface's IID beside its type.
fn com_interface_ids(snapshot: &SemanticSnapshot) -> rustc_hash::FxHashMap<String, String> {
    let mut ids = rustc_hash::FxHashMap::default();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        let Some(iid) = node.native.as_ref().and_then(|native| native.query.clone()) else {
            continue;
        };
        let declaration = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        // The interface itself -- `export type IPage = ComClass<...>` -- or
        // a query answering one (`as_IButton(): IButton`).
        let interface = if node.kind == NodeKind::Syntax(syntax::TYPE_ALIAS_DECLARATION) {
            snapshot.node_types.get(&declaration).copied()
        } else {
            crate::hir::generics::declared_signature(snapshot, declaration)
                .map(|signature| signature.return_type)
        };
        let Some(interface) = interface else { continue };
        if let Some(crate::hir::native::Pointee::Opaque(handle)) =
            crate::hir::native::pointer(snapshot, interface)
            && handle.family == crate::hir::native::Family::Com
        {
            ids.entry(handle.tag.clone()).or_insert(iid);
        }
    }
    ids
}

/// Note a class the program writes over an Objective-C class
/// ([`Hierarchy::objc_classes`]), and number it if it declares fields: see
/// [`Hierarchy::objc_states`].
fn note_objc_state(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder<'_>,
    class: NodeId,
    declared: TypeId,
    hierarchy: &mut Hierarchy,
) {
    if crate::hir::native::extends_objc(snapshot, class) {
        hierarchy.objc_classes.push(class);
    }
    let chain = objc_state_chain(snapshot, class);
    if chain
        .iter()
        .any(|class| probe.declares_instance_fields(*class))
        && let Some(name) = foreign_class_name(snapshot, class)
    {
        let index = hierarchy.objc_states.len();
        hierarchy.objc_states.insert(name, (index, declared));
        let types = chain
            .into_iter()
            .filter_map(|class| instance_type_of(snapshot, class))
            .collect();
        hierarchy.objc_chains.insert(declared, types);
    }
}

/// Whether a class type declares `name` itself and stores it, as the checker
/// records it: a field of the object holding a foreign class's state.
pub(super) fn declares_stored(snapshot: &SemanticSnapshot, class_ty: TypeId, name: &str) -> bool {
    matches!(
        snapshot.types.get(class_ty.0 as usize).map(|record| &record.kind),
        Some(TypeKind::Object { properties }) if properties.iter().any(|p| p.own && p.name.is_name(name.as_ref()) && p.kind.is_stored())
    )
}

/// The name a foreign runtime knows a class the program writes over one of
/// its classes by: the Objective-C class's, or -- for one over a `GObject`
/// class or a composable Windows Runtime class -- the class's own, which its
/// registration and state are keyed by. `None` for a class of the program's
/// own.
pub(super) fn foreign_class_name(snapshot: &SemanticSnapshot, class: NodeId) -> Option<String> {
    if crate::hir::native::extends_objc(snapshot, class) {
        return crate::hir::native::objc_name(snapshot, class);
    }
    if crate::hir::native::gobject_parent(snapshot, class).is_none()
        && !crate::hir::native::extends_com(snapshot, class)
    {
        return None;
    }
    snapshot
        .nodes
        .get(class.0 as usize)?
        .children
        .iter()
        .find_map(|child| {
            let node = snapshot.nodes.get(child.0 as usize)?;
            matches!(node.kind, NodeKind::Syntax(syntax::IDENTIFIER))
                .then(|| {
                    node.text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        .map(str::to_owned)
                })
                .flatten()
        })
}

/// A class the program writes over a foreign class, and -- over an
/// Objective-C class -- the program's classes it descends from, root first:
/// the classes whose fields one instance's state holds. The runtime's classes
/// above them are not in it. A `GObject` class's state is its own fields.
fn objc_state_chain(snapshot: &SemanticSnapshot, class: NodeId) -> Vec<NodeId> {
    let mut chain = vec![class];
    // A `GObject` class's chain is its ancestors the program wrote, which
    // `gobject_parent` answers for as it does for the class itself.
    let within: fn(&SemanticSnapshot, NodeId) -> bool =
        if crate::hir::native::extends_objc(snapshot, class) {
            crate::hir::native::extends_objc
        } else {
            |snapshot, base| crate::hir::native::gobject_parent(snapshot, base).is_some()
        };
    if within(snapshot, class) {
        let mut at = crate::hir::native::superclass(snapshot, class);
        while let Some(base) = at.filter(|base| within(snapshot, *base)) {
            chain.push(base);
            at = crate::hir::native::superclass(snapshot, base);
        }
    }
    chain.reverse();
    chain
}

pub(super) fn collect_hierarchy(
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    closures: &[ClosureInfo],
    qualified: &rustc_hash::FxHashMap<NodeId, String>,
) -> Hierarchy {
    let mut hierarchy = Hierarchy::default();
    let mut probe = FuncBuilder::new(snapshot, foreign);
    let instantiations = crate::hir::generics::instantiations(snapshot);
    hierarchy.provided_errors = provided_error_identities(snapshot);

    for (index, node) in snapshot.nodes.iter().enumerate() {
        if !matches!(node.kind, NodeKind::Syntax(kind) if declares_a_class(kind)) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        // An Objective-C class a binding declares dispatches through the
        // runtime, by selector: it has no table here, and a slot numbered for
        // one of its overrides (`NSView`'s `rotate` over `NSResponder`'s)
        // would widen every table in the program -- a closure's included,
        // whose call then sat in slot 8 of 9.
        // A composable Windows Runtime class a binding declares is the same:
        // its members are vtable calls and the overrides a subclass writes.
        if crate::hir::native::is_objc_class(snapshot, id)
            || crate::hir::native::is_com_class(snapshot, id)
        {
            continue;
        }
        let Some(declared) = instance_type_of(snapshot, id) else {
            continue;
        };
        note_objc_state(snapshot, &probe, id, declared, &mut hierarchy);
        // A generic class's facts belong to each *instantiation*, because that
        // is the type a `new` and a method call name. The declaration's own type
        // is never constructed and never laid out.
        let types: Vec<TypeId> = probe
            .children(id)
            .into_iter()
            .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| probe.node(child).symbol)
            .and_then(|symbol| instantiations.get(&symbol))
            .map_or_else(
                || vec![declared],
                |instances| instances.iter().map(|instance| instance.ty).collect(),
            );

        for ty in types {
            let name = hierarchy_class_name(&probe, snapshot, qualified, id, ty);
            {
                // Qualified for an instantiation, by the same construction
                // `layout_of` uses: a call site names its callee through this
                // map and the function was named through that one, so the two
                // have to agree letter for letter.
                hierarchy
                    .name
                    .insert(ty, format!("{name}{}", instantiation_suffix(snapshot, ty)));
            }
            // `extends` first, then `implements`, and a class extends at most one
            // class. An interface contributes no implementation, so it is not a
            // base for dispatch even though it is one for assignability.
            //
            // An instantiation has no base of its own recorded. The checker
            // answers `getBaseTypes` for a *declaration*, and `Box<number>` is
            // a reference to one, so `class Box<T> extends Base` left every
            // copy baseless and `b.tag()` found no declaration in the
            // hierarchy. The declaration's base is the right answer whenever it
            // does not mention a type parameter; when it does, it is
            // `Container<T>`, whose layout is a placeholder, and the copy is
            // refused for that rather than silently dispatching through it.
            if let Some(base) = snapshot
                .base_types
                .get(&ty)
                .or_else(|| snapshot.base_types.get(&declared))
                .and_then(|bases| bases.first())
            {
                hierarchy.base.insert(ty, *base);
            }

            let declared_methods: Vec<MemberKey> = probe
                .children(id)
                .into_iter()
                .filter_map(|child| member_dispatch_key(&probe, child))
                .collect();
            if probe
                .children(id)
                .into_iter()
                .any(|child| probe.kind_of(child) == Some(syntax::CONSTRUCTOR))
            {
                hierarchy.constructs.insert(ty);
            }
            hierarchy.declares.insert(ty, declared_methods.clone());
        }
    }

    collect_interfaces(snapshot, &probe, &mut hierarchy, &instantiations);
    let probe_hierarchy = Hierarchy {
        cast_faces: hierarchy.cast_faces.clone(),
        ..Hierarchy::default()
    };
    probe.hierarchy = &probe_hierarchy;
    hierarchy.template_instances = template_instances(snapshot, &instantiations);
    collect_anonymous_objects(snapshot, &probe, &mut hierarchy);
    // After both, because it edits `declares`: a member that becomes storage
    // must not also be numbered a slot. Before the slot loop for the same
    // reason.
    collect_stored_members(snapshot, &mut probe, closures, &mut hierarchy);
    std::sync::Arc::make_mut(&mut hierarchy.literal_methods)
        .collect_writes(&probe, &hierarchy.faces);
    infer_implements(snapshot, &probe, &mut hierarchy);

    hierarchy.access_families =
        std::sync::Arc::new(access_families::Families::collect(&mut probe, &hierarchy));

    number_slots(&mut hierarchy);
    std::sync::Arc::clone(&hierarchy.access_families).number_slots(&mut hierarchy);
    // One more slot on the end, if anything in the program can be a function
    // value: see [`needs_closure_slots`].
    if needs_closure_slots(snapshot, closures, &hierarchy) {
        hierarchy.closure_slot = Some(u32::try_from(hierarchy.slots.len()).unwrap_or(u32::MAX));
        // And the erased entry beside it, on exactly the same terms: a program
        // with no closures carries neither.
        hierarchy.erased_call_slot =
            Some(u32::try_from(hierarchy.table_size()).unwrap_or(u32::MAX));
        hierarchy.erased_call_arity = widest_closure(snapshot, closures);
        // And the raising entry beside it, on exactly the same terms. **After
        // it**, so a program with both gives each a distinct index -- and this is
        // the index that moves `generator_slot`, which is why a backend reads the
        // slot from `Program` rather than deriving it.
        //
        // **Ungated, and it was gated for a while.** A syntactic probe for "some
        // `try` in this program guards a call through a function value" saves a
        // word per descriptor in a program that has none -- and it cannot be made
        // sound once a *raising copy's own body* may hold such a call, because
        // which functions get copies is decided in `naming`, after this. Deciding
        // it here would be a third derivation of `raising_copies`' closure, and the
        // two coming apart means a body naming a slot the table does not carry.
        //
        // So the two slots are one condition, which is also what makes
        // `closure_callee` safe: a program that can dispatch at one can dispatch at
        // the other, and a program that can do neither refuses at both. The cost is
        // one null word in a static vtable, which is what A6's benchmark measured
        // the first of these two slots at -- `awfy-nbody`, `closures` and
        // `module-closures` each differed by exactly that and timed flat.
        hierarchy.raising_call_slot =
            Some(u32::try_from(hierarchy.table_size()).unwrap_or(u32::MAX));
    }
    // And one for the resumption, on the same terms: a program with no
    // generators carries no slot for one. After the closure slot, so that a
    // program with both gives each a distinct index.
    if !generator_indices(snapshot).is_empty() {
        hierarchy.generator_slot = Some(u32::try_from(hierarchy.table_size()).unwrap_or(u32::MAX));
    }
    hierarchy.com_iids = com_interface_ids(snapshot);
    hierarchy
}

/// One declaration's body, as far as raising is concerned: whether it `throw`s, and
/// what it reaches.
///
/// Its own function because [`throwing_symbols`](super::throwing_symbols) is the outer loop over symbols and
/// this is the descent over one body, and because the three things it counts as
/// reaching something -- a call, a `new`, and an accessor access -- were added one at
/// a time, each after a program the census called compiled turned out to escape its
/// handler.
/// The symbol of the class a class declaration **extends**, where that base is a class
/// this program declares.
///
/// `None` for anything else, which is the answer `super(…)` needs: a provided base's
/// constructor is emitted inline and cannot throw, so recording nothing for it is
/// right, while a program base's own entry is what its `throw` reaches through. See
/// the `super` arm in [`walk_one_declaration`](super::walk_one_declaration).
pub(super) fn declared_base_class(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    declaration: NodeId,
) -> Option<u32> {
    if !probe.kind_of(declaration).is_some_and(declares_a_class) {
        return None;
    }
    let mut pending: Vec<NodeId> = probe.children(declaration);
    let mut seen = rustc_hash::FxHashSet::default();
    while let Some(at) = pending.pop() {
        if !seen.insert(at) {
            continue;
        }
        match probe.kind_of(at) {
            Some(syntax::HERITAGE_CLAUSE | syntax::EXPRESSION_WITH_TYPE_ARGUMENTS) => {
                pending.extend(probe.children(at));
            }
            Some(syntax::IDENTIFIER) => {
                // Through an import: `extends Base` with `Base` imported names the
                // import's own symbol, declared by its specifier and not by a
                // class, and asking that one dropped the base. The throw from a
                // base constructor in another module then reached nothing, its
                // derived class's construction was not a raiser, and a `try`
                // around it was compiled with no handler edge -- the throw ended
                // the program (`outcomes/a-throw-from-a-base-constructor-in-another-module`).
                if let Some(symbol) = probe
                    .node(at)
                    .symbol
                    .map(|symbol| probe.denoted_symbol(symbol))
                    && snapshot
                        .symbols
                        .get(symbol.0 as usize)
                        .is_some_and(|record| {
                            record
                                .declarations
                                .iter()
                                .any(|at| probe.kind_of(*at).is_some_and(declares_a_class))
                        })
                {
                    return Some(symbol.0);
                }
            }
            _ => {}
        }
    }
    None
}

impl FuncBuilder<'_> {
    /// Every class the value can actually *be*: each arm and everything
    /// below it.
    ///
    /// The first version of this asked the arms alone and was wrong in the
    /// direction that folds to a constant. `const v: Shape | Other = ...`
    /// with `Circle extends Shape`: neither `Shape` nor `Other` declares
    /// `r`, so `"r" in v` folded to `false` -- and at run time `v` is a
    /// `Circle`, which has one. Node says true, nts said false, and the
    /// differential said so on 20 of 29 cases.
    ///
    /// Inheritance is additive, so a subclass declares everything its base
    /// does and possibly more. That makes the `true` direction safe with the
    /// arms alone and the `false` direction unsafe, which is exactly the
    /// asymmetry a "no arm has it" fold walks into.
    pub(super) fn with_subclasses(&self, mut members: Vec<TypeId>) -> Vec<TypeId> {
        let below: Vec<TypeId> = self
            .hierarchy
            .name
            .keys()
            .copied()
            .filter(|ty| {
                !members.contains(ty) && members.iter().any(|arm| self.descends_from(*ty, *arm))
            })
            .collect();
        members.extend(below);
        members.sort_unstable_by_key(|ty| ty.0);
        members.dedup();
        members
    }

    /// Whether `ty` is `class` or extends it, at any depth.
    /// The hierarchy's own answer, which counts an implemented interface as
    /// well as an extended class.
    ///
    /// This used to walk `hierarchy.base` alone, and an interface has no entry
    /// there -- `base` is filled from class declarations. That was invisible
    /// until a `new` began allocating at a declared interface type: an object
    /// laid out as `Tagged` stopped answering `instanceof Error`, because the
    /// set of classes the test accepts is built from this and `Tagged` was not
    /// in it. Two walks over one relation, and the narrower one was the one
    /// `instanceof` asked.
    pub(super) fn descends_from(&self, ty: TypeId, class: TypeId) -> bool {
        self.hierarchy.descends_from(ty, class)
    }

    /// The name of the class a class extends.
    pub(super) fn base_class(&self, class: NodeId) -> Option<String> {
        let ty = instance_type_of(self.snapshot, class)?;
        // `extends` first, then `implements`, and a class extends at most one
        // class -- so the first base is the superclass when there is one.
        let base = *self.snapshot.base_types.get(&ty)?.first()?;
        // Named the way its own members were named, which is the whole point of
        // the name: `super.m()` is a direct call to `{base}#m`. An anonymous
        // base is a class expression extending a class expression, and its
        // methods were emitted under the stand-in.
        Some(nominal_or_stand_in(self.snapshot, base))
    }
}

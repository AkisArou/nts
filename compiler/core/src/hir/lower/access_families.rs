//! One source contract for every interface field's concrete supplies.
//!
//! A family is licensed only after every structural candidate can answer its
//! read and, where writable, its write. A stored value must be initialized or
//! have undefined-capable storage. Getter results retain their actual absence;
//! the narrower type an assertion names cannot remove null or undefined.

use std::collections::BTreeMap;

use rustc_hash::{FxHashMap, FxHashSet};

use super::{
    Absent, FuncBuilder, Hierarchy, HirType, MemberKind, NodeId, PropertyRecord, Substitution,
    TypeId, TypeKind, absent_of_result, field_initialization, interfaces, result_crosses, slot_for,
    syntax,
};

#[derive(Debug, Clone, Copy)]
pub(super) struct Accessor {
    pub declaration: NodeId,
    pub owner: TypeId,
    pub symbol: u32,
}

struct Sources {
    ready: field_initialization::Ready,
    literals: BTreeMap<TypeId, Vec<NodeId>>,
    symbols: FxHashMap<NodeId, u32>,
}

#[derive(Debug, Clone)]
pub(super) enum Reader {
    Stored,
    Getter(Accessor),
    Undefined,
}

#[derive(Debug, Clone)]
pub(super) struct Supply {
    pub owner: TypeId,
    pub ty: HirType,
    pub absent: Absent,
    pub reader: Reader,
    pub setter: Option<Accessor>,
    pub write_ty: HirType,
}

#[derive(Debug, Clone)]
pub(super) struct Family {
    pub face: TypeId,
    pub member: String,
    pub returns: HirType,
    pub writes: Option<HirType>,
    pub written_input: Option<crate::hir::native::Scalar>,
    /// None means an open erased value; Some carries the actual absence tags.
    pub absences: Option<Vec<u32>>,
    /// A schema type is reusable only when all concrete suppliers agree.
    pub read_type: Option<TypeId>,
    pub supplies: Vec<Supply>,
    /// User code and changed read representations must be visible to source
    /// lowering, before handlers and static typeof/absence answers are chosen.
    pub eager: bool,
}

impl Family {
    pub(super) fn symbols(&self) -> impl Iterator<Item = u32> + '_ {
        self.supplies.iter().flat_map(|supply| {
            let getter = if let Reader::Getter(accessor) = supply.reader {
                Some(accessor.symbol)
            } else {
                None
            };
            getter
                .into_iter()
                .chain(supply.setter.map(|accessor| accessor.symbol))
        })
    }

    pub(super) fn key(&self, writes: bool) -> String {
        format!("nts${}${}", if writes { "set" } else { "get" }, self.member)
    }

    pub(super) fn accessors_for(&self, writes: bool) -> Vec<NodeId> {
        self.supplies
            .iter()
            .filter_map(|supply| {
                if writes {
                    supply.setter.map(|accessor| accessor.declaration)
                } else if let Reader::Getter(accessor) = supply.reader {
                    Some(accessor.declaration)
                } else {
                    None
                }
            })
            .collect()
    }
    /// Naming and lowering consult the same concrete accessor declarations.
    /// Stored-field helpers cannot raise into a TypeScript handler.
    pub(super) fn accessors(&self) -> Vec<NodeId> {
        let mut declarations = Vec::new();
        for supply in &self.supplies {
            if let Reader::Getter(accessor) = supply.reader {
                declarations.push(accessor.declaration);
            }
            declarations.extend(supply.setter.map(|accessor| accessor.declaration));
        }
        declarations.sort_unstable();
        declarations.dedup();
        declarations
    }
}

/// Source copies use the recovered concrete receiver's property contract;
/// an unresolved face uses the complete family, never its narrower assertion.
pub(super) enum Read<'a> {
    Family(&'a Family),
    Property(&'a PropertyRecord),
}

impl Read<'_> {
    pub(super) fn representation(&self, probe: &FuncBuilder<'_>) -> Option<HirType> {
        match self {
            Self::Family(family) => Some(family.returns.clone()),
            Self::Property(property) => probe.represent(property.ty),
        }
    }
    pub(super) fn schema(&self) -> Option<TypeId> {
        match self {
            Self::Family(family) => family.read_type,
            Self::Property(property) => Some(property.ty),
        }
    }
    pub(super) fn absences(&self, probe: &FuncBuilder<'_>) -> Option<Vec<u32>> {
        match self {
            Self::Family(family) => family.absences.clone(),
            Self::Property(property) => type_absences(probe, property.ty),
        }
    }
}

impl FuncBuilder<'_> {
    /// A known allocation has its own concrete layout. Other receivers need
    /// the whole-program own-shape proof, independently of field dispatch.
    pub(super) fn known_allocation(&self, mut value: super::ValueId) -> Option<TypeId> {
        for _ in 0..32 {
            match &self.values[value.0 as usize].kind {
                super::OpKind::ObjectNew { .. } => {
                    let HirType::Managed(super::ManagedType::Object(owner)) =
                        self.values[value.0 as usize].ty
                    else {
                        return None;
                    };
                    return Some(owner);
                }
                super::OpKind::Convert(source) => value = *source,
                _ => return None,
            }
        }
        None
    }

    pub(super) fn interface_field_read(
        &mut self,
        at: NodeId,
        object: super::ValueId,
        face: TypeId,
        member: &str,
    ) -> Result<Option<super::ValueId>, nts_diagnostics::Diagnostic> {
        // This object was allocated with exactly this storage. A wider
        // family's erased ABI says nothing about the value in its own slot.
        // Other owners still need dispatch: a conversion alone proves no
        // relationship between their field positions.
        if self.known_allocation(object) == Some(face) {
            return Ok(None);
        }
        let Some(family) = self
            .hierarchy
            .access_families
            .get(face, member)
            .filter(|family| family.eager)
        else {
            return Ok(None);
        };
        let ty = family.returns.clone();
        let callee = self
            .accessor_callee(at, face, member, "get ")?
            .ok_or_else(|| self.unsupported(at, "an unlicensed interface field read"))?;
        let read = self.push_an_accessor_call(at, callee, vec![object], ty, self.origin(at));
        // Dispatch chooses the concrete supplier, while the source node's
        // checked narrowing chooses the payload to read. actual_field_read
        // keeps this erased when a supplier's real absence contradicts it.
        self.narrowed(at, read).map(Some)
    }

    pub(super) fn interface_field_place(
        &mut self,
        at: NodeId,
        object: super::ValueId,
        face: TypeId,
        member: &str,
    ) -> Result<Option<super::Place>, nts_diagnostics::Diagnostic> {
        let Some(family) = self
            .hierarchy
            .access_families
            .get(face, member)
            .filter(|family| family.eager)
        else {
            return Ok(None);
        };
        let wants = family
            .writes
            .clone()
            .ok_or_else(|| self.unsupported(at, "assigning to a readonly interface field"))?;
        let callee = self
            .accessor_callee(at, face, member, "set ")?
            .ok_or_else(|| self.unsupported(at, "an unlicensed interface field write"))?;
        let getter = self.accessor_callee(at, face, member, "get ")?;
        Ok(Some(super::Place::Setter {
            object: Some(object),
            callee,
            getter,
            wants: Some(wants),
            at,
        }))
    }

    pub(super) fn field_access_family(&self, at: NodeId) -> Option<&Family> {
        self.hierarchy.access_families.at(at).next()
    }

    pub(super) fn actual_field_read(&self, at: NodeId) -> Option<Read<'_>> {
        if self.hierarchy.access_families.licensed.is_empty() {
            return None;
        }
        let at = self.field_read_site(at)?;
        if self.kind_of(at) == Some(syntax::BINDING_ELEMENT) {
            return self
                .field_access_family(at)
                .filter(|family| family.eager)
                .map(Read::Family);
        }
        let (receiver, member) = self.member_access(at)?;
        let face = self.snapshot.node_types.get(&receiver).copied()?;
        if let Some(HirType::Managed(super::ManagedType::Object(actual))) =
            self.bound_type(receiver)
            && actual != face
            // An interface binding is its storage contract, not evidence of
            // a concrete supplier. Keep the checker's narrowed face instead.
            && !self.hierarchy.faces.contains(&actual)
        {
            // A source copy reads this concrete storage directly. Its declared
            // field type describes the stored ABI; the source node still
            // licenses checked narrowing of the payload, just as on a class
            // read without a family. Getters keep their actual result contract:
            // assignment or assertion cannot remove an absence they return.
            return interfaces::property(self.snapshot, actual, &member)
                .filter(|property| property.kind != MemberKind::Field)
                .map(Read::Property);
        }
        self.hierarchy
            .access_families
            .get(face, &member)
            .filter(|family| family.eager)
            .map(Read::Family)
    }

    fn field_read_site(&self, mut at: NodeId) -> Option<NodeId> {
        for _ in 0..32 {
            if self.member_access(at).is_some() {
                return Some(at);
            }
            if matches!(
                self.kind_of(at),
                Some(
                    syntax::PARENTHESIZED_EXPRESSION
                        | syntax::AS_EXPRESSION
                        | syntax::TYPE_ASSERTION_EXPRESSION
                        | syntax::NON_NULL_EXPRESSION
                        | syntax::SATISFIES_EXPRESSION
                )
            ) {
                at = self
                    .children(at)
                    .into_iter()
                    .find(|child| !syntax::is_type_node(self.kind_of(*child).unwrap_or(0)))?;
                continue;
            }
            if self.kind_of(at) != Some(syntax::IDENTIFIER) {
                return None;
            }
            let symbol = self.node(at).symbol?;
            let declaration = *self
                .snapshot
                .symbols
                .get(symbol.0 as usize)?
                .declarations
                .first()?;
            if !matches!(
                self.kind_of(declaration),
                Some(syntax::VARIABLE_DECLARATION | syntax::BINDING_ELEMENT)
            ) {
                return None;
            }
            let list = self.ancestor(declaration, syntax::VARIABLE_DECLARATION_LIST)?;
            if nts_semantic_schema::VariableKind::from_flags(self.node(list).flags)
                != nts_semantic_schema::VariableKind::Const
            {
                return None;
            }
            if self.kind_of(declaration) == Some(syntax::BINDING_ELEMENT) {
                if self.child_slots::<4>(declaration)?[3].is_some() {
                    return None; // A default changes the read's possible values.
                }
                return Some(declaration);
            }
            at = self.child_slots::<4>(declaration)?[3]?;
        }
        None
    }
}

#[derive(Debug, Clone, Default)]
pub(super) struct Families {
    pub licensed: Vec<Family>,
    pub declined: BTreeMap<(TypeId, String), &'static str>,
    by_member: FxHashMap<TypeId, BTreeMap<String, usize>>,
    by_site: FxHashMap<NodeId, Vec<usize>>,
    transports: FxHashSet<(TypeId, TypeId)>,
    transport_faces: FxHashSet<TypeId>,
    spread_safe: FxHashSet<TypeId>,
    flow: super::access_family_flow::Bound,
    owners: Owners,
}

impl Families {
    pub(super) fn changes_transport(&self, face: TypeId) -> bool {
        self.transport_faces.contains(&face)
    }
    /// Licensing a layout's own fields does not change how its existing
    /// objects reach that layout. Keep the original record-copy path when
    /// the complete family contains only that exact source storage.
    fn changed_transport_faces(&self) -> FxHashSet<TypeId> {
        self.transports
            .iter()
            .filter_map(|(owner, face)| (owner != face).then_some(*face))
            .collect()
    }
    pub(super) fn permits_spread(&self, face: TypeId) -> bool {
        self.spread_safe.contains(&face)
    }
    pub(super) fn at(&self, site: NodeId) -> impl Iterator<Item = &Family> {
        self.by_site
            .get(&site)
            .into_iter()
            .flatten()
            .filter_map(|index| self.licensed.get(*index))
    }
    /// The object types whose shape fits `face` and that the source flow
    /// proves reach it -- what a value of a structural type can hold once it
    /// has been erased into a union, where no conversion asked for a prefix.
    ///
    /// **Flowing, not merely fitting.** Every `{ done, value }` in a program
    /// fits `ReadableStreamReadResult`'s arms, and an iterator result laid
    /// out `{ value, done }` elsewhere made `done` look mixed and refused a
    /// read nothing unrelated reaches. A conversion into a union reaches each
    /// arm in the flow, so the owner a union really holds is here.
    pub(super) fn structural_owners(&self, probe: &FuncBuilder<'_>, face: TypeId) -> Vec<TypeId> {
        let Some(wanted) = properties(probe, face) else {
            return Vec::new();
        };
        self.owners
            .candidates(wanted)
            .into_iter()
            .filter(|owner| {
                self.flow.reaches(*owner, face)
                    && fits_the_face(probe, &probe.hierarchy, face, *owner, wanted)
            })
            .collect()
    }
    pub(super) fn carries(&self, owner: TypeId, face: TypeId) -> bool {
        self.transports.contains(&(owner, face))
    }
    /// The owners other than itself that a value of `face` may hold through a
    /// licensed view, in type order so a refusal naming one is deterministic.
    pub(super) fn carried_by(&self, face: TypeId) -> Vec<TypeId> {
        let mut owners: Vec<_> = self
            .transports
            .iter()
            .filter(|(owner, at)| *at == face && *owner != face)
            .map(|(owner, _)| *owner)
            .collect();
        owners.sort_unstable();
        owners
    }
    pub(super) fn for_key(&self, face: TypeId, key: &str) -> Option<(&Family, bool)> {
        let (key, _) = super::without_the_raising_suffix(key);
        let (member, writes) = key
            .strip_prefix("nts$get$")
            .map(|member| (member, false))
            .or_else(|| key.strip_prefix("nts$set$").map(|member| (member, true)))?;
        self.get(face, member).map(|family| (family, writes))
    }

    pub(super) fn number_slots(&self, hierarchy: &mut Hierarchy) {
        for family in &self.licensed {
            for writes in [false, true] {
                if writes && family.writes.is_none() {
                    continue;
                }
                let slot = u32::try_from(hierarchy.slots.len()).unwrap_or(u32::MAX);
                hierarchy
                    .slots
                    .insert((family.face, family.key(writes)), slot);
            }
        }
    }

    pub(super) fn collect(probe: &mut FuncBuilder<'_>, hierarchy: &Hierarchy) -> Self {
        let sites = super::access_family_sites::collect(probe, hierarchy);
        let used = used_members(&sites);
        // Every program's objects, whether or not it reads a field through an
        // interface: a union of interfaces is read without one, and its arms
        // can hold any of them (`Self::structural_owners`).
        let literals = literal_owners(probe);
        let owners = Owners::collect(probe, hierarchy, &literals);
        // The flow is asked of every face a field is read through, and of every
        // object type a union names: a union's arm can hold the owners that
        // flow into the union, and only those (`Self::structural_owners`).
        let union_arms = union_arms(probe);
        let flow = super::access_family_flow::Bound::collect(
            probe,
            &owners.all,
            &literals,
            used.keys().copied().chain(union_arms.iter().copied()),
        );
        if used.is_empty() {
            return Self {
                flow,
                owners,
                ..Self::default()
            };
        }
        let sources = Sources {
            ready: field_initialization::Ready::collect(probe),
            literals,
            symbols: probe
                .snapshot
                .symbols
                .iter()
                .enumerate()
                .flat_map(|(at, symbol)| {
                    let at = u32::try_from(at).unwrap_or(u32::MAX);
                    symbol
                        .declarations
                        .iter()
                        .map(move |declaration| (*declaration, at))
                })
                .collect(),
        };
        let mut result = Self {
            flow,
            ..Self::default()
        };
        for (face, members) in used {
            let Some(properties) = properties(probe, face) else {
                continue;
            };
            // A spread copies the own properties of whatever object is there,
            // and any object of the face's shape can be: the proof decides
            // which owners license the family, not which shapes a spread sees.
            let structural: Vec<_> = owners
                .candidates(properties)
                .into_iter()
                .filter(|owner| fits_the_face(probe, hierarchy, face, *owner, properties))
                .collect();
            let candidates: Vec<_> = structural
                .iter()
                .copied()
                .filter(|owner| result.flow.permits(*owner, face))
                .collect();
            if !structural.is_empty()
                && structural.iter().all(|owner| {
                    owns_the_same_shape(probe, *owner, face, properties, &sources.literals)
                })
            {
                result.spread_safe.insert(face);
            }
            for member in members {
                let Some(wanted) = properties.iter().find(|property| property.name == member)
                else {
                    continue;
                };
                match family(probe, hierarchy, &sources, face, wanted, &candidates) {
                    Ok(family) => {
                        result
                            .by_member
                            .entry(face)
                            .or_default()
                            .insert(member, result.licensed.len());
                        result.licensed.push(family);
                    }
                    Err(reason) => {
                        result.declined.insert((face, member), reason);
                    }
                }
            }
        }
        result.record_transports(hierarchy);
        for (site, reads) in sites {
            let families: Vec<_> = reads
                .iter()
                .filter_map(|(face, member)| result.by_member.get(face)?.get(member).copied())
                .collect();
            if !families.is_empty() {
                result.by_site.insert(site, families);
            }
        }
        result.transport_faces = result.changed_transport_faces();
        result.owners = owners;
        result
    }

    /// The coercions the licensed families authorize: each supply into its
    /// face, unless some member of that face was declined.
    fn record_transports(&mut self, hierarchy: &Hierarchy) {
        let mut transports = Vec::new();
        for family in &self.licensed {
            if self.declined.keys().any(|(face, _)| *face == family.face) {
                continue;
            }
            transports.extend(
                family
                    .supplies
                    .iter()
                    .filter(|supply| {
                        // Field licensing cannot authorize transport into an
                        // incomplete method table. Method-value faces retain
                        // their independent legacy classification until D.
                        hierarchy
                            .declares
                            .get(&family.face)
                            .is_none_or(Vec::is_empty)
                            || hierarchy.descends_from(supply.owner, family.face)
                    })
                    .map(|supply| (supply.owner, family.face)),
            );
        }
        self.transports.extend(transports);
    }

    pub(super) fn get(&self, face: TypeId, member: &str) -> Option<&Family> {
        self.by_member
            .get(&face)
            .and_then(|members| members.get(member))
            .and_then(|at| self.licensed.get(*at))
    }
}

/// Declaration-only layouts reserve rows under the same candidate contract
/// as concrete owners. A missing optional member does not authorize rows for
/// a face whose required members the declaration cannot supply.
pub(super) fn reserves(probe: &FuncBuilder<'_>, owner: TypeId, face: TypeId) -> bool {
    properties(probe, face).is_some_and(|properties| {
        candidate_satisfies(
            probe,
            &probe.hierarchy,
            &probe.hierarchy.access_families.flow,
            face,
            owner,
            properties,
        )
    })
}

fn candidate_satisfies(
    probe: &FuncBuilder<'_>,
    hierarchy: &Hierarchy,
    flow: &super::access_family_flow::Bound,
    face: TypeId,
    owner: TypeId,
    properties: &[PropertyRecord],
) -> bool {
    flow.permits(owner, face) && fits_the_face(probe, hierarchy, face, owner, properties)
}

/// Whether an owner's members can stand where the face's are read: its shape
/// alone, independent of whether the supplier bound saw it arrive.
fn fits_the_face(
    probe: &FuncBuilder<'_>,
    hierarchy: &Hierarchy,
    face: TypeId,
    owner: TypeId,
    properties: &[PropertyRecord],
) -> bool {
    // Owners::candidates intersects these required names for concrete owners;
    // declaration-only reservations must observe the same membership rule.
    // An optional member cannot satisfy a required one either.
    if properties.iter().any(|wanted| {
        !wanted.optional
            && interfaces::property(probe.snapshot, owner, &wanted.name)
                .is_none_or(|found| found.optional)
    }) {
        return false;
    }
    // The method planner excludes provably disjoint signatures too. Unknown
    // or bivariant supplies remain candidates.
    properties.iter().all(|wanted| {
        !hierarchy
            .declares
            .get(&face)
            .is_some_and(|methods| methods.contains(&wanted.name))
            || interfaces::property(probe.snapshot, owner, &wanted.name)
                .is_none_or(|found| interfaces::candidate(probe, found, wanted))
    })
}

/// Intersect required members, starting with the rarest. Optional-only faces
/// still admit every owner; their missing properties need undefined readers.
#[derive(Debug, Clone, Default)]
struct Owners {
    all: Vec<TypeId>,
    by_member: FxHashMap<String, FxHashSet<TypeId>>,
}

impl Owners {
    fn collect(
        probe: &FuncBuilder<'_>,
        hierarchy: &Hierarchy,
        literals: &BTreeMap<TypeId, Vec<NodeId>>,
    ) -> Self {
        let mut all: Vec<_> = hierarchy
            .declares
            .keys()
            .copied()
            .filter(|owner| !hierarchy.faces.contains(owner))
            .collect();
        all.extend(literals.keys().copied());
        all.sort_unstable();
        all.dedup();
        let mut by_member: FxHashMap<String, FxHashSet<TypeId>> = FxHashMap::default();
        for owner in &all {
            for property in properties(probe, *owner).into_iter().flatten() {
                by_member
                    .entry(property.name.clone())
                    .or_default()
                    .insert(*owner);
            }
        }
        Self { all, by_member }
    }

    fn candidates(&self, wanted: &[PropertyRecord]) -> Vec<TypeId> {
        let required: Vec<_> = wanted
            .iter()
            .filter(|property| !property.optional)
            .map(|property| self.by_member.get(&property.name))
            .collect();
        if required.iter().any(Option::is_none) {
            return Vec::new();
        }
        let mut sets: Vec<_> = required.into_iter().flatten().collect();
        sets.sort_unstable_by_key(|set| set.len());
        let Some(first) = sets.first() else {
            return self.all.clone();
        };
        let mut candidates: Vec<_> = first
            .iter()
            .copied()
            .filter(|owner| sets.iter().skip(1).all(|set| set.contains(owner)))
            .collect();
        candidates.sort_unstable();
        candidates
    }
}

/// Every object type a union names: the faces the flow is asked about for
/// unions, beside the ones a field is read through.
fn union_arms(probe: &FuncBuilder<'_>) -> Vec<TypeId> {
    let mut arms: Vec<TypeId> = probe
        .snapshot
        .types
        .iter()
        .filter_map(|record| match &record.kind {
            TypeKind::Union(members) => Some(members),
            _ => None,
        })
        .flatten()
        .copied()
        .filter(|member| {
            matches!(
                probe
                    .snapshot
                    .types
                    .get(member.0 as usize)
                    .map(|record| &record.kind),
                Some(TypeKind::Object { .. })
            )
        })
        .collect();
    arms.sort_unstable();
    arms.dedup();
    arms
}

fn properties<'a>(probe: &'a FuncBuilder<'_>, owner: TypeId) -> Option<&'a [PropertyRecord]> {
    match &probe.snapshot.types.get(owner.0 as usize)?.kind {
        TypeKind::Object { properties } => Some(properties),
        _ => None,
    }
}

/// A static spread is legal only where every concrete supply has exactly the
/// same own fields in the same order and representation. In particular a
/// prototype getter is not read by object spread. Dynamic own-property
/// reflection is independent of field-access dispatch and stays a named stop.
fn owns_the_same_shape(
    probe: &FuncBuilder<'_>,
    owner: TypeId,
    face: TypeId,
    wanted: &[PropertyRecord],
    literals: &BTreeMap<TypeId, Vec<NodeId>>,
) -> bool {
    if literals.get(&owner).is_some_and(|allocations| {
        allocations
            .iter()
            .any(|literal| !literal_own_shape(probe, *literal, face, wanted))
    }) {
        return false;
    }
    if probe
        .snapshot
        .base_types
        .get(&owner)
        .is_some_and(|bases| !bases.is_empty())
    {
        return false;
    }
    let Some(found) = properties(probe, owner) else {
        return false;
    };
    let stored: Vec<_> = found
        .iter()
        .filter(|property| property.kind == MemberKind::Field)
        .collect();
    let wanted: Vec<_> = wanted
        .iter()
        .filter(|property| property.kind != MemberKind::Method)
        .collect();
    stored.len() == wanted.len()
        && stored.iter().zip(wanted).all(|(mine, wanted)| {
            mine.name == wanted.name
                && mine
                    .declaration
                    .is_none_or(|at| probe.kind_of(at) != Some(syntax::PARAMETER))
                && !mine.optional
                && !wanted.optional
                && storage(probe, mine.ty) == storage(probe, wanted.ty)
                && type_absences(probe, mine.ty) == type_absences(probe, wanted.ty)
        })
}

/// A contextual type can omit an extra own method or conceal differing literal
/// insertion orders. Check every allocation, rather than trusting that type.
fn literal_own_shape(
    probe: &FuncBuilder<'_>,
    literal: NodeId,
    face: TypeId,
    wanted: &[PropertyRecord],
) -> bool {
    let names: Option<Vec<Vec<String>>> = probe
        .children(literal)
        .into_iter()
        .map(|property| {
            if probe.kind_of(property) == Some(syntax::SPREAD_ASSIGNMENT) {
                let source = *probe.children(property).first()?;
                // A same-shape copy preserves this permission. Its source is
                // checked by spread_into against the same complete supply set.
                return (probe.snapshot.node_types.get(&source) == Some(&face)).then(|| {
                    wanted
                        .iter()
                        .filter(|field| field.kind == MemberKind::Field)
                        .map(|field| field.name.clone())
                        .collect()
                });
            }
            if !matches!(
                probe.kind_of(property),
                Some(syntax::PROPERTY_ASSIGNMENT | syntax::SHORTHAND_PROPERTY_ASSIGNMENT)
            ) {
                return None;
            }
            probe
                .children(property)
                .first()
                .and_then(|name| probe.literal_name(*name))
                .map(|name| vec![name])
        })
        .collect();
    let Some(names) = names else {
        return false;
    };
    let names: Vec<_> = names.into_iter().flatten().collect();
    let fields: Vec<_> = wanted
        .iter()
        .filter(|property| property.kind == MemberKind::Field)
        .collect();
    names.len() == fields.len()
        && names
            .iter()
            .zip(fields)
            .all(|(name, field)| *name == field.name)
}

fn used_members(sites: &BTreeMap<NodeId, Vec<(TypeId, String)>>) -> BTreeMap<TypeId, Vec<String>> {
    let mut used: BTreeMap<TypeId, Vec<String>> = BTreeMap::new();
    for reads in sites.values() {
        for (face, member) in reads {
            used.entry(*face).or_default().push(member.clone());
        }
    }
    for members in used.values_mut() {
        members.sort();
        members.dedup();
    }
    used
}

fn literal_owners(probe: &mut FuncBuilder<'_>) -> BTreeMap<TypeId, Vec<NodeId>> {
    let mut owners: BTreeMap<TypeId, Vec<NodeId>> = BTreeMap::new();
    for index in 0..probe.snapshot.nodes.len() {
        if probe.snapshot.nodes[index].kind
            != super::NodeKind::Syntax(syntax::OBJECT_LITERAL_EXPRESSION)
        {
            continue;
        }
        let Ok(index) = u32::try_from(index) else {
            continue;
        };
        let literal = NodeId(index);
        if let Some(owner) = probe.literal_member_owner(literal) {
            owners.entry(owner).or_default().push(literal);
        }
    }
    owners
}

fn family(
    probe: &FuncBuilder<'_>,
    hierarchy: &Hierarchy,
    sources: &Sources,
    face: TypeId,
    wanted: &PropertyRecord,
    candidates: &[TypeId],
) -> Result<Family, &'static str> {
    if candidates.is_empty() {
        return Err("no concrete supplier");
    }
    if properties(probe, face)
        .into_iter()
        .flatten()
        .any(|property| {
            property.name == format!("nts$get${}", wanted.name)
                || (!wanted.readonly && property.name == format!("nts$set${}", wanted.name))
        })
    {
        return Err("a source member colliding with the reserved field accessor name");
    }
    let declared = property_storage(probe, wanted).ok_or("an unrepresentable field contract")?;
    let mut supplies = Vec::new();
    let mut read_type = None;
    let mut actual_absences = Some(Vec::new());
    for owner in candidates {
        let supply = supply(probe, hierarchy, sources, *owner, wanted)?;
        let source = interfaces::property(probe.snapshot, *owner, &wanted.name)
            .filter(|property| !property.optional)
            .map(|property| property.ty);
        if supplies.is_empty() {
            read_type = source;
        } else if read_type != source {
            read_type = None;
        }
        join_absences(&mut actual_absences, absence_tags(probe, *owner, wanted));
        supplies.push(supply);
    }
    let declared_absences = property_absences(probe, wanted);
    let uniform = supplies.iter().all(|supply| {
        supply.ty == declared
            || interfaces::property(probe.snapshot, supply.owner, &wanted.name).is_some_and(
                |found| {
                    // Exact source signatures are related by
                    // relate_closures_to_signatures and share a published
                    // signature layout. This is callable identity transport,
                    // never a reinterpretation of unrelated record storage.
                    super::signature_key(probe.snapshot, wanted.ty).is_some_and(|key| {
                        super::signature_key(probe.snapshot, found.ty) == Some(key)
                    })
                },
            )
    });
    let same_absences = actual_absences == declared_absences;
    // A typed stored record still needs its source result layout. Distinct
    // schema ids may later merge, but no such proof exists here. Widening this
    // read to NtsValue would discard main's positional result path before it
    // can be shaped. Leave the family unlicensed and keep that existing path.
    if !uniform
        && matches!(declared, HirType::Managed(super::ManagedType::Object(_)))
        && supplies
            .iter()
            .all(|supply| matches!(supply.reader, Reader::Stored))
    {
        return Err("stored record results without one proven source storage contract");
    }
    let returns = if uniform && same_absences {
        declared.clone()
    } else {
        HirType::Erased
    };
    if returns == HirType::Erased && supplies.iter().any(|supply| !result_crosses(&supply.ty)) {
        return Err("a supplier has no erased representation");
    }
    let eager = supplies.iter().any(|supply| supply.ty != declared)
        || !same_absences
        || supplies
            .iter()
            .any(|supply| matches!(supply.reader, Reader::Getter(_)));
    let writes = writable(wanted).then_some(declared);
    if writes.is_some()
        && supplies
            .iter()
            .any(|supply| matches!(supply.reader, Reader::Undefined))
    {
        return Err("a writable field missing from a concrete supplier");
    }
    Ok(Family {
        face,
        member: wanted.name.clone(),
        returns,
        writes,
        written_input: crate::hir::native::scalar(probe.snapshot, wanted.ty),
        absences: actual_absences,
        read_type,
        supplies,
        eager,
    })
}

fn supply(
    probe: &FuncBuilder<'_>,
    hierarchy: &Hierarchy,
    sources: &Sources,
    owner: TypeId,
    wanted: &PropertyRecord,
) -> Result<Supply, &'static str> {
    let Some(found) = interfaces::property(probe.snapshot, owner, &wanted.name) else {
        return wanted
            .optional
            .then_some(Supply {
                owner,
                ty: HirType::Erased,
                absent: Absent::Undefined,
                reader: Reader::Undefined,
                setter: None,
                write_ty: HirType::Erased,
            })
            .ok_or("a required field missing from a concrete supplier");
    };
    let ty = property_storage(probe, found).ok_or("an unrepresentable concrete field")?;
    let absent = absent_of_result(probe.snapshot, found.ty);
    let getter = accessor(probe, hierarchy, sources, owner, &wanted.name, "get ");
    let setter = accessor(probe, hierarchy, sources, owner, &wanted.name, "set ");
    let reader = match found.kind {
        MemberKind::Accessor(_) => {
            let accessor = getter.ok_or("an accessor without a getter")?;
            if writable(wanted) && setter.is_none() {
                return Err("an accessor without a setter");
            }
            Reader::Getter(accessor)
        }
        MemberKind::Method => {
            return Err("a class method value requires its identity-preserving getter");
        }
        MemberKind::Field => {
            let literal_ready = sources.literals.get(&owner).is_some_and(|allocations| {
                allocations.iter().all(|literal| {
                    probe
                        .children(*literal)
                        .iter()
                        .any(|member| probe.member_name(*member).as_ref() == Some(&found.name))
                })
            });
            let admits_undefined = type_absences(probe, found.ty)
                .is_none_or(|absences| absences.contains(&super::super::tags::UNDEFINED));
            let class_field = found.declaration.is_some_and(|at| {
                matches!(
                    probe.kind_of(at),
                    Some(syntax::PROPERTY_DECLARATION | syntax::PARAMETER)
                )
            });
            let all_ready = (!sources.literals.contains_key(&owner) || literal_ready)
                && if class_field {
                    sources.ready.contains(found)
                } else {
                    literal_ready
                };
            if ty != HirType::Erased && !admits_undefined && !all_ready {
                return Err("a narrow stored field without initialization before publication");
            }
            Reader::Stored
        }
    };
    let written = setter
        .and_then(|accessor| {
            let parameter = super::parameters_of(probe, accessor.declaration)
                .first()
                .copied()?;
            let name = probe
                .children(parameter)
                .into_iter()
                .find(|at| probe.kind_of(*at) == Some(syntax::IDENTIFIER))?;
            probe.snapshot.node_types.get(&name).copied()
        })
        .unwrap_or(found.ty);
    let write_ty = if setter.is_none() {
        ty.clone()
    } else {
        storage(probe, written).ok_or("an unrepresentable setter input")?
    };
    if writable(wanted) {
        let declared =
            property_storage(probe, wanted).ok_or("an unrepresentable field contract")?;
        if found.readonly
            || !interfaces::stores(
                probe.snapshot,
                hierarchy,
                wanted.ty,
                written,
                &declared,
                &write_ty,
            )
        {
            return Err("a field write requiring narrowing or a structural storage conversion");
        }
    }
    Ok(Supply {
        owner,
        ty,
        absent,
        reader,
        setter,
        write_ty,
    })
}

fn storage(probe: &FuncBuilder<'_>, ty: TypeId) -> Option<HirType> {
    slot_for(
        probe.snapshot,
        ty,
        &mut Vec::new(),
        &Substitution::default(),
    )
}

/// Optionality is beside the schema type. The physical field carries its
/// undefined value as a tag, including when the non-absent value is a pointer.
fn property_storage(probe: &FuncBuilder<'_>, property: &PropertyRecord) -> Option<HirType> {
    if property.optional {
        Some(HirType::Erased)
    } else {
        storage(probe, property.ty)
    }
}

fn writable(property: &PropertyRecord) -> bool {
    !property.readonly
        && !matches!(
            property.kind,
            MemberKind::Accessor(nts_semantic_schema::Accessor::Get)
        )
}

fn accessor(
    probe: &FuncBuilder<'_>,
    hierarchy: &Hierarchy,
    sources: &Sources,
    owner: TypeId,
    name: &str,
    prefix: &str,
) -> Option<Accessor> {
    let owner = hierarchy.declaring(owner, &format!("{prefix}{name}"))?;
    let declaration = interfaces::property(probe.snapshot, owner, name)?.declaration?;
    let expected = if prefix == "get " {
        syntax::GET_ACCESSOR
    } else {
        syntax::SET_ACCESSOR
    };
    let declaration = (probe.kind_of(declaration) == Some(expected))
        .then_some(declaration)
        .or_else(|| {
            let parent = probe.node(declaration).parent?;
            probe.children(parent).into_iter().find(|at| {
                probe.kind_of(*at) == Some(expected)
                    && probe.member_name(*at).as_deref() == Some(name)
            })
        })?;
    Some(Accessor {
        declaration: probe.implementation_of(declaration),
        owner,
        symbol: *sources.symbols.get(&declaration)?,
    })
}

fn absence_tags(
    probe: &FuncBuilder<'_>,
    owner: TypeId,
    wanted: &PropertyRecord,
) -> Option<Vec<u32>> {
    interfaces::property(probe.snapshot, owner, &wanted.name).map_or_else(
        || Some(vec![super::super::tags::UNDEFINED]),
        |property| property_absences(probe, property),
    )
}

fn type_absences(probe: &FuncBuilder<'_>, ty: TypeId) -> Option<Vec<u32>> {
    type_absences_at(probe, ty, 0)
}

fn property_absences(probe: &FuncBuilder<'_>, property: &PropertyRecord) -> Option<Vec<u32>> {
    let mut absences = type_absences(probe, property.ty);
    if property.optional {
        join_absences(&mut absences, Some(vec![super::super::tags::UNDEFINED]));
    }
    absences
}

fn type_absences_at(probe: &FuncBuilder<'_>, ty: TypeId, depth: u32) -> Option<Vec<u32>> {
    if depth >= 32 {
        return None;
    }
    let record = probe.snapshot.types.get(ty.0 as usize)?;
    match &record.kind {
        TypeKind::Any | TypeKind::Unknown | TypeKind::TypeParameter { .. } => None,
        TypeKind::Null => Some(vec![super::super::tags::NULL]),
        TypeKind::Undefined | TypeKind::Void => Some(vec![super::super::tags::UNDEFINED]),
        TypeKind::Union(members) => {
            let mut absences = Some(Vec::new());
            for member in members {
                join_absences(&mut absences, type_absences_at(probe, *member, depth + 1));
            }
            absences
        }
        _ => Some(Vec::new()),
    }
}

fn join_absences(joined: &mut Option<Vec<u32>>, other: Option<Vec<u32>>) {
    match (joined.as_mut(), other) {
        (Some(joined), Some(other)) => {
            joined.extend(other);
            joined.sort_unstable();
            joined.dedup();
        }
        _ => *joined = None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nts_frontend_ts::{SemanticSource, TsgoApi};

    #[test]
    fn field_supplies_include_both_halves_of_a_user_accessor() {
        let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
            return;
        };
        let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/programs/accessor-families/tsconfig.json");
        let snapshot = TsgoApi::for_compilation(tsgo)
            .snapshot(&config)
            .unwrap_or_else(|error| panic!("snapshot failed: {error:?}"));
        let hierarchy = super::super::collect_hierarchy(
            &snapshot,
            &FxHashMap::default(),
            &[],
            &super::super::qualified_names(&snapshot).0,
        );
        let face = hierarchy
            .name
            .iter()
            .find(|(_, name)| name.as_str() == "Counter")
            .map_or_else(|| panic!("missing Counter"), |(face, _)| *face);
        let family = hierarchy
            .access_families
            .get(face, "value")
            .unwrap_or_else(|| {
                panic!(
                    "Counter.value was declined: {:?}",
                    hierarchy
                        .access_families
                        .declined
                        .get(&(face, "value".to_owned()))
                )
            });
        assert_eq!(family.accessors_for(false).len(), 1);
        assert_eq!(family.accessors_for(true).len(), 1);
        let binding = snapshot
            .nodes
            .iter()
            .enumerate()
            .find(|(_, node)| node.kind == super::super::NodeKind::Syntax(syntax::BINDING_ELEMENT))
            .and_then(|(index, _)| u32::try_from(index).ok())
            .map_or_else(|| panic!("the fixture has a destructured value"), NodeId);
        assert!(
            hierarchy
                .access_families
                .at(binding)
                .any(|family| family.face == face && family.member == "value")
        );
    }
}

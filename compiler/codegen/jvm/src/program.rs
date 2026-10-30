//! The program this backend renders, with the facts it derives once.
//!
//! **A whole-program fact asked per descriptor has to be computed once.**
//! Whether a face is split ([`crate::split_faces`]) changes how every value of
//! it is spelled, so `types::reference_class` asks it for each object type it
//! names -- every parameter, field, frame entry and call. Answered from the
//! layouts each time, that is a scan of the program per descriptor. So the
//! answer is taken once, here, and every function of this backend is handed
//! this rather than the bare `Program`, which it dereferences to: the core's
//! questions are asked of it unchanged, and the compiler says where a fact of
//! this backend's has to reach.

use std::ops::Deref;

use nts_core::hir::{Layout, Program};
use nts_semantic_schema::TypeId;
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug)]
pub struct JvmProgram<'a> {
    program: &'a Program,
    pub(crate) strings: crate::builder::Plan<'a>,
    guarded_members: FxHashMap<usize, crate::guarded_members::Member>,
    /// Every type a split face's layout holds; see [`crate::split_faces`].
    split: FxHashSet<TypeId>,
    /// Per split face, by layout index, every layout whose values it can hold:
    /// see [`Self::member`].
    members: FxHashMap<usize, FxHashSet<usize>>,
    /// Per layout, the split faces its class implements itself, in layout
    /// order: see [`Self::implemented`].
    implemented: FxHashMap<usize, Vec<usize>>,
    /// Each field family slot's declared accessor, which is what a call
    /// through the slot names; see [`Self::selector`].
    selectors: FxHashMap<u32, (&'a str, Option<TypeId>)>,
    /// Actual first-parameter types of source-published missing-field defaults
    /// installed at field-family slots. Source faces and row receivers differ.
    selector_receivers: FxHashMap<&'a str, TypeId>,
    /// The dispatch slots some layout fills with a body; see [`Self::live`].
    live: FxHashSet<usize>,
    /// `(layout, field)` for every field some operation reads or writes by
    /// position through a value of that layout's type; see [`Self::reached`].
    positional: FxHashSet<(usize, u32)>,
    /// Each module global's static field, by global index; see
    /// [`Self::global_field`].
    global_fields: Vec<String>,
    /// One method namespace for public names and allocated internal bodies.
    implementation_names: FxHashMap<&'a str, String>,
    /// Per layout, its proved declared interface parents and whether its
    /// whole declared chain is proved; see [`Self::declared_parents`].
    declared: DeclaredAncestry,
}

/// Declared interface ancestry, from `InterfaceIdentity::parents` alone.
///
/// Semantic ancestry is never inferred from physical prefixes, holder flow
/// or same-shaped storage: an edge exists here only where the core
/// published a declared parent for that exact instantiation. A layout is
/// *proved* when every identity type it holds has a parents entry, every
/// parent resolves to an interface identity's layout, the chain above it
/// is likewise proved and acyclic, and its physical superclass chain
/// (`hierarchy::jvm_base`) names only declared ancestors. Anything else --
/// a missing entry (unknown), a concrete parent, a cycle, a physical base
/// the declarations do not explain -- keeps the floor a face has today.
#[derive(Debug, Default)]
struct DeclaredAncestry {
    /// Per layout index, its direct declared parents' layout indices, in
    /// declaration order with same-layout edges collapsed. Empty where the
    /// layout is no face or its ancestry is not proved.
    parents: Vec<Vec<usize>>,
    /// Per layout index, every declared ancestor's layout index.
    ancestors: Vec<FxHashSet<usize>>,
    /// Per layout index, whether its declared chain is proved whole.
    proved: Vec<bool>,
}

/// Each layout's own declared edges, before the chain above them is asked:
/// a layout holding an identity type with no parents entry, a parent with
/// no layout, or a parent that is no interface identity (a concrete
/// parent) is not proved, however its fields line up.
fn declared_edges(
    program: &Program,
    by_type: &FxHashMap<TypeId, usize>,
    identity_of: &FxHashMap<TypeId, &nts_core::hir::InterfaceIdentity>,
) -> (Vec<Vec<usize>>, Vec<bool>) {
    let count = program.layouts.len();
    let mut parents: Vec<Vec<usize>> = vec![Vec::new(); count];
    let mut local: Vec<bool> = vec![false; count];
    for (at, layout) in program.layouts.iter().enumerate() {
        let mut proved = false;
        let mut edges: Vec<usize> = Vec::new();
        for id in &layout.types {
            let Some(identity) = identity_of.get(id) else {
                continue;
            };
            proved = true;
            let Some(declared) = identity.parents.get(id) else {
                proved = false;
                break;
            };
            for parent in declared {
                if !identity_of.contains_key(parent) {
                    proved = false;
                    break;
                }
                let Some(&parent_at) = by_type.get(parent) else {
                    proved = false;
                    break;
                };
                // A semantic edge within one shared layout is no edge
                // here: there is one class and at most one companion.
                if parent_at != at && !edges.contains(&parent_at) {
                    edges.push(parent_at);
                }
            }
            if !proved {
                break;
            }
        }
        local[at] = proved;
        if proved {
            parents[at] = edges;
        }
    }
    (parents, local)
}

/// Whether layout `at`'s declared chain is proved whole: its own edges,
/// every ancestor's, no cycle, and its physical superclass chain naming
/// only declared ancestors. A parent emitted as a JVM interface is a
/// proved leaf -- its own edges are that interface's, emitted with it,
/// and no companion stands for it.
fn declared_chain(
    facts: &JvmProgram<'_>,
    parents: &[Vec<usize>],
    local: &[bool],
    at: usize,
    state: &mut [u8],
    ancestors: &mut [FxHashSet<usize>],
    proved: &mut [bool],
) -> bool {
    match state[at] {
        1 => return false,
        2 => return proved[at],
        _ => {}
    }
    state[at] = 1;
    let layout = &facts.program.layouts[at];
    let mut whole = local[at];
    let mut above: FxHashSet<usize> = FxHashSet::default();
    if whole {
        for &parent in &parents[at] {
            above.insert(parent);
            let parent_layout = &facts.program.layouts[parent];
            if crate::hierarchy::is_interface(facts, parent_layout) {
                continue;
            }
            if !declared_chain(facts, parents, local, parent, state, ancestors, proved) {
                whole = false;
                break;
            }
            above.extend(ancestors[parent].iter().copied());
        }
    }
    if whole {
        whole = crate::hierarchy::ancestry(facts, layout)
            .iter()
            .skip(1)
            .all(|base| {
                facts
                    .index(base)
                    .is_some_and(|base_at| above.contains(&base_at))
            });
    }
    state[at] = 2;
    proved[at] = whole;
    if whole {
        ancestors[at] = above;
    }
    whole
}

impl<'a> JvmProgram<'a> {
    #[must_use]
    pub fn new(program: &'a Program) -> Self {
        let mut local_types = FxHashMap::default();
        for layout in &program.layouts {
            let local = !nts_core::hir::runtime::is_foreign_layout_name(&layout.name);
            for id in &layout.types {
                local_types.entry(*id).or_insert(local);
            }
        }
        let selectors: FxHashMap<_, _> = program
            .interface_access
            .families
            .iter()
            .flat_map(|family| {
                let local_types = &local_types;
                std::iter::once(&family.getter)
                    .chain(family.setter.iter())
                    .chain(family.raising.iter())
                    .map(move |entry| {
                        let face = local_types
                            .get(&family.face)
                            .copied()
                            .unwrap_or(false)
                            .then_some(family.face);
                        (entry.slot, (entry.declared.as_str(), face))
                    })
            })
            .collect();
        let bodies: FxHashMap<_, _> = program
            .funcs
            .iter()
            .filter(|func| !func.abstract_declaration)
            .map(|func| (func.name.as_str(), func))
            .collect();
        let mut live = FxHashSet::default();
        let mut selector_receivers = FxHashMap::default();
        for layout in &program.layouts {
            for (slot, entry) in layout.methods.iter().enumerate() {
                let Some(func) = entry.as_deref().and_then(|name| bodies.get(name)) else {
                    continue;
                };
                live.insert(slot);
                if program
                    .interface_access
                    .default_bodies
                    .contains_key(func.name.as_str())
                    && u32::try_from(slot).is_ok_and(|slot| selectors.contains_key(&slot))
                    && let Some(nts_core::hir::HirType::Managed(
                        nts_core::hir::ManagedType::Object(receiver),
                    )) = func.params.first().map(|param| &param.ty)
                {
                    selector_receivers.insert(func.name.as_str(), *receiver);
                }
            }
        }
        let mut facts = Self {
            program,
            strings: crate::builder::Plan::new(program),
            guarded_members: FxHashMap::default(),
            split: FxHashSet::default(),
            members: FxHashMap::default(),
            implemented: FxHashMap::default(),
            selectors,
            selector_receivers,
            live,
            positional: FxHashSet::default(),
            global_fields: global_fields(program),
            implementation_names: crate::entry::implementation_names(program),
            declared: DeclaredAncestry::default(),
        };
        facts.positional = facts.positional_accesses();
        facts.declared = facts.declared_ancestry();
        facts.settle_faces();
        facts.guarded_members = crate::guarded_members::plan(&facts);
        facts
    }

    /// `func` belongs to this program; every body and overload shares this plan.
    pub(crate) fn implementation_name(&self, func: &nts_core::hir::Func) -> &str {
        &self.implementation_names[func.name.as_str()]
    }

    /// An additional internal selector, never the public ordinary spelling.
    pub(crate) fn guarded_member(&self, slot: usize) -> Option<&str> {
        self.guarded_members
            .get(&slot)
            .map(|member| member.name.as_str())
    }

    /// The sole owner introducing this internal contract. Interface descendants
    /// inherit it without an abstract redeclaration or a second default.
    pub(crate) fn guarded_default(&self, layout: &Layout, slot: usize) -> bool {
        self.guarded_members.get(&slot).is_some_and(|member| {
            self.index(layout) == Some(member.default_owner)
                && match member.kind {
                    crate::guarded_members::ContractKind::Interface => {
                        crate::hierarchy::is_interface(self, layout)
                    }
                    crate::guarded_members::ContractKind::Companion => self.is_split(layout),
                    crate::guarded_members::ContractKind::ClassContract => {
                        !crate::hierarchy::is_interface(self, layout) && !self.is_split(layout)
                    }
                }
        })
    }

    /// Every field read or written by position through a value of its
    /// layout's type, in any function -- a family default's included, since a
    /// default reads the face's own storage.
    fn positional_accesses(&self) -> FxHashSet<(usize, u32)> {
        let program = self.program;
        let mut found = FxHashSet::default();
        for func in &program.funcs {
            for op in &func.values {
                let (nts_core::hir::OpKind::FieldGet { object, field }
                | nts_core::hir::OpKind::FieldSet { object, field, .. }) = &op.kind
                else {
                    continue;
                };
                let Some(nts_core::hir::HirType::Managed(nts_core::hir::ManagedType::Object(id))) =
                    func.values.get(object.0 as usize).map(|value| &value.ty)
                else {
                    continue;
                };
                if let Some(at) = program.layout(*id).and_then(|layout| self.index(layout)) {
                    found.insert((at, *field));
                }
            }
        }
        found
    }

    /// Whether some operation reads or writes field `field` by position
    /// through a value of `layout`'s type. A field of a face no operation
    /// reaches that way is one no holder has to keep where the face does, and
    /// one its companion interface needs no accessor for.
    #[must_use]
    pub fn reached(&self, layout: &Layout, field: u32) -> bool {
        self.index(layout)
            .is_some_and(|at| self.positional.contains(&(at, field)))
    }

    /// Every layout's declared interface parents, as far as the core proved
    /// them; see [`DeclaredAncestry`].
    fn declared_ancestry(&self) -> DeclaredAncestry {
        let program = self.program;
        let count = program.layouts.len();
        let mut by_type: FxHashMap<TypeId, usize> = FxHashMap::default();
        for (at, layout) in program.layouts.iter().enumerate() {
            for id in &layout.types {
                by_type.entry(*id).or_insert(at);
            }
        }
        let mut identity_of: FxHashMap<TypeId, &nts_core::hir::InterfaceIdentity> =
            FxHashMap::default();
        for identity in &program.interface_identities {
            for id in &identity.types {
                identity_of.entry(*id).or_insert(identity);
            }
        }
        let (mut parents, local) = declared_edges(program, &by_type, &identity_of);
        let mut state = vec![0u8; count];
        let mut ancestors: Vec<FxHashSet<usize>> = vec![FxHashSet::default(); count];
        let mut proved = vec![false; count];
        for at in 0..count {
            declared_chain(
                self,
                &parents,
                &local,
                at,
                &mut state,
                &mut ancestors,
                &mut proved,
            );
        }
        for at in 0..count {
            if !proved[at] {
                parents[at].clear();
                ancestors[at].clear();
            }
        }
        DeclaredAncestry {
            parents,
            ancestors,
            proved,
        }
    }

    /// `layout`'s direct declared interface parents, where its whole chain
    /// is proved; empty otherwise.
    #[must_use]
    pub fn declared_parents<'p>(&'p self, layout: &Layout) -> Vec<&'p Layout> {
        let program = self.program;
        self.index(layout)
            .and_then(|at| self.declared.parents.get(at))
            .map(|edges| edges.iter().map(|&at| &program.layouts[at]).collect())
            .unwrap_or_default()
    }

    /// Whether `layout`'s declared interface chain is proved whole.
    #[must_use]
    pub fn declared_proved(&self, layout: &Layout) -> bool {
        self.index(layout)
            .and_then(|at| self.declared.proved.get(at))
            .copied()
            .unwrap_or(false)
    }

    /// Which faces split, who belongs to each, and who implements which.
    ///
    /// **A face's values are its holders' and its holders' values.** A class
    /// holding face `L`, where `L` itself flows into face `M`, is a value of
    /// `M` too, and an `invokeinterface M$Face` reaches it. So each split face's
    /// members are the closure of its direct holders through every holder that
    /// is a face, and every member class implements the companion interface
    /// itself. Companion interfaces extend each other only along declared
    /// ancestry ([`DeclaredAncestry`]): two faces that merely flow into each
    /// other made them extend each other, and the JVM refused every class
    /// that loaded either -- `ClassCircularityError` in `in-operator` and
    /// four runtime modules. The declared graph is acyclic where proved,
    /// which is what reopens the door for it and nothing else.
    ///
    /// **Declared ancestry closes membership upward.** A holder of a child
    /// face is a value of every declared ancestor whether or not a value of
    /// it ever flows into an ancestor-typed place, and the child's own
    /// layout is one too. Each is admitted only where it can be a value of
    /// that ancestor itself ([`crate::split_faces::can_be`]): proof for the
    /// child alone does not prove the parent. An ancestor of a split face
    /// splits too, even with no direct holder of its own, because the
    /// child's companion extends its companion.
    fn settle_faces(&mut self) {
        let program = self.program;
        let direct: Vec<Vec<usize>> = program
            .layouts
            .iter()
            .map(|face| {
                if crate::split_faces::candidate(self, face) {
                    crate::split_faces::holders(self, face)
                        .into_iter()
                        .filter_map(|holder| self.index(holder))
                        .collect()
                } else {
                    Vec::new()
                }
            })
            .collect();
        let member_sets = self.close_members(&direct);
        let descends = |face: &Layout, member: usize| {
            crate::hierarchy::ancestry(self, &program.layouts[member])
                .iter()
                .any(|above| std::ptr::eq(*above, face))
        };
        let mut split: FxHashSet<usize> = FxHashSet::default();
        for (at, face) in program.layouts.iter().enumerate() {
            if crate::split_faces::eligible(self, face)
                && member_sets[at]
                    .iter()
                    .any(|member| !descends(face, *member))
            {
                split.insert(at);
            }
        }
        // A split face's companions extend its declared ancestors'
        // companions, so every proved, eligible ancestor splits too.
        let mut queue: Vec<usize> = split.iter().copied().collect();
        while let Some(at) = queue.pop() {
            for &ancestor in &self.declared.ancestors[at] {
                if !split.contains(&ancestor)
                    && crate::split_faces::eligible(self, &program.layouts[ancestor])
                {
                    split.insert(ancestor);
                    queue.push(ancestor);
                }
            }
        }
        for at in split {
            let face = &program.layouts[at];
            self.split.extend(face.types.iter().copied());
            self.members.insert(at, member_sets[at].clone());
        }
        // Each member implements the interface itself unless its class is the
        // face's or one below it, or a class above it is a member already.
        let mut implemented: FxHashMap<usize, Vec<usize>> = FxHashMap::default();
        let mut faces: Vec<&usize> = self.members.keys().collect();
        faces.sort_unstable();
        for &face in faces {
            let set = &self.members[&face];
            for &member in set {
                let chain = crate::hierarchy::ancestry(self, &program.layouts[member]);
                let inherits = chain.iter().skip(1).any(|above| {
                    self.index(above)
                        .is_some_and(|at| at == face || set.contains(&at))
                });
                let is_face = chain.iter().any(|at| self.index(at) == Some(face));
                if !inherits && !is_face {
                    implemented.entry(member).or_default().push(face);
                }
            }
        }
        self.implemented = implemented;
    }

    /// Every face's members, closed under holder flow and under declared
    /// ancestry, each admission re-asked of the face it joins.
    ///
    /// Flow first, as settlement always closed it. Then ancestry, in
    /// descendant-first order over the declared graph: a face pushes
    /// itself and its members into every ancestor, expanded through
    /// holder flow there too, so when an ancestor's turn comes its set
    /// already holds what its descendants contributed and one pass
    /// suffices.
    fn close_members(&self, direct: &[Vec<usize>]) -> Vec<FxHashSet<usize>> {
        let program = self.program;
        let mut can: FxHashMap<(usize, usize), bool> = FxHashMap::default();
        let mut admit = |facts: &Self, face: usize, candidate: usize| {
            *can.entry((face, candidate)).or_insert_with(|| {
                crate::split_faces::can_be(
                    facts,
                    &program.layouts[face],
                    &program.layouts[candidate],
                )
            })
        };
        let mut member_sets: Vec<FxHashSet<usize>> =
            vec![FxHashSet::default(); program.layouts.len()];
        for (at, face) in program.layouts.iter().enumerate() {
            if !crate::split_faces::is_face(self, face) {
                continue;
            }
            let mut queue: Vec<usize> = direct[at].clone();
            while let Some(next) = queue.pop() {
                // A holder of a holder is a member only if it can be a
                // value of *this* face: one keeping the field it reaches
                // somewhere else is not, whatever the face between them
                // allows -- 3258 refusing accessor stubs when the closure
                // did not ask.
                if next == at || member_sets[at].contains(&next) || !admit(self, at, next) {
                    continue;
                }
                member_sets[at].insert(next);
                queue.extend(direct[next].iter().copied());
            }
        }
        for at in self.descendant_first() {
            if !self.declared.proved[at] {
                continue;
            }
            let candidates: Vec<usize> = std::iter::once(at)
                .chain(member_sets[at].iter().copied())
                .collect();
            for &ancestor in &self.declared.ancestors[at] {
                let mut queue: Vec<usize> = candidates.clone();
                while let Some(candidate) = queue.pop() {
                    if candidate == ancestor
                        || member_sets[ancestor].contains(&candidate)
                        || !admit(self, ancestor, candidate)
                    {
                        continue;
                    }
                    member_sets[ancestor].insert(candidate);
                    queue.extend(direct[candidate].iter().copied());
                }
            }
        }
        member_sets
    }

    /// Layout indices with every declared descendant before its ancestors:
    /// a post-order over the declared graph, reversed. Unproved layouts
    /// have no edges and sit anywhere.
    fn descendant_first(&self) -> Vec<usize> {
        fn visit(parents: &[Vec<usize>], at: usize, state: &mut [u8], order: &mut Vec<usize>) {
            if state[at] != 0 {
                return;
            }
            state[at] = 1;
            for &parent in &parents[at] {
                visit(parents, parent, state, order);
            }
            state[at] = 2;
            order.push(at);
        }
        let count = self.program.layouts.len();
        let mut state = vec![0u8; count];
        let mut order: Vec<usize> = Vec::with_capacity(count);
        for at in 0..count {
            visit(&self.declared.parents, at, &mut state, &mut order);
        }
        order.reverse();
        order
    }

    /// The core's program, for a caller that needs the type itself.
    #[must_use]
    pub fn program(&self) -> &'a Program {
        self.program
    }

    /// `layout`'s index in the program's layouts, if it is one of them.
    #[must_use]
    pub fn index(&self, layout: &Layout) -> Option<usize> {
        let range = self.program.layouts.as_ptr_range();
        let at = std::ptr::from_ref(layout);
        range
            .contains(&at)
            .then(|| (at as usize - range.start as usize) / std::mem::size_of::<Layout>())
    }

    /// Whether some layout fills dispatch slot `slot` with a body: a slot that
    /// no class does is one no call reaches, since reachability keeps a body
    /// wherever a call can. A face still declares it.
    #[must_use]
    pub fn live(&self, slot: usize) -> bool {
        self.live.contains(&slot)
    }

    /// Whether `layout` is a split face.
    #[must_use]
    pub fn is_split(&self, layout: &Layout) -> bool {
        layout.types.iter().any(|id| self.split.contains(id))
    }

    /// Whether split face `face` can hold a value of `layout`: `layout` is one
    /// of its members ([`Self::settle_faces`]).
    #[must_use]
    pub fn member(&self, face: &Layout, layout: &Layout) -> bool {
        let (Some(face), Some(layout)) = (self.index(face), self.index(layout)) else {
            return false;
        };
        self.members
            .get(&face)
            .is_some_and(|members| members.contains(&layout))
    }

    /// The split faces `layout`'s class implements itself, in layout order.
    #[must_use]
    pub fn implemented(&self, layout: &Layout) -> Vec<&'a Layout> {
        let program = self.program;
        self.index(layout)
            .and_then(|at| self.implemented.get(&at))
            .map(|faces| faces.iter().map(|&at| &program.layouts[at]).collect())
            .unwrap_or_default()
    }

    /// The declared accessor of a field family's slot: the name a call through
    /// the slot carries (`Callee::Virtual`), and so the name every class's
    /// method there must have. A layout's own table holds its *row* at the
    /// slot -- `Point#nts$get$x@interface1@1` on the face itself -- and naming
    /// a method after that was a member the call never reached.
    /// The static field module global `index` is stored in.
    ///
    /// Its name mangled for the JVM (`body::method_name`), except where an
    /// earlier global mangles alike: then `<name>_<index>`, the rule properties
    /// are told apart by (`hierarchy::field_name`), with the index bumped past
    /// any global's own spelling. The mangling is not one-to-one -- every
    /// character DEX forbids becomes `$`, and so do ZWNJ and ZWJ, which an
    /// ECMAScript identifier may contain -- so test262's
    /// `identifiers/part-zwj-zwnj-escaped`, three globals `$`, `$‍` and
    /// `$‌`, declared one field three times and the class was refused.
    #[must_use]
    pub fn global_field(&self, index: usize) -> &str {
        &self.global_fields[index]
    }

    #[must_use]
    pub fn selector(&self, slot: usize) -> Option<&'a str> {
        u32::try_from(slot)
            .ok()
            .and_then(|slot| self.selectors.get(&slot).map(|(declared, _)| *declared))
    }

    /// The owned receiver of the actual missing-field default at a recognized
    /// field-family slot. Its source face can have a different layout from the
    /// row's receiver; a display name or equal storage never proves ownership.
    /// Unknown and foreign selector faces do not license root storage. The
    /// published default record supplies the domain, not purity or alias proof.
    pub(crate) fn selector_receiver(&self, slot: usize, body: &str) -> Option<TypeId> {
        let (_, face) = self.selectors.get(&u32::try_from(slot).ok()?)?;
        if face.is_none() {
            return None;
        }
        self.selector_receivers.get(body).copied()
    }
}

impl Deref for JvmProgram<'_> {
    type Target = Program;

    fn deref(&self) -> &Program {
        self.program
    }
}

/// [`JvmProgram::global_field`] for every global, in index order.
///
/// **Every global's own spelling is reserved first**, so a generated name never
/// takes one -- not even a later global's. `$‍` and `$‌` both mangle
/// to `$$`, and the second became `$$_1`, which a third global spelled `$$_1`
/// then declared again. A generated name bumps its index until it is free.
/// Linear in the globals, with sets, since a runtime module has thousands.
fn global_fields(program: &Program) -> Vec<String> {
    let spelled: Vec<String> = program
        .globals
        .iter()
        .map(|global| crate::body::method_name(&global.name))
        .collect();
    let reserved: FxHashSet<&str> = spelled.iter().map(String::as_str).collect();
    let mut taken: FxHashSet<String> = FxHashSet::default();
    spelled
        .iter()
        .enumerate()
        .map(|(at, name)| {
            if taken.insert(name.clone()) {
                return name.clone();
            }
            // At most `n` spellings are reserved and `n` names taken, so one of
            // any `2n + 1` consecutive candidates is free.
            let free = (at..)
                .take(2 * spelled.len() + 1)
                .map(|index| format!("{name}_{index}"))
                .find(|candidate| {
                    !reserved.contains(candidate.as_str()) && !taken.contains(candidate)
                })
                .unwrap_or_else(|| format!("{name}_{at}"));
            taken.insert(free.clone());
            free
        })
        .collect()
}

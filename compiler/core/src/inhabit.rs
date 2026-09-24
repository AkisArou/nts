//! Which layouts can inhabit a slot of a given type.
//!
//! **One derivation, two consumers.** [`crate::receivers`] counts what
//! indirection would cost and `hir::lower` decides where to emit it, and they
//! must agree about the same set or the census is measuring a rule the compiler
//! does not apply. Two derivations of one fact will disagree; this module is the
//! one.
//!
//! # The claim, and why it is sound in the direction that matters
//!
//! If a class `C` is assignable to an interface `I` then `C` declares every
//! *required* member of `I`, so `C`'s member **names** cover `I`'s required
//! names. Comparing names alone therefore also admits classes that are not
//! assignable — which is the safe direction for a type-test chain, because a
//! chain needs its arm set to be a **superset** of what can arrive. A value
//! matching no arm aborts; a value matching an arm it could never have been is
//! merely a test that never fires.
//!
//! Record 0294 ruled out the *complete* satisfier set, and this is not it: that
//! set is what you need to decide which interfaces are safe to leave alone, and
//! an over-approximation is what you need to decide which must be made indirect.
//! `through_possibly_inhabited`'s own doc draws the same distinction.
//!
//! # The bound
//!
//! The set covers **classes this program declares**. A library class is
//! invisible: `Error` declares `name` and could inhabit an `interface Named {
//! name: string }`. For a census that is a stated bound; for a chain it would be
//! a soundness hole, and the answer is `coerce`'s existing `NotAPrefix::Unknown`
//! — a source with no layout is already refused by name, which is the decision
//! record 0344 asked for and it was already written.

use nts_semantic_schema::schema::{NodeId, SemanticSnapshot, SymbolId, TypeId, TypeKind};
use nts_semantic_schema::{syntax, walk};
use rustc_hash::{FxHashMap, FxHashSet};

/// The two proxies for "a class could inhabit this interface", and the arm
/// count a chain through it would need.
///
/// The real set is the one record 0294 rules out: *"the classes that work by
/// accident are exactly the ones producing no layout evidence."* So neither of
/// these is the answer, and neither is implementable. Together they **bracket**
/// the argument, which is what the design step needs — the way
/// `erasure::Analysis::Local` is a bracket and not a proposal.
#[derive(Debug)]
pub struct Inhabitants {
    /// See [`crate::receivers::Excluded::interfaces_unexamined`].
    pub interfaces_unexamined: u32,
    /// See [`crate::receivers::Excluded::classes_unexamined`].
    pub classes_unexamined: u32,
    /// Named in some class's heritage clause. Misses a structural satisfier, so
    /// it over-states what a narrow rule would spare.
    implemented: FxHashSet<u32>,
    // Both sets stay private and are read through predicates, so a consumer
    // cannot ask a question this module has not thought about -- which is the
    // point of there being one derivation rather than a shared field.
    /// How many classes have a same-named member for each required member.
    ///
    /// A **count**, not a membership test, because the design step needs to know
    /// how long a type-test chain would be and not merely whether one is needed.
    /// Absent is zero; [`Inhabitable::satisfied`] is the old predicate, derived
    /// from it so the two cannot disagree.
    ///
    /// Compares names and not types, because assignability is the checker's and
    /// this does not have it — so it both over- and under-counts against the real
    /// relation. As an **arm count** it is an upper bound on distinct layouts:
    /// two classes can merge into one layout ([`crate::hir::Layout::same_shape`])
    /// and none can split, so counting classes never reports fewer arms than a
    /// chain would need.
    covering: FxHashMap<u32, Vec<TypeId>>,
    /// Interfaces some class covers **by member name**: the published lower
    /// bracket, kept apart from [`Inhabitable::covering`] now that the latter
    /// also counts an `implements` a name comparison misses.
    by_name: FxHashSet<u32>,
    /// Interface symbols neither proxy could examine. Counted as *possibly*
    /// inhabited, which is the direction that keeps a narrow rule sound.
    unexamined: FxHashSet<u32>,
}

impl Inhabitants {
    /// How many classes could inhabit this interface: the arm count a chain
    /// through it would need, **not** counting the interface's own layout.
    #[must_use]
    pub fn covering(&self, symbol: u32) -> u32 {
        u32::try_from(self.covering.get(&symbol).map_or(0, Vec::len)).unwrap_or(u32::MAX)
    }

    /// Every layout a value at a slot of this type can have, **its own included**.
    ///
    /// The arm list a chain through such a slot needs, and the order it should
    /// test in: the declared type first, because an object literal written at an
    /// interface is built at the interface's own shape and at no class's, and
    /// because record 0294 measured every structural-cast site as monomorphic --
    /// so the arm a value most often is should be the first test.
    ///
    /// **One means no chain.** A type nothing else can inhabit reads at a fixed
    /// offset and costs nothing, which is 3,334 of the 4,174 interface accesses
    /// in `runtime/node`.
    ///
    /// `TypeId`s and not layouts, because layouts do not exist yet where this is
    /// asked. `layout_of` *creates* one, and record 0199 is what creating a
    /// layout mid-lowering costs: "assignments that had been writing a closure
    /// into a slot of its own type started writing it into a distinct struct".
    /// So arms are resolved to indices after lowering, where every layout is
    /// already built.
    #[must_use]
    pub fn arms(&self, snapshot: &SemanticSnapshot, ty: TypeId) -> Vec<TypeId> {
        let mut out = vec![ty];
        let Some(symbol) = snapshot
            .types
            .get(ty.0 as usize)
            .and_then(|record| record.symbol)
            .map(|symbol| walk::denoted(snapshot, symbol))
        else {
            return out;
        };
        if let Some(classes) = self.covering.get(&symbol.0) {
            // A class whose instance type *is* the slot's type is already arm
            // zero; adding it again would emit the same test twice.
            out.extend(classes.iter().copied().filter(|class| *class != ty));
        }
        out
    }

    /// Named in some class's heritage clause: the bracket's upper arm.
    #[must_use]
    pub fn implemented(&self, symbol: u32) -> bool {
        self.implemented.contains(&symbol)
    }

    /// Neither proxy could examine it, so it counts as *possibly* inhabited.
    #[must_use]
    pub fn unexamined(&self, symbol: u32) -> bool {
        self.unexamined.contains(&symbol)
    }

    /// The published lower-bracket predicate: **the name proxy alone**.
    ///
    /// Deliberately not `covering(symbol) > 0`, which now also counts a class
    /// that merely *says* `implements`. That is the right arm count and the wrong
    /// bracket: `through_satisfied`'s sentence is about structural satisfaction,
    /// and widening it silently would move a published number by changing what it
    /// claims rather than what it found.
    #[must_use]
    pub fn satisfied(&self, symbol: u32) -> bool {
        self.by_name.contains(&symbol)
    }

    #[must_use]
    pub fn of(snapshot: &SemanticSnapshot) -> Self {
        let mut implemented = FxHashSet::default();
        let mut unexamined: FxHashSet<u32> = FxHashSet::default();
        let mut class_members: Vec<FxHashSet<&str>> = Vec::new();
        let mut interfaces_unexamined = 0;
        let mut classes_unexamined = 0;

        // Aligned with `class_members` by position: one entry per class that was
        // examined, holding the interfaces that class *names*. Two lists rather
        // than one struct because `class_members` borrows the snapshot and
        // splitting the borrow is what keeps this a single pass.
        let mut class_heritage: Vec<FxHashSet<u32>> = Vec::new();
        // And the instance type of each, which is what an arm names.
        let mut class_types: Vec<TypeId> = Vec::new();

        for index in 0..snapshot.nodes.len() {
            let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
            let Some(kind) = walk::kind_of(snapshot, id) else {
                continue;
            };
            if !matches!(
                kind,
                syntax::CLASS_DECLARATION | syntax::CLASS_EXPRESSION
            ) {
                continue;
            }
            let mut mine: FxHashSet<u32> = FxHashSet::default();
            // Heritage clauses, not `base_types`: `lower.rs` records that
            // `base_types` "in fact carries neither for a class that only
            // implements -- `class Counting implements Sink` has no entry at
            // all. That was measured rather than assumed."
            for clause in walk::children(snapshot, id) {
                if walk::kind_of(snapshot, clause) != Some(syntax::HERITAGE_CLAUSE) {
                    continue;
                }
                named_symbols(snapshot, clause, &mut mine);
            }
            implemented.extend(mine.iter().copied());
            let instance = instance_type_of(snapshot, id).unwrap_or(TypeId(u32::MAX));
            match snapshot
                .types
                .get(instance.0 as usize)
                .map(|record| &record.kind)
            {
                Some(TypeKind::Object { properties }) => {
                    class_members.push(properties.iter().map(|p| p.name.as_str()).collect());
                    class_heritage.push(mine);
                    class_types.push(instance);
                },
                _ => classes_unexamined += 1,
            }
        }

        let mut covering: FxHashMap<u32, Vec<TypeId>> = FxHashMap::default();
        let mut by_name: FxHashSet<u32> = FxHashSet::default();
        for (index, record) in snapshot.symbols.iter().enumerate() {
            if !record
                .declarations
                .iter()
                .any(|at| walk::kind_of(snapshot, *at) == Some(syntax::INTERFACE_DECLARATION))
            {
                continue;
            }
            let Some(TypeKind::Object { properties }) = record
                .declarations
                .iter()
                .find_map(|at| snapshot.node_types.get(at))
                .and_then(|ty| snapshot.types.get(ty.0 as usize))
                .map(|record| &record.kind)
            else {
                interfaces_unexamined += 1;
                unexamined.insert(u32::try_from(index).unwrap_or(u32::MAX));
                continue;
            };
            let symbol = u32::try_from(index).unwrap_or(u32::MAX);
            let required: Vec<&str> = properties
                .iter()
                .filter(|property| !property.optional)
                .map(|property| property.name.as_str())
                .collect();
            // **A class that says `implements I` inhabits it whether or not the
            // name proxy agrees**, and leaving it out would be unsound in the one
            // direction that matters: a chain missing a real arm aborts a correct
            // program. The empty-`required` skip below is why this is not
            // redundant -- an interface with only optional members is covered by
            // nobody under the name rule and can still be implemented by name.
            //
            // Found by the `arms` column's own `1` row: three accesses read as
            // one arm while their interface was in `implemented`, which is a
            // chain of one arm through a type two layouts reach.
            let covers: Vec<TypeId> = class_members
                .iter()
                .zip(&class_heritage)
                .zip(&class_types)
                .filter(|((members, heritage), _)| {
                    heritage.contains(&symbol)
                        || (!required.is_empty()
                            && required.iter().all(|name| members.contains(name)))
                })
                .map(|(_, instance)| *instance)
                .collect();
            if !covers.is_empty() {
                covering.insert(symbol, covers);
            }
            if !required.is_empty()
                && class_members
                    .iter()
                    .any(|members| required.iter().all(|name| members.contains(name)))
            {
                by_name.insert(symbol);
            }
        }

        Self {
            interfaces_unexamined,
            classes_unexamined,
            implemented,
            covering,
            by_name,
            unexamined,
        }
    }
}

/// The instance type a class node declares.
///
/// Four lines rather than a `pub` in `hir::lower`, which is the same trade
/// `erasure` makes: reading the construct signature's result answers for a
/// declaration and an expression without asking which kind of node this is.
fn instance_type_of(snapshot: &SemanticSnapshot, class: NodeId) -> Option<TypeId> {
    let ty = snapshot.node_types.get(&class).copied()?;
    let TypeKind::Function(signature) = snapshot.types.get(ty.0 as usize)?.kind else {
        return Some(ty);
    };
    Some(snapshot.signatures.get(signature.0 as usize)?.return_type)
}

/// Every symbol a heritage clause mentions, however it is spelled.
///
/// Walked rather than read at a fixed child: `implements Foo<Bar>` and
/// `implements ns.Foo` put the name at different depths, and a fixed index finds
/// one of them.
fn named_symbols(snapshot: &SemanticSnapshot, id: NodeId, out: &mut FxHashSet<u32>) {
    if let Some(symbol) = snapshot
        .nodes
        .get(id.0 as usize)
        .and_then(|node| node.symbol)
    {
        out.insert(walk::denoted(snapshot, SymbolId(symbol.0)).0);
    }
    for child in walk::children(snapshot, id) {
        named_symbols(snapshot, child, out);
    }
}


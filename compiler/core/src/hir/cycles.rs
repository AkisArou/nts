//! Cycle analysis without expanding every structural-prefix pair.
//!
//! Layout nodes follow reference fields. Slot nodes follow what their type can
//! hold (bases, explicit casts, structural prefixes and what an `Unerase` can
//! produce) and then the held layout. Keeping these two steps separate
//! matters: an empty layout cannot start a cycle, but an empty typed view can
//! hold an object that can.

use super::{
    CastSources, Cycles, Field, HirType, ManagedType, Program, is_closure_type, native,
    strongly_connected,
};
use nts_semantic_schema::{PropertyKey, TypeId};
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Hash, PartialEq, Eq)]
struct Slot<'a> {
    member: Member<'a>,
    ty: &'a HirType,
}

impl<'a> From<&'a Field> for Slot<'a> {
    fn from(field: &'a Field) -> Self {
        Self {
            member: Member::from(field),
            ty: &field.ty,
        }
    }
}

/// A member's identity without its type: public names ignore owners, private
/// names retain them ([`Field::names_the_same_member`]).
#[derive(Hash, PartialEq, Eq)]
struct Member<'a> {
    name: &'a PropertyKey,
    declared_by: Option<TypeId>,
}

impl<'a> From<&'a Field> for Member<'a> {
    fn from(field: &'a Field) -> Self {
        Self {
            name: &field.name,
            declared_by: if matches!(field.name, PropertyKey::Private(_)) {
                field.declared_by
            } else {
                None
            },
        }
    }
}

/// Whether every object read as a layout's type holds this member. An
/// optional one is erased or possibly-undefined storage, which an object
/// without it answers as `undefined`, so it decides nothing about what the
/// object is.
pub(super) fn requires(field: &Field) -> bool {
    !matches!(
        field.ty,
        HirType::Erased | HirType::PossiblyUndefined(_) | HirType::Void
    )
}

struct Graph<'a> {
    program: &'a Program,
    layout_of: FxHashMap<TypeId, usize>,
    edges: Vec<Vec<usize>>,
    all_layouts: Option<usize>,
}

impl<'a> Graph<'a> {
    fn build(program: &'a Program) -> Self {
        let count = program.layouts.len();
        let mut graph = Self {
            program,
            layout_of: FxHashMap::default(),
            edges: vec![Vec::new(); 2 * count],
            all_layouts: None,
        };
        for (at, layout) in program.layouts.iter().enumerate() {
            for ty in &layout.types {
                graph.layout_of.entry(*ty).or_insert(at);
            }
            // Real layout nodes are [0, count); their slot nodes follow them.
            graph.edges[count + at].push(at);
        }
        for (at, layout) in program.layouts.iter().enumerate() {
            if let Some(above) = layout.base.and_then(|base| graph.layout_of.get(&base)) {
                graph.edges[count + *above].push(count + at);
            }
            for field in &layout.fields {
                graph.reference(at, &field.ty);
            }
        }
        let casts = program.explicit_cast_sources();
        for &(target, source) in &casts.pairs {
            graph.edges[count + target].push(count + source);
        }
        graph.structural_prefixes();
        // Last: what an erased value can hold is read from the slot edges
        // above, and adds none that change it (see `unerasures`).
        graph.unerasures(&casts);
        #[cfg(test)]
        super::cycles_oracle::record_work(
            graph.edges.len() + graph.edges.iter().map(Vec::len).sum::<usize>(),
        );
        graph
    }

    fn node(&mut self) -> usize {
        let at = self.edges.len();
        self.edges.push(Vec::new());
        at
    }

    fn any_layout(&mut self) -> usize {
        if let Some(at) = self.all_layouts {
            return at;
        }
        let at = self.node();
        let count = self.program.layouts.len();
        self.edges[at].extend(count..2 * count);
        self.all_layouts = Some(at);
        at
    }

    /// The old `reaches` relation, with shared unknown targets and a first-wins
    /// type index. Exhaustive so a new HIR type must decide its reference edges.
    fn reference(&mut self, from: usize, ty: &HirType) {
        let target = match ty {
            HirType::PossiblyUndefined(payload) => {
                self.reference(from, payload);
                return;
            }
            HirType::Managed(ManagedType::Object(id)) => match self.layout_of.get(id).copied() {
                Some(at) => self.program.layouts.len() + at,
                None => self.any_layout(),
            },
            HirType::Managed(
                ManagedType::Array(element)
                | ManagedType::View(element)
                | ManagedType::Set(element)
                | ManagedType::Promise(element),
            ) => {
                self.reference(from, element);
                return;
            }
            HirType::Managed(ManagedType::Map(key, value) | ManagedType::Table(key, value)) => {
                self.reference(from, key);
                self.reference(from, value);
                return;
            }
            HirType::Erased => self.any_layout(),
            HirType::NativePointer(_)
                if ty
                    .counted_family()
                    .is_some_and(native::Family::holds_closures) =>
            {
                self.any_layout()
            }
            HirType::Managed(
                ManagedType::String
                | ManagedType::BoxedBigInt
                | ManagedType::Template
                | ManagedType::Date
                | ManagedType::Region
                | ManagedType::Buffer
                | ManagedType::AnyView
                | ManagedType::DataView
                | ManagedType::Symbol,
            )
            | HirType::NativePointer(_)
            | HirType::Void
            | HirType::Never
            | HirType::Bool
            | HirType::Int { .. }
            | HirType::Float { .. }
            | HirType::BigInt => return,
        };
        self.edges[from].push(target);
    }

    fn structural_prefixes(&mut self) {
        let program = self.program;
        let count = program.layouts.len();
        let root = self.node();
        // A trie edge is exactly lower::same_slot: public names ignore owners,
        // private names retain them, and HIR types compare in full.
        let mut prefixes: FxHashMap<(usize, Slot<'_>), usize> = FxHashMap::default();
        let mut terminal = Vec::with_capacity(count);
        for (source, layout) in program.layouts.iter().enumerate() {
            let mut prefix = root;
            for field in &layout.fields {
                let key = (prefix, Slot::from(field));
                prefix = if let Some(&next) = prefixes.get(&key) {
                    next
                } else {
                    let next = self.node();
                    self.edges[prefix].push(next);
                    prefixes.insert(key, next);
                    next
                };
            }
            // A prefix reaches the slots with exactly its fields, and by its
            // child edges all longer matching layouts. It shares that suffix
            // walk among every target instead of enumerating their pairs.
            self.edges[prefix].push(count + source);
            terminal.push(prefix);
        }
        let signatures: FxHashSet<TypeId> = program
            .layouts
            .iter()
            .filter(|layout| layout.types.iter().copied().any(is_closure_type))
            .filter_map(|layout| layout.base)
            .collect();
        for (target, layout) in program.layouts.iter().enumerate() {
            // A fieldless signature admits only its declared closure subtypes.
            // A concrete empty closure/class/interface still admits everything.
            if layout.fields.is_empty() && layout.types.iter().any(|ty| signatures.contains(ty)) {
                continue;
            }
            // This includes a reflexive relationship. The old search already
            // started at the target itself, so reachability is unchanged.
            self.edges[count + target].push(terminal[target]);
        }
    }

    /// What an `Unerase` to each type the program unerases to can produce:
    /// an object an erased value can hold, which can be read as that type.
    ///
    /// **Held by an erased value** is the slot closure of the types the program
    /// erases: a `Base` erased can be any layout a `Base` slot holds, so its
    /// subclasses, prefix layouts and cast sources too. Only slot and prefix
    /// nodes are followed, never a layout's reference fields: those lead to
    /// what an object *points at*, not to what it *is*. An erased type with no
    /// layout here could be anything. The edges this adds go from an unerased
    /// type's slot to layouts already in that closure, so the closure they
    /// would give, computed again, is the same: an unerased value erased again
    /// is one of the objects that were erased.
    ///
    /// **Read as the type** is supplying every member it requires: as a field
    /// with the same member identity, or as an owner of the type's interface
    /// family for that member. Every backend reads a value through its type's
    /// members -- positionally or through its family row -- so an object
    /// lacking one is not a value of that type at all; the JVM checkcasts it.
    /// An `instanceof Leaf` licensing an unerase to `Leaf` therefore cannot
    /// produce the cyclic `Link` erased beside it, which holds no `n`, and a
    /// `Leaf[]` stays acyclic. A `Knot { next; w }` narrowed to `Weighted { w }`
    /// by a type guard is held there, though `w` is not its first field.
    fn unerasures(&mut self, casts: &CastSources) {
        let program = self.program;
        let count = program.layouts.len();
        let targets: Vec<usize> = casts.unerased.iter().flatten().copied().collect();
        if targets.is_empty() || casts.erased.is_empty() {
            return;
        }
        let erasable: Vec<bool> = if casts.erased.contains(&None) {
            vec![true; count]
        } else {
            let mut seen = vec![false; self.edges.len()];
            let mut work: Vec<usize> = casts.erased.iter().flatten().map(|at| count + at).collect();
            for &at in &work {
                seen[at] = true;
            }
            while let Some(at) = work.pop() {
                for &next in &self.edges[at] {
                    if next >= count && !std::mem::replace(&mut seen[next], true) {
                        work.push(next);
                    }
                }
            }
            seen[count..2 * count].to_vec()
        };
        // Who supplies each member, ascending by layout so a membership test
        // is a binary search: as a field, by member identity, and as an owner
        // of a face's family, by face layout and member name.
        let mut by_field: FxHashMap<Member<'_>, Vec<usize>> = FxHashMap::default();
        for (at, layout) in program.layouts.iter().enumerate() {
            for field in &layout.fields {
                let suppliers = by_field.entry(Member::from(field)).or_default();
                if suppliers.last() != Some(&at) {
                    suppliers.push(at);
                }
            }
        }
        let mut by_family: FxHashMap<(usize, &PropertyKey), Vec<usize>> = FxHashMap::default();
        for family in &program.interface_access.families {
            let Some(&face) = self.layout_of.get(&family.face) else {
                continue;
            };
            by_family.entry((face, &family.member)).or_default().extend(
                family
                    .owners
                    .iter()
                    .filter_map(|owner| self.layout_of.get(owner)),
            );
        }
        for owners in by_family.values_mut() {
            owners.sort_unstable();
            owners.dedup();
        }
        let none: &[usize] = &[];
        for target in targets {
            let mut candidates: Vec<usize> = (0..count)
                .filter(|&at| at != target && erasable[at])
                .collect();
            for field in program.layouts[target]
                .fields
                .iter()
                .filter(|f| requires(f))
            {
                if candidates.is_empty() {
                    break;
                }
                let fields = by_field
                    .get(&Member::from(field))
                    .map_or(none, Vec::as_slice);
                let families = by_family
                    .get(&(target, &field.name))
                    .map_or(none, Vec::as_slice);
                candidates.retain(|at| {
                    fields.binary_search(at).is_ok() || families.binary_search(at).is_ok()
                });
            }
            self.edges[count + target].extend(candidates.into_iter().map(|at| count + at));
        }
    }

    fn answer(self) -> Cycles {
        let count = self.program.layouts.len();
        let component = strongly_connected(&self.edges);
        let mut members = vec![0usize; self.edges.len()];
        for &of in &component {
            members[of] += 1;
        }
        // Slot/prefix cycles alone are assignability, not object cycles. Only
        // real layouts are answered, and only reference fields leave them.
        // A path from a real layout back to itself contains a reference edge,
        // exactly as the old graph of fully expanded field edges did.
        let cyclic: Vec<bool> = (0..count).map(|at| members[component[at]] > 1).collect();
        let mut backwards = vec![Vec::new(); self.edges.len()];
        for (from, edges) in self.edges.iter().enumerate() {
            for &to in edges {
                backwards[to].push(from);
            }
        }
        let mut reaches = vec![false; self.edges.len()];
        let mut work: Vec<usize> = (0..count).filter(|&at| cyclic[at]).collect();
        for &at in &work {
            reaches[at] = true;
        }
        while let Some(at) = work.pop() {
            for &from in &backwards[at] {
                if !std::mem::replace(&mut reaches[from], true) {
                    work.push(from);
                }
            }
        }
        Cycles {
            cyclic,
            layout_of: self.layout_of,
            reaches_a_cycle: reaches[count..2 * count].to_vec(),
        }
    }
}

pub(super) fn analyze(program: &Program) -> Cycles {
    Graph::build(program).answer()
}

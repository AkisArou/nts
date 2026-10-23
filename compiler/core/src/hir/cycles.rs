//! Cycle analysis without expanding every structural-prefix pair.
//!
//! Layout nodes follow reference fields. Slot nodes follow what their type can
//! hold (bases, explicit casts and structural prefixes) and then the held
//! layout. Keeping these two steps separate matters: an empty layout cannot
//! start a cycle, but an empty typed view can hold an object that can.

use super::{
    Cycles, Field, HirType, ManagedType, Program, is_closure_type, native, strongly_connected,
};
use nts_semantic_schema::TypeId;
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Hash, PartialEq, Eq)]
struct Slot<'a> {
    name: &'a str,
    declared_by: Option<TypeId>,
    ty: &'a HirType,
}

impl<'a> From<&'a Field> for Slot<'a> {
    fn from(field: &'a Field) -> Self {
        Self {
            name: &field.name,
            declared_by: if field.name.starts_with('#') {
                field.declared_by
            } else {
                None
            },
            ty: &field.ty,
        }
    }
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
        for (target, source) in program.explicit_cast_sources() {
            graph.edges[count + target].push(count + source);
        }
        graph.structural_prefixes();
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

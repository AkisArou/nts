//! Layout collection owns both the source-ordered layouts and their indexes.

use std::collections::BTreeSet;

use rustc_hash::{FxHashMap, FxHashSet};

use super::{Field, HirType, Layout, Program, TypeId};

/// Exactly `Layout::same_shape`: owner and readonly are deliberately absent.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Shape {
    base: Option<TypeId>,
    fields: Vec<(String, HirType, Option<super::super::native::Scalar>)>,
    methods: Vec<Option<String>>,
}

impl From<&Layout> for Shape {
    fn from(layout: &Layout) -> Self {
        Self::new(&layout.fields, &layout.methods, layout.base)
    }
}

impl Shape {
    fn new(fields: &[Field], methods: &[Option<String>], base: Option<TypeId>) -> Self {
        Self {
            base,
            fields: fields
                .iter()
                .map(|field| (field.name.clone(), field.ty.clone(), field.written))
                .collect(),
            methods: methods.to_vec(),
        }
    }
}

/// The equivalence classes of `may_merge`, using the current layout spelling.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum Names {
    Nominal(String),
    Structural { tuple: bool },
}

impl Names {
    fn of(name: &str) -> Self {
        if super::nominal_name(name) {
            Self::Nominal(name.to_owned())
        } else {
            Self::Structural {
                tuple: super::super::is_tuple_layout_name(name),
            }
        }
    }
}

#[derive(Debug, Default)]
struct Holders {
    total: usize,
    owners: FxHashMap<Option<TypeId>, usize>,
}

/// No caller can mutate a layout while keeping its former indexed answer.
#[derive(Debug, Default)]
pub(super) struct LayoutCollector {
    layouts: Vec<Layout>,
    by_type: FxHashMap<TypeId, BTreeSet<usize>>,
    by_shape: FxHashMap<(Shape, Names), BTreeSet<usize>>,
    by_owner: FxHashMap<Option<TypeId>, BTreeSet<usize>>,
    names: FxHashMap<String, Holders>,
    aliases: Vec<FxHashSet<TypeId>>,
}

impl LayoutCollector {
    pub(super) fn new(layouts: Vec<Layout>) -> Self {
        #[cfg(test)]
        super::collection_tests::note(|counts| counts.full_rebuilds += 1);
        let mut collector = Self {
            layouts,
            ..Self::default()
        };
        for at in 0..collector.layouts.len() {
            collector.index_row(at);
        }
        collector
    }

    pub(super) fn layouts(&self) -> &[Layout] {
        &self.layouts
    }

    pub(super) fn into_layouts(self) -> Vec<Layout> {
        self.layouts
    }

    /// Raw consumers get the owned vector, and returning it constructs fresh
    /// indexes. Used a constant number of times, never once per function.
    pub(super) fn with_program<R>(
        self,
        program: &mut Program,
        use_raw: impl FnOnce(&mut Program) -> R,
    ) -> (Self, R) {
        assert!(program.layouts.is_empty(), "collection owns the layouts");
        program.layouts = self.into_layouts();
        let result = use_raw(program);
        let collector = Self::new(std::mem::take(&mut program.layouts));
        (collector, result)
    }

    fn index_row(&mut self, at: usize) {
        #[cfg(test)]
        super::collection_tests::note(|counts| {
            counts.layout_candidates += 1;
            counts.name_candidates += 1;
        });
        let layout = &self.layouts[at];
        for &ty in &layout.types {
            self.by_type.entry(ty).or_default().insert(at);
        }
        self.by_shape
            .entry((Shape::from(layout), Names::of(&layout.name)))
            .or_default()
            .insert(at);
        let own = layout.types.first().copied();
        self.by_owner.entry(own).or_default().insert(at);
        let holders = self.names.entry(layout.name.clone()).or_default();
        holders.total += 1;
        *holders.owners.entry(own).or_default() += 1;
        self.aliases
            .resize_with(self.layouts.len(), FxHashSet::default);
        self.aliases[at] = layout.types.iter().copied().collect();
    }

    pub(super) fn find(&self, incoming: &Layout) -> Option<usize> {
        let by_type = incoming
            .types
            .iter()
            .filter_map(|ty| {
                #[cfg(test)]
                super::collection_tests::note(|counts| counts.layout_candidates += 1);
                self.by_type.get(ty).and_then(BTreeSet::first).copied()
            })
            .min();
        #[cfg(test)]
        super::collection_tests::note(|counts| counts.layout_candidates += 1);
        let by_shape = self
            .by_shape
            .get(&(Shape::from(incoming), Names::of(&incoming.name)))
            .and_then(BTreeSet::first)
            .copied();
        by_type.into_iter().chain(by_shape).min()
    }

    pub(super) fn unique_name(&self, name: &str, own: Option<TypeId>) -> String {
        #[cfg(test)]
        super::collection_tests::note(|counts| counts.name_candidates += 1);
        let collision = self
            .names
            .get(name)
            .is_some_and(|holders| holders.total > holders.owners.get(&own).copied().unwrap_or(0));
        match (collision, own) {
            (true, Some(ty)) => format!("{name}{}", ty.0),
            _ => name.to_owned(),
        }
    }

    fn remove_holder(&mut self, name: &str, own: Option<TypeId>) {
        if let Some(holders) = self.names.get_mut(name) {
            holders.total -= 1;
            if let Some(count) = holders.owners.get_mut(&own) {
                *count -= 1;
                if *count == 0 {
                    holders.owners.remove(&own);
                }
            }
            if holders.total == 0 {
                self.names.remove(name);
            }
        }
    }

    fn change_owner(&mut self, at: usize, before: Option<TypeId>, after: Option<TypeId>) {
        if before == after {
            return;
        }
        if let Some(rows) = self.by_owner.get_mut(&before) {
            rows.remove(&at);
        }
        self.by_owner.entry(after).or_default().insert(at);
        let name = self.layouts[at].name.clone();
        self.remove_holder(&name, before);
        let holders = self.names.entry(name).or_default();
        holders.total += 1;
        *holders.owners.entry(after).or_default() += 1;
    }

    fn rename(&mut self, at: usize, name: String) {
        let layout = &self.layouts[at];
        let before = layout.name.clone();
        if before == name {
            return;
        }
        let shape = Shape::from(layout);
        let own = layout.types.first().copied();
        if let Some(rows) = self.by_shape.get_mut(&(shape.clone(), Names::of(&before))) {
            rows.remove(&at);
        }
        self.by_shape
            .entry((shape, Names::of(&name)))
            .or_default()
            .insert(at);
        self.remove_holder(&before, own);
        let holders = self.names.entry(name.clone()).or_default();
        holders.total += 1;
        *holders.owners.entry(own).or_default() += 1;
        self.layouts[at].name = name;
    }

    pub(super) fn add_type(&mut self, at: usize, ty: TypeId) {
        let before = self.layouts[at].types.first().copied();
        // Builder refinements historically append even a repeated alias.
        self.layouts[at].types.push(ty);
        self.aliases[at].insert(ty);
        self.by_type.entry(ty).or_default().insert(at);
        let after = self.layouts[at].types.first().copied();
        self.change_owner(at, before, after);
    }

    pub(super) fn collect(&mut self, program: &mut Program, incoming: Vec<Layout>) {
        for mut layout in incoming {
            if let Some(at) = self.find(&layout) {
                let known = &mut self.layouts[at];
                if let Some((kept, discarded)) =
                    super::one_type_two_orders(&known.fields, &layout.fields)
                {
                    program.disputed_layouts.push(super::super::DisputedLayout {
                        name: known.name.clone(),
                        kept,
                        discarded,
                    });
                }
                let before = known.types.first().copied();
                for ty in layout.types {
                    if self.aliases[at].insert(ty) {
                        known.types.push(ty);
                        self.by_type.entry(ty).or_default().insert(at);
                    }
                }
                let after = known.types.first().copied();
                let rename =
                    super::generated_name(&known.name) && !super::generated_name(&layout.name);
                self.change_owner(at, before, after);
                if rename {
                    let name = self.unique_name(&layout.name, after);
                    // The old position() used the first owner, which need not
                    // be `at` for raw lists with shared/empty owners.
                    if let Some(target) =
                        self.by_owner.get(&after).and_then(BTreeSet::first).copied()
                    {
                        self.rename(target, name);
                    }
                }
            } else {
                layout.name = self.unique_name(&layout.name, layout.types.first().copied());
                let at = self.layouts.len();
                self.layouts.push(layout);
                self.index_row(at);
            }
        }
    }

    pub(super) fn find_shape(
        &self,
        name: &str,
        fields: &[Field],
        methods: &[Option<String>],
        base: Option<TypeId>,
    ) -> Option<usize> {
        self.by_shape
            .get(&(Shape::new(fields, methods, base), Names::of(name)))
            .and_then(BTreeSet::first)
            .copied()
    }

    /// Builder discoveries have not passed program-level merge/name rules yet.
    pub(super) fn push_raw(&mut self, layout: Layout) {
        let at = self.layouts.len();
        self.layouts.push(layout);
        self.index_row(at);
    }

    fn unindex_row(&mut self, at: usize) {
        let row = &self.layouts[at];
        for ty in &row.types {
            if let Some(rows) = self.by_type.get_mut(ty) {
                rows.remove(&at);
            }
        }
        if let Some(rows) = self
            .by_shape
            .get_mut(&(Shape::from(row), Names::of(&row.name)))
        {
            rows.remove(&at);
        }
        let own = row.types.first().copied();
        if let Some(rows) = self.by_owner.get_mut(&own) {
            rows.remove(&at);
        }
        let name = row.name.clone();
        self.remove_holder(&name, own);
    }

    /// Re-index only the layout a builder refined, preserving every other row.
    pub(super) fn refine<R>(&mut self, at: usize, change: impl FnOnce(&mut Layout) -> R) -> R {
        self.unindex_row(at);
        let result = change(&mut self.layouts[at]);
        self.index_row(at);
        result
    }

    pub(super) fn split_off(&mut self, at: usize) -> Vec<Layout> {
        for row in at..self.layouts.len() {
            self.unindex_row(row);
        }
        self.aliases.truncate(at);
        self.layouts.split_off(at)
    }
}

/// Ordinary builders own their small discovery list. Adapter builders take
/// the program's collector with its indexes intact and return it after build.
#[derive(Debug)]
pub(super) enum BuilderLayouts {
    Local(Vec<Layout>),
    Collected(LayoutCollector),
}

impl Default for BuilderLayouts {
    fn default() -> Self {
        Self::Local(Vec::new())
    }
}

impl std::ops::Deref for BuilderLayouts {
    type Target = [Layout];

    fn deref(&self) -> &Self::Target {
        match self {
            Self::Local(layouts) => layouts,
            Self::Collected(collector) => collector.layouts(),
        }
    }
}

impl BuilderLayouts {
    pub(super) fn add_type(&mut self, at: usize, ty: TypeId) {
        match self {
            Self::Local(layouts) => layouts[at].types.push(ty),
            Self::Collected(collector) => collector.add_type(at, ty),
        }
    }

    pub(super) fn rename(&mut self, at: usize, name: String) {
        match self {
            Self::Local(layouts) => layouts[at].name = name,
            Self::Collected(collector) => collector.rename(at, name),
        }
    }

    pub(super) fn push(&mut self, layout: Layout) {
        match self {
            Self::Local(layouts) => layouts.push(layout),
            Self::Collected(collector) => collector.push_raw(layout),
        }
    }

    pub(super) fn find_shape(
        &self,
        name: &str,
        fields: &[Field],
        methods: &[Option<String>],
        base: Option<TypeId>,
    ) -> Option<usize> {
        match self {
            Self::Local(layouts) => layouts.iter().position(|known| {
                super::may_merge(&known.name, name) && known.same_shape(fields, methods, base)
            }),
            Self::Collected(collector) => collector.find_shape(name, fields, methods, base),
        }
    }

    pub(super) fn split_off(&mut self, at: usize) -> Vec<Layout> {
        match self {
            Self::Local(layouts) => layouts.split_off(at),
            Self::Collected(collector) => collector.split_off(at),
        }
    }

    pub(super) fn into_layouts(self) -> Vec<Layout> {
        match self {
            Self::Local(layouts) => layouts,
            Self::Collected(collector) => collector.into_layouts(),
        }
    }

    pub(super) fn into_collector(self) -> LayoutCollector {
        match self {
            Self::Collected(collector) => collector,
            Self::Local(_) => panic!("an adapter returns the collector it received"),
        }
    }
}

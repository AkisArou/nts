//! Void callback entries, only for layouts reaching a timer/reaction reader.
use nts_core::hir::{Callee, Func, HirType, Layout, ManagedType, OpKind, Program, ValueId};
use nts_semantic_schema::Origin;
use rustc_hash::{FxHashMap, FxHashSet};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Debug)]
pub struct Adapter<'a> {
    pub name: String,
    pub function: &'a Func,
    pub uniform: bool,
    /// Dispatch entries use core's owned-result convention. An ignored
    /// counted answer therefore belongs to this adapter, including a borrowed
    /// source expression whose dispatch body retained it on return.
    pub release: Option<crate::counting::Counter>,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Row<'a> {
    Source(&'a str),
    Adapter(usize),
}

#[derive(Debug, Clone, Copy)]
enum Binding<'a> {
    Direct(&'a Func),
    Adapter(usize),
}

#[derive(Debug)]
pub struct Callbacks<'a> {
    width: usize,
    columns: BTreeMap<u32, u32>,
    entries: FxHashMap<(&'a str, u32), Binding<'a>>,
    adapters: Vec<Adapter<'a>>,
    errors: Vec<(Origin, String)>,
    rows: FxHashMap<&'a str, usize>,
}

/// The fixed C runtime callback contract. An External is already a resolved
/// runtime identity; a source-owned same-spelled Direct never enters this arm.
#[must_use]
pub fn slot_argument(callee: &Callee) -> Option<usize> {
    match callee {
        Callee::External(name)
            if matches!(name.as_str(), "nts_set_timeout" | "nts_enqueue_job") =>
        {
            Some(1)
        }
        _ => None,
    }
}

impl<'a> Callbacks<'a> {
    #[must_use]
    pub fn new(program: &'a Program) -> Self {
        let functions: FxHashMap<_, _> = program
            .funcs
            .iter()
            .map(|function| (function.name.as_str(), function))
            .collect();
        let (children, roots) = callback_roots(program);
        let width = program.native_dispatch.as_ref().map_or_else(
            || {
                program
                    .layouts
                    .iter()
                    .map(|layout| layout.methods.len())
                    .max()
                    .unwrap_or(0)
            },
            |plan| plan.width as usize,
        );
        let columns = roots
            .keys()
            .enumerate()
            .filter_map(|(at, slot)| {
                u32::try_from(width.checked_add(at)?)
                    .ok()
                    .map(|column| (*slot, column))
            })
            .collect();
        let mut result = Self {
            width,
            columns,
            entries: FxHashMap::default(),
            adapters: Vec::new(),
            errors: Vec::new(),
            rows: FxHashMap::default(),
        };
        let mut seen = FxHashSet::default();
        let mut identities = FxHashMap::<(&str, bool), usize>::default();
        let mut pending: VecDeque<_> = roots
            .into_iter()
            .flat_map(|(slot, roots)| roots.into_iter().map(move |root| (slot, root)))
            .collect();
        while let Some((slot, at)) = pending.pop_front() {
            if !seen.insert((slot, at)) {
                continue;
            }
            pending.extend(children[at].iter().map(|child| (slot, *child)));
            let layout = &program.layouts[at];
            let Some(function) = layout
                .methods
                .get(slot as usize)
                .and_then(Option::as_deref)
                .and_then(|name| functions.get(name))
                .copied()
            else {
                continue;
            };
            if function.params.len() == 1 && function.return_type == HirType::Void {
                result
                    .entries
                    .insert((layout.name.as_str(), slot), Binding::Direct(function));
                continue;
            }
            let Some((called, uniform)) = omitted_call(program, layout, function, &functions)
            else {
                result.errors.push((
                    function.origin.clone(),
                    "a timer callback has no published entry admitting its omitted arguments"
                        .to_owned(),
                ));
                continue;
            };
            let key = (called.name.as_str(), uniform);
            let release = if program.provider == nts_core::hir::Memory::ReferenceCounting
                && called.return_type.is_counted()
            {
                match crate::counting::counter(&called.return_type) {
                    Ok(counter) => Some(counter),
                    Err(why) => {
                        result.errors.push((called.origin.clone(), why.to_owned()));
                        continue;
                    }
                }
            } else {
                None
            };
            let next = identities.len();
            let index = *identities.entry(key).or_insert_with(|| {
                result.adapters.push(Adapter {
                    name: format!("__nts_timer_{next}"),
                    function: called,
                    uniform,
                    release,
                });
                next
            });
            // Store the actual called Func identity; the adapter index is
            // indexed separately so no readable symbol can impersonate it.
            result
                .entries
                .insert((layout.name.as_str(), slot), Binding::Adapter(index));
        }
        result.index_rows(program);
        result
    }

    fn index_rows(&mut self, program: &'a Program) {
        if self.columns.is_empty() {
            return;
        }
        let mut by_layout = Vec::new();
        let mut distinct = BTreeSet::new();
        for layout in &program.layouts {
            let Ok(methods) = program.native_methods(layout) else {
                continue;
            };
            let mut row: Vec<_> = methods
                .into_iter()
                .map(|name| name.map(Row::Source))
                .collect();
            row.resize(self.width, None);
            row.extend(self.columns.keys().map(|slot| {
                self.entries
                    .get(&(layout.name.as_str(), *slot))
                    .map(|binding| match binding {
                        Binding::Direct(function) => Row::Source(function.name.as_str()),
                        Binding::Adapter(at) => Row::Adapter(*at),
                    })
            }));
            if row.iter().any(Option::is_some) {
                distinct.insert(row.clone());
                by_layout.push((layout.name.as_str(), row));
            }
        }
        let indexes: BTreeMap<_, _> = distinct
            .into_iter()
            .enumerate()
            .map(|(at, row)| (row, at))
            .collect();
        for (layout, row) in by_layout {
            self.rows.insert(layout, indexes[&row]);
        }
    }

    #[must_use]
    pub fn row_index(&self, layout: &Layout) -> Option<usize> {
        self.rows.get(layout.name.as_str()).copied()
    }

    #[must_use]
    pub fn column(&self, selector: u32) -> Option<u32> {
        self.columns.get(&selector).copied()
    }

    #[must_use]
    pub fn width(&self) -> usize {
        self.width
    }
    pub fn slots(&self) -> impl Iterator<Item = u32> + '_ {
        self.columns.keys().copied()
    }
    #[must_use]
    pub fn adapters(&self) -> &[Adapter<'a>] {
        &self.adapters
    }
    pub fn foreign_counters(&self) -> impl Iterator<Item = nts_core::hir::native::Counting> + '_ {
        self.adapters
            .iter()
            .filter_map(|adapter| match adapter.release {
                Some(crate::counting::Counter::Foreign(counting)) => Some(counting),
                _ => None,
            })
    }
    pub fn errors(&self) -> impl Iterator<Item = (&Origin, &str)> {
        self.errors
            .iter()
            .map(|(origin, reason)| (origin, reason.as_str()))
    }
    #[must_use]
    pub fn binding(&self, layout: &Layout, slot: u32) -> Option<(&'a Func, Option<&str>)> {
        match self.entries.get(&(layout.name.as_str(), slot))? {
            Binding::Direct(function) => Some((*function, None)),
            Binding::Adapter(at) => {
                let adapter = &self.adapters[*at];
                Some((adapter.function, Some(&adapter.name)))
            }
        }
    }
}

fn callback_type(function: &Func, mut value: ValueId) -> Option<nts_semantic_schema::TypeId> {
    let mut seen = FxHashSet::default();
    while seen.insert(value) {
        let op = function.value(value);
        if let HirType::Managed(ManagedType::Object(ty)) = op.ty {
            return Some(ty);
        }
        if let OpKind::Erase {
            value: original, ..
        } = op.kind
        {
            value = original;
        } else {
            return None;
        }
    }
    None
}

type Roots = BTreeMap<u32, BTreeSet<usize>>;

fn callback_roots(program: &Program) -> (Vec<Vec<usize>>, Roots) {
    let by_type: FxHashMap<_, _> = program
        .layouts
        .iter()
        .enumerate()
        .flat_map(|(at, layout)| layout.types.iter().map(move |ty| (*ty, at)))
        .collect();
    let mut children = vec![Vec::new(); program.layouts.len()];
    for (at, layout) in program.layouts.iter().enumerate() {
        for base in layout.base.iter().chain(&layout.interfaces) {
            if let Some(parent) = by_type.get(base) {
                children[*parent].push(at);
            }
        }
    }
    let mut roots = BTreeMap::<u32, BTreeSet<usize>>::new();
    for function in &program.funcs {
        for value in function.blocks.iter().flat_map(|block| &block.ops) {
            let pair = match &function.value(*value).kind {
                OpKind::PromiseSubscribe { reaction, slot, .. } => Some((*reaction, *slot)),
                OpKind::Call { callee, args, .. } => slot_argument(callee).and_then(|at| {
                    let slot = args.get(at)?;
                    let OpKind::DispatchSlot(slot) = function.value(*slot).kind else {
                        return None;
                    };
                    Some((*args.first()?, slot))
                }),
                _ => None,
            };
            if let Some((callback, slot)) = pair {
                let ty = callback_type(function, callback);
                if let Some(at) = ty.and_then(|ty| by_type.get(&ty)) {
                    roots.entry(slot).or_default().insert(*at);
                }
            }
        }
    }
    (children, roots)
}

fn omitted_call<'a>(
    program: &Program,
    layout: &Layout,
    function: &'a Func,
    functions: &FxHashMap<&str, &'a Func>,
) -> Option<(&'a Func, bool)> {
    if function.params.len() == 1 {
        return Some((function, false));
    }
    let entry = program
        .erased_call_slot
        .and_then(|slot| layout.methods.get(slot as usize))
        .and_then(Option::as_deref)
        .and_then(|name| functions.get(name))
        .copied()?;
    (entry.return_type == HirType::Erased
        && entry
            .params
            .iter()
            .skip(1)
            .all(|param| param.ty == HirType::Erased))
    .then_some((entry, true))
}

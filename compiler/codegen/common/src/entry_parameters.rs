//! Physical trailing parameters shared by implementations of a virtual slot.
//!
//! JavaScript permits an override to ignore arguments. Native definitions still
//! have to agree with the call's function type. Keep logical/source parameters
//! intact and append only unused physical parameters at the backend boundary.
use nts_core::hir::{Callee, Func, HirType, OpKind, Program};
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug, Clone, Copy, Default)]
pub struct Work {
    pub functions: usize,
    pub operations: usize,
    pub row_edges: usize,
    pub declarations: usize,
    pub joins: usize,
    pub find_steps: usize,
    pub padding_parameters: usize,
    pub task_targets: usize,
    pub receiver_projections: usize,
}
impl Work {
    #[must_use]
    pub const fn total(self) -> usize {
        self.functions
            + self.operations
            + self.row_edges
            + self.declarations
            + self.joins
            + self.find_steps
            + self.padding_parameters
            + self.task_targets
            + self.receiver_projections
    }
}

#[derive(Debug)]
pub struct EntryParameters<'a> {
    extra: FxHashMap<*const Func, Vec<&'a HirType>>,
    task_receivers: FxHashSet<*const Func>,
    callers: FxHashSet<*const Func>,
    printers: FxHashMap<*const Func, String>,
    work: Work,
}

struct Families {
    parent: Vec<usize>,
    size: Vec<usize>,
    joins: usize,
    find_steps: usize,
}
impl Families {
    fn connect(
        program: &Program,
        live: &FxHashSet<u32>,
        declared: &[(u32, usize)],
        by_name: &FxHashMap<&str, usize>,
        work: &mut Work,
    ) -> Self {
        let mut families = Self {
            parent: (0..program.funcs.len()).collect(),
            size: vec![1; program.funcs.len()],
            joins: 0,
            find_steps: 0,
        };
        let mut first = FxHashMap::default();
        let mut add = |slot, at| {
            if let Some(&other) = first.get(&slot) {
                families.join(other, at);
            } else {
                first.insert(slot, at);
            }
        };
        // Index each actual row edge once. A function shared by several roles
        // joins those roles; it still receives one physical definition.
        for layout in &program.layouts {
            for (slot, name) in layout.methods.iter().enumerate() {
                work.row_edges += 1;
                let Ok(slot) = u32::try_from(slot) else {
                    continue;
                };
                if live.contains(&slot)
                    && let Some(&at) = name.as_deref().and_then(|name| by_name.get(name))
                {
                    add(slot, at);
                }
            }
        }
        for (slot, name) in program.interface_access.defaults() {
            work.row_edges += 1;
            if live.contains(&slot)
                && let Some(&at) = by_name.get(name)
            {
                add(slot, at);
            }
        }
        for &(slot, at) in declared {
            add(slot, at);
        }
        families
    }

    fn root(&mut self, mut at: usize) -> usize {
        self.find_steps += 1;
        while self.parent[at] != at {
            self.find_steps += 1;
            self.parent[at] = self.parent[self.parent[at]];
            at = self.parent[at];
        }
        at
    }
    fn join(&mut self, left: usize, right: usize) {
        self.joins += 1;
        let (mut left, mut right) = (self.root(left), self.root(right));
        if left == right {
            return;
        }
        if self.size[left] < self.size[right] {
            std::mem::swap(&mut left, &mut right);
        }
        self.parent[right] = left;
        self.size[left] += self.size[right];
    }
}

impl<'a> EntryParameters<'a> {
    #[must_use]
    pub fn new(program: &'a Program) -> Self {
        let mut work = Work {
            functions: program.funcs.len(),
            ..Work::default()
        };
        let by_name: FxHashMap<_, _> = program
            .funcs
            .iter()
            .enumerate()
            .map(|(at, function)| (function.name.as_str(), at))
            .collect();
        let mut live = FxHashSet::default();
        let mut declared = Vec::new();
        let mut tasks = FxHashSet::default();
        for function in &program.funcs {
            for value in function.blocks.iter().flat_map(|block| &block.ops) {
                work.operations += 1;
                if let OpKind::Suspend { resume, .. } = &function.value(*value).kind {
                    work.task_targets += 1;
                    if let Some(&at) = by_name.get(resume.as_str()) {
                        tasks.insert(at);
                    }
                }
                if let OpKind::Call {
                    callee:
                        Callee::Virtual {
                            slot,
                            declared: name,
                        },
                    ..
                } = &function.value(*value).kind
                {
                    live.insert(*slot);
                    if let Some(&at) = by_name.get(name.as_str()) {
                        declared.push((*slot, at));
                        work.declarations += 1;
                    }
                }
            }
        }
        if live.is_empty() {
            return Self {
                extra: FxHashMap::default(),
                task_receivers: tasks
                    .iter()
                    .map(|&at| std::ptr::from_ref(&program.funcs[at]))
                    .collect(),
                callers: FxHashSet::default(),
                printers: FxHashMap::default(),
                work,
            };
        }
        let mut families = Families::connect(program, &live, &declared, &by_name, &mut work);
        let mut longest = FxHashMap::<usize, usize>::default();
        for (at, function) in program.funcs.iter().enumerate() {
            let root = families.root(at);
            let best = longest.entry(root).or_insert(at);
            if function.params.len() > program.funcs[*best].params.len() {
                *best = at;
            }
        }
        let task_roots: FxHashSet<_> = tasks.iter().map(|&at| families.root(at)).collect();
        let mut extra = FxHashMap::default();
        let mut task_receivers = FxHashSet::default();
        for (at, function) in program.funcs.iter().enumerate() {
            let root = families.root(at);
            let canonical = &program.funcs[longest[&root]];
            if canonical.params.len() > function.params.len() {
                extra.insert(
                    std::ptr::from_ref(function),
                    canonical
                        .params
                        .iter()
                        .skip(function.params.len())
                        .map(|param| &param.ty)
                        .collect(),
                );
            }
            if !task_roots.is_empty() {
                work.receiver_projections += 1;
                if task_roots.contains(&root) {
                    task_receivers.insert(std::ptr::from_ref(function));
                }
            }
        }
        let callers = Self::callers(program, &by_name, &extra, &mut work);
        let printers = printer_roles(program, &extra);
        work.joins = families.joins;
        work.find_steps = families.find_steps;
        work.padding_parameters = extra.values().map(Vec::len).sum();
        Self {
            extra,
            task_receivers,
            callers,
            printers,
            work,
        }
    }

    fn callers(
        program: &Program,
        by_name: &FxHashMap<&str, usize>,
        extra: &FxHashMap<*const Func, Vec<&HirType>>,
        work: &mut Work,
    ) -> FxHashSet<*const Func> {
        let mut callers = FxHashSet::default();
        if !extra.is_empty() {
            for function in &program.funcs {
                for value in function.blocks.iter().flat_map(|block| &block.ops) {
                    work.operations += 1;
                    if let OpKind::Call { callee, args, .. } = &function.value(*value).kind {
                        let (Callee::Direct(name) | Callee::Virtual { declared: name, .. }) =
                            callee
                        else {
                            continue;
                        };
                        if let Some(&at) = by_name.get(name.as_str()) {
                            let target = &program.funcs[at];
                            if extra
                                .get(&std::ptr::from_ref(target))
                                .is_some_and(|tail| args.len() < target.params.len() + tail.len())
                            {
                                callers.insert(std::ptr::from_ref(function));
                            }
                        }
                    }
                }
            }
        }
        callers
    }

    /// A fixed task role determines the receiver for every entry of its selector
    /// family. C renders this as void*; LLVM renders either pointer as ptr.
    #[must_use]
    pub fn task_receiver(&self, function: &Func) -> bool {
        self.task_receivers.contains(&std::ptr::from_ref(function))
    }

    /// The descriptor printer has a fixed one-argument contract. A virtual
    /// implementation with an ignored tail needs this separate role entry.
    #[must_use]
    pub fn printer_adapter(&self, function: &Func) -> Option<&str> {
        self.printers
            .get(&std::ptr::from_ref(function))
            .map(String::as_str)
    }

    #[must_use]
    pub fn printer_adapter_count(&self) -> usize {
        self.printers.len()
    }

    #[must_use]
    pub fn work(&self) -> Work {
        self.work
    }

    #[must_use]
    pub fn pads_calls(&self, function: &Func) -> bool {
        self.callers.contains(&std::ptr::from_ref(function))
    }

    /// Only parameters absent from the logical body, hence never read by it.
    #[must_use]
    pub fn extra(&self, function: &Func) -> &[&'a HirType] {
        self.extra
            .get(&std::ptr::from_ref(function))
            .map_or(&[], Vec::as_slice)
    }
}

fn printer_roles(
    program: &Program,
    extra: &FxHashMap<*const Func, Vec<&HirType>>,
) -> FxHashMap<*const Func, String> {
    let printers: FxHashSet<_> = program.printing_functions().collect();
    program
        .funcs
        .iter()
        .enumerate()
        .filter_map(|(at, function)| {
            let key = std::ptr::from_ref(function);
            (printers.contains(function.name.as_str()) && extra.contains_key(&key))
                .then(|| (key, format!("__nts_printer_{at}")))
        })
        .collect()
}

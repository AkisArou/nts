//! The owned managed edges of one physical layout, shared by native emitters
//! for destruction and cycle tracing.
//!
//! Foreign edges keep the runtime's finalization protocol. An erased slot is
//! visited only when its tag names managed storage; it is not a pointer field.
use nts_core::hir::{HirType, Layout};

#[derive(Debug, Clone, Copy)]
pub enum Action {
    Release,
    Trace,
}

impl Action {
    #[must_use]
    pub const fn symbol_prefix(self) -> &'static str {
        match self {
            Self::Release => "__nts_release_fields",
            Self::Trace => "__nts_trace_fields",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Fields {
    pub managed: Vec<usize>,
    pub erased: Vec<usize>,
}

impl Fields {
    #[must_use]
    pub fn of(layout: &Layout) -> Self {
        Self {
            managed: layout.pointer_fields(),
            erased: layout
                .fields
                .iter()
                .enumerate()
                .filter_map(|(at, field)| (field.ty == HirType::Erased).then_some(at))
                .collect(),
        }
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.managed.is_empty() && self.erased.is_empty()
    }
}

/// How deep one typed release may call another before it hands a field to
/// `nts_release`. Each level is one C stack frame of a death; the dying list
/// takes over past it, so no generated chain of layouts can grow the stack
/// further, whatever the program declares.
pub const TYPED_RELEASE_DEPTH: usize = 8;

/// Whether a native module counts the operations `tooling/memory` measures:
/// the build's choice, made once for every backend.
///
/// A typed release counts its arrival through [`ARRIVAL_COUNT`] exactly
/// where `nts_release` would have counted its own: once, after the
/// descriptor test has found its own layout, before the count test. A typed
/// release that hands the object (or a null) to `nts_release` does not count,
/// since `nts_release` does. So each release the compiler emitted is counted
/// once, whichever path it takes.
///
/// **Where each backend decides.** C defers the choice to the C compiler: its
/// typed releases call the hook under `#ifdef NTS_COUNT_OPERATIONS`, the same
/// macro the runtime counts under, so the program and the runtime cannot
/// disagree. An LLVM module has no preprocessor, so it is emitted for one
/// build or the other: [`Counting::Operations`] only when asked for
/// (`nts emit-llvm --count-operations`), and otherwise no hook at all.
///
/// **The link-time contract.** A program emitted for counting defines
/// [`COUNTING_GUARD`] (C: under the same macro; LLVM: under
/// [`Counting::Operations`]). `tooling/memory/harness.c` reads it as a weak
/// symbol and stops by name, with exit status 2, when it is absent, so a
/// module emitted without its hooks cannot be measured as if it had them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Counting {
    /// An ordinary build: nothing counts.
    #[default]
    Off,
    /// A counting build, linked with a runtime built with
    /// `NTS_COUNT_OPERATIONS`.
    Operations,
}

/// The runtime hook that counts a typed release's arrival.
pub const ARRIVAL_COUNT: &str = "nts_count_release";

/// What a program emitted for counting defines, for the counting harness to
/// check that it was (see [`Counting`]).
pub const COUNTING_GUARD: &str = "nts_program_counts_operations";

/// One layout's release specialized by type (`__nts_release_<layout>` in
/// `nts_runtime.h`): what it may assume and which fields it releases how.
#[derive(Debug, PartialEq, Eq)]
pub struct TypedRelease {
    /// The longest chain of typed deaths this one starts, itself included:
    /// at most [`TYPED_RELEASE_DEPTH`].
    pub depth: usize,
    /// For each of [`Fields::of`]'s managed fields, in that order: the layout
    /// whose typed release gives it up, or `None` for `nts_release`.
    pub children: Vec<Option<usize>>,
}

/// Every layout's typed release, by layout index, decided once for both
/// native emitters.
///
/// A layout has one when an object of it can die without anything the
/// generic death decides at run time:
///
/// - **Reference counting.** `NoGc` releases nothing.
/// - **Proved acyclic** by the cycle graph (`Program::cycles`), the same fact
///   its descriptor's `cyclic` carries, so no object of it is ever a cycle
///   candidate and no decrement of one has anything to buffer. The graph
///   treats an erased or unknown field as reaching every layout.
/// - **No erased and no foreign slot,** so its descriptor names no
///   `release_foreign` and nothing of it waits on the clear-before-release
///   protocol. An object or tuple layout keeps no storage outside its block.
/// - **Made** by an operation of the program (`ObjectNew`, or a static
///   closure instance): both emitters give such a layout its descriptors, and
///   no object can carry the descriptor of a layout nothing makes.
/// - **Placed**: a layout the layout engine cannot place has no descriptor.
///
/// A field gets its own layout's typed release only when its static type is
/// exactly an object with such a layout and that release's depth leaves room
/// under [`TYPED_RELEASE_DEPTH`]. The static type is a lower bound: the
/// emitted release still compares the child's descriptor before assuming it.
#[derive(Debug, Default)]
pub struct TypedReleases {
    by_layout: Vec<Option<TypedRelease>>,
    layout_of: rustc_hash::FxHashMap<nts_semantic_schema::TypeId, usize>,
}

impl TypedReleases {
    #[must_use]
    pub fn plan(program: &nts_core::hir::Program, cycles: &nts_core::hir::Cycles) -> Self {
        if program.provider != nts_core::hir::Memory::ReferenceCounting {
            return Self::default();
        }
        let mut layout_of = rustc_hash::FxHashMap::default();
        for (at, layout) in program.layouts.iter().enumerate() {
            for ty in &layout.types {
                layout_of.entry(*ty).or_insert(at);
            }
        }
        let mut made = vec![false; program.layouts.len()];
        for func in program.native_funcs() {
            for op in func
                .blocks
                .iter()
                .flat_map(|block| block.ops.iter())
                .map(|id| func.value(*id))
            {
                if let (
                    nts_core::hir::OpKind::ObjectNew { .. } | nts_core::hir::OpKind::ClosureStatic,
                    HirType::Managed(nts_core::hir::ManagedType::Object(ty)),
                ) = (&op.kind, &op.ty)
                    && let Some(&at) = layout_of.get(ty)
                {
                    made[at] = true;
                }
            }
        }
        let eligible: Vec<bool> = program
            .layouts
            .iter()
            .enumerate()
            .map(|(at, layout)| {
                made[at]
                    && !cycles.cyclic.get(at).copied().unwrap_or(true)
                    && Fields::of(layout).erased.is_empty()
                    && layout
                        .fields
                        .iter()
                        .all(|field| field.ty.counting().is_none())
                    && nts_core::hir::layout::place(&layout.fields).is_some()
            })
            .collect();
        let mut plan = Self {
            by_layout: Vec::new(),
            layout_of,
        };
        let mut state = vec![Visit::Unvisited; program.layouts.len()];
        let mut decided: Vec<Option<TypedRelease>> =
            (0..program.layouts.len()).map(|_| None).collect();
        for at in 0..program.layouts.len() {
            plan.decide(program, &eligible, at, &mut state, &mut decided);
        }
        plan.by_layout = decided;
        plan
    }

    /// Depth-first, with a mark for layouts in progress: a field that leads
    /// back to one is given to `nts_release`. The cycle graph already rules
    /// that out for acyclic layouts; the mark keeps the walk finite if a
    /// later change to either graph lets one through.
    fn decide(
        &self,
        program: &nts_core::hir::Program,
        eligible: &[bool],
        at: usize,
        state: &mut [Visit],
        decided: &mut [Option<TypedRelease>],
    ) {
        if state[at] != Visit::Unvisited || !eligible[at] {
            return;
        }
        state[at] = Visit::InProgress;
        let layout = &program.layouts[at];
        let mut children = Vec::new();
        let mut depth = 1;
        for field in Fields::of(layout).managed {
            let child = match &layout.fields[field].ty {
                HirType::Managed(nts_core::hir::ManagedType::Object(id)) => {
                    self.layout_of.get(id).copied()
                }
                _ => None,
            };
            let child = child.filter(|&child| {
                self.decide(program, eligible, child, state, decided);
                state[child] == Visit::Done
                    && decided[child]
                        .as_ref()
                        .is_some_and(|typed| typed.depth < TYPED_RELEASE_DEPTH)
            });
            if let Some(child) = child {
                depth = depth.max(1 + decided[child].as_ref().map_or(0, |typed| typed.depth));
            }
            children.push(child);
        }
        decided[at] = Some(TypedRelease { depth, children });
        state[at] = Visit::Done;
    }

    /// The typed release of a layout, by index.
    #[must_use]
    pub fn of(&self, layout: usize) -> Option<&TypedRelease> {
        self.by_layout.get(layout).and_then(Option::as_ref)
    }

    /// The layout whose typed release a value of this static type takes, at
    /// a release site or as an array's element.
    #[must_use]
    pub fn for_type(&self, ty: &HirType) -> Option<usize> {
        let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = ty else {
            return None;
        };
        let at = *self.layout_of.get(id)?;
        self.of(at).map(|_| at)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Visit {
    Unvisited,
    InProgress,
    Done,
}

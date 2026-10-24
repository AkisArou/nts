//! Allocation/storage placement relative to a reset, separate from the ambient
//! call-region rewrite. An owned result is not necessarily a fresh allocation,
//! and a call can grow backing storage without returning a reference. Keep both
//! candidates visible until a proof answers them. No allocator reads this yet.

use nts_semantic_schema::Origin;

use super::super::{BinOp, Callee, OpKind, Program, ValueId, runtime};

/// A point in this prepared program. Function indices and value ids refer to
/// its final bodies, after passes that can remove or reorder definitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Point {
    pub function: usize,
    pub value: ValueId,
}

/// The caller's chosen interval, including its exceptional reset exits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Owner {
    pub entry: Point,
    pub resets: Vec<Point>,
}

/// The failed proof, rather than a claim that an unproved site is on the arena.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unknown {
    NotAnalysed,
}

impl Unknown {
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::NotAnalysed => "not analysed",
        }
    }
}

/// Lifetime of allocation instances at a site, relative to the selected reset.
/// A repeated site's mixed young/final instances require a proof of splitting;
/// neither this enum nor the inventory supplies one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Placement {
    ResetCohort(Owner),
    Young { last_drops: Vec<Point> },
    Unknown(Unknown),
}

/// What a site can allocate. `CallResult` may later prove to be an alias, and
/// `CallStorage` may prove to allocate nothing. A backing growth is kept apart
/// from its header's creation: their instances can have different lifetimes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Storage {
    Object,
    Array,
    String,
    Native,
    CallResult,
    CallStorage,
}

impl Storage {
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Object => "object",
            // The initial inline slots and array header are one allocation;
            // a later backing allocation is a separate call-storage site.
            Self::Array => "array",
            Self::String => "string",
            Self::Native => "native storage",
            Self::CallResult => "possible call result allocation",
            Self::CallStorage => "possible call storage allocation",
        }
    }
}

/// One live allocation/storage candidate, in deterministic program order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Site {
    pub at: Point,
    pub storage: Storage,
    pub origin: Origin,
    pub placement: Placement,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Report {
    pub sites: Vec<Site>,
    /// One visit per live operation, including operations with no candidate.
    pub visits: usize,
}

/// Inventory only: no alias, lifetime or escape proof and no program mutation.
/// Unknown calls remain visible, including calls returning scalars that might
/// grow storage. Known non-storing helpers need no call-storage candidate.
#[must_use]
pub fn inventory(program: &Program) -> Report {
    let mut report = Report::default();
    for (function, func) in program.funcs.iter().enumerate() {
        for block in &func.blocks {
            for &value in &block.ops {
                report.visits += 1;
                let op = &func.values[value.0 as usize];
                let mut record = |storage| {
                    report.sites.push(Site {
                        at: Point { function, value },
                        storage,
                        origin: op.origin.clone(),
                        placement: Placement::Unknown(Unknown::NotAnalysed),
                    });
                };
                match &op.kind {
                    OpKind::ObjectNew { .. } => record(Storage::Object),
                    OpKind::ArrayNew { .. } => record(Storage::Array),
                    OpKind::NativeMalloc { .. } => record(Storage::Native),
                    OpKind::Binary {
                        op: BinOp::Concat, ..
                    } => record(Storage::String),
                    OpKind::Call { callee, .. } => {
                        if op.ty.is_counted() {
                            record(Storage::CallResult);
                        }
                        if !matches!(callee, Callee::External(name) if runtime::stores_nothing(name))
                        {
                            record(Storage::CallStorage);
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    report
}

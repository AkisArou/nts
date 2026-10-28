//! Runtime values of closed allocation identities, rather than their written
//! element types. A wider alias is a writer too.
//!
//! Tags and number facts travel together. An inert-cleanup consumer needs the
//! tag proof; a numeric consumer must first exclude every nonnumeric tag. The
//! provider must publish Unknown on an open writer set or exhausted budget,
//! never the partial union visited before that failure.

use super::facts::Facts;

mod provider;
pub use provider::{Container, FunctionFacts, Inspection, RecognizedWrite, RejectedUse};

use super::{BlockId, Callee, HirType, OpKind, Origin, Program, ValueId};

#[derive(Debug, Clone)]
pub struct Read {
    pub function: String,
    pub value: ValueId,
    pub origin: Origin,
    pub fact: ValueFact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cleanup {
    Retain,
    Release,
}

/// The actual operation removed, including its old location for execution
/// controls that restore the disabled optimization without changing producers.
#[derive(Debug, Clone)]
pub struct Elision {
    pub function: String,
    pub block: BlockId,
    pub operation: ValueId,
    pub operand: ValueId,
    pub before: Option<ValueId>,
    pub cleanup: Cleanup,
}

#[derive(Debug, Default)]
pub struct Report {
    pub reads: Vec<Read>,
    pub elisions: Vec<Elision>,
    pub inserted_retains_removed: usize,
    pub inserted_releases_removed: usize,
    pub visits: usize,
    pub budget_exhaustions: usize,
}

/// First consumer: erase no ownership, move no lifetime and change no writer.
/// Only remove operations whose actual SSA payload cannot affect a reference
/// count. Generic scalar retain/release does not collect or run a finalizer.
pub(super) fn elide(program: &mut Program, before_counting: &[usize]) -> Report {
    let mut report = Report::default();
    assert_eq!(program.funcs.len(), before_counting.len());
    for (function, &old_len) in program.funcs.iter_mut().zip(before_counting) {
        let facts = FunctionFacts::of(function);
        report.visits += facts.visits;
        report.budget_exhaustions += facts.budget_exhaustions;
        for block in &function.blocks {
            for &id in &block.ops {
                if matches!(&function.value(id).kind,
                    OpKind::Call { callee: Callee::External(name), .. }
                        if matches!(name.as_str(), "nts_map_get" | "nts_map_value_at" | super::entries::ENTRY_GET))
                {
                    report.reads.push(Read {
                        function: function.name.clone(),
                        value: id,
                        origin: function.value(id).origin.clone(),
                        fact: facts.value(id),
                    });
                }
            }
        }
        let values = &function.values;
        for (index, block) in function.blocks.iter_mut().enumerate() {
            let mut remove = rustc_hash::FxHashSet::default();
            for (position, &id) in block.ops.iter().enumerate() {
                let (operand, cleanup) = match values[id.0 as usize].kind {
                    OpKind::Retain(value) => (value, Cleanup::Retain),
                    OpKind::Release(value) => (value, Cleanup::Release),
                    _ => continue,
                };
                if values[operand.0 as usize].ty != HirType::Erased
                    || !facts.value(operand).is_inert()
                {
                    continue;
                }
                remove.insert(id);
                report.elisions.push(Elision {
                    function: function.name.clone(),
                    block: BlockId(u32::try_from(index).unwrap_or(u32::MAX)),
                    operation: id,
                    operand,
                    before: block.ops.get(position + 1).copied(),
                    cleanup,
                });
                if id.0 as usize >= old_len {
                    match cleanup {
                        Cleanup::Retain => report.inserted_retains_removed += 1,
                        Cleanup::Release => report.inserted_releases_removed += 1,
                    }
                }
            }
            block.ops.retain(|id| !remove.contains(id));
        }
    }
    report
}

/// Possible payload kinds. Managed includes strings, bigint boxes, symbols,
/// foreign values and every other counted reference; none is licensed inert.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tags(u8);

impl Tags {
    pub const NUMBER: Self = Self(1);
    pub const BOOLEAN: Self = Self(2);
    pub const NULL: Self = Self(4);
    pub const UNDEFINED: Self = Self(8);
    pub const MANAGED: Self = Self(16);

    #[must_use]
    pub const fn union(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }

    #[must_use]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    #[must_use]
    pub const fn intersect(self, other: Self) -> Self {
        Self(self.0 & other.0)
    }

    #[must_use]
    pub const fn without(self, other: Self) -> Self {
        Self(self.0 & !other.0)
    }

    #[must_use]
    pub const fn is_inert(self) -> bool {
        self.0 != 0 && self.0 & Self::MANAGED.0 == 0
    }
}

/// Failed proof, exposed with a read's origin in the prepared report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unknown {
    NotAnalysed,
    ExternalValue,
    OpenWriterSet,
    AmbiguousIdentity,
    EscapingIdentity,
    RecursiveValue,
    Budget,
}

impl Unknown {
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::NotAnalysed => "not analysed",
            Self::ExternalValue => "external or unresolved value",
            Self::OpenWriterSet => "not every writer is known",
            Self::AmbiguousIdentity => "not one closed fresh identity",
            Self::EscapingIdentity => "identity escapes the closed writer scope",
            Self::RecursiveValue => "recursive value proof is unresolved",
            Self::Budget => "content proof budget exhausted",
        }
    }
}

/// One answer for both tag and numeric consumers. The number component is the
/// existing core lattice, not a second account of JavaScript arithmetic.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ValueFact {
    Unknown(Unknown),
    Known { tags: Tags, numbers: Facts },
}

impl ValueFact {
    #[must_use]
    pub const fn number(numbers: Facts) -> Self {
        Self::Known {
            tags: Tags::NUMBER,
            numbers,
        }
    }

    #[must_use]
    pub const fn undefined() -> Self {
        Self::Known {
            tags: Tags::UNDEFINED,
            numbers: Facts::BOTTOM,
        }
    }

    #[must_use]
    pub fn join(self, other: Self) -> Self {
        match (self, other) {
            (Self::Unknown(why), _) | (_, Self::Unknown(why)) => Self::Unknown(why),
            (
                Self::Known {
                    tags: a,
                    numbers: x,
                },
                Self::Known {
                    tags: b,
                    numbers: y,
                },
            ) => Self::Known {
                tags: a.union(b),
                numbers: x.join(y),
            },
        }
    }

    #[must_use]
    pub const fn is_inert(self) -> bool {
        matches!(self, Self::Known { tags, .. } if tags.is_inert())
    }

    /// Every alternative must be numeric. A Map's absent result or an array
    /// hole cannot disappear merely because the numeric subset is bounded.
    #[must_use]
    pub fn numeric(self) -> Option<Facts> {
        match self {
            Self::Known {
                tags: Tags::NUMBER,
                numbers,
            } => Some(numbers),
            _ => None,
        }
    }
}

impl std::fmt::Display for ValueFact {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unknown(why) => write!(f, "Unknown({})", why.reason()),
            Self::Known { tags, numbers } => {
                let mut separator = "";
                for (tag, name) in [
                    (Tags::NUMBER, "number"),
                    (Tags::BOOLEAN, "boolean"),
                    (Tags::NULL, "null"),
                    (Tags::UNDEFINED, "undefined"),
                    (Tags::MANAGED, "managed"),
                ] {
                    if tags.contains(tag) {
                        write!(f, "{separator}{name}")?;
                        separator = "|";
                    }
                }
                if separator.is_empty() {
                    write!(f, "empty")?;
                }
                if tags.contains(Tags::NUMBER) {
                    write!(
                        f,
                        "; numbers=[{}, {}], whole={}, NaN={}, -0={}",
                        numbers.lo,
                        numbers.hi,
                        numbers.whole,
                        numbers.maybe_nan,
                        numbers.maybe_negative_zero
                    )?;
                }
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Facts, Tags, Unknown, ValueFact};

    #[test]
    fn report_keeps_absence_and_failed_proofs_visible() {
        assert_eq!(
            ValueFact::Unknown(Unknown::OpenWriterSet).to_string(),
            "Unknown(not every writer is known)"
        );
        let number = ValueFact::number(Facts::constant(-0.0));
        let text = number.join(ValueFact::undefined()).to_string();
        assert!(text.starts_with("number|undefined; numbers="));
        assert!(text.ends_with("-0=true"));
    }

    #[test]
    fn absence_is_inert_but_not_a_numeric_proof() {
        let stored = ValueFact::number(Facts::new(1.0, 4.0, true, false, false));
        let read = stored.join(ValueFact::undefined());
        assert!(read.is_inert());
        assert!(read.numeric().is_none());
        assert_eq!(stored.numeric().map(|n| (n.lo, n.hi)), Some((1.0, 4.0)));
    }

    #[test]
    fn every_writer_contributes_including_a_managed_wider_alias() {
        let scalar = ValueFact::number(Facts::TOP);
        let managed = ValueFact::Known {
            tags: Tags::MANAGED,
            numbers: Facts::BOTTOM,
        };
        assert!(!scalar.join(managed).is_inert());
        assert!(scalar.join(managed).numeric().is_none());
    }

    #[test]
    fn unknown_writers_never_recover_after_a_later_scalar_store() {
        let unknown = ValueFact::Unknown(Unknown::OpenWriterSet);
        let scalar = ValueFact::number(Facts::TOP);
        assert_eq!(unknown.join(scalar), unknown);
        assert_eq!(scalar.join(unknown), unknown);
        assert!(!unknown.is_inert());
    }

    #[test]
    fn numeric_flags_are_not_discarded_by_the_tag_proof() {
        let zero = ValueFact::number(Facts::new(0.0, 0.0, true, false, true));
        let nan = ValueFact::number(Facts::TOP);
        assert!(zero.numeric().is_some_and(|n| n.maybe_negative_zero));
        assert!(zero.join(nan).numeric().is_some_and(|n| n.maybe_nan));
        assert!(zero.is_inert());
    }
}

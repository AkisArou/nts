//! Executable witnesses for facts consumed by preparation.
//!
//! A witness describes the original operation when its rewrite is made. It
//! never asks the range or contents analysis to prove that rewrite again.
//! Its operands are real SSA uses: copying or renumbering a function must
//! copy and remap its witnesses as well.
//!
//! These descriptions provide no facts to an optimizer. The eventual
//! validation operation is effectful even when its predicate looks proved;
//! failure is a named compiler trap, not a catchable language exception.
//! Materialization belongs before ownership insertion.
//! Validation operations and their operands stay live under DCE. Deleting a
//! narrowed operation must retire its witness through the one audited deletion
//! path; deleting only the carried check is a hard `Missing` coverage error.
//!
//! This module defines the recording/coverage boundary. Preparation does not
//! yet emit these checks or offer a validation verdict.

use super::{BinOp, BlockId, Func, HirType, Op, OpKind, UnOp, ValueId, contents::Tags};

/// The representation before the rewrite, not whatever a later optimization
/// chooses for the same value. A recipe must keep Number arithmetic distinct
/// from Boolean comparisons and explicit JavaScript integer conversions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScalarInput {
    pub value: ValueId,
    pub representation: HirType,
}

/// The original, pure scalar prefix. Constants retain their exact bits, so
/// NaN and negative zero survive a clone without floating equality deciding
/// whether the clone still describes the same operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScalarRecipe {
    Number(u64),
    Boolean(bool),
    Input(ScalarInput),
    Unary {
        op: UnOp,
        input: ScalarInput,
    },
    Binary {
        op: BinOp,
        lhs: ScalarInput,
        rhs: ScalarInput,
    },
}

impl ScalarRecipe {
    /// Capture before rewriting. Calls and memory reads are deliberately not
    /// duplicated as scalar expressions: their original result must instead
    /// be retained as an `Input` at the conversion boundary.
    #[must_use]
    pub fn capture(
        original: &Op,
        operand_type: impl Fn(ValueId) -> Option<HirType>,
    ) -> Option<Self> {
        if !matches!(original.ty, HirType::Float { bits: 64 } | HirType::Bool) {
            return None;
        }
        let input = |value| {
            let representation = operand_type(value)?;
            if !matches!(
                representation,
                HirType::Float { bits: 64 | 32 }
                    | HirType::Int {
                        bits: 8 | 16 | 32 | 64,
                        ..
                    }
                    | HirType::Bool
            ) {
                return None;
            }
            Some(ScalarInput {
                value,
                representation,
            })
        };
        match original.kind {
            OpKind::ConstFloat(value) => Some(Self::Number(value.to_bits())),
            OpKind::ConstBool(value) => Some(Self::Boolean(value)),
            OpKind::Convert(value) => Some(Self::Input(input(value)?)),
            OpKind::Unary { op, operand } => Some(Self::Unary {
                op,
                input: input(operand)?,
            }),
            OpKind::Binary { op, lhs, rhs } if op != BinOp::Concat => Some(Self::Binary {
                op,
                lhs: input(lhs)?,
                rhs: input(rhs)?,
            }),
            _ => None,
        }
    }

    pub fn visit_values(&self, mut visit: impl FnMut(ValueId)) {
        match self {
            Self::Number(_) | Self::Boolean(_) => {}
            Self::Input(value) | Self::Unary { input: value, .. } => visit(value.value),
            Self::Binary { lhs, rhs, .. } => {
                visit(lhs.value);
                visit(rhs.value);
            }
        }
    }

    pub fn remap(&mut self, mut map: impl FnMut(ValueId) -> ValueId) {
        match self {
            Self::Number(_) | Self::Boolean(_) => {}
            Self::Input(value) | Self::Unary { input: value, .. } => value.value = map(value.value),
            Self::Binary { lhs, rhs, .. } => {
                lhs.value = map(lhs.value);
                rhs.value = map(rhs.value);
            }
        }
    }
}

/// Exact Number narrowing and JavaScript's explicit modulo conversion make
/// different promises. A truncated intermediate must not be checked as if
/// the source had promised its unobservable wide value was exact.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NumberEquality {
    Exact,
    ToInt32,
    ToUint32,
}

/// The length to observe at an access. A string's UTF-16 length and a view's
/// live length are not interchangeable with an array allocation's old size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoundsKind {
    Array,
    StringUnits,
    View,
}

/// A consumed proof, with the values needed to test it at its use. The stored
/// value of `ContentsTag` is the original tagged read, before any projection
/// loses the tag. `Storage` checks the runtime layout before an unchecked
/// payload or field read, never after interpreting the bytes as that layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Check {
    Scalar {
        actual: ValueId,
        original: ScalarRecipe,
        equality: NumberEquality,
    },
    Bounds {
        kind: BoundsKind,
        container: ValueId,
        index: ValueId,
    },
    ContentsTag {
        stored: ValueId,
        allowed: Tags,
    },
    Storage {
        value: ValueId,
        expected: HirType,
    },
    Unreachable,
}

impl Check {
    #[must_use]
    pub fn operands(&self) -> Vec<ValueId> {
        let mut operands = Vec::new();
        self.visit_values(|value| operands.push(value));
        operands
    }

    pub fn visit_values(&self, mut visit: impl FnMut(ValueId)) {
        match self {
            Self::Scalar {
                actual, original, ..
            } => {
                visit(*actual);
                original.visit_values(visit);
            }
            Self::Bounds {
                container, index, ..
            } => {
                visit(*container);
                visit(*index);
            }
            Self::ContentsTag { stored, .. } => visit(*stored),
            Self::Storage { value, .. } => visit(*value),
            Self::Unreachable => {}
        }
    }

    pub fn remap(&mut self, mut map: impl FnMut(ValueId) -> ValueId) {
        match self {
            Self::Scalar {
                actual, original, ..
            } => {
                *actual = map(*actual);
                original.remap(map);
            }
            Self::Bounds {
                container, index, ..
            } => {
                *container = map(*container);
                *index = map(*index);
            }
            Self::ContentsTag { stored, .. } => *stored = map(*stored),
            Self::Storage { value, .. } => *value = map(*value),
            Self::Unreachable => {}
        }
    }
}

/// Local to one function's independent recording ledger. A clone remaps both
/// that ledger and its executable checks; an inline copy obtains fresh local
/// IDs by appending the remapped ledger, not by reusing its source's indices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CheckId(usize);

/// The check carried by an opaque, effectful HIR operation. Its ID is local
/// to the owning function's ledger. A region copy changes this ID through the
/// map returned by `Ledger::copy_region` and remaps its real SSA operands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Witness {
    pub id: CheckId,
    pub check: Check,
}

/// Record and insert through the exact owning function. Ordinary preparation
/// must not call this entry: absence of a ledger is an error, not an implicit
/// request to start a partially instrumented function.
pub fn insert(
    func: &mut Func,
    block: BlockId,
    position: usize,
    check: Check,
    origin: nts_semantic_schema::Origin,
) -> Result<ValueId, CoverageError> {
    if func
        .blocks
        .get(block.0 as usize)
        .is_none_or(|block| position > block.ops.len())
    {
        return Err(CoverageError::Unsupported(
            "a validation insertion has no live program point".into(),
        ));
    }
    let value = u32::try_from(func.values.len()).map(ValueId).map_err(|_| {
        CoverageError::Unsupported("a validation operation exceeds the SSA ID space".into())
    })?;
    let ledger = func.validation.as_mut().ok_or_else(|| {
        CoverageError::Unsupported("a validation insertion has no owning function ledger".into())
    })?;
    let id = ledger.record(check.clone());
    func.values.push(Op {
        kind: OpKind::Validation(Box::new(Witness { id, check })),
        ty: HirType::Bool,
        origin,
    });
    func.blocks[block.0 as usize].ops.insert(position, value);
    Ok(value)
}

/// No caller can pair one function's checks with another function's ledger.
/// A normal, uninstrumented function has no receipt; an orphaned carried
/// check produces incomplete coverage rather than being silently ignored.
#[must_use]
pub fn audit_function(func: &Func) -> Option<Receipt> {
    let checks = || {
        func.blocks
            .iter()
            .flat_map(|block| &block.ops)
            .filter_map(|value| match &func.value(*value).kind {
                OpKind::Validation(witness) => Some((witness.id, &witness.check)),
                _ => None,
            })
    };
    if let Some(ledger) = &func.validation {
        return Some(ledger.audit(checks()));
    }
    checks().next()?;
    let mut orphaned = Ledger::default();
    orphaned.unsupported("a carried validation check has no owning function ledger".into());
    Some(orphaned.audit(checks()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoverageError {
    Unsupported(String),
    Unknown(CheckId),
    Missing(CheckId),
    Duplicate(CheckId),
    Changed(CheckId),
}

/// Per-function build evidence, retained even when validation cannot finish.
/// A driver serializes these counts and all unsupported reasons in its build
/// receipt. `complete` never means that an unsupported site was ignored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Receipt {
    pub recorded: usize,
    pub emitted: usize,
    pub unsupported: Vec<String>,
    pub errors: Vec<CoverageError>,
}

impl Receipt {
    #[must_use]
    pub fn complete(&self) -> bool {
        self.unsupported.is_empty() && self.errors.is_empty()
    }
}

/// Recorded independently from the checks an optimizer carries. Removing an
/// executable check therefore cannot also make its coverage obligation vanish.
/// No automatic retirement API exists: whole-function pruning discards its
/// whole ledger, while a kept function retains all its recorded checks.
#[derive(Debug, Default, Clone)]
pub struct Ledger {
    expected: Vec<Check>,
    unsupported: Vec<String>,
}

impl Ledger {
    pub fn record(&mut self, check: Check) -> CheckId {
        let id = CheckId(self.expected.len());
        self.expected.push(check);
        id
    }

    /// Incomplete support is a hard coverage error, never a weaker predicate.
    pub fn unsupported(&mut self, reason: String) {
        self.unsupported.push(reason);
    }

    pub fn remap(&mut self, mut map: impl FnMut(ValueId) -> ValueId) {
        for check in &mut self.expected {
            check.remap(&mut map);
        }
    }

    /// Return the source-ID to destination-ID map for the same inline copy
    /// that remaps executable checks. Unsupported source coverage propagates.
    pub fn append_remapped(
        &mut self,
        source: &Self,
        mut map: impl FnMut(ValueId) -> ValueId,
    ) -> Vec<CheckId> {
        self.unsupported.extend(source.unsupported.iter().cloned());
        source
            .expected
            .iter()
            .map(|check| {
                let mut check = check.clone();
                check.remap(&mut map);
                self.record(check)
            })
            .collect()
    }

    /// Clone just a region's witnesses inside the same function. IDs are
    /// returned in source order for the caller's check-ID remapping, while
    /// checks outside the region retain their existing IDs and operands.
    /// Reject duplicate or unknown IDs before changing the ledger.
    pub fn copy_region(
        &mut self,
        ids: &[CheckId],
        mut map: impl FnMut(ValueId) -> ValueId,
    ) -> Result<Vec<CheckId>, CoverageError> {
        let mut selected = rustc_hash::FxHashSet::default();
        let mut checks = Vec::with_capacity(ids.len());
        for &id in ids {
            let Some(check) = self.expected.get(id.0) else {
                return Err(CoverageError::Unknown(id));
            };
            if !selected.insert(id.0) {
                return Err(CoverageError::Duplicate(id));
            }
            checks.push(check.clone());
        }
        Ok(checks
            .into_iter()
            .map(|mut check| {
                check.remap(&mut map);
                self.record(check)
            })
            .collect())
    }

    /// Exact identity and recipe matching, not a count or a hash of recipes.
    /// In particular an equal count cannot hide one lost and one doubled check.
    pub fn verify<'a>(
        &self,
        emitted: impl IntoIterator<Item = (CheckId, &'a Check)>,
    ) -> Result<(), CoverageError> {
        let receipt = self.audit(emitted);
        receipt.errors.into_iter().next().map_or(Ok(()), Err)
    }

    /// Read every emitted check and keep every failure. A nightly report must
    /// not stop its coverage census at the first unsupported or missing site.
    pub fn audit<'a>(&self, emitted: impl IntoIterator<Item = (CheckId, &'a Check)>) -> Receipt {
        let mut receipt = Receipt {
            recorded: self.expected.len(),
            emitted: 0,
            unsupported: self.unsupported.clone(),
            errors: self
                .unsupported
                .iter()
                .cloned()
                .map(CoverageError::Unsupported)
                .collect(),
        };
        let mut seen = vec![false; self.expected.len()];
        for (id, check) in emitted {
            receipt.emitted += 1;
            let Some(expected) = self.expected.get(id.0) else {
                receipt.errors.push(CoverageError::Unknown(id));
                continue;
            };
            if seen[id.0] {
                receipt.errors.push(CoverageError::Duplicate(id));
                continue;
            }
            seen[id.0] = true;
            if expected != check {
                receipt.errors.push(CoverageError::Changed(id));
            }
        }
        for (at, seen) in seen.into_iter().enumerate() {
            if !seen {
                receipt.errors.push(CoverageError::Missing(CheckId(at)));
            }
        }
        receipt
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Absent, ArrayFill, Block, ManagedType, Param, ParamShape, Terminator};

    fn origin() -> nts_semantic_schema::Origin {
        nts_semantic_schema::Origin::source(nts_diagnostics::Location {
            file: nts_diagnostics::SourceId(0),
            span: nts_diagnostics::Span::new(0, 0),
        })
    }

    fn op(kind: OpKind, ty: HirType) -> Op {
        Op {
            kind,
            ty,
            origin: origin(),
        }
    }

    fn subject(values: Vec<Op>, blocks: Vec<Block>, params: Vec<Param>) -> Func {
        Func {
            name: "subject".into(),
            params,
            return_type: HirType::NUMBER,
            values,
            blocks,
            origin: origin(),
            exported: false,
            initializes_receiver: false,
            abstract_declaration: false,
            async_result: None,
            frame: None,
            obligations: vec![],
            exact: rustc_hash::FxHashMap::default(),
            written_return: None,
            result_absent: Absent::Impossible,
            written_return_elements: vec![],
            validation: Some(Box::default()),
        }
    }

    fn arithmetic() -> Check {
        Check::Scalar {
            actual: ValueId(3),
            original: ScalarRecipe::Binary {
                op: BinOp::Add,
                lhs: ScalarInput {
                    value: ValueId(1),
                    representation: HirType::NUMBER,
                },
                rhs: ScalarInput {
                    value: ValueId(2),
                    representation: HirType::NUMBER,
                },
            },
            equality: NumberEquality::Exact,
        }
    }

    #[test]
    fn scalar_capture_preserves_bits_and_never_repeats_an_effect() {
        let op = |kind| Op {
            kind,
            ty: HirType::NUMBER,
            origin: nts_semantic_schema::Origin::source(nts_diagnostics::Location {
                file: nts_diagnostics::SourceId(0),
                span: nts_diagnostics::Span::new(0, 0),
            }),
        };
        let number = |_| Some(HirType::NUMBER);
        for bits in [0, 1_u64 << 63, 0x7ff8_0000_0000_0123] {
            assert_eq!(
                ScalarRecipe::capture(&op(OpKind::ConstFloat(f64::from_bits(bits))), number),
                Some(ScalarRecipe::Number(bits))
            );
        }
        assert_eq!(ScalarRecipe::capture(&op(OpKind::Param(0)), number), None);
        assert_eq!(
            ScalarRecipe::capture(
                &op(OpKind::Call {
                    callee: super::super::Callee::Direct("effect".into()),
                    args: vec![],
                    frame: None,
                }),
                number
            ),
            None
        );
        assert_eq!(
            ScalarRecipe::capture(&op(OpKind::Convert(ValueId(1))), |_| Some(HirType::Erased)),
            None,
            "an erased payload is not a Number recipe"
        );
    }

    #[test]
    fn a_lost_or_weakened_check_cannot_keep_a_green_receipt() {
        let mut ledger = Ledger::default();
        let original = arithmetic();
        let id = ledger.record(original.clone());
        assert_eq!(ledger.verify([(id, &original)]), Ok(()));
        assert_eq!(ledger.verify([]), Err(CoverageError::Missing(id)));
        assert_eq!(
            ledger.verify([(id, &original), (id, &original)]),
            Err(CoverageError::Duplicate(id))
        );
        let mut weakened = original.clone();
        let Check::Scalar { equality, .. } = &mut weakened else {
            unreachable!()
        };
        *equality = NumberEquality::ToInt32;
        assert_eq!(
            ledger.verify([(id, &weakened)]),
            Err(CoverageError::Changed(id))
        );
        ledger.unsupported("stored tags were discarded before recording".into());
        assert!(matches!(
            ledger.verify([(id, &original)]),
            Err(CoverageError::Unsupported(_))
        ));
    }

    #[test]
    fn inline_copies_keep_original_recipes_and_receive_fresh_check_ids() {
        let original = arithmetic();
        let mut source = Ledger::default();
        source.record(original.clone());
        let mut destination = source.clone();
        let ids = destination.append_remapped(&source, |value| ValueId(value.0 + 10));
        let mut copied = original.clone();
        copied.remap(|value| ValueId(value.0 + 10));
        assert_eq!(
            destination.verify([(CheckId(0), &original), (ids[0], &copied)]),
            Ok(())
        );
        assert_eq!(
            destination.verify([(CheckId(0), &original), (ids[0], &original)]),
            Err(CoverageError::Changed(ids[0]))
        );
        let mut operands = vec![];
        copied.visit_values(|value| operands.push(value));
        assert_eq!(operands, [ValueId(13), ValueId(11), ValueId(12)]);
    }

    #[test]
    fn region_copies_leave_other_checks_in_place_and_fail_atomically() {
        let mut ledger = Ledger::default();
        let outside = Check::Unreachable;
        let outside_id = ledger.record(outside.clone());
        let original = arithmetic();
        let original_id = ledger.record(original.clone());
        let ids = ledger
            .copy_region(&[original_id], |value| ValueId(value.0 + 10))
            .expect("a region with one scalar witness");
        let mut copied = original.clone();
        copied.remap(|value| ValueId(value.0 + 10));
        assert_eq!(
            ledger.verify([
                (outside_id, &outside),
                (original_id, &original),
                (ids[0], &copied)
            ]),
            Ok(())
        );
        assert_eq!(
            ledger.copy_region(&[original_id, original_id], |value| value),
            Err(CoverageError::Duplicate(original_id))
        );
        assert_eq!(
            ledger.copy_region(&[original_id, CheckId(999)], |value| value),
            Err(CoverageError::Unknown(CheckId(999)))
        );
        let receipt = ledger.audit([
            (outside_id, &outside),
            (original_id, &original),
            (ids[0], &copied),
        ]);
        assert_eq!(receipt.recorded, 3, "failed copies added no partial claims");
        assert_eq!(receipt.emitted, 3);
        assert!(receipt.complete());
    }

    #[test]
    fn receipts_keep_the_whole_missing_and_unsupported_work_list() {
        let mut ledger = Ledger::default();
        let a = ledger.record(arithmetic());
        let b = ledger.record(Check::Unreachable);
        ledger.unsupported("a discarded original stored tag".into());
        ledger.unsupported("an unsupported original load".into());
        let receipt = ledger.audit([]);
        assert_eq!((receipt.recorded, receipt.emitted), (2, 0));
        assert_eq!(receipt.unsupported.len(), 2);
        assert_eq!(receipt.errors.len(), 4);
        assert!(receipt.errors.contains(&CoverageError::Missing(a)));
        assert!(receipt.errors.contains(&CoverageError::Missing(b)));
        assert!(!receipt.complete());
    }

    #[test]
    fn dce_preserves_a_check_and_its_otherwise_unused_original_operands() {
        let mut func = subject(
            vec![op(OpKind::ConstFloat(1.0), HirType::NUMBER)],
            vec![Block {
                params: vec![],
                ops: vec![ValueId(0)],
                terminator: Terminator::Return(None),
            }],
            vec![],
        );
        func.return_type = HirType::Void;
        let check = insert(
            &mut func,
            BlockId(0),
            1,
            Check::Scalar {
                actual: ValueId(0),
                original: ScalarRecipe::Number(1.0_f64.to_bits()),
                equality: NumberEquality::Exact,
            },
            origin(),
        )
        .expect("a recorded check in its owning function");
        crate::hir::dce::eliminate(&mut func);
        assert_eq!(func.blocks[0].ops, [ValueId(0), check]);
        assert!(
            audit_function(&func)
                .expect("instrumented function")
                .complete()
        );
        let mut orphan = func.clone();
        orphan.validation = None;
        assert!(
            !audit_function(&orphan)
                .expect("an orphaned check is reported")
                .complete()
        );
        func.blocks[0].ops.retain(|value| *value != check);
        assert!(
            !audit_function(&func)
                .expect("a lost check is reported")
                .complete()
        );
    }

    fn bounds_subject() -> Func {
        let uint = HirType::Int {
            bits: 32,
            signed: false,
        };
        subject(
            vec![
                op(OpKind::Param(0), uint.clone()),
                op(OpKind::ConstInt(4), uint.clone()),
                op(
                    OpKind::ArrayNew {
                        length: ValueId(1),
                        fill: ArrayFill::Holes,
                    },
                    HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER))),
                ),
                op(OpKind::ConstBool(true), HirType::Bool),
                op(
                    OpKind::ArrayGet {
                        array: ValueId(2),
                        index: ValueId(0),
                        checked: true,
                    },
                    HirType::NUMBER,
                ),
            ],
            vec![
                Block {
                    params: vec![],
                    ops: (0..4).map(ValueId).collect(),
                    terminator: Terminator::Jump {
                        target: BlockId(1),
                        args: vec![],
                    },
                },
                Block {
                    params: vec![],
                    ops: vec![ValueId(4)],
                    terminator: Terminator::Return(Some(ValueId(4))),
                },
                Block {
                    params: vec![],
                    ops: vec![],
                    terminator: Terminator::Unreachable,
                },
            ],
            vec![Param {
                name: "index".into(),
                ty: uint,
                origin: origin(),
                known: crate::hir::facts::Facts::TOP,
                written: None,
                shape: ParamShape::Ordinary,
            }],
        )
    }

    #[test]
    fn materialized_validation_branches_never_supply_bounds_authority() {
        let base = bounds_subject();
        let eliminate = |func: &mut Func| {
            let analysis = crate::hir::flow::analyze(func);
            crate::hir::bounds::eliminate_checks(
                func,
                &analysis,
                &crate::hir::bounds::ProgramLengths::default(),
            );
            matches!(func.values[4].kind, OpKind::ArrayGet { checked: true, .. })
        };
        assert!(
            eliminate(&mut base.clone()),
            "the unguarded program needs its check"
        );
        for check in [
            Check::Bounds {
                kind: BoundsKind::Array,
                container: ValueId(2),
                index: ValueId(0),
            },
            Check::Scalar {
                actual: ValueId(3),
                original: ScalarRecipe::Binary {
                    op: BinOp::Lt,
                    lhs: ScalarInput {
                        value: ValueId(0),
                        representation: HirType::NUMBER,
                    },
                    rhs: ScalarInput {
                        value: ValueId(1),
                        representation: HirType::NUMBER,
                    },
                },
                equality: NumberEquality::Exact,
            },
        ] {
            let mut validated = base.clone();
            let cond = insert(&mut validated, BlockId(0), 4, check, origin())
                .expect("a validation predicate");
            validated.blocks[0].terminator = Terminator::Branch {
                cond,
                then_target: BlockId(1),
                then_args: vec![],
                else_target: BlockId(2),
                else_args: vec![],
            };
            assert!(
                eliminate(&mut validated),
                "a diagnostic success is not a source guard"
            );
        }
        let mut source_guard = base;
        let cond = ValueId(u32::try_from(source_guard.values.len()).expect("small fixture"));
        source_guard.values.push(op(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: ValueId(0),
                rhs: ValueId(1),
            },
            HirType::Bool,
        ));
        source_guard.blocks[0].ops.push(cond);
        source_guard.blocks[0].terminator = Terminator::Branch {
            cond,
            then_target: BlockId(1),
            then_args: vec![],
            else_target: BlockId(2),
            else_args: vec![],
        };
        assert!(
            !eliminate(&mut source_guard),
            "the real source guard still proves the access"
        );
    }
}

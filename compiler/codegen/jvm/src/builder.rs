//! JVM spellings for the shared linear string-storage proof.
//!
//! Eligibility is backend-neutral (`hir::string_accumulators`); this module
//! chooses `StringBuilder` and fuses the single-unit append helper.

use nts_core::hir::{BinOp, Callee, Func, OpKind, Program, ValueId};
use rustc_hash::FxHashSet;

/// The verification type an accumulator is held as.
///
/// Split out so `body::Emitter::new` reads one call rather than a branch, for
/// the reason `unbox::held_as` is.
#[must_use]
pub(crate) fn held_as(
    accumulated: &FxHashSet<ValueId>,
    value: ValueId,
) -> Option<nts_jvm_emitter::VType> {
    accumulated
        .contains(&value)
        .then(|| nts_jvm_emitter::VType::Object(BUILDER.to_owned()))
}

/// The class a string accumulator is held in.
pub(crate) const BUILDER: &str = "java/lang/StringBuilder";

/// One physical mode, selected before any method descriptor is written.
#[derive(Debug)]
pub(crate) enum Plan<'a> {
    /// The pre-existing local convention; every function ABI remains String.
    Legacy,
    /// Every descriptor and held value uses one exact frozen proof subject.
    Shared(nts_core::hir::string_accumulators::chains::Plan<'a>),
}

impl<'a> Plan<'a> {
    pub(crate) fn new(program: &'a Program) -> Self {
        let proof = nts_core::hir::string_accumulators::chains::Plan::new(program);
        if proof.admitted().next().is_none() {
            Self::Legacy
        } else {
            Self::Shared(proof)
        }
    }
    pub(crate) fn parameter(&self, func: &Func) -> Option<usize> {
        match self {
            Self::Legacy => None,
            Self::Shared(proof) => proof
                .parameter_of(func)
                .and_then(|slot| usize::try_from(slot).ok()),
        }
    }
    pub(crate) fn values(
        &self,
        func: &Func,
    ) -> Result<FxHashSet<ValueId>, nts_diagnostics::Diagnostic> {
        match self {
            Self::Legacy => Ok(nts_core::hir::string_accumulators::local(func)),
            Self::Shared(proof) => proof.values_in(func).ok_or_else(|| {
                crate::body::refuse(
                    func,
                    "a string-carrier render subject absent from the frozen proof",
                )
            }),
        }
    }
}

pub(crate) const DESCRIPTOR: &str = "Ljava/lang/StringBuilder;";

/// The same carrier slot defines both a descriptor and its initial frame local.
pub(crate) fn parameter_type(
    shape: crate::types::Shape<'_>,
    func: &Func,
    index: usize,
) -> Option<nts_jvm_emitter::VType> {
    if shape.program.strings.parameter(func) == Some(index) {
        Some(nts_jvm_emitter::VType::Object(BUILDER.to_owned()))
    } else {
        crate::types::vtype(shape, &func.params.get(index)?.ty)
    }
}

impl crate::body::Emitter<'_> {
    /// Transfer the exact admitted carrier; other arguments keep their normal ABI.
    pub(crate) fn string_argument(
        &self,
        code: &mut nts_jvm_emitter::code::Code,
        pool: &mut nts_jvm_emitter::Pool,
        target: &Func,
        index: usize,
        arg: ValueId,
    ) -> Result<(), nts_diagnostics::Diagnostic> {
        if self.program.strings.parameter(target) == Some(index) {
            if !self.accumulated.contains(&arg) {
                return Err(crate::body::refuse(
                    self.func,
                    "a shared string call without its proved held argument",
                ));
            }
            self.load_held(code, pool, arg)
        } else {
            self.load(code, pool, arg)
        }
    }
    pub(crate) fn string_result(
        &self,
        code: &mut nts_jvm_emitter::code::Code,
        target: &Func,
        value: ValueId,
    ) -> Result<Option<crate::body::Placed>, nts_diagnostics::Diagnostic> {
        if self.program.strings.parameter(target).is_none() {
            return Ok(None);
        }
        if matches!(self.func.value(value).ty, nts_core::hir::HirType::Void) {
            code.pop(&self.func.value(value).origin, 1);
            return Ok(Some(crate::body::Placed::Stored));
        }
        if !self.accumulated.contains(&value) {
            return Err(crate::body::refuse(
                self.func,
                "a shared string result absent from the frozen held values",
            ));
        }
        Ok(Some(crate::body::Placed::OnStack))
    }
}

/// `out += String.fromCharCode(c)` where `out` is a builder: the one-character
/// string that `appendCharCode` makes unnecessary.
///
/// # This set exists so that two places cannot disagree
///
/// `ops` decided this at emission time and `block` did not know, so the call
/// was emitted *and* the fused append was emitted -- the string was built,
/// stored to a slot and never read:
///
/// ```text
/// 321: invokestatic  NtsRuntime.stringFromCharCode:(D)Ljava/lang/String;
/// 324: astore        27
/// 326: aload         9
/// 328: dload         21
/// 330: invokestatic  NtsRuntime.appendCharCode:(...)
/// ```
///
/// **C2 deletes the dead allocation, so on `HotSpot` the fusion measured as a
/// saving it was not making.** ART does not, and `node-utf8` allocates two
/// objects per character for it -- a `String` and its backing array, 15,366 an
/// operation at 23 bytes. That is the goal's premise exactly: "C2 handles it,
/// therefore it is free" was the whole of the original measurement.
///
/// So `ops` asks this set rather than re-deriving the condition, and `block`
/// asks the same one.
#[must_use]
pub(crate) fn char_code_appends(
    func: &Func,
    uses: &[u32],
    accumulated: &FxHashSet<ValueId>,
) -> FxHashSet<ValueId> {
    let mut fused = FxHashSet::default();
    for op in &func.values {
        let OpKind::Binary {
            op: BinOp::Concat,
            lhs,
            rhs,
        } = &op.kind
        else {
            continue;
        };
        if !accumulated.contains(lhs) || uses.get(rhs.0 as usize).copied() != Some(1) {
            continue;
        }
        let Some(source) = func.values.get(rhs.0 as usize) else {
            continue;
        };
        if let OpKind::Call {
            callee: Callee::External(name),
            args,
            ..
        } = &source.kind
            && name == "nts_string_from_char_code"
            && args.len() == 1
        {
            fused.insert(*rhs);
        }
    }
    fused
}

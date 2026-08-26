//! HIR: the compiler's first representation of a program.
//!
//! # What changes here
//!
//! A [`nts_semantic_schema::SemanticSnapshot`] states **facts about the source**.
//! HIR states **decisions about representation**. That distinction is the whole
//! point of the layer, and it is easy to lose: a one-to-one mapping from
//! [`nts_semantic_schema::TypeKind`] to [`HirType`] would look reasonable and
//! quietly forfeit every optimization the project exists for.
//!
//! The clearest case is `number`. TypeScript's `number` *is* an IEEE double —
//! that is a fact, and the frontend can say nothing else about it. [`HirType`]
//! has to choose how the value lives in a machine, and "double" is only the
//! conservative answer. When analysis shows a value is integral and in range, the
//! same source type becomes an `i32`: `iadd` rather than `dadd` on the JVM, no
//! boxing, and a machine register instead of a slot.
//!
//! # Three things happen in lowering
//!
//! - **Nodes become operations.** The tree flattens into typed instructions in
//!   one order, and an `Origin` rides on every one (RFC decision 20).
//! - **Types become representations.** See above.
//! - **Symbols become values.** Two identifiers carrying the same symbol become
//!   one [`ValueId`]. Binding identity is what makes that possible, which is why
//!   symbol resolution had to land before this.

pub mod dce;
pub mod facts;
pub mod flow;

pub mod lower;
pub mod specialize;
pub mod verify;

use nts_semantic_schema::{Origin, SemanticSnapshot, TypeId};

/// How a value is represented in a machine.
///
/// Deliberately not a mirror of [`nts_semantic_schema::TypeKind`]. That type
/// describes what the source said; this one describes what will be emitted, and
/// the two are related by a decision rather than a translation.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum HirType {
    /// No value. A function that falls off its end returns this.
    Void,
    /// No value, and control does not reach here. Distinct from [`HirType::Void`]:
    /// a `never` return means the call does not come back, which lets a backend
    /// drop everything after it.
    Never,
    Bool,
    /// An exact integer of a chosen width.
    ///
    /// Nothing in TypeScript is declared this way — reaching it is always a
    /// decision, either from an exact annotation or from specialization.
    Int {
        bits: u8,
        signed: bool,
    },
    /// An IEEE float. `f64` is what an unspecialized `number` becomes.
    Float {
        bits: u8,
    },
    /// A garbage-collected reference.
    ///
    /// The distinction that decides whether a store needs a write barrier and
    /// whether the value must be rooted across a safepoint (RFC §10, §11). An
    /// exact scalar needs neither and can live in a register.
    Managed(ManagedType),
}

/// What a managed reference points at.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ManagedType {
    String,
    /// An object whose layout comes from the snapshot's type record.
    ///
    /// Carries the schema's id rather than a resolved layout: the descriptor
    /// (RFC §8.1) is built during memory lowering, and duplicating it here would
    /// mean two answers to one question.
    Object(TypeId),
    Array(Box<HirType>),
}

impl HirType {
    /// The conservative representation for TypeScript's `number`.
    ///
    /// Named rather than written inline so the places that have *not* yet been
    /// specialized are greppable.
    ///
    /// # What replaces this
    ///
    /// Narrowing a `number` to an integer is a *proof*, not a heuristic, and the
    /// proof already exists: `third_party/scriptc/packages/compiler/src/ir/number-facts.ts`
    /// in the proof-of-concept is a flow-sensitive forward abstract
    /// interpretation over the IR — an interval over the extended reals joined
    /// with wholeness, may-be-NaN and may-be-negative-zero flags, plus the
    /// literal's source spelling.
    ///
    /// It discharges three obligations before a value may cross into an integer
    /// slot: representability (the written literal round-trips through `f64`),
    /// wholeness (integral on every path), and range (within ±(2^53 − 1), beyond
    /// which integrality is unprovable because adjacent integers stop being
    /// distinguishable). Its transfer functions implement JavaScript semantics
    /// rather than idealized arithmetic — `x | 0` is a proof by way of `ToInt32`,
    /// and remainder takes the dividend's sign.
    ///
    /// Its JVM consumer asks exactly the question this constant defers: whether a
    /// local can use a Java `int` without changing number semantics. Investigate
    /// it before writing a specialization pass here; do not re-derive it.
    pub const NUMBER: Self = Self::Float { bits: 64 };

    /// Whether values of this type are traced by the collector.
    ///
    /// What a write barrier and a root slot are decided from.
    #[must_use]
    pub const fn is_managed(&self) -> bool {
        matches!(self, Self::Managed(_))
    }

    /// Whether this type fits in a machine register.
    #[must_use]
    pub const fn is_scalar(&self) -> bool {
        matches!(self, Self::Bool | Self::Int { .. } | Self::Float { .. })
    }
}

/// A value produced by an operation.
///
/// Indexes the enclosing function's operation list: values are numbered in the
/// order they are defined, so a definition always precedes its uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ValueId(pub u32);

/// A basic block.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct BlockId(pub u32);

/// One function.
#[derive(Debug, Clone)]
pub struct Func {
    pub name: String,
    pub params: Vec<Param>,
    pub return_type: HirType,
    /// Every value the function defines. [`ValueId`] indexes this.
    ///
    /// Separate from the blocks so that a value's identity survives blocks being
    /// reordered, split, or merged — which every optimization does.
    pub values: Vec<Op>,
    /// Blocks. `blocks[0]` is the entry.
    pub blocks: Vec<Block>,
    pub origin: Origin,
    /// Exported from its module, and therefore a root: reachability starts here
    /// and the symbol survives into the artifact.
    pub exported: bool,
}

impl Func {
    /// The op defining a value.
    #[must_use]
    pub fn value(&self, id: ValueId) -> &Op {
        &self.values[id.0 as usize]
    }

    /// The entry block.
    #[must_use]
    pub fn entry(&self) -> &Block {
        &self.blocks[0]
    }
}

/// A straight-line run of operations ending in exactly one terminator.
///
/// # Why blocks, and why parameters instead of phi nodes
///
/// A flat operation list cannot express a branch, and without a control-flow
/// graph there is no dominance — so no constant propagation, no dead-code
/// elimination, and nowhere for `number` specialization to run. The structure is
/// the optimization work, not a preliminary to it.
///
/// Values that differ by which edge was taken arrive as **block parameters**,
/// passed as arguments on the jump. A phi node states the same thing but keeps it
/// inside the successor, where it has to be held in order with a predecessor list
/// that every edit can invalidate. On the edge, splitting a critical edge is
/// local and cannot desynchronize anything. Cranelift, MLIR and Swift SIL all
/// made this choice.
#[derive(Debug, Clone)]
pub struct Block {
    /// Values this block receives from its predecessors.
    pub params: Vec<ValueId>,
    /// Operations in order, as indices into the function's value arena.
    pub ops: Vec<ValueId>,
    pub terminator: Terminator,
}

/// How a block ends. Exactly one per block, and never in the middle.
#[derive(Debug, Clone, PartialEq)]
pub enum Terminator {
    Return(Option<ValueId>),
    Jump {
        target: BlockId,
        args: Vec<ValueId>,
    },
    Branch {
        cond: ValueId,
        then_target: BlockId,
        then_args: Vec<ValueId>,
        else_target: BlockId,
        else_args: Vec<ValueId>,
    },
    /// Control cannot reach here.
    ///
    /// Distinct from a missing terminator, which is a malformed function. This is
    /// a claim the compiler is making, and a backend may rely on it.
    Unreachable,
}

impl Terminator {
    /// Blocks this one can transfer control to.
    #[must_use]
    pub fn successors(&self) -> Vec<BlockId> {
        match self {
            Self::Return(_) | Self::Unreachable => Vec::new(),
            Self::Jump { target, .. } => vec![*target],
            Self::Branch {
                then_target,
                else_target,
                ..
            } => vec![*then_target, *else_target],
        }
    }
}

/// One parameter.
#[derive(Debug, Clone)]
pub struct Param {
    pub name: String,
    pub ty: HirType,
    pub origin: Origin,
    /// What the *declared type* says the value can be.
    ///
    /// A parameter is an input, so nothing inside a function constrains it —
    /// which is why an exported `(n: number)` defeats every proof downstream of
    /// it. But TypeScript's types often say more than `number`: `0 | 1 | 2` is a
    /// union of literal types, and `const` gives a literal type of its own. That
    /// is a fact about every possible caller, available without seeing one, and
    /// it is the only way a parameter becomes provable at all.
    pub known: facts::Facts,
}

/// One operation.
#[derive(Debug, Clone)]
pub struct Op {
    pub kind: OpKind,
    /// The type of the value this defines. [`HirType::Void`] when it defines none.
    pub ty: HirType,
    /// Where this came from. Not optional — RFC decision 20, and the one property
    /// that cannot be recovered once a lowering has run without it.
    pub origin: Origin,
}

/// What an operation does.
#[derive(Debug, Clone, PartialEq)]
pub enum OpKind {
    /// The nth parameter of the function, materialized as a value.
    Param(u32),
    /// The nth parameter of the block that defines it.
    BlockParam(u32),
    ConstInt(i64),
    ConstFloat(f64),
    ConstBool(bool),
    ConstString(String),
    Binary {
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
    },
    Unary {
        op: UnOp,
        operand: ValueId,
    },
    /// Reinterpret a value in a different representation.
    ///
    /// The one operation whose whole content is its result type. It appears only
    /// where specialization decided two adjacent values should live in different
    /// machine types — and each one is a cost, so a pass that inserts many is
    /// telling you it chose badly.
    Convert(ValueId),
    /// A call whose callee the checker resolved.
    Call {
        callee: Callee,
        args: Vec<ValueId>,
    },
    /// Return, with a value unless the function is `void`.
    Return(Option<ValueId>),
}

/// What a call reaches.
///
/// Not a value: a resolved call names its target statically, which is the whole
/// reason to have resolved it. A callee that had to be computed would be a
/// different operation, and one this lowering does not yet accept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Callee {
    /// A function declared in the compiled program. Emits a static call.
    Direct(String),
    /// Declared outside the compiled set — an import from a package, or an
    /// ambient declaration. The signature is known, so the call is still typed
    /// exactly; what is missing is a definition to call, which the linker or the
    /// platform supplies.
    External(String),
}

/// A binary operator, after the source operator has been resolved against its
/// operand types.
///
/// `+` is not one operator: on two numbers it is arithmetic, on two strings it is
/// concatenation, and the two lower to nothing alike. Resolving that here means
/// no backend has to ask again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Rem,
    /// String concatenation. Distinct from [`BinOp::Add`] on purpose.
    Concat,
    Lt,
    Le,
    Gt,
    Ge,
    Eq,
    Ne,

    /// Bitwise operators, on operands already coerced by [`UnOp::ToInt32`] or
    /// [`UnOp::ToUint32`].
    ///
    /// JavaScript defines these as `ToInt32`, then the machine operation, then
    /// back — which makes the *result* whole and inside int32 whatever the
    /// inputs were. That is not a hint about likely values, it is a guarantee
    /// from the language, and it is why `x | 0` is the idiom for "this is an
    /// integer". The coercion is a separate operation so that the guarantee
    /// lands on a value the analysis can see.
    BitAnd,
    BitOr,
    BitXor,
    Shl,
    /// Arithmetic (sign-propagating) right shift, JavaScript's `>>`.
    Shr,
    /// Logical right shift, JavaScript's `>>>`. The one bitwise operator whose
    /// result is *uint32*, and so the one that can exceed int32.
    UShr,
}

/// A unary operator.
///
/// Negation is its own operation rather than `0 - x`, which is a different
/// function: IEEE says `0.0 - 0.0` is `+0.0`, while `-(0.0)` is `-0.0`. The two
/// zeroes are distinguishable — `1/x` tells them apart — so lowering negation to
/// a subtraction silently changes results.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnOp {
    Neg,
    Not,
    /// JavaScript's `ToInt32`: truncate toward zero, reduce modulo 2^32, then
    /// reinterpret as signed. Maps NaN and both infinities to `0`.
    ///
    /// Not a C cast. `(int32_t)x` on an out-of-range double is undefined
    /// behaviour, while `ToInt32` is total and wraps.
    ToInt32,
    /// JavaScript's `ToUint32`. As above, reinterpreted unsigned.
    ToUint32,
}

/// A lowered program.
#[derive(Debug, Clone, Default)]
pub struct Program {
    pub funcs: Vec<Func>,
}

/// Everything a backend needs, in the one order that is correct.
///
/// Lower, specialize, verify. Kept here rather than in each caller because a
/// backend that skipped specialization would emit slower code than the tests
/// measured, and one that skipped verification would emit code from HIR nothing
/// checked. Both have happened; neither is visible in the output.
#[derive(Debug)]
pub struct Prepared {
    pub program: Program,
    /// What could not be lowered. Reported, not fatal: a program may have one
    /// unsupported function and many supported ones.
    pub diagnostics: Vec<nts_diagnostics::Diagnostic>,
    pub specialized: usize,
    pub conversions: usize,
}

/// Lower a snapshot and make it ready to emit.
///
/// # Errors
///
/// If the result is not valid SSA. A backend is entitled to trust its input
/// only because something checked it, and specialization rewrites types and
/// inserts operations — so it has to earn that trust again rather than inherit
/// it from the lowering.
pub fn prepare(snapshot: &SemanticSnapshot) -> Result<Prepared, Vec<verify::Invalid>> {
    let lowered = lower::lower(snapshot);
    let mut program = lowered.program;
    let mut specialized = 0;
    let mut conversions = 0;

    for func in &mut program.funcs {
        let analysis = flow::analyze(func);
        let report = specialize::specialize(func, &analysis);
        specialized += report.specialized;
        conversions += report.conversions;
    }

    // Specialization orphans values by design — a folded constant leaves its
    // unfolded original with no readers — and the C emitter declares a local for
    // everything it assigns.
    for func in &mut program.funcs {
        dce::eliminate(func);
    }

    verify::verify(&program)?;
    Ok(Prepared {
        program,
        diagnostics: lowered.diagnostics,
        specialized,
        conversions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_number_lowers_to_a_double_until_specialized() {
        // The conservative choice, and the one specialization exists to improve on.
        assert_eq!(HirType::NUMBER, HirType::Float { bits: 64 });
    }

    #[test]
    fn scalars_and_managed_references_are_disjoint() {
        // What a write barrier is decided from: an exact scalar needs none and
        // can live in a register; a managed reference needs both a barrier and a
        // root slot across a safepoint.
        let scalar = HirType::Int {
            bits: 32,
            signed: true,
        };
        let managed = HirType::Managed(ManagedType::String);

        assert!(scalar.is_scalar() && !scalar.is_managed());
        assert!(managed.is_managed() && !managed.is_scalar());
    }

    #[test]
    fn void_and_never_are_distinct() {
        // `never` says control does not come back, which lets a backend drop
        // everything after the call. `void` says it does, with no value.
        assert_ne!(HirType::Void, HirType::Never);
        assert!(!HirType::Never.is_scalar());
    }
}

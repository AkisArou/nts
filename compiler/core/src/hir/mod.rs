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

pub mod lower;

use nts_semantic_schema::{Origin, TypeId};

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

/// One function.
#[derive(Debug, Clone)]
pub struct Func {
    pub name: String,
    pub params: Vec<Param>,
    pub return_type: HirType,
    /// Operations in evaluation order. `ops[i]` defines `ValueId(i)`.
    pub ops: Vec<Op>,
    pub origin: Origin,
    /// Exported from its module, and therefore a root: reachability starts here
    /// and the symbol survives into the artifact.
    pub exported: bool,
}

/// One parameter.
#[derive(Debug, Clone)]
pub struct Param {
    pub name: String,
    pub ty: HirType,
    pub origin: Origin,
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
    /// The nth parameter, materialized as a value.
    Param(u32),
    ConstInt(i64),
    ConstFloat(f64),
    ConstBool(bool),
    ConstString(String),
    Binary {
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
    },
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
}

/// A lowered program.
#[derive(Debug, Clone, Default)]
pub struct Program {
    pub funcs: Vec<Func>,
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

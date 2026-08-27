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

pub mod bounds;
pub mod dce;
pub mod escape;
pub mod facts;
pub mod fields;
pub mod flow;
pub mod fold;
pub mod guards;
pub mod interprocedural;
pub mod liveness;
pub mod loops;

pub mod lower;
pub mod monomorphize;
pub mod rc;
pub mod reachable;
pub mod signatures;
pub mod simplify;
pub mod specialize;
pub mod verify;
pub mod zero_sign;

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
    /// Parameter zero arrives freshly allocated, with every field still zero.
    ///
    /// True for a constructor and nothing else. It holds by construction rather
    /// than by analysis: `new C(...)` is the only thing that emits a call to
    /// `C#constructor`, and it allocates the object immediately before. There is
    /// no way in TypeScript to run a constructor over an object that already
    /// exists.
    ///
    /// What it buys is that a constructor's first store to a field is an
    /// initializing store — it does not have to load and release whatever the
    /// slot held, because the slot held nothing. Without this a class costs a
    /// load, a null test and a call per reference field per construction.
    pub initializes_receiver: bool,
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
        /// Storage for the result, in the frame, measured in code units.
        ///
        /// Only for an external helper that returns a *fresh* string. Set by
        /// [`place_allocations`] where two facts hold together: the result does
        /// not escape ([`escape`]), and its length cannot exceed this capacity
        /// ([`flow::string_span`]). The helper then fills storage the caller
        /// supplies instead of calling the allocator, and the result is
        /// `NTS_IMMORTAL`, so the release the counting pass emits is a no-op.
        ///
        /// This is [`OpKind::ObjectNew`]'s `frame` for a value whose size is not
        /// its type's. An object's layout says how big it is; a string's does
        /// not, which is why this carries a number and that carries a flag.
        frame: Option<u32>,
    },
    /// Return, with a value unless the function is `void`.
    Return(Option<ValueId>),

    /// Allocate an array. The element type is carried by the operation's own
    /// type, which is a [`ManagedType::Array`].
    ArrayNew {
        length: ValueId,
    },
    /// The element count of a variable-length managed object.
    ///
    /// One operation for arrays and strings, because they share a header
    /// (RFC 8.2) and it is the same field. For a string it counts UTF-16 code
    /// units, which is what `String.prototype.length` means.
    Length(ValueId),
    /// `array[index]`.
    ArrayGet {
        array: ValueId,
        index: ValueId,
        /// Whether the index still has to be tested at run time.
        ///
        /// A *decision*, recorded here rather than left to the backend, so that
        /// eliminating a check is visible in the HIR and can be tested for. See
        /// [`super::bounds`].
        checked: bool,
    },
    /// Claim a reference. Produces nothing.
    ///
    /// Abstract on purpose (RFC §7.2): HIR must not encode reference counting as
    /// the *meaning* of a managed reference. Under `NoGC` these are not emitted at
    /// all; under a tracing collector they would not be either.
    Retain(ValueId),
    /// Give up a reference. Produces nothing.
    Release(ValueId),
    /// Allocate an object. The type is carried by the operation's own type,
    /// which is a [`ManagedType::Object`].
    /// One UTF-16 code unit of a string: `s.charCodeAt(i)`.
    ///
    /// An operation and not a call, for the same reason [`OpKind::ArrayGet`] is
    /// one. As a call its index has to match a C signature, which pins the index
    /// — and therefore the loop counter that produces it — to a `double`, and
    /// then every arithmetic step downstream is floating point. As an operation
    /// the analysis sees a `uint32` index and a result in `[0, 65535]`.
    ///
    /// `checked` is the reverse of an array's: out of range is `NaN` rather than
    /// a trap, so the flag says whether the result may be one. Where the index
    /// is proven inside the string, it cannot be, and the whole expression stays
    /// integral.
    StringUnitAt {
        string: ValueId,
        index: ValueId,
        checked: bool,
    },
    /// Read a module-scope variable.
    GlobalGet(u32),
    /// Write one. Produces nothing.
    GlobalSet {
        global: u32,
        value: ValueId,
    },
    /// Allocate an object.
    ///
    /// `frame: true` puts it in the caller's stack frame instead of the heap,
    /// which [`escape`] decides: a reference that never leaves the function
    /// that made it does not need to be anywhere a collector can see. A frame
    /// object is not reference counted, because there is nothing to count -- it
    /// goes away when the frame does.
    /// The absent reference: `null` and `undefined`, which are one value here.
    ///
    /// A reference has a value that is not an object, so `T | undefined` needs
    /// no tag beside it -- this *is* the tag. The op's type is the managed type
    /// the absence stands in for, because a null `NtsString *` and a null
    /// `NtsObj_Point *` are different types to C even though they are the same
    /// address.
    ConstNull,
    ObjectNew {
        frame: bool,
    },
    /// `object.field`, by index into the type's [`Layout`].
    ///
    /// An index rather than a name: the layout already decided the order, and
    /// a backend that had to look a name up would be free to disagree with the
    /// one that emitted the type.
    FieldGet {
        object: ValueId,
        field: u32,
    },
    /// `object.field = value`. Produces nothing.
    FieldSet {
        object: ValueId,
        field: u32,
        value: ValueId,
    },
    /// `array[index] = value`. Produces nothing.
    ArraySet {
        array: ValueId,
        index: ValueId,
        value: ValueId,
        checked: bool,
    },
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
    /// A method something overrides, so which implementation runs depends on
    /// what the receiver *is* rather than on what its type says.
    ///
    /// The slot is an index into the receiver's class table, numbered against
    /// the class that first declared the method so that every class in a
    /// hierarchy agrees about it. `declared` names the implementation the
    /// receiver's static type would reach, which is what gives the call its
    /// signature — the table stores untyped pointers, and something has to say
    /// how to call one.
    ///
    /// A method nothing overrides is [`Callee::Direct`]. That is not an
    /// optimization applied afterwards: a call site knows which it is, because
    /// the hierarchy is closed and the compiler has all of it.
    Virtual { slot: u32, declared: String },
    /// A function *value* being called: `f(x)` where `f` is a parameter, a
    /// local, or anything else that holds a closure.
    ///
    /// A closure is an object with one method, so this is a dispatch like any
    /// other -- but there is no declaration to take a signature from, because
    /// every closure of the type has its own. The signature is built from the
    /// call itself, which knows the argument types and the result type exactly.
    Closure { slot: u32 },
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

    /// `Math.min` and `Math.max`.
    ///
    /// Not C's `fmin`/`fmax`, which return the non-NaN operand where JavaScript
    /// returns NaN, and which have their own opinion about the two zeroes.
    Min,
    Max,
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

    /// `Math.floor`, `Math.ceil`, `Math.trunc`, `Math.round`, `Math.abs`.
    ///
    /// The rounding four are *proofs of wholeness*, in the way `x | 0` is a
    /// proof of int32-ness — and a stronger one, because they keep the
    /// magnitude instead of wrapping it. They are how an author says "this is
    /// an integer" about a value too large for int32.
    ///
    /// `Round` is not C's `round`: JavaScript rounds a half toward positive
    /// infinity, so `Math.round(-1.5)` is `-1` where C says `-2`.
    Floor,
    Ceil,
    Trunc,
    Round,
    Abs,

    /// `Math.sqrt`.
    ///
    /// The one transcendental-looking function that is not one: IEEE-754
    /// requires a correctly rounded square root, so C's `sqrt` and JavaScript's
    /// `Math.sqrt` are the same value on every input, including the negatives
    /// where both are NaN. `Math.sin` is not, which is why it is not here.
    Sqrt,

    /// JavaScript truthiness.
    ///
    /// Not a comparison against zero: `NaN` is falsy and is not equal to
    /// anything, and both zeroes are falsy while only one of them compares
    /// equal to `0` in an interval. What `&&` and `||` branch on.
    Truthy,
}

/// One field of an object, in layout order.
#[derive(Debug, Clone)]
pub struct Field {
    pub name: String,
    pub ty: HirType,
    /// Never written after construction — semantic, not syntactic, so
    /// `Readonly<T>` counts. Load-bearing: `const` in C, `ACC_FINAL` on the
    /// JVM, hoistable loads, and no write barrier on a reference field that is
    /// never stored to.
    pub readonly: bool,
}

/// How one object type is laid out.
///
/// The compiler's answer to "where is this field", decided once and consumed by
/// every backend — so a C struct and a JVM `field_info` table cannot disagree
/// about the order. RFC §8.1's descriptor is built from this; the descriptor is
/// what the *provider* reads at run time, and this is what the compiler decided.
#[derive(Debug, Clone)]
pub struct Layout {
    /// Every schema type that has this layout.
    ///
    /// More than one, because TypeScript is *structurally* typed: `Point` and
    /// the anonymous `{ x: number; y: number }` of a literal are the same type,
    /// and giving them separate layouts would emit two C structs that are the
    /// same struct and could not be passed to each other.
    pub types: Vec<TypeId>,
    /// The source name, for diagnostics and for the emitted type's name.
    pub name: String,
    pub fields: Vec<Field>,
    /// This class's implementation for each dispatch slot, where it has one.
    ///
    /// Empty for a class in a hierarchy where nothing is overridden, which is
    /// most of them — and an empty table is no table at all in the emitted code.
    pub methods: Vec<Option<String>>,
}

impl Layout {
    /// Whether two layouts are the same shape.
    ///
    /// Field names and representations, in order. Not `readonly`: a value is
    /// laid out the same whether or not anyone may write to it, and refusing to
    /// share a layout over that would split `Point` from `Readonly<Point>`.
    ///
    /// The dispatch table counts too. Two classes that extend the same base and
    /// add no fields have identical field lists and different `area` methods —
    /// merging them on fields alone would give one of them the other's
    /// behaviour. The same is true, and much more often, of closures: their
    /// fields are what they captured, and two closures capturing one number
    /// each are the same shape and different code.
    #[must_use]
    pub fn same_shape(&self, fields: &[Field], methods: &[Option<String>]) -> bool {
        self.fields.len() == fields.len()
            && self
                .fields
                .iter()
                .zip(fields)
                .all(|(mine, theirs)| mine.name == theirs.name && mine.ty == theirs.ty)
            && self.methods == methods
    }

    /// Which fields hold references, by name, in layout order.
    ///
    /// RFC §8.3's reference map. The backend turns each name into a byte offset
    /// with `offsetof`, because the runtime cannot: it does not know the field
    /// types, so a field *index* tells it nothing about where the field is.
    ///
    /// A list rather than the bitmap this used to be. A bitmap over indices
    /// needed the backend to reconstruct the same order to interpret it, and it
    /// stopped working at thirty-two fields -- a limit that had to be refused,
    /// for a program that is perfectly ordinary.
    ///
    /// It is recorded even under `NoGC`, where nothing reads it, because it is a
    /// fact about the *layout* and the layout is decided here rather than by
    /// whatever collects later.
    #[must_use]
    pub fn reference_fields(&self) -> Vec<&str> {
        self.fields
            .iter()
            .filter(|field| field.ty.is_managed())
            .map(|field| field.name.as_str())
            .collect()
    }

    /// The index of a field by name.
    #[must_use]
    pub fn index_of(&self, name: &str) -> Option<u32> {
        self.fields
            .iter()
            .position(|field| field.name == name)
            .and_then(|at| u32::try_from(at).ok())
    }
}

/// The first type id this compiler gives to a class the checker never saw.
///
/// A closure's class is one: the checker has a type for the arrow's
/// *signature*, but the thing that carries what it captured is this compiler's
/// own construction. Those are numbered down from the top of the id space, so a
/// program would have to declare a million types before one collided -- and a
/// dump can tell the two apart, which matters because `obj#4294967295` reads
/// like a bug where `closure#0` reads like what it is.
pub const SYNTHETIC_TYPE_FLOOR: u32 = u32::MAX - (1 << 20);

/// A lowered program.
#[derive(Debug, Clone, Default)]
pub struct Program {
    pub funcs: Vec<Func>,
    /// Layouts for every object type the program uses.
    pub layouts: Vec<Layout>,
    /// Variables declared at module scope, indexed by [`OpKind::GlobalGet`].
    pub globals: Vec<Global>,
}

/// A variable that outlives every call.
///
/// Only `let` and `var` reach here. A module-scope `const` with a constant
/// initializer is resolved to its value at each use instead — a better answer
/// than storage that is read and never written, and what makes `const TAU = 6.28`
/// cost nothing at all.
///
/// Scalars only, for now. A managed global is a *root*: reachable without being
/// on any stack, so a collector has to be told about it, and RFC §10.2 puts root
/// registration in the memory provider rather than in a backend. Refusing until
/// that exists beats a global nothing traces.
#[derive(Debug, Clone, PartialEq)]
pub struct Global {
    pub name: String,
    pub ty: HirType,
    /// What it holds before anything runs. A `bool` stores its truth value here;
    /// `ty` says which of the two a zero means.
    pub initial: f64,
    /// Visible outside the compiled set, so it keeps its name in the artifact.
    pub exported: bool,
    pub origin: Origin,
}

impl Program {
    /// Which layouts can be part of a reference cycle.
    ///
    /// A cycle is what reference counting cannot reclaim on its own, so a
    /// collector has to consider every object that might be in one. Most cannot
    /// be, and that is decidable from the types alone: an object of type `T` can
    /// be in a cycle only if `T` is reachable from `T` by following reference
    /// fields. `class Wrapper { inner: Leaf }` never can be, however many
    /// `Wrapper`s exist; `class Node { next: Node }` always can be, and takes
    /// one line to write.
    ///
    /// Answering it here is what keeps the collector off every program that has
    /// no cycles to collect. The alternative is a runtime that buffers a
    /// candidate on every release that does not reach zero, which is most of
    /// them.
    ///
    /// An array of references is conservatively cyclic: every one of them shares
    /// a single descriptor, which describes the element's shape and not what the
    /// element points at, so there is nothing per-element-type to be precise
    /// with. A field whose type has no layout here is cyclic for the same
    /// reason — the answer is unknown, and unknown has to mean yes.
    /// Which functions a dispatch slot can land on, by index into `funcs`.
    ///
    /// Every pass that reasons across a call needs this, because a dispatch is not
    /// opaque: the tables *are* the complete list of what a call through a slot can
    /// reach. Treating it as unknowable instead costs precision everywhere --
    /// reference-counting placement, escape analysis, and the facts a parameter is
    /// analyzed with, which is the one that turns into wrong code rather than slow
    /// code.
    #[must_use]
    pub fn slot_targets(&self) -> rustc_hash::FxHashMap<u32, Vec<usize>> {
        let by_name: rustc_hash::FxHashMap<&str, usize> = self
            .funcs
            .iter()
            .enumerate()
            .map(|(index, func)| (func.name.as_str(), index))
            .collect();

        let mut targets: rustc_hash::FxHashMap<u32, Vec<usize>> = rustc_hash::FxHashMap::default();
        for layout in &self.layouts {
            for (slot, method) in layout.methods.iter().enumerate() {
                let Some(target) = method.as_deref().and_then(|name| by_name.get(name)) else {
                    continue;
                };
                let entry = targets
                    .entry(u32::try_from(slot).unwrap_or(u32::MAX))
                    .or_default();
                if !entry.contains(target) {
                    entry.push(*target);
                }
            }
        }
        targets
    }

    #[must_use]
    pub fn cyclic_layouts(&self) -> Vec<bool> {
        // Edges: which layouts a layout's reference fields can lead to.
        let edges: Vec<Vec<usize>> = self
            .layouts
            .iter()
            .map(|layout| {
                let mut targets = Vec::new();
                for field in &layout.fields {
                    self.reaches(&field.ty, &mut targets);
                }
                targets
            })
            .collect();

        // Reachability from each layout to itself. The layout count is small --
        // one per distinct object shape in the program -- so a search per
        // layout is the right shape of answer rather than a strongly-connected
        // components pass that would need explaining.
        (0..self.layouts.len())
            .map(|start| {
                let mut seen = vec![false; self.layouts.len()];
                let mut stack = edges[start].clone();
                while let Some(next) = stack.pop() {
                    if next == start {
                        return true;
                    }
                    if std::mem::replace(&mut seen[next], true) {
                        continue;
                    }
                    stack.extend(edges[next].iter().copied());
                }
                false
            })
            .collect()
    }

    /// The layouts a type's references can lead to.
    ///
    /// An unknown target is recorded as an edge to every layout, so the
    /// conservative answer falls out of the same search rather than needing a
    /// rule of its own: whoever holds it can reach itself, and is cyclic.
    fn reaches(&self, ty: &HirType, into: &mut Vec<usize>) {
        match ty {
            HirType::Managed(ManagedType::Object(id)) => {
                match self.layouts.iter().position(|l| l.types.contains(id)) {
                    Some(at) => into.push(at),
                    // A type with no layout here could be anything, including
                    // something that leads back. Every layout is a possible
                    // target, which makes whoever holds it cyclic.
                    None => into.extend(0..self.layouts.len()),
                }
            }
            // Through an array, which is a reference like any other.
            HirType::Managed(ManagedType::Array(element)) => self.reaches(element, into),
            _ => {}
        }
    }

    /// The layout of an object type.
    #[must_use]
    pub fn layout(&self, ty: TypeId) -> Option<&Layout> {
        self.layouts
            .iter()
            .find(|layout| layout.types.contains(&ty))
    }
}

/// The values an operation reads.
///
/// Exposed because a backend needs the same answer the verifier does, and two
/// implementations of "what does this operation read" would eventually disagree
/// about a newly added operation — in whichever direction was not tested.
#[must_use]
pub fn operands_of(kind: &OpKind) -> Vec<ValueId> {
    verify::operands(kind)
}

/// Whether an array's allocated length is still its length.
///
/// `[1, 2, 3].length` is 3, and that is what lets an index into a literal be
/// proven in bounds by the interval domain alone. It stops being true the moment
/// something can `push`: the array object does not move, so every reference to
/// it stays valid and every one of them sees a longer array.
///
/// The rule is deliberately blunt -- an array that is handed to *anything* loses
/// the claim, because what a callee does with it is not visible here. An array
/// literal that is only indexed keeps it, which is the case the claim exists for.
#[must_use]
pub fn allocated_length_is_exact(func: &Func, array: ValueId, growable: bool) -> bool {
    if !matches!(func.values[array.0 as usize].kind, OpKind::ArrayNew { .. }) {
        return false;
    }
    if !growable {
        // Nothing in the program can change an array's length, so handing this
        // one to a call cannot either. Worth asking, because *every* array a
        // program does anything with is passed somewhere -- `fill` it, hand it
        // to the method that reads it -- and the test below then refuses them
        // all.
        return true;
    }
    !func
        .values
        .iter()
        .any(|op| matches!(&op.kind, OpKind::Call { args, .. } if args.contains(&array)))
}

/// Whether any array in this program can change length.
///
/// Only two operations do, and a program that calls neither has arrays whose
/// length is decided where they are allocated and true forever after. That is a
/// coarse question to ask about a whole program, and it is asked that way on
/// purpose: the precise version is a may-grow fixpoint over parameters and
/// fields, and this answers "no" for every program that never pushes -- which
/// is most of them, and all of Are We Fast Yet.
#[must_use]
pub fn arrays_can_grow(program: &Program) -> bool {
    program.funcs.iter().any(|func| {
        func.values.iter().any(|op| {
            matches!(
                &op.kind,
                OpKind::Call { callee: Callee::External(name), .. }
                    if name == "nts_array_push" || name == "nts_array_pop"
            )
        })
    })
}

/// The values a terminator reads.
#[must_use]
pub fn operands_of_terminator(terminator: &Terminator) -> Vec<ValueId> {
    verify::terminator_operands(terminator)
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
    /// Bounds checks the range analysis proved unnecessary.
    pub checks_removed: usize,
    /// Bounds checks that remain.
    pub checks_kept: usize,
    /// Functions dropped because nothing reachable from an export calls them.
    pub pruned: usize,
    /// Retains and releases inserted, if the provider counts references.
    pub counting: rc::Report,
    /// Allocations that stayed in the frame instead of reaching the allocator.
    pub framed: usize,
    /// Operations that turned out to return one of their own operands.
    pub simplified: usize,
    /// Functions cloned for the closure they are called with.
    pub cloned: usize,
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
    prepare_with(snapshot, &Options::default())
}

/// Which memory discipline the emitted code follows.
///
/// RFC §9 and the amendment to §10.2: this is a property of the *provider*, not
/// of the backend, and it decides what the compiler emits — not only what the
/// runtime does with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Provider {
    /// RFC §9.1. Allocate and never free. No retains, no releases, no barriers.
    /// For bring-up, allocation testing and bounded-lifetime tools; never a
    /// silent default for an application.
    #[default]
    NoGc,
    /// RFC §9.2. Reference counting, without the cycle collector yet — so a
    /// cycle is still a leak, which is the shape of leak this provider has.
    ReferenceCounting,
}

/// What to compile, and how.
#[derive(Debug, Clone, Copy)]
pub struct Options<'a> {
    /// The memory discipline. See [`Provider`].
    pub provider: Provider,
    /// Whether to prove numbers into integers. Off is not a supported way to
    /// build anything — it is how the benchmarks measure what the analysis is
    /// worth, by compiling one program both ways.
    pub specialize_numbers: bool,
    /// Where reachability starts. See [`reachable::Roots`]: an executable and a
    /// library have different public surfaces, so they keep different things.
    pub roots: reachable::Roots<'a>,
}

impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            provider: Provider::NoGc,
            specialize_numbers: true,
            // The safe choice when the product is unknown: a library may have
            // any export called from outside. An executable keeps more than it
            // needs until it says what it is.
            roots: reachable::Roots::EveryExport,
        }
    }
}

/// As [`prepare`], with specialization optional.
///
/// Turning it off is not a supported way to build anything — it is how the
/// benchmarks measure what specialization is worth, by compiling one program
/// both ways and running both.
///
/// # Errors
///
/// As [`prepare`].
pub fn prepare_with(
    snapshot: &SemanticSnapshot,
    options: &Options<'_>,
) -> Result<Prepared, Vec<verify::Invalid>> {
    let prepared = prepare_unverified(snapshot, options);
    verify::verify(&prepared.program)?;
    Ok(prepared)
}

/// Everything `prepare_with` does, without the final check that it worked.
///
/// Exists so that an invalid program can be *read*. A verifier that returns only
/// a list of complaints is a poor debugging tool, because the thing worth
/// looking at is the program the complaints are about. Nothing that emits code
/// should call this.
#[must_use]
pub fn prepare_unverified(snapshot: &SemanticSnapshot, options: &Options<'_>) -> Prepared {
    let specialize_numbers = options.specialize_numbers;
    let lowered = lower::lower(snapshot);
    let mut program = lowered.program;

    // First, before anything expensive. Everything that survives here gets
    // analyzed interprocedurally, specialized, proven and emitted, and a
    // function nothing can call should pay for none of that.
    let pruned = reachable::prune(&mut program, options.roots);

    // Before any analysis, because a clone's parameter is a different type and
    // everything downstream should see it that way -- and because the dispatch
    // it turns into a direct call is a call the interprocedural analysis can
    // then follow.
    let cloned = monomorphize::monomorphize(&mut program);
    // Again, because a function every caller now reaches through a clone is a
    // function nothing calls -- and one that still contains the dispatch the
    // clone exists to avoid.
    let pruned = pruned + reachable::prune(&mut program, options.roots);

    let mut specialized = 0;
    let mut conversions = 0;
    let mut checks_removed = 0;

    if specialize_numbers {
        // Analyzed as a program rather than a function at a time: a parameter is
        // written by callers and a call's result by the callee, and neither is
        // visible from inside.
        let analyses = interprocedural::analyze_program(&program, options.roots);
        for (func, analysis) in program.funcs.iter_mut().zip(&analyses) {
            // Folding first, because a folded constant is a smaller thing to
            // specialize and because a coercion of a known value should never
            // reach the backend as a call.
            fold::fold(func, analysis);
        }

        // Re-analyzed, since folding changed what the operations are — and a
        // folded return value is a sharper fact for every caller.
        let analyses = interprocedural::analyze_program(&program, options.roots);

        // Bounds first, because proving an access safe *sharpens the facts*
        // rather than merely removing a test. A `charCodeAt` that might be out
        // of range might be NaN, and a NaN cannot be an integer -- so a scan by
        // code unit stayed floating point until this ran, and running it after
        // specialization was too late to matter. It runs again at the end, for
        // what specialization itself sharpens.
        let field_lengths = fields::lengths(&program, &analyses);
        for (func, analysis) in program.funcs.iter_mut().zip(&analyses) {
            checks_removed += bounds::eliminate_checks(func, analysis, &field_lengths);
        }

        // A field's *storage* before the bodies that read it. `number` is a
        // double, but a field every store puts a small whole number into holds
        // one every time -- and an `int32` member is half the object and
        // integer arithmetic on the other side of the load.
        let analyses = interprocedural::analyze_program(&program, options.roots);
        let narrowed = fields::representations(&program, &analyses);
        fields::narrow(&mut program, &narrowed);

        // Signatures before bodies. A parameter narrowed to an integer changes
        // what its body can prove about everything derived from it, and every
        // caller converts to the narrower type rather than widening back.
        let outward: rustc_hash::FxHashSet<String> = reachable::root_names(&program, options.roots)
            .into_iter()
            .map(str::to_owned)
            .collect();
        // A root's arguments are unknowable, but almost every one of them is a
        // whole number. One test at the boundary makes that a fact the analysis
        // below can use, at the cost of a copy of the body.
        guards::install(&mut program, &outward);

        let analyses = interprocedural::analyze_program(&program, options.roots);
        signatures::specialize(&mut program, &analyses, &outward);
        // A test that bought nothing is a test and a copy for nothing. Whether
        // it bought anything is only knowable now.
        if guards::retract(&mut program) > 0 {
            reachable::prune(&mut program, options.roots);
        }
        let expected = signatures::expected(&program);

        let analyses = interprocedural::analyze_program(&program, options.roots);
        for (func, analysis) in program.funcs.iter_mut().zip(&analyses) {
            let report = specialize::specialize(func, analysis, &expected);
            specialized += report.specialized;
            conversions += report.conversions;
        }
    }

    // Identities become visible only once specialization has decided
    // representations: `x | 0` is a coercion until `x` is known to be an `i32`,
    // and then it is nothing. Removing them here keeps every pass below from
    // tracking values that are copies of other values.
    let mut simplified = 0;
    for func in &mut program.funcs {
        simplified += simplify::simplify(func);
    }

    // Specialization orphans values by design — a folded constant leaves its
    // unfolded original with no readers — and the C emitter declares a local for
    // everything it assigns.
    for func in &mut program.funcs {
        dce::eliminate(func);
    }

    // Escape analysis before reference counting, because an object that stays
    // in the frame should not be counted at all -- and after dead-code
    // elimination, because an allocation nothing reads is not evidence of
    // anything.
    let framed = place_allocations(&mut program);

    // Reference counting, after everything that could move or remove an
    // operation: a retain inserted before dead-code elimination would keep
    // alive exactly what that pass was about to drop.
    let counting = if options.provider == Provider::ReferenceCounting {
        rc::insert(&mut program)
    } else {
        rc::Report::default()
    };

    // Bounds checks last, once the facts are as sharp as they are going to get:
    // a check is removed only where the index was proven, and specialization
    // and folding are what sharpen the index.
    if specialize_numbers {
        let analyses = interprocedural::analyze_program(&program, options.roots);
        let field_lengths = fields::lengths(&program, &analyses);
        for (func, analysis) in program.funcs.iter_mut().zip(&analyses) {
            checks_removed += bounds::eliminate_checks(func, analysis, &field_lengths);
        }
    }
    let checks_kept = program
        .funcs
        .iter()
        .flat_map(|func| &func.values)
        .filter(|op| {
            matches!(
                op.kind,
                OpKind::ArrayGet { checked: true, .. } | OpKind::ArraySet { checked: true, .. }
            )
        })
        .count();

    Prepared {
        cloned,
        program,
        diagnostics: lowered.diagnostics,
        specialized,
        conversions,
        checks_removed,
        checks_kept,
        pruned,
        counting,
        framed,
        simplified,
    }
}

/// Move every allocation that can be in the frame into it.
///
/// Returns how many moved, which is worth reporting: it is the difference
/// between a loop that calls the allocator and one that does not, and on the
/// `objects` benchmark it is the entire gap to hand-written C.
fn place_allocations(program: &mut Program) -> usize {
    let escapes = escape::analyze_program(program);
    let mut framed = 0;

    for (func, escapes) in program.funcs.iter_mut().zip(&escapes) {
        for index in 0..func.values.len() {
            let value = ValueId(u32::try_from(index).unwrap_or(0));
            if !escapes.is_frame_local(value) {
                continue;
            }
            if matches!(func.values[index].kind, OpKind::ObjectNew { frame: false }) {
                func.values[index].kind = OpKind::ObjectNew { frame: true };
                framed += 1;
            } else if let Some(units) = frame_capacity(func, value)
                && let OpKind::Call { frame, .. } = &mut func.values[index].kind
            {
                *frame = Some(units);
                framed += 1;
            }
        }
    }
    framed
}

/// Frame storage for a fresh string, where one is worth having.
///
/// An object's size is its type's, so keeping one in the frame needs no number.
/// A string's is not, and nothing at the allocation site says what it will be —
/// which is why this needs [`flow::string_span`], and why a *tokenizer* is the
/// program that gains: it makes strings whose length is written down nowhere.
///
/// The caller has already established the other half, that the reference does
/// not outlive the frame. Both are required and neither implies the other.
fn frame_capacity(func: &Func, value: ValueId) -> Option<u32> {
    /// Code units a frame string may hold.
    ///
    /// Storage is per allocation *site*, so a function with several pays for all
    /// of them for its whole call — and a deep recursion pays again per level.
    /// Past this the heap is the right answer, and a long slice is one where the
    /// allocation is a smaller share of the copy anyway.
    const LIMIT: u32 = 128;

    let OpKind::Call {
        callee: Callee::External(name),
        ..
    } = &func.values[value.0 as usize].kind
    else {
        return None;
    };
    // The helpers with an `_into` form: each returns a *fresh* string, so
    // nothing else can hold the one this builds.
    if !matches!(
        name.as_str(),
        "nts_str_substring" | "nts_str_slice" | "nts_str_char_at" | "nts_concat"
    ) {
        return None;
    }
    let span = flow::string_span(func, value, 0)?;
    if !(span.hi >= 0.0 && span.hi <= f64::from(LIMIT)) {
        return None;
    }
    // Exact: the test above put it inside `0..=LIMIT`, and every whole number
    // there is representable in both.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    Some(span.hi as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout(name: &str, id: u32, fields: Vec<Field>) -> Layout {
        Layout {
            types: vec![TypeId(id)],
            name: name.to_owned(),
            fields,
            methods: Vec::new(),
        }
    }

    fn field(name: &str, ty: HirType) -> Field {
        Field {
            name: name.to_owned(),
            ty,
            readonly: false,
        }
    }

    fn object(id: u32) -> HirType {
        HirType::Managed(ManagedType::Object(TypeId(id)))
    }

    fn origin() -> nts_semantic_schema::Origin {
        nts_semantic_schema::Origin::source(nts_diagnostics::Location {
            file: nts_diagnostics::SourceId(0),
            span: nts_diagnostics::Span::new(0, 1),
        })
    }

    /// One `new Array(4)`, indexed, and handed to a call. Whether its length is
    /// still four where it is read depends on nothing local — only on whether
    /// anything in the *program* can change one.
    fn allocating(pushes: bool) -> Program {
        let numbers = HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER)));
        let mut values = vec![
            Op {
                kind: OpKind::ConstFloat(4.0),
                ty: HirType::NUMBER,
                origin: origin(),
            },
            Op {
                kind: OpKind::ArrayNew {
                    length: ValueId(0),
                },
                ty: numbers.clone(),
                origin: origin(),
            },
            Op {
                kind: OpKind::Call {
                    callee: Callee::External("nts_array_fill".to_owned()),
                    args: vec![ValueId(1)],
                    frame: None,
                },
                ty: numbers,
                origin: origin(),
            },
        ];
        if pushes {
            values.push(Op {
                kind: OpKind::Call {
                    callee: Callee::External("nts_array_push".to_owned()),
                    args: vec![ValueId(1), ValueId(0)],
                    frame: None,
                },
                ty: HirType::NUMBER,
                origin: origin(),
            });
        }
        let ops = (0..values.len())
            .map(|index| ValueId(u32::try_from(index).unwrap_or(0)))
            .collect();
        Program {
            funcs: vec![Func {
                name: "f".to_owned(),
                params: Vec::new(),
                return_type: HirType::Void,
                values,
                blocks: vec![Block {
                    params: Vec::new(),
                    ops,
                    terminator: Terminator::Return(None),
                }],
                origin: origin(),
                exported: true,
                initializes_receiver: false,
            }],
            globals: Vec::new(),
            layouts: Vec::new(),
        }
    }

    /// The condition that lets a bounds check be removed on an array the
    /// function passed to something. Getting this wrong removes a check that
    /// can fail, so it is pinned from both sides.
    #[test]
    fn an_allocated_length_is_exact_only_while_nothing_can_grow_an_array() {
        let quiet = allocating(false);
        assert!(!arrays_can_grow(&quiet));
        assert!(allocated_length_is_exact(&quiet.funcs[0], ValueId(1), false));

        // The same function, in a program that pushes somewhere. `fill` cannot
        // grow it and `push` can, and this does not distinguish them — passing
        // the array anywhere is now enough to lose the length.
        let growing = allocating(true);
        assert!(arrays_can_grow(&growing));
        assert!(!allocated_length_is_exact(&growing.funcs[0], ValueId(1), true));
    }

    #[test]
    fn only_types_that_can_lead_back_to_themselves_can_be_in_a_cycle() {
        // The question a cycle collector has to ask about every object, answered
        // once per type instead. `Wrapper` holds a reference and still cannot be
        // in a cycle, which is the case that matters: it is the common one.
        let program = Program {
            funcs: Vec::new(),
            globals: Vec::new(),
            layouts: vec![
                // 0: Node { next: Node } -- a cycle in one line.
                layout("Node", 1, vec![field("next", object(1))]),
                // 1: Leaf { value: number }
                layout("Leaf", 2, vec![field("value", HirType::NUMBER)]),
                // 2: Wrapper { inner: Leaf }
                layout("Wrapper", 3, vec![field("inner", object(2))]),
                // 3: Left { right: Right } and 4: Right { left: Left }
                layout("Left", 4, vec![field("right", object(5))]),
                layout("Right", 5, vec![field("left", object(4))]),
                // 5: Tree { children: Tree[] } -- through an array.
                layout(
                    "Tree",
                    6,
                    vec![field(
                        "children",
                        HirType::Managed(ManagedType::Array(Box::new(object(6)))),
                    )],
                ),
            ],
        };

        assert_eq!(
            program.cyclic_layouts(),
            vec![true, false, false, true, true, true],
        );
    }

    #[test]
    fn a_field_of_unknown_layout_is_assumed_to_lead_anywhere() {
        // Unknown has to mean yes. A type this program has no layout for could
        // lead back, and a collector that skipped the object on that basis would
        // skip a cycle.
        let program = Program {
            funcs: Vec::new(),
            globals: Vec::new(),
            layouts: vec![layout("Holder", 1, vec![field("other", object(99))])],
        };
        assert_eq!(program.cyclic_layouts(), vec![true]);
    }

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

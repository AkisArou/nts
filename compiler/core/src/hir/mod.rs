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
pub mod builtin;
pub mod dce;
pub mod elements;
pub mod escape;
pub mod facts;
pub mod fields;
pub mod globals;
pub mod flow;
pub mod fold;
pub mod generics;
pub mod guards;
pub mod interprocedural;
pub mod liveness;
pub mod loops;
pub mod suspend;
pub mod tags;
pub mod unerase;

pub mod lower;
pub mod inline;
pub mod monomorphize;
pub mod narrow;
/// Who owns what, and for how long: one answer per value, which the counting
/// pass reads and does no reasoning of its own about.
pub mod own;
pub mod rc;
pub mod runtime;
pub mod reachable;
pub mod signatures;
pub mod simplify;
pub mod split;
pub mod substring;
pub mod specialize;
pub mod verify;
pub mod zero_sign;

use nts_semantic_schema::{Origin, SemanticSnapshot, TypeId};

/// Re-exported because it is already part of this module's surface -- a
/// [`Layout`]'s `types` and an [`OpKind::InstanceOf`]'s `classes` are both made
/// of these -- and a backend that has to read one needs to be able to name it.
pub use nts_semantic_schema::TypeId as ClassId;

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
    /// An exact integer with no upper bound in the language, and 128 bits here.
    ///
    /// # Why it is not `Int { bits: 128 }`
    ///
    /// It was, for an afternoon, and the differential took it apart. A `bigint`
    /// is not a number that happens to be integral: `1n << 40n` is 2^40 where
    /// `1 << 40` is 256, because a *number*'s shift masks its count to five bits
    /// and truncates its operands to int32. Constant folding, `**`, and the
    /// specializer all know the number rules, and every one of them applied
    /// itself to a `bigint` the moment it wore an integer's type -- silently,
    /// and correctly by their own lights.
    ///
    /// A type of its own turns each of those into a compile error at the match
    /// that has to decide, which is the only way a second numeric semantics
    /// arrives without a search for every pass that assumed the first.
    ///
    /// TypeScript refuses to mix the two at all, so nothing here has to guard
    /// against a `double` reaching a `bigint` operator: the checker did it.
    BigInt,
    /// A value carrying its own type, where the static type does not decide one.
    ///
    /// Two source constructs reach here. `unknown` is the open case -- the tag
    /// may be any of them. A heterogeneous union is the *closed* case:
    /// `number | string` is the same value with the tag restricted to two, and
    /// `number | undefined` is why a union needs a tag at all, since a double
    /// has no spare bit pattern to be absent in the way a pointer has null.
    ///
    /// Still called `Erased` for both, and accurately: in either case the
    /// *specific* type is erased at compile time and recovered from the tag.
    ///
    /// One machine value that can hold anything reachable, together with a tag
    /// saying what it currently holds. `TypeKind::Any` deliberately does *not*
    /// map here: `docs/any-unknown.md` forbids an `any` from reaching HIR at
    /// all, because it is the checker announcing it has stopped providing
    /// safety, and giving it a representation would accept the escape hatch
    /// that rule exists to close.
    ///
    /// The *layout* is the backend's, not this type's. A tagged struct and a
    /// NaN-boxed word are the same three operations at different sizes, and
    /// naming a layout here would make changing it a refactor of every pass
    /// rather than of one emitter.
    Erased,
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
    /// A promise, carrying the representation of what it settles with.
    ///
    /// The payload type is here for the *compiler*: it is what says which
    /// `nts_promise_fulfill_*` to emit and how to read the value back out. The
    /// runtime layout does not vary with it -- there is one `NtsPromise` with a
    /// tagged union, so this is not a monomorphization.
    ///
    /// A distinct managed type rather than a provided class in the manner of
    /// `hir::builtin`'s `Error`, which was the alternative. A provided class
    /// would have reused the object machinery, and would have been a shape that
    /// lies about itself: its C type is a fixed runtime struct rather than a
    /// generated one, and it would have had a "layout" with no field anyone may
    /// read.
    Promise(Box<HirType>),
    /// A `Map`, carrying what its keys and values represent as.
    ///
    /// Here for the compiler, not for the runtime, in the same way
    /// [`ManagedType::Promise`]'s payload is: there is one `NtsMap` and it
    /// stores `NtsValue`s, so the layout does not vary with either. What they
    /// decide is which hash and comparison the table is built with -- a
    /// `Map<string, V>` compares strings and never reads a tag -- and what a
    /// `get` hands back. So this is not a monomorphization.
    ///
    /// A distinct managed type rather than an object with a provided layout,
    /// for the reason written above `Promise`: its C type is a fixed runtime
    /// struct rather than a generated one, and giving it a layout would mean a
    /// shape with fields that nothing may read.
    Map(Box<HirType>, Box<HirType>),
    /// A `Set`: the same table, with no values stored at all.
    Set(Box<HirType>),
    /// A date: a millisecond offset from the epoch, and nothing else.
    ///
    /// Carrying nothing, for the reason [`ManagedType::Symbol`] carries
    /// nothing: a `Date` has no element type and no layout that varies. The
    /// specification calls its contents a *time value* and defines every
    /// accessor as arithmetic on it, so the object is a header and a double.
    ///
    /// A distinct managed type rather than a provided class, on the standard
    /// this enum already applies: its C type is a fixed runtime struct rather
    /// than a generated one, so a layout for it would have a field nothing may
    /// read.
    Date,
    /// A symbol: an interned cell whose **address is its identity**.
    ///
    /// Carrying nothing, because there is nothing to carry. A symbol has no
    /// element type, no payload representation and no layout that varies —
    /// every symbol is one `NtsSymbol`, and the description it holds is for
    /// printing and takes no part in what a symbol *is*.
    ///
    /// A distinct managed type for the reason [`ManagedType::Promise`] gives:
    /// its C type is a fixed runtime struct rather than a generated one, so an
    /// object with a provided layout would be a shape with fields nothing may
    /// read. Unlike `Promise` and `Map` it is not even parameterised, which
    /// makes it the simplest member of this enum and the one whose whole
    /// content is its tag.
    Symbol,
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

    /// Whether a value of this type can hold a reference the collector must see.
    ///
    /// A separate question from [`Self::is_managed`], which is asked in at
    /// least three different senses across this compiler -- "is this a pointer
    /// to cast", "does this need reference counting", "is this field a
    /// reference". An erased value answers *yes* to the last two and *no* to
    /// the first: it is sixteen bytes that may or may not contain a pointer,
    /// depending on a tag only the runtime reads. Widening `is_managed` would
    /// have made the emitter try to cast one.
    #[must_use]
    pub const fn may_hold_a_reference(&self) -> bool {
        matches!(self, Self::Managed(_) | Self::Erased)
    }

    /// Whether a slot of this type holds a *pointer* a collector can follow.
    ///
    /// [`Self::may_hold_a_reference`] is the wider question, and the two are
    /// not interchangeable where a descriptor is built. A descriptor carries
    /// two tables: `offsets`, whose slots are read as `NtsHeader *`, and
    /// `erased_offsets`, whose slots are read as `NtsValue`. An erased slot
    /// answers *yes* to the wider question and belongs only in the second --
    /// put in both, it is read both ways, and reading a tagged value as a
    /// pointer is a segfault inside the collector's own walk.
    ///
    /// That is not hypothetical: `{ name?: string }` released under counting
    /// crashed in `nts_release`, reached through `nts_each_reference` from
    /// `nts_destroy`, on both backends and for this reason.
    #[must_use]
    pub fn holds_a_pointer(&self) -> bool {
        matches!(self, Self::Managed(_))
    }

    /// Whether this type fits in a machine register.
    #[must_use]
    pub const fn is_scalar(&self) -> bool {
        matches!(self, Self::Bool | Self::Int { .. } | Self::Float { .. })
    }

    /// Whether a module-scope variable may hold this.
    ///
    /// Scalars, and an erased value. `docs/any-unknown.md` lists module state
    /// among the places `unknown` may appear and says the compiler "must not
    /// reject `unknown` merely because it requires an erased representation" --
    /// and a global of erased type is representable: it starts as `undefined`
    /// and `module#init` assigns the rest, which is already where every
    /// non-constant module-scope initializer runs.
    ///
    /// Separate from [`Self::is_scalar`] rather than widening it, because the
    /// two questions differ. An erased value is not a scalar: it is sixteen
    /// bytes that may hold a reference, and the places that ask whether
    /// something fits in a register still need the narrower answer.
    #[must_use]
    pub const fn can_be_global(&self) -> bool {
        self.is_scalar() || self.may_hold_a_reference()
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
    /// An `abstract` method: a signature the program declares and no body.
    ///
    /// It is in `funcs` because a call through the slot takes its
    /// function-pointer type from here — refusing the declaration left the
    /// *caller* undeliverable with "no declaration for `Shape#area` to take a
    /// signature from". Nothing calls it and no vtable names it: an abstract
    /// class is never instantiated, so every reachable receiver is a subclass
    /// whose override filled the slot.
    ///
    /// So a backend must **not** emit a body for one. The C backend emitted the
    /// `__builtin_unreachable()` stub and clang refused the translation unit
    /// under `-Werror`: `unused function 'Shape__area'`, found by
    /// `benches/cases/upcast`, whose build is the only one that turns warnings
    /// into errors. The JVM's answer is `ACC_ABSTRACT` with no `Code`
    /// attribute, which is the same statement in that file format.
    pub abstract_declaration: bool,
    /// The promise an `async` function settles, where this is one.
    ///
    /// Recorded by the lowering rather than rediscovered: [`super::suspend`]
    /// has to know which value is the result so it can put it in the frame, and
    /// looking for "the `nts_promise_new` in the entry block" would be a
    /// pattern match on the shape of code the lowering happens to emit.
    pub async_result: Option<ValueId>,
    /// The frame type reserved for this function, where it is a **generator**.
    ///
    /// An `async` function's frame is named by [`super::suspend`] from the
    /// function's index in `funcs`, and nothing outside that pass ever says the
    /// name. A generator's has to be said twice: once by the pass that builds
    /// it, and once by the `for...of` that walks one, which is lowered long
    /// before the pass runs and cannot predict an index that refusals will
    /// shift. So the lowering reserves it and both sides read it from here.
    pub frame: Option<GeneratorFrame>,
}

/// What a generator's frame is, said once so that two passes agree about it.
///
/// Reserved by the lowering. [`suspend`] builds the layout from it and the
/// `for...of` that walks the generator reads its element from it, and if those
/// two disagreed the load would be typed one way and the store the other --
/// which is a wrong answer rather than an error, because both are field
/// accesses on the same object at the same offset.
#[derive(Debug, Clone, PartialEq)]
pub struct GeneratorFrame {
    /// The synthetic type id, from [`generator_frame`].
    pub ty: TypeId,
    /// What `yield` produces, at the representation the field holds.
    pub yields: HirType,
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
    ///
    /// A claim it can *back*: after a `throw`, and on the default arm of a
    /// resumed generator's state dispatch, control genuinely does not arrive.
    /// Where the lowering merely has nothing to say, see [`Self::FellThrough`].
    Unreachable,
    /// Control fell out of the end of a function that owes a value.
    ///
    /// Not a claim — an absence. The lowering reached the end of a body with
    /// nothing to return, and unlike [`Self::Unreachable`] it has no reason of
    /// its own to believe the block is dead.
    ///
    /// It is sound exactly when the block *is* unreachable, which TypeScript
    /// guarantees for a body it accepted: `while (true) { }` is the shape that
    /// reaches here legally, and folding the constant condition makes the block
    /// dead. So the two are separated here rather than checked by a heuristic
    /// on shape: a reachable `Unreachable` is legitimate and a reachable
    /// `FellThrough` is not, and nothing about the block itself tells them
    /// apart.
    ///
    /// If one survives to the verifier still reachable, the function's *return
    /// type* is wrong. That mattered once already: `set ["size"](n: number)`
    /// read its own name as a return annotation, came out returning `f64` from
    /// a body that returns nothing, and the emitter rendered the fall-through
    /// as `__builtin_unreachable()` — a store followed by a licence for the C
    /// compiler to compute anything at all in the caller. It compiled, every
    /// test passed, and the answer was wrong by a constant.
    FellThrough,
}

impl Terminator {
    /// Blocks this one can transfer control to.
    #[must_use]
    pub fn successors(&self) -> Vec<BlockId> {
        match self {
            Self::Return(_) | Self::Unreachable | Self::FellThrough => Vec::new(),
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
    /// What the declaration said, beyond the type.
    ///
    /// The type does not carry it: `...args: number[]` and `args: number[]` are
    /// the same `Managed(Array(f64))`, and `x?: number` and `x: number = 1` are
    /// both an `f64` slot the callee always has. TypeScript distinguishes all
    /// three and this used to drop the distinction -- which is a precision loss
    /// of the kind `docs/conformance/typescript.md` §16 exists to record, and
    /// `lower_param` was computing both halves of it and throwing them away.
    ///
    /// Nothing is emitted for it: a parameter is a parameter in every backend
    /// whatever its shape, and the work a rest or a default implies happens at
    /// the *call* -- `lower_arguments` gathers the array and evaluates the
    /// default, which is where JavaScript does. So this is a note on the
    /// declaration and costs one discriminant on a struct that already carries
    /// a `String`, an `Origin` and a `Facts`.
    pub shape: ParamShape,
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

/// What a parameter's declaration said, beyond its type.
///
/// [`Self::Optional`] and [`Self::Defaulted`] are *not* the same case, and the
/// difference is observable. An omitted optional parameter is `undefined`
/// inside the callee, which a caller can pass; an omitted defaulted one is
/// never observable at all, because the *caller* evaluates the initializer --
/// `lower_arguments` does it at every call site, which is where JavaScript
/// evaluates it. So a boundary that is not a compiled call site can supply the
/// first and cannot supply the second.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ParamShape {
    /// A declared parameter, present at every call.
    #[default]
    Ordinary,
    /// `...args: T[]`. An ordinary parameter of array type as far as the callee
    /// is concerned; the array is gathered by the call.
    Rest,
    /// `x?: T`, with no initializer. Absent means `undefined`, which is a *tag*
    /// rather than a zero -- so a caller supplying `0` is wrong rather than
    /// imprecise.
    Optional,
    /// `x: T = expr`. The initializer is evaluated by each caller that omits
    /// the argument, so the callee's parameter is ordinary and always present.
    Defaulted,
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
    /// An exact integer of any width this compiler has.
    ///
    /// `i128` rather than `i64` because `bigint` is one of them, and the
    /// largest value the node profile writes is `0xffffffffffffffffn` -- 2^64-1,
    /// which is not an `i64`. Every narrower width still fits, so nothing that
    /// used this before had to change.
    ConstInt(i128),
    ConstFloat(f64),
    ConstBool(bool),
    ConstString(String),
    /// A concrete value becomes an erased one, tagged with what it was.
    ///
    /// The tag is not stored here: it is a function of the operand's type,
    /// which every pass already has. Storing it would create a second answer
    /// to one question and a way for the two to disagree.
    Erase {
        value: ValueId,
    },
    /// The tag an erased value currently carries.
    ///
    /// `typeof` on an erased value is exactly this, which is why
    /// [`crate::hir::HirType::Erased`]'s tags are spelled as `typeof`'s
    /// answers.
    TagOf {
        value: ValueId,
    },
    /// An erased value becomes a concrete one, at the type the checker
    /// narrowed it to.
    ///
    /// Unchecked by construction: it is emitted only where narrowing licensed
    /// it, and the tag was tested on the path that reaches it. That is the one
    /// place in this feature where being wrong is silent rather than loud, so
    /// it is emitted from one function and nowhere else.
    Unerase {
        value: ValueId,
    },
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
        /// Whether the elements have to be zeroed.
        ///
        /// They do for anything the *source* can observe before writing, because
        /// there is no `undefined` in a double and so a hole has no
        /// representation to leave behind. `new Array(n)` is that case.
        ///
        /// `false` only where this lowering fills every slot itself before the
        /// array can be read, which today is `map` alone: its loop runs from 0
        /// to the length it allocated, `deliver` stores on every path through
        /// the body, and there is no early exit. Worth 7% on `pipeline`, which
        /// it takes to parity with hand-written C++ -- and worth being narrow
        /// about, because the failure mode is reading uninitialized memory
        /// rather than reading a zero.
        zeroed: bool,
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
    /// `null`.
    ///
    /// A reference has a value that is not an object, so `T | null` needs no
    /// tag beside it -- the null pointer *is* the tag. The op's type is the
    /// managed type the absence stands in for, because a null `NtsString *` and
    /// a null `NtsObj_Point *` are different types to C even though they are
    /// the same address.
    ///
    /// Separate from [`OpKind::ConstUndefined`] because `null === undefined` is
    /// **false**, and a program can observe the difference. They were one op
    /// once, and the compiler answered that comparison with `true`.
    ///
    /// A pointer has room for only one of the two, which is why a union
    /// carrying both is represented as [`HirType::Erased`] instead -- see the
    /// union arm of the representation decision. So when this op's type *is* a
    /// pointer, it and `ConstUndefined` emit the same thing and cannot be
    /// confused; when it is erased, they carry different tags.
    ConstNull,
    /// `undefined`, and `void`'s value.
    ///
    /// See [`OpKind::ConstNull`] for why the two are separate.
    ConstUndefined,
    ObjectNew {
        frame: bool,
    },
    /// Stop if a cell is read before its declaration filled it.
    ///
    /// Only on a cell for a name declared *below* the closure that reads it,
    /// and only on reads inside a closure body -- TypeScript rejects a direct
    /// use before declaration in the same scope, so a closure is the only way
    /// into that window.
    ///
    /// JavaScript throws a `ReferenceError` there. This compiler has a `throw`
    /// now, but not one the *runtime* can raise: a handler is a block and a
    /// `throw` is a jump the lowering emits, so nothing below the lowering can
    /// reach one. So this stops the program with the name rather than answering
    /// with the zero the cell still holds. One predictable branch, on the cells
    /// that have the window and no others.
    CellReady {
        cell: ValueId,
        /// The variable's name, for the message. Compile-time text: the check
        /// costs a load and a branch, and the string is only touched on the
        /// path that ends the program.
        name: String,
    },
    /// The one instance of a closure that stands for a named function.
    ///
    /// `nextTick(finish, stream)` needs `finish` as a value, and JavaScript's
    /// answer is a function object. This compiler's is a closure with no
    /// captures whose `call` forwards to `finish` -- and because it captures
    /// nothing there is nothing to distinguish two of them, so there is one,
    /// static and immortal. That is not only an optimization: `finish ===
    /// finish` has to be true, and an event emitter removing a listener finds
    /// it by exactly that comparison.
    ///
    /// Deliberately *not* used for a non-capturing arrow. `(() => 1) === (() =>
    /// 1)` is false in JavaScript -- two evaluations make two objects -- so
    /// folding those to one instance would answer a comparison wrongly.
    ///
    /// The type says which closure class, the way [`OpKind::ObjectNew`]'s does.
    ClosureStatic,
    /// `x instanceof C`, answered by the object's own class.
    ///
    /// The set of classes that satisfy it is **closed at compile time**: `C`
    /// and everything that extends it, which the hierarchy already knows. A
    /// compiled program cannot gain a subclass after it is built, so there is
    /// no chain to walk and no prototype to consult -- the test is a comparison
    /// against a handful of descriptor pointers, and usually against one.
    ///
    /// The operand may be erased, in which case its tag has to say it is a
    /// reference before its class can be asked for. The lowering emits that
    /// test; this operation assumes it.
    InstanceOf {
        value: ValueId,
        /// `C` and its subclasses, in a stable order so two runs of one
        /// compiler on one input emit the same program.
        classes: Vec<TypeId>,
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
    /// `await p`: suspend until `p` settles, and produce what it settled with.
    ///
    /// An operation rather than a call, because it is neither. A call returns to
    /// its caller; this one *returns to the event loop* and comes back later, in
    /// a different C function, with the locals it needs restored from a heap
    /// frame. No runtime helper can do that on a function's behalf -- the
    /// transformation is of the function itself.
    ///
    /// It survives only as far as [`super::suspend`], which splits the block
    /// here and rewrites the function into a state machine. Nothing downstream
    /// sees one.
    Await {
        promise: ValueId,
    },
    /// `yield v`: hand `v` to whoever is walking this generator, and stop here.
    ///
    /// The mirror of [`OpKind::Await`] and the same transformation: the
    /// function returns and comes back later with its locals restored from a
    /// heap frame. What differs is *who* resumes it. An `await` hands control
    /// to the event loop and is resumed by a subscription; a `yield` hands
    /// control to the **caller**, and is resumed by the caller asking for
    /// another element. So there is no subscription and no promise, and the
    /// suspension is an ordinary `return`.
    ///
    /// Produces nothing. `yield` is an expression in TypeScript -- it evaluates
    /// to whatever is passed to the next `next(v)` -- and that value is refused
    /// by name, because supplying it means the walk has something to say and
    /// `for...of` never does.
    ///
    /// It survives only as far as [`super::suspend`].
    Yield {
        value: ValueId,
    },
    /// Suspend: subscribe `frame` to `promise`, to be resumed by `resume`.
    ///
    /// One operation rather than a function-pointer *value* plus a call. A
    /// function address has no type in this IR -- it is not managed, and
    /// spelling it as a pointer-sized integer would be a lie the backend has to
    /// undo. Naming the callee here also keeps the edge visible: a function
    /// reached only through a pointer inside a runtime structure is one
    /// `hir::reachable` would prune, and the failure would be a link error
    /// rather than a diagnostic.
    ///
    /// Produces nothing. The suspension itself is the `Return` that follows.
    Suspend {
        promise: ValueId,
        frame: ValueId,
        resume: String,
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
    /// What this class extends, where the program declares it.
    ///
    /// `None` for an anonymous type, a closure, a tuple, and for a class with
    /// no `extends` — and also for the four provided error classes, which this
    /// program does not declare and whose relation to `Error` is spelled where
    /// `instanceof` needs it rather than carried here.
    ///
    /// Load-bearing for *merging*. Layouts are structural, so `class B extends
    /// A {}` that adds nothing has A's fields and A's dispatch table and used to
    /// merge into A — one layout, one descriptor, and `b instanceof A` true of
    /// an `A`. Two types that differ only in what they extend are two classes,
    /// and this is what [`Layout::same_shape`] compares to say so.
    ///
    /// A `TypeId` rather than a layout index, because indices move as layouts
    /// merge and a `TypeId` does not. [`Program::base_layout`] resolves it.
    pub base: Option<TypeId>,
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
    pub fn same_shape(
        &self,
        fields: &[Field],
        methods: &[Option<String>],
        base: Option<TypeId>,
    ) -> bool {
        // The base is a parameter rather than a comparison the callers make,
        // so that neither of them can forget it. There are two, they must
        // agree, and "two places that must agree" has cost this project a week.
        self.base == base
            && self.fields.len() == fields.len()
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
            .filter(|field| field.ty.may_hold_a_reference())
            .map(|field| field.name.as_str())
            .collect()
    }

    /// The fields holding a *pointer*, which is the narrower question.
    ///
    /// A descriptor's two tables are built from the two: `offsets` from this
    /// one, whose slots it reads as `NtsHeader *`, and `erased_offsets` from
    /// the erased fields, whose slots it reads as `NtsValue`. See
    /// [`HirType::holds_a_pointer`] for what a slot in both did.
    #[must_use]
    pub fn pointer_fields(&self) -> Vec<&str> {
        self.fields
            .iter()
            .filter(|field| field.ty.holds_a_pointer())
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

/// The synthetic space, in named parts.
///
/// Three kinds of type have no id from the checker and need one of their own: a
/// cell's class, a suspended frame's, and a closure's. They used to be told
/// apart by "closures count down from the top, frames count up from halfway",
/// which holds only while there are fewer than 2^19 of each — and, worse, gives
/// no way to *ask* what kind an id is.
///
/// `typeof` has to ask. A closure answers `"function"` where every other object
/// answers `"object"`, and the three places that decide a tag see a `TypeId`
/// and no program to look it up in. So the space is partitioned rather than
/// merely arranged.
pub const SYNTHETIC_CELLS: u32 = SYNTHETIC_TYPE_FLOOR;
pub const SYNTHETIC_FRAMES: u32 = SYNTHETIC_TYPE_FLOOR + (1 << 18);
pub const SYNTHETIC_CLOSURES: u32 = SYNTHETIC_TYPE_FLOOR + (1 << 19);

/// The upper half of the frames' space, for a **generator**'s frame.
///
/// Split from the lower half because the two are numbered by different things
/// and neither can see the other's counter: an `async` frame is the function's
/// index in `funcs`, chosen by [`suspend`] after refusals have removed
/// functions, and a generator's is the lowering's own count, chosen before.
/// Sharing one counter would have them collide for any program with both.
pub const SYNTHETIC_GENERATOR_FRAMES: u32 = SYNTHETIC_FRAMES + (1 << 17);

/// The frame type reserved for the `n`th generator the lowering meets.
#[must_use]
pub fn generator_frame(index: usize) -> TypeId {
    let id = SYNTHETIC_GENERATOR_FRAMES + u32::try_from(index).unwrap_or(0);
    debug_assert!(
        id < SYNTHETIC_CLOSURES,
        "more generators than the synthetic id space holds"
    );
    TypeId(id)
}

/// Whether a type id names a closure's class.
///
/// The one question about a synthetic id that is asked outside the module that
/// invented it, which is why the partition above exists.
#[must_use]
pub const fn is_closure_type(ty: TypeId) -> bool {
    ty.0 >= SYNTHETIC_CLOSURES
}

/// A lowered program.
#[derive(Debug, Clone, Default)]
pub struct Program {
    pub funcs: Vec<Func>,
    /// Layouts for every object type the program uses.
    pub layouts: Vec<Layout>,
    /// Variables declared at module scope, indexed by [`OpKind::GlobalGet`].
    pub globals: Vec<Global>,
    /// The memory discipline this program was lowered under.
    ///
    /// A backend receives a `Program` and not the [`Options`] that produced it,
    /// so a decision made here was previously invisible downstream -- and one
    /// backend has to act on it. The JVM lane refuses a function containing
    /// [`OpKind::Retain`] or [`OpKind::Release`], because a build that silently
    /// dropped them would have its lifetimes come from somewhere unexplained.
    /// That is the right guard against a *misconfiguration*, and it was firing
    /// on every `async` function: [`suspend`] emits one retain regardless of
    /// provider, since a suspension frame outliving its function is a lifetime
    /// question the provider does not answer. Without this field the backend
    /// could not tell the two cases apart.
    pub provider: Provider,
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
    /// Where a layout's base lives in the program's layout list.
    ///
    /// Resolved here rather than in each backend, because a base's `TypeId` may
    /// be one of several sharing a layout and the map that knows is this one.
    #[must_use]
    pub fn base_layout(&self, layout: &Layout) -> Option<usize> {
        let base = layout.base?;
        self.layouts
            .iter()
            .position(|candidate| candidate.types.contains(&base))
    }

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

/// Whether a runtime helper can change an array's length.
///
/// By *family* rather than by exact name, and deliberately. Missing one is a
/// wrong answer: every `array.len` on an allocation then folds to the size it
/// was made with, so `xs.pop(); xs.length` reads the old length. Naming one too
/// many costs an optimisation and nothing else.
///
/// It was an exact list of two, and it went wrong the first time the family
/// grew -- `nts_array_pop_value`, the `pop` that answers `undefined` rather
/// than NaN, is a `pop` that the list did not recognise. The `_ref` family
/// would have been the second time. `shift`, `unshift` and `splice` are named
/// here before they exist, so that building one cannot repeat it.
fn changes_array_length(name: &str) -> bool {
    [
        "nts_array_push",
        "nts_array_pop",
        "nts_array_shift",
        "nts_array_unshift",
        "nts_array_splice",
    ]
    .iter()
    .any(|family| name.starts_with(family))
}

/// Whether any array in this program can change length.
///
/// A program that changes none has arrays whose length is decided where they
/// are allocated and true forever after. That is a coarse question to ask about
/// a whole program, and it is asked that way on purpose: the precise version is
/// a may-grow fixpoint over parameters and fields, and this answers "no" for
/// every program that never pushes -- which is most of them, and all of Are We
/// Fast Yet.
#[must_use]
pub fn arrays_can_grow(program: &Program) -> bool {
    program.funcs.iter().any(|func| {
        func.values.iter().any(|op| {
            matches!(
                &op.kind,
                OpKind::Call { callee: Callee::External(name), .. }
                    if changes_array_length(name)
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
    /// Sites that stopped being erased.
    ///
    /// An array whose every store agreed, a parameter whose every caller
    /// agreed, a return whose every `return` agreed, and a block parameter
    /// whose every edge carried a known tag (see [`split`]). Each one is a tag
    /// that is no longer written and no longer tested, which is the whole of
    /// what the erased representation costs -- `docs/records/0019` measured it
    /// at 11% on an array and proved it was the tag rather than the size.
    pub narrowed: usize,
    /// Functions cloned for the closure they are called with.
    pub cloned: usize,
    /// Calls merged with the body they called, to place an allocation.
    pub copied: usize,
    /// Closure calls made direct, because the field the closure came from can
    /// hold only one. See [`fields::devirtualize`] for what that is worth.
    pub devirtualized: usize,
}

/// Lower a snapshot and make it ready to emit.
///
/// # Errors
///
/// If the result is not valid SSA. A backend is entitled to trust its input
/// only because something checked it, and specialization rewrites types and
/// inserts operations — so it has to earn that trust again rather than inherit
/// it from the lowering.
/// Function declarations the lowering neither emitted nor refused.
///
/// A conservation law, suggested by the Node session: **every function the
/// checker knows about is either lowered or refused, and never neither.** It
/// asks nothing about whether the answer is right, only whether anything
/// vanished — which is exactly what every defect in the known-defects table
/// did. An object-literal method was neither lowered nor refused. A namespace
/// member was lowered under a name that collided with another's, so one of the
/// two vanished at link time. `isNaN` was lowered into a call to a definition
/// that does not exist.
///
/// Each of those was found by someone tripping over it. This is checkable from
/// data the compiler already produces, over every file in the corpus, without
/// anyone thinking to look at object literals.
///
/// Attribution is by span containment rather than by name, because a name is
/// exactly what a generic instantiation and a namespace member change.
///
/// # What it does not cover
///
/// Arrow functions and function expressions. Those become closures, or are
/// desugared away entirely — `xs.forEach(v => …)` is compiled as the loop it
/// is, and a rule that expected a function for it would report the optimization
/// as a loss.
#[must_use]
/// Whether a declaration has a body to emit.
///
/// An overload signature and an ambient declaration have none: there is
/// nothing to emit and nothing to refuse.
fn has_a_body(snapshot: &SemanticSnapshot, node: &nts_semantic_schema::NodeRecord) -> bool {
    use nts_semantic_schema::{NodeKind, syntax};
    node.children.iter().any(|child| {
        matches!(
            snapshot.nodes.get(child.0 as usize).map(|child| child.kind),
            Some(NodeKind::Syntax(syntax::BLOCK))
        )
    })
}

#[must_use]
pub fn unaccounted(
    snapshot: &SemanticSnapshot,
    program: &Program,
    diagnostics: &[nts_diagnostics::Diagnostic],
    generic: &generics::GenericFunctions,
) -> Vec<nts_diagnostics::Location> {
    use nts_semantic_schema::{NodeKind, syntax};

    let within = |outer: &nts_diagnostics::Location, inner: &nts_diagnostics::Location| {
        outer.file == inner.file
            && inner.span.start >= outer.span.start
            && inner.span.end <= outer.span.end
    };

    // Every function-ish declaration with a body, and whether it was refused.
    //
    // Collected first because the question below is asked of *enclosing*
    // declarations too: a method declared inside a function that was itself
    // refused did not vanish silently, because nothing was emitted for the
    // function it is in. Fifty of the node profile's fifty-one reports were
    // that -- an object literal method inside a function refused for something
    // else entirely, where the refusal's span covers the offending expression
    // and not the method three lines below it.
    let declarations: Vec<(nts_diagnostics::Location, bool)> = snapshot
        .nodes
        .iter()
        .filter(|node| {
            matches!(
                node.kind,
                NodeKind::Syntax(
                    syntax::FUNCTION_DECLARATION
                        | syntax::METHOD_DECLARATION
                        | syntax::CONSTRUCTOR
                        | syntax::GET_ACCESSOR
                        | syntax::SET_ACCESSOR
                )
            ) && has_a_body(snapshot, node)
        })
        .map(|node| {
            let here = node.origin.location;
            let refused = diagnostics
                .iter()
                .any(|diagnostic| within(&here, &diagnostic.primary));
            (here, refused)
        })
        .collect();

    let mut missing = Vec::new();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        let NodeKind::Syntax(kind) = node.kind else {
            continue;
        };
        if !matches!(
            kind,
            syntax::FUNCTION_DECLARATION
                | syntax::METHOD_DECLARATION
                | syntax::CONSTRUCTOR
                | syntax::GET_ACCESSOR
                | syntax::SET_ACCESSOR
        ) {
            continue;
        }
        // No body: an overload signature, or an ambient declaration whose
        // definition is somewhere else. There is nothing to emit and nothing to
        // refuse.
        if !has_a_body(snapshot, node) {
            continue;
        }
        // A generic function is lowered once per instantiation and not at all
        // as itself: a parameter of type `T` has no width. One that nothing
        // calls is dead, and `lower::function_copies` says so in those words --
        // so reporting it here contradicted a decision the lowering makes
        // deliberately, and did it for a third of everything this reported.
        let id = nts_semantic_schema::NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        if generics::declared_type_parameters(snapshot, id) > 0
            && !generic.copies.contains_key(&id)
        {
            continue;
        }
        let here = node.origin.location;
        let emitted = program
            .funcs
            .iter()
            .any(|func| within(&here, &func.origin.location));
        // Refused itself, or declared inside something that was. The second is
        // what keeps this a question about *vanishing*: a function whose
        // enclosing declaration was refused had nothing emitted for it and no
        // caller that could reach it, which is not the failure this exists to
        // catch.
        //
        // It still catches that failure. A method of a class expression is the
        // case it was built for -- nothing walks a class expression at all --
        // and there the enclosing function lowers *successfully* while the
        // method disappears, so no refusal covers either.
        let refused = declarations
            .iter()
            .any(|(outer, refused)| *refused && within(outer, &here))
            // Or inside a refusal's own span. A module-scope statement is not a
            // declaration, so nothing above covers `const env = new Proxy({},
            // { get() {...} })` -- and the refusal for that statement does span
            // it, which is what makes this the same question and not a weaker
            // one.
            || diagnostics
                .iter()
                .any(|diagnostic| within(&diagnostic.primary, &here));
        if !emitted && !refused {
            missing.push(here);
        }
    }
    missing
}

/// Put every store and every edge back in agreement with the slot it fills.
///
/// Specialization narrows a slot and the value that fills it independently, and
/// until now nothing reconciled them: a field narrowed to `i32` was assigned a
/// `double`, an array of `double` was assigned an `i32`. The IR permitted it
/// because `verify::compatible` called any scalar compatible with any other --
/// and *that* was true only because C converts at an assignment without being
/// asked. The rule was a description of one backend, written into the
/// definition of a valid program.
///
/// Unconditional, not under `specialize_numbers`: a store that disagrees with
/// its slot is malformed however it came to be.
fn reconcile(program: &mut Program) -> usize {
    let returns: rustc_hash::FxHashMap<String, HirType> = program
        .funcs
        .iter()
        .map(|func| (func.name.clone(), func.return_type.clone()))
        .collect();
    let Program {
        funcs,
        layouts,
        globals,
        ..
    } = program;
    funcs
        .iter_mut()
        .map(|func| specialize::reconcile_stores(func, layouts, globals, &returns))
        .sum()
}

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
    /// RFC §9.2. Reference counting, with the cycle collector behind it: an
    /// object that could be in a cycle goes to a candidate buffer at a count of
    /// zero rather than being freed there, and collection runs once ten
    /// thousand roots have accumulated.
    ///
    /// That deferral reads as a leak in a program too short to reach the
    /// threshold — it is what made an async call look like it leaked a promise
    /// per `await`. Across twenty thousand calls the live count is flat.
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
/// Refuse every function that calls a function which was refused.
///
/// A refusal removes one function and leaves its callers behind, each holding a
/// `Callee::Direct` naming something that is not there. That reaches the backend
/// as a call to an undeclared function, which is C that does not compile — a
/// *worse* outcome than the refusal that caused it, because the diagnostic
/// explains a construct nobody can find in the program that failed to build.
///
/// Are We Fast Yet's `storage` found it: the benchmark's method is refused for
/// a recursive array type, and the entry point that calls it was emitted
/// anyway.
///
/// A fixpoint, because dropping a caller orphans *its* callers. Only
/// `Callee::Direct` matters: an external callee is a runtime helper and is
/// declared in the header, and a dispatch already tolerates a hole — the tables
/// emit a null where an implementation is missing, which is the same thing this
/// does for the other kind of call.
fn drop_callers_of_refused(lowered: &mut lower::Lowered) {
    loop {
        // A function about to be split by `suspend` provides two names: its
        // own and its resumption's. A `for...of` over a generator calls the
        // second, and this runs *before* the split -- so without them every
        // such loop is dropped as calling something that was refused.
        let resumptions: Vec<String> = lowered
            .program
            .funcs
            .iter()
            .filter_map(suspend::provides)
            .collect();
        let present: rustc_hash::FxHashSet<&str> = lowered
            .program
            .funcs
            .iter()
            .map(|func| func.name.as_str())
            .chain(resumptions.iter().map(String::as_str))
            .collect();
        let mut refused = Vec::new();
        for func in &lowered.program.funcs {
            let missing = func.values.iter().find_map(|op| match &op.kind {
                OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                } if !present.contains(name.as_str()) => Some((name.clone(), op.origin.clone())),
                _ => None,
            });
            if let Some((name, origin)) = missing {
                refused.push((func.name.clone(), name, origin));
            }
        }
        if refused.is_empty() {
            return;
        }
        for (caller, callee, origin) in refused {
            lowered.diagnostics.push(nts_diagnostics::Diagnostic::error(
                "NTS1003",
                format!(
                    "`{caller}` cannot be compiled because it calls `{callee}`, \
                     which was refused above"
                ),
                origin.location,
            ));
            lowered.program.funcs.retain(|func| func.name != caller);
        }
    }
}

/// should call this.
/// Hold each field and each module-scope variable as narrowly as its contents
/// allow, before the bodies that read them are specialized.
///
/// `number` is a double, but a slot every store puts a small whole number into
/// holds one every time -- and an `int32` is half the storage and integer
/// arithmetic on the other side of the load.
///
/// Two of the three kinds of storage. [`elements`] is the third and runs after
/// this, because what an array holds depends on what the fields feeding it were
/// narrowed to.
/// Operations whose answer is one of their own operands, in every function.
fn simplify_all(program: &mut Program) -> usize {
    program.funcs.iter_mut().map(simplify::simplify).sum()
}

/// Call a closure directly where the field it came from can hold only one.
///
/// Run before `reshape_calls`, so a call this makes direct is a call the
/// inliner can inline and the interprocedural analysis can read a callee's
/// facts through. A dispatch is opaque to both, and that opacity is most of
/// what it costs: `benches/cases/optional-chain` went 87.98 us to 35.17 us on
/// this, and `tooling/memory/cases/callback-field` went from 35 counting
/// operations to 1 — a reference cannot be borrowed across a call nothing can
/// name, which is record 0091's shape.
fn devirtualize_closures(program: &mut Program) -> usize {
    let held = fields::closures(program);
    fields::devirtualize(program, &held)
}

fn narrow_storage(program: &mut Program, analyses: &[flow::Analysis]) {
    let widths = fields::representations(program, analyses);
    fields::narrow(program, &widths);

    // A global had no analysis at all until this, so every read of one was TOP
    // -- and a TOP in a loop makes the arithmetic after it floating point
    // whatever the slot holds. The width below is the smaller half of that; the
    // facts `globals::analyze` puts into the fixpoint are the rest.
    let facts = globals::analyze(program, analyses);
    let widths = globals::representations(program, &facts);
    globals::narrow(program, &widths);
}

#[must_use]
pub fn prepare_unverified(snapshot: &SemanticSnapshot, options: &Options<'_>) -> Prepared {
    let specialize_numbers = options.specialize_numbers;
    let mut lowered = lower::lower(snapshot);
    // Before anything looks at the program: a function that calls a refused one
    // has a call to nothing in it.
    drop_callers_of_refused(&mut lowered);
    // Before anything looks at the shape of a function: a suspension rewrites
    // one function into two and moves its locals into a frame, and every
    // analysis after this should see the result rather than the source.
    lowered
        .diagnostics
        .extend(suspend::transform(&mut lowered.program));
    drop_callers_of_refused(&mut lowered);

    let mut program = lowered.program;

    // First, before anything expensive. Everything that survives here gets
    // analyzed interprocedurally, specialized, proven and emitted, and a
    // function nothing can call should pay for none of that.
    let pruned = reachable::prune(&mut program, options.roots);

    let devirtualized = devirtualize_closures(&mut program);

    let (cloned, copied, dropped) = reshape_calls(&mut program, options.roots);
    let pruned = pruned + dropped;
    let unions_split = split_unions(&mut program);

    let (mut specialized, mut conversions, mut checks_removed) = (0, 0, 0);

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

        let analyses = interprocedural::analyze_program(&program, options.roots);
        narrow_storage(&mut program, &analyses);

        // And the same for what an array holds. An element that arrives as an
        // integer is what lets a `switch` over one become a jump table, and it
        // halves the memory besides.
        let roots: rustc_hash::FxHashSet<&str> = reachable::root_names(&program, options.roots)
            .into_iter()
            .collect();
        let element_widths =
            elements::representations(&program, &elements::analyze(&program, &analyses, &roots));
        elements::narrow(&mut program, &element_widths);

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
    let narrowed = narrow_widths(&mut program) + shed_erasure(&mut program) + unions_split;

    let mut simplified = simplify_all(&mut program);

    // Reconcile *after* the passes that rewrite operands, not before.
    //
    // It ran before `shed_erasure` at first, which was too early: that pass
    // removes `x | 0` once `x` is known to be an `i32`, and removing an
    // identity means every reader of it moves to the value underneath -- which
    // may be of another type than the one the reader was reconciled against.
    // The unit tests caught it where two corpora did not, on a `+` whose right
    // operand went back to being an `i64` under a `double`.
    // Before `reconcile`, which is what fixes up the operand types the new
    // arithmetic arrives with, and before `dce`, which collects the call it
    // leaves behind. See [`substring`].
    // Counted with the simplifications: a substring answered from its
    // endpoints is an operation that turned out to be its own operands, which
    // is what that number means.
    simplified += program.funcs.iter_mut().map(substring::elide).sum::<usize>();

    conversions += reconcile(&mut program);

    // Specialization orphans values by design — a folded constant leaves its
    // unfolded original with no readers — and the C emitter declares a local for
    // everything it assigns.
    for func in &mut program.funcs {
        // Parameters first: dropping one can be what makes the value feeding
        // it dead, and that is an operation for the pass below to collect.
        dce::prune_parameters(func);
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
    // Recorded on the program rather than left in the options, because a
    // backend is handed the program alone and one of them has to act on this.
    // Set here, beside the pass it describes, so the two cannot drift.
    program.provider = options.provider;

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
        copied,
        devirtualized,
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
        narrowed,
    }
}

/// Take erasure off every site that never needed it, then fold what that left.
///
/// Two steps rather than one pass, because the second is true whether or not
/// the first fired: `typeof v === "number"` lowers to a string allocation and
/// a string compare, and the tag the comparison is really about is already in
/// hand either way.
fn shed_erasure(program: &mut Program) -> usize {
    let narrowed = narrow_erasure(program);
    for func in &mut program.funcs {
        tags::fold_comparisons(func);
    }
    narrowed
}

/// Take erasure off every site that never needed it.
///
/// Run before the peepholes rather than after: narrowing leaves an unerase that
/// is now the identity and a tag read that is now a constant, and removing
/// those is `simplify`'s job and `fold`'s. A pass that also swept up after
/// itself would be two passes wearing one name -- and the first placement of
/// this one *was* after them, which left the dead unerase in the emitted C.
fn narrow_erasure(program: &mut Program) -> usize {
    // Returns and parameters feed each other in both directions. A narrowed
    // return is a narrowed argument at the next call, which is what lets that
    // callee's parameter narrow; a narrowed parameter is a narrowed value to
    // return, which is what lets this function's return narrow. So both to a
    // fixpoint rather than in whichever order catches most of it.
    //
    // It terminates on its own -- every round strictly removes erasure and no
    // round adds any -- and the bound is there so that a later pass joining
    // this loop without that property cannot hang the compiler instead of
    // being noticed.
    let mut narrowed = 0;
    for _ in 0..8 {
        let round = unerase::narrow_returns(program) + unerase::narrow_parameters(program);
        narrowed += round;
        if round == 0 {
            break;
        }
    }
    // Arrays last: a parameter or a result that has become a `double` is a
    // `double` stored into an array, which is what lets the array narrow too.
    // The other order narrows nothing on the second pass.
    let escapes = escape::analyze_program(program);
    for (func, escapes) in program.funcs.iter_mut().zip(&escapes) {
        narrowed += unerase::narrow_arrays(func, escapes);
    }
    narrowed
}
/// Move every allocation that can be in the frame into it.
///
/// Returns how many moved, which is worth reporting: it is the difference
/// between a loop that calls the allocator and one that does not, and on the
/// `objects` benchmark it is the entire gap to hand-written C.
/// Settle what calls what, before anything reads a call.
///
/// **Monomorphize** first, because a clone's parameter is a different type and
/// everything downstream should see it that way -- and because the dispatch it
/// turns into a direct call is a call the interprocedural analysis can follow.
///
/// **Merge** two frames where a callee hands back what it allocated, which is
/// the one shape no summary can answer: placement is per function and the
/// allocation is in the wrong one. Not an inliner -- see [`inline`], and
/// `docs/records/0027` for the general one that was measured and deleted.
///
/// **Prune** after both, because a function reached only through a clone, or
/// copied into every caller it had, is a function nothing calls -- and one that
/// still contains the dispatch the clone exists to avoid.
fn reshape_calls(program: &mut Program, roots: reachable::Roots<'_>) -> (usize, usize, usize) {
    let cloned = monomorphize::monomorphize(program);
    let copied = inline::inline(program);
    (cloned, copied, reachable::prune(program, roots))
}

/// Split every union-typed block parameter the program allows. Reports how many.
///
/// Called before specialization, and that is the whole of why it is a separate
/// step rather than part of one: run afterwards it would find every payload
/// already committed to a double, which is the conversion it exists to remove.
/// Narrow every arithmetic value to the width its result is truncated to.
///
/// Runs before `reconcile`, which is what inserts the truncation wherever a
/// value that stayed wide feeds one that did not -- see [`narrow`], where that
/// boundary is the induction variable and there is exactly one of them.
fn narrow_widths(program: &mut Program) -> usize {
    program.funcs.iter_mut().map(narrow::narrow_truncated).sum()
}

fn split_unions(program: &mut Program) -> usize {
    program.funcs.iter_mut().map(split::split_unions).sum()
}

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
    // One code unit, whatever the argument is: `fromCharCode` truncates to
    // sixteen bits and yields exactly one. The other helpers below are bounded
    // by a string they were given, which is what `string_span` reads; this one
    // is bounded by what it *is*, and asking `string_span` about a `double`
    // argument would get no answer.
    if name == "nts_string_from_char_code" {
        return Some(1);
    }
    // `String(x)`, whose length is bounded by what a double *is* rather than by
    // any argument: the shortest round-tripping decimal needs at most 17
    // significant digits, and the widest shape around them is
    // `-1.2345678901234567e-308` at twenty-four characters.
    //
    // This is the difference between `String(x)` and `toLowerCase`, which
    // cannot be placed at all: one has a bound the compiler can know before the
    // call and the other's output length is its input's. `NTS_NUMBER_STRING_MAX`
    // in the runtime header is the same number, and `nts_number_to_string_into`
    // takes the heap rather than trusting it if a value ever exceeds it.
    if name == "nts_number_to_string" {
        return Some(40);
    }
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
            base: None,
        }
    }

    /// Two types that differ only in what they extend are two classes.
    ///
    /// `class Circle extends Shape {}` adds nothing, so it has `Shape`'s fields
    /// and `Shape`'s dispatch table. Layouts are structural and merged them,
    /// which gave `Circle` `Shape`'s descriptor and made `s instanceof Circle`
    /// true of a `Shape`.
    ///
    /// The base is compared inside `same_shape` rather than beside it at the
    /// two call sites, so that neither can forget -- which is the failure this
    /// project has paid for repeatedly.
    #[test]
    fn a_base_keeps_two_identical_shapes_apart() {
        let shape = Layout {
            types: vec![TypeId(1)],
            name: "Shape".to_owned(),
            fields: vec![field("size", HirType::NUMBER)],
            methods: Vec::new(),
            base: None,
        };
        let derived_fields = vec![field("size", HirType::NUMBER)];

        // Identical in every structural respect, and not the same class.
        assert!(
            !shape.same_shape(&derived_fields, &[], Some(TypeId(1))),
            "an empty subclass must not merge into what it extends",
        );
        // And a type with the same base is still merged on shape, which is what
        // keeps two spellings of one anonymous type from becoming two layouts.
        assert!(shape.same_shape(&derived_fields, &[], None));
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
                    zeroed: true,
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
                async_result: None,
                frame: None,
                abstract_declaration: false,
            }],
            globals: Vec::new(),
            layouts: Vec::new(),
            ..Program::default()
        }
    }

    /// The condition that lets a bounds check be removed on an array the
    /// function passed to something. Getting this wrong removes a check that
    /// can fail, so it is pinned from both sides.
    #[test]
    fn an_allocated_length_is_exact_only_while_nothing_can_grow_an_array() {
        let quiet = allocating(false);
        assert!(!arrays_can_grow(&quiet));
        assert!(allocated_length_is_exact(
            &quiet.funcs[0],
            ValueId(1),
            false
        ));

        // The same function, in a program that pushes somewhere. `fill` cannot
        // grow it and `push` can, and this does not distinguish them — passing
        // the array anywhere is now enough to lose the length.
        let growing = allocating(true);
        assert!(arrays_can_grow(&growing));
        assert!(!allocated_length_is_exact(
            &growing.funcs[0],
            ValueId(1),
            true
        ));
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
            ..Program::default()
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
            ..Program::default()
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

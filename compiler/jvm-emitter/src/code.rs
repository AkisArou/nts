//! Building a method body, one instruction at a time, with its provenance.
//!
//! # Provenance is structural, not remembered
//!
//! `nts-codegen-common`'s `CodeWriter` makes it impossible to emit a line of C
//! without saying where it came from, on the argument that a writer which
//! *offers* a "record an origin" call gets it right exactly as often as
//! somebody remembers to make it. The same argument holds one representation
//! down, so here too there is no way to add an instruction without an
//! [`Origin`], and the offset-to-origin map is produced by the same call that
//! produces the bytes.
//!
//! `LineNumberTable`, the `SourceDebugExtension` SMAP stratum, and the debug
//! sidecar are all projections of that map rather than things built separately
//! and hoped to agree.
//!
//! # Errors are recorded, not returned
//!
//! An emitter makes thousands of these calls and any one of them can meet a
//! limit the class file format has and C does not -- a constant pool past
//! 65,535 entries, a method past 65,534 bytes, a branch past a signed 16-bit
//! offset. Returning a `Result` from every instruction would put a `?` on every
//! line to report a condition that ends this method however it is reported. So
//! the first error is kept and [`Code::finish`] reports it, which is the same
//! shape as the C backend building each body speculatively and keeping it only
//! on success.

use nts_semantic_schema::Origin;

use crate::descriptor;
use crate::frames::VType;
use crate::insn::{self, Compare, Kind};
use crate::pool::Pool;

/// A branch destination. Created before it is placed, because a forward jump
/// names a block that has not been emitted yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Label(u32);

/// Why a method body could not be built.
///
/// Every variant is a limit of the class file format rather than a defect in
/// the program, and every one of them ends as a refusal naming the function --
/// never a half-written method.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// Past 65,535 constant pool entries. One class per module rather than one
    /// per program is the fix, and it is a real one for a large program.
    PoolOverflow,
    /// Past 65,534 bytes of code in one method.
    CodeTooLong(usize),
    /// A branch further than a signed 16-bit offset reaches.
    BranchOutOfRange { at: u16, distance: i64 },
    /// A label was branched to and never placed -- an emitter bug, not a
    /// program's.
    UnboundLabel,
    /// More than 65,535 local slots.
    TooManyLocals(u32),
    /// A block boundary was reached with something still on the operand stack.
    ///
    /// This is the invariant the whole `StackMapTable` design rests on, so it
    /// is checked rather than assumed: if it ever fails, the frames would be
    /// wrong and the class would be rejected far from the cause.
    StackNotEmptyAtLabel { at: u16, depth: i32 },
    /// More was popped than was pushed. Always an emitter bug.
    StackUnderflow { at: u16 },
    /// A descriptor the emitter built and cannot read back.
    BadDescriptor(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PoolOverflow => write!(f, "the constant pool exceeded 65,535 entries"),
            Self::CodeTooLong(bytes) => {
                write!(f, "a method body of {bytes} bytes exceeds the 65,534-byte limit")
            }
            Self::BranchOutOfRange { at, distance } => {
                write!(f, "a branch at {at} reaches {distance} bytes, past a 16-bit offset")
            }
            Self::UnboundLabel => write!(f, "a branch names a block that was never emitted"),
            Self::TooManyLocals(slots) => {
                write!(f, "{slots} local slots exceeds the 65,535 the format allows")
            }
            Self::StackNotEmptyAtLabel { at, depth } => {
                write!(f, "the operand stack held {depth} words at the block starting at {at}")
            }
            Self::StackUnderflow { at } => write!(f, "the operand stack underflowed at {at}"),
            Self::BadDescriptor(text) => write!(f, "malformed descriptor `{text}`"),
        }
    }
}

#[derive(Debug)]
struct Fixup {
    /// Where the branch instruction starts -- offsets are relative to this,
    /// not to the operand.
    from: u16,
    /// Where the two-byte operand sits.
    operand: u16,
    label: Label,
}

/// A finished method body, and everything the `Code` attribute needs.
#[derive(Debug)]
pub struct Body {
    pub max_stack: u16,
    pub max_locals: u16,
    pub code: Vec<u8>,
    /// One entry per instruction, in offset order.
    pub origins: Vec<(u16, Origin)>,
    /// Offsets needing a stack map frame: every block boundary.
    pub frame_offsets: Vec<u16>,
    /// The slot table, as verification entries.
    pub locals: Vec<VType>,
}

/// A method body under construction.
#[derive(Debug)]
pub struct Code {
    bytes: Vec<u8>,
    origins: Vec<(u16, Origin)>,
    labels: Vec<Option<u16>>,
    fixups: Vec<Fixup>,
    frame_offsets: Vec<u16>,
    locals: Vec<VType>,
    max_locals: u16,
    stack: i32,
    max_stack: i32,
    error: Option<Error>,
}

impl Code {
    /// `locals` is the slot table as verification entries in slot order, with a
    /// wide kind contributing one entry and two slots. `max_locals` is the slot
    /// count, which is therefore not `locals.len()`.
    #[must_use]
    pub fn new(locals: Vec<VType>, max_locals: u16) -> Self {
        Self {
            bytes: Vec::new(),
            origins: Vec::new(),
            labels: Vec::new(),
            fixups: Vec::new(),
            frame_offsets: Vec::new(),
            locals,
            max_locals,
            stack: 0,
            max_stack: 0,
            error: None,
        }
    }

    /// How many words the operand stack currently holds.
    ///
    /// Exposed so a caller that keeps its own model of what is on the stack can
    /// check it against this one rather than trust it. A backend that leaves
    /// values on the stack between operations has two accounts of the same
    /// thing, and the emitted code is wrong long before anything here notices.
    #[must_use]
    pub fn depth(&self) -> i32 {
        self.stack
    }

    #[must_use]
    pub fn offset(&self) -> u16 {
        u16::try_from(self.bytes.len()).unwrap_or(u16::MAX)
    }

    fn fail(&mut self, error: Error) {
        if self.error.is_none() {
            self.error = Some(error);
        }
    }

    pub fn label(&mut self) -> Label {
        self.labels.push(None);
        Label(u32::try_from(self.labels.len() - 1).unwrap_or(u32::MAX))
    }

    /// Place a label here, and record that a frame is needed at this offset.
    ///
    /// Refuses a non-empty operand stack: see [`Error::StackNotEmptyAtLabel`].
    pub fn bind(&mut self, label: Label) {
        let at = self.offset();
        if self.stack != 0 {
            self.fail(Error::StackNotEmptyAtLabel { at, depth: self.stack });
        }
        if let Some(slot) = self.labels.get_mut(label.0 as usize) {
            *slot = Some(at);
        }
        if !self.frame_offsets.contains(&at) {
            self.frame_offsets.push(at);
        }
    }

    /// The one place bytes are appended, so the origin cannot be forgotten and
    /// the stack depth cannot go untracked.
    fn emit(&mut self, origin: &Origin, bytes: &[u8], pops: u16, pushes: u16) {
        let at = self.offset();
        self.origins.push((at, origin.clone()));
        self.bytes.extend_from_slice(bytes);
        self.stack -= i32::from(pops);
        if self.stack < 0 {
            self.fail(Error::StackUnderflow { at });
        }
        self.stack += i32::from(pushes);
        self.max_stack = self.max_stack.max(self.stack);
    }

    fn op(&mut self, origin: &Origin, opcode: u8, pops: u16, pushes: u16) {
        self.emit(origin, &[opcode], pops, pushes);
    }

    fn op_u2(&mut self, origin: &Origin, opcode: u8, operand: u16, pops: u16, pushes: u16) {
        let [hi, lo] = operand.to_be_bytes();
        self.emit(origin, &[opcode, hi, lo], pops, pushes);
    }

    // ----- locals -------------------------------------------------------

    /// A slot index, using the one-byte forms where they exist and the `wide`
    /// prefix past 255. Which form is used is decided here rather than by a
    /// caller, so a method with 300 locals is not a different code path.
    fn slot_op(&mut self, origin: &Origin, kind: Kind, slot: u16, storing: bool) {
        let (base, short) = if storing {
            (insn::STORE, insn::STORE_0)
        } else {
            (insn::LOAD, insn::LOAD_0)
        };
        let (pops, pushes) = if storing { (kind.words(), 0) } else { (0, kind.words()) };
        let family = kind as u8;
        if slot < 4 {
            let opcode = short + family * 4 + u8::try_from(slot).unwrap_or(0);
            self.op(origin, opcode, pops, pushes);
        } else if let Ok(narrow) = u8::try_from(slot) {
            self.emit(origin, &[base + family, narrow], pops, pushes);
        } else {
            let [hi, lo] = slot.to_be_bytes();
            self.emit(origin, &[insn::WIDE, base + family, hi, lo], pops, pushes);
        }
    }

    pub fn load(&mut self, origin: &Origin, kind: Kind, slot: u16) {
        self.slot_op(origin, kind, slot, false);
    }

    pub fn store(&mut self, origin: &Origin, kind: Kind, slot: u16) {
        self.slot_op(origin, kind, slot, true);
    }

    /// Store a default into every slot the parameters did not fill.
    ///
    /// This is what makes the stack map design in [`crate::frames`] true rather
    /// than merely intended: the frame declares a type for every slot, and the
    /// verifier will not accept a frame naming a slot nothing has assigned. The
    /// stores cost a handful of bytes and are dead by the time C2 sees them --
    /// which is a claim to measure rather than to trust, and `benches/cases/fib`
    /// is where.
    ///
    /// `from_slot` is one past the last parameter: parameters arrive assigned
    /// and re-initializing one would erase the argument.
    pub fn initialize_locals(&mut self, origin: &Origin, from_slot: u16) {
        let mut slot = 0u16;
        let locals = std::mem::take(&mut self.locals);
        for local in &locals {
            if slot >= from_slot {
                match local {
                    VType::Integer => {
                        self.op(origin, insn::ICONST_0, 0, 1);
                        self.store(origin, Kind::Int, slot);
                    }
                    VType::Float => {
                        self.op(origin, insn::FCONST_0, 0, 1);
                        self.store(origin, Kind::Float, slot);
                    }
                    VType::Long => {
                        self.op(origin, insn::LCONST_0, 0, 2);
                        self.store(origin, Kind::Long, slot);
                    }
                    VType::Double => {
                        self.op(origin, insn::DCONST_0, 0, 2);
                        self.store(origin, Kind::Double, slot);
                    }
                    VType::Object(_) | VType::Null => {
                        self.const_null(origin);
                        self.store(origin, Kind::Ref, slot);
                    }
                    // Nothing can be stored into a `Top` slot, and nothing may
                    // read one either -- it is the declaration that a slot is
                    // unused rather than untyped.
                    VType::Top => {}
                }
            }
            slot += local.slots();
        }
        self.locals = locals;
    }

    // ----- constants ----------------------------------------------------

    fn ldc(&mut self, origin: &Origin, index: u16, pushes: u16) {
        if pushes == 2 {
            self.op_u2(origin, insn::LDC2_W, index, 0, 2);
        } else if let Ok(narrow) = u8::try_from(index) {
            self.emit(origin, &[insn::LDC, narrow], 0, 1);
        } else {
            self.op_u2(origin, insn::LDC_W, index, 0, 1);
        }
    }

    pub fn const_int(&mut self, origin: &Origin, pool: &mut Pool, value: i32) {
        match value {
            -1..=5 => {
                let opcode = u8::try_from(i32::from(insn::ICONST_0) + value).unwrap_or(insn::ICONST_0);
                self.op(origin, opcode, 0, 1);
            }
            -128..=127 => {
                let byte = i8::try_from(value).unwrap_or(0).cast_unsigned();
                self.emit(origin, &[insn::BIPUSH, byte], 0, 1);
            }
            -32768..=32767 => {
                let short = i16::try_from(value).unwrap_or(0).cast_unsigned();
                self.op_u2(origin, insn::SIPUSH, short, 0, 1);
            }
            _ => {
                let index = pool.integer(value);
                self.ldc(origin, index, 1);
            }
        }
    }

    pub fn const_long(&mut self, origin: &Origin, pool: &mut Pool, value: i64) {
        if value == 0 || value == 1 {
            let opcode = insn::LCONST_0 + u8::try_from(value).unwrap_or(0);
            self.op(origin, opcode, 0, 2);
        } else {
            let index = pool.long(value);
            self.ldc(origin, index, 2);
        }
    }

    /// A `double` constant.
    ///
    /// The short forms are compared **by bits**, not by value: `dconst_0`
    /// pushes `+0.0`, and `-0.0 == 0.0` is true in Rust as it is in JavaScript.
    /// A value comparison would therefore emit `+0.0` where the program wrote
    /// `-0.0`, which `Object.is` and `1/x` both observe -- and which this
    /// repository has a whole `zero_sign` analysis about.
    pub fn const_double(&mut self, origin: &Origin, pool: &mut Pool, value: f64) {
        if value.to_bits() == 0.0f64.to_bits() {
            self.op(origin, insn::DCONST_0, 0, 2);
        } else if value.to_bits() == 1.0f64.to_bits() {
            self.op(origin, insn::DCONST_0 + 1, 0, 2);
        } else {
            let index = pool.double(value);
            self.ldc(origin, index, 2);
        }
    }

    pub fn const_float(&mut self, origin: &Origin, pool: &mut Pool, value: f32) {
        let bits = value.to_bits();
        if bits == 0.0f32.to_bits() {
            self.op(origin, insn::FCONST_0, 0, 1);
        } else if bits == 1.0f32.to_bits() {
            self.op(origin, insn::FCONST_0 + 1, 0, 1);
        } else if bits == 2.0f32.to_bits() {
            self.op(origin, insn::FCONST_0 + 2, 0, 1);
        } else {
            let index = pool.float(value);
            self.ldc(origin, index, 1);
        }
    }

    pub fn const_string(&mut self, origin: &Origin, pool: &mut Pool, text: &str) {
        let index = pool.string(text);
        self.ldc(origin, index, 1);
    }

    pub fn const_null(&mut self, origin: &Origin) {
        self.op(origin, insn::ACONST_NULL, 0, 1);
    }

    // ----- arithmetic ---------------------------------------------------

    /// One of the four-wide arithmetic families: `insn::ADD`, `SUB`, `MUL`,
    /// `DIV`, `REM`.
    pub fn arithmetic(&mut self, origin: &Origin, family: u8, kind: Kind) {
        let words = kind.words();
        self.op(origin, family + kind as u8, words * 2, words);
    }

    pub fn negate(&mut self, origin: &Origin, kind: Kind) {
        let words = kind.words();
        self.op(origin, insn::NEG + kind as u8, words, words);
    }

    /// One of the integral families: `insn::AND`, `OR`, `XOR`.
    pub fn bitwise(&mut self, origin: &Origin, family: u8, kind: Kind) {
        let words = kind.words();
        self.op(origin, family + u8::from(kind == Kind::Long), words * 2, words);
    }

    /// `insn::SHL`, `SHR` or `USHR`. The shift *count* is always an `int` even
    /// when the value is a `long`, which is why this cannot use `bitwise`.
    pub fn shift(&mut self, origin: &Origin, family: u8, kind: Kind) {
        let words = kind.words();
        self.op(origin, family + u8::from(kind == Kind::Long), words + 1, words);
    }

    pub fn convert(&mut self, origin: &Origin, opcode: u8, from: Kind, to: Kind) {
        self.op(origin, opcode, from.words(), to.words());
    }

    /// `lcmp`, `fcmpl`, `fcmpg`, `dcmpl`, `dcmpg`: pop two, push an `int` of
    /// -1, 0 or 1.
    ///
    /// Prefer [`Code::branch_float`] for a floating comparison: the `l`/`g`
    /// suffix and the branch that reads it have exactly one correct pairing,
    /// and this entry point cannot enforce it.
    pub fn compare(&mut self, origin: &Origin, opcode: u8, kind: Kind) {
        self.op(origin, opcode, kind.words() * 2, 1);
    }

    /// A floating-point comparison and the branch that reads it, chosen
    /// together because they are one decision.
    ///
    /// # The pairing, and why it is not a caller's business
    ///
    /// `dcmpg` answers `1` when either operand is `NaN` and `dcmpl` answers
    /// `-1`. JavaScript requires every relational operator to be **false**
    /// against `NaN`, so each comparison needs the form whose `NaN` answer the
    /// following branch rejects:
    ///
    /// ```text
    /// a <  b   dcmpg + iflt      1 is not < 0
    /// a <= b   dcmpg + ifle      1 is not <= 0
    /// a >  b   dcmpl + ifgt     -1 is not > 0
    /// a >= b   dcmpl + ifge     -1 is not >= 0
    /// a == b   dcmpl + ifeq     -1 is not == 0
    /// a != b   dcmpl + ifne     -1 is != 0, which is right: NaN != x is true
    /// ```
    ///
    /// Splitting this across two calls is how it gets written backwards, and
    /// backwards is silent on every input except `NaN` -- so the two are one
    /// call. The first version of this crate had them apart and had the rule
    /// inverted; the hostile pool in the differential carries a `NaN` and would
    /// have found it later and further from the cause.
    pub fn branch_float(&mut self, origin: &Origin, compare: Compare, kind: Kind, target: Label) {
        self.branch_float_when(origin, compare, false, kind, target);
    }

    /// The same, taking the branch when the comparison is **false**.
    ///
    /// # Why this is not `branch_float(compare.inverted(), ..)`
    ///
    /// Because `!(a > b)` is not `a <= b`. Against `NaN` both are false, so the
    /// negation of the first is *true* and the second is not -- the relational
    /// operators are not a total order and inverting one does not give its
    /// complement.
    ///
    /// Concretely: `a > b` is `dcmpl` then `ifgt`, and `NaN` makes `dcmpl`
    /// answer -1, which `ifgt` rejects. Its negation must therefore be `dcmpl`
    /// then `ifle`, which -1 *accepts*. Inverting the comparison instead would
    /// pick `dcmpg` -- a different `NaN` answer -- and quietly reject it twice.
    ///
    /// So the comparison chooses the `dcmp` form and the negation chooses only
    /// the branch. This is the same bug as pairing `dcmpl` with `iflt`, made
    /// available again by the inverter that fixed it: `examples/conditionals`
    /// answered `sign(NaN)` as 1 where node answers 0, and the differential
    /// found it on its first run.
    pub fn branch_float_when(
        &mut self,
        origin: &Origin,
        compare: Compare,
        negate: bool,
        kind: Kind,
        target: Label,
    ) {
        // Chosen from the comparison as written, *not* from the test below.
        let opcode = match (kind, compare) {
            (Kind::Float, Compare::Lt | Compare::Le) => insn::FCMPG,
            (Kind::Float, _) => insn::FCMPL,
            (_, Compare::Lt | Compare::Le) => insn::DCMPG,
            (_, _) => insn::DCMPL,
        };
        self.compare(origin, opcode, kind);
        let test = if negate { compare.inverted() } else { compare };
        self.branch_zero(origin, test, target);
    }

    // ----- control flow -------------------------------------------------

    fn branch(&mut self, origin: &Origin, opcode: u8, target: Label, pops: u16) {
        let from = self.offset();
        let operand = from.saturating_add(1);
        self.emit(origin, &[opcode, 0, 0], pops, 0);
        self.fixups.push(Fixup { from, operand, label: target });
    }

    /// `ifeq`..`ifle`: compare one `int` against zero.
    pub fn branch_zero(&mut self, origin: &Origin, compare: Compare, target: Label) {
        self.branch(origin, insn::IFEQ + compare as u8, target, 1);
    }

    /// `if_icmpeq`..`if_icmple`: compare two `int`s.
    pub fn branch_int(&mut self, origin: &Origin, compare: Compare, target: Label) {
        self.branch(origin, insn::IF_ICMPEQ + compare as u8, target, 2);
    }

    /// `if_acmpeq` / `if_acmpne`: reference identity, which is what JavaScript
    /// `===` means on an object and is **not** what it means on a string.
    pub fn branch_ref(&mut self, origin: &Origin, equal: bool, target: Label) {
        self.branch(origin, insn::IF_ACMPEQ + u8::from(!equal), target, 2);
    }

    pub fn branch_null(&mut self, origin: &Origin, is_null: bool, target: Label) {
        let opcode = if is_null { insn::IFNULL } else { insn::IFNONNULL };
        self.branch(origin, opcode, target, 1);
    }

    pub fn goto(&mut self, origin: &Origin, target: Label) {
        self.branch(origin, insn::GOTO, target, 0);
    }

    /// `ireturn`..`areturn`, or `return` for `None`.
    pub fn ret(&mut self, origin: &Origin, kind: Option<Kind>) {
        if let Some(kind) = kind {
            self.op(origin, insn::RETURN_TYPED + kind as u8, kind.words(), 0);
        } else {
            self.op(origin, insn::RETURN_VOID, 0, 0);
        }
    }

    pub fn athrow(&mut self, origin: &Origin) {
        self.op(origin, insn::ATHROW, 1, 0);
    }

    // ----- fields and calls ---------------------------------------------

    pub fn get_static(&mut self, origin: &Origin, pool: &mut Pool, class: &str, name: &str, ty: &str) {
        let index = pool.field_ref(class, name, ty);
        self.op_u2(origin, insn::GETSTATIC, index, 0, descriptor::words(ty));
    }

    pub fn put_static(&mut self, origin: &Origin, pool: &mut Pool, class: &str, name: &str, ty: &str) {
        let index = pool.field_ref(class, name, ty);
        self.op_u2(origin, insn::PUTSTATIC, index, descriptor::words(ty), 0);
    }

    pub fn get_field(&mut self, origin: &Origin, pool: &mut Pool, class: &str, name: &str, ty: &str) {
        let index = pool.field_ref(class, name, ty);
        self.op_u2(origin, insn::GETFIELD, index, 1, descriptor::words(ty));
    }

    pub fn put_field(&mut self, origin: &Origin, pool: &mut Pool, class: &str, name: &str, ty: &str) {
        let index = pool.field_ref(class, name, ty);
        self.op_u2(origin, insn::PUTFIELD, index, 1 + descriptor::words(ty), 0);
    }

    fn invoke(&mut self, origin: &Origin, pool: &mut Pool, opcode: u8, class: &str, name: &str, signature: &str) {
        // Every invoke but `invokestatic` pops a receiver under the arguments.
        let receiver = u16::from(opcode != insn::INVOKESTATIC);
        let Some((arguments, result)) = descriptor::call_effect(signature) else {
            self.fail(Error::BadDescriptor(signature.to_owned()));
            return;
        };
        if opcode == insn::INVOKEINTERFACE {
            let index = pool.interface_method_ref(class, name, signature);
            let [hi, lo] = index.to_be_bytes();
            // The redundant argument count, and a zero the format reserves and
            // never used.
            let count = u8::try_from(arguments + receiver).unwrap_or(u8::MAX);
            self.emit(origin, &[opcode, hi, lo, count, 0], arguments + receiver, result);
        } else {
            let index = pool.method_ref(class, name, signature);
            self.op_u2(origin, opcode, index, arguments + receiver, result);
        }
    }

    pub fn invoke_static(&mut self, origin: &Origin, pool: &mut Pool, class: &str, name: &str, signature: &str) {
        self.invoke(origin, pool, insn::INVOKESTATIC, class, name, signature);
    }

    pub fn invoke_virtual(&mut self, origin: &Origin, pool: &mut Pool, class: &str, name: &str, signature: &str) {
        self.invoke(origin, pool, insn::INVOKEVIRTUAL, class, name, signature);
    }

    pub fn invoke_special(&mut self, origin: &Origin, pool: &mut Pool, class: &str, name: &str, signature: &str) {
        self.invoke(origin, pool, insn::INVOKESPECIAL, class, name, signature);
    }

    pub fn invoke_interface(&mut self, origin: &Origin, pool: &mut Pool, class: &str, name: &str, signature: &str) {
        self.invoke(origin, pool, insn::INVOKEINTERFACE, class, name, signature);
    }

    // ----- objects and arrays -------------------------------------------

    pub fn new_object(&mut self, origin: &Origin, pool: &mut Pool, class: &str) {
        let index = pool.class(class);
        self.op_u2(origin, insn::NEW, index, 0, 1);
    }

    /// `newarray` for a primitive element, `anewarray` for a reference one.
    pub fn new_array(&mut self, origin: &Origin, pool: &mut Pool, element: &str) {
        match insn::Kind::of(element) {
            Some(Kind::Ref) => {
                let index = pool.class(&descriptor::class_operand(element));
                self.op_u2(origin, insn::ANEWARRAY, index, 1, 1);
            }
            Some(_) => {
                self.emit(origin, &[insn::NEWARRAY, insn::array_type(element)], 1, 1);
            }
            None => self.fail(Error::BadDescriptor(element.to_owned())),
        }
    }

    pub fn array_length(&mut self, origin: &Origin) {
        self.op(origin, insn::ARRAYLENGTH, 1, 1);
    }

    /// `iaload`..`aaload`, plus the three narrow forms a `byte`, `char` or
    /// `short` array needs.
    pub fn array_load(&mut self, origin: &Origin, element: &str) {
        let opcode = match element.as_bytes().first() {
            Some(b'B' | b'Z') => insn::BALOAD,
            Some(b'C') => insn::CALOAD,
            Some(b'S') => insn::SALOAD,
            _ => {
                let Some(kind) = Kind::of(element) else {
                    self.fail(Error::BadDescriptor(element.to_owned()));
                    return;
                };
                insn::ARRAY_LOAD + kind as u8
            }
        };
        let pushes = descriptor::words(element);
        self.op(origin, opcode, 2, pushes);
    }

    pub fn array_store(&mut self, origin: &Origin, element: &str) {
        let opcode = match element.as_bytes().first() {
            Some(b'B' | b'Z') => insn::BASTORE,
            Some(b'C') => insn::CASTORE,
            Some(b'S') => insn::SASTORE,
            _ => {
                let Some(kind) = Kind::of(element) else {
                    self.fail(Error::BadDescriptor(element.to_owned()));
                    return;
                };
                insn::ARRAY_STORE + kind as u8
            }
        };
        self.op(origin, opcode, 2 + descriptor::words(element), 0);
    }

    pub fn check_cast(&mut self, origin: &Origin, pool: &mut Pool, ty: &str) {
        let index = pool.class(&descriptor::class_operand(ty));
        self.op_u2(origin, insn::CHECKCAST, index, 1, 1);
    }

    pub fn instance_of(&mut self, origin: &Origin, pool: &mut Pool, ty: &str) {
        let index = pool.class(&descriptor::class_operand(ty));
        self.op_u2(origin, insn::INSTANCEOF, index, 1, 1);
    }

    pub fn dup(&mut self, origin: &Origin) {
        self.op(origin, insn::DUP, 0, 1);
    }

    pub fn pop(&mut self, origin: &Origin, words: u16) {
        let opcode = if words == 2 { insn::POP2 } else { insn::POP };
        self.op(origin, opcode, words, 0);
    }

    // ----- finishing ----------------------------------------------------

    /// Resolve every branch and hand back the body, or the first thing that
    /// went wrong.
    pub fn finish(mut self, pool: &Pool) -> Result<Body, Error> {
        if pool.overflowed() {
            self.fail(Error::PoolOverflow);
        }
        // 65,534 rather than 65,535: `code_length` is a `u4` in the file, but
        // JVMS 4.9.1 caps a method at 65,535 bytes and an offset must be able
        // to name one past the end.
        if self.bytes.len() > 65_534 {
            self.fail(Error::CodeTooLong(self.bytes.len()));
        }
        for fixup in &self.fixups {
            let Some(Some(to)) = self.labels.get(fixup.label.0 as usize).copied() else {
                if self.error.is_none() {
                    self.error = Some(Error::UnboundLabel);
                }
                continue;
            };
            let distance = i64::from(to) - i64::from(fixup.from);
            let Ok(narrow) = i16::try_from(distance) else {
                if self.error.is_none() {
                    self.error = Some(Error::BranchOutOfRange { at: fixup.from, distance });
                }
                continue;
            };
            let [hi, lo] = narrow.to_be_bytes();
            if let Some(slot) = self.bytes.get_mut(fixup.operand as usize) {
                *slot = hi;
            }
            if let Some(slot) = self.bytes.get_mut(fixup.operand as usize + 1) {
                *slot = lo;
            }
        }
        if let Some(error) = self.error {
            return Err(error);
        }
        self.frame_offsets.sort_unstable();
        self.frame_offsets.dedup();
        Ok(Body {
            max_stack: u16::try_from(self.max_stack).unwrap_or(u16::MAX),
            max_locals: self.max_locals,
            code: self.bytes,
            origins: self.origins,
            frame_offsets: self.frame_offsets,
            locals: self.locals,
        })
    }
}

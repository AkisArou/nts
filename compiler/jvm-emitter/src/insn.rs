//! Opcodes, and the regularity in them worth exploiting.
//!
//! The JVM's instruction set is laid out in families: `iload` `lload` `fload`
//! `dload` `aload` are consecutive, and so are `istore..astore`, `ireturn..
//! areturn`, `iadd..dadd`, `iaload..aaload`. So a [`Kind`] that knows its
//! position in that ordering collapses five near-identical emitters into one,
//! and -- more usefully -- makes it impossible to write `dstore` where `dload`
//! was meant, because neither name is ever typed.

/// A value's machine kind, which is what decides an opcode and a slot width.
///
/// The discriminant is the offset within each opcode family, so
/// `LOAD + kind as u8` is that kind's load. That is a fact about the
/// instruction set rather than a coincidence: JVMS orders every typed family
/// int, long, float, double, reference.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Kind {
    Int = 0,
    Long = 1,
    Float = 2,
    Double = 3,
    Ref = 4,
}

impl Kind {
    /// Stack words, and local slots -- the same number, which is why the JVM
    /// calls both "category".
    #[must_use]
    pub const fn words(self) -> u16 {
        match self {
            Self::Long | Self::Double => 2,
            _ => 1,
        }
    }

    #[must_use]
    pub const fn descriptor(self) -> &'static str {
        match self {
            Self::Int => "I",
            Self::Long => "J",
            Self::Float => "F",
            Self::Double => "D",
            Self::Ref => "Ljava/lang/Object;",
        }
    }

    /// The kind a field or method descriptor names.
    ///
    /// `B`, `C`, `S` and `Z` are all `Int`: the JVM has no narrower
    /// computational type, and a `byte` field holds an `int` on the stack. The
    /// narrowing happens at the store, which is why `i2b` exists.
    #[must_use]
    pub fn of(descriptor: &str) -> Option<Self> {
        match descriptor.as_bytes().first()? {
            b'B' | b'C' | b'I' | b'S' | b'Z' => Some(Self::Int),
            b'J' => Some(Self::Long),
            b'F' => Some(Self::Float),
            b'D' => Some(Self::Double),
            b'L' | b'[' => Some(Self::Ref),
            _ => None,
        }
    }
}

pub const ACONST_NULL: u8 = 0x01;
pub const ICONST_0: u8 = 0x03;
pub const LCONST_0: u8 = 0x09;
pub const FCONST_0: u8 = 0x0b;
pub const DCONST_0: u8 = 0x0e;
pub const BIPUSH: u8 = 0x10;
pub const SIPUSH: u8 = 0x11;
pub const LDC: u8 = 0x12;
pub const LDC_W: u8 = 0x13;
pub const LDC2_W: u8 = 0x14;

/// `iload`. `+ Kind` gives the family; `LOAD_0 + Kind * 4 + slot` gives the
/// one-byte form for slots 0 to 3.
pub const LOAD: u8 = 0x15;
pub const LOAD_0: u8 = 0x1a;
pub const ARRAY_LOAD: u8 = 0x2e;
pub const BALOAD: u8 = 0x33;
pub const CALOAD: u8 = 0x34;
pub const SALOAD: u8 = 0x35;
pub const STORE: u8 = 0x36;
pub const STORE_0: u8 = 0x3b;
pub const ARRAY_STORE: u8 = 0x4f;
pub const BASTORE: u8 = 0x54;
pub const CASTORE: u8 = 0x55;
pub const SASTORE: u8 = 0x56;

pub const POP: u8 = 0x57;
pub const POP2: u8 = 0x58;
pub const DUP: u8 = 0x59;
pub const DUP_X1: u8 = 0x5a;
pub const DUP_X2: u8 = 0x5b;
pub const DUP2: u8 = 0x5c;
pub const SWAP: u8 = 0x5f;

pub const ADD: u8 = 0x60;
pub const SUB: u8 = 0x64;
pub const MUL: u8 = 0x68;
pub const DIV: u8 = 0x6c;
pub const REM: u8 = 0x70;
pub const NEG: u8 = 0x74;
/// `ishl`. Integral only, so `+ 0` is int and `+ 1` is long.
pub const SHL: u8 = 0x78;
pub const SHR: u8 = 0x7a;
pub const USHR: u8 = 0x7c;
pub const AND: u8 = 0x7e;
pub const OR: u8 = 0x80;
pub const XOR: u8 = 0x82;
pub const IINC: u8 = 0x84;

pub const I2L: u8 = 0x85;
pub const I2F: u8 = 0x86;
pub const I2D: u8 = 0x87;
pub const L2I: u8 = 0x88;
pub const L2F: u8 = 0x89;
pub const L2D: u8 = 0x8a;
pub const F2I: u8 = 0x8b;
pub const F2L: u8 = 0x8c;
pub const F2D: u8 = 0x8d;
pub const D2I: u8 = 0x8e;
pub const D2L: u8 = 0x8f;
pub const D2F: u8 = 0x90;
pub const I2B: u8 = 0x91;
pub const I2C: u8 = 0x92;
pub const I2S: u8 = 0x93;

pub const LCMP: u8 = 0x94;
pub const FCMPL: u8 = 0x95;
pub const FCMPG: u8 = 0x96;
pub const DCMPL: u8 = 0x97;
pub const DCMPG: u8 = 0x98;

pub const IFEQ: u8 = 0x99;
pub const IF_ICMPEQ: u8 = 0x9f;
pub const IF_ACMPEQ: u8 = 0xa5;
pub const GOTO: u8 = 0xa7;
pub const RETURN_TYPED: u8 = 0xac;
pub const RETURN_VOID: u8 = 0xb1;

pub const GETSTATIC: u8 = 0xb2;
pub const PUTSTATIC: u8 = 0xb3;
pub const GETFIELD: u8 = 0xb4;
pub const PUTFIELD: u8 = 0xb5;
pub const INVOKEVIRTUAL: u8 = 0xb6;
pub const INVOKESPECIAL: u8 = 0xb7;
pub const INVOKESTATIC: u8 = 0xb8;
pub const INVOKEINTERFACE: u8 = 0xb9;

pub const NEW: u8 = 0xbb;
pub const NEWARRAY: u8 = 0xbc;
pub const ANEWARRAY: u8 = 0xbd;
pub const ARRAYLENGTH: u8 = 0xbe;
pub const ATHROW: u8 = 0xbf;
pub const CHECKCAST: u8 = 0xc0;
pub const INSTANCEOF: u8 = 0xc1;
pub const WIDE: u8 = 0xc4;
pub const IFNULL: u8 = 0xc6;
pub const IFNONNULL: u8 = 0xc7;
pub const GOTO_W: u8 = 0xc8;

/// A comparison against zero, or between two values of the same kind.
///
/// Named rather than spelled as opcodes because getting `ge` where `gt` was
/// meant is a silent wrong answer, and because the branch families are
/// consecutive in exactly this order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Compare {
    Eq = 0,
    Ne = 1,
    Lt = 2,
    Ge = 3,
    Gt = 4,
    Le = 5,
}

impl Compare {
    /// The comparison that is true exactly when this one is false.
    ///
    /// Needed because a two-way HIR `Branch` becomes one conditional jump and
    /// one fallthrough, and which arm falls through is decided by the block
    /// order rather than by the source.
    #[must_use]
    pub const fn inverted(self) -> Self {
        match self {
            Self::Eq => Self::Ne,
            Self::Ne => Self::Eq,
            Self::Lt => Self::Ge,
            Self::Ge => Self::Lt,
            Self::Gt => Self::Le,
            Self::Le => Self::Gt,
        }
    }
}

/// The `newarray` operand for a primitive element type. JVMS table 6.5.
#[must_use]
pub const fn array_type(kind: Kind) -> u8 {
    match kind {
        Kind::Int => 10,
        Kind::Long => 11,
        Kind::Float => 6,
        Kind::Double => 7,
        // Not a primitive; `anewarray` takes a class instead. Returning the
        // int code here would silently build the wrong array, so callers must
        // branch on `Kind::Ref` before asking -- which `Code::new_array` does.
        Kind::Ref => 0,
    }
}

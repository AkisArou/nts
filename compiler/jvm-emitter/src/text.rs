//! A javap-style listing, disassembled from the bytes rather than recorded
//! while writing them.
//!
//! # Why disassemble what we just encoded
//!
//! The LLVM backend exists partly because textual IR is legible: "reading
//! `program.c` diagnosed three separate bugs in one week", and that legibility
//! was worth keeping in the backend meant to become primary. Bytecode has no
//! text form of its own, so this is it.
//!
//! It is deliberately a *decoder* and not a log. A listing recorded at emit
//! time would print what the emitter meant; this prints what the emitter
//! wrote, so `nts emit-jvm --text` and `javap -c` are two independent readings
//! of the same bytes and a disagreement between them is an encoding bug -- the
//! same argument that makes the C backend an oracle for the LLVM one.

use std::fmt::Write as _;

use crate::code::Body;

/// Mnemonics by opcode. JVMS chapter 6, in order.
#[rustfmt::skip]
const MNEMONIC: [&str; 202] = [
    "nop", "aconst_null", "iconst_m1", "iconst_0", "iconst_1", "iconst_2", "iconst_3",
    "iconst_4", "iconst_5", "lconst_0", "lconst_1", "fconst_0", "fconst_1", "fconst_2",
    "dconst_0", "dconst_1", "bipush", "sipush", "ldc", "ldc_w", "ldc2_w",
    "iload", "lload", "fload", "dload", "aload",
    "iload_0", "iload_1", "iload_2", "iload_3",
    "lload_0", "lload_1", "lload_2", "lload_3",
    "fload_0", "fload_1", "fload_2", "fload_3",
    "dload_0", "dload_1", "dload_2", "dload_3",
    "aload_0", "aload_1", "aload_2", "aload_3",
    "iaload", "laload", "faload", "daload", "aaload", "baload", "caload", "saload",
    "istore", "lstore", "fstore", "dstore", "astore",
    "istore_0", "istore_1", "istore_2", "istore_3",
    "lstore_0", "lstore_1", "lstore_2", "lstore_3",
    "fstore_0", "fstore_1", "fstore_2", "fstore_3",
    "dstore_0", "dstore_1", "dstore_2", "dstore_3",
    "astore_0", "astore_1", "astore_2", "astore_3",
    "iastore", "lastore", "fastore", "dastore", "aastore", "bastore", "castore", "sastore",
    "pop", "pop2", "dup", "dup_x1", "dup_x2", "dup2", "dup2_x1", "dup2_x2", "swap",
    "iadd", "ladd", "fadd", "dadd", "isub", "lsub", "fsub", "dsub",
    "imul", "lmul", "fmul", "dmul", "idiv", "ldiv", "fdiv", "ddiv",
    "irem", "lrem", "frem", "drem", "ineg", "lneg", "fneg", "dneg",
    "ishl", "lshl", "ishr", "lshr", "iushr", "lushr",
    "iand", "land", "ior", "lor", "ixor", "lxor", "iinc",
    "i2l", "i2f", "i2d", "l2i", "l2f", "l2d", "f2i", "f2l", "f2d",
    "d2i", "d2l", "d2f", "i2b", "i2c", "i2s",
    "lcmp", "fcmpl", "fcmpg", "dcmpl", "dcmpg",
    "ifeq", "ifne", "iflt", "ifge", "ifgt", "ifle",
    "if_icmpeq", "if_icmpne", "if_icmplt", "if_icmpge", "if_icmpgt", "if_icmple",
    "if_acmpeq", "if_acmpne", "goto", "jsr", "ret", "tableswitch", "lookupswitch",
    "ireturn", "lreturn", "freturn", "dreturn", "areturn", "return",
    "getstatic", "putstatic", "getfield", "putfield",
    "invokevirtual", "invokespecial", "invokestatic", "invokeinterface", "invokedynamic",
    "new", "newarray", "anewarray", "arraylength", "athrow", "checkcast", "instanceof",
    "monitorenter", "monitorexit", "wide", "multianewarray", "ifnull", "ifnonnull",
    "goto_w", "jsr_w",
];

/// How an opcode's operands are shaped, for both width and rendering.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Operands {
    None,
    /// An unsigned byte -- a local slot or a `ldc` index.
    Byte,
    /// A signed byte, which `bipush` is and a slot is not.
    SignedByte,
    Short,
    /// A constant pool index, rendered `#n`.
    Pool,
    /// A branch, rendered as the absolute target rather than the delta -- the
    /// delta is what is encoded and the target is what a reader wants.
    Branch,
    WideBranch,
    /// `iinc`: a slot and a signed increment.
    IncrementSlot,
    /// `invokeinterface`: a pool index, a count, and a reserved zero.
    Interface,
}

fn operands(opcode: u8) -> Operands {
    match opcode {
        0x10 => Operands::SignedByte,
        0x11 => Operands::Short,
        0x12..=0x14 | 0xb2..=0xb8 | 0xbb | 0xbd | 0xc0 | 0xc1 => Operands::Pool,
        0x15..=0x19 | 0x36..=0x3a | 0xa9 | 0xbc => Operands::Byte,
        0x84 => Operands::IncrementSlot,
        0x99..=0xa8 | 0xc6 | 0xc7 => Operands::Branch,
        0xc8 | 0xc9 => Operands::WideBranch,
        0xb9 | 0xba => Operands::Interface,
        // `tableswitch`, `lookupswitch`, `wide` and `multianewarray` have
        // variable or padded operands. Nothing here emits one, and a decoder
        // that guessed would produce a listing that silently drifts from the
        // bytes -- which is the one thing this file exists not to do.
        _ => Operands::None,
    }
}

const fn width(operands: Operands) -> usize {
    match operands {
        Operands::None => 0,
        Operands::Byte | Operands::SignedByte => 1,
        Operands::Short | Operands::Pool | Operands::Branch | Operands::IncrementSlot => 2,
        Operands::WideBranch | Operands::Interface => 4,
    }
}

/// One method's code, as text.
///
/// Every line is `offset: mnemonic operands`, which is `javap -c`'s shape
/// without its constant-pool comments -- those need the pool, and the point of
/// this listing is to be readable without one. A `>` in the first column marks
/// an offset carrying a stack map frame, which is where a verifier message
/// will point.
#[must_use]
pub fn listing(body: &Body) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "  stack={} locals={} code={} frames={}",
        body.max_stack,
        body.max_locals,
        body.code.len(),
        body.frame_offsets.len()
    );
    let mut at = 0usize;
    while at < body.code.len() {
        let opcode = body.code[at];
        let name = MNEMONIC.get(opcode as usize).copied().unwrap_or("<unknown>");
        let shape = operands(opcode);
        let size = width(shape);
        if at + 1 + size > body.code.len() {
            let _ = writeln!(out, " {at:5}: {name} <truncated>");
            break;
        }
        let bytes = &body.code[at + 1..at + 1 + size];
        let here = i64::try_from(at).unwrap_or(i64::MAX);
        let rendered = match shape {
            Operands::None => String::new(),
            Operands::Byte => format!(" {}", bytes[0]),
            Operands::SignedByte => format!(" {}", bytes[0].cast_signed()),
            Operands::Short => format!(" {}", i16::from_be_bytes([bytes[0], bytes[1]])),
            Operands::Pool | Operands::Interface => {
                format!(" #{}", u16::from_be_bytes([bytes[0], bytes[1]]))
            }
            Operands::Branch => {
                let delta = i64::from(i16::from_be_bytes([bytes[0], bytes[1]]));
                format!(" {}", here + delta)
            }
            Operands::WideBranch => {
                let delta = i64::from(i32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]));
                format!(" {}", here + delta)
            }
            Operands::IncrementSlot => format!(" {}, {}", bytes[0], bytes[1].cast_signed()),
        };
        let framed = u16::try_from(at).is_ok_and(|at| body.frame_offsets.contains(&at));
        let marker = if framed { ">" } else { " " };
        let _ = writeln!(out, "{marker}{at:5}: {name}{rendered}");
        at += 1 + size;
    }
    out
}

//! Which of a Java method's parameters outlive the call.
//!
//! # What this is for, and what it is worth
//!
//! `hir::escape` assumes every argument to a bound Java call escapes, because
//! it cannot see through the callee. That is sound and pessimistic: an object
//! handed to a method that only *reads* it is pushed to the heap for nothing.
//! The plan's `keeps` table exists to say otherwise, and the jar has the
//! callee's bytecode, so for a method with a body the answer is computable
//! rather than declarable.
//!
//! # The analysis, and why it is deliberately crude
//!
//! An abstract stack whose entries are either "this is parameter *n*" or
//! "something else". `aload_n` pushes the first, everything else pushes the
//! second, and an instruction that could let a value outlive the call marks
//! whatever it consumes as escaped.
//!
//! **Conservative at every fork**, in three specific ways that each cost
//! precision and buy soundness:
//!
//! - **Any `invoke` escapes the whole stack.** Resolving the callee's argument
//!   count means walking `Methodref` to `NameAndType` to a descriptor, and
//!   even then the callee's own behaviour is unknown without recursing. So a
//!   method that passes a parameter to `System.arraycopy` is reported as
//!   escaping, though `arraycopy` retains nothing.
//! - **A branch target resets the stack.** Real merging needs the frame
//!   information; `javac` leaves the stack empty at almost every branch target,
//!   so this is nearly exact in practice and always safe.
//! - **An unknown opcode abandons the method**, answering "everything
//!   escapes". A misparse must not be able to produce a *permissive* answer.
//! - **An opcode whose stack *effect* is not modelled marks the whole stack as
//!   escaped.** Distinct from the point above, and the distinction is where the
//!   bug was: that one is about an opcode whose *width* is unknown, so the walk
//!   cannot continue at all; this one is about an opcode the walk steps over
//!   correctly while not knowing what it did to the operands.
//!
//! The result is a yes-or-no that is only ever wrong in the direction that
//! costs speed, never correctness -- which is the same trade `hir::escape`
//! already makes, moved one level in.
//!
//! **That fourth point was missing from this list, and it is exactly where the
//! analysis failed open.** The first version cleared the stack and pushed
//! "something else" for an unmodelled effect, which *discards the evidence*:
//! `FilterOutputStream.write(byte[])` calls `write(b, 0, b.length)` and came
//! back `escaping=[]`, because `b` left the model at `arraylength` two
//! instructions before the `invoke` that publishes it. The header enumerated
//! the conservative choices and the one it did not enumerate is the one that
//! was not made.
//!
//! # A body that always throws is not evidence, and this nearly shipped
//!
//! `android.jar` is a **stub** jar. Every method in it has a body, and every
//! body is:
//!
//! ```text
//! new java/lang/RuntimeException; dup; ldc "Stub!"; invokespecial; athrow
//! ```
//!
//! The parameter is never loaded, so a reader that only asks "did anything
//! publish it" answers **nothing escapes** -- about a method whose real
//! implementation, on the device, may retain everything. That is a *permissive*
//! wrong answer, and it is the one direction this analysis must never fail in.
//!
//! Measured before the guard: 600 classes of `android.jar` gave **2,411 of
//! 2,724** methods "proved non-escaping", an 88.5% yield. A number that looks
//! like a spectacular result and is entirely an artefact of the stubs.
//!
//! So: **a body with no return instruction never returns normally, and tells
//! you nothing about its parameters.** That is not a stub-specific hack -- it
//! is true of any method that only throws, and it is exactly the class of body
//! whose bytecode is not its behaviour.

use crate::class::access;
use crate::read::Member;

/// What a method does with its parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Keeps {
    /// Parameter indices, in declaration order, that may outlive the call.
    pub escaping: Vec<usize>,
    /// Whether the analysis ran at all. `false` for an `abstract` or `native`
    /// method, where `escaping` is meaningless and every caller must assume
    /// the worst.
    pub analysed: bool,
}

impl Keeps {
    /// The pessimistic answer: everything escapes, nothing was analysed.
    fn unknown(count: usize) -> Self {
        Self { escaping: (0..count).collect(), analysed: false }
    }
}


/// The local slot each declared parameter occupies, in order.
///
/// `long` and `double` take **two** slots, which is the same rule the constant
/// pool has for `Long` and `Double` and is wrong in the same invisible way: a
/// method taking `(JI)V` has its `int` at slot 3, not slot 2.
fn parameter_slots(descriptor: &str, is_static: bool) -> Option<Vec<u16>> {
    let open = descriptor.find('(')?;
    let close = descriptor.find(')')?;
    let mut slot: u16 = u16::from(!is_static);
    let mut slots = Vec::new();
    let mut rest = &descriptor[open + 1..close];
    while !rest.is_empty() {
        slots.push(slot);
        let wide = matches!(rest.as_bytes()[0], b'J' | b'D');
        let used = match rest.as_bytes()[0] {
            b'L' => rest.find(';').map_or(rest.len(), |it| it + 1),
            b'[' => {
                let mut at = 0;
                while rest.as_bytes().get(at) == Some(&b'[') {
                    at += 1;
                }
                if rest.as_bytes().get(at) == Some(&b'L') {
                    rest[at..].find(';').map_or(rest.len(), |it| at + it + 1)
                } else {
                    at + 1
                }
            }
            _ => 1,
        };
        slot += if wide { 2 } else { 1 };
        rest = &rest[used..];
    }
    Some(slots)
}

/// How many bytes an instruction occupies, including its operands.
///
/// `None` for an opcode this table does not know, which makes the caller
/// abandon the method rather than resynchronise on a byte that is really an
/// operand -- a misparse that kept walking would produce confident nonsense.
fn width(code: &[u8], at: usize) -> Option<usize> {
    let op = *code.get(at)?;
    Some(match op {
        // No operands: the constants, loads/stores by index, stack ops,
        // arithmetic, conversions, array element access, returns, throw.
        0x00..=0x0f | 0x1a..=0x35 | 0x3b..=0x83 | 0x85..=0x98 | 0xac..=0xb1 | 0xbe | 0xbf
        | 0xca => 1,
        // bipush, ldc, the by-index loads/stores, and newarray.
        0x10 | 0x12 | 0x15..=0x19 | 0x36..=0x3a | 0xbc => 2,
        // sipush, ldc_w, ldc2_w, the field and method refs, new, anewarray,
        // checkcast, instanceof, the 16-bit branches, iinc, newarray is 2.
        0x11 | 0x13 | 0x14 | 0x84 | 0x99..=0xa8 | 0xb2..=0xb8 | 0xbb | 0xbd | 0xc0 | 0xc1
        | 0xc6 | 0xc7 => 3,
        // multianewarray.
        0xc5 => 4,
        // invokeinterface, invokedynamic, goto_w, jsr_w.
        0xb9 | 0xba | 0xc8 | 0xc9 => 5,
        // wide: 4 bytes, or 6 when it prefixes iinc.
        0xc4 => {
            if code.get(at + 1) == Some(&0x84) {
                6
            } else {
                4
            }
        }
        0xaa => {
            // tableswitch: pad to a 4-byte boundary, then default, low, high,
            // then (high - low + 1) offsets.
            let pad = (4 - ((at + 1) % 4)) % 4;
            let base = at + 1 + pad;
            let low = i32::from_be_bytes([
                *code.get(base + 4)?,
                *code.get(base + 5)?,
                *code.get(base + 6)?,
                *code.get(base + 7)?,
            ]);
            let high = i32::from_be_bytes([
                *code.get(base + 8)?,
                *code.get(base + 9)?,
                *code.get(base + 10)?,
                *code.get(base + 11)?,
            ]);
            let count = usize::try_from(high.checked_sub(low)?.checked_add(1)?).ok()?;
            1 + pad + 12 + count * 4
        }
        0xab => {
            // lookupswitch: pad, default, npairs, then npairs * 8.
            let pad = (4 - ((at + 1) % 4)) % 4;
            let base = at + 1 + pad;
            let pairs = u32::from_be_bytes([
                *code.get(base + 4)?,
                *code.get(base + 5)?,
                *code.get(base + 6)?,
                *code.get(base + 7)?,
            ]) as usize;
            1 + pad + 8 + pairs * 8
        }
        _ => return None,
    })
}


/// Whether the instruction walk lands **exactly** on the end of the code.
///
/// # Why this is the only available check on the width table
///
/// [`width`] is a transcription of JVMS 6.5, and a transcription is a second
/// derivation of something this crate cannot otherwise verify: a wrong width
/// for a *known* opcode does not fail, it **desynchronises**. The walk resumes
/// a byte or two off, reads an operand as an opcode, and -- if that byte
/// happens to be a valid instruction, which at 200-odd assigned opcodes it
/// usually is -- keeps going confidently over nonsense.
///
/// An exact landing is a strong check for the same reason a checksum is: every
/// instruction's width has to be right for the total to come out, and being
/// wrong in one place almost never cancels against being wrong in another.
/// `tests/reads.rs` runs it over every method of `java.base`, which is
/// thousands of real methods `javac` produced and this table has to agree with.
fn walks_cleanly(code: &[u8]) -> bool {
    let mut at = 0usize;
    while at < code.len() {
        let Some(step) = width(code, at) else { return false };
        if step == 0 {
            return false;
        }
        at += step;
    }
    at == code.len()
}

/// One entry on the abstract stack.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Value {
    /// The value loaded from this local slot.
    Slot(u16),
    Other,
}

/// Which parameters of `method` may outlive a call to it.
#[must_use]
pub fn of(method: &Member) -> Keeps {
    let is_static = method.access & access::STATIC != 0;
    let Some(slots) = parameter_slots(&method.descriptor, is_static) else {
        return Keeps::unknown(0);
    };
    let Some(code) = method.code.as_ref() else {
        // `abstract` or `native`: there is nothing to read, and saying so is
        // different from saying "nothing escapes".
        return Keeps::unknown(slots.len());
    };

    // **Fail closed on a desynchronised walk.** If the instruction widths do
    // not add up to the code length exactly, this table disagrees with the
    // bytecode somewhere and every offset after that point is a guess.
    if !walks_cleanly(&code.bytes) {
        return Keeps::unknown(slots.len());
    }

    // Every offset that is a branch target, so the stack can be reset there.
    let mut targets = Vec::new();
    let mut at = 0usize;
    while at < code.bytes.len() {
        let Some(step) = width(&code.bytes, at) else { return Keeps::unknown(slots.len()) };
        let op = code.bytes[at];
        if (0x99..=0xa8).contains(&op) || op == 0xc6 || op == 0xc7 {
            let offset = i32::from(i16::from_be_bytes([code.bytes[at + 1], code.bytes[at + 2]]));
            if let Ok(target) = usize::try_from(i64::try_from(at).unwrap_or(i64::MAX) + i64::from(offset)) {
                targets.push(target);
            }
        }
        at += step;
    }

    // **A body that cannot return normally is not evidence.** See the module
    // header: `android.jar`'s stubs all throw, never load their parameters, and
    // would otherwise be reported as retaining nothing.
    let mut returns = false;
    let mut at = 0usize;
    while at < code.bytes.len() {
        let Some(step) = width(&code.bytes, at) else { return Keeps::unknown(slots.len()) };
        if (0xac..=0xb1).contains(&code.bytes[at]) {
            returns = true;
            break;
        }
        at += step;
    }
    if !returns {
        return Keeps::unknown(slots.len());
    }

    let mut escaped = vec![false; slots.len()];
    let mut stack: Vec<Value> = Vec::new();
    let mark = |stack: &mut Vec<Value>, escaped: &mut Vec<bool>, how_many: usize| {
        for _ in 0..how_many.min(stack.len()) {
            if let Some(Value::Slot(slot)) = stack.pop()
                && let Some(index) = slots.iter().position(|it| *it == slot)
            {
                escaped[index] = true;
            }
        }
    };

    let mut at = 0usize;
    while at < code.bytes.len() {
        if targets.contains(&at) {
            stack.clear();
        }
        let Some(step) = width(&code.bytes, at) else { return Keeps::unknown(slots.len()) };
        let op = code.bytes[at];
        match op {
            // aload_0 .. aload_3, and aload <index>.
            0x2a..=0x2d => stack.push(Value::Slot(u16::from(op - 0x2a))),
            0x19 => stack.push(Value::Slot(u16::from(code.bytes[at + 1]))),
            // Anything that can publish a reference consumes it.
            // putfield takes objectref and value; aastore takes array, index
            // and value; putstatic and areturn each take one. The counts are
            // operand counts, and over-popping is harmless because `mark`
            // stops at the bottom of the stack.
            0xb5 => mark(&mut stack, &mut escaped, 2),
            0x53 => mark(&mut stack, &mut escaped, 3),
            0xb3 | 0xb0 => mark(&mut stack, &mut escaped, 1),
            // Instructions whose stack effect is modelled exactly, because
            // they are the ones that stand between a parameter and the call
            // that publishes it.
            //
            // `arraylength`, `getfield`, `checkcast` and `instanceof` each pop
            // one and push one: without them, `write(b, 0, b.length)` loses
            // `b` from the model at `arraylength` and the `invoke` two
            // instructions later sees an empty stack.
            0xbe | 0xb4 | 0xc0 | 0xc1 => {
                stack.pop();
                stack.push(Value::Other);
            }
            // dup, and the constant/primitive pushes: they add an operand that
            // is certainly not a parameter reference.
            0x59 => {
                let top = stack.last().copied().unwrap_or(Value::Other);
                stack.push(top);
            }
            0x01..=0x14 | 0x1a..=0x29 | 0xbb => stack.push(Value::Other),
            // pop, and the primitive stores: they consume one operand.
            0x57 | 0x36..=0x38 | 0x3b..=0x4a => {
                stack.pop();
            }
            // **Any invoke, and everything else, fails CLOSED.**
            //
            // For an invoke: resolving the callee's arity is possible and its
            // *behaviour* is not, so the whole stack is assumed published.
            // For anything unmodelled: an instruction whose effect is unknown
            // might have published what it consumed, so the safe reading is
            // that it did. The two arms do the same thing for the same reason,
            // which is why they are one arm.
            //
            // The first version cleared the stack and pushed `Other` here,
            // which is the *opposite* -- it discarded the evidence and reported
            // non-escaping. `FilterOutputStream.write([B)V` calls
            // `write(b, 0, b.length)` and came back `escaping=[]`, which is a
            // permissive wrong answer about the textbook case.
            _ => {
                let depth = stack.len();
                mark(&mut stack, &mut escaped, depth);
            }
        }
        at += step;
    }

    Keeps {
        escaping: escaped
            .iter()
            .enumerate()
            .filter_map(|(index, yes)| yes.then_some(index))
            .collect(),
        analysed: true,
    }
}

/// The `keeps` table for a whole class, as the binding table will carry it.
///
/// One line per method the analysis could say something about, in the key
/// format `hir::runtime::foreign_key` defines -- `owner.member:descriptor` --
/// so the generator and `keeps` share **one** derivation of the key rather than
/// two that can drift.
///
/// **Methods the analysis could not read are omitted, not recorded as empty.**
/// An absent entry means "assume every argument escapes", which is always
/// sound; an empty entry means "proved: nothing escapes", which is a claim. A
/// table that wrote `[]` for an `abstract` method would turn ignorance into
/// permission, which is the failure this analysis has already made twice.
#[must_use]
pub fn table(class: &crate::read::ClassFile) -> Vec<(String, Vec<usize>)> {
    let mut rows = Vec::new();
    for method in &class.methods {
        if method.name.starts_with('<') {
            continue;
        }
        let kept = of(method);
        if !kept.analysed {
            continue;
        }
        rows.push((
            format!("{}.{}:{}", class.binary_name, method.name, method.descriptor),
            kept.escaping,
        ));
    }
    rows
}

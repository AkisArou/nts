//! Writing JVM class files.
//!
//! # What this crate is, and what it deliberately is not
//!
//! This is the class file *format*, and it knows nothing about HIR. That split
//! is not tidiness: a verifier error is a message about bytes, and the only way
//! to debug one without simultaneously debugging a lowering is to be able to
//! hand-build a class, run it, and see. `tests/runs.rs` does exactly that, and
//! it is why this crate has no dependency on `nts-core`.
//!
//! It is also the class file *reader* that `nts bind` will need to turn a jar
//! into TypeScript declarations. The format is symmetric and the constant pool
//! is the same table read or written, so one crate serves both directions.
//!
//! # The two things it insists on
//!
//! - **Every instruction carries an [`Origin`](nts_semantic_schema::Origin).**
//!   There is no way to emit one without. RFC decision 20 requires provenance
//!   to survive into the artifact, and a builder that merely *offers* a way to
//!   record it gets it as often as somebody remembers.
//! - **The operand stack is empty at every block boundary.** [`code::Code::bind`]
//!   refuses otherwise. The whole `StackMapTable` design rests on it, so it is
//!   checked where it is established rather than trusted and discovered wrong
//!   in a verifier message.
//!
//! # Orientation
//!
//! ```text
//! pool        the constant pool, interned
//! descriptor  type spellings, and reading a call's stack effect back out
//! insn        opcodes, and the regularity that collapses five emitters to one
//! code        a method body: instructions, labels, branches, provenance
//! frames      StackMapTable -- eighty lines, for reasons the module explains
//! class       assembly and serialization
//! text        a javap-style listing, disassembled from the bytes we wrote
//! ```

pub mod class;
pub mod code;
pub mod descriptor;
pub mod frames;
pub mod insn;
pub mod pool;
pub mod text;

pub use class::{Class, ClassBuilder, FieldFromStatic, MAJOR_JAVA_5, MAJOR_JAVA_8, access};
pub use code::{Body, Code, Error, Label};
pub use frames::VType;
pub use insn::{Compare, Kind};
pub use pool::Pool;

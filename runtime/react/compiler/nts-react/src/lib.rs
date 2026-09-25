//! The React lane's compiler stage.
//!
//! Upstream's Rust React Compiler memoizes components; this crate feeds it,
//! types its output again from the original program, and writes a project nts
//! builds. See runtime/react/compiler/TYPED-OUTPUT.md for the design and the
//! measurements it rests on.

pub mod babel;

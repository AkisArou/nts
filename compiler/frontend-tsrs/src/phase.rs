//! Closed compile-time phases of a borrowed native program.

mod sealed {
    pub trait Sealed {}
}

/// A native view phase. Only the adapter's capture and syntax phases exist.
pub trait ViewPhase: sealed::Sealed + Copy + std::fmt::Debug + Eq + std::hash::Hash {}

/// Semantic questions are allowed, before any pool diagnostics run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CapturePhase {}

/// Syntax and metadata only, after diagnostics have finished.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SyntaxPhase {}

impl sealed::Sealed for CapturePhase {}
impl sealed::Sealed for SyntaxPhase {}
impl ViewPhase for CapturePhase {}
impl ViewPhase for SyntaxPhase {}

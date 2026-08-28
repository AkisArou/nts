//! Protocol tooling shared by the external correctness suites.
//!
//! The existing `nts-suite` binary owns corpus measurements and the numeric
//! Test262 extractor. The standards-facing Test262 protocol lives in this
//! library so its metadata, scheduling, and verdict logic can be tested without
//! invoking the compiler or linking a `NativeTS` runtime.

pub mod test262_runner;

//! What the backend a program is prepared for provides.
//!
//! The first slice of one mechanism for builtins: a target says which runtime
//! helpers it provides, from the one table each backend already keeps, and the
//! compiler answers a program's `typeof` of an `@ntsAbi intrinsic` declaration
//! from it -- `"function"` where the helper is there, `"undefined"` where it is
//! not -- while preparing that backend's branch. So one TypeScript source can
//! call a native helper where a target has it and keep its own body elsewhere:
//!
//! ```ts
//! /** @ntsAbi intrinsic */
//! declare function nts_json_quote(value: string): string;
//!
//! export function quoteJSONString(value: string): string {
//!   if (typeof nts_json_quote === "function") return nts_json_quote(value);
//!   // the TypeScript body, which node, Bun and every target without the helper run
//! }
//! ```
//!
//! Lowering is shared by every backend, so it cannot answer; it leaves the
//! question as [`super::OpKind::Provided`], and [`fold_provided`] answers it as
//! the first step of each branch's preparation. The comparison then folds, the
//! branch with it, and the arm a target cannot run is pruned before anything
//! that target emits could see the call.

use super::{OpKind, Program};

/// Which runtime helpers a backend provides, asked by name.
///
/// Each backend's own table is the one truth: the C runtime's header for C and
/// LLVM (the LLVM signature table, generated from it and checked against it),
/// and the JVM's closed table. Every driver names the table for its backend
/// (`nts_codegen_llvm::provides` or `nts_codegen_jvm::provides`).
#[derive(Debug, Clone, Copy, Default)]
pub enum Provided {
    /// No backend named, so nothing is provided. Always safe: the arm a guard
    /// keeps is the TypeScript body, which every target runs, so a driver that
    /// forgets to say costs speed and never correctness.
    #[default]
    Nothing,
    /// The backend's answer.
    By(fn(&str) -> bool),
}

impl Provided {
    /// Whether the backend provides `helper`.
    #[must_use]
    pub fn provides(self, helper: &str) -> bool {
        match self {
            Self::Nothing => false,
            Self::By(provides) => provides(helper),
        }
    }
}

/// Answer every `typeof` of an intrinsic in `program` for the backend
/// `provided` describes, and say how many there were.
pub fn fold_provided(program: &mut Program, provided: Provided) -> usize {
    let mut folded = 0;
    for func in &mut program.funcs {
        for op in &mut func.values {
            if let OpKind::Provided(helper) = &op.kind {
                let answer = if provided.provides(helper) {
                    "function"
                } else {
                    "undefined"
                };
                op.kind = OpKind::ConstString(answer.to_owned().into());
                folded += 1;
            }
        }
    }
    folded
}

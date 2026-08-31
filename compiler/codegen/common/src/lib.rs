//! The decisions every backend would otherwise make separately.
//!
//! # Why this crate exists
//!
//! The risk in a multi-backend compiler is not ugly emitters — it is two of them
//! answering one question differently. The proof of concept measured that:
//! record 0004 found two backends spelling one predicate two ways, and the cost
//! was a divergence only a differential test caught.
//!
//! So the shared work lives here and the emitters get none of it. Block order,
//! SSA destruction, and storage assignment are decided once, and a C or JVM
//! emitter downstream is a printer with no choices left to make.
//!
//! LLVM is the exception by construction rather than by special case: it is an
//! SSA IR, so it consumes the block order and skips the destruction, mapping
//! block parameters onto phi nodes directly.

pub mod layout;
pub mod destruct;
pub mod linearize;
pub mod writer;

pub use destruct::{Copy, edge_copies};
pub use linearize::block_order;
pub use writer::CodeWriter;

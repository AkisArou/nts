//! `SemanticSnapshot` v1 — the versioned, serializable frontend output.
//!
//! # Representation
//!
//! Everything is a flat `Vec` indexed by a newtype id. No `Rc`, no `RefCell`,
//! no back-pointers. This is deliberate and is the single hardest decision to
//! reverse later:
//!
//! - the whole snapshot serializes with `postcard` in one pass;
//! - ids are `Copy` and 4 bytes, so analysis maps stay small;
//! - a cache key is a digest over the bytes, not a graph walk;
//! - cycles in the *data* (a type referring to itself) cost nothing, because
//!   the reference is an index rather than a pointer.
//!
//! # Versioning
//!
//! [`SCHEMA_VERSION`] participates in every cache key. Changing any type in this
//! module without bumping it will serve stale artifacts, so the bump is not
//! optional bookkeeping — it is the correctness mechanism.

use nts_diagnostics::{Location, SourceFile};
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

use crate::origin::Origin;

/// Bump on **any** change to the types in this module.
///
/// RFC §7.1: the snapshot is versioned. `nts-build` folds this into every
/// action-cache key, so a stale snapshot cannot be silently reused across a
/// schema change.
pub const SCHEMA_VERSION: u32 = 6;

/// A TypeScript symbol, as the checker resolved it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct SymbolId(pub u32);

/// A TypeScript type, as the checker computed it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct TypeId(pub u32);

/// A call signature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct SignatureId(pub u32);

/// A node in the flattened AST.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct NodeId(pub u32);

/// A module in the source graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ModuleId(pub u32);

/// The complete semantic view of one compilation.
///
/// Produced by a [`crate::SemanticSource`]; consumed by `nts-core`. Nothing
/// downstream of this type is permitted to call the TypeScript checker.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SemanticSnapshot {
    /// Must equal [`SCHEMA_VERSION`]; checked by [`SemanticSnapshot::validate`].
    pub schema_version: u32,
    /// Indexed by `nts_diagnostics::SourceId`.
    pub sources: Vec<SourceFile>,
    /// Indexed by [`ModuleId`].
    pub modules: Vec<ModuleRecord>,
    /// Indexed by [`SymbolId`].
    pub symbols: Vec<SymbolRecord>,
    /// Indexed by [`TypeId`].
    pub types: Vec<TypeRecord>,
    /// Indexed by [`SignatureId`].
    pub signatures: Vec<SignatureRecord>,
    /// Indexed by [`NodeId`]. Flattened from tsgo's encoded AST.
    pub nodes: Vec<NodeRecord>,
    /// Which signature each call site resolves to.
    ///
    /// The difference between emitting a static call and emitting a dispatch. A
    /// backend that does not know the callee has to go through a function value;
    /// one that does can emit `call helper` and inline it.
    pub call_targets: FxHashMap<NodeId, CallTarget>,
    /// What the checker said about this program.
    ///
    /// A snapshot is produced even when the program does not typecheck, because
    /// an editor or a diagnostic run wants it either way. Deciding whether to
    /// *build* is a separate question — see [`SemanticSnapshot::has_errors`].
    pub diagnostics: Vec<nts_diagnostics::Diagnostic>,
    /// Type assigned to a node, for the nodes that have one.
    ///
    /// Sparse on purpose: only nodes the lowering actually needs a type for are
    /// queried, which is what keeps the frontend's round-trip count bounded by
    /// file count rather than node count.
    pub node_types: FxHashMap<NodeId, TypeId>,
}

/// Modifiers written on a declaration.
///
/// Derived from the declaration's own modifier keywords, so this costs no round
/// trips — but it is stored rather than re-walked, because scanning children for
/// keyword kinds at every use is the kind of thing that gets written slightly
/// differently in each backend.
///
/// These map close to directly onto emission: `static`, `abstract` and `final`
/// (from `readonly`) are JVM access flags on `method_info` and `field_info`, and
/// `async` decides whether a function lowers to a state machine at all (RFC §12).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Hash, Serialize, Deserialize)]
pub struct DeclarationModifiers(pub u16);

impl DeclarationModifiers {
    pub const EXPORT: Self = Self(1 << 0);
    pub const DEFAULT: Self = Self(1 << 1);
    pub const DECLARE: Self = Self(1 << 2);
    pub const ABSTRACT: Self = Self(1 << 3);
    pub const STATIC: Self = Self(1 << 4);
    pub const READONLY: Self = Self(1 << 5);
    pub const ASYNC: Self = Self(1 << 6);
    pub const OVERRIDE: Self = Self(1 << 7);
    pub const PUBLIC: Self = Self(1 << 8);
    pub const PRIVATE: Self = Self(1 << 9);
    pub const PROTECTED: Self = Self(1 << 10);
    /// `const` as a modifier, as on `const enum`. Not the `const` of a variable
    /// declaration — that lives in [`NodeRecord::flags`].
    pub const CONST: Self = Self(1 << 11);

    #[must_use]
    pub const fn contains(self, other: Self) -> bool {
        (self.0 & other.0) == other.0
    }

    #[must_use]
    pub const fn union(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }

    #[must_use]
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }
}

/// What a heritage clause declares.
///
/// A class carries one clause per keyword, and the clause's *node data* small
/// bits are the discriminator: `0` for `extends`, `1` for `implements`. Nothing
/// in the node kind distinguishes them, so reading the wrong field makes an
/// interface list look like a base class — which on the JVM is the difference
/// between `super_class` and the `interfaces` table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HeritageKind {
    Extends,
    Implements,
}

impl HeritageKind {
    /// Classify a `HeritageClause` from its node data.
    #[must_use]
    pub const fn from_data(data: NodeData) -> Self {
        match data {
            NodeData::Children { small: 0, .. } => Self::Extends,
            _ => Self::Implements,
        }
    }
}

/// How a variable was declared.
///
/// From `NodeFlags` on the `VariableDeclarationList`, not from the node data bits
/// the encoder documentation points at. `const` is what lets a backend treat a
/// binding as immutable without proving it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum VariableKind {
    Var,
    Let,
    Const,
}

impl VariableKind {
    /// Classify a `VariableDeclarationList` by its node flags.
    #[must_use]
    pub const fn from_flags(flags: u32) -> Self {
        // NodeFlags: Let = 1, Const = 2. Neither set means `var`.
        if flags & 2 != 0 {
            Self::Const
        } else if flags & 1 != 0 {
            Self::Let
        } else {
            Self::Var
        }
    }
}

/// What a call site reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallTarget {
    /// The signature the checker selected, after overload resolution.
    pub signature: SignatureId,
    /// The callee's declaration, when it is in the decoded program.
    ///
    /// `None` for a call into a file outside the decoded set — an imported or
    /// ambient function. The signature is still known, so the call can be typed
    /// exactly; only the direct symbol reference is unavailable.
    pub callee: Option<NodeId>,
}

/// One module in the source graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModuleRecord {
    pub file: nts_diagnostics::SourceId,
    /// Resolved module specifiers this module imports.
    pub imports: Vec<ModuleId>,
    /// Symbols this module exports, by exported name.
    pub exports: Vec<(String, SymbolId)>,
    /// Root node of the module's AST.
    pub root: NodeId,
}

/// A resolved symbol.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SymbolRecord {
    pub name: String,
    pub flags: SymbolFlags,
    /// Where the symbol is declared. A merged declaration has more than one.
    pub declarations: Vec<Location>,
    /// The symbol's type, if the checker resolved one.
    pub ty: Option<TypeId>,
}

/// What kind of entity a symbol names.
///
/// A bitflag rather than an enum because TypeScript genuinely merges kinds —
/// a class is a value and a type, a namespace can merge with a function.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SymbolFlags(pub u32);

impl SymbolFlags {
    pub const VARIABLE: Self = Self(1 << 0);
    pub const FUNCTION: Self = Self(1 << 1);
    pub const CLASS: Self = Self(1 << 2);
    pub const INTERFACE: Self = Self(1 << 3);
    pub const TYPE_ALIAS: Self = Self(1 << 4);
    pub const ENUM: Self = Self(1 << 5);
    pub const MODULE: Self = Self(1 << 6);
    pub const PROPERTY: Self = Self(1 << 7);
    pub const METHOD: Self = Self(1 << 8);

    #[must_use]
    pub const fn contains(self, other: Self) -> bool {
        (self.0 & other.0) == other.0
    }

    #[must_use]
    pub const fn union(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }
}

/// A type as the checker computed it.
///
/// This is a *projection* of TypeScript's type model, not a copy of it. Only
/// what the compiler needs to choose a representation and lower an operation
/// is recorded; variance annotations and inference state are not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypeRecord {
    pub kind: TypeKind,
    /// Set when the type came from a named declaration.
    pub symbol: Option<SymbolId>,
}

/// The closed set of type shapes the compiler understands.
///
/// RFC §4.1: reachable behavior either lowers statically or produces a precise
/// diagnostic. [`TypeKind::Unsupported`] is how the second case is represented —
/// it carries the checker's own rendering so the diagnostic can quote it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TypeKind {
    Any,
    Unknown,
    Never,
    Void,
    Undefined,
    Null,
    Boolean,
    Number,
    BigInt,
    String,
    Symbol,
    /// A literal type: `42`, `"ok"`, `true`.
    Literal(LiteralValue),
    /// A named object type, class instance, or interface.
    Object {
        properties: Vec<(String, TypeId)>,
    },
    Array(TypeId),
    Tuple(Vec<TypeId>),
    Union(Vec<TypeId>),
    Intersection(Vec<TypeId>),
    Function(SignatureId),
    /// An unresolved type parameter, before specialization.
    TypeParameter {
        name: String,
        constraint: Option<TypeId>,
    },
    /// A structured type the checker resolved but this snapshot has not
    /// decomposed into members yet.
    ///
    /// Objects, unions, intersections, tuples, and conditionals all reach here.
    /// Their members need follow-up queries that the frontend does not make in one
    /// pass, and recording an empty [`TypeKind::Object`] or [`TypeKind::Union`]
    /// instead would be indistinguishable from a genuinely empty one — a lie no
    /// later pass could detect. `flags` is the checker's own `TypeFlags`.
    Structured {
        flags: u32,
    },

    /// The checker produced something this schema does not model.
    ///
    /// Reaching one of these in a lowering is a diagnostic, never a silent
    /// fallback to a dynamic representation.
    Unsupported {
        rendered: String,
    },
}

/// The value of a literal type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LiteralValue {
    Boolean(bool),
    Number(f64),
    String(String),
    BigInt(String),
}

// `f64` is not `Eq`, but literal types are compared for identity rather than
// numeric equality, and the checker never produces a NaN literal type.
impl Eq for LiteralValue {}

/// A call signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignatureRecord {
    pub parameters: Vec<ParameterRecord>,
    pub return_type: TypeId,
    pub type_parameters: Vec<TypeId>,
    /// `async` in source. Lowering allocates a managed `AsyncFrame` (RFC §12).
    pub is_async: bool,
}

/// One parameter of a signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParameterRecord {
    pub name: String,
    pub ty: TypeId,
    pub optional: bool,
    pub rest: bool,
}

/// What kind of node this is.
///
/// A dedicated variant for lists rather than a magic number: tsgo encodes a
/// `NodeList` with the sentinel kind `0xFFFF_FFFF`, which does not fit a `u16`
/// and means something categorically different from a syntax kind. Making that
/// an enum stops the sentinel from being compared against real kinds by accident.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum NodeKind {
    /// tsgo's `SyntaxKind`, kept as a number so a tsgo bump that adds kinds does
    /// not require a schema change to *parse* — only to handle.
    Syntax(u16),
    /// A `NodeList`: the encoded parent of a syntactic group.
    List,
}

/// The tagged payload of a node's data field.
///
/// tsgo packs four things into one `u32`: a 2-bit type tag, 6 bits of per-kind
/// flags, and a 24-bit payload. Splitting it here means no downstream pass has to
/// remember which bits mean what — and in particular that a unary expression's
/// operator, which lives in the flag bits, is never mistaken for a string index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeData {
    /// Which of the node kind's child properties are present, as a bitmask in
    /// visitor order.
    Children { present: u8, small: u8 },
    /// Index into the encoded string table, already resolved into
    /// [`NodeRecord::text`].
    String { index: u32, small: u8 },
    /// Byte offset into the extended-data section. Template literals and the
    /// source file itself use this.
    Extended { offset: u32, small: u8 },
    /// Number of entries, for a [`NodeKind::List`].
    ListLength(u32),
}

/// One node of the flattened AST.
///
/// Mirrors tsgo's encoded layout so that decoding is close to a reinterpretation
/// rather than a tree construction. `children` is the one derived field: the
/// encoding stores parent and next-sibling links instead, and source order makes
/// the child lists recoverable in order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeRecord {
    pub kind: NodeKind,
    pub origin: Origin,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    /// Resolved symbol, where the node names one.
    pub symbol: Option<SymbolId>,
    /// tsgo's `NodeFlags`. Carries `let`/`const`, ambient, and similar bits.
    pub flags: u32,
    /// Modifier keywords written on this declaration.
    pub modifiers: DeclarationModifiers,
    pub data: NodeData,
    /// Resolved text, for nodes whose data is a string index.
    pub text: Option<String>,
}

/// Why a snapshot was rejected.
#[derive(Debug, thiserror::Error)]
pub enum SnapshotError {
    #[error("snapshot schema version {found} does not match compiler schema {expected}")]
    SchemaMismatch { expected: u32, found: u32 },

    #[error("{what} id {id} is out of range ({len} present)")]
    DanglingId {
        what: &'static str,
        id: u32,
        len: usize,
    },

    #[error("frontend transport failed: {0}")]
    Transport(String),

    #[error("failed to decode snapshot: {0}")]
    Decode(String),
}

impl SemanticSnapshot {
    /// Reject a snapshot the rest of the compiler cannot safely trust.
    ///
    /// Called once at the frontend boundary. Everything downstream indexes these
    /// arenas directly, so a dangling id must be caught here rather than
    /// panicking three passes later with no context.
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(SnapshotError::SchemaMismatch {
                expected: SCHEMA_VERSION,
                found: self.schema_version,
            });
        }

        for (index, node) in self.nodes.iter().enumerate() {
            if let Some(NodeId(parent)) = node.parent {
                self.check_node(parent)?;
                debug_assert_ne!(parent as usize, index, "a node may not be its own parent");
            }
            for &NodeId(child) in &node.children {
                self.check_node(child)?;
            }
            if let Some(SymbolId(symbol)) = node.symbol {
                check(symbol, "symbol", self.symbols.len())?;
            }
        }

        for symbol in &self.symbols {
            if let Some(TypeId(ty)) = symbol.ty {
                check(ty, "type", self.types.len())?;
            }
        }

        for (&NodeId(node), &TypeId(ty)) in &self.node_types {
            self.check_node(node)?;
            check(ty, "type", self.types.len())?;
        }

        Ok(())
    }

    fn check_node(&self, id: u32) -> Result<(), SnapshotError> {
        check(id, "node", self.nodes.len())
    }

    /// Whether the program failed to typecheck.
    ///
    /// No backend may emit code for a program where this is true. A C backend
    /// handed `function f(a: number): string { return a; }` would emit a function
    /// declared to return a string and returning a double — the generated code
    /// would be wrong in a way nothing downstream could detect.
    #[must_use]
    pub fn has_errors(&self) -> bool {
        self.diagnostics
            .iter()
            .any(|d| d.severity == nts_diagnostics::Severity::Error)
    }

    /// Content digest over the snapshot, for cache keys.
    ///
    /// Includes [`SCHEMA_VERSION`], so a schema change invalidates every cached
    /// artifact derived from a snapshot without any separate bookkeeping.
    pub fn digest(&self) -> Result<[u8; 16], SnapshotError> {
        let bytes =
            postcard::to_allocvec(self).map_err(|e| SnapshotError::Decode(e.to_string()))?;
        let hash = xxhash_rust::xxh3::xxh3_128(&bytes);
        Ok(hash.to_le_bytes())
    }
}

/// Bounds-check an arena index.
///
/// Free rather than a method: it needs the length, not the snapshot, and taking
/// `&self` would imply it consults more state than it does.
fn check(id: u32, what: &'static str, len: usize) -> Result<(), SnapshotError> {
    if (id as usize) < len {
        Ok(())
    } else {
        Err(SnapshotError::DanglingId { what, id, len })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use nts_diagnostics::{SourceId, Span};

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn node(parent: Option<NodeId>, children: Vec<NodeId>) -> NodeRecord {
        NodeRecord {
            kind: NodeKind::Syntax(0),
            origin: origin(),
            parent,
            children,
            symbol: None,
            flags: 0,
            modifiers: DeclarationModifiers::default(),
            data: NodeData::Children {
                present: 0,
                small: 0,
            },
            text: None,
        }
    }

    fn snapshot(nodes: Vec<NodeRecord>) -> SemanticSnapshot {
        SemanticSnapshot {
            schema_version: SCHEMA_VERSION,
            nodes,
            ..SemanticSnapshot::default()
        }
    }

    #[test]
    fn wrong_schema_version_is_rejected() {
        let snap = SemanticSnapshot {
            schema_version: SCHEMA_VERSION + 1,
            ..SemanticSnapshot::default()
        };
        assert!(matches!(
            snap.validate(),
            Err(SnapshotError::SchemaMismatch { .. })
        ));
    }

    #[test]
    fn dangling_child_is_rejected_at_the_boundary() {
        // The whole point of validate(): catch this here, not when a lowering
        // pass indexes out of bounds with no source context to report.
        let snap = snapshot(vec![node(None, vec![NodeId(7)])]);
        assert!(matches!(
            snap.validate(),
            Err(SnapshotError::DanglingId {
                what: "node",
                id: 7,
                ..
            })
        ));
    }

    #[test]
    fn well_formed_snapshot_validates() {
        let snap = snapshot(vec![
            node(None, vec![NodeId(1)]),
            node(Some(NodeId(0)), vec![]),
        ]);
        assert!(snap.validate().is_ok());
    }

    #[test]
    fn digest_changes_when_content_changes() {
        let a = snapshot(vec![node(None, vec![])]);
        let b = snapshot(vec![node(None, vec![]), node(None, vec![])]);
        assert_ne!(a.digest().unwrap(), b.digest().unwrap());
    }

    #[test]
    fn digest_is_stable_across_calls() {
        let snap = snapshot(vec![node(None, vec![])]);
        assert_eq!(snap.digest().unwrap(), snap.digest().unwrap());
    }
}

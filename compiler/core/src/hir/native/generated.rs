//! Native operations emitted by lowering, independently of their debug names.

use std::borrow::Cow;

/// An authored `@ntsGType` or a class whose registration lowering produces.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GType {
    Declared(String),
    ProgramClass(String),
}

impl GType {
    #[must_use]
    pub fn symbol(&self) -> Cow<'_, str> {
        match self {
            Self::Declared(name) => Cow::Borrowed(name),
            Self::ProgramClass(class) => Cow::Owned(format!("{}{class}", super::PROGRAM_GTYPE)),
        }
    }

    #[must_use]
    pub fn program_class(&self) -> Option<&str> {
        match self {
            Self::ProgramClass(class) => Some(class),
            Self::Declared(_) => None,
        }
    }
}

/// The parent of a foreign class: an Objective-C/COM runtime class or a typed `GType`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForeignParent {
    Named(String),
    GObject(GType),
}

impl ForeignParent {
    #[must_use]
    pub fn symbol(&self) -> Cow<'_, str> {
        match self {
            Self::Named(name) => Cow::Borrowed(name),
            Self::GObject(gtype) => gtype.symbol(),
        }
    }

    #[must_use]
    pub const fn gtype(&self) -> Option<&GType> {
        match self {
            Self::GObject(gtype) => Some(gtype),
            Self::Named(_) => None,
        }
    }
}

impl From<String> for ForeignParent {
    fn from(value: String) -> Self {
        Self::Named(value)
    }
}

impl From<&str> for ForeignParent {
    fn from(value: &str) -> Self {
        Self::Named(value.to_owned())
    }
}

impl std::fmt::Display for ForeignParent {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.symbol().fmt(formatter)
    }
}

/// An explicit GIR operation, supplied by `@ntsIntrinsic`, never by a symbol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PropertyOperation {
    Get,
    Set,
    Construct,
}

/// A native function whose implementation lowering requests from the backend.
/// An authored C declaration cannot acquire this fact through its spelling.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GObjectThunk {
    Type {
        class: String,
    },
    New {
        class: String,
    },
    Child {
        class: String,
        index: usize,
    },
    Notify {
        class: String,
        index: usize,
    },
    Chain {
        class: String,
        slot: usize,
    },
    Signal {
        name: String,
        kinds: String,
    },
    Property {
        operation: PropertyOperation,
        kind: char,
        name: String,
    },
}

impl GObjectThunk {
    /// GIR's compiler-defined property operations. The payload is explicit;
    /// the declaration's C symbol does not participate in this decision.
    ///
    /// # Errors
    ///
    /// A recognized operation with a missing/unknown kind or property payload.
    pub fn from_intrinsic(text: &str) -> Result<Option<Self>, String> {
        let mut words = text.split_whitespace();
        let operation = match words.next() {
            Some("gobject.get-by-name") => PropertyOperation::Get,
            Some("gobject.set-by-name") => PropertyOperation::Set,
            Some("gobject.construct-by-name") => PropertyOperation::Construct,
            _ => return Ok(None),
        };
        let kind = words.next().and_then(|word| {
            let mut characters = word.chars();
            let kind = characters.next()?;
            (characters.next().is_none() && "iulLzdp".contains(kind)).then_some(kind)
        });
        let name = words.next();
        match (kind, name, words.next()) {
            (Some(kind), Some(name), None) => Ok(Some(Self::Property {
                operation,
                kind,
                name: name.to_owned(),
            })),
            _ => Err(
                "a GObject by-name intrinsic requires a kind (i/u/l/L/z/d/p) and one property name"
                    .to_owned(),
            ),
        }
    }

    /// The existing semantic/debug name. Emitters use the producer metadata
    /// to decide ownership; they never reconstruct it by parsing this name.
    #[must_use]
    pub fn symbol(&self) -> String {
        match self {
            Self::Type { class } => format!("{}{class}", super::PROGRAM_GTYPE),
            Self::New { class } => format!("nts_gobject_new_{class}"),
            Self::Child { class, index } => crate::hir::Template::child_thunk(class, *index),
            Self::Notify { class, index } => {
                crate::hir::ForeignProperty::notify_thunk(class, *index)
            }
            Self::Chain { class, slot } => format!("nts_gobject_chain_{class}_{slot}"),
            Self::Signal { name, kinds } => crate::hir::ForeignSignal::emit_thunk(name, kinds),
            Self::Property {
                operation,
                kind,
                name,
            } => {
                let role = match operation {
                    PropertyOperation::Get => "propget",
                    PropertyOperation::Set => "prop",
                    PropertyOperation::Construct => "with",
                };
                format!("nts_gobject_{role}_{kind}__{}", name.replace('-', "_"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ForeignParent, GObjectThunk, GType, PropertyOperation};

    #[test]
    fn property_operations_come_from_explicit_intrinsics() {
        for (tag, operation) in [
            ("gobject.get-by-name", PropertyOperation::Get),
            ("gobject.set-by-name", PropertyOperation::Set),
            ("gobject.construct-by-name", PropertyOperation::Construct),
        ] {
            assert_eq!(
                GObjectThunk::from_intrinsic(&format!("{tag} z item-type")),
                Ok(Some(GObjectThunk::Property {
                    operation,
                    kind: 'z',
                    name: "item-type".to_owned(),
                }))
            );
        }
        assert_eq!(
            GObjectThunk::from_intrinsic("nts_gobject_prop_i__value"),
            Ok(None)
        );
        for malformed in [
            "gobject.get-by-name",
            "gobject.get-by-name z",
            "gobject.get-by-name zz value",
            "gobject.get-by-name x value",
            "gobject.get-by-name z value extra",
        ] {
            assert!(GObjectThunk::from_intrinsic(malformed).is_err());
        }
    }

    #[test]
    fn authored_and_program_gtypes_have_distinct_provenance() {
        let declared = GType::Declared("nts_gobject_type_Probe".to_owned());
        let generated = GType::ProgramClass("Probe".to_owned());
        assert_eq!(declared.symbol(), generated.symbol());
        assert_eq!(declared.program_class(), None);
        assert_eq!(generated.program_class(), Some("Probe"));
        assert_ne!(declared, generated);
        assert_eq!(ForeignParent::from("nts_gobject_type_Probe").gtype(), None);
        assert_eq!(
            ForeignParent::GObject(declared.clone()).gtype(),
            Some(&declared)
        );
    }
}

//! Declaration-authored C ABI types. Brands describe a foreign boundary;
//! inside TypeScript their values retain JavaScript's primitive semantics.

use nts_semantic_schema::{MemberKind, SemanticSnapshot, TypeId, TypeKind};

use super::{HirType, ManagedType};

/// The authored ABI, retained on the call so another declaration cannot
/// change it and every backend receives the same signature.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Function {
    pub name: String,
    pub convention: Convention,
    pub parameters: Vec<Type>,
    pub result: Type,
    /// True only under an authored no-retention/no-return contract.
    pub no_escape: Vec<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Convention {
    C,
    Nts,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Type {
    Pointer(Pointee),
    Scalar(Scalar),
    Bool,
    Void,
    /// NTS references retain their declared payload for analyses. Their C
    /// spelling is the runtime's fixed struct, never a program-local layout.
    Managed(ManagedType),
    Erased,
    BigInt,
}

/// Native memory has a declared element layout, independently of ownership.
/// An opaque tag identifies a foreign object but permits no memory access.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Pointee {
    Opaque(String),
    Scalar(Scalar),
    Struct(std::sync::Arc<Struct>),
    Pointer(Box<Pointee>),
}

/// C storage order is declaration order, never the managed layout order.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Struct {
    pub name: String,
    pub fields: Vec<Field>,
    /// Whether `name` is a C struct tag the declaration authored, rather than a
    /// spelling invented for a layout that exists only in this program.
    ///
    /// The two are distinguishable from `name` alone -- an invented one is
    /// `NtsNative_Type{id}` -- and deliberately not distinguished that way. A
    /// question answered by a name prefix is answered again, differently, by
    /// whoever writes the next prefix test. It is recorded once, where the
    /// declaration is read, because only there is it known.
    ///
    /// What turns on it: a foreign tag names a type some header defines, so a
    /// translation unit that includes that header can be asked whether we
    /// described it correctly. An invented one names nothing outside this
    /// program and has no such witness to offer.
    pub foreign: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Field {
    pub name: String,
    pub ty: Pointee,
}

impl Pointee {
    #[must_use]
    pub fn c_type(&self) -> String {
        match self {
            Self::Opaque(name) => format!("struct {name}"),
            Self::Scalar(scalar) => scalar.c_type().to_owned(),
            Self::Struct(layout) => format!("struct {}", layout.name),
            Self::Pointer(pointee) => pointee.pointer_type(),
        }
    }

    #[must_use]
    pub fn pointer_type(&self) -> String { format!("{} *", self.c_type()) }

    /// A loadable scalar or pointer slot. Aggregates are addressable, but a
    /// whole-aggregate load/copy is not an implicit pointer assignment.
    #[must_use]
    pub fn element_type(&self) -> Option<HirType> {
        match self {
            Self::Scalar(scalar) => Some(scalar.representation()),
            Self::Pointer(pointee) => Some(HirType::NativePointer((**pointee).clone())),
            Self::Opaque(_) | Self::Struct(_) => None,
        }
    }
}

impl std::fmt::Display for Pointee {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Opaque(name) => write!(f, "{name}"),
            Self::Scalar(scalar) => write!(f, "{}", scalar.c_type()),
            Self::Struct(layout) => write!(f, "{}", layout.name),
            Self::Pointer(pointee) => write!(f, "{pointee}*"),
        }
    }
}

impl Type {
    /// A closure's synthesized layout differs from its callable interface.
    /// Both cross this convention as a header pointer; preserve the actual
    /// layout on the operand so reachability and ownership can still see it.
    #[must_use]
    pub fn accepts(&self, actual: &HirType) -> bool {
        matches!(
            (self, actual),
            (
                Self::Managed(ManagedType::Object(_)),
                HirType::Managed(ManagedType::Object(_))
            )
        ) || self.representation() == *actual
    }
    #[must_use]
    pub fn representation(&self) -> HirType {
        match self {
            Self::Pointer(name) => HirType::NativePointer(name.clone()),
            Self::Scalar(scalar) => scalar.representation(),
            Self::Bool => HirType::Bool,
            Self::Void => HirType::Void,
            Self::Managed(ty) => HirType::Managed(ty.clone()),
            Self::Erased => HirType::Erased,
            Self::BigInt => HirType::BigInt,
        }
    }

    #[must_use]
    pub fn c_type(&self) -> std::borrow::Cow<'_, str> {
        std::borrow::Cow::Borrowed(match self {
            Self::Pointer(pointee) => return std::borrow::Cow::Owned(pointee.pointer_type()),
            Self::Scalar(scalar) => scalar.c_type(),
            Self::Bool => "bool",
            Self::Void => "void",
            Self::Erased => "NtsValue",
            Self::BigInt => "__int128",
            Self::Managed(ty) => match ty {
                ManagedType::String => "NtsString *",
                ManagedType::Object(_) => "NtsHeader *",
                ManagedType::Array(_) => "NtsArray *",
                ManagedType::Promise(_) => "NtsPromise *",
                ManagedType::Map(..) | ManagedType::Table(..) | ManagedType::Set(_) => "NtsMap *",
                ManagedType::Date => "NtsDate *",
                ManagedType::Buffer => "NtsBuffer *",
                ManagedType::View(_) | ManagedType::AnyView | ManagedType::DataView => "NtsView *",
                ManagedType::Symbol => "NtsSymbol *",
            },
        })
    }
}

impl Function {
    /// Aliases such as `int`/`int32_t` agree on the supported LP64 targets;
    /// signedness remains part of the contract even where LLVM erases it.
    #[must_use]
    pub fn same_abi(&self, other: &Self) -> bool {
        self.result.same_abi(&other.result)
            && self.parameters.len() == other.parameters.len()
            && self
                .parameters
                .iter()
                .zip(&other.parameters)
                .all(|(a, b)| a.same_abi(b))
    }

    pub fn from_signature(
        snapshot: &SemanticSnapshot,
        name: String,
        signature: &nts_semantic_schema::SignatureRecord,
        abi: Option<&str>,
    ) -> Result<Self, String> {
        fn abi_type(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Type> {
            if let Some(name) = pointer(snapshot, ty) {
                return Some(Type::Pointer(name));
            }
            if let Some(scalar) = scalar(snapshot, ty) {
                return Some(Type::Scalar(scalar));
            }
            match snapshot.types.get(ty.0 as usize)?.kind {
                TypeKind::Boolean => Some(Type::Bool),
                TypeKind::Void => Some(Type::Void),
                _ => None,
            }
        }
        let abi_type = |ty| {
            if abi == Some("managed") {
                match super::lower::representation(snapshot, ty)? {
                    HirType::Void => Some(Type::Void),
                    HirType::Bool => Some(Type::Bool),
                    HirType::Float { bits: 64 } => Some(Type::Scalar(Scalar::Double)),
                    HirType::Managed(ManagedType::Object(_))
                        if matches!(
                            snapshot.types.get(ty.0 as usize)?.kind,
                            TypeKind::Tuple(_)
                        ) =>
                    {
                        None
                    }
                    HirType::Managed(ty) => Some(Type::Managed(ty)),
                    HirType::Erased => Some(Type::Erased),
                    HirType::BigInt => Some(Type::BigInt),
                    _ => None,
                }
            } else {
                abi_type(snapshot, ty)
            }
        };
        if let Some(abi) = abi
            && abi != "managed"
        {
            return Err(format!(
                "foreign function `{name}` with unknown @ntsAbi `{abi}`"
            ));
        }
        if !signature.type_parameters.is_empty() || signature.is_async || signature.is_construct {
            return Err(format!(
                "foreign function `{name}` with a generic, async, or constructor signature"
            ));
        }
        let mut parameters = Vec::with_capacity(signature.parameters.len());
        for parameter in &signature.parameters {
            if parameter.optional || parameter.rest {
                return Err(format!(
                    "foreign function `{name}` with an optional or rest parameter"
                ));
            }
            let ty = abi_type(parameter.ty)
                .filter(|ty| *ty != Type::Void)
                .ok_or_else(|| format!("foreign function `{name}` parameter `{}` without a native ABI type; use a c_int/c_double brand or boolean", parameter.name))?;
            parameters.push(ty);
        }
        let result = abi_type(signature.return_type)
            .ok_or_else(|| format!("foreign function `{name}` return without a native ABI type; use a c_int/c_double brand, boolean, or void"))?;
        Ok(Self {
            name,
            convention: if abi == Some("managed") {
                Convention::Nts
            } else {
                Convention::C
            },
            no_escape: vec![false; parameters.len()],
            parameters,
            result,
        })
    }
}

impl Type {
    fn same_abi(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Managed(_), Self::Managed(_)) => self.c_type() == other.c_type(),
            _ => self.representation() == other.representation(),
        }
    }
}

/// C scalars whose widths are fixed on the native targets supported by nts.
/// Keep C spelling separate from the register type: it is the declaration's
/// contract, not an integer width inferred from a particular argument.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Scalar {
    Int,
    UInt,
    Int8,
    UInt8,
    Int16,
    UInt16,
    Int32,
    UInt32,
    Int64,
    UInt64,
    Long,
    ULong,
    Size,
    Ptrdiff,
    Float,
    Double,
}

impl Scalar {
    #[must_use]
    pub fn from_brand(name: &str) -> Option<Self> {
        Some(match name {
            "__c_int" => Self::Int,
            "__c_uint" => Self::UInt,
            "__c_int8" => Self::Int8,
            "__c_uint8" => Self::UInt8,
            "__c_int16" => Self::Int16,
            "__c_uint16" => Self::UInt16,
            "__c_int32" => Self::Int32,
            "__c_uint32" => Self::UInt32,
            "__c_int64" => Self::Int64,
            "__c_uint64" => Self::UInt64,
            "__c_long" => Self::Long,
            "__c_ulong" => Self::ULong,
            "__c_size_t" => Self::Size,
            "__c_ptrdiff_t" => Self::Ptrdiff,
            "__c_float" => Self::Float,
            "__c_double" => Self::Double,
            _ => return None,
        })
    }

    #[must_use]
    pub const fn representation(self) -> HirType {
        match self {
            Self::Int | Self::Int32 => HirType::Int {
                bits: 32,
                signed: true,
            },
            Self::UInt | Self::UInt32 => HirType::Int {
                bits: 32,
                signed: false,
            },
            Self::Int8 => HirType::Int {
                bits: 8,
                signed: true,
            },
            Self::UInt8 => HirType::Int {
                bits: 8,
                signed: false,
            },
            Self::Int16 => HirType::Int {
                bits: 16,
                signed: true,
            },
            Self::UInt16 => HirType::Int {
                bits: 16,
                signed: false,
            },
            Self::Int64 | Self::Long | Self::Ptrdiff => HirType::Int {
                bits: 64,
                signed: true,
            },
            Self::UInt64 | Self::ULong | Self::Size => HirType::Int {
                bits: 64,
                signed: false,
            },
            Self::Float => HirType::Float { bits: 32 },
            Self::Double => HirType::NUMBER,
        }
    }

    #[must_use]
    pub const fn c_type(self) -> &'static str {
        match self {
            Self::Int => "int",
            Self::UInt => "unsigned int",
            Self::Int8 => "int8_t",
            Self::UInt8 => "uint8_t",
            Self::Int16 => "int16_t",
            Self::UInt16 => "uint16_t",
            Self::Int32 => "int32_t",
            Self::UInt32 => "uint32_t",
            Self::Int64 => "int64_t",
            Self::UInt64 => "uint64_t",
            Self::Long => "long",
            Self::ULong => "unsigned long",
            Self::Size => "size_t",
            Self::Ptrdiff => "ptrdiff_t",
            Self::Float => "float",
            Self::Double => "double",
        }
    }
}

/// Recognize the reserved native brand shape itself, not the name of a type
/// alias somebody happened to intern elsewhere. An arbitrary primitive/object
/// intersection does not acquire a representation through this function.
#[must_use]
pub fn scalar(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Scalar> {
    let TypeKind::Intersection(parts) = &snapshot.types.get(ty.0 as usize)?.kind else {
        return None;
    };
    if parts.len() != 2 {
        return None;
    }
    let mut number = false;
    let mut brand = None;
    for part in parts {
        match &snapshot.types.get(part.0 as usize)?.kind {
            TypeKind::Number => number = true,
            TypeKind::Object { properties } if properties.len() == 1 => {
                let property = &properties[0];
                if !property.readonly || property.optional || property.kind != MemberKind::Field {
                    return None;
                }
                // The snapshot preserves the checker's unique-symbol flag;
                // accepting ordinary `symbol` would also accept a real slot.
                if !matches!(snapshot.types.get(property.ty.0 as usize)?.kind,
                    TypeKind::Structured { flags } if flags == 1 << 14)
                {
                    return None;
                }
                // PropertyRecord carries tsgo's escaped symbol name: a source
                // name beginning `__` has one extra leading underscore.
                brand = Scalar::from_brand(property.name.strip_prefix('_')?);
            }
            _ => return None,
        }
    }
    number.then_some(brand).flatten()
}

mod schema;
pub use schema::{is_layout, pointer, storage};

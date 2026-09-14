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
    /// What the callee may do with each argument beyond the call, one entry per
    /// parameter. See [`Retention`].
    pub retention: Vec<Retention>,
    /// The type of each argument past the declared ones, when the C prototype
    /// ends in `...`.
    ///
    /// Spelled as a TypeScript rest parameter, which is already the right
    /// signal and needs no tag: `open(path, flags, ...rest: c_uint32[])` is
    /// `int open(const char *, int, ...)`.
    ///
    /// **A type, where C has none.** The prototype constrains nothing after the
    /// comma, and this constrains everything -- which is a narrower claim than
    /// the header makes and deliberately so. A variadic argument's type is not
    /// recoverable from the callee, so it has to come from somewhere, and the
    /// declaration is the only place that can be checked. A binding that needs
    /// two shapes of `ioctl` declares two names for it.
    pub variadic: Option<Type>,
}

/// What a foreign call keeps of one argument after it returns.
///
/// **`Unknown` is not "may be retained" spelled pessimistically.** It is the
/// absence of a claim, and keeping it distinct from a proved one is the whole
/// content of this type: collapse them and an optimizer has a permission nobody
/// established. Every analysis must assume the worst from `Unknown`, and that
/// is a different statement from having been told the worst is true.
///
/// One axis today because one axis is what the published calls need. A pointer
/// the callee does not keep and a callback the callee does not call later are
/// the same fact about two kinds of value: *nothing of this argument outlives
/// the call*. When a binding needs reads-versus-writes, or acquisition and
/// release, those are further axes and belong beside this one rather than
/// inside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Retention {
    /// Nothing was established. The callee may keep, free, reallocate or
    /// invalidate the argument, and may call it after returning.
    Unknown,
    /// Authored: no address into the argument is retained or returned, it is
    /// not freed, reallocated or invalidated, and if it is a callback it is not
    /// called after this call returns.
    ///
    /// Non-retention alone would not be enough for a pointer -- freeing it
    /// invalidates it just as surely as keeping it -- which is why the
    /// contract names those too.
    NotRetained,
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
    /// A C function pointer, `int (*)(const void *, const void *)`.
    ///
    /// Spelled in a binding as an ordinary TypeScript function type. At a C ABI
    /// boundary a function-typed parameter can mean nothing else, so no wrapper
    /// type is invented for it; what a *value* of this type is on the TS side is
    /// a separate question, answered where the call is lowered, because a
    /// TypeScript function and a C code pointer are not interchangeable and the
    /// bridge between them has to exist somewhere visible.
    FnPointer(std::sync::Arc<FnPointer>),
}

/// The shape of a C function pointer, and the name its typedef gets.
///
/// C spells a function pointer as a *declarator* wrapped around the name --
/// `int (*cmp)(void)` -- which does not fit anywhere a type is written before a
/// name. Every use therefore goes through a typedef, and the name is derived
/// from the shape so that two identical signatures reach the same one and two
/// different signatures cannot collide.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FnPointer {
    pub name: String,
    pub parameters: Vec<Type>,
    pub result: Box<Type>,
}

impl FnPointer {
    /// A typedef name derived from the signature itself.
    ///
    /// Not a counter: a counter depends on visit order, so the same signature
    /// would get different names in two programs and the emitted C would differ
    /// for no reason. This is a function of the shape alone.
    #[must_use]
    pub fn spell(parameters: Vec<Type>, result: Type) -> Self {
        let mut name = String::from("NtsFn");
        for part in std::iter::once(&result).chain(parameters.iter()) {
            name.push('_');
            for byte in part.c_type().bytes() {
                match byte {
                    b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' => name.push(byte as char),
                    b'*' => name.push('p'),
                    _ => name.push('_'),
                }
            }
        }
        Self { name, parameters, result: Box::new(result) }
    }

    /// `int (*NAME)(const void *, const void *)`, as a whole typedef.
    #[must_use]
    pub fn typedef(&self) -> String {
        let parameters = if self.parameters.is_empty() {
            "void".to_owned()
        } else {
            self.parameters.iter().map(Type::c_type).collect::<Vec<_>>().join(", ")
        };
        format!("typedef {} (*{})({parameters});", self.result.c_type(), self.name)
    }

    /// `int (*)(int)` -- the same shape with no name and no typedef in it.
    ///
    /// The witness needs this and the typedef cannot serve. It deliberately
    /// does not include `program.h`, which is where the typedef is defined, so
    /// a prototype it re-declares has to spell the shape out or name something
    /// that does not exist there. That is what it did: `native-callback`'s
    /// witness said `extern int apply_twice(NtsFn_int_int, int);` and had never
    /// been compiled, because that example had no file that included it.
    #[must_use]
    pub fn anonymous(&self) -> String {
        let parameters = if self.parameters.is_empty() {
            "void".to_owned()
        } else {
            self.parameters.iter().map(Type::c_type_expanded).collect::<Vec<_>>().join(", ")
        };
        format!("{} (*)({parameters})", self.result.c_type_expanded())
    }
}

impl Type {
    /// The C spelling with every typedef expanded in place.
    ///
    /// Differs from [`Type::c_type`] only for a function pointer, and only
    /// where the typedef is not in scope. Everywhere in `program.c` it is, and
    /// the typedef is the better spelling -- this is for the one consumer that
    /// cannot see it.
    #[must_use]
    pub fn c_type_expanded(&self) -> String {
        match self {
            Self::FnPointer(signature) => signature.anonymous(),
            other => other.c_type().into_owned(),
        }
    }
}

/// Native memory has a declared element layout, independently of ownership.
/// An opaque tag identifies a foreign object but permits no memory access.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Pointee {
    Opaque(String),
    Scalar(Scalar),
    Record(std::sync::Arc<Record>),
    Pointer(Box<Pointee>),
    /// C's `void`, as the pointee of a `void *`. Storage of unstated element
    /// type: an address a callee interprets, carrying no extent and nothing
    /// this program may read or write through.
    ///
    /// Distinct from [`Opaque`], which names a type some header defines and
    /// this program merely cannot see into. `void` names no type at all, so
    /// two `void *` say nothing about pointing at the same kind of thing.
    ///
    /// Spelled `Ptr<unknown>`, which is not a workaround: every `Ptr<T>` is
    /// already assignable to it under TypeScript's own variance, which is
    /// exactly the conversion C performs at the call. `any` is deliberately not
    /// accepted -- it would make an unchecked type into a pointer silently,
    /// where `unknown` is the one a person writes on purpose.
    Void,
    /// `const T`, as the pointee of a `const T *`.
    ///
    /// A restriction on access *through this view*, and nothing more. It is not
    /// a claim that the storage is immutable, nor that no one else holds a
    /// mutable pointer to it: `const` in C constrains the holder, not the
    /// memory. Saying otherwise would be an ownership promise with no checker
    /// behind it.
    ///
    /// Spelled `ConstPtr<T>`, which a `Ptr<T>` satisfies and which does not
    /// satisfy a `Ptr<T>` -- TypeScript's own assignability, giving exactly C's
    /// qualification conversion in the one direction C allows. Writing through
    /// one is a type error before lowering sees it (`TS2542`, "only permits
    /// reading"); lowering refuses it again rather than trusting that.
    Const(Box<Pointee>),
    /// `T[N]` stored inline, as a struct member is: `char name[65]`.
    ///
    /// The length is part of the type because it is part of the *layout* --
    /// `struct utsname` is five of these and its size is nothing without them.
    /// A pointer to one is not this; this is the storage itself, which is why
    /// it appears as a member and decays to a pointer when read.
    Array { element: Box<Pointee>, length: u32 },
    /// A view of the same thing that promises no alignment.
    ///
    /// Produced by taking the address of a member of a **packed** record, and a
    /// distinct type because in C it is one: `uint32_t *` promises four-byte
    /// alignment and a member at offset 4 of a 12-byte `struct epoll_event`
    /// does not have it. Reading through the aligned spelling is undefined, and
    /// clang says so rather than guessing -- `taking address of packed member`
    /// is a correctness warning, not a style one.
    ///
    /// It has to be on the *type* rather than on the field-address operation,
    /// because the operation is not where it is spent: the load and the store
    /// happen through the pointer value, one op later, and a backend reading
    /// only that value would have to trace it back to learn what it points at.
    Unaligned(Box<Pointee>),
}

/// C storage order is declaration order, never the managed layout order.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Record {
    pub name: String,
    pub fields: Vec<Field>,
    /// Whether the members follow one another or share an address.
    ///
    /// One type for both because C has one: 6.2.5 says "structure or union
    /// type" throughout, they are declared by the same grammar, their members
    /// are reached by the same `.` and `->`, and everything here except the
    /// keyword and the offsets is common to them. Two types would have
    /// duplicated every match arm to say the same thing twice.
    pub kind: RecordKind,
    /// `__attribute__((packed))` -- no padding anywhere, and an alignment of 1.
    ///
    /// Declared rather than inferred, because it cannot be inferred: a packed
    /// and an unpacked declaration of the same members are the same text and
    /// different layouts. `struct epoll_event` is the case that matters --
    /// 12 bytes packed where the natural layout is 16 -- and getting it wrong
    /// puts every member of an array at the wrong address.
    pub packed: bool,
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
    /// Whether the scope that declared it named a header -- so the definition
    /// is that header's and not ours.
    ///
    /// `program.h` includes what a binding names and defines only what nothing
    /// else does. Without this it defined every foreign struct itself, and a C
    /// consumer that included both `program.h` and the real header got
    /// `redefinition of 'struct utsname'` -- the two cannot meet, which is an
    /// odd thing for a header whose purpose is being included.
    ///
    /// *Whether*, not *which*: a module may name several headers, they are all
    /// included together, and which of them carries a given tag is a fact the
    /// preprocessor already holds. Deriving it a second time here would produce
    /// something that can disagree with it.
    pub from_header: bool,
}

/// Whether a record's members follow one another or share an address.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum RecordKind {
    Struct,
    Union,
}

impl RecordKind {
    /// The C keyword, which is also half of the type's spelling: a tag lives in
    /// one namespace but `struct x` and `union x` are different type names.
    #[must_use]
    pub const fn keyword(self) -> &'static str {
        match self {
            Self::Struct => "struct",
            Self::Union => "union",
        }
    }
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
            Self::Record(layout) => format!("{} {}", layout.kind.keyword(), layout.name),
            Self::Pointer(pointee) => pointee.pointer_type(),
            Self::Void => "void".to_owned(),
            Self::Const(pointee) => format!("const {}", pointee.c_type()),
            // The element's spelling. C writes the length in the *declarator*
            // -- `char name[65]`, not `char[65] name` -- so a member emits it
            // beside the name and a bare type spelling cannot carry it.
            Self::Array { element, .. } => element.c_type(),
            // A typedef, because C has no inline spelling for this. The name is
            // derived from the element so that two of them agree and two
            // different ones cannot collide -- the same rule the function
            // pointer typedefs follow, for the same reason.
            Self::Unaligned(pointee) => pointee.unaligned_typedef(),
        }
    }

    /// Whether a `Self *` may become a `to *` with no cast, as C does at a call.
    ///
    /// C performs exactly two implicit pointer conversions and this is both of
    /// them: any object pointer to `void *`, and adding qualification. They
    /// compose -- `uint8_t *` reaches `const void *` -- which is why this
    /// recurses rather than listing pairs.
    ///
    /// One direction only. Dropping `const`, or turning a `void *` back into a
    /// typed pointer, are the conversions mistakes are made of, and C requires a
    /// cast for both. TypeScript refuses them too, `ConstPtr<T>` not satisfying
    /// `Ptr<T>`; this is the second of two guards rather than the only one.
    #[must_use]
    pub fn converts_to(&self, to: &Self) -> bool {
        match to {
            Self::Void => true,
            Self::Const(inner) => self == &**inner || self.converts_to(inner),
            _ => false,
        }
    }

    #[must_use]
    pub fn pointer_type(&self) -> String { format!("{} *", self.c_type()) }

    /// The typedef name for this pointee read without alignment.
    ///
    /// A C identifier derived from the spelling: `unsigned int` becomes
    /// `NtsUnaligned_unsigned_int`, and the substitution is the same one the
    /// function-pointer typedefs use so that one shape is always one name.
    #[must_use]
    pub fn unaligned_typedef(&self) -> String {
        let mut name = String::from("NtsUnaligned_");
        for byte in self.c_type().bytes() {
            match byte {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' => name.push(byte as char),
                b'*' => name.push('p'),
                _ => name.push('_'),
            }
        }
        name
    }

    /// `typedef unsigned int NtsUnaligned_unsigned_int __attribute__((aligned(1)));`
    ///
    /// Not ISO C. There is no ISO way to say this: reducing a type's alignment
    /// is an extension, which clang and gcc both have, and a program describing
    /// a packed struct is already outside ISO by the time it gets here.
    #[must_use]
    pub fn unaligned_definition(&self) -> String {
        format!(
            "typedef {} {} __attribute__((aligned(1)));",
            self.c_type(),
            self.unaligned_typedef()
        )
    }

    /// The pointee underneath any view -- const, unaligned, or both.
    #[must_use]
    pub fn viewed(&self) -> &Self {
        match self {
            Self::Const(inner) | Self::Unaligned(inner) => inner.viewed(),
            other => other,
        }
    }

    /// A loadable scalar or pointer slot. Aggregates are addressable, but a
    /// whole-aggregate load/copy is not an implicit pointer assignment.
    #[must_use]
    pub fn element_type(&self) -> Option<HirType> {
        match self {
            Self::Scalar(scalar) => Some(scalar.representation()),
            Self::Pointer(pointee) => Some(HirType::NativePointer((**pointee).clone())),
            // A view loads exactly what the type underneath it does, which is
            // what C allows through both of these. What they restrict is
            // elsewhere: a `const` view must not *store*, and that is refused
            // where stores are lowered rather than by pretending the element
            // does not exist; an unaligned one changes how a backend spells
            // the access and not what is found there.
            Self::Const(pointee) | Self::Unaligned(pointee) => pointee.element_type(),
            // Reading `p.name[i]` is reading a `T`: the array decays to a
            // pointer to its first element, exactly as it does in C.
            Self::Array { element, .. } => element.element_type(),
            // `void` has no element to load and no size to step by, so neither
            // `p[i]` nor an index address exists for it. Refusing here is what
            // keeps a `void *` an address to hand onward rather than storage
            // this program may read through.
            Self::Opaque(_) | Self::Record(_) | Self::Void => None,
        }
    }
}

impl std::fmt::Display for Pointee {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Opaque(name) => write!(f, "{name}"),
            Self::Scalar(scalar) => write!(f, "{}", scalar.c_type()),
            Self::Record(layout) => write!(f, "{}", layout.name),
            Self::Pointer(pointee) => write!(f, "{pointee}*"),
            Self::Void => write!(f, "void"),
            Self::Const(pointee) => write!(f, "const {pointee}"),
            Self::Array { element, length } => write!(f, "{element}[{length}]"),
            Self::Unaligned(pointee) => write!(f, "unaligned {pointee}"),
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
            // One machine word holding an address this program never reads
            // through, which is what `void *` already means here. C does not
            // guarantee a code pointer and an object pointer share a
            // representation; POSIX does, and this compiler targets Linux LP64
            // only, which is where that assumption is stated.
            //
            // The *declared* type stays `FnPointer` and is what the emitted C
            // is written from, so the ABI is not decided by this line -- only
            // the width of the value carrying it. TypeScript keeps the two
            // apart before here: a function type and a `Ptr<unknown>` are not
            // assignable to each other.
            Self::FnPointer(_) => HirType::NativePointer(Pointee::Void),
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
            // The typedef's name. A function pointer's C spelling wraps the
            // declarator around the name, so it cannot be written where a type
            // precedes a name; every use goes through the typedef instead.
            Self::FnPointer(signature) => return std::borrow::Cow::Borrowed(&signature.name),
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
                // An ordinary TypeScript function type, which at a C ABI
                // boundary can mean one thing: a function pointer. No wrapper
                // type is invented to say so, because there is nothing else it
                // could have meant and a second spelling would be a second
                // fact to keep in agreement.
                //
                // Every parameter and the result go through this same function,
                // so a callback taking a `Ptr<T>` or returning `c_int` is
                // described by the rules already in use, and one that takes
                // something with no C ABI is refused here rather than at the
                // point where it would have been emitted.
                TypeKind::Function(id) => {
                    let signature = snapshot.signatures.get(id.0 as usize)?;
                    let parameters = signature
                        .parameters
                        .iter()
                        .map(|parameter| abi_type(snapshot, parameter.ty))
                        .collect::<Option<Vec<_>>>()?;
                    let result = abi_type(snapshot, signature.return_type)?;
                    Some(Type::FnPointer(std::sync::Arc::new(FnPointer::spell(
                        parameters, result,
                    ))))
                }
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
        let mut variadic = None;
        for (at, parameter) in signature.parameters.iter().enumerate() {
            if parameter.optional {
                return Err(format!("foreign function `{name}` with an optional parameter"));
            }
            if parameter.rest {
                let element = rest_element(snapshot, &name, parameter, at, signature)?;
                let ty = abi_type(element)
                    .filter(|ty| *ty != Type::Void)
                    .ok_or_else(|| format!(
                        "foreign function `{name}` variadic tail `{}` without a native ABI element type",
                        parameter.name
                    ))?;
                variadic_tail_is_passable(&name, &ty, parameters.is_empty())?;
                variadic = Some(ty);
                continue;
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
            retention: vec![Retention::Unknown; parameters.len()],
            parameters,
            variadic,
            result,
        })
    }
}

/// The element type of a rest parameter, which is the type of each argument
/// past the declared ones.
///
/// Two of the refusals here are **unreachable from TypeScript source, and
/// checked to be**: tsgo reports `TS1014 A rest parameter must be last` and
/// `TS2370 A rest parameter must be of an array type` before this is asked.
/// They stay because the input is a snapshot rather than the source, and a
/// malformed one should be refused and not laid out. They are not controls --
/// nothing written in TypeScript can make either fire.
fn rest_element(
    snapshot: &SemanticSnapshot,
    name: &str,
    parameter: &nts_semantic_schema::ParameterRecord,
    at: usize,
    signature: &nts_semantic_schema::SignatureRecord,
) -> Result<TypeId, String> {
    if at + 1 != signature.parameters.len() {
        return Err(format!(
            "foreign function `{name}` with a rest parameter that is not last"
        ));
    }
    let Some(TypeKind::Array(element)) =
        snapshot.types.get(parameter.ty.0 as usize).map(|record| &record.kind)
    else {
        return Err(format!(
            "foreign function `{name}` rest parameter `{}` is not an array type",
            parameter.name
        ));
    };
    Ok(*element)
}

/// Whether a variadic tail of this type is what the callee actually receives.
fn variadic_tail_is_passable(name: &str, ty: &Type, no_fixed: bool) -> Result<(), String> {
    // C11 6.7.6.3p5: `...` must follow at least one named parameter. `int f(...)`
    // is not a prototype this can emit, and a declaration with nothing before
    // the rest parameter is one no header has.
    if no_fixed {
        return Err(format!(
            "foreign function `{name}` is variadic with no declared parameter before `...`"
        ));
    }
    // C promotes a variadic argument narrower than `int`, and a `float` to
    // `double`, before the callee ever sees it. A type that would be promoted
    // therefore describes something other than what is passed, and the two
    // backends would have to agree about a conversion neither declaration
    // mentions. Refused with the promoted type named, which is what the binding
    // should say.
    if let Some(promoted) = ty.promoted_for_variadic() {
        return Err(format!(
            "foreign function `{name}` variadic tail is `{}`, which C promotes to `{}` before the callee sees it; declare `{}`",
            ty.c_type(), promoted.c_type(), promoted.c_type()
        ));
    }
    Ok(())
}

impl Type {
    /// What C's default argument promotions turn this into, when they change it.
    ///
    /// `None` means it is already its own promoted form and passes as declared.
    /// The promotions (C11 6.5.2.2p6) apply to every argument past a prototype's
    /// last declared parameter: anything with integer rank below `int` becomes
    /// `int` or `unsigned int`, and a `float` becomes a `double`. A declaration
    /// naming one of those describes something other than what is passed.
    #[must_use]
    pub fn promoted_for_variadic(&self) -> Option<Self> {
        let Self::Scalar(scalar) = self else { return None };
        Some(Self::Scalar(match scalar {
            // Every value of these fits in an `int`, signed or not, so C11
            // 6.3.1.1p2 promotes all of them to the signed one.
            Scalar::Char
            | Scalar::Int8
            | Scalar::UInt8
            | Scalar::Int16
            | Scalar::UInt16 => Scalar::Int,
            Scalar::Float => Scalar::Double,
            _ => return None,
        }))
    }

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
    /// C's `char`, which is a **third** type: distinct from both `signed char`
    /// and `unsigned char` however it happens to be signed on a target. A
    /// `char[65]` member described as `uint8_t[65]` has the same size, the same
    /// alignment and the same offsets, and is a different type -- which is
    /// exactly what the witness caught when `struct utsname` was first written
    /// with `c_uint8`.
    Char,
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
            "__c_char" => Self::Char,
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
            // Signed here because it is signed on this target. The *type* is
            // distinct from `signed char` regardless; the representation is
            // what the target says, and LP64 Linux says signed.

            Self::Int | Self::Int32 => HirType::Int {
                bits: 32,
                signed: true,
            },
            Self::UInt | Self::UInt32 => HirType::Int {
                bits: 32,
                signed: false,
            },
            Self::Char | Self::Int8 => HirType::Int { bits: 8, signed: true },
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
            Self::Char => "char",
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
impl Scalar {
    /// Whether this C type has values a TypeScript `number` cannot hold.
    ///
    /// A `double` represents every integer up to 2^53 exactly and nothing
    /// above it, so the 64-bit spellings need `bigint` and the narrower ones do
    /// not. On this target that is the whole LP64 family -- `long`, `size_t`
    /// and `ptrdiff_t` are 64 bits here, and giving `int64_t` exact values
    /// while its own underlying spelling rounded would be the worse of both.
    ///
    /// Target-dependent, and stated rather than assumed: LP64 is the model this
    /// compiler implements, and a target where `long` is 32 bits would move
    /// those three back.
    #[must_use]
    pub fn needs_exact_integer(self) -> bool {
        matches!(
            self,
            Self::Int64 | Self::UInt64 | Self::Long | Self::ULong | Self::Size | Self::Ptrdiff
        )
    }
}

#[must_use]
pub fn scalar(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Scalar> {
    let TypeKind::Intersection(parts) = &snapshot.types.get(ty.0 as usize)?.kind else {
        return None;
    };
    if parts.len() != 2 {
        return None;
    }
    let mut base = None;
    let mut brand = None;
    for part in parts {
        match &snapshot.types.get(part.0 as usize)?.kind {
            TypeKind::Number => base = Some(false),
            TypeKind::BigInt => base = Some(true),
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
    // The base has to be the one the brand's range needs, and a mismatch is
    // refused rather than reinterpreted. A `c_int64` spelled over `number`
    // would silently be the lossy thing this pairing exists to prevent -- and
    // it would still emit a correct `int64_t` prototype, so nothing downstream
    // would notice.
    let brand = brand?;
    (base? == brand.needs_exact_integer()).then_some(brand)
}

mod schema;
pub use schema::{is_layout, pointer, storage};

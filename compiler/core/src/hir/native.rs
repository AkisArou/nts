//! Declaration-authored C ABI types. Brands describe a foreign boundary;
//! inside TypeScript their values retain JavaScript's primitive semantics.

use nts_semantic_schema::{LiteralValue, MemberKind, NodeId, SemanticSnapshot, TypeId, TypeKind};

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
    /// The `declare module` whose `@ntsHeader` covers this declaration, when
    /// one does.
    ///
    /// The same fact [`Record::declaring_module`] carries, for the other half
    /// of what a program holds. Compiler metadata: no backend reads it and no
    /// C changes, and what it decides is which headers a translation unit needs
    /// rather than anything about the call.
    pub declared_at: Option<NodeId>,
    /// What each C parameter is *for*, one entry per parameter.
    ///
    /// The ABI in `parameters` is C's exactly, so prototypes and the witness
    /// need nothing beyond it; this is what the call site does to produce the
    /// argument. Read by lowering, which inserts the conversions. No backend
    /// reads it: by the time a backend sees the call every argument already
    /// is what C takes.
    ///
    /// **Not one-to-one with the TypeScript parameters.** A closure slot is
    /// followed by the C parameters that carry its context -- `ClosureData`,
    /// and for a retained one `ClosureNotify` -- which the declaration never
    /// spells and the caller never passes. [`Function::c_index`] maps between
    /// the two.
    pub roles: Vec<Role>,
    /// Set when the declaration returns a TypeScript `string`: the `result`
    /// is then C's `const char *`, which the call site copies into a string.
    pub returns_string: Option<ReturnedString>,
    /// Set when the declaration is an Objective-C message (`@ntsSelector`)
    /// rather than a C symbol. `name` is then the TypeScript name, which no
    /// backend links against. The call is `objc_msgSend` cast to exactly this
    /// function's type, with the receiver and the selector first.
    pub send: Option<Send>,
    /// Whether the result is a reference the caller owns (+1), where the
    /// result is a counted handle. Otherwise it is borrowed (+0), and a caller
    /// that keeps it takes a reference of its own.
    ///
    /// Read by the ownership pass, which is all it needs to know: an
    /// Objective-C binding sets it from ARC's method families (`alloc`,
    /// `new`, `copy`, `mutableCopy`, `init`), and a `GObject` one would set it
    /// from GIR's `transfer-ownership="full"`.
    pub returns_owned: bool,
    /// The C parameters whose reference the callee takes over, so the caller
    /// hands the one it holds rather than releasing it after the call. `init`
    /// consumes its receiver.
    pub consumes: Vec<usize>,
    /// What the declaring module's `@ntsFramework` names: the Apple
    /// frameworks the program links because it calls this, the way
    /// `declared_at` makes it include a header. A C function can live in one
    /// (CoreFoundation's `CFRunLoopRun`) as well as a message.
    pub frameworks: Vec<String>,
    /// What the declaration's `@ntsLibrary` names: the C libraries the
    /// program links because it calls this (`gdi32` for `BitBlt`).
    pub libraries: Vec<String>,
    /// `@ntsDefault`: the C parameter an optional TypeScript parameter lands
    /// in, and what the compiler passes there when the caller leaves it out.
    pub defaults: Vec<(usize, ParameterDefault)>,
    /// `Declared<T, D>`: the handle the program receives, `T`, where `result`
    /// is the ancestor `D` C declares. The call's value is converted to it.
    pub result_as: Option<Type>,
}

/// What `@ntsDefault` gives an optional parameter: an integer for a C integer
/// or boolean, `null` for a pointer that admits it. Nothing else -- a string
/// would be a managed value the binding writes for the caller, and a float
/// has no parameter that wants one yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParameterDefault {
    Int(i64),
    Null,
}

/// `@ntsDefault flags=7 cancellable=null`, read: the one parser of the tag's
/// text, which the snapshot keeps raw so that a malformed one is refused here
/// with a reason naming it.
///
/// # Errors
///
/// A word that is not `name=value`, a value that is neither an integer nor
/// `null`, or a name given twice.
pub fn parse_defaults(text: &str) -> Result<Vec<(String, ParameterDefault)>, String> {
    let mut defaults: Vec<(String, ParameterDefault)> = Vec::new();
    for word in text.split_whitespace() {
        let Some((name, value)) = word.split_once('=').filter(|(name, _)| is_c_identifier(name)) else {
            return Err(format!("@ntsDefault `{word}` that is not `parameter=value`, as in `@ntsDefault flags=0 cancellable=null`"));
        };
        let value = match value {
            "null" => ParameterDefault::Null,
            number => number.parse().map(ParameterDefault::Int).map_err(|_| {
                format!("@ntsDefault `{word}` whose value is neither an integer nor `null`")
            })?,
        };
        if defaults.iter().any(|(given, _)| given == name) {
            return Err(format!("@ntsDefault gives `{name}` twice"));
        }
        defaults.push((name.to_owned(), value));
    }
    Ok(defaults)
}

/// An Objective-C message: `[receiver selector:arguments]`.
///
/// **Always a cast, never a variadic call.** `objc_msgSend` is declared
/// variadic, and calling it that way is wrong on arm64, where variadic
/// arguments are passed on the stack and the method reads them from
/// registers. Each call site casts it to the exact function type this
/// declaration spells, which is what clang itself does for `[r sel]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Send {
    /// `initWithUTF8String:`. One colon per argument, checked when the
    /// declaration is read.
    pub selector: String,
    /// `Some("NSString")` for a class method: the receiver is the class
    /// object, looked up by name, and is not a parameter. `None` for an
    /// instance method: `parameters[0]` is the receiver (`this`).
    pub class: Option<String>,
}

/// The selectors ARC reserves to itself. On an object the program counts,
/// sending one would release (or retain, or free) behind the count's back.
pub const ARC_OWNED_SELECTORS: [&str; 5] = ["retain", "release", "autorelease", "dealloc", "retainCount"];

impl Send {
    /// Whether the selector is in `family` by ARC's rule (clang's
    /// `ObjCMethodFamily`): its first keyword, past leading underscores, is the
    /// family's name, or starts with it and continues with anything but a
    /// lowercase letter. So `copy` and `copyWithZone:` are in `copy`, and
    /// `copyright` is not.
    #[must_use]
    pub fn in_family(selector: &str, family: &str) -> bool {
        let first = selector.split(':').next().unwrap_or("").trim_start_matches('_');
        first
            .strip_prefix(family)
            .is_some_and(|rest| !rest.starts_with(|c: char| c.is_ascii_lowercase()))
    }

    /// Whether the message hands back an object the caller owns (+1): ARC's
    /// `alloc`, `new`, `copy`, `mutableCopy` and `init` families.
    #[must_use]
    pub fn returns_owned(selector: &str) -> bool {
        ["alloc", "new", "copy", "mutableCopy", "init"]
            .iter()
            .any(|family| Self::in_family(selector, family))
    }

    /// Whether the message consumes its receiver: the `init` family, whose
    /// method may free the object it was sent to and return another.
    #[must_use]
    pub fn consumes_receiver(selector: &str) -> bool {
        Self::in_family(selector, "init")
    }

    /// The arguments a selector takes: one per colon. `length` takes none,
    /// `initWithUTF8String:` one, and `setObject:forKey:` two.
    #[must_use]
    pub fn arity(selector: &str) -> usize {
        selector.bytes().filter(|&byte| byte == b':').count()
    }

    /// A selector's spelling: identifier characters, where every colon
    /// follows a keyword, and a selector with any colon ends in one. So
    /// `length` and `setObject:forKey:` are selectors, and `upper:case:String`
    /// (a keyword with no argument after two with one) is not. Neither empty,
    /// nor starting with a colon, nor holding a space, which is also what keeps
    /// it safe inside a C string literal.
    #[must_use]
    pub fn is_selector(selector: &str) -> bool {
        let mut keyword = false;
        for byte in selector.bytes() {
            match byte {
                b':' if keyword => keyword = false,
                b'_' | b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' => keyword = true,
                _ => return false,
            }
        }
        !selector.is_empty()
            && !selector.as_bytes()[0].is_ascii_digit()
            && (!selector.contains(':') || selector.ends_with(':'))
    }
}

/// A string a foreign function returns, as the declaration describes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReturnedString {
    /// `string | null`: C's NULL is `null`. Otherwise a NULL ends the
    /// process, since the declaration promised a string.
    pub nullable: bool,
    /// `@ntsFree`: the function that releases C's copy once it is read.
    /// Absent, the string is borrowed -- C keeps it, and nothing is freed.
    /// Present, the C result is `char *` rather than `const char *`, which is
    /// how C spells a string the caller owns.
    ///
    /// **A wrong tag is far worse than a missing one.** Missing, C's string
    /// leaks, which a leak check sees. Present on a borrowed string, the
    /// program frees memory it does not own: heap corruption, which nothing in
    /// the tree reliably sees. `bind-gir` writes it from GIR's `transfer-
    /// ownership="full"`; a hand-written binding should add it only where the
    /// library's documentation says the caller frees the result.
    pub free: Option<String>,
    /// A NULL-terminated array of strings rather than one, returned as a
    /// `string[]` and copied into one. The free function then takes the
    /// array's own C type -- `g_strfreev(gchar **)` -- where a string's takes
    /// `void *`, which is `g_free`'s and `free`'s.
    pub array: bool,
}

/// What one C parameter of a foreign function receives.
/// What a `string` becomes on its way to C: the conversion, its release, and
/// the C type the callee reads. One place names all three, so a call cannot
/// convert with one encoding's helper and release with the other's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Encoding {
    /// `string`: `const char *`, UTF-8 (`nts_string_to_cstring`).
    Utf8,
    /// `Utf16String`: `const uint16_t *`, UTF-16 (`nts_string_to_utf16`) --
    /// Windows' `LPCWSTR`. A two-byte string is lent in place.
    Utf16,
}

impl Encoding {
    /// The runtime helper that makes the C string.
    #[must_use]
    pub const fn to_c(self) -> &'static str {
        match self {
            Self::Utf8 => "nts_string_to_cstring",
            Self::Utf16 => "nts_string_to_utf16",
        }
    }

    /// The runtime helper that gives it back, given the string it came from.
    #[must_use]
    pub const fn release(self) -> &'static str {
        match self {
            Self::Utf8 => "nts_cstring_release",
            Self::Utf16 => "nts_utf16_release",
        }
    }

    /// The C parameter type: a pointer to const code units.
    #[must_use]
    pub fn c_type(self) -> Type {
        let unit = match self {
            Self::Utf8 => Scalar::Char,
            Self::Utf16 => Scalar::UInt16,
        };
        Type::Pointer(Pointee::Const(Box::new(Pointee::Scalar(unit))))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Role {
    /// The argument as TypeScript passed it, converted to the ABI type.
    Plain,
    /// A TypeScript `string` as a NUL-terminated C string in `Encoding`,
    /// borrowed by the callee for the call and released after it. C that
    /// keeps the pointer past the call must be declared as a pointer instead;
    /// that is the contract of the spelling.
    String(Encoding),
    /// A TypeScript closure -- capturing or not -- as a C function pointer
    /// whose last parameter is the closure's context. `Closure<F>` in
    /// `c:types` when C keeps it (`scoped: false`, released by the notify
    /// that follows), `ScopedClosure<F>` when it is called only during the
    /// call (released after it).
    ///
    /// `bridge` is the signature the closure is called with, context last.
    /// It is the parameter's own C type except for an `ErasedClosure`, whose
    /// parameter is `GLib`'s type-erased `GCallback`, `void (*)(void)`, and
    /// the bridge is converted to it at the call.
    Closure { lifetime: Lifetime, bridge: std::sync::Arc<FnPointer> },
    /// A TypeScript function as an Objective-C block (`Block<F>`): one C
    /// parameter, the block's address. `bridge` is the trampoline's type,
    /// `signature` with the context after it; `signature` is the block's own.
    /// The closure is lent for the call; a callee that keeps the block
    /// copies it, and the copy lends it again.
    Block { bridge: std::sync::Arc<FnPointer>, signature: std::sync::Arc<FnPointer> },
    /// The closure's context, the `void *` C hands back to the callback:
    /// `nts_closure_lend(closure)`. Hidden from TypeScript.
    ClosureData,
    /// `void (*)(void *)` that releases the context, called when C lets go:
    /// `nts_closure_notify()`. Hidden from TypeScript.
    ClosureNotify,
    /// A `string[]` as a NULL-terminated `char **` (`CStrings<Q>` in
    /// `c:types`), lent for the call and released after it
    /// (`nts_strings_to_cstrings` / `nts_cstrings_release`).
    Strings,
    /// A `Uint8Array`'s bytes, borrowed in place for the call (`CBytes<Q>`):
    /// `nts_view_bytes`, no copy. The view is the caller's argument, alive
    /// across the call, and its storage never moves.
    Bytes,
    /// The element count of the array in C parameter `array`, which C takes
    /// as a parameter of its own (`Counted<A, L>`). Hidden from TypeScript:
    /// the compiler passes it. `nullable` when the array may be `null`, whose
    /// count is `0` -- `(NULL, 0)` being the one pair that describes no array,
    /// and `GLib`'s documented `g_application_run(app, 0, NULL)`.
    Length { array: usize, nullable: bool },
    /// Where C reports a failure -- `GError **error` -- declared `@ntsThrows`.
    /// A caller that passes a slot reads the error itself; one that leaves the
    /// parameter out gets a zeroed slot of the compiler's, and a failure C
    /// reports there is thrown as an `Error` carrying the message `converter`
    /// makes of it.
    ErrorSlot { converter: String },
    /// One labelled argument: the property `key` of the object literal the
    /// program passes where the binding declares an object-type parameter --
    /// `setFrame(_ frame: CGRect, labels: { display: boolean })`, which is
    /// Swift's `setFrame(_:display:)`. Every label of one parameter is fed by
    /// that one TypeScript argument, and `last` closes the group. The object
    /// is never built: each property is lowered on its own and passed here.
    Label { key: String, last: bool },
}

/// The labels of a parameter declared as an object type literal --
/// `labels: { display: boolean }` -- in the order the literal declares them,
/// which is the order the arguments are passed in. Only an anonymous object
/// type, which the checker records with no symbol, and only required fields:
/// an interface names a type a program builds and passes around, where a label
/// list is the call's own spelling, as Swift's is. Such a parameter had no
/// native ABI before, so nothing that compiled reads differently.
fn labels_of(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Vec<(String, TypeId)>> {
    let record = snapshot.types.get(ty.0 as usize)?;
    let TypeKind::Object { properties } = &record.kind else { return None };
    if record.symbol.is_some() || properties.is_empty() {
        return None;
    }
    // Not a marker: `Opaque<T>`, `Class<...>`, a closure's or a brand's are
    // anonymous object types too, made of readonly `__`-named properties (the
    // checker escapes the name to `___`), and each is already a type of its
    // own here. A label is an ordinary name.
    if properties.iter().any(|p| p.readonly || p.name.starts_with("__"))
        || pointer(snapshot, ty).is_some()
        || is_layout(snapshot, ty)
    {
        return None;
    }
    properties
        .iter()
        .map(|p| (p.kind == MemberKind::Field && !p.optional).then(|| (p.name.clone(), p.ty)))
        .collect()
}

/// "This has no native ABI type", **as a noun phrase**.
///
/// `hir::lower`'s `unsupported` interpolates a message into "… is not supported
/// by this lowering yet", and its own doc states that rule and gives this exact
/// failure as the example. These two messages ended in *advice*, so the Windows
/// lane read
///
/// ```text
/// use a c_int/c_double brand, boolean, or string is not supported by this
/// lowering yet
/// ```
///
/// which is a missing word rather than a diagnostic. The advice moves inside the
/// sentence so it still ends on the thing that is unsupported, and both messages
/// are built here so they cannot drift apart again.
fn no_abi_type(function: &str, parameter: Option<&str>) -> String {
    let wants = "a c_int or c_double brand, a boolean, or a string";
    match parameter {
        Some(name) => format!(
            "foreign function `{function}`'s parameter `{name}` (which wants {wants}), a type with no native ABI"
        ),
        None => format!(
            "foreign function `{function}`'s return (which wants {wants}, or void), a type with no native ABI"
        ),
    }
}

impl Function {
    /// Every C parameter in order: its role, and the TypeScript argument that
    /// feeds it -- `None` for the context slots no declaration spells.
    ///
    /// **The one derivation of that mapping.** Lowering walks this to build the
    /// arguments, and [`Function::c_index`] reads it to place an
    /// `@ntsNoEscape`; two walks deciding separately which slots are hidden
    /// would disagree the first time a role is added.
    pub fn slots(&self) -> impl Iterator<Item = (usize, Role, Option<usize>)> + '_ {
        let mut ts = 0;
        self.roles.iter().enumerate().map(move |(at, role)| {
            let fed = match role {
                Role::ClosureData | Role::ClosureNotify | Role::Length { .. } => None,
                Role::Plain
                | Role::String(_)
                | Role::Closure { .. }
                | Role::Block { .. }
                | Role::Strings
                | Role::Bytes
                | Role::ErrorSlot { .. } => {
                    ts += 1;
                    Some(ts - 1)
                }
                Role::Label { last, .. } => {
                    let fed = ts;
                    if *last {
                        ts += 1;
                    }
                    Some(fed)
                }
            };
            (at, role.clone(), fed)
        })
    }

    /// The C parameter the `ts`th TypeScript parameter lands in.
    #[must_use]
    pub fn c_index(&self, ts: usize) -> Option<usize> {
        self.slots().find(|(_, _, fed)| *fed == Some(ts)).map(|(at, _, _)| at)
    }
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
    /// A record passed or returned **by value**: `NSRect frame`, not
    /// `NSRect *frame`. Written `ByValue<T>` in a binding.
    ///
    /// TypeScript holds a record only as storage, so this is carried in HIR as
    /// a pointer to that storage -- its [`Type::representation`] -- and the
    /// value crosses at the call. An argument is read from the storage the
    /// caller points at, and C copies it. A result is written into a
    /// `NativeLocal` the lowering makes, which is the call's **last HIR
    /// argument**: sret, said in HIR. So the local's lifetime rules --
    /// no escape, no loop, no suspension -- are the result's, unchanged.
    ///
    /// Plain bytes only: [`by_value_record_is_passable`] refuses a record
    /// holding a counted handle, which would make a copy an ownership edge.
    Record(std::sync::Arc<Record>),
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

/// Ordered and hashed **by the derived name**, which `spell` makes a function
/// of the shape alone -- so two of these compare and hash equal exactly when
/// they are equal, and `spell` is the only thing that ever sets a name.
///
/// By hand rather than derived, because deriving would demand `Hash` and `Ord`
/// on `native::Type` and from there on every managed type it can hold, which is
/// a lot of trait surface for an ordering whose only job is to let a `Pointee`
/// sit in a `BTreeSet`.
impl std::hash::Hash for FnPointer {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.name.hash(state);
    }
}

impl PartialOrd for FnPointer {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for FnPointer {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.name.cmp(&other.name)
    }
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

    /// `int (**)(int)` -- a pointer *to* one, with no typedef in it.
    ///
    /// The extra `*` goes inside the parentheses, where the declarator is.
    /// The witness needs this for `_Generic` on the address of a member that
    /// holds a callback: it does not include `program.h`, so `NtsFn_int_int *`
    /// names nothing there -- which is what it emitted, and what the witness
    /// refused.
    #[must_use]
    pub fn anonymous_pointer(&self) -> String {
        self.anonymous().replacen("(*)", "(**)", 1)
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
    /// A C struct this program holds only pointers to, by its tag.
    Opaque(Handle),
    Scalar(Scalar),
    /// `T name : width` -- a member occupying `width` bits of a `T`-sized
    /// storage unit, packed with the bit-fields beside it.
    ///
    /// **No offset of its own**, and that is the whole difficulty: a `Field`
    /// carries a name and a type, and where it sits comes from the order the
    /// fields are written. That works because every other member starts on a
    /// byte. `layout` allocates bits for these instead, following the rule the
    /// platform ABI states, and the generator's existing self-check -- the
    /// recomputed layout against clang's own dump -- is what says the rule was
    /// applied correctly, on real headers rather than on an argument.
    ///
    /// `offsetof` and `&` are both illegal on one in C, so unlike every other
    /// member this cannot be checked by the witness at compile time. What the
    /// witness can still assert is the enclosing record's `sizeof`, which a
    /// misallocated run of bit-fields changes.
    Bits {
        unit: Scalar,
        width: u32,
    },
    /// `T name[]` at the end of a record -- C's *flexible array member*.
    ///
    /// Storage with no extent. It is placed at its element's alignment and
    /// raises the record's, and contributes **zero bytes**: `struct cmsghdr` is
    /// 16 bytes and `offsetof(struct cmsghdr, __cmsg_data)` is also 16.
    ///
    /// Distinct from `Array { length: 0 }`, which would lay out identically and
    /// spell differently: C writes `T name[]`, a zero-length array is a GNU
    /// extension, and `_Generic` wants `T (*)[]` against `T (*)[0]`. A count of
    /// zero on the surface would also be a claim -- that there are none --
    /// where the truth is that the count is not in the type at all. It comes
    /// from somewhere else; for `cmsghdr` it is `cmsg_len`, and no part of this
    /// can know that.
    Flexible(Box<Pointee>),
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
    /// A C **function**, which is what a function pointer points at.
    ///
    /// The function and not the pointer, so the surrounding convention holds:
    /// `NativePointer(P)` spells `P *`, and `NativePointer(FnPointer)` is
    /// therefore `int (*)(int)` -- which is exactly `NtsFn_int_int`, the
    /// typedef, because C has no other spelling where a type precedes a name.
    ///
    /// A struct member holding a callback is `Pointer(FnPointer)`: a pointer
    /// to a function. Then `&p->run` is `NativePointer(Pointer(FnPointer))`
    /// and spells `NtsFn_int_int *`, which is what it is. Reading this variant
    /// as "the pointer" instead made those two the same type, and the emitted
    /// `v5 = &v0->run` was declared `NtsFn_int_int` and subscripted.
    FnPointer(std::sync::Arc<FnPointer>),
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

/// An opaque pointee: the C struct tag, and the tags it may become without a
/// cast.
///
/// `ancestors` is root first and excludes `tag` -- a `GtkButton` is
/// `_GtkButton` with `["_GObject", "_GInitiallyUnowned", "_GtkWidget"]`. Empty
/// for a plain `Opaque<"Counter">`, which converts to nothing but itself.
/// Read from `Class<Tag, Parent>` in `c:types`, whose chain TypeScript already
/// checks for assignability; this is the second of those two guards.
///
/// Dereferences to the tag, which is what every C spelling of it needs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Handle {
    pub tag: String,
    pub ancestors: Vec<String>,
    /// Whose object this is, which decides whether the program counts it.
    pub family: Family,
}

/// The object system a handle belongs to.
///
/// A plain enum on purpose, where a flag would do for two members. Each object
/// system with its own reference count is one more arm, whose answer is a pair
/// of functions in [`Family::counting`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Family {
    /// A C pointer the program never counts: its library's own functions
    /// create and destroy it, and the binding calls them by hand.
    #[default]
    C,
    /// An Objective-C object: `ObjcClass<Tag, Parent>`, retained and released
    /// with the ARC entry points under the reference-counting provider.
    Objc,
    /// A `GObject`: `GObjectClass<Tag, Parent>`, counted with `GLib`'s own
    /// pair under the reference-counting provider.
    GObject,
}

/// The two functions a counted handle is retained and released with. Both
/// take the object; `retain` hands it back, as `objc_retain` and
/// `g_object_ref` do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Counting {
    pub retain: &'static str,
    pub release: &'static str,
    /// Whether the pair takes `NULL` quietly, as `objc_retain(nil)` does. A
    /// count on a handle that may be null -- a field's old value, a nullable
    /// result -- otherwise goes through a guard each backend defines once
    /// ([`Counting::guarded`]): `g_object_unref(NULL)` is a critical, and an
    /// abort under `G_DEBUG=fatal-criticals`.
    pub null_safe: bool,
}

impl Counting {
    /// The function a backend calls for `retain` or `release`: the pair's own
    /// where it is null-safe, and otherwise the guard it defines around it.
    #[must_use]
    pub fn called(&self, retain: bool) -> String {
        let name = if retain { self.retain } else { self.release };
        if self.null_safe { name.to_owned() } else { Self::guarded(name) }
    }

    /// The guard around `name`: `nts_guarded_g_object_unref`.
    #[must_use]
    pub fn guarded(name: &str) -> String {
        format!("nts_guarded_{name}")
    }
}

impl Family {
    /// How this family's objects are counted, or `None` when the program does
    /// not count them. The one place a family's functions are named: the
    /// ownership pass asks it whether to count, and each backend asks it
    /// what to call.
    #[must_use]
    pub const fn counting(self) -> Option<Counting> {
        match self {
            Self::C => None,
            Self::Objc => Some(Counting { retain: "objc_retain", release: "objc_release", null_safe: true }),
            // `ref_sink`, as glib-rs takes a borrowed object: a plain ref on
            // an ordinary one, and on a new widget -- born floating, handed
            // back transfer-none -- the floating reference itself, which
            // otherwise nothing would ever drop.
            Self::GObject => Some(Counting { retain: "g_object_ref_sink", release: "g_object_unref", null_safe: false }),
        }
    }
}

/// The root every counted `GObject` handle upcasts to: what a promise's box
/// holds one as (`HANDLE_BOX_GOBJECT`), since one box serves the family and
/// its release is the family's.
#[must_use]
pub fn gobject_root() -> Pointee {
    Pointee::Opaque(Handle { tag: "_GObject".to_owned(), ancestors: vec!["_GTypeInstance".to_owned()], family: Family::GObject })
}

impl Pointee {
    /// The family of the handle this is, through a `const` view.
    #[must_use]
    pub fn family(&self) -> Option<Family> {
        match self {
            Self::Opaque(handle) => Some(handle.family),
            Self::Const(inner) => inner.family(),
            _ => None,
        }
    }

    /// How a handle to this is counted: its family's answer, through a
    /// `const` view as well, since `Const<NSString>` is the same object.
    #[must_use]
    pub fn counting(&self) -> Option<Counting> {
        match self {
            Self::Opaque(handle) => handle.family.counting(),
            Self::Const(inner) => inner.counting(),
            _ => None,
        }
    }
}

impl Handle {
    /// Whether a pointer to this may be passed where one to `to` is wanted:
    /// `to`'s whole chain is a strict prefix of this one's, in one family --
    /// or `to` is a C handle nobody counts, which a counted object may be
    /// viewed as: a `GObject` is a `GTypeInstance` to C. That view holds no
    /// reference, and the ownership pass keeps the object alive across it
    /// (`own::anchors`).
    #[must_use]
    pub fn upcasts_to(&self, to: &Self) -> bool {
        (self.family == to.family || to.family == Family::C)
            && self.ancestors.len() > to.ancestors.len()
            && self.ancestors.starts_with(&to.ancestors)
            && self.ancestors[to.ancestors.len()] == to.tag
    }
}

impl From<String> for Handle {
    fn from(tag: String) -> Self {
        Self { tag, ancestors: Vec::new(), family: Family::C }
    }
}

impl From<&str> for Handle {
    fn from(tag: &str) -> Self {
        tag.to_owned().into()
    }
}

impl std::ops::Deref for Handle {
    type Target = String;
    fn deref(&self) -> &String {
        &self.tag
    }
}

impl std::fmt::Display for Handle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.tag)
    }
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
    /// How this program knows the type: invented here, an authored C tag, or a
    /// record the header declares without one.
    ///
    /// **One field because two of the combinations were impossible.** These
    /// were three bools -- `foreign`, `from_header`, `anonymous` -- and
    /// `anonymous` implies `!foreign` (there is no tag) while `from_header`
    /// was only ever set alongside `foreign`. Four reachable states in eight,
    /// which is the shape that later reads as a bug. `packed` stays a bool
    /// beside this because it genuinely is independent of all three.
    pub naming: Naming,
    /// `__attribute__((packed))` -- no padding anywhere, and an alignment of 1.
    ///
    /// Declared rather than inferred, because it cannot be inferred: a packed
    /// and an unpacked declaration of the same members are the same text and
    /// different layouts. `struct epoll_event` is the case that matters --
    /// 12 bytes packed where the natural layout is 16 -- and getting it wrong
    /// puts every member of an array at the wrong address.
    pub packed: bool,
}

/// How this program came to know a record's type.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Naming {
    /// A layout this program invented, named `NtsNative_Type{id}`. Nothing
    /// outside this program has the type, so no header can be asked about it
    /// and this compiler emits its definition.
    Invented,
    /// A C tag the declaration authored, so some header defines it and a
    /// translation unit holding that header can be asked whether this program
    /// described it correctly.
    ///
    /// `from_header` is **which** `declare module` named that header, when one
    /// did. It decides whether `program.h` includes the header or defines its
    /// own copy -- and, because it is an identity rather than a bool, which
    /// headers a program that uses this record needs. A program is not obliged
    /// to carry every header in the snapshot, and carried all of them while
    /// this said only *that* one was named.
    Tagged { from_header: Option<NodeId> },
    /// Named by a **typedef** rather than by a tag: `typedef struct { ... } X;`
    /// gives the struct no tag, only a typedef name, so C spells the type `X`
    /// and never `struct X`.
    ///
    /// Everything else about it is a header's record -- `sizeof(X)`,
    /// `offsetof(X, f)` and `_Generic(&p->f, T *)` all work -- so it is
    /// `foreign` and `from_header` like a tagged one, and differs only in the
    /// keyword that is *not* written.
    ///
    /// clang reports such a member's type as `struct X`, because an unnamed
    /// record takes a typedef name for linkage; that spelling is not one source
    /// may use, which is how this reads as a missing definition and is not one.
    Typedef { from_header: Option<NodeId> },
    /// Declared by a header **without a tag**, so nothing can name it.
    ///
    /// Inferred rather than marked: a header-defined record's members are the
    /// header's, so a member whose type carries no tag cannot be a layout this
    /// program invented. The surface says nothing about it, which is the point
    /// -- the author would have been restating what the enclosing tag says.
    ///
    /// Not called `Anonymous`, because C reserves that word for the other case:
    /// C11 6.7.2.1p13's "anonymous structure or union" is a member with **no
    /// declarator**, whose fields are reached as the enclosing record's. That
    /// is a different rule, and one word for both is how they get confused.
    ///
    /// C gives an anonymous record no spelling: no variable may be declared to
    /// point at one and `_Generic` cannot ask about one. Every consumer here
    /// reaches its members by byte offset from the enclosing record, and no
    /// definition, forward declaration or type assertion is emitted for it.
    /// `name` is still filled in, because the TypeScript side needs something
    /// to call it and a diagnostic needs something to say.
    Untagged,
}

impl Record {
    /// Whether `name` is a C tag some header defines.
    #[must_use]
    pub const fn foreign(&self) -> bool {
        matches!(self.naming, Naming::Tagged { .. } | Naming::Typedef { .. })
    }

    /// Whether C spells this type without a `struct` or `union` keyword.
    #[must_use]
    pub const fn spelled_bare(&self) -> bool {
        matches!(self.naming, Naming::Typedef { .. })
    }

    /// Whether the binding named the header that defines it, so `program.h`
    /// includes that header rather than defining its own copy.
    #[must_use]
    pub const fn from_header(&self) -> bool {
        matches!(
            self.naming,
            Naming::Tagged { from_header: Some(_) } | Naming::Typedef { from_header: Some(_) }
        )
    }

    /// The `declare module` whose `@ntsHeader` describes this record, when one
    /// does. What a program needs in its translation unit is the union of these
    /// over the records and calls it actually holds.
    #[must_use]
    pub const fn declaring_module(&self) -> Option<NodeId> {
        match self.naming {
            Naming::Tagged { from_header } | Naming::Typedef { from_header } => from_header,
            _ => None,
        }
    }

    /// Whether the header declares it without a tag. See [`Naming::Untagged`].
    #[must_use]
    pub const fn untagged(&self) -> bool {
        matches!(self.naming, Naming::Untagged)
    }
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
    /// Whether storage of this type holds a handle the program counts,
    /// directly or in a nested record or array.
    #[must_use]
    pub fn holds_counted(&self) -> bool {
        match self {
            Self::Pointer(pointee) => pointee.counting().is_some(),
            Self::Record(record) => record.fields.iter().any(|field| field.ty.holds_counted()),
            Self::Array { element, .. } | Self::Flexible(element) | Self::Const(element) => element.holds_counted(),
            _ => false,
        }
    }

    #[must_use]
    pub fn c_type(&self) -> String {
        match self {
            Self::Opaque(name) => format!("struct {name}"),
            Self::Scalar(scalar) => scalar.c_type().to_owned(),
            // The width belongs to the *declarator*, not the type: C writes
            // `unsigned int ihl : 4`, so `c_type` is the storage unit and
            // whoever emits the member appends the `: width`.
            Self::Bits { unit, .. } => unit.c_type().to_owned(),
            // `char` for an anonymous one, which is not a description of it: C
            // has no spelling for a record the header left untagged, and
            // `char *` is the type any address may be held as. Every access
            // through it is byte arithmetic from the enclosing record, which
            // is what a C programmer writes when they cannot name a type
            // either. A member *declaration* of one would be wrong, and
            // `types` refuses to emit a record that holds one.
            Self::Record(layout) if layout.untagged() => "char".to_owned(),
            // A typedef-named record is spelled bare: `__sigset_t`, never
            // `struct __sigset_t`, because the struct has no tag to write.
            Self::Record(layout) if layout.spelled_bare() => layout.name.clone(),
            Self::Record(layout) => format!("{} {}", layout.kind.keyword(), layout.name),
            Self::Pointer(pointee) => pointee.pointer_type(),
            Self::Void => "void".to_owned(),
            // A const *pointer* takes the qualifier after its star --
            // `char * const` -- because `const char *` is a pointer to a const
            // `char`, a different type. Written before first, a
            // `const char * const *` came out `const const char * *`.
            Self::Const(pointee) if matches!(**pointee, Self::Pointer(_)) => format!("{} const", pointee.c_type()),
            Self::Const(pointee) => format!("const {}", pointee.c_type()),
            // The element's spelling. C writes the length in the *declarator*
            // -- `char name[65]`, not `char[65] name` -- so a member emits it
            // beside the name and a bare type spelling cannot carry it.
            // An array's bound and a flexible array's brackets both live in
            // the *declarator*, after the name, so neither is part of the type
            // spelling and both answer with the element.
            Self::Array { element, .. } | Self::Flexible(element) => element.c_type(),
            // A typedef, because C has no inline spelling for this. The name is
            // derived from the element so that two of them agree and two
            // different ones cannot collide -- the same rule the function
            // pointer typedefs follow, for the same reason.
            Self::Unaligned(pointee) => pointee.unaligned_typedef(),
            // A bare function type has no spelling here and should not be
            // reached: every use is `Pointer(FnPointer)`, whose `c_type` is
            // this one's `pointer_type` and therefore the typedef.
            Self::FnPointer(signature) => signature.name.clone(),
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
    ///
    /// **And one conversion C does not do, which a class hierarchy does.** A
    /// `GtkButton *` is a `GtkWidget *` because `GObject` lays every instance out
    /// with its parent's instance struct first -- the conversion C spells
    /// `GTK_WIDGET(button)`. Only upward, and only along the chain the handle
    /// was declared with: a downcast is a runtime question
    /// (`g_type_check_instance_is_a`), and `widget as GtkButton` typechecks in
    /// TypeScript because the two overlap, so this is where it is refused.
    #[must_use]
    pub fn converts_to(&self, to: &Self) -> bool {
        match to {
            Self::Void => true,
            Self::Const(inner) => self == &**inner || self.converts_to(inner),
            Self::Opaque(to) => matches!(self, Self::Opaque(from) if from.upcasts_to(to)),
            _ => false,
        }
    }

    /// `T *`, with C's one irregularity absorbed.
    ///
    /// A pointer to a function is `int (*)(int)`, which cannot be written as a
    /// spelling followed by a `*` -- the declarator wraps the name. The typedef
    /// is that whole thing, so this answers with the typedef and adds nothing.
    #[must_use]
    pub fn pointer_type(&self) -> String {
        match self {
            Self::FnPointer(signature) => signature.name.clone(),
            other => format!("{} *", other.c_type()),
        }
    }

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

    /// `element_type`, as the slot C reads on `abi` rather than the value
    /// HIR holds. They differ only where `Scalar::abi` does.
    #[must_use]
    pub fn abi_element_type(&self, abi: NativeAbi) -> Option<HirType> {
        match self {
            Self::Scalar(scalar) => Some(scalar.abi(abi)),
            Self::Bits { unit, .. } => Some(unit.abi(abi)),
            Self::Const(inner) | Self::Unaligned(inner) => inner.abi_element_type(abi),
            other => other.element_type(),
        }
    }

    /// A loadable scalar or pointer slot. Aggregates are addressable, but a
    /// whole-aggregate load/copy is not an implicit pointer assignment.
    #[must_use]
    pub fn element_type(&self) -> Option<HirType> {
        match self {
            Self::Scalar(scalar) => Some(scalar.representation()),
            // Loadable as a value and only as a value. A bit-field has no
            // address, so nothing may point at one -- which is why the surface
            // projects it without the phantom `addrOf` reads.
            Self::Bits { unit, .. } => Some(unit.representation()),
            // Reading `p.name[i]` is reading a `T`, exactly as for a sized
            // array: the decay is the same and only the extent is missing. It
            // answered with a *pointer* first, which is the type
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
            // Reading `p.name[i]` is reading a `T` for both: the array decays
            // to a pointer to its first element, exactly as in C, and a
            // flexible member decays the same way with no extent to state.
            //
            // A flexible one answered with a *pointer* first, which is the type
            // `native.index.addr` produces rather than the type it loads. The
            // verifier said so: "native memory element", expected a pointer,
            // found one.
            Self::Array { element, .. } | Self::Flexible(element) => element.element_type(),
            // Nothing here is a value this can load, for four different
            // reasons that come to one answer.
            //
            // `void` has no element and no size to step by, which is what
            // keeps a `void *` an address to hand onward rather than storage
            // this program may read through. An opaque tag and a record are
            // storage whose *address* is the thing -- reading a record as a
            // value would be an aggregate copy, which `copy` is for. And a
            // function is not a value at all: `Pointer(FnPointer)` is the
            // loadable thing, and the pointer arm above answers for it with
            // `NativePointer(FnPointer)`, one word holding a function's
            // address, which is what `p.run` reads and what a bridge produces.
            Self::FnPointer(_) | Self::Opaque(_) | Self::Record(_) | Self::Void => None,
        }
    }
}

impl std::fmt::Display for Pointee {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Opaque(name) => write!(f, "{name}"),
            Self::Scalar(scalar) => write!(f, "{}", scalar.c_type()),
            Self::Bits { unit, width } => write!(f, "{}:{width}", unit.c_type()),
            Self::Flexible(element) => write!(f, "{element}[]"),
            Self::Record(layout) => write!(f, "{}", layout.name),
            Self::Pointer(pointee) => write!(f, "{pointee}*"),
            Self::Void => write!(f, "void"),
            Self::Const(pointee) => write!(f, "const {pointee}"),
            Self::Array { element, length } => write!(f, "{element}[{length}]"),
            Self::Unaligned(pointee) => write!(f, "unaligned {pointee}"),
            Self::FnPointer(signature) => write!(f, "{}", signature.name),
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

    /// The slot C passes this in on `abi`, where `representation` is the
    /// value HIR holds. They differ only where `Scalar::abi` does.
    #[must_use]
    pub fn abi(&self, abi: NativeAbi) -> HirType {
        match self {
            Self::Scalar(scalar) => scalar.abi(abi),
            other => other.representation(),
        }
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
            // The function pointer itself, not a `void *` standing in for one.
            //
            // It was `Pointee::Void` on the reasoning that this is one machine
            // word holding an address the program never reads through -- true,
            // and it made the emitted C say things ISO C does not: assigning a
            // function to a `void *`, and passing a `void *` where an
            // `NtsFn_int_int` is wanted. `-pedantic-errors` reported ten of
            // those in `native-callback`. POSIX does guarantee the
            // representation, which is why it worked; the declaration was
            // simply less true than it could be.
            //
            // Saying the real thing also removes a conversion: the specializer
            // converts each argument to its parameter's representation, and
            // with `void *` that inserted `v4 = (void *)v2;` before every call.
            Self::FnPointer(signature) => {
                HirType::NativePointer(Pointee::FnPointer(signature.clone()))
            }
            Self::Record(record) => HirType::NativePointer(Pointee::Record(record.clone())),
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
            Self::Record(record) => return std::borrow::Cow::Owned(Pointee::Record(record.clone()).c_type()),
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

/// A C ABI type read from a TypeScript type, for the plain (unmanaged) case.
///
/// Hoisted out of `Function::from_signature` so the struct schema can ask the
/// same question about a *member*: a function-typed member is a C function
/// pointer for exactly the reason a function-typed parameter is, and two
/// answers to that would be two places to keep in agreement.
    fn abi_type(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Type> {
        if let Some(scalar) = int_bool(snapshot, ty) {
            return Some(Type::Scalar(scalar));
        }
        if let Some(record) = schema::by_value(snapshot, ty) {
            return Some(Type::Record(record));
        }
        if let Some(name) = pointer(snapshot, ty) {
            return Some(Type::Pointer(name));
        }
        if let Some(scalar) = scalar(snapshot, ty) {
            return Some(Type::Scalar(scalar));
        }
        match &snapshot.types.get(ty.0 as usize)?.kind {
            TypeKind::Boolean => Some(Type::Bool),
            TypeKind::Void => Some(Type::Void),
            // `F | null`: the same function pointer, which C passes as NULL
            // when the program passes `null`. A null pointer and a valid one
            // share a representation, as they do for `Ptr<T> | null`.
            //
            // **`| null` is the API's claim, not a safety net.** It says the
            // C function documents NULL as meaningful there -- `SetTimer`
            // posting `WM_TIMER` instead of calling back -- and nothing here
            // can check that. A function that calls a NULL callback anyway
            // crashes, and that is its contract, not this binding's.
            TypeKind::Union(parts) => {
                let [a, b] = parts.as_slice() else { return None };
                let is_null = |id: &TypeId| matches!(snapshot.types.get(id.0 as usize).map(|t| &t.kind), Some(TypeKind::Null));
                let payload = if is_null(a) { b } else if is_null(b) { a } else { return None };
                match abi_type(snapshot, *payload)? {
                    function @ Type::FnPointer(_) => Some(function),
                    _ => None,
                }
            }
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
                // A callback taking or returning a record by value would need
                // its bridge to do what a call does here; nothing does yet.
                if parameters.iter().chain([&result]).any(|ty| matches!(ty, Type::Record(_))) {
                    return None;
                }
                Some(Type::FnPointer(std::sync::Arc::new(FnPointer::spell(
                    parameters, result,
                ))))
            }
            _ => None,
        }
    }

/// A C function pointer read from an ordinary TypeScript function type.
///
/// `None` for anything else, including a function whose signature names
/// something with no C ABI -- refused here rather than where it would have
/// been emitted.
#[must_use]
pub fn fn_pointer(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
) -> Option<std::sync::Arc<FnPointer>> {
    match abi_type(snapshot, ty)? {
        Type::FnPointer(signature) => Some(signature),
        _ => None,
    }
}

impl Function {
    /// Whether a record crosses this call by value, as an argument or as the
    /// result. A backend that has no aggregate calling convention asks this
    /// and refuses by name, because a record's HIR representation is a pointer
    /// and would otherwise pass every check a pointer passes.
    #[must_use]
    pub fn passes_a_record(&self) -> bool {
        self.parameters.iter().chain([&self.result]).any(|ty| matches!(ty, Type::Record(_)))
    }

    /// The storage a record result is written into, when there is one: the
    /// call's argument after every declared parameter (see [`Type::Record`]).
    /// Never alongside a variadic tail, which `from_signature` refuses.
    #[must_use]
    pub fn destination(&self) -> Option<&Type> {
        matches!(self.result, Type::Record(_)).then_some(&self.result)
    }

    /// What an HIR call to this carries, in order: the declared parameters,
    /// then the destination. The variadic tail is not in it.
    pub fn argument_types(&self) -> impl Iterator<Item = &Type> {
        self.parameters.iter().chain(self.destination())
    }

    /// The type of an HIR call's argument `at`: a declared parameter, the
    /// destination, or past both the variadic tail.
    #[must_use]
    pub fn argument(&self, at: usize) -> Option<&Type> {
        self.argument_types().nth(at).or(self.variadic.as_ref())
    }

    /// The type of the call's own value: the result, except for a record,
    /// which the call writes into its destination and does not produce.
    #[must_use]
    pub fn call_result(&self) -> HirType {
        if self.destination().is_some() { HirType::Void } else { self.result.representation() }
    }

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

    /// `throws` is `@ntsThrows`: the parameter that is the error slot, and the
    /// function that turns an error into its message. `defaults` is
    /// `@ntsDefault`, read by [`parse_defaults`].
    pub fn from_signature(
        snapshot: &SemanticSnapshot,
        name: String,
        signature: &nts_semantic_schema::SignatureRecord,
        abi: Option<&str>,
        throws: Option<(&str, &str)>,
        defaults: &[(String, ParameterDefault)],
    ) -> Result<Self, String> {
        let abi_type = |ty| {
            if abi == Some("managed") { managed_abi_type(snapshot, ty) } else { abi_type(snapshot, ty) }
        };
        if let Some(abi) = abi
            && abi != "managed"
        {
            return Err(format!(
                "foreign function `{name}` with unknown @ntsAbi `{abi}`"
            ));
        }
        // Not `async`: a foreign function is an ambient declaration, and
        // TypeScript rejects the modifier there outright (TS1040), so the case
        // this once claimed to refuse cannot be written.
        if !signature.type_parameters.is_empty() || signature.is_construct {
            return Err(format!(
                "foreign function `{name}` with a generic or constructor signature"
            ));
        }
        let mut parameters = Vec::with_capacity(signature.parameters.len());
        let mut roles = Vec::with_capacity(signature.parameters.len());
        let mut variadic = None;
        tags_name_parameters(&name, signature, throws, defaults)?;
        let (mut given, mut consumes) = (Vec::new(), Vec::new());
        for (at, parameter) in signature.parameters.iter().enumerate() {
            // The error slot, the one parameter a caller may leave out: C
            // reports through it, and the compiler supplies one when omitted.
            if let Some((slot, converter)) = throws
                && parameter.name == slot
            {
                let (ty, role) = error_slot(snapshot, &name, parameter, converter)?;
                parameters.push(ty);
                roles.push(role);
                continue;
            }
            if parameter.optional {
                let Some((_, value)) = defaults.iter().find(|(named, _)| *named == parameter.name) else {
                    return Err(format!(
                        "foreign function `{name}` with an optional parameter `{}` that no @ntsDefault gives a value",
                        parameter.name
                    ));
                };
                given.push((parameters.len(), *value));
                parameters.push(defaulted(snapshot, &name, parameter, *value)?);
                roles.push(Role::Plain);
                continue;
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
            if abi.is_none()
                && let Some(slots) = c_parameter(snapshot, &name, parameter, parameters.len())?
            {
                for (ty, role) in slots {
                    parameters.push(ty);
                    roles.push(role);
                }
                continue;
            }
            let ty = abi_type(parameter.ty)
                .filter(|ty| *ty != Type::Void)
                .ok_or_else(|| no_abi_type(&name, Some(&parameter.name)))?;
            if consumed(snapshot, &name, parameter, &ty)? { consumes.push(parameters.len()); }
            parameters.push(ty);
            roles.push(Role::Plain);
        }
        let returned = returned(snapshot, &name, signature.return_type, abi)?;
        let result = records_checked(&name, &parameters, variadic.is_some(), returned.result)?;
        Ok(Self {
            name,
            convention: if abi == Some("managed") {
                Convention::Nts
            } else {
                Convention::C
            },
            retention: by_value_retention(retention_of(&roles), &parameters, &result),
            parameters,
            variadic,
            result,
            // Filled in by whoever resolved the callee, which is the only place
            // that has the declaration node.
            declared_at: None,
            roles,
            returns_string: returned.string,
            send: None,
            returns_owned: returned.owned,
            consumes,
            frameworks: Vec::new(),
            libraries: Vec::new(),
            defaults: given,
            result_as: returned.program,
        })
    }
}

/// What the callee keeps of each parameter, as far as the declaration says.
///
/// A scoped closure is called only during the call and its context is released
/// after it: nothing of either outlives the call, which is `NotRetained` stated
/// by the type rather than by a tag. Everything else starts `Unknown`, and an
/// `@ntsNoEscape` may narrow it where the callee is resolved.
/// A record passed by value is copied by C, so the storage the argument points
/// at is read and not kept. A record result is written through one more
/// argument, past the declared ones, into storage the callee never sees as an
/// address. Both are borrows, which is what lets a `NativeLocal` be either.
fn by_value_retention(mut retention: Vec<Retention>, parameters: &[Type], result: &Type) -> Vec<Retention> {
    for (at, ty) in parameters.iter().enumerate() {
        if matches!(ty, Type::Record(_))
            && let Some(slot) = retention.get_mut(at)
        {
            *slot = Retention::NotRetained;
        }
    }
    if matches!(result, Type::Record(_)) {
        retention.resize(parameters.len(), Retention::Unknown);
        retention.push(Retention::NotRetained);
    }
    retention
}

/// `result`, once every record the signature passes or returns by value has
/// been checked, along with the one shape a record result's destination cannot
/// share: a variadic tail, which would put it after arguments whose count only
/// the call knows.
fn records_checked(name: &str, parameters: &[Type], variadic: bool, result: Type) -> Result<Type, String> {
    for ty in parameters.iter().chain([&result]) {
        if let Type::Record(record) = ty {
            by_value_record_is_passable(name, record)?;
        }
    }
    if variadic && matches!(result, Type::Record(_)) {
        return Err(format!("foreign function `{name}` is variadic and returns a record by value"));
    }
    Ok(result)
}

/// What a record must be to cross by value.
///
/// - **No counted handle inside.** Copying one would duplicate an ownership
///   edge, which is `classify`'s question and a different feature. ARC agrees:
///   a struct with a `__strong` member is a non-trivial C struct.
/// - **A C spelling.** An untagged record has none, so neither the prototype
///   nor the cast can name it.
/// - **Not packed and no flexible member.** A packed record's registers are
///   not what its members suggest, and a flexible member has no extent to
///   copy.
fn by_value_record_is_passable(name: &str, record: &Record) -> Result<(), String> {
    let refuse = |why: &str| Err(format!("foreign function `{name}` passes `{}` by value, which {why}", record.name));
    if record.untagged() {
        return refuse("C has no name for");
    }
    if record.packed {
        return refuse("is packed; take it by pointer");
    }
    if let Some(field) = record.fields.iter().find(|field| field.ty.holds_counted()) {
        return Err(format!(
            "foreign function `{name}` passes `{}` by value, and its member `{}` is a counted handle: a copy would be a second owner",
            record.name, field.name
        ));
    }
    if record.fields.iter().any(|field| matches!(field.ty, Pointee::Flexible(_))) {
        return refuse("ends in a flexible array member with no extent to copy");
    }
    Ok(())
}

fn retention_of(roles: &[Role]) -> Vec<Retention> {
    roles
        .iter()
        .scan(false, |scoped, role| {
            Some(match role {
                Role::Closure { lifetime: Lifetime::Call, .. } => {
                    *scoped = true;
                    Retention::NotRetained
                }
                Role::ClosureData if *scoped => Retention::NotRetained,
                _ => {
                    *scoped = false;
                    Retention::Unknown
                }
            })
        })
        .collect()
}

/// The C parameters one `Closure<F>` or `ScopedClosure<F>` becomes: the
/// callback with the context as its last parameter, the context, and for a
/// retained closure the function that releases it.
fn closure_slots(
    snapshot: &SemanticSnapshot,
    name: &str,
    parameter: &str,
    function: TypeId,
    kind: ClosureKind,
) -> Result<Vec<(Type, Role)>, String> {
    let Some(Type::FnPointer(declared)) = abi_type(snapshot, function) else {
        return Err(format!(
            "foreign function `{name}` closure parameter `{parameter}` whose signature has no native ABI type"
        ));
    };
    let context = Type::Pointer(Pointee::Void);
    let mut callback = declared.parameters.clone();
    callback.push(context.clone());
    let bridge = std::sync::Arc::new(FnPointer::spell(callback, (*declared.result).clone()));
    if matches!(kind, ClosureKind::Block) {
        return Ok(vec![(context, Role::Block { bridge, signature: declared })]);
    }
    let lifetime = match kind {
        // A block returned above; its lend is the call's, as a scoped one's.
        ClosureKind::Scoped | ClosureKind::Block => Lifetime::Call,
        ClosureKind::Once => Lifetime::Once,
        ClosureKind::Retained | ClosureKind::Erased(_) => Lifetime::Notified,
    };
    // What C's parameter is: the bridge's own type, or for an erased closure
    // `GCallback`, which the bridge is converted to.
    let slot = match kind {
        ClosureKind::Erased(_) => Type::FnPointer(std::sync::Arc::new(FnPointer::spell(Vec::new(), Type::Void))),
        ClosureKind::Scoped | ClosureKind::Once | ClosureKind::Retained | ClosureKind::Block => {
            Type::FnPointer(bridge.clone())
        }
    };
    let mut slots = vec![(slot, Role::Closure { lifetime, bridge }), (context.clone(), Role::ClosureData)];
    match kind {
        ClosureKind::Scoped | ClosureKind::Once | ClosureKind::Block => {}
        ClosureKind::Retained => slots.push((
            Type::FnPointer(std::sync::Arc::new(FnPointer::spell(vec![context], Type::Void))),
            Role::ClosureNotify,
        )),
        // The destroy function's C type is the binding's to state: C libraries
        // do not agree on one, and GLib's takes the `GClosure` second.
        ClosureKind::Erased(notify) => {
            let Some(Type::FnPointer(notify)) = abi_type(snapshot, notify) else {
                return Err(format!(
                    "foreign function `{name}` closure parameter `{parameter}` whose destroy function has no native ABI type"
                ));
            };
            if notify.parameters.first() != Some(&context) || *notify.result != Type::Void {
                return Err(format!(
                    "foreign function `{name}` closure parameter `{parameter}` whose destroy function does not take the context first and return nothing"
                ));
            }
            slots.push((Type::FnPointer(notify), Role::ClosureNotify));
        }
    }
    Ok(slots)
}

/// When a closure lent to C is given back, and by whom.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lifetime {
    /// After the call that lent it (`ScopedClosure`): C calls it only during
    /// that call.
    Call,
    /// When C calls the destroy function passed beside it (`Closure`,
    /// `ErasedClosure`).
    Notified,
    /// By the bridge, after C's one call of it (`OnceClosure`): GIO's
    /// `GAsyncReadyCallback`, which comes with no destroy function.
    Once,
}

/// Which closure a `c:` parameter asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClosureKind {
    /// `ScopedClosure<F>`: called only during the call.
    Scoped,
    /// `OnceClosure<F>`: called once, later, then never again.
    Once,
    /// `Closure<F>`: kept, and released by a `void (*)(void *)`.
    Retained,
    /// `ErasedClosure<F, N>`: kept, handed over as `GCallback`, and released
    /// by a destroy function of type `N`.
    Erased(TypeId),
    /// `Block<F>` (`objc:types`): an Objective-C block, which carries its
    /// own context and is released by the block runtime, not by a destroy
    /// function beside it.
    Block,
}

/// The function type inside a `Closure<F>` or `ScopedClosure<F>`, and whether
/// it is the scoped one.
///
/// Both are `F & { readonly __c_closure?: "retained" | "scoped" }`. The marker
/// is optional so that an arrow, which has no such property, is assignable --
/// which is also why this reads it directly rather than through the schema's
/// `marker`, which accepts required properties only.
fn closure(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<(TypeId, ClosureKind)> {
    let kind_of = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
    // An optional property reads as `T | undefined`: the `T`.
    let defined = |id: TypeId| -> Option<TypeId> {
        match kind_of(id)? {
            TypeKind::Union(members) => {
                members.iter().copied().find(|member| !matches!(kind_of(*member), Some(TypeKind::Undefined)))
            }
            _ => Some(id),
        }
    };
    let TypeKind::Intersection(parts) = kind_of(ty)? else {
        return None;
    };
    let mut function = None;
    let mut marker = None;
    let mut notify = None;
    for part in parts {
        match kind_of(*part)? {
            TypeKind::Function(_) => function = Some(*part),
            TypeKind::Object { properties } => {
                let closure = properties.iter().find(|p| p.name == "___c_closure")?;
                let TypeKind::Literal(LiteralValue::String(kind)) = kind_of(defined(closure.ty)?)? else {
                    return None;
                };
                marker = Some(kind.clone());
                notify = properties.iter().find(|p| p.name == "___c_notify").and_then(|p| defined(p.ty));
            }
            _ => return None,
        }
    }
    let kind = match marker?.as_str() {
        "scoped" => ClosureKind::Scoped,
        "once" => ClosureKind::Once,
        "retained" => ClosureKind::Retained,
        "erased" => ClosureKind::Erased(notify?),
        "block" => ClosureKind::Block,
        _ => return None,
    };
    Some((function?, kind))
}

/// `CStrings<Q>` or `CBytes<Q>`, possibly `Counted<…>`, possibly `| null`,
/// as declared.
struct NativeArray {
    /// `Role::Strings` or `Role::Bytes`: what the call makes of it.
    role: Role,
    /// The argument as the program holds it: `string[]`, or the
    /// `Uint8Array`'s view.
    managed: HirType,
    /// The whole parameter's C type: `char **`, `const uint8_t *`, ...
    c: Type,
    nullable: bool,
    /// The length slot's C type, and whether it comes after the array.
    count: Option<(TypeId, bool)>,
}

/// The argument's representation where a parameter is `CStrings` or
/// `CBytes`: the value the markers are intersected with, which has one where
/// the markers have none.
pub(crate) fn native_array_argument(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<HirType> {
    native_array(snapshot, ty).map(|array| array.managed)
}

/// Read a `CStrings` or `CBytes` parameter type, or `None` for any other.
///
/// The markers sit on object types intersected with the value -- a
/// `readonly string[]`, a `Uint8Array` -- the way `Closure`'s sit on the
/// function type, so this reads the parts of one intersection and nothing
/// deeper. A part is a marker when every property it has is one; the value
/// is the other part, and is an object type with properties of its own.
fn native_array(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<NativeArray> {
    let kind_of = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
    // An optional marker reads as `T | undefined`: the `T`.
    let defined = |id: TypeId| -> Option<TypeId> {
        match kind_of(id)? {
            TypeKind::Union(members) => {
                members.iter().copied().find(|member| !matches!(kind_of(*member), Some(TypeKind::Undefined)))
            }
            _ => Some(id),
        }
    };
    let text = |id: TypeId| match kind_of(defined(id)?)? {
        TypeKind::Literal(LiteralValue::String(text)) => Some(text.clone()),
        _ => None,
    };
    let (ty, nullable) = match kind_of(ty)? {
        TypeKind::Union(parts) => {
            let [a, b] = parts.as_slice() else { return None };
            match (kind_of(*a)?, kind_of(*b)?) {
                (TypeKind::Null, _) => (*b, true),
                (_, TypeKind::Null) => (*a, true),
                _ => return None,
            }
        }
        _ => (ty, false),
    };
    let TypeKind::Intersection(parts) = kind_of(ty)? else { return None };
    let mut strings = None;
    let mut bytes = None;
    let mut value = None;
    let mut count = None;
    let mut after = true;
    for part in parts {
        let markers = match kind_of(*part)? {
            TypeKind::Object { properties }
                if !properties.is_empty() && properties.iter().all(|p| p.name.starts_with("___c_")) =>
            {
                properties
            }
            _ => {
                if value.replace(*part).is_some() {
                    return None;
                }
                continue;
            }
        };
        for property in markers {
            match property.name.as_str() {
                "___c_strings" => strings = Some(text(property.ty)?),
                "___c_bytes" => bytes = Some(text(property.ty)?),
                "___c_count" => count = Some(defined(property.ty)?),
                "___c_count_at" => after = text(property.ty)? == "after",
                _ => return None,
            }
        }
    }
    let value = value?;
    let char = Pointee::Scalar(Scalar::Char);
    let (role, managed, c) = match (strings, bytes) {
        (Some(spelling), None) => {
            let TypeKind::Array(element) = kind_of(value)? else { return None };
            if !matches!(kind_of(*element)?, TypeKind::String) {
                return None;
            }
            let c = match spelling.as_str() {
                "char" => Type::Pointer(Pointee::Pointer(Box::new(char))),
                "const" => Type::Pointer(Pointee::Pointer(Box::new(Pointee::Const(Box::new(char))))),
                "const const" => Type::Pointer(Pointee::Const(Box::new(Pointee::Pointer(Box::new(Pointee::Const(
                    Box::new(char),
                )))))),
                _ => return None,
            };
            let managed = HirType::Managed(ManagedType::Array(Box::new(HirType::Managed(ManagedType::String))));
            (Role::Strings, managed, c)
        }
        (None, Some(spelling)) => {
            // A view of bytes, whatever TypeScript calls its class: what the
            // program passes is its storage.
            let managed = super::lower::representation(snapshot, value)?;
            let HirType::Managed(ManagedType::View(element)) = &managed else { return None };
            if **element != (HirType::Int { bits: 8, signed: false }) {
                return None;
            }
            let pointee = match spelling.as_str() {
                "const uint8_t" => Pointee::Const(Box::new(Pointee::Scalar(Scalar::UInt8))),
                "uint8_t" => Pointee::Scalar(Scalar::UInt8),
                "const char" => Pointee::Const(Box::new(char)),
                "const void" => Pointee::Const(Box::new(Pointee::Void)),
                "void" => Pointee::Void,
                _ => return None,
            };
            (Role::Bytes, managed, Type::Pointer(pointee))
        }
        _ => return None,
    };
    Some(NativeArray { role, managed, c, nullable, count: count.map(|ty| (ty, after)) })
}

/// The C slots a `CStrings` or `CBytes` parameter occupies, `at` being the
/// first one's index: the array, and its length before or after it.
fn array_slots(
    snapshot: &SemanticSnapshot,
    name: &str,
    parameter: &str,
    array: &NativeArray,
    at: usize,
) -> Result<Vec<(Type, Role)>, String> {
    let Some((count, after)) = array.count else {
        return Ok(vec![(array.c.clone(), array.role.clone())]);
    };
    let Some(length @ Type::Scalar(_)) = abi_type(snapshot, count) else {
        return Err(format!("foreign function `{name}` parameter `{parameter}`: a `Counted` length that is not a C integer brand"));
    };
    Ok(if after {
        vec![(array.c.clone(), array.role.clone()), (length, Role::Length { array: at, nullable: array.nullable })]
    } else {
        vec![(length, Role::Length { array: at + 1, nullable: array.nullable }), (array.c.clone(), array.role.clone())]
    })
}

/// A type under `@ntsAbi managed`, which passes the managed value itself.
fn managed_abi_type(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Type> {
    match super::lower::representation(snapshot, ty)? {
        HirType::Void => Some(Type::Void),
        HirType::Bool => Some(Type::Bool),
        HirType::Float { bits: 64 } => Some(Type::Scalar(Scalar::Double)),
        HirType::Managed(ManagedType::Object(_))
            if matches!(snapshot.types.get(ty.0 as usize)?.kind, TypeKind::Tuple(_)) =>
        {
            None
        }
        HirType::Managed(ty) => Some(Type::Managed(ty)),
        HirType::Erased => Some(Type::Erased),
        HirType::BigInt => Some(Type::BigInt),
        _ => None,
    }
}

/// The C result a returned `string[]` or `string` is read from: borrowed
/// until `@ntsFree` says otherwise, which makes it `char **` / `char *` --
/// the rule both follow, and `GLib`'s own spelling of both.
fn returned_text(array: bool, string: bool) -> Option<Type> {
    let char = Pointee::Scalar(Scalar::Char);
    if array {
        Some(Type::Pointer(Pointee::Const(Box::new(Pointee::Pointer(Box::new(Pointee::Const(Box::new(char))))))))
    } else if string {
        Some(Type::Pointer(Pointee::Const(Box::new(char))))
    } else {
        None
    }
}

/// The `@ntsThrows` parameter: C's `E **error`, and the converter that makes
/// a reported error its message.
///
/// Optional, so its type is `T | undefined` -- and `T` is `Ptr<E | null> |
/// null`. The pointer-to-pointer member is the slot; the absent ones all mean
/// "no slot", which is what leaving it out says.
/// Every parameter the tags name exists, asked before any parameter is read
/// so that a refusal names the tag rather than the parameter it failed to
/// claim. An `@ntsThrows` naming none would leave the call with no slot, and
/// nothing it reported would ever be thrown; a default is for a parameter the
/// caller may leave out, and given to any other it would be text nothing
/// reads.
fn tags_name_parameters(
    name: &str,
    signature: &nts_semantic_schema::SignatureRecord,
    throws: Option<(&str, &str)>,
    defaults: &[(String, ParameterDefault)],
) -> Result<(), String> {
    let find = |named: &str| signature.parameters.iter().find(|parameter| parameter.name == named);
    if let Some((slot, _)) = throws
        && find(slot).is_none()
    {
        return Err(format!("foreign function `{name}` @ntsThrows names no parameter `{slot}`"));
    }
    for (named, _) in defaults {
        match find(named) {
            None => return Err(format!("foreign function `{name}` @ntsDefault names no parameter `{named}`")),
            Some(parameter) if !parameter.optional => {
                return Err(format!("foreign function `{name}` @ntsDefault for `{named}`, which is not optional"));
            }
            Some(_) => {}
        }
    }
    Ok(())
}

/// What a foreign function hands back, read from its declared return type.
struct Returned {
    /// C's result type.
    result: Type,
    /// A string, or a `NULL`-terminated array of them, copied at the call.
    string: Option<ReturnedString>,
    /// `Owned<T>`: the reference comes with the handle.
    owned: bool,
    /// `Declared<T, D>`: the handle the program has where C declares `D`.
    program: Option<Type>,
}

fn returned(snapshot: &SemanticSnapshot, name: &str, ty: TypeId, abi: Option<&str>) -> Result<Returned, String> {
    let string = if abi.is_none() { returned_string(snapshot, ty) } else { None };
    let array = if abi.is_none() { returned_strings(snapshot, ty) } else { None };
    let declared = declared_result(snapshot, name, ty)?;
    let result = match (returned_text(array.is_some(), string.is_some()), &declared) {
        (Some(text), _) => text,
        (None, Some((c, _))) => c.clone(),
        (None, None) => if abi == Some("managed") { managed_abi_type(snapshot, ty) } else { abi_type(snapshot, ty) }
            .ok_or_else(|| no_abi_type(name, None))?,
    };
    Ok(Returned {
        result,
        string: array.map(|nullable| ReturnedString { nullable, free: None, array: true }).or(string),
        owned: owned_result(snapshot, name, ty)?,
        // A `CBool`'s integer, read back as a boolean.
        program: declared.map(|(_, program)| program).or_else(|| int_bool(snapshot, ty).map(|_| Type::Bool)),
    })
}

/// Whether `ty` -- or its non-null half -- carries the optional brand
/// `property` (tsgo's escaped name), as `Owned<T>` and `Consumed<T>` do.
fn branded(snapshot: &SemanticSnapshot, ty: TypeId, property: &str) -> bool {
    let kind = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
    let ty = match kind(ty) {
        Some(TypeKind::Union(members)) => match members.as_slice() {
            [a, b] if matches!(kind(*a), Some(TypeKind::Null)) => *b,
            [a, b] if matches!(kind(*b), Some(TypeKind::Null)) => *a,
            _ => return false,
        },
        _ => ty,
    };
    let Some(TypeKind::Intersection(parts)) = kind(ty) else { return false };
    parts.iter().any(|part| {
        matches!(kind(*part), Some(TypeKind::Object { properties })
            if matches!(properties.as_slice(), [p] if p.name == property && p.optional && p.readonly))
    })
}

/// Whether a parameter is typed `Consumed<T>` -- GIR's
/// `transfer-ownership="full"` on an argument: the callee keeps the
/// reference it is given, so the caller hands one over rather than releasing
/// its own after the call.
///
/// # Errors
///
/// `Consumed` on a handle the program does not count: there is no reference
/// here to hand.
fn consumed(snapshot: &SemanticSnapshot, name: &str, parameter: &nts_semantic_schema::ParameterRecord, ty: &Type) -> Result<bool, String> {
    if !branded(snapshot, parameter.ty, "___c_consumed") {
        return Ok(false);
    }
    if !matches!(ty, Type::Pointer(pointee) if pointee.counting().is_some()) {
        return Err(format!(
            "foreign function `{name}` takes over `{}`, a handle the program does not count; declare its class with `GObjectClass`, not `Class`",
            parameter.name
        ));
    }
    Ok(true)
}

/// Whether a result is typed `Owned<T>` -- GIR's `transfer-ownership="full"`:
/// the caller has the reference, and takes no other.
///
/// # Errors
///
/// `Owned` on a handle the program does not count: a reference handed over
/// that nothing would ever drop.
fn owned_result(snapshot: &SemanticSnapshot, name: &str, ty: TypeId) -> Result<bool, String> {
    let owned = branded(snapshot, ty, "___c_owned");
    if owned && pointer(snapshot, ty).is_none_or(|pointee| pointee.counting().is_none()) {
        return Err(format!(
            "foreign function `{name}` hands back a reference the caller owns, as a handle the program does not count; declare its class with `GObjectClass`, not `Class`"
        ));
    }
    Ok(owned)
}

/// A result typed `Declared<T, D>`: C's type, a pointer to `D`, and the
/// program's, a pointer to `T`. `None` for any other result.
///
/// The claim is trusted: that `D` is an ancestor of `T` bounds its shape and
/// not its truth, and a C function returning a sibling of `T` would be read
/// as a `T`. What is refused is a `D` that is not an ancestor at all.
///
/// # Errors
///
/// `D` not a handle among `T`'s declared ancestors -- which includes an
/// interface `T` implements, since a handle's chain records its parents only.
fn declared_result(snapshot: &SemanticSnapshot, name: &str, ty: TypeId) -> Result<Option<(Type, Type)>, String> {
    let kind = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
    // `Declared<T, D> | null`: the handle, which may be NULL like any other.
    let ty = match kind(ty) {
        Some(TypeKind::Union(members)) => match members.as_slice() {
            [a, b] if matches!(kind(*a), Some(TypeKind::Null)) => *b,
            [a, b] if matches!(kind(*b), Some(TypeKind::Null)) => *a,
            _ => return Ok(None),
        },
        _ => ty,
    };
    let Some(TypeKind::Intersection(parts)) = kind(ty) else { return Ok(None) };
    let declared = parts.iter().find_map(|part| match kind(*part) {
        Some(TypeKind::Object { properties }) => match properties.as_slice() {
            [property] if property.name == "___c_declared" && property.optional && property.readonly => Some(property.ty),
            _ => None,
        },
        _ => None,
    });
    let Some(declared) = declared else { return Ok(None) };
    let declared = match kind(declared) {
        Some(TypeKind::Union(members)) => members.iter().copied().find(|m| !matches!(kind(*m), Some(TypeKind::Undefined))),
        _ => Some(declared),
    };
    let handle = |pointee: Option<Pointee>| match pointee {
        Some(Pointee::Opaque(handle)) => Some(handle),
        _ => None,
    };
    let (Some(c), Some(program)) = (handle(declared.and_then(|d| pointer(snapshot, d))), handle(pointer(snapshot, ty))) else {
        return Err(format!("foreign function `{name}` with a `Declared` result whose types are not both handles"));
    };
    if !program.upcasts_to(&c) {
        return Err(format!(
            "foreign function `{name}` declares its result `{}` for a `{}`, which is not among its ancestors",
            c.tag, program.tag
        ));
    }
    Ok(Some((Type::Pointer(Pointee::Opaque(c)), Type::Pointer(Pointee::Opaque(program)))))
}

/// The C type of an optional parameter `@ntsDefault` gives a value: its type
/// without the `undefined` that being optional adds. An integer needs one C
/// integer or boolean, in range; `null` needs a pointer whose type admits it.
fn defaulted(
    snapshot: &SemanticSnapshot,
    name: &str,
    parameter: &nts_semantic_schema::ParameterRecord,
    value: ParameterDefault,
) -> Result<Type, String> {
    let kind = |ty: TypeId| snapshot.types.get(ty.0 as usize).map(|record| &record.kind);
    let members = match kind(parameter.ty) {
        Some(TypeKind::Union(parts)) => parts.clone(),
        _ => vec![parameter.ty],
    };
    let members: Vec<TypeId> = members.into_iter().filter(|m| !matches!(kind(*m), Some(TypeKind::Undefined))).collect();
    let nullable = members.iter().any(|m| matches!(kind(*m), Some(TypeKind::Null)));
    let payload: Vec<TypeId> = members.into_iter().filter(|m| !matches!(kind(*m), Some(TypeKind::Null))).collect();
    let parameter = &parameter.name;
    // `boolean` is `true | false` to the checker, so it arrives here as two
    // literals once `undefined` is gone.
    let boolean = |m: &TypeId| matches!(kind(*m), Some(TypeKind::Literal(LiteralValue::Boolean(_))));
    // And a `CEnum` is its members, each `member & brand`.
    let ty = match payload.as_slice() {
        [one] => abi_type(snapshot, *one),
        [_, _] if payload.iter().all(boolean) => Some(Type::Bool),
        members => enum_members_scalar(snapshot, members).or_else(|| int_bool_members(snapshot, members)).map(Type::Scalar),
    };
    match (value, ty) {
        (ParameterDefault::Int(value), Some(Type::Bool)) if !nullable => {
            if value == 0 || value == 1 {
                Ok(Type::Bool)
            } else {
                Err(format!("foreign function `{name}` @ntsDefault gives boolean `{parameter}` {value}, which is not 0 or 1"))
            }
        }
        (ParameterDefault::Int(value), Some(Type::Scalar(scalar))) if !nullable => match scalar.representation() {
            HirType::Int { bits, signed } => {
                let (low, high) = if signed {
                    (-(1i128 << (bits - 1)), (1i128 << (bits - 1)) - 1)
                } else {
                    (0, (1i128 << bits) - 1)
                };
                if (low..=high).contains(&i128::from(value)) {
                    Ok(Type::Scalar(scalar))
                } else {
                    Err(format!("foreign function `{name}` @ntsDefault gives `{parameter}` {value}, outside its C type"))
                }
            }
            _ => Err(format!("foreign function `{name}` @ntsDefault for floating-point `{parameter}`, which takes only an integer or null")),
        },
        (ParameterDefault::Null, Some(ty @ Type::Pointer(_))) if nullable => Ok(ty),
        (ParameterDefault::Int(_), _) => Err(format!(
            "foreign function `{name}` @ntsDefault gives `{parameter}` an integer, which only a C integer or boolean parameter takes"
        )),
        (ParameterDefault::Null, _) => Err(format!(
            "foreign function `{name}` @ntsDefault gives `{parameter}` null, which only a C pointer parameter admitting `null` takes"
        )),
    }
}

fn error_slot(
    snapshot: &SemanticSnapshot,
    name: &str,
    parameter: &nts_semantic_schema::ParameterRecord,
    converter: &str,
) -> Result<(Type, Role), String> {
    let members = match snapshot.types.get(parameter.ty.0 as usize).map(|record| &record.kind) {
        Some(TypeKind::Union(parts)) => parts.clone(),
        _ => vec![parameter.ty],
    };
    let Some(ty) = members
        .into_iter()
        .filter_map(|member| abi_type(snapshot, member))
        .find(|ty| matches!(ty, Type::Pointer(Pointee::Pointer(_))))
    else {
        return Err(format!(
            "foreign function `{name}` @ntsThrows parameter `{}` that is not a pointer to a pointer",
            parameter.name
        ));
    };
    if !is_c_identifier(converter) {
        return Err(format!("foreign function `{name}` @ntsThrows converter `{converter}` that is not a C function name"));
    }
    Ok((ty, Role::ErrorSlot { converter: converter.to_owned() }))
}

/// The parameters only the C convention has, each a type TypeScript spells
/// its own way: `None` for any other, which is read as a plain ABI type.
///
/// - **`object`**: C's `void *`, any native pointer at all -- what `gpointer`
///   means. TypeScript also lets a managed object through, and lowering
///   refuses one at the call.
/// - **`string`**, or a string literal type: `const char *`, converted at the
///   call. Only in the C convention: the managed one passes the string itself,
///   which is what `@ntsAbi managed` means.
/// - **`Closure<F>` / `ScopedClosure<F>` / `ErasedClosure<F, N>`**: the
///   callback C calls with the closure's context last, then the context, then
///   -- when C keeps it -- the function that releases it.
/// - **`CStrings<Q>`** or **`CBytes<Q>`**, optionally `Counted`: a `char **`
///   or a byte pointer, and its length
///   beside it when C takes one. `at` is the C index the first slot lands
///   in, which a length slot names its array by.
fn c_parameter(
    snapshot: &SemanticSnapshot,
    name: &str,
    parameter: &nts_semantic_schema::ParameterRecord,
    at: usize,
) -> Result<Option<Vec<(Type, Role)>>, String> {
    // Labels: one slot per property, in the order the literal declares them.
    if let Some(labels) = labels_of(snapshot, parameter.ty) {
        return labels
            .iter()
            .enumerate()
            .map(|(at, (key, ty))| {
                let ty = abi_type(snapshot, *ty)
                    .filter(|ty| *ty != Type::Void)
                    .ok_or_else(|| no_abi_type(name, Some(&format!("{}.{key}", parameter.name))))?;
                Ok((ty, Role::Label { key: key.clone(), last: at + 1 == labels.len() }))
            })
            .collect::<Result<Vec<_>, String>>()
            .map(Some);
    }
    if let Some(array) = native_array(snapshot, parameter.ty) {
        return array_slots(snapshot, name, &parameter.name, &array, at).map(Some);
    }
    if is_object_pointer(snapshot, parameter.ty) {
        return Ok(Some(vec![(Type::Pointer(Pointee::Void), Role::Plain)]));
    }
    if let Some(encoding) = string_encoding(snapshot, parameter.ty) {
        return Ok(Some(vec![(encoding.c_type(), Role::String(encoding))]));
    }
    if is_string_literal(snapshot, parameter.ty) {
        return Ok(Some(vec![(Encoding::Utf8.c_type(), Role::String(Encoding::Utf8))]));
    }
    match closure(snapshot, parameter.ty) {
        Some((function, kind)) => closure_slots(snapshot, name, &parameter.name, function, kind).map(Some),
        None => Ok(None),
    }
}


/// Whether a declared parameter is a TypeScript `string`, or `string | null`.
///
/// Both lower to a string reference, `null` as the null one -- checked with
/// `nts hir`, not assumed: `string | null` is `managed<str>` and its `null`
/// is `const null : managed<str>`. The conversion maps a null string to a null
/// `const char *`, which is what C's "nullable" means. `string | undefined` is
/// not the same: two absences make it an erased value, which is not the
/// `NtsString *` the conversion reads, so it is left refused.
fn is_string(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    string_encoding(snapshot, ty) == Some(Encoding::Utf8)
}

/// One half of a `CBool` as a value (`true & brand`): exactly a boolean at
/// run time, since the brand is optional and never exists. Two parts, a
/// boolean literal and an object whose only property is the optional,
/// readonly `__c_bool`.
pub(crate) fn is_branded_bool(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    let kind = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
    match kind(ty) {
        Some(TypeKind::Intersection(parts)) => {
            let [a, b] = parts.as_slice() else { return false };
            let literal = |id: TypeId| matches!(kind(id), Some(TypeKind::Literal(LiteralValue::Boolean(_))));
            let brand = |id: TypeId| {
                matches!(kind(id), Some(TypeKind::Object { properties })
                    if matches!(properties.as_slice(), [p] if p.name == "___c_bool" && p.optional && p.readonly))
            };
            (literal(*a) && brand(*b)) || (literal(*b) && brand(*a))
        }
        _ => false,
    }
}

/// A `string` with an optional C-boundary brand (`Utf16String`): an
/// intersection whose value is exactly a string.
///
/// **Exactly** that: two parts, `string` and an object whose only property is
/// the optional, readonly `__c_utf16` marker. A required property, or any
/// other one -- `string & { real: number }` -- is a value with a layout, and
/// is not this.
pub(crate) fn is_branded_string(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    matches!(snapshot.types.get(ty.0 as usize).map(|record| &record.kind), Some(TypeKind::Intersection(_)))
        && string_encoding(snapshot, ty).is_some()
}

/// How a `string` parameter crosses, or `None` for anything that is not one:
/// `string` as UTF-8 and `Utf16String` -- `string` with the optional
/// `__c_utf16` brand -- as UTF-16, either one optionally `| null`.
fn string_encoding(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Encoding> {
    let kind = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
    match kind(ty)? {
        TypeKind::String => Some(Encoding::Utf8),
        TypeKind::Intersection(parts) => {
            let [a, b] = parts.as_slice() else { return None };
            let (text, brand) = if matches!(kind(*a), Some(TypeKind::String)) { (a, b) } else { (b, a) };
            if !matches!(kind(*text), Some(TypeKind::String)) {
                return None;
            }
            let TypeKind::Object { properties } = kind(*brand)? else { return None };
            match properties.as_slice() {
                [property] if property.name == "___c_utf16" && property.optional && property.readonly => {
                    Some(Encoding::Utf16)
                }
                _ => None,
            }
        }
        TypeKind::Union(parts) => {
            let [a, b] = parts.as_slice() else { return None };
            let payload = if matches!(kind(*a), Some(TypeKind::Null)) { *b } else if matches!(kind(*b), Some(TypeKind::Null)) { *a } else { return None };
            string_encoding(snapshot, payload)
        }
        _ => None,
    }
}

/// A string literal type, `"clicked"`: a parameter whose only value is that
/// text, which a binding uses to pin an argument C reads as a name. It crosses
/// as any `string` does; a return is never one, since C cannot promise it.
fn is_string_literal(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    matches!(
        snapshot.types.get(ty.0 as usize).map(|record| &record.kind),
        Some(TypeKind::Literal(LiteralValue::String(_)))
    )
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
    if matches!(ty, Type::Record(_)) {
        return Err(format!("foreign function `{name}` passes records by value through `...`, which C cannot say how to"));
    }
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
            // Its representation is a pointer to it, which a `Ptr<T>` shares:
            // compared that way, `f(r: NSRect)` and `f(r: NSRect *)` agree.
            (Self::Record(a), Self::Record(b)) => a == b,
            (Self::Record(_), _) | (_, Self::Record(_)) => false,
            _ => self.representation() == other.representation(),
        }
    }
}

/// The C ABI a native target lays storage out and passes scalars by.
///
/// **A backend fact, not a lowering one.** HIR is shared by every target a
/// program is built for, so lowering never asks which of these it is: a
/// `c_long` is an exact `i64` value in HIR everywhere, and only the slot C
/// reads it from is narrower on Windows. Each backend is handed its target's
/// ABI and resolves sizes, offsets and the boundary conversions from it.
///
/// There is no default, and that is the point: every function taking one
/// takes it as a required argument, so a caller cannot get the wrong ABI by
/// forgetting to pass it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NativeAbi {
    /// LP64 System V (Linux, macOS): `long` is 64 bits, and bit-fields use
    /// the System V placement rules.
    SysV,
    /// Windows on `x86_64` and arm64, mingw and MSVC alike.
    ///
    /// **What this names is the data model, plus the MS x64 conventions this
    /// compiler implements, and no more.** The data model is LLP64 on both
    /// arches: `long` is 32 bits, while `long long`, pointers, `size_t` and
    /// `ptrdiff_t` stay 64. Bit-fields use the MS placement rules, which this
    /// compiler does not implement, so a record holding one has no layout.
    ///
    /// **Argument classification and aggregate passing are not in it**, and
    /// they differ between the two arches: AAPCS64 on arm64 Windows, the MS
    /// x64 convention on `x86_64`. Nothing here passes an aggregate by value
    /// yet. The first rule that does must split this variant by arch, not take
    /// `x86_64`'s answer for arm64 by reaching for `Win64`.
    Win64,
}

impl NativeAbi {
    /// **The ABI a target-independent stage bounds sizes with.** Lowering
    /// refuses stack storage over a limit before it knows the target.
    ///
    /// `SysV` is an upper bound on every supported target's layout. Win64
    /// narrows `long` from 8 bytes to 4 and relaxes its alignment from 8 to 4
    /// at the same time, and narrowing a member together with its alignment
    /// cannot enlarge the record holding it: `{char; long}` goes from size 16
    /// and align 8 to size 8 and align 4. `long` is the only scalar that
    /// differs between the two, and it only shrinks.
    ///
    /// **So the imprecision falls one way.** A limit checked at this ABI can
    /// refuse a program that would have fit on Windows. It can never accept
    /// one that does not. A surprising refusal on Windows near a limit is this
    /// documented cost, not a bug.
    pub const BOUND: Self = Self::SysV;
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
    /// C's `long` where it is 32 bits: Win64 (LLP64). A `number` in
    /// TypeScript, for Windows APIs, which are built on `LONG` and `DWORD`;
    /// portable code keeps `Long`, which is exact on every target. A backend
    /// whose `long` is 64 bits refuses it (`abi::unavailable_scalars`).
    Long32,
    ULong32,
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
            "__c_long32" => Self::Long32,
            "__c_ulong32" => Self::ULong32,
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

            Self::Int | Self::Int32 | Self::Long32 => HirType::Int {
                bits: 32,
                signed: true,
            },
            Self::UInt | Self::UInt32 | Self::ULong32 => HirType::Int {
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
            Self::Long | Self::Long32 => "long",
            Self::ULong | Self::ULong32 => "unsigned long",
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
    /// The slot C reads this scalar from, on `abi`.
    ///
    /// `representation` is the value's type in HIR, which is the same on every
    /// target. This is the storage and register type, and it differs from the
    /// representation only for `long` and `unsigned long` under Win64.
    #[must_use]
    pub const fn abi(self, abi: NativeAbi) -> HirType {
        match (self, abi) {
            (Self::Long, NativeAbi::Win64) => HirType::Int { bits: 32, signed: true },
            (Self::ULong, NativeAbi::Win64) => HirType::Int { bits: 32, signed: false },
            _ => self.representation(),
        }
    }

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
    if let Some(scalar) = enum_scalar(snapshot, ty) {
        return Some(scalar);
    }
    let TypeKind::Intersection(parts) = &snapshot.types.get(ty.0 as usize)?.kind else {
        return None;
    };
    if parts.len() != 2 {
        return None;
    }
    let mut base = None;
    let mut brand = None;
    let mut optional = false;
    for part in parts {
        match &snapshot.types.get(part.0 as usize)?.kind {
            TypeKind::Number => base = Some(false),
            TypeKind::BigInt => base = Some(true),
            TypeKind::Object { properties } if properties.len() == 1 => {
                let property = &properties[0];
                if !property.readonly || property.kind != MemberKind::Field {
                    return None;
                }
                // `number & { readonly __c_double?: true }`: the brand as an
                // optional `true`, which is how `objc:types` spells Swift's
                // `Double`, `Int` and `CGFloat`. A plain `number` is assignable
                // to it, so no cast is written, and it crosses as the brand's
                // C type all the same.
                if property.optional {
                    if !is_true(snapshot, property.ty) {
                        return None;
                    }
                    optional = true;
                }
                // The snapshot preserves the checker's unique-symbol flag;
                // accepting ordinary `symbol` would also accept a real slot.
                else if !matches!(snapshot.types.get(property.ty.0 as usize)?.kind,
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
    // A Swift-shaped number is a `number` whatever C's width is: Swift's `Int`
    // is 64 bits, and a program writes `list.count / 2` without a `bigint` in
    // sight. What a `number` cannot hold exactly -- an integer past 2^53 --
    // rounds, as it does in every bridge to JavaScript; the required brands
    // above keep `bigint` for code that needs every bit.
    if optional {
        return (!base?).then_some(brand);
    }
    (base? == brand.needs_exact_integer()).then_some(brand)
}

/// Whether a brand's type is `true`, or the `true | undefined` an optional
/// property of it reads as.
fn is_true(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    let is = |ty: TypeId| matches!(snapshot.types.get(ty.0 as usize).map(|t| &t.kind), Some(TypeKind::Literal(LiteralValue::Boolean(true))));
    match snapshot.types.get(ty.0 as usize).map(|t| &t.kind) {
        Some(TypeKind::Union(parts)) => parts.iter().any(|part| is(*part))
            && parts.iter().all(|part| is(*part) || matches!(snapshot.types.get(part.0 as usize).map(|t| &t.kind), Some(TypeKind::Undefined))),
        _ => is(ty),
    }
}

/// `CEnum<E, B>`: an enum that C takes as the integer brand `B`.
///
/// `E & { readonly __c_enum?: B }`, which the checker distributes over `E`'s
/// members, so it arrives as `member & brand` per member -- a union of them,
/// or one for a single-member enum. Every member a number literal, every
/// brand the one object, and `B` (optional, so `B | undefined`) a C integer:
/// an enum's members are integers, and nothing else is read as one.
fn enum_scalar(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Scalar> {
    match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Union(parts) => enum_members_scalar(snapshot, parts),
        TypeKind::Intersection(_) => enum_members_scalar(snapshot, &[ty]),
        _ => None,
    }
}

/// [`enum_scalar`] over the members themselves, for a union the checker
/// flattened further -- an optional `CEnum` parameter is its members and
/// `undefined`, in one union.
fn enum_members_scalar(snapshot: &SemanticSnapshot, members: &[TypeId]) -> Option<Scalar> {
    branded_members(snapshot, members, |literal| matches!(literal, LiteralValue::Number(_)), "___c_enum")
}

/// `CBool<B>`: a boolean C holds in the integer brand `B` -- `GLib`'s
/// `gboolean`, an `int`. `boolean & { readonly __c_bool?: B }`, which the
/// checker distributes into `true & brand | false & brand`. A parameter so
/// typed is `B`, and TypeScript's boolean widens into it; a result is `B`
/// read back as `!= 0`, as C reads an `int` as a truth value.
#[must_use]
pub fn int_bool(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Scalar> {
    match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Union(parts) => int_bool_members(snapshot, parts),
        _ => None,
    }
}

fn int_bool_members(snapshot: &SemanticSnapshot, members: &[TypeId]) -> Option<Scalar> {
    branded_members(snapshot, members, |literal| matches!(literal, LiteralValue::Boolean(_)), "___c_bool")
}

/// A union whose every member is a literal `is_member` accepts intersected
/// with one optional brand, `brand`, naming a C integer: `CEnum` and `CBool`.
fn branded_members(
    snapshot: &SemanticSnapshot,
    members: &[TypeId],
    is_literal: fn(&LiteralValue) -> bool,
    brand_name: &str,
) -> Option<Scalar> {
    let kind = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
    let is_member = |id: TypeId| matches!(kind(id), Some(TypeKind::Literal(literal)) if is_literal(literal));
    let mut brand = None;
    for &member in members {
        let TypeKind::Intersection(parts) = kind(member)? else { return None };
        let [a, b] = parts.as_slice() else { return None };
        let object = match (is_member(*a), is_member(*b)) {
            (true, false) => *b,
            (false, true) => *a,
            _ => return None,
        };
        if brand.is_some_and(|seen| seen != object) {
            return None;
        }
        brand = Some(object);
    }
    let TypeKind::Object { properties } = kind(brand?)? else { return None };
    let [property] = properties.as_slice() else { return None };
    // tsgo's escaped name: a source name beginning `__` has one more `_`.
    if property.name != brand_name || !property.readonly || !property.optional || property.kind != MemberKind::Field {
        return None;
    }
    let given: Vec<TypeId> = match kind(property.ty)? {
        TypeKind::Union(parts) => parts.iter().copied().filter(|p| !matches!(kind(*p), Some(TypeKind::Undefined))).collect(),
        _ => vec![property.ty],
    };
    let [given] = given.as_slice() else { return None };
    scalar(snapshot, *given).filter(|scalar| matches!(scalar.representation(), HirType::Int { .. }))
}

pub(crate) mod schema;
pub use schema::{is_layout, pointer, storage};
pub(crate) use schema::{extends_objc, is_objc_class, objc_meta};

/// Whether a declared parameter is TypeScript's `object`, or `object | null`.
///
/// `TypeFlags.NonPrimitive`, which the schema carries as a structured type.
/// The same test `FuncBuilder::is_the_object_type` makes in lowering; kept here
/// rather than shared because the two crates' copies should become one, and
/// that is a change to lowering for another day.
pub(crate) fn is_object_pointer(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    const NON_PRIMITIVE: u32 = 0x0002_0000;
    let kind = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
    let object = |id: TypeId| matches!(kind(id), Some(TypeKind::Structured { flags }) if *flags == NON_PRIMITIVE);
    match kind(ty) {
        Some(TypeKind::Union(parts)) => {
            let [a, b] = parts.as_slice() else { return false };
            (object(*a) && matches!(kind(*b), Some(TypeKind::Null))) || (object(*b) && matches!(kind(*a), Some(TypeKind::Null)))
        }
        _ => object(ty),
    }
}

/// A `string` result is C's `const char *`, copied into a string at the call;
/// `string | null` makes NULL a `null`. The free function, if any, comes from
/// the declaration's `@ntsFree`, where the callee is resolved.
fn returned_string(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<ReturnedString> {
    is_string(snapshot, ty).then(|| ReturnedString {
        nullable: !matches!(snapshot.types.get(ty.0 as usize).map(|record| &record.kind), Some(TypeKind::String)),
        free: None,
        array: false,
    })
}
/// A returned `string[]`, or `string[] | null` -- whether it is nullable --
/// read from C's NULL-terminated `char **`.
///
/// Plain, where a parameter is `CStrings<Q>`: a result is the program's own
/// value, so markers on it would follow it into every variable it is stored
/// in. The spelling is decided the way a returned string's is instead.
fn returned_strings(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<bool> {
    let kind_of = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
    let is_array = |id: TypeId| matches!(kind_of(id), Some(TypeKind::Array(element)) if matches!(kind_of(*element), Some(TypeKind::String)));
    if is_array(ty) {
        return Some(false);
    }
    let TypeKind::Union(parts) = kind_of(ty)? else { return None };
    let [a, b] = parts.as_slice() else { return None };
    let null = |id: TypeId| matches!(kind_of(id), Some(TypeKind::Null));
    ((null(*a) && is_array(*b)) || (null(*b) && is_array(*a))).then_some(true)
}

/// Whether `name` could be a C function's name: what `@ntsFree` may say.
#[must_use]
pub fn is_c_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[cfg(test)]
mod handles {
    use super::{Handle, Pointee};

    fn class(chain: &[&str]) -> Pointee {
        let (tag, ancestors) = chain.split_last().expect("a chain has a tag");
        Pointee::Opaque(Handle {
            tag: (*tag).to_owned(),
            ancestors: ancestors.iter().map(|&a| a.to_owned()).collect(),
            family: super::Family::C,
        })
    }

    /// Upward along the declared chain, and nowhere else.
    ///
    /// The downward and sideways arms are the ones TypeScript cannot be
    /// trusted with alone: `widget as GtkButton` typechecks, because the two
    /// types overlap.
    #[test]
    fn a_handle_converts_upward_along_its_chain_and_nowhere_else() {
        let object = class(&["_GObject"]);
        let widget = class(&["_GObject", "_GtkWidget"]);
        let button = class(&["_GObject", "_GtkWidget", "_GtkButton"]);
        let label = class(&["_GObject", "_GtkWidget", "_GtkLabel"]);
        let plain = Pointee::Opaque("_GtkWidget".into());

        assert!(button.converts_to(&widget));
        assert!(button.converts_to(&object));
        assert!(widget.converts_to(&object));
        assert!(button.converts_to(&Pointee::Const(Box::new(widget.clone()))));
        assert!(button.converts_to(&Pointee::Void));

        assert!(!widget.converts_to(&button), "downcast");
        assert!(!label.converts_to(&button), "sibling");
        assert!(!button.converts_to(&button), "a conversion to itself is equality, not this");
        // Same tag, no chain: a plain `Opaque` is a different declaration of
        // the struct, and nothing says it is the same class.
        assert!(!button.converts_to(&plain));
        assert!(!plain.converts_to(&widget));
        // A chain that shares the parent's tag but not its ancestry.
        assert!(!class(&["_Other", "_GtkWidget", "_GtkButton"]).converts_to(&widget));
    }
}

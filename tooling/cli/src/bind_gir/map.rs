//! GIR's model into what a binding says: every decision in `bind-gir` is here.
//!
//! **The C layer is spelled from `c:type`, and GIR supplies the rest.** A
//! header can check a C spelling; it cannot check ownership, nullability, or
//! which parameter carries a callback's `user_data`, and GIR states all three.
//! So a type's ABI comes from what C says it is -- `gtk_button_new` returns a
//! `GtkWidget *` although GIR calls the result a Button -- and the annotations
//! decide how TypeScript sees it.
//!
//! Each mapped type carries two spellings of one fact: the TypeScript text the
//! binding declares, and the compiler's own `native::Type`, whose C spelling
//! the self-check compiles against the headers. The second is the compiler's
//! code, not a copy of it, so the check asks the question the build's witness
//! will ask later.
//!
//! What cannot be mapped is refused with a [`Reason`], never guessed. The
//! reasons are counted, and the counts are the queue.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use nts_core::hir::native::{FnPointer, Handle, Pointee, Scalar, Type};

use super::model::{
    ArrayRef, Callable, CallableKind, Callback, Class, Direction, Namespace, Param, Repository, Scope,
    Transfer, TypeRef,
};

/// A type named from another module, or this one: `(module, name)`, the module
/// empty for this one.
type Reference = (String, String);

/// An interface a class implements: the name the binding writes and the C
/// tag it is, `("GtkEditable", "_GtkEditable")`.
type Implemented = (String, String);

/// What a signal's view calls: `g_signal_connect_data`, keeping the closure.
pub(crate) const CONNECT: &str = "nts_gobject_connect";

/// One namespace's binding, ready to write.
#[derive(Debug, Default)]
pub(crate) struct Binding {
    pub(crate) module: String,
    pub(crate) headers: Vec<String>,
    pub(crate) types: Vec<TypeDecl>,
    pub(crate) functions: Vec<Function>,
    pub(crate) enums: Vec<EnumDecl>,
    /// What each other module contributes to this one's signatures.
    pub(crate) imports: BTreeMap<String, BTreeSet<String>>,
    /// The `c:types` names the signatures use.
    pub(crate) brands: BTreeSet<&'static str>,
    pub(crate) refused: Vec<(String, Reason)>,
    /// Classes with a checked downcast helper.
    pub(crate) casts: Vec<Cast>,
    /// Each class's properties, by the class's C type. Which become a
    /// property of the class's methods is the emitter's call, since it depends
    /// on which of those methods the self-check kept.
    pub(crate) properties: BTreeMap<String, Vec<Accessor>>,
    /// What `new GtkButton({ … })` calls before its setters, by the class's
    /// C type.
    pub(crate) constructors: BTreeMap<String, Constructor>,
}

/// How a class is constructed with every property at its default: its own
/// `new` taking nothing (`gtk_button_new`), or else its view of
/// `g_object_new_with_properties` given its `GType` (`GtkLabel_construct`,
/// `gtk_label_get_type`).
#[derive(Debug)]
pub(crate) struct Constructor {
    pub(crate) function: String,
    pub(crate) get_type: Option<String>,
    /// For a class with construct-only properties, the properties the
    /// constructor takes, in its order: `g_list_store_new(item_type)`, which
    /// `new GListStore({ item_type })` calls with the literal's.
    pub(crate) from: Vec<String>,
}

/// A property as the binding names it (`icon_name`), and the methods GIR
/// says read and write it (`get_icon_name`).
#[derive(Debug)]
pub(crate) struct Accessor {
    pub(crate) name: String,
    pub(crate) getter: Option<String>,
    pub(crate) setter: Option<String>,
}

/// One `asGtkBox`-style helper: the class, and the function answering its
/// `GType`.
#[derive(Debug)]
pub(crate) struct Cast {
    pub(crate) class: String,
    pub(crate) get_type: String,
}

#[derive(Debug)]
pub(crate) enum TypeDecl {
    /// `Class<"_GtkButton", GtkWidget>`; the parent as `(module, name)` when
    /// it lives in another namespace.
    /// `counted` for a `GObject`, which the compiler counts: `GObjectClass`.
    /// `interface` for a `GObject` interface (`GObjectInterface`), and
    /// `implements` the interfaces a class declares, as `(name, tag)`.
    Class {
        name: String,
        tag: String,
        parent: Option<(String, String)>,
        counted: bool,
        interface: bool,
        implements: Vec<(String, String)>,
    },
}

#[derive(Debug, Clone)]
pub(crate) struct Function {
    /// The name the binding exports: the C symbol, or for a typed view of
    /// another function -- a signal's connect -- a name of its own.
    pub(crate) name: String,
    pub(crate) symbol: String,
    pub(crate) parameters: Vec<(String, Mapped)>,
    pub(crate) result: Mapped,
    /// Every C parameter in order, hidden context slots included: what the
    /// compiler will pass, and so what the self-check declares.
    pub(crate) c_parameters: Vec<Type>,
    pub(crate) deprecated: bool,
    /// `@ntsFree`: the function releasing a returned string the caller owns.
    pub(crate) free: Option<String>,
    /// `@ntsNoEscape`: the parameters the callee writes through during the
    /// call and keeps nothing of -- out parameters, which is what lets their
    /// storage be a `local` on the caller's stack.
    pub(crate) no_escape: Vec<String>,
    /// GIR's own name for the result where the C type is less specific --
    /// `gtk_button_new` returns a `GtkWidget *` that GIR says is a Button.
    pub(crate) returns: Option<String>,
    /// `(class, method)` where GIR declares this a method of a class: it is
    /// also written as `method(this: Class, ...)` on that class's methods, so
    /// `button.set_label(text)` calls it.
    pub(crate) method: Option<(String, String)>,
    /// `@ntsThrows`: the parameter GIR's `throws` adds, written optional so a
    /// caller that leaves it out has the failure thrown.
    pub(crate) throws: Option<String>,
    /// For an `_async` method, the name of the method that finishes it.
    pub(crate) finish: Option<String>,
    /// The parameters a caller may leave out, each with what stands for
    /// leaving it out; which of them are written optional is the emitter's
    /// call, since only a run at the end can be (`emit::defaults`).
    pub(crate) omissible: BTreeMap<String, &'static str>,
    /// Written only as a method: a signal's `connect`, which as a function
    /// would be one more name per signal for the same call.
    pub(crate) method_only: bool,
    /// `(class, name)` where GIR declares this a constructor or a function of
    /// a class rather than a method: a static member of the class's value,
    /// `GtkStringObject.new("x")`, as GJS has it.
    pub(crate) statics: Option<(String, String)>,
}

#[derive(Debug)]
pub(crate) struct EnumDecl {
    pub(crate) name: String,
    /// The C type, `GtkOrientation`: the name a signature spells the enum
    /// by, unique across namespaces where `Orientation` is not.
    pub(crate) c_type: Option<String>,
    /// `(name, value, C identifier)`.
    pub(crate) members: Vec<(String, i64, String)>,
}

/// A type as the binding spells it, and as C spells it.
#[derive(Debug, Clone)]
pub(crate) struct Mapped {
    pub(crate) ts: String,
    pub(crate) c: Type,
    /// What a later step asks of the spelling, said where it is made rather
    /// than read back out of `ts`.
    pub(crate) shape: Shape,
}

/// What a [`Mapped`] is, where something after mapping needs to know.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Shape {
    Other,
    /// A handle to `class` (`GtkBox`, through `Const<…>` too), and whether it
    /// admits `null`.
    Handle { class: String, nullable: bool },
    /// A callback C calls once, after the call returns: a `OnceClosure`,
    /// which a Promise form stands in for.
    Once,
    /// An array lent for the call (`CStrings`, `Counted<CBytes>`), which the
    /// program holds as `program` -- `readonly string[]`, `Uint8Array` -- and
    /// which only a foreign function's own parameter can be declared as.
    Lent { program: String },
    /// A slot C writes a scalar through, typed `value` as the program reads
    /// it back: what a GJS-style method returns rather than takes. Only a
    /// scalar, since a handle read out of a slot has an ownership to settle
    /// that a number does not.
    Out { value: String },
}

/// Why something was not bound. Counted, so the most common one is the next
/// thing to build.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Reason {
    /// GIR names another entry as the one to bind for this symbol.
    Shadowed,
    NotIntrospectable,
    NoSymbol,
    Throws,
    OwnedString,
    WritableBuffer,
    OutParameter,
    StringOut,
    CallerAllocates,
    Array,
    Varargs,
    Gpointer,
    RecordByValue,
    PointerDepth(String),
    CallbackScope(&'static str),
    CallbackShape(&'static str),
    StringInCallback,
    Unknown(String),
    /// A C type the headers do not define as a tagged struct.
    NoTag(String),
    /// Dropped by the self-check: the header disagrees with the mapping.
    Header(String),
    /// Dropped by the self-check: in GIR, and in none of the headers GIR
    /// names (`g_access` is in `glib/gstdio.h`, which `glib.h` leaves out).
    Undeclared,
    /// `g_object_ref`, `g_object_unref` and their kin: the compiler counts a
    /// `GObject` itself, and a program that also did would count it twice.
    CountedByCompiler,
}

impl fmt::Display for Reason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Shadowed => write!(f, "GIR says another entry replaces it"),
            Self::NotIntrospectable => write!(f, "GIR marks it not introspectable"),
            Self::NoSymbol => write!(f, "no C symbol"),
            Self::Throws => write!(f, "reports errors through a `GError **`"),
            Self::OwnedString => write!(f, "a string parameter the callee takes ownership of"),
            Self::WritableBuffer => write!(f, "a `char *` buffer the callee may write into, which GIR calls a string"),
            Self::OutParameter => write!(f, "an out parameter of a type written through no slot here"),
            Self::StringOut => write!(f, "a string out parameter"),
            Self::CallerAllocates => write!(f, "an out parameter whose storage the caller allocates"),
            Self::Array => write!(f, "an array"),
            Self::Varargs => write!(f, "variadic"),
            Self::Gpointer => write!(f, "a `gpointer`"),
            Self::RecordByValue => write!(f, "a record passed by value"),
            Self::PointerDepth(c) => write!(f, "`{c}`, a pointer depth other than one"),
            Self::CallbackScope(scope) => write!(f, "a callback with `scope=\"{scope}\"`"),
            Self::CallbackShape(why) => write!(f, "a callback whose {why}"),
            Self::StringInCallback => write!(f, "a callback taking or returning a string"),
            Self::Unknown(name) => write!(f, "`{name}`, a type this binder does not know"),
            Self::NoTag(c) => write!(f, "`{c}`, which the headers do not define as a tagged struct"),
            Self::Header(error) => write!(f, "the header disagrees: {error}"),
            Self::Undeclared => write!(f, "declared by none of the headers GIR names"),
            Self::CountedByCompiler => write!(f, "a reference count the compiler keeps itself"),
        }
    }
}

impl Reason {
    /// The reason without its particulars, for counting.
    #[must_use]
    pub(crate) fn kind(&self) -> String {
        match self {
            Self::PointerDepth(_) => "a pointer depth other than one".to_owned(),
            Self::Unknown(_) => "a type this binder does not know".to_owned(),
            Self::NoTag(_) => "a type the headers do not define as a tagged struct".to_owned(),
            Self::Header(_) => "the header disagrees".to_owned(),
            other => other.to_string(),
        }
    }
}

/// The functions a program would count a `GObject` with, which the compiler
/// calls itself: bound, a program could release what it does not own.
const COUNTING: [&str; 6] =
    ["g_object_ref", "g_object_unref", "g_object_ref_sink", "g_object_take_ref", "g_object_force_floating", "g_clear_object"];

/// Whether `name` can be a TypeScript type name as it is.
fn is_type_name(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_') && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// A constructor or function GIR declares on a class, as a member of the
/// class's value: `(class, name)`.
fn static_of(callable: &Callable, owner: Option<&Class>) -> Option<(String, String)> {
    matches!(callable.kind, CallableKind::Constructor | CallableKind::Function)
        .then(|| owner.and_then(|class| class.c_type.clone()))
        .flatten()
        .map(|class| (class, callable.name.clone()))
}

/// The properties a constructor takes, where the class has construct-only
/// ones this constructor covers and every parameter is a property of the
/// class by name -- `g_list_store_new(item_type)` for `item-type`. `None`
/// otherwise.
fn constructs_from(class: &Class, callable: &Callable) -> Option<Vec<String>> {
    let name = |property: &str| identifier(&property.replace('-', "_"));
    let construct_only: Vec<String> = class.properties.iter().filter(|p| p.construct_only).map(|p| name(&p.name)).collect();
    if construct_only.is_empty() || callable.signature.parameters.is_empty() {
        return None;
    }
    let taken: Vec<String> = callable.signature.parameters.iter().map(|p| identifier(&p.name)).collect();
    let known = |taken: &String| class.properties.iter().any(|p| name(&p.name) == *taken);
    (taken.iter().all(known) && construct_only.iter().all(|c| taken.contains(c))).then_some(taken)
}

/// The module name a namespace binds as: `c:Gtk-4.0`.
#[must_use]
pub(crate) fn module_of(namespace: &Namespace) -> String {
    format!("c:{}-{}", namespace.name, namespace.version)
}

/// The GIR scalar names and the brand each is, with the compiler's scalar
/// behind it. The brand is the `c:types` name, and a test checks each against
/// `Scalar::from_brand` so the two cannot drift.
pub(crate) const SCALARS: &[(&str, &str, Scalar)] = &[
    // `gboolean` is `int`, not C's `bool`: the ABI is four bytes.
    ("gboolean", "c_int", Scalar::Int),
    ("gint", "c_int", Scalar::Int),
    ("int", "c_int", Scalar::Int),
    ("guint", "c_uint", Scalar::UInt),
    ("gchar", "c_char", Scalar::Char),
    ("guchar", "c_uint8", Scalar::UInt8),
    ("gint8", "c_int8", Scalar::Int8),
    ("guint8", "c_uint8", Scalar::UInt8),
    ("gshort", "c_int16", Scalar::Int16),
    ("gushort", "c_uint16", Scalar::UInt16),
    ("gint16", "c_int16", Scalar::Int16),
    ("guint16", "c_uint16", Scalar::UInt16),
    ("gint32", "c_int32", Scalar::Int32),
    ("guint32", "c_uint32", Scalar::UInt32),
    ("gunichar", "c_uint32", Scalar::UInt32),
    ("GQuark", "c_uint32", Scalar::UInt32),
    ("gint64", "c_int64", Scalar::Int64),
    ("guint64", "c_uint64", Scalar::UInt64),
    ("goffset", "c_int64", Scalar::Int64),
    ("glong", "c_long", Scalar::Long),
    ("gulong", "c_ulong", Scalar::ULong),
    ("gssize", "c_long", Scalar::Long),
    ("gsize", "c_size_t", Scalar::Size),
    // `GType` is a `gsize`.
    ("GType", "c_size_t", Scalar::Size),
    ("gfloat", "c_float", Scalar::Float),
    ("gdouble", "c_double", Scalar::Double),
    ("double", "c_double", Scalar::Double),
];

struct Mapper<'a> {
    repository: &'a Repository,
    namespace: &'a Namespace,
    /// Every class and record by its C type name, so a handle is spelled from
    /// what C says it points at.
    c_types: BTreeMap<&'a str, &'a Namespace>,
    /// What the headers say: struct tags and enum signedness (see `facts`).
    facts: &'a super::facts::Facts,
    binding: Binding,
}

/// Bind one namespace of `repository`.
#[must_use]
pub(crate) fn bind<'a>(
    repository: &'a Repository,
    namespace: &'a Namespace,
    facts: &'a super::facts::Facts,
) -> Binding {
    let mut c_types = BTreeMap::new();
    for ns in repository.namespaces.values() {
        let classes = ns.classes.iter().filter_map(|c| c.c_type.as_deref());
        let records = ns.records.iter().filter(|r| !r.class_struct).filter_map(|r| r.c_type.as_deref());
        for c_type in classes.chain(records) {
            c_types.entry(c_type).or_insert(ns);
        }
    }
    let mut mapper = Mapper {
        repository,
        namespace,
        c_types,
        facts,
        binding: Binding {
            module: module_of(namespace),
            headers: namespace.headers.clone(),
            ..Binding::default()
        },
    };
    mapper.types();
    mapper.enums();
    // Each with the class it is declared in, which is what a constructor
    // returns whatever its return type says.
    let mut callables: Vec<(&Callable, Option<&Class>)> = namespace.functions.iter().map(|f| (f, None)).collect();
    for class in &namespace.classes {
        callables.extend(class.callables.iter().map(|c| (c, Some(class))));
    }
    for record in namespace.records.iter().filter(|r| !r.class_struct) {
        callables.extend(record.callables.iter().map(|c| (c, None)));
    }
    for (callable, owner) in callables {
        let name = callable.c_identifier.clone().unwrap_or_else(|| callable.name.clone());
        match mapper.function(callable, owner) {
            Ok(function) => {
                // `new GtkButton({ … })` calls the class's `new`, when it
                // takes nothing; and a class with construct-only properties,
                // the constructor that takes them.
                if callable.kind == CallableKind::Constructor
                    && let Some(class) = owner
                    && let Some(c_type) = class.c_type.clone()
                {
                    if let Some(from) = constructs_from(class, callable) {
                        mapper.binding.constructors.insert(c_type, Constructor { function: function.name.clone(), get_type: None, from });
                    } else if callable.name == "new"
                        && callable.signature.parameters.is_empty()
                        && !class.properties.iter().any(|p| p.construct_only)
                    {
                        mapper.binding.constructors.insert(c_type, Constructor { function: function.name.clone(), get_type: None, from: Vec::new() });
                    }
                }
                mapper.binding.functions.push(function);
            }
            // The entry GIR names instead is bound under the same symbol;
            // this one is a duplicate, not something missing.
            Err(Reason::Shadowed) => {}
            Err(reason) => mapper.binding.refused.push((name, reason)),
        }
    }
    for class in &namespace.classes {
        for signal in &class.signals {
            let label = format!("{}::{}", class.c_type.as_deref().unwrap_or(&class.name), signal.name);
            match mapper.signal(class, signal) {
                Ok(connect) => {
                    // `connect_after`: the same call with `G_CONNECT_AFTER`.
                    let after = Function {
                        name: connect.name.replacen("_connect_", "_connect_after_", 1),
                        omissible: BTreeMap::from([("connect_flags".to_owned(), "1")]),
                        method: connect.method.as_ref().map(|(class, _)| (class.clone(), "connect_after".to_owned())),
                        ..connect.clone()
                    };
                    mapper.binding.functions.extend([connect, after]);
                }
                Err(reason) => mapper.binding.refused.push((label, reason)),
            }
        }
    }
    mapper.binding.functions.sort_by(|a, b| a.name.cmp(&b.name));
    // Two GIR entries can name one C symbol (a function and a method moved to
    // it); the first is the binding. Signal connects share a symbol and have
    // names of their own, which is what this compares.
    mapper.binding.functions.dedup_by(|a, b| a.name == b.name);
    mapper.binding
}

/// A method of the class its instance is: `this` on that class's methods.
/// Only a plain or `Const` handle is an instance a method can be called on;
/// an erased one is left a function.
fn method_of(callable: &Callable, parameters: &[(String, Mapped)]) -> Option<(String, String)> {
    if callable.kind != CallableKind::Method || callable.signature.instance.is_none() {
        return None;
    }
    let (_, instance) = parameters.first()?;
    match &instance.shape {
        Shape::Handle { class, nullable: false } => Some((class.clone(), identifier(&callable.name))),
        _ => None,
    }
}

/// What a qualified GIR name refers to.
enum Resolved<'a> {
    Class(&'a Namespace, &'a Class),
    Record,
    /// An enum or bitfield, where it is declared, and the C integer it is.
    Enum(&'a Namespace, &'a super::model::Enum, Scalar),
    Callback(&'a Callback),
}

impl<'a> Mapper<'a> {
    fn qualify(&self, name: &str) -> String {
        if name.contains('.') { name.to_owned() } else { format!("{}.{name}", self.namespace.name) }
    }

    fn resolve(&self, qualified: &str) -> Option<Resolved<'a>> {
        let repository: &'a Repository = self.repository;
        let (ns, local) = qualified.split_once('.')?;
        let namespace = repository.namespaces.get(ns)?;
        if let Some(class) = namespace.classes.iter().find(|c| c.name == local) {
            return Some(Resolved::Class(namespace, class));
        }
        if namespace.records.iter().any(|r| r.name == local) {
            return Some(Resolved::Record);
        }
        if let Some(e) = namespace.enums.iter().find(|e| e.name == local) {
            // Signed or not is the compiler's answer (see `facts`), and only
            // where it gave none is GIR's reading of the values used: C makes
            // an enum `unsigned int` unless a member is negative.
            let c_type = e.c_type.as_deref().unwrap_or_default();
            let signed = if self.facts.signed.contains(c_type) {
                true
            } else if self.facts.unsigned.contains(c_type) {
                false
            } else {
                e.members.iter().any(|m| m.value < 0)
            };
            return Some(Resolved::Enum(namespace, e, if signed { Scalar::Int } else { Scalar::UInt }));
        }
        namespace
            .callbacks
            .iter()
            .find(|c| c.name == local)
            .map(Resolved::Callback)
    }

    /// The name a type from `namespace` has here, importing it if it lives
    /// elsewhere.
    fn name_in(&mut self, namespace: &'a Namespace, c_type: &str) -> String {
        if namespace.name != self.namespace.name {
            self.binding
                .imports
                .entry(module_of(namespace))
                .or_default()
                .insert(c_type.to_owned());
        }
        c_type.to_owned()
    }

    /// A type from `namespace` named here, as `(module, name)`: the module is
    /// empty when it is this one, and imported otherwise.
    fn reference(&mut self, namespace: &'a Namespace, c_type: &str) -> (String, String) {
        let name = self.name_in(namespace, c_type);
        let module = if namespace.name == self.namespace.name { String::new() } else { module_of(namespace) };
        (module, name)
    }

    fn types(&mut self) {
        for class in &self.namespace.classes {
            let Some(c_type) = &class.c_type else { continue };
            let Some(tag) = self.facts.tags.get(c_type).cloned() else { continue };
            // An interface's base is the first class above it, and the
            // interfaces between are ones it implements.
            let (parent, implied) = if class.interface { self.interface_base(class) } else { (self.parent_of(class), Vec::new()) };
            // The parent's methods come with it, from its own module.
            if let Some((module, name)) = &parent
                && !module.is_empty()
            {
                self.binding.imports.entry(module.clone()).or_default().insert(format!("{name}Methods"));
                self.binding.imports.entry(module.clone()).or_default().insert(format!("{name}Props"));
            }
            self.binding.brands.insert("Class");
            if let Some(get_type) = &class.get_type
                && !class.interface
                && self.reaches_type_instance(class)
            {
                self.binding.functions.push(Function {
                    name: get_type.clone(),
                    symbol: get_type.clone(),
                    parameters: Vec::new(),
                    result: Mapped { shape: Shape::Other, ts: "c_size_t".to_owned(), c: Type::Scalar(Scalar::Size) },
                    c_parameters: Vec::new(),
                    deprecated: false,
                    free: None,
                    no_escape: Vec::new(),
                    returns: None,
                    method: None,
                    throws: None,
                    finish: None,
                    omissible: BTreeMap::new(),
                    method_only: false,
                    statics: None,
                });
                self.binding.brands.insert("c_size_t");
                self.binding.casts.push(Cast { class: c_type.clone(), get_type: get_type.clone() });
                // A class `new GtkLabel({ … })` can make by its `GType`; its
                // own `new`, where that takes nothing, replaces this below.
                if !class.is_abstract && self.counted(self.namespace, class) {
                    match self.construct(class, c_type) {
                        Ok(view) => {
                            let constructor = Constructor { function: view.name.clone(), get_type: Some(get_type.clone()), from: Vec::new() };
                            self.binding.constructors.insert(c_type.clone(), constructor);
                            self.binding.functions.push(view);
                        }
                        Err(reason) => self.binding.refused.push((format!("{c_type}_construct"), reason)),
                    }
                }
            }
            let counted = self.counted(self.namespace, class);
            self.binding.properties.insert(
                c_type.clone(),
                // `icon-name` as `icon_name`, as GJS spells it too.
                class
                    .properties
                    .iter()
                    .map(|p| Accessor { name: identifier(&p.name.replace('-', "_")), getter: p.getter.clone(), setter: p.setter.clone() })
                    .collect(),
            );
            if counted {
                self.binding.brands.insert("GObjectClass");
            }
            let implements = if counted {
                let mut implements = self.implements(class);
                implements.extend(implied);
                implements
            } else {
                Vec::new()
            };
            let interface = class.interface && counted && parent.is_some();
            if interface {
                self.binding.brands.insert("GObjectInterface");
            }
            self.binding.types.push(TypeDecl::Class { name: c_type.clone(), tag, parent, counted, interface, implements });
        }
        // Records are roots: nothing derives from one by GIR's account, and a
        // root `Class` is an opaque handle that can also anchor a chain, which
        // `GTypeInstance` has to.
        for record in self.namespace.records.iter().filter(|r| !r.class_struct) {
            let Some(c_type) = &record.c_type else { continue };
            let Some(tag) = self.facts.tags.get(c_type) else { continue };
            self.binding.brands.insert("Class");
            self.binding.types.push(TypeDecl::Class {
                name: c_type.clone(),
                tag: tag.clone(),
                parent: None,
                counted: false,
                interface: false,
                implements: Vec::new(),
            });
        }
    }

    /// An interface's base: the first class up its prerequisites, and the
    /// interfaces passed on the way, as `(name, tag)` -- `GDtlsConnection`'s
    /// prerequisite is the interface `GDatagramBased`, whose is `GObject`.
    fn interface_base(&mut self, class: &'a Class) -> (Option<Reference>, Vec<Implemented>) {
        let mut implied = Vec::new();
        let (mut namespace, mut at) = (self.namespace, class);
        for _ in 0..64 {
            let Some((next_namespace, next)) = self.parent_class(namespace, at) else { break };
            let Some(c_type) = next.c_type.clone() else { break };
            if !next.interface {
                return (Some(self.reference(next_namespace, &c_type)), implied);
            }
            if let Some(tag) = self.facts.tags.get(&c_type).cloned() {
                let (module, local) = self.reference(next_namespace, &c_type);
                if !module.is_empty() {
                    self.binding.imports.entry(module).or_default().extend([format!("{local}Methods"), format!("{local}Props")]);
                }
                implied.push((local, tag));
            }
            (namespace, at) = (next_namespace, next);
        }
        (None, implied)
    }

    /// The interfaces `class` declares, as the binding names them and as C
    /// tags them: `("GtkEditable", "_GtkEditable")`. Each one's methods are
    /// merged into the class's, from its own module. One the headers do not
    /// tag, or that is not a counted interface, is left out -- the class is
    /// then simply not seen to implement it.
    fn implements(&mut self, class: &'a Class) -> Vec<Implemented> {
        let mut found = Vec::new();
        for name in &class.implements {
            let qualified = if name.contains('.') { name.clone() } else { format!("{}.{name}", self.namespace.name) };
            let Some(Resolved::Class(namespace, interface)) = self.resolve(&qualified) else { continue };
            let Some(c_type) = interface.c_type.as_deref() else { continue };
            let Some(tag) = self.facts.tags.get(c_type).cloned() else { continue };
            if !interface.interface || !self.counted(namespace, interface) {
                continue;
            }
            let (module, local) = self.reference(namespace, c_type);
            if !module.is_empty() {
                self.binding.imports.entry(module).or_default().extend([format!("{local}Methods"), format!("{local}Props")]);
            }
            found.push((local, tag));
        }
        found
    }

    /// The class's parent: GIR's `parent`, or for a root its first field when
    /// that field is a record stored inline -- C makes a pointer to a struct
    /// and one to its first member interconvertible, which is how `GObject`
    /// sits on `GTypeInstance` although GIR gives it no parent.
    fn parent_of(&mut self, class: &'a Class) -> Option<(String, String)> {
        if class.parent.is_some() || class.interface {
            let (namespace, parent) = self.parent_class(self.namespace, class)?;
            let c_type = parent.c_type.clone()?;
            return Some(self.reference(namespace, &c_type));
        }
        let Some(TypeRef::Named { c_type: Some(c_type), .. }) = &class.first_field else { return None };
        if c_type.contains('*') {
            return None;
        }
        let namespace = self.c_types.get(c_type.as_str()).copied()?;
        namespace.records.iter().any(|r| r.c_type.as_deref() == Some(c_type)).then(|| self.reference(namespace, c_type))?
            .into()
    }

    /// Whether the class's chain reaches `GTypeInstance`, the one root whose
    /// instances `g_type_check_instance_is_a` can answer for.
    fn reaches_type_instance(&self, class: &Class) -> bool {
        let mut current = class;
        for _ in 0..64 {
            match &current.parent {
                Some(parent) => {
                    let qualified = if parent.contains('.') {
                        parent.clone()
                    } else {
                        // Parents are named relative to the class's own namespace.
                        let owner = self.repository.namespaces.values().find(|ns| {
                            ns.classes.iter().any(|c| std::ptr::eq(c, current))
                        });
                        format!("{}.{parent}", owner.map_or(self.namespace.name.as_str(), |ns| ns.name.as_str()))
                    };
                    let Some(Resolved::Class(_, next)) = self.resolve(&qualified) else { return false };
                    current = next;
                }
                None => {
                    return matches!(&current.first_field, Some(TypeRef::Named { c_type: Some(c), .. }) if c == "GTypeInstance");
                }
            }
        }
        false
    }

    fn enums(&mut self) {
        for e in &self.namespace.enums {
            self.binding.enums.push(EnumDecl {
                name: e.name.clone(),
                c_type: e.c_type.clone().filter(|c| is_type_name(c) && *c != e.name),
                members: e
                    .members
                    .iter()
                    .map(|m| (m.name.to_ascii_uppercase(), m.value, m.c_identifier.clone()))
                    .collect(),
            });
        }
    }

    fn function(&mut self, callable: &Callable, owner: Option<&'a Class>) -> Result<Function, Reason> {
        if callable.shadowed {
            return Err(Reason::Shadowed);
        }
        if !callable.introspectable {
            return Err(Reason::NotIntrospectable);
        }
        let symbol = callable.c_identifier.clone().ok_or(Reason::NoSymbol)?;
        if COUNTING.contains(&symbol.as_str()) {
            return Err(Reason::CountedByCompiler);
        }
        let signature = &callable.signature;
        let mut parameters = Vec::new();
        let mut c_parameters = Vec::new();
        if let Some(instance) = &signature.instance {
            let mapped = self.value(instance)?;
            c_parameters.push(mapped.c.clone());
            parameters.push((identifier(&instance.name), mapped));
        }
        // The parameters a callback's context and destroy function occupy,
        // which the declaration does not spell and the caller does not pass.
        let mut hidden = BTreeSet::new();
        let mut no_escape = Vec::new();
        let mut omissible = BTreeMap::new();
        // The parameters that hold an array's length, which the compiler fills
        // from the array: `index -> the array's index`.
        let lengths: BTreeMap<usize, usize> = signature
            .parameters
            .iter()
            .enumerate()
            .filter_map(|(at, param)| match &param.ty {
                TypeRef::Array(array) if param.direction == Direction::In => Some((array.length?, at)),
                _ => None,
            })
            .collect();
        for (at, param) in signature.parameters.iter().enumerate() {
            if hidden.contains(&at) {
                continue;
            }
            // A length: its C slot is here, and the caller does not pass it.
            if lengths.contains_key(&at) {
                c_parameters.push(self.value(param)?.c);
                continue;
            }
            if let TypeRef::Array(array) = &param.ty
                && param.direction == Direction::In
            {
                let mapped = self.array_parameter(param, array, at, &signature.parameters)?;
                c_parameters.push(mapped.c.clone());
                no_escape.push(identifier(&param.name));
                parameters.push((identifier(&param.name), mapped));
                continue;
            }
            if param.direction != Direction::In {
                let mapped = self.out(param)?;
                c_parameters.push(mapped.c.clone());
                no_escape.push(identifier(&param.name));
                omissible.extend(self.omissible(param).map(|value| (identifier(&param.name), value)));
                parameters.push((identifier(&param.name), mapped));
                continue;
            }
            if let Some((mapped, slots)) = self.callback_parameter(param, at, &signature.parameters)? {
                hidden.extend(at + 1..at + 1 + (slots.len() - 1));
                c_parameters.extend(slots);
                parameters.push((identifier(&param.name), mapped));
                continue;
            }
            let (mapped, omitted) = self.plain(param)?;
            c_parameters.push(mapped.c.clone());
            omissible.extend(omitted.map(|value| (identifier(&param.name), value)));
            parameters.push((identifier(&param.name), mapped));
        }
        let (result, free) = self.function_result(callable, owner)?;
        // `GError **error`, which GIR leaves out of the parameter list: the
        // same out parameter as any other, a slot for a nullable handle.
        if signature.throws {
            if parameters.iter().any(|(name, _)| name == "error") {
                return Err(Reason::Throws);
            }
            let error = self.error_parameter().ok_or(Reason::Throws)?;
            c_parameters.push(error.c.clone());
            no_escape.push("error".to_owned());
            parameters.push(("error".to_owned(), error));
        }
        let throws = signature.throws.then(|| "error".to_owned());
        let returns = self.constructed(callable);
        let method = method_of(callable, &parameters);
        let statics = if method.is_none() { static_of(callable, owner) } else { None };
        Ok(Function {
            name: symbol.clone(),
            symbol,
            parameters,
            result,
            c_parameters,
            deprecated: callable.deprecated,
            free,
            no_escape,
            returns,
            method,
            throws,
            finish: callable.finish.clone(),
            omissible,
            method_only: false,
            statics,
        })
    }

    /// What stands for a parameter the caller leaves out, where `GLib` itself
    /// names a "nothing": `0`, the empty set of any bitfield's flags; `0`,
    /// `G_PRIORITY_DEFAULT`, for an `io_priority`; and `null` for a
    /// `GCancellable *`, which every one of them accepts. No other parameter
    /// is guessed at -- `window.set_child()` meaning "no child" would be a
    /// default nobody chose.
    fn omissible(&self, param: &Param) -> Option<&'static str> {
        // An out parameter the caller may pass no slot for -- `etag_out` on
        // every GIO `_finish`, the second size of `get_size` -- is left out,
        // as GJS leaves it out.
        if param.direction == Direction::Out && param.optional {
            return Some("null");
        }
        if param.direction != Direction::In {
            return None;
        }
        let TypeRef::Named { name, c_type } = &param.ty else { return None };
        let pointer = c_type.as_deref().is_some_and(|c| c.contains('*'));
        let qualified = self.qualify(name);
        if qualified == "Gio.Cancellable" && pointer && param.nullable {
            return Some("null");
        }
        if name == "gint" && param.name == "io_priority" {
            return Some("0");
        }
        let (namespace, local) = qualified.split_once('.')?;
        let flags = self.repository.namespaces.get(namespace)?.enums.iter().any(|e| e.name == local && e.flags);
        (flags && !pointer).then_some("0")
    }

    /// The result, and for a string the caller owns, what frees it.
    fn result(&mut self, result: &Param) -> Result<(Mapped, Option<String>), Reason> {
        match &result.ty {
            TypeRef::Named { name, .. } if name == "none" => {
                Ok((Mapped { shape: Shape::Other, ts: "void".to_owned(), c: Type::Void }, None))
            }
            // A returned string is copied at the call. Transfer-full is
            // GLib's `g_malloc`, so `g_free` releases it, and it is spelled
            // `char *` -- which the self-check confirms against the header.
            TypeRef::Named { name, .. } if name == "utf8" || name == "filename" => {
                let owned = match result.transfer {
                    Transfer::None => false,
                    Transfer::Full => true,
                    Transfer::Container => return Err(Reason::OwnedString),
                };
                let char = Pointee::Scalar(Scalar::Char);
                let c = if owned { Type::Pointer(char) } else { Type::Pointer(Pointee::Const(Box::new(char))) };
                let ts = if result.nullable { "string | null" } else { "string" };
                Ok((Mapped { shape: Shape::Other, ts: ts.to_owned(), c }, owned.then(|| "g_free".to_owned())))
            }
            TypeRef::Missing => Ok((Mapped { shape: Shape::Other, ts: "void".to_owned(), c: Type::Void }, None)),
            TypeRef::Array(array) => Self::returned_strings(result, array),
            _ => self.typed(result).map(|mapped| (mapped, None)),
        }
    }

    /// An out or inout parameter: a pointer to the slot the callee writes,
    /// which the caller makes with `local<T>()` and reads after the call --
    /// `Ptr<c_int>` for `gint *`, `Ptr<GtkWidget | null>` for `GtkWidget **`.
    ///
    /// A handle's slot is nullable whatever GIR says of the value: it holds
    /// what the caller put there until the callee writes it, and `local`
    /// zeroes it. `optional` is whether the caller may pass no slot at all.
    fn out(&mut self, param: &Param) -> Result<Mapped, Reason> {
        if param.caller_allocates {
            return Err(Reason::CallerAllocates);
        }
        let TypeRef::Named { name, c_type } = &param.ty else {
            return Err(if matches!(param.ty, TypeRef::Array(_)) { Reason::Array } else { Reason::OutParameter });
        };
        if name == "utf8" || name == "filename" {
            // Only an optional one, which the caller leaves out (`omissible`):
            // C's `char **` exactly, for a caller that does pass a slot.
            if !param.optional {
                return Err(Reason::StringOut);
            }
            let constant = c_type.as_deref().is_some_and(|c| c.trim_start().starts_with("const"));
            let char = Pointee::Scalar(Scalar::Char);
            let (ts, char) = if constant {
                ("Ptr<ConstPtr<c_char>> | null", Pointee::Const(Box::new(char)))
            } else {
                ("Ptr<Ptr<c_char>> | null", char)
            };
            self.binding.brands.extend(["Ptr", "ConstPtr", "c_char"]);
            return Ok(Mapped { shape: Shape::Other, ts: ts.to_owned(), c: Type::Pointer(Pointee::Pointer(Box::new(char))) });
        }
        if name == "gpointer" || name == "gconstpointer" {
            return Err(Reason::Gpointer);
        }
        // The value's own C type, one `*` fewer than the parameter's.
        let Some(value_type) = c_type.as_deref().and_then(|c| c.strip_suffix('*')) else {
            return Err(Reason::OutParameter);
        };
        let value = Param {
            ty: TypeRef::Named { name: name.clone(), c_type: Some(value_type.trim_end().to_owned()) },
            direction: Direction::In,
            nullable: false,
            ..param.clone()
        };
        let mapped = self.typed(&value)?;
        let (slot, pointee, shape) = match mapped.c {
            Type::Scalar(scalar) => {
                (mapped.ts.clone(), Pointee::Scalar(scalar), Shape::Out { value: mapped.ts })
            }
            Type::Pointer(pointee) => (format!("{} | null", mapped.ts), Pointee::Pointer(Box::new(pointee)), Shape::Other),
            _ => return Err(Reason::OutParameter),
        };
        self.binding.brands.insert("Ptr");
        let ts = format!("Ptr<{slot}>");
        let ts = if param.optional { format!("{ts} | null") } else { ts };
        Ok(Mapped { shape, ts, c: Type::Pointer(pointee) })
    }

    /// An array the callee reads (or fills) during the call: strings as
    /// `CStrings<Q>`, bytes as a borrowed `Uint8Array`, `CBytes<Q>` -- `Q`
    /// read from GIR's `c:type` -- and `Counted` when C takes its length in a
    /// parameter beside it: the one GIR names, which must be right before or
    /// right after it (`at`, among `parameters`).
    ///
    /// Only transfer-none: the callee borrows the array, which is what lets
    /// the compiler lend one for the call. Every other array stays refused as
    /// one.
    fn array_parameter(&mut self, param: &Param, array: &ArrayRef, at: usize, parameters: &[Param]) -> Result<Mapped, Reason> {
        let length = match array.length {
            Some(index) => {
                let side = if index == at + 1 {
                    "after"
                } else if index + 1 == at {
                    "before"
                } else {
                    return Err(Reason::Array);
                };
                Some((self.value(parameters.get(index).ok_or(Reason::Array)?)?, side))
            }
            None => None,
        };
        let element = array.element.as_deref().ok_or(Reason::Array)?;
        if param.transfer != Transfer::None {
            return Err(Reason::Array);
        }
        let spelling: String = array.c_type.as_deref().ok_or(Reason::Array)?.split_whitespace().collect();
        let char = Pointee::Scalar(Scalar::Char);
        let (ts, c, program) = match element {
            "utf8" | "filename" if array.zero_terminated || length.is_some() => {
                let (qualifier, c) = match spelling.replace("gchar", "char").as_str() {
                    "char**" => ("char", Type::Pointer(Pointee::Pointer(Box::new(char)))),
                    "constchar**" => ("const", Type::Pointer(Pointee::Pointer(Box::new(Pointee::Const(Box::new(char)))))),
                    "constchar*const*" => (
                        "const const",
                        Type::Pointer(Pointee::Const(Box::new(Pointee::Pointer(Box::new(Pointee::Const(Box::new(char))))))),
                    ),
                    _ => return Err(Reason::Array),
                };
                self.binding.brands.insert("CStrings");
                (format!("CStrings<\"{qualifier}\">"), c, "readonly string[]")
            }
            // Bytes have no terminator to find their end by, so only with a
            // length. `guchar` is `uint8_t` on every target GLib runs on; the
            // self-check compiles the prototype against the header either way.
            "guint8" if length.is_some() => {
                let (qualifier, pointee) = match spelling.as_str() {
                    "constguint8*" | "constguchar*" => ("const uint8_t", Pointee::Const(Box::new(Pointee::Scalar(Scalar::UInt8)))),
                    "guint8*" | "guchar*" => ("uint8_t", Pointee::Scalar(Scalar::UInt8)),
                    "constgchar*" | "constchar*" => ("const char", Pointee::Const(Box::new(char))),
                    "gconstpointer" | "constvoid*" => ("const void", Pointee::Const(Box::new(Pointee::Void))),
                    "gpointer" | "void*" => ("void", Pointee::Void),
                    _ => return Err(Reason::Array),
                };
                self.binding.brands.insert("CBytes");
                (format!("CBytes<\"{qualifier}\">"), Type::Pointer(pointee), "Uint8Array")
            }
            _ => return Err(Reason::Array),
        };
        let mut ts = ts;
        if let Some((count, side)) = length {
            self.binding.brands.insert("Counted");
            ts = format!("Counted<{ts}, {}, \"{side}\">", count.ts);
        }
        // `null` is NULL, with a count of 0 beside it where there is one.
        let mut program = program.to_owned();
        if param.nullable {
            ts.push_str(" | null");
            program.push_str(" | null");
        }
        Ok(Mapped { shape: Shape::Lent { program }, ts, c })
    }

    /// `error: Ptr<GError | null> | null` -- C's `GError **error`, which the
    /// caller may pass as `NULL` to ignore the error. `None` where `GError`
    /// is not a type these headers tag.
    fn error_parameter(&mut self) -> Option<Mapped> {
        let namespace = self.c_types.get("GError").copied()?;
        let tag = self.facts.tags.get("GError").cloned()?;
        let local = self.name_in(namespace, "GError");
        self.binding.brands.insert("Ptr");
        let handle = Pointee::Opaque(Handle::from(tag));
        Some(Mapped {
            shape: Shape::Other,
            ts: format!("Ptr<{local} | null> | null"),
            c: Type::Pointer(Pointee::Pointer(Box::new(handle))),
        })
    }

    /// A returned NULL-terminated array of strings, as a `string[]` the
    /// compiler copies: `GLib`'s `gchar **` the caller frees with `g_strfreev`,
    /// or a `const gchar * const *` it borrows. Those two spellings are the
    /// compiler's for the two ownerships, and they are what GIR says for
    /// nearly every such result; any other is refused rather than declared
    /// in a spelling the header would contradict.
    fn returned_strings(result: &Param, array: &ArrayRef) -> Result<(Mapped, Option<String>), Reason> {
        let element = array.element.as_deref().ok_or(Reason::Array)?;
        if !(element == "utf8" || element == "filename") || !array.zero_terminated || array.length.is_some() {
            return Err(Reason::Array);
        }
        let spelling: String =
            array.c_type.as_deref().ok_or(Reason::Array)?.replace("gchar", "char").replace("GStrv", "char**").split_whitespace().collect();
        let char = Pointee::Scalar(Scalar::Char);
        let (c, free) = match (result.transfer, spelling.as_str()) {
            (Transfer::Full, "char**") => (Type::Pointer(Pointee::Pointer(Box::new(char))), Some("g_strfreev".to_owned())),
            (Transfer::None, "constchar*const*") => (
                Type::Pointer(Pointee::Const(Box::new(Pointee::Pointer(Box::new(Pointee::Const(Box::new(char))))))),
                None,
            ),
            _ => return Err(Reason::Array),
        };
        let ts = if result.nullable { "string[] | null" } else { "string[]" };
        Ok((Mapped { shape: Shape::Other, ts: ts.to_owned(), c }, free))
    }

    /// An in parameter or an instance.
    fn value(&mut self, param: &Param) -> Result<Mapped, Reason> {
        if param.direction != Direction::In {
            return Err(Reason::OutParameter);
        }
        if let TypeRef::Named { name, .. } = &param.ty
            && (name == "utf8" || name == "filename")
        {
            if param.transfer != Transfer::None {
                return Err(Reason::OwnedString);
            }
            // `char *` without `const` is a buffer the callee may write into
            // (`g_strlcat`'s destination), which GIR still calls `utf8`. A
            // string lent for the call is read-only, and not that.
            let c_type = match &param.ty {
                TypeRef::Named { c_type, .. } => c_type.as_deref().unwrap_or_default(),
                _ => "",
            };
            if !c_type.starts_with("const ") {
                return Err(Reason::WritableBuffer);
            }
            return Ok(Mapped {
                shape: Shape::Other,
                ts: if param.nullable { "string | null" } else { "string" }.to_owned(),
                c: Type::Pointer(Pointee::Const(Box::new(Pointee::Scalar(Scalar::Char)))),
            });
        }
        self.typed(param)
    }

    /// A scalar, enum, handle or record pointer -- the shapes that need no
    /// conversion at the call.
    fn typed(&mut self, param: &Param) -> Result<Mapped, Reason> {
        let (name, c_type) = match &param.ty {
            TypeRef::Named { name, c_type } => (name.as_str(), c_type.as_deref().unwrap_or("")),
            TypeRef::Array(_) => return Err(Reason::Array),
            TypeRef::Varargs => return Err(Reason::Varargs),
            TypeRef::Missing => return Err(Reason::Unknown("(no type)".to_owned())),
        };
        // `gpointer` is C's `void *`: any native pointer, which a binding
        // spells `object` and the compiler checks is not a managed one.
        // `gconstpointer` would need a const `void *` TypeScript has no
        // spelling for yet, and a returned `gpointer` says nothing about what
        // it points at; both stay refused.
        if name == "gpointer" && param.direction == Direction::In && c_type != "gconstpointer" && !c_type.starts_with("const") {
            return Ok(Mapped {
                shape: Shape::Other,
                ts: if param.nullable { "object | null" } else { "object" }.to_owned(),
                c: Type::Pointer(Pointee::Void),
            });
        }
        if name == "gpointer" || name == "gconstpointer" {
            return Err(Reason::Gpointer);
        }
        // C99's `bool`, which GIR's scanner reports as `gboolean` -- an `int`
        // -- although the ABI is one byte. `c:type` says which it is.
        if c_type == "bool" || c_type == "_Bool" {
            return Ok(Mapped { shape: Shape::Other, ts: "boolean".to_owned(), c: Type::Bool });
        }
        let depth = c_type.matches('*').count();
        // A scalar only where C passes one: `const guint8 *` is named `guint8`
        // by GIR too, and is a pointer to storage.
        if let Some((_, brand, scalar)) = SCALARS.iter().find(|(gir, ..)| *gir == name) {
            if depth != 0 {
                return Err(Reason::PointerDepth(c_type.to_owned()));
            }
            // A plain `number`, as GJS takes one -- a 64-bit size, length,
            // offset or handler id rounds past 2^53 there too. `GType` is an
            // identifier, not a quantity, and keeps every bit as a `bigint`.
            if name == "GType" {
                self.binding.brands.insert(brand);
                return Ok(Mapped { shape: Shape::Other, ts: (*brand).to_owned(), c: Type::Scalar(*scalar) });
            }
            self.binding.brands.insert("CNumber");
            let c = brand.strip_prefix("c_").unwrap_or(brand);
            return Ok(Mapped { shape: Shape::Other, ts: format!("CNumber<\"{c}\">"), c: Type::Scalar(*scalar) });
        }
        let qualified = self.qualify(name);
        // A handle is what C says it points at. GIR's name can be more
        // specific -- `gtk_activate_action_get` returns a `GtkShortcutAction *`
        // that GIR calls an ActivateAction -- and the ABI is the C one.
        let (constant, base) = match c_type.strip_prefix("const ") {
            Some(rest) => (true, rest),
            None => (false, c_type),
        };
        let base = base.trim_end_matches(['*', ' ']);
        // A handle C takes as `gpointer` -- `g_object_unref`'s parameter is
        // `GObject.Object` to GIR and `gpointer` to C. `Erased<GObject>`: any
        // object for TypeScript, `void *` for the header. And one C returns
        // as `gpointer` -- `gtk_list_item_get_item`, `g_list_model_get_item`
        // -- which the program holds as the handle GIR names, counted, and
        // owned where GIR says so. (A result is the one `Out` reaching here:
        // `out` rewrites an out parameter's slot to `In`.)
        if c_type == "gpointer"
            && let Some(Resolved::Class(namespace, class)) = self.resolve(&qualified)
            && let Some(class_type) = class.c_type.clone()
        {
            let local = self.name_in(namespace, &class_type);
            self.binding.brands.insert("Erased");
            let ts = format!("Erased<{local}>");
            let ts = if param.nullable { format!("{ts} | null") } else { ts };
            let shape = if param.direction == Direction::In {
                Shape::Other
            } else {
                Shape::Handle { class: local, nullable: param.nullable }
            };
            return Ok(Mapped { shape, ts, c: Type::Pointer(Pointee::Void) });
        }
        if depth == 1
            && let Some(namespace) = self.c_types.get(base).copied()
        {
            let tag = self.facts.tags.get(base).cloned().ok_or_else(|| Reason::NoTag(base.to_owned()))?;
            let local = self.name_in(namespace, base);
            return Ok(self.handle(local, &tag, constant, param.nullable));
        }
        match self.resolve(&qualified) {
            Some(Resolved::Enum(namespace, e, scalar)) if depth == 0 => {
                let brand = if scalar == Scalar::Int { "c_int" } else { "c_uint" };
                self.binding.brands.insert(brand);
                // `CEnum<GtkOrientation, c_uint>`, so the enum's members pass
                // without a cast; by its C name, which `enums` declares beside
                // the enum as an alias, since two namespaces can share a short one.
                let ts = match e.c_type.as_deref().filter(|c| is_type_name(c) && *c != e.name) {
                    Some(c_type) => {
                        self.binding.brands.insert("CEnum");
                        if namespace.name != self.namespace.name {
                            self.binding.imports.entry(module_of(namespace)).or_default().insert(c_type.to_owned());
                        }
                        format!("CEnum<{c_type}, {brand}>")
                    }
                    None => brand.to_owned(),
                };
                Ok(Mapped { shape: Shape::Other, ts, c: Type::Scalar(scalar) })
            }
            Some(Resolved::Record) if depth == 0 => Err(Reason::RecordByValue),
            Some(Resolved::Callback(_)) => {
                Err(Reason::CallbackShape("closure data is not annotated where it is passed"))
            }
            Some(_) => Err(Reason::PointerDepth(c_type.to_owned())),
            None => Err(Reason::Unknown(qualified)),
        }
    }

    /// A typed view of `g_signal_connect_data` for one signal of one class:
    ///
    /// ```text
    /// gtk_button_connect_clicked(instance: Erased<GtkButton>, detailed_signal: "clicked",
    ///     handler: ErasedClosure<(self: GtkButton) => void>, connect_flags: c_uint): c_ulong
    /// ```
    ///
    /// Signals have no C prototype -- `GObject` registers them at run time -- so
    /// this is the one place a signal's signature can be typed. The C side is
    /// `g_signal_connect_data`'s exactly, called as `nts_gobject_connect`
    /// (`nts_gobject.h`), which is `g_signal_connect_data` keeping the
    /// connection's `GClosure` -- what lets the collector see that the
    /// instance holds the handler's closure, and find a handler that captures
    /// its own instance. The self-check compiles every view against that
    /// header: the instance is `void *`, the handler a `GCallback`, its
    /// destroy function a `GClosureNotify`. The handler's
    /// own signature is GIR's: the instance first, the signal's parameters,
    /// and the `user_data` last, where the bridge takes the closure from.
    fn signal(&mut self, class: &'a Class, signal: &super::model::Signal) -> Result<Function, Reason> {
        let c_type = class.c_type.clone().ok_or_else(|| Reason::Unknown(class.name.clone()))?;
        if !self.binding.headers.iter().any(|header| header == nts_codegen_c::GOBJECT_HEADER_NAME) {
            self.binding.headers.push(nts_codegen_c::GOBJECT_HEADER_NAME.to_owned());
        }
        // `self: GtkButton` names the class's handle, which exists only for a
        // tagged struct.
        if !self.facts.tags.contains_key(&c_type) {
            return Err(Reason::NoTag(c_type));
        }
        let prefix = class.symbol_prefix.as_deref().ok_or(Reason::NoSymbol)?;
        let local = c_type.clone();
        self.binding.brands.extend(["Erased", "ErasedClosure", "c_uint", "CNumber"]);
        let mut ts_parameters = vec![format!("self: {local}")];
        for param in &signal.signature.parameters {
            if matches!(&param.ty, TypeRef::Named { name, .. } if name == "utf8" || name == "filename") {
                return Err(Reason::StringInCallback);
            }
            let param = self.with_c_type(param);
            let mapped = self.typed(&param)?;
            let mapped = self.truth(&param, mapped);
            ts_parameters.push(format!("{}: {}", identifier(&param.name), mapped.ts));
        }
        let result = match &signal.signature.result.ty {
            TypeRef::Named { name, .. } if name == "none" => Mapped { shape: Shape::Other, ts: "void".to_owned(), c: Type::Void },
            TypeRef::Named { name, .. } if name == "utf8" || name == "filename" => return Err(Reason::StringInCallback),
            _ => {
                let result = self.with_c_type(&signal.signature.result);
                let mapped = self.typed(&result)?;
                self.truth(&result, mapped)
            }
        };
        let context = Type::Pointer(Pointee::Void);
        // The handler's C signature is the compiler's to derive from the
        // TypeScript one; mapping the parameters above is what refuses a
        // signal whose parameters have no C type here.
        let erased = Type::FnPointer(std::sync::Arc::new(FnPointer::spell(Vec::new(), Type::Void)));
        // `GClosureNotify`: `void (*)(gpointer, GClosure *)`, which the header
        // declares exactly and the self-check compares.
        let closure_tag = self.facts.tags.get("GClosure").cloned().ok_or_else(|| Reason::NoTag("GClosure".to_owned()))?;
        let closure = Type::Pointer(Pointee::Opaque(Handle::from(closure_tag)));
        let notify = Type::FnPointer(std::sync::Arc::new(FnPointer::spell(vec![context.clone(), closure], Type::Void)));
        let objects = self
            .repository
            .namespaces
            .get("GObject")
            .ok_or_else(|| Reason::Unknown("GObject".to_owned()))?;
        let (_, gclosure) = self.reference(objects, "GClosure");
        self.binding.brands.insert("Ptr");
        let string = Type::Pointer(Pointee::Const(Box::new(Pointee::Scalar(Scalar::Char))));
        let name = format!(
            "{}_{prefix}_connect_{}",
            self.namespace.symbol_prefix,
            signal.name.replace('-', "_")
        );
        Ok(Function {
            name,
            symbol: CONNECT.to_owned(),
            parameters: vec![
                ("instance".to_owned(), Mapped { shape: Shape::Other, ts: format!("Erased<{local}>"), c: context.clone() }),
                ("detailed_signal".to_owned(), Mapped { shape: Shape::Other, ts: format!("\"{}\"", signal.name), c: string.clone() }),
                (
                    "handler".to_owned(),
                    Mapped {
                        shape: Shape::Other,
                        ts: format!(
                            "ErasedClosure<({}) => {}, (data: Ptr<unknown>, closure: {gclosure}) => void>",
                            ts_parameters.join(", "),
                            result.ts
                        ),
                        c: erased.clone(),
                    },
                ),
                ("connect_flags".to_owned(), Mapped { shape: Shape::Other, ts: "c_uint".to_owned(), c: Type::Scalar(Scalar::UInt) }),
            ],
            // A handler id, a number as GJS returns it, which
            // `g_signal_handler_disconnect` takes back.
            result: Mapped { shape: Shape::Other, ts: "CNumber<\"ulong\">".to_owned(), c: Type::Scalar(Scalar::ULong) },
            c_parameters: vec![context.clone(), string, erased, context, notify, Type::Scalar(Scalar::UInt)],
            deprecated: false,
            free: None,
            no_escape: Vec::new(),
            returns: None,
            // `button.connect("clicked", handler)`, GJS's spelling: a method
            // of the class, the flags left out -- `0`, and `1`,
            // `G_CONNECT_AFTER`, for `connect_after`.
            method: Some((local, "connect".to_owned())),
            throws: None,
            finish: None,
            omissible: BTreeMap::from([("connect_flags".to_owned(), "0")]),
            method_only: true,
            statics: None,
        })
    }

    /// A signal parameter with its C type filled in where GIR left it out:
    /// a class or record there is passed as a pointer, which is how `GObject`'s
    /// marshallers pass one.
    fn with_c_type(&self, param: &Param) -> Param {
        let mut param = param.clone();
        if let TypeRef::Named { name, c_type } = &mut param.ty
            && c_type.is_none()
        {
            let qualified = self.qualify(name);
            let (ns, local) = qualified.split_once('.').unwrap_or_default();
            if let Some(namespace) = self.repository.namespaces.get(ns) {
                let pointer = namespace
                    .classes
                    .iter()
                    .find(|c| c.name == local)
                    .and_then(|c| c.c_type.clone())
                    .or_else(|| namespace.records.iter().find(|r| r.name == local).and_then(|r| r.c_type.clone()));
                *c_type = pointer.map(|c| format!("{c}*")).or_else(|| {
                    namespace.enums.iter().find(|e| e.name == local).and_then(|e| e.c_type.clone())
                });
            }
            if c_type.is_none() {
                *c_type = Some(name.clone());
            }
        }
        param
    }

    /// A pointer to a class or record, `const` where C says so.
    /// The result, and what frees it. A constructor returns its class: GIR
    /// says so by where it declares one, and its return type says what C
    /// does -- `Gtk.Widget` for `gtk_box_new`.
    fn function_result(&mut self, callable: &Callable, owner: Option<&'a Class>) -> Result<(Mapped, Option<String>), Reason> {
        let (result, free) = self.result(&callable.signature.result)?;
        let result = match owner {
            Some(class) if callable.kind == CallableKind::Constructor => self.declared(result, class),
            _ => result,
        };
        let result = self.truth(&callable.signature.result, result);
        Ok((self.owned(result, callable.signature.result.transfer == Transfer::Full), free))
    }

    /// A `gboolean` as the boolean it means: `CBool<c_int>`, where C still
    /// sees the `int` it is -- a function's parameters and result, and a
    /// callback's or a signal handler's too, whose bridge reads C's `int` as
    /// C does (2 is `true`) and answers 0 or 1: `() => true` keeps a timeout.
    fn truth(&mut self, param: &Param, mapped: Mapped) -> Mapped {
        let gboolean = matches!(&param.ty, TypeRef::Named { name, .. } if name == "gboolean");
        if !gboolean || mapped.c != Type::Scalar(Scalar::Int) {
            return mapped;
        }
        self.binding.brands.extend(["CBool", "c_int"]);
        Mapped { ts: "CBool<c_int>".to_owned(), ..mapped }
    }

    /// A parameter passed as it is -- a scalar, an enum, a handle -- with what
    /// it hands over (`Consumed`) and what stands for leaving it out.
    fn plain(&mut self, param: &Param) -> Result<(Mapped, Option<&'static str>), Reason> {
        let value = self.value(param)?;
        let value = self.truth(param, value);
        Ok((self.handed_over(value, param.transfer == Transfer::Full), self.omissible(param)))
    }

    /// A counted handle the caller receives a reference with -- GIR's
    /// `transfer-ownership="full"` on a result: `Owned<GFile>`.
    fn owned(&mut self, mapped: Mapped, full: bool) -> Mapped {
        self.branded(mapped, full, "Owned")
    }

    /// A counted handle the callee keeps -- `transfer-ownership="full"` on a
    /// parameter: `Consumed<GListModel>`.
    fn handed_over(&mut self, mapped: Mapped, full: bool) -> Mapped {
        self.branded(mapped, full, "Consumed")
    }

    fn branded(&mut self, mapped: Mapped, full: bool, brand: &'static str) -> Mapped {
        let Shape::Handle { class, nullable } = &mapped.shape else { return mapped };
        if !full || matches!(mapped.c, Type::Pointer(Pointee::Const(_))) || !self.counted_c_type(class) {
            return mapped;
        }
        let inner = mapped.ts.strip_suffix(" | null").unwrap_or(&mapped.ts);
        self.binding.brands.insert(brand);
        let ts = format!("{brand}<{inner}>{}", if *nullable { " | null" } else { "" });
        Mapped { ts, ..mapped }
    }

    /// The class above `class`: GIR's `parent`, or its `prerequisite` for an
    /// interface -- and for an interface GIR gives none, what the type system
    /// says every instance of it also is (`GObject` for `GFile`, probed).
    /// The one derivation of a class's parent, which the chain, the counting
    /// and a constructor's class all walk.
    fn parent_class(&self, namespace: &'a Namespace, class: &'a Class) -> Option<(&'a Namespace, &'a Class)> {
        if let Some(parent) = &class.parent {
            let qualified = if parent.contains('.') { parent.clone() } else { format!("{}.{parent}", namespace.name) };
            return match self.resolve(&qualified) {
                Some(Resolved::Class(namespace, parent)) => Some((namespace, parent)),
                _ => None,
            };
        }
        if !class.interface {
            return None;
        }
        let prerequisite = class.c_type.as_deref().and_then(|c| self.facts.prerequisites.get(c))?;
        let namespace = self.c_types.get(prerequisite.as_str()).copied()?;
        let parent = namespace.classes.iter().find(|c| c.c_type.as_deref() == Some(prerequisite.as_str()))?;
        Some((namespace, parent))
    }

    /// Whether the chain takes `class` to `GObject.Object`: a `GObject`,
    /// which the compiler counts.
    fn counted(&self, namespace: &'a Namespace, class: &'a Class) -> bool {
        let (mut namespace, mut class) = (namespace, class);
        // Bounded, so a cycle in malformed GIR ends.
        for _ in 0..64 {
            if namespace.name == "GObject" && class.name == "Object" {
                return true;
            }
            let Some(parent) = self.parent_class(namespace, class) else { return false };
            (namespace, class) = parent;
        }
        false
    }

    /// [`Self::counted`] for a handle named by its C type, from any namespace.
    fn counted_c_type(&self, c_type: &str) -> bool {
        let Some(namespace) = self.c_types.get(c_type).copied() else { return false };
        namespace.classes.iter().find(|class| class.c_type.as_deref() == Some(c_type)).is_some_and(|class| self.counted(namespace, class))
    }

    /// What a constructor returns, as GIR names it (`Gtk.Button`), where C's
    /// type may be an ancestor's.
    fn constructed(&self, callable: &Callable) -> Option<String> {
        match &callable.signature.result.ty {
            TypeRef::Named { name, .. } if callable.kind == CallableKind::Constructor => Some(self.qualify(name)),
            _ => None,
        }
    }

    /// A typed view of `g_object_new_with_properties` for one class:
    ///
    /// ```text
    /// GtkLabel_construct(object_type: c_size_t, n_properties?: c_uint,
    ///     names?: Ptr<ConstPtr<c_char>> | null, values?: Const<GValue> | null): Declared<GtkLabel, GObject>
    /// ```
    ///
    /// Called with the class's `GType` and nothing else, it makes an instance
    /// with every property at its default -- GJS's `new Gtk.Label()` -- which
    /// is what `new GtkLabel({ … })` calls, then the setters, for a class with
    /// no `new` taking nothing. GIR marks the function not introspectable,
    /// since it takes `GValue`s, so it is declared here; the self-check
    /// compiles each view against `GObject`'s header. The result is floating
    /// for a `GInitiallyUnowned`, as `gtk_label_new`'s is, and the caller's
    /// own reference, `Owned`, for any other object. `names` is a plain
    /// pointer rather than a lent `CStrings`, since nothing here passes one:
    /// the view is for `NULL`, which a lent array cannot be defaulted to.
    fn construct(&mut self, class: &'a Class, c_type: &str) -> Result<Function, Reason> {
        let objects = self
            .repository
            .namespaces
            .get("GObject")
            .ok_or_else(|| Reason::Unknown("GObject".to_owned()))?;
        let tag = |name: &str| self.facts.tags.get(name).cloned().ok_or_else(|| Reason::NoTag(name.to_owned()));
        let (object_tag, value_tag) = (tag("GObject")?, tag("GValue")?);
        let object = self.name_in(objects, "GObject");
        let value = self.name_in(objects, "GValue");
        let result = self.handle(object, &object_tag, false, false);
        let result = self.declared(result, class);
        let floating = self.descends(self.namespace, class, "GInitiallyUnowned");
        let result = self.owned(result, !floating);
        let char = Pointee::Scalar(Scalar::Char);
        self.binding.brands.extend(["Ptr", "ConstPtr", "c_char", "c_size_t", "c_uint"]);
        let parameters = vec![
            ("object_type".to_owned(), Mapped { shape: Shape::Other, ts: "c_size_t".to_owned(), c: Type::Scalar(Scalar::Size) }),
            ("n_properties".to_owned(), Mapped { shape: Shape::Other, ts: "c_uint".to_owned(), c: Type::Scalar(Scalar::UInt) }),
            (
                "names".to_owned(),
                Mapped {
                    shape: Shape::Other,
                    ts: "Ptr<ConstPtr<c_char>> | null".to_owned(),
                    c: Type::Pointer(Pointee::Pointer(Box::new(Pointee::Const(Box::new(char))))),
                },
            ),
            ("values".to_owned(), self.handle(value, &value_tag, true, true)),
        ];
        Ok(Function {
            name: format!("{c_type}_construct"),
            symbol: "g_object_new_with_properties".to_owned(),
            c_parameters: parameters.iter().map(|(_, mapped)| mapped.c.clone()).collect(),
            parameters,
            result,
            deprecated: false,
            free: None,
            no_escape: Vec::new(),
            returns: None,
            method: None,
            throws: None,
            finish: None,
            omissible: BTreeMap::from([
                ("n_properties".to_owned(), "0"),
                ("names".to_owned(), "null"),
                ("values".to_owned(), "null"),
            ]),
            method_only: false,
            statics: None,
        })
    }

    /// A constructor's result as the class GIR says it returns, where C
    /// declares one of that class's ancestors: `gtk_box_new`'s `GtkWidget *`
    /// is `Declared<GtkBox, GtkWidget>`, so `box.append(…)` needs no downcast.
    /// GIR's word is trusted, as gtk-rs trusts it; anything else -- the same
    /// class, or one GIR does not say descends from C's -- is left as C has it.
    fn declared(&mut self, result: Mapped, class: &'a Class) -> Mapped {
        let Shape::Handle { class: declared, nullable } = result.shape.clone() else { return result };
        let namespace = self.namespace;
        let Some(c_type) = class.c_type.as_deref() else { return result };
        if c_type == declared || !self.facts.tags.contains_key(c_type) || !self.descends(namespace, class, &declared) {
            return result;
        }
        let local = self.name_in(namespace, c_type);
        self.binding.brands.insert("Declared");
        let ts = format!("Declared<{local}, {declared}>{}", if nullable { " | null" } else { "" });
        Mapped { shape: Shape::Handle { class: local, nullable }, ts, c: result.c }
    }

    /// Whether GIR says `class` descends from the class C calls `ancestor`.
    fn descends(&self, namespace: &'a Namespace, class: &'a Class, ancestor: &str) -> bool {
        let (mut namespace, mut class) = (namespace, class);
        // Bounded, so a cycle in malformed GIR ends.
        for _ in 0..64 {
            let Some((next_namespace, next)) = self.parent_class(namespace, class) else { return false };
            if next.c_type.as_deref() == Some(ancestor) {
                return true;
            }
            (namespace, class) = (next_namespace, next);
        }
        false
    }

    fn handle(&mut self, local: String, tag: &str, constant: bool, nullable: bool) -> Mapped {
        let pointee = Pointee::Opaque(Handle::from(tag));
        let class = local.clone();
        let (pointee, local) = if constant {
            self.binding.brands.insert("Const");
            (Pointee::Const(Box::new(pointee)), format!("Const<{local}>"))
        } else {
            (pointee, local)
        };
        let ts = if nullable { format!("{local} | null") } else { local };
        Mapped { shape: Shape::Handle { class, nullable }, ts, c: Type::Pointer(pointee) }
    }

    /// A callback parameter, with the C slots that travel with it: the
    /// function pointer taking its context last, the context, and for a
    /// notified one the destroy function. `None` for anything that is not a
    /// callback.
    fn callback_parameter(
        &mut self,
        param: &Param,
        at: usize,
        all: &[Param],
    ) -> Result<Option<(Mapped, Vec<Type>)>, Reason> {
        let TypeRef::Named { name, .. } = &param.ty else { return Ok(None) };
        let qualified = self.qualify(name);
        let Some(Resolved::Callback(callback)) = self.resolve(&qualified) else {
            return Ok(None);
        };
        let (scope, wrapper) = match param.scope {
            Some(Scope::Call) => (Scope::Call, "ScopedClosure"),
            Some(Scope::Notified) => (Scope::Notified, "Closure"),
            // Called once, after the call returns, with nothing to release it
            // by: GIO's `GAsyncReadyCallback`. The bridge releases it.
            Some(Scope::Async) => (Scope::Async, "OnceClosure"),
            Some(Scope::Forever) => return Err(Reason::CallbackScope("forever")),
            None => return Err(Reason::CallbackShape("scope is not annotated")),
        };
        if param.closure != Some(at + 1) {
            return Err(Reason::CallbackShape("context is not the next parameter"));
        }
        if scope == Scope::Notified {
            let destroy = param.destroy.and_then(|d| all.get(d));
            if param.destroy != Some(at + 2) || destroy.is_none() {
                return Err(Reason::CallbackShape("destroy function is not the parameter after its context"));
            }
        } else if param.destroy.is_some() {
            return Err(Reason::CallbackShape("destroy function is annotated on a scoped callback"));
        }
        // The callback's own signature: its context must be its last
        // parameter, which is where the bridge takes its receiver from.
        //
        // Where the callback type does not mark it -- GIO's `AsyncReadyCallback`
        // leaves its `data` unannotated -- a last parameter of type `gpointer`
        // is it: the calling function's own `closure` annotation says there is
        // user data, and GLib passes it last. A mark anywhere else still
        // refuses.
        let signature = &callback.signature;
        let last_is_data = signature.parameters.last().is_some_and(|p| {
            matches!(&p.ty, TypeRef::Named { name, .. } if name == "gpointer")
        });
        let context = signature
            .parameters
            .iter()
            .position(|p| p.closure.is_some())
            .or_else(|| last_is_data.then(|| signature.parameters.len() - 1));
        if context != Some(signature.parameters.len().saturating_sub(1)) || signature.parameters.is_empty() {
            return Err(Reason::CallbackShape("context is not its last parameter"));
        }
        let visible = &signature.parameters[..signature.parameters.len() - 1];
        let mut ts_parameters = Vec::new();
        let mut c_parameters = Vec::new();
        for p in visible {
            if matches!(&p.ty, TypeRef::Named { name, .. } if name == "utf8" || name == "filename") {
                return Err(Reason::StringInCallback);
            }
            let mapped = self.typed(p)?;
            let mapped = self.truth(p, mapped);
            c_parameters.push(mapped.c.clone());
            ts_parameters.push(format!("{}: {}", identifier(&p.name), mapped.ts));
        }
        if matches!(&signature.result.ty, TypeRef::Named { name, .. } if name == "utf8" || name == "filename") {
            return Err(Reason::StringInCallback);
        }
        let result = match &signature.result.ty {
            TypeRef::Named { name, .. } if name == "none" => Mapped { shape: Shape::Other, ts: "void".to_owned(), c: Type::Void },
            _ => {
                let mapped = self.typed(&signature.result)?;
                self.truth(&signature.result, mapped)
            }
        };
        let context = Type::Pointer(Pointee::Void);
        let mut callback_c = c_parameters;
        callback_c.push(context.clone());
        let mut slots = vec![
            Type::FnPointer(std::sync::Arc::new(FnPointer::spell(callback_c, result.c.clone()))),
            context.clone(),
        ];
        if scope == Scope::Notified {
            slots.push(Type::FnPointer(std::sync::Arc::new(FnPointer::spell(vec![context], Type::Void))));
        }
        self.binding.brands.insert(wrapper);
        let ts = format!("{wrapper}<({}) => {}>", ts_parameters.join(", "), result.ts);
        // The Mapped's C type is the function pointer alone; the slots carry
        // the rest.
        let shape = if scope == Scope::Async { Shape::Once } else { Shape::Other };
        Ok(Some((Mapped { shape, ts, c: slots[0].clone() }, slots)))
    }
}

/// A GIR parameter name as a TypeScript identifier.
fn identifier(name: &str) -> String {
    const RESERVED: &[&str] = &[
        "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
        "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
        "import", "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw",
        "true", "try", "typeof", "var", "void", "while", "with", "yield", "let", "static",
        "implements", "interface", "package", "private", "protected", "public", "await",
    ];
    if name.is_empty() {
        "arg".to_owned()
    } else if RESERVED.contains(&name) {
        format!("{name}_")
    } else {
        name.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::SCALARS;
    use nts_core::hir::native::Scalar;

    /// Each brand this binder writes is the one the compiler reads back as the
    /// scalar it was mapped from -- one table on each side, checked here so
    /// they cannot drift.
    #[test]
    fn every_scalar_brand_reads_back_as_its_scalar() {
        for (gir, brand, scalar) in SCALARS {
            assert_eq!(
                Scalar::from_brand(&format!("__{brand}")),
                Some(*scalar),
                "`{gir}` is written as `{brand}`, which the compiler does not read as {scalar:?}"
            );
        }
    }
}

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

use crate::bind_header::ctype::CType;
use nts_core::hir::native::{FnPointer, Handle, Pointee, Scalar, Type};

use super::model::{
    Alias, ArrayRef, Callable, CallableKind, Callback, Class, Direction, Field, Namespace, Param,
    Record, Repository, Scope, Transfer, TypeRef,
};

/// A type named from another module, or this one: `(module, name)`, the module
/// empty for this one.
type Reference = (String, String);

/// An interface a class implements: the name the binding writes and the C
/// tag it is, `("GtkEditable", "_GtkEditable")`.
type Implemented = (String, String);

/// What a signal's view calls: `g_signal_connect_data`, keeping the closure.
pub(crate) const CONNECT: &str = "nts_gobject_connect";
/// What a signal's `emit` view names: no C function, but a thunk the
/// compiler defines per signal, which emits by the signal's id.
pub(crate) const EMIT: &str = "nts_gobject_emit";
/// `gtk_cclosure_expression_new`, bound as GJS's closure expression makes one
/// (`Mapper::cclosure_expression`), through the runtime's
/// `nts_gtk_cclosure_expression_new` (`nts_gtk.h`).
const CCLOSURE_EXPRESSION: (&str, &str) = (
    "gtk_cclosure_expression_new",
    "nts_gtk_cclosure_expression_new",
);
/// What a property with no setter method is written through: a thunk the
/// backend defines per property, `nts_gobject_prop_{kind}__{name}`, as
/// `g_object_set`.
pub(crate) const SET_BY_NAME: &str = "nts_gobject_prop_";
/// The prefix of a construction's calls (`construct_with`): the support
/// file's `builder_new` and `builder_build`, and each property's thunk,
/// `{kind}__{name}`, which the backend defines.
pub(crate) const CONSTRUCT_WITH: &str = "nts_gobject_with_";
/// And one with no getter method read through `g_object_get`, which the thunk
/// reads into a local of the property's own type: a string or an object comes
/// back owned (see `get_by_name`).
pub(crate) const GET_BY_NAME: &str = "nts_gobject_propget_";
/// The method name a property's by-name reader or writer takes where
/// `get_<name>` or `set_<name>` is a method the class already has from an
/// ancestor or an interface: a spelling no GIR method has, so the property
/// keeps an accessor to name and the method keeps its meaning. Not `__`:
/// TypeScript escapes a name that starts with two underscores (`___`), so
/// the lowering would look for a method the checker records under another.
pub(crate) const INTERNAL_GET: &str = "$ntsPropGet_";
pub(crate) const INTERNAL_SET: &str = "$ntsPropSet_";

/// One namespace's binding, ready to write.
#[derive(Debug, Default, Clone)]
pub(crate) struct Binding {
    pub(crate) module: String,
    /// The `gi:` surface's imports: each other namespace a spelling names,
    /// as `(module, name)`, imported whole (`import type * as Gio from
    /// "gi:gio"`). Empty for the `c:` surface, which imports by name.
    pub(crate) namespaces: Vec<(String, String)>,
    /// What the module re-exports from `c:types`: `gi:gobject`'s `property`,
    /// which a program imports beside `GObject`.
    pub(crate) reexports: Vec<&'static str>,
    /// Whether a class's `new` is self-typed, `new <Self, Impl>`, as the `gi:`
    /// surface's are (`Selfed` in `c:types`); a `c:` one's is generic in a
    /// signal map (`Signalled`).
    pub(crate) self_typed: bool,
    pub(crate) headers: Vec<String>,
    /// Macros defined before `headers`, as `@ntsDefine` writes them.
    pub(crate) defines: Vec<String>,
    /// The pkg-config packages the headers and symbols come from, as
    /// `@ntsPackage` names them: GIR's `<package>`, and the request's.
    pub(crate) packages: Vec<String>,
    pub(crate) types: Vec<TypeDecl>,
    pub(crate) functions: Vec<Function>,
    pub(crate) enums: Vec<EnumDecl>,
    pub(crate) aliases: Vec<AliasDecl>,
    /// What each other module contributes to this one's signatures.
    pub(crate) imports: BTreeMap<String, BTreeSet<String>>,
    /// The `c:types` names the signatures use.
    pub(crate) brands: BTreeSet<&'static str>,
    pub(crate) refused: Vec<(String, Reason)>,
    /// The refused entries GIR marks deprecated, which the refusal report
    /// says so of: a census of what programs miss leaves them out, since
    /// GJS programs are not written against them.
    pub(crate) deprecated: BTreeSet<String>,
    /// Each class, with the function answering its `GType`.
    pub(crate) casts: Vec<Cast>,
    /// Each `GObject` interface's `GType` function, by its C type: what a
    /// program class implementing it (`{Name}Implementation`) registers with.
    pub(crate) interface_types: BTreeMap<String, String>,
    /// Each class's properties, by the class's C type. Which become a
    /// property of the class's methods is the emitter's call, since it depends
    /// on which of those methods the self-check kept.
    pub(crate) properties: BTreeMap<String, Vec<Accessor>>,
    /// What `new GtkButton({ … })` calls before its setters, by the class's
    /// C type.
    pub(crate) constructors: BTreeMap<String, Constructor>,
    /// By class C type, for a class made by its `GType`: the construct-only
    /// properties a construction of it can give (`construct_with`).
    pub(crate) constructed: BTreeMap<String, Constructed>,
    /// Each `<constant>` a program can read, folded where it is read, since
    /// no C symbol holds a macro's value.
    pub(crate) constants: Vec<ConstantDecl>,
}

/// A class's construct-only properties, GJS's `new Gio.ThemedIcon({ name })`.
#[derive(Debug, Clone)]
pub(crate) struct Constructed {
    /// Its own, as `(name, TypeScript type)`, which `…Props` offers.
    pub(crate) own: Vec<(String, String)>,
    /// Every one a construction of it can give, its ancestors' in its
    /// namespace included, which the tag lists (`@ntsConstruct … with name`).
    pub(crate) names: Vec<String>,
}

/// One numeric `<constant>`, declared by its C name with its type and its
/// value in a tag, as every binding's constant is (`@ntsConstant`):
/// `/** @ntsConstant 200 */ export const G_PRIORITY_DEFAULT_IDLE:
/// c_int;`.
#[derive(Debug, Clone)]
pub(crate) struct ConstantDecl {
    pub(crate) name: String,
    /// GIR's own name, `PRIORITY_DEFAULT`, which the `gi:` surface spells it
    /// by (`naming`).
    pub(crate) gir_name: String,
    pub(crate) ts: String,
    /// The value `@ntsConstant` carries, folded where it is read; `None`
    /// where the type carries it: a string's literal type,
    /// `"Desktop Entry"`, which lowering reads as it reads a number's.
    pub(crate) value: Option<String>,
}

/// How a class is constructed with every property at its default: its own
/// `new` taking nothing (`gtk_button_new`), or else its view of
/// `g_object_new_with_properties` given its `GType` (`GtkLabel_construct`,
/// `gtk_label_get_type`).
#[derive(Debug, Clone)]
pub(crate) struct Constructor {
    pub(crate) function: String,
    pub(crate) get_type: Option<String>,
    /// For a class with construct-only properties, the properties the
    /// constructor takes, in its order: `g_list_store_new(item_type)`, which
    /// `new GListStore({ item_type })` calls with the literal's.
    pub(crate) from: Vec<String>,
    /// The class's other constructors that take only properties, by fewest
    /// taken: `new GSimpleAction({ name })` is `g_simple_action_new`, and one
    /// that also writes `state` is `g_simple_action_new_stateful`.
    pub(crate) alternatives: Vec<(String, Vec<String>)>,
}

/// A property as the binding names it (`icon_name`), and the methods GIR
/// says read and write it (`get_icon_name`).
#[derive(Debug, Clone)]
pub(crate) struct Accessor {
    pub(crate) name: String,
    pub(crate) getter: Option<String>,
    pub(crate) setter: Option<String>,
}

/// One `asGtkBox`-style helper: the class, and the function answering its
/// `GType`.
#[derive(Debug, Clone)]
pub(crate) struct Cast {
    pub(crate) class: String,
    pub(crate) get_type: String,
}

#[derive(Debug, Clone)]
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
        /// For a `GLib` boxed record, its `GType` function and its size (0
        /// where the headers keep it opaque): `Boxed<Tag, GetType, Size>`.
        boxed: Option<(String, u64)>,
    },
    /// A record C lays out for the program -- `PangoRectangle` -- as
    /// `Struct<{ x: c_int; ... }, "_PangoRectangle">`: each member as
    /// `(name, spelling)`, private ones too, since each is layout.
    Struct {
        name: String,
        tag: String,
        fields: Vec<(String, String)>,
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
    /// A full-transfer raw result, which the caller owns without an inferred deallocator.
    pub(crate) raw_result_owned: bool,
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
    /// A virtual function (`@ntsVfunc`): a slot a subclass overrides, with no
    /// symbol of its own. Written only as a method, `vfunc_clicked`, as GJS
    /// names an override.
    pub(crate) vfunc: Option<Vfunc>,
    /// For a function of the namespace itself -- not a class's, a record's or
    /// a view -- GIR's name for it (`init` for `gtk_init`), which the `gi:`
    /// surface exports it as (`naming`).
    pub(crate) gir_name: Option<String>,
}

/// A virtual function's slot: its class struct, member and the offset C's
/// `offsetof` gives, and the out parameters its override answers as a tuple
/// rather than takes (`vfunc_out`).
#[derive(Debug, Clone)]
pub(crate) struct Vfunc {
    pub(crate) class_struct: String,
    pub(crate) member: String,
    pub(crate) offset: u64,
    /// The slot's trailing out parameters, each by name and whether GTK may
    /// pass NULL for it, in C's order: `@ntsVfuncOut minimum? natural?`.
    pub(crate) outs: Vec<(String, bool)>,
}

#[derive(Debug, Clone)]
pub(crate) struct EnumDecl {
    pub(crate) name: String,
    /// The C type, `GtkOrientation`: the name a signature spells the enum
    /// by, unique across namespaces where `Orientation` is not.
    pub(crate) c_type: Option<String>,
    /// `(name, value, C identifier)`.
    pub(crate) members: Vec<(String, i64, String)>,
}

/// A name GIR gives another type (`<alias>`), declared by the name C gives
/// it -- `GQuark` for `Uint32`, `GtkAllocation` for `GdkRectangle` -- as GTK's
/// C documentation names it.
#[derive(Debug, Clone)]
pub(crate) struct AliasDecl {
    pub(crate) name: String,
    /// What it stands for, as this binding spells it: a scalar's brand, the
    /// form C holds and a `Struct` member spells; a record's type.
    pub(crate) ts: String,
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
    Handle {
        class: String,
        nullable: bool,
    },
    /// A callback C calls once, after the call returns: a `OnceClosure`,
    /// which a Promise form stands in for.
    Once,
    /// An array lent for the call (`CStrings`, `Counted<CBytes>`), which the
    /// program holds as `program` -- `readonly string[]`, `Uint8Array` -- and
    /// which only a foreign function's own parameter can be declared as.
    Lent {
        program: String,
    },
    /// A slot C writes a scalar through, typed `value` as the program reads
    /// it back: what a GJS-style method returns rather than takes. Only a
    /// scalar, since a handle read out of a slot has an ownership to settle
    /// that a number does not.
    Out {
        value: String,
    },
    /// Storage the caller allocates and C fills, a boxed record's
    /// (`GtkTextIter`): passed as the record, and what a GJS-style method
    /// makes with `new class()` and returns, as `get_bounds()` does. Only an
    /// out: an inout's storage holds what C reads, which the caller gives.
    Filled {
        class: String,
    },
    /// Bytes C hands back with their length in another out slot, `length`:
    /// the call's result or an out slot of its own, which a GJS-style method
    /// returns as the `Uint8Array` it copies them into (`bytesFrom`), freeing
    /// C's buffer after where it is the caller's (`owned`).
    Bytes {
        length: String,
        owned: bool,
    },
    /// The out slot holding a `Bytes`'s length, typed `value`: made and read
    /// by the values form, and not a value it returns.
    Length {
        value: String,
    },
}

/// A signal's handler parameters as TypeScript spells them, and the named
/// parameters its `emit` form takes.
type SignalParameters = (Vec<String>, Vec<(String, Mapped)>);

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
    /// A virtual function whose class struct member the headers do not place.
    NoSlot,
    /// A boxed record a parameter hands over (`transfer full`): the box the
    /// program holds it in would free it too.
    BoxedTakenOver,
    StringOut,
    CallerAllocates,
    /// An array shape no lending or copying here covers; the detail
    /// says which shape, so the refusal ledger separates a missing
    /// length from an ownership the compiler has no form for.
    Array(&'static str),
    /// The same, where the ledger needs a name read from GIR (the
    /// element type) rather than one this file states.
    ArrayShape(String),
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
    /// The header declares a `volatile` pointee (`g_atomic_pointer_set`),
    /// which no binding has a spelling for.
    Volatile,
    /// A constant whose value the binding cannot state: the detail says
    /// what it is.
    Constant(String),
    /// A string result C lends as `char *` (`g_strrstr`), where a lent
    /// `string` result is C's `const char *`.
    LentWritableString,
    /// Dropped by the self-check: in GIR, and in none of the headers GIR
    /// names (`g_access` is in `glib/gstdio.h`, which `glib.h` leaves out).
    Undeclared,
    /// `g_object_ref`, `g_object_unref` and their kin: the compiler counts a
    /// `GObject` itself, and a program that also did would count it twice.
    CountedByCompiler,
    /// A function the `gi:` surface would export under a name the module
    /// already has (`naming`).
    NameClash(String),
}

impl fmt::Display for Reason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Shadowed => write!(f, "GIR says another entry replaces it"),
            Self::NotIntrospectable => write!(f, "GIR marks it not introspectable"),
            Self::NoSymbol => write!(f, "no C symbol"),
            Self::Throws => write!(f, "reports errors through a `GError **`"),
            Self::OwnedString => write!(f, "a string parameter the callee takes ownership of"),
            Self::WritableBuffer => write!(
                f,
                "a `char *` buffer the callee may write into, which GIR calls a string"
            ),
            Self::OutParameter => {
                write!(f, "an out parameter of a type written through no slot here")
            }
            Self::NoSlot => write!(
                f,
                "a virtual function whose class struct member the headers do not place"
            ),
            Self::BoxedTakenOver => write!(
                f,
                "a boxed record a parameter hands over, which the program's box would also free"
            ),
            Self::StringOut => write!(f, "a string out parameter"),
            Self::CallerAllocates => {
                write!(f, "an out parameter whose storage the caller allocates")
            }
            Self::Array(why) => write!(f, "an array: {why}"),
            Self::ArrayShape(why) => write!(f, "an array: {why}"),
            Self::Varargs => write!(f, "variadic"),
            Self::Gpointer => write!(f, "a `gpointer`"),
            Self::RecordByValue => write!(f, "a record passed by value"),
            Self::PointerDepth(c) => write!(f, "`{c}`, a pointer depth other than one"),
            Self::CallbackScope(scope) => write!(f, "a callback with `scope=\"{scope}\"`"),
            Self::CallbackShape(why) => write!(f, "a callback whose {why}"),
            Self::StringInCallback => write!(f, "a callback taking or returning a string"),
            Self::Unknown(name) => write!(f, "`{name}`, a type this binder does not know"),
            Self::NoTag(c) => write!(
                f,
                "`{c}`, which the headers do not define as a tagged struct"
            ),
            Self::Header(error) => write!(f, "the header disagrees: {error}"),
            Self::Volatile => write!(
                f,
                "a `volatile` pointee in the header, which no binding spells"
            ),
            Self::Constant(why) => write!(f, "a constant: {why}"),
            Self::LentWritableString => write!(
                f,
                "a string result lent as `char *`, where a lent string result is `const char *`"
            ),
            Self::Undeclared => write!(f, "declared by none of the headers GIR names"),
            Self::CountedByCompiler => write!(f, "a reference count the compiler keeps itself"),
            Self::NameClash(name) => write!(
                f,
                "`{name}` on the gi: surface, a name the module already has"
            ),
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
            Self::Constant(_) => "a constant whose value the binding cannot state".to_owned(),
            Self::NameClash(_) => "a name the gi: surface already has".to_owned(),
            other => other.to_string(),
        }
    }
}

/// The functions a program would count a `GObject` with, which the compiler
/// calls itself: bound, a program could release what it does not own.
const COUNTING: [&str; 6] = [
    "g_object_ref",
    "g_object_unref",
    "g_object_ref_sink",
    "g_object_take_ref",
    "g_object_force_floating",
    "g_clear_object",
];

/// Whether `name` can be a TypeScript type name as it is.
fn is_type_name(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// A constructor or function GIR declares on a class, as a member of the
/// class's value: `(class, name)`.
fn static_of(callable: &Callable, owner: Option<&Class>) -> Option<(String, String)> {
    matches!(
        callable.kind,
        CallableKind::Constructor | CallableKind::Function
    )
    .then(|| owner.and_then(|class| class.c_type.clone()))
    .flatten()
    .map(|class| (class, callable.name.clone()))
}

/// The properties a constructor takes, where every parameter is a property
/// of the class by name and one is construct-only -- `g_list_store_new(
/// item_type)` for `item-type`. `None` otherwise. A construct-only property
/// no constructor chosen takes has no setter either, so a props object
/// cannot name it; the constructor that does is called as itself.
fn constructs_from(class: &Class, callable: &Callable) -> Option<Vec<String>> {
    let name = |property: &str| identifier(&property.replace('-', "_"));
    let construct_only: Vec<String> = class
        .properties
        .iter()
        .filter(|p| p.construct_only)
        .map(|p| name(&p.name))
        .collect();
    if construct_only.is_empty() || callable.signature.parameters.is_empty() {
        return None;
    }
    let taken: Vec<String> = callable
        .signature
        .parameters
        .iter()
        .map(|p| identifier(&p.name))
        .collect();
    let known = |taken: &String| class.properties.iter().any(|p| name(&p.name) == *taken);
    (taken.iter().all(known) && construct_only.iter().any(|c| taken.contains(c))).then_some(taken)
}

/// The module name a namespace binds as: `c:Gtk-4.0`.
#[must_use]
pub(crate) fn module_of(namespace: &Namespace) -> String {
    format!("c:{}-{}", namespace.name, namespace.version)
}

/// The GIR scalar names and the brand each is, with the compiler's scalar
/// behind it. The brand is the `c:types` name, and a test checks each against
/// `Scalar::from_label` so the two cannot drift.
pub(crate) const SCALARS: &[(&str, &str, Scalar)] = &[
    // `gboolean` is `int`, not C's `bool`: the ABI is four bytes.
    ("gboolean", "c_int", Scalar::Int),
    ("gint", "c_int", Scalar::Int),
    ("int", "c_int", Scalar::Int),
    ("guint", "c_uint", Scalar::UInt),
    ("gchar", "c_char", Scalar::Char),
    ("guchar", "Uint8", Scalar::UInt8),
    ("gint8", "Int8", Scalar::Int8),
    ("guint8", "Uint8", Scalar::UInt8),
    ("gshort", "Int16", Scalar::Int16),
    ("gushort", "Uint16", Scalar::UInt16),
    ("gint16", "Int16", Scalar::Int16),
    ("guint16", "Uint16", Scalar::UInt16),
    ("gint32", "Int32", Scalar::Int32),
    ("guint32", "Uint32", Scalar::UInt32),
    ("gunichar", "Uint32", Scalar::UInt32),
    ("GQuark", "Uint32", Scalar::UInt32),
    ("gint64", "BigInt64", Scalar::Int64),
    ("guint64", "BigUint64", Scalar::UInt64),
    ("goffset", "BigInt64", Scalar::Int64),
    ("glong", "c_long", Scalar::Long),
    ("gulong", "c_ulong", Scalar::ULong),
    ("gssize", "c_long", Scalar::Long),
    ("gsize", "c_size_t", Scalar::Size),
    // GIR's own basic types for C's: `time_t` is 64 bits wherever GLib runs
    // (`long` on LP64, `__int64` on Windows), `guintptr` a `size_t`'s width.
    // The self-check compiles each prototype against the header, which is
    // what says the spelling is compatible.
    ("time_t", "BigInt64", Scalar::Int64),
    ("guintptr", "c_size_t", Scalar::Size),
    // `GType` is a `gsize`.
    ("GType", "c_size_t", Scalar::Size),
    ("gfloat", "Float32", Scalar::Float),
    ("gdouble", "Float64", Scalar::Double),
    ("double", "Float64", Scalar::Double),
];

struct Mapper<'a> {
    repository: &'a Repository,
    namespace: &'a Namespace,
    /// Every class and record by its C type name, so a handle is spelled from
    /// what C says it points at.
    c_types: BTreeMap<&'a str, &'a Namespace>,
    /// What the headers say: struct tags and enum signedness (see `facts`).
    facts: &'a super::facts::Facts,
    /// The records the type system embeds first in what it hands out -- an
    /// instance's `GTypeInstance`, a class struct's `GTypeClass`, an
    /// interface's `GTypeInterface` -- which stay handles, never `Struct`s:
    /// `g_type_class_ref` returns one.
    embedded: BTreeSet<&'a str>,
    binding: Binding,
    /// Mapping one of `COMPARES_ITEMS`: its compare callback's `gpointer`s are
    /// a list model's items.
    comparing_items: bool,
}

/// An integer as GIR writes a constant's value, where a double holds it
/// exactly -- within 2^53 -- returned as written.
fn exact_integer(value: &str) -> Option<String> {
    let integer = value.parse::<i128>().ok()?;
    (integer.unsigned_abs() <= 1 << 53).then(|| value.to_owned())
}

/// Functions whose `GCompareDataFunc` compares the items of a list model --
/// always `GObject`s, which GIR, typing the callback once for every use, cannot
/// say. GJS's overrides know it too. The callback's two `gpointer`s are
/// `Erased<GObject>` for these: `sorter.set_sort_func((a, b) => ...)`.
const COMPARES_ITEMS: [&str; 5] = [
    "gtk_custom_sorter_new",
    "gtk_custom_sorter_set_sort_func",
    "g_list_store_sort",
    "g_list_store_insert_sorted",
    "g_list_store_find_with_equal_func_full",
];

/// Bind one namespace of `repository`.
#[must_use]
#[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
pub(crate) fn bind<'a>(
    repository: &'a Repository,
    namespace: &'a Namespace,
    facts: &'a super::facts::Facts,
) -> Binding {
    let mut c_types = BTreeMap::new();
    for ns in repository.namespaces.values() {
        let classes = ns.classes.iter().filter_map(|c| c.c_type.as_deref());
        let records = ns
            .records
            .iter()
            .filter(|r| !r.class_struct)
            .filter_map(|r| r.c_type.as_deref());
        for c_type in classes.chain(records) {
            c_types.entry(c_type).or_insert(ns);
        }
    }
    let mut embedded = BTreeSet::new();
    for ns in repository.namespaces.values() {
        let instances = ns.classes.iter().filter_map(|c| c.first_field.as_ref());
        let class_structs = ns
            .records
            .iter()
            .filter(|r| r.class_struct)
            .filter_map(|r| r.fields.first().map(|f| &f.ty));
        for first in instances.chain(class_structs) {
            if let TypeRef::Named {
                c_type: Some(c_type),
                ..
            } = first
            {
                embedded.insert(c_type.as_str());
            }
        }
        // And every record GIR names where C passes a `gpointer`: an object
        // handed out through an untyped pointer -- `GTypeInterface` to
        // `g_type_interface_peek_parent` -- which the binding spells
        // `Erased<T>`, a handle. GIR's own word in each namespace, so a
        // record's spelling does not depend on which others a closure holds:
        // GObject's interface struct carries no `is-gtype-struct-for`, and
        // bound with GLib alone nothing marked embedded `GTypeInterface`.
        let callables = ns
            .functions
            .iter()
            .chain(
                ns.classes
                    .iter()
                    .flat_map(|c| c.callables.iter().chain(&c.vfuncs)),
            )
            .chain(ns.records.iter().flat_map(|r| &r.callables));
        let signatures = callables
            .map(|callable| &callable.signature)
            .chain(ns.callbacks.iter().map(|callback| &callback.signature));
        for signature in signatures {
            let params = signature
                .instance
                .iter()
                .chain(&signature.parameters)
                .chain(std::iter::once(&signature.result));
            for param in params {
                let TypeRef::Named {
                    name,
                    c_type: Some(c_type),
                } = &param.ty
                else {
                    continue;
                };
                if !matches!(c_type.as_str(), "gpointer" | "gconstpointer") {
                    continue;
                }
                let (owner, local) = match name.split_once('.') {
                    Some((owner, local)) => (repository.namespaces.get(owner), local),
                    None => (Some(ns), name.as_str()),
                };
                if let Some(c_type) = owner
                    .and_then(|owner| owner.records.iter().find(|r| r.name == local))
                    .and_then(|record| record.c_type.as_deref())
                {
                    embedded.insert(c_type);
                }
            }
        }
    }
    let mut mapper = Mapper {
        repository,
        namespace,
        c_types,
        facts,
        embedded,
        comparing_items: false,
        binding: Binding {
            module: module_of(namespace),
            headers: namespace.headers.clone(),
            packages: namespace.packages.clone(),
            defines: namespace.defines.clone(),
            ..Binding::default()
        },
    };
    mapper.types();
    mapper.enums();
    mapper.aliases();
    mapper.constants();
    // Each with the class it is declared in, which is what a constructor
    // returns whatever its return type says.
    // A record's, with the record's C type: its constructors and functions
    // are statics of its value, `cairo_t.create(surface)`, as a class's are.
    let mut callables: Vec<(&Callable, Option<&Class>, Option<&str>)> = namespace
        .functions
        .iter()
        .map(|f| (f, None, None))
        .collect();
    for class in &namespace.classes {
        callables.extend(class.callables.iter().map(|c| (c, Some(class), None)));
    }
    for record in namespace.records.iter().filter(|r| !r.class_struct) {
        callables.extend(
            record
                .callables
                .iter()
                .map(|c| (c, None, record.c_type.as_deref())),
        );
    }
    for (callable, owner, record) in callables {
        let name = callable
            .c_identifier
            .clone()
            .unwrap_or_else(|| callable.name.clone());
        match mapper.function(callable, owner) {
            Ok(mut function) => {
                function.gir_name =
                    (owner.is_none() && record.is_none() && function.method.is_none())
                        .then(|| callable.name.clone());
                if let Some(record) = record
                    && function.method.is_none()
                    && mapper.plain_struct(record).is_none()
                    && matches!(
                        callable.kind,
                        CallableKind::Constructor | CallableKind::Function
                    )
                {
                    function.statics = Some((record.to_owned(), callable.name.clone()));
                }
                // `new GtkButton({ … })` calls the class's `new`, when it
                // takes nothing; and a class with construct-only properties,
                // the constructor that takes them.
                if callable.kind == CallableKind::Constructor
                    && let Some(class) = owner
                    && let Some(c_type) = class.c_type.clone()
                {
                    // One that throws is no `new`: it could not report why.
                    if let Some(from) =
                        constructs_from(class, callable).filter(|_| function.throws.is_none())
                    {
                        // Each, the one taking the fewest first: which a
                        // construction calls is the lowering's, by what its
                        // literal writes.
                        let made = Constructor {
                            function: function.name.clone(),
                            get_type: None,
                            from,
                            alternatives: Vec::new(),
                        };
                        match mapper.binding.constructors.get_mut(&c_type) {
                            Some(first) if !first.from.is_empty() => {
                                let mut all = std::mem::take(&mut first.alternatives);
                                all.push((first.function.clone(), first.from.clone()));
                                all.push((made.function, made.from));
                                all.sort_by_key(|(_, from)| from.len());
                                let (function, from) = all.remove(0);
                                *first = Constructor {
                                    function,
                                    get_type: None,
                                    from,
                                    alternatives: all,
                                };
                            }
                            _ => {
                                mapper.binding.constructors.insert(c_type, made);
                            }
                        }
                    } else if callable.name == "new"
                        && callable.signature.parameters.is_empty()
                        && !class.properties.iter().any(|p| p.construct_only)
                    {
                        mapper.binding.constructors.insert(
                            c_type,
                            Constructor {
                                function: function.name.clone(),
                                get_type: None,
                                from: Vec::new(),
                                alternatives: Vec::new(),
                            },
                        );
                    }
                }
                mapper.binding.functions.push(function);
            }
            // The entry GIR names instead is bound under the same symbol;
            // this one is a duplicate, not something missing.
            Err(Reason::Shadowed) => {}
            Err(reason) => {
                if callable.deprecated {
                    mapper.binding.deprecated.insert(name.clone());
                }
                mapper.binding.refused.push((name, reason));
            }
        }
    }
    vfuncs(&mut mapper, namespace);
    set_by_name(&mut mapper, namespace);
    signals(&mut mapper, namespace);
    mapper.binding.functions.sort_by(|a, b| a.name.cmp(&b.name));
    // Two GIR entries can name one C symbol (a function and a method moved to
    // it); the first is the binding. Signal connects share a symbol and have
    // names of their own, which is what this compares.
    mapper.binding.functions.dedup_by(|a, b| a.name == b.name);
    mapper.binding
}

/// Each class's signals, as the views that connect to one (`connect`,
/// `connect_after`) and emit it (`emit`), where its parameters map.
fn signals<'a>(mapper: &mut Mapper<'a>, namespace: &'a Namespace) {
    for class in &namespace.classes {
        for signal in &class.signals {
            let label = format!(
                "{}::{}",
                class.c_type.as_deref().unwrap_or(&class.name),
                signal.name
            );
            match mapper.signal(class, signal) {
                Ok((connect, emit)) => {
                    // `connect_after`: the same call with `G_CONNECT_AFTER`.
                    let after = Function {
                        name: connect.name.replacen("_connect_", "_connect_after_", 1),
                        omissible: BTreeMap::from([("connect_flags".to_owned(), "1")]),
                        method: connect
                            .method
                            .as_ref()
                            .map(|(class, _)| (class.clone(), "connect_after".to_owned())),
                        ..connect.clone()
                    };
                    mapper.binding.functions.extend([connect, after]);
                    mapper.binding.functions.extend(emit);
                }
                Err(reason) => mapper.binding.refused.push((label, reason)),
            }
        }
    }
}

/// Each property writable after construction with no setter method --
/// `GtkWidget`'s `width-request`, `GtkWindow`'s `default-width` -- given one:
/// `set_width_request`, whose symbol is the thunk the backend defines as
/// `g_object_set(object, "width-request", value, NULL)`, so that `new
/// GtkWidget({ width_request })` and `widget.width_request = 80` write it
/// as they write a property with a setter. The value crosses `g_object_set`'s
/// varargs, so the thunk's name says how (`SET_BY_NAME`): `i` an `int`
/// (`gint`, `gboolean`, an enum), `u` a `guint` or flags, `l`/`L` 64 bits,
/// `d` a `double` or `float`, `p` a pointer. Anything else is refused.
fn set_by_name<'a>(mapper: &mut Mapper<'a>, namespace: &'a Namespace) {
    for class in &namespace.classes {
        let Some(c_type) = class.c_type.clone() else {
            continue;
        };
        if class.interface || !mapper.facts.tags.contains_key(&c_type) {
            continue;
        }
        for property in &class.properties {
            if let Some(param) = &property.get_by_name {
                get_by_name(mapper, class, &c_type, &property.name, param);
            }
            let Some(param) = &property.set_by_name else {
                continue;
            };
            let ident = member(&property.name);
            let mut method = format!("set_{ident}");
            if class
                .callables
                .iter()
                .any(|callable| member(&callable.name) == method)
            {
                continue;
            }
            if mapper.inherits_method(namespace, class, &method) {
                method = format!("{INTERNAL_SET}{ident}");
            }
            let label = format!("{c_type}:{}", property.name);
            let param = mapper.with_c_type(&spelled_string(param, "const gchar*"));
            // A string as an in parameter's is (`value`), lent for the call.
            let value = match if is_string(&param) {
                mapper.value(&param)
            } else {
                mapper.typed(&param)
            } {
                Ok(value) => mapper.truth(&param, value),
                Err(reason) => {
                    mapper.binding.refused.push((label, reason));
                    continue;
                }
            };
            let Some(kind) = value_kind(&value.c) else {
                mapper.binding.refused.push((
                    label,
                    Reason::Unknown(format!("a property value of C type {:?}", value.c)),
                ));
                continue;
            };
            let this = Mapped {
                shape: Shape::Other,
                ts: c_type.clone(),
                c: Type::Pointer(Pointee::Void),
            };
            mapper.binding.functions.push(Function {
                name: format!("{c_type}_{method}_by_name"),
                symbol: format!("{SET_BY_NAME}{kind}__{}", property.name.replace('-', "_")),
                parameters: vec![
                    ("self".to_owned(), this.clone()),
                    ("value".to_owned(), value.clone()),
                ],
                result: Mapped {
                    shape: Shape::Other,
                    ts: "void".to_owned(),
                    c: Type::Void,
                },
                c_parameters: vec![this.c, value.c],
                deprecated: false,
                free: None,
                raw_result_owned: false,
                no_escape: Vec::new(),
                returns: None,
                method: Some((c_type.clone(), method.clone())),
                throws: None,
                finish: None,
                omissible: BTreeMap::new(),
                method_only: true,
                statics: None,
                vfunc: None,
                gir_name: None,
            });
            if let Some(accessor) = mapper
                .binding
                .properties
                .get_mut(&c_type)
                .and_then(|all| all.iter_mut().find(|accessor| accessor.name == ident))
            {
                accessor.setter = Some(method);
            }
        }
    }
}

/// A function the binding declares itself, calling what `symbol` names with
/// `parameters` as they are.
fn plain_function(
    name: String,
    symbol: String,
    parameters: Vec<(String, Mapped)>,
    result: Mapped,
) -> Function {
    Function {
        name,
        symbol,
        c_parameters: parameters
            .iter()
            .map(|(_, mapped)| mapped.c.clone())
            .collect(),
        parameters,
        result,
        deprecated: false,
        free: None,
        raw_result_owned: false,
        no_escape: Vec::new(),
        returns: None,
        method: None,
        throws: None,
        finish: None,
        omissible: BTreeMap::new(),
        method_only: false,
        statics: None,
        vfunc: None,
        gir_name: None,
    }
}

/// A property's `utf8` spelled as the thunk passes it -- `const gchar*` in,
/// `gchar*` back -- so that it maps as a parameter's or a result's string
/// does. GIR writes a property's with no C type, or as `gchar*`, which a
/// parameter would mean a buffer the callee writes: `g_object_set` only
/// reads it.
fn spelled_string(param: &Param, spelling: &str) -> Param {
    let mut param = param.clone();
    if let TypeRef::Named { name, c_type } = &mut param.ty
        && name == "utf8"
    {
        *c_type = Some(spelling.to_owned());
    }
    param
}

fn is_string(param: &Param) -> bool {
    matches!(&param.ty, TypeRef::Named { name, .. } if name == "utf8")
}

/// A string C lends as `char *`, as `g_strrstr` lends one into its argument:
/// a `string` result is `const char *` unless the caller frees it
/// (`@ntsFree`), so nothing spells a lent one the header's way.
fn lends_writable_string(result: &Param, header: &CType) -> bool {
    matches!(&result.ty, TypeRef::Named { name, .. } if name == "utf8" || name == "filename")
        && result.transfer == Transfer::None
        && matches!(header, CType::Pointer { constant: false, to }
            if **to == CType::Scalar("char".to_owned()))
}

/// `callable` with each C spelling's `const` as `header` declares it: GIR's
/// `void*` for `gio.h`'s `const void *buffer` is `const void*`. Unchanged
/// where GIR's C slots -- the instance, each parameter, a `GError **` --
/// are not the header's, one for one.
fn header_qualified(callable: &Callable, header: &CType) -> Callable {
    let CType::Function {
        result, parameters, ..
    } = header
    else {
        return callable.clone();
    };
    let signature = &callable.signature;
    let slots = usize::from(signature.instance.is_some())
        + signature
            .parameters
            .iter()
            .filter(|p| !matches!(p.ty, TypeRef::Varargs))
            .count()
        + usize::from(signature.throws);
    if slots != parameters.len() {
        return callable.clone();
    }
    let mut qualified = callable.clone();
    let signature = &mut qualified.signature;
    // A trailing `GError **` is the header's last slot and GIR's none.
    let gir = signature.instance.iter_mut().chain(
        signature
            .parameters
            .iter_mut()
            .filter(|p| !matches!(p.ty, TypeRef::Varargs)),
    );
    for (param, header) in gir.zip(parameters) {
        qualify_param(param, header);
    }
    qualify_param(&mut signature.result, result);
    qualified
}

fn qualify_param(param: &mut Param, header: &CType) {
    let spelling = match &mut param.ty {
        TypeRef::Named { c_type, .. } => c_type,
        TypeRef::Array(array) => &mut array.c_type,
        TypeRef::Varargs | TypeRef::Missing => return,
    };
    if let Some(text) = spelling
        && let Some(requalified) = requalify(text, header)
    {
        *text = requalified;
    }
}

/// GIR's C spelling of a pointer, with the `const` at each level that
/// `header` has: `void*` as `const void*`, `gpointer` as `gconstpointer`,
/// `const gchar*` as `gchar*`. `None` where they already agree, and where
/// the two differ in more than that -- another depth, or a callback type's
/// name -- which the self-check still holds to the header.
fn requalify(spelling: &str, header: &CType) -> Option<String> {
    // The base: its words and whether `const` is among them; then a `bool`
    // per `*`, for a `const` written after it.
    let (mut base_const, base, mut levels) = match spelling.trim() {
        "gpointer" => (false, "void".to_owned(), vec![false]),
        "gconstpointer" => (true, "void".to_owned(), vec![false]),
        text => {
            let spaced = text.replace('*', " * ");
            let mut words = spaced.split_whitespace();
            let (mut constant, mut base) = (false, Vec::new());
            let mut levels = Vec::new();
            for word in words.by_ref() {
                match word {
                    "*" => {
                        levels.push(false);
                        break;
                    }
                    "const" => constant = true,
                    word => base.push(word),
                }
            }
            for word in words {
                match (word, levels.last_mut()) {
                    ("*", _) => levels.push(false),
                    ("const", Some(last)) => *last = true,
                    _ => return None,
                }
            }
            (constant, base.join(" "), levels)
        }
    };
    if levels.is_empty() || base.is_empty() {
        return None;
    }
    // The header's `const` per level, outermost pointer first: the first
    // is what the parameter points at, so the base's is the last.
    let mut consts = Vec::new();
    let mut at = header;
    for _ in 0..levels.len() {
        let CType::Pointer { to, constant } = at else {
            return None;
        };
        consts.push(*constant);
        at = to;
    }
    if matches!(at, CType::Pointer { .. }) {
        return None;
    }
    let before = (base_const, levels[..levels.len() - 1].to_vec());
    base_const = consts[levels.len() - 1];
    // Level `i`'s `const` qualifies the pointer one level inside the
    // outermost, `consts[levels.len() - 2 - i]`; the outermost's own is
    // the parameter's, which a function type does not keep.
    for (i, level) in levels.iter_mut().enumerate().take(consts.len() - 1) {
        *level = consts[consts.len() - 2 - i];
    }
    if before == (base_const, levels[..levels.len() - 1].to_vec()) {
        return None;
    }
    if base == "void"
        && levels.len() == 1
        && matches!(spelling.trim(), "gpointer" | "gconstpointer")
    {
        return Some(
            if base_const {
                "gconstpointer"
            } else {
                "gpointer"
            }
            .to_owned(),
        );
    }
    let mut text = format!("{}{base}", if base_const { "const " } else { "" });
    for (i, constant) in levels.iter().enumerate() {
        text.push('*');
        if *constant && i + 1 < levels.len() {
            text.push_str(" const");
        }
    }
    Some(text)
}

/// A compare callback's `gpointer` or `gconstpointer`, for a function in
/// `COMPARES_ITEMS`, as the `GObject` it is: typed as GIR types a
/// `GtkCustomFilterFunc`'s item, `GObject.Object` passed as `gpointer`.
fn item_of_list(param: &Param) -> Option<Param> {
    let TypeRef::Named { name, .. } = &param.ty else {
        return None;
    };
    if name != "gpointer" && name != "gconstpointer" {
        return None;
    }
    let mut item = param.clone();
    item.ty = TypeRef::Named {
        name: "GObject.Object".to_owned(),
        c_type: Some("gpointer".to_owned()),
    };
    // A model's item is never NULL.
    item.nullable = false;
    Some(item)
}

/// How a property's value crosses `g_object_set`/`g_object_get`, as a
/// thunk's name says it (see `set_by_name`). `None` for any other C type.
fn value_kind(c: &Type) -> Option<char> {
    Some(match c {
        Type::Scalar(Scalar::Int | Scalar::Int32 | Scalar::Int16 | Scalar::Int8 | Scalar::Char)
        | Type::Bool => 'i',
        Type::Scalar(Scalar::UInt | Scalar::UInt32 | Scalar::UInt16 | Scalar::UInt8) => 'u',
        Type::Scalar(Scalar::Int64 | Scalar::Long) => 'l',
        Type::Scalar(Scalar::UInt64 | Scalar::ULong) => 'L',
        Type::Scalar(Scalar::Double | Scalar::Float) => 'd',
        Type::Pointer(_) => 'p',
        _ => return None,
    })
}

/// A readable property with no getter method, read through `g_object_get`
/// (`GET_BY_NAME`): `get_width_request`. A number or a boolean, a string --
/// copied, and freed once read -- or a `GObject`, owned. Anything else is left
/// unreadable, as it was: the lowering refuses a read no `@ntsGet` names.
fn get_by_name(
    mapper: &mut Mapper<'_>,
    class: &Class,
    c_type: &str,
    property: &str,
    param: &Param,
) {
    let ident = member(property);
    let mut method = format!("get_{ident}");
    if class
        .callables
        .iter()
        .any(|callable| member(&callable.name) == method)
    {
        return;
    }
    if mapper.inherits_method(mapper.namespace, class, &method) {
        method = format!("{INTERNAL_GET}{ident}");
    }
    let raw = param;
    let param = mapper.with_c_type(&spelled_string(raw, "const gchar*"));
    let (value, kind) = if is_string(&param) {
        (
            Mapped {
                shape: Shape::Other,
                ts: String::new(),
                c: Type::Pointer(Pointee::Void),
            },
            'p',
        )
    } else {
        let Ok(value) = mapper.typed(&param) else {
            return;
        };
        let value = mapper.truth(&param, value);
        let Some(kind) = value_kind(&value.c) else {
            return;
        };
        (value, kind)
    };
    // A pointer comes back owned: a string `g_object_get` copied, which the
    // call frees once read, or a GObject it took a reference to. Anything
    // else -- a boxed copy -- is left unreadable.
    let (value, free) = if kind == 'p' {
        let mut result = mapper.with_c_type(&spelled_string(raw, "gchar*"));
        result.direction = Direction::Out;
        result.transfer = Transfer::Full;
        result.nullable = true;
        let Ok((read, free)) = mapper.result(&result) else {
            return;
        };
        let read = mapper.truth(&result, read);
        let string = read.ts.starts_with("string");
        if !string && !matches!(read.shape, Shape::Handle { .. }) {
            return;
        }
        (
            if string {
                read
            } else {
                mapper.owned(read, true)
            },
            free,
        )
    } else {
        (value, None)
    };
    let this = Mapped {
        shape: Shape::Other,
        ts: c_type.to_owned(),
        c: Type::Pointer(Pointee::Void),
    };
    mapper.binding.functions.push(Function {
        name: format!("{c_type}_{method}_by_name"),
        symbol: format!("{GET_BY_NAME}{kind}__{}", property.replace('-', "_")),
        parameters: vec![("self".to_owned(), this.clone())],
        result: value.clone(),
        c_parameters: vec![this.c],
        deprecated: false,
        free,
        raw_result_owned: false,
        no_escape: Vec::new(),
        returns: None,
        method: Some((c_type.to_owned(), method.clone())),
        throws: None,
        finish: None,
        omissible: BTreeMap::new(),
        method_only: true,
        statics: None,
        vfunc: None,
        gir_name: None,
    });
    if let Some(accessor) = mapper
        .binding
        .properties
        .get_mut(c_type)
        .and_then(|all| all.iter_mut().find(|accessor| accessor.name == ident))
    {
        accessor.getter = Some(method);
    }
}

/// Each class's virtual functions, as `vfunc_*` methods naming their class
/// struct's member. Named after the member (`GtkButtonClass_clicked`) since
/// they have no symbol, and a name is what tells two apart.
fn vfuncs<'a>(mapper: &mut Mapper<'a>, namespace: &'a Namespace) {
    for class in &namespace.classes {
        let Some(class_struct) = class
            .type_struct
            .as_ref()
            .and_then(|name| namespace.records.iter().find(|record| &record.name == name))
            .and_then(|record| record.c_type.clone())
        else {
            continue;
        };
        for vfunc in &class.vfuncs {
            let label = format!("{class_struct}.{}", vfunc.name);
            // Mapped as the method it is, under the name it gets here, since
            // there is no C identifier to map it under.
            let named = Callable {
                c_identifier: Some(format!("{class_struct}_{}", vfunc.name)),
                ..vfunc.clone()
            };
            let Some(offset) = mapper
                .facts
                .offsets
                .get(&(class_struct.clone(), vfunc.name.clone()))
                .copied()
            else {
                mapper.binding.refused.push((label, Reason::NoSlot));
                continue;
            };
            match mapper.function(&named, Some(class)) {
                Ok(mut function) => {
                    let Some((class, _)) = function.method.clone() else {
                        mapper.binding.refused.push((label, Reason::OutParameter));
                        continue;
                    };
                    let outs = vfunc_tuple(&mut function);
                    let name = format!("{class_struct}_{}", vfunc.name);
                    mapper.binding.functions.push(Function {
                        name: name.clone(),
                        symbol: name,
                        method: Some((class, format!("vfunc_{}", identifier(&vfunc.name)))),
                        method_only: true,
                        statics: None,
                        finish: None,
                        vfunc: Some(Vfunc {
                            class_struct: class_struct.clone(),
                            member: vfunc.name.clone(),
                            offset,
                            outs,
                        }),
                        ..function
                    });
                }
                Err(Reason::Shadowed) => {}
                Err(reason) => mapper.binding.refused.push((label, reason)),
            }
        }
    }
}

/// GJS's form of an override: its trailing scalar out parameters taken out
/// of its parameters and answered, after its own result, as the tuple GJS
/// returns -- `vfunc_measure(orientation, for_size): [minimum, natural,
/// minimum_baseline, natural_baseline]`, one value bare, as a call's values
/// form answers. Its C parameters and result are the slot's, unchanged,
/// which the self-check compares. The outs, by name and whether GTK may pass
/// NULL for one; none, and the parameters as they were, unless every out
/// parameter is a scalar and all of them trail the ins.
fn vfunc_tuple(function: &mut Function) -> Vec<(String, bool)> {
    let is_out = |mapped: &Mapped| matches!(mapped.shape, Shape::Out { .. });
    let Some(first) = function
        .parameters
        .iter()
        .position(|(_, mapped)| is_out(mapped))
    else {
        return Vec::new();
    };
    if !function.parameters[first..]
        .iter()
        .all(|(_, mapped)| is_out(mapped))
    {
        return Vec::new();
    }
    let outs = function.parameters.split_off(first);
    let mut elements: Vec<String> = Vec::new();
    if function.result.ts != "void" {
        elements.push(function.result.ts.clone());
    }
    elements.extend(outs.iter().filter_map(|(_, mapped)| match &mapped.shape {
        Shape::Out { value } => Some(value.clone()),
        _ => None,
    }));
    let ts = if elements.len() == 1 {
        elements.remove(0)
    } else {
        format!("[{}]", elements.join(", "))
    };
    function.result = Mapped {
        shape: Shape::Other,
        ts,
        c: function.result.c.clone(),
    };
    let names: Vec<(String, bool)> = outs
        .into_iter()
        .map(|(name, mapped)| (name, mapped.ts.ends_with(" | null")))
        .collect();
    function
        .no_escape
        .retain(|name| !names.iter().any(|(out, _)| out == name));
    for (name, _) in &names {
        function.omissible.remove(name);
    }
    names
}

/// A plain record's member, as [`Mapper::member`] reads it.
enum StructMember {
    /// A value of the type GIR names, qualified.
    Value(String),
    /// A string's `char *`, `const` where the header's is.
    String { constant: bool },
    /// Another plain record, held by value, by its C type.
    Nested(String),
}

/// A type name as `namespace` writes it, qualified so it resolves from any
/// namespace's binding -- `Weight` in Pango is `Pango.Weight` -- with C's own
/// names (`gint`, `gpointer`, `utf8`) left bare.
fn qualified_in(namespace: &Namespace, name: &str) -> String {
    if name.contains('.')
        || SCALARS.iter().any(|(gir, ..)| *gir == name)
        || matches!(
            name,
            "gpointer" | "gconstpointer" | "utf8" | "filename" | "none" | "va_list"
        )
    {
        name.to_owned()
    } else {
        format!("{}.{name}", namespace.name)
    }
}

/// What a `T *` spelling points at: `T`, without `const`.
fn pointee_of(c_type: &str) -> &str {
    c_type
        .trim()
        .trim_start_matches("const ")
        .trim_end_matches(['*', ' '])
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
        // A NULL instance C accepts too -- `g_cancellable_cancel(NULL)` does
        // nothing -- is a method all the same: a receiver is never NULL.
        Shape::Handle { class, .. } => Some((class.clone(), member(&callable.name))),
        // An instance C takes as `gpointer`, `Erased<GObject>`: a method all
        // the same, as a signal's `connect` is -- `source.bind_property(...)`
        // is `g_object_bind_property(source, ...)`.
        Shape::Other => instance
            .ts
            .strip_prefix("Erased<")
            .and_then(|rest| rest.strip_suffix('>'))
            .filter(|class| is_type_name(class))
            .map(|class| (class.to_owned(), member(&callable.name))),
        _ => None,
    }
}

/// The type the alias `qualified` names, followed to the end of a chain of
/// aliases: qualified by the alias's own namespace where it names a type of
/// one, and bare where it names a C one (`guint32`). `None` for a name that
/// is not an alias.
fn alias_target(repository: &Repository, qualified: &str) -> Option<String> {
    let mut at = qualified.to_owned();
    let mut found = None;
    // Bounded: a chain of aliases is a handful long, and a cycle is GIR's
    // error, not a reason to hang.
    for _ in 0..8 {
        let (ns, local) = at.split_once('.')?;
        let namespace = repository.namespaces.get(ns)?;
        let Some(Alias { target, .. }) = namespace.aliases.iter().find(|alias| alias.name == local)
        else {
            break;
        };
        let target = if target.contains('.') || SCALARS.iter().any(|(gir, ..)| gir == target) {
            target.clone()
        } else {
            format!("{ns}.{target}")
        };
        found = Some(target.clone());
        if !target.contains('.') {
            break;
        }
        at = target;
    }
    found
}

/// The C type of the record `qualified` names.
fn record_c_type<'a>(repository: &'a Repository, qualified: &str) -> Option<&'a str> {
    let (ns, local) = qualified.split_once('.')?;
    repository
        .namespaces
        .get(ns)?
        .records
        .iter()
        .find(|record| record.name == local)?
        .c_type
        .as_deref()
}

/// What an alias a program can name stands for.
pub(super) enum AliasOf<'a> {
    /// A scalar, by its brand: `GQuark` is a `Uint32`.
    Scalar(&'static str),
    /// A record, by its C type: `GtkAllocation` is a `GdkRectangle`.
    Record(&'a str),
}

/// An alias of `namespace`'s a program can name, by its C name, with what it
/// stands for: a scalar or a record. Not one standing for nothing a program
/// holds -- `GMutexLocker`, a `typedef void` for `g_autoptr` -- nor one for
/// a type no single spelling is (`GStrv`'s `utf8`), nor a callback's, which
/// waits on callback members. One rule, for the binding that declares it and
/// for the `gi:` surface's names (`naming::Names`).
pub(super) fn named_alias<'a>(
    repository: &'a Repository,
    namespace: &Namespace,
    alias: &'a Alias,
) -> Option<(&'a str, AliasOf<'a>)> {
    let name = alias.c_type.as_deref().filter(|c| is_type_name(c))?;
    let target = alias_target(repository, &format!("{}.{}", namespace.name, alias.name))?;
    let stands_for = match SCALARS.iter().find(|(gir, ..)| *gir == target) {
        Some((_, brand, _)) => AliasOf::Scalar(brand),
        None => AliasOf::Record(record_c_type(repository, &target)?),
    };
    Some((name, stands_for))
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
        if name.contains('.') {
            name.to_owned()
        } else {
            format!("{}.{name}", self.namespace.name)
        }
    }

    /// The type an alias names (`alias_target`), for a name in this namespace.
    fn alias_target(&self, name: &str) -> Option<String> {
        alias_target(self.repository, &self.qualify(name))
    }

    /// A record's alias as the record it stands for: `typedef GdkRectangle
    /// GtkAllocation` makes a `GtkAllocation *` a `GdkRectangle *` to C, and
    /// the record is what the headers tag and the bindings declare, so every
    /// path a record takes -- its `Struct`'s storage, its handle -- reads it
    /// by the record's C name. Where `ty` names an alias of a record and
    /// spells the alias's typedef, its C type the record's, with the `const`
    /// and `*`s kept; `None` otherwise. The GIR name stays the alias's, so
    /// `typed` reads it as the record and spells it by its own name
    /// (`spelled_as_alias`), as it does a scalar's.
    fn record_alias(&self, ty: &TypeRef) -> Option<TypeRef> {
        let TypeRef::Named {
            name,
            c_type: Some(c_type),
        } = ty
        else {
            return None;
        };
        let qualified = self.qualify(name);
        let (ns, local) = qualified.split_once('.')?;
        let typedef = self
            .repository
            .namespaces
            .get(ns)?
            .aliases
            .iter()
            .find(|alias| alias.name == local)?
            .c_type
            .as_deref()?;
        let target = self.alias_target(name)?;
        let record = record_c_type(self.repository, &target)?;
        let (constant, spelled) = match c_type.strip_prefix("const ") {
            Some(rest) => ("const ", rest),
            None => ("", c_type.as_str()),
        };
        let stars = spelled.strip_prefix(typedef)?;
        stars
            .chars()
            .all(|c| c == '*' || c == ' ')
            .then(|| TypeRef::Named {
                name: name.clone(),
                c_type: Some(format!("{constant}{record}{stars}")),
            })
    }

    /// `callable` with each record alias it names read as the record
    /// (`record_alias`); `None` where it names none.
    fn records_unaliased(&self, callable: &Callable) -> Option<Callable> {
        let signature = &callable.signature;
        signature
            .instance
            .iter()
            .chain(&signature.parameters)
            .chain([&signature.result])
            .any(|param| self.record_alias(&param.ty).is_some())
            .then(|| {
                let mut unaliased = callable.clone();
                let signature = &mut unaliased.signature;
                for param in signature
                    .instance
                    .iter_mut()
                    .chain(&mut signature.parameters)
                    .chain([&mut signature.result])
                {
                    if let Some(ty) = self.record_alias(&param.ty) {
                        param.ty = ty;
                    }
                }
                unaliased
            })
    }

    /// `ts`, mapped for the type the alias `name` stands for, spelled by the
    /// alias where it is declared (`named_alias`) and the spelling is the
    /// form it is declared as: `GQuark` for `Uint32`, `Const<GtkAllocation>`
    /// for `Const<GdkRectangle>`. Not where the position changes the form --
    /// `AsNumber<BigInt64>` for a `GTimeSpan` passed, a `CBool`, a `CEnum` --
    /// which is not the alias's. The same type to TypeScript either way: an
    /// alias is transparent.
    fn spelled_as_alias(&mut self, name: &str, ts: String) -> String {
        let qualified = self.qualify(name);
        let Some((ns, local)) = qualified.split_once('.') else {
            return ts;
        };
        let repository: &'a Repository = self.repository;
        let Some(namespace) = repository.namespaces.get(ns) else {
            return ts;
        };
        let Some((alias, stands_for)) = namespace
            .aliases
            .iter()
            .find(|alias| alias.name == local)
            .and_then(|alias| named_alias(repository, namespace, alias))
        else {
            return ts;
        };
        let form = match stands_for {
            AliasOf::Scalar(brand) => brand,
            AliasOf::Record(record) => record,
        };
        let tokens: Vec<(usize, &str)> = super::naming::identifiers(&ts).collect();
        if !tokens.iter().any(|(_, token)| *token == form)
            || tokens
                .iter()
                .any(|(_, token)| matches!(*token, "AsNumber" | "CBool" | "CEnum"))
        {
            return ts;
        }
        let mut spelled = String::with_capacity(ts.len());
        let mut copied = 0;
        for (start, token) in tokens {
            if token == form {
                spelled.push_str(&ts[copied..start]);
                spelled.push_str(alias);
                copied = start + token.len();
            }
        }
        spelled.push_str(&ts[copied..]);
        if !std::ptr::eq(namespace, self.namespace) {
            self.binding
                .imports
                .entry(module_of(namespace))
                .or_default()
                .insert(alias.to_owned());
        }
        spelled
    }

    /// The C type of the class or record `qualified` names, where its handle
    /// is declared, for erasing to `void *`: a class's always, and a record's
    /// where the typed `T *` path would declare it -- a struct the headers
    /// tag, not a class struct.
    fn erased_handle(&self, qualified: &str) -> Option<(&'a Namespace, String)> {
        let repository: &'a Repository = self.repository;
        let (ns, local) = qualified.split_once('.')?;
        let namespace = repository.namespaces.get(ns)?;
        if let Some(class) = namespace.classes.iter().find(|c| c.name == local) {
            return Some((namespace, class.c_type.clone()?));
        }
        let c_type = namespace
            .records
            .iter()
            .find(|r| r.name == local)?
            .c_type
            .clone()?;
        (self.c_types.contains_key(c_type.as_str()) && self.facts.tags.contains_key(&c_type))
            .then_some((namespace, c_type))
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
            let (namespace, e) = self.enum_owner(namespace, e);
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
            return Some(Resolved::Enum(
                namespace,
                e,
                if signed { Scalar::Int } else { Scalar::UInt },
            ));
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
        let module = if namespace.name == self.namespace.name {
            String::new()
        } else {
            module_of(namespace)
        };
        (module, name)
    }

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn types(&mut self) {
        for class in &self.namespace.classes {
            let Some(c_type) = &class.c_type else {
                continue;
            };
            let Some(tag) = self.facts.tags.get(c_type).cloned() else {
                continue;
            };
            // An interface's base is the first class above it, and the
            // interfaces between are ones it implements.
            let (parent, implied) = if class.interface {
                self.interface_base(class)
            } else {
                (self.parent_of(class), Vec::new())
            };
            // The parent's methods come with it, from its own module.
            if let Some((module, name)) = &parent
                && !module.is_empty()
            {
                self.binding
                    .imports
                    .entry(module.clone())
                    .or_default()
                    .insert(format!("{name}Methods"));
                self.binding
                    .imports
                    .entry(module.clone())
                    .or_default()
                    .insert(format!("{name}Props"));
            }
            self.binding.brands.insert("Class");
            if let Some(get_type) = &class.get_type
                && class.interface
            {
                self.binding
                    .interface_types
                    .insert(c_type.clone(), get_type.clone());
            }
            if let Some(get_type) = &class.get_type
                && !class.interface
                && self.reaches_type_instance(class)
            {
                self.binding.functions.push(get_type_function(get_type));
                self.binding.brands.insert("c_size_t");
                self.binding.casts.push(Cast {
                    class: c_type.clone(),
                    get_type: get_type.clone(),
                });
                // A class `new GtkLabel({ … })` can make by its `GType`; its
                // own `new`, where that takes nothing, replaces this below.
                if !class.is_abstract && self.counted(self.namespace, class) {
                    match self.construct(class, c_type) {
                        Ok(view) => {
                            let constructor = Constructor {
                                function: view.name.clone(),
                                get_type: Some(get_type.clone()),
                                from: Vec::new(),
                                alternatives: Vec::new(),
                            };
                            self.binding
                                .constructors
                                .insert(c_type.clone(), constructor);
                            self.construct_with(class, c_type, &view.result);
                            self.binding.functions.push(view);
                        }
                        Err(reason) => self
                            .binding
                            .refused
                            .push((format!("{c_type}_construct"), reason)),
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
                    .map(|p| Accessor {
                        name: member(&p.name),
                        getter: p.getter.clone(),
                        setter: p.setter.clone(),
                    })
                    .collect(),
            );
            if counted {
                self.binding
                    .brands
                    .extend(["GObjectClass", "SignalMap", "Signalled"]);
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
            self.binding.types.push(TypeDecl::Class {
                name: c_type.clone(),
                tag,
                parent,
                counted,
                interface,
                implements,
                boxed: None,
            });
        }
        // Records are roots: nothing derives from one by GIR's account, and a
        // root `Class` is an opaque handle that can also anchor a chain, which
        // `GTypeInstance` has to.
        for record in self.namespace.records.iter().filter(|r| !r.class_struct) {
            let Some(c_type) = &record.c_type else {
                continue;
            };
            // A pointer record's handle is the struct its typedef points at.
            let Some(tag) = self
                .facts
                .tags
                .get(c_type)
                .or_else(|| self.facts.pointers.get(c_type).map(|p| &p.tag))
            else {
                continue;
            };
            if self.plain_struct(c_type).is_some()
                && let Some(fields) = self.struct_fields(record)
            {
                self.binding.brands.insert("Struct");
                self.binding.types.push(TypeDecl::Struct {
                    name: c_type.clone(),
                    tag: tag.clone(),
                    fields,
                });
                continue;
            }
            self.binding.brands.insert("Class");
            let boxed = self.boxed_record(c_type);
            // A boxed record's `GType`, which the compiler boxes and copies it
            // by (`nts_gobject_boxed`), and which `new` of one allocates by.
            if let Some((get_type, _)) = &boxed {
                self.binding.brands.extend(["Boxed", "c_size_t"]);
                self.binding.functions.push(get_type_function(get_type));
            }
            self.binding.types.push(TypeDecl::Class {
                name: c_type.clone(),
                tag: tag.clone(),
                parent: None,
                counted: false,
                interface: false,
                implements: Vec::new(),
                boxed,
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
            let Some((next_namespace, next)) = self.parent_class(namespace, at) else {
                break;
            };
            let Some(c_type) = next.c_type.clone() else {
                break;
            };
            if !next.interface {
                return (Some(self.reference(next_namespace, &c_type)), implied);
            }
            if let Some(tag) = self.facts.tags.get(&c_type).cloned() {
                let (module, local) = self.reference(next_namespace, &c_type);
                if !module.is_empty() {
                    self.binding
                        .imports
                        .entry(module)
                        .or_default()
                        .extend([format!("{local}Methods"), format!("{local}Props")]);
                }
                implied.push((local, tag));
            }
            (namespace, at) = (next_namespace, next);
        }
        (None, implied)
    }

    /// The interfaces `class`, of `namespace`, declares whose methods the
    /// binding merges into its own: an interface, tagged by the headers, and
    /// counted.
    fn merged_interfaces(
        &self,
        namespace: &'a Namespace,
        class: &'a Class,
    ) -> Vec<(&'a Namespace, &'a Class)> {
        class
            .implements
            .iter()
            .filter_map(|name| {
                let qualified = if name.contains('.') {
                    name.clone()
                } else {
                    format!("{}.{name}", namespace.name)
                };
                let Some(Resolved::Class(namespace, interface)) = self.resolve(&qualified) else {
                    return None;
                };
                let tagged = self.facts.tags.contains_key(interface.c_type.as_deref()?);
                (tagged && interface.interface && self.counted(namespace, interface))
                    .then_some((namespace, interface))
            })
            .collect()
    }

    /// Whether `class` has a method named `method` from elsewhere than its
    /// own callables: an ancestor's, or an interface's the binding merges into
    /// it or into an ancestor -- `GListStore`'s `get_n_items` is
    /// `GListModel`'s. A property's by-name method must not take that name
    /// (`INTERNAL_GET`): it would shadow the method GJS calls by it, which can
    /// be another thing entirely -- `GtkShortcutsShortcut`'s `direction`
    /// property is not `gtk_widget_get_direction`.
    fn inherits_method(&self, namespace: &'a Namespace, class: &'a Class, method: &str) -> bool {
        let named = |class: &Class| {
            class
                .callables
                .iter()
                .any(|callable| member(&callable.name) == method)
        };
        let mut interfaces = self.merged_interfaces(namespace, class);
        let mut at = self.parent_class(namespace, class);
        // Bounded, so a cycle in malformed GIR ends.
        for _ in 0..64 {
            if interfaces.iter().any(|(_, interface)| named(interface)) {
                return true;
            }
            let Some((namespace, class)) = at else {
                return false;
            };
            if named(class) {
                return true;
            }
            interfaces = self.merged_interfaces(namespace, class);
            at = self.parent_class(namespace, class);
        }
        false
    }

    /// The interfaces `class` declares, as the binding names them and as C
    /// tags them: `("GtkEditable", "_GtkEditable")`. Each one's methods are
    /// merged into the class's, from its own module. One the headers do not
    /// tag, or that is not a counted interface, is left out -- the class is
    /// then simply not seen to implement it.
    fn implements(&mut self, class: &'a Class) -> Vec<Implemented> {
        let mut found = Vec::new();
        for (namespace, interface) in self.merged_interfaces(self.namespace, class) {
            let Some(c_type) = interface.c_type.as_deref() else {
                continue;
            };
            let Some(tag) = self.facts.tags.get(c_type).cloned() else {
                continue;
            };
            let (module, local) = self.reference(namespace, c_type);
            if !module.is_empty() {
                self.binding
                    .imports
                    .entry(module)
                    .or_default()
                    .extend([format!("{local}Methods"), format!("{local}Props")]);
            }
            found.push((local, tag));
        }
        found
    }

    /// GJS's `new Gio.ThemedIcon({ name })`, for a class made by its
    /// `GType` (`made` is its result): a construct-only property has no
    /// setter, so it is given to `g_object_new` or never. Declared for the
    /// lowering to call in turn: `{C}_builder(type)` begins one
    /// (`nts_gobject_with_builder_new`), `{C}_with_{name}(builder, value)`
    /// gives each property the literal writes -- a thunk the backend
    /// defines, as it does a by-name setter, which hands the value on as C's
    /// varargs promote it (`nts_gobject_with_{kind}__{name}`) -- and
    /// `{C}_build` makes the object, owned or floating as the view's is. The
    /// class's own construct-only properties and its ancestors' in its
    /// namespace; one in another namespace would be mapped against this
    /// one's names, and is left out. Each whose type has no mapping is left
    /// out, and counted.
    fn construct_with(&mut self, class: &'a Class, c_type: &str, made: &Mapped) {
        let mut chain = vec![class];
        let mut at = self.parent_class(self.namespace, class);
        // Bounded, so a cycle in malformed GIR ends.
        for _ in 0..64 {
            let Some((namespace, ancestor)) = at else {
                break;
            };
            if !std::ptr::eq(namespace, self.namespace) {
                break;
            }
            chain.push(ancestor);
            at = self.parent_class(namespace, ancestor);
        }
        let builder = Mapped {
            shape: Shape::Other,
            ts: "Ptr<void>".to_owned(),
            c: Type::Pointer(Pointee::Void),
        };
        let mut own = Vec::new();
        let mut names = Vec::new();
        let mut withs = Vec::new();
        for (depth, declarer) in chain.iter().enumerate() {
            for property in &declarer.properties {
                let Some(param) = &property.constructed else {
                    continue;
                };
                let label = format!("{c_type}:{} (construct-only)", property.name);
                let param = self.with_c_type(&spelled_string(param, "const gchar*"));
                let value = match if is_string(&param) {
                    self.value(&param)
                } else {
                    self.typed(&param)
                } {
                    Ok(value) => self.truth(&param, value),
                    Err(reason) => {
                        self.binding.refused.push((label, reason));
                        continue;
                    }
                };
                let Some(kind) = value_kind(&value.c) else {
                    self.binding.refused.push((
                        label,
                        Reason::Unknown(format!("a property value of C type {:?}", value.c)),
                    ));
                    continue;
                };
                let ident = member(&property.name);
                if depth == 0 {
                    own.push((
                        ident.clone(),
                        value
                            .ts
                            .strip_suffix(" | null")
                            .unwrap_or(&value.ts)
                            .to_owned(),
                    ));
                }
                withs.push(plain_function(
                    format!("{c_type}_with_{ident}"),
                    format!(
                        "{CONSTRUCT_WITH}{kind}__{}",
                        property.name.replace('-', "_")
                    ),
                    vec![
                        ("builder".to_owned(), builder.clone()),
                        ("value".to_owned(), value),
                    ],
                    Mapped {
                        shape: Shape::Other,
                        ts: "void".to_owned(),
                        c: Type::Void,
                    },
                ));
                names.push(ident);
            }
        }
        if names.is_empty() {
            return;
        }
        self.binding.brands.extend(["Ptr", "c_size_t"]);
        let object_type = Mapped {
            shape: Shape::Other,
            ts: "c_size_t".to_owned(),
            c: Type::Scalar(Scalar::Size),
        };
        self.binding.functions.push(plain_function(
            format!("{c_type}_builder"),
            format!("{CONSTRUCT_WITH}builder_new"),
            vec![("object_type".to_owned(), object_type)],
            builder.clone(),
        ));
        self.binding.functions.extend(withs);
        self.binding.functions.push(plain_function(
            format!("{c_type}_build"),
            format!("{CONSTRUCT_WITH}builder_build"),
            vec![("builder".to_owned(), builder)],
            made.clone(),
        ));
        self.binding
            .constructed
            .insert(c_type.to_owned(), Constructed { own, names });
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
        let Some(TypeRef::Named {
            c_type: Some(c_type),
            ..
        }) = &class.first_field
        else {
            return None;
        };
        if c_type.contains('*') {
            return None;
        }
        let namespace = self.c_types.get(c_type.as_str()).copied()?;
        namespace
            .records
            .iter()
            .any(|r| r.c_type.as_deref() == Some(c_type))
            .then(|| self.reference(namespace, c_type))?
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
                        let owner = self
                            .repository
                            .namespaces
                            .values()
                            .find(|ns| ns.classes.iter().any(|c| std::ptr::eq(c, current)));
                        format!(
                            "{}.{parent}",
                            owner.map_or(self.namespace.name.as_str(), |ns| ns.name.as_str())
                        )
                    };
                    let Some(Resolved::Class(_, next)) = self.resolve(&qualified) else {
                        return false;
                    };
                    current = next;
                }
                None => {
                    return matches!(&current.first_field, Some(TypeRef::Named { c_type: Some(c), .. }) if c == "GTypeInstance");
                }
            }
        }
        false
    }

    /// The namespace that declares `e`, of `namespace`: its own, unless a
    /// namespace it includes declares the same C enum. `GObject`'s GIR
    /// registers `GLib`'s `GIOCondition` a second time, as `GObject.IOCondition`,
    /// and two declarations of one C enum are two unrelated types to a
    /// program that meets both. The included one owns it -- the header that
    /// defines it is its -- and the other refers to it.
    fn enum_owner(
        &self,
        namespace: &'a Namespace,
        e: &'a super::model::Enum,
    ) -> (&'a Namespace, &'a super::model::Enum) {
        let Some(c_type) = e.c_type.as_deref() else {
            return (namespace, e);
        };
        let mut pending: Vec<&str> = namespace
            .includes
            .iter()
            .map(|(name, _)| name.as_str())
            .collect();
        let mut seen: BTreeSet<&str> = BTreeSet::new();
        while let Some(name) = pending.pop() {
            if !seen.insert(name) {
                continue;
            }
            let Some(included) = self.repository.namespaces.get(name) else {
                continue;
            };
            if let Some(owned) = included
                .enums
                .iter()
                .find(|other| other.c_type.as_deref() == Some(c_type))
            {
                return self.enum_owner(included, owned);
            }
            pending.extend(included.includes.iter().map(|(name, _)| name.as_str()));
        }
        (namespace, e)
    }

    /// The namespace's integer constants whose value GIR states exactly and
    /// the fold holds exactly: within 2^53. Refused, since the fold would
    /// carry a different number with nothing to say so: an integer beyond
    /// 2^53 (`G_MAXINT64`), and every floating one, which GIR writes to six
    /// digits (`G_E` is `2.718282` there). And the strings and booleans,
    /// which `@ntsConstant` does not carry: as literal initializers, the
    /// module they are declared in is refused as one with code in it. Each
    /// is a row in the ledger, as everything left unbound is.
    fn constants(&mut self) {
        for constant in &self.namespace.constants {
            // A string is its literal type, spelled as `JSON.stringify` spells
            // it -- escapes TypeScript reads back as the same text.
            if matches!(constant.ty.as_str(), "utf8" | "filename") {
                self.binding.constants.push(ConstantDecl {
                    name: constant.c_name.clone(),
                    gir_name: constant.name.clone(),
                    ts: serde_json::Value::String(constant.value.clone()).to_string(),
                    value: None,
                });
                continue;
            }
            let Some((_, brand, _)) = SCALARS.iter().find(|(gir, _, scalar)| {
                *gir == constant.ty
                    && !matches!(scalar, Scalar::Float | Scalar::Double | Scalar::Size)
            }) else {
                let why = match constant.ty.as_str() {
                    "gfloat" | "gdouble" => {
                        format!("`{}`, a floating value GIR writes rounded", constant.value)
                    }
                    ty => format!("a `{ty}`, a type no constant is bound in yet"),
                };
                self.binding
                    .refused
                    .push((constant.c_name.clone(), Reason::Constant(why)));
                continue;
            };
            let Some(value) = exact_integer(&constant.value) else {
                let value = &constant.value;
                let why = if value.parse::<i128>().is_ok() {
                    format!("`{value}`, beyond the 2^53 a fold holds exactly")
                } else if matches!(value.as_str(), "true" | "false") {
                    "a boolean, which `@ntsConstant` does not carry".to_owned()
                } else {
                    format!("`{value}`, which is not an integer")
                };
                self.binding
                    .refused
                    .push((constant.c_name.clone(), Reason::Constant(why)));
                continue;
            };
            let ts = nts_core::hir::native::as_number(brand);
            self.binding.brands.insert(brand);
            if ts != *brand {
                self.binding.brands.insert("AsNumber");
            }
            self.binding.constants.push(ConstantDecl {
                name: constant.c_name.clone(),
                gir_name: constant.name.clone(),
                ts,
                value: Some(value),
            });
        }
        // The fundamental types, from the headers, each a `GType` as a
        // type's is: GJS's `GObject.TYPE_STRING`, which a list store's
        // `item_type` or a column's type takes.
        for name in super::FUNDAMENTAL_TYPES {
            if let Some(value) = self.facts.macros.get(*name) {
                self.binding.brands.insert("c_size_t");
                // GJS's `GObject.TYPE_STRING`: the macro without its prefix.
                let gir_name = name.strip_prefix("G_").unwrap_or(name).to_owned();
                self.binding.constants.push(ConstantDecl {
                    name: (*name).to_owned(),
                    gir_name,
                    ts: "c_size_t".to_owned(),
                    value: Some(value.to_string()),
                });
            }
        }
    }

    fn enums(&mut self) {
        for e in &self.namespace.enums {
            // Declared by a namespace this one includes: that one's.
            if !std::ptr::eq(self.enum_owner(self.namespace, e).0, self.namespace) {
                continue;
            }
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

    /// Each `<alias>` a program can name (`named_alias`), as the type it
    /// stands for.
    fn aliases(&mut self) {
        let namespace = self.namespace;
        for alias in &namespace.aliases {
            let Some((name, stands_for)) = named_alias(self.repository, namespace, alias) else {
                continue;
            };
            let ts = match stands_for {
                AliasOf::Scalar(brand) => {
                    self.binding.brands.insert(brand);
                    brand.to_owned()
                }
                AliasOf::Record(record) => {
                    let Some(owner) = self.c_types.get(record).copied() else {
                        continue;
                    };
                    self.name_in(owner, record)
                }
            };
            self.binding.aliases.push(AliasDecl {
                name: name.to_owned(),
                ts,
            });
        }
    }

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn function(
        &mut self,
        callable: &Callable,
        owner: Option<&'a Class>,
    ) -> Result<Function, Reason> {
        let symbol = bindable_symbol(callable)?;
        if symbol == CCLOSURE_EXPRESSION.0 {
            return self.cclosure_expression(callable, owner);
        }
        if self.facts.volatile.contains(&symbol) {
            return Err(Reason::Volatile);
        }
        let header = self.facts.prototypes.get(&symbol);
        // GIR decides what each parameter means; the header, its `const`.
        let qualified = header.map(|header| header_qualified(callable, header));
        let callable = qualified.as_ref().unwrap_or(callable);
        // And a record's alias is the record (`record_alias`).
        let unaliased = self.records_unaliased(callable);
        let callable = unaliased.as_ref().unwrap_or(callable);
        self.comparing_items = COMPARES_ITEMS.contains(&symbol.as_str());
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
        let lengths = in_lengths(signature);
        let byte_lengths = byte_lengths(signature);
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
            if let Some(mapped) = self.bytes_parameter(param, at, signature, &byte_lengths)? {
                c_parameters.push(mapped.c.clone());
                no_escape.push(identifier(&param.name));
                parameters.push((identifier(&param.name), mapped));
                continue;
            }
            if param.direction != Direction::In {
                let mapped = self.out(param)?;
                c_parameters.push(mapped.c.clone());
                no_escape.push(identifier(&param.name));
                omissible.extend(
                    self.omissible(param)
                        .map(|value| (identifier(&param.name), value)),
                );
                parameters.push((identifier(&param.name), mapped));
                continue;
            }
            if let Some((mapped, slots)) =
                self.callback_parameter(param, at, &signature.parameters)?
            {
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
        if let Some(CType::Function { result, .. }) = header
            && lends_writable_string(&signature.result, result)
        {
            return Err(Reason::LentWritableString);
        }
        let (result, free) = self.result_or_bytes(callable, owner)?;
        let raw_result_owned = signature.result.transfer == Transfer::Full
            && matches!(result.shape, Shape::Other)
            && matches!(&result.c, Type::Pointer(p) if matches!(p, Pointee::Void) || matches!(p, Pointee::Const(inner) if **inner == Pointee::Void));
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
        let statics = if method.is_none() {
            static_of(callable, owner)
        } else {
            None
        };
        Ok(Function {
            name: symbol.clone(),
            symbol,
            parameters,
            result,
            c_parameters,
            deprecated: callable.deprecated,
            free,
            raw_result_owned,
            no_escape,
            returns,
            method,
            throws,
            finish: callable.finish.clone(),
            omissible,
            method_only: false,
            statics,
            vfunc: None,
            gir_name: None,
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
        let TypeRef::Named { name, c_type } = &param.ty else {
            return None;
        };
        let pointer = c_type.as_deref().is_some_and(|c| c.contains('*'));
        let qualified = self.qualify(name);
        if qualified == "Gio.Cancellable" && pointer && param.nullable {
            return Some("null");
        }
        if name == "gint" && param.name == "io_priority" {
            return Some("0");
        }
        let (namespace, local) = qualified.split_once('.')?;
        let flags = self
            .repository
            .namespaces
            .get(namespace)?
            .enums
            .iter()
            .any(|e| e.name == local && e.flags);
        (flags && !pointer).then_some("0")
    }

    /// The result, and for a string the caller owns, what frees it.
    fn result(&mut self, result: &Param) -> Result<(Mapped, Option<String>), Reason> {
        match &result.ty {
            TypeRef::Named { name, .. } if name == "none" => Ok((
                Mapped {
                    shape: Shape::Other,
                    ts: "void".to_owned(),
                    c: Type::Void,
                },
                None,
            )),
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
                let c = if owned {
                    Type::Pointer(char)
                } else {
                    Type::Pointer(Pointee::Const(Box::new(char)))
                };
                let ts = if result.nullable {
                    "string | null"
                } else {
                    "string"
                };
                Ok((
                    Mapped {
                        shape: Shape::Other,
                        ts: ts.to_owned(),
                        c,
                    },
                    owned.then(|| "g_free".to_owned()),
                ))
            }
            TypeRef::Missing => Ok((
                Mapped {
                    shape: Shape::Other,
                    ts: "void".to_owned(),
                    c: Type::Void,
                },
                None,
            )),
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
    ///
    /// A record's `T *` is no slot but the storage itself, as the header's
    /// pointer depth says: a record the callee allocated would come back
    /// through a `T **`. So an out or inout `T *` is storage the caller
    /// gives, whatever GIR says of caller-allocates --
    /// `pango_extents_to_pixels` reads and rewrites the `PangoRectangle` the
    /// program gives it, `gsk_path_get_next` the `GskPathPoint`.
    fn out(&mut self, param: &Param) -> Result<Mapped, Reason> {
        if param.caller_allocates || self.record_storage(param) {
            return self.caller_allocated(param);
        }
        let TypeRef::Named { name, c_type } = &param.ty else {
            return Err(if let TypeRef::Array(array) = &param.ty {
                Reason::ArrayShape(format!(
                    "an out array (`{}`) written through no slot here",
                    array.element.as_deref().unwrap_or("?")
                ))
            } else {
                Reason::OutParameter
            });
        };
        if name == "utf8" || name == "filename" {
            // Only an optional one, which the caller leaves out (`omissible`):
            // C's `char **` exactly, for a caller that does pass a slot.
            if !param.optional {
                return Err(Reason::StringOut);
            }
            let constant = c_type
                .as_deref()
                .is_some_and(|c| c.trim_start().starts_with("const"));
            let char = Pointee::Scalar(Scalar::Char);
            let (ts, char) = if constant {
                (
                    "Ptr<ConstPtr<c_char>> | null",
                    Pointee::Const(Box::new(char)),
                )
            } else {
                ("Ptr<Ptr<c_char>> | null", char)
            };
            self.binding.brands.extend(["Ptr", "ConstPtr", "c_char"]);
            return Ok(Mapped {
                shape: Shape::Other,
                ts: ts.to_owned(),
                c: Type::Pointer(Pointee::Pointer(Box::new(char))),
            });
        }
        // The value's own C type, one `*` fewer than the parameter's.
        let Some(value_type) = c_type.as_deref().and_then(|c| c.strip_suffix('*')) else {
            return Err(Reason::OutParameter);
        };
        let value = Param {
            ty: TypeRef::Named {
                name: name.clone(),
                c_type: Some(value_type.trim_end().to_owned()),
            },
            direction: Direction::In,
            nullable: false,
            ..param.clone()
        };
        let mapped = if name == "gpointer" || name == "gconstpointer" {
            self.void_pointer(&value)?
        } else {
            self.typed(&value)?
        };
        let (slot, pointee, shape) = match mapped.c {
            Type::Scalar(scalar) => (
                mapped.ts.clone(),
                Pointee::Scalar(scalar),
                Shape::Out { value: mapped.ts },
            ),
            Type::Pointer(pointee) => (
                format!("{} | null", mapped.ts),
                Pointee::Pointer(Box::new(pointee)),
                Shape::Other,
            ),
            _ => return Err(Reason::OutParameter),
        };
        self.binding.brands.insert("Ptr");
        let ts = format!("Ptr<{slot}>");
        let ts = if param.optional {
            format!("{ts} | null")
        } else {
            ts
        };
        Ok(Mapped {
            shape,
            ts,
            c: Type::Pointer(pointee),
        })
    }

    /// An out parameter whose storage the caller allocates: for a boxed
    /// record the headers size, the record itself, which the program makes
    /// with `new GtkTextIter()` and C fills -- GJS returns it instead, through
    /// a values form. For one the headers keep opaque there is no storage a
    /// caller could allocate, so GIR can only mean the caller's own object:
    /// `hb_face_collect_unicodes(face, set)` fills a set `hb_set_create()`
    /// made, passed as the handle. For a plain record, a pointer to its
    /// `Struct`: storage the program makes, `local<PangoRectangle>()`, and
    /// reads once C has filled it. Anything else is refused.
    fn caller_allocated(&mut self, param: &Param) -> Result<Mapped, Reason> {
        if !matches!(param.ty, TypeRef::Named { .. }) {
            return Err(Reason::CallerAllocates);
        }
        // A storage the caller may leave out is `null` when it does:
        // `gdk_rectangle_intersect(a, b)` asks only whether they meet.
        let value = Param {
            direction: Direction::In,
            nullable: param.optional || param.nullable,
            optional: false,
            ..param.clone()
        };
        let storage = self.struct_storage(param);
        let mapped = self.typed(&value)?;
        if storage {
            return Ok(mapped);
        }
        let Shape::Handle { class, .. } = &mapped.shape else {
            return Err(Reason::CallerAllocates);
        };
        match self.boxed_record(class) {
            Some((_, size)) if size > 0 && param.direction == Direction::Out => {
                let class = class.clone();
                Ok(Mapped {
                    shape: Shape::Filled { class },
                    ..mapped
                })
            }
            Some(_) => Ok(mapped),
            None => Err(Reason::CallerAllocates),
        }
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
    fn array_parameter(
        &mut self,
        param: &Param,
        array: &ArrayRef,
        at: usize,
        parameters: &[Param],
    ) -> Result<Mapped, Reason> {
        let length = match array.length {
            Some(index) => {
                let side = if index == at + 1 {
                    "after"
                } else if index + 1 == at {
                    "before"
                } else {
                    return Err(Reason::Array("its length is not beside it"));
                };
                Some((
                    self.value(
                        parameters
                            .get(index)
                            .ok_or(Reason::Array("its length is not beside it"))?,
                    )?,
                    side,
                ))
            }
            None => None,
        };
        let element = array
            .element
            .as_deref()
            .ok_or(Reason::Array("GIR names no element type"))?;
        if param.transfer != Transfer::None {
            return Err(Reason::Array("its transfer is not none"));
        }
        let spelling: String = array
            .c_type
            .as_deref()
            .ok_or(Reason::Array("GIR names no C type"))?
            .split_whitespace()
            .collect();
        let char = Pointee::Scalar(Scalar::Char);
        let (ts, c, program) = match element {
            "utf8" | "filename" if array.zero_terminated || length.is_some() => {
                let (qualifier, c) = match spelling.replace("gchar", "char").as_str() {
                    "char**" => ("char", Type::Pointer(Pointee::Pointer(Box::new(char)))),
                    "constchar**" => (
                        "const",
                        Type::Pointer(Pointee::Pointer(Box::new(Pointee::Const(Box::new(char))))),
                    ),
                    "constchar*const*" => (
                        "const const",
                        Type::Pointer(Pointee::Const(Box::new(Pointee::Pointer(Box::new(
                            Pointee::Const(Box::new(char)),
                        ))))),
                    ),
                    _ => return Err(Reason::Array("strings in a spelling not lent here")),
                };
                self.binding.brands.insert("CStrings");
                (
                    format!("CStrings<\"{qualifier}\">"),
                    c,
                    "readonly string[]".to_owned(),
                )
            }
            // Bytes have no terminator to find their end by, so only with a
            // length. `guchar` is `uint8_t` on every target GLib runs on; the
            // self-check compiles the prototype against the header either way.
            "guint8" if length.is_some() => {
                let (qualifier, pointee) = match spelling.as_str() {
                    "constguint8*" | "constguchar*" => (
                        "const uint8_t",
                        Pointee::Const(Box::new(Pointee::Scalar(Scalar::UInt8))),
                    ),
                    "guint8*" | "guchar*" => ("uint8_t", Pointee::Scalar(Scalar::UInt8)),
                    "constgchar*" | "constchar*" => ("const char", Pointee::Const(Box::new(char))),
                    "gconstpointer" | "constvoid*" => {
                        ("const void", Pointee::Const(Box::new(Pointee::Void)))
                    }
                    "gpointer" | "void*" => ("void", Pointee::Void),
                    _ => return Err(Reason::Array("bytes in a spelling not lent here")),
                };
                self.binding.brands.insert("CBytes");
                (
                    format!("CBytes<\"{qualifier}\">"),
                    Type::Pointer(pointee),
                    "Uint8Array".to_owned(),
                )
            }
            _ if length.is_some() => match self.elements_parameter(element, &spelling) {
                Some(mapped) => mapped,
                None => self.handles_parameter(param, element, &spelling)?,
            },
            _ => return Err(Reason::Array("with no length beside it")),
        };
        let mut ts = ts;
        if let Some((count, side)) = length {
            self.binding.brands.insert("Counted");
            ts = format!("Counted<{ts}, {}, \"{side}\">", count.ts);
        }
        // `null` is NULL, with a count of 0 beside it where there is one.
        let mut program = program;
        if param.nullable {
            ts.push_str(" | null");
            program.push_str(" | null");
        }
        Ok(Mapped {
            shape: Shape::Lent { program },
            ts,
            c,
        })
    }

    /// An array of scalars C borrows for the call, with its length beside
    /// it -- `const gint *priorities` -- as `CElements<A, Q>` over the
    /// program's typed array, lent in place as `CBytes` is. Only the
    /// widths `CElements` names today; `gint64`/`guint64` (a
    /// `BigInt64Array`), `gboolean` and the `long`/`size_t` widths stay
    /// refused as not-a-class below, for the compiler to extend.
    /// `None` where the element is none of these.
    fn elements_parameter(
        &mut self,
        element: &str,
        spelling: &str,
    ) -> Option<(String, Type, String)> {
        let name = element.rsplit('.').next().unwrap_or(element);
        // GIR names the type `GLib.Quark`; the scalar table by its C name.
        let name = if name == "Quark" { "GQuark" } else { name };
        if name == "gboolean" {
            return None;
        }
        let scalar = SCALARS
            .iter()
            .find(|(gir, ..)| *gir == name)
            .map(|(_, _, scalar)| *scalar)?;
        let (typed_array, spelling_q) = match scalar {
            Scalar::Int8 => ("Int8Array", "int8_t"),
            Scalar::Int16 => ("Int16Array", "int16_t"),
            Scalar::UInt16 => ("Uint16Array", "uint16_t"),
            Scalar::Int | Scalar::Int32 => ("Int32Array", "int32_t"),
            Scalar::UInt | Scalar::UInt32 => ("Uint32Array", "uint32_t"),
            Scalar::Float => ("Float32Array", "float"),
            Scalar::Double => ("Float64Array", "double"),
            _ => return None,
        };
        let constant = spelling.starts_with("const");
        let (qualifier, pointee) = if constant {
            (
                format!("const {spelling_q}"),
                Pointee::Const(Box::new(Pointee::Scalar(scalar))),
            )
        } else {
            (spelling_q.to_owned(), Pointee::Scalar(scalar))
        };
        self.binding.brands.insert("CElements");
        Some((
            format!("CElements<{typed_array}, \"{qualifier}\">"),
            Type::Pointer(pointee),
            typed_array.to_owned(),
        ))
    }

    /// An array of objects C borrows for the call -- `GFile **files`, or
    /// `gpointer *additions` with GIR's element type -- as `CHandles<H, Q>`
    /// over the program's `readonly H[]`, whose element block already holds
    /// the pointers C reads: the compiler lends it in place. `Q` is `"void"`
    /// where C spells the array `gpointer *`. Only with a length, and only
    /// where GIR states the transfer as none: a borrow read into an array
    /// C keeps, or one whose elements it takes, would be wrong in the
    /// direction nothing reports.
    fn handles_parameter(
        &mut self,
        param: &Param,
        element: &str,
        spelling: &str,
    ) -> Result<(String, Type, String), Reason> {
        if !param.transfer_stated {
            return Err(Reason::Array("GIR does not state its transfer"));
        }
        let Some(Resolved::Class(_, class)) = self.resolve(&self.qualify(element)) else {
            return Err(Reason::ArrayShape(format!(
                "its element is not a class (`{element}`)"
            )));
        };
        let c_type = class
            .c_type
            .clone()
            .ok_or(Reason::Array("GIR names no C type"))?;
        let void = match spelling {
            "gpointer*" | "void**" => true,
            _ if spelling == format!("{c_type}**") => false,
            _ => return Err(Reason::Array("objects in a spelling not lent here")),
        };
        let value = Param {
            ty: TypeRef::Named {
                name: element.to_owned(),
                c_type: Some(format!("{c_type}*")),
            },
            direction: Direction::In,
            nullable: false,
            ..param.clone()
        };
        let mapped = self.typed(&value)?;
        let (Shape::Handle { .. }, Type::Pointer(pointee)) = (&mapped.shape, mapped.c) else {
            return Err(Reason::Array("its element is not a handle"));
        };
        let pointee = if void { Pointee::Void } else { pointee };
        self.binding.brands.insert("CHandles");
        let qualifier = if void { "void" } else { "element" };
        Ok((
            format!("CHandles<{}, \"{qualifier}\">", mapped.ts),
            Type::Pointer(Pointee::Pointer(Box::new(pointee))),
            format!("readonly {}[]", mapped.ts),
        ))
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
    fn returned_strings(
        result: &Param,
        array: &ArrayRef,
    ) -> Result<(Mapped, Option<String>), Reason> {
        let element = array
            .element
            .as_deref()
            .ok_or(Reason::Array("GIR names no element type"))?;
        if !(element == "utf8" || element == "filename")
            || !array.zero_terminated
            || array.length.is_some()
        {
            return Err(Reason::ArrayShape(format!(
                "returned (`{element}`, {}, {})",
                if array.zero_terminated {
                    "NULL-terminated"
                } else {
                    "not NULL-terminated"
                },
                if array.length.is_some() {
                    "with a length"
                } else {
                    "with no length"
                },
            )));
        }
        let spelling: String = array
            .c_type
            .as_deref()
            .ok_or(Reason::Array("GIR names no C type"))?
            .replace("gchar", "char")
            .replace("GStrv", "char**")
            .split_whitespace()
            .collect();
        let char = Pointee::Scalar(Scalar::Char);
        let (c, free) = match (result.transfer, spelling.as_str()) {
            (Transfer::Full, "char**") => (
                Type::Pointer(Pointee::Pointer(Box::new(char))),
                Some("g_strfreev".to_owned()),
            ),
            (Transfer::None, "constchar*const*") => (
                Type::Pointer(Pointee::Const(Box::new(Pointee::Pointer(Box::new(
                    Pointee::Const(Box::new(char)),
                ))))),
                None,
            ),
            _ => {
                return Err(Reason::Array(
                    "returned strings in a spelling not copied here",
                ));
            }
        };
        let ts = if result.nullable {
            "string[] | null"
        } else {
            "string[]"
        };
        Ok((
            Mapped {
                shape: Shape::Other,
                ts: ts.to_owned(),
                c,
            },
            free,
        ))
    }

    /// Bytes C returns, their length in the out slot `length`: C's own
    /// pointer, which the values form copies (`Shape::Bytes`), and frees where
    /// the transfer makes it the caller's.
    fn returned_bytes(
        &mut self,
        result: &Param,
        array: &ArrayRef,
        parameters: &[Param],
    ) -> Result<Mapped, Reason> {
        let length = array
            .length
            .and_then(|index| parameters.get(index))
            .map(|param| identifier(&param.name))
            .ok_or(Reason::Array("its length is not beside it"))?;
        let owned = match result.transfer {
            Transfer::None => false,
            Transfer::Full => true,
            Transfer::Container => return Err(Reason::Array("its transfer is the container only")),
        };
        let spelling: String = array
            .c_type
            .as_deref()
            .ok_or(Reason::Array("GIR names no C type"))?
            .split_whitespace()
            .collect();
        let (ts, pointee) = match spelling.as_str() {
            "gconstpointer" | "constvoid*" => (
                "ConstPtr<void> | null",
                Pointee::Const(Box::new(Pointee::Void)),
            ),
            "constguint8*" | "constguchar*" => (
                "ConstPtr<Uint8> | null",
                Pointee::Const(Box::new(Pointee::Scalar(Scalar::UInt8))),
            ),
            "guint8*" | "guchar*" => ("Ptr<Uint8> | null", Pointee::Scalar(Scalar::UInt8)),
            "gchar*" | "char*" => ("Ptr<c_char> | null", Pointee::Scalar(Scalar::Char)),
            _ => {
                return Err(Reason::Array(
                    "returned bytes in a spelling not copied here",
                ));
            }
        };
        self.binding
            .brands
            .extend(["Ptr", "ConstPtr", "Uint8", "c_char"]);
        Ok(Mapped {
            shape: Shape::Bytes { length, owned },
            ts: ts.to_owned(),
            c: Type::Pointer(pointee),
        })
    }

    /// The result, and what frees it: bytes C hands back (`returned_bytes`),
    /// or any other (`function_result`).
    fn result_or_bytes(
        &mut self,
        callable: &Callable,
        owner: Option<&'a Class>,
    ) -> Result<(Mapped, Option<String>), Reason> {
        let signature = &callable.signature;
        match &signature.result.ty {
            TypeRef::Array(array) if is_bytes(array) => Ok((
                self.returned_bytes(&signature.result, array, &signature.parameters)?,
                None,
            )),
            _ => self.function_result(callable, owner),
        }
    }

    /// An out parameter belonging to bytes C hands back: the bytes' slot
    /// (`out_bytes`), or the slot holding their length (`Shape::Length`).
    /// `None` for any other parameter.
    fn bytes_parameter(
        &mut self,
        param: &Param,
        at: usize,
        signature: &super::model::Signature,
        byte_lengths: &BTreeSet<usize>,
    ) -> Result<Option<Mapped>, Reason> {
        if param.direction == Direction::In {
            return Ok(None);
        }
        if let TypeRef::Array(array) = &param.ty
            && is_bytes(array)
        {
            let length = array
                .length
                .and_then(|index| signature.parameters.get(index))
                .ok_or(Reason::Array("its length is not beside it"))?;
            return self
                .out_bytes(param, array, &identifier(&length.name))
                .map(Some);
        }
        if byte_lengths.contains(&at) {
            let mapped = self.out(param)?;
            let Shape::Out { value } = mapped.shape else {
                return Err(Reason::Array("its length slot is not a plain value"));
            };
            return Ok(Some(Mapped {
                shape: Shape::Length { value },
                ..mapped
            }));
        }
        Ok(None)
    }

    /// An out slot C writes bytes' address into, their length in the out slot
    /// `length`: `Ptr<Ptr<c_char> | null>`, the `char **` C declares, which
    /// the values form makes, reads and copies (`Shape::Bytes`).
    fn out_bytes(
        &mut self,
        param: &Param,
        array: &ArrayRef,
        length: &str,
    ) -> Result<Mapped, Reason> {
        let owned = match param.transfer {
            Transfer::None => false,
            Transfer::Full => true,
            Transfer::Container => return Err(Reason::Array("its transfer is the container only")),
        };
        let spelling: String = array
            .c_type
            .as_deref()
            .ok_or(Reason::Array("GIR names no C type"))?
            .split_whitespace()
            .collect();
        let (ts, element) = match spelling.as_str() {
            "gchar**" | "char**" => ("Ptr<Ptr<c_char> | null>", Scalar::Char),
            "guint8**" | "guchar**" => ("Ptr<Ptr<Uint8> | null>", Scalar::UInt8),
            _ => return Err(Reason::Array("out bytes in a spelling not written here")),
        };
        self.binding.brands.extend(["Ptr", "Uint8", "c_char"]);
        Ok(Mapped {
            shape: Shape::Bytes {
                length: length.to_owned(),
                owned,
            },
            ts: ts.to_owned(),
            c: Type::Pointer(Pointee::Pointer(Box::new(Pointee::Scalar(element)))),
        })
    }

    /// An in parameter or an instance.
    fn value(&mut self, param: &Param) -> Result<Mapped, Reason> {
        if param.direction != Direction::In {
            return Err(Reason::OutParameter);
        }
        if let TypeRef::Named { name, .. } = &param.ty
            && (name == "utf8" || name == "filename")
        {
            let c_type = match &param.ty {
                TypeRef::Named { c_type, .. } => c_type.as_deref().unwrap_or_default(),
                _ => "",
            };
            // A string is one `*`. Behind more -- `const gchar *const *`, a
            // list GIR does not call an array, or `const gchar **`, a slot GIR
            // does not call out -- it is the raw pointer the header writes,
            // down to its `char`, as any pointer GIR leaves unannotated is.
            if c_type.matches('*').count() != 1 {
                return self
                    .raw_pointer("gchar", c_type)
                    .ok_or_else(|| Reason::PointerDepth(c_type.to_owned()));
            }
            if param.transfer != Transfer::None {
                return Err(Reason::OwnedString);
            }
            // `char *` without `const` is a buffer the callee may write into
            // (`g_strlcat`'s destination), which GIR still calls `utf8`. A
            // string lent for the call is read-only, and not that.
            if !c_type.starts_with("const ") {
                return Err(Reason::WritableBuffer);
            }
            return Ok(Mapped {
                shape: Shape::Other,
                ts: if param.nullable {
                    "string | null"
                } else {
                    "string"
                }
                .to_owned(),
                c: Type::Pointer(Pointee::Const(Box::new(Pointee::Scalar(Scalar::Char)))),
            });
        }
        // A pointer GIR leaves unannotated -- no direction, no array, no
        // caller-allocates -- deeper than the type it names is the C
        // vocabulary's raw pointer. Only where nothing else maps it, so a
        // later GIR annotation upgrades it by itself.
        match self.typed(param) {
            Err(Reason::PointerDepth(c_type)) if !param.caller_allocates => {
                let TypeRef::Named { name, .. } = &param.ty else {
                    return Err(Reason::PointerDepth(c_type));
                };
                self.raw_pointer(name, &c_type)
                    .ok_or(Reason::PointerDepth(c_type))
            }
            other => other,
        }
    }

    /// `c_type` as the raw pointer the header writes: `Ptr<…> | null` per
    /// `*`, `ConstPtr<…> | null` where that level's pointee is `const`, down
    /// to the first level this binder already maps -- a scalar by its brand
    /// (never `AsNumber`), an enum, a handle, a `Struct`'s `Ptr`, `void`.
    /// Owning nothing: no transfer applies. `None` where no level maps: a
    /// pointee the program cannot name (`FILE`), or a `volatile` one.
    fn raw_pointer(&mut self, name: &str, c_type: &str) -> Option<Mapped> {
        if c_type.split_whitespace().any(|word| word == "volatile") {
            return None;
        }
        let level = Param {
            name: String::new(),
            ty: TypeRef::Named {
                name: name.to_owned(),
                c_type: Some(c_type.to_owned()),
            },
            direction: Direction::In,
            transfer: Transfer::None,
            transfer_stated: false,
            // What a pointer points at may be NULL as readily as not.
            nullable: true,
            optional: false,
            caller_allocates: false,
            scope: None,
            closure: None,
            destroy: None,
        };
        match self.typed(&level) {
            Ok(mapped) => Some(self.raw_pointee(name, mapped)),
            Err(Reason::PointerDepth(_)) => {
                let star = c_type.rfind('*')?;
                let pointee = c_type[..star].trim_end();
                // `T * const *`: the level below is a const pointer.
                let (pointee, constant) = match pointee.strip_suffix("const") {
                    Some(rest) if rest.ends_with([' ', '*']) => (rest.trim_end(), true),
                    _ => (
                        pointee,
                        !pointee.contains('*') && pointee.trim_start().starts_with("const "),
                    ),
                };
                let inner = self.raw_pointer(name, pointee)?;
                let pointee = match inner.c {
                    Type::Scalar(scalar) => Pointee::Scalar(scalar),
                    Type::Pointer(pointee) => Pointee::Pointer(Box::new(pointee)),
                    _ => return None,
                };
                let (brand, pointee) = if constant {
                    ("ConstPtr", Pointee::Const(Box::new(pointee)))
                } else {
                    ("Ptr", pointee)
                };
                self.binding.brands.insert(brand);
                Some(Mapped {
                    shape: Shape::Other,
                    ts: format!("{brand}<{}> | null", inner.ts),
                    c: Type::Pointer(pointee),
                })
            }
            Err(_) => None,
        }
    }

    /// The innermost level of a raw pointer, as `typed` mapped it -- but a
    /// scalar by its brand, as a `Struct` member is: `AsNumber` is how a call
    /// hands a number over, not what memory holds.
    fn raw_pointee(&mut self, name: &str, mapped: Mapped) -> Mapped {
        if matches!(mapped.c, Type::Scalar(_)) {
            let target = self.alias_target(name).unwrap_or_else(|| name.to_owned());
            if let Some((_, brand, _)) = SCALARS.iter().find(|(gir, ..)| *gir == target) {
                self.binding.brands.insert(brand);
                return Mapped {
                    ts: self.spelled_as_alias(name, (*brand).to_owned()),
                    ..mapped
                };
            }
        }
        mapped
    }

    /// A raw address has no element type, handle ownership, or guessed release.
    /// GIR decides value nullability; the existing out-slot path adds nullable
    /// storage for the value before C writes it and optionality for the slot.
    fn void_pointer(&mut self, param: &Param) -> Result<Mapped, Reason> {
        let TypeRef::Named {
            c_type: Some(c_type),
            ..
        } = &param.ty
        else {
            return Err(Reason::Gpointer);
        };
        let compact: String = c_type.split_whitespace().collect();
        let (brand, pointee) = match compact.as_str() {
            "gpointer" | "void*" => ("Ptr", Pointee::Void),
            "gconstpointer" | "constvoid*" | "voidconst*" => {
                ("ConstPtr", Pointee::Const(Box::new(Pointee::Void)))
            }
            _ => return Err(Reason::PointerDepth(c_type.clone())),
        };
        self.binding.brands.insert(brand);
        Ok(Mapped {
            shape: Shape::Other,
            ts: format!(
                "{brand}<void>{}",
                if param.nullable { " | null" } else { "" }
            ),
            c: Type::Pointer(pointee),
        })
    }

    /// A scalar, enum, handle or record pointer -- the shapes that need no
    /// conversion at the call.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn typed(&mut self, param: &Param) -> Result<Mapped, Reason> {
        let (name, c_type) = match &param.ty {
            TypeRef::Named { name, c_type } => (name.as_str(), c_type.as_deref().unwrap_or("")),
            TypeRef::Array(_) => return Err(Reason::Array("in a position no array is lent")),
            TypeRef::Varargs => return Err(Reason::Varargs),
            TypeRef::Missing => return Err(Reason::Unknown("(no type)".to_owned())),
        };
        // An alias is the type it names -- `GLib.Quark` a `guint32` -- spelled
        // in C as the parameter says (`GQuark`), which the self-check compiles
        // against the header's typedef, and in TypeScript by its own name.
        if let Some(target) = self.alias_target(name) {
            let mut aliased = param.clone();
            if let TypeRef::Named { name, .. } = &mut aliased.ty {
                *name = target;
            }
            let mapped = self.typed(&aliased)?;
            let ts = self.spelled_as_alias(name, mapped.ts);
            return Ok(Mapped { ts, ..mapped });
        }
        // Raw addresses use the same exact pointer vocabulary in every
        // direction. The former `object` input already refused managed values
        // at lowering; spelling Ptr/ConstPtr makes that contract visible to TS.
        if name == "gpointer" || name == "gconstpointer" {
            return self.void_pointer(param);
        }
        // C99's `bool`, which GIR's scanner reports as `gboolean` -- an `int`
        // -- although the ABI is one byte. `c:type` says which it is.
        if c_type == "bool" || c_type == "_Bool" {
            return Ok(Mapped {
                shape: Shape::Other,
                ts: "boolean".to_owned(),
                c: Type::Bool,
            });
        }
        let depth = c_type.matches('*').count();
        // A scalar only where C passes one: `const guint8 *` is named `guint8`
        // by GIR too, and is a pointer to storage.
        if let Some((_, brand, scalar)) = SCALARS.iter().find(|(gir, ..)| *gir == name) {
            if depth != 0 {
                return Err(Reason::PointerDepth(c_type.to_owned()));
            }
            // A number, as GJS takes one -- a 64-bit size, length, offset or
            // handler id as `AsNumber<C>`, which is a `RangeError` past 2^53
            // where GJS rounds. `GType` is an identifier, not a quantity, and
            // keeps every bit as a `bigint`.
            if name == "GType" {
                self.binding.brands.insert(brand);
                return Ok(Mapped {
                    shape: Shape::Other,
                    ts: (*brand).to_owned(),
                    c: Type::Scalar(*scalar),
                });
            }
            let ts = nts_core::hir::native::as_number(brand);
            self.binding.brands.insert(brand);
            if ts != *brand {
                self.binding.brands.insert("AsNumber");
            }
            return Ok(Mapped {
                shape: Shape::Other,
                ts,
                c: Type::Scalar(*scalar),
            });
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
        // `out` rewrites an out parameter's slot to `In`.) A record's handle
        // too (`g_type_class_ref`'s `GTypeClass`), and as `gconstpointer`,
        // `Const<Erased<GBytes>>` and `const void *` (`g_bytes_equal`).
        if matches!(c_type, "gpointer" | "gconstpointer")
            && let Some((namespace, handle_type)) = self.erased_handle(&qualified)
        {
            let local = self.name_in(namespace, &handle_type);
            self.binding.brands.insert("Erased");
            let erased = format!("Erased<{local}>");
            let (ts, pointee) = if c_type == "gconstpointer" {
                self.binding.brands.insert("Const");
                (
                    format!("Const<{erased}>"),
                    Pointee::Const(Box::new(Pointee::Void)),
                )
            } else {
                (erased, Pointee::Void)
            };
            let ts = if param.nullable {
                format!("{ts} | null")
            } else {
                ts
            };
            let shape = if param.direction == Direction::In {
                Shape::Other
            } else {
                Shape::Handle {
                    class: local,
                    nullable: param.nullable,
                }
            };
            return Ok(Mapped {
                shape,
                ts,
                c: Type::Pointer(pointee),
            });
        }
        // A pointer record's typedef holds the `*` itself: spelled bare it is
        // the handle, as `T *` is any other record's, `const` where its
        // typedef points `const` -- `hb_language_t` is `Const<hb_language_t>`.
        // `hb_language_t *` is a pointer to one, which an out slot reaches here
        // bare and nothing else does.
        if depth == 0
            && let Some(pointer) = self.facts.pointers.get(base).cloned()
            && let Some(namespace) = self.c_types.get(base).copied()
        {
            let local = self.name_in(namespace, base);
            return Ok(self.handle(local, &pointer.tag, pointer.constant, param.nullable));
        }
        // A plain record's pointer points at its `Struct`, which the program
        // reads and writes through: `Ptr<PangoRectangle>`, and `ConstPtr<…>`
        // where C points `const`.
        if depth == 1
            && let Some((namespace, _)) = self.plain_struct(base)
            && let Some(tag) = self.facts.tags.get(base).cloned()
        {
            let local = self.name_in(namespace, base);
            return Ok(self.struct_pointer(&local, &tag, constant, param.nullable));
        }
        if depth == 1
            && let Some(namespace) = self.c_types.get(base).copied()
        {
            let tag = self
                .facts
                .tags
                .get(base)
                .cloned()
                .ok_or_else(|| Reason::NoTag(base.to_owned()))?;
            let local = self.name_in(namespace, base);
            return Ok(self.handle(local, &tag, constant, param.nullable));
        }
        match self.resolve(&qualified) {
            Some(Resolved::Enum(namespace, e, scalar)) if depth == 0 => {
                let brand = if scalar == Scalar::Int {
                    "c_int"
                } else {
                    "c_uint"
                };
                self.binding.brands.insert(brand);
                // `CEnum<GtkOrientation, c_uint>`, so the enum's members pass
                // without a cast; by its C name, which `enums` declares beside
                // the enum as an alias, since two namespaces can share a short one.
                let ts = match e
                    .c_type
                    .as_deref()
                    .filter(|c| is_type_name(c) && *c != e.name)
                {
                    Some(c_type) => {
                        self.binding.brands.insert("CEnum");
                        if namespace.name != self.namespace.name {
                            self.binding
                                .imports
                                .entry(module_of(namespace))
                                .or_default()
                                .insert(c_type.to_owned());
                        }
                        format!("CEnum<{c_type}, {brand}>")
                    }
                    None => brand.to_owned(),
                };
                Ok(Mapped {
                    shape: Shape::Other,
                    ts,
                    c: Type::Scalar(scalar),
                })
            }
            Some(Resolved::Record) if depth == 0 => Err(Reason::RecordByValue),
            Some(Resolved::Callback(_)) => Err(Reason::CallbackShape(
                "closure data is not annotated where it is passed",
            )),
            Some(_) => Err(Reason::PointerDepth(c_type.to_owned())),
            None => Err(Reason::Unknown(qualified)),
        }
    }

    /// A signal's handler parameters as TypeScript declares them -- `self`
    /// first -- and as the `emit` form takes them (`SignalParameters`).
    ///
    /// `self` is `this`, the receiver the program connected on, as GJS hands
    /// it over: `action.connect("notify::state", (action) => action.state)`
    /// reads a `GSimpleAction`, where the class declaring `notify` is
    /// `GObject`. A signal's view is only ever a method (`method_only`), so
    /// `this` always has a receiver to name.
    fn signal_parameters(
        &mut self,
        signal: &super::model::Signal,
    ) -> Result<SignalParameters, Reason> {
        let mut ts_parameters = vec!["self: this".to_owned()];
        let mut emitted = Vec::new();
        // GIR gives a signal's parameters no C type; each spelled from its
        // name, for an array's length to be read at.
        let spelled: Vec<Param> = signal
            .signature
            .parameters
            .iter()
            .map(|param| self.with_c_type(param))
            .collect();
        // An array's length rides in its array (`Counted`), not as a
        // parameter of its own.
        let lengths: Vec<usize> = signal
            .signature
            .parameters
            .iter()
            .filter_map(|param| match &param.ty {
                TypeRef::Array(array) => array.length,
                _ => None,
            })
            .collect();
        for (at, param) in signal.signature.parameters.iter().enumerate() {
            if lengths.contains(&at) {
                continue;
            }
            // A slot the handler writes -- `GtkSpinButton::input`'s `gdouble
            // *new_value`, `GtkOverlay::get-child-position`'s caller-allocated
            // rectangle, `GtkEditable::insert-text`'s `gint *position`. GIR
            // gives a signal's parameters no C type, so the one `with_c_type`
            // spells from the name has no `*`: the handler was declared taking
            // a `double` where C passes a pointer, and a boxed one was copied,
            // so whatever it wrote never reached C. Refused until a handler
            // can answer them, as GJS's returns them. The rule behind it: a
            // signal parameter's missing `c:type` is unknown, not a default --
            // what `with_c_type` spells is a guess that holds only for `in`.
            if param.direction != Direction::In {
                return Err(Reason::OutParameter);
            }
            // A UTF-8 string GLib passes the handler, lent for the call: the
            // handler's bridge copies it (`native::abi_type`). A `filename`
            // is in the file system's encoding, which a `string` is not.
            if matches!(&param.ty, TypeRef::Named { name, .. } if name == "utf8") {
                let ts = if param.nullable {
                    "string | null"
                } else {
                    "string"
                };
                ts_parameters.push(format!("{}: {ts}", identifier(&param.name)));
                let c = Type::Pointer(Pointee::Const(Box::new(Pointee::Scalar(Scalar::Char))));
                emitted.push((
                    identifier(&param.name),
                    Mapped {
                        shape: Shape::Other,
                        ts: ts.to_owned(),
                        c,
                    },
                ));
                continue;
            }
            if matches!(&param.ty, TypeRef::Named { name, .. } if name == "filename") {
                return Err(Reason::StringInCallback);
            }
            // An array of objects and its length: `GApplication::open`'s
            // `GFile **files, gint n_files`. GIR spells it `gpointer`, the
            // value the signal marshals; the handler is passed the array's
            // address, `gpointer *`, which is what the bridge declares.
            if let TypeRef::Array(array) = &param.ty {
                let array = super::model::ArrayRef {
                    c_type: Some("gpointer*".to_owned()),
                    ..array.clone()
                };
                let mapped = self.array_parameter(param, &array, at, &spelled)?;
                ts_parameters.push(format!("{}: {}", identifier(&param.name), mapped.ts));
                emitted.push((identifier(&param.name), mapped));
                continue;
            }
            let param = self.with_c_type(param);
            let mapped = self.typed(&param)?;
            let mapped = self.truth(&param, mapped);
            ts_parameters.push(format!("{}: {}", identifier(&param.name), mapped.ts));
            emitted.push((identifier(&param.name), mapped));
        }
        Ok((ts_parameters, emitted))
    }

    /// `gtk_cclosure_expression_new`, as GJS's `new Gtk.ClosureExpression(type,
    /// fn, null)` makes one: a value type and a function of the evaluated
    /// `this`, called as `nts_gtk_cclosure_expression_new` (`nts_gtk.h`), which
    /// passes `GLib`'s generic marshaller and no parameter expressions.
    ///
    /// A named exception, because GIR cannot say what the callback is: it
    /// types it `GCallback`, taking nothing, where the marshaller calls it with
    /// the `this` and then the user data -- a signal handler's shape, and so
    /// the same `ErasedClosure` a `connect` takes, with the same destroy
    /// function. The marshaller takes over what the function answers
    /// (`g_value_take_string`), so the bridge answers it owned
    /// (`native::owned_string`). A string is the one answer typed until a port
    /// needs another.
    fn cclosure_expression(
        &mut self,
        callable: &Callable,
        owner: Option<&'a Class>,
    ) -> Result<Function, Reason> {
        if !self
            .binding
            .headers
            .iter()
            .any(|header| header == nts_codegen_c::GTK_HEADER_NAME)
        {
            self.binding
                .headers
                .push(nts_codegen_c::GTK_HEADER_NAME.to_owned());
        }
        let value_type = callable
            .signature
            .parameters
            .first()
            .ok_or(Reason::CallbackShape("no value type"))?;
        let (value, _) = self.plain(value_type)?;
        let objects = self
            .repository
            .namespaces
            .get("GObject")
            .ok_or_else(|| Reason::Unknown("GObject".to_owned()))?;
        let (_, object) = self.reference(objects, "GObject");
        let (_, gclosure) = self.reference(objects, "GClosure");
        let closure_tag = self
            .facts
            .tags
            .get("GClosure")
            .cloned()
            .ok_or_else(|| Reason::NoTag("GClosure".to_owned()))?;
        self.binding.brands.extend(["ErasedClosure", "Ptr"]);
        let context = Type::Pointer(Pointee::Void);
        let erased = Type::FnPointer(std::sync::Arc::new(FnPointer::spell(
            Vec::new(),
            Type::Void,
        )));
        let notify = Type::FnPointer(std::sync::Arc::new(FnPointer::spell(
            vec![
                context.clone(),
                Type::Pointer(Pointee::Opaque(Handle::from(closure_tag))),
            ],
            Type::Void,
        )));
        let callback = Mapped {
            shape: Shape::Other,
            ts: format!(
                "ErasedClosure<(this_: {object} | null) => string | null, (data: Ptr<void>, closure: {gclosure}) => void>"
            ),
            c: erased.clone(),
        };
        let (result, free) = self.result_or_bytes(callable, owner)?;
        let c_parameters = vec![value.c.clone(), erased, context, notify];
        Ok(Function {
            name: CCLOSURE_EXPRESSION.0.to_owned(),
            symbol: CCLOSURE_EXPRESSION.1.to_owned(),
            parameters: vec![
                ("value_type".to_owned(), value),
                ("callback".to_owned(), callback),
            ],
            result,
            c_parameters,
            deprecated: callable.deprecated,
            free,
            raw_result_owned: false,
            no_escape: Vec::new(),
            returns: self.constructed(callable),
            method: None,
            throws: None,
            finish: None,
            omissible: BTreeMap::new(),
            method_only: false,
            statics: static_of(callable, owner),
            vfunc: None,
            gir_name: None,
        })
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
    ///
    /// With it, the view `emit`: `button.emit("clicked")`, GJS's spelling,
    /// the signal's parameters after its name, answering the handlers'
    /// result where that is a number or a boolean -- `keys.emit("key-pressed",
    /// ...)` is whether one handled it. A signal answering a pointer has none.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn signal(
        &mut self,
        class: &'a Class,
        signal: &super::model::Signal,
    ) -> Result<(Function, Option<Function>), Reason> {
        let c_type = class
            .c_type
            .clone()
            .ok_or_else(|| Reason::Unknown(class.name.clone()))?;
        if !self
            .binding
            .headers
            .iter()
            .any(|header| header == nts_codegen_c::GOBJECT_HEADER_NAME)
        {
            self.binding
                .headers
                .push(nts_codegen_c::GOBJECT_HEADER_NAME.to_owned());
        }
        // `self: GtkButton` names the class's handle, which exists only for a
        // tagged struct.
        if !self.facts.tags.contains_key(&c_type) {
            return Err(Reason::NoTag(c_type));
        }
        let prefix = class.symbol_prefix.as_deref().ok_or(Reason::NoSymbol)?;
        let local = c_type.clone();
        self.binding
            .brands
            .extend(["Erased", "ErasedClosure", "c_uint", "c_ulong", "AsNumber"]);
        let (ts_parameters, emitted) = self.signal_parameters(signal)?;
        let result = match &signal.signature.result.ty {
            TypeRef::Named { name, .. } if name == "none" => Mapped {
                shape: Shape::Other,
                ts: "void".to_owned(),
                c: Type::Void,
            },
            TypeRef::Named { name, .. } if name == "utf8" || name == "filename" => {
                return Err(Reason::StringInCallback);
            }
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
        let erased = Type::FnPointer(std::sync::Arc::new(FnPointer::spell(
            Vec::new(),
            Type::Void,
        )));
        // `GClosureNotify`: `void (*)(gpointer, GClosure *)`, which the header
        // declares exactly and the self-check compares.
        let closure_tag = self
            .facts
            .tags
            .get("GClosure")
            .cloned()
            .ok_or_else(|| Reason::NoTag("GClosure".to_owned()))?;
        let closure = Type::Pointer(Pointee::Opaque(Handle::from(closure_tag)));
        let notify = Type::FnPointer(std::sync::Arc::new(FnPointer::spell(
            vec![context.clone(), closure],
            Type::Void,
        )));
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
        let connect = Function {
            name,
            symbol: CONNECT.to_owned(),
            parameters: vec![
                (
                    "instance".to_owned(),
                    Mapped {
                        shape: Shape::Other,
                        ts: format!("Erased<{local}>"),
                        c: context.clone(),
                    },
                ),
                (
                    "detailed_signal".to_owned(),
                    Mapped {
                        shape: Shape::Other,
                        ts: detailed_name(signal),
                        c: string.clone(),
                    },
                ),
                (
                    "handler".to_owned(),
                    Mapped {
                        shape: Shape::Other,
                        ts: format!(
                            "ErasedClosure<({}) => {}, (data: Ptr<void>, closure: {gclosure}) => void>",
                            ts_parameters.join(", "),
                            result.ts
                        ),
                        c: erased.clone(),
                    },
                ),
                (
                    "connect_flags".to_owned(),
                    Mapped {
                        shape: Shape::Other,
                        ts: "c_uint".to_owned(),
                        c: Type::Scalar(Scalar::UInt),
                    },
                ),
            ],
            // A handler id, a number as GJS returns it, which
            // `g_signal_handler_disconnect` takes back.
            result: Mapped {
                shape: Shape::Other,
                ts: "AsNumber<c_ulong>".to_owned(),
                c: Type::Scalar(Scalar::ULong),
            },
            c_parameters: vec![
                context.clone(),
                string,
                erased,
                context,
                notify,
                Type::Scalar(Scalar::UInt),
            ],
            deprecated: false,
            free: None,
            raw_result_owned: false,
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
            vfunc: None,
            gir_name: None,
        };
        // What an emit answers: nothing, or a number or a boolean -- the
        // handlers' answer through the location `g_signal_emit` writes. A
        // pointer would come back with an ownership nothing here says, so a
        // signal answering one has no `emit`.
        if result.c != Type::Void && value_kind(&result.c).is_none_or(|kind| kind == 'p') {
            return Ok((connect, None));
        }
        let emit = emit_view(&connect, &signal.name, emitted, result);
        Ok((connect, Some(emit)))
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
                    .or_else(|| {
                        namespace
                            .records
                            .iter()
                            .find(|r| r.name == local)
                            .and_then(|r| r.c_type.clone())
                    });
                *c_type = pointer.map(|c| format!("{c}*")).or_else(|| {
                    namespace
                        .enums
                        .iter()
                        .find(|e| e.name == local)
                        .and_then(|e| e.c_type.clone())
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
    fn function_result(
        &mut self,
        callable: &Callable,
        owner: Option<&'a Class>,
    ) -> Result<(Mapped, Option<String>), Reason> {
        let (result, free) = self.result(&callable.signature.result)?;
        let result = match owner {
            Some(class) if callable.kind == CallableKind::Constructor => {
                self.declared(result, class)
            }
            _ => result,
        };
        let result = self.truth(&callable.signature.result, result);
        Ok((
            self.owned(result, callable.signature.result.transfer == Transfer::Full),
            free,
        ))
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
        Mapped {
            ts: "CBool<c_int>".to_owned(),
            ..mapped
        }
    }

    /// A parameter passed as it is -- a scalar, an enum, a handle -- with what
    /// it hands over (`Consumed`) and what stands for leaving it out.
    fn plain(&mut self, param: &Param) -> Result<(Mapped, Option<&'static str>), Reason> {
        let value = self.value(param)?;
        let value = self.truth(param, value);
        // A boxed record C takes over would be freed twice: by C, and by the
        // box the program holds it in.
        if param.transfer == Transfer::Full
            && let Shape::Handle { class, .. } = &value.shape
            && self.boxed_record(class).is_some()
        {
            return Err(Reason::BoxedTakenOver);
        }
        Ok((
            self.handed_over(value, param.transfer == Transfer::Full),
            self.omissible(param),
        ))
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
        let Shape::Handle { class, nullable } = &mapped.shape else {
            return mapped;
        };
        // A boxed record handed over is the box's to free: `Owned`, as a
        // counted handle is. (A boxed record C takes over is refused before
        // here, in `plain`.)
        let boxed = brand == "Owned" && self.boxed_record(class).is_some();
        if !full
            || matches!(mapped.c, Type::Pointer(Pointee::Const(_)))
            || !(self.counted_c_type(class) || boxed)
        {
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
    fn parent_class(
        &self,
        namespace: &'a Namespace,
        class: &'a Class,
    ) -> Option<(&'a Namespace, &'a Class)> {
        if let Some(parent) = &class.parent {
            let qualified = if parent.contains('.') {
                parent.clone()
            } else {
                format!("{}.{parent}", namespace.name)
            };
            return match self.resolve(&qualified) {
                Some(Resolved::Class(namespace, parent)) => Some((namespace, parent)),
                _ => None,
            };
        }
        if !class.interface {
            return None;
        }
        let prerequisite = class
            .c_type
            .as_deref()
            .and_then(|c| self.facts.prerequisites.get(c))?;
        let namespace = self.c_types.get(prerequisite.as_str()).copied()?;
        let parent = namespace
            .classes
            .iter()
            .find(|c| c.c_type.as_deref() == Some(prerequisite.as_str()))?;
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
            let Some(parent) = self.parent_class(namespace, class) else {
                return false;
            };
            (namespace, class) = parent;
        }
        false
    }

    /// [`Self::counted`] for a handle named by its C type, from any namespace.
    /// A `GLib` boxed record's `GType` function and size (0 where the headers
    /// keep the struct opaque), by its C type, from whichever namespace
    /// declares it. `None` for anything else.
    fn boxed_record(&self, c_type: &str) -> Option<(String, u64)> {
        let namespace = self.c_types.get(c_type).copied()?;
        let record = namespace
            .records
            .iter()
            .find(|r| !r.class_struct && r.c_type.as_deref() == Some(c_type))?;
        // `intern` is GIR's word for a type GLib registers itself, with no
        // function to name.
        let get_type = record
            .get_type
            .clone()
            .filter(|name| name != "intern" && self.facts.declared.contains(name))?;
        Some((get_type, self.facts.sizes.get(c_type).copied().unwrap_or(0)))
    }

    fn counted_c_type(&self, c_type: &str) -> bool {
        let Some(namespace) = self.c_types.get(c_type).copied() else {
            return false;
        };
        namespace
            .classes
            .iter()
            .find(|class| class.c_type.as_deref() == Some(c_type))
            .is_some_and(|class| self.counted(namespace, class))
    }

    /// What a constructor returns, as GIR names it (`Gtk.Button`), where C's
    /// type may be an ancestor's.
    fn constructed(&self, callable: &Callable) -> Option<String> {
        match &callable.signature.result.ty {
            TypeRef::Named { name, .. } if callable.kind == CallableKind::Constructor => {
                Some(self.qualify(name))
            }
            _ => None,
        }
    }

    /// A typed view of `g_object_new_with_properties` for one class:
    ///
    /// ```text
    /// GtkLabel_construct(object_type: c_size_t, n_properties?: c_uint,
    ///     names?: Ptr<ConstPtr<c_char>> | null, values?: Const<GValue> | null): Declared<GtkLabel, `GObject`>
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
        let tag = |name: &str| {
            self.facts
                .tags
                .get(name)
                .cloned()
                .ok_or_else(|| Reason::NoTag(name.to_owned()))
        };
        let (object_tag, value_tag) = (tag("GObject")?, tag("GValue")?);
        let object = self.name_in(objects, "GObject");
        let value = self.name_in(objects, "GValue");
        let result = self.handle(object, &object_tag, false, false);
        let result = self.declared(result, class);
        let floating = self.descends(self.namespace, class, "GInitiallyUnowned");
        let result = self.owned(result, !floating);
        let char = Pointee::Scalar(Scalar::Char);
        self.binding
            .brands
            .extend(["Ptr", "ConstPtr", "c_char", "c_size_t", "c_uint"]);
        let parameters = vec![
            (
                "object_type".to_owned(),
                Mapped {
                    shape: Shape::Other,
                    ts: "c_size_t".to_owned(),
                    c: Type::Scalar(Scalar::Size),
                },
            ),
            (
                "n_properties".to_owned(),
                Mapped {
                    shape: Shape::Other,
                    ts: "c_uint".to_owned(),
                    c: Type::Scalar(Scalar::UInt),
                },
            ),
            (
                "names".to_owned(),
                Mapped {
                    shape: Shape::Other,
                    ts: "Ptr<ConstPtr<c_char>> | null".to_owned(),
                    c: Type::Pointer(Pointee::Pointer(Box::new(Pointee::Const(Box::new(char))))),
                },
            ),
            (
                "values".to_owned(),
                self.handle(value, &value_tag, true, true),
            ),
        ];
        Ok(Function {
            name: format!("{c_type}_construct"),
            symbol: "g_object_new_with_properties".to_owned(),
            c_parameters: parameters
                .iter()
                .map(|(_, mapped)| mapped.c.clone())
                .collect(),
            parameters,
            result,
            deprecated: false,
            free: None,
            raw_result_owned: false,
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
            vfunc: None,
            gir_name: None,
        })
    }

    /// A constructor's result as the class GIR says it returns, where C
    /// declares one of that class's ancestors: `gtk_box_new`'s `GtkWidget *`
    /// is `Declared<GtkBox, GtkWidget>`, so `box.append(…)` needs no downcast.
    /// GIR's word is trusted, as gtk-rs trusts it; anything else -- the same
    /// class, or one GIR does not say descends from C's -- is left as C has it.
    fn declared(&mut self, result: Mapped, class: &'a Class) -> Mapped {
        let Shape::Handle {
            class: declared,
            nullable,
        } = result.shape.clone()
        else {
            return result;
        };
        let namespace = self.namespace;
        let Some(c_type) = class.c_type.as_deref() else {
            return result;
        };
        if c_type == declared
            || !self.facts.tags.contains_key(c_type)
            || !self.descends(namespace, class, &declared)
        {
            return result;
        }
        let local = self.name_in(namespace, c_type);
        self.binding.brands.insert("Declared");
        let ts = format!(
            "Declared<{local}, {declared}>{}",
            if nullable { " | null" } else { "" }
        );
        Mapped {
            shape: Shape::Handle {
                class: local,
                nullable,
            },
            ts,
            c: result.c,
        }
    }

    /// Whether GIR says `class` descends from the class C calls `ancestor`.
    fn descends(&self, namespace: &'a Namespace, class: &'a Class, ancestor: &str) -> bool {
        let (mut namespace, mut class) = (namespace, class);
        // Bounded, so a cycle in malformed GIR ends.
        for _ in 0..64 {
            let Some((next_namespace, next)) = self.parent_class(namespace, class) else {
                return false;
            };
            if next.c_type.as_deref() == Some(ancestor) {
                return true;
            }
            (namespace, class) = (next_namespace, next);
        }
        false
    }

    /// Whether `param`'s header type is one `*` on a record's C type: the
    /// record's storage, which a callee-allocated record's `T **` is not. A
    /// pointer record's typedef holds a `*` of its own (`hb_language_t`), so
    /// its `T *` is that `T **`: a slot, and no storage.
    fn record_storage(&self, param: &Param) -> bool {
        let TypeRef::Named {
            c_type: Some(c_type),
            ..
        } = &param.ty
        else {
            return false;
        };
        let base = pointee_of(c_type);
        c_type.matches('*').count() == 1
            && self.c_types.get(base).is_some_and(|namespace| {
                namespace
                    .records
                    .iter()
                    .any(|r| !r.class_struct && !r.pointer && r.c_type.as_deref() == Some(base))
            })
    }

    /// Whether `param` is a pointer to a plain record's storage: one `*` on a
    /// `Struct`'s C type.
    fn struct_storage(&self, param: &Param) -> bool {
        matches!(
            &param.ty,
            TypeRef::Named { c_type: Some(c_type), .. }
                if c_type.matches('*').count() == 1 && self.plain_struct(pointee_of(c_type)).is_some()
        )
    }

    /// A pointer to a plain record's `Struct`: `Ptr<PangoRectangle>`, or
    /// `ConstPtr<…>`. To C the same `struct _PangoRectangle *` a handle is.
    fn struct_pointer(&mut self, local: &str, tag: &str, constant: bool, nullable: bool) -> Mapped {
        let pointee = Pointee::Opaque(Handle::from(tag));
        let (brand, pointee) = if constant {
            ("ConstPtr", Pointee::Const(Box::new(pointee)))
        } else {
            ("Ptr", pointee)
        };
        self.binding.brands.insert(brand);
        Mapped {
            shape: Shape::Other,
            ts: format!("{brand}<{local}>{}", if nullable { " | null" } else { "" }),
            c: Type::Pointer(pointee),
        }
    }

    /// A record C lays out for the program, a `Struct` rather than a handle
    /// (`PangoRectangle`): one with no `GType` to box it by, that GIR does not
    /// call opaque, whose members GIR lists and the headers complete --
    /// `sizeof` answered -- each one a `Struct` spells, and that is not one
    /// the type system embeds first in what it hands out.
    fn plain_struct(&self, c_type: &str) -> Option<(&'a Namespace, &'a Record)> {
        self.plain_struct_at(c_type, 0)
    }

    fn plain_struct_at(&self, c_type: &str, depth: usize) -> Option<(&'a Namespace, &'a Record)> {
        let namespace = self.c_types.get(c_type).copied()?;
        let record = namespace
            .records
            .iter()
            .find(|r| !r.class_struct && r.c_type.as_deref() == Some(c_type))?;
        // Bounded: a record holding itself by value is C's error, not a
        // reason to recurse.
        let plain = depth < 8
            && record.get_type.is_none()
            && !record.pointer
            && !record.opaque
            && !record.fields.is_empty()
            && !self.embedded.contains(c_type)
            && self.facts.sizes.contains_key(c_type)
            && self.facts.tags.contains_key(c_type)
            && record
                .fields
                .iter()
                .all(|field| self.member(namespace, field, depth).is_some());
        plain.then_some((namespace, record))
    }

    /// What a record's member is to a `Struct`: a value `typed` spells -- a
    /// scalar, an enum, a `void *` -- by its type's qualified name; a
    /// string's raw `char *`; or another plain record held by value, by its
    /// C type. `None` for what no `Struct` spells here: a bit-field, a
    /// `volatile` member, a handle, an array, a callback, a union.
    fn member(&self, namespace: &Namespace, field: &Field, depth: usize) -> Option<StructMember> {
        if field.bits {
            return None;
        }
        let TypeRef::Named { name, c_type } = &field.ty else {
            return None;
        };
        let c_type = c_type.as_deref().unwrap_or("").trim();
        if c_type.split_whitespace().any(|word| word == "volatile") {
            return None;
        }
        let name = qualified_in(namespace, name);
        let target = self.alias_target(&name).unwrap_or_else(|| name.clone());
        if matches!(target.as_str(), "gpointer" | "gconstpointer") {
            return Some(StructMember::Value(name));
        }
        if matches!(target.as_str(), "utf8" | "filename") {
            let compact: String = c_type.split_whitespace().collect();
            return match compact.as_str() {
                "gchar*" | "char*" => Some(StructMember::String { constant: false }),
                "constgchar*" | "constchar*" | "gcharconst*" | "charconst*" => {
                    Some(StructMember::String { constant: true })
                }
                _ => None,
            };
        }
        if c_type.contains('*') || matches!(c_type, "bool" | "_Bool") {
            return None;
        }
        if SCALARS.iter().any(|(gir, ..)| *gir == target) {
            return Some(StructMember::Value(name));
        }
        match self.resolve(&target) {
            Some(Resolved::Enum(..)) => Some(StructMember::Value(name)),
            Some(Resolved::Record) => self
                .plain_struct_at(c_type, depth + 1)
                .map(|_| StructMember::Nested(c_type.to_owned())),
            _ => None,
        }
    }

    /// A plain record's members as its `Struct` spells them, in order; `None`
    /// where one does not spell after all.
    fn struct_fields(&mut self, record: &'a Record) -> Option<Vec<(String, String)>> {
        let mut fields = Vec::new();
        for field in &record.fields {
            let ts = match self.member(self.namespace, field, 0)? {
                // The member's bytes, which the program reads with
                // `stringFrom`: nothing here owns or frees them.
                StructMember::String { constant } => {
                    let brand = if constant { "ConstPtr" } else { "Ptr" };
                    self.binding.brands.extend([brand, "c_char"]);
                    format!("{brand}<c_char> | null")
                }
                StructMember::Nested(c_type) => {
                    let owner = self.c_types.get(c_type.as_str()).copied()?;
                    self.name_in(owner, &c_type)
                }
                StructMember::Value(name) => {
                    let TypeRef::Named { c_type, .. } = &field.ty else {
                        return None;
                    };
                    // A scalar member is C's integer as C lays it out: the
                    // brand itself, never `AsNumber`, which is how a call
                    // hands one over.
                    let target = self.alias_target(&name).unwrap_or_else(|| name.clone());
                    if let Some((_, brand, _)) = SCALARS.iter().find(|(gir, ..)| *gir == target) {
                        self.binding.brands.insert(brand);
                        let ts = self.spelled_as_alias(&name, (*brand).to_owned());
                        fields.push((field.name.clone(), ts));
                        continue;
                    }
                    let value = Param {
                        name: field.name.clone(),
                        ty: TypeRef::Named {
                            name,
                            c_type: c_type.clone(),
                        },
                        direction: Direction::In,
                        transfer: Transfer::None,
                        transfer_stated: false,
                        // A pointer member holds `NULL` as readily as not.
                        nullable: true,
                        optional: false,
                        caller_allocates: false,
                        scope: None,
                        closure: None,
                        destroy: None,
                    };
                    self.typed(&value).ok()?.ts
                }
            };
            fields.push((field.name.clone(), ts));
        }
        Some(fields)
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
        let ts = if nullable {
            format!("{local} | null")
        } else {
            local
        };
        Mapped {
            shape: Shape::Handle { class, nullable },
            ts,
            c: Type::Pointer(pointee),
        }
    }

    /// A callback parameter, with the C slots that travel with it: the
    /// function pointer taking its context last, the context, and for a
    /// notified one the destroy function. `None` for anything that is not a
    /// callback.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn callback_parameter(
        &mut self,
        param: &Param,
        at: usize,
        all: &[Param],
    ) -> Result<Option<(Mapped, Vec<Type>)>, Reason> {
        let TypeRef::Named { name, .. } = &param.ty else {
            return Ok(None);
        };
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
                return Err(Reason::CallbackShape(
                    "destroy function is not the parameter after its context",
                ));
            }
        } else if param.destroy.is_some() {
            return Err(Reason::CallbackShape(
                "destroy function is annotated on a scoped callback",
            ));
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
        let last_is_data = signature
            .parameters
            .last()
            .is_some_and(|p| matches!(&p.ty, TypeRef::Named { name, .. } if name == "gpointer"));
        let context = signature
            .parameters
            .iter()
            .position(|p| p.closure.is_some())
            .or_else(|| last_is_data.then(|| signature.parameters.len() - 1));
        if context != Some(signature.parameters.len().saturating_sub(1))
            || signature.parameters.is_empty()
        {
            return Err(Reason::CallbackShape("context is not its last parameter"));
        }
        let visible = &signature.parameters[..signature.parameters.len() - 1];
        let mut ts_parameters = Vec::new();
        let mut c_parameters = Vec::new();
        for p in visible {
            if matches!(&p.ty, TypeRef::Named { name, .. } if name == "utf8" || name == "filename")
            {
                return Err(Reason::StringInCallback);
            }
            let item = self.comparing_items.then(|| item_of_list(p)).flatten();
            let constant = item.is_some()
                && matches!(&p.ty, TypeRef::Named { c_type: Some(c), .. } if c.starts_with("gconst") || c.starts_with("const"));
            let p = item.as_ref().unwrap_or(p);
            let mapped = self.typed(p)?;
            let mut mapped = self.truth(p, mapped);
            // C's own spelling of the slot, `gconstpointer`, which the
            // self-check compares: the item is still the handle it lends.
            if constant {
                mapped.c = Type::Pointer(Pointee::Const(Box::new(Pointee::Void)));
                self.binding.brands.insert("Const");
                mapped.ts = format!("Const<{}>", mapped.ts);
            }
            c_parameters.push(mapped.c.clone());
            ts_parameters.push(format!("{}: {}", identifier(&p.name), mapped.ts));
        }
        let result = match &signature.result.ty {
            TypeRef::Named { name, .. } if name == "none" => Mapped {
                shape: Shape::Other,
                ts: "void".to_owned(),
                c: Type::Void,
            },
            // A string C takes over, `GtkScaleFormatValueFunc`'s: the bridge
            // answers a `malloc`ed copy (`native::owned_string`). One C only
            // borrows would have no point at which to be given back.
            TypeRef::Named { name, .. }
                if name == "utf8" && signature.result.transfer == Transfer::Full =>
            {
                let ts = if signature.result.nullable {
                    "string | null"
                } else {
                    "string"
                };
                Mapped {
                    shape: Shape::Other,
                    ts: ts.to_owned(),
                    c: Type::Pointer(Pointee::Scalar(Scalar::Char)),
                }
            }
            TypeRef::Named { name, .. } if name == "utf8" || name == "filename" => {
                return Err(Reason::StringInCallback);
            }
            _ => {
                let mapped = self.typed(&signature.result)?;
                self.truth(&signature.result, mapped)
            }
        };
        let context = Type::Pointer(Pointee::Void);
        let mut callback_c = c_parameters;
        callback_c.push(context.clone());
        let mut slots = vec![
            Type::FnPointer(std::sync::Arc::new(FnPointer::spell(
                callback_c,
                result.c.clone(),
            ))),
            context.clone(),
        ];
        if scope == Scope::Notified {
            slots.push(Type::FnPointer(std::sync::Arc::new(FnPointer::spell(
                vec![context],
                Type::Void,
            ))));
        }
        self.binding.brands.insert(wrapper);
        let ts = format!("{wrapper}<({}) => {}>", ts_parameters.join(", "), result.ts);
        // The Mapped's C type is the function pointer alone; the slots carry
        // the rest.
        let shape = if scope == Scope::Async {
            Shape::Once
        } else {
            Shape::Other
        };
        Ok(Some((
            Mapped {
                shape,
                ts,
                c: slots[0].clone(),
            },
            slots,
        )))
    }
}

/// The C symbol of a callable a binding may declare: one GIR neither shadows
/// nor marks unusable, and whose counting is not the compiler's own.
fn bindable_symbol(callable: &Callable) -> Result<String, Reason> {
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
    Ok(symbol)
}

/// A name as a member of a TypeScript type -- a method or a property --
/// where every word is allowed: GJS writes `buffer.delete(start, end)`, and
/// so does a program here. `identifier`'s escape is for a name that stands
/// alone, a parameter's. `icon-name` is `icon_name`, as GJS spells it.
fn member(name: &str) -> String {
    name.replace('-', "_")
}

/// A GIR parameter name as a TypeScript identifier: a name that stands
/// alone, escaped where it is a word TypeScript reserves -- `delete` is
/// `delete_`.
pub(crate) fn identifier(name: &str) -> String {
    const RESERVED: &[&str] = &[
        "break",
        "case",
        "catch",
        "class",
        "const",
        "continue",
        "debugger",
        "default",
        "delete",
        "do",
        "else",
        "enum",
        "export",
        "extends",
        "false",
        "finally",
        "for",
        "function",
        "if",
        "import",
        "in",
        "instanceof",
        "new",
        "null",
        "return",
        "super",
        "switch",
        "this",
        "throw",
        "true",
        "try",
        "typeof",
        "var",
        "void",
        "while",
        "with",
        "yield",
        "let",
        "static",
        "implements",
        "interface",
        "package",
        "private",
        "protected",
        "public",
        "await",
    ];
    if name.is_empty() {
        "arg".to_owned()
    } else if RESERVED.contains(&name) {
        format!("{name}_")
    } else {
        name.to_owned()
    }
}

/// A class's or boxed record's `GType` function, `gtk_text_iter_get_type()`,
/// declared as the C function it is.
fn get_type_function(get_type: &str) -> Function {
    Function {
        name: get_type.to_owned(),
        symbol: get_type.to_owned(),
        parameters: Vec::new(),
        result: Mapped {
            shape: Shape::Other,
            ts: "c_size_t".to_owned(),
            c: Type::Scalar(Scalar::Size),
        },
        c_parameters: Vec::new(),
        deprecated: false,
        free: None,
        raw_result_owned: false,
        no_escape: Vec::new(),
        returns: None,
        method: None,
        throws: None,
        finish: None,
        omissible: BTreeMap::new(),
        method_only: false,
        statics: None,
        vfunc: None,
        gir_name: None,
    }
}

/// What a signal's name is written as at `connect`: the name, and for a
/// signal GIR marks detailed also the name with a detail after `::` --
/// `"notify"` or the template literal `notify::${string}` -- so
/// `connect("notify::label", ...)` typechecks and reaches `GLib`, which parses
/// the detail, as written.
/// A signal's `emit` view, made from its `connect`: the instance and the
/// signal's plain name -- a detail (`notify::label`) would be part of the
/// thunk's -- then the signal's parameters, answering the signal's result.
fn emit_view(
    connect: &Function,
    signal: &str,
    emitted: Vec<(String, Mapped)>,
    result: Mapped,
) -> Function {
    let mut parameters = connect.parameters[..2].to_vec();
    parameters[1].1.ts = format!("\"{signal}\"");
    let mut c_parameters = connect.c_parameters[..2].to_vec();
    for (name, mapped) in emitted {
        c_parameters.push(mapped.c.clone());
        parameters.push((name, mapped));
    }
    Function {
        name: connect.name.replacen("_connect_", "_emit_", 1),
        symbol: EMIT.to_owned(),
        parameters,
        result,
        c_parameters,
        method: connect
            .method
            .as_ref()
            .map(|(class, _)| (class.clone(), "emit".to_owned())),
        omissible: BTreeMap::new(),
        ..connect.clone()
    }
}

fn detailed_name(signal: &super::model::Signal) -> String {
    if signal.detailed {
        format!("\"{0}\" | `{0}::${{string}}`", signal.name)
    } else {
        format!("\"{}\"", signal.name)
    }
}

/// The parameters that hold an inbound array's length, which the compiler
/// fills from the array: `index -> the array's index`.
fn in_lengths(signature: &super::model::Signature) -> BTreeMap<usize, usize> {
    signature
        .parameters
        .iter()
        .enumerate()
        .filter_map(|(at, param)| match &param.ty {
            TypeRef::Array(array) if param.direction == Direction::In => Some((array.length?, at)),
            _ => None,
        })
        .collect()
}

/// The out slots holding the length of bytes C hands back -- an out byte
/// array's, or the result's -- which the values form reads.
fn byte_lengths(signature: &super::model::Signature) -> BTreeSet<usize> {
    signature
        .parameters
        .iter()
        .filter(|param| param.direction != Direction::In)
        .map(|param| &param.ty)
        .chain([&signature.result.ty])
        .filter_map(|ty| match ty {
            TypeRef::Array(array) if is_bytes(array) => array.length,
            _ => None,
        })
        .collect()
}

/// An array of bytes: `guint8`, or a `gchar` array that is not a string.
fn is_bytes(array: &ArrayRef) -> bool {
    matches!(
        array.element.as_deref(),
        Some("guint8" | "gchar" | "guchar")
    ) && !array.zero_terminated
        && array.length.is_some()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]
    use super::SCALARS;
    use nts_core::hir::native::Scalar;

    /// Each brand this binder writes is the one the compiler reads back as the
    /// scalar it was mapped from -- one table on each side, checked here so
    /// they cannot drift.
    #[test]
    fn every_scalar_brand_reads_back_as_its_scalar() {
        for (gir, brand, scalar) in SCALARS {
            assert_eq!(
                Scalar::from_label(&format!("__{brand}")),
                Some(*scalar),
                "`{gir}` is written as `{brand}`, which the compiler does not read as {scalar:?}"
            );
        }
    }
    fn raw_pointer_fixture() -> (std::path::PathBuf, super::Repository) {
        use std::fmt::Write as _;
        let dir = std::env::temp_dir().join(format!("nts-gir-raw-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("fixture directory");
        std::fs::write(
            dir.join("raw.h"),
            r"
            typedef void *gpointer; typedef const void *gconstpointer;
            gpointer raw_plain(void); gpointer raw_nullable(void);
            gconstpointer raw_const(void); gconstpointer raw_legacy(void);
            gpointer raw_owned(void); void raw_slot(gpointer *slot);
            void raw_optional(gconstpointer *slot); void raw_inout(gpointer *slot);
            void raw_bad_header(gconstpointer *slot); void raw_bad_depth(gpointer **slot);
            void raw_input(gpointer value); void raw_const_input(gconstpointer value);
            void raw_nullable_input(gpointer value); void raw_legacy_input(gconstpointer value);
            void raw_optional_input(gpointer value); void raw_bad_input(gconstpointer value);
            void raw_deep_input(gpointer *value);
        ",
        )
        .expect("header");
        let mut xml = String::from(
            r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0">
            <c:include name="raw.h"/><namespace name="Raw" version="1.0">"#,
        );
        for (name, gir, c, flags) in [
            ("plain", "gpointer", "gpointer", ""),
            ("nullable", "gpointer", "void *", "nullable=\"1\""),
            ("const", "gconstpointer", "const void *", ""),
            (
                "legacy",
                "gconstpointer",
                "gconstpointer",
                "allow-none=\"1\"",
            ),
            (
                "owned",
                "gpointer",
                "gpointer",
                "transfer-ownership=\"full\"",
            ),
        ] {
            let _ = writeln!(
                xml,
                r#"<function name="{name}" c:identifier="raw_{name}">
                <return-value {flags}><type name="{gir}" c:type="{c}"/></return-value>
                </function>"#
            );
        }
        for (name, gir, c, flags) in [
            ("slot", "gpointer", "gpointer*", "direction=\"out\""),
            (
                "optional",
                "gconstpointer",
                "gconstpointer*",
                "direction=\"out\" optional=\"1\"",
            ),
            ("inout", "gpointer", "void**", "direction=\"inout\""),
            ("bad_header", "gpointer", "gpointer*", "direction=\"out\""),
            ("bad_depth", "gpointer", "gpointer**", "direction=\"out\""),
            ("input", "gpointer", "gpointer", ""),
            ("const_input", "gconstpointer", "gconstpointer", ""),
            ("nullable_input", "gpointer", "void*", "nullable=\"1\""),
            (
                "legacy_input",
                "gconstpointer",
                "void const*",
                "allow-none=\"1\"",
            ),
            ("optional_input", "gpointer", "gpointer", "optional=\"1\""),
            ("bad_input", "gpointer", "gpointer", ""),
            ("deep_input", "gpointer", "gpointer*", ""),
        ] {
            let _ = writeln!(
                xml,
                r#"<function name="{name}" c:identifier="raw_{name}">
                <return-value><type name="none" c:type="void"/></return-value><parameters>
                <parameter name="slot" {flags}><type name="{gir}" c:type="{c}"/></parameter>
                </parameters></function>"#
            );
        }
        xml.push_str("</namespace></repository>");
        std::fs::write(dir.join("Raw-1.0.gir"), xml).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("Raw-1.0", &[search]).expect("parse GIR");
        (dir, repository)
    }

    /// A pointer GIR leaves unannotated is the raw pointer the header writes,
    /// a level per `*`, its innermost type as this binder spells it -- a
    /// scalar by its brand, a handle -- and its prototype the header's. The
    /// controls each differ in one thing and stay as they were: a pointee no
    /// type names (`FILE`), a `volatile` one, and the same `gint *` annotated
    /// `out`, which stays a slot.
    #[test]
    fn an_unannotated_pointer_is_the_raw_pointer_the_header_writes() {
        use super::super::{check, facts};
        use super::{Reason, bind};
        let dir = crate::bind_scratch::directory("gir-unannotated-pointer-test")
            .expect("fixture directory");
        std::fs::write(
            dir.join("u.h"),
            "#include <stdint.h>\n#include <stdio.h>\n\
             typedef unsigned long gsize; typedef unsigned int guint32; typedef int gint;\n\
             typedef struct _UData UData;\n\
             void u_size(gsize *count); void u_codes(const guint32 *codes);\n\
             void u_list(UData **list); void u_file(FILE *file);\n\
             void u_slot(gint *value); void u_atomic(volatile gint *value);\n",
        )
        .expect("header");
        let function = |name: &str, ty: &str, c_type: &str, flags: &str| {
            format!(
                r#"<function name="{name}" c:identifier="u_{name}"><return-value><type name="none" c:type="void"/></return-value>
                <parameters><parameter name="p" {flags}><type name="{ty}" c:type="{c_type}"/></parameter></parameters></function>"#
            )
        };
        let xml = [
            r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0">
            <c:include name="u.h"/><namespace name="U" version="1.0">
            <record name="Data" c:type="UData" opaque="1"/>"#,
            &function("size", "gsize", "gsize*", ""),
            &function("codes", "guint32", "const guint32*", ""),
            &function("list", "Data", "UData**", ""),
            &function("file", "gpointer", "FILE*", ""),
            &function(
                "slot",
                "gint",
                "gint*",
                r#"direction="out" caller-allocates="0""#,
            ),
            &function("atomic", "gint", "volatile gint*", ""),
            "</namespace></repository>",
        ]
        .concat();
        std::fs::write(dir.join("U-1.0.gir"), xml).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("U-1.0", &[search]).expect("parse GIR");
        let header = facts::Facts {
            tags: [("UData".to_owned(), "_UData".to_owned())].into(),
            ..facts::Facts::default()
        };
        let mut binding = bind(&repository, &repository.namespaces["U"], &header);
        check::against_headers(&mut binding, &[format!("-I{}", dir.display())])
            .expect("header check");
        let parameter = |symbol: &str| {
            binding
                .functions
                .iter()
                .find(|f| f.symbol == symbol)
                .map(|f| f.parameters[0].1.ts.clone())
        };
        assert_eq!(parameter("u_size").as_deref(), Some("Ptr<c_size_t> | null"));
        assert_eq!(
            parameter("u_codes").as_deref(),
            Some("ConstPtr<Uint32> | null"),
            "{:?}",
            binding.refused
        );
        assert_eq!(
            parameter("u_list").as_deref(),
            Some("Ptr<UData | null> | null")
        );
        assert_eq!(parameter("u_slot").as_deref(), Some("Ptr<c_int>"));
        for refused in ["u_file", "u_atomic"] {
            assert!(
                parameter(refused).is_none()
                    && binding
                        .refused
                        .iter()
                        .any(|(n, r)| n == refused && matches!(r, Reason::PointerDepth(_))),
                "{refused}: {:?}",
                binding.refused
            );
        }
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }

    #[test]
    fn raw_void_results_and_slots_follow_gir_and_the_header() {
        use super::super::{check, emit, facts};
        use super::{Reason, bind};
        let (dir, repository) = raw_pointer_fixture();
        let namespace = &repository.namespaces["Raw"];
        let mut binding = bind(&repository, namespace, &facts::Facts::default());
        let function = |name: &str| {
            binding
                .functions
                .iter()
                .find(|f| f.symbol == name)
                .expect("bound function")
        };
        for (name, expected) in [
            ("raw_plain", "Ptr<void>"),
            ("raw_nullable", "Ptr<void> | null"),
            ("raw_const", "ConstPtr<void>"),
            ("raw_legacy", "ConstPtr<void> | null"),
            ("raw_owned", "Ptr<void>"),
        ] {
            assert_eq!(function(name).result.ts, expected);
        }
        assert!(function("raw_owned").raw_result_owned);
        assert!(!function("raw_plain").raw_result_owned);
        assert_eq!(
            function("raw_slot").parameters[0].1.ts,
            "Ptr<Ptr<void> | null>"
        );
        assert_eq!(
            function("raw_optional").parameters[0].1.ts,
            "Ptr<ConstPtr<void> | null> | null"
        );
        assert_eq!(
            function("raw_inout").parameters[0].1.ts,
            "Ptr<Ptr<void> | null>"
        );
        assert_eq!(function("raw_input").parameters[0].1.ts, "Ptr<void>");
        assert_eq!(
            function("raw_const_input").parameters[0].1.ts,
            "ConstPtr<void>"
        );
        assert_eq!(
            function("raw_nullable_input").parameters[0].1.ts,
            "Ptr<void> | null"
        );
        assert_eq!(
            function("raw_legacy_input").parameters[0].1.ts,
            "ConstPtr<void> | null"
        );
        // Optionality is distinct from GIR value nullability, as before.
        assert_eq!(
            function("raw_optional_input").parameters[0].1.ts,
            "Ptr<void>"
        );
        assert_eq!(function("raw_bad_input").parameters[0].1.ts, "Ptr<void>");
        assert_eq!(function("raw_slot").no_escape, ["slot"]);
        // One difference: metadata says the same slot, but the header makes
        // its pointee const. Mapping alone accepts it; the final check refuses.
        assert_eq!(
            function("raw_bad_header").parameters[0].1.ts,
            "Ptr<Ptr<void> | null>"
        );
        assert!(
            binding
                .refused
                .iter()
                .any(|(n, r)| n == "raw_bad_depth" && matches!(r, Reason::PointerDepth(_)))
        );
        // Unannotated and deeper than the type GIR names: the raw pointer the
        // header writes. `raw_bad_depth`, the same depth annotated `out`, is
        // refused above: an annotated form is never replaced.
        assert_eq!(
            function("raw_deep_input").parameters[0].1.ts,
            "Ptr<Ptr<void> | null> | null"
        );
        check::against_headers(&mut binding, &[format!("-I{}", dir.display())])
            .expect("header check");
        assert!(
            binding
                .refused
                .iter()
                .any(|(n, r)| n == "raw_bad_header" && matches!(r, Reason::Header(_)))
        );
        assert!(
            binding
                .refused
                .iter()
                .any(|(n, r)| n == "raw_bad_input" && matches!(r, Reason::Header(_)))
        );
        let text = emit::declarations(&binding, "test");
        assert!(
            text.contains("Caller owns the raw pointer result; this binding names no deallocator.")
        );
        assert!(!text.contains("@ntsFree"));
        assert!(text.contains("raw_optional(slot?: Ptr<ConstPtr<void> | null> | null): void;"));
        assert!(text.contains("raw_slot(slot: Ptr<Ptr<void> | null>): void;"));
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }

    /// A header and its GIR, which writes `q_write`'s buffer `void*` and
    /// `q_take`'s value `gpointer` where the header has `const void *` and
    /// `gconstpointer`.
    fn const_fixture() -> (std::path::PathBuf, super::Repository) {
        use std::fmt::Write as _;
        let dir = crate::bind_scratch::directory("gir-const-test").expect("fixture directory");
        std::fs::write(
            dir.join("q.h"),
            r"
            #include <stddef.h>
            typedef char gchar; typedef size_t gsize;
            typedef void *gpointer; typedef const void *gconstpointer;
            int q_write(const void *buffer, gsize count);
            int q_write_plain(void *buffer, gsize count);
            gchar *q_find(const gchar *haystack);
            void q_take(gconstpointer value);
            void q_atomic(volatile void *atomic);
        ",
        )
        .expect("header");
        let mut xml = String::from(
            r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0">
            <c:include name="q.h"/><namespace name="Q" version="1.0">"#,
        );
        for name in ["write", "write_plain"] {
            let _ = write!(
                xml,
                r#"<function name="{name}" c:identifier="q_{name}">
                <return-value><type name="gint" c:type="int"/></return-value><parameters>
                <parameter name="buffer" transfer-ownership="none">
                <array length="1" zero-terminated="0" c:type="void*"><type name="guint8"/></array>
                </parameter>
                <parameter name="count"><type name="gsize" c:type="gsize"/></parameter>
                </parameters></function>"#
            );
        }
        xml.push_str(
            r#"<function name="find" c:identifier="q_find">
            <return-value transfer-ownership="none" nullable="1"><type name="utf8" c:type="gchar*"/></return-value>
            <parameters><parameter name="haystack"><type name="utf8" c:type="const gchar*"/></parameter></parameters>
            </function>"#,
        );
        for name in ["take", "atomic"] {
            let _ = write!(
                xml,
                r#"<function name="{name}" c:identifier="q_{name}">
                <return-value><type name="none" c:type="void"/></return-value>
                <parameters><parameter name="value"><type name="gpointer" c:type="gpointer"/></parameter></parameters>
                </function>"#
            );
        }
        xml.push_str("</namespace></repository>");
        std::fs::write(dir.join("Q-1.0.gir"), xml).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("Q-1.0", &[search]).expect("parse GIR");
        (dir, repository)
    }

    /// GIR decides what a parameter means and the header its `const`. A
    /// `volatile` and a lent `gchar *` result are refused by name. One
    /// difference makes the control: the same GIR without the headers'
    /// prototypes keeps GIR's spelling, which the self-check refuses.
    #[test]
    fn the_header_decides_const_and_gir_the_meaning() {
        use super::super::{check, facts};
        use super::{Reason, bind};
        let (dir, repository) = const_fixture();
        let namespace = &repository.namespaces["Q"];
        let cflags = [format!("-I{}", dir.display())];
        let functions = ["q_write", "q_write_plain", "q_find", "q_take", "q_atomic"];
        let (prototypes, volatile) = facts::prototypes(
            &crate::bind_header::preamble(&namespace.defines, &namespace.headers),
            &cflags,
            &functions,
            &[],
        )
        .expect("prototypes");
        assert_eq!(
            volatile.iter().map(String::as_str).collect::<Vec<_>>(),
            ["q_atomic"]
        );
        let header = facts::Facts {
            prototypes,
            volatile,
            ..facts::Facts::default()
        };
        let parameter = |binding: &super::Binding, name: &str| {
            binding
                .functions
                .iter()
                .find(|f| f.symbol == name)
                .map(|f| f.parameters[0].1.ts.clone())
        };
        let mut binding = bind(&repository, namespace, &header);
        check::against_headers(&mut binding, &cflags).expect("header check");
        assert!(
            !binding
                .refused
                .iter()
                .any(|(_, r)| matches!(r, Reason::Header(_))),
            "{:?}",
            binding.refused
        );
        let write = parameter(&binding, "q_write").expect("q_write bound");
        assert!(
            write.starts_with("Counted<CBytes<\"const void\">"),
            "{write}"
        );
        let plain = parameter(&binding, "q_write_plain").expect("q_write_plain bound");
        assert!(plain.starts_with("Counted<CBytes<\"void\">"), "{plain}");
        assert_eq!(
            parameter(&binding, "q_take").as_deref(),
            Some("ConstPtr<void>")
        );
        // A lent `gchar *` result: a `string` result has no such spelling.
        assert!(
            binding
                .refused
                .iter()
                .any(|(n, r)| n == "q_find" && *r == Reason::LentWritableString)
        );
        assert!(
            binding
                .refused
                .iter()
                .any(|(n, r)| n == "q_atomic" && *r == Reason::Volatile)
        );
        // The control: GIR's own spellings, which the header refuses.
        let mut control = bind(&repository, namespace, &facts::Facts::default());
        check::against_headers(&mut control, &cflags).expect("header check");
        for name in ["q_write", "q_take", "q_atomic"] {
            assert!(
                control
                    .refused
                    .iter()
                    .any(|(n, r)| n == name && matches!(r, Reason::Header(_))),
                "{name}: {:?}",
                control.refused
            );
        }
        assert!(
            control
                .functions
                .iter()
                .any(|f| f.symbol == "q_write_plain")
        );
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }

    /// A record C takes as `gconstpointer` or answers as `gpointer` is its
    /// handle erased: `Const<Erased<GBytes>>` and `Erased<GBytes>`, as a
    /// class's is. One difference makes the control: the same shapes for a
    /// record the headers do not tag, which stays refused.
    #[test]
    fn a_record_c_erases_is_its_erased_handle() {
        use super::super::facts;
        use super::{Reason, bind};
        use nts_core::hir::native::{Pointee, Type};
        use std::fmt::Write as _;
        let dir = crate::bind_scratch::directory("gir-erased-test").expect("fixture directory");
        let mut xml = String::from(
            r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0">
            <c:include name="e.h"/><namespace name="E" version="1.0">
            <record name="Bytes" c:type="GBytes"/><record name="Loose" c:type="GLoose"/>"#,
        );
        for record in ["Bytes", "Loose"] {
            let lower = record.to_lowercase();
            let _ = write!(
                xml,
                r#"<function name="{lower}_equal" c:identifier="e_{lower}_equal">
                <return-value><type name="gboolean" c:type="gboolean"/></return-value>
                <parameters><parameter name="a"><type name="{record}" c:type="gconstpointer"/></parameter></parameters>
                </function>
                <function name="{lower}_peek" c:identifier="e_{lower}_peek">
                <return-value transfer-ownership="none"><type name="{record}" c:type="gpointer"/></return-value>
                </function>"#
            );
        }
        xml.push_str("</namespace></repository>");
        std::fs::write(dir.join("E-1.0.gir"), xml).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("E-1.0", &[search]).expect("parse GIR");
        let namespace = &repository.namespaces["E"];
        let header = facts::Facts {
            tags: [("GBytes".to_owned(), "_GBytes".to_owned())].into(),
            ..facts::Facts::default()
        };
        let binding = bind(&repository, namespace, &header);
        let function = |name: &str| binding.functions.iter().find(|f| f.symbol == name);
        let equal = function("e_bytes_equal").expect("e_bytes_equal bound");
        assert_eq!(equal.parameters[0].1.ts, "Const<Erased<GBytes>>");
        assert_eq!(
            equal.parameters[0].1.c,
            Type::Pointer(Pointee::Const(Box::new(Pointee::Void)))
        );
        let peek = function("e_bytes_peek").expect("e_bytes_peek bound");
        assert_eq!(peek.result.ts, "Erased<GBytes>");
        assert_eq!(peek.result.c, Type::Pointer(Pointee::Void));
        for name in ["e_loose_equal", "e_loose_peek"] {
            assert!(
                binding
                    .refused
                    .iter()
                    .any(|(n, r)| n == name && *r == Reason::RecordByValue),
                "{name}: {:?}",
                binding.refused
            );
        }
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }

    /// The GIR `a_plain_record_is_a_struct_and_its_pointer_is_storage` binds:
    /// `SRect`, and one record beside it for each thing that keeps one a
    /// handle; and a function taking an `SRect *` out, inout and `const`.
    fn plain_struct_gir() -> String {
        let field = |name: &str, ty: &str, c_type: &str| {
            format!(
                r#"<field name="{name}" writable="1"><type name="{ty}" c:type="{c_type}"/></field>"#
            )
        };
        let record = |name: &str, fields: &str| {
            format!(r#"<record name="{name}" c:type="S{name}">{fields}</record>"#)
        };
        let function = |name: &str, parameter: &str| {
            format!(
                r#"<function name="{name}" c:identifier="s_{name}"><return-value><type name="none" c:type="void"/></return-value><parameters>{parameter}</parameters></function>"#
            )
        };
        let ints = [field("x", "gint", "gint"), field("y", "gint", "gint")].concat();
        let rect = [
            ints.as_str(),
            &field("stamp", "gint64", "gint64"),
            &field("name", "utf8", "const gchar*"),
            &field("label", "utf8", "gchar*"),
            r#"<field name="reserved" readable="0" private="1"><type name="gpointer" c:type="gpointer"/></field>"#,
        ]
        .concat();
        [
            r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0"
            xmlns:glib="http://www.gtk.org/introspection/glib/1.0">
            <c:include name="s.h"/><namespace name="S" version="1.0">"#,
            &record("Rect", &rect),
            &record("Volatile", &field("state", "gint", "volatile gint")),
            &record("Root", &field("type", "GType", "GType")),
            &record("Unsized", &ints),
            &record("Holder", &field("rect", "Rect", "SRect*")),
            &record("Handed", &field("type", "GType", "GType")),
            r#"<function name="peek" c:identifier="s_peek"><return-value><type name="none" c:type="void"/></return-value><parameters><parameter name="handed"><type name="Handed" c:type="gpointer"/></parameter></parameters></function>"#,
            r#"<record name="ThingClass" c:type="SThingClass" glib:is-gtype-struct-for="Thing">"#,
            &field("root", "Root", "SRoot"),
            "</record>",
            &function(
                "fill",
                r#"<parameter name="out" direction="out" caller-allocates="1" transfer-ownership="none"><type name="Rect" c:type="SRect*"/></parameter>"#,
            ),
            &function(
                "scale",
                r#"<parameter name="rect" direction="inout" caller-allocates="0" transfer-ownership="full" nullable="1"><type name="Rect" c:type="SRect*"/></parameter>"#,
            ),
            &function(
                "area",
                r#"<parameter name="rect"><type name="Rect" c:type="const SRect*"/></parameter>"#,
            ),
            "</namespace></repository>",
        ]
        .concat()
    }

    /// A record with no `GType`, whose members the headers lay out, is a
    /// `Struct` -- private members too, a 64-bit one as its brand, a string
    /// as its raw `char *` -- and a pointer to one is the program's storage,
    /// in, out or both. The controls differ from it in one thing each and
    /// stay handles: a `volatile` member, a record a class struct embeds
    /// first, one GIR names where C passes a `gpointer` (as it names
    /// `GTypeInterface`), one the headers do not complete, one holding a
    /// pointer to another record.
    #[test]
    fn a_plain_record_is_a_struct_and_its_pointer_is_storage() {
        use super::super::facts;
        use super::{Reason, TypeDecl, bind};
        let dir =
            crate::bind_scratch::directory("gir-plain-struct-test").expect("fixture directory");
        std::fs::write(dir.join("S-1.0.gir"), plain_struct_gir()).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("S-1.0", &[search]).expect("parse GIR");
        let header = facts::Facts {
            tags: [
                "SRect",
                "SVolatile",
                "SRoot",
                "SUnsized",
                "SHolder",
                "SHanded",
            ]
            .map(|c| (c.to_owned(), format!("_{c}")))
            .into(),
            sizes: [
                ("SRect", 48),
                ("SVolatile", 4),
                ("SRoot", 8),
                ("SHolder", 8),
                ("SHanded", 8),
            ]
            .map(|(c, size)| (c.to_owned(), size))
            .into(),
            ..facts::Facts::default()
        };
        let binding = bind(&repository, &repository.namespaces["S"], &header);
        let mut structs = binding.types.iter().filter_map(|decl| match decl {
            TypeDecl::Struct { name, tag, fields } => Some((name, tag, fields)),
            TypeDecl::Class { .. } => None,
        });
        let (name, tag, fields) = structs.next().expect("a Struct");
        assert!(structs.next().is_none(), "more than one Struct");
        assert_eq!((name.as_str(), tag.as_str()), ("SRect", "_SRect"));
        let spelled: Vec<(&str, &str)> = fields
            .iter()
            .map(|(name, ts)| (name.as_str(), ts.as_str()))
            .collect();
        assert_eq!(
            spelled,
            [
                ("x", "c_int"),
                ("y", "c_int"),
                ("stamp", "BigInt64"),
                ("name", "ConstPtr<c_char> | null"),
                ("label", "Ptr<c_char> | null"),
                ("reserved", "Ptr<void> | null"),
            ]
        );
        for control in ["SVolatile", "SRoot", "SUnsized", "SHolder", "SHanded"] {
            assert!(
                binding
                    .types
                    .iter()
                    .any(|decl| matches!(decl, TypeDecl::Class { name, .. } if name == control)),
                "{control} is no longer a handle"
            );
        }
        let parameter = |symbol: &str| {
            binding
                .functions
                .iter()
                .find(|f| f.symbol == symbol)
                .map_or_else(
                    || panic!("{symbol}: {:?}", binding.refused),
                    |f| f.parameters[0].1.ts.clone(),
                )
        };
        assert_eq!(parameter("s_fill"), "Ptr<SRect>");
        assert_eq!(parameter("s_scale"), "Ptr<SRect> | null");
        assert_eq!(parameter("s_area"), "ConstPtr<SRect>");
        assert!(
            !binding
                .refused
                .iter()
                .any(|(_, r)| *r == Reason::CallerAllocates)
        );
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }

    /// A record's alias is the record: `SAllocation`, a `typedef SRect` as
    /// GTK's `GtkAllocation` is a `GdkRectangle`, binds every way its record
    /// does -- storage the caller gives C to fill, a `const` pointer in -- and
    /// `SLayoutRun`, a boxed record's alias as Pango's `PangoLayoutRun` is a
    /// `PangoGlyphItem`, as a lent result. Each control is the same call
    /// through the record's own name, which bound before: the same but for
    /// the name it is spelled by.
    #[test]
    fn a_records_alias_is_the_record() {
        use super::super::facts;
        use super::bind;
        let dir =
            crate::bind_scratch::directory("gir-record-alias-test").expect("fixture directory");
        let function = |name: &str, result: &str, parameter: &str| {
            format!(
                r#"<function name="{name}" c:identifier="s_{name}"><return-value transfer-ownership="none"><type {result}/></return-value><parameters>{parameter}</parameters></function>"#
            )
        };
        let void = r#"name="none" c:type="void""#;
        let out = |ty: &str, c_type: &str| {
            format!(
                r#"<parameter name="out" direction="out" caller-allocates="1" transfer-ownership="none"><type name="{ty}" c:type="{c_type}"/></parameter>"#
            )
        };
        let given = |ty: &str, c_type: &str| {
            format!(r#"<parameter name="rect"><type name="{ty}" c:type="{c_type}"/></parameter>"#)
        };
        let xml = [
            r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0"
            xmlns:glib="http://www.gtk.org/introspection/glib/1.0">
            <c:include name="s.h"/><namespace name="S" version="1.0">"#,
            r#"<alias name="Allocation" c:type="SAllocation"><type name="Rect" c:type="SRect"/></alias>"#,
            r#"<alias name="LayoutRun" c:type="SLayoutRun"><type name="Run" c:type="SRun"/></alias>"#,
            r#"<record name="Rect" c:type="SRect"><field name="x" writable="1"><type name="gint" c:type="gint"/></field></record>"#,
            r#"<record name="Run" c:type="SRun" glib:get-type="s_run_get_type"><field name="x" writable="1"><type name="gint" c:type="gint"/></field></record>"#,
            &function("fill", void, &out("Allocation", "SAllocation*")),
            &function("fill_rect", void, &out("Rect", "SRect*")),
            &function("area", void, &given("Allocation", "const SAllocation*")),
            &function("area_rect", void, &given("Rect", "const SRect*")),
            &function("run", r#"name="LayoutRun" c:type="SLayoutRun*""#, ""),
            &function("run_itself", r#"name="Run" c:type="SRun*""#, ""),
            "</namespace></repository>",
        ]
        .concat();
        std::fs::write(dir.join("S-1.0.gir"), xml).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("S-1.0", &[search]).expect("parse GIR");
        let header = facts::Facts {
            tags: ["SRect", "SRun"]
                .map(|c| (c.to_owned(), format!("_{c}")))
                .into(),
            sizes: [("SRect", 4), ("SRun", 4)]
                .map(|(c, size)| (c.to_owned(), size))
                .into(),
            ..facts::Facts::default()
        };
        let binding = bind(&repository, &repository.namespaces["S"], &header);
        assert!(binding.refused.is_empty(), "{:?}", binding.refused);
        let bound = |symbol: &str| {
            let function = binding
                .functions
                .iter()
                .find(|f| f.symbol == symbol)
                .unwrap_or_else(|| panic!("{symbol} is not bound"));
            format!(
                "{:?}",
                (
                    &function.parameters,
                    &function.result,
                    &function.c_parameters
                )
            )
        };
        for (alias, record) in [
            ("s_fill", "s_fill_rect"),
            ("s_area", "s_area_rect"),
            ("s_run", "s_run_itself"),
        ] {
            let by_record = bound(alias)
                .replace("SAllocation", "SRect")
                .replace("SLayoutRun", "SRun");
            assert_eq!(by_record, bound(record), "{alias}");
        }
        let parameter = |symbol: &str| {
            binding
                .functions
                .iter()
                .find(|f| f.symbol == symbol)
                .expect("bound")
                .parameters[0]
                .1
                .ts
                .clone()
        };
        assert_eq!(parameter("s_fill"), "Ptr<SAllocation>");
        assert_eq!(parameter("s_area"), "ConstPtr<SAllocation>");
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }

    /// An alias a program can name is declared once, in its namespace: by
    /// its C name as the type it stands for -- a scalar's brand, 64-bit too
    /// (`BigInt64`, what C holds), a record's type -- and on the `gi:` surface
    /// by its GIR name, the record's renamed with it. `GType` too, which GIR
    /// also writes bare. The controls are each kind not declared: a `typedef
    /// void` (`GMutexLocker`), a string list's `utf8` (`GStrv`), a callback's.
    #[test]
    fn an_alias_is_declared_by_its_c_name_and_its_gir_name() {
        use super::super::{emit, facts, naming};
        use super::bind;
        let dir =
            crate::bind_scratch::directory("gir-alias-names-test").expect("fixture directory");
        let alias = |name: &str, c_type: &str, target: &str| {
            format!(r#"<alias name="{name}" c:type="{c_type}"><type name="{target}"/></alias>"#)
        };
        let xml = [
            r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0"
            xmlns:glib="http://www.gtk.org/introspection/glib/1.0">
            <c:include name="s.h"/><namespace name="S" version="1.0">"#,
            &alias("Quark", "SQuark", "guint32"),
            &alias("Span", "SSpan", "gint64"),
            &alias("Allocation", "SAllocation", "Rect"),
            &alias("Locker", "SLocker", "none"),
            &alias("Strv", "SStrv", "utf8"),
            &alias("Type", "GType", "gsize"),
            &alias("Callback", "SCallbackAlias", "Func"),
            r#"<record name="Rect" c:type="SRect"><field name="x" writable="1"><type name="gint" c:type="gint"/></field></record>"#,
            r#"<callback name="Func" c:type="SFunc"><return-value><type name="none" c:type="void"/></return-value></callback>"#,
            "</namespace></repository>",
        ]
        .concat();
        std::fs::write(dir.join("S-1.0.gir"), xml).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("S-1.0", &[search]).expect("parse GIR");
        let header = facts::Facts {
            tags: [("SRect".to_owned(), "_SRect".to_owned())].into(),
            sizes: [("SRect".to_owned(), 4)].into(),
            ..facts::Facts::default()
        };
        let namespace = &repository.namespaces["S"];
        let binding = bind(&repository, namespace, &header);
        let declared = |binding: &super::Binding| {
            binding
                .aliases
                .iter()
                .map(|a| format!("{} = {}", a.name, a.ts))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            declared(&binding),
            [
                "SQuark = Uint32",
                "SSpan = BigInt64",
                "SAllocation = SRect",
                "GType = c_size_t"
            ]
        );
        let text = emit::declarations(&binding, "test");
        assert!(text.contains("  export type SQuark = Uint32;\n"), "{text}");
        let gi = naming::gi(&binding, namespace, &naming::Names::of(&repository));
        assert_eq!(
            declared(&gi),
            [
                "Quark = Uint32",
                "Span = BigInt64",
                "Allocation = Rect",
                "Type = c_size_t"
            ]
        );
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }

    /// Where GIR names an alias, the binding spells it by that name, in the
    /// form it is declared as: a result, an out slot's value, a `Struct`
    /// member, a record's `const` pointer -- `SQuark`, `ConstPtr<SAllocation>`
    /// -- and on the `gi:` surface by its GIR name. The control is the one
    /// position that changes the form: a 64-bit alias passed, which is
    /// `AsNumber<BigInt64>`, not the `BigInt64` `SSpan` is declared as.
    #[test]
    fn an_alias_is_spelled_by_its_name_where_its_form_is() {
        use super::super::{facts, naming};
        use super::{TypeDecl, bind};
        let dir =
            crate::bind_scratch::directory("gir-alias-spelling-test").expect("fixture directory");
        let function = |name: &str, result: &str, parameter: &str| {
            format!(
                r#"<function name="{name}" c:identifier="s_{name}"><return-value transfer-ownership="none"><type {result}/></return-value><parameters>{parameter}</parameters></function>"#
            )
        };
        let void = r#"name="none" c:type="void""#;
        let xml = [
            r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0"
            xmlns:glib="http://www.gtk.org/introspection/glib/1.0">
            <c:include name="s.h"/><namespace name="S" version="1.0">"#,
            r#"<alias name="Quark" c:type="SQuark"><type name="guint32" c:type="guint32"/></alias>"#,
            r#"<alias name="Span" c:type="SSpan"><type name="gint64" c:type="gint64"/></alias>"#,
            r#"<alias name="Allocation" c:type="SAllocation"><type name="Rect" c:type="SRect"/></alias>"#,
            r#"<record name="Rect" c:type="SRect"><field name="x" writable="1"><type name="gint" c:type="gint"/></field><field name="q" writable="1"><type name="Quark" c:type="SQuark"/></field></record>"#,
            &function("intern", r#"name="Quark" c:type="SQuark""#, ""),
            &function(
                "wait",
                void,
                r#"<parameter name="span"><type name="Span" c:type="SSpan"/></parameter>"#,
            ),
            &function(
                "lookup",
                void,
                r#"<parameter name="quark" direction="out" caller-allocates="0" transfer-ownership="full"><type name="Quark" c:type="SQuark*"/></parameter>"#,
            ),
            &function(
                "area",
                void,
                r#"<parameter name="rect"><type name="Allocation" c:type="const SAllocation*"/></parameter>"#,
            ),
            "</namespace></repository>",
        ]
        .concat();
        std::fs::write(dir.join("S-1.0.gir"), xml).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("S-1.0", &[search]).expect("parse GIR");
        let header = facts::Facts {
            tags: [("SRect".to_owned(), "_SRect".to_owned())].into(),
            sizes: [("SRect".to_owned(), 8)].into(),
            ..facts::Facts::default()
        };
        let namespace = &repository.namespaces["S"];
        let binding = bind(&repository, namespace, &header);
        assert!(binding.refused.is_empty(), "{:?}", binding.refused);
        let spelled = |binding: &super::Binding, symbol: &str| {
            let function = binding
                .functions
                .iter()
                .find(|f| f.symbol == symbol)
                .unwrap_or_else(|| panic!("{symbol} is not bound"));
            function
                .parameters
                .first()
                .map_or_else(|| function.result.ts.clone(), |(_, m)| m.ts.clone())
        };
        let member = |binding: &super::Binding| {
            binding.types.iter().find_map(|decl| match decl {
                TypeDecl::Struct { fields, .. } => fields
                    .iter()
                    .find(|(name, _)| name == "q")
                    .map(|(_, ts)| ts.clone()),
                TypeDecl::Class { .. } => None,
            })
        };
        assert_eq!(spelled(&binding, "s_intern"), "SQuark");
        assert_eq!(spelled(&binding, "s_lookup"), "Ptr<SQuark>");
        assert_eq!(spelled(&binding, "s_area"), "ConstPtr<SAllocation>");
        assert_eq!(member(&binding).as_deref(), Some("SQuark"));
        assert_eq!(spelled(&binding, "s_wait"), "AsNumber<BigInt64>");
        let gi = naming::gi(&binding, namespace, &naming::Names::of(&repository));
        assert_eq!(spelled(&gi, "s_intern"), "Quark");
        assert_eq!(spelled(&gi, "s_area"), "ConstPtr<Allocation>");
        assert_eq!(member(&gi).as_deref(), Some("Quark"));
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }

    /// A string constant is its literal type, with no `@ntsConstant`: the
    /// text as `JSON.stringify` writes it, which TypeScript reads back as the
    /// same text -- a quote, a backslash and a newline escaped -- on both
    /// surfaces, where the `gi:` one renames nothing inside it, a quoted
    /// `SRect` included. The control is an integer constant, which keeps its
    /// tag.
    #[test]
    fn a_string_constant_is_its_literal_type() {
        use super::super::{emit, naming};
        use super::bind;
        let dir =
            crate::bind_scratch::directory("gir-string-constant-test").expect("fixture directory");
        let constant = |name: &str, value: &str, ty: &str, c_type: &str| {
            format!(
                r#"<constant name="{name}" value="{value}" c:type="S_{name}"><type name="{ty}" c:type="{c_type}"/></constant>"#
            )
        };
        let xml = [
            r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0"
            xmlns:glib="http://www.gtk.org/introspection/glib/1.0">
            <c:include name="s.h"/><namespace name="S" version="1.0">"#,
            r#"<record name="Rect" c:type="SRect"><field name="x" writable="1"><type name="gint" c:type="gint"/></field></record>"#,
            &constant("GROUP", "Desktop Entry", "utf8", "gchar*"),
            &constant("QUOTED", r"say &quot;SRect&quot;\&#10;", "utf8", "gchar*"),
            &constant("LIMIT", "7", "gint", "gint"),
            "</namespace></repository>",
        ]
        .concat();
        std::fs::write(dir.join("S-1.0.gir"), xml).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("S-1.0", &[search]).expect("parse GIR");
        let namespace = &repository.namespaces["S"];
        let binding = bind(
            &repository,
            namespace,
            &super::super::facts::Facts::default(),
        );
        let declared = |binding: &super::Binding| {
            binding
                .constants
                .iter()
                .map(|c| (c.name.clone(), c.ts.clone(), c.value.clone()))
                .collect::<Vec<_>>()
        };
        let quoted = r#""say \"SRect\"\\\n""#;
        assert_eq!(
            declared(&binding),
            [
                ("S_GROUP".to_owned(), r#""Desktop Entry""#.to_owned(), None),
                ("S_QUOTED".to_owned(), quoted.to_owned(), None),
                (
                    "S_LIMIT".to_owned(),
                    "c_int".to_owned(),
                    Some("7".to_owned())
                ),
            ]
        );
        let text = emit::declarations(&binding, "test");
        assert!(!text.contains("@ntsConstant Desktop"), "{text}");
        assert!(
            text.contains("  export const S_GROUP: \"Desktop Entry\";\n"),
            "{text}"
        );
        assert!(
            text.contains("  /** @ntsConstant 7 */\n  export const S_LIMIT: c_int;\n"),
            "{text}"
        );
        let gi = naming::gi(&binding, namespace, &naming::Names::of(&repository));
        assert_eq!(
            declared(&gi),
            [
                ("GROUP".to_owned(), r#""Desktop Entry""#.to_owned(), None),
                ("QUOTED".to_owned(), quoted.to_owned(), None),
                ("LIMIT".to_owned(), "c_int".to_owned(), Some("7".to_owned())),
            ]
        );
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }

    /// A string is one `*`. A `utf8` behind more -- a list of strings GIR
    /// does not call an array, a slot it does not call out -- is the raw
    /// pointer the header writes, down to its `char`, and never the one
    /// string it is not. The control is a `const gchar *`: a string.
    #[test]
    fn a_string_is_one_pointer_and_one_behind_more_is_raw() {
        use super::bind;
        let dir =
            crate::bind_scratch::directory("gir-string-depth-test").expect("fixture directory");
        let function = |name: &str, c_type: &str| {
            format!(
                r#"<function name="{name}" c:identifier="s_{name}"><return-value><type name="none" c:type="void"/></return-value><parameters><parameter name="text" transfer-ownership="none" nullable="1"><type name="utf8" c:type="{c_type}"/></parameter></parameters></function>"#
            )
        };
        let xml = [
            r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0">
            <c:include name="s.h"/><namespace name="S" version="1.0">"#,
            &function("domains", "const gchar* const*"),
            &function("parse", "const gchar**"),
            &function("name", "const gchar*"),
            "</namespace></repository>",
        ]
        .concat();
        std::fs::write(dir.join("S-1.0.gir"), xml).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("S-1.0", &[search]).expect("parse GIR");
        let binding = bind(
            &repository,
            &repository.namespaces["S"],
            &super::super::facts::Facts::default(),
        );
        assert!(binding.refused.is_empty(), "{:?}", binding.refused);
        let spelled = |symbol: &str| {
            binding
                .functions
                .iter()
                .find(|f| f.symbol == symbol)
                .map_or_else(
                    || panic!("{symbol} is not bound"),
                    |f| f.parameters[0].1.ts.clone(),
                )
        };
        assert_eq!(
            spelled("s_domains"),
            "ConstPtr<ConstPtr<c_char> | null> | null"
        );
        assert_eq!(spelled("s_parse"), "Ptr<ConstPtr<c_char> | null> | null");
        assert_eq!(spelled("s_name"), "string | null");
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }

    /// An out or inout record whose header type is `T *` is storage the
    /// caller gives, whatever GIR says of caller-allocates: a boxed record's
    /// own box (`new SPoint()`), or the object an opaque one's maker made.
    /// The control is the header's `T **`, a slot the callee writes a record
    /// it allocated into.
    #[test]
    fn a_records_pointer_is_storage_by_its_header_depth() {
        use super::super::facts;
        use super::{Shape, bind};
        let dir =
            crate::bind_scratch::directory("gir-record-storage-test").expect("fixture directory");
        let function = |name: &str, parameter: &str| {
            format!(
                r#"<function name="{name}" c:identifier="s_{name}"><return-value><type name="none" c:type="void"/></return-value><parameters>{parameter}</parameters></function>"#
            )
        };
        let xml = [
            r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0"
            xmlns:glib="http://www.gtk.org/introspection/glib/1.0">
            <c:include name="s.h"/><namespace name="S" version="1.0">"#,
            r#"<record name="Point" c:type="SPoint" glib:get-type="s_point_get_type"><field name="x" writable="1"><type name="gint" c:type="gint"/></field></record>"#,
            r#"<record name="Set" c:type="SSet" opaque="1" glib:get-type="s_set_get_type"/>"#,
            &function(
                "next",
                r#"<parameter name="point" direction="inout" caller-allocates="0" transfer-ownership="none"><type name="Point" c:type="SPoint*"/></parameter>"#,
            ),
            &function(
                "start",
                r#"<parameter name="point" direction="out" caller-allocates="0" transfer-ownership="none"><type name="Point" c:type="SPoint*"/></parameter>"#,
            ),
            &function(
                "collect",
                r#"<parameter name="set" direction="out" caller-allocates="0" transfer-ownership="none"><type name="Set" c:type="SSet*"/></parameter>"#,
            ),
            &function(
                "take",
                r#"<parameter name="point" direction="out" caller-allocates="0" transfer-ownership="full"><type name="Point" c:type="SPoint**"/></parameter>"#,
            ),
            "</namespace></repository>",
        ]
        .concat();
        std::fs::write(dir.join("S-1.0.gir"), xml).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("S-1.0", &[search]).expect("parse GIR");
        let header = facts::Facts {
            tags: ["SPoint", "SSet"]
                .map(|c| (c.to_owned(), format!("_{c}")))
                .into(),
            sizes: [("SPoint".to_owned(), 4)].into(),
            declared: ["s_point_get_type", "s_set_get_type"]
                .map(str::to_owned)
                .into(),
            ..facts::Facts::default()
        };
        let binding = bind(&repository, &repository.namespaces["S"], &header);
        let parameter = |symbol: &str| {
            binding
                .functions
                .iter()
                .find(|f| f.symbol == symbol)
                .map_or_else(
                    || panic!("{symbol}: {:?}", binding.refused),
                    |f| f.parameters[0].1.clone(),
                )
        };
        assert_eq!(parameter("s_next").ts, "SPoint");
        let start = parameter("s_start");
        assert_eq!(start.ts, "SPoint");
        assert!(matches!(start.shape, Shape::Filled { .. }), "{start:?}");
        assert_eq!(parameter("s_collect").ts, "SSet");
        // The header's `T **`: a slot the callee writes, never storage.
        let take = parameter("s_take");
        assert!(
            !matches!(take.shape, Shape::Filled { .. }) && take.ts != "SPoint",
            "{take:?}"
        );
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }

    /// Every constant the binding cannot state is a row in the ledger, with
    /// what it is. The controls are the ones it can: an exact integer and a
    /// string, bound.
    #[test]
    fn a_constant_left_unbound_is_a_row_in_the_ledger() {
        use super::super::facts;
        use super::{Reason, bind};
        use std::fmt::Write as _;
        let dir = crate::bind_scratch::directory("gir-constants-test").expect("fixture directory");
        let mut xml = String::from(
            r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0">
            <c:include name="k.h"/><namespace name="K" version="1.0">"#,
        );
        for (name, ty, value) in [
            ("EXACT", "gint", "7"),
            ("TEXT", "utf8", "seven"),
            ("ROUNDED", "gdouble", "2.718282"),
            ("WIDE", "gint64", "9223372036854775807"),
            ("TRUTH", "gboolean", "true"),
            ("ALIASED", "Glyph", "7"),
        ] {
            let _ = write!(
                xml,
                r#"<constant name="{name}" value="{value}" c:type="K_{name}"><type name="{ty}"/></constant>"#
            );
        }
        xml.push_str("</namespace></repository>");
        std::fs::write(dir.join("K-1.0.gir"), xml).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("K-1.0", &[search]).expect("parse GIR");
        let binding = bind(
            &repository,
            &repository.namespaces["K"],
            &facts::Facts::default(),
        );
        assert_eq!(
            binding
                .constants
                .iter()
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>(),
            ["K_EXACT", "K_TEXT"]
        );
        let refused = |name: &str| {
            binding
                .refused
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, r)| r.clone())
        };
        for (name, why) in [
            (
                "K_ROUNDED",
                "`2.718282`, a floating value GIR writes rounded",
            ),
            (
                "K_WIDE",
                "`9223372036854775807`, beyond the 2^53 a fold holds exactly",
            ),
            ("K_TRUTH", "a boolean, which `@ntsConstant` does not carry"),
            ("K_ALIASED", "a `Glyph`, a type no constant is bound in yet"),
        ] {
            assert_eq!(
                refused(name),
                Some(Reason::Constant(why.to_owned())),
                "{name}"
            );
        }
        assert_eq!(refused("K_EXACT"), None);
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }

    /// A pointer record (GIR's `pointer="1"`) spelled bare is its handle,
    /// `const` where its typedef points `const`; spelled `q_lang_t *` as an
    /// out slot it is a pointer to that handle, one level more and no other;
    /// as an input it stays refused. The control: the same GIR without the
    /// headers' answer, which stays a record passed by value.
    #[test]
    fn a_pointer_record_spelled_bare_is_its_handle() {
        use super::super::facts;
        use super::{Reason, bind};
        use nts_core::hir::native::{Handle, Pointee, Type};
        let dir = crate::bind_scratch::directory("gir-pointer-test").expect("fixture directory");
        let xml = r#"<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0">
            <c:include name="q.h"/><namespace name="Q" version="1.0">
            <record name="lang_t" c:type="q_lang_t" disguised="1" pointer="1"/>
            <function name="lang_get" c:identifier="q_lang_get">
            <return-value transfer-ownership="none"><type name="lang_t" c:type="q_lang_t"/></return-value>
            </function>
            <function name="lang_set" c:identifier="q_lang_set">
            <return-value><type name="none" c:type="void"/></return-value>
            <parameters><parameter name="lang"><type name="lang_t" c:type="q_lang_t"/></parameter></parameters>
            </function>
            <function name="lang_out" c:identifier="q_lang_out">
            <return-value><type name="none" c:type="void"/></return-value>
            <parameters><parameter name="lang" direction="out" caller-allocates="0" transfer-ownership="none">
            <type name="lang_t" c:type="q_lang_t*"/></parameter></parameters>
            </function>
            <function name="lang_in" c:identifier="q_lang_in">
            <return-value><type name="none" c:type="void"/></return-value>
            <parameters><parameter name="lang"><type name="lang_t" c:type="q_lang_t*"/></parameter></parameters>
            </function>
            </namespace></repository>"#;
        std::fs::write(dir.join("Q-1.0.gir"), xml).expect("GIR");
        let search = camino::Utf8PathBuf::from_path_buf(dir.clone()).expect("UTF-8 path");
        let repository = super::super::parse::repository("Q-1.0", &[search]).expect("parse GIR");
        let namespace = &repository.namespaces["Q"];
        assert!(namespace.records[0].pointer);
        let header = facts::Facts {
            pointers: [(
                "q_lang_t".to_owned(),
                facts::PointerRecord {
                    tag: "q_lang_impl".to_owned(),
                    constant: true,
                },
            )]
            .into(),
            ..facts::Facts::default()
        };
        let binding = bind(&repository, namespace, &header);
        let function = |name: &str| {
            binding
                .functions
                .iter()
                .find(|f| f.symbol == name)
                .unwrap_or_else(|| panic!("{name} bound: {:?}", binding.refused))
        };
        let pointee = Pointee::Const(Box::new(Pointee::Opaque(Handle::from("q_lang_impl"))));
        let handle = Type::Pointer(pointee.clone());
        let get = function("q_lang_get");
        assert_eq!(get.result.ts, "Const<q_lang_t>");
        assert_eq!(get.result.c, handle);
        let set = function("q_lang_set");
        assert_eq!(set.parameters[0].1.ts, "Const<q_lang_t>");
        assert_eq!(set.parameters[0].1.c, handle);
        // The out slot: a pointer to the handle, exactly one level more.
        let out = function("q_lang_out");
        assert_eq!(
            out.parameters[0].1.c,
            Type::Pointer(Pointee::Pointer(Box::new(pointee))),
            "{:?}",
            out.parameters[0].1
        );
        // An input `q_lang_t *` is not a handle, and is not taken for one.
        assert!(
            binding
                .refused
                .iter()
                .any(|(n, r)| n == "q_lang_in" && matches!(r, Reason::NoTag(_))),
            "{:?}",
            binding.refused
        );
        assert!(
            binding
                .types
                .iter()
                .any(|t| matches!(t, super::TypeDecl::Class { name, tag, .. } if name == "q_lang_t" && tag == "q_lang_impl"))
        );
        // The control: no answer from the headers, so a record by value.
        let control = bind(&repository, namespace, &facts::Facts::default());
        for name in ["q_lang_get", "q_lang_set"] {
            assert!(
                control
                    .refused
                    .iter()
                    .any(|(n, r)| n == name && *r == Reason::RecordByValue),
                "{name}: {:?}",
                control.refused
            );
        }
        std::fs::remove_dir_all(dir).expect("remove fixture");
    }
}

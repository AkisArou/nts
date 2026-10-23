//! Direct semantic facts from one persistent first checker per program.
//!
//! Views cannot cross a checking-thread boundary:
//! ```compile_fail
//! use nts_frontend_tsrs::Type;
//! fn require_send<T: Send>() {}
//! require_send::<Type<'static>>();
//! ```
//! A revision cannot change while a semantic view is still used:
//! ```compile_fail
//! use nts_frontend_tsrs::{Session, ProjectSpec, SourceChanges};
//! fn invalid(session: &mut Session, spec: ProjectSpec) {
//!     let checked = session.open(spec).unwrap();
//!     let file = checked.projects().next().unwrap().files().next().unwrap();
//!     let ty = file.root().ty();
//!     session.revise(SourceChanges::default()).unwrap();
//!     let _ = ty.kind();
//! }
//! ```

#[cfg(test)]
#[path = "semantic_test.rs"]
mod tests;

#[path = "semantic_graph.rs"]
mod graph;
pub use graph::*;

#[path = "symbol_name.rs"]
mod names;
pub use names::{InternalName, SymbolName};

use std::fmt;
use std::hash::{Hash, Hasher};

use tsrs_ast::{Symbol as NativeSymbol, SymbolFlags};
use tsrs_checker::{
    CheckMode, ObjectFlags, Signature as NativeSignature, Type as NativeType, TypeData, TypeFlags,
    TypeFormatFlags,
};
use tsrs_core::P;

use crate::{File, JsString, Node};

macro_rules! view {
    ($name:ident, $native:ty) => {
        #[derive(Clone, Copy)]
        pub struct $name<'p> {
            native: P<$native>,
            file: File<'p>,
        }
        impl fmt::Debug for $name<'_> {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.debug_struct(stringify!($name))
                    .field("program", &self.file.program_path())
                    .finish_non_exhaustive()
            }
        }
        impl PartialEq for $name<'_> {
            fn eq(&self, other: &Self) -> bool {
                self.native == other.native && self.file.same_program(other.file)
            }
        }
        impl Eq for $name<'_> {}
        impl Hash for $name<'_> {
            fn hash<H: Hasher>(&self, hash: &mut H) {
                self.native.hash(hash);
                self.file.program_identity().hash(hash);
            }
        }
    };
}
view!(Symbol, NativeSymbol);
view!(Type, NativeType);
view!(Signature, NativeSignature);

pub type Declaration<'p> = Node<'p>;

impl<'p> Node<'p> {
    #[must_use]
    pub fn constant(self) -> Option<Constant<'p>> {
        let file = self.source_file();
        let value = file.with_checker(|c| c.get_constant_value(self.native))?;
        match value {
            tsrs_checker::LiteralValue::Number(value) => Some(Constant::Number(value.0)),
            tsrs_checker::LiteralValue::String(text) => {
                Some(Constant::String(file.intern_string(text.as_bytes())))
            }
            tsrs_checker::LiteralValue::Boolean(_) | tsrs_checker::LiteralValue::BigInt(_) => None,
        }
    }
    #[must_use]
    pub fn symbol(self) -> Option<Symbol<'p>> {
        let file = self.source_file();
        let native = file.with_checker(|c| c.get_symbol_at_location_exported(self.native));
        native.map(|native| Symbol::new(native, file))
    }
    #[must_use]
    pub fn ty(self) -> Type<'p> {
        let file = self.source_file();
        Type {
            native: file.with_checker(|c| c.get_type_at_location(self.native)),
            file,
        }
    }
    #[must_use]
    pub fn resolved_signature(self) -> Option<Signature<'p>> {
        if !matches!(
            self.native.kind(),
            tsrs_ast::Kind::CallExpression | tsrs_ast::Kind::NewExpression
        ) {
            return None;
        }
        let file = self.source_file();
        Some(Signature {
            native: file
                .with_checker(|c| c.get_resolved_signature(self.native, None, CheckMode::Normal)),
            file,
        })
    }
    #[must_use]
    pub fn type_text(self) -> String {
        let text = self.source_file().with_checker(|c| {
            let ty = c.get_type_at_location(self.native);
            c.type_to_string_ex_exported(ty, Some(self.native), TypeFormatFlags::None, None)
        });
        crate::strings::display(text.as_bytes())
    }
}

impl<'p> File<'p> {
    #[must_use]
    pub fn module_symbol(self) -> Option<Symbol<'p>> {
        self.root().symbol()
    }
}

impl<'p> Symbol<'p> {
    fn new(native: P<NativeSymbol>, file: File<'p>) -> Self {
        let native = file.with_checker(|c| c.get_merged_symbol_exported(native));
        Self { native, file }
    }
    #[must_use]
    pub fn name(self) -> SymbolName<'p> {
        self.name_in(names::NameTable::Automatic)
    }
    #[must_use]
    pub fn classification(self) -> SymbolClassification {
        let flags = self.file.with_checker(|_| self.native.flags());
        SymbolClassification {
            alias: flags.intersects(SymbolFlags::Alias),
            module: flags.intersects(SymbolFlags::Module),
            type_literal: flags.intersects(SymbolFlags::TypeLiteral),
            object_literal: flags.intersects(SymbolFlags::ObjectLiteral),
            method: flags.intersects(SymbolFlags::Method),
            getter: flags.intersects(SymbolFlags::GetAccessor),
            setter: flags.intersects(SymbolFlags::SetAccessor),
            optional: flags.intersects(SymbolFlags::Optional),
            variable: flags.intersects(SymbolFlags::Variable),
            function: flags.intersects(SymbolFlags::Function),
            class: flags.intersects(SymbolFlags::Class),
            interface: flags.intersects(SymbolFlags::Interface),
            type_alias: flags.intersects(SymbolFlags::TypeAlias),
            enum_: flags.intersects(SymbolFlags::Enum),
            property: flags.intersects(SymbolFlags::Property),
        }
    }
    pub fn declarations(self) -> impl ExactSizeIterator<Item = Declaration<'p>> {
        let declarations = self.file.with_checker(|_| self.native.declarations());
        declarations.iter().map(move |&native| {
            self.file
                .node_view(native)
                .expect("native declaration must have a source in its program")
        })
    }
    #[must_use]
    pub fn alias_target(self) -> Option<Self> {
        if !self.classification().alias {
            return None;
        }
        let native = self
            .file
            .with_checker(|c| c.get_aliased_symbol(self.native));
        Some(Self::new(native, self.file))
    }
    #[must_use]
    pub fn exports(self) -> Vec<Export<'p>> {
        if !self.classification().module {
            return Vec::new();
        }
        self.file
            .with_checker(|c| {
                let mut exports = c.get_exports_of_module_exported(self.native);
                if let Some(assignment) = self.native.exports().and_then(|table| {
                    table
                        .get()
                        .get(tsrs_ast::INTERNAL_SYMBOL_NAME_EXPORT_EQUALS)
                }) && !exports.contains(&assignment)
                {
                    exports.push(assignment);
                }
                exports
            })
            .into_iter()
            .map(|native| {
                let symbol = Self::new(native, self.file);
                Export {
                    name: symbol.name_in(names::NameTable::Export),
                    symbol,
                }
            })
            .collect()
    }
    #[must_use]
    pub fn ty(self) -> Type<'p> {
        Type {
            native: self
                .file
                .with_checker(|c| c.get_type_of_symbol(self.native)),
            file: self.file,
        }
    }
    #[must_use]
    pub fn ty_at(self, location: Node<'p>) -> Option<Type<'p>> {
        self.file.assert_same_program(location.source_file());
        self.file
            .with_checker(|c| c.get_type_of_symbol_at_location(self.native, Some(location.native)))
            .map(|native| Type {
                native,
                file: self.file,
            })
    }
    #[must_use]
    pub fn declared_type(self) -> Option<Type<'p>> {
        let flags = self.file.with_checker(|_| self.native.flags());
        if !flags.intersects(SymbolFlags::Type) {
            return None;
        }
        Some(Type {
            native: self
                .file
                .with_checker(|c| c.get_declared_type_of_symbol(self.native)),
            file: self.file,
        })
    }
    #[must_use]
    pub fn readonly(self) -> bool {
        self.file
            .with_checker(|c| c.is_readonly_symbol_exported(self.native))
    }
}

#[derive(Debug, Clone, Copy)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "merged symbols combine independent semantic categories"
)]
pub struct SymbolClassification {
    pub alias: bool,
    pub module: bool,
    pub type_literal: bool,
    pub object_literal: bool,
    pub method: bool,
    pub getter: bool,
    pub setter: bool,
    pub optional: bool,
    pub variable: bool,
    pub function: bool,
    pub class: bool,
    pub interface: bool,
    pub type_alias: bool,
    pub enum_: bool,
    pub property: bool,
}
#[derive(Debug, Clone, Copy)]
pub struct Export<'p> {
    pub name: SymbolName<'p>,
    pub symbol: Symbol<'p>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TypeKind {
    Any,
    Unknown,
    Never,
    Void,
    Undefined,
    Null,
    Boolean,
    String,
    Number,
    BigInt,
    Symbol,
    UniqueSymbol,
    Literal,
    TypeParameter,
    Union,
    Intersection,
    Tuple,
    Reference,
    Object,
    Conditional,
    IndexedAccess,
    Template,
    Substitution,
    NonPrimitive,
    /// A builder must emit a named unsupported-type refusal, never erase it or substitute any.
    Other,
}

#[derive(Debug, Clone, Copy)]
pub enum TypeLiteral<'p> {
    String(JsString<'p>),
    Number(f64),
    Boolean(bool),
    BigInt { negative: bool, digits: &'p str },
}

impl<'p> Type<'p> {
    #[must_use]
    pub fn kind(self) -> TypeKind {
        self.file.with_checker(|_| {
            let flags = self.native.flags.get();
            if flags.intersects(
                TypeFlags::StringLiteral
                    | TypeFlags::NumberLiteral
                    | TypeFlags::BooleanLiteral
                    | TypeFlags::BigIntLiteral,
            ) {
                return TypeKind::Literal;
            }
            for (native, kind) in [
                (TypeFlags::Any, TypeKind::Any),
                (TypeFlags::Unknown, TypeKind::Unknown),
                (TypeFlags::Never, TypeKind::Never),
                (TypeFlags::Void, TypeKind::Void),
                (TypeFlags::Undefined, TypeKind::Undefined),
                (TypeFlags::Null, TypeKind::Null),
                (TypeFlags::Boolean, TypeKind::Boolean),
                (TypeFlags::String, TypeKind::String),
                (TypeFlags::Number | TypeFlags::Enum, TypeKind::Number),
                (TypeFlags::BigInt, TypeKind::BigInt),
                (TypeFlags::UniqueESSymbol, TypeKind::UniqueSymbol),
                (TypeFlags::ESSymbol, TypeKind::Symbol),
                (TypeFlags::TypeParameter, TypeKind::TypeParameter),
                (TypeFlags::Union, TypeKind::Union),
                (TypeFlags::Intersection, TypeKind::Intersection),
                (TypeFlags::Conditional, TypeKind::Conditional),
                (TypeFlags::IndexedAccess, TypeKind::IndexedAccess),
                (TypeFlags::TemplateLiteral, TypeKind::Template),
                (TypeFlags::Substitution, TypeKind::Substitution),
                (TypeFlags::NonPrimitive, TypeKind::NonPrimitive),
            ] {
                if flags.intersects(native) {
                    return kind;
                }
            }
            if self.native.is_tuple_type() {
                TypeKind::Tuple
            } else if self
                .native
                .object_flags
                .get_lazy()
                .intersects(ObjectFlags::Reference)
            {
                TypeKind::Reference
            } else if flags.intersects(TypeFlags::Object) {
                TypeKind::Object
            } else {
                TypeKind::Other
            }
        })
    }
    #[must_use]
    pub fn symbol(self) -> Option<Symbol<'p>> {
        self.file
            .with_checker(|_| self.native.symbol())
            .map(|native| Symbol::new(native, self.file))
    }
    #[must_use]
    pub fn non_inferrable(self) -> bool {
        self.file.with_checker(|_| {
            self.native
                .object_flags
                .get_lazy()
                .intersects(ObjectFlags::NonInferrableType)
        })
    }
    #[must_use]
    pub fn evolving_any(self) -> bool {
        self.file.with_checker(|_| {
            let objects = self.native.object_flags.get_lazy();
            objects.intersects(ObjectFlags::EvolvingArray)
                || (self.native.flags.get().intersects(TypeFlags::Any)
                    && objects.intersects(ObjectFlags::NonInferrableType))
        })
    }
    #[must_use]
    pub fn literal(self) -> Option<TypeLiteral<'p>> {
        let value = self.file.with_checker(|_| match self.native.data() {
            TypeData::Literal(data) => data.value(),
            TypeData::Intrinsic(data)
                if self
                    .native
                    .flags
                    .get()
                    .intersects(TypeFlags::BooleanLiteral) =>
            {
                match data.intrinsic_name() {
                    "true" => Some(tsrs_checker::LiteralValue::Boolean(true)),
                    "false" => Some(tsrs_checker::LiteralValue::Boolean(false)),
                    _ => None,
                }
            }
            _ => None,
        })?;
        Some(match value {
            tsrs_checker::LiteralValue::String(text) => {
                TypeLiteral::String(self.file.intern_string(text.as_bytes()))
            }
            tsrs_checker::LiteralValue::Number(value) => TypeLiteral::Number(value.0),
            tsrs_checker::LiteralValue::Boolean(value) => TypeLiteral::Boolean(value),
            tsrs_checker::LiteralValue::BigInt(value) => TypeLiteral::BigInt {
                negative: value.negative,
                digits: if value.base10_value.is_empty() {
                    "0"
                } else {
                    value.base10_value
                },
            },
        })
    }
    #[must_use]
    pub fn signatures(self, kind: SignatureKind) -> Vec<Signature<'p>> {
        let native_kind = match kind {
            SignatureKind::Call => tsrs_checker::SignatureKind::Call,
            SignatureKind::Construct => tsrs_checker::SignatureKind::Construct,
        };
        self.file
            .with_checker(|c| c.get_signatures_of_type(self.native, native_kind))
            .iter()
            .map(|&native| Signature {
                native,
                file: self.file,
            })
            .collect()
    }
    #[must_use]
    pub fn assignable_to(self, target: Self) -> bool {
        self.file.assert_same_program(target.file);
        self.file
            .with_checker(|c| c.is_type_assignable_to(self.native, target.native))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SignatureKind {
    Call,
    Construct,
}
#[derive(Debug, Clone)]
pub struct Parameter<'p> {
    pub symbol: Symbol<'p>,
    pub name: SymbolName<'p>,
    pub ty: Type<'p>,
    pub declarations: Vec<Declaration<'p>>,
    pub optional: bool,
    pub has_initializer: bool,
    pub rest: bool,
}
impl<'p> Signature<'p> {
    #[must_use]
    pub fn predicate(self) -> Option<TypePredicate<'p>> {
        use tsrs_checker::TypePredicateKind;
        let (kind, index, name, ty) = self.file.with_checker(|c| {
            let predicate = c.get_type_predicate_of_signature_exported(self.native)?;
            Some((
                predicate.kind(),
                predicate.parameter_index(),
                predicate.parameter_name(),
                predicate.type_(),
            ))
        })?;
        let subject = match kind {
            TypePredicateKind::This | TypePredicateKind::AssertsThis => PredicateSubject::This,
            TypePredicateKind::Identifier | TypePredicateKind::AssertsIdentifier => {
                PredicateSubject::Parameter {
                    name: self.file.intern_string(name.as_bytes()),
                    index: index.expect("native identifier predicate has a parameter index"),
                }
            }
        };
        Some(TypePredicate {
            asserts: matches!(
                kind,
                TypePredicateKind::AssertsThis | TypePredicateKind::AssertsIdentifier
            ),
            subject,
            narrowed_type: ty.map(|native| Type {
                native,
                file: self.file,
            }),
        })
    }
    #[must_use]
    pub fn declaration(self) -> Option<Declaration<'p>> {
        self.file
            .with_checker(|_| self.native.declaration())
            .map(|native| {
                self.file
                    .node_view(native)
                    .expect("signature declaration must have a source in its program")
            })
    }
    fn parameter(self, native: P<NativeSymbol>, optional: bool, rest: bool) -> Parameter<'p> {
        let symbol = Symbol::new(native, self.file);
        let declarations: Vec<_> = symbol.declarations().collect();
        let has_initializer = declarations.iter().any(|d| d.attributes().has_initializer);
        let optional = optional || declarations.iter().any(|d| d.attributes().optional);
        Parameter {
            symbol,
            name: symbol.name(),
            ty: symbol.ty(),
            declarations,
            optional,
            has_initializer,
            rest,
        }
    }
    #[must_use]
    pub fn parameters(self) -> Vec<Parameter<'p>> {
        let (parameters, minimum, rest) = self.file.with_checker(|_| {
            (
                self.native.parameters(),
                self.native.min_argument_count(),
                self.native.has_rest_parameter(),
            )
        });
        parameters
            .iter()
            .enumerate()
            .map(|(index, &native)| {
                self.parameter(
                    native,
                    index >= minimum,
                    rest && index + 1 == parameters.len(),
                )
            })
            .collect()
    }
    #[must_use]
    pub fn return_type(self) -> Type<'p> {
        Type {
            native: self
                .file
                .with_checker(|c| c.get_return_type_of_signature(self.native)),
            file: self.file,
        }
    }
    #[must_use]
    pub fn type_parameters(self) -> Vec<Type<'p>> {
        self.file
            .with_checker(|_| self.native.type_parameters())
            .iter()
            .map(|&native| Type {
                native,
                file: self.file,
            })
            .collect()
    }
    #[must_use]
    pub fn this_parameter(self) -> Option<Parameter<'p>> {
        self.file
            .with_checker(|_| self.native.this_parameter())
            .map(|native| {
                let mut parameter = self.parameter(native, false, false);
                parameter.name = parameter.symbol.name_in(names::NameTable::ThisParameter);
                parameter
            })
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Constant<'p> {
    Number(f64),
    String(JsString<'p>),
}
#[derive(Debug, Clone, Copy)]
pub struct TypePredicate<'p> {
    pub asserts: bool,
    pub subject: PredicateSubject<'p>,
    pub narrowed_type: Option<Type<'p>>,
}
#[derive(Debug, Clone, Copy)]
pub enum PredicateSubject<'p> {
    This,
    Parameter { name: JsString<'p>, index: usize },
}

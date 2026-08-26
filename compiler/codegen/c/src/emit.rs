//! Emitting C from HIR.
//!
//! # A printer, not a decision-maker
//!
//! Block order and the copies a block-parameter edge implies are decided in
//! `nts-codegen-common`, so nothing here chooses anything a JVM emitter would
//! have to choose again. What is left is spelling.
//!
//! # Scalars only, for now
//!
//! A managed reference needs a runtime — an allocator, a header, a collector —
//! and none of that exists yet. Rather than emit a plausible `char *` and pretend,
//! a function touching a managed type is refused. RFC §4.1 again: the failure has
//! to be visible.

use nts_codegen_common::{CodeWriter, Copy, block_order, destruct};
use nts_core::hir::{
    BinOp, BlockId, Callee, Func, HirType, ManagedType, OpKind, Program, Terminator, UnOp, ValueId,
};
use nts_diagnostics::Diagnostic;
use nts_semantic_schema::Origin;

/// The C runtime, as source.
///
/// Real C compiled as its own translation unit rather than text pasted into
/// every generated file. It lives under `runtime/c/` and is included here, so
/// it can be read, edited and reviewed as C -- and so an unused external
/// function is not a warning, which is what let the whole "work out which
/// helpers this program reaches" apparatus be deleted.
pub const RUNTIME_HEADER_NAME: &str = "nts_runtime.h";
pub const RUNTIME_HEADER: &str = include_str!("../../../../runtime/c/nts_runtime.h");
pub const RUNTIME_SOURCE_NAME: &str = "nts_runtime.c";
pub const RUNTIME_SOURCE: &str = include_str!("../../../../runtime/c/nts_runtime.c");

/// Every value some operation or terminator in a function reads.
fn values_read(func: &Func) -> rustc_hash::FxHashSet<ValueId> {
    let mut read = rustc_hash::FxHashSet::default();
    for block in &func.blocks {
        read.extend(nts_core::hir::operands_of_terminator(&block.terminator));
        for value in &block.ops {
            read.extend(nts_core::hir::operands_of(
                &func.values[value.0 as usize].kind,
            ));
        }
    }
    read
}

/// What an emitter needs beyond the function it is emitting.
///
/// Layouts come from the program because a field's name and position are a
/// property of its *type*, not of the function reading it; literals come from
/// the program because two functions naming the same string must reach the same
/// static.
struct Context<'a> {
    program: &'a Program,
    literals: &'a [String],
    /// Values something in this function reads.
    ///
    /// A call whose result nobody wants still has to happen, so dead-code
    /// elimination keeps it — but assigning it to a local nobody reads is
    /// `-Wunused-but-set-variable`, which is an error under the flags the
    /// generated file is compiled with. `c.advance();` as a statement is
    /// exactly that.
    read: rustc_hash::FxHashSet<ValueId>,
}

/// C for one program, and what could not be emitted.
#[derive(Debug)]
pub struct Emitted {
    pub writer: CodeWriter,
    pub diagnostics: Vec<Diagnostic>,
}

impl Emitted {
    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.diagnostics.is_empty()
    }
}

/// Emit a whole program as one translation unit.
#[must_use]
pub fn emit(program: &Program) -> Emitted {
    let mut writer = CodeWriter::new();
    let mut diagnostics = Vec::new();

    let Some(first) = program.funcs.first() else {
        return Emitted {
            writer,
            diagnostics,
        };
    };
    let origin = first.origin.clone();

    // Each function is emitted speculatively and kept only if it succeeded. A
    // half-emitted function is worse than an absent one: it declares a signature
    // and a body that does not return, which compiles into a callable shell.
    // Two different TypeScript names can mangle to one C name — `double` and
    // `double_` both become `double_`. Emitting both would produce a redefinition
    // error far from its cause, so it is caught here where the cause is known.
    let mut claimed: rustc_hash::FxHashMap<String, &str> = rustc_hash::FxHashMap::default();
    for func in &program.funcs {
        let c_name = c_identifier(&func.name);
        if let Some(previous) = claimed.insert(c_name.clone(), &func.name)
            && previous != func.name
        {
            diagnostics.push(Diagnostic::error(
                "NTS2004",
                format!(
                    "`{}` and `{previous}` both need the C name `{c_name}`",
                    func.name
                ),
                func.origin.location,
            ));
        }
    }

    // Collected before emission so that every reference names the same static.
    let mut literals: Vec<String> = Vec::new();
    for func in &program.funcs {
        for op in &func.values {
            if let OpKind::ConstString(text) = &op.kind
                && !literals.contains(text)
            {
                literals.push(text.clone());
            }
        }
    }

    let mut bodies = Vec::new();
    for func in &program.funcs {
        let mut body = CodeWriter::new();
        let context = Context {
            program,
            literals: &literals,
            read: values_read(func),
        };
        match emit_func(&mut body, func, &context) {
            Ok(signature) => bodies.push((signature, body, func)),
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }

    let descriptors = descriptors_reached(&bodies);

    writer.line(&origin, "/* Generated by nts. Do not edit. */");
    // The runtime, and nothing else -- notably not <stdlib.h>, which declares
    // `div`, a name a TypeScript program is entitled to use.
    writer.line(&origin, format!("#include \"{RUNTIME_HEADER_NAME}\""));
    emit_object_types(&mut writer, &origin, program);
    emit_descriptors(&mut writer, &origin, &descriptors);
    emit_literals(&mut writer, &origin, &literals);

    // Forward declarations, so a call does not depend on definition order — and
    // only for functions that actually have a definition.
    for (signature, _, _) in &bodies {
        writer.line(&origin, format!("{signature};"));
    }
    writer.blank(&origin);

    for (_, body, _) in bodies {
        writer.append(body);
    }

    Emitted {
        writer,
        diagnostics,
    }
}

/// Identifiers C will not let us use for a function.
///
/// C11 keywords, the macros `<stdbool.h>` defines, `main`, and the standard
/// library names declared by the headers the runtime needs. TypeScript has no
/// such restriction, so `function double()` and `function div()` are both
/// perfectly good source that cannot be spelled that way in C.
///
/// # The real fix, not done here
///
/// This list is bounded only by which headers the generated file includes, and
/// that is the wrong thing to depend on: adding one header could rename a user's
/// exported function. The runtime belongs in its own translation unit, with a
/// header declaring only the types and prototypes -- then the generated file
/// includes no system headers at all and the collision surface is the runtime's
/// own `nts_` prefix. That is a separate slice; this list makes the current
/// arrangement correct in the meantime.
const RESERVED: &[&str] = &[
    // C11 keywords and the macros <stdbool.h> defines.
    "alignas",
    "alignof",
    "auto",
    "bool",
    "break",
    "case",
    "char",
    "const",
    "constexpr",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extern",
    "false",
    "float",
    "for",
    "goto",
    "if",
    "inline",
    "int",
    "long",
    "main",
    "nullptr",
    "register",
    "restrict",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "static_assert",
    "struct",
    "switch",
    "thread_local",
    "true",
    "typedef",
    "typeof",
    "union",
    "unsigned",
    "void",
    "volatile",
    "while",
    // <math.h>, which the runtime header pulls in for the float builtins the
    // emitter uses directly. This is the whole collision surface now: a
    // generated file includes the runtime header and nothing else, so it no
    // longer picks up the hundreds of names <stdio.h> and <stdlib.h> declare.
    "acos",
    "asin",
    "atan",
    "atan2",
    "cbrt",
    "ceil",
    "cos",
    "cosh",
    "exp",
    "fabs",
    "floor",
    "fmax",
    "fmin",
    "fmod",
    "hypot",
    "isfinite",
    "isnan",
    "log",
    "log10",
    "log2",
    "modf",
    "pow",
    "round",
    "signbit",
    "sin",
    "sinh",
    "sqrt",
    "tan",
    "tanh",
    "trunc",
];

/// The C spelling of a function name.
///
/// Appending an underscore is the whole rule: it is reversible by inspection,
/// which matters because an exported name is an ABI that a human will link
/// against. Names this backend generates itself (`v0`, `t0`, `b0`) are mangled
/// the same way, so a function called `v0` cannot shadow a parameter.
fn c_identifier(name: &str) -> String {
    // A method's qualified name is `Class#method`. `#` cannot appear in a
    // TypeScript identifier, which is why it was chosen -- and it cannot appear
    // in a C one either, so it is spelled with an underscore pair here.
    if name.contains('#') {
        return name.replace('#', "__");
    }
    let generated = matches!(name.as_bytes().first(), Some(b'v' | b't' | b'b'))
        && name.len() > 1
        && name[1..].bytes().all(|b| b.is_ascii_digit());

    if RESERVED.contains(&name) || generated || name.starts_with('_') {
        format!("{name}_")
    } else {
        name.to_string()
    }
}

/// The C name of a string literal's static data.
fn literal_name(literals: &[String], text: &str) -> String {
    let index = literals.iter().position(|known| known == text).unwrap_or(0);
    format!("nts_str_{index}")
}

/// String literals, as static data.
///
/// Emitted as numeric code units rather than as C string literals: a C literal
/// would need escaping rules that do not match JavaScript's, and would carry
/// its own idea of what a byte means.
fn emit_literals(writer: &mut CodeWriter, origin: &Origin, literals: &[String]) {
    for (index, text) in literals.iter().enumerate() {
        let units: Vec<u16> = text.encode_utf16().collect();
        let name = format!("nts_str_{index}");
        // One byte per code unit whenever every one fits, which for ordinary
        // program text is always. The trailing zero is what makes a one-byte
        // string usable as a C string without copying.
        let wide = units.iter().any(|unit| *unit > 0xFF);
        let (element, descriptor, flags) = if wide {
            ("uint16_t", "nts_desc_string2", "NTS_TWO_BYTE")
        } else {
            ("unsigned char", "nts_desc_string1", "0")
        };
        let data: Vec<String> = units
            .iter()
            .map(std::string::ToString::to_string)
            .chain(std::iter::once("0".to_owned()))
            .collect();
        writer.line(
            origin,
            format!(
                "static const struct {{ NtsHeader header; {element} data[{}]; }} {name} = \
                 {{ {{ &{descriptor}, NTS_IMMORTAL, {flags}, {} }}, {{ {} }} }};",
                data.len(),
                units.len(),
                data.join(", ")
            ),
        );
    }
    if !literals.is_empty() {
        writer.blank(origin);
    }
}

/// A C struct per object type, and its descriptor.
///
/// A real struct rather than manual offsets, so the C compiler decides padding
/// and alignment and the emitted field access is `p->x` — which is both faster
/// to read and impossible to get wrong by an offset.
fn emit_object_types(writer: &mut CodeWriter, origin: &Origin, program: &Program) {
    // Every object type is forward-declared first, so a field may point at a
    // type declared later -- or at its own, which a linked structure does.
    for layout in &program.layouts {
        let name = object_type_name(layout);
        writer.line(origin, format!("typedef struct {name} {name};"));
    }
    if !program.layouts.is_empty() {
        writer.blank(origin);
    }

    for layout in &program.layouts {
        let name = object_type_name(layout);
        writer.line(origin, format!("struct {name} {{"));
        // The header first, so every managed object starts the same way and a
        // provider can read the descriptor without knowing the type (RFC 8.2).
        writer.line(origin, "    NtsHeader header;");
        for field in &layout.fields {
            let Ok(ty) = c_type_of(program, &field.ty, origin) else {
                continue;
            };
            // `readonly` is semantic, not syntactic — `Readonly<T>` counts — but
            // it is deliberately *not* emitted as `const` on the member.
            //
            // It used to be, to let clang hoist loads across calls, and the
            // construction store wrote through the qualifier with a cast. That
            // is defined for heap storage, which has no declared type, and
            // undefined the moment the same struct is declared in a frame --
            // which is now something the compiler does whenever an object does
            // not escape. One of the two had to go, and an object that never
            // reaches the allocator is worth an order of magnitude more than a
            // qualifier on storage whose declared type does not exist.
            //
            // The fact is not lost: `readonly` stays in the HIR, where a field
            // load that cannot change is something this compiler can common up
            // itself. That is strictly more than the C qualifier was buying.
            writer.line(origin, format!("    {ty} {};", c_identifier(&field.name)));
        }
        writer.line(origin, "};");
        // RFC 8.3: where this object's references are, as byte offsets. Written
        // with `offsetof` so the compiler that laid the struct out is the one
        // that says where its fields are -- padding, alignment and field order
        // are its business, and duplicating its arithmetic here would be a
        // second source of truth that agrees until it does not.
        //
        // Nothing reads this under NoGC, where a reference field is a pointer
        // and costs nothing. It is emitted anyway, because it is a fact about
        // the layout.
        let references = layout.reference_fields();
        let offsets = if references.is_empty() {
            // No table, and no `static const uint32_t x[] = {};` either: a
            // zero-length array is not C.
            "0".to_owned()
        } else {
            let entries: Vec<String> = references
                .iter()
                .map(|field| format!("offsetof({name}, {})", c_identifier(field)))
                .collect();
            writer.line(
                origin,
                format!(
                    "static const uint32_t nts_refs_{name}[] = {{ {} }};",
                    entries.join(", ")
                ),
            );
            format!("nts_refs_{name}")
        };
        writer.line(
            origin,
            format!(
                "static const NtsDescriptor nts_desc_{name} = \
                 {{ NTS_KIND_OBJECT, sizeof({name}), {}u, {offsets}, \"{}\" }};",
                references.len(),
                layout.name
            ),
        );
        writer.blank(origin);
    }
}

/// The per-program data: a descriptor per element type this program allocates.
///
/// The runtime itself is [`RUNTIME_HEADER`] and [`RUNTIME_SOURCE`] -- real C,
/// compiled separately -- so none of it is generated. What is generated is what
/// depends on the program.
fn emit_descriptors(writer: &mut CodeWriter, origin: &Origin, descriptors: &[&'static str]) {
    for element in descriptors {
        writer.line(
            origin,
            format!(
                "static const NtsDescriptor {} = \
                 {{ NTS_KIND_ARRAY, sizeof({element}), 0, 0, \"{element}[]\" }};",
                descriptor_name(element)
            ),
        );
    }
    if !descriptors.is_empty() {
        writer.blank(origin);
    }
}

/// The element types the emitted functions actually allocate.
///
/// One descriptor per element type rather than per array: a descriptor is
/// immutable and describes the shape, not any particular array's contents.
fn descriptors_reached(bodies: &[(String, CodeWriter, &Func)]) -> Vec<&'static str> {
    let mut found: Vec<&'static str> = Vec::new();
    for func in bodies.iter().map(|(_, _, func)| *func) {
        for op in &func.values {
            if !matches!(op.kind, OpKind::ArrayNew { .. }) {
                continue;
            }
            let HirType::Managed(ManagedType::Array(element)) = &op.ty else {
                continue;
            };
            // Arrays of references share the runtime's own descriptor: every
            // reference is a pointer, so they are all the same shape.
            if element.is_managed() {
                continue;
            }
            if let Ok(spelling) = c_type(element, &op.origin)
                && !found.contains(&spelling)
            {
                found.push(spelling);
            }
        }
    }
    found
}

/// The C spelling of a type, including the object types this program declares.
fn c_type_of(program: &Program, ty: &HirType, origin: &Origin) -> Result<String, Diagnostic> {
    if let HirType::Managed(ManagedType::Object(_)) = ty {
        let layout = layout_of(program, ty, origin)?;
        return Ok(format!("{} *", object_type_name(layout)));
    }
    Ok(c_type(ty, origin)?.to_owned())
}

/// The layout an object-typed value refers to.
fn layout_of<'a>(
    program: &'a Program,
    ty: &HirType,
    origin: &Origin,
) -> Result<&'a nts_core::hir::Layout, Diagnostic> {
    let HirType::Managed(ManagedType::Object(id)) = ty else {
        return Err(Diagnostic::error(
            "NTS2006",
            "a field operation on something that is not an object",
            origin.location,
        ));
    };
    program.layout(*id).ok_or_else(|| {
        Diagnostic::error("NTS2006", "an object type with no layout", origin.location)
    })
}

/// The C name of an object type.
///
/// Prefixed so it cannot collide with anything the program declares, and named
/// after the source type so the emitted C is readable.
fn object_type_name(layout: &nts_core::hir::Layout) -> String {
    format!(
        "NtsObj_{}",
        layout.name.replace(|c: char| !c.is_alphanumeric(), "_")
    )
}

/// The C name of a field, by index into its type's layout.
fn field_of(
    program: &Program,
    func: &Func,
    object: ValueId,
    field: u32,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    let layout = layout_of(program, &func.values[object.0 as usize].ty, origin)?;
    layout
        .fields
        .get(field as usize)
        .map(|field| c_identifier(&field.name))
        .ok_or_else(|| {
            Diagnostic::error(
                "NTS2006",
                "a field index outside its layout",
                origin.location,
            )
        })
}

/// The C spelling of an array's element type.
fn element_type(program: &Program, array: &HirType, origin: &Origin) -> Result<String, Diagnostic> {
    let HirType::Managed(ManagedType::Array(element)) = array else {
        return Err(Diagnostic::error(
            "NTS2005",
            "an array operation on something that is not an array",
            origin.location,
        ));
    };
    c_type_of(program, element, origin)
}

/// The descriptor an array's elements use.
///
/// Every reference is the same shape -- a pointer -- so arrays of references
/// share one descriptor. A descriptor describes the element's *shape*, not what
/// it points at, and emitting one per pointed-to type would be as many copies
/// of the same three numbers.
fn element_descriptor(array: &HirType, origin: &Origin) -> Result<String, Diagnostic> {
    let HirType::Managed(ManagedType::Array(element)) = array else {
        return Err(Diagnostic::error(
            "NTS2005",
            "an array operation on something that is not an array",
            origin.location,
        ));
    };
    if element.is_managed() {
        return Ok("nts_desc_ref".to_owned());
    }
    Ok(descriptor_name(c_type(element, origin)?))
}

/// The descriptor a given element type uses. One per element type, not per
/// array: the descriptor is immutable and says nothing about a particular
/// array's contents.
fn descriptor_name(element: &str) -> String {
    format!("nts_desc_{}", element.replace(' ', "_"))
}

/// The subscript for an element access, with or without a bounds test.
///
/// An unsigned comparison catches a negative index in the same instruction as
/// a too-large one, since a negative wraps to something enormous. Where the
/// analysis proved the index in range, there is no test at all.
fn index_expression(func: &Func, array: ValueId, index: ValueId, checked: bool) -> String {
    if !checked {
        // Proven in range, so the cast is exact whichever representation it
        // arrived in.
        return format!("(uint32_t){}", value_name(index));
    }
    if matches!(func.values[index.0 as usize].ty, HirType::Int { .. }) {
        format!(
            "nts_check({}, (uint32_t){})",
            value_name(array),
            value_name(index)
        )
    } else {
        format!("nts_index({}, {})", value_name(array), value_name(index))
    }
}

/// Whether a coercion is a no-op because its operand already has that shape.
fn coercion_is_free(func: &Func, coercion: UnOp, operand: ValueId) -> bool {
    let source = &func.values[operand.0 as usize].ty;
    match coercion {
        UnOp::ToInt32 => {
            *source
                == HirType::Int {
                    bits: 32,
                    signed: true,
                }
        }
        UnOp::ToUint32 => {
            *source
                == HirType::Int {
                    bits: 32,
                    signed: false,
                }
        }
        _ => false,
    }
}

fn c_type(ty: &HirType, origin: &Origin) -> Result<&'static str, Diagnostic> {
    Ok(match ty {
        HirType::Void => "void",
        HirType::Bool => "bool",
        HirType::Float { bits: 32 } => "float",
        HirType::Float { .. } => "double",
        HirType::Int {
            bits: 8,
            signed: true,
        } => "int8_t",
        HirType::Int {
            bits: 8,
            signed: false,
        } => "uint8_t",
        HirType::Int {
            bits: 16,
            signed: true,
        } => "int16_t",
        HirType::Int {
            bits: 16,
            signed: false,
        } => "uint16_t",
        HirType::Int {
            bits: 32,
            signed: true,
        } => "int32_t",
        HirType::Int {
            bits: 32,
            signed: false,
        } => "uint32_t",
        HirType::Int { signed: true, .. } => "int64_t",
        HirType::Int { signed: false, .. } => "uint64_t",
        // `never` reaching a value position means control got somewhere the type
        // system said it could not.
        HirType::Never => {
            return Err(Diagnostic::error(
                "NTS2002",
                "a value of type `never` reached code generation",
                origin.location,
            ));
        }
        // An array is a pointer to its header; the elements follow it. The
        // element type is not in the C type, because every access already knows
        // it from the HIR and spelling it here would need a struct per element
        // type for no benefit.
        HirType::Managed(ManagedType::Array(_)) => "NtsArray *",
        HirType::Managed(ManagedType::String) => "NtsString *",
        // An object type is named per program, so it has no `&'static str`
        // spelling. `c_type_of` answers for those; reaching here means a caller
        // asked the question that cannot be answered without the program.
        HirType::Managed(ManagedType::Object(_)) => {
            return Err(Diagnostic::error(
                "NTS2006",
                "an object type needs the program to be named",
                origin.location,
            ));
        }
    })
}

fn signature(program: &Program, func: &Func) -> Result<String, Diagnostic> {
    let returns = c_type_of(program, &func.return_type, &func.origin)?;
    if func.params.is_empty() {
        return Ok(format!("{returns} {}(void)", c_identifier(&func.name)));
    }
    let mut params = Vec::new();
    for (index, param) in func.params.iter().enumerate() {
        let ty = c_type_of(program, &param.ty, &param.origin)?;
        params.push(format!(
            "{ty} {}",
            value_name(ValueId(u32::try_from(index).unwrap_or(0)))
        ));
    }
    Ok(format!(
        "{returns} {}({})",
        c_identifier(&func.name),
        params.join(", ")
    ))
}

/// The C name of a value.
///
/// A parameter's value is the C parameter itself, which is why the arena is
/// numbered so that `%0..%n` are the parameters — no copy is needed to get an
/// argument into a local.
fn value_name(value: ValueId) -> String {
    format!("v{}", value.0)
}

fn block_label(block: BlockId) -> String {
    format!("b{}", block.0)
}

/// Emit one function, returning its signature so a declaration can be written.
fn emit_func(
    writer: &mut CodeWriter,
    func: &Func,
    context: &Context<'_>,
) -> Result<String, Diagnostic> {
    let signature = signature(context.program, func)?;
    writer.line(&func.origin, format!("{signature} {{"));
    emit_body(writer, func, context)?;
    writer.line(&func.origin, "}");
    writer.blank(&func.origin);
    Ok(signature)
}

fn emit_body(
    writer: &mut CodeWriter,
    func: &Func,
    context: &Context<'_>,
) -> Result<(), Diagnostic> {
    let order = block_order(func);

    // Every value except the parameters becomes a local. C scoping would not let
    // a value defined in one block be read in another, so they are all declared
    // at the top — where SSA guarantees each is assigned before any use.
    //
    // Declared from the block contents rather than from the value arena, so that
    // a value dead-code elimination dropped does not leave an unused local
    // behind. The arena keeps dead entries on purpose: a `ValueId` is an index
    // into it, and compacting would invalidate every reference in the function.
    let mut declared = rustc_hash::FxHashSet::default();
    let mut read = rustc_hash::FxHashSet::default();
    for block in &func.blocks {
        declared.extend(block.params.iter().copied());
        declared.extend(block.ops.iter().copied());
        read.extend(nts_core::hir::operands_of_terminator(&block.terminator));
        for value in &block.ops {
            read.extend(nts_core::hir::operands_of(
                &func.values[value.0 as usize].kind,
            ));
        }
    }

    // A call whose result nobody reads is emitted as a bare statement, so it has
    // nothing to declare. `c.advance();` written for its effect is exactly that,
    // and a local assigned by nobody is `-Wunused-variable`.
    declared.retain(|value| {
        read.contains(value) || !matches!(func.values[value.0 as usize].kind, OpKind::Call { .. })
    });

    // A parameter nothing reads is an error under -Werror, and constant folding
    // produces them for real: `fixed(scale: 8) { return scale * scale }` folds
    // to `64` and stops looking at its argument. The signature still has to
    // match, so the parameter stays and is discarded explicitly.
    writer.indent();
    for index in 0..func.params.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        if !read.contains(&id) {
            writer.line(
                &func.params[index].origin,
                format!("(void){};", value_name(id)),
            );
        }
    }
    writer.dedent();

    writer.indent();
    for (index, op) in func.values.iter().enumerate() {
        // A parameter is already declared by the signature, a value nothing
        // reads was dropped by dead-code elimination, and an operation that
        // produces nothing has nothing to hold — `void v4;` is not a variable.
        if matches!(op.kind, OpKind::Param(_))
            || matches!(op.ty, HirType::Void)
            || !declared.contains(&ValueId(u32::try_from(index).unwrap_or(0)))
        {
            continue;
        }
        let ty = c_type_of(context.program, &op.ty, &op.origin)?;
        // An object that does not escape lives here rather than on the heap, so
        // it needs storage as well as a pointer to it. Declared with the other
        // locals, which means one slot per allocation site rather than one per
        // execution of it -- correct precisely because nothing outlives the
        // iteration that made it.
        if let OpKind::ObjectNew { frame: true } = op.kind {
            let layout = layout_of(context.program, &op.ty, &op.origin)?;
            writer.line(
                &op.origin,
                format!(
                    "{} {}_frame;",
                    object_type_name(layout),
                    value_name(ValueId(u32::try_from(index).unwrap_or(0)))
                ),
            );
        }
        writer.line(
            &op.origin,
            format!(
                "{ty} {};",
                value_name(ValueId(u32::try_from(index).unwrap_or(0)))
            ),
        );
    }

    let temps = destruct::temp_count(func);
    for temp in 0..temps {
        // One scratch per cycle depth. Typed as the widest scalar, since a swap
        // only ever moves a value into a slot of its own type.
        writer.line(&func.origin, format!("double t{temp};"));
    }
    writer.dedent();

    // Only blocks something actually jumps to need a label, and an unreferenced
    // label is a warning in every C compiler worth using. "Actually" is the load-
    // bearing word: a jump to the next block in this order emits no `goto`, so
    // the successor edge exists in the HIR and no label is needed for it. This
    // has to mirror the rule in `emit_terminator` exactly or the two disagree.
    let mut targeted = rustc_hash::FxHashSet::default();
    for (position, block) in order.iter().enumerate() {
        let next = order.get(position + 1).copied();
        match &func.blocks[block.0 as usize].terminator {
            Terminator::Jump { target, .. } if next == Some(*target) => {}
            terminator => targeted.extend(terminator.successors()),
        }
    }

    for (position, block) in order.iter().enumerate() {
        let next = order.get(position + 1).copied();
        emit_block(
            writer,
            func,
            *block,
            next,
            targeted.contains(block),
            context,
        )?;
    }
    Ok(())
}

fn emit_block(
    writer: &mut CodeWriter,
    func: &Func,
    block: BlockId,
    next: Option<BlockId>,
    labelled: bool,
    context: &Context<'_>,
) -> Result<(), Diagnostic> {
    let record = &func.blocks[block.0 as usize];
    let origin = func
        .values
        .get(record.ops.first().map_or(0, |v| v.0 as usize))
        .map_or_else(|| func.origin.clone(), |op| op.origin.clone());

    if labelled {
        writer.line(&origin, format!("{}:;", block_label(block)));
    }
    writer.indent();

    for value in &record.ops {
        emit_op(writer, func, *value, context)?;
    }
    emit_terminator(writer, func, block, next, &origin);

    writer.dedent();
    Ok(())
}

/// The C spelling of a binary operation.
fn binary_text(
    func: &Func,
    op: &nts_core::hir::Op,
    name: &str,
    bin: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Result<String, Diagnostic> {
    // A bitwise operator's operands are always coercion results — the lowering
    // guarantees it — so they hold int32 values whatever their representation
    // says. When specialization did not give them an integer type, the
    // arithmetic still has to happen in integers, so it is spelled with casts
    // around it. Those casts are exactly the cost the analysis removes.
    let integral = matches!(op.ty, HirType::Int { .. });
    // Cast decided per *operand*, from its own type. Deciding it from the
    // result's would emit `v14 | v15` with `v15` a double, which is not C.
    let cast = |value: ValueId| {
        if matches!(func.values[value.0 as usize].ty, HirType::Int { .. }) {
            value_name(value)
        } else {
            format!("(int32_t){}", value_name(value))
        }
    };
    let wrap = |text: String| {
        if integral {
            format!("{name} = {text};")
        } else {
            format!("{name} = (double)({text});")
        }
    };

    // Shifts are not C operators here. JavaScript masks the count to five bits,
    // where C leaves a shift by 32 or more undefined; `<<` on a negative signed
    // operand is undefined in C and defined in JavaScript. Each goes through a
    // helper that spells the real rule.
    let helper = match bin {
        BinOp::Shl => Some("nts_shl"),
        BinOp::Shr => Some("nts_shr"),
        BinOp::UShr => Some("nts_ushr"),
        _ => None,
    };
    if let Some(helper) = helper {
        return Ok(wrap(format!("{helper}({}, {})", cast(lhs), cast(rhs))));
    }

    // Strings compare by value: `"a" + "b" === "ab"` is true in JavaScript, and
    // those are two different allocations, so pointer equality is the wrong
    // answer rather than an approximation of it.
    if matches!(bin, BinOp::Eq | BinOp::Ne)
        && matches!(
            func.values[lhs.0 as usize].ty,
            HirType::Managed(ManagedType::String)
        )
    {
        let negate = if matches!(bin, BinOp::Ne) { "!" } else { "" };
        return Ok(format!(
            "{name} = {negate}nts_string_eq({}, {});",
            value_name(lhs),
            value_name(rhs)
        ));
    }

    let operator = match bin {
        BinOp::Add => "+",
        BinOp::Sub => "-",
        BinOp::Mul => "*",
        BinOp::Div => "/",
        BinOp::Rem => "%",
        BinOp::BitAnd => "&",
        BinOp::BitOr => "|",
        BinOp::BitXor => "^",
        BinOp::Lt => "<",
        BinOp::Le => "<=",
        BinOp::Gt => ">",
        BinOp::Ge => ">=",
        BinOp::Eq => "==",
        BinOp::Ne => "!=",
        BinOp::Shl | BinOp::Shr | BinOp::UShr => unreachable!("handled above"),
        // Not `fmin`/`fmax`: those return the non-NaN operand where JavaScript
        // returns NaN, and disagree about the two zeroes.
        BinOp::Min | BinOp::Max => {
            // Two integers cannot be NaN and have no second zero, so the whole
            // reason the helper exists is absent and a comparison will do.
            let both_integers = matches!(func.values[lhs.0 as usize].ty, HirType::Int { .. })
                && matches!(func.values[rhs.0 as usize].ty, HirType::Int { .. });
            if both_integers {
                let test = if matches!(bin, BinOp::Min) { "<" } else { ">" };
                return Ok(format!(
                    "{name} = {0} {test} {1} ? {0} : {1};",
                    value_name(lhs),
                    value_name(rhs)
                ));
            }
            let helper = if matches!(bin, BinOp::Min) {
                "nts_min"
            } else {
                "nts_max"
            };
            return Ok(wrap(format!(
                "{helper}({}, {})",
                value_name(lhs),
                value_name(rhs)
            )));
        }
        BinOp::Concat => {
            return Ok(format!(
                "{name} = nts_concat({}, {});",
                value_name(lhs),
                value_name(rhs)
            ));
        }
    };

    if matches!(bin, BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor) {
        return Ok(wrap(format!("{} {operator} {}", cast(lhs), cast(rhs))));
    }

    // `%` is integer-only in C. On doubles it is `fmod`, and emitting `%` would
    // not compile — better than emitting something that does and is wrong, but
    // still worth naming. On integers it is exactly JavaScript's remainder:
    // both take the sign of the dividend.
    if matches!(bin, BinOp::Rem) && matches!(op.ty, HirType::Float { .. }) {
        return Err(Diagnostic::error(
            "NTS2003",
            "floating-point remainder needs `fmod`, which is not wired up yet",
            op.origin.location,
        ));
    }

    Ok(format!(
        "{name} = {} {operator} {};",
        value_name(lhs),
        value_name(rhs)
    ))
}

/// The C spelling of a unary operation.
fn unary_text(func: &Func, name: &str, un: UnOp, operand: ValueId, result: &HirType) -> String {
    match un {
        UnOp::Neg => format!("{name} = -{};", value_name(operand)),
        UnOp::Not => format!("{name} = !{};", value_name(operand)),
        UnOp::Truthy => {
            // An integer is truthy exactly when it is non-zero, and `!= 0` says
            // so. A double additionally has to exclude NaN, which is falsy and
            // which `!= 0` would call true — every comparison with a NaN is
            // false, including the inequality.
            if matches!(func.values[operand.0 as usize].ty, HirType::Int { .. }) {
                format!("{name} = {} != 0;", value_name(operand))
            } else {
                format!("{name} = ({0} != 0.0) && !isnan({0});", value_name(operand))
            }
        }
        UnOp::Floor | UnOp::Ceil | UnOp::Trunc | UnOp::Round | UnOp::Abs => {
            // An integer is already rounded, and taking its magnitude is a
            // comparison rather than a library call.
            let already_integral =
                matches!(func.values[operand.0 as usize].ty, HirType::Int { .. });
            if already_integral {
                return match un {
                    UnOp::Abs => format!("{name} = {0} < 0 ? -{0} : {0};", value_name(operand)),
                    _ => format!("{name} = {};", value_name(operand)),
                };
            }
            let call = match un {
                UnOp::Floor => "floor",
                UnOp::Ceil => "ceil",
                UnOp::Trunc => "trunc",
                UnOp::Abs => "fabs",
                // C's `round` rounds a half away from zero; JavaScript rounds it
                // toward positive infinity, so `Math.round(-1.5)` is `-1` and
                // `round(-1.5)` is `-2`.
                _ => "nts_round",
            };
            // Rounding in doubles and converting after, never the other way
            // round: `(int32_t)-3.7` is `-3` and `floor(-3.7)` is `-4`.
            if matches!(result, HirType::Int { .. }) {
                return format!("{name} = (int32_t){call}({});", value_name(operand));
            }
            format!("{name} = {call}({});", value_name(operand))
        }
        UnOp::ToInt32 | UnOp::ToUint32 => {
            // A value already in the target representation needs no coercion,
            // and that is the common case: integer code writing `x | 0` on
            // something already proven an integer.
            if coercion_is_free(func, un, operand) {
                return format!("{name} = {};", value_name(operand));
            }

            // An *integer* of some other width is a truncation, which C spells
            // as a cast through the unsigned type of the target — exactly
            // ToInt32's "reduce modulo 2^32, reinterpret signed", and one
            // instruction. Only a genuine double needs the total, wrapping,
            // fmod-based helper, and reaching for it on an `int64_t` operand
            // costs a conversion to double and a library call in the loop body
            // that the whole analysis existed to speed up.
            if matches!(func.values[operand.0 as usize].ty, HirType::Int { .. }) {
                return match un {
                    UnOp::ToInt32 => {
                        format!("{name} = (int32_t)(uint32_t){};", value_name(operand))
                    }
                    _ => format!("{name} = (uint32_t){};", value_name(operand)),
                };
            }

            let helper = if matches!(un, UnOp::ToInt32) {
                "nts_to_int32"
            } else {
                "nts_to_uint32"
            };
            format!("{name} = {helper}({});", value_name(operand))
        }
    }
}

/// Allocation and field or element access: the operations that go through a
/// managed object's header.
fn managed_op(
    writer: &mut CodeWriter,
    func: &Func,
    value: ValueId,
    context: &Context<'_>,
) -> Result<(), Diagnostic> {
    let op = func.value(value);
    let name = value_name(value);
    let text = match &op.kind {
        OpKind::ObjectNew { frame } => {
            let layout = layout_of(context.program, &op.ty, &op.origin)?;
            let type_name = object_type_name(layout);
            if *frame {
                // The storage is a local declared with the others; this only
                // fills in the header and takes its address. The descriptor is
                // written because anything that reads an object reads it there,
                // and the count is `NTS_IMMORTAL` so that a retain or release
                // that reaches a frame object is a no-op rather than a call to
                // `free` on a stack address.
                //
                // Both stores are dead in every program that does not read
                // them, and clang removes them along with the object itself.
                writer.line(
                    &op.origin,
                    format!("{name}_frame.header.descriptor = &nts_desc_{type_name};"),
                );
                writer.line(
                    &op.origin,
                    format!("{name}_frame.header.reserved = NTS_IMMORTAL;"),
                );
                format!("{name} = &{name}_frame;")
            } else {
                format!("{name} = ({type_name} *)nts_object_new(&nts_desc_{type_name});")
            }
        }
        OpKind::FieldGet { object, field } => {
            let field = field_of(context.program, func, *object, *field, &op.origin)?;
            format!("{name} = {}->{field};", value_name(*object))
        }
        OpKind::FieldSet {
            object,
            field,
            value: stored,
        } => {
            let layout = layout_of(
                context.program,
                &func.values[object.0 as usize].ty,
                &op.origin,
            )?;
            let declared = layout.fields.get(*field as usize).ok_or_else(|| {
                Diagnostic::error(
                    "NTS2006",
                    "a field index outside its layout",
                    op.origin.location,
                )
            })?;
            let field = c_identifier(&declared.name);
            format!(
                "{}->{field} = {};",
                value_name(*object),
                value_name(*stored)
            )
        }
        OpKind::ArrayNew { length } => {
            format!(
                "{name} = nts_array_new(&{}, {});",
                element_descriptor(&op.ty, &op.origin)?,
                value_name(*length)
            )
        }
        OpKind::Length(array) => {
            let target = c_type(&op.ty, &op.origin)?;
            format!("{name} = ({target}){}->length;", value_name(*array))
        }
        OpKind::ArrayGet {
            array,
            index,
            checked,
        } => {
            let element = element_type(
                context.program,
                &func.values[array.0 as usize].ty,
                &op.origin,
            )?;
            let slot = index_expression(func, *array, *index, *checked);
            format!(
                "{name} = NTS_ELEMENTS({}, {element})[{slot}];",
                value_name(*array)
            )
        }
        OpKind::ArraySet {
            array,
            index,
            value: stored,
            checked,
        } => {
            let element = element_type(
                context.program,
                &func.values[array.0 as usize].ty,
                &op.origin,
            )?;
            let slot = index_expression(func, *array, *index, *checked);
            format!(
                "NTS_ELEMENTS({}, {element})[{slot}] = {};",
                value_name(*array),
                value_name(*stored)
            )
        }
        _ => unreachable!("managed_op is only reached for managed operations"),
    };
    writer.line(&op.origin, text);
    Ok(())
}

fn emit_op(
    writer: &mut CodeWriter,
    func: &Func,
    value: ValueId,
    context: &Context<'_>,
) -> Result<(), Diagnostic> {
    let op = func.value(value);
    let name = value_name(value);
    let text = match &op.kind {
        // Nothing to compute at the definition site. A parameter *is* the C
        // parameter; a block parameter is written by the edges that jump here;
        // a return is spelled by the terminator.
        OpKind::Param(_) | OpKind::BlockParam(_) | OpKind::Return(_) => return Ok(()),
        OpKind::ConstInt(v) => format!("{name} = {v};"),
        // Enough digits to round-trip an f64 exactly. Fewer would change the
        // program's arithmetic.
        OpKind::ConstFloat(v) => format!("{name} = {v:?};"),
        OpKind::ConstBool(v) => format!("{name} = {v};"),
        // A literal is immutable and known now, so it is static data rather
        // than an allocation. This is the difference between a string-heavy
        // program allocating once at startup and allocating in a loop.
        OpKind::ConstString(text) => {
            format!(
                "{name} = (NtsString *)(void *)&{};",
                literal_name(context.literals, text)
            )
        }
        OpKind::Binary { op: bin, lhs, rhs } => binary_text(func, op, &name, *bin, *lhs, *rhs)?,
        OpKind::Call { callee, args } => {
            let (Callee::Direct(target) | Callee::External(target)) = callee;
            let arguments: Vec<String> = args.iter().map(|a| value_name(*a)).collect();
            let call = format!("{}({})", c_identifier(target), arguments.join(", "));
            if context.read.contains(&value) {
                format!("{name} = {call};")
            } else {
                // The call still happens; only its result is unwanted.
                format!("{call};")
            }
        }
        OpKind::Unary { op: un, operand } => unary_text(func, &name, *un, *operand, &op.ty),
        OpKind::ObjectNew { .. }
        | OpKind::FieldGet { .. }
        | OpKind::FieldSet { .. }
        | OpKind::ArrayNew { .. }
        | OpKind::Length(_)
        | OpKind::ArrayGet { .. }
        | OpKind::ArraySet { .. } => {
            return managed_op(writer, func, value, context);
        }
        OpKind::Retain(object) => {
            format!("nts_retain((NtsHeader *){});", value_name(*object))
        }
        OpKind::Release(object) => {
            format!("nts_release((NtsHeader *){});", value_name(*object))
        }
        OpKind::Convert(operand) => {
            // A C cast. Between an integer and a double this is one instruction,
            // and every one is a place specialization decided two adjacent
            // values should live in different machine types.
            let target = c_type(&op.ty, &op.origin)?;
            format!("{name} = ({target}){};", value_name(*operand))
        }
    };
    writer.line(&op.origin, text);
    Ok(())
}

fn emit_terminator(
    writer: &mut CodeWriter,
    func: &Func,
    block: BlockId,
    next: Option<BlockId>,
    origin: &Origin,
) {
    let record = &func.blocks[block.0 as usize];

    // The copies an edge implies run before control leaves.
    let emit_edge = |writer: &mut CodeWriter, target: BlockId, args: &[ValueId]| {
        let params = &func.blocks[target.0 as usize].params;
        for copy in destruct::edge_copies(params, args) {
            let text = match copy {
                Copy::Move { to, from } => format!("{} = {};", value_name(to), value_name(from)),
                Copy::Save { temp, from } => format!("t{temp} = {};", value_name(from)),
                Copy::Restore { to, temp } => format!("{} = t{temp};", value_name(to)),
            };
            writer.line(origin, text);
        }
    };

    match &record.terminator {
        Terminator::Return(Some(value)) => {
            writer.line(origin, format!("return {};", value_name(*value)));
        }
        Terminator::Return(None) => writer.line(origin, "return;"),
        Terminator::Unreachable => {
            // A claim the compiler made. Saying so lets the C compiler optimize on
            // it, and makes a violated claim a crash rather than a fall-through.
            writer.line(origin, "__builtin_unreachable();");
        }
        Terminator::Jump { target, args } => {
            emit_edge(writer, *target, args);
            // The block order exists so this is usually free.
            if next != Some(*target) {
                writer.line(origin, format!("goto {};", block_label(*target)));
            }
        }
        Terminator::Branch {
            cond,
            then_target,
            then_args,
            else_target,
            else_args,
        } => {
            // Each arm's copies belong to that arm, so they are emitted inside it.
            writer.line(origin, format!("if ({}) {{", value_name(*cond)));
            writer.nested(|writer| {
                emit_edge(writer, *then_target, then_args);
                writer.line(origin, format!("goto {};", block_label(*then_target)));
            });
            writer.line(origin, "} else {");
            writer.nested(|writer| {
                emit_edge(writer, *else_target, else_args);
                writer.line(origin, format!("goto {};", block_label(*else_target)));
            });
            writer.line(origin, "}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_c_keyword_is_not_a_usable_function_name() {
        // `function double()` is ordinary TypeScript.
        assert_eq!(c_identifier("double"), "double_");
        assert_eq!(c_identifier("int"), "int_");
        assert_eq!(c_identifier("switch"), "switch_");
        // `main` is not a keyword, but a second definition of it does not link.
        assert_eq!(c_identifier("main"), "main_");
    }

    #[test]
    fn a_name_this_backend_generates_is_also_reserved() {
        // A function called `v0` would shadow the first parameter of every
        // function that calls it.
        assert_eq!(c_identifier("v0"), "v0_");
        assert_eq!(c_identifier("t12"), "t12_");
        assert_eq!(c_identifier("b3"), "b3_");
        // Only the exact generated shape. These are ordinary names.
        assert_eq!(c_identifier("v"), "v");
        assert_eq!(c_identifier("value0"), "value0");
        assert_eq!(c_identifier("b3x"), "b3x");
    }

    #[test]
    fn a_leading_underscore_is_reserved_to_the_implementation() {
        assert_eq!(c_identifier("_internal"), "_internal_");
    }

    #[test]
    fn an_ordinary_name_is_left_alone() {
        // Mangling everything would be simpler and would make every exported
        // symbol worse to link against.
        assert_eq!(c_identifier("compute"), "compute");
        assert_eq!(c_identifier("sumTo"), "sumTo");
    }
}

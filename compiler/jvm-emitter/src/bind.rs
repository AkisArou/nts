//! A parsed class file as TypeScript declarations.
//!
//! The other half of `nts bind`: [`crate::read`] turns bytes into a
//! [`ClassFile`], and this turns one into the `.d.ts` a program imports.
//!
//! # Why the type mapping is not a preference
//!
//! Every row below is forced by something measured rather than chosen:
//!
//! - **`J` is `bigint`, not `number`.** A Java `long` exceeds 2^53, so a
//!   `number` would round it silently. The friction of not being able to add it
//!   to a `number` is the type system refusing to lose the value.
//! - **`I` is a branded `int`.** Measured: a brand in a **declared** signature
//!   lowers cleanly and the checker rejects a plain `number` against it with
//!   `TS2345`, which is the entire mechanism that keeps `find(int)` apart from
//!   `find(double)` when both collapse to one TypeScript name. The same brand
//!   in one of *our* parameters is refused by the lowering -- so it belongs
//!   here, in a declaration, and nowhere else.
//! - **`[I` is `Int32Array`, not `int[]`.** Also measured: a branded array does
//!   not lower at all, while `Int32Array` gives a real `managed<view<i32>>`
//!   with `i32` element reads. The element type *is* the TypeScript type, so a
//!   branded array cannot narrow and a typed array already does.
//! - **`Ljava/lang/Object;` is `unknown`, never `any`.** Refuse rather than
//!   miscompile, the same rule as an unannotated reference return.
//!
//! # What this slice does not do
//!
//! Generic signatures are read but not yet rendered: a `List<String>` still
//! surfaces as `java.util.List<unknown>` here, with the erased descriptor
//! driving the name. The `Signature` attribute is parsed and carried by
//! [`crate::read::Member`], so this is a rendering gap rather than a missing
//! input, and it is the next thing to close.

use crate::read::ClassFile;
use std::fmt::Write as _;

/// `ACC_PUBLIC`, `ACC_STATIC`, `ACC_FINAL`. JVMS table 4.5-A.
const ACC_PUBLIC: u16 = 0x0001;
const ACC_STATIC: u16 = 0x0008;
const ACC_FINAL: u16 = 0x0010;
/// On a class it means "this is an enum"; on a field, "this is one of its
/// constants". JVMS table 4.5-A.
const ACC_ENUM: u16 = 0x4000;

/// One Java type, as TypeScript.
///
/// Takes a descriptor slice and returns the rendered type plus how many bytes
/// it consumed, so an arg list can be walked without a second parser.
fn type_of(descriptor: &str) -> Option<(String, usize)> {
    let bytes = descriptor.as_bytes();
    match *bytes.first()? {
        b'V' => Some(("void".to_owned(), 1)),
        b'Z' => Some(("boolean".to_owned(), 1)),
        b'B' => Some(("byte".to_owned(), 1)),
        b'S' => Some(("short".to_owned(), 1)),
        b'C' => Some(("char".to_owned(), 1)),
        b'I' => Some(("int".to_owned(), 1)),
        // A `long` exceeds 2^53. `number` would be a lie.
        b'J' => Some(("bigint".to_owned(), 1)),
        // `float` is branded because passing a `number` to it loses precision,
        // and that is worth a cast at the call site. `double` IS `number` and
        // gets no brand -- a brand that is never the distinguishing one is
        // noise everywhere it appears.
        b'F' => Some(("float".to_owned(), 1)),
        b'D' => Some(("number".to_owned(), 1)),
        b'[' => {
            let (inner, used) = type_of(&descriptor[1..])?;
            // A Java primitive array IS the matching typed array: same object,
            // no copy, and the element type narrows.
            let rendered = match inner.as_str() {
                "byte" => "Uint8Array".to_owned(),
                "short" => "Int16Array".to_owned(),
                "char" => "Uint16Array".to_owned(),
                "int" => "Int32Array".to_owned(),
                "float" => "Float32Array".to_owned(),
                "number" => "Float64Array".to_owned(),
                // `long[]` has a typed array but `boolean[]` does not, and an
                // array of references is an ordinary TypeScript array.
                "bigint" => "BigInt64Array".to_owned(),
                other => format!("{other}[]"),
            };
            Some((rendered, used + 1))
        }
        b'L' => {
            let end = descriptor.find(';')?;
            let binary = &descriptor[1..end];
            Some((reference(binary), end + 1))
        }
        _ => None,
    }
}

/// A reference type's binary name, as TypeScript.
fn reference(binary: &str) -> String {
    match binary {
        "java/lang/String" | "java/lang/CharSequence" => "string".to_owned(),
        // Refuse rather than miscompile: `any` would silence every later error.
        "java/lang/Object" => "unknown".to_owned(),
        // A nested class is `Outer$Inner` in the class file and `Outer.Inner`
        // in a namespace, which is how `Catalog.Entry` reads at a call site.
        other => other.replace(['/', '$'], "."),
    }
}

/// The parameter types and return type of a method descriptor.
fn signature_of(descriptor: &str) -> Option<(Vec<String>, String)> {
    let open = descriptor.find('(')?;
    let close = descriptor.find(')')?;
    let mut parameters = Vec::new();
    let mut rest = &descriptor[open + 1..close];
    while !rest.is_empty() {
        let (rendered, used) = type_of(rest)?;
        parameters.push(rendered);
        rest = &rest[used..];
    }
    let (returns, _) = type_of(&descriptor[close + 1..])?;
    Some((parameters, returns))
}

/// Whether a member is annotated `@Nullable`, in either annotation table.
fn nullable(annotations: &[String]) -> bool {
    annotations.iter().any(|it| it.ends_with("/Nullable"))
}

fn nonnull(annotations: &[String]) -> bool {
    annotations.iter().any(|it| it.ends_with("/NonNull"))
}

/// Is this type one a `null` can inhabit?
fn is_reference(rendered: &str) -> bool {
    !matches!(
        rendered,
        "void" | "boolean" | "byte" | "short" | "char" | "int" | "bigint" | "float" | "number"
    )
}

/// A return type with its nullability applied.
///
/// **An unannotated reference return becomes `T | null`.** That is the
/// refuse-rather-than-miscompile rule and the reason Kotlin had to invent
/// platform types: the class file genuinely does not say, and guessing
/// non-null produces an NPE the type system promised could not happen. An
/// overrides file is how a jar with no annotations gets cleaned up.
fn returns(rendered: &str, annotations: &[String]) -> String {
    if !is_reference(rendered) || nonnull(annotations) {
        return rendered.to_owned();
    }
    format!("{rendered} | null")
}

fn simple_name(binary: &str) -> String {
    let after_package = binary.rsplit('/').next().unwrap_or(binary);
    after_package.rsplit('$').next().unwrap_or(after_package).to_owned()
}

/// Render one class as a `declare class` body.
///
/// # Errors
///
/// Returns the member's name when a descriptor cannot be rendered, rather than
/// emitting a declaration with a hole in it. **Refuse by name, never
/// half-emit**: a `.d.ts` that silently drops a method is one a caller trusts.
pub fn declarations(class: &ClassFile) -> Result<String, String> {
    let mut out = String::new();
    let name = simple_name(&class.binary_name);

    let _ = writeln!(out, "  /** {} */", class.binary_name.replace('/', "."));
    let _ = writeln!(out, "  export class {name} {{");

    let is_enum_class = class.access & ACC_ENUM != 0;

    for field in class.fields.iter().filter(|f| f.access & ACC_PUBLIC != 0) {
        let Some((rendered, _)) = type_of(&field.descriptor) else {
            return Err(format!("{}.{}: {}", class.binary_name, field.name, field.descriptor));
        };
        let is_static = field.access & ACC_STATIC != 0;
        let is_final = field.access & ACC_FINAL != 0;
        // **Two fields are provably never null, and the default would have
        // made both `| null` for no reason.**
        //
        // A `ConstantValue` field IS its constant -- the value is in the class
        // file and the JVM resolves the read to an `ldc`, so there is no
        // execution in which it is null. And an enum's own constants are
        // created by its `<clinit>` before any of them is observable, which
        // the JLS guarantees; `ACC_ENUM` on both the class and the field is
        // how the class file says so.
        //
        // Without this, `Catalog.NAME` reads `string | null` for a compile-time
        // string literal, and every use of it needs a null check that can
        // never fire. That is the kind of noise that makes a generated binding
        // unpleasant enough to hand-edit.
        let provably_present = field.constant || (is_enum_class && field.access & ACC_ENUM != 0);
        // `ConstantValue` is what decides `ldc` against `getstatic`, and it is
        // worth saying at the declaration because it decides whether touching
        // the member loads the class at all.
        let note = if field.constant {
            "    /** Inlined at the call site: the class is never loaded for this. */\n"
        } else if is_static {
            "    /** A real `getstatic`, and it runs the owner's `<clinit>`. */\n"
        } else {
            ""
        };
        out.push_str(note);
        let _ = writeln!(
            out,
            "    {}{}{}: {};",
            if is_static { "static " } else { "" },
            if is_final { "readonly " } else { "" },
            field.name,
            if provably_present { rendered.clone() } else { returns(&rendered, &field.annotations) },
        );
    }

    for method in class.methods.iter().filter(|m| m.access & ACC_PUBLIC != 0) {
        let Some((parameters, result)) = signature_of(&method.descriptor) else {
            return Err(format!("{}.{}: {}", class.binary_name, method.name, method.descriptor));
        };
        let arguments = parameters
            .iter()
            .enumerate()
            .map(|(index, rendered)| {
                // A parameter annotated `@Nullable` accepts null; an
                // unannotated one does NOT get `| null` added, because the
                // rule for an argument runs the other way from a return -- a
                // caller passing null where the callee did not say it accepts
                // one is the error this keeps.
                let annotated = method
                    .parameter_annotations
                    .get(index)
                    .is_some_and(|it| nullable(it));
                let ty = if annotated && is_reference(rendered) {
                    format!("{rendered} | null")
                } else {
                    rendered.clone()
                };
                format!("a{index}: {ty}")
            })
            .collect::<Vec<_>>()
            .join(", ");

        if method.name == "<init>" {
            let _ = writeln!(out, "    constructor({arguments});");
            continue;
        }
        if method.name == "<clinit>" {
            continue;
        }
        if !method.throws.is_empty() {
            let _ = writeln!(
                out,
                "    /** Throws {}. Caught at the call site and raised as an `NtsRefusal`; not \
                 catchable by a TypeScript `try` yet. */",
                method.throws.iter().map(|it| it.replace('/', ".")).collect::<Vec<_>>().join(", ")
            );
        }
        let _ = writeln!(
            out,
            "    {}{}({arguments}): {};",
            if method.access & ACC_STATIC != 0 { "static " } else { "" },
            method.name,
            returns(&result, &method.annotations),
        );
    }

    out.push_str("  }\n");
    Ok(out)
}

/// Wrap one or more classes in the ambient module a program imports.
///
/// The module specifier is `java:<package>`, which is an ordinary TypeScript
/// ambient module -- no resolver change, no plugin, and it reads at the import
/// site as what it is.
#[must_use]
pub fn module(package: &str, bodies: &[String]) -> String {
    let mut out = String::new();
    out.push_str("// GENERATED by `nts bind`. Do not edit.\n//\n");
    out.push_str("// Every comment below is emitted, not written by hand: where a member costs an\n");
    out.push_str("// allocation or loads a class, the declaration is where a reader is looking.\n\n");
    out.push_str("import type { int, short, byte, char, float } from \"./java\";\n\n");
    let _ = writeln!(out, "declare module \"java:{package}\" {{");
    for body in bodies {
        out.push_str(body);
        out.push('\n');
    }
    out.push_str("}\n");
    out
}

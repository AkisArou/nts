//! The class file format, from the other end.
//!
//! # Why this lives in the writer's crate
//!
//! The format is symmetric and the two directions share exactly the thing that
//! is easy to get wrong twice: the constant pool's variable-width entries, and
//! the rule that a `Long` or a `Double` occupies **two** slots. [`pool::tag`] is
//! one table read by both, so a reader and a writer cannot disagree about what
//! a tag byte means.
//!
//! # What it is for
//!
//! `nts bind` reads a jar and emits `.d.ts` plus a binding table, which is what
//! lets compiled TypeScript call `android.jar` at all. Everything that document
//! needs is in the class file already: names, superclass, interfaces,
//! descriptors, generics in the `Signature` attribute -- which survives erasure
//! -- and nullability in the annotation tables.
//!
//! **Both annotation tables.** `androidx.annotation.Nullable` is
//! `CLASS`-retention, so it lands in `RuntimeInvisibleAnnotations`; a reader
//! that only walks the visible table sees **none** of the 77 `@Nullable` marks
//! on `android.view.View`. That is measured, not supposed, and it is why
//! [`Member::annotations`] merges the two.
//!
//! # What this slice does not do
//!
//! No `Code` attribute: method bodies are not needed to generate bindings, and
//! the escape analysis that would want them is the optional half of one
//! proposal. No `StackMapTable` parsing, for the same reason. Both are additive
//! and neither changes the shape here.

use crate::pool::tag;

/// Anything that makes a class file unreadable.
///
/// One variant with a message rather than a taxonomy: every caller does the
/// same thing with it, which is to name the jar entry and move on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub message: String,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

fn fail<T>(message: impl Into<String>) -> Result<T, Error> {
    Err(Error { message: message.into() })
}

/// A field or a method. The two differ only in what the descriptor means.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub access: u16,
    pub name: String,
    /// The erased descriptor: `(I)Ljava/lang/String;` or `[I`.
    pub descriptor: String,
    /// The `Signature` attribute, which carries generics through erasure.
    /// `Ljava/util/List<Ljava/lang/String;>;` where `descriptor` says
    /// `Ljava/util/List;`.
    pub signature: Option<String>,
    /// Binary names from the `Exceptions` attribute.
    pub throws: Vec<String>,
    /// Every annotation on this member, **visible and invisible merged**, as
    /// binary names. See the module header for why the invisible table is not
    /// optional.
    pub annotations: Vec<String>,
    /// Annotations on each parameter, in declaration order.
    ///
    /// A separate attribute from the member's own, and on `android.view.View`
    /// it is where **most** of the nullability lives: 79 parameter-annotation
    /// sites against 38 member ones. A reader that stops at `annotations`
    /// surfaces `setText(CharSequence)` without knowing the argument may be
    /// null, which is the direction that matters most for a caller.
    pub parameter_annotations: Vec<Vec<String>>,
    /// Present when the field has a `ConstantValue` attribute, which is what
    /// makes a `static final` primitive or `String` inline to an `ldc` instead
    /// of a `getstatic`.
    pub constant: bool,
}

/// One parsed class file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassFile {
    pub major: u16,
    pub minor: u16,
    pub access: u16,
    pub binary_name: String,
    /// Absent only for `java/lang/Object`.
    pub super_name: Option<String>,
    pub interfaces: Vec<String>,
    pub fields: Vec<Member>,
    pub methods: Vec<Member>,
    pub signature: Option<String>,
    pub annotations: Vec<String>,
    /// `(inner, outer)` binary-name pairs from `InnerClasses`, for the entries
    /// that name both. A true inner class's constructor takes its outer
    /// instance as a synthetic first parameter, and this is how the generator
    /// knows which classes those are.
    pub inner_classes: Vec<(String, String)>,
}

/// A cursor that cannot read past the end.
///
/// Every `u1`/`u2`/`u4` goes through here, so a truncated file is an `Error`
/// rather than a panic -- which matters because the inputs are other people's
/// jars.
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    fn u1(&mut self) -> Result<u8, Error> {
        let Some(&b) = self.bytes.get(self.at) else {
            return fail("the class file ends inside a value");
        };
        self.at += 1;
        Ok(b)
    }

    fn u2(&mut self) -> Result<u16, Error> {
        Ok(u16::from(self.u1()?) << 8 | u16::from(self.u1()?))
    }

    fn u4(&mut self) -> Result<u32, Error> {
        Ok(u32::from(self.u2()?) << 16 | u32::from(self.u2()?))
    }

    fn skip(&mut self, n: usize) -> Result<(), Error> {
        if self.at + n > self.bytes.len() {
            return fail("the class file ends inside an attribute");
        }
        self.at += n;
        Ok(())
    }

    fn utf8(&mut self, len: usize) -> Result<String, Error> {
        if self.at + len > self.bytes.len() {
            return fail("the class file ends inside a string");
        }
        let raw = &self.bytes[self.at..self.at + len];
        self.at += len;
        // Modified UTF-8 differs from UTF-8 for the null byte and for
        // supplementary characters. Neither appears in a name or a descriptor,
        // which is all this reader asks for, so a lossy decode here is exact in
        // practice and never panics on the jars that are not.
        Ok(String::from_utf8_lossy(raw).into_owned())
    }
}

/// The subset of the pool this reader resolves: everything is looked up by
/// index and only `Utf8` and `Class` are ever dereferenced.
struct Pool {
    utf8: Vec<Option<String>>,
    class: Vec<Option<u16>>,
}

impl Pool {
    fn text(&self, index: u16) -> Result<String, Error> {
        match self.utf8.get(index as usize).and_then(Clone::clone) {
            Some(text) => Ok(text),
            None => fail(format!("constant pool index {index} is not a Utf8")),
        }
    }

    /// A `Class` entry's binary name, e.g. `java/lang/String`.
    fn class_name(&self, index: u16) -> Result<String, Error> {
        match self.class.get(index as usize).and_then(|it| *it) {
            Some(name) => self.text(name),
            None => fail(format!("constant pool index {index} is not a Class")),
        }
    }
}

fn constant_pool(reader: &mut Reader) -> Result<Pool, Error> {
    let count = reader.u2()? as usize;
    let mut utf8 = vec![None; count.max(1)];
    let mut class = vec![None; count.max(1)];

    let mut index = 1usize;
    while index < count {
        let tag = reader.u1()?;
        match tag {
            tag::UTF8 => {
                let len = reader.u2()? as usize;
                utf8[index] = Some(reader.utf8(len)?);
            }
            tag::CLASS => class[index] = Some(reader.u2()?),
            tag::STRING | tag::METHOD_TYPE | tag::MODULE | tag::PACKAGE => reader.skip(2)?,
            tag::METHOD_HANDLE => reader.skip(3)?,
            tag::INTEGER
            | tag::FLOAT
            | tag::FIELDREF
            | tag::METHODREF
            | tag::INTERFACE_METHODREF
            | tag::NAME_AND_TYPE
            | tag::DYNAMIC
            | tag::INVOKE_DYNAMIC => reader.skip(4)?,
            tag::LONG | tag::DOUBLE => {
                reader.skip(8)?;
                // **The one rule a reader gets wrong first and notices last.**
                // JVMS 4.4.5: a Long or a Double takes two pool slots and the
                // second is unusable. Miss this and every index after the first
                // `long` constant is off by one, which reads as a corrupt file
                // somewhere much later.
                index += 1;
            }
            other => return fail(format!("unknown constant pool tag {other} at index {index}")),
        }
        index += 1;
    }
    Ok(Pool { utf8, class })
}

/// Everything a member or a class can carry that this slice reads.
#[derive(Default)]
struct Attributes {
    signature: Option<String>,
    throws: Vec<String>,
    annotations: Vec<String>,
    constant: bool,
    inner_classes: Vec<(String, String)>,
    parameter_annotations: Vec<Vec<String>>,
}

fn attributes(reader: &mut Reader, pool: &Pool) -> Result<Attributes, Error> {
    let mut found = Attributes::default();
    let count = reader.u2()?;
    for _ in 0..count {
        let name = pool.text(reader.u2()?)?;
        let length = reader.u4()? as usize;
        let end = reader.at + length;
        match name.as_str() {
            "Signature" => found.signature = Some(pool.text(reader.u2()?)?),
            "ConstantValue" => {
                reader.skip(2)?;
                found.constant = true;
            }
            "Exceptions" => {
                let n = reader.u2()?;
                for _ in 0..n {
                    found.throws.push(pool.class_name(reader.u2()?)?);
                }
            }
            // Merged deliberately: see the module header. A CLASS-retention
            // `@Nullable` is only in the invisible table.
            "RuntimeVisibleAnnotations" | "RuntimeInvisibleAnnotations" => {
                let n = reader.u2()?;
                for _ in 0..n {
                    found.annotations.push(annotation(reader, pool)?);
                }
            }
            // JVMS 4.7.18. A `u1` parameter count -- not `u2`, and that is the
            // one place this structure differs from every other table here.
            // Merged across visible and invisible for the same reason as above,
            // and unioned per index because a parameter can carry one of each.
            "RuntimeVisibleParameterAnnotations" | "RuntimeInvisibleParameterAnnotations" => {
                let parameters = reader.u1()? as usize;
                if found.parameter_annotations.len() < parameters {
                    found.parameter_annotations.resize(parameters, Vec::new());
                }
                for index in 0..parameters {
                    let n = reader.u2()?;
                    for _ in 0..n {
                        let name = annotation(reader, pool)?;
                        found.parameter_annotations[index].push(name);
                    }
                }
            }
            "InnerClasses" => {
                let n = reader.u2()?;
                for _ in 0..n {
                    let inner = reader.u2()?;
                    let outer = reader.u2()?;
                    let _name = reader.u2()?;
                    let _access = reader.u2()?;
                    // `outer` is zero for an anonymous or local class, which is
                    // exactly the distinction that decides whether a nested
                    // class is bindable.
                    if outer != 0 {
                        found
                            .inner_classes
                            .push((pool.class_name(inner)?, pool.class_name(outer)?));
                    }
                }
            }
            _ => {}
        }
        // Always resume at the attribute's declared end, whether this reader
        // understood it or not. An attribute it does not know is data to step
        // over, and stepping by the declared length is the only way that stays
        // true for attributes written after this code.
        if end > reader.bytes.len() {
            return fail(format!("attribute `{name}` runs past the end of the class file"));
        }
        reader.at = end;
    }
    Ok(found)
}

/// One `annotation` structure, returning its type's binary name.
///
/// The element-value pairs are walked rather than skipped because they nest,
/// and their lengths are implicit -- an annotation is the one structure in this
/// format that cannot be stepped over by reading a count.
fn annotation(reader: &mut Reader, pool: &Pool) -> Result<String, Error> {
    let descriptor = pool.text(reader.u2()?)?;
    let pairs = reader.u2()?;
    for _ in 0..pairs {
        let _name = reader.u2()?;
        element_value(reader, pool)?;
    }
    // `Lcom/example/Nullable;` -> `com/example/Nullable`
    Ok(descriptor.trim_start_matches('L').trim_end_matches(';').to_owned())
}

fn element_value(reader: &mut Reader, pool: &Pool) -> Result<(), Error> {
    let kind = reader.u1()?;
    match kind {
        b'B' | b'C' | b'D' | b'F' | b'I' | b'J' | b'S' | b'Z' | b's' | b'c' => reader.skip(2)?,
        b'e' => reader.skip(4)?,
        b'@' => {
            annotation(reader, pool)?;
        }
        b'[' => {
            let n = reader.u2()?;
            for _ in 0..n {
                element_value(reader, pool)?;
            }
        }
        other => return fail(format!("unknown annotation element tag {}", other as char)),
    }
    Ok(())
}

fn members(reader: &mut Reader, pool: &Pool) -> Result<Vec<Member>, Error> {
    let count = reader.u2()?;
    let mut found = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let access = reader.u2()?;
        let name = pool.text(reader.u2()?)?;
        let descriptor = pool.text(reader.u2()?)?;
        let extra = attributes(reader, pool)?;
        found.push(Member {
            access,
            name,
            descriptor,
            signature: extra.signature,
            throws: extra.throws,
            annotations: extra.annotations,
            parameter_annotations: extra.parameter_annotations,
            constant: extra.constant,
        });
    }
    Ok(found)
}

/// Parse one class file.
///
/// # Errors
///
/// Every malformed input is an `Error` and none is a panic: the inputs are
/// other people's jars, and `android.jar` alone is several thousand entries.
pub fn class_file(bytes: &[u8]) -> Result<ClassFile, Error> {
    let mut reader = Reader::new(bytes);
    if reader.u4()? != 0xCAFE_BABE {
        return fail("not a class file: the magic number is wrong");
    }
    let minor = reader.u2()?;
    let major = reader.u2()?;
    let pool = constant_pool(&mut reader)?;
    let access = reader.u2()?;
    let binary_name = pool.class_name(reader.u2()?)?;
    let super_index = reader.u2()?;
    // Zero exactly once in any program: `java/lang/Object` has no superclass.
    let super_name = if super_index == 0 { None } else { Some(pool.class_name(super_index)?) };

    let interface_count = reader.u2()?;
    let mut interfaces = Vec::with_capacity(interface_count as usize);
    for _ in 0..interface_count {
        interfaces.push(pool.class_name(reader.u2()?)?);
    }

    let fields = members(&mut reader, &pool)?;
    let methods = members(&mut reader, &pool)?;
    let extra = attributes(&mut reader, &pool)?;

    Ok(ClassFile {
        major,
        minor,
        access,
        binary_name,
        super_name,
        interfaces,
        fields,
        methods,
        signature: extra.signature,
        annotations: extra.annotations,
        inner_classes: extra.inner_classes,
    })
}

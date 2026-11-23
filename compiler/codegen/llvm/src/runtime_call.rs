//! Runtime calls are built from independently typed operands, never inferred
//! from the declaration. Opaque LLVM pointers otherwise allow a call to disagree
//! with that declaration while still assembling and linking successfully.

use std::borrow::Cow;
use std::fmt::{self, Write as _};

use nts_core::hir::{Func, Program};
use nts_diagnostics::{Diagnostic, Location};

use crate::{Platform, declared_result, dispatch_location, global, signatures};

/// An operand's type is the producer's answer. Attributes belong to its ABI
/// passing mode; neither can be silently changed to match a helper.
#[derive(Clone, Debug)]
pub(super) struct Operand<'a> {
    pub(super) ty: Cow<'a, str>,
    pub(super) value: Cow<'a, str>,
    attributes: Cow<'a, str>,
}

impl<'a> Operand<'a> {
    pub(super) fn new(ty: impl Into<Cow<'a, str>>, value: impl Into<Cow<'a, str>>) -> Self {
        Self::with_attributes(ty, value, "")
    }

    pub(super) fn with_attributes(
        ty: impl Into<Cow<'a, str>>,
        value: impl Into<Cow<'a, str>>,
        attributes: impl Into<Cow<'a, str>>,
    ) -> Self {
        Self {
            ty: ty.into(),
            value: value.into(),
            attributes: attributes.into(),
        }
    }
}

impl fmt::Display for Operand<'_> {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(out, "{} {}{}", self.ty, self.attributes, self.value)
    }
}

/// Provenance at the site building a call, including synthesized entries that
/// have no HIR function of their own.
#[derive(Clone, Copy)]
pub(super) struct Site<'a> {
    name: &'a str,
    location: Location,
    gobject: crate::gobject::Declarations,
}

impl<'a> Site<'a> {
    pub(super) fn function(func: &'a Func) -> Self {
        Self {
            name: &func.name,
            location: func.origin.location,
            gobject: crate::gobject::Declarations::default(),
        }
    }

    pub(super) fn synthetic(program: &Program, name: &'a str) -> Self {
        Self {
            name,
            location: dispatch_location(program),
            gobject: crate::gobject::Declarations::default(),
        }
    }

    pub(super) fn with_gobject(mut self, declarations: crate::gobject::Declarations) -> Self {
        self.gobject = declarations;
        self
    }

    pub(super) fn refuse(self, message: &str) -> Diagnostic {
        Diagnostic::error(
            "NTS3001",
            format!("{message} (in `{}`)", self.name),
            self.location,
        )
    }
}

/// The callee of a direct call that is not a runtime helper: a function the
/// program defines, a foreign symbol, or an SSA value holding a function
/// pointer. These constructors are the only spelling of such a callee outside
/// this module, so a declared helper can only be called through [`call`].
#[derive(Clone, Debug)]
pub(super) struct DirectCallee<'a>(Cow<'a, str>);

impl<'a> DirectCallee<'a> {
    /// A spelled global. A helper's declared name, bare or quoted, is refused:
    /// its call is the checked constructor's to render.
    pub(super) fn global(
        site: Site<'_>,
        platform: Platform,
        spelling: impl Into<Cow<'a, str>>,
    ) -> Result<Self, Diagnostic> {
        let spelling = spelling.into();
        let Some(name) = global_name(&spelling) else {
            return Err(site.refuse(&format!("an invalid callee spelling {spelling}")));
        };
        if declaration(site, platform, &name)?.is_some() {
            return Err(site.refuse(&format!(
                "a direct call to the runtime helper {name}, which only its checked constructor renders"
            )));
        }
        Ok(Self(spelling))
    }

    /// A symbol by its bare name, such as a foreign function's.
    pub(super) fn symbol(
        site: Site<'_>,
        platform: Platform,
        name: &str,
    ) -> Result<DirectCallee<'static>, Diagnostic> {
        DirectCallee::global(site, platform, global(name))
    }

    /// A function this program defines, by its source symbol.
    pub(super) fn compiled(
        site: Site<'_>,
        platform: Platform,
        program: &crate::Emission<'_>,
        function: &str,
    ) -> Result<DirectCallee<'static>, Diagnostic> {
        DirectCallee::global(site, platform, program.source_function(function))
    }

    /// An SSA value holding the address to call.
    pub(super) fn value(value: impl Into<Cow<'a, str>>) -> Self {
        let value = value.into();
        assert!(
            value.as_bytes().first() == Some(&b'%'),
            "{value} is not an SSA value"
        );
        Self(value)
    }
}

/// What a call op calls: a runtime helper, rendered by the checked
/// constructor at its declaration, or a direct callee at the op's own types.
pub(super) enum Called<'a> {
    Runtime(&'a str),
    Direct(DirectCallee<'a>),
}

impl fmt::Display for DirectCallee<'_> {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(&self.0)
    }
}

/// The symbol a valid global spelling names: `@name`, or `@"..."` with its
/// hex escapes decoded, so a quoted spelling cannot hide a helper's name.
fn global_name(spelling: &str) -> Option<Cow<'_, str>> {
    if !crate::valid_global_spelling(spelling) {
        return None;
    }
    let name = &spelling[1..];
    let Some(quoted) = name
        .strip_prefix('"')
        .and_then(|name| name.strip_suffix('"'))
    else {
        return Some(Cow::Borrowed(name));
    };
    let mut bytes = Vec::with_capacity(quoted.len());
    let mut rest = quoted.as_bytes();
    while let Some((&byte, tail)) = rest.split_first() {
        if byte == b'\\' {
            let hex = std::str::from_utf8(tail.get(..2)?).ok()?;
            bytes.push(u8::from_str_radix(hex, 16).ok()?);
            rest = &tail[2..];
        } else {
            bytes.push(byte);
            rest = tail;
        }
    }
    String::from_utf8(bytes).ok().map(Cow::Owned)
}

/// Render a direct call whose callee is not a runtime helper. `returns` is
/// the call's return type, with any result attributes or explicit function
/// type a variadic callee needs.
pub(super) fn direct(
    returns: impl fmt::Display,
    callee: &DirectCallee<'_>,
    arguments: impl fmt::Display,
) -> String {
    format!("call {returns} {callee}({arguments})")
}

/// The type prefix of a declared parameter, without its parameter attributes.
/// This reads the declaration, never a rendered argument or call.
fn parameter_type(spec: &str) -> &str {
    if spec.starts_with('[') {
        return spec.find(']').map_or(spec, |end| &spec[..=end]);
    }
    spec.split_ascii_whitespace().next().unwrap_or(spec)
}

/// A pointer to caller-owned storage, with the declaration's ABI attributes.
/// The independently known operand type stays `ptr` even if the declaration
/// were changed to a different type, so the constructor can refuse it.
pub(super) fn pointer_parameter<'a>(
    value: impl Into<Cow<'a, str>>,
    parameter: &str,
) -> Operand<'a> {
    let attributes = parameter
        .strip_prefix("ptr ")
        .map(|attributes| format!("{attributes} "))
        .unwrap_or_default();
    Operand::with_attributes("ptr", value, attributes)
}

/// Render typed operands of an ordinary compiled/native call. Runtime calls
/// use `call`, which checks the declaration before producing any text.
pub(super) fn operands_text(operands: &[Operand<'_>]) -> String {
    let mut text = String::new();
    for (at, operand) in operands.iter().enumerate() {
        if at != 0 {
            text.push_str(", ");
        }
        let _ = write!(text, "{operand}");
    }
    text
}

/// Calls whose symbol comes from a foreign binding can still name a runtime
/// helper. Its canonical declaration wins over the binding's assumed shape.
pub(super) fn external(
    site: Site<'_>,
    platform: Platform,
    helper: &str,
    returns: &str,
    operands: &[Operand<'_>],
) -> Result<String, Diagnostic> {
    external_spelled(site, platform, helper, returns, operands, false)
}

/// A synthesized entry whose established spelling is explicitly quoted.
/// Canonical helpers still use the checked constructor and its declaration.
pub(super) fn external_quoted(
    site: Site<'_>,
    platform: Platform,
    helper: &str,
    returns: &str,
    operands: &[Operand<'_>],
) -> Result<String, Diagnostic> {
    external_spelled(site, platform, helper, returns, operands, true)
}

fn external_spelled(
    site: Site<'_>,
    platform: Platform,
    helper: &str,
    returns: &str,
    operands: &[Operand<'_>],
    quoted: bool,
) -> Result<String, Diagnostic> {
    if declaration(site, platform, helper)?.is_some() {
        call(site, platform, helper, operands)
    } else {
        let callee = if quoted {
            // These entries are generated identifiers. Preserve their quoted
            // spelling while retaining the global-name owner's validation.
            DirectCallee::global(site, platform, format!("@\"{helper}\""))?
        } else {
            DirectCallee::symbol(site, platform, helper)?
        };
        Ok(direct(returns, &callee, operands_text(operands)))
    }
}

/// Canonical runtime declarations are always present. Product support names
/// resolve only under the capability that also emits their declarations.
fn declaration(
    site: Site<'_>,
    platform: Platform,
    helper: &str,
) -> Result<Option<&'static signatures::Signature>, Diagnostic> {
    if let Some(known) = signatures::signature_on(helper, platform) {
        return Ok(Some(known));
    }
    let known = crate::gobject::signature(helper);
    if known.is_some() && !site.gobject.contains(helper) {
        return Err(site.refuse(&format!(
            "a call to {helper}, whose GObject support declaration this program does not emit"
        )));
    }
    Ok(known)
}

/// Whether a value of LLVM type `ty` is one C's default argument promotions
/// produce, and so what a callee's `va_arg` can read from a `...` tail: an
/// integer narrower than `int` arrives as `int`, and a `float` as `double`.
fn promoted(ty: &str) -> bool {
    !matches!(ty, "i1" | "i8" | "i16" | "half" | "bfloat" | "float")
}

/// Construct one runtime call, or refuse at the site that tried to make it.
/// Each fixed parameter takes exactly its declared type. A variadic helper's
/// tail takes any number of operands, each of a type C's default argument
/// promotions produce, and the call names the callee's function type.
/// Declaration lookup uses indexes built once per process, so checking a call
/// costs only its own arguments, independently of the number of helpers.
pub(super) fn call(
    site: Site<'_>,
    platform: Platform,
    helper: &str,
    operands: &[Operand<'_>],
) -> Result<String, Diagnostic> {
    let known = declaration(site, platform, helper)?.ok_or_else(|| {
        site.refuse(&format!(
            "a call to {helper}, which has no declared runtime signature"
        ))
    })?;
    let fixed = known.fixed();
    let checked = if known.variadic() {
        fixed.len()
    } else {
        fixed.len().max(operands.len())
    };
    for at in 0..checked {
        let expected = fixed.get(at).map(|spec| parameter_type(spec));
        let found = operands.get(at).map(|operand| operand.ty.as_ref());
        if expected != found {
            return Err(site.refuse(&format!(
                "runtime helper {helper} parameter {}: expected {}, found {}",
                at + 1,
                expected.unwrap_or("<no parameter>"),
                found.unwrap_or("<missing argument>"),
            )));
        }
    }
    for (at, operand) in operands.iter().enumerate().skip(fixed.len()) {
        if !promoted(&operand.ty) {
            return Err(site.refuse(&format!(
                "runtime helper {helper} variadic argument {}: {} is not a type C's default argument promotions pass through `...`",
                at + 1,
                operand.ty,
            )));
        }
    }
    let (attribute, returns) = declared_result(known.returns);
    let mut text = format!("call {attribute}{returns} ");
    if known.variadic() {
        // A variadic callee is called at its own function type, which names
        // the fixed parameters' types and the tail.
        text.push('(');
        for spec in fixed {
            let _ = write!(text, "{}, ", parameter_type(spec));
        }
        text.push_str(signatures::VARIADIC_TAIL);
        text.push_str(") ");
    }
    let _ = write!(text, "{}(", global(helper));
    for (at, operand) in operands.iter().enumerate() {
        if at != 0 {
            text.push_str(", ");
        }
        let _ = write!(text, "{operand}");
    }
    text.push(')');
    Ok(text)
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;
    use nts_diagnostics::{SourceId, Span};

    fn site() -> Site<'static> {
        Site {
            name: "subject",
            gobject: crate::gobject::Declarations::default(),
            location: Location {
                file: SourceId(0),
                span: Span::new(0, 0),
            },
        }
    }

    #[test]
    fn an_operand_is_checked_before_a_runtime_call_is_rendered() {
        for platform in [
            Platform::SYSV_X86_64,
            Platform::WIN64_X86_64,
            Platform::APPLE_ARM64,
            Platform::LINUX_ARM64,
            Platform::WINDOWS_ARM64,
        ] {
            let control = call(
                site(),
                platform,
                "nts_str_split",
                &[Operand::new("ptr", "%s"), Operand::new("ptr", "%separator")],
            )
            .expect("typed control");
            assert_eq!(control, "call ptr @nts_str_split(ptr %s, ptr %separator)");
            let error = call(
                site(),
                platform,
                "nts_str_split",
                &[
                    Operand::new("ptr", "%s"),
                    Operand::new("double", "%separator"),
                ],
            )
            .expect_err("a double cannot fill a pointer parameter");
            assert_eq!(error.code, "NTS3001");
            assert_eq!(
                error.message,
                "runtime helper nts_str_split parameter 2: expected ptr, found double (in `subject`)"
            );
        }
    }

    #[test]
    fn physical_erased_arguments_and_hidden_results_remain_typed() {
        for platform in [
            Platform::SYSV_X86_64,
            Platform::WIN64_X86_64,
            Platform::APPLE_ARM64,
            Platform::LINUX_ARM64,
            Platform::WINDOWS_ARM64,
        ] {
            let args = if platform.arch == crate::Arch::Aarch64 {
                vec![Operand::new("[2 x i64]", "%words")]
            } else if crate::indirect::applies(platform) {
                vec![Operand::new("ptr", "%copy")]
            } else {
                vec![Operand::new("i32", "%tag"), Operand::new("i64", "%bits")]
            };
            assert!(call(site(), platform, "nts_value_truthy_fn", &args).is_ok());
        }
        let args = [
            crate::indirect::result(),
            Operand::new("ptr", "%map"),
            Operand::new("ptr", "%key"),
            Operand::new("i32", "0"),
        ];
        let rendered = call(site(), Platform::WIN64_X86_64, "nts_map_get", &args)
            .expect("hidden pointer control");
        assert_eq!(
            rendered,
            "call void @nts_map_get(ptr sret({ i32, i64 }) align 8 %win64.r, ptr %map, ptr %key, i32 0)"
        );
        let refused = call(site(), Platform::WIN64_X86_64, "nts_map_get", &args[1..])
            .expect_err("the hidden pointer is a counted argument");
        assert!(
            refused
                .message
                .contains("parameter 3: expected ptr, found i32")
        );
    }

    #[test]
    fn a_foreign_symbol_cannot_bypass_a_canonical_runtime_declaration() {
        let args = [Operand::new("ptr", "%s"), Operand::new("double", "%bad")];
        assert!(external(site(), Platform::SYSV_X86_64, "nts_str_split", "ptr", &args).is_err());
        assert!(
            external_quoted(site(), Platform::SYSV_X86_64, "nts_str_split", "ptr", &args).is_err()
        );
    }

    #[test]
    fn com_answers_keep_their_call_bytes_and_refuse_a_wrong_result_operand() {
        for platform in [Platform::WIN64_X86_64, Platform::WINDOWS_ARM64] {
            for helper in ["nts_com_answer", "nts_com_answer_string"] {
                let rendered = call(site(), platform, helper, &[Operand::new("ptr", "%r")])
                    .expect("COM answer control");
                assert_eq!(rendered, format!("call ptr @{helper}(ptr %r)"));
                let bad = call(site(), platform, helper, &[Operand::new("double", "%r")])
                    .expect_err("a numeric result cannot be answered as a pointer");
                assert!(
                    bad.message.contains(&format!(
                        "runtime helper {helper} parameter 1: expected ptr, found double"
                    )),
                    "{}",
                    bad.message
                );
            }
        }
        let rendered = external_quoted(
            site(),
            Platform::SYSV_X86_64,
            "nts.open.g.double.1_0",
            "double",
            &[Operand::new("{ i32, i64 }", "%object")],
        )
        .expect("synthesized quoted entry");
        assert_eq!(
            rendered,
            "call double @\"nts.open.g.double.1_0\"({ i32, i64 } %object)"
        );
    }

    #[test]
    fn absent_and_extra_arguments_are_named_too() {
        for (args, message) in [
            (
                vec![Operand::new("ptr", "%s")],
                "parameter 2: expected ptr, found <missing argument>",
            ),
            (
                vec![
                    Operand::new("ptr", "%s"),
                    Operand::new("ptr", "%separator"),
                    Operand::new("i32", "0"),
                ],
                "parameter 3: expected <no parameter>, found i32",
            ),
        ] {
            let error = call(site(), Platform::SYSV_X86_64, "nts_str_split", &args)
                .expect_err("arity mismatch");
            assert!(error.message.contains(message), "{}", error.message);
        }
    }

    #[test]
    #[should_panic(expected = "@nts_release is not an SSA value")]
    fn an_ssa_callee_cannot_spell_a_global() {
        let _ = DirectCallee::value("@nts_release");
    }

    #[test]
    fn a_direct_callee_cannot_spell_a_declared_runtime_helper() {
        for platform in [
            Platform::SYSV_X86_64,
            Platform::WIN64_X86_64,
            Platform::APPLE_ARM64,
            Platform::LINUX_ARM64,
            Platform::WINDOWS_ARM64,
        ] {
            for spelling in ["@nts_release", "@\"nts_release\"", "@\"nts\\5Frelease\""] {
                let refused = DirectCallee::global(site(), platform, spelling)
                    .expect_err("a helper is called only through `call`");
                assert_eq!(refused.code, "NTS3001");
                assert!(
                    refused
                        .message
                        .contains("a direct call to the runtime helper nts_release"),
                    "{}",
                    refused.message
                );
            }
            assert!(DirectCallee::symbol(site(), platform, "nts_release").is_err());
            let control = DirectCallee::symbol(site(), platform, "objc_msgSend")
                .expect("a foreign symbol is a direct callee");
            assert_eq!(
                direct("ptr (ptr, ptr)", &control, "ptr %r, ptr %s"),
                "call ptr (ptr, ptr) @objc_msgSend(ptr %r, ptr %s)"
            );
        }
        assert!(DirectCallee::global(site(), Platform::SYSV_X86_64, "nts_release").is_err());
        assert!(DirectCallee::global(site(), Platform::SYSV_X86_64, "@\"bad\\G0\"").is_err());
        assert_eq!(
            direct("void", &DirectCallee::value("%visit"), "ptr %m0"),
            "call void %visit(ptr %m0)"
        );
    }
}

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
    pub(super) ty: &'a str,
    pub(super) value: Cow<'a, str>,
    attributes: Cow<'a, str>,
}

impl<'a> Operand<'a> {
    pub(super) fn new(ty: &'a str, value: impl Into<Cow<'a, str>>) -> Self {
        Self::with_attributes(ty, value, "")
    }

    pub(super) fn with_attributes(
        ty: &'a str,
        value: impl Into<Cow<'a, str>>,
        attributes: impl Into<Cow<'a, str>>,
    ) -> Self {
        Self {
            ty,
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
}

impl<'a> Site<'a> {
    pub(super) fn function(func: &'a Func) -> Self {
        Self {
            name: &func.name,
            location: func.origin.location,
        }
    }

    pub(super) fn synthetic(program: &Program, name: &'a str) -> Self {
        Self {
            name,
            location: dispatch_location(program),
        }
    }

    pub(super) fn refuse(self, message: &str) -> Diagnostic {
        Diagnostic::error(
            "NTS3001",
            format!("{message} (in `{}`)", self.name),
            self.location,
        )
    }
}

/// The type prefix of a declared parameter, without its parameter attributes.
/// This reads the declaration, never a rendered argument or call.
fn parameter_type(spec: &str) -> &str {
    if spec.starts_with('[') {
        return spec.find(']').map_or(spec, |end| &spec[..=end]);
    }
    spec.split_ascii_whitespace().next().unwrap_or(spec)
}

/// Construct one runtime call, or refuse at the site that tried to make it.
/// `signature_on` uses an index built once per process, so checking a call
/// costs only its own arguments, independently of the number of helpers.
pub(super) fn call(
    site: Site<'_>,
    platform: Platform,
    helper: &str,
    operands: &[Operand<'_>],
) -> Result<String, Diagnostic> {
    let known = signatures::signature_on(helper, platform).ok_or_else(|| {
        site.refuse(&format!(
            "a call to {helper}, which has no declared runtime signature"
        ))
    })?;
    for at in 0..known.params.len().max(operands.len()) {
        let expected = known.params.get(at).map(|spec| parameter_type(spec));
        let found = operands.get(at).map(|operand| operand.ty);
        if expected != found {
            return Err(site.refuse(&format!(
                "runtime helper {helper} parameter {}: expected {}, found {}",
                at + 1,
                expected.unwrap_or("<no parameter>"),
                found.unwrap_or("<missing argument>"),
            )));
        }
    }
    let (attribute, returns) = declared_result(known.returns);
    let mut text = format!("call {attribute}{returns} {}(", global(helper));
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
}

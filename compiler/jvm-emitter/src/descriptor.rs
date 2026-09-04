//! Type descriptors, and the one thing an emitter needs to read back out of one.
//!
//! A descriptor is the JVM's spelling of a type: `D` is a double, `[I` an array
//! of ints, `Lnts/gen/Point;` a class, `(DI)Ljava/lang/String;` a method taking
//! a double and an int and returning a string.
//!
//! # Why this module parses as well as builds
//!
//! `invokestatic` pops as many stack words as the callee's parameters occupy
//! and pushes as many as its result does, and the only statement of that is the
//! descriptor. An emitter that took the counts as separate arguments would have
//! two answers to one question, which is the failure this repository's shared
//! codegen crate exists to prevent -- so the counts are read from the string
//! that is already the truth.

/// How many stack words a value of this descriptor occupies.
///
/// Two for `long` and `double`, zero for `void`, one for everything else. This
/// is the whole of the JVM's "category" distinction and it is the reason a
/// local slot table cannot be indexed by value number alone.
#[must_use]
pub fn words(descriptor: &str) -> u16 {
    match descriptor.as_bytes().first() {
        Some(b'J' | b'D') => 2,
        Some(b'V') | None => 0,
        Some(_) => 1,
    }
}

/// The stack effect of a call: words popped for the parameters, words pushed
/// for the result.
///
/// The receiver is *not* counted -- `invokevirtual` pops one more than this
/// says and `invokestatic` does not, which is the caller's distinction to make.
///
/// Returns `None` for a descriptor that is not a well-formed method
/// descriptor, which is a bug in the emitter rather than a program error, and
/// is reported as such rather than guessed at.
#[must_use]
pub fn call_effect(descriptor: &str) -> Option<(u16, u16)> {
    let bytes = descriptor.as_bytes();
    if bytes.first() != Some(&b'(') {
        return None;
    }
    let mut at = 1;
    let mut arguments = 0u16;
    while at < bytes.len() && bytes[at] != b')' {
        let (length, wide) = field_length(&bytes[at..])?;
        arguments = arguments.checked_add(if wide { 2 } else { 1 })?;
        at += length;
    }
    if at >= bytes.len() {
        return None;
    }
    let result = descriptor.get(at + 1..)?;
    // A malformed return type must not be read as `void`, which would make the
    // stack one word short and the class unverifiable in a way that points at
    // the call rather than at the descriptor.
    let (length, _) = if result == "V" {
        (1, false)
    } else {
        field_length(result.as_bytes())?
    };
    if length != result.len() {
        return None;
    }
    Some((arguments, words(result)))
}

/// The length in bytes of the field descriptor at the front of `bytes`, and
/// whether it names a two-word type.
fn field_length(bytes: &[u8]) -> Option<(usize, bool)> {
    match bytes.first()? {
        b'B' | b'C' | b'F' | b'I' | b'S' | b'Z' => Some((1, false)),
        b'J' | b'D' => Some((1, true)),
        b'L' => {
            let end = bytes.iter().position(|&b| b == b';')?;
            Some((end + 1, false))
        }
        b'[' => {
            // An array is one word whatever it holds, so the element's own
            // width is read only to find where the descriptor ends.
            let (inner, _) = field_length(bytes.get(1..)?)?;
            Some((inner + 1, false))
        }
        _ => None,
    }
}

/// The descriptor of an array of `element`.
#[must_use]
pub fn array_of(element: &str) -> String {
    format!("[{element}")
}

/// The descriptor of a class named the JVM's way (`java/lang/String`).
#[must_use]
pub fn object(internal_name: &str) -> String {
    format!("L{internal_name};")
}

/// A method descriptor from its parts.
#[must_use]
pub fn method(parameters: &[&str], result: &str) -> String {
    let mut out = String::with_capacity(2 + result.len() + parameters.len() * 2);
    out.push('(');
    for parameter in parameters {
        out.push_str(parameter);
    }
    out.push(')');
    out.push_str(result);
    out
}

/// The class an `anewarray`, `checkcast` or `instanceof` operand names.
///
/// These take a *class* constant, and for an array type the class constant's
/// name is the descriptor rather than an internal name -- `[D` and not `[D;`,
/// and `[Ljava/lang/String;` with the `L` and the `;` that a plain class
/// constant does not have. Getting this backwards produces a class that loads
/// and fails at the first cast, so the conversion lives here rather than at
/// each of the three call sites.
#[must_use]
pub fn class_operand(descriptor: &str) -> String {
    if let Some(inner) = descriptor.strip_prefix('L') {
        inner.strip_suffix(';').unwrap_or(inner).to_owned()
    } else {
        descriptor.to_owned()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;

    #[test]
    fn a_double_is_two_words_and_an_array_of_them_is_one() {
        assert_eq!(words("D"), 2);
        assert_eq!(words("[D"), 1);
        assert_eq!(words("V"), 0);
        assert_eq!(words("Ljava/lang/String;"), 1);
    }

    #[test]
    fn call_effects() {
        assert_eq!(call_effect("()V"), Some((0, 0)));
        assert_eq!(call_effect("(D)D"), Some((2, 2)));
        assert_eq!(call_effect("(DI)Ljava/lang/String;"), Some((3, 1)));
        assert_eq!(call_effect("(JJ)J"), Some((4, 2)));
        assert_eq!(
            call_effect("([Ljava/lang/String;I)[[D"),
            Some((2, 1)),
            "an array parameter is one word whatever its element is"
        );
    }

    #[test]
    fn a_malformed_descriptor_is_not_guessed_at() {
        assert_eq!(call_effect("D)V"), None, "no opening paren");
        assert_eq!(call_effect("(D"), None, "no closing paren");
        assert_eq!(call_effect("(Ljava/lang/String)V"), None, "unterminated class");
        assert_eq!(call_effect("(D)Q"), None, "unknown return type");
        assert_eq!(call_effect("(D)DD"), None, "two return types");
    }

    #[test]
    fn class_operands_lose_their_wrapper_but_arrays_keep_theirs() {
        assert_eq!(class_operand("Lnts/gen/Point;"), "nts/gen/Point");
        assert_eq!(class_operand("[D"), "[D");
        assert_eq!(class_operand("[Ljava/lang/String;"), "[Ljava/lang/String;");
    }
}

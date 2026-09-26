//! ECMAScript's `Number::toString`, for the compiler rather than the runtime.
//!
//! The runtime has this as `nts_number_to_string` in C, reached only when a
//! program runs. Nothing in the middle end could stringify a number at all,
//! which cost two things: `fold.rs` cannot fold `"" + n`, and a **computed
//! member name** spelled as anything but a plain decimal named the wrong member.
//!
//! `[0x10]` is a member called `"16"`. Taking the literal's spelling -- which
//! `ast.rs` attaches deliberately, because the checker's value is not always the
//! literal -- put `"0x10"` in the layout while every read looked for `"16"`, so
//! an accessor or method lookup found nothing and **the reading statement was
//! dropped with no diagnostic**, and a class field `[0x10] = "f"` reached a slot
//! that was not there and **segfaulted**.
//!
//! Two near-misses are the reason this is the real algorithm rather than a rule
//! about spellings, and both were caught by the conformance lane against node
//! before anything was built:
//!
//! - **The checker's number is not the answer either.**
//!   `[0.9999999999999999]` is a key named `"0.9999999999999999"` -- a distinct
//!   double whose shortest round-trip string is itself -- while tsgo answers `1`
//!   for that literal.
//! - **Nor is "the text, when it reprints identically".** `[1e-7]` is named
//!   `"1e-7"` in JavaScript and `0.0000001` by Rust's `Display`, so that test
//!   would have started refusing a key that works today.
//!
//! So neither source is right on its own, and every rule short of the algorithm
//! broke a case somebody was relying on.

/// ECMAScript's `Number::toString(x)` for radix 10 (spec 7.1.12.1).
///
/// Rust's `{:e}` already yields the **shortest round-tripping** mantissa and
/// exponent, which is the same digit string the spec's step 5 asks for ("`k` as
/// small as possible"). So what is written here is the *formatting*: where the
/// decimal point goes, when to pad with zeros, and when to give up and use
/// exponential notation. Those thresholds are the whole difference from Rust's
/// own `Display`, which never uses exponential notation and therefore prints
/// `1e21` as twenty-two digits where JavaScript prints `1e+21`.
#[must_use]
pub fn to_js_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value == 0.0 {
        // Both zeroes print `0`: the sign of zero is not observable here, which
        // is why `String(-0)` is `"0"` while `(-0).toFixed(2)` is `"0.00"` and
        // `1 / -0` is `-Infinity`.
        return "0".to_owned();
    }
    if value < 0.0 {
        return format!("-{}", to_js_string(-value));
    }
    if value.is_infinite() {
        return "Infinity".to_owned();
    }

    // `s` are the significant digits and `n` the position of the decimal point:
    // `s * 10^(n - k) == value`, with `k = s.len()`. Read off Rust's exponential
    // form rather than derived, so the digits are the ones that round-trip.
    let exponential = format!("{value:e}");
    let (mantissa, exponent) = exponential.split_once('e').unwrap_or((&exponential, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let Ok(exponent) = exponent.parse::<i32>() else {
        return exponential;
    };
    let k = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    let n = exponent + 1;

    if k <= n && n <= 21 {
        // `1e20` -> the digits, then enough zeros to reach the point.
        let mut out = digits;
        for _ in 0..(n - k) {
            out.push('0');
        }
        return out;
    }
    if 0 < n && n <= 21 {
        // A point inside the digits: `1.5`, `16.25`.
        let at = usize::try_from(n).unwrap_or(0);
        return format!("{}.{}", &digits[..at], &digits[at..]);
    }
    if -6 < n && n <= 0 {
        // `0.000001`, and `0.9999999999999999` -- the case that rules the
        // checker's rounded value out as a source.
        let zeros = "0".repeat(usize::try_from(-n).unwrap_or(0));
        return format!("0.{zeros}{digits}");
    }
    // Exponential, which is where Rust and JavaScript part company: the sign is
    // always written, and the exponent is `n - 1` rather than Rust's `n`.
    let sign = if n - 1 < 0 { '-' } else { '+' };
    let magnitude = (n - 1).abs();
    if k == 1 {
        format!("{digits}e{sign}{magnitude}")
    } else {
        format!("{}.{}e{sign}{magnitude}", &digits[..1], &digits[1..])
    }
}

/// The value a numeric literal denotes, from the digits as written.
///
/// `str::parse` covers a decimal literal exactly -- Rust's parser is correctly
/// rounding -- and rejects every other spelling JavaScript allows. Those are all
/// **integers**, so a radix parse is exact and needs nothing from the checker.
///
/// Not asking the checker is the point rather than an optimisation. It rounds
/// (`ast.rs`: tsgo answers `1` for `0.9999999999999999`), and for a **static**
/// computed member name it records no type on the literal's node at all -- so a
/// first version of this that fell back to the checker turned six test262 cases
/// from a wrong answer into a *refusal*: `static get [0x10]()` in both class forms,
/// for hex, binary and octal, while the spellings Rust can parse passed. The gate's
/// reconciliation named all six.
#[must_use]
pub fn parse_literal(text: &str) -> Option<f64> {
    // Separators are a spelling, not a value: `1_000` is `1000`.
    let text = if text.contains('_') { text.replace('_', "") } else { text.to_owned() };
    let radix = match text.as_bytes() {
        [b'0', b'x' | b'X', ..] => 16,
        [b'0', b'o' | b'O', ..] => 8,
        [b'0', b'b' | b'B', ..] => 2,
        _ => return text.parse::<f64>().ok(),
    };
    // `u128` rather than `u64`: a hex literal may carry more digits than a double
    // can hold, and the narrowing below **is** the language's semantics -- a
    // numeric literal denotes a `Number`, so `0x20000000000001` rounds in
    // JavaScript exactly as it does here. Losing precision is the specified
    // behaviour rather than an accepted risk, which is why this is allowed rather
    // than worked around.
    #[allow(clippy::cast_precision_loss)]
    u128::from_str_radix(&text[2..], radix).ok().map(|value| value as f64)
}

#[cfg(test)]
mod tests {
    use super::{parse_literal, to_js_string};

    /// The values the conformance lane chose, because they are where Rust's
    /// `Display` and `Number::toString` disagree.
    #[test]
    fn the_spellings_that_disagree_with_rusts_display() {
        // Rust prints twenty-two digits; JavaScript switches to exponential at
        // exactly 1e21.
        assert_eq!(to_js_string(1e21), "1e+21");
        // And not at 1e20, which is the boundary on the other side.
        assert_eq!(to_js_string(1e20), "100000000000000000000");
        // Rust prints `0.0000001`; JavaScript keeps the exponent below 1e-6.
        assert_eq!(to_js_string(1e-7), "1e-7");
        // One step up, and both spell it out.
        assert_eq!(to_js_string(1e-6), "0.000001");
        // `123e-20` is `1.23e-18`, with three significant digits.
        assert_eq!(to_js_string(123e-20), "1.23e-18");
    }

    /// The literal whose *value* the checker rounds, and whose name is therefore
    /// neither the checker's number nor Rust's idea of canonical.
    ///
    /// Written without digit separators deliberately: the sixteen nines are the
    /// subject, and the assertion is that they come back **unchanged**, so the
    /// literal and the expected string have to be comparable by eye.
    #[allow(clippy::unreadable_literal)]
    #[test]
    fn a_double_whose_shortest_string_is_itself() {
        assert_eq!(to_js_string(0.9999999999999999), "0.9999999999999999");
        assert_ne!(to_js_string(0.9999999999999999), "1");
    }

    /// Every non-decimal spelling in the report names the same member.
    #[test]
    fn a_spelling_is_not_a_name() {
        for value in [16.0, f64::from(0x10), f64::from(0b1_0000), f64::from(0o20), 1.6e1] {
            assert_eq!(to_js_string(value), "16");
        }
        assert_eq!(to_js_string(9_007_199_254_740_992.0), "9007199254740992");
    }

    /// The spellings `str::parse` rejects, which are the ones the checker used to
    /// be asked about -- and the ones it has no answer for on a static member.
    #[test]
    fn every_spelling_of_sixteen_parses_without_the_checker() {
        for text in ["16", "0x10", "0X10", "0b10000", "0B10000", "0o20", "0O20", "1.6e1", "16.0"] {
            assert_eq!(parse_literal(text).map(to_js_string), Some("16".to_owned()), "{text}");
        }
        assert_eq!(parse_literal("1_000").map(to_js_string), Some("1000".to_owned()));
        // And the ones whose *value* the checker rounds.
        assert_eq!(
            parse_literal("0.9999999999999999").map(to_js_string),
            Some("0.9999999999999999".to_owned())
        );
        assert_eq!(parse_literal("1e21").map(to_js_string), Some("1e+21".to_owned()));
        assert_eq!(parse_literal("not a number"), None);
    }

    #[test]
    fn the_ordinary_middle() {
        assert_eq!(to_js_string(0.0), "0");
        assert_eq!(to_js_string(-0.0), "0");
        assert_eq!(to_js_string(1.0), "1");
        assert_eq!(to_js_string(-1.5), "-1.5");
        assert_eq!(to_js_string(0.1), "0.1");
        assert_eq!(to_js_string(f64::NAN), "NaN");
        assert_eq!(to_js_string(f64::INFINITY), "Infinity");
        assert_eq!(to_js_string(f64::NEG_INFINITY), "-Infinity");
    }
}

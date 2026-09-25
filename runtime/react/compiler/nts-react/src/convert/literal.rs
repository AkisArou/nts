//! Literal values, read from the source as a JavaScript lexer reads them.
//!
//! tsgo's snapshot keeps no text for string, numeric or bigint literals (their
//! nodes carry extended data, which nts resolves only for template pieces), so
//! the value comes from the literal as written.

/// The value of a string literal, given with its quotes: escapes processed.
/// Lone surrogates from `\uD800` survive as UTF-16 code units.
#[must_use]
pub fn cook_string(raw: &str) -> Vec<u16> {
    let inner: Vec<char> = raw.chars().collect();
    let body = inner.get(1..inner.len().saturating_sub(1)).unwrap_or(&[]);
    let mut out = Vec::with_capacity(body.len());
    let mut at = 0;
    while at < body.len() {
        let ch = body[at];
        at += 1;
        if ch != '\\' {
            let mut buffer = [0u16; 2];
            out.extend_from_slice(ch.encode_utf16(&mut buffer));
            continue;
        }
        let Some(&escape) = body.get(at) else { break };
        at += 1;
        match escape {
            'n' => out.push(0x0A),
            't' => out.push(0x09),
            'r' => out.push(0x0D),
            'b' => out.push(0x08),
            'f' => out.push(0x0C),
            'v' => out.push(0x0B),
            '0' if !body.get(at).is_some_and(char::is_ascii_digit) => out.push(0),
            'x' => {
                let hex: String = body.iter().skip(at).take(2).collect();
                at += 2;
                out.push(u16::from_str_radix(&hex, 16).unwrap_or(0));
            }
            'u' if body.get(at) == Some(&'{') => {
                let digits: String = body.iter().skip(at + 1).take_while(|c| **c != '}').collect();
                at += digits.len() + 2;
                let code = u32::from_str_radix(&digits, 16).unwrap_or(0xFFFD);
                match char::from_u32(code) {
                    Some(ch) => {
                        let mut buffer = [0u16; 2];
                        out.extend_from_slice(ch.encode_utf16(&mut buffer));
                    }
                    None => out.push(u16::try_from(code).unwrap_or(0xFFFD)),
                }
            }
            'u' => {
                let hex: String = body.iter().skip(at).take(4).collect();
                at += 4;
                out.push(u16::from_str_radix(&hex, 16).unwrap_or(0xFFFD));
            }
            // A line continuation: the backslash and the line break vanish.
            '\r' => {
                if body.get(at) == Some(&'\n') {
                    at += 1;
                }
            }
            '\n' | '\u{2028}' | '\u{2029}' => {}
            other => {
                let mut buffer = [0u16; 2];
                out.extend_from_slice(other.encode_utf16(&mut buffer));
            }
        }
    }
    out
}

/// The value of a numeric literal as written: separators, radix prefixes and
/// legacy octal (`017`) included.
///
/// A JavaScript number is an `f64`, so an integer literal beyond 2^53 rounds
/// here exactly as it rounds in JavaScript: the precision loss is the value.
#[must_use]
#[allow(clippy::cast_precision_loss)]
pub fn numeric_value(raw: &str) -> f64 {
    let text: String = raw.chars().filter(|c| *c != '_').collect();
    let lower = text.to_ascii_lowercase();
    let radix = |prefix: &str, radix: u32| {
        lower.strip_prefix(prefix).map(|digits| u128::from_str_radix(digits, radix).map_or(f64::NAN, |value| value as f64))
    };
    if let Some(value) = radix("0x", 16).or_else(|| radix("0o", 8)).or_else(|| radix("0b", 2)) {
        return value;
    }
    if lower.len() > 1 && lower.starts_with('0') && lower.chars().all(|c| c.is_ascii_digit()) && !lower.contains(['8', '9']) {
        return u128::from_str_radix(&lower[1..], 8).map_or(f64::NAN, |value| value as f64);
    }
    lower.parse().unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use super::{cook_string, numeric_value};

    fn cooked(raw: &str) -> String {
        String::from_utf16_lossy(&cook_string(raw))
    }

    #[test]
    fn strings_are_cooked() {
        assert_eq!(cooked(r#""react""#), "react");
        assert_eq!(cooked(r"'a\tb\n'"), "a\tb\n");
        assert_eq!(cooked(r#""\x41B\u{43}""#), "ABC");
        assert_eq!(cooked(r#""\"quoted\"""#), "\"quoted\"");
        assert_eq!(cooked("'one\\\ntwo'"), "onetwo");
        assert_eq!(cook_string(r#""\uD800""#), vec![0xD800]);
    }

    #[test]
    fn numbers_are_read_as_written() {
        assert!((numeric_value("1_000") - 1000.0).abs() < f64::EPSILON);
        assert!((numeric_value("0x1F") - 31.0).abs() < f64::EPSILON);
        assert!((numeric_value("0b101") - 5.0).abs() < f64::EPSILON);
        assert!((numeric_value("017") - 15.0).abs() < f64::EPSILON);
        assert!((numeric_value("1.5e3") - 1500.0).abs() < f64::EPSILON);
        assert!((numeric_value(".5") - 0.5).abs() < f64::EPSILON);
    }
}

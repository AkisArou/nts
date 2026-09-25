//! JSX text as TypeScript reads it (tsgo's `jsxtransforms/jsx.go`): HTML
//! entities, and the whitespace rules that turn a text child into a string.
//!
//! The converter decodes a text's entities, as Babel does, because that is
//! the string the compiler reasons about: it moves a text containing `&` or
//! `<` into a JavaScript string literal, where nothing decodes it again. The
//! lowering trims the source text line by line and only then decodes, as
//! TypeScript does, since a decoded `&nbsp;` would be trimmed as whitespace.

mod entities;

/// Replaces `&amp;`, `&#123;` and `&#x7B;` with the characters they stand
/// for; an unknown or unterminated entity stays as written. tsgo's
/// `decodeEntities`.
#[must_use]
pub fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let Some(semi) = rest.find(';') else { break };
        // An `&` before the `;` starts over from there.
        if let Some(next) = rest[1..semi].find('&') {
            out.push_str(&rest[..=next]);
            rest = &rest[next + 1..];
            continue;
        }
        match decode_entity(&rest[1..semi]) {
            Some(ch) => out.push(ch),
            None => out.push_str(&rest[..=semi]),
        }
        rest = &rest[semi + 1..];
    }
    out.push_str(rest);
    out
}

fn decode_entity(entity: &str) -> Option<char> {
    if let Some(number) = entity.strip_prefix('#') {
        let value = match number.strip_prefix('x') {
            Some(hex) => u32::from_str_radix(hex, 16).ok()?,
            None => number.parse().ok()?,
        };
        return char::from_u32(value);
    }
    entities::named(entity)
}

/// A text child as the string it passes: each line trimmed (the first only
/// at its end, the last only at its start), empty lines dropped, the rest
/// joined with one space, and -- with `decode`, for source text -- each
/// line's entities decoded. Empty when the text is only formatting. tsgo's
/// `fixupWhitespaceAndDecodeEntities`.
#[must_use]
pub fn fixup_whitespace(text: &str, decode: bool) -> String {
    let mut out = String::new();
    let mut add_line = |line: &str| {
        if !out.is_empty() {
            out.push(' ');
        }
        if decode {
            out.push_str(&decode_entities(line));
        } else {
            out.push_str(line);
        }
    };
    // The first line keeps its leading whitespace, but is dropped when it is
    // only whitespace: its start is 0 while its end is unknown.
    let mut first_non_whitespace = Some(0);
    let mut last_non_whitespace_end = None;
    for (at, ch) in text.char_indices() {
        if is_line_break(ch) {
            if let (Some(first), Some(last)) = (first_non_whitespace, last_non_whitespace_end) {
                add_line(&text[first..last]);
            }
            first_non_whitespace = None;
        } else if !is_whitespace_single_line(ch) {
            last_non_whitespace_end = Some(at + ch.len_utf8());
            first_non_whitespace.get_or_insert(at);
        }
    }
    // The last line keeps its trailing whitespace.
    if let Some(first) = first_non_whitespace {
        add_line(&text[first..]);
    }
    out
}

/// Whether a text child is only formatting -- whitespace across a line
/// break -- which JSX does not count as a child at all. tsgo's
/// `ContainsOnlyTriviaWhiteSpaces`.
#[must_use]
pub fn is_formatting(text: &str) -> bool {
    text.chars().all(|ch| is_line_break(ch) || is_whitespace_single_line(ch)) && text.contains(is_line_break)
}

fn is_line_break(ch: char) -> bool {
    matches!(ch, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// tsgo's `IsWhiteSpaceSingleLine`.
fn is_whitespace_single_line(ch: char) -> bool {
    matches!(
        ch,
        ' ' | '\t' | '\u{b}' | '\u{c}' | '\u{a0}' | '\u{85}' | '\u{1680}' | '\u{2000}'..='\u{200b}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

#[cfg(test)]
mod tests {
    use super::{decode_entities, fixup_whitespace, is_formatting};

    #[test]
    fn text_is_trimmed_as_typescript_trims_it() {
        assert_eq!(fixup_whitespace("  a  ", true), "  a  ");
        assert_eq!(fixup_whitespace("\n    a b\n    c\n  ", true), "a b c");
        assert_eq!(fixup_whitespace("\n   \n", true), "");
        assert_eq!(fixup_whitespace("a \n b", true), "a b");
        // Trimmed before decoding: an entity is not whitespace.
        assert_eq!(fixup_whitespace("\n  &nbsp;x\n", true), "\u{a0}x");
        assert_eq!(fixup_whitespace("\n  &amp;lt;\n", false), "&amp;lt;");
    }

    #[test]
    fn entities_are_decoded() {
        assert_eq!(decode_entities("a &amp; b &#65;&#x42; &nope; &"), "a & b AB &nope; &");
        assert_eq!(decode_entities("&a&amp;"), "&a&");
    }

    #[test]
    fn formatting_is_whitespace_across_a_line() {
        assert!(is_formatting("\n   "));
        assert!(!is_formatting("   "));
        assert!(!is_formatting("\n a"));
    }
}

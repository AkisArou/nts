//! JavaScript text is a sequence of UTF-16 code units, including lone units.

use std::borrow::Cow;
use std::cmp::Ordering;
use std::hash::{Hash, Hasher};

use serde::{Deserialize, Serialize};

/// Unicode text keeps its compact UTF-8 form. UTF-16 is needed only when a
/// JavaScript string contains an unpaired surrogate; no replacement is made.
#[derive(Clone, Serialize, Deserialize)]
pub enum JsText {
    Utf8(String),
    Utf16(Vec<u16>),
}

impl JsText {
    #[must_use]
    pub fn from_utf16(units: Vec<u16>) -> Self {
        String::from_utf16(&units).map_or_else(|_| Self::Utf16(units), Self::Utf8)
    }

    #[must_use]
    pub fn as_utf8(&self) -> Option<&str> {
        match self {
            Self::Utf8(text) => Some(text),
            Self::Utf16(_) => None,
        }
    }

    #[must_use]
    pub fn utf16(&self) -> Cow<'_, [u16]> {
        match self {
            Self::Utf8(text) => Cow::Owned(text.encode_utf16().collect()),
            Self::Utf16(units) => Cow::Borrowed(units),
        }
    }

    pub fn encode_utf16(&self) -> impl Iterator<Item = u16> + Clone + '_ {
        let (text, units): (Option<&str>, &[u16]) = match self {
            Self::Utf8(text) => (Some(text), &[]),
            Self::Utf16(units) => (None, units),
        };
        text.into_iter()
            .flat_map(str::encode_utf16)
            .chain(units.iter().copied())
    }

    #[must_use]
    pub fn utf16_len(&self) -> usize {
        self.encode_utf16().count()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        match self {
            Self::Utf8(text) => text.is_empty(),
            Self::Utf16(units) => units.is_empty(),
        }
    }

    #[must_use]
    pub fn concat(&self, other: &Self) -> Self {
        if let (Self::Utf8(left), Self::Utf8(right)) = (self, other) {
            let mut text = String::with_capacity(left.len() + right.len());
            text.push_str(left);
            text.push_str(right);
            Self::Utf8(text)
        } else {
            Self::from_utf16(self.encode_utf16().chain(other.encode_utf16()).collect())
        }
    }
}

impl Default for JsText {
    fn default() -> Self {
        Self::Utf8(String::new())
    }
}
impl From<String> for JsText {
    fn from(text: String) -> Self {
        Self::Utf8(text)
    }
}
impl From<&str> for JsText {
    fn from(text: &str) -> Self {
        Self::Utf8(text.to_owned())
    }
}
impl From<&String> for JsText {
    fn from(text: &String) -> Self {
        Self::Utf8(text.clone())
    }
}
impl From<&JsText> for JsText {
    fn from(text: &JsText) -> Self {
        text.clone()
    }
}
impl PartialEq for JsText {
    fn eq(&self, other: &Self) -> bool {
        self.encode_utf16().eq(other.encode_utf16())
    }
}
impl Eq for JsText {}
impl PartialEq<str> for JsText {
    fn eq(&self, other: &str) -> bool {
        self.encode_utf16().eq(other.encode_utf16())
    }
}
impl PartialEq<&str> for JsText {
    fn eq(&self, other: &&str) -> bool {
        self == *other
    }
}
impl PartialEq<String> for JsText {
    fn eq(&self, other: &String) -> bool {
        self == other.as_str()
    }
}
impl PartialOrd for JsText {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for JsText {
    fn cmp(&self, other: &Self) -> Ordering {
        self.encode_utf16().cmp(other.encode_utf16())
    }
}
impl Hash for JsText {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.utf16_len().hash(state);
        for unit in self.encode_utf16() {
            unit.hash(state);
        }
    }
}
impl std::fmt::Debug for JsText {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Utf8(text) => text.fmt(f),
            Self::Utf16(units) => f.debug_tuple("Utf16").field(units).finish(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::JsText;

    #[test]
    fn lone_units_are_distinct_from_replacement_characters_and_pairs_stay_exact() {
        let high = JsText::from_utf16(vec![0xd800]);
        let low = JsText::from_utf16(vec![0xdc00]);
        assert_eq!(high.utf16().as_ref(), &[0xd800]);
        assert_ne!(high, JsText::from("\u{fffd}"));
        assert_eq!(high.concat(&low), JsText::from("\u{10000}"));
        assert_eq!(
            JsText::from_utf16(vec![0xd83d, 0xde00]).as_utf8(),
            Some("😀")
        );
        assert_eq!(JsText::from_utf16(vec![0, 0xd800, 0]).utf16_len(), 3);
    }
}

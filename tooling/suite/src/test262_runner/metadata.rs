use std::{collections::BTreeMap, ops::Range};

use thiserror::Error;
use xxhash_rust::xxh3::xxh3_64;

use super::model::{NegativeExpectation, NegativePhase, TestRecord, YamlValue};

/// A malformed Test262 record or value in its restricted YAML dialect.
#[derive(Debug, Error)]
pub enum MetadataError {
    #[error("{path}: missing /*--- ... ---*/ Test262 frontmatter")]
    MissingFrontmatter { path: String },
    #[error("metadata line {line}: {message}")]
    InvalidYaml { line: usize, message: String },
    #[error("{path}: metadata field {field:?} must be {expected}")]
    InvalidField {
        path: String,
        field: String,
        expected: &'static str,
    },
}

/// Parse the subset of YAML implemented by Test262's `monkeyYaml.py`.
///
/// This intentionally does not accept the rest of YAML. Matching the suite's
/// parser is more important than accepting documents the suite does not use.
pub fn parse_yaml(text: &str) -> Result<Option<BTreeMap<String, YamlValue>>, MetadataError> {
    MonkeyYaml::new(text).parse()
}

/// Parse one Test262 source file into execution metadata and stable hashes.
pub fn parse_test_record(path: &str, source: &str) -> Result<TestRecord, MetadataError> {
    let Some((frontmatter_span, attributes)) = find_frontmatter(source) else {
        return Err(MetadataError::MissingFrontmatter {
            path: path.to_owned(),
        });
    };

    let metadata = parse_yaml(attributes)?.unwrap_or_default();
    let flags = string_list(path, &metadata, "flags")?.into_iter().collect();
    let includes = string_list(path, &metadata, "includes")?;
    let features = string_list(path, &metadata, "features")?;
    let negative = negative_expectation(path, &metadata)?;

    let license_span = find_license(&source[..frontmatter_span.start]);
    let header = license_span
        .as_ref()
        .map_or_else(String::new, |span| source[span.clone()].trim().to_owned());

    let mut body = source.to_owned();
    let mut removed = vec![frontmatter_span];
    if let Some(span) = license_span {
        removed.push(span);
    }
    removed.sort_by_key(|span| std::cmp::Reverse(span.start));
    for span in removed {
        body.replace_range(span, "");
    }

    Ok(TestRecord {
        path: path.to_owned(),
        source_hash: hash(source),
        body_hash: hash(&body),
        header,
        body,
        metadata,
        flags,
        includes,
        features,
        negative,
    })
}

fn hash(text: &str) -> String {
    format!("{:016x}", xxh3_64(text.as_bytes()))
}

fn string_list(
    path: &str,
    metadata: &BTreeMap<String, YamlValue>,
    field: &str,
) -> Result<Vec<String>, MetadataError> {
    let Some(value) = metadata.get(field) else {
        return Ok(Vec::new());
    };
    let Some(values) = value.as_sequence() else {
        return Err(MetadataError::InvalidField {
            path: path.to_owned(),
            field: field.to_owned(),
            expected: "a list of strings",
        });
    };
    values
        .iter()
        .map(|value| {
            value
                .as_string()
                .map(str::to_owned)
                .ok_or_else(|| MetadataError::InvalidField {
                    path: path.to_owned(),
                    field: field.to_owned(),
                    expected: "a list of strings",
                })
        })
        .collect()
}

fn negative_expectation(
    path: &str,
    metadata: &BTreeMap<String, YamlValue>,
) -> Result<Option<NegativeExpectation>, MetadataError> {
    let Some(value) = metadata.get("negative") else {
        return Ok(None);
    };
    let Some(mapping) = value.as_mapping() else {
        return Err(MetadataError::InvalidField {
            path: path.to_owned(),
            field: "negative".to_owned(),
            expected: "a mapping with phase and type",
        });
    };
    let phase = required_string(path, mapping, "negative.phase")?;
    let error_type = required_string(path, mapping, "negative.type")?;
    let phase = match phase.as_str() {
        "parse" => NegativePhase::Parse,
        "resolution" => NegativePhase::Resolution,
        "runtime" => NegativePhase::Runtime,
        _ => NegativePhase::Other(phase),
    };
    Ok(Some(NegativeExpectation { phase, error_type }))
}

fn required_string(
    path: &str,
    mapping: &BTreeMap<String, YamlValue>,
    qualified: &str,
) -> Result<String, MetadataError> {
    let key = qualified.rsplit('.').next().unwrap_or(qualified);
    mapping
        .get(key)
        .and_then(YamlValue::as_string)
        .map(str::to_owned)
        .ok_or_else(|| MetadataError::InvalidField {
            path: path.to_owned(),
            field: qualified.to_owned(),
            expected: "a string",
        })
}

fn find_frontmatter(source: &str) -> Option<(Range<usize>, &str)> {
    let start = source.find("/*---")?;
    let attributes_start = start + "/*---".len();
    // `parseTestRecord.py` uses a greedy match. `rfind` preserves that behavior
    // if a test ever embeds the closing marker in its metadata text.
    let close_relative = source[attributes_start..].rfind("---*/")?;
    let close = attributes_start + close_relative;
    let mut end = close + "---*/".len();
    end = consume_blank_lines(source, end);
    Some((start..end, source[attributes_start..close].trim()))
}

fn find_license(prefix: &str) -> Option<Range<usize>> {
    let lower = prefix.to_ascii_lowercase();

    if let Some(phrase) = lower.find("any copyright is dedicated to the public domain") {
        let start = prefix[..phrase].rfind("/*")?;
        let close = prefix[phrase..].find("*/")? + phrase + 2;
        return Some(start..consume_blank_lines(prefix, close));
    }

    let mut cursor = 0;
    let mut license_end = None;
    while cursor < prefix.len() {
        let line_end = prefix[cursor..]
            .find('\n')
            .map_or(prefix.len(), |offset| cursor + offset + 1);
        let line = prefix[cursor..line_end].to_ascii_lowercase();
        let ends_license = line.contains("license found in the license file.")
            || line.contains("found in the license file.")
            || line.contains("see license for details.")
            || line.contains("tc39/test262/blob/head/license");
        cursor = line_end;
        if ends_license {
            license_end = Some(cursor);
            break;
        }
    }
    let license_end = license_end?;
    // The official expression starts at the last copyright line before the
    // matching license ending. This excludes unrelated old or additional
    // copyright notices on either side of the active header.
    let copyright = lower[..license_end].rfind("// copyright")?;
    let start = prefix[..copyright]
        .rfind('\n')
        .map_or(0, |newline| newline + 1);
    Some(start..consume_blank_lines(prefix, license_end))
}

fn consume_blank_lines(text: &str, mut at: usize) -> usize {
    loop {
        let line_start = at;
        while matches!(text.as_bytes().get(at), Some(b' ' | b'\t')) {
            at += 1;
        }
        match text.as_bytes().get(at) {
            Some(b'\r') if text.as_bytes().get(at + 1) == Some(&b'\n') => at += 2,
            Some(b'\n' | b'\r') => at += 1,
            _ => return line_start,
        }
    }
}

struct MonkeyYaml<'a> {
    lines: Vec<&'a str>,
    at: usize,
}

impl<'a> MonkeyYaml<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            lines: split_lines(text),
            at: 0,
        }
    }

    fn parse(mut self) -> Result<Option<BTreeMap<String, YamlValue>>, MetadataError> {
        self.read_mapping("")
    }

    fn read_mapping(
        &mut self,
        indent: &str,
    ) -> Result<Option<BTreeMap<String, YamlValue>>, MetadataError> {
        let mut mapping: Option<BTreeMap<String, YamlValue>> = None;
        let mut last_key: Option<String> = None;
        let mut empty_lines = 0;

        while let Some(line) = self.lines.get(self.at).copied() {
            if !line.starts_with(indent) {
                break;
            }
            let line_number = self.at + 1;
            self.at += 1;

            if line.trim().is_empty() {
                empty_lines += 1;
                continue;
            }

            if let Some((key, value)) = line.split_once(':') {
                let key = key.trim().to_owned();
                let value = self.read_value(value.trim(), indent)?;
                mapping
                    .get_or_insert_with(BTreeMap::new)
                    .insert(key.clone(), value);
                last_key = Some(key);
            } else if let (Some(values), Some(key)) = (mapping.as_mut(), last_key.as_ref()) {
                let Some(YamlValue::String(value)) = values.get_mut(key) else {
                    return Err(MetadataError::InvalidYaml {
                        line: line_number,
                        message: "a continuation line followed a non-string value".to_owned(),
                    });
                };
                if empty_lines == 0 {
                    value.push(' ');
                } else {
                    for _ in 0..empty_lines {
                        value.push('\n');
                    }
                }
                value.push_str(line.trim());
            } else {
                return Err(MetadataError::InvalidYaml {
                    line: line_number,
                    message: format!("monkeyYaml is confused at {line}"),
                });
            }
            empty_lines = 0;
        }

        Ok(mapping)
    }

    fn read_value(&mut self, value: &str, indent: &str) -> Result<YamlValue, MetadataError> {
        if value == ">" || value == "|" {
            let mut value = self.read_multiline()?;
            value.push('\n');
            return Ok(YamlValue::String(value));
        }

        if value.is_empty()
            && let Some(next) = self.lines.get(self.at).copied()
        {
            if list_item(next).is_some() {
                return self.read_multiline_list();
            }
            let whitespace = leading_whitespace(next);
            if next.starts_with(indent) && whitespace > indent.len() {
                let child_indent = &next[..whitespace];
                return Ok(self
                    .read_mapping(child_indent)?
                    .map_or_else(|| YamlValue::String(String::new()), YamlValue::Mapping));
            }
        }

        Ok(read_scalar(value))
    }

    fn read_multiline(&mut self) -> Result<String, MetadataError> {
        let Some(first) = self.lines.get(self.at).copied() else {
            return Err(MetadataError::InvalidYaml {
                line: self.at + 1,
                message: "multiline value has no content".to_owned(),
            });
        };
        let indent = leading_spaces(first);
        let mut parts = Vec::new();
        while let Some(line) = self.lines.get(self.at).copied() {
            if line.trim().is_empty() {
                self.at += 1;
                parts.push("\n".to_owned());
            } else if leading_spaces(line) < indent {
                break;
            } else {
                self.at += 1;
                parts.push(line[indent..].to_owned());
            }
        }
        Ok(parts.join(" "))
    }

    fn read_multiline_list(&mut self) -> Result<YamlValue, MetadataError> {
        let mut values = Vec::new();
        let mut indent = None;
        while let Some(line) = self.lines.get(self.at).copied() {
            let leading = leading_spaces(line);
            if line.trim().is_empty() {
                self.at += 1;
                continue;
            }
            if let Some(expected) = indent
                && (leading < expected
                    || (leading == expected && line.as_bytes().get(leading) != Some(&b'-')))
            {
                break;
            }
            let expected = *indent.get_or_insert(leading);
            let Some(item) = line.get(expected..).and_then(list_item) else {
                return Err(MetadataError::InvalidYaml {
                    line: self.at + 1,
                    message: "invalid multiline list item".to_owned(),
                });
            };
            self.at += 1;
            values.push(read_scalar(item));
        }
        Ok(YamlValue::Sequence(values))
    }
}

fn read_scalar(value: &str) -> YamlValue {
    if let Some(inner) = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
    {
        if inner.is_empty() {
            return YamlValue::Sequence(Vec::new());
        }
        return YamlValue::Sequence(
            inner
                .split(',')
                .map(|value| read_scalar(value.trim()))
                .collect(),
        );
    }

    if value
        .chars()
        .all(|character| character == '-' || character.is_ascii_digit())
        && let Ok(value) = value.parse::<i64>()
    {
        return YamlValue::Integer(value);
    }
    if value
        .chars()
        .all(|character| matches!(character, '-' | '.' | 'e' | 'E') || character.is_ascii_digit())
        && let Ok(value) = value.parse::<f64>()
    {
        return YamlValue::Float(value);
    }
    YamlValue::String(value.to_owned())
}

fn list_item(line: &str) -> Option<&str> {
    line.trim_start_matches(' ').strip_prefix("- ")
}

fn leading_spaces(line: &str) -> usize {
    line.len() - line.trim_start_matches(' ').len()
}

fn leading_whitespace(line: &str) -> usize {
    line.len() - line.trim_start_matches([' ', '\t']).len()
}

/// Python's `str.splitlines()` recognizes a lone carriage return as a line
/// boundary. Test262 contains dedicated CR source files, while Rust's
/// `str::lines()` only splits on line feed.
fn split_lines(text: &str) -> Vec<&str> {
    let bytes = text.as_bytes();
    let mut lines = Vec::new();
    let mut start = 0;
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'\n' => {
                lines.push(&text[start..at]);
                at += 1;
                start = at;
            }
            b'\r' => {
                lines.push(&text[start..at]);
                at += 1;
                if bytes.get(at) == Some(&b'\n') {
                    at += 1;
                }
                start = at;
            }
            _ => at += 1,
        }
    }
    if start < text.len() {
        lines.push(&text[start..]);
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_execution_metadata_in_both_list_styles() {
        let yaml = r"
description: >
  strict runtime failure
flags:
  - onlyStrict
  - async
includes: [a.js, b.js]
negative:
  phase: runtime
  type: ReferenceError
";
        let parsed = parse_yaml(yaml).expect("valid metadata").expect("mapping");
        assert_eq!(
            parsed.get("flags"),
            Some(&YamlValue::Sequence(vec![
                YamlValue::String("onlyStrict".to_owned()),
                YamlValue::String("async".to_owned())
            ]))
        );
        assert_eq!(
            parsed
                .get("negative")
                .and_then(YamlValue::as_mapping)
                .and_then(|negative| negative.get("type")),
            Some(&YamlValue::String("ReferenceError".to_owned()))
        );
    }

    #[test]
    fn matches_monkey_yaml_continuation_folding() {
        let parsed = parse_yaml("description: first\n             second\n\n             third\n")
            .expect("valid metadata")
            .expect("mapping");
        assert_eq!(
            parsed.get("description"),
            Some(&YamlValue::String("first second\nthird".to_owned()))
        );
    }

    #[test]
    fn extracts_a_typed_record_and_removes_protocol_headers() {
        let source = r"// Copyright 2026 Example.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
flags: [onlyStrict]
negative:
  phase: parse
  type: SyntaxError
---*/

$DONOTEVALUATE();
";
        let record = parse_test_record("language/example.js", source).expect("valid record");
        assert!(record.flags.contains("onlyStrict"));
        assert_eq!(
            record.negative,
            Some(NegativeExpectation {
                phase: NegativePhase::Parse,
                error_type: "SyntaxError".to_owned()
            })
        );
        assert_eq!(record.body, "$DONOTEVALUATE();\n");
        assert!(!record.source_hash.is_empty());
        assert!(!record.body_hash.is_empty());
    }

    #[test]
    fn rejects_wrong_execution_field_shapes() {
        let source = "/*---\nflags: onlyStrict\n---*/\nassert(true);\n";
        let error = parse_test_record("bad.js", source).expect_err("flags must be a list");
        assert!(error.to_string().contains("flags"));
    }
}

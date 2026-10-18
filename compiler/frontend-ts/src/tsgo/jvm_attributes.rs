//! Declaration-local JVM metadata. ABI descriptors remain opaque here; the
//! JVM binding reader owns their grammar and their relation to invocation kind.

use nts_semantic_schema::JvmAttributes;

pub(super) fn read(source: &str) -> Result<Option<JvmAttributes>, String> {
    let bindings = super::ast::leading_tags(source, "@ntsJvm");
    let keeps = super::ast::leading_tags(source, "@ntsJvmKeeps");
    if bindings.is_empty() && keeps.is_empty() {
        return Ok(None);
    }
    let binding = match bindings.as_slice() {
        [binding] => *binding,
        [] => return Err("@ntsJvmKeeps requires @ntsJvm".to_owned()),
        _ => return Err("duplicate @ntsJvm".to_owned()),
    };
    let parts: Vec<_> = binding.split_whitespace().collect();
    if parts.len() != 2
        || !matches!(
            parts[0],
            "static" | "virtual" | "interface" | "special" | "field" | "staticfield"
        )
        || !parts[1].contains(':')
    {
        return Err(
            "malformed @ntsJvm: expected an invocation kind and owner.member:descriptor".to_owned(),
        );
    }
    let retained = match keeps.as_slice() {
        [] => None,
        [kept] => Some(retained_parameters(kept)?),
        _ => return Err("duplicate @ntsJvmKeeps".to_owned()),
    };
    Ok(Some(JvmAttributes {
        binding: parts.join(" "),
        keeps: retained,
    }))
}

fn retained_parameters(text: &str) -> Result<Vec<u32>, String> {
    if text == "none" {
        return Ok(Vec::new());
    }
    if text.is_empty() {
        return Err("empty @ntsJvmKeeps: write `none` for proved non-retention".to_owned());
    }
    let mut indices = Vec::new();
    for part in text.split_whitespace() {
        let index = part
            .chars()
            .all(|c| c.is_ascii_digit())
            .then(|| part.parse::<u32>().ok())
            .flatten()
            .ok_or_else(|| format!("invalid @ntsJvmKeeps parameter index `{part}`"))?;
        if indices.contains(&index) {
            return Err(format!("duplicate @ntsJvmKeeps parameter index `{part}`"));
        }
        indices.push(index);
    }
    Ok(indices)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn unknown_and_proved_retention_survive_serialization() {
        for (tag, expected) in [
            ("", None),
            (" * @ntsJvmKeeps none\n", Some(vec![])),
            (" * @ntsJvmKeeps 0 2\n", Some(vec![0, 2])),
        ] {
            let source = format!(
                "/**\n * @ntsJvm virtual p/C.m:(Ljava/lang/Object;)V\n{tag} */\nm(x: unknown): void;"
            );
            let attributes = read(&source).unwrap().unwrap();
            assert_eq!(attributes.keeps, expected);
            let bytes = postcard::to_stdvec(&attributes).unwrap();
            let decoded: JvmAttributes = postcard::from_bytes(&bytes).unwrap();
            assert_eq!(decoded, attributes);
        }
    }

    #[test]
    fn malformed_and_duplicate_tags_are_errors() {
        for tags in [
            "@ntsJvm",
            "@ntsJvm wobbly p/C.m:()V",
            "@ntsJvm virtual missing-key",
            "@ntsJvmKeeps none",
            "@ntsJvm virtual p/C.m:()V\n * @ntsJvm static p/C.m:()V",
            "@ntsJvm virtual p/C.m:()V\n * @ntsJvmKeeps none\n * @ntsJvmKeeps none",
            "@ntsJvm virtual p/C.m:()V\n * @ntsJvmKeeps",
            "@ntsJvm virtual p/C.m:()V\n * @ntsJvmKeeps 0 0",
            "@ntsJvm virtual p/C.m:()V\n * @ntsJvmKeeps none 0",
            "@ntsJvm virtual p/C.m:()V\n * @ntsJvmKeeps -1",
        ] {
            assert!(
                read(&format!("/** {tags} */\nm(): void;")).is_err(),
                "{tags}"
            );
        }
    }

    #[test]
    fn body_strings_and_longer_tag_names_publish_no_binding() {
        for source in [
            "m() { return '@ntsJvm virtual p/C.m:()V'; }",
            "/** @ntsJvmSomething static p/C.m:()V */\nm(): void;",
        ] {
            assert!(read(source).unwrap().is_none());
        }
    }
}

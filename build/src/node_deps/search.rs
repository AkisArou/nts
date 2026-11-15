//! Search directory names are inputs too: a new earlier header can shadow one.
use super::{hash, invocation};
use anyhow::{Context as _, Result, bail};
use std::{collections::BTreeSet, path::PathBuf, process::Stdio};

pub(super) fn fingerprint(context: &invocation::Context) -> Result<String> {
    let output = context
        .compiler()
        .args(&context.flags)
        .args(["-E", "-x", "c", "-v", "-"])
        .stdin(Stdio::null())
        .output()?;
    if !output.status.success() {
        bail!(
            "cannot observe compiler include search: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let text = String::from_utf8(output.stderr)?;
    let mut roots = Vec::new();
    let mut inside = false;
    let mut found = false;
    let mut configs = Vec::new();
    for line in text.lines() {
        if let Some(path) = line.trim().strip_prefix("Configuration file: ") {
            let bytes = std::fs::read(path)?;
            invocation::config_options(&bytes)?;
            configs.push((path.to_owned(), hash(&bytes)));
        }
        if line.contains("search starts here:") {
            inside = true;
            found = true;
            continue;
        }
        if line.trim() == "End of search list." {
            inside = false;
            continue;
        }
        if inside {
            roots.push(PathBuf::from(line.trim()));
        }
        if let Some(path) = line
            .trim()
            .strip_prefix("ignoring nonexistent directory \"")
            .and_then(|s| s.strip_suffix('"'))
        {
            roots.push(PathBuf::from(path));
        }
    }
    if !found {
        bail!("compiler did not report its include search");
    }
    // Forced headers can themselves contain local quoted includes.
    roots.extend(forced_header_parents(&String::from_utf8(output.stdout)?)?);
    let configs = configs
        .into_iter()
        .map(|(path, sha)| Ok((context.source.identity(std::path::Path::new(&path))?, sha)))
        .collect::<Result<Vec<_>>>()?;
    Ok(hash(&serde_json::to_vec(&(
        directories_with(roots, Some(&context.source))?,
        configs,
    ))?))
}

fn forced_header_parents(text: &str) -> Result<Vec<PathBuf>> {
    let mut parents = Vec::new();
    let mut primary = None;
    for line in text.lines() {
        let Some((number, quoted)) = line
            .strip_prefix("# ")
            .and_then(|text| text.split_once(' '))
        else {
            continue;
        };
        if number.is_empty()
            || !number.bytes().all(|byte| byte.is_ascii_digit())
            || !quoted.starts_with('"')
        {
            continue;
        }
        let path = quoted_filename(quoted)?;
        // Zig materializes stdin as a file. Only the exact primary input from
        // the first numeric marker is excluded, including return markers.
        // Its temporary directory is not a compiler header-search input.
        let primary = primary.get_or_insert_with(|| path.clone());
        // GCC -g emits a working-directory marker whose filename ends //.
        // It names a directory, not a header: taking its parent would add the
        // cache's sources namespace and make unrelated cache entries key inputs.
        if !path.starts_with('<')
            && !path.ends_with("//")
            && path != *primary
            && let Some(parent) = std::path::Path::new(&path).parent()
        {
            parents.push(parent.to_owned());
        }
    }
    Ok(parents)
}

/// Compiler linemarkers quote filenames as C strings, including octal UTF-8
/// bytes. JSON's universal/control escapes are not that filename grammar.
fn quoted_filename(text: &str) -> Result<String> {
    let bytes = text.as_bytes();
    let mut at = 1;
    let mut output = Vec::new();
    while let Some(&byte) = bytes.get(at) {
        at += 1;
        if byte == b'"' {
            return Ok(String::from_utf8(output)?);
        }
        if byte != b'\\' {
            output.push(byte);
            continue;
        }
        let escaped = *bytes
            .get(at)
            .context("incomplete compiler linemarker escape")?;
        at += 1;
        let value = match escaped {
            b'\\' | b'"' | b'\'' | b'?' => escaped,
            b'a' => 7,
            b'b' => 8,
            b'f' => 12,
            b'n' => 10,
            b'r' => 13,
            b't' => 9,
            b'v' => 11,
            b'0'..=b'7' => {
                let mut value = u16::from(escaped - b'0');
                for _ in 0..2 {
                    let Some(&next) = bytes.get(at).filter(|byte| (b'0'..=b'7').contains(byte))
                    else {
                        break;
                    };
                    at += 1;
                    value = value * 8 + u16::from(next - b'0');
                }
                u8::try_from(value).context("compiler linemarker octal escape exceeds a byte")?
            }
            b'x' | b'u' | b'U' => {
                let count = match escaped {
                    b'u' => 4,
                    b'U' => 8,
                    _ => usize::MAX,
                };
                let mut value = 0u32;
                let mut digits = 0;
                while digits < count {
                    let Some(next) = bytes
                        .get(at)
                        .and_then(|byte| char::from(*byte).to_digit(16))
                    else {
                        break;
                    };
                    at += 1;
                    digits += 1;
                    value = value
                        .checked_mul(16)
                        .and_then(|value| value.checked_add(next))
                        .context("compiler linemarker hex escape overflow")?;
                }
                if digits == 0 || count != usize::MAX && digits != count {
                    bail!("incomplete compiler linemarker hex escape");
                }
                if escaped != b'x' {
                    let character = char::from_u32(value)
                        .context("invalid compiler linemarker Unicode escape")?;
                    let mut encoded = [0; 4];
                    output.extend_from_slice(character.encode_utf8(&mut encoded).as_bytes());
                    continue;
                }
                u8::try_from(value).context("compiler linemarker hex escape exceeds a byte")?
            }
            _ => bail!(
                "unsupported compiler linemarker escape: {}",
                char::from(escaped)
            ),
        };
        output.push(value);
    }
    bail!("unterminated compiler linemarker filename")
}

#[cfg(test)]
fn directories(pending: Vec<PathBuf>) -> Result<String> {
    directories_with(pending, None)
}

fn directories_with(
    mut pending: Vec<PathBuf>,
    source: Option<&super::paths::SourcePaths>,
) -> Result<String> {
    let mut visited = BTreeSet::new();
    let mut records = Vec::new();
    let mut budget = 1_000_000usize;
    while let Some(path) = pending.pop() {
        if budget == 0 {
            bail!("compiler search inventory exceeds its entry bound");
        }
        budget -= 1;
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                records.push((path, "missing".to_owned()));
                continue;
            }
            Err(error) => {
                return Err(error).with_context(|| format!("observing {}", path.display()));
            }
        };
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::MetadataExt as _;
            metadata.mode()
        };
        #[cfg(not(unix))]
        let mode = u32::from(metadata.permissions().readonly());
        if metadata.is_symlink() {
            let target = std::fs::read_link(&path)?;
            records.push((path.clone(), format!("link:{}", target.display())));
            match path.canonicalize() {
                Ok(resolved) => pending.push(resolved),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    records.push((path, "missing link target".to_owned()));
                }
                Err(error) => return Err(error).context("resolving compiler search link"),
            }
        } else if metadata.is_dir() {
            let actual = path.canonicalize()?;
            if !visited.insert(actual) {
                continue;
            }
            records.push((path.clone(), format!("directory:{mode}")));
            let mut entries = std::fs::read_dir(&path)?
                .map(|entry| entry.map(|e| e.path()))
                .collect::<std::io::Result<Vec<_>>>()?;
            entries.sort();
            pending.extend(entries);
        } else {
            records.push((path, format!("file:{mode}")));
        }
    }
    let mut records = records
        .into_iter()
        .map(|(path, value)| {
            Ok((
                source.map_or_else(
                    || Ok(path.to_string_lossy().into_owned()),
                    |source| source.identity(&path),
                )?,
                value,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    records.sort();
    Ok(hash(&serde_json::to_vec(&records)?))
}

#[cfg(all(test, unix))]
mod tests {
    use super::{directories, forced_header_parents};
    use std::os::unix::fs::{PermissionsExt as _, symlink};
    use std::path::PathBuf;

    #[test]
    fn search_inventory_observes_shadowing_and_missing_link_targets() {
        let root = crate::scratch::StdScratchDir::path_in_std_target("nts-header-search");
        std::fs::create_dir_all(&root).expect("search fixture");
        let target = root.join("later.h");
        symlink(&target, root.join("alias.h")).expect("absent header link");
        let before = directories(vec![root.clone()]).expect("absent target");
        std::fs::write(&target, "#define PRESENT 1\n").expect("new header");
        let after = directories(vec![root.clone()]).expect("new target");
        assert_ne!(before, after);
        assert_eq!(
            after,
            directories(vec![root.clone()]).expect("stable inventory")
        );
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600))
            .expect("mode change");
        assert_ne!(
            after,
            directories(vec![root.clone()]).expect("changed visibility")
        );
        std::fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn gcc_working_directory_is_not_a_header_but_quoted_and_escaped_headers_remain() {
        let text = r#"# 1 "/owned/cache/sources/bundle//"
# 0 "<built-in>"
# 1 "/sdk/forced.h" 1 3
# 4 "/sdk/quote\"and\\slash/header.h" 1
# 1 "/sdk/utf8-\303\251/header.h"
"#;
        assert_eq!(
            forced_header_parents(text).expect("decoded compiler markers"),
            [
                PathBuf::from("/sdk"),
                PathBuf::from("/sdk/quote\"and\\slash"),
                PathBuf::from("/sdk/utf8-é"),
            ]
        );
        for text in [
            "# 1 \"unterminated",
            r#"# 1 "/bad/\q.h""#,
            r#"# 1 "/bad/\x.h""#,
        ] {
            assert!(forced_header_parents(text).is_err());
        }
    }

    #[test]
    fn exact_primary_input_is_not_a_header_but_its_sibling_forced_header_is() {
        for primary in ["/compiler/tmp/first-stdin.c", "/other/tmp/second-stdin.c"] {
            let text = format!(
                "# 1 \"{primary}\"\n# 1 \"<built-in>\"\n# 1 \"/compiler/tmp/forced.h\" 1\n# 7 \"{primary}\" 2\n"
            );
            assert_eq!(
                forced_header_parents(&text).expect("primary versus forced header"),
                [PathBuf::from("/compiler/tmp")]
            );
        }
    }
}

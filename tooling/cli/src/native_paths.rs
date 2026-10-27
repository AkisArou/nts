//! Native tools see names relative to the build directory, including in `ThinLTO`
//! identities and C's `__FILE__`. Cache identities still retain the real directory.

use anyhow::{Context, Result, anyhow};
use camino::{Utf8Path, Utf8PathBuf};

pub(super) fn absolute(path: &Utf8Path) -> Result<Utf8PathBuf> {
    let path = std::path::absolute(path).with_context(|| format!("resolving {path}"))?;
    let resolved = std::fs::canonicalize(&path).unwrap_or_else(|_| {
        path.parent()
            .and_then(|parent| std::fs::canonicalize(parent).ok())
            .zip(path.file_name())
            .map_or_else(|| path.clone(), |(parent, name)| parent.join(name))
    });
    Utf8PathBuf::from_path_buf(resolved).map_err(|path| anyhow!("{} is not UTF-8", path.display()))
}

pub(super) fn relative(path: &Utf8Path, directory: &Utf8Path) -> Result<Utf8PathBuf> {
    let path = absolute(path)?;
    let directory = absolute(directory)?;
    let input: Vec<_> = path.components().collect();
    let base: Vec<_> = directory.components().collect();
    let shared = input.iter().zip(&base).take_while(|(a, b)| a == b).count();
    // Different Windows drives have no relative spelling.
    if shared == 0 {
        return Ok(path);
    }
    let mut result = Utf8PathBuf::new();
    for _ in &base[shared..] {
        result.push("..");
    }
    for component in &input[shared..] {
        result.push(component.as_str());
    }
    if result.as_str().is_empty() {
        result.push(".");
    }
    Ok(result)
}

pub(super) fn program(name: &str) -> Result<String> {
    let path = Utf8Path::new(name);
    if path
        .parent()
        .is_some_and(|parent| !parent.as_str().is_empty())
    {
        Ok(absolute(path)?.into_string())
    } else {
        Ok(name.to_owned())
    }
}

/// Preserve relative include/search flags when the child changes directory too.
pub(super) fn arguments(arguments: &[String], directory: &Utf8Path) -> Result<Vec<String>> {
    let mut path_next = false;
    arguments
        .iter()
        .map(|argument| {
            if path_next || Utf8Path::new(argument).is_absolute() {
                path_next = false;
                return relative(Utf8Path::new(argument), directory).map(Utf8PathBuf::into_string);
            }
            path_next = matches!(
                argument.as_str(),
                "-c" | "-o"
                    | "-I"
                    | "-L"
                    | "-F"
                    | "-MF"
                    | "-isystem"
                    | "-iquote"
                    | "-include"
                    | "-imacros"
                    | "-isysroot"
                    | "--sysroot"
            );
            for prefix in ["-I", "-L", "-F", "--sysroot="] {
                if let Some(path) = argument
                    .strip_prefix(prefix)
                    .filter(|path| !path.is_empty())
                {
                    return relative(Utf8Path::new(path), directory)
                        .map(|path| format!("{prefix}{path}"));
                }
            }
            Ok(argument.clone())
        })
        .collect()
}

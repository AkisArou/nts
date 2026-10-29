use super::{Request, Target, cache, hash, invocation};
use anyhow::{Context, Result, bail};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

pub(super) fn objects(
    request: &Request,
    identity: &invocation::Context,
    source: &Path,
    target: &Target,
    directory: &Path,
) -> Result<Vec<PathBuf>> {
    let next = AtomicUsize::new(0);
    let results = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..request.jobs.min(target.sources.len()) {
            let (next, results) = (&next, &results);
            scope.spawn(move || {
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some(input) = target.sources.get(index) else {
                        break;
                    };
                    let result = object(identity, source, target, directory, input);
                    let failed = result.is_err();
                    results.lock().expect("compiler results").push(result);
                    if failed {
                        break;
                    }
                }
            });
        }
    });
    let mut objects = results
        .into_inner()
        .expect("compiler results")
        .into_iter()
        .collect::<Result<Vec<_>>>()?;
    if objects.len() != target.sources.len() {
        bail!("incomplete dependency compile");
    }
    objects.sort();
    Ok(objects)
}

fn object(
    identity: &invocation::Context,
    source: &Path,
    target: &Target,
    directory: &Path,
    input: &str,
) -> Result<PathBuf> {
    cache::source_hash(source, input)?;
    let id = hash(input.as_bytes());
    let object = directory.join(format!("{id}.o"));
    let deps = directory.join(format!("{id}.d"));
    let mut command = identity.compiler();
    command.args(&target.cflags);
    for include in &target.includes {
        command.arg(format!("-I{}", source.join(include).display()));
    }
    for define in &target.defines {
        command.arg(format!("-D{define}"));
    }
    command
        .args(&identity.flags)
        .args([
            "-fPIC",
            "-fvisibility=hidden",
            "-ffunction-sections",
            "-fdata-sections",
            "-UNDEBUG",
        ])
        .arg("-MD")
        .arg("-MF")
        .arg(&deps)
        .arg("-c")
        .arg(source.join(input))
        .arg("-o")
        .arg(&object);
    std::fs::write(
        directory.join(format!("{id}.command.json")),
        serde_json::to_vec(
            &command
                .get_args()
                .map(|s| s.to_string_lossy().into_owned())
                .collect::<Vec<_>>(),
        )?,
    )?;
    let output = command
        .output()
        .with_context(|| format!("compiling {input}"))?;
    std::fs::write(directory.join(format!("{id}.stderr")), &output.stderr)?;
    if !output.status.success() {
        bail!(
            "bundled Node {input} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(object)
}

pub(super) fn observations(
    source: &Path,
    target: &Target,
    directory: &Path,
) -> Result<BTreeMap<String, String>> {
    let mut inputs = BTreeMap::new();
    for input in &target.sources {
        if Path::new(input)
            .extension()
            .is_some_and(|ext| ext == "s" || ext == "asm")
        {
            let path = source.join(input);
            inputs.insert(
                path.to_string_lossy().into_owned(),
                hash(&std::fs::read(&path)?),
            );
            continue;
        }
        let id = hash(input.as_bytes());
        let deps = std::fs::read_to_string(directory.join(format!("{id}.d")))
            .with_context(|| format!("dependency record for {input}"))?;
        let joined = deps.replace("\\\n", "");
        let (_, dependencies) = joined
            .split_once(": ")
            .context("compiler dependency list")?;
        // Compiler output escapes whitespace and backslashes in make paths.
        for name in make_words(dependencies)? {
            let path = if Path::new(&name).is_absolute() {
                PathBuf::from(name)
            } else {
                source.join(name)
            };
            if let std::collections::btree_map::Entry::Vacant(entry) =
                inputs.entry(path.to_string_lossy().into_owned())
            {
                entry.insert(hash(&std::fs::read(path)?));
            }
        }
    }
    Ok(inputs)
}

fn make_words(input: &str) -> Result<Vec<String>> {
    let mut result = Vec::new();
    let mut word = String::new();
    let mut escape = false;
    for c in input.chars() {
        if escape {
            word.push(c);
            escape = false;
        } else if c == '\\' {
            escape = true;
        } else if c.is_whitespace() {
            if !word.is_empty() {
                result.push(std::mem::take(&mut word));
            }
        } else {
            word.push(c);
        }
    }
    if escape {
        bail!("unfinished make-path escape");
    }
    if !word.is_empty() {
        result.push(word);
    }
    Ok(result)
}

use super::{ObjectFormat, Recipe, Request, SOURCE_BUNDLE, bundle, hash};
use anyhow::{Context as _, Result, bail};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
};

pub(super) struct Context {
    pub key: String,
    pub record: Vec<u8>,
    pub flags: Vec<String>,
    compiler: Vec<String>,
    archiver: Vec<String>,
    directory: PathBuf,
    environment: BTreeMap<String, Option<OsString>>,
    format: ObjectFormat,
}

impl Context {
    pub(super) fn new(request: &Request, source: &Path, plan: &Recipe) -> Result<Self> {
        let origin = std::env::current_dir()?;
        let mut context = Self {
            key: String::new(),
            record: Vec::new(),
            flags: arguments(&request.flags, &origin)?,
            compiler: tool(&request.compiler, &origin)?,
            archiver: tool(&request.archiver, &origin)?,
            directory: source.to_owned(),
            environment: environment(&origin)?,
            format: plan.object_format,
        };
        admitted_driver(&context.compiler, true)?;
        admitted_driver(&context.archiver, false)?;
        admitted_options(&context.flags)?;
        let leading = if Path::new(&context.compiler[0])
            .file_name()
            .is_some_and(|s| s == "zig")
        {
            2
        } else {
            1
        };
        admitted_options(&context.compiler[leading..])?;
        if std::env::var_os("CCC_OVERRIDE_OPTIONS").is_some() {
            bail!("bundled dependency builds do not admit CCC_OVERRIDE_OPTIONS");
        }
        let environment: BTreeMap<_, _> = context
            .environment
            .iter()
            .map(|(k, v)| (k, v.as_ref().map(|s| s.as_encoded_bytes())))
            .collect();
        context.record = serde_json::to_vec_pretty(&(
            SOURCE_BUNDLE,
            serde_json::to_string(&(&bundle().node, &bundle().source_sha256, plan))?,
            &request.target,
            &context.compiler,
            &context.archiver,
            &context.flags,
            &context.directory,
            context.version(&context.compiler)?,
            context.version(&context.archiver)?,
            tool_inputs(&context.compiler)?,
            tool_inputs(&context.archiver)?,
            tool_inputs(&context.flags)?,
            super::search::fingerprint(&context)?,
            environment,
        ))?;
        context.key = hash(&context.record);
        Ok(context)
    }

    fn command(&self, words: &[String]) -> Command {
        let mut command = Command::new(&words[0]);
        command.args(&words[1..]).current_dir(&self.directory);
        command.env("LC_ALL", "C");
        for (name, value) in &self.environment {
            if let Some(value) = value {
                command.env(name, value);
            } else {
                command.env_remove(name);
            }
        }
        command
    }
    pub(super) fn compiler(&self) -> Command {
        self.command(&self.compiler)
    }
    pub(super) fn archiver(&self) -> Command {
        let mut command = self.command(&self.archiver);
        if self.format == ObjectFormat::Macho {
            command.arg("--format=darwin");
        }
        command
    }
    fn version(&self, words: &[String]) -> Result<String> {
        let output = self.command(words).arg("--version").output()?;
        if !output.status.success() {
            bail!("native dependency tool version failed: {words:?}");
        }
        Ok(format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

fn absolute(path: &str, origin: &Path) -> Result<String> {
    let path = Path::new(path);
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        origin.join(path)
    };
    Ok(path
        .to_str()
        .context("native dependency path is not UTF-8")?
        .to_owned())
}

fn arguments(words: &[String], origin: &Path) -> Result<Vec<String>> {
    let mut path_next = false;
    words
        .iter()
        .map(|word| {
            if word.starts_with('@') {
                bail!("bundled dependency builds do not admit response files");
            }
            if path_next {
                path_next = false;
                return absolute(word, origin);
            }
            path_next = matches!(
                word.as_str(),
                "-I" | "-L"
                    | "-F"
                    | "-isystem"
                    | "-iquote"
                    | "-include"
                    | "-imacros"
                    | "-isysroot"
                    | "--sysroot"
                    | "--config"
            );
            for prefix in [
                "--sysroot=",
                "--config=",
                "--config-user-dir=",
                "--config-system-dir=",
                "-I",
                "-L",
                "-F",
                "@",
            ] {
                if let Some(path) = word.strip_prefix(prefix).filter(|s| !s.is_empty()) {
                    return Ok(format!("{prefix}{}", absolute(path, origin)?));
                }
            }
            if !word.starts_with('-')
                && Path::new(word).components().count() > 1
                && origin.join(word).is_file()
            {
                return absolute(word, origin);
            }
            Ok(word.clone())
        })
        .collect()
}

fn tool(words: &[String], origin: &Path) -> Result<Vec<String>> {
    let name = Path::new(&words[0]);
    let path = if name.components().count() > 1 {
        origin.join(name)
    } else {
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .map(|d| origin.join(d).join(name))
            .find(|p| p.is_file())
            .with_context(|| format!("finding {}", words[0]))?
    };
    let path = path.canonicalize()?;
    let mut result = vec![
        path.to_str()
            .context("compiler path is not UTF-8")?
            .to_owned(),
    ];
    result.extend(arguments(&words[1..], origin)?);
    Ok(result)
}

fn tool_inputs(words: &[String]) -> Result<BTreeMap<String, String>> {
    let mut files = BTreeMap::new();
    let mut config_next = false;
    for word in words {
        let config = config_next || word.starts_with("--config=");
        config_next = word == "--config";
        let path = Path::new(word.strip_prefix("--config=").unwrap_or(word));
        if path.is_file() {
            let bytes = std::fs::read(path)?;
            if config {
                config_options(&bytes)?;
            }
            files.insert(path.to_string_lossy().into_owned(), hash(&bytes));
        } else if config {
            bail!("compiler config input is not a file: {}", path.display());
        }
    }
    Ok(files)
}

// Do not pretend an arbitrary wrapper's hidden inputs are described by argv.
// Direct Linux drivers and zig cc are the admitted toolchain grammar.
fn admitted_driver(words: &[String], compiler: bool) -> Result<()> {
    let name = Path::new(&words[0])
        .file_name()
        .and_then(|s| s.to_str())
        .context("tool name")?;
    let allowed = if compiler {
        name == "zig" && words.get(1).is_some_and(|s| s == "cc")
            || name == "cc"
            || name == "gcc"
            || name.starts_with("gcc-")
            || name == "clang"
            || name.starts_with("clang-")
            || name.ends_with("-gcc")
    } else {
        name == "ar" || name == "llvm-ar" || name.starts_with("llvm-ar-")
    };
    if !allowed || !std::fs::read(&words[0])?.starts_with(b"\x7fELF") {
        bail!(
            "bundled dependency tool must be a direct ELF compiler/archiver, not a wrapper: {}",
            words[0]
        );
    }
    Ok(())
}

// Config files may contain scalar defines and code-generation switches only.
// Nested configs, response files, plugins and other hidden file inputs refuse.
pub(super) fn config_options(bytes: &[u8]) -> Result<()> {
    for line in std::str::from_utf8(bytes)?.lines() {
        let line = line.split('#').next().unwrap_or("");
        for word in line.split_ascii_whitespace() {
            if !scalar_option(word)
                || word.contains('@')
                || word.contains('"')
                || word.contains('\'')
            {
                bail!("compiler config contains an unsupported or nested input: {word}");
            }
        }
    }
    Ok(())
}

fn scalar_option(word: &str) -> bool {
    word.starts_with("-D") && word.len() > 2
        || word.starts_with("-U") && word.len() > 2
        || [
            "-O0",
            "-O1",
            "-O2",
            "-O3",
            "-Os",
            "-Oz",
            "-Og",
            "-Ofast",
            "-g",
            "-g0",
            "-g1",
            "-g2",
            "-g3",
            "-fPIC",
            "-fpic",
            "-fno-lto",
            "-flto",
            "-flto=thin",
            "-flto=full",
            "-pthread",
            "-fno-omit-frame-pointer",
            "-fomit-frame-pointer",
            "-fno-strict-aliasing",
            "-fvisibility=hidden",
            "-ffunction-sections",
            "-fdata-sections",
            "-fuse-ld=lld",
            "-falign-loops=32",
            "-ffp-contract=off",
            "-fno-math-errno",
            "-nostdlibinc",
        ]
        .contains(&word)
}

fn admitted_options(words: &[String]) -> Result<()> {
    let mut operand = false;
    for word in words {
        if operand {
            operand = false;
            continue;
        }
        operand = [
            "-I",
            "-L",
            "-F",
            "-isystem",
            "-iquote",
            "-include",
            "-imacros",
            "-isysroot",
            "--sysroot",
            "--config",
            "-target",
            "--target",
            "-D",
            "-U",
        ]
        .contains(&word.as_str());
        let path = [
            "-I",
            "-L",
            "-F",
            "--sysroot=",
            "--config=",
            "--config-user-dir=",
            "--config-system-dir=",
            "--target=",
        ]
        .iter()
        .any(|prefix| word.starts_with(prefix) && word.len() > prefix.len());
        let machine =
            (word.starts_with("-m") && !word.contains('=') && word != "-mllvm" && word != "-mmlir"
                || ["-march=", "-mtune=", "-mcpu="]
                    .iter()
                    .any(|prefix| word.starts_with(prefix)))
                && word
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-=_,.+".contains(&c));
        if !(operand || path || machine || scalar_option(word)) {
            bail!(
                "unsupported bundled dependency compiler option (hidden inputs are not cacheable): {word}"
            );
        }
    }
    if operand {
        bail!("bundled dependency compiler option lacks an operand");
    }
    Ok(())
}

fn environment(origin: &Path) -> Result<BTreeMap<String, Option<OsString>>> {
    let lists = [
        "PATH",
        "CPATH",
        "C_INCLUDE_PATH",
        "CPLUS_INCLUDE_PATH",
        "OBJC_INCLUDE_PATH",
        "LIBRARY_PATH",
        "COMPILER_PATH",
    ];
    let names = [
        "PATH",
        "CPATH",
        "C_INCLUDE_PATH",
        "CPLUS_INCLUDE_PATH",
        "OBJC_INCLUDE_PATH",
        "INCLUDE",
        "LIB",
        "LIBRARY_PATH",
        "COMPILER_PATH",
        "GCC_EXEC_PREFIX",
        "SDKROOT",
        "MACOSX_DEPLOYMENT_TARGET",
        "SOURCE_DATE_EPOCH",
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "CCC_OVERRIDE_OPTIONS",
        "CLANG_CONFIG_FILE_SYSTEM_DIR",
        "CLANG_CONFIG_FILE_USER_DIR",
        "CCACHE_PREFIX",
        "CCACHE_CONFIGPATH",
        "SCCACHE_CONF",
    ];
    names
        .into_iter()
        .map(|name| {
            let mut value = std::env::var_os(name);
            if lists.contains(&name)
                && let Some(paths) = &value
            {
                value = Some(std::env::join_paths(
                    std::env::split_paths(paths).map(|p| origin.join(p)),
                )?);
            }
            Ok((name.to_owned(), value))
        })
        .collect()
}

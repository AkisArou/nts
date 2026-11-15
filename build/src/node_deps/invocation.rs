use super::{
    ObjectFormat, Recipe, Request, SOURCE_BUNDLE, bundle, hash,
    paths::{MAPPING_POLICY, SourcePaths},
};
use anyhow::{Context as _, Result, bail};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    path::Path,
    process::{Command, Stdio},
};

pub(super) struct Context {
    pub key: String,
    pub record: Vec<u8>,
    pub flags: Vec<String>,
    compiler: Vec<String>,
    archiver: Vec<String>,
    pub(super) source: SourcePaths,
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
            source: SourcePaths::new(source)?,
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
        for target in &plan.targets {
            for flag in &target.cflags {
                refuse_prefix_map(flag)?;
            }
        }
        if std::env::var_os("CCC_OVERRIDE_OPTIONS").is_some() {
            bail!("bundled dependency builds do not admit CCC_OVERRIDE_OPTIONS");
        }
        // Explicit and implicit configs are checked before the mapping probe
        // or any object compile, so a caller never installs a competing map.
        let compiler_inputs = context.tool_inputs(&context.compiler)?;
        let archiver_inputs = context.tool_inputs(&context.archiver)?;
        let flag_inputs = context.tool_inputs(&context.flags)?;
        let search = super::search::fingerprint(&context)?;
        context.verify_mapping(&request.cache)?;
        let environment: BTreeMap<_, _> = context
            .environment
            .iter()
            .map(|(k, v)| Ok((k, context.identity_environment(k, v.as_ref())?)))
            .collect::<Result<_>>()?;
        context.record = serde_json::to_vec_pretty(&(
            SOURCE_BUNDLE,
            serde_json::to_string(&(&bundle().node, &bundle().source_sha256, plan))?,
            &request.target,
            context.identity_words(&context.compiler)?,
            context.identity_words(&context.archiver)?,
            context.identity_words(&context.flags)?,
            (MAPPING_POLICY, context.source.virtual_root()),
            context.version(&context.compiler)?,
            context.version(&context.archiver)?,
            compiler_inputs,
            archiver_inputs,
            flag_inputs,
            search,
            environment,
        ))?;
        context.key = hash(&context.record);
        Ok(context)
    }

    fn command(&self, words: &[String]) -> Command {
        let mut command = Command::new(&words[0]);
        command.args(&words[1..]).current_dir(self.source.root());
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
        let mut command = self.command(&self.compiler);
        command.args(self.source.mappings());
        command
    }
    pub(super) fn compiler_for_object(&self, input: &Path) -> Command {
        let mut command = self.compiler();
        if self.format == ObjectFormat::Coff {
            command.args([
                format!(
                    "-fdebug-compilation-dir={}",
                    self.source.virtual_root().display()
                ),
                "-gno-codeview-command-line".to_owned(),
                format!(
                    "-object-file-name={}/objects/{}.o",
                    self.source.virtual_root().display(),
                    input.display()
                ),
            ]);
        }
        command
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

    fn verify_mapping(&self, cache: &Path) -> Result<()> {
        // The verified bundle must stay byte-exact. This claim is outside it,
        // and the scratch owner keeps cleanup beside the operation's failure.
        nts_publication::scratch(cache, |directory| {
            self.probe_object(directory).map_err(std::io::Error::other)
        })?;
        Ok(())
    }

    fn probe_object(&self, directory: &Path) -> Result<()> {
        let probe = SourcePaths::new(directory)?;
        let name = Path::new("nts-prefix-map-probe.c");
        let physical = self.source.root().join(name);
        let input = format!(
            "#line 1 {}\nconst char nts_file_probe[] = \"nts-file-probe:\" __FILE__;\nconst char nts_base_probe[] = \"nts-base-probe:\" __BASE_FILE__;\n",
            serde_json::to_string(&physical)?
        );
        let source = probe.root().join(name);
        std::fs::write(&source, input)?;
        let object = probe.root().join("probe.o");
        let output = self
            .compiler_for_object(name)
            .args(probe.mappings())
            .args(&self.flags)
            .current_dir(probe.root())
            .arg("-g")
            .arg("-c")
            .arg(Path::new(".").join(name))
            .arg("-o")
            .arg(&object)
            .output()
            .context("probing bundled dependency object source mapping")?;
        if !output.status.success() {
            bail!(
                "bundled dependency compiler cannot map source paths in a debug object: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let bytes = self.probe_bytes(&object)?;
        self.check_probe_object(&bytes, &probe, name)
    }

    fn probe_bytes(&self, object: &Path) -> Result<Vec<u8>> {
        let bytes = std::fs::read(object)?;
        if !bytes.starts_with(b"BC\xc0\xde") && !bytes.starts_with(b"\xde\xc0\x17\x0b") {
            return Ok(bytes);
        }
        // Inspect the representation the route actually emitted. The compile
        // keeps all route flags, including LTO; this same driver decodes its
        // bitcode. Stdin avoids a disassembler-created ModuleID path comment.
        let output = self
            .compiler()
            .args(&self.flags)
            .args(["-S", "-emit-llvm", "-x", "ir", "-", "-o", "-"])
            .stdin(Stdio::from(std::fs::File::open(object)?))
            .output()
            .context("decoding bundled dependency bitcode source mapping probe")?;
        if !output.status.success() {
            bail!(
                "bundled dependency compiler cannot decode its source mapping bitcode: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        llvm_quoted_bytes(&output.stdout)
    }

    fn check_probe_object(&self, bytes: &[u8], probe: &SourcePaths, name: &Path) -> Result<()> {
        let expected = self
            .source
            .virtual_root()
            .join(name)
            .to_string_lossy()
            .into_owned();
        for tag in ["nts-file-probe:", "nts-base-probe:"] {
            let mapped = contains_bytes(bytes, format!("{tag}{expected}\0").as_bytes())
                || self.format == ObjectFormat::Coff
                    && contains_bytes(
                        bytes,
                        format!("{tag}{}\0", expected.replace('/', "\\")).as_bytes(),
                    );
            if !mapped {
                bail!(
                    "bundled dependency compiler cannot map source paths in a debug object: missing {tag}{expected}"
                );
            }
        }
        for root in [self.source.root(), probe.root()] {
            let spelling = root.to_str().context("probe path is not UTF-8")?;
            for spelling in [spelling.to_owned(), spelling.replace('/', "\\")] {
                let utf16 = spelling
                    .encode_utf16()
                    .flat_map(u16::to_le_bytes)
                    .collect::<Vec<_>>();
                if contains_bytes(bytes, spelling.as_bytes()) || contains_bytes(bytes, &utf16) {
                    bail!(
                        "bundled dependency compiler cannot map source paths in a debug object: physical namespace remains: {}",
                        root.display()
                    );
                }
            }
        }
        Ok(())
    }

    fn identity_words(&self, words: &[String]) -> Result<Vec<String>> {
        let mut path_next = false;
        words
            .iter()
            .map(|word| {
                if path_next {
                    path_next = false;
                    return self.source.identity(Path::new(word));
                }
                path_next = path_operand(word);
                for prefix in [
                    "--sysroot=",
                    "--config=",
                    "--config-user-dir=",
                    "--config-system-dir=",
                    "-I",
                    "-L",
                    "-F",
                ] {
                    if let Some(path) = word.strip_prefix(prefix).filter(|s| !s.is_empty()) {
                        return Ok(format!(
                            "{prefix}{}",
                            self.source.identity(Path::new(path))?
                        ));
                    }
                }
                if Path::new(word).is_absolute() {
                    return self.source.identity(Path::new(word));
                }
                Ok(word.clone())
            })
            .collect()
    }

    fn tool_inputs(&self, words: &[String]) -> Result<BTreeMap<String, String>> {
        tool_inputs(words)?
            .into_iter()
            .map(|(path, sha)| Ok((self.source.identity(Path::new(&path))?, sha)))
            .collect()
    }

    fn identity_environment(
        &self,
        name: &str,
        value: Option<&OsString>,
    ) -> Result<Option<Vec<u8>>> {
        let Some(value) = value else {
            return Ok(None);
        };
        let bytes = if PATH_LISTS.contains(&name) {
            let paths = std::env::split_paths(value)
                .map(|path| self.source.identity(&path))
                .collect::<Result<Vec<_>>>()?;
            std::env::join_paths(paths)?.as_encoded_bytes().to_vec()
        } else if [
            "GCC_EXEC_PREFIX",
            "SDKROOT",
            "CLANG_CONFIG_FILE_SYSTEM_DIR",
            "CLANG_CONFIG_FILE_USER_DIR",
        ]
        .contains(&name)
            && Path::new(value).is_absolute()
        {
            self.source.identity(Path::new(value))?.into_bytes()
        } else {
            value.as_encoded_bytes().to_vec()
        };
        Ok(Some(bytes))
    }
}

fn contains_bytes(bytes: &[u8], needle: &[u8]) -> bool {
    bytes.windows(needle.len()).any(|part| part == needle)
}

/// LLVM's printer represents bytes in quoted strings with two-digit hex
/// escapes. Inspect those bytes, including NULs, rather than searching the
/// bitstream or mistaking textual escape spelling for an artifact path.
fn llvm_quoted_bytes(text: &[u8]) -> Result<Vec<u8>> {
    let mut result = Vec::new();
    let mut at = 0;
    while at < text.len() {
        if text[at] == b';' {
            while at < text.len() && text[at] != b'\n' {
                at += 1;
            }
            continue;
        }
        if text[at] != b'"' {
            at += 1;
            continue;
        }
        at += 1;
        loop {
            let byte = *text.get(at).context("unterminated LLVM probe string")?;
            at += 1;
            if byte == b'"' {
                result.push(0);
                break;
            }
            if byte == b'\\' {
                let mut value = 0;
                for _ in 0..2 {
                    let digit = text
                        .get(at)
                        .and_then(|byte| char::from(*byte).to_digit(16))
                        .context("invalid LLVM probe string byte escape")?;
                    at += 1;
                    value = value * 16 + u8::try_from(digit)?;
                }
                result.push(value);
            } else {
                result.push(byte);
            }
        }
    }
    Ok(result)
}

const PATH_LISTS: &[&str] = &[
    "PATH",
    "CPATH",
    "C_INCLUDE_PATH",
    "CPLUS_INCLUDE_PATH",
    "OBJC_INCLUDE_PATH",
    "LIBRARY_PATH",
    "COMPILER_PATH",
];

fn path_operand(word: &str) -> bool {
    matches!(
        word,
        "-I" | "-L"
            | "-F"
            | "-isystem"
            | "-iquote"
            | "-include"
            | "-imacros"
            | "-isysroot"
            | "--sysroot"
            | "--config"
    )
}

fn refuse_prefix_map(word: &str) -> Result<()> {
    if [
        "-ffile-prefix-map",
        "-fdebug-prefix-map",
        "-fmacro-prefix-map",
    ]
    .iter()
    .any(|flag| word == *flag || word.starts_with(&format!("{flag}=")))
    {
        bail!(
            "bundled dependency source mappings are owner-controlled; caller flag is not allowed: {word}"
        );
    }
    Ok(())
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
            path_next = path_operand(word);
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
            refuse_prefix_map(word)?;
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
        refuse_prefix_map(word)?;
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
            if PATH_LISTS.contains(&name)
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

#[cfg(test)]
mod tests {
    use super::llvm_quoted_bytes;

    #[test]
    fn llvm_probe_strings_decode_bytes_and_refuse_malformed_escapes() {
        assert_eq!(
            llvm_quoted_bytes(
                br#"; "ignored comment"
source_filename = "./probe.c"
@tag = constant [10 x i8] c"tag:\2Froot\00"
"#
            )
            .expect("LLVM represented bytes"),
            b"./probe.c\0tag:/root\0\0"
        );
        for text in [br#""unfinished"#.as_slice(), br#""bad\0""#, br#""bad\GG""#] {
            assert!(llvm_quoted_bytes(text).is_err());
        }
    }
}

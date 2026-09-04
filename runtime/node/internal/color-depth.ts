// Terminal colour capability, from node v24.20.0 `lib/internal/tty.js`.
//
// This is policy rather than a native operation: the answer comes from the
// process environment, with only the Windows kernel release supplied by the
// host. Keeping the policy here gives the Node stand-in and a native program
// one implementation, including the warning emitted when FORCE_COLOR wins
// over one of the disable variables.

import { emitWarning } from "./process-warning.ts";

declare function nts_process_env(name: string): string;
declare function nts_process_env_has(name: string): boolean;
declare function nts_platform(): string;
declare function nts_os_release(): string;

const COLORS_2 = 1;
const COLORS_16 = 4;
const COLORS_256 = 8;
const COLORS_16M = 24;

function environment(name: string): string | undefined {
  return nts_process_env_has(name) ? nts_process_env(name) : undefined;
}

function environmentIsSet(name: string): boolean {
  return nts_process_env_has(name);
}

let warnedAboutDisabledColors = false;

/** Node warns once when an enabling FORCE_COLOR masks a disabling variable. */
function warnOnDeactivatedColors(): void {
  if (warnedAboutDisabledColors) return;

  const nodeDisableColors = environment("NODE_DISABLE_COLORS");
  const noColor = environment("NO_COLOR");
  let name = "";
  if (nodeDisableColors !== undefined && nodeDisableColors !== "") {
    name = "NODE_DISABLE_COLORS";
  }
  if (noColor !== undefined && noColor !== "") {
    if (name !== "") name += "' and '";
    name += "NO_COLOR";
  }

  if (name !== "") {
    emitWarning(
      `The '${name}' env is ignored due to the 'FORCE_COLOR' env being set.`,
      "Warning",
      "",
    );
    warnedAboutDisabledColors = true;
  }
}

function decimalComponent(text: string, wanted: number): number {
  let component = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i !== text.length && text.charCodeAt(i) !== 46) continue;
    if (component === wanted) {
      let value = 0;
      for (let at = start; at < i; at++) {
        const digit = text.charCodeAt(at) - 48;
        if (digit < 0 || digit > 9) return -1;
        value = value * 10 + digit;
      }
      return value;
    }
    component++;
    start = i + 1;
  }
  return -1;
}

function windowsColorDepth(): number {
  const release = nts_os_release();
  const major = decimalComponent(release, 0);
  if (major >= 10) {
    const build = decimalComponent(release, 2);
    if (build >= 14931) return COLORS_16M;
    if (build >= 10586) return COLORS_256;
  }
  return COLORS_16;
}

function ciColorDepth(): number {
  if (environmentIsSet("APPVEYOR")) return COLORS_256;
  if (environmentIsSet("BUILDKITE")) return COLORS_256;
  if (environmentIsSet("CIRCLECI")) return COLORS_16M;
  if (environmentIsSet("DRONE")) return COLORS_256;
  if (environmentIsSet("GITEA_ACTIONS")) return COLORS_16M;
  if (environmentIsSet("GITHUB_ACTIONS")) return COLORS_16M;
  if (environmentIsSet("GITLAB_CI")) return COLORS_256;
  if (environmentIsSet("TRAVIS")) return COLORS_256;
  if (environment("CI_NAME") === "codeship") return COLORS_256;
  return COLORS_2;
}

/** The version test in Node's `/^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/`. */
function modernTeamCity(version: string): boolean {
  let majorEnd = 0;
  while (majorEnd < version.length) {
    const code = version.charCodeAt(majorEnd);
    if (code < 48 || code > 57) break;
    majorEnd++;
  }
  if (majorEnd >= 2 && version.charCodeAt(majorEnd) === 46) return true;
  if (!version.startsWith("9.")) return false;

  let at = 2;
  while (version.charCodeAt(at) === 48) at++;
  const first = version.charCodeAt(at);
  if (first < 49 || first > 57) return false;
  do {
    at++;
    const code = version.charCodeAt(at);
    if (code < 48 || code > 57) break;
  } while (at < version.length);
  return version.charCodeAt(at) === 46;
}

function conTerminal(term: string): boolean {
  if (!term.startsWith("con")) return false;
  let at = 3;
  while (at < term.length) {
    const code = term.charCodeAt(at);
    if (code < 48 || code > 57) break;
    at++;
  }
  if (term.charCodeAt(at) !== 120) return false;
  const digit = term.charCodeAt(at + 1);
  return digit >= 48 && digit <= 57;
}

function namedTerminalColorDepth(term: string): number {
  switch (term) {
    case "mosh":
    case "rxvt-unicode-24bit":
    case "terminator":
    case "xterm-kitty":
      return COLORS_16M;
    case "eterm":
    case "cons25":
    case "console":
    case "cygwin":
    case "dtterm":
    case "gnome":
    case "hurd":
    case "jfbterm":
    case "konsole":
    case "kterm":
    case "mlterm":
    case "putty":
    case "st":
      return COLORS_16;
    default:
      break;
  }

  if (
    term.includes("ansi") ||
    term.includes("color") ||
    term.includes("linux") ||
    term.includes("direct") ||
    conTerminal(term) ||
    term.startsWith("rxvt") ||
    term.startsWith("screen") ||
    term.startsWith("xterm") ||
    term.startsWith("vt100") ||
    term.startsWith("vt220")
  ) {
    return COLORS_16;
  }
  return COLORS_2;
}

/** The number of colour bits Node assigns to the current environment. */
export function getColorDepth(): number {
  const forceColor = environment("FORCE_COLOR");
  if (forceColor !== undefined) {
    switch (forceColor) {
      case "":
      case "1":
      case "true":
        warnOnDeactivatedColors();
        return COLORS_16;
      case "2":
        warnOnDeactivatedColors();
        return COLORS_256;
      case "3":
        warnOnDeactivatedColors();
        return COLORS_16M;
      default:
        return COLORS_2;
    }
  }

  const nodeDisableColors = environment("NODE_DISABLE_COLORS");
  const noColor = environment("NO_COLOR");
  if (
    (nodeDisableColors !== undefined && nodeDisableColors !== "") ||
    (noColor !== undefined && noColor !== "") ||
    environment("TERM") === "dumb"
  ) {
    return COLORS_2;
  }

  if (nts_platform() === "win32") return windowsColorDepth();

  const tmux = environment("TMUX");
  if (tmux !== undefined && tmux !== "") return COLORS_16M;

  if (environmentIsSet("TF_BUILD") && environmentIsSet("AGENT_NAME")) {
    return COLORS_16;
  }

  if (environmentIsSet("CI")) return ciColorDepth();

  const teamCityVersion = environment("TEAMCITY_VERSION");
  if (teamCityVersion !== undefined) {
    return modernTeamCity(teamCityVersion) ? COLORS_16 : COLORS_2;
  }

  const termProgram = environment("TERM_PROGRAM");
  switch (termProgram) {
    case "iTerm.app": {
      const version = environment("TERM_PROGRAM_VERSION");
      if (
        version === undefined ||
        version === "" ||
        (version.length >= 2 && version.charCodeAt(0) >= 48 &&
          version.charCodeAt(0) <= 50 && version.charCodeAt(1) === 46)
      ) {
        return COLORS_256;
      }
      return COLORS_16M;
    }
    case "HyperTerm":
    case "MacTerm":
      return COLORS_16M;
    case "Apple_Terminal":
      return COLORS_256;
    default:
      break;
  }

  const colorTerm = environment("COLORTERM");
  if (colorTerm === "truecolor" || colorTerm === "24bit") return COLORS_16M;

  const rawTerm = environment("TERM");
  if (rawTerm !== undefined && rawTerm !== "") {
    if (rawTerm.includes("truecolor")) return COLORS_16M;
    if (rawTerm.startsWith("xterm-256")) return COLORS_256;
    const namedDepth = namedTerminalColorDepth(rawTerm.toLowerCase());
    if (namedDepth !== COLORS_2) return namedDepth;
  }

  if (colorTerm !== undefined && colorTerm !== "") return COLORS_16;
  return COLORS_2;
}

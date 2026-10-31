// Ambient behavior belongs to the gate's environment contract. Only the
// harness's explicit inputs and child protocol cross this boundary as well.
import {hostEnvironment,FIXED_AMBIENT} from "../gate/canonical-environment.ts";
import {mkdirSync} from "node:fs";
import {join,resolve} from "node:path";

const INPUTS = [
  "NTS_BIN", "NTS_COMPILER", "NTS_ADDON_OUT", "NTS_CONFORMANCE_OUT",
  "NTS_ADDON_EMITTED", "NTS_ADDON_SIBLING_CACHE", "NTS_NATIVE_OBJ_CACHE",
  "NTS_CONFORMANCE_TIMEOUT_MS", "NTS_CONFORMANCE_RC", "NTS_CONFORMANCE_ORACLE", "NTS_KEEP_TEMP",
] as const;

export function nodeEnvironment(launcher:NodeJS.ProcessEnv,owned:NodeJS.ProcessEnv={}):NodeJS.ProcessEnv {
  const host=hostEnvironment(launcher);
  const inputs=Object.fromEntries(INPUTS.filter(name=>launcher[name]!==undefined).map(name=>[name,launcher[name]]));
  const env:NodeJS.ProcessEnv={...host,...FIXED_AMBIENT,...inputs,NTS_CHECKERS:"1",...owned};
  env.TMPDIR=resolve(owned.TMPDIR??launcher.TMPDIR??join(host.HOME!,".cache/nts-conformance",String(process.pid),"tmp"));
  // Unix socket names have 107 bytes, including test-specific suffixes.
  env.NODE_TEST_DIR=resolve(owned.NODE_TEST_DIR??launcher.NODE_TEST_DIR??join(host.HOME!,".cache",`n${process.pid.toString(36)}`));
  env.XDG_CACHE_HOME=join(host.HOME!,".cache");
  mkdirSync(env.TMPDIR,{recursive:true});
  mkdirSync(env.NODE_TEST_DIR,{recursive:true});
  return env;
}

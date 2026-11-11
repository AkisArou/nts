import { verdictContract } from "./verdict-contract.ts";
import { FIXED_AMBIENT, type EnvironmentReport } from "./canonical-environment.ts";

export function contractReport(): EnvironmentReport {
  return {
    version: 1, canonical: true, experiments: [], dropped: [],
    host: { HOME: "/fixture/home", PATH: "/fixture/bin", DBUS_SESSION_BUS_ADDRESS: "fixture-bus" },
    ambient: { ...FIXED_AMBIENT, TMPDIR: "/fixture/run/tmp" },
  };
}

export function fixtureContract() {
  return verdictContract(contractReport(), {
    platform: "linux", arch: "x64", node: "26.13.0", tools: { rustc: "fixture-rustc" }, inputs: {},
  });
}

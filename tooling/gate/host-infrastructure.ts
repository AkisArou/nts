// The user-manager connection is a named host capability, independent of
// canonical setup and its provisioning imports (also used by sampler Workers).
export const HOST_INFRASTRUCTURE = ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"] as const;
export function hostInfrastructure(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
  return Object.fromEntries(HOST_INFRASTRUCTURE.flatMap(name=>env[name]===undefined?[]:[[name,env[name]]]));
}

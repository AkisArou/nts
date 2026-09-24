// The state `react` shares with its renderers, read from the `react` package
// so the reconciler and the app use one object. A re-export: a live binding
// nothing reads while modules are still evaluating.
export { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as ReactSharedInternals } from "react";

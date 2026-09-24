// The internals as every bundle except `react`'s own sees them: read from
// the `react` package, so that the JSX runtime, the compiler runtime and
// every renderer share the one object `react` created. The build forks this
// module to ./ReactSharedInternalsClient.ts inside `react`'s main entry.
import { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as internals } from "react";

export const ReactSharedInternals = internals;

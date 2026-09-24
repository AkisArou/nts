// A compile-time check that each noop entry's config exports every value the
// reconciler's ReactFiberConfig.ts contract declares. The build replaces the
// contract with these modules, so a missing name would otherwise surface only
// as `undefined is not a function` inside a test. Not imported at run time.

import type * as Contract from "react-reconciler/ReactFiberConfig.ts";
import type * as Mutation from "./ReactFiberConfigNoopMutation.ts";
import type * as Persistent from "./ReactFiberConfigNoopPersistent.ts";

type MissingFrom<Config> = Exclude<keyof typeof Contract, keyof Config>;

export const mutationConfigIsComplete: [MissingFrom<typeof Mutation>] extends [never] ? true : MissingFrom<typeof Mutation> = true;
export const persistentConfigIsComplete: [MissingFrom<typeof Persistent>] extends [never] ? true : MissingFrom<typeof Persistent> = true;

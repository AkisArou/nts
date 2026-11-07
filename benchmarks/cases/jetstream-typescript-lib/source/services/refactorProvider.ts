// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/refactorProvider.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { type ApplicableRefactorInfo, arrayFrom, flatMapIterator, type InteractiveRefactorArguments, type Refactor, type RefactorContext, type RefactorEditInfo } from "./_namespaces/ts.ts";
import { refactorKindBeginsWith } from "./_namespaces/ts.refactor.ts";
// A map with the refactor code as key, the refactor itself as value
// e.g.  nonSuggestableRefactors[refactorCode] -> the refactor you want
const refactors = new Map<string, Refactor>();
/**
 * @param name An unique code associated with each refactor. Does not have to be human-readable.
 *
 * @internal
 */
export function registerRefactor(name: string, refactor: Refactor): void {
    refactors.set(name, refactor);
}
/** @internal */
export function getApplicableRefactors(context: RefactorContext, includeInteractiveActions?: boolean): ApplicableRefactorInfo[] {
    return arrayFrom(flatMapIterator(refactors.values(), refactor => context.cancellationToken && context.cancellationToken.isCancellationRequested() ||
        !refactor.kinds?.some(kind => refactorKindBeginsWith(kind, context.kind)) ? undefined :
        refactor.getAvailableActions(context, includeInteractiveActions)));
}
/** @internal */
export function getEditsForRefactor(context: RefactorContext, refactorName: string, actionName: string, interactiveRefactorArguments?: InteractiveRefactorArguments): RefactorEditInfo | undefined {
    const refactor = refactors.get(refactorName);
    return refactor && refactor.getEditsForAction(context, actionName, interactiveRefactorArguments);
}

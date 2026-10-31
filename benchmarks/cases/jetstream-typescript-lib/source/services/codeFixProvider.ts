// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codeFixProvider.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../checked.ts";
import { present } from "../checked.ts";
import { arrayFrom, cast, type CodeActionCommand, type CodeFixAction, type CodeFixAllContext, type CodeFixContext, type CodeFixContextBase, type CodeFixRegistration, type CombinedCodeActions, computeSuggestionDiagnostics, contains, createMultiMap, Debug, type Diagnostic, type DiagnosticOrDiagnosticAndArguments, diagnosticToString, type DiagnosticWithLocation, type FileTextChanges, flatMap, getEmitDeclarations, isString, map, type TextChange, textChanges } from "./_namespaces/ts.ts";
const errorCodeToFixes = createMultiMap<string, CodeFixRegistration>();
const fixIdToRegistration = new Map<string, CodeFixRegistration>();
/** @internal */
export function createCodeFixActionWithoutFixAll(fixName: string, changes: FileTextChanges[], description: DiagnosticOrDiagnosticAndArguments): CodeFixAction {
    return createCodeFixActionWorker(fixName, diagnosticToString(description), changes, /*fixId*/ undefined, /*fixAllDescription*/ undefined);
}
/** @internal */
export function createCodeFixAction(fixName: string, changes: FileTextChanges[], description: DiagnosticOrDiagnosticAndArguments, fixId: {}, fixAllDescription: DiagnosticOrDiagnosticAndArguments, command?: CodeActionCommand): CodeFixAction {
    return createCodeFixActionWorker(fixName, diagnosticToString(description), changes, fixId, diagnosticToString(fixAllDescription), command);
}
/** @internal */
export function createCodeFixActionMaybeFixAll(fixName: string, changes: FileTextChanges[], description: DiagnosticOrDiagnosticAndArguments, fixId?: {}, fixAllDescription?: DiagnosticOrDiagnosticAndArguments, command?: CodeActionCommand): CodeFixAction {
    return createCodeFixActionWorker(fixName, diagnosticToString(description), changes, fixId, fixAllDescription && diagnosticToString(fixAllDescription), command);
}
function createCodeFixActionWorker(fixName: string, description: string, changes: FileTextChanges[], fixId?: {}, fixAllDescription?: string, command?: CodeActionCommand): CodeFixAction {
    return { fixName, description, changes, fixId, fixAllDescription, commands: command ? [command] : undefined };
}
/** @internal */
export function registerCodeFix(reg: CodeFixRegistration): void {
    for (const error of reg.errorCodes) {
        errorCodeToFixesArray = undefined;
        errorCodeToFixes.add(String(error), reg);
    }
    if (reg.fixIds) {
        for (const fixId of reg.fixIds) {
            Debug.assert(!fixIdToRegistration.has(fixId));
            fixIdToRegistration.set(fixId, reg);
        }
    }
}
let errorCodeToFixesArray: readonly string[] | undefined;
/** @internal */
export function getSupportedErrorCodes(): readonly string[] {
    return errorCodeToFixesArray ??= arrayFrom(errorCodeToFixes.keys());
}
function removeFixIdIfFixAllUnavailable(registration: CodeFixRegistration, diagnostics: Diagnostic[]) {
    const { errorCodes } = registration;
    let maybeFixableDiagnostics = 0;
    for (const diag of diagnostics) {
        if (contains(errorCodes, diag.code))
            maybeFixableDiagnostics++;
        if (maybeFixableDiagnostics > 1)
            break;
    }
    const fixAllUnavailable = maybeFixableDiagnostics < 2;
    return ({ fixId, fixAllDescription, ...action }: CodeFixAction): CodeFixAction => {
        return fixAllUnavailable ? action : { ...action, fixId, fixAllDescription };
    };
}
/** @internal */
export function getFixes(context: CodeFixContext): readonly CodeFixAction[] {
    const diagnostics = getDiagnostics(context);
    const registrations = errorCodeToFixes.get(String(context.errorCode));
    return flatMap(registrations, f => map(f.getCodeActions(context), removeFixIdIfFixAllUnavailable(f, diagnostics)));
}
/** @internal */
export function getAllFixes(context: CodeFixAllContext): CombinedCodeActions {
    // Currently fixId is always a string.
    return requireCompilerMember((fixIdToRegistration.get(cast(context.fixId, isString)))!, "getAllCodeActions").getAllCodeActions(context);
}
/** @internal */
export function createCombinedCodeActions(changes: FileTextChanges[], commands?: CodeActionCommand[]): CombinedCodeActions {
    return { changes, commands };
}
/** @internal */
export function createFileTextChanges(fileName: string, textChanges: TextChange[]): FileTextChanges {
    return { fileName, textChanges };
}
/** @internal */
export function codeFixAll(context: CodeFixAllContext, errorCodes: number[], use: (changes: textChanges.ChangeTracker, error: DiagnosticWithLocation, commands: CodeActionCommand[]) => void): CombinedCodeActions {
    const commands: CodeActionCommand[] = [];
    const changes = textChanges.ChangeTracker.with(context, t => eachDiagnostic(context, errorCodes, diag => use(t, diag, commands)));
    return createCombinedCodeActions(changes, commands.length === 0 ? undefined : commands);
}
/** @internal */
export function eachDiagnostic(context: CodeFixAllContext, errorCodes: readonly number[], cb: (diag: DiagnosticWithLocation) => void): void {
    for (const diag of getDiagnostics(context)) {
        if (contains(errorCodes, diag.code)) {
            cb(requireLocatedCodeFixDiagnostic(diag));
        }
    }
}
function getDiagnostics({ program, sourceFile, cancellationToken }: CodeFixContextBase) {
    const diagnostics = [
        ...program.getSemanticDiagnostics(sourceFile, cancellationToken),
        ...program.getSyntacticDiagnostics(sourceFile, cancellationToken),
        ...computeSuggestionDiagnostics(sourceFile, program, cancellationToken),
    ];
    if (getEmitDeclarations(program.getCompilerOptions())) {
        diagnostics.push(...program.getDeclarationDiagnostics(sourceFile, cancellationToken));
    }
    return diagnostics;
}

function isLocatedCodeFixDiagnostic(diag: Diagnostic): diag is DiagnosticWithLocation {
    return diag.file !== undefined && diag.start !== undefined && diag.length !== undefined;
}
function requireLocatedCodeFixDiagnostic(diag: Diagnostic): DiagnosticWithLocation {
    if (isLocatedCodeFixDiagnostic(diag)) return diag;
    throw new TypeError("Expected located code-fix diagnostic");
}

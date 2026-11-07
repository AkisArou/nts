// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/types.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import type { MapLike } from "./_namespaces/ts.ts";
interface NamespaceLayout_ScriptSnapshot {
    fromString: {
        (text: string): IScriptSnapshot;
    };
}
import { type CancellationToken, type CompilerHost, type CompilerOptions, type CustomTransformers, type Diagnostic, type DiagnosticWithLocation, DocumentHighlights, type DocumentPositionMapper, type EmitOutput, type ExportInfoMap, type ExportMapInfoKey, type FileReference, type GetEffectiveTypeRootsHost, type HasChangedAutomaticTypeDirectiveNames, type HasInvalidatedResolutions, JSDocParsingMode, type LineAndCharacter, type MinimalResolutionCacheHost, type ModuleResolutionCache, type ModuleSpecifierCache, type ParsedCommandLine, type Path, type Program, type ProjectReference, type ResolutionMode, type ResolvedModule, type ResolvedModuleWithFailedLookupLocations, type ResolvedProjectReference, type ResolvedTypeReferenceDirective, type ResolvedTypeReferenceDirectiveWithFailedLookupLocations, ScriptKind, type SourceFile, type SourceFileLike, type SourceMapper, type StringLiteralLike, type Symbol, type SymlinkCache, type TextChangeRange, textChanges, type TextRange, type TextSpan, type UserPreferences } from "./_namespaces/ts.ts";
declare module "../compiler/types.js" {
    // Module transform: converted from interface augmentation
    export interface Node {
        getSourceFile?(): SourceFile;
        getChildCount?(sourceFile?: SourceFile): number;
        getChildAt?(index: number, sourceFile?: SourceFile): Node;
        getChildren?(sourceFile?: SourceFile): readonly Node[];
        /** @internal */
        getChildren?(sourceFile?: SourceFileLike): readonly Node[]; // eslint-disable-line @typescript-eslint/unified-signatures
        getStart?(sourceFile?: SourceFile, includeJsDocComment?: boolean): number;
        /** @internal */
        getStart?(sourceFile?: SourceFileLike, includeJsDocComment?: boolean): number; // eslint-disable-line @typescript-eslint/unified-signatures
        getFullStart?(): number;
        getEnd?(): number;
        getWidth?(sourceFile?: SourceFileLike): number;
        getFullWidth?(): number;
        getLeadingTriviaWidth?(sourceFile?: SourceFile): number;
        getFullText?(sourceFile?: SourceFile): string;
        getText?(sourceFile?: SourceFile): string;
        getFirstToken?(sourceFile?: SourceFile): Node | undefined;
        /** @internal */
        getFirstToken?(sourceFile?: SourceFileLike): Node | undefined; // eslint-disable-line @typescript-eslint/unified-signatures
        getLastToken?(sourceFile?: SourceFile): Node | undefined;
        /** @internal */
        getLastToken?(sourceFile?: SourceFileLike): Node | undefined; // eslint-disable-line @typescript-eslint/unified-signatures
        // See ts.forEachChild for documentation.
        forEachChild?<T>(cbNode: (node: Node) => T | undefined, cbNodeArray?: (nodes: NodeArray<Node>) => T | undefined): T | undefined;
    }
}
declare module "../compiler/types.js" {
    // Module transform: converted from interface augmentation
    export interface Identifier {
        text?: string;
    }
}
declare module "../compiler/types.js" {
    // Module transform: converted from interface augmentation
    export interface PrivateIdentifier {
        text?: string;
    }
}
declare module "../compiler/types.js" {
    // Module transform: converted from interface augmentation
    export interface Symbol {
        name?: string;
        getFlags?(): SymbolFlags;
        getEscapedName?(): __String;
        getName?(): string;
        getDeclarations?(): Declaration[] | undefined;
        getDocumentationComment?(typeChecker: TypeChecker | undefined): SymbolDisplayPart[];
        /** @internal */
        getContextualDocumentationComment?(context: Node | undefined, checker: TypeChecker | undefined): SymbolDisplayPart[];
        getJsDocTags?(checker?: TypeChecker): JSDocTagInfo[];
        /** @internal */
        getContextualJsDocTags?(context: Node | undefined, checker: TypeChecker | undefined): JSDocTagInfo[];
    }
}
declare module "../compiler/types.js" {
    // Module transform: converted from interface augmentation
    export interface Type {
        getFlags?(): TypeFlags;
        getSymbol?(): Symbol | undefined;
        getProperties?(): Symbol[];
        getProperty?(propertyName: string): Symbol | undefined;
        getApparentProperties?(): Symbol[];
        getCallSignatures?(): readonly Signature[];
        getConstructSignatures?(): readonly Signature[];
        getStringIndexType?(): Type | undefined;
        getNumberIndexType?(): Type | undefined;
        getBaseTypes?(): BaseType[] | undefined;
        getNonNullableType?(): Type;
        /** @internal */ getNonOptionalType?(): Type;
        /** @internal */ isNullableType?(): boolean;
        getConstraint?(): Type | undefined;
        getDefault?(): Type | undefined;
        isUnion?(): this is UnionType;
        isIntersection?(): this is IntersectionType;
        isUnionOrIntersection?(): this is UnionOrIntersectionType;
        isLiteral?(): this is LiteralType;
        isStringLiteral?(): this is StringLiteralType;
        isNumberLiteral?(): this is NumberLiteralType;
        isTypeParameter?(): this is TypeParameter;
        isClassOrInterface?(): this is InterfaceType;
        isClass?(): this is InterfaceType;
        isIndexType?(): this is IndexType;
    }
}
declare module "../compiler/types.js" {
    // Module transform: converted from interface augmentation
    export interface TypeReference {
        typeArguments?: readonly Type[];
    }
}
declare module "../compiler/types.js" {
    // Module transform: converted from interface augmentation
    export interface Signature {
        getDeclaration?(): SignatureDeclaration;
        getTypeParameters?(): TypeParameter[] | undefined;
        getParameters?(): Symbol[];
        getTypeParameterAtPosition?(pos: number): Type;
        getReturnType?(): Type;
        getDocumentationComment?(typeChecker: TypeChecker | undefined): SymbolDisplayPart[];
        getJsDocTags?(): JSDocTagInfo[];
    }
}
declare module "../compiler/types.js" {
    // Module transform: converted from interface augmentation
    export interface SourceFile {
        /** @internal */ version: string;
        /** @internal */ scriptSnapshot: IScriptSnapshot | undefined;
        /** @internal */ nameTable: Map<__String, number> | undefined;
        /** @internal */ getNamedDeclarations?(): Map<string, readonly Declaration[]>;
        getLineAndCharacterOfPosition?(pos: number): LineAndCharacter;
        getLineEndOfPosition?(pos: number): number;
        getLineStarts?(): readonly number[];
        getPositionOfLineAndCharacter?(line: number, character: number): number;
        update?(newText: string, textChangeRange: TextChangeRange): SourceFile;
        /** @internal */ sourceMapper?: DocumentPositionMapper;
    }
}
declare module "../compiler/types.js" {
    // Module transform: converted from interface augmentation
    export interface SourceFileLike {
        getLineAndCharacterOfPosition?(pos: number): LineAndCharacter;
    }
}
declare module "../compiler/types.js" {
    // Module transform: converted from interface augmentation
    export interface SourceMapSource {
        getLineAndCharacterOfPosition?(pos: number): LineAndCharacter;
    }
}
/**
 * Represents an immutable snapshot of a script at a specified time.Once acquired, the
 * snapshot is observably immutable. i.e. the same calls with the same parameters will return
 * the same values.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface IScriptSnapshot {
    /** Gets a portion of the script snapshot specified by [start, end). */
    getText(start: number, end: number): string;
    /** Gets the length of this script snapshot. */
    getLength(): number;
    /**
     * Gets the TextChangeRange that describe how the text changed between this text and
     * an older version.  This information is used by the incremental parser to determine
     * what sections of the script need to be re-parsed.  'undefined' can be returned if the
     * change range cannot be determined.  However, in that case, incremental parsing will
     * not happen and the entire document will be re - parsed.
     */
    getChangeRange(oldSnapshot: IScriptSnapshot): TextChangeRange | undefined;
    /** Releases all resources held by this script snapshot */
    dispose?(): void;
}
export const ScriptSnapshot: NamespaceLayout_ScriptSnapshot = (function (): NamespaceLayout_ScriptSnapshot {
    class StringScriptSnapshot implements IScriptSnapshot {
        constructor(text: string) {
            this.text = text;
        }
        public getText(start: number, end: number): string {
            return start === 0 && end === this.text.length
                ? this.text
                : this.text.substring(start, end);
        }
        public getLength(): number {
            return this.text.length;
        }
        public getChangeRange(): TextChangeRange | undefined {
            // Text-based snapshots do not support incremental parsing. Return undefined
            // to signal that to the caller.
            return undefined;
        }
        declare private text: string;
    }
    function fromString(text: string): IScriptSnapshot {
        return new StringScriptSnapshot(text);
    }
    return {
        fromString
    };
})();
export interface PreProcessedFileInfo {
    referencedFiles: FileReference[];
    typeReferenceDirectives: FileReference[];
    libReferenceDirectives: FileReference[];
    importedFiles: FileReference[];
    ambientExternalModules?: string[];
    isLibFile: boolean;
}
export interface HostCancellationToken {
    isCancellationRequested(): boolean;
}
export interface InstallPackageOptions {
    fileName: Path;
    packageName: string;
}
/** @internal */
export type PackageJsonDependencyGroup = number;
/** @internal */
export const PackageJsonDependencyGroup: {
    readonly Dependencies: 1;
    readonly DevDependencies: 2;
    readonly PeerDependencies: 4;
    readonly OptionalDependencies: 8;
    readonly All: 15;
    [index: number]: string;
} = {
    Dependencies: 1,
    "1": "Dependencies",
    DevDependencies: 2,
    "2": "DevDependencies",
    PeerDependencies: 4,
    "4": "PeerDependencies",
    OptionalDependencies: 8,
    "8": "OptionalDependencies",
    All: 15,
    "15": "All"
};
/** @internal */
export interface ProjectPackageJsonInfo {
    fileName: string;
    parseable: boolean;
    dependencies?: Map<string, string>;
    devDependencies?: Map<string, string>;
    peerDependencies?: Map<string, string>;
    optionalDependencies?: Map<string, string>;
    get(dependencyName: string, inGroups?: PackageJsonDependencyGroup): string | undefined;
    has(dependencyName: string, inGroups?: PackageJsonDependencyGroup): boolean;
}
/** @internal */
export interface FormattingHost {
    getNewLine?(): string;
}
/** @internal */
export type PackageJsonAutoImportPreference = number;
/** @internal */
export const PackageJsonAutoImportPreference: {
    readonly Off: 0;
    readonly On: 1;
    readonly Auto: 2;
    [index: number]: string;
} = {
    Off: 0,
    "0": "Off",
    On: 1,
    "1": "On",
    Auto: 2,
    "2": "Auto"
};
export interface PerformanceEvent {
    kind: "UpdateGraph" | "CreatePackageJsonAutoImportProvider";
    durationMs: number;
}
export type LanguageServiceMode = number;
export const LanguageServiceMode: {
    readonly Semantic: 0;
    readonly PartialSemantic: 1;
    readonly Syntactic: 2;
    [index: number]: string;
} = {
    Semantic: 0,
    "0": "Semantic",
    PartialSemantic: 1,
    "1": "PartialSemantic",
    Syntactic: 2,
    "2": "Syntactic"
};
export interface IncompleteCompletionsCache {
    get(): CompletionInfo | undefined;
    set(response: CompletionInfo): void;
    clear(): void;
}
//
// Public interface of the host of a language service instance.
//
export interface LanguageServiceHost extends GetEffectiveTypeRootsHost, MinimalResolutionCacheHost {
    getCompilationSettings(): CompilerOptions;
    getNewLine?(): string;
    /** @internal */ updateFromProject?(): void;
    /** @internal */ updateFromProjectInProgress?: boolean;
    getProjectVersion?(): string;
    getScriptFileNames(): string[];
    getScriptKind?(fileName: string): ScriptKind | undefined;
    getScriptVersion(fileName: string): string | undefined;
    getScriptSnapshot(fileName: string): IScriptSnapshot | undefined;
    getProjectReferences?(): readonly ProjectReference[] | undefined;
    getLocalizedDiagnosticMessages?(): MapLike<string> | undefined;
    getCancellationToken?(): HostCancellationToken;
    getCurrentDirectory(): string;
    getDefaultLibFileName(options: CompilerOptions): string;
    log?(s: string): void;
    trace?(s: string): void;
    error?(s: string): void;
    useCaseSensitiveFileNames?(): boolean;
    /*
     * LS host can optionally implement these methods to support completions for module specifiers.
     * Without these methods, only completions for ambient modules will be provided.
     */
    readDirectory?(path: string, extensions?: readonly string[], exclude?: readonly string[], include?: readonly string[], depth?: number): string[];
    realpath?(path: string): string;
    /** @internal */ createHash?: ((data: string) => string) | undefined;
    /*
     * Unlike `realpath and `readDirectory`, `readFile` and `fileExists` are now _required_
     * to properly acquire and setup source files under module: node16+ modes.
     */
    readFile(path: string, encoding?: string): string | undefined;
    fileExists(path: string): boolean;
    /*
     * LS host can optionally implement these methods to support automatic updating when new type libraries are installed
     */
    getTypeRootsVersion?(): number;
    /*
     * LS host can optionally implement this method if it wants to be completely in charge of module name resolution.
     * if implementation is omitted then language service will use built-in module resolution logic and get answers to
     * host specific questions using 'getScriptSnapshot'.
     *
     * If this is implemented, `getResolvedModuleWithFailedLookupLocationsFromCache` should be too.
     */
    /** @deprecated supply resolveModuleNameLiterals instead for resolution that can handle newer resolution modes like nodenext */
    resolveModuleNames?(moduleNames: string[], containingFile: string, reusedNames: string[] | undefined, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingSourceFile?: SourceFile): (ResolvedModule | undefined)[];
    getResolvedModuleWithFailedLookupLocationsFromCache?(modulename: string, containingFile: string, resolutionMode?: ResolutionMode): ResolvedModuleWithFailedLookupLocations | undefined;
    /** @deprecated supply resolveTypeReferenceDirectiveReferences instead for resolution that can handle newer resolution modes like nodenext */
    resolveTypeReferenceDirectives?(typeDirectiveNames: string[] | FileReference[], containingFile: string, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingFileMode?: ResolutionMode): (ResolvedTypeReferenceDirective | undefined)[];
    resolveModuleNameLiterals?(moduleLiterals: readonly StringLiteralLike[], containingFile: string, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingSourceFile: SourceFile, reusedNames: readonly StringLiteralLike[] | undefined): readonly ResolvedModuleWithFailedLookupLocations[];
    resolveTypeReferenceDirectiveReferences?<T extends FileReference | string>(typeDirectiveReferences: readonly T[], containingFile: string, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingSourceFile: SourceFile | undefined, reusedNames: readonly T[] | undefined): readonly ResolvedTypeReferenceDirectiveWithFailedLookupLocations[];
    /** @internal */
    resolveLibrary?(libraryName: string, resolveFrom: string, options: CompilerOptions, libFileName: string): ResolvedModuleWithFailedLookupLocations;
    /**
     * If provided along with custom resolveLibrary, used to determine if we should redo library resolutions
     * @internal
     */
    hasInvalidatedLibResolutions?: ((libFileName: string) => boolean) | undefined;
    /** @internal */ hasInvalidatedResolutions?: HasInvalidatedResolutions | undefined;
    /** @internal */ hasChangedAutomaticTypeDirectiveNames?: HasChangedAutomaticTypeDirectiveNames;
    /** @internal */ getGlobalTypingsCacheLocation?(): string | undefined;
    /** @internal */ getSymlinkCache?(files?: readonly SourceFile[]): SymlinkCache;
    /* Lets the Program from a AutoImportProviderProject use its host project's ModuleResolutionCache */
    /** @internal */ getModuleResolutionCache?(): ModuleResolutionCache | undefined;
    /*
     * Required for full import and type reference completions.
     * These should be unprefixed names. E.g. `getDirectories("/foo/bar")` should return `["a", "b"]`, not `["/foo/bar/a", "/foo/bar/b"]`.
     */
    getDirectories?(directoryName: string): string[];
    /**
     * Gets a set of custom transformers to use during emit.
     */
    getCustomTransformers?(): CustomTransformers | undefined;
    isKnownTypesPackageName?(name: string): boolean;
    installPackage?(options: InstallPackageOptions): Promise<ApplyCodeActionCommandResult>;
    writeFile?(fileName: string, content: string): void;
    /** @internal */ getDocumentPositionMapper?(generatedFileName: string, sourceFileName?: string): DocumentPositionMapper | undefined;
    /** @internal */ getSourceFileLike?(fileName: string): SourceFileLike | undefined;
    /** @internal */ getPackageJsonsVisibleToFile?(fileName: string, rootDir?: string): readonly ProjectPackageJsonInfo[];
    /** @internal */ getNearestAncestorDirectoryWithPackageJson?(fileName: string): string | undefined;
    /** @internal */ getPackageJsonsForAutoImport?(rootDir?: string): readonly ProjectPackageJsonInfo[];
    /** @internal */ getCachedExportInfoMap?(): ExportInfoMap;
    /** @internal */ getModuleSpecifierCache?(): ModuleSpecifierCache;
    /** @internal */ setCompilerHost?(host: CompilerHost): void;
    /** @internal */ useSourceOfProjectReferenceRedirect?(): boolean;
    /** @internal */ getPackageJsonAutoImportProvider?(): Program | undefined;
    /** @internal */ sendPerformanceEvent?(kind: PerformanceEvent["kind"], durationMs: number): void;
    getParsedCommandLine?(fileName: string): ParsedCommandLine | undefined;
    /** @internal */ onReleaseParsedCommandLine?(configFileName: string, oldResolvedRef: ResolvedProjectReference | undefined, optionOptions: CompilerOptions): void;
    /** @internal */ onReleaseOldSourceFile?(oldSourceFile: SourceFile, oldOptions: CompilerOptions, hasSourceFileByPath: boolean, newSourceFileByResolvedPath: SourceFile | undefined): void;
    /** @internal */ getIncompleteCompletionsCache?(): IncompleteCompletionsCache;
    /** @internal */ runWithTemporaryFileUpdate?(rootFile: string, updatedText: string, cb: (updatedProgram: Program, originalProgram: Program | undefined, updatedPastedText: SourceFile) => void): void;
    jsDocParsingMode?: JSDocParsingMode | undefined;
}
/** @internal */
export const emptyOptions = {};
export type WithMetadata<T> = T & {
    metadata?: unknown;
};
export type SemanticClassificationFormat = "original" | "2020";
export const SemanticClassificationFormat: {
    readonly Original: "original";
    readonly TwentyTwenty: "2020";
} = {
    Original: "original",
    TwentyTwenty: "2020"
};
/** @internal */
export interface RegionDiagnosticsResult {
    diagnostics: Diagnostic[];
    spans: TextSpan[];
}
//
// Public services of a language service instance associated
// with a language service host instance
//
export interface LanguageService {
    /** This is used as a part of restarting the language service. */
    cleanupSemanticCache(): void;
    /**
     * Gets errors indicating invalid syntax in a file.
     *
     * In English, "this cdeo have, erorrs" is syntactically invalid because it has typos,
     * grammatical errors, and misplaced punctuation. Likewise, examples of syntax
     * errors in TypeScript are missing parentheses in an `if` statement, mismatched
     * curly braces, and using a reserved keyword as a variable name.
     *
     * These diagnostics are inexpensive to compute and don't require knowledge of
     * other files. Note that a non-empty result increases the likelihood of false positives
     * from `getSemanticDiagnostics`.
     *
     * While these represent the majority of syntax-related diagnostics, there are some
     * that require the type system, which will be present in `getSemanticDiagnostics`.
     *
     * @param fileName A path to the file you want syntactic diagnostics for
     */
    getSyntacticDiagnostics(fileName: string): DiagnosticWithLocation[];
    /**
     * Gets warnings or errors indicating type system issues in a given file.
     * Requesting semantic diagnostics may start up the type system and
     * run deferred work, so the first call may take longer than subsequent calls.
     *
     * Unlike the other get*Diagnostics functions, these diagnostics can potentially not
     * include a reference to a source file. Specifically, the first time this is called,
     * it will return global diagnostics with no associated location.
     *
     * To contrast the differences between semantic and syntactic diagnostics, consider the
     * sentence: "The sun is green." is syntactically correct; those are real English words with
     * correct sentence structure. However, it is semantically invalid, because it is not true.
     *
     * @param fileName A path to the file you want semantic diagnostics for
     */
    getSemanticDiagnostics(fileName: string): Diagnostic[];
    /**
     * Similar to {@link getSemanticDiagnostics}, but only checks the specified ranges of the file for diagnostics.
     * @internal
     */
    getRegionSemanticDiagnostics(fileName: string, ranges: TextRange[]): RegionDiagnosticsResult | undefined;
    /**
     * Gets suggestion diagnostics for a specific file. These diagnostics tend to
     * proactively suggest refactors, as opposed to diagnostics that indicate
     * potentially incorrect runtime behavior.
     *
     * @param fileName A path to the file you want semantic diagnostics for
     */
    getSuggestionDiagnostics(fileName: string): DiagnosticWithLocation[];
    // TODO: Rename this to getProgramDiagnostics to better indicate that these are any
    // diagnostics present for the program level, and not just 'options' diagnostics.
    /**
     * Gets global diagnostics related to the program configuration and compiler options.
     */
    getCompilerOptionsDiagnostics(): Diagnostic[];
    /** @deprecated Use getEncodedSyntacticClassifications instead. */
    getSyntacticClassifications(fileName: string, span: TextSpan): ClassifiedSpan[];
    getSyntacticClassifications(fileName: string, span: TextSpan, format: SemanticClassificationFormat): ClassifiedSpan[] | ClassifiedSpan2020[];
    /** @deprecated Use getEncodedSemanticClassifications instead. */
    getSemanticClassifications(fileName: string, span: TextSpan): ClassifiedSpan[];
    getSemanticClassifications(fileName: string, span: TextSpan, format: SemanticClassificationFormat): ClassifiedSpan[] | ClassifiedSpan2020[];
    /** Encoded as triples of [start, length, ClassificationType]. */
    getEncodedSyntacticClassifications(fileName: string, span: TextSpan): Classifications;
    /**
     * Gets semantic highlights information for a particular file. Has two formats, an older
     * version used by VS and a format used by VS Code.
     *
     * @param fileName The path to the file
     * @param position A text span to return results within
     * @param format Which format to use, defaults to "original"
     * @returns a number array encoded as triples of [start, length, ClassificationType, ...].
     */
    getEncodedSemanticClassifications(fileName: string, span: TextSpan, format?: SemanticClassificationFormat): Classifications;
    /**
     * Gets completion entries at a particular position in a file.
     *
     * @param fileName The path to the file
     * @param position A zero-based index of the character where you want the entries
     * @param options An object describing how the request was triggered and what kinds
     * of code actions can be returned with the completions.
     * @param formattingSettings settings needed for calling formatting functions.
     */
    getCompletionsAtPosition(fileName: string, position: number, options: GetCompletionsAtPositionOptions | undefined, formattingSettings?: FormatCodeSettings): WithMetadata<CompletionInfo> | undefined;
    /**
     * Gets the extended details for a completion entry retrieved from `getCompletionsAtPosition`.
     *
     * @param fileName The path to the file
     * @param position A zero based index of the character where you want the entries
     * @param entryName The `name` from an existing completion which came from `getCompletionsAtPosition`
     * @param formatOptions How should code samples in the completions be formatted, can be undefined for backwards compatibility
     * @param source `source` property from the completion entry
     * @param preferences User settings, can be undefined for backwards compatibility
     * @param data `data` property from the completion entry
     */
    getCompletionEntryDetails(fileName: string, position: number, entryName: string, formatOptions: FormatCodeOptions | FormatCodeSettings | undefined, source: string | undefined, preferences: UserPreferences | undefined, data: CompletionEntryData | undefined): CompletionEntryDetails | undefined;
    getCompletionEntrySymbol(fileName: string, position: number, name: string, source: string | undefined): Symbol | undefined;
    /**
     * Gets semantic information about the identifier at a particular position in a
     * file. Quick info is what you typically see when you hover in an editor.
     *
     * @param fileName The path to the file
     * @param position A zero-based index of the character where you want the quick info
     * @param maximumLength Maximum length of a quickinfo text before it is truncated.
     */
    getQuickInfoAtPosition(fileName: string, position: number, maximumLength?: number): QuickInfo | undefined;
    /** @internal */
    getQuickInfoAtPosition(fileName: string, position: number, maximumLength: number | undefined, verbosityLevel: number | undefined): QuickInfo | undefined;
    getNameOrDottedNameSpan(fileName: string, startPos: number, endPos: number): TextSpan | undefined;
    getBreakpointStatementAtPosition(fileName: string, position: number): TextSpan | undefined;
    getSignatureHelpItems(fileName: string, position: number, options: SignatureHelpItemsOptions | undefined): SignatureHelpItems | undefined;
    getRenameInfo(fileName: string, position: number, preferences: UserPreferences): RenameInfo;
    /** @deprecated Use the signature with `UserPreferences` instead. */
    getRenameInfo(fileName: string, position: number, options?: RenameInfoOptions): RenameInfo;
    findRenameLocations(fileName: string, position: number, findInStrings: boolean, findInComments: boolean, preferences: UserPreferences): readonly RenameLocation[] | undefined;
    /** @deprecated Pass `providePrefixAndSuffixTextForRename` as part of a `UserPreferences` parameter. */
    findRenameLocations(fileName: string, position: number, findInStrings: boolean, findInComments: boolean, providePrefixAndSuffixTextForRename?: boolean): readonly RenameLocation[] | undefined;
    getSmartSelectionRange(fileName: string, position: number): SelectionRange;
    /** @internal */
    getDefinitionAtPosition(fileName: string, position: number, searchOtherFilesOnly: false, stopAtAlias: boolean): readonly DefinitionInfo[] | undefined;
    /** @internal */
    getDefinitionAtPosition(fileName: string, position: number, searchOtherFilesOnly: boolean, stopAtAlias: false): readonly DefinitionInfo[] | undefined;
    getDefinitionAtPosition(fileName: string, position: number): readonly DefinitionInfo[] | undefined;
    getDefinitionAndBoundSpan(fileName: string, position: number): DefinitionInfoAndBoundSpan | undefined;
    getTypeDefinitionAtPosition(fileName: string, position: number): readonly DefinitionInfo[] | undefined;
    getImplementationAtPosition(fileName: string, position: number): readonly ImplementationLocation[] | undefined;
    getReferencesAtPosition(fileName: string, position: number): ReferenceEntry[] | undefined;
    findReferences(fileName: string, position: number): ReferencedSymbol[] | undefined;
    getDocumentHighlights(fileName: string, position: number, filesToSearch: string[]): DocumentHighlights[] | undefined;
    getFileReferences(fileName: string): ReferenceEntry[];
    getNavigateToItems(searchValue: string, maxResultCount?: number, fileName?: string, excludeDtsFiles?: boolean, excludeLibFiles?: boolean): NavigateToItem[];
    getNavigationBarItems(fileName: string): NavigationBarItem[];
    getNavigationTree(fileName: string): NavigationTree;
    prepareCallHierarchy(fileName: string, position: number): CallHierarchyItem | CallHierarchyItem[] | undefined;
    provideCallHierarchyIncomingCalls(fileName: string, position: number): CallHierarchyIncomingCall[];
    provideCallHierarchyOutgoingCalls(fileName: string, position: number): CallHierarchyOutgoingCall[];
    provideInlayHints(fileName: string, span: TextSpan, preferences: UserPreferences | undefined): InlayHint[];
    getOutliningSpans(fileName: string): OutliningSpan[];
    getTodoComments(fileName: string, descriptors: TodoCommentDescriptor[]): TodoComment[];
    getBraceMatchingAtPosition(fileName: string, position: number): TextSpan[];
    getIndentationAtPosition(fileName: string, position: number, options: EditorOptions | EditorSettings): number;
    getFormattingEditsForRange(fileName: string, start: number, end: number, options: FormatCodeOptions | FormatCodeSettings): TextChange[];
    getFormattingEditsForDocument(fileName: string, options: FormatCodeOptions | FormatCodeSettings): TextChange[];
    getFormattingEditsAfterKeystroke(fileName: string, position: number, key: string, options: FormatCodeOptions | FormatCodeSettings): TextChange[];
    getDocCommentTemplateAtPosition(fileName: string, position: number, options?: DocCommentTemplateOptions, formatOptions?: FormatCodeSettings): TextInsertion | undefined;
    isValidBraceCompletionAtPosition(fileName: string, position: number, openingBrace: number): boolean;
    /**
     * This will return a defined result if the position is after the `>` of the opening tag, or somewhere in the text, of a JSXElement with no closing tag.
     * Editors should call this after `>` is typed.
     */
    getJsxClosingTagAtPosition(fileName: string, position: number): JsxClosingTagInfo | undefined;
    getLinkedEditingRangeAtPosition(fileName: string, position: number): LinkedEditingInfo | undefined;
    getSpanOfEnclosingComment(fileName: string, position: number, onlyMultiLine: boolean): TextSpan | undefined;
    toLineColumnOffset?(fileName: string, position: number): LineAndCharacter;
    /** @internal */
    getSourceMapper(): SourceMapper;
    /** @internal */
    clearSourceMapperCache(): void;
    getCodeFixesAtPosition(fileName: string, start: number, end: number, errorCodes: readonly number[], formatOptions: FormatCodeSettings, preferences: UserPreferences): readonly CodeFixAction[];
    getCombinedCodeFix(scope: CombinedCodeFixScope, fixId: {}, formatOptions: FormatCodeSettings, preferences: UserPreferences): CombinedCodeActions;
    applyCodeActionCommand(action: CodeActionCommand, formatSettings?: FormatCodeSettings): Promise<ApplyCodeActionCommandResult>;
    applyCodeActionCommand(action: CodeActionCommand[], formatSettings?: FormatCodeSettings): Promise<ApplyCodeActionCommandResult[]>;
    applyCodeActionCommand(action: CodeActionCommand | CodeActionCommand[], formatSettings?: FormatCodeSettings): Promise<ApplyCodeActionCommandResult | ApplyCodeActionCommandResult[]>;
    /** @deprecated `fileName` will be ignored */
    applyCodeActionCommand(fileName: string, action: CodeActionCommand): Promise<ApplyCodeActionCommandResult>;
    /** @deprecated `fileName` will be ignored */
    applyCodeActionCommand(fileName: string, action: CodeActionCommand[]): Promise<ApplyCodeActionCommandResult[]>;
    /** @deprecated `fileName` will be ignored */
    applyCodeActionCommand(fileName: string, action: CodeActionCommand | CodeActionCommand[]): Promise<ApplyCodeActionCommandResult | ApplyCodeActionCommandResult[]>;
    /**
     * @param includeInteractiveActions Include refactor actions that require additional arguments to be
     * passed when calling `getEditsForRefactor`. When true, clients should inspect the `isInteractive`
     * property of each returned `RefactorActionInfo` and ensure they are able to collect the appropriate
     * arguments for any interactive action before offering it.
     */
    getApplicableRefactors(fileName: string, positionOrRange: number | TextRange, preferences: UserPreferences | undefined, triggerReason?: RefactorTriggerReason, kind?: string, includeInteractiveActions?: boolean): ApplicableRefactorInfo[];
    getEditsForRefactor(fileName: string, formatOptions: FormatCodeSettings, positionOrRange: number | TextRange, refactorName: string, actionName: string, preferences: UserPreferences | undefined, interactiveRefactorArguments?: InteractiveRefactorArguments): RefactorEditInfo | undefined;
    getMoveToRefactoringFileSuggestions(fileName: string, positionOrRange: number | TextRange, preferences: UserPreferences | undefined, triggerReason?: RefactorTriggerReason, kind?: string): {
        newFileName: string;
        files: string[];
    };
    organizeImports(args: OrganizeImportsArgs, formatOptions: FormatCodeSettings, preferences: UserPreferences | undefined): readonly FileTextChanges[];
    getEditsForFileRename(oldFilePath: string, newFilePath: string, formatOptions: FormatCodeSettings, preferences: UserPreferences | undefined): readonly FileTextChanges[];
    getEmitOutput(fileName: string, emitOnlyDtsFiles?: boolean, forceDtsEmit?: boolean): EmitOutput;
    getProgram(): Program | undefined;
    /** @internal */ getCurrentProgram(): Program | undefined;
    /** @internal */ getNonBoundSourceFile(fileName: string): SourceFile;
    /** @internal */ getAutoImportProvider(): Program | undefined;
    /// Returns true if a suitable symbol was found in the project.
    /// May set isDefinition properties in `referencedSymbols` to false.
    /// May add elements to `knownSymbolSpans`.
    /** @internal */ updateIsDefinitionOfReferencedSymbols(referencedSymbols: readonly ReferencedSymbol[], knownSymbolSpans: { has(value: DocumentSpan): boolean; add(value: DocumentSpan): void }): boolean;
    toggleLineComment(fileName: string, textRange: TextRange): TextChange[];
    toggleMultilineComment(fileName: string, textRange: TextRange): TextChange[];
    commentSelection(fileName: string, textRange: TextRange): TextChange[];
    uncommentSelection(fileName: string, textRange: TextRange): TextChange[];
    getSupportedCodeFixes(fileName?: string): readonly string[];
    /** @internal */ mapCode(fileName: string, contents: string[], focusLocations: TextSpan[][] | undefined, formatOptions: FormatCodeSettings, preferences: UserPreferences): readonly FileTextChanges[];
    dispose(): void;
    preparePasteEditsForFile(fileName: string, copiedTextRanges: TextRange[]): boolean;
    getPasteEdits(args: PasteEditsArgs, formatOptions: FormatCodeSettings): PasteEdits;
}
export interface JsxClosingTagInfo {
    newText: string;
}
export interface LinkedEditingInfo {
    ranges: TextSpan[];
    wordPattern?: string;
}
export interface CombinedCodeFixScope {
    type: "file";
    fileName: string;
}
export type OrganizeImportsMode = "All" | "SortAndCombine" | "RemoveUnused";
export const OrganizeImportsMode: {
    readonly All: "All";
    readonly SortAndCombine: "SortAndCombine";
    readonly RemoveUnused: "RemoveUnused";
} = {
    All: "All",
    SortAndCombine: "SortAndCombine",
    RemoveUnused: "RemoveUnused"
};
export interface PasteEdits {
    edits: readonly FileTextChanges[];
    fixId?: {};
}
export interface PasteEditsArgs {
    targetFile: string;
    pastedText: string[];
    pasteLocations: TextRange[];
    copiedFrom: {
        file: string;
        range: TextRange[];
    } | undefined;
    preferences: UserPreferences;
}
export interface OrganizeImportsArgs extends CombinedCodeFixScope {
    /** @deprecated Use `mode` instead */
    skipDestructiveCodeActions?: boolean;
    mode?: OrganizeImportsMode;
}
export type CompletionsTriggerCharacter = "." | '"' | "'" | "`" | "/" | "@" | "<" | "#" | " ";
export type CompletionTriggerKind = number;
export const CompletionTriggerKind: {
    readonly Invoked: 1;
    readonly TriggerCharacter: 2;
    readonly TriggerForIncompleteCompletions: 3;
    [index: number]: string;
} = {
    Invoked: 1,
    "1": "Invoked",
    TriggerCharacter: 2,
    "2": "TriggerCharacter",
    TriggerForIncompleteCompletions: 3,
    "3": "TriggerForIncompleteCompletions"
};
export interface GetCompletionsAtPositionOptions extends UserPreferences {
    /**
     * If the editor is asking for completions because a certain character was typed
     * (as opposed to when the user explicitly requested them) this should be set.
     */
    triggerCharacter?: CompletionsTriggerCharacter;
    triggerKind?: CompletionTriggerKind;
    /**
     * Include a `symbol` property on each completion entry object.
     * Symbols reference cyclic data structures and sometimes an entire TypeChecker instance,
     * so use caution when serializing or retaining completion entries retrieved with this option.
     * @default false
     */
    includeSymbol?: boolean;
    /** @deprecated Use includeCompletionsForModuleExports */
    includeExternalModuleExports?: boolean;
    /** @deprecated Use includeCompletionsWithInsertText */
    includeInsertTextCompletions?: boolean;
}
export type SignatureHelpTriggerCharacter = "," | "(" | "<";
export type SignatureHelpRetriggerCharacter = SignatureHelpTriggerCharacter | ")";
export interface SignatureHelpItemsOptions {
    triggerReason?: SignatureHelpTriggerReason;
}
export type SignatureHelpTriggerReason = SignatureHelpInvokedReason | SignatureHelpCharacterTypedReason | SignatureHelpRetriggeredReason;
/**
 * Signals that the user manually requested signature help.
 * The language service will unconditionally attempt to provide a result.
 */
export interface SignatureHelpInvokedReason {
    kind: "invoked";
    triggerCharacter?: undefined;
}
/**
 * Signals that the signature help request came from a user typing a character.
 * Depending on the character and the syntactic context, the request may or may not be served a result.
 */
export interface SignatureHelpCharacterTypedReason {
    kind: "characterTyped";
    /**
     * Character that was responsible for triggering signature help.
     */
    triggerCharacter: SignatureHelpTriggerCharacter;
}
/**
 * Signals that this signature help request came from typing a character or moving the cursor.
 * This should only occur if a signature help session was already active and the editor needs to see if it should adjust.
 * The language service will unconditionally attempt to provide a result.
 * `triggerCharacter` can be `undefined` for a retrigger caused by a cursor move.
 */
export interface SignatureHelpRetriggeredReason {
    kind: "retrigger";
    /**
     * Character that was responsible for triggering signature help.
     */
    triggerCharacter?: SignatureHelpRetriggerCharacter;
}
export interface ApplyCodeActionCommandResult {
    successMessage: string;
}
export interface Classifications {
    spans: number[];
    endOfLineState: EndOfLineState;
}
export interface ClassifiedSpan {
    textSpan: TextSpan;
    classificationType: ClassificationTypeNames;
}
export interface ClassifiedSpan2020 {
    textSpan: TextSpan;
    classificationType: number;
}
/**
 * Navigation bar interface designed for visual studio's dual-column layout.
 * This does not form a proper tree.
 * The navbar is returned as a list of top-level items, each of which has a list of child items.
 * Child items always have an empty array for their `childItems`.
 */
export interface NavigationBarItem {
    text: string;
    kind: ScriptElementKind;
    kindModifiers: string;
    spans: TextSpan[];
    childItems: NavigationBarItem[];
    indent: number;
    bolded: boolean;
    grayed: boolean;
}
/**
 * Node in a tree of nested declarations in a file.
 * The top node is always a script or module node.
 */
export interface NavigationTree {
    /** Name of the declaration, or a short description, e.g. "<class>". */
    text: string;
    kind: ScriptElementKind;
    /** ScriptElementKindModifier separated by commas, e.g. "public,abstract" */
    kindModifiers: string;
    /**
     * Spans of the nodes that generated this declaration.
     * There will be more than one if this is the result of merging.
     */
    spans: TextSpan[];
    nameSpan: TextSpan | undefined;
    /** Present if non-empty */
    childItems?: NavigationTree[];
}
export interface CallHierarchyItem {
    name: string;
    kind: ScriptElementKind;
    kindModifiers?: string;
    file: string;
    span: TextSpan;
    selectionSpan: TextSpan;
    containerName?: string;
}
export interface CallHierarchyIncomingCall {
    from: CallHierarchyItem;
    fromSpans: TextSpan[];
}
export interface CallHierarchyOutgoingCall {
    to: CallHierarchyItem;
    fromSpans: TextSpan[];
}
export type InlayHintKind = "Type" | "Parameter" | "Enum";
export const InlayHintKind: {
    readonly Type: "Type";
    readonly Parameter: "Parameter";
    readonly Enum: "Enum";
} = {
    Type: "Type",
    Parameter: "Parameter",
    Enum: "Enum"
};
export interface InlayHint {
    /** This property will be the empty string when displayParts is set. */
    text: string;
    position: number;
    kind: InlayHintKind;
    whitespaceBefore?: boolean;
    whitespaceAfter?: boolean;
    displayParts?: InlayHintDisplayPart[];
}
export interface InlayHintDisplayPart {
    text: string;
    span?: TextSpan;
    file?: string;
}
export interface TodoCommentDescriptor {
    text: string;
    priority: number;
}
export interface TodoComment {
    descriptor: TodoCommentDescriptor;
    message: string;
    position: number;
}
export interface TextChange {
    span: TextSpan;
    newText: string;
}
export interface FileTextChanges {
    fileName: string;
    textChanges: readonly TextChange[];
    isNewFile?: boolean;
}
export interface CodeAction {
    /** Description of the code action to display in the UI of the editor */
    description: string;
    /** Text changes to apply to each file as part of the code action */
    changes: FileTextChanges[];
    /**
     * If the user accepts the code fix, the editor should send the action back in a `applyAction` request.
     * This allows the language service to have side effects (e.g. installing dependencies) upon a code fix.
     */
    commands?: CodeActionCommand[];
}
export interface CodeFixAction extends CodeAction {
    /** Short name to identify the fix, for use by telemetry. */
    fixName: string;
    /**
     * If present, one may call 'getCombinedCodeFix' with this fixId.
     * This may be omitted to indicate that the code fix can't be applied in a group.
     */
    fixId?: {};
    fixAllDescription?: string;
}
export interface CombinedCodeActions {
    changes: readonly FileTextChanges[];
    commands?: readonly CodeActionCommand[];
}
// Publicly, this type is just `{}`. Internally it is a union of all the actions we use.
// See `commands?: {}[]` in protocol.ts
export type CodeActionCommand = InstallPackageAction;
export interface InstallPackageAction {
    /** @internal */ type: "install package";
    /** @internal */ file: string;
    /** @internal */ packageName: string;
}
/**
 * A set of one or more available refactoring actions, grouped under a parent refactoring.
 */
export interface ApplicableRefactorInfo {
    /**
     * The programmatic name of the refactoring
     */
    name: string;
    /**
     * A description of this refactoring category to show to the user.
     * If the refactoring gets inlined (see below), this text will not be visible.
     */
    description: string;
    /**
     * Inlineable refactorings can have their actions hoisted out to the top level
     * of a context menu. Non-inlineanable refactorings should always be shown inside
     * their parent grouping.
     *
     * If not specified, this value is assumed to be 'true'
     */
    inlineable?: boolean;
    actions: RefactorActionInfo[];
}
/**
 * Represents a single refactoring action - for example, the "Extract Method..." refactor might
 * offer several actions, each corresponding to a surround class or closure to extract into.
 */
export interface RefactorActionInfo {
    /**
     * The programmatic name of the refactoring action
     */
    name: string;
    /**
     * A description of this refactoring action to show to the user.
     * If the parent refactoring is inlined away, this will be the only text shown,
     * so this description should make sense by itself if the parent is inlineable=true
     */
    description: string;
    /**
     * A message to show to the user if the refactoring cannot be applied in
     * the current context.
     */
    notApplicableReason?: string;
    /**
     * The hierarchical dotted name of the refactor action.
     */
    kind?: string;
    /**
     * Indicates that the action requires additional arguments to be passed
     * when calling `getEditsForRefactor`.
     */
    isInteractive?: boolean;
    /**
     * Range of code the refactoring will be applied to.
     */
    range?: {
        start: {
            line: number;
            offset: number;
        };
        end: {
            line: number;
            offset: number;
        };
    };
}
/**
 * A set of edits to make in response to a refactor action, plus an optional
 * location where renaming should be invoked from
 */
export interface RefactorEditInfo {
    edits: FileTextChanges[];
    renameFilename?: string;
    renameLocation?: number;
    commands?: CodeActionCommand[];
    notApplicableReason?: string;
}
export type RefactorTriggerReason = "implicit" | "invoked";
export interface TextInsertion {
    newText: string;
    /** The position in newText the caret should point to after the insertion. */
    caretOffset: number;
}
export interface DocumentSpan {
    textSpan: TextSpan;
    fileName: string;
    /**
     * If the span represents a location that was remapped (e.g. via a .d.ts.map file),
     * then the original filename and span will be specified here
     */
    originalTextSpan?: TextSpan;
    originalFileName?: string;
    /**
     * If DocumentSpan.textSpan is the span for name of the declaration,
     * then this is the span for relevant declaration
     */
    contextSpan?: TextSpan;
    originalContextSpan?: TextSpan;
}
export interface RenameLocation extends DocumentSpan {
    prefixText?: string;
    suffixText?: string;
}
export interface ReferenceEntry extends DocumentSpan {
    isWriteAccess: boolean;
    isInString?: true;
}
export interface ImplementationLocation extends DocumentSpan {
    kind: ScriptElementKind;
    displayParts: SymbolDisplayPart[];
}
export type HighlightSpanKind = "none" | "definition" | "reference" | "writtenReference";
export const HighlightSpanKind: {
    readonly none: "none";
    readonly definition: "definition";
    readonly reference: "reference";
    readonly writtenReference: "writtenReference";
} = {
    none: "none",
    definition: "definition",
    reference: "reference",
    writtenReference: "writtenReference"
};
export interface HighlightSpan {
    fileName?: string;
    isInString?: true;
    textSpan: TextSpan;
    contextSpan?: TextSpan;
    kind: HighlightSpanKind;
}
export interface NavigateToItem {
    name: string;
    kind: ScriptElementKind;
    kindModifiers: string;
    matchKind: "exact" | "prefix" | "substring" | "camelCase";
    isCaseSensitive: boolean;
    fileName: string;
    textSpan: TextSpan;
    containerName: string;
    containerKind: ScriptElementKind;
}
export type IndentStyle = number;
export const IndentStyle: {
    readonly None: 0;
    readonly Block: 1;
    readonly Smart: 2;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    Block: 1,
    "1": "Block",
    Smart: 2,
    "2": "Smart"
};
export type SemicolonPreference = "ignore" | "insert" | "remove";
export const SemicolonPreference: {
    readonly Ignore: "ignore";
    readonly Insert: "insert";
    readonly Remove: "remove";
} = {
    Ignore: "ignore",
    Insert: "insert",
    Remove: "remove"
};
/** @deprecated - consider using EditorSettings instead */
export interface EditorOptions {
    BaseIndentSize?: number;
    IndentSize: number;
    TabSize: number;
    NewLineCharacter: string;
    ConvertTabsToSpaces: boolean;
    IndentStyle: IndentStyle;
}
// TODO: GH#18217 These are frequently asserted as defined
export interface EditorSettings {
    baseIndentSize?: number;
    indentSize?: number;
    tabSize?: number;
    newLineCharacter?: string;
    convertTabsToSpaces?: boolean;
    indentStyle?: IndentStyle;
    trimTrailingWhitespace?: boolean;
}
/** @deprecated - consider using FormatCodeSettings instead */
export interface FormatCodeOptions extends EditorOptions {
    InsertSpaceAfterCommaDelimiter: boolean;
    InsertSpaceAfterSemicolonInForStatements: boolean;
    InsertSpaceBeforeAndAfterBinaryOperators: boolean;
    InsertSpaceAfterConstructor?: boolean;
    InsertSpaceAfterKeywordsInControlFlowStatements: boolean;
    InsertSpaceAfterFunctionKeywordForAnonymousFunctions: boolean;
    InsertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: boolean;
    InsertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: boolean;
    InsertSpaceAfterOpeningAndBeforeClosingNonemptyBraces?: boolean;
    InsertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: boolean;
    InsertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces?: boolean;
    InsertSpaceAfterTypeAssertion?: boolean;
    InsertSpaceBeforeFunctionParenthesis?: boolean;
    PlaceOpenBraceOnNewLineForFunctions: boolean;
    PlaceOpenBraceOnNewLineForControlBlocks: boolean;
    insertSpaceBeforeTypeAnnotation?: boolean;
}
export interface FormatCodeSettings extends EditorSettings {
    insertSpaceAfterCommaDelimiter?: boolean;
    insertSpaceAfterSemicolonInForStatements?: boolean;
    insertSpaceBeforeAndAfterBinaryOperators?: boolean;
    insertSpaceAfterConstructor?: boolean;
    insertSpaceAfterKeywordsInControlFlowStatements?: boolean;
    insertSpaceAfterFunctionKeywordForAnonymousFunctions?: boolean;
    insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis?: boolean;
    insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets?: boolean;
    insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces?: boolean;
    insertSpaceAfterOpeningAndBeforeClosingEmptyBraces?: boolean;
    insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces?: boolean;
    insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces?: boolean;
    insertSpaceAfterTypeAssertion?: boolean;
    insertSpaceBeforeFunctionParenthesis?: boolean;
    placeOpenBraceOnNewLineForFunctions?: boolean;
    placeOpenBraceOnNewLineForControlBlocks?: boolean;
    insertSpaceBeforeTypeAnnotation?: boolean;
    indentMultiLineObjectLiteralBeginningOnBlankLine?: boolean;
    semicolons?: SemicolonPreference;
    indentSwitchCase?: boolean;
}
export function getDefaultFormatCodeSettings(newLineCharacter?: string): FormatCodeSettings {
    return {
        indentSize: 4,
        tabSize: 4,
        newLineCharacter: newLineCharacter || "\n",
        convertTabsToSpaces: true,
        indentStyle: IndentStyle.Smart,
        insertSpaceAfterConstructor: false,
        insertSpaceAfterCommaDelimiter: true,
        insertSpaceAfterSemicolonInForStatements: true,
        insertSpaceBeforeAndAfterBinaryOperators: true,
        insertSpaceAfterKeywordsInControlFlowStatements: true,
        insertSpaceAfterFunctionKeywordForAnonymousFunctions: false,
        insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
        insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
        insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
        insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: false,
        insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: false,
        insertSpaceBeforeFunctionParenthesis: false,
        placeOpenBraceOnNewLineForFunctions: false,
        placeOpenBraceOnNewLineForControlBlocks: false,
        semicolons: SemicolonPreference.Ignore,
        trimTrailingWhitespace: true,
        indentSwitchCase: true,
    };
}
/** @internal */
export const testFormatSettings: FormatCodeSettings = getDefaultFormatCodeSettings("\n");
export interface DefinitionInfo extends DocumentSpan {
    kind: ScriptElementKind;
    name: string;
    containerKind: ScriptElementKind | undefined;
    containerName: string | undefined;
    unverified?: boolean;
    /** @internal
     * Initially, this value is determined syntactically, but it is updated by the checker to cover
     * cases like declarations that are exported in subsequent statements.  As a result, the value
     * may be "incomplete" if this span has yet to be checked.
     */
    isLocal?: boolean;
    /** @internal */ isAmbient?: boolean;
    /** @internal */ failedAliasResolution?: boolean;
}
export interface DefinitionInfoAndBoundSpan {
    definitions?: readonly DefinitionInfo[];
    textSpan: TextSpan;
}
export interface ReferencedSymbolDefinitionInfo extends DefinitionInfo {
    displayParts: SymbolDisplayPart[];
}
export interface ReferencedSymbol {
    definition: ReferencedSymbolDefinitionInfo;
    references: ReferencedSymbolEntry[];
}
export interface ReferencedSymbolEntry extends ReferenceEntry {
    isDefinition?: boolean;
}
export type SymbolDisplayPartKind = number;
export const SymbolDisplayPartKind: {
    readonly aliasName: 0;
    readonly className: 1;
    readonly enumName: 2;
    readonly fieldName: 3;
    readonly interfaceName: 4;
    readonly keyword: 5;
    readonly lineBreak: 6;
    readonly numericLiteral: 7;
    readonly stringLiteral: 8;
    readonly localName: 9;
    readonly methodName: 10;
    readonly moduleName: 11;
    readonly operator: 12;
    readonly parameterName: 13;
    readonly propertyName: 14;
    readonly punctuation: 15;
    readonly space: 16;
    readonly text: 17;
    readonly typeParameterName: 18;
    readonly enumMemberName: 19;
    readonly functionName: 20;
    readonly regularExpressionLiteral: 21;
    readonly link: 22;
    readonly linkName: 23;
    readonly linkText: 24;
    [index: number]: string;
} = {
    aliasName: 0,
    "0": "aliasName",
    className: 1,
    "1": "className",
    enumName: 2,
    "2": "enumName",
    fieldName: 3,
    "3": "fieldName",
    interfaceName: 4,
    "4": "interfaceName",
    keyword: 5,
    "5": "keyword",
    lineBreak: 6,
    "6": "lineBreak",
    numericLiteral: 7,
    "7": "numericLiteral",
    stringLiteral: 8,
    "8": "stringLiteral",
    localName: 9,
    "9": "localName",
    methodName: 10,
    "10": "methodName",
    moduleName: 11,
    "11": "moduleName",
    operator: 12,
    "12": "operator",
    parameterName: 13,
    "13": "parameterName",
    propertyName: 14,
    "14": "propertyName",
    punctuation: 15,
    "15": "punctuation",
    space: 16,
    "16": "space",
    text: 17,
    "17": "text",
    typeParameterName: 18,
    "18": "typeParameterName",
    enumMemberName: 19,
    "19": "enumMemberName",
    functionName: 20,
    "20": "functionName",
    regularExpressionLiteral: 21,
    "21": "regularExpressionLiteral",
    link: 22,
    "22": "link",
    linkName: 23,
    "23": "linkName",
    linkText: 24,
    "24": "linkText"
};
export interface SymbolDisplayPart {
    /**
     * Text of an item describing the symbol.
     */
    text: string;
    /**
     * The symbol's kind (such as 'className' or 'parameterName' or plain 'text').
     */
    kind: string;
}
export interface JSDocLinkDisplayPart extends SymbolDisplayPart {
    target: DocumentSpan;
}
export interface JSDocTagInfo {
    name: string;
    text?: SymbolDisplayPart[];
}
export interface QuickInfo {
    kind: ScriptElementKind;
    kindModifiers: string;
    textSpan: TextSpan;
    displayParts?: SymbolDisplayPart[];
    documentation?: SymbolDisplayPart[];
    tags?: JSDocTagInfo[];
    canIncreaseVerbosityLevel?: boolean;
}
export type RenameInfo = RenameInfoSuccess | RenameInfoFailure;
export interface RenameInfoSuccess {
    canRename: true;
    /**
     * File or directory to rename.
     * If set, `getEditsForFileRename` should be called instead of `findRenameLocations`.
     */
    fileToRename?: string;
    displayName: string;
    /**
     * Full display name of item to be renamed.
     * If item to be renamed is a file, then this is the original text of the module specifer
     */
    fullDisplayName: string;
    kind: ScriptElementKind;
    kindModifiers: string;
    triggerSpan: TextSpan;
}
export interface RenameInfoFailure {
    canRename: false;
    localizedErrorMessage: string;
}
/**
 * @deprecated Use `UserPreferences` instead.
 */
export interface RenameInfoOptions {
    allowRenameOfImportPath?: boolean;
}
export interface DocCommentTemplateOptions {
    generateReturnInDocTemplate?: boolean;
}
export interface InteractiveRefactorArguments {
    targetFile: string;
}
/**
 * Signature help information for a single parameter
 */
export interface SignatureHelpParameter {
    name: string;
    documentation: SymbolDisplayPart[];
    displayParts: SymbolDisplayPart[];
    isOptional: boolean;
    isRest?: boolean;
}
export interface SelectionRange {
    textSpan: TextSpan;
    parent?: SelectionRange;
}
/**
 * Represents a single signature to show in signature help.
 * The id is used for subsequent calls into the language service to ask questions about the
 * signature help item in the context of any documents that have been updated.  i.e. after
 * an edit has happened, while signature help is still active, the host can ask important
 * questions like 'what parameter is the user currently contained within?'.
 */
export interface SignatureHelpItem {
    isVariadic: boolean;
    prefixDisplayParts: SymbolDisplayPart[];
    suffixDisplayParts: SymbolDisplayPart[];
    separatorDisplayParts: SymbolDisplayPart[];
    parameters: SignatureHelpParameter[];
    documentation: SymbolDisplayPart[];
    tags: JSDocTagInfo[];
}
/**
 * Represents a set of signature help items, and the preferred item that should be selected.
 */
export interface SignatureHelpItems {
    items: SignatureHelpItem[];
    applicableSpan: TextSpan;
    selectedItemIndex: number;
    argumentIndex: number;
    argumentCount: number;
}
// Do not change existing values, as they exist in telemetry.
export type CompletionInfoFlags = number;
// Do not change existing values, as they exist in telemetry.
export const CompletionInfoFlags: {
    readonly None: 0;
    readonly MayIncludeAutoImports: 1;
    readonly IsImportStatementCompletion: 2;
    readonly IsContinuation: 4;
    readonly ResolvedModuleSpecifiers: 8;
    readonly ResolvedModuleSpecifiersBeyondLimit: 16;
    readonly MayIncludeMethodSnippets: 32;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    MayIncludeAutoImports: 1,
    "1": "MayIncludeAutoImports",
    IsImportStatementCompletion: 2,
    "2": "IsImportStatementCompletion",
    IsContinuation: 4,
    "4": "IsContinuation",
    ResolvedModuleSpecifiers: 8,
    "8": "ResolvedModuleSpecifiers",
    ResolvedModuleSpecifiersBeyondLimit: 16,
    "16": "ResolvedModuleSpecifiersBeyondLimit",
    MayIncludeMethodSnippets: 32,
    "32": "MayIncludeMethodSnippets"
};
export interface CompletionInfo {
    /** For performance telemetry. */
    flags?: CompletionInfoFlags;
    /** Not true for all global completions. This will be true if the enclosing scope matches a few syntax kinds. See `isSnippetScope`. */
    isGlobalCompletion: boolean;
    isMemberCompletion: boolean;
    /**
     * In the absence of `CompletionEntry["replacementSpan"]`, the editor may choose whether to use
     * this span or its default one. If `CompletionEntry["replacementSpan"]` is defined, that span
     * must be used to commit that completion entry.
     */
    optionalReplacementSpan?: TextSpan;
    /**
     * true when the current location also allows for a new identifier
     */
    isNewIdentifierLocation: boolean;
    /**
     * Indicates to client to continue requesting completions on subsequent keystrokes.
     */
    isIncomplete?: (true) | undefined;
    entries: CompletionEntry[];
    /**
     * Default commit characters for the completion entries.
     */
    defaultCommitCharacters?: string[];
}
export interface CompletionEntryDataAutoImport {
    /**
     * The name of the property or export in the module's symbol table. Differs from the completion name
     * in the case of InternalSymbolName.ExportEquals and InternalSymbolName.Default.
     */
    exportName: string;
    exportMapKey?: ExportMapInfoKey;
    moduleSpecifier?: string;
    /** The file name declaring the export's module symbol, if it was an external module */
    fileName?: string;
    /** The module name (with quotes stripped) of the export's module symbol, if it was an ambient module */
    ambientModuleName?: string;
    /** True if the export was found in the package.json AutoImportProvider */
    isPackageJsonImport?: true;
}
export interface CompletionEntryDataUnresolved extends CompletionEntryDataAutoImport {
    exportMapKey: ExportMapInfoKey;
}
export interface CompletionEntryDataResolved extends CompletionEntryDataAutoImport {
    moduleSpecifier: string;
}
export type CompletionEntryData = CompletionEntryDataUnresolved | CompletionEntryDataResolved;
// see comments in protocol.ts
export interface CompletionEntry {
    name: string;
    kind: ScriptElementKind;
    kindModifiers?: string; // see ScriptElementKindModifier, comma separated
    /**
     * A string that is used for comparing completion items so that they can be ordered. This
     * is often the same as the name but may be different in certain circumstances.
     */
    sortText: string;
    /**
     * Text to insert instead of `name`.
     * This is used to support bracketed completions; If `name` might be "a-b" but `insertText` would be `["a-b"]`,
     * coupled with `replacementSpan` to replace a dotted access with a bracket access.
     */
    insertText?: string;
    /**
     * A string that should be used when filtering a set of
     * completion items.
     */
    filterText?: string;
    /**
     * `insertText` should be interpreted as a snippet if true.
     */
    isSnippet?: true;
    /**
     * An optional span that indicates the text to be replaced by this completion item.
     * If present, this span should be used instead of the default one.
     * It will be set if the required span differs from the one generated by the default replacement behavior.
     */
    replacementSpan?: TextSpan;
    /**
     * Indicates whether commiting this completion entry will require additional code actions to be
     * made to avoid errors. The CompletionEntryDetails will have these actions.
     */
    hasAction?: true;
    /**
     * Identifier (not necessarily human-readable) identifying where this completion came from.
     */
    source?: string;
    /**
     * Human-readable description of the `source`.
     */
    sourceDisplay?: SymbolDisplayPart[];
    /**
     * Additional details for the label.
     */
    labelDetails?: CompletionEntryLabelDetails;
    /**
     * If true, this completion should be highlighted as recommended. There will only be one of these.
     * This will be set when we know the user should write an expression with a certain type and that type is an enum or constructable class.
     * Then either that enum/class or a namespace containing it will be the recommended symbol.
     */
    isRecommended?: true;
    /**
     * If true, this completion was generated from traversing the name table of an unchecked JS file,
     * and therefore may not be accurate.
     */
    isFromUncheckedFile?: true;
    /**
     * If true, this completion was for an auto-import of a module not yet in the program, but listed
     * in the project package.json. Used for telemetry reporting.
     */
    isPackageJsonImport?: true;
    /**
     * If true, this completion was an auto-import-style completion of an import statement (i.e., the
     * module specifier was inserted along with the imported identifier). Used for telemetry reporting.
     */
    isImportStatementCompletion?: true;
    /**
     * For API purposes.
     * Included for non-string completions only when `includeSymbol: true` option is passed to `getCompletionsAtPosition`.
     * @example Get declaration of completion: `symbol.valueDeclaration`
     */
    symbol?: Symbol;
    /**
     * A property to be sent back to TS Server in the CompletionDetailsRequest, along with `name`,
     * that allows TS Server to look up the symbol represented by the completion item, disambiguating
     * items with the same name. Currently only defined for auto-import completions, but the type is
     * `unknown` in the protocol, so it can be changed as needed to support other kinds of completions.
     * The presence of this property should generally not be used to assume that this completion entry
     * is an auto-import.
     */
    data?: CompletionEntryData;
    /**
     * If this completion entry is selected, typing a commit character will cause the entry to be accepted.
     */
    commitCharacters?: string[];
}
export interface CompletionEntryLabelDetails {
    /**
     * An optional string which is rendered less prominently directly after
     * {@link CompletionEntry.name name}, without any spacing. Should be
     * used for function signatures or type annotations.
     */
    detail?: string;
    /**
     * An optional string which is rendered less prominently after
     * {@link CompletionEntryLabelDetails.detail}. Should be used for fully qualified
     * names or file path.
     */
    description?: string;
}
export interface CompletionEntryDetails {
    name: string;
    kind: ScriptElementKind;
    kindModifiers: string; // see ScriptElementKindModifier, comma separated
    displayParts: SymbolDisplayPart[];
    documentation?: SymbolDisplayPart[];
    tags?: JSDocTagInfo[];
    codeActions?: CodeAction[];
    /** @deprecated Use `sourceDisplay` instead. */
    source?: SymbolDisplayPart[];
    sourceDisplay?: SymbolDisplayPart[];
}
export interface OutliningSpan {
    /** The span of the document to actually collapse. */
    textSpan: TextSpan;
    /** The span of the document to display when the user hovers over the collapsed span. */
    hintSpan: TextSpan;
    /** The text to display in the editor for the collapsed region. */
    bannerText: string;
    /**
     * Whether or not this region should be automatically collapsed when
     * the 'Collapse to Definitions' command is invoked.
     */
    autoCollapse: boolean;
    /**
     * Classification of the contents of the span
     */
    kind: OutliningSpanKind;
}
export type OutliningSpanKind = "comment" | "region" | "code" | "imports";
export const OutliningSpanKind: {
    readonly Comment: "comment";
    readonly Region: "region";
    readonly Code: "code";
    readonly Imports: "imports";
} = {
    Comment: "comment",
    Region: "region",
    Code: "code",
    Imports: "imports"
};
export type OutputFileType = number;
export const OutputFileType: {
    readonly JavaScript: 0;
    readonly SourceMap: 1;
    readonly Declaration: 2;
    [index: number]: string;
} = {
    JavaScript: 0,
    "0": "JavaScript",
    SourceMap: 1,
    "1": "SourceMap",
    Declaration: 2,
    "2": "Declaration"
};
export type EndOfLineState = number;
export const EndOfLineState: {
    readonly None: 0;
    readonly InMultiLineCommentTrivia: 1;
    readonly InSingleQuoteStringLiteral: 2;
    readonly InDoubleQuoteStringLiteral: 3;
    readonly InTemplateHeadOrNoSubstitutionTemplate: 4;
    readonly InTemplateMiddleOrTail: 5;
    readonly InTemplateSubstitutionPosition: 6;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    InMultiLineCommentTrivia: 1,
    "1": "InMultiLineCommentTrivia",
    InSingleQuoteStringLiteral: 2,
    "2": "InSingleQuoteStringLiteral",
    InDoubleQuoteStringLiteral: 3,
    "3": "InDoubleQuoteStringLiteral",
    InTemplateHeadOrNoSubstitutionTemplate: 4,
    "4": "InTemplateHeadOrNoSubstitutionTemplate",
    InTemplateMiddleOrTail: 5,
    "5": "InTemplateMiddleOrTail",
    InTemplateSubstitutionPosition: 6,
    "6": "InTemplateSubstitutionPosition"
};
export type TokenClass = number;
export const TokenClass: {
    readonly Punctuation: 0;
    readonly Keyword: 1;
    readonly Operator: 2;
    readonly Comment: 3;
    readonly Whitespace: 4;
    readonly Identifier: 5;
    readonly NumberLiteral: 6;
    readonly BigIntLiteral: 7;
    readonly StringLiteral: 8;
    readonly RegExpLiteral: 9;
    [index: number]: string;
} = {
    Punctuation: 0,
    "0": "Punctuation",
    Keyword: 1,
    "1": "Keyword",
    Operator: 2,
    "2": "Operator",
    Comment: 3,
    "3": "Comment",
    Whitespace: 4,
    "4": "Whitespace",
    Identifier: 5,
    "5": "Identifier",
    NumberLiteral: 6,
    "6": "NumberLiteral",
    BigIntLiteral: 7,
    "7": "BigIntLiteral",
    StringLiteral: 8,
    "8": "StringLiteral",
    RegExpLiteral: 9,
    "9": "RegExpLiteral"
};
export interface ClassificationResult {
    finalLexState: EndOfLineState;
    entries: ClassificationInfo[];
}
export interface ClassificationInfo {
    length: number;
    classification: TokenClass;
}
export interface Classifier {
    /**
     * Gives lexical classifications of tokens on a line without any syntactic context.
     * For instance, a token consisting of the text 'string' can be either an identifier
     * named 'string' or the keyword 'string', however, because this classifier is not aware,
     * it relies on certain heuristics to give acceptable results. For classifications where
     * speed trumps accuracy, this function is preferable; however, for true accuracy, the
     * syntactic classifier is ideal. In fact, in certain editing scenarios, combining the
     * lexical, syntactic, and semantic classifiers may issue the best user experience.
     *
     * @param text                      The text of a line to classify.
     * @param lexState                  The state of the lexical classifier at the end of the previous line.
     * @param syntacticClassifierAbsent Whether the client is *not* using a syntactic classifier.
     *                                  If there is no syntactic classifier (syntacticClassifierAbsent=true),
     *                                  certain heuristics may be used in its place; however, if there is a
     *                                  syntactic classifier (syntacticClassifierAbsent=false), certain
     *                                  classifications which may be incorrectly categorized will be given
     *                                  back as Identifiers in order to allow the syntactic classifier to
     *                                  subsume the classification.
     * @deprecated Use getLexicalClassifications instead.
     */
    getClassificationsForLine(text: string, lexState: EndOfLineState, syntacticClassifierAbsent: boolean): ClassificationResult;
    getEncodedLexicalClassifications(text: string, endOfLineState: EndOfLineState, syntacticClassifierAbsent: boolean): Classifications;
}
export type ScriptElementKind = "" | "warning" | "keyword" | "script" | "module" | "class" | "local class" | "interface" | "type" | "enum" | "enum member" | "var" | "local var" | "using" | "await using" | "function" | "local function" | "method" | "getter" | "setter" | "property" | "accessor" | "constructor" | "call" | "index" | "construct" | "parameter" | "type parameter" | "primitive type" | "label" | "alias" | "const" | "let" | "directory" | "external module name" | "JSX attribute" | "string" | "link" | "link name" | "link text";
export const ScriptElementKind: {
    readonly unknown: "";
    readonly warning: "warning";
    readonly keyword: "keyword";
    readonly scriptElement: "script";
    readonly moduleElement: "module";
    readonly classElement: "class";
    readonly localClassElement: "local class";
    readonly interfaceElement: "interface";
    readonly typeElement: "type";
    readonly enumElement: "enum";
    readonly enumMemberElement: "enum member";
    readonly variableElement: "var";
    readonly localVariableElement: "local var";
    readonly variableUsingElement: "using";
    readonly variableAwaitUsingElement: "await using";
    readonly functionElement: "function";
    readonly localFunctionElement: "local function";
    readonly memberFunctionElement: "method";
    readonly memberGetAccessorElement: "getter";
    readonly memberSetAccessorElement: "setter";
    readonly memberVariableElement: "property";
    readonly memberAccessorVariableElement: "accessor";
    readonly constructorImplementationElement: "constructor";
    readonly callSignatureElement: "call";
    readonly indexSignatureElement: "index";
    readonly constructSignatureElement: "construct";
    readonly parameterElement: "parameter";
    readonly typeParameterElement: "type parameter";
    readonly primitiveType: "primitive type";
    readonly label: "label";
    readonly alias: "alias";
    readonly constElement: "const";
    readonly letElement: "let";
    readonly directory: "directory";
    readonly externalModuleName: "external module name";
    readonly jsxAttribute: "JSX attribute";
    readonly string: "string";
    readonly link: "link";
    readonly linkName: "link name";
    readonly linkText: "link text";
} = {
    unknown: "",
    warning: "warning",
    keyword: "keyword",
    scriptElement: "script",
    moduleElement: "module",
    classElement: "class",
    localClassElement: "local class",
    interfaceElement: "interface",
    typeElement: "type",
    enumElement: "enum",
    enumMemberElement: "enum member",
    variableElement: "var",
    localVariableElement: "local var",
    variableUsingElement: "using",
    variableAwaitUsingElement: "await using",
    functionElement: "function",
    localFunctionElement: "local function",
    memberFunctionElement: "method",
    memberGetAccessorElement: "getter",
    memberSetAccessorElement: "setter",
    memberVariableElement: "property",
    memberAccessorVariableElement: "accessor",
    constructorImplementationElement: "constructor",
    callSignatureElement: "call",
    indexSignatureElement: "index",
    constructSignatureElement: "construct",
    parameterElement: "parameter",
    typeParameterElement: "type parameter",
    primitiveType: "primitive type",
    label: "label",
    alias: "alias",
    constElement: "const",
    letElement: "let",
    directory: "directory",
    externalModuleName: "external module name",
    jsxAttribute: "JSX attribute",
    string: "string",
    link: "link",
    linkName: "link name",
    linkText: "link text"
};
export type ScriptElementKindModifier = "" | "public" | "private" | "protected" | "export" | "declare" | "static" | "abstract" | "optional" | "deprecated" | ".d.ts" | ".ts" | ".tsx" | ".js" | ".jsx" | ".json" | ".d.mts" | ".mts" | ".mjs" | ".d.cts" | ".cts" | ".cjs";
export const ScriptElementKindModifier: {
    readonly none: "";
    readonly publicMemberModifier: "public";
    readonly privateMemberModifier: "private";
    readonly protectedMemberModifier: "protected";
    readonly exportedModifier: "export";
    readonly ambientModifier: "declare";
    readonly staticModifier: "static";
    readonly abstractModifier: "abstract";
    readonly optionalModifier: "optional";
    readonly deprecatedModifier: "deprecated";
    readonly dtsModifier: ".d.ts";
    readonly tsModifier: ".ts";
    readonly tsxModifier: ".tsx";
    readonly jsModifier: ".js";
    readonly jsxModifier: ".jsx";
    readonly jsonModifier: ".json";
    readonly dmtsModifier: ".d.mts";
    readonly mtsModifier: ".mts";
    readonly mjsModifier: ".mjs";
    readonly dctsModifier: ".d.cts";
    readonly ctsModifier: ".cts";
    readonly cjsModifier: ".cjs";
} = {
    none: "",
    publicMemberModifier: "public",
    privateMemberModifier: "private",
    protectedMemberModifier: "protected",
    exportedModifier: "export",
    ambientModifier: "declare",
    staticModifier: "static",
    abstractModifier: "abstract",
    optionalModifier: "optional",
    deprecatedModifier: "deprecated",
    dtsModifier: ".d.ts",
    tsModifier: ".ts",
    tsxModifier: ".tsx",
    jsModifier: ".js",
    jsxModifier: ".jsx",
    jsonModifier: ".json",
    dmtsModifier: ".d.mts",
    mtsModifier: ".mts",
    mjsModifier: ".mjs",
    dctsModifier: ".d.cts",
    ctsModifier: ".cts",
    cjsModifier: ".cjs"
};
export type ClassificationTypeNames = "comment" | "identifier" | "keyword" | "number" | "bigint" | "operator" | "string" | "whitespace" | "text" | "punctuation" | "class name" | "enum name" | "interface name" | "module name" | "type parameter name" | "type alias name" | "parameter name" | "doc comment tag name" | "jsx open tag name" | "jsx close tag name" | "jsx self closing tag name" | "jsx attribute" | "jsx text" | "jsx attribute string literal value";
export const ClassificationTypeNames: {
    readonly comment: "comment";
    readonly identifier: "identifier";
    readonly keyword: "keyword";
    readonly numericLiteral: "number";
    readonly bigintLiteral: "bigint";
    readonly operator: "operator";
    readonly stringLiteral: "string";
    readonly whiteSpace: "whitespace";
    readonly text: "text";
    readonly punctuation: "punctuation";
    readonly className: "class name";
    readonly enumName: "enum name";
    readonly interfaceName: "interface name";
    readonly moduleName: "module name";
    readonly typeParameterName: "type parameter name";
    readonly typeAliasName: "type alias name";
    readonly parameterName: "parameter name";
    readonly docCommentTagName: "doc comment tag name";
    readonly jsxOpenTagName: "jsx open tag name";
    readonly jsxCloseTagName: "jsx close tag name";
    readonly jsxSelfClosingTagName: "jsx self closing tag name";
    readonly jsxAttribute: "jsx attribute";
    readonly jsxText: "jsx text";
    readonly jsxAttributeStringLiteralValue: "jsx attribute string literal value";
} = {
    comment: "comment",
    identifier: "identifier",
    keyword: "keyword",
    numericLiteral: "number",
    bigintLiteral: "bigint",
    operator: "operator",
    stringLiteral: "string",
    whiteSpace: "whitespace",
    text: "text",
    punctuation: "punctuation",
    className: "class name",
    enumName: "enum name",
    interfaceName: "interface name",
    moduleName: "module name",
    typeParameterName: "type parameter name",
    typeAliasName: "type alias name",
    parameterName: "parameter name",
    docCommentTagName: "doc comment tag name",
    jsxOpenTagName: "jsx open tag name",
    jsxCloseTagName: "jsx close tag name",
    jsxSelfClosingTagName: "jsx self closing tag name",
    jsxAttribute: "jsx attribute",
    jsxText: "jsx text",
    jsxAttributeStringLiteralValue: "jsx attribute string literal value"
};
export type ClassificationType = number;
export const ClassificationType: {
    readonly comment: 1;
    readonly identifier: 2;
    readonly keyword: 3;
    readonly numericLiteral: 4;
    readonly operator: 5;
    readonly stringLiteral: 6;
    readonly regularExpressionLiteral: 7;
    readonly whiteSpace: 8;
    readonly text: 9;
    readonly punctuation: 10;
    readonly className: 11;
    readonly enumName: 12;
    readonly interfaceName: 13;
    readonly moduleName: 14;
    readonly typeParameterName: 15;
    readonly typeAliasName: 16;
    readonly parameterName: 17;
    readonly docCommentTagName: 18;
    readonly jsxOpenTagName: 19;
    readonly jsxCloseTagName: 20;
    readonly jsxSelfClosingTagName: 21;
    readonly jsxAttribute: 22;
    readonly jsxText: 23;
    readonly jsxAttributeStringLiteralValue: 24;
    readonly bigintLiteral: 25;
    [index: number]: string;
} = {
    comment: 1,
    "1": "comment",
    identifier: 2,
    "2": "identifier",
    keyword: 3,
    "3": "keyword",
    numericLiteral: 4,
    "4": "numericLiteral",
    operator: 5,
    "5": "operator",
    stringLiteral: 6,
    "6": "stringLiteral",
    regularExpressionLiteral: 7,
    "7": "regularExpressionLiteral",
    whiteSpace: 8,
    "8": "whiteSpace",
    text: 9,
    "9": "text",
    punctuation: 10,
    "10": "punctuation",
    className: 11,
    "11": "className",
    enumName: 12,
    "12": "enumName",
    interfaceName: 13,
    "13": "interfaceName",
    moduleName: 14,
    "14": "moduleName",
    typeParameterName: 15,
    "15": "typeParameterName",
    typeAliasName: 16,
    "16": "typeAliasName",
    parameterName: 17,
    "17": "parameterName",
    docCommentTagName: 18,
    "18": "docCommentTagName",
    jsxOpenTagName: 19,
    "19": "jsxOpenTagName",
    jsxCloseTagName: 20,
    "20": "jsxCloseTagName",
    jsxSelfClosingTagName: 21,
    "21": "jsxSelfClosingTagName",
    jsxAttribute: 22,
    "22": "jsxAttribute",
    jsxText: 23,
    "23": "jsxText",
    jsxAttributeStringLiteralValue: 24,
    "24": "jsxAttributeStringLiteralValue",
    bigintLiteral: 25,
    "25": "bigintLiteral"
};
/** @internal */
export interface CodeFixRegistration {
    errorCodes: readonly number[];
    getCodeActions(context: CodeFixContext): CodeFixAction[] | undefined;
    fixIds?: readonly string[];
    getAllCodeActions?(context: CodeFixAllContext): CombinedCodeActions;
}
/** @internal */
export interface CodeFixContextBase extends textChanges.TextChangesContext {
    sourceFile: SourceFile;
    program: Program;
    cancellationToken: CancellationToken;
    preferences: UserPreferences;
}
/** @internal */
export interface CodeFixAllContext extends CodeFixContextBase {
    fixId: {};
}
/** @internal */
export interface CodeFixContext extends CodeFixContextBase {
    errorCode: number;
    span: TextSpan;
}
/** @internal */
export interface Refactor {
    /** List of action kinds a refactor can provide.
     * Used to skip unnecessary calculation when specific refactors are requested. */
    kinds?: string[];
    /** Compute the associated code actions */
    getEditsForAction(context: RefactorContext, actionName: string, interactiveRefactorArguments?: InteractiveRefactorArguments): RefactorEditInfo | undefined;
    /** Compute (quickly) which actions are available here */
    getAvailableActions(context: RefactorContext, includeInteractive?: boolean, interactiveRefactorArguments?: InteractiveRefactorArguments): readonly ApplicableRefactorInfo[];
}
/** @internal */
export interface RefactorContext extends textChanges.TextChangesContext {
    file: SourceFile;
    startPosition: number;
    endPosition?: number;
    program: Program;
    cancellationToken?: CancellationToken;
    preferences: UserPreferences;
    triggerReason?: RefactorTriggerReason;
    kind?: string;
}
export interface InlayHintsContext {
    file: SourceFile;
    program: Program;
    cancellationToken: CancellationToken;
    host: LanguageServiceHost;
    span: TextSpan;
    preferences: UserPreferences;
}

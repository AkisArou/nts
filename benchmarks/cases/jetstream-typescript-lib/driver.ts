/*
 * Copyright (C) 2025 Apple Inc. All rights reserved.
 * Copyright 2025 Google LLC
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

// Typed module bindings replace the released bundle's module loader.
import * as ts from "./source/typescript/typescript.ts";
import { dictionaryValue, present } from "./source/checked.ts";
import type { SourceFiles } from "./input.ts";
import type { TypeScriptConfiguration } from "./config.ts";

// The released benchmark replaces console.log with a no-op. Keep that binding local.
const console = { log(_value: unknown): void {} };
export interface CompileResult { diagnostics: string[]; resultFilesCount: number; }

const REPO_ROOT = "/User/test/JetStream/";

class CompilerHost implements ts.CompilerHost {
  declare options: ts.CompilerOptions;
  declare srcFileData: SourceFiles;
  declare outFileData: Record<string, unknown>;
  constructor(options: ts.CompilerOptions, srcFileData: SourceFiles) {
    this.options = options;
    this.srcFileData = srcFileData;
    this.outFileData = dictionaryValue(Object.create(null));
  }
  getSourceFile(fileName: string, languageVersion: ts.ScriptTarget | ts.CreateSourceFileOptions, onError?: (message: string) => void, shouldCreateNewSourceFile?: boolean): ts.SourceFile {
    const fileContent = this.readFile(fileName);
    return ts.createSourceFile(fileName, fileContent, languageVersion);
  }
  resolveModuleNames(moduleNames: string[], containingFile: string): (ts.ResolvedModule | undefined)[] {
    const resolvedModules: (ts.ResolvedModule | undefined)[] = [];
    for (const moduleName of moduleNames) {
      const result = ts.resolveModuleName(
        moduleName,
        containingFile,
        this.options,
        this
      );
      if (result.resolvedModule) {
        resolvedModules.push(result.resolvedModule);
      } else {
        resolvedModules.push(undefined);
      }
    }
    return resolvedModules;
  }
  getDefaultLibFileName(): string {
    return "lib.d.ts";
  }
  getCurrentDirectory(): string {
    return "";
  }
  getCanonicalFileName(fileName: string): string {
    return fileName.toLowerCase();
  }
  useCaseSensitiveFileNames(): boolean {
    return true;
  }
  getNewLine(): string {
    return "\n";
  }
  fileExists(filePath: string): boolean {
    return filePath in this.srcFileData;
  }
  readFile(filePath: string): string {
    const fileContent = this.srcFileData[filePath.toLowerCase()];
    if (fileContent === undefined) {
      throw new Error(`"${filePath}" does not exist.`);
    }
    return fileContent;
  }
  writeFile(fileName: string, data: string, writeByteOrderMark: boolean): void {
    this.outFileData[fileName] = data;
  }
}

export function compileTest(tsConfig: TypeScriptConfiguration, srcFileData: SourceFiles): CompileResult {
  const options = ts.convertCompilerOptionsFromJson(
    tsConfig.compilerOptions,
    REPO_ROOT
  ).options;
  options.lib = [...(options.lib || []), "dom"];
  const host = new CompilerHost(options, srcFileData);
  const program = ts.createProgram(Object.keys(srcFileData), options, host);
  const emitResult = program.emit();
  const diagnostics = formatDiagnostics(program, emitResult);
  return {
    diagnostics,
    resultFilesCount: Object.keys(host.outFileData).length,
  };
}

function formatDiagnostics(program: ts.Program, emitResult: ts.EmitResult): string[] {
  const allDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics);
  if (allDiagnostics.length > 0) {
    console.log(`Found ${allDiagnostics.length} errors:`);
  }
  const formattedDiagnostics = allDiagnostics.map((diagnostic) => {
    if (diagnostic.file) {
      const { line, character } = ts.getLineAndCharacterOfPosition(
        diagnostic.file,
        (diagnostic.start)!
      );
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n"
      );
      return `${diagnostic.file.fileName} (${line + 1},${
        character + 1
      }): ${message}`;
    } else {
      return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    }
  });
  formattedDiagnostics.slice(0, 20).map((each) => console.log(each));
  return formattedDiagnostics;
}

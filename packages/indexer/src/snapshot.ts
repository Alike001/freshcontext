import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';

import {
  Node,
  Project,
  SyntaxKind,
  type ArrowFunction,
  type DiagnosticMessageChain,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type Node as MorphNode,
  type Signature,
  type SourceFile,
} from 'ts-morph';

import type {
  CallEdgeSnapshot,
  ImportEdgeSnapshot,
  IndexedSymbolKind,
  RepositoryDescriptor,
  RepositorySnapshot,
  SkippedFile,
  SourceDiagnostic,
  SymbolSnapshot,
} from './types.js';

type SupportedNode = FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression;

interface IndexedSymbol extends SymbolSnapshot {
  readonly node: SupportedNode;
  readonly declarationKey: string;
}

const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 1_000;

export function buildRepositorySnapshot(
  repositoryId: string,
  descriptor: RepositoryDescriptor,
): RepositorySnapshot {
  if (repositoryId.length === 0 || repositoryId.trim() !== repositoryId) {
    throw new Error('repositoryId must be a non-empty value without surrounding whitespace');
  }

  const project = new Project({
    tsConfigFilePath: resolve(descriptor.rootPath, 'tsconfig.json'),
    skipFileDependencyResolution: false,
  });
  const trackedTypeScript = new Set(
    descriptor.trackedFiles.filter(isTypeScriptPath).map(normalizeRepositoryPath),
  );
  const projectFiles = new Map<string, SourceFile>();
  for (const sourceFile of project.getSourceFiles()) {
    const path = repositoryPath(descriptor.rootPath, sourceFile);
    if (path && trackedTypeScript.has(path)) {
      projectFiles.set(path, sourceFile);
    }
  }

  const diagnostics: SourceDiagnostic[] = [];
  const skippedFiles: SkippedFile[] = [];
  const indexableFiles = new Map<string, SourceFile>();
  for (const path of [...trackedTypeScript].sort(compareText)) {
    const sourceFile = projectFiles.get(path);
    if (!sourceFile) {
      skippedFiles.push({ path, reason: 'not-in-tsconfig', diagnosticCodes: [] });
      continue;
    }
    const fileDiagnostics = project.getProgram().getSyntacticDiagnostics(sourceFile);
    if (fileDiagnostics.length > 0) {
      const converted = fileDiagnostics.map((diagnostic) => ({
        code: diagnostic.getCode(),
        message: diagnosticMessage(diagnostic.getMessageText()),
        path,
        line: diagnostic.getLineNumber() ?? null,
      }));
      diagnostics.push(...converted);
      skippedFiles.push({
        path,
        reason: 'syntax-errors',
        diagnosticCodes: converted.map((diagnostic) => diagnostic.code),
      });
      continue;
    }
    indexableFiles.set(path, sourceFile);
  }

  const files = [...indexableFiles].map(([path, sourceFile]) => ({
    path,
    contentHash: hashText(sourceFile.getFullText()),
  }));
  const symbols = collectSymbols(indexableFiles);
  const symbolByDeclaration = new Map(
    symbols.map((symbol) => [symbol.declarationKey, symbol] as const),
  );
  const symbolByLogicalKey = new Map(symbols.map((symbol) => [symbol.key, symbol] as const));
  const imports: ImportEdgeSnapshot[] = [];
  let externalImportCount = 0;
  let unresolvedImportCount = 0;

  for (const [sourcePath, sourceFile] of indexableFiles) {
    for (const declaration of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = declaration.getModuleSpecifierValue();
      const targetFile = declaration.getModuleSpecifierSourceFile();
      if (!targetFile) {
        if (isExternalModuleSpecifier(moduleSpecifier)) {
          externalImportCount += 1;
        } else {
          unresolvedImportCount += 1;
        }
        continue;
      }
      const targetPath = repositoryPath(descriptor.rootPath, targetFile);
      if (!targetPath || !indexableFiles.has(targetPath)) {
        externalImportCount += 1;
        continue;
      }
      imports.push({ sourcePath, targetPath, moduleSpecifier });
    }
  }

  const calls: CallEdgeSnapshot[] = [];
  let unresolvedCallCount = 0;
  let externalCallCount = 0;
  let unsupportedInternalCallCount = 0;
  let callsOutsideSupportedSymbols = 0;
  const checker = project.getTypeChecker();

  for (const [path, sourceFile] of indexableFiles) {
    const fileSymbols = symbols.filter((symbol) => symbol.path === path);
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const caller = smallestContainingSymbol(fileSymbols, call);
      if (!caller) {
        callsOutsideSupportedSymbols += 1;
        continue;
      }
      const signature = checker.getResolvedSignature(call);
      if (!signature) {
        unresolvedCallCount += 1;
        continue;
      }
      const target = resolveTarget(
        descriptor.rootPath,
        signature,
        indexableFiles,
        symbolByDeclaration,
        symbolByLogicalKey,
      );
      if (target.kind === 'external') {
        externalCallCount += 1;
      } else if (target.kind === 'unsupported') {
        unsupportedInternalCallCount += 1;
      } else {
        calls.push({ callerKey: caller.key, calleeKey: target.symbol.key });
      }
    }
  }

  const uniqueImports = uniqueBy(
    imports,
    (edge) => `${edge.sourcePath}\0${edge.targetPath}\0${edge.moduleSpecifier}`,
  );
  const uniqueCalls = uniqueBy(calls, (edge) => `${edge.callerKey}\0${edge.calleeKey}`);
  const publicSymbols = symbols.map(toPublicSymbol);

  return {
    repositoryId,
    rootPath: descriptor.rootPath,
    commit: descriptor.commit,
    files: files.sort((left, right) => compareText(left.path, right.path)),
    symbols: publicSymbols.sort((left, right) => compareText(left.key, right.key)),
    imports: uniqueImports.sort(compareImport),
    calls: uniqueCalls.sort(compareCall),
    diagnostics: diagnostics.sort(compareDiagnostic),
    skippedFiles: skippedFiles.sort((left, right) => compareText(left.path, right.path)),
    statistics: {
      trackedTypeScriptFileCount: trackedTypeScript.size,
      indexedFileCount: files.length,
      skippedFileCount: skippedFiles.length,
      symbolCount: publicSymbols.length,
      importEdgeCount: uniqueImports.length,
      externalImportCount,
      unresolvedImportCount,
      callEdgeCount: uniqueCalls.length,
      unresolvedCallCount,
      externalCallCount,
      unsupportedInternalCallCount,
      callsOutsideSupportedSymbols,
      syntacticDiagnosticCount: diagnostics.length,
    },
  };
}

function collectSymbols(files: ReadonlyMap<string, SourceFile>): IndexedSymbol[] {
  const symbols: IndexedSymbol[] = [];
  for (const [path, sourceFile] of files) {
    const nodes: SupportedNode[] = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration).filter(hasFunctionBody),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration).filter(hasMethodBody),
      ...sourceFile
        .getDescendantsOfKind(SyntaxKind.ArrowFunction)
        .filter((node) => directVariableName(node) !== undefined),
      ...sourceFile
        .getDescendantsOfKind(SyntaxKind.FunctionExpression)
        .filter((node) => directVariableName(node) !== undefined || node.getName() !== undefined),
    ];
    for (const node of nodes) {
      const qualifiedName = qualifiedSymbolName(node);
      if (!qualifiedName) {
        continue;
      }
      const kind = symbolKind(node);
      symbols.push({
        node,
        declarationKey: declarationKey(path, node),
        key: `${path}::${qualifiedName}`,
        path,
        qualifiedName,
        kind,
        sourceHash: hashText(node.getText()),
        startLine: node.getStartLineNumber(),
        endLine: node.getEndLineNumber(),
      });
    }
  }
  return uniqueBy(symbols, (symbol) => symbol.key).sort((left, right) =>
    compareText(left.key, right.key),
  );
}

function toPublicSymbol(symbol: IndexedSymbol): SymbolSnapshot {
  return Object.freeze({
    key: symbol.key,
    path: symbol.path,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind,
    sourceHash: symbol.sourceHash,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
  });
}

function resolveTarget(
  rootPath: string,
  signature: Signature,
  files: ReadonlyMap<string, SourceFile>,
  byDeclaration: ReadonlyMap<string, IndexedSymbol>,
  byLogicalKey: ReadonlyMap<string, IndexedSymbol>,
):
  | { readonly kind: 'resolved'; readonly symbol: IndexedSymbol }
  | { readonly kind: 'external' }
  | { readonly kind: 'unsupported' } {
  const declaration = signature.getDeclaration();
  const path = repositoryPath(rootPath, declaration.getSourceFile());
  if (!path || !files.has(path)) {
    return { kind: 'external' };
  }
  const exact = byDeclaration.get(declarationKey(path, declaration));
  if (exact) {
    return { kind: 'resolved', symbol: exact };
  }
  if (isSupportedNode(declaration)) {
    const qualifiedName = qualifiedSymbolName(declaration);
    if (qualifiedName) {
      const logical = byLogicalKey.get(`${path}::${qualifiedName}`);
      if (logical) {
        return { kind: 'resolved', symbol: logical };
      }
    }
  }
  return { kind: 'unsupported' };
}

function smallestContainingSymbol(
  symbols: readonly IndexedSymbol[],
  node: MorphNode,
): IndexedSymbol | undefined {
  return symbols
    .filter(
      (symbol) =>
        symbol.node.getStart() <= node.getStart() && symbol.node.getEnd() >= node.getEnd(),
    )
    .sort((left, right) => span(left.node) - span(right.node))[0];
}

function qualifiedSymbolName(node: SupportedNode): string | undefined {
  const ownName = symbolName(node);
  if (!ownName) {
    return undefined;
  }
  const owners: string[] = [];
  for (const ancestor of node.getAncestors().reverse()) {
    if (Node.isClassDeclaration(ancestor) || Node.isModuleDeclaration(ancestor)) {
      const name = ancestor.getName();
      if (name) {
        owners.push(name);
      }
      continue;
    }
    if (isSupportedNode(ancestor)) {
      const name = symbolName(ancestor);
      if (name) {
        owners.push(name);
      }
      continue;
    }
    if (
      Node.isVariableDeclaration(ancestor) &&
      Node.isObjectLiteralExpression(ancestor.getInitializer())
    ) {
      owners.push(ancestor.getName());
    }
  }
  return [...owners, ownName].join('.');
}

function symbolName(node: SupportedNode): string | undefined {
  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
    return node.getName();
  }
  if (Node.isFunctionExpression(node) && node.getName()) {
    return node.getName();
  }
  return directVariableName(node);
}

function directVariableName(node: ArrowFunction | FunctionExpression): string | undefined {
  const parent = node.getParent();
  return Node.isVariableDeclaration(parent) && parent.getInitializer() === node
    ? parent.getName()
    : undefined;
}

function symbolKind(node: SupportedNode): IndexedSymbolKind {
  if (Node.isFunctionDeclaration(node)) return 'function';
  if (Node.isMethodDeclaration(node)) return 'method';
  if (Node.isArrowFunction(node)) return 'arrow-function';
  return 'function-expression';
}

function hasFunctionBody(node: FunctionDeclaration): boolean {
  return node.getBody() !== undefined;
}

function hasMethodBody(node: MethodDeclaration): boolean {
  return node.getBody() !== undefined;
}

function isSupportedNode(node: MorphNode): node is SupportedNode {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node)
  );
}

function declarationKey(path: string, node: MorphNode): string {
  return `${path}:${node.getStart()}:${node.getEnd()}:${node.getKind()}`;
}

function repositoryPath(rootPath: string, sourceFile: SourceFile): string | undefined {
  const path = relative(rootPath, sourceFile.getFilePath());
  if (path.length === 0 || path === '..' || path.startsWith(`..${sep}`)) {
    return undefined;
  }
  return normalizeRepositoryPath(path);
}

function normalizeRepositoryPath(path: string): string {
  return path.split(sep).join('/');
}

function hashText(text: string): string {
  return createHash('sha256').update(text.replaceAll('\r\n', '\n'), 'utf8').digest('hex');
}

function diagnosticMessage(message: string | DiagnosticMessageChain): string {
  if (typeof message === 'string') {
    return message.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH);
  }
  const next = message.getNext() ?? [];
  return [message.getMessageText(), ...next.map(diagnosticMessage)]
    .join('\n')
    .slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH);
}

function span(node: MorphNode): number {
  return node.getEnd() - node.getStart();
}

function isTypeScriptPath(path: string): boolean {
  return (path.endsWith('.ts') || path.endsWith('.tsx')) && !path.endsWith('.d.ts');
}

function isExternalModuleSpecifier(moduleSpecifier: string): boolean {
  return !moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/');
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const unique = new Map<string, T>();
  for (const value of values) {
    unique.set(key(value), value);
  }
  return [...unique.values()];
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function compareImport(left: ImportEdgeSnapshot, right: ImportEdgeSnapshot): number {
  return compareText(
    `${left.sourcePath}\0${left.targetPath}\0${left.moduleSpecifier}`,
    `${right.sourcePath}\0${right.targetPath}\0${right.moduleSpecifier}`,
  );
}

function compareCall(left: CallEdgeSnapshot, right: CallEdgeSnapshot): number {
  return compareText(
    `${left.callerKey}\0${left.calleeKey}`,
    `${right.callerKey}\0${right.calleeKey}`,
  );
}

function compareDiagnostic(left: SourceDiagnostic, right: SourceDiagnostic): number {
  return compareText(
    `${left.path}\0${left.line ?? 0}\0${left.code}`,
    `${right.path}\0${right.line ?? 0}\0${right.code}`,
  );
}

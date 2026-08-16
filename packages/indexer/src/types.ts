export type IndexedSymbolKind = 'function' | 'method' | 'arrow-function' | 'function-expression';

export interface CommitSnapshot {
  readonly sha: string;
  readonly parentShas: readonly string[];
  readonly committedAt: string;
}

export interface SourceDiagnostic {
  readonly code: number;
  readonly message: string;
  readonly path: string;
  readonly line: number | null;
}

export interface SkippedFile {
  readonly path: string;
  readonly reason: 'not-in-tsconfig' | 'syntax-errors';
  readonly diagnosticCodes: readonly number[];
}

export interface FileSnapshot {
  readonly path: string;
  readonly contentHash: string;
}

export interface SymbolSnapshot {
  readonly key: string;
  readonly path: string;
  readonly qualifiedName: string;
  readonly kind: IndexedSymbolKind;
  readonly sourceHash: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface ImportEdgeSnapshot {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly moduleSpecifier: string;
}

export interface CallEdgeSnapshot {
  readonly callerKey: string;
  readonly calleeKey: string;
}

export interface IndexStatistics {
  readonly trackedTypeScriptFileCount: number;
  readonly indexedFileCount: number;
  readonly skippedFileCount: number;
  readonly symbolCount: number;
  readonly importEdgeCount: number;
  readonly externalImportCount: number;
  readonly unresolvedImportCount: number;
  readonly callEdgeCount: number;
  readonly unresolvedCallCount: number;
  readonly externalCallCount: number;
  readonly unsupportedInternalCallCount: number;
  readonly callsOutsideSupportedSymbols: number;
  readonly syntacticDiagnosticCount: number;
}

export interface RepositorySnapshot {
  readonly repositoryId: string;
  readonly rootPath: string;
  readonly commit: CommitSnapshot;
  readonly files: readonly FileSnapshot[];
  readonly symbols: readonly SymbolSnapshot[];
  readonly imports: readonly ImportEdgeSnapshot[];
  readonly calls: readonly CallEdgeSnapshot[];
  readonly diagnostics: readonly SourceDiagnostic[];
  readonly skippedFiles: readonly SkippedFile[];
  readonly statistics: IndexStatistics;
}

export interface RepositoryDescriptor {
  readonly rootPath: string;
  readonly commit: CommitSnapshot;
  readonly trackedFiles: readonly string[];
}

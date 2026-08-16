import {
  createImmutableEntity,
  createImmutableRelationship,
  entityKeys,
  type ImmutableEntity,
  type ImmutableRelationship,
  type JsonObject,
} from '@freshcontext/graph';

import type { RepositorySnapshot } from './types.js';

const MAX_RECORDED_SKIPPED_FILES = 100;
const MAX_RECORDED_DIAGNOSTICS = 50;

export interface RepositoryGraphPlan {
  readonly content: readonly ImmutableRelationship[];
  readonly completion: readonly ImmutableRelationship[];
}

export function createRepositoryGraphPlan(snapshot: RepositorySnapshot): RepositoryGraphPlan {
  const root = createImmutableEntity('GraphRoot', entityKeys.graphRoot(), { version: 1 });
  const repository = createImmutableEntity(
    'Repository',
    entityKeys.repository(snapshot.repositoryId),
    { repositoryId: snapshot.repositoryId },
  );
  const commit = createImmutableEntity(
    'Commit',
    entityKeys.commit(snapshot.repositoryId, snapshot.commit.sha),
    {
      sha: snapshot.commit.sha,
      parentShas: snapshot.commit.parentShas,
      committedAt: snapshot.commit.committedAt,
    },
  );
  const content: ImmutableRelationship[] = [
    createImmutableRelationship('ROOT_HAS_REPOSITORY', root, repository),
    createImmutableRelationship('HAS_COMMIT', repository, commit),
  ];
  const fileEntities = new Map<string, { stable: ImmutableEntity; revision: ImmutableEntity }>();
  const symbolEntities = new Map<string, { stable: ImmutableEntity; revision: ImmutableEntity }>();

  for (const file of snapshot.files) {
    const stable = createImmutableEntity(
      'File',
      entityKeys.file(snapshot.repositoryId, file.path),
      {
        path: file.path,
        language: file.path.endsWith('.tsx') ? 'tsx' : 'typescript',
      },
    );
    const revision = createImmutableEntity(
      'FileRevision',
      entityKeys.fileRevision(snapshot.repositoryId, snapshot.commit.sha, file.path),
      { path: file.path, commitSha: snapshot.commit.sha, contentHash: file.contentHash },
    );
    fileEntities.set(file.path, { stable, revision });
    content.push(
      createImmutableRelationship('HAS_FILE', repository, stable),
      createImmutableRelationship('HAS_FILE_REVISION', commit, revision),
      createImmutableRelationship('HAS_REVISION', stable, revision),
    );
  }

  for (const symbol of snapshot.symbols) {
    const file = requiredMapValue(fileEntities, symbol.path, 'file');
    const stable = createImmutableEntity(
      'Symbol',
      entityKeys.symbol(snapshot.repositoryId, symbol.path, symbol.qualifiedName),
      { path: symbol.path, qualifiedName: symbol.qualifiedName, symbolKind: symbol.kind },
    );
    const revision = createImmutableEntity(
      'SymbolRevision',
      entityKeys.symbolRevision(
        snapshot.repositoryId,
        snapshot.commit.sha,
        symbol.path,
        symbol.qualifiedName,
      ),
      {
        path: symbol.path,
        qualifiedName: symbol.qualifiedName,
        symbolKind: symbol.kind,
        commitSha: snapshot.commit.sha,
        sourceHash: symbol.sourceHash,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
      },
    );
    symbolEntities.set(symbol.key, { stable, revision });
    content.push(
      createImmutableRelationship('DECLARES', file.revision, revision),
      createImmutableRelationship('HAS_REVISION', stable, revision),
      createImmutableRelationship('REVISION_OF', revision, stable),
    );
  }

  for (const edge of snapshot.imports) {
    const source = requiredMapValue(fileEntities, edge.sourcePath, 'import source').revision;
    const target = requiredMapValue(fileEntities, edge.targetPath, 'import target').revision;
    content.push(createImmutableRelationship('IMPORTS', source, target, {}, edge.moduleSpecifier));
  }
  for (const edge of snapshot.calls) {
    const source = requiredMapValue(symbolEntities, edge.callerKey, 'call source').revision;
    const target = requiredMapValue(symbolEntities, edge.calleeKey, 'call target').revision;
    content.push(createImmutableRelationship('CALLS', source, target));
  }

  const indexRun = createImmutableEntity(
    'IndexRun',
    entityKeys.indexRun(snapshot.repositoryId, snapshot.commit.sha),
    indexRunProperties(snapshot),
  );
  const completion = [
    createImmutableRelationship('HAS_INDEX_RUN', repository, indexRun),
    createImmutableRelationship('REFERS_TO', indexRun, commit, {}, 'indexed-commit'),
  ];

  return {
    content: uniqueRelationships(content),
    completion: uniqueRelationships(completion),
  };
}

function indexRunProperties(snapshot: RepositorySnapshot): JsonObject {
  const skippedFiles = snapshot.skippedFiles.slice(0, MAX_RECORDED_SKIPPED_FILES);
  const diagnostics = snapshot.diagnostics.slice(0, MAX_RECORDED_DIAGNOSTICS);
  return {
    repositoryId: snapshot.repositoryId,
    commitSha: snapshot.commit.sha,
    state: 'complete',
    statistics: { ...snapshot.statistics },
    skippedFiles: skippedFiles.map((file) => ({
      path: file.path,
      reason: file.reason,
      diagnosticCodes: file.diagnosticCodes,
    })),
    skippedFilesTruncated: snapshot.skippedFiles.length - skippedFiles.length,
    diagnostics: diagnostics.map((diagnostic) => ({
      path: diagnostic.path,
      line: diagnostic.line,
      code: diagnostic.code,
      message: diagnostic.message,
    })),
    diagnosticsTruncated: snapshot.diagnostics.length - diagnostics.length,
  };
}

function uniqueRelationships(
  relationships: readonly ImmutableRelationship[],
): ImmutableRelationship[] {
  const unique = new Map<number, ImmutableRelationship>();
  for (const relationship of relationships) {
    const existing = unique.get(relationship.id);
    if (existing && existing.payloadHash !== relationship.payloadHash) {
      throw new Error(`Relationship id collision inside graph plan: ${relationship.id}`);
    }
    unique.set(relationship.id, relationship);
  }
  return [...unique.values()].sort((left, right) => left.id - right.id);
}

function requiredMapValue<T>(values: ReadonlyMap<string, T>, key: string, kind: string): T {
  const value = values.get(key);
  if (!value) {
    throw new Error(`Missing ${kind} ${key} while building repository graph`);
  }
  return value;
}

import { describe, expect, it } from 'vitest';

import { classifySymbolChanges } from '../src/change.js';
import type { SymbolSnapshot } from '../src/types.js';

describe('symbol change classification', () => {
  it('classifies added, changed, and removed symbols while ignoring line movement', () => {
    const unchanged = symbol('src/a.ts', 'unchanged', 'hash-1', 1);
    const changed = symbol('src/a.ts', 'changed', 'hash-2', 5);
    const removed = symbol('src/a.ts', 'removed', 'hash-3', 9);
    const result = classifySymbolChanges(
      [unchanged, changed, removed],
      [
        { ...unchanged, startLine: 20, endLine: 22 },
        { ...changed, sourceHash: 'hash-2-next' },
        symbol('src/a.ts', 'added', 'hash-4', 30),
      ],
    );

    expect(result.map((change) => [change.key, change.kind])).toEqual([
      ['src/a.ts::added', 'added'],
      ['src/a.ts::changed', 'changed'],
      ['src/a.ts::removed', 'removed'],
    ]);
  });

  it('rejects duplicate or malformed stable keys', () => {
    const duplicate = symbol('src/a.ts', 'same', 'hash', 1);
    expect(() => classifySymbolChanges([duplicate, duplicate], [])).toThrow(/Duplicate before/u);
    expect(() => classifySymbolChanges([{ ...duplicate, key: 'wrong' }], [])).toThrow(
      /does not match/u,
    );
  });
});

function symbol(
  path: string,
  qualifiedName: string,
  sourceHash: string,
  startLine: number,
): SymbolSnapshot {
  return {
    key: `${path}::${qualifiedName}`,
    path,
    qualifiedName,
    kind: 'function',
    sourceHash,
    startLine,
    endLine: startLine + 2,
  };
}

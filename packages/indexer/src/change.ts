import type { SymbolSnapshot } from './types.js';

export type SymbolChangeKind = 'added' | 'changed' | 'removed';

export interface SymbolChange {
  readonly key: string;
  readonly kind: SymbolChangeKind;
  readonly before: SymbolSnapshot | null;
  readonly after: SymbolSnapshot | null;
}

export function classifySymbolChanges(
  before: readonly SymbolSnapshot[],
  after: readonly SymbolSnapshot[],
): SymbolChange[] {
  const beforeByKey = uniqueSymbols(before, 'before');
  const afterByKey = uniqueSymbols(after, 'after');
  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const changes: SymbolChange[] = [];

  for (const key of [...keys].sort(compareText)) {
    const previous = beforeByKey.get(key);
    const next = afterByKey.get(key);
    if (!previous && next) {
      changes.push({ key, kind: 'added', before: null, after: next });
    } else if (previous && !next) {
      changes.push({ key, kind: 'removed', before: previous, after: null });
    } else if (previous && next && hasMeaningfulChange(previous, next)) {
      changes.push({ key, kind: 'changed', before: previous, after: next });
    }
  }

  return changes;
}

function uniqueSymbols(
  symbols: readonly SymbolSnapshot[],
  side: 'before' | 'after',
): ReadonlyMap<string, SymbolSnapshot> {
  const byKey = new Map<string, SymbolSnapshot>();
  for (const symbol of symbols) {
    if (byKey.has(symbol.key)) {
      throw new Error(`Duplicate ${side} symbol key ${symbol.key}`);
    }
    if (`${symbol.path}::${symbol.qualifiedName}` !== symbol.key) {
      throw new Error(`Symbol key ${symbol.key} does not match its path and qualified name`);
    }
    byKey.set(symbol.key, symbol);
  }
  return byKey;
}

function hasMeaningfulChange(before: SymbolSnapshot, after: SymbolSnapshot): boolean {
  return before.kind !== after.kind || before.sourceHash !== after.sourceHash;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

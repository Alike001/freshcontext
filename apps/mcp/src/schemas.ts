import { z } from 'zod';

const printable = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value.trim() === value, 'must not have surrounding whitespace')
    .refine((value) => !hasControlCharacters(value), 'must contain printable text');

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

const repositoryId = printable(200);
const commitSha = z.string().regex(/^[a-f0-9]{40,64}$/u, 'must be a full Git object id');
const evidenceReference = z.strictObject({
  path: printable(1_000).refine(
    (value) => !value.startsWith('/') && !value.split('/').includes('..'),
    'must be repository-relative',
  ),
  qualifiedName: printable(500),
});

export const rememberInputSchema = z.strictObject({
  repositoryId,
  commitSha,
  claim: printable(2_000),
  evidence: z.array(evidenceReference).min(1).max(10),
});

export const recallInputSchema = z.strictObject({
  repositoryId,
  commitSha,
  path: evidenceReference.shape.path,
  qualifiedName: evidenceReference.shape.qualifiedName,
});

export const statusInputSchema = z.strictObject({ repositoryId });

const memoryStateSchema = z.enum(['pending', 'current', 'needs_review', 'superseded']);
const memoryRecordSchema = z.strictObject({
  memoryId: z.string(),
  claim: z.string(),
  repositoryId: z.string(),
  sourceCommit: z.string(),
  createdAt: z.string(),
  state: memoryStateSchema,
  evidence: z.array(evidenceReference),
});

export const rememberOutputSchema = memoryRecordSchema;

const unavailableSchema = z.strictObject({
  status: z.literal('context_unavailable'),
  message: z.string(),
});

export const recallOutputSchema = z.strictObject({
  result: z.union([
    z.strictObject({
      status: z.literal('ready'),
      repositoryId: z.string(),
      indexedCommit: z.string(),
      context: evidenceReference,
      memories: z.array(memoryRecordSchema),
      withheldCount: z.number().int().nonnegative(),
      withheldMemoryIds: z.array(z.string()),
      abstained: z.boolean(),
      abstentionReason: z.enum(['no_memory', 'all_matching_memory_unsafe']).nullable(),
    }),
    unavailableSchema,
  ]),
});

export const statusOutputSchema = z.strictObject({
  result: z.union([
    z.strictObject({
      status: z.literal('ready'),
      repositoryId: z.string(),
      indexed: z.boolean(),
      indexedCommit: z.string().nullable(),
      statistics: z.record(z.string(), z.number().int()).nullable(),
    }),
    unavailableSchema,
  ]),
});

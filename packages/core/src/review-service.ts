import { createHash } from 'node:crypto';

import {
  createImmutableEntity,
  createImmutableRelationship,
  entityKeys,
  type HydraQueryGateway,
  type ImmutableEntity,
  type ImmutableGraphStore,
} from '@freshcontext/graph';
import { HydraRequestError, type HydraQueryResponse } from '@freshcontext/hydra';

import { MemoryDomainError } from './errors.js';
import { MemoryService } from './memory-service.js';
import { INSPECT_REVIEW_STATE_QUERY, SET_REVIEW_STATE_QUERY } from './queries.js';
import type { ReviewCheckpoint, ReviewMemoryInput, ReviewMemoryResult } from './review-types.js';

export interface ReviewServiceOptions {
  readonly graph: ImmutableGraphStore;
  readonly hydra: HydraQueryGateway;
  readonly memory?: MemoryService;
  readonly faultInjector?: (checkpoint: ReviewCheckpoint) => void | Promise<void>;
}

export class ReviewService {
  readonly #graph: ImmutableGraphStore;
  readonly #hydra: HydraQueryGateway;
  readonly #memory: MemoryService;
  readonly #faultInjector?: ReviewServiceOptions['faultInjector'];

  public constructor(options: ReviewServiceOptions) {
    this.#graph = options.graph;
    this.#hydra = options.hydra;
    this.#memory =
      options.memory ?? new MemoryService({ graph: options.graph, hydra: options.hydra });
    this.#faultInjector = options.faultInjector;
  }

  public async review(input: ReviewMemoryInput): Promise<ReviewMemoryResult> {
    const original = await this.#memory.getMemory(input.repositoryId, input.originalMemoryId);
    if (!original) {
      throw new MemoryDomainError(
        'EVIDENCE_NOT_FOUND',
        `Original memory ${input.originalMemoryId} does not exist`,
      );
    }
    if (original.record.state !== 'needs_review' && original.record.state !== 'superseded') {
      throw new MemoryDomainError(
        'MEMORY_NOT_RETRYABLE',
        `Memory ${input.originalMemoryId} is ${original.record.state}, expected needs_review`,
      );
    }
    const replacement = await this.#memory.prepareMemory({
      repositoryId: input.repositoryId,
      commitSha: input.commitSha,
      claim: input.replacementClaim,
      evidence: input.evidence,
    });
    if (replacement.record.memoryId === original.record.memoryId) {
      throw new MemoryDomainError('INVALID_INPUT', 'Replacement must differ from the original');
    }
    if (replacement.record.state !== 'pending' && replacement.record.state !== 'current') {
      throw new MemoryDomainError(
        'MEMORY_NOT_RETRYABLE',
        `Replacement memory is ${replacement.record.state}`,
      );
    }

    const operationId = createHash('sha256')
      .update(`${input.repositoryId}\0${original.record.memoryId}\0${replacement.record.memoryId}`)
      .digest('hex')
      .slice(0, 32);
    const repository = createImmutableEntity(
      'Repository',
      entityKeys.repository(input.repositoryId),
      { repositoryId: input.repositoryId },
    );
    const review = createImmutableEntity(
      'ReviewOperation',
      entityKeys.reviewOperation(input.repositoryId, operationId),
      {
        operationId,
        repositoryId: input.repositoryId,
        originalMemoryId: original.record.memoryId,
        replacementMemoryId: replacement.record.memoryId,
        commitSha: input.commitSha,
        occurredAt: replacement.record.createdAt,
      },
    );
    await this.#graph.writeRelationship(
      createImmutableRelationship('HAS_REVIEW_OPERATION', repository, review),
    );
    await this.#setReviewState(review.id, 'pending');
    await this.#graph.writeRelationship(
      createImmutableRelationship('SUPERSEDES', replacement.entity, original.entity),
    );
    await this.#writeEvent(
      original.entity,
      original.record.memoryId,
      input.repositoryId,
      operationId,
      input.commitSha,
      replacement.record.createdAt,
      'superseded',
    );
    await this.#memory.setMemoryState(original.entity.id, 'superseded');
    await this.#checkpoint('original-superseded');
    await this.#writeEvent(
      replacement.entity,
      replacement.record.memoryId,
      input.repositoryId,
      operationId,
      input.commitSha,
      replacement.record.createdAt,
      'current',
    );
    await this.#memory.setMemoryState(replacement.entity.id, 'current');
    await this.#setReviewState(review.id, 'complete');

    const finalOriginal = await this.#memory.getMemory(
      input.repositoryId,
      original.record.memoryId,
    );
    const finalReplacement = await this.#memory.getMemory(
      input.repositoryId,
      replacement.record.memoryId,
    );
    if (!finalOriginal || !finalReplacement) {
      throw new MemoryDomainError('CORRUPT_GRAPH', 'Reviewed memories disappeared');
    }
    return { operationId, original: finalOriginal.record, replacement: finalReplacement.record };
  }

  async #writeEvent(
    memory: ImmutableEntity,
    memoryId: string,
    repositoryId: string,
    operationId: string,
    commitSha: string,
    occurredAt: string,
    state: 'superseded' | 'current',
  ): Promise<void> {
    const event = createImmutableEntity(
      'MemoryEvent',
      entityKeys.memoryEvent(repositoryId, memoryId, `review:${operationId}:${state}`),
      {
        memoryId,
        eventType: state === 'current' ? 'reviewed-replacement' : 'superseded',
        state,
        commitSha,
        occurredAt,
        operationId,
      },
    );
    await this.#graph.writeRelationship(createImmutableRelationship('HAS_EVENT', memory, event));
  }

  async #setReviewState(reviewId: number, state: 'pending' | 'complete'): Promise<void> {
    const current = await this.#inspectReviewState(reviewId);
    if (current === state) return;
    await this.#hydra.query(SET_REVIEW_STATE_QUERY, {
      parameters: { reviewId, state },
      queryId: `freshcontext-review-state-v1-${reviewId}-${current ?? 'unset'}-to-${state}`,
    });
    if ((await this.#inspectReviewState(reviewId)) !== state) {
      throw new HydraRequestError(`HydraDB did not persist review state ${state}`, {});
    }
  }

  async #inspectReviewState(reviewId: number): Promise<'pending' | 'complete' | undefined> {
    const response = await this.#hydra.query(INSPECT_REVIEW_STATE_QUERY, {
      parameters: { reviewId },
      consistency: 'strong',
    });
    if (response.rows.length === 0) return undefined;
    const state = optionalStringCell(response, 0, 'state') ?? 'pending';
    if (state !== 'pending' && state !== 'complete') {
      throw new MemoryDomainError('CORRUPT_GRAPH', `Review state ${state} is invalid`);
    }
    return state;
  }

  async #checkpoint(checkpoint: ReviewCheckpoint): Promise<void> {
    await this.#faultInjector?.(checkpoint);
  }
}

function optionalStringCell(
  response: HydraQueryResponse,
  row: number,
  column: string,
): string | undefined {
  const columnIndex = response.columns.indexOf(column);
  const cell = columnIndex >= 0 ? response.rows[row]?.[columnIndex] : undefined;
  if (!cell) throw new MemoryDomainError('CORRUPT_GRAPH', `HydraDB omitted ${column}`);
  if (cell.type === 'null') return undefined;
  if (cell.type !== 'string') {
    throw new MemoryDomainError('CORRUPT_GRAPH', `HydraDB column ${column} is not a string`);
  }
  return cell.value;
}

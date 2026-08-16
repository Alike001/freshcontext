import { makeDecision } from './policy.js';

export function authorize(role: string): boolean {
  return makeDecision(role) === 'allow';
}

export function authorizeApi(role: string): { allowed: boolean } {
  return { allowed: authorize(role) };
}

export function authorizeBatch(roles: readonly string[]): boolean {
  return roles.every((role) => authorizeApi(role).allowed);
}

export function stableGuard(): boolean {
  return true;
}

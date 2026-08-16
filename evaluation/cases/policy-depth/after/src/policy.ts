export function isAllowed(role: string): boolean {
  return role === 'admin';
}

export function makeDecision(role: string): 'allow' | 'deny' {
  return isAllowed(role) ? 'allow' : 'deny';
}

export function policyLabel(): string {
  return 'workspace-role-policy';
}

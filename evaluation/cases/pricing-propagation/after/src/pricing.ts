export function fee(amount: number): number {
  return amount > 100 ? 4 : 1;
}

export function calculateTotal(amount: number): number {
  return amount + fee(amount);
}

export function unrelatedLabel(): string {
  return 'standard';
}

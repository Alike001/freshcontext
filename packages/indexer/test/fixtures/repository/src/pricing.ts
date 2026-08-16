export function fee(amount: number): number {
  return amount > 0 ? 2 : 0;
}

export function calculateTotal(amount: number): number {
  return amount + fee(amount);
}

export const formatTotal = (amount: number): string => String(calculateTotal(amount));

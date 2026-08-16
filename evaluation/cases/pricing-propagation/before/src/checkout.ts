import { calculateTotal } from './pricing.js';

export class Checkout {
  public total(amount: number): number {
    return calculateTotal(amount);
  }
}

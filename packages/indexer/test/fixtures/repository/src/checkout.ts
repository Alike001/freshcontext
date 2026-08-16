import { calculateTotal } from './pricing.js';

export class Checkout {
  public total(amount: number): number {
    return calculateTotal(amount);
  }

  public dynamic(service: unknown): unknown {
    // @ts-expect-error This fixture deliberately contains a dynamic call with no resolvable target.
    return service();
  }
}

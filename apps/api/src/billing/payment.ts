import { Logger } from '@nestjs/common';

// Payment-provider seam. A real provider (Paystack / Flutterwave) plugs in here
// once its API keys are supplied; until then checkout is "manual" (the invoice
// stays open and can be marked paid by hand). Same pattern as the channel seam.
export interface CheckoutResult {
  status: 'redirect' | 'manual';
  url?: string;
  ref?: string;
  detail?: string;
}
export interface PaymentProvider {
  readonly name: string;
  readonly configured: boolean;
  checkout(opts: { amount: number; currency: string; email: string; reference: string }): Promise<CheckoutResult>;
}

class UnconfiguredProvider implements PaymentProvider {
  configured = false;
  private readonly logger = new Logger('Payment');
  constructor(public readonly name: string, private readonly requirement: string) {}
  async checkout(): Promise<CheckoutResult> {
    this.logger.warn(`payment provider ${this.name} not configured — ${this.requirement}`);
    return { status: 'manual', detail: `${this.name} not connected (${this.requirement})` };
  }
}

// Choose provider from env keys; default to an unconfigured stub.
export function getPaymentProvider(env: Record<string, any> = process.env): PaymentProvider {
  // if (env.PAYSTACK_SECRET_KEY) return new PaystackProvider(env.PAYSTACK_SECRET_KEY);
  // if (env.FLUTTERWAVE_SECRET_KEY) return new FlutterwaveProvider(env.FLUTTERWAVE_SECRET_KEY);
  const want = (env.PAYMENT_PROVIDER as string) || 'paystack';
  const req = want === 'flutterwave'
    ? 'Flutterwave secret key (FLUTTERWAVE_SECRET_KEY)'
    : 'Paystack secret key (PAYSTACK_SECRET_KEY)';
  return new UnconfiguredProvider(want, req);
}

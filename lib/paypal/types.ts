export type PayPalConfig = {
  PAYPAL_ENV: "sandbox" | string;
  PAYPAL_ENABLED: string;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_WEBHOOK_ID: string;
  PAYPAL_PRODUCT_ID?: string;
  PAYPAL_ESSENTIAL_PLAN_ID: string;
  PAYPAL_GROWTH_PLAN_ID: string;
  PAYPAL_PRO_PLAN_ID: string;
  NEXT_PUBLIC_PAYPAL_CLIENT_ID?: string;
};

export type PayPalTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type PayPalLink = {
  href: string;
  rel: string;
  method?: string;
};

export type PayPalOrder = {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED" | string;
  purchase_units?: Array<{
    reference_id?: string;
    amount?: {
      currency_code: string;
      value: string;
    };
    custom_id?: string;
    payments?: {
      captures?: Array<{
        id: string;
        status: "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | string;
        amount?: {
          currency_code: string;
          value: string;
        };
        custom_id?: string;
      }>;
    };
  }>;
  links?: PayPalLink[];
};

export type PayPalSubscription = {
  id: string;
  status:
    | "APPROVAL_PENDING"
    | "APPROVED"
    | "ACTIVE"
    | "SUSPENDED"
    | "CANCELLED"
    | "EXPIRED"
    | string;
  status_change_note?: string;
  status_update_time?: string;
  plan_id: string;
  custom_id?: string;
  subscriber?: {
    payer_id?: string;
    email_address?: string;
    name?: { given_name?: string; surname?: string };
  };
  billing_info?: {
    next_billing_time?: string;
    last_payment?: {
      amount?: { currency_code: string; value: string };
      time?: string;
    };
    failed_payments_count?: number;
  };
  links?: PayPalLink[];
};

export type PayPalWebhookEvent = {
  id: string;
  event_version?: string;
  create_time?: string;
  resource_type: string;
  event_type: string;
  summary?: string;
  resource: Record<string, any>;
  links?: PayPalLink[];
};

export type PayPalWebhookHeaders = {
  authAlgo: string | null;
  certUrl: string | null;
  transmissionId: string | null;
  transmissionSig: string | null;
  transmissionTime: string | null;
};

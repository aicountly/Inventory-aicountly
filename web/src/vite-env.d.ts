/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_APP_NAME: string
  readonly VITE_APP_ENV: string
  /** Portal authentication_jump key. Defaults to the hostname's product. */
  readonly VITE_PRODUCT_KEY: string
  /** Overrides the login portal origin. For local development only. */
  readonly VITE_PORTAL_LOGIN_URL: string
  /** Overrides the Books SPA origin for cross-app links. Defaults to the `books` entry in config/aicountlyApps.ts. */
  readonly VITE_BOOKS_APP_URL?: string
  /** GA4 measurement ID for this product. Analytics is disabled when unset. */
  readonly VITE_GA4_SAAS_INVENTORY_MEASUREMENT_ID?: string
  /** Generic GA4 measurement ID fallback, checked when the product-specific one is unset. */
  readonly VITE_GA4_MEASUREMENT_ID?: string
  /**
   * API path that answers Aicountly AI requests, e.g. `v1/ai/suggest`.
   * Unset (the default) and the masters AI panels offer themselves as not yet
   * connected rather than inventing an answer — see
   * masters/warehouseGroups/warehouseGroupsAi.ts and services/uomAiApi.ts.
   */
  readonly VITE_INVENTORY_AI_PATH?: string

  /* Feature flags — see src/config/features.ts. Unset means on; `0`/`false`/`off` takes it out. */
  readonly VITE_FEATURE_JOB_WORK_ASSISTANT?: string
  readonly VITE_FEATURE_JOB_WORK_SMART_WARNINGS?: string
  readonly VITE_FEATURE_JOB_WORK_TIMELINE?: string
  readonly VITE_FEATURE_JOB_WORK_IMPORT?: string
  readonly VITE_FEATURE_JOB_WORK_BARCODE_SCAN?: string

  /**
   * Material receipt integrations, each off until the endpoint behind it exists.
   * See documents/receipt/integrations.ts — every one of these is a LIVE API
   * call through Inventory's own relay, never a copy of another product's data.
   */
  readonly VITE_FEATURE_RECEIPT_PURCHASE_ORDERS?: string
  readonly VITE_FEATURE_RECEIPT_AI_AUTOFILL?: string
  readonly VITE_FEATURE_RECEIPT_ATTACHMENTS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

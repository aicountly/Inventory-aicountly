/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_APP_NAME: string
  readonly VITE_APP_ENV: string
  /** Portal authentication_jump key. Defaults to the hostname's product. */
  readonly VITE_PRODUCT_KEY: string
  /** Overrides the login portal origin. For local development only. */
  readonly VITE_PORTAL_LOGIN_URL: string
  /** GA4 measurement ID for this product. Analytics is disabled when unset. */
  readonly VITE_GA4_SAAS_INVENTORY_MEASUREMENT_ID?: string
  /** Generic GA4 measurement ID fallback, checked when the product-specific one is unset. */
  readonly VITE_GA4_MEASUREMENT_ID?: string
  /**
   * API path that answers Aicountly AI suggestions, e.g. `v1/ai/suggest`.
   * Unset (the default) and the AI panel offers itself as not yet connected
   * rather than inventing an answer — see masters/warehouseGroups/warehouseGroupsAi.ts.
   */
  readonly VITE_INVENTORY_AI_PATH?: string
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

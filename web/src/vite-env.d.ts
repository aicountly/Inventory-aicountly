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
   * API path of the Aicountly AI assistant, relative to the API base.
   *
   * Unset — the default — means the assistant's free-text box reports itself
   * unconnected rather than answering. The panel's derived analyses (duplicate,
   * unused and un-coded units) do not use it and work regardless.
   */
  readonly VITE_AI_ASSISTANT_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

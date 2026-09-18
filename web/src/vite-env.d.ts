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
   * Inventory API path of the Aicountly AI category-analysis endpoint, e.g.
   * `v1/ai/stock-categories/analyse`. Unset (the default) means no AI service
   * is connected and the Stock categories panel says so instead of showing
   * anything that looks like analysis.
   */
  readonly VITE_AI_CATEGORY_ANALYSIS_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

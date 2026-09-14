import type { Config } from 'tailwindcss'

/** The config is plain JS (PostCSS loads it directly); this is only so the
 *  colour-registration test can import it under the app's TS project. */
declare const config: Config
export default config

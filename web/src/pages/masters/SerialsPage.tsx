/**
 * Masters › Serial numbers.
 *
 * The screen itself lives in `src/serials`, which is where the workspace's
 * components, its data hook and its pure helpers sit together. This file stays
 * as the route's entry point — and re-exports `serialsConfig`, which is the
 * export contract the master export tests are written against.
 */
export { serialsConfig } from '../../serials/serialsConfig'
export { SerialsWorkspacePage as SerialsPage } from '../../serials/SerialsWorkspacePage'

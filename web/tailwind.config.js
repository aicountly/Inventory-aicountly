/** @type {import('tailwindcss').Config} */
/*
 * Ported verbatim from books-react-app/web/tailwind.config.js so the two
 * Aicountly products share one design language, with one deliberate change:
 *
 *   corePlugins.preflight = false
 *
 * Books is Tailwind top to bottom; Inventory still has ~170 files styled by the
 * hand-written stylesheets in src/components/ui.css, src/pages/views.css and
 * friends, which assume the browser's default element styles. Turning Tailwind's
 * global reset on would silently re-style every one of those screens.
 *
 * Instead src/theme/tokens.css carries the same reset scoped under `.aic`
 * (written with :where() so it adds zero specificity and every utility still
 * wins). Books-ported subtrees opt in with a single `aic` class; legacy screens
 * are untouched. When the last legacy stylesheet retires, delete the scoped
 * block and set preflight back to true.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      screens: {
        tall: { raw: '(min-height: 800px)' },
        /*
         * The same idea as `tall`, raised for the `page` register layout.
         *
         * Pinning the header, the filters and the KPI cards and giving the
         * table what is left only pays while "what is left" is a table. The
         * panel layout's header stack is a good 200px taller than the compact
         * one, and narrower than 1280px the filter grid folds to two columns
         * and the KPI cards to two rows, which costs another 200px again. Under
         * either, scrolling the page is plainly the better screen.
         */
        taller: { raw: '(min-height: 900px) and (min-width: 1280px)' },
      },
      fontFamily: {
        nunito: ['Nunito', 'sans-serif'],
        poppins: ['Poppins', 'sans-serif'],
      },
      colors: {
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        'primary-hover': 'rgb(var(--color-primary-hover) / <alpha-value>)',
        // The 12% wash of the primary that marks a selected or hovered surface.
        // It is registered here, rather than hand-written in tokens.css, so that
        // `hover:bg-primary-light/40` scales the wash instead of generating
        // nothing at all: the modifier lands inside the calc, leaving a bare
        // `bg-primary-light` at exactly the 0.12 it has always been.
        'primary-light': 'rgb(var(--color-primary) / calc(0.12 * <alpha-value>))',
        nav: 'rgb(var(--color-nav) / <alpha-value>)',
        workspace: {
          bg: 'rgb(var(--workspace-bg) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}

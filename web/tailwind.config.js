import { fileURLToPath } from 'node:url';
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [here('./index.html'), here('./src/**/*.{ts,tsx}')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: Object.fromEntries(
        Object.entries({
          bg: '--bg', surface: '--surface', muted: '--surface-muted', ink: '--ink', ink2: '--ink-2', sub: '--muted',
          faint: '--subtle', line: '--border', accent: '--accent', 'accent-soft': '--accent-soft',
          danger: '--danger', warn: '--warning', ok: '--success',
        }).map(([k, v]) => [k, `color-mix(in srgb, var(${v}) calc(<alpha-value> * 100%), transparent)`]),
      ),
      fontFamily: { sans: ['"DM Sans"', 'system-ui', 'sans-serif'], display: ['"Space Grotesk"', 'sans-serif'], mono: ['"JetBrains Mono"', 'monospace'] },
      boxShadow: { card: 'var(--shadow-card)' },
    },
  },
  plugins: [],
};

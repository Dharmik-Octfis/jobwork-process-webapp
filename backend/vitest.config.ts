import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // `npm run build` compiles the tests too, so `dist/` holds a second copy of
    // every suite. Without this they run twice — and that copy is whatever the last
    // build produced, so it fails against any newer schema (found 2026-07-25: the
    // stale copy still selected `memberships.role` after that column was dropped,
    // reporting three failures that did not exist in the source).
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});

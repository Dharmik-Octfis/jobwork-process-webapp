// Commit-message rules for the whole repo (web/ + backend/).
// Enforces the Conventional Commits standard:
//   <type>(<optional scope>): <description>
// e.g. "feat(auth): add login page", "fix(api): retry on 401", "docs: update setup"
// Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
// See docs/CODE_QUALITY_AND_FORMATTING.md.
module.exports = {
  extends: ['@commitlint/config-conventional'],
};

/** Shape returned to clients for a role (a job title). */
export interface PublicRole {
  id: string;
  name: string;
  description: string | null;
  /** The built-in root role (seeded as "CEO"). Cannot be edited, deleted, or
   * assigned by invite. Test this flag, never the name — an org may rename it. */
  isSystem: boolean;
  /**
   * Who this title reports to; null for a root of the org chart.
   *
   * 🔴 Structure, not access. Nothing in the request path reads this — a parent
   * role grants a child nothing. If you find code branching on it to decide what
   * someone may do or see, that is an authorization bug.
   */
  parentRoleId: string | null;
  parentRoleName: string | null;
  /** 0 for a root, 1 for its children, and so on. Lets the UI indent without
   * walking the tree itself. */
  depth: number;
  /** Root-first names, including this role: `["CEO", "Senior Manager", "Manager"]`. */
  path: string[];
  /** How many memberships currently carry this title — lets the UI say why a role
   * can't be deleted, and spot titles nobody uses. Counts THIS title only, never
   * the subtree: a manager does not "have" their reports' memberships. */
  memberCount: number;
  /** Direct children. Non-zero blocks deletion — see `deleteRole`. */
  childCount: number;
  createdAt: string;
  updatedAt: string;
}

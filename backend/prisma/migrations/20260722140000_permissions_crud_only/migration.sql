-- Normalize the permission catalog to a uniform Read/Create/Update/Delete per
-- resource — the `:manage` and organization-only keys are gone (see
-- permissions.catalog.ts). Data-only migration: rewrites the seeded Admin and
-- Member system templates for every existing org to the new key set. Owner stays
-- empty (isOwner → all, computed). Custom (non-system) templates are left alone;
-- an admin re-edits those. Runs as the table owner, so RLS does not apply.

-- Admin — every resource's full CRUD, except organization:delete and role writes
-- (reserved to Owner).
UPDATE "permission_templates"
SET permissions = ARRAY[
  'vendor:read','vendor:create','vendor:update','vendor:delete',
  'item:read','item:create','item:update','item:delete',
  'currency:read','currency:create','currency:update','currency:delete',
  'uom:read','uom:create','uom:update','uom:delete',
  'custom_field:read','custom_field:create','custom_field:update','custom_field:delete',
  'member:read','member:create','member:update','member:delete',
  'role:read',
  'organization:read','organization:create','organization:update'
]::text[]
WHERE is_system = true AND is_owner = false AND name = 'Admin';

-- Member — read-only across every module.
UPDATE "permission_templates"
SET permissions = ARRAY[
  'vendor:read','item:read','currency:read','uom:read',
  'custom_field:read','member:read','role:read','organization:read'
]::text[]
WHERE is_system = true AND is_owner = false AND name = 'Member';

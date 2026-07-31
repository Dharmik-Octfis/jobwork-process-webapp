import { z } from 'zod';

/**
 * Names are required wherever a member record is created or renamed, and are
 * always the MEMBERSHIP's name — never the account's. `fullName` is deliberately
 * absent from every schema here: it is derived by `composeFullName` in the service
 * so the denormalized column can never disagree with its parts.
 */
const firstName = z.string().trim().min(1, 'First name is required.').max(40);
const lastName = z.string().trim().min(1, 'Last name is required.').max(40);

/** Optional free text that should be stored as NULL, not '', when cleared. An empty
 * string in a nullable column means "the user typed nothing", which reads as data. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long.`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/**
 * A calendar date, `YYYY-MM-DD`. Rejected as a full ISO instant on purpose — the
 * column is `@db.Date`, and accepting a timestamp invites a birthday that shifts a
 * day depending on the sender's timezone.
 */
const dateOfBirth = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'That is not a real date.')
  .refine((v) => new Date(`${v}T00:00:00Z`) <= new Date(), 'Date of birth cannot be in the future.')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/**
 * The per-org address. Mirrors `organizations`: `stateCode`/`countryCode` are the
 * master tables' own keys (VarChar), NOT uuids — `cities` is the only one keyed by
 * uuid. Getting this backwards fails at runtime with
 * "operator does not exist: uuid = text", which `prisma validate` will not catch.
 */
const addressFields = {
  addressLine1: optionalText(255, 'Address'),
  addressLine2: optionalText(255, 'Address'),
  cityId: z.string().uuid('Select a valid city.').nullable().optional(),
  stateCode: optionalText(6, 'State code'),
  countryCode: optionalText(2, 'Country code'),
  zip: optionalText(20, 'ZIP / postal code'),
};

/**
 * 🔴 These all write to `users`, NOT to the membership — they are the account's,
 * shared by every organization the person belongs to. Only `firstName`/`lastName`
 * are per-org. Adding a field here means adding it to something every one of that
 * person's organizations can see and edit; if the answer should differ per org, it
 * belongs on `Membership` instead. See `accountDetailData` in the service.
 */
const accountDetailFields = {
  phone: optionalText(20, 'Phone'),
  mobile: optionalText(20, 'Mobile'),
  dateOfBirth,
  avatarUrl: optionalText(2048, 'Avatar URL'),
  ...addressFields,
};

/**
 * `PUT /members/:id` — an admin editing SOMEONE ELSE. Gated by `member:update`.
 *
 * Everything is optional (PATCH-style: send what changed), but at least one field
 * must be present or the request is a no-op that still writes `updatedBy`.
 *
 * `isActive` is here rather than on its own endpoint because deactivating is an
 * edit like any other from the client's point of view — but note it is NOT
 * cosmetic: `tenantContext` filters on it, so flipping it to false ends the
 * person's access to this org on their very next request.
 */
export const updateMemberSchema = z
  .object({
    firstName: firstName.optional(),
    lastName: lastName.optional(),
    ...accountDetailFields,
    roleId: z.string().uuid('Select a role.').nullable().optional(),
    permissionTemplateId: z.string().uuid('Select a permission template.').optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

/**
 * `PUT /members/me` — a member editing THEIR OWN record in this org.
 *
 * 🔴 Deliberately NOT gated by `member:update`. Requiring a permission to fix the
 * spelling of your own name fails closed in the worst way: a new joiner cannot
 * correct the typo the inviter made, and needs an admin to do it. No mainstream
 * product works that way.
 *
 * The difference from `updateMemberSchema` is the omissions, and they are the whole
 * point: no `roleId`, no `permissionTemplateId`, no `isActive`. Those are the three
 * fields that would let anyone promote themselves, grant themselves any permission,
 * or reactivate an account an admin just switched off. `requirePermission` cannot
 * express "self or permitted", so the split lives in two routes with two schemas
 * rather than a branch inside one service (CLAUDE.md: never write a bespoke
 * membership lookup to authorize).
 */
export const updateMyProfileSchema = z
  .object({
    firstName: firstName.optional(),
    lastName: lastName.optional(),
    ...accountDetailFields,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

// The list query is the shared `listQuerySchema` from `lib/pagination.ts` — same
// search / filter / page / perPage contract as vendors, items and customers, so the
// Users screen is built from the same hooks. The filter keys it accepts come from
// `listFilters.catalog.ts` under `member`.

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type UpdateMyProfileInput = z.infer<typeof updateMyProfileSchema>;

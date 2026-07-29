import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes.ts';
import { organizationsRouter } from '../modules/settings/organization/organizations/organizations.routes.ts';
import {
  invitationsRouter,
  myInvitationsRouter,
  orgInvitationsRouter,
} from '../modules/settings/organization/invitations/invitations.routes.ts';
import {
  globalSeedDataRouter,
  tenantSeedDataRouter,
} from '../modules/seed-data/seed-data.routes.ts';
import { appModulesRouter } from '../modules/settings/customization/app-modules/app-modules.routes.ts';
import { vendorsRouter } from '../modules/purchases/vendors/vendors.routes.ts';
import { purchaseOrdersRouter } from '../modules/purchases/purchase-orders/purchase-orders.routes.ts';
import { customersRouter } from '../modules/sales/customers/customers.routes.ts';
import { uomRouter } from '../modules/settings/inventory/uom/uom.routes.ts';
import { currenciesRouter } from '../modules/settings/configuration/currencies/currencies.routes.ts';
import { paymentTermsRouter } from '../modules/settings/configuration/payment-terms/payment-terms.routes.ts';
import { locationsRouter } from '../modules/settings/configuration/locations/locations.routes.ts';
import { customFieldsRouter } from '../modules/settings/customization/custom-fields/custom-fields.routes.ts';
import { rolesRouter } from '../modules/settings/organization/roles/roles.routes.ts';
import { permissionTemplatesRouter } from '../modules/settings/organization/permission-templates/permission-templates.routes.ts';
import { membersRouter } from '../modules/settings/organization/members/members.routes.ts';
import { itemsRouter } from '../modules/items/items.routes.ts';
import { listViewsRouter } from '../modules/settings/list-views/listViews.routes.ts';
import { diagnosticsRouter } from '../modules/diagnostics/diagnostics.routes.ts';
import { env } from '../config/env.ts';

/** Mounts every module router under `/api` (architecture §4). */
export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Ops-only latency probe. NOT mounted unless a token is configured, so a
// deployment that never sets `DIAGNOSTICS_TOKEN` genuinely has no such route —
// the safest possible default for something that reports infrastructure shape.
if (env.diagnosticsToken) {
  apiRouter.use('/diagnostics', diagnosticsRouter);
}

apiRouter.use('/auth', authRouter);

// Tenant-scoped modules nest under `/organizations/:orgId/…` so the organization
// is part of the URL: explicit, bookmarkable, and shareable. `tenantContext`
// reads `:orgId` and verifies membership before any handler runs.
//
// Registered BEFORE `/organizations` deliberately. Express matches in mount
// order, and `use('/organizations', …)` also matches this longer path — it would
// hand the request to organizationsRouter, find no route, and fall through here
// anyway, but only after running that router's `authenticate` a second time.
// Specific before general keeps the path short and the middleware chain honest.
apiRouter.use('/organizations/:orgId/purchases/vendors', vendorsRouter);
apiRouter.use('/organizations/:orgId/purchases/purchase-orders', purchaseOrdersRouter);
apiRouter.use('/organizations/:orgId/sales/customers', customersRouter);
apiRouter.use('/organizations/:orgId/inventory/uom', uomRouter);
apiRouter.use('/organizations/:orgId/configuration/currencies', currenciesRouter);
apiRouter.use('/organizations/:orgId/configuration/payment-terms', paymentTermsRouter);
apiRouter.use('/organizations/:orgId/configuration/locations', locationsRouter);
apiRouter.use('/organizations/:orgId/custom-fields', customFieldsRouter);
// Two separate axes: `/roles` is job titles, `/permission-templates` is access.
// A membership points at one of each, independently.
apiRouter.use('/organizations/:orgId/invitations', orgInvitationsRouter);
apiRouter.use('/organizations/:orgId/roles', rolesRouter);
apiRouter.use('/organizations/:orgId/permission-templates', permissionTemplatesRouter);
apiRouter.use('/organizations/:orgId/members', membersRouter);
apiRouter.use('/organizations/:orgId/items', itemsRouter);
apiRouter.use('/organizations/:orgId/list-views', listViewsRouter);
apiRouter.use('/organizations/:orgId/seed-data', tenantSeedDataRouter);
apiRouter.use('/seed-data', globalSeedDataRouter);

apiRouter.use('/organizations', organizationsRouter);
apiRouter.use('/invitations', invitationsRouter);
// The recipient's own inbox — authenticated, addressed by invitation id. Distinct
// from `/invitations/:token` above, which is public and token-addressed.
apiRouter.use('/me/invitations', myInvitationsRouter);
apiRouter.use('/modules', appModulesRouter);

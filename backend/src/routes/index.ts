import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes.ts';
import { organizationsRouter } from '../modules/settings/organization/organizations/organizations.routes.ts';
import { invitationsRouter } from '../modules/settings/organization/invitations/invitations.routes.ts';
import {
  globalSeedDataRouter,
  tenantSeedDataRouter,
} from '../modules/seed-data/seed-data.routes.ts';
import { appModulesRouter } from '../modules/settings/customization/app-modules/app-modules.routes.ts';
import { vendorsRouter } from '../modules/purchases/vendors/vendors.routes.ts';
import { customersRouter } from '../modules/sales/customers/customers.routes.ts';
import { uomRouter } from '../modules/settings/inventory/uom/uom.routes.ts';
import { currenciesRouter } from '../modules/settings/configuration/currencies/currencies.routes.ts';
import { paymentTermsRouter } from '../modules/settings/configuration/payment-terms/payment-terms.routes.ts';
import { customFieldsRouter } from '../modules/settings/customization/custom-fields/custom-fields.routes.ts';
import { itemsRouter } from '../modules/items/items.routes.ts';

/** Mounts every module router under `/api` (architecture §4). */
export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

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
apiRouter.use('/organizations/:orgId/sales/customers', customersRouter);
apiRouter.use('/organizations/:orgId/inventory/uom', uomRouter);
apiRouter.use('/organizations/:orgId/configuration/currencies', currenciesRouter);
apiRouter.use('/organizations/:orgId/configuration/payment-terms', paymentTermsRouter);
apiRouter.use('/organizations/:orgId/custom-fields', customFieldsRouter);
apiRouter.use('/organizations/:orgId/items', itemsRouter);
apiRouter.use('/organizations/:orgId/seed-data', tenantSeedDataRouter);
apiRouter.use('/seed-data', globalSeedDataRouter);

apiRouter.use('/organizations', organizationsRouter);
apiRouter.use('/invitations', invitationsRouter);
apiRouter.use('/modules', appModulesRouter);

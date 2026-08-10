import { lazy, type ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { SignupPage } from '../features/auth/SignupPage';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { ProtectedRoute } from '../routes/ProtectedRoute';
import { RequireOrganization } from '../routes/RequireOrganization';
import { OrgRedirect } from '../routes/OrgRedirect';
import { LegacyJobworkMasterRedirect } from '../routes/LegacyJobworkMasterRedirect';
import { AcceptInvitePage } from '../features/invitations/AcceptInvitePage';
import { CreateOrganizationForm } from '../features/organizations/CreateOrganizationForm';
import { AppLayout } from '../components/layout/AppLayout';
import { SettingsLayout } from '../components/layout/SettingsLayout';

/**
 * WHAT IS EAGER AND WHAT IS SPLIT, AND WHY THE LINE SITS WHERE IT DOES
 *
 * Everything imported above ships in the entry bundle; everything built with
 * `lazyPage` below becomes its own chunk fetched on first navigation. Before
 * this split the entry bundle was 981 KB (249 KB gzipped) because it contained
 * every page in the app — you downloaded the role editor and the purchase-order
 * module to look at the login screen.
 *
 * Eager, deliberately:
 *  - the auth pages, because a logged-out visitor lands on one and a second
 *    round trip to fetch it is pure added latency on the most common entry point
 *  - the route guards (`ProtectedRoute`, `RequireOrganization`, `OrgRedirect`),
 *    which are a few lines each and run before any page renders
 *  - both layouts, which render on every authenticated route — splitting them
 *    would put a chunk fetch in front of the shell on literally every page
 *
 * Split: every feature page. They are the bulk of the code, a given user visits
 * a handful of them, and each one already waits on its own API call — so the
 * chunk fetch overlaps work the page was going to do anyway.
 */

/**
 * `React.lazy` requires a module with a **default** export; every page in this
 * codebase is a named export. This adapts one to the other in a single place
 * rather than repeating the `.then(m => ({ default: m.X }))` dance 25 times.
 *
 * The `ComponentType` cast is safe because every route element here takes no
 * props — React Router supplies context through hooks, not props. A page that
 * ever needs props must not go through this helper.
 */
function lazyPage<M extends Record<string, unknown>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
}

const DashboardPage = lazyPage(
  () => import('../features/dashboard/DashboardPage'),
  'DashboardPage',
);
const PurchasesPage = lazyPage(
  () => import('../features/purchases/PurchasesPage'),
  'PurchasesPage',
);
const OrganizationsList = lazyPage(
  () => import('../features/organizations/OrganizationsList'),
  'OrganizationsList',
);
const ProfilePage = lazyPage(() => import('../features/profile/ProfilePage'), 'ProfilePage');
const OrganizationSettingsPage = lazyPage(
  () => import('../features/organizations/OrganizationSettingsPage'),
  'OrganizationSettingsPage',
);
const UsersPage = lazyPage(() => import('../features/users/UsersPage'), 'UsersPage');
const RolesPage = lazyPage(() => import('../features/roles/RolesPage'), 'RolesPage');
const PermissionTemplatesPage = lazyPage(
  () => import('../features/permission-templates/PermissionTemplatesPage'),
  'PermissionTemplatesPage',
);
const NewPermissionTemplate = lazyPage(
  () => import('../features/permission-templates/NewPermissionTemplate'),
  'NewPermissionTemplate',
);
const EditPermissionTemplate = lazyPage(
  () => import('../features/permission-templates/EditPermissionTemplate'),
  'EditPermissionTemplate',
);
const VendorsList = lazyPage(
  () => import('../features/purchases/vendors/VendorsList'),
  'VendorsList',
);
const CreateVendor = lazyPage(
  () => import('../features/purchases/vendors/CreateVendor'),
  'CreateVendor',
);
const EditVendor = lazyPage(() => import('../features/purchases/vendors/EditVendor'), 'EditVendor');
const PurchaseOrdersList = lazyPage(
  () => import('../features/purchases/purchase-orders/PurchaseOrdersList'),
  'PurchaseOrdersList',
);
const CreatePurchaseOrder = lazyPage(
  () => import('../features/purchases/purchase-orders/CreatePurchaseOrder'),
  'CreatePurchaseOrder',
);
const CustomersList = lazyPage(
  () => import('../features/sales/customers/CustomersList'),
  'CustomersList',
);
const CreateCustomer = lazyPage(
  () => import('../features/sales/customers/CreateCustomer'),
  'CreateCustomer',
);
const EditCustomer = lazyPage(
  () => import('../features/sales/customers/EditCustomer'),
  'EditCustomer',
);
const JobworkPage = lazyPage(() => import('../features/jobwork/JobworkPage'), 'JobworkPage');
const ProcessesList = lazyPage(
  () => import('../features/jobwork/processes/ProcessesList'),
  'ProcessesList',
);
const CreateProcess = lazyPage(
  () => import('../features/jobwork/processes/CreateProcess'),
  'CreateProcess',
);
const EditProcess = lazyPage(
  () => import('../features/jobwork/processes/EditProcess'),
  'EditProcess',
);
const RoutesList = lazyPage(
  () => import('../features/jobwork/process-routes/RoutesList'),
  'RoutesList',
);
const CreateRoute = lazyPage(
  () => import('../features/jobwork/process-routes/CreateRoute'),
  'CreateRoute',
);
const EditRoute = lazyPage(
  () => import('../features/jobwork/process-routes/EditRoute'),
  'EditRoute',
);
const JobOrdersList = lazyPage(
  () => import('../features/jobwork/job-orders/JobOrdersList'),
  'JobOrdersList',
);
const CreateJobOrder = lazyPage(
  () => import('../features/jobwork/job-orders/CreateJobOrder'),
  'CreateJobOrder',
);
const EditJobOrder = lazyPage(
  () => import('../features/jobwork/job-orders/EditJobOrder'),
  'EditJobOrder',
);
const JobOrderOverview = lazyPage(
  () => import('../features/jobwork/job-orders/JobOrderOverview'),
  'JobOrderOverview',
);
const IssuesList = lazyPage(() => import('../features/jobwork/issues/IssuesList'), 'IssuesList');
const ReceiptsList = lazyPage(
  () => import('../features/jobwork/receipts/ReceiptsList'),
  'ReceiptsList',
);
const RejectionReasonsList = lazyPage(
  () => import('../features/jobwork/rejection-reasons/RejectionReasonsList'),
  'RejectionReasonsList',
);
const ItemsList = lazyPage(() => import('../features/items/ItemsList'), 'ItemsList');
const CreateItemPage = lazyPage(() => import('../features/items/CreateItemPage'), 'CreateItemPage');
const EditItemPage = lazyPage(() => import('../features/items/EditItemPage'), 'EditItemPage');
const CompositeItemsPage = lazyPage(() => import('../features/inventory/composite-items/CompositeItemsPage'), 'CompositeItemsPage');
const CreateCompositeItemPage = lazyPage(() => import('../features/inventory/composite-items/CreateCompositeItemPage'), 'CreateCompositeItemPage');
const EditCompositeItemPage = lazyPage(() => import('../features/inventory/composite-items/EditCompositeItemPage'), 'EditCompositeItemPage');
const UnitOfMeasurementPage = lazyPage(
  () => import('../features/inventory/uom/UnitOfMeasurementPage'),
  'UnitOfMeasurementPage',
);
const CurrenciesPage = lazyPage(
  () => import('../features/configuration/currencies/CurrenciesPage'),
  'CurrenciesPage',
);
const ModulesListPage = lazyPage(
  () => import('../features/custom-fields/ModulesListPage'),
  'ModulesListPage',
);
const ModuleFieldsPage = lazyPage(
  () => import('../features/custom-fields/ModuleFieldsPage'),
  'ModuleFieldsPage',
);
const LocationsList = lazyPage(
  () => import('../features/configuration/locations/LocationsList'),
  'LocationsList',
);
const CreateLocation = lazyPage(
  () => import('../features/configuration/locations/CreateLocation'),
  'CreateLocation',
);
const EditLocation = lazyPage(
  () => import('../features/configuration/locations/EditLocation'),
  'EditLocation',
);

/**
 * Every page whose data belongs to one organization lives under
 * `/organizations/:orgId/…`, mirroring the API. The organization is part of the
 * URL, so a page can be bookmarked, shared, and opened in two tabs for two
 * different organizations at once — none of which works when the active
 * organization is hidden in localStorage.
 *
 * `:orgId` is a claim the user can edit in the URL bar. It is verified against
 * `memberships` server-side on every request (`tenantContext`), so a wrong id
 * returns 403 rather than someone else's data.
 *
 * Not org-scoped, deliberately: auth, `/profile`, `/organizations` (you pick one
 * *before* you have one), and `/invite/accept` (the invitee may have no account).
 *
 * 🔴 Every lazy element below renders inside `AppLayout` or `SettingsLayout`,
 * which is where the `<Suspense>` boundary lives — around each layout's
 * `<Outlet />`, so a chunk still loading swaps only the content area and leaves
 * the sidebar and header on screen. A page added OUTSIDE both layouts must be
 * eager, or it suspends with no boundary above it and blanks the whole app.
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  // Public — the invitee may not have an account yet.
  { path: '/invite/accept', element: <AcceptInvitePage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          // No organization in the URL yet — send them to their last one.
          { path: '/', element: <OrgRedirect /> },
          {
            element: <RequireOrganization />,
            children: [
              { path: '/organizations/:orgId', element: <DashboardPage /> },
              { path: '/organizations/:orgId/purchases', element: <PurchasesPage /> },
              { path: '/organizations/:orgId/purchases/vendors', element: <VendorsList /> },
              { path: '/organizations/:orgId/purchases/vendors/new', element: <CreateVendor /> },
              { path: '/organizations/:orgId/purchases/vendors/:id/edit', element: <EditVendor /> },
              {
                path: '/organizations/:orgId/purchases/purchase-orders',
                element: <PurchaseOrdersList />,
              },
              {
                path: '/organizations/:orgId/purchases/purchase-orders/new',
                element: <CreatePurchaseOrder />,
              },
              {
                path: '/organizations/:orgId/purchases/purchase-orders/:id/edit',
                element: <CreatePurchaseOrder />,
              },
              { path: '/organizations/:orgId/sales/customers', element: <CustomersList /> },
              { path: '/organizations/:orgId/sales/customers/new', element: <CreateCustomer /> },
              { path: '/organizations/:orgId/sales/customers/:id/edit', element: <EditCustomer /> },
              { path: '/organizations/:orgId/purchases/po', element: <PurchasesPage /> },
              { path: '/organizations/:orgId/purchases/bills', element: <PurchasesPage /> },
              // Jobwork, Sprints 1–4.
              //
              // 🔴 There is no `issues/new` and no `receipts/new`, deliberately.
              // Both documents are raised from a job order step — the dialogs
              // live on the Overview page — because a challan with no step has no
              // process, no rate, no tolerance and nothing to come back to. A
              // standalone create route would be a form that cannot be filled in
              // correctly.
              { path: '/organizations/:orgId/jobwork', element: <JobworkPage /> },
              // The Processes and Process Routes masters now live under Settings —
              // these two only forward the old URLs there.
              {
                path: '/organizations/:orgId/jobwork/processes/*',
                element: <LegacyJobworkMasterRedirect />,
              },
              {
                path: '/organizations/:orgId/jobwork/routes/*',
                element: <LegacyJobworkMasterRedirect />,
              },
              { path: '/organizations/:orgId/jobwork/job-orders', element: <JobOrdersList /> },
              { path: '/organizations/:orgId/jobwork/job-orders/new', element: <CreateJobOrder /> },
              // Before ':id', or "new" is read as a job order id.
              {
                path: '/organizations/:orgId/jobwork/job-orders/:id',
                element: <JobOrderOverview />,
              },
              {
                path: '/organizations/:orgId/jobwork/job-orders/:id/edit',
                element: <EditJobOrder />,
              },
              { path: '/organizations/:orgId/jobwork/issues', element: <IssuesList /> },
              { path: '/organizations/:orgId/jobwork/receipts', element: <ReceiptsList /> },
              {
                path: '/organizations/:orgId/jobwork/rejection-reasons',
                element: <RejectionReasonsList />,
              },
              { path: '/organizations/:orgId/items', element: <ItemsList /> },
              { path: '/organizations/:orgId/items/new', element: <CreateItemPage /> },
              { path: '/organizations/:orgId/items/:id/edit', element: <EditItemPage /> },
              { path: '/organizations/:orgId/composite-items', element: <CompositeItemsPage /> },
              { path: '/organizations/:orgId/composite-items/new', element: <CreateCompositeItemPage /> },
              { path: '/organizations/:orgId/composite-items/:id/edit', element: <EditCompositeItemPage /> },
            ],
          },
          { path: '/organizations', element: <OrganizationsList /> },
        ],
      },
      // Moved outside AppLayout so settings takes the full page
      {
        path: '/organizations/:orgId/settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <OrganizationSettingsPage /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: 'users', element: <UsersPage /> },
          // "Members & Invites" became "Users" on 2026-07-30. The old path is kept
          // as a redirect rather than deleted: it is in people's bookmarks and in
          // links we have already sent by email, and a 404 there looks like the
          // feature was removed. `replace` so Back doesn't bounce off the redirect.
          {
            path: 'members',
            element: <Navigate to="../users" replace />,
          },
          // Two screens, deliberately: `roles` is job titles (no access at all),
          // `permissions` is the access bundles. A member is assigned one of each.
          { path: 'roles', element: <RolesPage /> },
          // The list carries its own detail pane at `?id=<uuid>`, like every other
          // module — so there is no `permissions/:id` route, only new/edit.
          { path: 'permissions', element: <PermissionTemplatesPage /> },
          { path: 'permissions/new', element: <NewPermissionTemplate /> },
          { path: 'permissions/:id/edit', element: <EditPermissionTemplate /> },
          { path: 'inventory/uom', element: <UnitOfMeasurementPage /> },
          { path: 'configuration/currencies', element: <CurrenciesPage /> },
          // Jobwork masters. Like every other settings list, each carries its own
          // detail pane at `?id=<uuid>` rather than a `:id` route.
          { path: 'jobwork/processes', element: <ProcessesList /> },
          { path: 'jobwork/processes/new', element: <CreateProcess /> },
          { path: 'jobwork/processes/:id/edit', element: <EditProcess /> },
          { path: 'jobwork/routes', element: <RoutesList /> },
          { path: 'jobwork/routes/new', element: <CreateRoute /> },
          { path: 'jobwork/routes/:id/edit', element: <EditRoute /> },
          { path: 'modules', element: <ModulesListPage /> },
          { path: 'modules/:entityType', element: <ModuleFieldsPage /> },
          { path: 'locations', element: <LocationsList /> },
          { path: 'locations/new', element: <CreateLocation /> },
          { path: 'locations/:id/edit', element: <EditLocation /> },
        ],
      },
      { path: '/organizations/new', element: <CreateOrganizationForm /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

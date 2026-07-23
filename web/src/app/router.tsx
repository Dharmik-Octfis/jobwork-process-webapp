import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { SignupPage } from '../features/auth/SignupPage';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { PurchasesPage } from '../features/purchases/PurchasesPage';
import { ProtectedRoute } from '../routes/ProtectedRoute';
import { RequireOrganization } from '../routes/RequireOrganization';
import { OrgRedirect } from '../routes/OrgRedirect';
import { OrganizationsList } from '../features/organizations/OrganizationsList';
import { CreateOrganizationForm } from '../features/organizations/CreateOrganizationForm';
import { ProfilePage } from '../features/profile/ProfilePage';
import { OrganizationSettingsPage } from '../features/organizations/OrganizationSettingsPage';
import { AcceptInvitePage } from '../features/invitations/AcceptInvitePage';
import { InviteMembersPage } from '../features/invitations/InviteMembersPage';
import { RolesPage } from '../features/roles/RolesPage';
import { AppLayout } from '../components/layout/AppLayout';
import { SettingsLayout } from '../components/layout/SettingsLayout';
import { VendorsList } from '../features/purchases/vendors/VendorsList';
import { CreateVendor } from '../features/purchases/vendors/CreateVendor';
import { EditVendor } from '../features/purchases/vendors/EditVendor';
import { CustomersList } from '../features/sales/customers/CustomersList';
import { CreateCustomer } from '../features/sales/customers/CreateCustomer';
import { EditCustomer } from '../features/sales/customers/EditCustomer';

import { ItemsList } from '../features/items/ItemsList';
import { CreateItemPage } from '../features/items/CreateItemPage';
import { EditItemPage } from '../features/items/EditItemPage';
import { UnitOfMeasurementPage } from '../features/inventory/uom/UnitOfMeasurementPage';
import { CurrenciesPage } from '../features/configuration/currencies/CurrenciesPage';
import { ModulesListPage } from '../features/custom-fields/ModulesListPage';
import { ModuleFieldsPage } from '../features/custom-fields/ModuleFieldsPage';

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
              { path: '/organizations/:orgId/sales/customers', element: <CustomersList /> },
              { path: '/organizations/:orgId/sales/customers/new', element: <CreateCustomer /> },
              { path: '/organizations/:orgId/sales/customers/:id/edit', element: <EditCustomer /> },
              { path: '/organizations/:orgId/purchases/po', element: <PurchasesPage /> },
              { path: '/organizations/:orgId/purchases/bills', element: <PurchasesPage /> },
              { path: '/organizations/:orgId/items', element: <ItemsList /> },
              { path: '/organizations/:orgId/items/new', element: <CreateItemPage /> },
              { path: '/organizations/:orgId/items/:id/edit', element: <EditItemPage /> },
            ],
          },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/organizations', element: <OrganizationsList /> },
        ],
      },
      // Moved outside AppLayout so settings takes the full page
      {
        path: '/organizations/:orgId/settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <OrganizationSettingsPage /> },
          { path: 'members', element: <InviteMembersPage /> },
          { path: 'roles', element: <RolesPage /> },
          { path: 'inventory/uom', element: <UnitOfMeasurementPage /> },
          { path: 'configuration/currencies', element: <CurrenciesPage /> },
          { path: 'modules', element: <ModulesListPage /> },
          { path: 'modules/:entityType', element: <ModuleFieldsPage /> },
        ],
      },
      { path: '/organizations/new', element: <CreateOrganizationForm /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

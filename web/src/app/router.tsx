import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { SignupPage } from '../features/auth/SignupPage';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { PurchasesPage } from '../features/purchases/PurchasesPage';
import { ProtectedRoute } from '../routes/ProtectedRoute';
import { RequireOrganization } from '../routes/RequireOrganization';
import { OrganizationsList } from '../features/organizations/OrganizationsList';
import { CreateOrganizationForm } from '../features/organizations/CreateOrganizationForm';
import { ProfilePage } from '../features/profile/ProfilePage';
import { OrganizationSettingsPage } from '../features/organizations/OrganizationSettingsPage';
import { AcceptInvitePage } from '../features/invitations/AcceptInvitePage';
import { InviteMembersPage } from '../features/invitations/InviteMembersPage';
import { AppLayout } from '../components/layout/AppLayout';
import { VendorsList } from '../features/purchases/vendors/VendorsList';
import { CreateVendor } from '../features/purchases/vendors/CreateVendor';

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
          {
            element: <RequireOrganization />,
            children: [
              { path: '/', element: <DashboardPage /> },
              { path: '/purchases', element: <PurchasesPage /> },
              { path: '/purchases/vendors', element: <VendorsList /> },
              { path: '/purchases/vendors/new', element: <CreateVendor /> },
              { path: '/purchases/po', element: <PurchasesPage /> },
              { path: '/purchases/bills', element: <PurchasesPage /> },
            ],
          },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/organizations', element: <OrganizationsList /> },
          { path: '/organizations/:id/settings', element: <OrganizationSettingsPage /> },
        ],
      },
      { path: '/organizations/new', element: <CreateOrganizationForm /> },
      { path: '/organizations/:id/settings', element: <OrganizationSettingsPage /> },
      { path: '/organizations/:id/members', element: <InviteMembersPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

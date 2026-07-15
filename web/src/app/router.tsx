import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { SignupPage } from '../features/auth/SignupPage';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { ProtectedRoute } from '../routes/ProtectedRoute';
import { RequireOrganization } from '../routes/RequireOrganization';
import { OrganizationsList } from '../features/organizations/OrganizationsList';
import { CreateOrganizationForm } from '../features/organizations/CreateOrganizationForm';
import { ProfilePage } from '../features/profile/ProfilePage';

import { OrganizationSettingsPage } from '../features/organizations/OrganizationSettingsPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <RequireOrganization />,
        children: [
          { path: '/', element: <DashboardPage /> },
        ],
      },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/organizations', element: <OrganizationsList /> },
      { path: '/organizations/new', element: <CreateOrganizationForm /> },
      { path: '/organizations/:id/settings', element: <OrganizationSettingsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);


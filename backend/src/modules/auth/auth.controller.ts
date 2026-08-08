import type { Request, Response } from 'express';
import { ApiError } from '../../lib/apiError.ts';
import { sendSuccess } from '../../lib/apiResponse.ts';
import { clearTokenCookies, setRefreshTokenAsCookie } from '../../lib/cookies.ts';
import { readSessionId } from '../../lib/jwt.ts';
import type {
  LoginInput,
  SignupInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  UpdateProfileInput,
  ChangePasswordInput,
  UpdateLocationInput,
} from './auth.schemas.ts';
import * as authService from './auth.service.ts';

export async function signup(req: Request, res: Response): Promise<void> {
  const { accessToken, refreshToken, user, refreshTokenExpiresAt } = await authService.signup(
    req.body as SignupInput,
    req.get('user-agent') ?? 'unknown',
    req.ip,
  );

  setRefreshTokenAsCookie(res, refreshToken, refreshTokenExpiresAt);
  sendSuccess(res, { user, accessToken }, 'Account created.', 201);
}

export async function login(req: Request, res: Response): Promise<void> {
  const userAgent = req.get('user-agent') ?? 'unknown';
  const { accessToken, refreshToken, user, refreshTokenExpiresAt } = await authService.login(
    req.body as LoginInput,
    userAgent,
    req.ip,
  );

  setRefreshTokenAsCookie(res, refreshToken, refreshTokenExpiresAt);
  sendSuccess(res, { user, accessToken }, 'Signed in.');
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const presentedToken = req.cookies.refreshToken as string | undefined;

  if (!presentedToken) {
    throw new ApiError(401, 'No refresh token provided.');
  }

  // `refreshToken` is the SAME token that came in — it is no longer rotated. The
  // cookie is re-sent anyway so its expiry stays pinned to the session row, and
  // so a browser that somehow lost it gets it back.
  const { accessToken, refreshToken, user, refreshTokenExpiresAt } =
    await authService.refresh(presentedToken);

  setRefreshTokenAsCookie(res, refreshToken, refreshTokenExpiresAt);
  sendSuccess(res, { user, accessToken }, 'Session refreshed.');
}

/**
 * The signed-in user's own login history — every session, live and ended.
 *
 * No `requirePermission`: this is not tenant data, it is the caller's own
 * account activity, and it is scoped to `req.user.id` rather than anything the
 * client sends. An org-wide version would be a different route on the users
 * module, gated on `user:read`.
 */
export async function mySessions(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new ApiError(401, 'Sign in to continue.');
  }

  const sessions = await authService.listUserSessions(req.user.id);
  sendSuccess(res, { sessions });
}

export async function logout(req: Request, res: Response): Promise<void> {
  // Identify the session to end without any device metadata (Way-1): read the
  // `sid` from the Bearer access token. Expiry is ignored on purpose — the
  // access token may have lapsed, but the signed `sid` still names the exact
  // session row. If the client no longer holds an access token (e.g. logout
  // right after a reload), fall back to the httpOnly refresh cookie.
  const header = req.headers.authorization;
  const accessToken = header?.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : undefined;
  const refreshToken = req.cookies.refreshToken as string | undefined;

  try {
    if (accessToken) {
      await authService.logout(readSessionId(accessToken));
    } else if (refreshToken) {
      await authService.logoutByToken(refreshToken);
    }
  } catch {
    // Missing/forged token — nothing to revoke, but still clear the cookie.
  }

  clearTokenCookies(res);
  sendSuccess(res, null, 'Logged out successfully');
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new ApiError(401, 'Sign in to continue.');
  }

  const user = await authService.getUserById(req.user.id);
  sendSuccess(res, { user });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new ApiError(401, 'Sign in to continue.');
  }

  const user = await authService.updateProfile(req.user.id, req.body as UpdateProfileInput);
  sendSuccess(res, { user });
}

export async function updateLocation(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new ApiError(401, 'Sign in to continue.');
  }

  const header = req.headers.authorization;
  const accessToken = header?.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : undefined;

  if (!accessToken) {
    throw new ApiError(401, 'No active session.');
  }

  const sessionId = readSessionId(accessToken);
  const input = req.body as UpdateLocationInput;

  await authService.updateLocation(req.user.id, sessionId, input.latitude, input.longitude);
  sendSuccess(res, null);
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new ApiError(401, 'Sign in to continue.');
  }

  await authService.changePassword(req.user.id, req.body as ChangePasswordInput);
  sendSuccess(res, null, 'Password changed successfully.');
}

export async function uploadAvatar(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new ApiError(401, 'Sign in to continue.');
  }

  const file = req.file;
  if (!file) {
    throw ApiError.badRequest('No image file provided.');
  }

  const user = await authService.uploadAvatar(req.user.id, file);
  sendSuccess(res, { user }, 'Avatar uploaded successfully.');
}

export async function deleteAvatar(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new ApiError(401, 'Sign in to continue.');
  }

  const user = await authService.deleteAvatar(req.user.id);
  sendSuccess(res, { user }, 'Avatar deleted successfully.');
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as ForgotPasswordInput;
  await authService.requestPasswordReset(email);
  sendSuccess(
    res,
    null,
    'If an account with that email exists, we sent you a password reset link.',
  );
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  await authService.resetPassword(req.body as ResetPasswordInput);
  sendSuccess(res, null, 'Your password has been successfully reset.');
}

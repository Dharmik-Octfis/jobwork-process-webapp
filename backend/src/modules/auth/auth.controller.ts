import type { Request, Response } from 'express';
import { ApiError } from '../../lib/apiError.ts';
import { clearTokenCookies, setAccessTokenAsCookie } from '../../lib/cookies.ts';
import type { LoginInput, SignupInput, ForgotPasswordInput, ResetPasswordInput } from './auth.schemas.ts';
import * as authService from './auth.service.ts';

export async function signup(req: Request, res: Response): Promise<void> {
  const { accessToken, refreshToken, user } = await authService.signup(req.body as SignupInput);
  
  setAccessTokenAsCookie(res, accessToken);
  res.status(201).json({ user, refreshToken });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { accessToken, refreshToken, user } = await authService.login(req.body as LoginInput);
  
  setAccessTokenAsCookie(res, accessToken);
  res.status(200).json({ user, refreshToken });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const oldRefreshToken = req.body.refreshToken;
  
  if (!oldRefreshToken) {
    throw new ApiError(401, 'No refresh token provided.');
  }

  const { accessToken, refreshToken, user } = await authService.refresh(oldRefreshToken);
  
  setAccessTokenAsCookie(res, accessToken);
  res.status(200).json({ user, refreshToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const refreshToken = req.body.refreshToken;
  
  if (refreshToken) {
    await authService.logout(refreshToken);
  }
  
  clearTokenCookies(res);
  res.status(200).json({ message: 'Logged out successfully' });
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new ApiError(401, 'Sign in to continue.');
  }

  const user = await authService.getUserById(req.user.id);
  res.status(200).json({ user });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as ForgotPasswordInput;
  await authService.requestPasswordReset(email);
  res.status(200).json({ message: 'If an account with that email exists, we sent you a password reset link.' });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  await authService.resetPassword(req.body as ResetPasswordInput);
  res.status(200).json({ message: 'Your password has been successfully reset.' });
}

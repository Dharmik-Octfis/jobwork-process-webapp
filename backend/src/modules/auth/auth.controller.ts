import type { Request, Response } from 'express';
import { ApiError } from '../../lib/apiError.ts';
import type { LoginInput, SignupInput } from './auth.schemas.ts';
import * as authService from './auth.service.ts';

/**
 * Controllers know HTTP and nothing else: read the request, call the service,
 * send the response (architecture §4). No try/catch — Express 5 forwards a
 * rejected promise to `errorHandler` on its own.
 */

export async function signup(req: Request, res: Response): Promise<void> {
  // `validateBody` has already parsed and normalized this.
  const result = await authService.signup(req.body as SignupInput);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body as LoginInput);
  res.status(200).json(result);
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    // Unreachable behind `authenticate`, but the type says optional and a
    // silent `undefined` here would be a security bug rather than a crash.
    throw new ApiError(401, 'Sign in to continue.');
  }

  const user = await authService.getUserById(req.user.id);
  res.status(200).json({ user });
}

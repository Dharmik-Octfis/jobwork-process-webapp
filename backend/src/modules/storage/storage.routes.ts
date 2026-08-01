import { Router } from 'express';
import { proxyFile } from './storage.controller.ts';

export const storageRouter = Router();

storageRouter.get('/stream', proxyFile);

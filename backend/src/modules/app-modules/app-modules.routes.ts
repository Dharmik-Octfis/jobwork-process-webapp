import { Router } from 'express';
import { getAppModules } from './app-modules.controller.js';
import { authenticate } from '../../middlewares/authenticate.js';

const router = Router();

router.get('/', authenticate, getAppModules);

export { router as appModulesRouter };

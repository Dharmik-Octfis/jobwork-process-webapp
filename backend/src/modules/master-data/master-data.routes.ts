import { Router } from 'express';
import { getMasterData } from './master-data.controller.ts';

const masterDataRouter = Router();

masterDataRouter.get('/', getMasterData);

export { masterDataRouter };

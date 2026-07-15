import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.ts';
import { createOrganization, getOrganizations, updateOrganization, deleteOrganization } from './organizations.controller.ts';

export const organizationsRouter = Router();

organizationsRouter.use(authenticate);

organizationsRouter.post('/', createOrganization);
organizationsRouter.get('/', getOrganizations);
organizationsRouter.put('/:id', updateOrganization);
organizationsRouter.delete('/:id', deleteOrganization);

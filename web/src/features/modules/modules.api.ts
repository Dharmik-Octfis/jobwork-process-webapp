import { apiClient } from '../../api/client';
import { appModulesResponseSchema, type AppModule } from './modules.schemas';

export async function fetchAppModules(): Promise<AppModule[]> {
  const response = await apiClient.get(`/modules?t=${Date.now()}`);
  return appModulesResponseSchema.parse(response.data);
}

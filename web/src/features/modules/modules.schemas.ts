import { z } from 'zod';

const baseAppModuleSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  sortIndex: z.number(),
  icon: z.string().nullable(),
  isActive: z.boolean(),
});

export type AppModule = z.infer<typeof baseAppModuleSchema> & {
  children?: AppModule[];
};

export const appModuleSchema: z.ZodType<AppModule> = baseAppModuleSchema.extend({
  children: z.lazy(() => z.array(appModuleSchema)),
});

export const appModulesResponseSchema = z.array(appModuleSchema);

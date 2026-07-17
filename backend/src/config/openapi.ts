import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// 1. Extend Zod with OpenAPI properties before any schemas are evaluated
extendZodWithOpenApi(z);

// 2. Create the central registry
export const openApiRegistry = new OpenAPIRegistry();

// Register JWT Bearer Auth
openApiRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

// 3. Generate the document when requested
export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(openApiRegistry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Jobwork Process API',
      description: 'API for managing the Jobwork process application',
    },
    servers: [{ url: '/api' }],
    security: [{ bearerAuth: [] }],
  });
}

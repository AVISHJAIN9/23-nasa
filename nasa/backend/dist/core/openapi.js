import { OpenAPIRegistry, OpenApiGeneratorV3, } from '@asteasolutions/zod-to-openapi';
import { ErrorResponseSchema } from '../schemas/common.js';
export const globalOpenApiRegistry = new OpenAPIRegistry();
// Register shared schemas so they appear in components/schemas
globalOpenApiRegistry.register('ErrorResponse', ErrorResponseSchema);
export const SHARED_ERROR_RESPONSES = {
    400: {
        description: 'Bad Request - Malformed JSON or bad input structure',
        content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    401: {
        description: 'Unauthenticated - Missing, invalid, or expired credentials',
        content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    403: {
        description: 'Forbidden - Insufficient permissions or role required',
        content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
        description: 'Not Found - The requested resource does not exist',
        content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    409: {
        description: 'Conflict - Resource state conflict or concurrent mutation',
        content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    422: {
        description: 'Validation Error - Field constraints or validation failed',
        content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    429: {
        description: 'Rate Limited - Request threshold exceeded',
        content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    500: {
        description: 'Internal Server Error - Unexpected server condition masked for security',
        content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    503: {
        description: 'Service Unavailable - Degradation or subsystem failure',
        content: { 'application/json': { schema: ErrorResponseSchema } },
    },
};
/**
 * Registers an API route in the OpenAPI registry.
 * Forces tags, summary, a success response schema, and shared error responses.
 */
export function registerRoute(config, registry = globalOpenApiRegistry) {
    if (!config.tags || config.tags.length === 0) {
        throw new Error(`Route [${config.method.toUpperCase()} ${config.path}] must specify at least one tag.`);
    }
    if (!config.summary || config.summary.trim().length === 0) {
        throw new Error(`Route [${config.method.toUpperCase()} ${config.path}] must specify a non-empty summary.`);
    }
    if (!config.successResponse || !config.successResponse.schema) {
        throw new Error(`Route [${config.method.toUpperCase()} ${config.path}] must specify a success response schema.`);
    }
    const successStatus = config.successResponse.status ?? config.successResponse.statusCode ?? 200;
    registry.registerPath({
        method: config.method,
        path: config.path,
        tags: config.tags,
        summary: config.summary,
        description: config.description,
        request: config.request,
        responses: {
            [successStatus]: {
                description: config.successResponse.description,
                content: {
                    'application/json': {
                        schema: config.successResponse.schema,
                    },
                },
            },
            ...SHARED_ERROR_RESPONSES,
        },
    });
}
/**
 * Generates the complete OpenAPI 3.0 documentation object.
 */
export function generateOpenApiDocument(registry = globalOpenApiRegistry, version = '0.1.0') {
    const generator = new OpenApiGeneratorV3(registry.definitions);
    return generator.generateDocument({
        openapi: '3.0.0',
        info: {
            title: 'AstroCare API',
            version,
            description: 'AstroCare: Space-medicine decision-support backend prototype for astronaut healthcare, vital monitoring, and autonomous tele-medicine.',
        },
        servers: [
            {
                url: '/',
                description: 'Current environment server',
            },
        ],
    });
}

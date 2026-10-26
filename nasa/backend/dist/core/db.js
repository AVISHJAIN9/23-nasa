import mongoose from 'mongoose';
import { defaultReadinessRegistry } from './readiness.js';
import { logger } from './logger.js';
/**
 * Registers the MongoDB connection readiness check.
 */
export function registerMongoReadinessCheck(registry = defaultReadinessRegistry) {
    registry.registerCheck('mongodb', async () => {
        const state = mongoose.connection.readyState;
        const isConnected = state === 1;
        const stateLabels = {
            0: 'Disconnected',
            1: 'Connected',
            2: 'Connecting',
            3: 'Disconnecting',
        };
        return {
            ok: isConnected,
            message: stateLabels[state] ?? `Unknown state: ${state}`,
        };
    });
}
// Automatically register readiness check on default registry
registerMongoReadinessCheck();
/**
 * Connects to MongoDB with the given URI and configures connection event logging.
 */
export async function connectMongo(uri) {
    logger.info({ uri: uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@') }, 'Connecting to MongoDB...');
    try {
        const conn = await mongoose.connect(uri, {
            autoIndex: true,
            serverSelectionTimeoutMS: 5000,
        });
        logger.info('MongoDB connected successfully.');
        return conn;
    }
    catch (err) {
        logger.error({ err }, 'Failed to connect to MongoDB.');
        throw err;
    }
}
/**
 * Disconnects from MongoDB.
 */
export async function disconnectMongo() {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
        logger.info('MongoDB disconnected.');
    }
}

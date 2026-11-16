import type { AuthUser } from './auth';

export const agentScope = (actor?: AuthUser) => actor && actor.role !== 'ADMIN' ? { ownerId: actor.id } : {};
export const runScope = (actor?: AuthUser) => actor && actor.role !== 'ADMIN' ? { ownerId: actor.id } : {};
export const taskReadScope = (actor?: AuthUser) => actor && actor.role !== 'ADMIN' ? { OR: [{ ownerId: actor.id }, { isShared: true }] } : {};
export const taskWriteScope = (actor?: AuthUser) => actor && actor.role !== 'ADMIN' ? { ownerId: actor.id } : {};

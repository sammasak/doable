// src/lib/auth/session.ts
import { EncryptJWT, jwtDecrypt } from 'jose';
import { env } from '$env/dynamic/private';

export interface Session {
	userId: string;
	email: string;
	expiresAt: number;
}

function getKey(): Uint8Array {
	const secret = env.SESSION_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error('SESSION_SECRET env var must be at least 32 characters');
	}
	return new TextEncoder().encode(secret.slice(0, 32));
}

export async function encryptSession(session: Session): Promise<string> {
	return new EncryptJWT(session as unknown as Record<string, unknown>)
		.setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
		.setIssuedAt()
		.setExpirationTime('7d')
		.encrypt(getKey());
}

export async function decryptSession(token: string): Promise<Session | null> {
	try {
		const { payload } = await jwtDecrypt(token, getKey());
		if (
			!payload ||
			typeof payload.userId !== 'string' ||
			typeof payload.email !== 'string'
		) {
			return null;
		}
		return payload as unknown as Session;
	} catch {
		return null;
	}
}

// src/app.d.ts
declare global {
	namespace App {
		interface Locals {
			userId: string | null;
			email: string | null;
		}
	}
}

export {};

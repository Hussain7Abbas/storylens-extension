import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadEnvFile(path: string): void {
	if (!existsSync(path)) {
		return;
	}

	for (const line of readFileSync(path, "utf-8").split("\n")) {
		const trimmed = line.trim();

		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		const separatorIndex = trimmed.indexOf("=");
		if (separatorIndex === -1) {
			continue;
		}

		const key = trimmed.slice(0, separatorIndex).trim();
		const rawValue = trimmed.slice(separatorIndex + 1).trim();
		const value = rawValue.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

		if (key && process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env"));

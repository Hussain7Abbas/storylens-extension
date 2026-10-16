import { afterEach, beforeEach, expect, test } from "bun:test";

const { cancelPrompt, generateDesktopImage } = await import(
	"../src/lib/desktop-client/background"
);

import { fakeBrowser, resetFakeBrowser } from "./helpers/fake-browser";

const originalFetch = globalThis.fetch;
const input = {
	requestId: "cover-job",
	prompt: "A chapter scene",
	model: "codex",
	effort: "default",
	referenceImageUrls: ["https://images.example.invalid/mira.png"],
};
beforeEach(async () => {
	resetFakeBrowser();
	await fakeBrowser.storage.local.set({
		"storylens-desktop-client": {
			token: "paired",
			model: "codex",
			effort: "default",
			port: 43127,
		},
	});
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});
test("Stop during the reference capability check cannot start a later image job", async () => {
	const begun = Promise.withResolvers<AbortSignal>();
	globalThis.fetch = (async (_url, init) => {
		const signal = init?.signal as AbortSignal;
		begun.resolve(signal);
		return new Promise<Response>((_resolve, reject) =>
			signal.addEventListener(
				"abort",
				() => reject(new DOMException("Aborted", "AbortError")),
				{ once: true },
			),
		);
	}) as typeof fetch;
	const job = generateDesktopImage(input, 5);
	const signal = await begun.promise;
	cancelPrompt(input.requestId, 6);
	expect(signal.aborted).toBe(false);
	cancelPrompt(input.requestId, 5);
	await expect(job).rejects.toThrow("Aborted");
	expect(signal.aborted).toBe(true);
});
for (const supported of [false, true])
	test(`references are ${supported ? "attached for supported" : "omitted for older"} desktop companions`, async () => {
		let body: Record<string, unknown> = {};
		globalThis.fetch = (async (url, init) => {
			if (String(url).endsWith("/capabilities"))
				return Response.json({
					protocolVersion: 2,
					models: [],
					limits: { promptBytes: 500000 },
					features: { imageGeneration: true, imageReferences: supported },
				});
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					type: "result",
					mimeType: "image/png",
					data: "aW1hZ2U=",
				}) + "\n",
			);
		}) as typeof fetch;
		expect((await generateDesktopImage(input, 5)).mimeType).toBe("image/png");
		expect(body.referenceImageUrls).toEqual(
			supported ? input.referenceImageUrls : undefined,
		);
	});

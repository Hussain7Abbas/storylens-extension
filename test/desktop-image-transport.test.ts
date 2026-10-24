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
	test(`structured descriptions ${supported ? "allow" : "block"} desktop image requests`, async () => {
		let body: Record<string, unknown> | undefined;
		globalThis.fetch = (async (url, init) => {
			if (String(url).endsWith("/capabilities"))
				return Response.json({
					protocolVersion: 2,
					models: [],
					limits: { promptBytes: 500000 },
					features: {
						imageGeneration: true,
						imageReferences: true,
						structuredImageDescriptions: supported,
					},
				});
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(
				`${JSON.stringify({ type: "result", mimeType: "image/png", data: "AA==", imageDescription: "A silver-haired scout." })}\n`,
			);
		}) as typeof fetch;
		const request = generateDesktopImage(
			{ ...input, promptIsDescription: true },
			5,
		);
		if (!supported) {
			await expect(request).rejects.toThrow(
				"Update the Story Lens desktop companion",
			);
			expect(body).toBeUndefined();
		} else {
			const result = await request;
			expect(result.imageDescription).toBe("A silver-haired scout.");
			expect(body?.referenceImageUrls).toEqual(input.referenceImageUrls);
			expect(body?.promptIsDescription).toBeUndefined();
		}
	});

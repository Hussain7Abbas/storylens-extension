import { describe, expect, test } from "bun:test";
import type { GetBillingPricing200 } from "@/api/generated/schemas";
import { aiAvailability } from "@/lib/ai-source/availability";
import { runLocalizedPrompt } from "@/lib/ai-source/prompt-runner";
import { parseAiSource } from "@/lib/ai-source/source";
import { accountBalance, cacheFresh } from "@/lib/billing/cache";
import {
	CloudAiError,
	cloudFailure,
	unwrapAiReply,
} from "@/lib/cloud-ai/errors";
import { cloudRequest } from "@/lib/cloud-ai/transport";

const desktop = { port: 43127, token: "", model: "", effort: "" };
const paired = { ...desktop, token: "paired", model: "m", effort: "low" };
const pricing: GetBillingPricing200 = {
	currency: "USD",
	available: true,
	lensPriceUsd: "0.01",
	lensPriceMicros: 10000,
	trialLenses: 10,
	request: { min: 100, max: 50000, pendingMax: 3 },
	cloudAi: { enabled: true },
	features: [
		{
			key: "page_summary",
			nameEn: "Summary",
			nameAr: "ملخص",
			descriptionEn: null,
			descriptionAr: null,
			lenses: 2,
			enabled: true,
			maxPromptChars: 200000,
		},
	],
};
test("existing paired installs stay on desktop; explicit source wins", () => {
	expect(parseAiSource(undefined, paired)).toBe("desktop");
	expect(parseAiSource(undefined, desktop)).toBe("cloud");
	expect(parseAiSource("cloud", paired)).toBe("cloud");
	expect(parseAiSource("desktop", desktop)).toBe("desktop");
});
test("availability covers accounts, sources, kill switch and feature switch", () => {
	const base = {
		source: "cloud" as const,
		desktop,
		user: { isGuest: false },
		pricing,
		feature: "page_summary" as const,
	};
	expect(aiAvailability(base)).toEqual({ ok: true });
	expect(aiAvailability({ ...base, source: "desktop" })).toEqual({
		ok: false,
		reason: "desktop-unpaired",
	});
	expect(
		aiAvailability({
			...base,
			source: "desktop",
			desktop: paired,
			user: null,
			pricing: null,
		}),
	).toEqual({ ok: true });
	expect(aiAvailability({ ...base, user: null })).toEqual({
		ok: false,
		reason: "signed-out",
	});
	expect(aiAvailability({ ...base, user: { isGuest: true } })).toEqual({
		ok: false,
		reason: "guest",
	});
	expect(aiAvailability({ ...base, pricing: null })).toEqual({
		ok: false,
		reason: "cloud-off",
	});
	expect(
		aiAvailability({
			...base,
			pricing: { ...pricing, cloudAi: { enabled: false } },
		}),
	).toEqual({ ok: false, reason: "cloud-off" });
	expect(
		aiAvailability({
			...base,
			pricing: {
				...pricing,
				features: [{ ...pricing.features[0], enabled: false }],
			},
		}),
	).toEqual({ ok: false, reason: "feature-off" });
});
test("pricing age and balances are scoped to the signed-in account", () => {
	expect(cacheFresh({ fetchedAt: 1000 }, 600, 1500)).toBe(true);
	expect(cacheFresh({ fetchedAt: 1000 }, 600, 1600)).toBe(false);
	expect(cacheFresh(undefined, 600)).toBe(false);
	expect(
		accountBalance({ userId: "a", balance: 42, updatedAt: 0 }, "b"),
	).toBeNull();
	expect(accountBalance({ userId: "a", balance: 42, updatedAt: 0 }, "a")).toBe(
		42,
	);
});
function stream(frames: unknown[], chunkSize = 7) {
	const data = new TextEncoder().encode(
		frames.map((frame) => `${JSON.stringify(frame)}\n`).join(""),
	);
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (let offset = 0; offset < data.length; offset += chunkSize)
					controller.enqueue(data.slice(offset, offset + chunkSize));
				controller.close();
			},
		}),
		{ headers: { "content-type": "application/x-ndjson" } },
	);
}
const input = {
	url: "https://api.example/api/user/ai/prompts",
	body: { actionId: "action", attempt: 1 },
	token: "secret",
	language: "ar",
	version: "extension/3.4.0",
	signal: new AbortController().signal,
	maxBytes: 10000,
};
test("streaming reads split UTF-8 and metadata, sends auth, language and version", async () => {
	const balances: number[] = [];
	const value = await cloudRequest(input, {
		fetch: async (_url, init) => {
			expect(init?.headers).toMatchObject({
				Authorization: "Bearer secret",
				"Accept-Language": "ar",
				"X-Client-Version": "extension/3.4.0",
			});
			return stream([
				{ type: "started", balance: 8 },
				{ type: "heartbeat" },
				{ type: "result", output: "ملخص", balance: 8, lensesCharged: 2 },
			]);
		},
		onFrame: async (frame) => {
			if (frame.balance !== undefined) balances.push(frame.balance);
		},
		onUpgrade: async () => {},
	});
	expect(value.output).toBe("ملخص");
	expect(balances).toEqual([8, 8]);
});
test("stream error preserves refunds and balance through the message boundary", async () => {
	try {
		await cloudRequest(input, {
			fetch: async () =>
				stream([
					{ type: "started", balance: 8 },
					{
						type: "error",
						error: { code: "AI_TIMEOUT", message: "Timed out" },
						refunded: true,
						balance: 10,
					},
				]),
			onFrame: async () => {},
			onUpgrade: async () => {},
		});
		throw new Error("must fail");
	} catch (error) {
		expect(error).toBeInstanceOf(CloudAiError);
		expect(error).toMatchObject({
			code: "AI_TIMEOUT",
			details: { refunded: true, balance: 10 },
		});
	}
	expect(() =>
		unwrapAiReply({
			ok: false,
			failure: cloudFailure(402, {
				error: {
					code: "INSUFFICIENT_LENSES",
					details: { required: 3, balance: 1 },
				},
			}),
		}),
	).toThrow(CloudAiError);
});
for (const [status, code] of [
	[401, "SIGNED_OUT"],
	[402, "INSUFFICIENT_LENSES"],
	[403, "REGISTERED_ACCOUNT_REQUIRED"],
	[404, "CLOUD_NOT_READY"],
	[413, "PROMPT_TOO_LARGE"],
	[426, "UPGRADE_REQUIRED"],
	[429, "AI_RATE_LIMITED"],
	[503, "AI_UNAVAILABLE"],
] as const)
	test(`HTTP ${status} maps to ${code}`, async () => {
		let upgrades = 0;
		await expect(
			cloudRequest(input, {
				fetch: async () => new Response("{}", { status }),
				onFrame: async () => {},
				onUpgrade: async () => {
					upgrades++;
				},
			}),
		).rejects.toMatchObject({ code });
		expect(upgrades).toBe(status === 426 ? 1 : 0);
	});
test("JSON fallback doesn't send a second paid request", async () => {
	let requests = 0;
	const value = await cloudRequest(input, {
		fetch: async () => {
			requests++;
			return Response.json({ output: "answer", balance: 8 });
		},
		onFrame: async () => {},
		onUpgrade: async () => {},
	});
	expect(value.output).toBe("answer");
	expect(requests).toBe(1);
});
test("cancellation passes the same signal to fetch", async () => {
	const controller = new AbortController();
	const promise = cloudRequest(
		{ ...input, signal: controller.signal },
		{
			fetch: async (_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					);
				}),
			onFrame: async () => {},
			onUpgrade: async () => {},
		},
	);
	controller.abort();
	await expect(promise).rejects.toMatchObject({ name: "AbortError" });
});
describe("localized retries", () => {
	function runner(
		execute: (prompt: string, id: string, attempt: 1 | 2) => Promise<string>,
	) {
		return runLocalizedPrompt({
			prompt: "instructions",
			language: "ar",
			cloud: true,
			signal: new AbortController().signal,
			execute,
			parse: (text) => JSON.parse(text) as { description: string },
			texts: (result) => [result.description],
		});
	}
	test("language retry uses the same action ID and exactly two attempts", async () => {
		const calls: { id: string; attempt: number; prompt: string }[] = [];
		const result = await runner(async (prompt, id, attempt) => {
			calls.push({ id, attempt, prompt });
			return JSON.stringify({
				description: attempt === 1 ? "A tall man" : "رجل طويل",
			});
		});
		expect(result.description).toBe("رجل طويل");
		expect(calls.map((c) => c.attempt)).toEqual([1, 2]);
		expect(calls[0].id).toBe(calls[1].id);
		expect(calls[1].prompt).toContain("Arabic");
	});
	test("failed correction keeps the paid usable first result", async () => {
		expect(
			(
				await runner(async (_prompt, _id, attempt) => {
					if (attempt === 2) throw new Error("timeout");
					return '{"description":"A tall man"}';
				})
			).description,
		).toBe("A tall man");
	});
	test("malformed JSON gets one correction on the same action", async () => {
		let second = "";
		const result = await runner(async (prompt, _id, attempt) => {
			if (attempt === 1) return "not json";
			second = prompt;
			return '{"description":"رجل طويل"}';
		});
		expect(second).toContain("not valid JSON");
		expect(result.description).toBe("رجل طويل");
	});
});

test("cancellation belongs to the originating owner, including tab closure", async () => {
	const { JobControllers } = await import(
		"../src/lib/cloud-ai/job-controllers"
	);
	const jobs = new JobControllers();
	const one = jobs.begin("one", 1),
		two = jobs.begin("two", 2),
		three = jobs.begin("three", 1);
	jobs.cancel("one", 2);
	expect(one.signal.aborted).toBe(false);
	jobs.cancel("one", 1);
	expect(one.signal.aborted).toBe(true);
	jobs.cancelOwner(1);
	expect(three.signal.aborted).toBe(true);
	expect(two.signal.aborted).toBe(false);
	expect(() => jobs.begin("two", 1)).toThrow("already running");
	jobs.end("two");
	expect(jobs.begin("two", 1).signal.aborted).toBe(false);
});

test("JSON fallback enforces its response size without replaying a request", async () => {
	const { readCloudFrame } = await import("../src/lib/cloud-ai/frames");
	await expect(
		readCloudFrame(
			new Response(JSON.stringify({ output: "x".repeat(100) }), {
				headers: { "content-type": "application/json" },
			}),
			20,
			async () => {},
		),
	).rejects.toThrow("size limit");
});

test("Cloud summary excludes controls, author-hidden nodes and extension markup", async () => {
	const { JSDOM } = await import("jsdom");
	const { summaryBodyText } = await import(
		"../src/lib/desktop-client/summary-text"
	);
	const dom = new JSDOM(
		'<style>.private{display:none}</style><body><p>Chapter one</p><p>مرحبا</p><form>private form<input value="secret"></form><span class="private">hidden secret</span><span hidden>hidden</span><div id="storylens-page-launcher">extension text</div><script>script secret</script></body>',
	);
	try {
		expect(summaryBodyText(dom.window.document.body)).toBe(
			"Chapter one\n\nمرحبا",
		);
	} finally {
		dom.window.close();
	}
});

test("content-script lens labels use all Arabic plural categories", async () => {
	const { vanillaAiText } = await import("../src/lib/cloud-ai/vanilla-text");
	const ar = vanillaAiText("ar"),
		en = vanillaAiText("en");
	expect(ar("lens.count", { count: 1, formatted: "1" })).toBe("عدسة واحدة");
	expect(ar("lens.count", { count: 2, formatted: "2" })).toBe("عدستان");
	expect(ar("lens.count", { count: 3, formatted: "3" })).toBe("3 عدسات");
	expect(ar("lens.count", { count: 11, formatted: "11" })).toBe("11 عدسة");
	expect(ar("lens.count", { count: 100, formatted: "100" })).toBe("100 عدسة");
	expect(en("lens.count", { count: 1, formatted: "1" })).toBe("1 lens");
	expect(en("lens.count", { count: 3, formatted: "3" })).toBe("3 lenses");
});

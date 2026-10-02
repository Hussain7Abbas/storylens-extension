import { browser } from "#imports";
import {
	extensionClientVersion,
	requestExtensionUpdate,
} from "@/api/client-compat";
import { env } from "@/env";
import { aiState } from "@/lib/ai-source/storage";
import { getStoredAuth } from "@/lib/auth/auth-storage";
import {
	refreshAiPricing,
	refreshLensBalance,
	updateFrameBalance,
} from "@/lib/billing/background";
import { type BalanceCache, LENS_BALANCE_KEY } from "@/lib/billing/cache";
import { getStoredLanguage } from "@/utils/stored-language";
import type { GeneratedImage } from "../desktop-client/types";
import { CloudAiError } from "./errors";
import { JobControllers } from "./job-controllers";
import { cloudRequest } from "./transport";
import type { AiImageInput, AiPromptInput } from "./types";

// Only live controllers are in memory. No account, price, balance or notices depend on the worker's lifetime.
const active = new JobControllers();
export function cancelCloudPrompt(id: string, owner: number): void {
	active.cancel(id, owner);
}
export function cancelCloudTabPrompts(owner: number): void {
	active.cancelOwner(owner);
}
async function run(
	data: AiPromptInput | AiImageInput,
	owner: number,
	image: boolean,
) {
	const controller = active.begin(data.requestId, owner);
	const timeout = setTimeout(
		() => controller.abort(),
		image ? 300_000 : 180_000,
	);
	// Extension API activity keeps an MV3 worker alive for this bounded, user-requested operation.
	const keepAlive = setInterval(() => {
		void browser.runtime.getPlatformInfo().catch(() => {});
	}, 20_000);
	try {
		await refreshAiPricing(30 * 60_000);
		const feature = image ? "character_image" : (data as AiPromptInput).feature;
		const state = await aiState(feature);
		const auth = await getStoredAuth();
		if (!auth.user || !auth.token)
			throw new CloudAiError({
				code: "SIGNED_OUT",
				message: "Sign in to use Story Lens Cloud.",
				details: {},
			});
		if (auth.user.isGuest)
			throw new CloudAiError({
				code: "REGISTERED_ACCOUNT_REQUIRED",
				message: "Create a free account to use Story Lens Cloud.",
				details: {},
			});
		const price = state.pricing?.features.find((row) => row.key === feature);
		if (price && data.prompt.length > price.maxPromptChars)
			throw new CloudAiError({
				code: "PROMPT_TOO_LARGE",
				message: "This text is too long for Story Lens Cloud.",
				details: { maxChars: price.maxPromptChars },
			});
		const cached = (await browser.storage.local.get(LENS_BALANCE_KEY))[
			LENS_BALANCE_KEY
		] as BalanceCache | undefined;
		if (
			(image || (data as AiPromptInput).attempt === 1) &&
			cached?.userId === auth.user.id &&
			Date.now() - cached.updatedAt < 60_000 &&
			cached.balance < (price?.lenses ?? 0)
		) {
			throw new CloudAiError({
				code: "INSUFFICIENT_LENSES",
				message: "You do not have enough lenses.",
				details: { required: price?.lenses, balance: cached.balance },
			});
		}
		const prompt = data as AiPromptInput;
		const userId = auth.user.id;
		return await cloudRequest(
			{
				url: `${env.WXT_API_URL.replace(/\/$/, "")}/api/user/ai/${image ? "images" : "prompts"}`,
				body: {
					actionId: data.actionId,
					feature,
					prompt: data.prompt,
					...(!image
						? {
								attempt: prompt.attempt,
								responseLanguage: prompt.responseLanguage,
								...(prompt.novelId ? { novelId: prompt.novelId } : {}),
							}
						: {}),
				},
				token: auth.token,
				language: await getStoredLanguage(),
				version: extensionClientVersion(),
				signal: controller.signal,
				maxBytes: image ? 12_000_000 : 1_100_000,
			},
			{
				// Native worker fetch must not receive the dependencies object as `this`.
				fetch: (url, init) => fetch(url, init),
				onUpgrade: requestExtensionUpdate,
				onFrame: async (frame) => {
					if (typeof frame.balance === "number")
						await updateFrameBalance(userId, frame.balance).catch(() => {});
					if (frame.type === "result" || frame.type === "error")
						await refreshLensBalance();
				},
			},
		);
	} finally {
		clearTimeout(timeout);
		clearInterval(keepAlive);
		active.end(data.requestId);
		controller.abort();
	}
}
export async function executeCloudPrompt(
	data: AiPromptInput,
	owner: number,
): Promise<string> {
	const result = await run(data, owner, false);
	if (typeof result.output !== "string" || !result.output.trim())
		throw new Error("Story Lens Cloud returned no answer.");
	return result.output;
}
export async function generateCloudImage(
	data: AiImageInput,
	owner: number,
): Promise<GeneratedImage> {
	const result = await run(data, owner, true);
	if (
		typeof result.data !== "string" ||
		typeof result.mimeType !== "string" ||
		!result.mimeType.startsWith("image/")
	)
		throw new Error("Story Lens Cloud returned no image.");
	return {
		data: result.data,
		mimeType: result.mimeType,
		revisedPrompt: result.revisedPrompt,
	};
}

import { sendMessage } from "@/entrypoints/background/messaging";
import type { AiImageFeature, AiSource } from "@/lib/ai-source/source";
import { unwrapAiReply } from "@/lib/cloud-ai/errors";
import type { DesktopSettings } from "./types";

function base64File(data: string, mimeType: string, name: string): File {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++)
		bytes[index] = binary.charCodeAt(index);
	const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
	const base =
		name
			.trim()
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-|-$/g, "") || "character";
	return new File([bytes], `${base}.${extension}`, { type: mimeType });
}

export type GeneratedCharacterImage = {
	file: File;
	/** AI-written visual description used for the generated image. */
	prompt?: string;
	revisedPrompt?: string;
	data: string;
	mimeType: string;
};

/** Shared image transport and cancellation for manual and selection requests. */
export async function generateCharacterImage(input: {
	source: AiSource;
	feature?: AiImageFeature;
	referenceImageUrls?: string[];
	settings: DesktopSettings;
	prompt: string;
	name: string;
	/** Legacy hint accepted by transports; text preparation is still mandatory. */
	promptIsDescription?: boolean;
	signal: AbortSignal;
}): Promise<GeneratedCharacterImage> {
	input.signal.throwIfAborted();
	const requestId = crypto.randomUUID();
	const cancel = () => {
		void sendMessage("cancelAiPrompt", requestId).catch(() => {});
	};
	input.signal.addEventListener("abort", cancel, { once: true });
	try {
		const image = unwrapAiReply(
			await sendMessage("generateAiImage", {
				source: input.source,
				...(input.feature ? { feature: input.feature } : {}),
				...(input.referenceImageUrls?.length
					? { referenceImageUrls: input.referenceImageUrls }
					: {}),
				actionId: crypto.randomUUID(),
				requestId,
				prompt: input.prompt,
				...(input.promptIsDescription ? { promptIsDescription: true } : {}),
				// Desktop images always use Codex and its default effort, independently of text.
				model: "codex",
				effort: "default",
			}),
		);
		input.signal.throwIfAborted();
		const prompt =
			image.imageDescription?.trim() || image.revisedPrompt?.trim();
		return {
			prompt,
			file: base64File(image.data, image.mimeType, input.name),
			data: image.data,
			mimeType: image.mimeType,
			revisedPrompt: image.revisedPrompt,
		};
	} finally {
		input.signal.removeEventListener("abort", cancel);
	}
}

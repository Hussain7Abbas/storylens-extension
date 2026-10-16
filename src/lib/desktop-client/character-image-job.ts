import { sendMessage } from "@/entrypoints/background/messaging";
import type { AiSource } from "@/lib/ai-source/source";
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

export type GeneratedCharacterImage = { file: File; revisedPrompt?: string };

/** Shared image transport and cancellation for manual and selection requests. */
export async function generateCharacterImage(input: {
	source: AiSource;
	settings: DesktopSettings;
	prompt: string;
	name: string;
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
				actionId: crypto.randomUUID(),
				requestId,
				prompt: input.prompt,
				model: input.settings.model,
				effort: input.settings.effort,
			}),
		);
		input.signal.throwIfAborted();
		return {
			file: base64File(image.data, image.mimeType, input.name),
			revisedPrompt: image.revisedPrompt,
		};
	} finally {
		input.signal.removeEventListener("abort", cancel);
	}
}

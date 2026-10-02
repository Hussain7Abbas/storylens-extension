import {
	type ResultFrame,
	readResultFrame,
} from "../desktop-client/job-stream";
import { CloudAiError, cloudFailure } from "./errors";
export type CloudFrame = ResultFrame & {
	balance?: number;
	lensesCharged?: number;
	refunded?: boolean;
	revisedPrompt?: string;
};
export async function readCloudFrame(
	response: Response,
	maxBytes: number,
	onFrame: (frame: CloudFrame) => Promise<void>,
): Promise<CloudFrame> {
	// Some browsers expose only JSON responses. Never repeat a paid request to change transport.
	if (!response.headers.get("content-type")?.includes("ndjson")) {
		if (!response.body) throw new Error("Cloud AI sent no response body.");
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let text = "",
			received = 0;
		try {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				received += chunk.value.byteLength;
				if (received > maxBytes)
					throw new Error("Cloud AI response exceeded the size limit.");
				text += decoder.decode(chunk.value, { stream: true });
			}
			text += decoder.decode();
		} finally {
			await reader.cancel().catch(() => {});
			reader.releaseLock();
		}
		const frame = { ...JSON.parse(text), type: "result" } as CloudFrame;
		await onFrame(frame);
		return frame;
	}
	return readResultFrame(response, maxBytes, {
		onFrame: (frame) => onFrame(frame as CloudFrame),
		error: (frame) => new CloudAiError(cloudFailure(502, frame)),
	}) as Promise<CloudFrame>;
}

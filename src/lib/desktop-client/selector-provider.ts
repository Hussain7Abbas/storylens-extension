import { isAiConfigured } from "./ai-config";
import type { DesktopSettings } from "./types";

type DetectionInput = {
	url: string;
	html: string;
	language: string;
	signal: AbortSignal;
};

/** A configured desktop provider is the sole provider for this request. */
export async function detectChapterSelectorsWithProviders<T>(
	input: DetectionInput,
	providers: {
		settings: () => Promise<DesktopSettings>;
		desktop: (
			input: DetectionInput & { settings: DesktopSettings },
		) => Promise<T>;
		backend: (input: Pick<DetectionInput, "url" | "html">) => Promise<T>;
	},
): Promise<T> {
	if (input.signal.aborted) throw new DOMException("Aborted", "AbortError");
	const settings = await providers.settings();
	if (input.signal.aborted) throw new DOMException("Aborted", "AbortError");
	if (isAiConfigured(settings))
		return providers.desktop({ ...input, settings });
	return providers.backend({ url: input.url, html: input.html });
}

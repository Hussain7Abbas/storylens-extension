import type { AiSource } from "../ai-source/source";
import type { DesktopSettings } from "./types";

type DetectionInput = {
	url: string;
	html: string;
	language: string;
	signal: AbortSignal;
};
/** Only the selected source runs; failures never silently switch sources or incur another charge. */
export async function detectChapterSelectorsWithProviders<T>(
	input: DetectionInput,
	providers: {
		source: AiSource;
		settings: () => Promise<DesktopSettings>;
		desktop: (
			input: DetectionInput & { settings: DesktopSettings },
		) => Promise<T>;
		cloud: (input: DetectionInput) => Promise<T>;
	},
): Promise<T> {
	if (input.signal.aborted) throw new DOMException("Aborted", "AbortError");
	if (providers.source === "cloud") return providers.cloud(input);
	const settings = await providers.settings();
	if (input.signal.aborted) throw new DOMException("Aborted", "AbortError");
	return providers.desktop({ ...input, settings });
}

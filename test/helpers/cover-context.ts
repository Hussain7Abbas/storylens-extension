import type {
	ChapterContext,
	ChapterContextRecord,
} from "../../src/lib/chapter-context/schema";
export function coverContext(): ChapterContext {
	return {
		schemaVersion: 1,
		summary: "Mira confronts the guardian on the bridge.",
		scenes: [
			{
				id: "bridge",
				title: "The guardian confrontation",
				environment: {
					location: "Broken stone bridge",
					time: "Dusk",
					weather: "Rain",
					lighting: "Blue fire",
					details: "A shattered arch",
				},
				entities: [
					{
						entityKey: "name:mira",
						keywordId: null,
						name: "Mira",
						kind: "character",
						appearance: "A scar across her cheek",
						condition: "Injured left arm",
						clothing: "Rain-soaked silver armor",
						equipment: ["Sword"],
						pose: "Raises her sword",
						emotion: "Determined",
						relations: ["Confronts the guardian"],
						evidence: "Mira raises her sword.",
					},
				],
			},
		],
		stateChanges: [],
	};
}
export function readyCoverContext(): ChapterContextRecord {
	return {
		context: coverContext(),
		contentHash: "hash",
		generating: false,
		inactiveEntities: [],
	};
}

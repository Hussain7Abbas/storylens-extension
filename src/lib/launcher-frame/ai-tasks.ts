/**
 * AI requests running in a tab, shown under the launcher button so the reader
 * can keep reading while they run. Free of React: the content script, the
 * background relay and the popup all import it.
 *
 * Popup frames report their tasks through the background (`reportAiTask`), so
 * names never pass through the novel site's window; content-script requests
 * (the page summary) report to {@link pageAiTasks} directly.
 */

export const AI_TASK_OPERATIONS = [
	"suggest-keyword",
	"generate-image",
	"summarize",
	"extract-characters",
	"detect-selectors",
] as const;
export type AiTaskOperation = (typeof AI_TASK_OPERATIONS)[number];

/**
 * Where a task runs: the launcher's kept popup, the chapter extraction panel's
 * frame, or the content script itself. A frame's tasks end with its frame.
 */
export const AI_TASK_SOURCES = ["popup", "panel", "page"] as const;
export type AiTaskSource = (typeof AI_TASK_SOURCES)[number];

/**
 * `working` starts a task; `done` and `failed` end it. A done task holds its
 * result (a form to save) until `released`, which also cancels a running one.
 */
export type AiTaskUpdate =
	| {
			id: string;
			state: "working" | "done" | "failed";
			operation: AiTaskOperation;
			/** The keyword, page or site the request is about. */
			subject: string;
	  }
	| { id: string; state: "released" };

export type AiTaskReport = AiTaskUpdate & {
	source: AiTaskSource;
	/** The popup document that runs it, so its card opens that popup tab. */
	frame?: string;
};

export type AiTask = {
	id: string;
	operation: AiTaskOperation;
	subject: string;
	source: AiTaskSource;
	frame?: string;
	state: "working" | "done" | "failed";
	finishedAt?: number;
	/** Listed under the launcher. */
	shown: boolean;
	/** Running, or done with a result the reader has not saved or dismissed yet. */
	held: boolean;
};

const SUBJECT_LIMIT = 200;
const FRAME_LIMIT = 64;
// Ended task IDs remembered so a late report cannot list them again.
const ENDED_LIMIT = 200;

function isOneOf<T extends string>(
	values: readonly T[],
	value: unknown,
): value is T {
	return (
		typeof value === "string" && (values as readonly string[]).includes(value)
	);
}

/** Reads a relayed task report; anything malformed is `undefined`. */
export function parseAiTaskReport(data: unknown): AiTaskReport | undefined {
	if (!data || typeof data !== "object") return undefined;
	if (!("id" in data) || typeof data.id !== "string" || !data.id)
		return undefined;
	if (!("source" in data) || !isOneOf(AI_TASK_SOURCES, data.source))
		return undefined;
	if (!("state" in data)) return undefined;
	const frame =
		"frame" in data &&
		typeof data.frame === "string" &&
		data.frame &&
		data.frame.length <= FRAME_LIMIT
			? { frame: data.frame }
			: {};
	if (data.state === "released")
		return { id: data.id, state: "released", source: data.source, ...frame };
	if (
		(data.state !== "working" &&
			data.state !== "done" &&
			data.state !== "failed") ||
		!("operation" in data) ||
		!isOneOf(AI_TASK_OPERATIONS, data.operation)
	)
		return undefined;
	const subject =
		"subject" in data && typeof data.subject === "string"
			? data.subject.trim().slice(0, SUBJECT_LIMIT)
			: "";
	return {
		id: data.id,
		state: data.state,
		operation: data.operation,
		subject,
		source: data.source,
		...frame,
	};
}

/** The AI tasks of one tab, in the order they started. */
export function createAiTaskList(): {
	apply: (report: AiTaskReport, now?: number) => void;
	/** Stops listing the finished tasks that match; their results stay held. */
	dismiss: (match: (task: AiTask) => boolean) => void;
	/** A frame went away: its matching tasks are cancelled or their results lost. */
	drop: (match: (task: AiTask) => boolean) => void;
	shown: () => AiTask[];
	/** Whether a shown or held task matches. */
	some: (match: (task: AiTask) => boolean) => boolean;
	/** Whether leaving the page would lose a running request or an unsaved result. */
	unsaved: () => boolean;
	subscribe: (listener: () => void) => () => void;
} {
	const tasks = new Map<string, AiTask>();
	const ended = new Set<string>();
	const listeners = new Set<() => void>();
	const changed = () => {
		for (const [id, task] of tasks)
			if (!task.shown && !task.held) {
				tasks.delete(id);
				ended.add(id);
			}
		for (const id of ended) {
			if (ended.size <= ENDED_LIMIT) break;
			ended.delete(id);
		}
		for (const listener of listeners) listener();
	};
	return {
		apply: (report, now = Date.now()) => {
			const task = tasks.get(report.id);
			if (report.state === "released") {
				if (!task) return;
				task.held = false;
				// A request released while it runs was cancelled.
				if (task.state === "working") task.shown = false;
			} else if (report.state === "working") {
				// Only a new task starts; a late repeat must not revive a finished one.
				if (task || ended.has(report.id)) return;
				tasks.set(report.id, {
					id: report.id,
					operation: report.operation,
					subject: report.subject,
					source: report.source,
					...(report.frame ? { frame: report.frame } : {}),
					state: "working",
					shown: true,
					held: true,
				});
			} else {
				if (!task || task.state !== "working") return;
				task.state = report.state;
				task.finishedAt = now;
				// A failed request has nothing to save.
				task.held = report.state === "done";
			}
			changed();
		},
		dismiss: (match) => {
			let any = false;
			for (const task of tasks.values())
				if (task.shown && task.state !== "working" && match(task)) {
					task.shown = false;
					any = true;
				}
			if (any) changed();
		},
		drop: (match) => {
			let any = false;
			for (const task of tasks.values())
				if (match(task)) {
					task.held = false;
					task.shown = false;
					any = true;
				}
			if (any) changed();
		},
		shown: () => [...tasks.values()].filter((task) => task.shown),
		some: (match) => [...tasks.values()].some(match),
		unsaved: () => [...tasks.values()].some((task) => task.held),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/** The tasks of this tab, kept by its content script for the launcher. */
export const pageAiTasks = createAiTaskList();

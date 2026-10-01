import { useEffect, useRef, useState } from "react";
import { sendMessage } from "@/entrypoints/background/messaging";
import type { AiTaskOperation, AiTaskUpdate } from "./ai-tasks";
import {
	isLauncherPopup,
	launcherFrameKey,
	useLauncherWork,
} from "./use-launcher-work";

function report(update: AiTaskUpdate): void {
	const frame = launcherFrameKey();
	// The background relays it to this tab's launcher; the novel site never sees the name.
	void sendMessage("reportAiTask", {
		...update,
		source: isLauncherPopup() ? "popup" : "panel",
		...(frame ? { frame } : {}),
	}).catch(() => {});
}

/**
 * Lists an AI request on its popup's tab under the launcher button while it
 * runs, then marks it done or failed. A done task holds its result until
 * `holding` turns false or the component unmounts (the form was saved or
 * closed): until then the popup counts it as unsaved work, so the launcher
 * keeps that tab and opens the next requested form in a new one, and leaving
 * the page asks the reader first. Does nothing outside a page frame.
 */
export function useAiTask({
	operation,
	subject,
	working,
	failed = false,
	holding = true,
}: {
	operation: AiTaskOperation;
	/** The keyword, page or site; read when the request starts. */
	subject: string;
	working: boolean;
	failed?: boolean;
	holding?: boolean;
}): void {
	const task = useRef<{
		id: string;
		operation: AiTaskOperation;
		subject: string;
		finished: boolean;
	} | null>(null);
	const latest = useRef({ operation, subject, holding });
	latest.current = { operation, subject, holding };
	// A result waiting in this form; the running request itself is reported by its caller.
	const [held, setHeld] = useState(false);
	useLauncherWork({ dirty: held });

	useEffect(() => {
		if (window.parent === window) return;
		const current = task.current;
		if (working) {
			if (current && !current.finished) return;
			// A new request replaces the result of the previous one.
			if (current) report({ id: current.id, state: "released" });
			setHeld(false);
			const next = {
				id: crypto.randomUUID(),
				operation: latest.current.operation,
				subject: latest.current.subject,
				finished: false,
			};
			task.current = next;
			report({
				id: next.id,
				state: "working",
				operation: next.operation,
				subject: next.subject,
			});
			return;
		}
		if (!current || current.finished) return;
		current.finished = true;
		report({
			id: current.id,
			state: failed ? "failed" : "done",
			operation: current.operation,
			subject: current.subject,
		});
		if (latest.current.holding && !failed) {
			setHeld(true);
			return;
		}
		report({ id: current.id, state: "released" });
		task.current = null;
	}, [working, failed]);

	useEffect(() => {
		const current = task.current;
		if (holding || !current?.finished) return;
		report({ id: current.id, state: "released" });
		task.current = null;
		setHeld(false);
	}, [holding]);

	useEffect(
		() => () => {
			if (!task.current) return;
			report({ id: task.current.id, state: "released" });
			task.current = null;
		},
		[],
	);
}

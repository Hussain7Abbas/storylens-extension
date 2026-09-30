import { createElement, X } from "lucide";

const MODAL_ID = "storylens-image-modal";

/** Closes the full-size image modal, if one is open. */
export function closeImageModal(): void {
	const dialog = document.getElementById(MODAL_ID);
	if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
	dialog?.remove();
}

/**
 * Shows an image at full size in a modal centered on the page. The modal is
 * sized by the image (capped to the viewport) and closes on Escape, the close
 * button or a click outside it.
 */
export function openImageModal(
	src: string,
	alt: string,
	closeLabel: string,
): void {
	closeImageModal();

	const dialog = document.createElement("dialog");
	dialog.id = MODAL_ID;
	dialog.className = "storylens-image-modal";
	dialog.setAttribute("data-storylens-skip", "");
	dialog.setAttribute("closedby", "any");
	if (alt) dialog.setAttribute("aria-label", alt);

	const image = document.createElement("img");
	image.className = "storylens-image-modal-image";
	image.src = src;
	image.alt = alt;

	const close = document.createElement("button");
	close.type = "button";
	close.className = "storylens-image-modal-close";
	close.setAttribute("aria-label", closeLabel);
	close.title = closeLabel;
	close.append(
		createElement(X, {
			width: 18,
			height: 18,
			"aria-hidden": "true",
			"stroke-width": 1.75,
		}),
	);
	close.addEventListener("click", () => dialog.close());

	// Browsers without `closedby` get the same outside-click dismissal.
	if (!("closedBy" in HTMLDialogElement.prototype)) {
		dialog.addEventListener("click", (event) => {
			if (event.target !== dialog) return;
			const rect = dialog.getBoundingClientRect();
			const inside =
				rect.top <= event.clientY &&
				event.clientY <= rect.bottom &&
				rect.left <= event.clientX &&
				event.clientX <= rect.right;
			if (!inside) dialog.close();
		});
	}
	dialog.addEventListener("close", () => dialog.remove());

	dialog.append(image, close);
	(document.body ?? document.documentElement).append(dialog);
	dialog.showModal();
}

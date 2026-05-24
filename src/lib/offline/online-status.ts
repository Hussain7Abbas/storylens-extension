export function isOnline(): boolean {
	return typeof navigator !== "undefined" ? navigator.onLine : true;
}

export function subscribeOnlineStatus(
	onOnline: () => void,
	onOffline: () => void,
): () => void {
	if (typeof window === "undefined") {
		return () => undefined;
	}

	window.addEventListener("online", onOnline);
	window.addEventListener("offline", onOffline);

	return () => {
		window.removeEventListener("online", onOnline);
		window.removeEventListener("offline", onOffline);
	};
}

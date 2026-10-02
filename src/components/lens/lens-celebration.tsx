import { Button, Modal, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { sendMessage } from "@/entrypoints/background/messaging";
import { useAiSnapshot } from "@/lib/ai-source/hooks";
import { trackEvent } from "@/lib/analytics/client";
import { palette } from "@/styles/palette";
import { LensCoin } from "./lens-coin";
import { useLensLabel } from "./lens-price";
/** Main popup only. Notices live in account-scoped extension storage until the API acknowledges them. */
export function LensCelebration() {
	const { t } = useTranslation();
	const { user, balance, notices } = useAiSnapshot();
	const [openedFor, setOpenedFor] = useState<string | null>(null);
	const opened = !!user && openedFor === user.id;
	const [shown, setShown] = useState<typeof notices>([]);
	const previousAccount = useRef(user?.id);
	useEffect(() => {
		if (previousAccount.current === user?.id) return;
		previousAccount.current = user?.id;
		setOpenedFor(null);
		setShown([]);
	}, [user?.id]);
	const handled = useRef(new Set<string>());
	const canvas = useRef<HTMLCanvasElement>(null);
	const alive = useRef(true);
	const currentUser = useRef(user?.id);
	currentUser.current = user?.id;
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const label = useLensLabel();
	const lastCheck = useRef<typeof notices | undefined>(undefined);
	useEffect(() => {
		if (
			!user ||
			!notices.length ||
			opened ||
			notices.every((notice) => handled.current.has(`${user.id}:${notice.id}`))
		)
			return;
		if (lastCheck.current === notices) return;
		lastCheck.current = notices;
		const pending = notices.filter(
			(notice) => !handled.current.has(`${user.id}:${notice.id}`),
		);

		for (const notice of pending)
			handled.current.add(`${user.id}:${notice.id}`);

		void (async () => {
			const ids = await sendMessage("claimLensNotices", {
				userId: user.id,
				ids: pending.map((notice) => notice.id),
			});
			const claimed = pending.filter((notice) => ids.includes(notice.id));
			for (const notice of pending)
				if (!ids.includes(notice.id))
					handled.current.delete(`${user.id}:${notice.id}`);
			if (!alive.current || currentUser.current !== user.id || !claimed.length)
				return;
			setShown(claimed);
			setOpenedFor(user.id);
			const types = new Set(claimed.map((notice) => notice.type));
			trackEvent("lens_increase_celebrated", {
				type:
					types.size > 1
						? "mixed"
						: claimed[0].type === "TRIAL_GIFT"
							? "trial"
							: claimed[0].type === "ADMIN_GIFT"
								? "gift"
								: "purchase",
			});
		})().catch(() => {
			for (const notice of pending)
				handled.current.delete(`${user.id}:${notice.id}`);
		});
	}, [user, notices, opened]);

	useEffect(() => {
		if (!opened || !user || !shown.length) return;
		void sendMessage("markLensNoticesSeen", {
			userId: user.id,
			ids: shown.map((notice) => notice.id),
		})
			.then((ok) => {
				if (!ok)
					for (const notice of shown)
						handled.current.delete(`${user.id}:${notice.id}`);
			})
			.catch(() => {
				for (const notice of shown)
					handled.current.delete(`${user.id}:${notice.id}`);
			});
	}, [opened, user, shown]);
	useEffect(() => {
		if (
			!opened ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		)
			return;
		let alive = true,
			reset: (() => void) | undefined;
		void (async () => {
			const { default: confetti } = await import("canvas-confetti");
			if (!alive || !canvas.current) return;
			const burst = confetti.create(canvas.current, {
				resize: true,
				useWorker: false,
			});
			reset = () => burst.reset();
			const colors =
				document.documentElement.getAttribute("data-mantine-color-scheme") ===
				"dark"
					? palette.dark
					: palette.light;
			void burst({
				particleCount: 55,
				shapes: [
					"circle",
					confetti.shapeFromPath({
						path: "M12 6.5c.5 3 2.5 5 5.5 5.5-3 .5-5 2.5-5.5 5.5-.5-3-2.5-5-5.5-5.5 3-.5 5-2.5 5.5-5.5z",
					}),
				],
				spread: 80,
				ticks: 90,
				gravity: 1.3,
				origin: { y: 0.35 },
				colors: [colors.accent, colors.accentHover],
				disableForReducedMotion: true,
			});
		})().catch(() => {
			/* A decorative animation must never interrupt the notice dialog. */
		});
		return () => {
			alive = false;
			reset?.();
		};
	}, [opened]);
	return (
		<Modal
			opened={opened}
			onClose={() => setOpenedFor(null)}
			title={t("cloud.congratulations")}
			centered
			size="sm"
			returnFocus
		>
			<canvas
				ref={canvas}
				aria-hidden
				style={{
					position: "absolute",
					inset: 0,
					width: "100%",
					height: "100%",
					pointerEvents: "none",
				}}
			/>
			<Stack align="center" gap="sm">
				<LensCoin size={64} />
				<Text fw={600}>
					{t("cloud.received", {
						lenses: label(
							shown.reduce((total, notice) => total + notice.lenses, 0),
						),
					})}
				</Text>
				{shown.map((notice) => (
					<Text key={notice.id} size="sm">
						{t(
							notice.type === "TRIAL_GIFT"
								? "cloud.trial"
								: notice.type === "ADMIN_GIFT"
									? "cloud.gift"
									: "cloud.purchase",
							{ lenses: label(notice.lenses) },
						)}
						{notice.note && (
							<>
								<br />
								{notice.note}
							</>
						)}
					</Text>
				))}
				<Text size="sm">
					{t("cloud.balance")}: {balance === null ? "—" : label(balance)}
				</Text>
				<Button onClick={() => setOpenedFor(null)}>{t("_.close")}</Button>
			</Stack>
		</Modal>
	);
}

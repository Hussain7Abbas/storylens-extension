import { atom, useAtomValue, useSetAtom } from "jotai";
import {
	createContext,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { trackEvent } from "@/lib/analytics/client";

const formTargetContext = createContext<HTMLElement | null>(null);

export const formPageAtom = atom<{ close: () => void; title: string } | null>(
	null,
);

/** Keep the originating tab mounted while its form occupies the content page. */
export function FormPage({
	children,
	onClose,
	title,
}: {
	children: ReactNode;
	onClose: () => void;
	title: string;
}) {
	const setPage = useSetAtom(formPageAtom);
	const close = useRef(onClose);
	close.current = onClose;
	const target = useContext(formTargetContext);
	useLayoutEffect(() => {
		setPage({ close: () => close.current(), title });
		trackEvent("page_view", {
			page_title: title,
			page_location: `/forms/${title}`,
			embedded: window.parent !== window,
		});
		return () => setPage(null);
	}, [setPage, title]);
	return target ? createPortal(children, target) : null;
}

export function PageContent({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const page = useAtomValue(formPageAtom);
	const [target, setTarget] = useState<HTMLElement | null>(null);
	return (
		<formTargetContext.Provider value={target}>
			<div hidden={!!page}>{children}</div>
			<section
				ref={setTarget}
				data-form-page
				hidden={!page}
				aria-label={t("selection.form")}
				style={{ padding: "var(--mantine-spacing-md)", minHeight: "100%" }}
			/>
		</formTargetContext.Provider>
	);
}

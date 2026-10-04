import type { ReactNode } from "react";

/** The original coin stays still; only the surrounding decorations brighten. */
export function LensCoinSparkles({
	size,
	mono,
	title,
	children,
}: {
	size: number;
	mono: boolean;
	title?: string;
	children: ReactNode;
}) {
	return (
		<span
			className="lens-coin-static"
			data-mono={mono ? "true" : undefined}
			style={{ width: size, height: size }}
			role="img"
			aria-label={title}
			aria-hidden={title ? undefined : true}
		>
			<span className="lens-coin-artwork" aria-hidden="true">
				{children}
			</span>
			<svg
				className="lens-coin-sparkles"
				viewBox="0 0 32 32"
				fill="currentColor"
				stroke="none"
				aria-hidden="true"
				focusable="false"
			>
				<path d="M26 0c.4 2.4 1.6 3.6 4 4-2.4.4-3.6 1.6-4 4-.4-2.4-1.6-3.6-4-4 2.4-.4 3.6-1.6 4-4z" />
				<path d="M3 10c.3 1.8 1.2 2.7 3 3-1.8.3-2.7 1.2-3 3-.3-1.8-1.2-2.7-3-3 1.8-.3 2.7-1.2 3-3z" />
				<path d="M26 26c.3 1.8 1.2 2.7 3 3-1.8.3-2.7 1.2-3 3-.3-1.8-1.2-2.7-3-3 1.8-.3 2.7-1.2 3-3z" />
			</svg>
		</span>
	);
}

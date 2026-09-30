// Ink & Iris: mirrored by the website's globals.css and design-system/MASTER.md.
// Keep host-page surfaces independent of Mantine and of the novel site's CSS.
export const palette = {
	light: {
		paper: "#f7f7fb",
		surface: "#ffffff",
		ink: "#202132",
		muted: "#656779",
		border: "#e0e1eb",
		accent: "#6554c0",
		accentHover: "#5544a7",
		onAccent: "#ffffff",
		wash: "#eeeefa",
		soft: "#eeebfa",
		success: "#26705e",
		error: "#b4233b",
		warning: "#9a4c00",
	},
	dark: {
		paper: "#171820",
		surface: "#22232e",
		ink: "#eeeff6",
		muted: "#a8abbe",
		border: "#383a4b",
		accent: "#b5a8f5",
		accentHover: "#c9befa",
		onAccent: "#211a39",
		wash: "#302a45",
		soft: "#302a45",
		success: "#80cbb0",
		error: "#ff9ba9",
		warning: "#f5c078",
	},
} as const;

function pageVariables(colors: (typeof palette)[keyof typeof palette]) {
	return `--paper:${colors.paper};--surface:${colors.surface};--ink:${colors.ink};--muted:${colors.muted};--border:${colors.border};--accent:${colors.accent};--accent-hover:${colors.accentHover};--on-accent:${colors.onAccent};--wash:${colors.wash};--soft:${colors.soft};--success:${colors.success};--error:${colors.error}`;
}

// Shadow roots use the system preference; extension pages use their saved theme.
export const contentThemeCss = `:host{${pageVariables(palette.light)}}@media(prefers-color-scheme:dark){:host{${pageVariables(palette.dark)}}}`;

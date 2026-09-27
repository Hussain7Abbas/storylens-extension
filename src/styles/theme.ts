import {
	type CSSVariablesResolver,
	createTheme,
	defaultVariantColorsResolver,
	type MantineColorsTuple,
	type MantineThemeOverride,
	parseThemeColor,
	type VariantColorsResolver,
} from "@mantine/core";

import { palette } from "./palette";

// Shade 7 is the light primary; shade 3 is its readable dark-mode counterpart.
const brand: MantineColorsTuple = [
	"#f4f1fd",
	"#eeebfa",
	"#d3caf6",
	"#b5a8f5",
	"#a18fe8",
	"#8a76dc",
	"#7562ce",
	"#6554c0",
	"#5544a7",
	"#443685",
];
const sage: MantineColorsTuple = [
	"#f0f8f4",
	"#dceee6",
	"#bfe1d2",
	"#80cbb0",
	"#60b596",
	"#43967a",
	"#32836b",
	"#26705e",
	"#205b4d",
	"#19483c",
];
const lavender: MantineColorsTuple = [
	"#f4f1fd",
	"#e7e1fa",
	"#d3caf6",
	"#b5a8f5",
	"#a18fe8",
	"#8a76dc",
	"#7562ce",
	"#6554c0",
	"#5544a7",
	"#443685",
];
const gray: MantineColorsTuple = [
	"#f7f7fb",
	"#eeeefa",
	"#e6e6f0",
	"#e0e1eb",
	"#c4c5d4",
	"#9496aa",
	"#656779",
	"#4d4f63",
	"#353749",
	"#202132",
];
const dark: MantineColorsTuple = [
	"#eeeff6",
	"#d4d6e5",
	"#a8abbe",
	"#85889e",
	"#383a4b",
	"#2d2f3d",
	"#22232e",
	"#171820",
	"#12131a",
	"#0d0e14",
];

// Semantic text needs the same contrast as primary text, including small notices.
const red: MantineColorsTuple = [
	"#fff1f3",
	"#ffe0e6",
	"#ffc1cc",
	"#ff9ba9",
	"#ee7288",
	"#db526c",
	"#c63752",
	"#b4233b",
	"#951c30",
	"#751627",
];
const orange: MantineColorsTuple = [
	"#fff8ed",
	"#fff0d6",
	"#ffdfac",
	"#f5c078",
	"#e4a355",
	"#c9842f",
	"#b16715",
	"#9a4c00",
	"#7c3d00",
	"#603000",
];

// Mantine derives filled text color from the light shade, so brand fills would
// keep white text on the pale night iris. Route it through a per-scheme token.
const variantColorResolver: VariantColorsResolver = (input) => {
	const colors = defaultVariantColorsResolver(input);
	const parsed = parseThemeColor({
		color: input.color || input.theme.primaryColor,
		theme: input.theme,
	});
	if (
		input.variant === "filled" &&
		parsed.color === "brand" &&
		parsed.shade === undefined
	) {
		return { ...colors, color: "var(--sl-on-brand)" };
	}
	return colors;
};

const bodyFont =
	'"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const displayFont = bodyFont;

export const theme: MantineThemeOverride = createTheme({
	colors: { brand, sage, lavender, gray, dark, red, orange },
	primaryColor: "brand",
	primaryShade: { light: 7, dark: 3 },
	variantColorResolver,
	autoContrast: true,
	respectReducedMotion: true,
	black: palette.light.ink,
	white: "#ffffff",
	fontFamily: bodyFont,
	headings: {
		fontFamily: displayFont,
		fontWeight: "600",
		sizes: {
			h1: { fontSize: "2rem", lineHeight: "1.1" },
			h2: { fontSize: "1.75rem", lineHeight: "1.1" },
			h3: { fontSize: "1.5rem", lineHeight: "1.2" },
			h4: { fontSize: "1.3rem", lineHeight: "1.2" },
			h5: { fontSize: "1.15rem", lineHeight: "1.3" },
			h6: { fontSize: "1rem", lineHeight: "1.3" },
		},
	},
	radius: {
		xs: "0.35rem",
		sm: "0.65rem",
		md: "0.75rem",
		lg: "1rem",
		xl: "1.25rem",
	},
	defaultRadius: "sm",
	shadows: {
		xs: "0 1px 2px rgb(32 33 50 / 0.06)",
		sm: "0 2px 8px rgb(32 33 50 / 0.08)",
		md: "0 8px 24px rgb(32 33 50 / 0.1)",
		lg: "0 16px 48px rgb(32 33 50 / 0.12)",
		xl: "0 24px 80px rgb(32 33 50 / 0.13)",
	},
	components: {
		Button: { defaultProps: { fw: 500, size: "sm" } },
		ActionIcon: { defaultProps: { variant: "subtle", size: "lg" } },
		Tabs: { defaultProps: { variant: "pills" } },
		Tooltip: {
			defaultProps: {
				color: "dark.6",
				events: { hover: true, focus: true, touch: false },
				openDelay: 350,
				withArrow: true,
			},
		},
	},
});

function schemeVariables(colors: (typeof palette)[keyof typeof palette]) {
	return {
		"--mantine-color-body": colors.paper,
		"--mantine-color-text": colors.ink,
		"--mantine-color-dimmed": colors.muted,
		"--mantine-color-default": colors.surface,
		"--mantine-color-default-hover": colors.wash,
		"--mantine-color-default-border": colors.border,
		"--sl-surface": colors.surface,
		"--sl-wash": colors.wash,
		"--sl-brand-soft": colors.soft,
		"--sl-on-brand": colors.onAccent,
		"--mantine-color-brand-filled": colors.accent,
		"--mantine-color-brand-filled-hover": colors.accentHover,
		"--mantine-color-brand-light": colors.soft,
		"--mantine-color-brand-light-hover": colors.wash,
		"--mantine-color-brand-light-color": colors.accent,
		"--mantine-color-brand-outline": colors.accent,
		"--mantine-color-brand-outline-hover": colors.soft,
		"--mantine-primary-color-filled": colors.accent,
		"--mantine-primary-color-filled-hover": colors.accentHover,
		"--mantine-primary-color-light": colors.soft,
		"--mantine-primary-color-light-hover": colors.wash,
		"--mantine-primary-color-light-color": colors.accent,
		"--mantine-primary-color-contrast": colors.onAccent,
		"--sl-success": colors.success,
		"--mantine-color-orange-text": colors.warning,
		"--mantine-color-red-text": colors.error,
	};
}

export const cssVariablesResolver: CSSVariablesResolver = () => ({
	variables: {
		"--sl-font-display": displayFont,
		"--sl-highlight-0": "#dceee6",
		"--sl-highlight-1": "#f4e5cc",
		"--sl-highlight-2": "#e7e1fa",
		"--sl-mark-ink": "#262337",
	},
	light: schemeVariables(palette.light),
	dark: schemeVariables(palette.dark),
});

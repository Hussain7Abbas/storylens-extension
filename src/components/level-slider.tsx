import { DirectionProvider, Group, Slider, Stack, Text } from "@mantine/core";

interface LevelSliderProps {
	label: string;
	direction: "ltr" | "rtl";
	value: number;
	min: number;
	max: number;
	step?: number;
	/** Unit shown after the numbers, such as "px" or "%". */
	suffix?: string;
	onChange: (value: number) => void;
}

/**
 * A labelled horizontal level: drag the thumb, click the track, or use the
 * arrow keys to pick a number between `min` and `max`.
 */
export function LevelSlider({
	label,
	direction,
	value,
	min,
	max,
	step = 1,
	suffix = "",
	onChange,
}: LevelSliderProps) {
	return (
		<Stack gap={4} dir={direction}>
			<Group justify="space-between" wrap="nowrap">
				<Text size="sm" fw={500}>
					{label}
				</Text>
				<Text size="sm" fw={500}>
					{value}
					{suffix}
				</Text>
			</Group>
			{/* Keep Mantine's pointer math and the track's CSS in the same direction. */}
			<DirectionProvider
				key={direction}
				initialDirection={direction}
				detectDirection={false}
			>
				<Slider
					thumbLabel={label}
					// Mantine's RTL thumb selector matches any RTL ancestor, including
					// a document whose direction has not yet followed a locale change.
					styles={{
						thumb:
							direction === "ltr"
								? { left: "var(--slider-thumb-offset)", right: "auto" }
								: {
										left: "auto",
										right:
											"calc(var(--slider-thumb-offset) - var(--slider-thumb-size))",
									},
					}}
					// The value is shown beside the label, so no floating bubble.
					label={null}
					min={min}
					max={max}
					step={step}
					value={value}
					onChange={onChange}
				/>
			</DirectionProvider>
			<Group justify="space-between" wrap="nowrap">
				<Text size="xs" c="dimmed">
					{min}
					{suffix}
				</Text>
				<Text size="xs" c="dimmed">
					{max}
					{suffix}
				</Text>
			</Group>
		</Stack>
	);
}

import {
	ColorInput as MantineColorInput,
	type ColorInputProps as MantineColorInputProps,
} from "@mantine/core";
import { useCallback, useSyncExternalStore } from "react";
import {
	addColorToHistory,
	getColorHistoryServerSnapshot,
	normalizeHexColor,
	readColorHistory,
	subscribeToColorHistory,
} from "./color-input-history";

export interface ColorInputProps
	extends Omit<MantineColorInputProps, "format" | "swatches"> {
	onChangeEnd?: (value: string) => void;
}

export function ColorInput({
	onChange,
	onChangeEnd,
	swatchesPerRow = 7,
	placeholder = "#FF0000",
	...props
}: ColorInputProps) {
	const history = useSyncExternalStore(
		subscribeToColorHistory,
		readColorHistory,
		getColorHistoryServerSnapshot,
	);

	const rememberColor = useCallback((color: string) => {
		const normalized = normalizeHexColor(color);
		if (normalized) {
			addColorToHistory(normalized);
		}
	}, []);

	const handleChangeEnd = useCallback(
		(color: string) => {
			rememberColor(color);
			onChangeEnd?.(color);
		},
		[onChangeEnd, rememberColor],
	);

	return (
		<MantineColorInput
			format="hex"
			swatches={history}
			swatchesPerRow={swatchesPerRow}
			placeholder={placeholder}
			closeOnColorSwatchClick
			onChange={onChange}
			onChangeEnd={handleChangeEnd}
			{...props}
		/>
	);
}

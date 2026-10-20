import {
	type ComboboxItem,
	NativeSelect,
	Select,
	type SelectProps,
	Stack,
	Text,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { lookupOptions } from "@/utils/lookup-options";
import type { Language } from "@/utils/translation";
import { RenderErrorBoundary } from "./render-error-boundary";

type LookupSelectProps = Omit<
	SelectProps,
	"data" | "defaultValue" | "onBlur" | "onFocus"
> & {
	rows: readonly unknown[] | undefined;
	language: Language;
	onBlur?: () => void;
	onFocus?: () => void;
};

/** The form owns the value; replacing a failed menu must not remount that form. */
export function LookupSelect({ rows, language, ...props }: LookupSelectProps) {
	const { t } = useTranslation();
	const options: ComboboxItem[] = lookupOptions(rows, language);
	// Keep a saved selection visible even when its lookup is absent from this cache.
	if (props.value && !options.some((option) => option.value === props.value))
		options.push({
			value: props.value,
			label: t("lookupSelect.savedValue"),
			disabled: true,
		});
	return (
		<RenderErrorBoundary
			fallback={
				<Stack gap="xs">
					<Text size="xs" c="dimmed" role="status">
						{t("lookupSelect.recovered")}
					</Text>
					<NativeSelect
						label={props.label}
						description={props.description}
						error={props.error}
						required={props.required}
						withAsterisk={props.withAsterisk}
						disabled={props.disabled || props.readOnly}
						name={props.name}
						id={props.id}
						onBlur={props.onBlur}
						onFocus={props.onFocus}
						size={props.size}
						leftSection={props.leftSection}
						value={props.value ?? ""}
						data={[
							{
								value: "",
								label: props.placeholder ?? "—",
								disabled: !props.clearable,
							},
							...options,
						]}
						onChange={(event) => {
							const value = event.currentTarget.value || null;
							props.onChange?.(
								value,
								options.find((option) => option.value === value) ?? {
									value: "",
									label: props.placeholder ?? "",
								},
							);
						}}
					/>
				</Stack>
			}
		>
			<Select {...props} data={options} />
		</RenderErrorBoundary>
	);
}

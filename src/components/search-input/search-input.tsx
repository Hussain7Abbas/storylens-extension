import {
	InputClearButton,
	rem,
	TextInput,
	type TextInputProps,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

interface SearchInputProps extends Omit<TextInputProps, "onChange" | "value"> {
	value?: string;
	onChange: (value: string) => void;
}

export function SearchInput({ value, onChange, ...props }: SearchInputProps) {
	const { t } = useTranslation();
	const size = useMemo(() => 40, []);

	return (
		<TextInput
			w={260}
			variant={"filled"}
			leftSection={<IconSearch />}
			rightSectionWidth={rem(size)}
			placeholder={t("_.search")}
			value={value || ""}
			rightSection={value && <InputClearButton onClick={() => onChange("")} />}
			{...props}
			onChange={(event) => onChange(event.target.value)}
		/>
	);
}

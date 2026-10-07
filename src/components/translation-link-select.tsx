import { Loader, Select } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { Languages as IconLanguages } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fuzzyMatches } from "@/utils/fuzzy-search";

export type TranslationOption = { id: string; name: string };

/**
 * The **Link** field of a form's other-language tab: an optional picker of the
 * keyword or alias already named in that language, with a debounced fuzzy search
 * over the novel's local view. Saving with one chosen merges the two rows into
 * the one being saved, which takes that language's name and everything that hung
 * off the merged row.
 */
export function TranslationLinkSelect({
	options,
	value,
	onChange,
	isLoading,
	disabled,
}: {
	options: TranslationOption[];
	value: string | null;
	onChange: (option: TranslationOption | undefined) => void;
	isLoading?: boolean;
	disabled?: boolean;
}) {
	const { t } = useTranslation();
	const [search, setSearch] = useState("");
	const [term] = useDebouncedValue(search, 250);
	return (
		<Select
			label={t("coloring.link")}
			description={t("coloring.linkDescription")}
			placeholder={t("coloring.searchLink")}
			searchable
			clearable
			comboboxProps={{ withinPortal: false }}
			maxDropdownHeight={160}
			searchValue={search}
			onSearchChange={setSearch}
			value={value}
			onChange={(id) => onChange(options.find((item) => item.id === id))}
			data={options
				.filter((item) => item.id === value || fuzzyMatches(term, [item.name]))
				.map((item) => ({ value: item.id, label: item.name }))}
			filter={({ options: shown }) => shown}
			leftSection={
				isLoading ? <Loader size="xs" /> : <IconLanguages size={16} />
			}
			nothingFoundMessage={
				isLoading ? t("selection.loading") : t("coloring.noLinks")
			}
			disabled={disabled}
		/>
	);
}

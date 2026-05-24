import { Button, Stack } from "@mantine/core";
import { useSetState } from "@mantine/hooks";
import type { QueryObserverResult } from "@tanstack/react-query";
import { DataTable } from "mantine-datatable";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetKeywordCategories } from "@/api/endpoints/keyword-categories.js";
import { SearchInput } from "@/components/search-input";
import { useDataTable } from "@/hooks/use-datatable";
import type { KeywordCategory } from "@/types/models";
import { CategoryForm, type CategoryFormModesType } from "./category-form";

export function CategoryTab() {
	const { t } = useTranslation();
	const [formMode, setFormMode] = useState<CategoryFormModesType>(undefined);
	const [category, setCategory] = useState<KeywordCategory | undefined>();

	const [query, setQuery] = useSetState<{ search: string }>({
		search: "",
	});

	const { pagination, sorting, setPagination, getTableProps } = useDataTable();
	useEffect(() => setPagination({ page: 1 }), [query, setPagination]);

	const categories = useGetKeywordCategories<{
		data: { data: KeywordCategory[]; total: number };
	}>({
		pagination,
		sorting,
	});

	const tableProps = getTableProps({
		query: categories as unknown as QueryObserverResult<
			{ total: number; data: KeywordCategory[] },
			unknown
		>,
	});

	if (formMode) {
		return (
			<CategoryForm
				mode={formMode}
				category={category}
				onClose={() => {
					setFormMode(undefined);
					setCategory(undefined);
				}}
			/>
		);
	}

	return (
		<Stack p="md" gap="xs">
			<Button
				variant="light"
				color="green.7"
				onClick={() => {
					setCategory(undefined);
					setFormMode("add");
				}}
			>
				{t("settings.addCategory")}
			</Button>

			<SearchInput
				value={query.search || ""}
				onChange={(value) => setQuery({ search: value as string })}
				variant="default"
			/>

			<DataTable
				{...tableProps}
				noRecordsText={t("category.noRecords")}
				onRowClick={({ record }) => {
					setCategory(record as KeywordCategory);
					setFormMode("edit");
				}}
				columns={[
					{ accessor: "name", title: t("settings.name") },
					{ accessor: "color", title: t("settings.color") },
				]}
			/>
		</Stack>
	);
}

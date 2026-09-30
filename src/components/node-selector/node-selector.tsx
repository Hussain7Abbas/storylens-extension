import { Button, Group, Stack, Title, Tooltip } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOnlineStatus } from "@/lib/offline/hooks";
import { NodeSelectorForm } from "./node-selector-form";
import { NodeSelectorTable } from "./node-selector-table";

export function NodeSelector() {
	const { t } = useTranslation();
	// Website selectors are online-only (D6).
	const online = useOnlineStatus();
	const [showForm, setShowForm] = useState(false);
	const [editedWebsite, setEditedWebsite] = useState<string | undefined>(
		undefined,
	);

	function handleShowForm() {
		if (!online) return;
		setShowForm(true);
		setEditedWebsite(undefined);
	}

	function handleCloseForm() {
		setShowForm(false);
		setEditedWebsite(undefined);
	}

	function handleEdit(website: string) {
		if (!online) return;
		setEditedWebsite(website);
		setShowForm(true);
	}

	return (
		<Stack gap="xs">
			{showForm && online ? (
				<NodeSelectorForm
					onClose={handleCloseForm}
					editedWebsite={editedWebsite}
				/>
			) : (
				<>
					<Group justify="space-between">
						<Title order={4}>{t("nodeSelector.websites")}</Title>
						<Tooltip
							label={online ? t("_.add") : t("offline.requiresConnection")}
							withArrow
							openDelay={350}
						>
							<Button
								onClick={handleShowForm}
								data-disabled={!online || undefined}
							>
								{t("_.add")}
							</Button>
						</Tooltip>
					</Group>
					<NodeSelectorTable onEdit={handleEdit} />
				</>
			)}
		</Stack>
	);
}

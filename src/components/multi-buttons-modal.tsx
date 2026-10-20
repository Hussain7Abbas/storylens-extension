import {
	Alert,
	Button,
	type ButtonProps,
	Group,
	Modal,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import { type FormEventHandler, type ReactNode, useId } from "react";

export type MultiButtonsModalButton = {
	id: string;
	label: ReactNode;
	onClick?: () => void;
	type?: "button" | "submit";
	variant?: ButtonProps["variant"];
	color?: ButtonProps["color"];
	disabled?: boolean;
	loading?: boolean;
	autoFocus?: boolean;
	tooltip?: ReactNode;
};

/** Shared confirmation shell; callers own the action and when to close. */
export function MultiButtonsModal({
	opened,
	title,
	message,
	children,
	buttons,
	busy = false,
	error,
	onClose,
	onSubmit,
	returnFocus = true,
}: {
	opened: boolean;
	title: ReactNode;
	message?: ReactNode;
	children?: ReactNode;
	buttons: readonly MultiButtonsModalButton[];
	busy?: boolean;
	error?: string;
	onClose: () => void;
	onSubmit?: FormEventHandler<HTMLFormElement>;
	returnFocus?: boolean;
}) {
	const messageId = useId();
	const body = (
		<Stack gap="md">
			{message && (
				<Text id={messageId} size="sm">
					{message}
				</Text>
			)}
			{children}
			{error && (
				<Alert color="red" role="alert">
					{error}
				</Alert>
			)}
			<Group justify="flex-end" gap="xs">
				{buttons.map(({ id, label, autoFocus, tooltip, ...button }) => {
					const control = (
						<Button
							key={id}
							{...button}
							type={button.type ?? "button"}
							disabled={busy || button.disabled}
							data-autofocus={autoFocus || undefined}
						>
							<span>{label}</span>
						</Button>
					);
					return tooltip ? (
						<Tooltip key={id} label={tooltip}>
							<span>{control}</span>
						</Tooltip>
					) : (
						<span key={id}>{control}</span>
					);
				})}
			</Group>
		</Stack>
	);
	return (
		<Modal
			opened={opened}
			title={title}
			aria-describedby={message ? messageId : undefined}
			centered
			returnFocus={returnFocus}
			onClose={() => {
				if (!busy) onClose();
			}}
			closeOnEscape={!busy}
			closeOnClickOutside={!busy}
			withCloseButton={!busy}
		>
			{onSubmit ? (
				<form
					onSubmit={(event) => {
						event.stopPropagation();
						onSubmit(event);
					}}
				>
					{body}
				</form>
			) : (
				body
			)}
		</Modal>
	);
}

import {
	ActionIcon,
	Input,
	Text,
	Tooltip,
	VisuallyHidden,
} from "@mantine/core";
import { ImageUp, Trash2, X } from "lucide-react";
import { type DragEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "@/lib/analytics/client";
import { MAX_IMAGE_BYTES } from "@/lib/image-upload";
import classes from "./image-upload.module.css";

/** A keyboard-accessible single-image picker; the parent owns preview and persistence. */
export function ImageUpload({
	label,
	value,
	hasImage = false,
	onChange,
	disabled = false,
}: {
	label: string;
	value: File | null;
	hasImage?: boolean;
	onChange: (file: File | null) => void;
	disabled?: boolean;
}) {
	const { t } = useTranslation();
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	const depth = useRef(0);
	const [drag, setDrag] = useState<"idle" | "accept" | "reject">("idle");
	const [error, setError] = useState<string>();
	const selected = !!value || hasImage;
	useEffect(() => {
		if (value) setError(undefined);
	}, [value]);
	const choose = (files: File[], method: "drop" | "picker") => {
		if (disabled || files.length === 0) return;
		if (files.length !== 1) {
			setError(t("imageUpload.oneImage"));
			return;
		}
		const file = files[0];
		if (
			!file.type.startsWith("image/") &&
			!(
				file.type === "" &&
				/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|tiff?)$/i.test(file.name)
			)
		) {
			setError(t("imageUpload.imagesOnly"));
			return;
		}
		if (file.size > MAX_IMAGE_BYTES) {
			setError(t("imageUpload.tooLarge"));
			return;
		}
		setError(undefined);
		onChange(file);
		trackEvent("image_upload_selected", { method });
	};
	const fileDrag = (event: DragEvent) =>
		Array.from(event.dataTransfer.types).includes("Files");
	const dragState = (event: DragEvent) => {
		const files = Array.from(event.dataTransfer.items).filter(
			(item) => item.kind === "file",
		);
		return files.length > 1 ||
			files.some((item) => item.type && !item.type.startsWith("image/"))
			? ("reject" as const)
			: ("accept" as const);
	};
	return (
		<Input.Wrapper
			id={id}
			label={label}
			error={error ? <span role="alert">{error}</span> : undefined}
		>
			<fieldset
				aria-labelledby={`${id}-label`}
				className={classes.root}
				onDragEnter={(event) => {
					if (!fileDrag(event)) return;
					event.preventDefault();
					event.stopPropagation();
					if (disabled) return;
					depth.current += 1;
					setDrag(dragState(event));
				}}
				onDragOver={(event) => {
					if (!fileDrag(event)) return;
					event.preventDefault();
					event.stopPropagation();
					event.dataTransfer.dropEffect =
						disabled || dragState(event) === "reject" ? "none" : "copy";
					if (!disabled) setDrag(dragState(event));
				}}
				onDragLeave={(event) => {
					event.preventDefault();
					depth.current = Math.max(0, depth.current - 1);
					if (!depth.current) setDrag("idle");
				}}
				onDrop={(event) => {
					if (!fileDrag(event)) return;
					event.preventDefault();
					event.stopPropagation();
					depth.current = 0;
					setDrag("idle");
					choose(Array.from(event.dataTransfer.files), "drop");
				}}
			>
				<VisuallyHidden>
					<input
						id={id}
						ref={input}
						type="file"
						accept="image/*"
						tabIndex={-1}
						disabled={disabled}
						aria-describedby={error ? `${id}-error` : undefined}
						onChange={(event) => {
							choose(Array.from(event.currentTarget.files ?? []), "picker");
							event.currentTarget.value = "";
						}}
					/>
				</VisuallyHidden>
				<button
					type="button"
					ref={button}
					className={classes.area}
					disabled={disabled}
					aria-labelledby={`${id}-label ${id}-action`}
					aria-describedby={error ? `${id}-error` : undefined}
					aria-invalid={!!error}
					data-drag={drag}
					data-error={!!error || undefined}
					data-selected={selected || undefined}
					onClick={() => input.current?.click()}
				>
					{drag === "reject" ? (
						<X size={24} strokeWidth={1.75} aria-hidden="true" />
					) : (
						<ImageUp size={24} strokeWidth={1.75} aria-hidden="true" />
					)}
					<span id={`${id}-action`} className={classes.instruction}>
						{t(
							drag === "reject"
								? "imageUpload.invalidDrop"
								: drag === "accept"
									? "imageUpload.dropNow"
									: "imageUpload.dropOrClick",
						)}
					</span>
					{selected && (
						<Text
							component="span"
							size="xs"
							c="dimmed"
							className={classes.filename}
							title={value?.name}
						>
							{value?.name ?? t("imageUpload.selected")}
						</Text>
					)}
				</button>
				{selected && (
					<Tooltip label={t("imageUpload.remove")} withArrow openDelay={350}>
						<ActionIcon
							className={classes.remove}
							type="button"
							size="md"
							color="gray"
							variant="subtle"
							disabled={disabled}
							aria-label={t("imageUpload.remove")}
							onClick={() => {
								setError(undefined);
								onChange(null);
								trackEvent("image_upload_cleared", { had_file: !!value });
								button.current?.focus();
							}}
						>
							<Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
						</ActionIcon>
					</Tooltip>
				)}
			</fieldset>
		</Input.Wrapper>
	);
}

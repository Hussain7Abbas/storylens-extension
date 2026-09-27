import { Paper, type PaperProps } from "@mantine/core";
import type { ComponentPropsWithoutRef, PropsWithChildren } from "react";
import classes from "./list-item-card.module.css";

type ListItemCardProps = PropsWithChildren<
	PaperProps & Pick<ComponentPropsWithoutRef<"div">, "onClick">
>;

export function ListItemCard({
	children,
	className,
	...props
}: ListItemCardProps) {
	return (
		<Paper
			p="sm"
			data-interactive={props.onClick ? true : undefined}
			withBorder
			className={[classes.root, className].filter(Boolean).join(" ")}
			{...props}
		>
			{children}
		</Paper>
	);
}

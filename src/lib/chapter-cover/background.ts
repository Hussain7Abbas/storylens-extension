import { customInstance } from "@/api/axios-instance";
import type { CoverReply, CoverRequest } from "./types";

/** Online shared artwork uses immediate upload; no chapter text or prompts are stored. */
export async function chapterCoverRequest(
	input: CoverRequest,
): Promise<CoverReply> {
	const path = `/api/user/chapter-covers/${encodeURIComponent(input.novelId)}/${input.chapterNumber}`;
	if (input.action === "read")
		return (await customInstance<CoverReply>({ url: path, method: "GET" }))
			.data;
	if (input.action === "claim")
		return (
			await customInstance<CoverReply>({ url: `${path}/claim`, method: "POST" })
		).data;
	if (input.action === "release") {
		await customInstance({
			url: `${path}/claim`,
			method: "DELETE",
			data: { token: input.token },
		});
		return { image: null, generating: false };
	}
	if (!input.mimeType.startsWith("image/") || input.data.length > 16_000_000)
		throw new Error("Invalid cover image");
	const binary = atob(input.data);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	const body = new FormData();
	body.append("id", input.imageId);
	body.append("type", "Image");
	body.append(
		"file",
		new File([bytes], "chapter-cover", { type: input.mimeType }),
	);
	await customInstance({
		url: "/api/user/files/upload",
		method: "POST",
		data: body,
		timeout: 120_000,
	});
	return (
		await customInstance<CoverReply>({
			url: path,
			method: "PUT",
			data: { token: input.token, imageId: input.imageId },
		})
	).data;
}

import { customInstance } from "@/api/axios-instance";
import type { PostFilesUpload200 } from "@/api/schemas";

export async function uploadImageFile(file: File): Promise<string> {
	const formData = new FormData();
	formData.append("file", file);
	formData.append("type", "Image");

	const response = await customInstance<PostFilesUpload200>({
		url: "/files/upload",
		method: "POST",
		data: formData,
	});

	return response.data.id;
}

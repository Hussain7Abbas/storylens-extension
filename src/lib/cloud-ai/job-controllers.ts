/** Only a request's originating tab/page owner may cancel it. */
export class JobControllers {
	private readonly jobs = new Map<
		string,
		{ owner: number; controller: AbortController }
	>();
	begin(id: string, owner: number): AbortController {
		if (this.jobs.has(id)) throw new Error("This request is already running.");
		const controller = new AbortController();
		this.jobs.set(id, { owner, controller });
		return controller;
	}
	cancel(id: string, owner: number): void {
		const job = this.jobs.get(id);
		if (job?.owner === owner) job.controller.abort();
	}
	cancelOwner(owner: number): void {
		for (const job of this.jobs.values())
			if (job.owner === owner) job.controller.abort();
	}
	end(id: string): void {
		this.jobs.delete(id);
	}
}

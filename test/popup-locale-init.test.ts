/// <reference types="bun" />
import { expect, it } from "bun:test";

it("reads the saved Arabic locale before a fresh popup's first render", async () => {
	// A separate extension document gets fresh modules, without another test's atoms.
	const child = Bun.spawn(
		[
			process.execPath,
			"-e",
			`import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "chrome-extension://storylens-test/popup.html" });
localStorage.setItem("locale", JSON.stringify("ar"));
const { localeAtom } = await import("./src/store/locale.ts");
const { createStore } = await import("jotai");
console.log(createStore().get(localeAtom));
await GlobalRegistrator.unregister();`,
		],
		{ cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" },
	);
	const output = await new Response(child.stdout).text();
	expect(await child.exited).toBe(0);
	expect(output.trim()).toBe("ar");
});

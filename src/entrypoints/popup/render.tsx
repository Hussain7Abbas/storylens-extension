import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import "./style.css";
import { BrowserRouter } from "react-router";
import { setupApiClient } from "@/utils/setup-api-client";

setupApiClient();

export function Main(type: "popup" | "options" = "popup") {
	if (type === "options" || window.parent !== window)
		document.documentElement.dataset.embedded = "";
	const view = new URLSearchParams(window.location.search).get("view");
	if (view) document.documentElement.dataset.view = view;
	ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
		<React.StrictMode>
			<BrowserRouter>
				<App type={type} />
			</BrowserRouter>
		</React.StrictMode>,
	);
}

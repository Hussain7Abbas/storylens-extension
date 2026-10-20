import { Component, type ReactNode } from "react";

/** Catch render/effect failures at the smallest replaceable UI boundary. */
export class RenderErrorBoundary extends Component<
	{ children: ReactNode; fallback: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: unknown) {
		// Local diagnostics only. Never send form contents or error text to analytics.
		console.error("[StoryLens] A view failed to render:", error);
	}

	render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

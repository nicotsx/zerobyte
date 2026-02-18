import { useCallback } from "react";

export function useScrollToFormError() {
	return useCallback(() => {
		setTimeout(() => {
			const firstError = document.querySelector("[data-slot='form-message']");
			firstError?.scrollIntoView({ behavior: "smooth", block: "center" });
		}, 50);
	}, []);
}

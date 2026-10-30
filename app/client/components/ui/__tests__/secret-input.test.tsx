import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";
import { STORED_SECRET } from "~/lib/stored-secret";
import { SecretInput } from "../secret-input";

afterEach(cleanup);

const SecretForm = ({ onSave, multiline = false }: { onSave: (value: string) => void; multiline?: boolean }) => {
	const [value, setValue] = useState(STORED_SECRET);

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				onSave(value);
			}}
		>
			<label htmlFor="credential">Credential</label>
			<SecretInput id="credential" value={value} onChange={setValue} multiline={multiline} allowClear />
			<button type="submit">Save changes</button>
		</form>
	);
};

test("preserves an untouched stored credential without revealing its marker", async () => {
	const onSave = vi.fn();
	render(<SecretForm onSave={onSave} />);

	expect(screen.getByLabelText("Credential")).toHaveProperty("value", "Stored credential");
	expect(screen.queryByDisplayValue(STORED_SECRET)).toBeNull();
	expect(screen.queryByRole("button", { name: "Show secret" })).toBeNull();
	await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
	expect(onSave).toHaveBeenLastCalledWith(STORED_SECRET);
});

test("keeps the credential when clearing is cancelled and clears only after confirmation", async () => {
	const onSave = vi.fn();
	render(<SecretForm onSave={onSave} />);

	await userEvent.click(screen.getByRole("button", { name: "Clear" }));
	expect(screen.getByRole("alertdialog")).toBeTruthy();
	expect(onSave).not.toHaveBeenCalled();
	await userEvent.click(screen.getByRole("button", { name: "Keep credential" }));
	await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
	expect(onSave).toHaveBeenLastCalledWith(STORED_SECRET);

	await userEvent.click(screen.getByRole("button", { name: "Clear" }));
	await userEvent.click(screen.getByRole("button", { name: "Clear credential" }));
	expect(screen.getByLabelText("Credential")).toHaveProperty("value", "");
	expect(screen.queryByRole("button", { name: "Keep stored" })).toBeNull();
	expect(onSave).toHaveBeenCalledTimes(1);
	await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
	expect(onSave).toHaveBeenLastCalledWith("");
});

test.each([false, true])("replaces a stored credential with multiline=%s", async (multiline) => {
	const onSave = vi.fn();
	render(<SecretForm onSave={onSave} multiline={multiline} />);

	await userEvent.click(screen.getByRole("button", { name: "Replace" }));
	expect(screen.getByLabelText("Credential")).toHaveProperty("value", "");
	await userEvent.click(screen.getByRole("button", { name: "Keep stored" }));
	await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
	expect(onSave).toHaveBeenLastCalledWith(STORED_SECRET);

	await userEvent.click(screen.getByRole("button", { name: "Replace" }));
	await userEvent.type(screen.getByLabelText("Credential"), "replacement-secret");
	expect(screen.queryByRole("button", { name: "Keep stored" })).toBeNull();
	await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
	expect(onSave).toHaveBeenLastCalledWith("replacement-secret");

	await userEvent.clear(screen.getByLabelText("Credential"));
	await userEvent.click(screen.getByRole("button", { name: "Keep stored" }));
	expect(screen.getByLabelText("Credential")).toHaveProperty("value", "Stored credential");
	await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
	expect(onSave).toHaveBeenLastCalledWith(STORED_SECRET);
});

test.each([{ disabled: true }, { readOnly: true }])("prevents stored credential changes with %j", (props) => {
	render(<SecretInput value={STORED_SECRET} onChange={vi.fn()} allowClear {...props} />);
	expect(screen.getByRole("button", { name: "Replace" })).toHaveProperty("disabled", true);
	expect(screen.getByRole("button", { name: "Clear" })).toHaveProperty("disabled", true);
});

test("opening replacement preserves the marker until typing and does not restore it after typing", async () => {
	const onSave = vi.fn();
	render(<SecretForm onSave={onSave} />);

	await userEvent.click(screen.getByRole("button", { name: "Replace" }));
	await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
	expect(onSave).toHaveBeenLastCalledWith(STORED_SECRET);

	await userEvent.type(screen.getByLabelText("Credential"), "replacement");
	await userEvent.clear(screen.getByLabelText("Credential"));
	await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
	expect(onSave).toHaveBeenLastCalledWith("");
});

test("masks new secrets and lets the user reveal them", async () => {
	render(<SecretInput aria-label="Credential" value="new-secret" onChange={vi.fn()} />);
	expect(screen.getByLabelText("Credential")).toHaveProperty("type", "password");
	await userEvent.click(screen.getByRole("button", { name: "Show secret" }));
	expect(screen.getByLabelText("Credential")).toHaveProperty("type", "text");
	await userEvent.click(screen.getByRole("button", { name: "Hide secret" }));
	expect(screen.getByLabelText("Credential")).toHaveProperty("type", "password");
});

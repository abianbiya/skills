import { describe, expect, test } from "bun:test";
import { chooseSetting, settingOptions, settingRequest } from "./settings.js";

describe("workflow settings picker", () => {
	test("canceling either step produces no request", async () => {
		let calls = 0;
		expect(await chooseSetting(async () => { calls++; return undefined; })).toBeUndefined();
		expect(calls).toBe(1);
		const answers = [settingOptions[0].label, undefined];
		expect(await chooseSetting(async () => answers.shift())).toBeUndefined();
	});

	test("every displayed level selects the corresponding integer", async () => {
		for (let level = 1; level <= 10; level++) {
			let step = 0;
			const selected = await chooseSetting(async (_title, options) => {
				if (step++ === 0) return options[0];
				expect(options).toHaveLength(10);
				return options[level - 1];
			});
			expect(selected).toEqual({ key: "assurance_level", value: level });
		}
	});

	test("other controls preserve their typed configuration value", async () => {
		for (let index = 1; index < settingOptions.length; index++) {
			let step = 0;
			expect(await chooseSetting(async (_title, options) => options[step++ === 0 ? index : 0]))
				.toEqual({ key: settingOptions[index].key, value: settingOptions[index].values[0] });
		}
	});

	test("unexpected host selections do not produce a configuration edit", async () => {
		expect(await chooseSetting(async () => "not an option")).toBeUndefined();
		let step = 0;
		expect(await chooseSetting(async (_title, options) => step++ === 0 ? options[0] : "11"))
			.toBeUndefined();
	});

	test("requests address the selected directory and carry no execution approval", () => {
		const path = '/workspace/second project/.specflow/specs/overview';
		const message = settingRequest(path, { key: "assurance_level", value: 2 });
		expect(message).toContain(JSON.stringify(path));
		expect(message).toContain("assurance_level to 2");
		expect(message).toContain("does not authorize application edits or execution");
	});
});

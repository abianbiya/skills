/** The picker requests a scoped agent edit; it never writes configuration itself. */
export const settingOptions = [
	{ key: "assurance_level", label: "Assurance level (1–10)", values: Array.from({ length: 10 }, (_, i) => i + 1) },
	{ key: "delivery_target", label: "Delivery target", values: ["prototype", "mvp", "production"] },
	{ key: "review_cadence", label: "Review cadence", values: ["milestone", "task"] },
	{ key: "planning_detail", label: "Planning detail", values: ["concise", "detailed"] },
] as const;

export interface SettingChoice {
	key: typeof settingOptions[number]["key"];
	value: string | number;
}

type Select = (title: string, options: string[]) => Promise<string | undefined>;

export async function chooseSetting(select: Select): Promise<SettingChoice | undefined> {
	const selected = await select("SpecFlow setting", settingOptions.map((s) => s.label));
	const setting = settingOptions.find((s) => s.label === selected);
	if (!setting) return;
	const labels = setting.values.map((value) => {
		if (typeof value !== "number") return value;
		const band = value <= 2 ? "Focused" : value <= 5 ? "Operational" : value <= 8 ? "High assurance" : "Critical";
		return `${value} — ${band}`;
	});
	const picked = await select(setting.label, labels);
	const index = picked === undefined ? -1 : labels.indexOf(picked);
	if (index < 0) return;
	return { key: setting.key, value: setting.values[index] };
}

export function settingRequest(specDirectory: string, choice: SettingChoice): string {
	return `Use SpecFlow configuration to set ${choice.key} to ${JSON.stringify(choice.value)} for the spec at ${JSON.stringify(specDirectory)} only. Preserve other settings. Explain any change to its approved validation or delivery boundary and reconcile it before execution. This request changes a workflow preference; it does not authorize application edits or execution.`;
}

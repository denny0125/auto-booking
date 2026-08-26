import { describe, expect, it } from "vitest";

import { inferAvailability } from "../../src/adapters/ntuhPageAdapter.ts";

describe("inferAvailability", () => {
	it("treats NTUH avaliable card markup as available even without explicit text", () => {
		const availability = inferAvailability(
			"林展毅 | 11 診 消化科 | 普 通門診",
			'<button class="doctor-tag avaliable" onclick="window.location.href=\'RegForm?newx=token\';">前往掛號</button>',
		);

		expect(availability).toBe("available");
	});

	it("still classifies text-only full slots as unavailable", () => {
		const availability = inferAvailability("吳行健 | 18 診 額滿 消化系");

		expect(availability).toBe("unavailable");
	});
});
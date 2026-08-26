import { describe, expect, it } from "vitest";

import { findDoctorCandidateByCriteria, inferAvailability } from "../../src/adapters/ntuhPageAdapter.ts";

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

		expect(availability).toBe("full");
	});

	it("filters candidates by appointment date when requested", async () => {
		const candidatePage = createCandidateLookupPage([
			{
				visible: true,
				textContent: "林 展毅 | 9/7 | 11 診 消化科 | 普通門診",
				outerHTML: '<button class="doctor-tag avaliable" onclick="window.location.href=\'RegForm?newx=old\';">前往掛號</button>',
			},
			{
				visible: true,
				textContent: "林 展毅 | 9/8 | 11 診 消化科 | 普通門診",
				outerHTML: '<button class="doctor-tag avaliable" onclick="window.location.href=\'RegForm?newx=target\';">前往掛號</button>',
			},
		]);

		const candidate = await findDoctorCandidateByCriteria(candidatePage, {
			doctorName: "林展毅",
			appointmentDate: "9/8",
		});

		expect(candidate?.appointmentDate).toBe("9/8");
		expect(candidate?.availability).toBe("available");
	});

	it("extracts appointment date from a nearby date container when the doctor card text omits it", async () => {
		const candidatePage = createCandidateLookupPage([
			{
				visible: true,
				textContent: "張 為淵 | 02 診 消化科 | 普通門診",
				outerHTML: '<button class="doctor-tag avaliable" onclick="window.location.href=\'RegForm?newx=target\';">前往掛號</button>',
				ancestors: [
					{ visible: true, textContent: "張 為淵 | 02 診 消化科 | 普通門診" },
					{ visible: true, textContent: "9/9 星期三 上午門診 張 為淵 | 02 診 消化科 | 普通門診" },
				],
			},
		]);

		const candidate = await findDoctorCandidateByCriteria(candidatePage, {
			doctorName: "張為淵",
			appointmentDate: "9/9",
		});

		expect(candidate?.appointmentDate).toBe("9/9");
		expect(candidate?.availability).toBe("available");
	});
});

function createCandidateLookupPage(entries) {
	const locators = entries.map((entry) => createDoctorTextLocator(entry));

	return {
		locator() {
			return {
				filter() {
					return {
						async count() {
							return locators.length;
						},
						 nth(index) {
							return locators[index];
						},
					};
				},
			};
		},
		getByText() {
			return {
				async count() {
					return locators.length;
				},
				nth(index) {
					return locators[index];
				},
			};
		},
	};
}

function createDoctorTextLocator(entry) {
	const ancestorLocators = (entry.ancestors ?? []).map((ancestor) => ({
		async textContent() {
			return ancestor.textContent;
		},
		async isVisible() {
			return ancestor.visible;
		},
		first() {
			return this;
		},
		locator() {
			return { first: () => this };
		},
	}));

	const rowLocator = {
		async textContent() {
			return entry.textContent;
		},
		async evaluate(callback) {
			return callback({ outerHTML: entry.outerHTML });
		},
		async isVisible() {
			return entry.visible;
		},
		first() {
			return this;
		},
		locator(selector) {
			const ancestorMatch = /ancestor::(?:div\[(\d+)\]|section\[1\])/.exec(selector);

			if (ancestorMatch) {
				const ancestorIndex = ancestorMatch[1] ? Number(ancestorMatch[1]) - 1 : ancestorLocators.length - 1;
				return {
					first() {
						return ancestorLocators[ancestorIndex] ?? rowLocator;
					},
				};
			}

			return {
				first() {
					return rowLocator;
				},
			};
		},
	};

	return {
		async isVisible() {
			return entry.visible;
		},
		async textContent() {
			return entry.textContent;
		},
		locator(selector) {
			return rowLocator.locator(selector);
		},
	};
}
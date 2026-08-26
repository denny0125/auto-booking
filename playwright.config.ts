import { defineConfig } from "playwright/test";

export default defineConfig({
	use: {
		browserName: "chromium",
		headless: true,
		viewport: { width: 1440, height: 1200 },
		ignoreHTTPSErrors: false,
	},
	testDir: "tests/e2e",
	timeout: 30_000,
	retries: 0,
});
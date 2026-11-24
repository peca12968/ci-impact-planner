import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  use: {
    baseURL: "http://127.0.0.1:4186",
    launchOptions: { executablePath: process.env.BROWSER_PATH },
  },
  webServer: {
    command: "python -m http.server 4186 --bind 127.0.0.1 --directory web",
    url: "http://127.0.0.1:4186",
  },
});

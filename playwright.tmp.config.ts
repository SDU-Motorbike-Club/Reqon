import { devices } from '@playwright/test'
import base from './playwright.config.ts'

// Temporary: the same config, but with the Chromium that is already installed (the pinned build is not).
const executablePath = `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`
export default {
  ...base,
  reporter: [['list']],
  projects: [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } }],
}

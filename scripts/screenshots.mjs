#!/usr/bin/env node
/**
 * Regenerates the README screenshots from a seeded demo database.
 *
 * Playwright rather than a real browser window: the viewport is exact and
 * reproducible, the retina scale factor is explicit, and nothing renders a
 * mouse cursor into the frame.
 *
 *   node scripts/seed-demo.mjs /tmp/demo/app.sqlite
 *   node scripts/screenshots.mjs http://127.0.0.1:4393 [http://127.0.0.1:4392]
 *
 * The second URL is a server whose onboarding is not finished, used for the
 * first-run shots.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "screenshots");

const baseUrl = process.argv[2] || "http://127.0.0.1:4393";
const onboardingUrl = process.argv[3] || null;

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  // Retina output, so the images stay sharp when GitHub scales them down.
  deviceScaleFactor: 2,
  colorScheme: "dark",
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo"
});
const page = await context.newPage();

/** Waits for the app to have painted real data, not the loading skeleton. */
async function settle(selector) {
  await page.waitForLoadState("networkidle").catch(() => {});
  if (selector) await page.waitForSelector(selector, { timeout: 15000 }).catch(() => {});
  // One more frame for the entry animation.
  await page.waitForTimeout(900);
}

async function shot(name, { url, waitFor, scrollTo, fullPage = false, before } = {}) {
  if (url) await page.goto(url, { waitUntil: "domcontentloaded" });
  await settle(waitFor);
  if (before) await before();
  if (scrollTo) {
    await page.evaluate((text) => {
      const heading = [...document.querySelectorAll("h2, h3, [class*='CardTitle'], div")]
        .find((el) => el.textContent?.trim().startsWith(text));
      heading?.scrollIntoView({ block: "start" });
    }, scrollTo);
    await page.waitForTimeout(700);
  }
  const file = path.join(OUT, `${name}.jpg`);
  await page.screenshot({ path: file, type: "jpeg", quality: 92, fullPage });
  console.log(`  ${name}.jpg`);
}

console.log("gerando capturas:");

await shot("dashboard", { url: `${baseUrl}/#/painel`, waitFor: "text=Execuções recentes" });
await shot("jobs", { url: `${baseUrl}/#/vagas`, waitFor: "table" });
await shot("profile", { url: `${baseUrl}/#/perfil`, waitFor: "text=Identidade e contato" });
await shot("keys", { url: `${baseUrl}/#/chaves`, waitFor: "text=Providers de modelo" });

/** Settings is tabbed now; each shot opens its own tab. */
async function settingsTab(name, tab, waitFor) {
  await shot(name, {
    url: `${baseUrl}/#/configuracoes`,
    waitFor: "role=tablist",
    before: async () => {
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(700);
      if (waitFor) await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
    }
  });
}

await settingsTab("settings-linkedin", /Integrações/i, "text=LinkedIn");
await settingsTab("settings-pipelines", /Pipelines/i, "text=Executar agora");
await settingsTab("settings-alerts", /Alertas/i, "text=Falhas agrupadas");
await settingsTab("settings-general", /Geral/i, "text=Pausa global");

// The record dialog, opened by clicking the first job title.
await shot("job-detail", {
  url: `${baseUrl}/#/vagas`,
  waitFor: "table",
  before: async () => {
    await page.getByRole("button", { name: /Senior Backend Engineer/i }).first().click();
    await page.waitForTimeout(900);
  }
});

if (onboardingUrl) {
  await shot("onboarding", { url: `${onboardingUrl}/#/`, waitFor: "text=Vamos configurar seu perfil" });
  await shot("provider-dialog", {
    url: `${onboardingUrl}/#/`,
    waitFor: "text=Provider de modelo",
    before: async () => {
      await page.getByRole("button", { name: /^Configurar$/ }).first().click();
      await page.waitForTimeout(900);
    }
  });
}

await browser.close();
console.log(`\nsalvo em ${path.relative(ROOT, OUT)}/`);

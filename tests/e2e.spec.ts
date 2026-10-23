import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";

/** Requires a disposable PostgreSQL DATABASE_URL. AI is the controlled local baseline, never an external provider. */
test("register, persist, assign, upload policy, review draft, respond, resolve, deny another tenant", async ({
  page,
  playwright,
  baseURL,
}) => {
  const suffix = randomBytes(6).toString("hex");
  const email = `e2e-${suffix}@example.com`;
  const password = randomBytes(24).toString("hex");
  const name = "E2E Support Agent";
  await page.goto("/");
  await page
    .getByRole("button", { name: "New here? Create your workspace" })
    .click();
  await page.getByLabel("Your name", { exact: true }).fill(name);
  await page
    .getByLabel("Workspace name", { exact: true })
    .fill(`E2E Workspace ${suffix}`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create workspace →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ticket inbox", exact: true }),
  ).toBeVisible();
  const identity = await (await page.request.get("/api/auth/me")).json();
  const organizationId = identity.organizations[0].id;

  await page
    .getByRole("button", { name: "Knowledge base", exact: true })
    .click();
  await page.getByRole("button", { name: /Add document/ }).click();
  await page
    .getByLabel("Document title", { exact: true })
    .fill("Delivery policy");
  await page
    .getByLabel("Import .txt or .md (up to 200 KB)", { exact: true })
    .setInputFiles({
      name: "delivery-policy.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "Delayed delivery policy: delivery normally takes 3 to 5 business days. Ask for the order tracking number before escalating a delayed shipment.",
      ),
    });
  await page.getByRole("button", { name: "Save & index", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Delivery policy", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ticket inbox", exact: false })
    .click();
  await page.getByRole("button", { name: /New ticket/ }).click();
  const form = page.getByRole("dialog", { name: "Start a conversation" });
  const subject = `Delayed delivery ${suffix}`;
  await form.getByLabel("Subject", { exact: true }).fill(subject);
  await form
    .getByLabel("Customer email", { exact: true })
    .fill("synthetic-customer@example.com");
  await form
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("normal");
  await form
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("delivery");
  await form
    .getByLabel("Message", { exact: true })
    .fill(
      "My delivery is delayed. What is your delivery policy and order tracking process?",
    );
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tickets") &&
      response.request().method() === "POST",
  );
  await form
    .getByRole("button", { name: "Create ticket", exact: true })
    .click();
  const created = await (await createdResponse).json();
  const drawer = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: subject, exact: true }) });
  await expect(drawer).toBeVisible();
  const assigned = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/tickets/${created.id}`) &&
      response.request().method() === "PATCH",
  );
  await drawer
    .getByLabel("Assigned agent", { exact: true })
    .selectOption(identity.user.id);
  expect((await assigned).ok()).toBeTruthy();
  await expect(
    drawer.getByLabel("Assigned agent", { exact: true }),
  ).toHaveValue(identity.user.id);
  await drawer
    .getByRole("button", { name: "Suggest a reply", exact: true })
    .click();
  await expect(
    drawer.getByText("Provider: local-extractive-baseline", { exact: true }),
  ).toBeVisible();
  await expect(
    drawer.locator("summary").filter({ hasText: "Delivery policy" }),
  ).toBeVisible();
  await drawer
    .getByRole("button", { name: "Edit in composer", exact: true })
    .click();
  await expect(drawer.getByLabel("Reply message", { exact: true })).toHaveValue(
    /3 to 5 business days/,
  );
  const replied = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/tickets/${created.id}/messages`) &&
      response.request().method() === "POST",
  );
  await drawer
    .getByRole("button", { name: "Send response →", exact: true })
    .click();
  expect((await replied).status()).toBe(201);
  const resolved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/tickets/${created.id}`) &&
      response.request().method() === "PATCH",
  );
  await drawer
    .getByLabel("Ticket status", { exact: true })
    .selectOption("resolved");
  expect((await resolved).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("button").filter({ hasText: subject }).click();
  await expect(page.getByLabel("Ticket status", { exact: true })).toHaveValue(
    "resolved",
  );

  const other = await playwright.request.newContext({ baseURL });
  try {
    const registration = await other.post("/api/auth/register", {
      data: {
        name: "Other Tenant",
        email: `other-${suffix}@example.com`,
        password,
        organization: `Other ${suffix}`,
      },
    });
    expect(registration.status()).toBe(201);
    const otherIdentity = await registration.json();
    const access = await other.get(`/api/tickets/${created.id}`, {
      headers: { "X-Organization-Id": otherIdentity.organizations[0].id },
    });
    expect(access.status()).toBe(404);
    const impersonated = await other.get(`/api/tickets/${created.id}`, {
      headers: { "X-Organization-Id": organizationId },
    });
    expect(impersonated.status()).toBe(403);
  } finally {
    await other.dispose();
  }

  await page.getByRole("button", { name: "Close ticket", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in →", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ticket inbox", exact: true }),
  ).toBeVisible();
});

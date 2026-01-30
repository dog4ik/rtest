import { test } from "@/test_context";
import { faker } from "@faker-js/faker";
import { delay } from "@std/async";

test.concurrent(
  "cerate personal account",
  { timeout: 60_000 },
  async ({ ctx, browser }) => {
    let page = await browser.newPage();
    let login = faker.internet.email();
    let password = "Ui_7ESOUou";
    await ctx.annotate(`New user: ${login} ${password}`);
    await page.goto("http://localhost:8900/login");

    await page.getByRole("button", { name: "Registration" }).click();
    await page.getByRole("textbox", { name: "your@email.com" }).fill(login);
    await page.locator("#accept_terms-btn").check();
    await page.getByRole("button", { name: "Registration" }).click();
    await page.locator("#authorization-phone-code").click();
    await delay(1_000);
    let code = await ctx.shared_state().core_db.last_session_code();
    await page
      .locator("#authorization-phone-code")
      .fill(code.confirm_code.toString());
    await page.getByRole("button", { name: "Confirm" }).click();
    await page
      .getByRole("button", { name: "Personal Personal Description" })
      .click();
    await page.locator('input[name="first_name"]').click();
    await page
      .locator('input[name="first_name"]')
      .fill(faker.person.firstName());
    await page.locator('input[name="first_name"]').press("Tab");
    await page.locator('input[name="last_name"]').fill(faker.person.lastName());
    await page.getByRole("combobox").selectOption("Bahrain");
    await page.locator("#password").click();
    await page.locator("#password").fill(password);
    await page.locator("#password_confirmation").click();
    await page.locator("#password_confirmation").fill(password);
    await page.getByRole("button", { name: "continue" }).click();
    await page
      .getByRole("link", { name: "fill information about your" })
      .click();
    await page.locator('input[name="birthday"]').click();
    await page.locator('input[name="birthday"]').fill("15.08.2002");
    await page.getByText("Birthdate").click();
    await page.getByRole("button", { name: "Bahrain" }).click();
    await page.getByText("Algeria").first().click();
    await page.locator('input[name="city"]').click();
    await page.locator('input[name="city"]').fill(faker.location.city());
    await page.locator('input[name="street"]').click();
    await page
      .locator('input[name="street"]')
      .fill(faker.location.street());
    await page.locator('input[name="postcode"]').click();
    await page.locator('input[name="postcode"]').fill(faker.location.zipCode());
    await page.locator('input[name="id_type"]').click();
    await page.locator('input[name="id_type"]').fill("Passport");
    await page.locator('input[name="passport_number"]').click();
    await page.locator('input[name="passport_number"]').fill("929292");
    await page.locator('input[name="id_issue_date"]').click();
    await page.locator('input[name="id_issue_date"]').fill("15.08.2002");
    await page.locator('input[name="id_exp_date"]').click();
    await page.locator('input[name="id_exp_date"]').fill("15.08.2026");
    await page
      .locator("form div")
      .filter({
        has: page.locator("input#id_issuing_country"),
      })
      .getByRole("button")
      .click();
    await page.getByText("Afghanistan").nth(1).click();
    await page.locator('input[name="id_issued_by"]').click();
    await page.locator('input[name="id_issued_by"]').fill(faker.company.name());
    await page
      .locator("#passport_picture_input")
      .setInputFiles("assets/image.png");
    await page.getByRole("button").filter({ hasText: /^$/ }).click();
    await page.getByText("Aland Islands").nth(2).click();
    await page.locator('input[name="tax_number"]').click();
    await page
      .locator('input[name="tax_number"]')
      .fill(faker.number.int().toString());
    await page.getByRole("button", { name: "Save" }).click({ timeout: 60_000 });
  },
);

import { test } from "@/test_context";
import { faker } from "@faker-js/faker";
import { delay } from "@std/async";

test.concurrent(
  "create business account",
  { timeout: 60_000 },
  async ({ ctx, browser }) => {
    let page = await browser.newPage();
    let login = faker.internet.email();
    let password = "Ui_7ESOUou";
    await ctx.annotate(`New user: ${login} ${password}`);
    await page.goto("http://localhost:8900/login");

    await page.getByRole("button", { name: "Registration" }).click();
    await page.getByRole("textbox", { name: "your@email.com" }).click();
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
      .getByRole("button", { name: "Business Business Description" })
      .click();
    await page.locator('input[name="company_name"]').click();
    await page.locator('input[name="company_name"]').fill(faker.company.name());
    await page.locator('input[name="registration_number"]').click();
    await page.locator('input[name="registration_number"]').fill("12342424");
    await page.getByRole("combobox").selectOption("Bangladesh");
    await page.locator("#password").click();
    await page.locator("#password").fill(password);
    await page
      .locator("div")
      .filter({
        hasText:
          /^Password\(Upper\/LowerCase, Number\/SpecialChar, min 8 Chars\)$/,
      })
      .getByRole("link")
      .click();
    await page.locator("#password_confirmation").click();
    await page.locator("#password_confirmation").fill(password);
    await page.getByRole("button", { name: "continue" }).click();
    await page
      .getByRole("link", { name: "fill information about your" })
      .click();
    await page.getByRole("button").filter({ hasText: /^$/ }).first().click();
    await page.locator("#info").getByText("Afghanistan").click();
    await page.locator("#company_info_legal_name").click();
    await page.locator("#company_info_legal_name").fill(faker.company.name());
    await page
      .getByRole("button")
      .filter({
        has: page.locator("input#company_info_industry"),
      })
      .click();
    await page
      .locator("div.v-input.v-select._open")
      .locator("div.v-select-list__item")
      .nth(0)
      .click();
    await page.locator("#company_info_type_of_incorporation").click();
    await page
      .locator("#company_info_type_of_incorporation")
      .fill(faker.person.jobArea());
    await page.locator("#company_info_reg_number").click();
    await page.locator("#company_info_reg_number").fill("93293939");
    await page.locator("#company_info_date_of_incorporation").click();
    await page
      .locator("#company_info_date_of_incorporation")
      .fill("11.11.2002");
    await page
      .locator("#company_info_stock_exchange_company_is_listed_on")
      .click();
    await page
      .locator("#company_info_stock_exchange_company_is_listed_on")
      .fill(faker.company.name());
    await page.locator("#company_info_regulated_by").click();
    await page.locator("#company_info_regulated_by").fill(faker.company.name());
    await page.locator("#company_info_license_number").click();
    await page.locator("#company_info_license_number").fill("999");
    await page.locator("#company_info_corporate_email").click();
    await page
      .locator("#company_info_corporate_email")
      .fill(faker.internet.email());
    await page.locator("#company_info_corporate_phone").click();
    await page
      .locator("#company_info_corporate_phone")
      .fill(faker.phone.number());
    await page.locator("#company_info_website").click();
    await page.locator("#company_info_website").fill(faker.internet.url());
    await page.getByRole("link", { name: "Save and go next" }).click();
    await page.locator("#company_info_registered_address").click();
    await page
      .locator("#company_info_registered_address")
      .fill(faker.location.streetAddress({ useFullAddress: true }));
    await page.locator("#company_info_registered_city").click();
    await page
      .locator("#company_info_registered_city")
      .fill(faker.location.city());
    await page.getByRole("button").filter({ hasText: /^$/ }).first().click();
    await page.getByText("Afghanistan").nth(2).click();
    await page.locator("#company_info_registered_street").click();
    await page
      .locator("#company_info_registered_street")
      .fill(faker.location.street());
    await page.locator("#company_info_registered_house_number").click();
    await page
      .locator("#company_info_registered_house_number")
      .fill(faker.location.buildingNumber());
    await page.locator("#company_info_registered_zip_code").click();
    await page
      .locator("#company_info_registered_zip_code")
      .fill(faker.location.zipCode());
    await page
      .getByRole("checkbox", { name: "Is the same as Registered" })
      .check();
    await page.getByRole("link", { name: "Save and go next" }).click();
    await page.locator('input[name="directors[0][first_name]"]').click();
    await page
      .locator('input[name="directors[0][first_name]"]')
      .fill(faker.person.firstName());
    await page.locator('input[name="directors[0][last_name]"]').click();
    await page
      .locator('input[name="directors[0][last_name]"]')
      .fill(faker.person.lastName());
    await page.locator('input[name="directors[0][nationality]"]').click();
    await page
      .locator('input[name="directors[0][nationality]"]')
      .fill(faker.location.countryCode());
    await page.locator('input[name="directors[0][date_of_birth]"]').click();
    await page
      .locator('input[name="directors[0][date_of_birth]"]')
      .fill("11.11.2002");
    await page
      .locator('input[name="directors[0][country_of_residence]"]')
      .click();
    await page
      .locator('input[name="directors[0][country_of_residence]"]')
      .fill(faker.location.country());
    await page.locator('input[name="directors[0][document_type]"]').click();
    await page
      .locator('input[name="directors[0][document_type]"]')
      .fill("Passport");
    await page.locator('input[name="directors[0][number]"]').click();
    await page
      .locator('input[name="directors[0][number]"]')
      .fill(faker.number.int().toString());
    await page.locator('input[name="directors[0][date_of_issue]"]').click();
    await page
      .locator('input[name="directors[0][date_of_issue]"]')
      .fill("11.11.2020");
    await page.locator('input[name="directors[0][issued_by]"]').click();
    await page
      .locator('input[name="directors[0][issued_by]"]')
      .fill(faker.company.name());
    await page.locator('input[name="directors[0][expiry_date]"]').click();
    await page
      .locator('input[name="directors[0][expiry_date]"]')
      .fill("11.11.2030");
    await page.locator('input[name="directors[0][unit_country]"]').click();
    await page
      .locator('input[name="directors[0][unit_country]"]')
      .fill(faker.location.countryCode());
    await page
      .locator("input#directors_attachments")
      .setInputFiles("assets/image.png");
    await page.getByRole("link", { name: "Save and go next" }).click();
    await page.locator('input[name="beneficiaries[0][first_name]"]').click();
    await page
      .locator('input[name="beneficiaries[0][first_name]"]')
      .fill(faker.person.firstName());
    await page.locator('input[name="beneficiaries[0][last_name]"]').click();
    await page
      .locator('input[name="beneficiaries[0][last_name]"]')
      .fill(faker.person.lastName());
    await page.locator('input[name="beneficiaries[0][nationality]"]').click();
    await page
      .locator('input[name="beneficiaries[0][nationality]"]')
      .fill(faker.location.countryCode());
    await page.locator('input[name="beneficiaries[0][date_of_birth]"]').click();
    await page
      .locator('input[name="beneficiaries[0][date_of_birth]"]')
      .fill("11.11.2002");
    await page
      .locator('input[name="beneficiaries[0][country_of_residence]"]')
      .click();
    await page
      .locator('input[name="beneficiaries[0][country_of_residence]"]')
      .fill(faker.location.country());
    await page.locator('input[name="beneficiaries[0][document_type]"]').click();
    await page
      .locator('input[name="beneficiaries[0][document_type]"]')
      .fill("Passport");
    await page.locator('input[name="beneficiaries[0][number]"]').click();
    await page
      .locator('input[name="beneficiaries[0][number]"]')
      .fill(faker.number.int().toString());
    await page.locator('input[name="beneficiaries[0][date_of_issue]"]').click();
    await page
      .locator('input[name="beneficiaries[0][date_of_issue]"]')
      .fill("11.11.2020");
    await page.locator('input[name="beneficiaries[0][issued_by]"]').click();
    await page
      .locator('input[name="beneficiaries[0][issued_by]"]')
      .fill(faker.company.name());
    await page.locator('input[name="beneficiaries[0][expiry_date]"]').click();
    await page
      .locator('input[name="beneficiaries[0][expiry_date]"]')
      .fill("11.11.2030");
    await page.locator('input[name="beneficiaries[0][unit_country]"]').click();
    await page
      .locator('input[name="beneficiaries[0][unit_country]"]')
      .fill(faker.location.countryCode());
    await page
      .locator("input#directors_attachments")
      .setInputFiles("assets/image.png");
    await page.getByRole("link", { name: "Save and go next" }).click();
    await page.locator("#company_info_description").click();
    await page
      .locator("#company_info_description")
      .fill(faker.location.streetAddress({ useFullAddress: true }));
    await page.getByRole("button").filter({ hasText: /^$/ }).first().click();
    await page.getByText("Individuals").click();
    await page.locator("#company_info_how_many_customers").click();
    await page
      .locator("#company_info_how_many_customers")
      .fill(faker.number.int().toString());
    await page.locator("#company_info_how_many_employees").click();
    await page
      .locator("#company_info_how_many_employees")
      .fill(faker.number.int().toString());
    await page.locator("#company_info_how_do_you_sell").click();
    await page.locator("#company_info_how_do_you_sell").fill(faker.word.verb());
    await page.getByRole("button").filter({ hasText: /^$/ }).first().click();
    await page.getByText("Receive payments from").click();
    await page
      .locator("div")
      .filter({ hasText: /^Requested accountsEUR IBAN account$/ })
      .getByRole("button")
      .click();
    await page.getByText("EUR IBAN account").click();
    await page.getByRole("button").filter({ hasText: /^$/ }).click();
    await page.getByText("Investments Of Company Owners").click();
    await page
      .locator("#company_info_type_of_your_future_outgoing_transfers")
      .click();
    await page
      .locator("#company_info_type_of_your_future_outgoing_transfers")
      .fill("Sells");
    await page.locator("#company_info_monthly_turnover").click();
    await page
      .locator("#company_info_monthly_turnover")
      .fill(faker.number.int().toString());
    await page
      .locator("#company_info_monthly_turnover_of_incoming_payments")
      .click();
    await page
      .locator("#company_info_monthly_turnover_of_incoming_payments")
      .fill(faker.number.int().toString());
    await page
      .locator("#company_info_monthly_turnover_of_outgoing_payments")
      .click();
    await page
      .locator("#company_info_monthly_turnover_of_outgoing_payments")
      .fill(faker.number.int().toString());
    await page.locator("#company_info_number_of_incoming_payments").click();
    await page
      .locator("#company_info_number_of_incoming_payments")
      .fill(faker.number.int().toString());
    await page.locator("#company_info_number_of_outgoing_payments").click();
    await page
      .locator("#company_info_number_of_outgoing_payments")
      .fill(faker.number.int().toString());
    await page.locator("#company_info_major_partners").click();
    await page
      .locator("#company_info_major_partners")
      .fill(faker.company.name());
    await page.locator("#company_info_operations_countries_list").click();
    await page
      .locator("#company_info_operations_countries_list")
      .fill(faker.location.country());
    await page.getByRole("button", { name: "Save and send" }).click();
  },
);

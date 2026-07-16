import type { TraderDriver } from "@/driver/trader";
import { throwResponseErrors, type TraderSchemas } from "@/driver/trader/traderFetchClient";
import { delay } from "@std/async";
import { assert } from "vitest";

export type ExtendedRequisite = ReturnType<typeof extendedRequisite>;

async function edit(this: ExtendedRequisite, update: Partial<TraderSchemas["requisite"]>) {
  await delay(1000);
  let current = await this.driver.client
    .GET("/api/profiles/{profile_id}/requisites", {
      params: { path: { profile_id: this.profile_id } },
    })
    .then(throwResponseErrors);
    console.log(current);
  let requisite = current.list.find((r) => r.id === this.id);
  assert(requisite, `Requisite ${this.id} for profile ${this.profile_id} was not found`);
  return await this.driver.client
    .PUT("/api/profiles/{profile_id}/requisites/{id}", {
      params: { path: { profile_id: this.profile_id, id: this.id } },
      body: {
        ...requisite,
        ...update,
      },
    })
    .then(throwResponseErrors);
}

export function extendedRequisite(driver: TraderDriver, id: number, profile_id: number) {
  return { id, profile_id, driver, edit };
}

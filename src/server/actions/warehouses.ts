"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/warehouses";

async function actor() {
  const s = await getSession();
  if (!s) return fail("You are not signed in.");
  return s;
}

export async function createWarehouseAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const id = await svc.createWarehouse(me as never, {
      code: String(formData.get("code") ?? ""),
      name: String(formData.get("name") ?? ""),
      address: String(formData.get("address") ?? ""),
    });
    revalidatePath("/warehouses");
    redirect(`/warehouses/${id}`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function setDefaultWarehouseAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.setDefaultWarehouse(me as never, id);
    revalidatePath("/warehouses");
    revalidatePath(`/warehouses/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function deleteWarehouseAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.deleteWarehouse(me as never, id);
    revalidatePath("/warehouses");
    redirect("/warehouses");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function addLocationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const warehouseId = String(formData.get("warehouseId") ?? "");
  try {
    await svc.addLocation(me as never, warehouseId, String(formData.get("code") ?? ""), String(formData.get("zone") ?? ""));
    revalidatePath(`/warehouses/${warehouseId}`);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function deleteLocationAction(warehouseId: string, locationId: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.deleteLocation(me as never, warehouseId, locationId);
    revalidatePath(`/warehouses/${warehouseId}`);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

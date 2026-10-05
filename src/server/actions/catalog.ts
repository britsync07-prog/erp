"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/catalog";

async function actor() {
  const s = await getSession();
  if (!s) return fail("You are not signed in.");
  return s;
}

function form(raw: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  raw.forEach((v, k) => {
    if (typeof v === "string") out[k] = v;
  });
  return out;
}

export async function createCategoryAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.createCategory(me as never, String(formData.get("name") ?? ""), String(formData.get("parentId") ?? "") || undefined);
    revalidatePath("/categories");
    revalidatePath("/products/new");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.deleteCategory(me as never, id);
    revalidatePath("/categories");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function createProductAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const id = await svc.createProduct(me as never, form(formData));
    revalidatePath("/products");
    redirect(`/products/${id}`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function updateProductAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const id = String(formData.get("id") ?? "");
  try {
    await svc.updateProduct(me as never, id, form(formData));
    revalidatePath(`/products/${id}`);
    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function discontinueProductAction(id: string, discontinued: boolean): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.discontinueProduct(me as never, id, discontinued);
    revalidatePath(`/products/${id}`);
    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function deleteProductAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.deleteProduct(me as never, id);
    revalidatePath("/products");
    redirect("/products");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function addPriceRuleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const productId = String(formData.get("productId") ?? "");
  try {
    await svc.addPriceRule(me as never, productId, form(formData));
    revalidatePath(`/products/${productId}`);
    revalidatePath("/pricing");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function linkSupplierAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const productId = String(formData.get("productId") ?? "");
  try {
    await svc.linkProductSupplier(
      me as never,
      productId,
      String(formData.get("supplierId") ?? ""),
      Math.round(Number(formData.get("cost")) * 100),
      formData.get("preferred") === "on",
    );
    revalidatePath(`/products/${productId}`);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

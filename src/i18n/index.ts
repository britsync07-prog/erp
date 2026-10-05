// Minimal i18n infrastructure (§40). Default locale is English (per client
// choice); Italian dictionary ships alongside so no string is hardcoded in a
// way that blocks translation. Server components import { t } with locale.

export const LOCALES = ["en", "it"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const en = {
  "nav.home": "Home",
  "nav.customers": "Customers",
  "nav.suppliers": "Suppliers",
  "nav.products": "Products",
  "nav.categories": "Categories",
  "nav.pricing": "Pricing",
  "nav.warehouses": "Warehouses",
  "nav.users": "Users",
  "nav.roles": "Roles",
  "nav.audit": "Audit log",
  "nav.notifications": "Notifications",
  "nav.search": "Search",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.create": "Create",
  "common.search": "Search",
  "common.noResults": "No results found.",
  "common.loading": "Loading…",
  "auth.signIn": "Sign in",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.invalid": "Invalid email or password.",
  "home.title": "Operational command centre",
  "home.subtitle": "What is happening in the business right now.",
} as const;

const it: Record<keyof typeof en, string> = {
  "nav.home": "Home",
  "nav.customers": "Clienti",
  "nav.suppliers": "Fornitori",
  "nav.products": "Prodotti",
  "nav.categories": "Categorie",
  "nav.pricing": "Prezzi",
  "nav.warehouses": "Magazzini",
  "nav.users": "Utenti",
  "nav.roles": "Ruoli",
  "nav.audit": "Registro audit",
  "nav.notifications": "Notifiche",
  "nav.search": "Cerca",
  "common.save": "Salva",
  "common.cancel": "Annulla",
  "common.delete": "Elimina",
  "common.edit": "Modifica",
  "common.create": "Crea",
  "common.search": "Cerca",
  "common.noResults": "Nessun risultato.",
  "common.loading": "Caricamento…",
  "auth.signIn": "Accedi",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.invalid": "Email o password non validi.",
  "home.title": "Centro di comando operativo",
  "home.subtitle": "Cosa sta accadendo in azienda in questo momento.",
};

export const dictionaries: Record<Locale, Record<keyof typeof en, string>> = { en, it };
export type DictKey = keyof typeof en;

export function t(locale: Locale, key: DictKey): string {
  return dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
}

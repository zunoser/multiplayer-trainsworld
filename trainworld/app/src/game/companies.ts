import { computed, signal } from "@preact/signals";
import type { Competition } from "../workers/protocol";
export const companies = signal<Competition | null>(null);
export const myCompanyId = signal<string | null>(null);
export const myCompany = computed(()=>companies.value?.companies.find(c=>c.id===myCompanyId.value)??null);
export const operatingProfit = (c: Competition["companies"][number])=>c.revenue-c.running-c.upkeep;

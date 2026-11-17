import { companies, myCompanyId, operatingProfit } from "../game/companies";
import { t } from "../i18n";
import { Money } from "./MoneyText";
export function CompanyTable() {
  const game=companies.value;if(!game)return null;
  const ranked=[...game.companies].sort((a,b)=>operatingProfit(b)-operatingProfit(a)||a.id.localeCompare(b.id));
  return <section aria-label={t("competition.standings")}>
    <h2 class="h">{t("competition.standings")}</h2>
    <table class="company-table"><thead><tr><th>{t("competition.company")}</th><th>{t("competition.cash")}</th><th>{t("competition.profit")}</th></tr></thead>
      <tbody>{ranked.map(c=><tr key={c.id} aria-current={c.id===myCompanyId.value?"true":undefined}><th>{c.name}{c.id===myCompanyId.value?" · "+t("lobby.youShort"):""}</th><td class="num"><Money dollars={c.cash*1e6} /></td><td class="num"><Money dollars={operatingProfit(c)*1e6} /></td></tr>)}</tbody></table>
    <p class="small muted">{t("competition.profitNote")}</p>
  </section>;
}

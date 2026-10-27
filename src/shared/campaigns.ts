import { normalizeSearch } from './search';

export const campaignSourceNames: Record<string, string> = {
  facebook: 'فيسبوك',
  instagram: 'إنستغرام',
  threads: 'ثريدز',
  audience_network: 'شبكة جمهور Meta',
  meta: 'فيسبوك / إنستغرام',
  tiktok: 'تيك توك',
  google: 'جوجل',
  snapchat: 'سناب شات',
  direct: 'مباشر أو مصدر غير معروف',
  referral: 'إحالة من موقع آخر',
  fb: 'فيسبوك',
  ig: 'إنستغرام',
  th: 'ثريدز',
  an: 'شبكة جمهور Meta',
};
export function canonicalCampaignSource(source: string) {
  const value = source.trim().toLowerCase() || 'direct';
  return (
    (
      { fb: 'facebook', ig: 'instagram', th: 'threads', an: 'audience_network' } as Record<
        string,
        string
      >
    )[value] || value
  );
}
export const campaignMetrics = ['visits', 'checkouts', 'orders', 'delivered', 'revenue'] as const;
export type CampaignMetric = (typeof campaignMetrics)[number];
export type CampaignRow = Record<CampaignMetric, number> & { source: string; campaign: string };
export type CampaignGroup = Record<CampaignMetric, number> & {
  id: string;
  campaign: string;
  sources: CampaignRow[];
};
export type SavedCampaignLink = {
  id: string;
  campaign: string;
  source: string;
  target: string;
  url: string;
  created_at: string;
};
export const matchesCampaign = (name: string, search: string) => {
  const text = normalizeSearch(name);
  return normalizeSearch(search)
    .split(' ')
    .filter(Boolean)
    .every((token) => text.includes(token));
};
// Presentation only: preserve stored attribution, saved URLs and the existing
// per-session/per-day counting rules. Unnamed traffic remains separate by source.
export function groupCampaigns(
  rows: CampaignRow[],
  search = '',
  source = '',
  sort: CampaignMetric = 'visits',
): CampaignGroup[] {
  const groups = new Map<string, CampaignGroup>();
  for (const row of rows) {
    const canonical = canonicalCampaignSource(row.source),
      campaign = row.campaign.trim();
    if ((source && canonical !== source) || !matchesCampaign(campaign, search)) continue;
    const id = JSON.stringify(campaign ? ['campaign', campaign] : ['source', canonical]);
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        campaign,
        sources: [],
        visits: 0,
        checkouts: 0,
        orders: 0,
        delivered: 0,
        revenue: 0,
      };
      groups.set(id, group);
    }
    let detail = group.sources.find((s) => s.source === canonical);
    if (!detail) {
      detail = {
        source: canonical,
        campaign,
        visits: 0,
        checkouts: 0,
        orders: 0,
        delivered: 0,
        revenue: 0,
      };
      group.sources.push(detail);
    }
    for (const metric of campaignMetrics) {
      const value = Number(row[metric]) || 0;
      detail[metric] += value;
      group[metric] += value;
    }
  }
  return [...groups.values()].sort((a, b) => b[sort] - a[sort] || a.id.localeCompare(b.id));
}
export function filterCampaignLinks(links: SavedCampaignLink[], search = '', source = '') {
  return links.filter(
    (link) =>
      matchesCampaign(link.campaign, search) &&
      (!source || canonicalCampaignSource(link.source) === source),
  );
}
export function campaignPage<T>(rows: T[], page: number, size = 10) {
  const pages = Math.max(1, Math.ceil(rows.length / size)),
    current = Math.max(1, Math.min(pages, page));
  return {
    rows: rows.slice((current - 1) * size, current * size),
    page: current,
    pages,
    count: rows.length,
  };
}

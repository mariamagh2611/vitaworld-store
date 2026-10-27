import { expect, it } from 'vitest';
import {
  groupCampaigns,
  campaignPage,
  filterCampaignLinks,
  type CampaignRow,
} from '../src/shared/campaigns';

const row = (
  source: string,
  campaign: string,
  visits: number,
  orders = 0,
  revenue = 0,
): CampaignRow => ({
  source,
  campaign,
  visits,
  orders,
  revenue,
  checkouts: orders + 1,
  delivered: orders,
});
it('combines campaign aliases without changing stored rows or mixing distinct campaigns', () => {
  const rows = [
    row('facebook', 'Gluta V1', 4, 1, 10000),
    row('fb', 'Gluta V1', 6, 2, 20000),
    row('ig', 'Gluta V1', 3),
    row('fb', 'Gluta V2', 1),
  ];
  const before = structuredClone(rows),
    groups = groupCampaigns(rows);
  expect(groups).toHaveLength(2);
  expect(groups[0]).toMatchObject({ campaign: 'Gluta V1', visits: 13, orders: 3, revenue: 30000 });
  expect(groups[0].sources).toHaveLength(2);
  expect(groups[0].sources[0]).toMatchObject({ source: 'facebook', visits: 10, orders: 3 });
  expect(rows).toEqual(before);
});
it('keeps unnamed direct and social traffic separate and applies source filters before totals', () => {
  const rows = [
    row('direct', '', 20),
    row('fb', '', 5),
    row('facebook', '', 4),
    row('ig', 'Campaign', 3),
    row('fb', 'Campaign', 8),
  ];
  expect(groupCampaigns(rows)).toHaveLength(3);
  expect(groupCampaigns(rows, 'campaign', 'instagram')[0]).toMatchObject({
    visits: 3,
    sources: [
      {
        source: 'instagram',
        visits: 3,
        orders: 0,
        delivered: 0,
        revenue: 0,
        checkouts: 1,
        campaign: 'Campaign',
      },
    ],
  });
});
it('searches campaign names across all pages with Arabic and French normalization', () => {
  const rows = Array.from({ length: 35 }, (_, i) => row('fb', 'Campaign ' + i, 35 - i));
  rows.push(row('ig', 'Sélénium عناية البشرة', 1));
  expect(groupCampaigns(rows, 'SELENIUM البشره')).toHaveLength(1);
  expect(campaignPage(groupCampaigns(rows), 1).rows).toHaveLength(10);
  expect(campaignPage(groupCampaigns(rows, 'Campaign 34'), 4)).toMatchObject({
    page: 1,
    pages: 1,
    count: 1,
  });
  expect(campaignPage(groupCampaigns(rows, 'absent'), 99)).toMatchObject({
    page: 1,
    pages: 1,
    count: 0,
    rows: [],
  });
});
it('sorts numeric results, searches all saved links, and clamps the page after deletion', () => {
  const groups = groupCampaigns(
    [row('fb', 'Popular', 100, 0), row('ig', 'Converts', 2, 3, 30000)],
    '',
    '',
    'orders',
  );
  expect(groups[0].campaign).toBe('Converts');
  const links = Array.from({ length: 21 }, (_, i) => ({
    id: String(i),
    campaign: 'Campaign ' + i,
    source: i === 20 ? 'ig' : 'fb',
    target: 'https://shop.example/',
    url: 'https://shop.example/?id=' + i,
    created_at: '2026-10-16T10:00:00Z',
  }));
  expect(filterCampaignLinks(links, 'campaign 20', 'instagram').map((link) => link.id)).toEqual([
    '20',
  ]);
  expect(campaignPage(links.slice(0, 20), 3)).toMatchObject({ page: 2, pages: 2, count: 20 });
});

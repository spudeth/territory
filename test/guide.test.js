// The Game Guide (loop 16): built from data/economy.json, so it always shows the current numbers. In memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderGuide } = require('../guide');
const economy = require('../data/economy.json');
const catalog = require('../catalog');
const upgrades = require('../upgrades');

test('the guide has every section, the numbers from the data, the whole glossary, and no secret achievements', () => {
  const html = renderGuide({ maps: [{ name: 'Pangea', base: 10240 }, { name: 'White Plains', base: 40000 }] });
  for (const id of ['play', 'levels', 'pay', 'upgrades', 'market', 'achievements', 'glossary']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(html.includes('Pangea (E = 10,240)') && html.includes('71,680'), 'a level table for each official map (level 4 of Pangea: 7 x E)');
  for (const u of Object.values(economy.tiers)) assert.ok(html.includes(`<h3>${u.name}</h3>`), u.name);
  assert.ok(html.includes(Number(catalog.fromTenths(upgrades.tierCostTenths('clickPower', 10))).toLocaleString('en-US')), 'tier 10 cost');
  for (const g of economy.glossary) assert.ok(html.includes(g.meaning.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')), g.symbol);
  const secret = economy.achievements.find(a => a.secret);
  if (secret) assert.ok(!html.includes(secret.description.replace(/&/g, '&amp;')), 'secrets stay hidden');
  assert.ok(html.includes('href="/privacy"') && html.includes('<title>Game Guide · Territory</title>'));
});

test('plug-ins add their sections after Upgrades, with a link at the top (loop 19)', () => {
  const html = renderGuide({ pluginSections: () => [{ id: 'gizmos', title: 'Gizmos', html: '<h2 id="gizmos">Gizmos</h2>' }] });
  assert.ok(html.includes('href="#gizmos">Gizmos</a>'));
  assert.ok(html.indexOf('id="upgrades"') < html.indexOf('id="gizmos"') && html.indexOf('id="gizmos"') < html.indexOf('id="market"'));
});

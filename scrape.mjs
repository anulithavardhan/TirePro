import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const SITE = 'https://www.tireworksinc.com/shop-tires/';
const LOCATION_ID = '57486';
const BRAND_ID = '99'; // GT Radial

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const inputFile = path.resolve(arg('input', 'input.tsv'));
const outputFile = path.resolve(arg('output', `tireworks-prices-${new Date().toISOString().slice(0, 10)}.csv`));
const headless = arg('headless', 'true').toLowerCase() !== 'false';
const delayMs = Number(arg('delay-ms', '1500'));
const batchSize = Number(arg('batch-size', '40'));
const batchPauseMs = Number(arg('batch-pause-ms', '60000'));
const shardIndex = Number(arg('shard-index', '0'));
const shardTotal = Number(arg('shard-total', '1'));
if (!Number.isInteger(shardIndex) || !Number.isInteger(shardTotal) || shardTotal < 1 || shardIndex < 0 || shardIndex >= shardTotal) {
  throw new Error('Invalid shard settings. Use --shard-index 0..N-1 with --shard-total N.');
}

function parseInput(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const start = /^Brand\+Product\tRawsize$/i.test(lines[0]?.trim()) ? 1 : 0;
  const seen = new Set();
  return lines.slice(start).map((line, index) => {
    const [product, rawSize] = line.split('\t').map(v => v?.trim());
    if (!product || !rawSize) throw new Error(`Bad input row ${index + start + 1}: ${line}`);
    return { product, rawSize };
  }).filter(row => {
    const key = `${row.product.toLowerCase()}|${row.rawSize.toUpperCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseSize(raw) {
  const s = raw.toUpperCase().replace(/^LT/, '').replace(/\s+XL$/, '').replace(/LT$/, '').replace(/C$/, '').trim();
  let m = s.match(/^(\d{3})\/(\d{2})R(\d{2}(?:\.5)?)$/);
  if (m) return { width: m[1], height: m[2], rim: m[3] };
  m = s.match(/^(\d{2}(?:\.\d{1,2})?)X(\d{1,2}(?:\.\d{1,2})?)R(\d{2}(?:\.5)?)$/);
  if (m) return { width: String(Number(m[1])), height: String(Number(m[2])), rim: String(Number(m[3])) };
  throw new Error(`Unsupported tire size: ${raw}`);
}

function productKey(s) {
  return s.normalize('NFKD').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function searchUrl(size) {
  const q = new URLSearchParams({
    bp: 'tire', location_id: LOCATION_ID, search_by: 'size', type: 'passenger',
    'width>': size.width, 'height>': size.height, 'rim>': size.rim, season: 'all',
    page: '1', order_by: 'best_match', display: 'full', 'filters>brand_id>': BRAND_ID
  });
  return `${SITE}#!tires/results?${q.toString()}`;
}

function csv(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const requested = parseInput(fs.readFileSync(inputFile, 'utf8'));
const groups = new Map();
for (const row of requested) {
  const size = parseSize(row.rawSize);
  const key = `${size.width}|${size.height}|${size.rim}`;
  if (!groups.has(key)) groups.set(key, { size, rows: [] });
  groups.get(key).rows.push(row);
}
const selectedGroups = [...groups.values()].filter((_, index) => index % shardTotal === shardIndex);
console.log(`Shard ${shardIndex + 1}/${shardTotal}: ${selectedGroups.length} of ${groups.size} unique sizes`);

let browser = await chromium.launch({ headless });
const results = [];
const missing = [];

try {
  let done = 0;
  for (const { size, rows } of selectedGroups) {
    done += 1;
    if (done > 1 && batchSize > 0 && (done - 1) % batchSize === 0) {
      console.log(`Cooling down for ${Math.round(batchPauseMs / 1000)}s after ${done - 1} sizes...`);
      await browser.close().catch(() => {});
      await new Promise(resolve => setTimeout(resolve, batchPauseMs));
      browser = await chromium.launch({ headless });
    }
    console.log(`[${done}/${selectedGroups.length}] ${size.width}/${size.height}R${size.rim}`);
    let cards = null;
    let lastError = '';
    for (let attempt = 1; attempt <= 3 && cards === null; attempt += 1) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      try {
        await page.goto(searchUrl(size), { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForFunction(({ width, height, rim }) => {
          const title = document.querySelector('[data-tctid="page_title"]')?.textContent?.trim().toUpperCase() || '';
          const metric = title.match(/^(?:LT)?(\d{3})\/(\d{2})R(\d{2}(?:\.5)?)/);
          const flotation = title.match(/^(\d{2}(?:\.\d+)?)X(\d{1,2}(?:\.\d+)?)R(\d{2}(?:\.5)?)/);
          const shown = metric || flotation;
          const correctSize = shown &&
            Number(shown[1]) === Number(width) &&
            Number(shown[2]) === Number(height) &&
            Number(shown[3]) === Number(rim);
          return correctSize && (
            document.querySelector('[data-tctid="result"]') ||
            /(?:found\s+0|no tires|no results)/i.test(document.body.innerText)
          );
        }, size, { timeout: 60000 });

        cards = await page.locator('[data-tctid="result"]').evaluateAll(nodes => nodes.map(card => ({
          brand: card.querySelector('[data-tctid="product_brand"] img')?.getAttribute('alt')?.replace(/\s*Tire\.?$/i, '').trim() || 'GT Radial',
          product: card.querySelector('[data-tctid="product_model"]')?.textContent?.trim() || '',
          size: card.querySelector('[data-tctid="tire_size"]')?.textContent?.replace(/^Size:\s*/i, '').replace(/\s+/g, ' ').trim() || '',
          price: card.querySelector('[data-tctid="product_price"]')?.textContent?.trim() || ''
        })));
      } catch (error) {
        lastError = error?.message?.split('\n')[0] || String(error);
        console.warn(`  attempt ${attempt}/3 failed: ${lastError}`);
        if (attempt < 3) {
          const retryPauseMs = attempt * 60000;
          console.log(`  restarting browser and waiting ${retryPauseMs / 1000}s before retry...`);
          await page.close().catch(() => {});
          await browser.close().catch(() => {});
          await new Promise(resolve => setTimeout(resolve, retryPauseMs));
          browser = await chromium.launch({ headless });
        }
      } finally {
        await page.close().catch(() => {});
      }
    }

    if (cards === null) {
      console.error(`  skipped after 3 attempts`);
      missing.push(...rows.map(row => ({ ...row, reason: `scrape_failed: ${lastError}` })));
      console.log('  cooling down for 120s before continuing with the next size...');
      await browser.close().catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 120000));
      browser = await chromium.launch({ headless });
      continue;
    }

    for (const wanted of rows) {
      const matches = cards.filter(card => productKey(card.product) === productKey(wanted.product));
      if (!matches.length) missing.push({ ...wanted, reason: 'product_not_returned' });
      for (const match of matches) results.push(match);
    }
    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
} finally {
  await browser.close();
}

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
const rows = [['brand', 'product', 'size', 'price'], ...results.map(r => [r.brand, r.product, r.size, r.price])];
fs.writeFileSync(outputFile, rows.map(r => r.map(csv).join(',')).join('\r\n') + '\r\n', 'utf8');

const missingFile = outputFile.replace(/\.csv$/i, '-missing.csv');
const missingRows = [['product', 'requested_size', 'reason'], ...missing.map(r => [r.product, r.rawSize, r.reason])];
fs.writeFileSync(missingFile, missingRows.map(r => r.map(csv).join(',')).join('\r\n') + '\r\n', 'utf8');
console.log(`Wrote ${results.length} price rows to ${outputFile}`);
console.log(`Wrote ${missing.length} unmatched requests to ${missingFile}`);

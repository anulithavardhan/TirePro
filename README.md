# Tireworks GT Radial price scraper

This Playwright scraper reads `input.tsv`, groups requests by tire size, opens one GT Radial-filtered result page per unique size, and writes dated CSV output.

## GitHub Actions: weekday automation

1. Create a GitHub repository.
2. Upload every item in this folder, including the hidden `.github` folder.
3. Open the repository's **Actions** tab and enable workflows if prompted.
4. Select **Tireworks weekday scrape**, then choose **Run workflow** for the first test.

The workflow runs at **7:00 AM America/New_York, Monday through Friday**. Eastern daylight-saving time is handled by the workflow timezone setting.

Each run uploads a `tireworks-prices-*` artifact containing:

- `tireworks-prices-YYYY-MM-DD.csv` with `brand,product,size,price`.
- `tireworks-prices-YYYY-MM-DD-missing.csv` with requests the site did not return.

Artifacts remain downloadable from the workflow run for 30 days. No GitHub secrets are required.

## Run locally

Install Node.js 22 or newer, then run from PowerShell:

```powershell
.\run-daily.ps1
```

On its first run, the script installs the required npm package and Chromium browser.

To specify paths directly:

```powershell
node .\scrape.mjs --input .\input.tsv --output .\prices.csv
```

## Optional Windows schedule

GitHub Actions replaces the need for a Windows task. If you still want the local backup schedule, run an Administrator PowerShell window once:

```powershell
.\install-daily-task.ps1 -At '07:00'
```

## Input rules

Keep the two tab-separated columns `Brand+Product` and `Rawsize`. Metric, `LT` prefix/suffix, `C`, `XL`, and flotation forms such as `35X12.50R20LT` are supported. `LT` is omitted from the site search, while the exact returned size/load designation is retained in the output.

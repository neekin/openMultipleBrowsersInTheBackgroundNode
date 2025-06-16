const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// 自动检测 chromium 路径
function detectChromiumPath() {
  const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const chromiumPath = detectChromiumPath();

function randomFingerprint() {
  const { chromeVersionRange, buildRange, viewportRange } = config.fingerprint;
  return {
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${Math.floor(Math.random() * (chromeVersionRange.max - chromeVersionRange.min) + chromeVersionRange.min)}.0.${Math.floor(Math.random() * (buildRange.max - buildRange.min) + buildRange.min)}.100 Safari/537.36`,
    viewport: {
      width: Math.floor(Math.random() * (viewportRange.width.max - viewportRange.width.min) + viewportRange.width.min),
      height: Math.floor(Math.random() * (viewportRange.height.max - viewportRange.height.min) + viewportRange.height.min),
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      isLandscape: true
    }
  };
}

async function launchBrowser({ userDataDir, fingerprint, url }) {
  const launchOptions = {
    ...config.browser.launchOptions,
    userDataDir,
    args: [
      ...config.browser.launchOptions.args,
      `--window-size=${fingerprint.viewport.width},${fingerprint.viewport.height}`
    ]
  };
  if (chromiumPath) launchOptions.executablePath = chromiumPath;
  
  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  await page.setUserAgent(fingerprint.userAgent);
  await page.setViewport(fingerprint.viewport);
  if (url) await page.goto(url);
  return { browser, page };
}

async function restoreBrowser(row) {
  const launchOptions = {
    ...config.browser.launchOptions,
    userDataDir: row.userDataDir,
    args: [
      ...config.browser.launchOptions.args,
      `--window-size=${JSON.parse(row.viewport).width},${JSON.parse(row.viewport).height}`
    ]
  };
  if (chromiumPath) launchOptions.executablePath = chromiumPath;
  
  const browser = await puppeteer.launch(launchOptions);
  const pages = await browser.pages();
  for (const p of pages) {
    await p.setUserAgent(row.userAgent);
    await p.setViewport(JSON.parse(row.viewport));
    if (row.url) {
      try { await p.goto(row.url); } catch {}
    }
  }
  return { browser, pages };
}

async function restoreAllBrowsers(db, browsers) {
  return new Promise((resolve) => {
    db.all('SELECT * FROM browsers', async (err, rows) => {
      if (err) {
        console.error('恢复浏览器实例时数据库查询失败:', err.message);
        return resolve();
      }
      
      console.log(`发现 ${rows.length} 个历史实例，正在尝试恢复...`);
      
      const restorePromises = rows.map(async (row) => {
        try {
          const { browser, pages } = await restoreBrowser(row);
          browser.on('targetcreated', async target => {
            if (target.type() === 'page') {
              const newPage = await target.page();
              pages.push(newPage);
              if (browsers[row.id] && browsers[row.id].wsList) {
                for (const ws of browsers[row.id].wsList) {
                  try { ws.send(JSON.stringify({ type: 'tabUpdate' })); } catch {}
                }
              }
            }
          });
          browsers[row.id] = {
            browser,
            pages,
            activePageIdx: 0,
            fingerprint: { userAgent: row.userAgent, viewport: JSON.parse(row.viewport) },
            wsEndpoint: browser.wsEndpoint(),
            createdAt: row.createdAt,
            userDataDir: row.userDataDir
          };
          console.log(`已恢复实例: ${row.id}`);
        } catch (error) {
          console.error(`恢复实例 ${row.id} 失败:`, error.message);
        }
      });
      
      await Promise.all(restorePromises);
      console.log('浏览器实例恢复完成');
      resolve();
    });
  });
}

module.exports = {
  randomFingerprint,
  launchBrowser,
  restoreBrowser,
  restoreAllBrowsers,
  detectChromiumPath,
  chromiumPath
};

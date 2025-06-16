const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const config = require('../config');
const { randomFingerprint, launchBrowser, restoreBrowser } = require('../browserManager');

// 工具函数：安全删除目录
function removeDirectory(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 工具函数：设置浏览器事件监听
function setupBrowserEvents(browser, pages, id, browsers) {
  browser.on('targetcreated', async target => {
    if (target.type() === 'page') {
      const newPage = await target.page();
      pages.push(newPage);
      if (browsers[id] && browsers[id].wsList) {
        for (const ws of browsers[id].wsList) {
          try { ws.send(JSON.stringify({ type: 'tabUpdate' })); } catch {}
        }
      }
    }
  });
}

module.exports = function(browsers, db) {
  const router = express.Router();

  // 创建 Puppeteer 实例
  router.post('/create', async (req, res) => {
    try {
      const id = crypto.randomUUID();
      const fingerprint = randomFingerprint();
      const userDataDir = path.join(config.browser.userDataDir, id);
      let url = req.body?.url || config.browser.defaultUrl;
      if (!/^https?:\/\//.test(url)) url = 'https://' + url;
      const { browser, page } = await launchBrowser({ userDataDir, fingerprint, url });
      const pages = [page];
      setupBrowserEvents(browser, pages, id, browsers);
      browsers[id] = { browser, pages, activePageIdx: 0, fingerprint, wsEndpoint: browser.wsEndpoint(), createdAt: new Date().toISOString(), userDataDir };
      db.run(
        `INSERT OR REPLACE INTO browsers (id, userAgent, viewport, wsEndpoint, createdAt, userDataDir, url) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, fingerprint.userAgent, JSON.stringify(fingerprint.viewport), browser.wsEndpoint(), new Date().toISOString(), userDataDir, url]
      );
      res.json({ id, wsEndpoint: browser.wsEndpoint(), fingerprint });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 获取实例列表（内存+数据库）
  router.get('/', (req, res) => {
    db.all('SELECT * FROM browsers', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      // 合并内存中的实时状态
      const memMap = new Map(Object.entries(browsers));
      const list = rows.map(row => {
        const mem = memMap.get(row.id);
        return {
          id: row.id,
          wsEndpoint: mem?.wsEndpoint || row.wsEndpoint,
          userAgent: row.userAgent,
          createdAt: row.createdAt || '',
          online: !!mem
        };
      });
      res.json(list);
    });
  });

  // 获取指定实例的所有标签页信息
  router.get('/:id/pages', async (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) return res.status(404).json({ error: 'not found' });
    const infos = await Promise.all(inst.pages.map(async (p, idx) => {
      let title = '';
      try { title = await p.title(); } catch {}
      let url = '';
      try { url = p.url(); } catch {}
      return { idx, title, url };
    }));
    res.json(infos);
  });

  // 删除实例
  router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    const inst = browsers[id];
    try {
      if (inst) {
        if (inst.pages) {
          for (const p of inst.pages) {
            try { await p.close(); } catch (e) {}
          }
        }
        if (inst.browser) {
          try { await inst.browser.close(); } catch (e) {}
        }
        if (inst.wsList) {
          for (const ws of inst.wsList) {
            try { ws.close(); } catch (e) {}
          }
        }
        if (inst.userDataDir) removeDirectory(inst.userDataDir);
        delete browsers[id];
      } else {
        // 不在内存时也尝试删除 userDataDir
        db.get('SELECT * FROM browsers WHERE id = ?', [id], (err, row) => {
          if (row && row.userDataDir) {
            removeDirectory(row.userDataDir);
          }
        });
      }
      db.run('DELETE FROM browsers WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 恢复历史实例到内存
  router.post('/:id/restore', async (req, res) => {
    const id = req.params.id;
    if (browsers[id]) return res.json({ success: true, online: true });
    db.get('SELECT * FROM browsers WHERE id = ?', [id], async (err, row) => {
      if (err || !row) return res.status(404).json({ error: 'not found' });
      try {
        const { browser, pages } = await restoreBrowser(row);
        setupBrowserEvents(browser, pages, id, browsers);
        browsers[id] = {
          browser,
          pages,
          activePageIdx: 0,
          fingerprint: { userAgent: row.userAgent, viewport: JSON.parse(row.viewport) },
          wsEndpoint: browser.wsEndpoint(),
          createdAt: row.createdAt,
          userDataDir: row.userDataDir
        };
        res.json({ success: true, online: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  });

  return router;
};

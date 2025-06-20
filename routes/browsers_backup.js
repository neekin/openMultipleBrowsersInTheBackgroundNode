const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const config = require('../config');
const { randomFingerprint, launchBrowser, restoreBrowser, checkInstanceStatus, smartStartInstance } = require('../browserManager');

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
    const performanceManager = require('../performanceManager');
    
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
        
        // 清理性能监控数据
        performanceManager.cleanupInstance(id);
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

  // 远程批量操作 API
  router.post('/:id/batch-operations', async (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) return res.status(404).json({ error: 'not found' });
    
    const { operations } = req.body;
    if (!Array.isArray(operations)) {
      return res.status(400).json({ error: 'operations must be an array' });
    }
    
    try {
      const page = inst.pages[inst.activePageIdx || 0];
      if (!page) {
        return res.status(400).json({ error: 'no active page' });
      }
      
      // 批量执行操作
      for (const op of operations) {
        switch (op.type) {
          case 'click':
            await page.mouse.click(op.x, op.y);
            break;
          case 'type':
            await page.keyboard.type(op.text);
            break;
          case 'goto':
            await page.goto(op.url, { waitUntil: 'networkidle2' });
            break;
          case 'evaluate':
            await page.evaluate(op.code);
            break;
        }
      }
      
      res.json({ success: true, operationsExecuted: operations.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 获取实例性能统计
  router.get('/:id/stats', async (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) return res.status(404).json({ error: 'not found' });
    
    try {
      const page = inst.pages[inst.activePageIdx || 0];
      if (!page) {
        return res.json({ error: 'no active page' });
      }
      
      // 获取页面性能指标
      const metrics = await page.metrics();
      const title = await page.title();
      const url = page.url();
      
      res.json({
        instance: {
          id: req.params.id,
          createdAt: inst.createdAt,
          pagesCount: inst.pages.length,
          activePageIndex: inst.activePageIdx || 0,
          wsConnections: inst.wsList ? inst.wsList.length : 0
        },
        page: {
          title,
          url,
          metrics
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 快速截图 API（不通过 WebSocket）
  router.get('/:id/screenshot', async (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) return res.status(404).json({ error: 'not found' });
    
    try {
      const page = inst.pages[inst.activePageIdx || 0];
      if (!page) {
        return res.status(400).json({ error: 'no active page' });
      }
      
      const quality = parseInt(req.query.quality) || 30;
      const fullPage = req.query.fullPage === 'true';
      
      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: Math.min(Math.max(quality, 10), 100),
        fullPage
      });
      
      res.set('Content-Type', 'image/jpeg');
      res.send(screenshot);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 全局性能统计 API
  router.get('/performance/global', (req, res) => {
    const stats = require('../performanceManager').getGlobalStats();
    res.json(stats);
  });

  // 实例性能优化建议 API
  router.get('/:id/performance/suggestions', (req, res) => {
    const suggestions = require('../performanceManager').getPerformanceSuggestions(req.params.id);
    res.json({ suggestions });
  });

  // 动态配置优化 API
  router.get('/:id/performance/config', (req, res) => {
    const optimizedConfig = require('../performanceManager').getAutoOptimizationConfig(req.params.id);
    res.json(optimizedConfig);
  });

  // 系统资源统计 API
  router.get('/system/resources', (req, res) => {
    const resourceStats = require('../resourceManager').getResourceStats();
    res.json(resourceStats);
  });

  // 系统优化建议 API
  router.get('/system/recommendations', (req, res) => {
    const recommendations = require('../resourceManager').getSystemRecommendations();
    res.json({ recommendations });
  });

  // 高级操作统计 API
  router.get('/system/operations', (req, res) => {
    const operationStats = require('../advancedOperationManager').getGlobalStats();
    res.json(operationStats);
  });

  // 实例资源详情 API
  router.get('/:id/resources', (req, res) => {
    const resourceDetails = require('../resourceManager').getInstanceDetails(req.params.id);
    const operationStats = require('../advancedOperationManager').getInstanceStats(req.params.id);
    
    if (!resourceDetails && !operationStats) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    res.json({
      resources: resourceDetails,
      operations: operationStats
    });
  });

  // 实例内存优化 API
  router.post('/:id/optimize', async (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) return res.status(404).json({ error: 'not found' });

    try {
      const resourceManager = require('../resourceManager');
      await resourceManager.optimizeInstanceMemory(req.params.id);
      
      // 强制垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
      }

      res.json({ success: true, message: '内存优化完成' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 实例预加载 API
  router.post('/:id/preload', async (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) return res.status(404).json({ error: 'not found' });

    try {
      const page = inst.pages[inst.activePageIdx || 0];
      if (!page) {
        return res.status(400).json({ error: 'no active page' });
      }

      const advancedOpManager = require('../advancedOperationManager');
      await advancedOpManager.preloadResources(req.params.id, page);

      res.json({ success: true, message: '资源预加载完成' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 检查实例状态
  router.get('/:id/status', (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) {
      return res.status(404).json({ error: 'not found' });
    }

    const status = checkInstanceStatus(inst);
    res.json({
      id: req.params.id,
      ...status,
      wsConnections: inst.wsList ? inst.wsList.length : 0,
      lastClosed: inst.lastClosed || null,
      lastStarted: inst.lastStarted || null
    });
  });

  // 智能启动实例
  router.post('/:id/smart-start', async (req, res) => {
    const id = req.params.id;
    const inst = browsers[id];
    
    if (!inst) {
      return res.status(404).json({ error: 'not found' });
    }

    try {
      const status = checkInstanceStatus(inst);
      
      if (status.online) {
        return res.json({ 
          success: true, 
          message: '实例已在运行',
          status: 'already_running' 
        });
      }

      // 智能启动实例
      const { browser, pages } = await smartStartInstance(id, inst, db);
      
      // 更新实例数据
      inst.browser = browser;
      inst.pages = pages;
      inst.online = true;
      inst.lastStarted = new Date().toISOString();
      inst.wsEndpoint = browser.wsEndpoint();

      res.json({
        success: true,
        message: '实例启动成功',
        status: 'started',
        wsEndpoint: browser.wsEndpoint()
      });
    } catch (err) {
      res.status(500).json({ 
        error: err.message,
        status: 'start_failed' 
      });
    }
  });

  // 智能关闭实例（保留数据）
  router.post('/:id/smart-stop', async (req, res) => {
    const id = req.params.id;
    const inst = browsers[id];
    
    if (!inst) {
      return res.status(404).json({ error: 'not found' });
    }

    try {
      if (inst.browser && !inst.browser.process()?.killed) {
        await inst.browser.close();
      }
      
      // 标记为离线但保留配置
      inst.online = false;
      inst.lastClosed = new Date().toISOString();
      
      // 如果有WebSocket连接，通知客户端
      if (inst.wsList) {
        for (const ws of inst.wsList) {
          try {
            ws.send(JSON.stringify({ 
              type: 'instance_stopped',
              message: '实例已停止' 
            }));
          } catch (e) {}
        }
      }

      res.json({
        success: true,
        message: '实例已安全停止',
        status: 'stopped'
      });
    } catch (err) {
      res.status(500).json({ 
        error: err.message,
        status: 'stop_failed' 
      });
    }
  });

  return router;
};

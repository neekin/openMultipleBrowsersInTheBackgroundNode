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

  // ==================== 静态路径（优先级最高）====================
  
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

  // ==================== 性能相关静态路径 ====================
  
  // 全局性能统计
  router.get('/performance/global', (req, res) => {
    const stats = require('../performanceManager').getGlobalStats();
    res.json(stats);
  });

  // ==================== 系统相关静态路径 ====================
  
  // 系统资源使用情况
  router.get('/system/resources', (req, res) => {
    const resourceStats = require('../resourceManager').getResourceStats();
    res.json(resourceStats);
  });

  // 系统优化建议
  router.get('/system/recommendations', (req, res) => {
    const recommendations = require('../resourceManager').getSystemRecommendations();
    res.json(recommendations);
  });

  // 系统操作统计
  router.get('/system/operations', (req, res) => {
    const operationStats = require('../advancedOperationManager').getGlobalStats();
    res.json(operationStats);
  });

  // ==================== 抖音专用静态路径 ====================
  
  // 抖音专用统计 API
  router.get('/douyin/stats', async (req, res) => {
    try {
      const { douyinManager } = require('../browserManager');
      const stats = await douyinManager.getDouyinStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 抖音维护 API
  router.post('/douyin/maintenance', async (req, res) => {
    try {
      const { douyinManager } = require('../browserManager');
      await douyinManager.performDouyinMaintenance();
      res.json({ success: true, message: '抖音维护完成' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 创建抖音专用实例 API
  router.post('/douyin/create', async (req, res) => {
    try {
      const { douyinManager } = require('../browserManager');
      const canCreate = douyinManager.canCreateNewInstance();
      if (!canCreate.allowed) {
        return res.status(429).json({ 
          error: canCreate.reason,
          details: canCreate
        });
      }

      const id = crypto.randomUUID();
      const userDataDir = path.join(config.browser.userDataDir, id);
      let url = req.body?.url || 'https://www.douyin.com';
      if (!/^https?:\/\//.test(url)) url = 'https://' + url;

      const { browser, instanceId } = await douyinManager.createDouyinOptimizedBrowser({
        userDataDir,
        instanceId: id
      });

      const page = await douyinManager.createDouyinOptimizedPage(browser);

      // 导航到抖音并处理登录
      const navResult = await douyinManager.navigateToDouyinWithLogin(page, { url });
      
      // 启动登录保活
      await douyinManager.keepLoginActive(page);

      const pages = [page];
      setupBrowserEvents(browser, pages, id, browsers);
      
      browsers[id] = { 
        browser, 
        pages, 
        activePageIdx: 0, 
        fingerprint: config.douyin.fingerprint,
        wsEndpoint: browser.wsEndpoint(), 
        createdAt: new Date().toISOString(), 
        userDataDir,
        isDouyinOptimized: true,
        loginStatus: navResult.loginStatus
      };

      db.run(
        `INSERT OR REPLACE INTO browsers (id, userAgent, viewport, wsEndpoint, createdAt, userDataDir, url) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, config.douyin.userAgent, JSON.stringify(config.douyin.viewport), browser.wsEndpoint(), new Date().toISOString(), userDataDir, url]
      );

      res.json({ 
        id, 
        message: '抖音专用实例创建成功',
        wsEndpoint: browser.wsEndpoint(), 
        createdAt: new Date().toISOString(),
        loginStatus: navResult.loginStatus
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== 内存管理静态路径 ====================
  
  // 超低内存管理统计
  router.get('/memory/ultra-stats', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      const stats = await memoryManager.getEnhancedMemoryStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 内存统计
  router.get('/memory/stats', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      const stats = memoryManager.getMemoryStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 紧急内存释放
  router.post('/memory/emergency-release', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      await memoryManager.emergencyMemoryRelease();
      res.json({ success: true, message: '紧急内存释放完成' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 实例休眠
  router.post('/memory/hibernate-idle', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      const result = await memoryManager.hibernateIdleInstances();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 批量创建实例
  router.post('/memory/batch-create', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      const { count = 5, url } = req.body;
      const result = await memoryManager.batchCreateInstances(count, url);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 检查是否可创建新实例
  router.get('/memory/can-create', (req, res) => {
    const { memoryManager } = require('../browserManager');
    const result = memoryManager.canCreateNewInstance();
    res.json(result);
  });

  // 唤醒实例
  router.post('/memory/wakeup/:id', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      const result = await memoryManager.wakeupInstance(req.params.id);
      if (result) {
        res.json({ success: true, message: '实例唤醒成功', wsEndpoint: result.wsEndpoint });
      } else {
        res.status(404).json({ error: '休眠实例不存在' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 强制休眠实例
  router.post('/memory/force-hibernate/:id', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      const result = await memoryManager.hibernateInstance(req.params.id);
      if (result) {
        res.json({ success: true, message: '实例已休眠' });
      } else {
        res.status(404).json({ error: '实例不存在或无法休眠' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== 动态路径（优先级最低）====================
  
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

  // 获取实例统计信息
  router.get('/:id/stats', async (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) return res.status(404).json({ error: 'not found' });
    
    try {
      const performanceManager = require('../performanceManager');
      const resourceManager = require('../resourceManager');
      const advancedOperationManager = require('../advancedOperationManager');
      
      const perfStats = performanceManager.getInstanceStats(req.params.id);
      const resourceDetails = resourceManager.getInstanceDetails(req.params.id);
      const operationStats = advancedOperationManager.getInstanceStats(req.params.id);
      
      if (!resourceDetails && !operationStats) {
        return res.status(404).json({ error: 'no stats available' });
      }
      
      res.json({
        instance: req.params.id,
        performance: perfStats,
        resources: resourceDetails,
        operations: operationStats
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 获取实例截图
  router.get('/:id/screenshot', async (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) return res.status(404).json({ error: 'not found' });
    
    try {
      const page = inst.pages[inst.activePageIdx || 0];
      if (!page) {
        return res.status(400).json({ error: 'no active page' });
      }
      
      const screenshot = await page.screenshot({ 
        format: 'png',
        encoding: 'base64'
      });
      
      res.json({ 
        screenshot: `data:image/png;base64,${screenshot}`,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 性能建议
  router.get('/:id/performance/suggestions', (req, res) => {
    const suggestions = require('../performanceManager').getOptimizationSuggestions(req.params.id);
    res.json(suggestions);
  });

  // 性能配置
  router.get('/:id/performance/config', (req, res) => {
    const config = require('../performanceManager').getPerformanceConfig(req.params.id);
    res.json(config);
  });

  // 实例资源详情
  router.get('/:id/resources', (req, res) => {
    const resourceDetails = require('../resourceManager').getInstanceDetails(req.params.id);
    const operationStats = require('../advancedOperationManager').getInstanceStats(req.params.id);
    
    if (!resourceDetails && !operationStats) {
      return res.status(404).json({ error: 'no resource data available' });
    }
    
    res.json({
      instance: req.params.id,
      resources: resourceDetails,
      operations: operationStats
    });
  });

  // 检查抖音登录状态 API
  router.get('/:id/douyin/login-status', async (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) return res.status(404).json({ error: 'not found' });
    
    try {
      const { douyinManager } = require('../browserManager');
      const page = inst.pages[inst.activePageIdx || 0];
      
      if (!page) {
        return res.json({ error: 'no active page' });
      }
      
      const loginStatus = await douyinManager.checkDouyinLoginStatus(page);
      res.json({
        instanceId: req.params.id,
        loginStatus,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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

  // 恢复实例
  router.post('/:id/restore', async (req, res) => {
    const id = req.params.id;
    if (browsers[id]) {
      return res.json({ success: false, message: '实例已存在' });
    }

    db.get('SELECT * FROM browsers WHERE id = ?', [id], async (err, row) => {
      if (err || !row) {
        return res.status(404).json({ error: 'not found in database' });
      }

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
        res.json({ success: true, wsEndpoint: browser.wsEndpoint() });
      } catch (restoreErr) {
        res.status(500).json({ error: restoreErr.message });
      }
    });
  });

  // 批量操作
  router.post('/:id/batch-operations', async (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) return res.status(404).json({ error: 'not found' });

    try {
      const { operations } = req.body;
      if (!Array.isArray(operations)) {
        return res.status(400).json({ error: 'operations must be an array' });
      }

      const page = inst.pages[inst.activePageIdx || 0];
      if (!page) {
        return res.status(400).json({ error: 'no active page' });
      }

      const advancedOpManager = require('../advancedOperationManager');
      const results = [];

      for (const op of operations) {
        try {
          const result = await advancedOpManager.executeBatchOperation(req.params.id, page, op);
          results.push({ success: true, operation: op.type, result });
        } catch (opErr) {
          results.push({ success: false, operation: op.type, error: opErr.message });
        }
      }

      res.json({ 
        success: true, 
        results,
        totalOperations: operations.length,
        successCount: results.filter(r => r.success).length
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 优化实例
  router.post('/:id/optimize', async (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) return res.status(404).json({ error: 'not found' });

    try {
      const page = inst.pages[inst.activePageIdx || 0];
      if (!page) {
        return res.status(400).json({ error: 'no active page' });
      }

      const resourceManager = require('../resourceManager');
      await resourceManager.optimizeInstance(req.params.id, page);

      res.json({ success: true, message: '实例优化完成' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 预加载资源
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
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

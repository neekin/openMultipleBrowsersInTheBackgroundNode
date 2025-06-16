const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const config = require('../config');
const { randomFingerprint, launchBrowser, restoreBrowser, douyinManager } = require('../browserManager');

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
      // 检查是否可以创建新实例
      const { memoryManager } = require('../browserManager');
      const canCreate = memoryManager.canCreateNewInstance();
      if (!canCreate.allowed) {
        return res.status(429).json({ 
          error: canCreate.reason,
          details: canCreate
        });
      }

      const id = crypto.randomUUID();
      const fingerprint = randomFingerprint();
      const userDataDir = path.join(config.browser.userDataDir, id);
      let url = req.body?.url || config.browser.defaultUrl;
      if (!/^https?:\/\//.test(url)) url = 'https://' + url;
      
      const { browser, page } = await launchBrowser({ userDataDir, fingerprint, url });
      const pages = [page];
      setupBrowserEvents(browser, pages, id, browsers);
      browsers[id] = { 
        browser, 
        pages, 
        activePageIdx: 0, 
        fingerprint, 
        wsEndpoint: browser.wsEndpoint(), 
        createdAt: new Date().toISOString(), 
        userDataDir 
      };
      
      db.run(
        `INSERT OR REPLACE INTO browsers (id, userAgent, viewport, wsEndpoint, createdAt, userDataDir, url) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, fingerprint.userAgent, JSON.stringify(fingerprint.viewport), browser.wsEndpoint(), new Date().toISOString(), userDataDir, url]
      );
      
      res.json({ 
        id, 
        wsEndpoint: browser.wsEndpoint(), 
        fingerprint,
        memoryInfo: canCreate
      });
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


    // 抖音专用统计 API
  router.get('/douyin/stats', async (req, res) => {
    try {
      const stats = await douyinManager.getDouyinStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

    // 抖音实例维护 API
  router.post('/douyin/maintenance', async (req, res) => {
    try {
      await douyinManager.performDouyinMaintenance();
      res.json({ success: true, message: '抖音维护完成' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 清理离线实例
  router.delete('/offline', async (req, res) => {
    console.log('清理离线实例 API 被调用');
    try {
      // 获取所有实例
      const rows = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM browsers', (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
      
      console.log('数据库中的所有实例:', rows.length);
      console.log('内存中的实例:', Object.keys(browsers).length);
      
      // 找出离线实例
      const offlineIds = rows
        .filter(row => !browsers[row.id])
        .map(row => row.id);
      
      console.log('离线实例ID:', offlineIds);
      
      if (offlineIds.length === 0) {
        return res.json({ message: '没有离线实例需要清理', cleaned: 0 });
      }
      
      // 删除离线实例的数据库记录
      const placeholders = offlineIds.map(() => '?').join(',');
      await new Promise((resolve, reject) => {
        db.run(`DELETE FROM browsers WHERE id IN (${placeholders})`, offlineIds, function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
      
      // 清理对应的用户数据目录
      for (const id of offlineIds) {
        const userDataDir = path.join(config.browser.userDataDir, id);
        removeDirectory(userDataDir);
      }
      
      res.json({ 
        message: `成功清理 ${offlineIds.length} 个离线实例`, 
        cleaned: offlineIds.length,
        cleanedIds: offlineIds
      });
    } catch (error) {
      console.error('清理离线实例出错:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 创建抖音专用实例 API
  router.post('/douyin/create', async (req, res) => {
    try {
      const canCreate = douyinManager.canCreateNewInstance();
      if (!canCreate.allowed) {
        return res.status(429).json({ 
          error: canCreate.reason,
          details: canCreate
        });
      }

      const id = crypto.randomUUID();
      const userDataDir = path.join(config.browser.userDataDir, id);
      const url = 'https://www.douyin.com';

      console.log(`🎵 开始创建抖音专用实例: ${id}`);

      // 第一步：创建浏览器实例
      const { browser, instanceId } = await douyinManager.createDouyinOptimizedBrowser({
        userDataDir,
        instanceId: id
      });

      console.log(`✅ 抖音浏览器实例创建成功: ${id}`);

      // 第二步：创建优化页面
      const page = await douyinManager.createDouyinOptimizedPage(browser);
      
      console.log(`✅ 抖音页面创建成功: ${id}`);
      
      // 第三步：导航到抖音并等待页面完全加载
      const navResult = await douyinManager.navigateToDouyinWithLogin(page, { url });
      
      if (!navResult.success) {
        // 如果导航失败，清理资源
        try {
          await browser.close();
        } catch (e) {
          console.error('清理浏览器失败:', e);
        }
        throw new Error(`抖音页面导航失败: ${navResult.error}`);
      }

      console.log(`✅ 抖音页面导航完成: ${id}`);
      
      // 第四步：启动登录保活
      await douyinManager.keepLoginActive(page);

      // 第五步：验证页面状态
      try {
        const pageUrl = await page.url();
        const pageTitle = await page.title();
        
        if (!pageUrl.includes('douyin.com')) {
          throw new Error(`页面URL异常: ${pageUrl}`);
        }
        
        // 验证页面执行上下文是否有效
        const contextValid = await page.evaluate(() => {
          try {
            return document.readyState === 'complete' && document.body !== null;
          } catch (e) {
            return false;
          }
        });
        
        if (!contextValid) {
          throw new Error('页面执行上下文无效');
        }
        
        console.log(`✅ 页面状态验证通过: ${pageTitle} | ${pageUrl}`);
        
      } catch (e) {
        console.error('页面状态验证失败:', e.message);
        try {
          await browser.close();
        } catch (closeError) {
          console.error('清理浏览器失败:', closeError);
        }
        throw new Error(`页面状态验证失败: ${e.message}`);
      }

      // 第六步：设置浏览器事件监听
      const pages = [page];
      setupBrowserEvents(browser, pages, id, browsers);

      // 第七步：注册到browsers对象
      browsers[id] = {
        browser,
        pages,
        activePageIdx: 0,
        fingerprint: { 
          userAgent: await page.evaluate(() => navigator.userAgent),
          viewport: config.douyin.viewport  // 使用配置文件中的桌面端视口
        },
        wsEndpoint: browser.wsEndpoint(),
        createdAt: new Date().toISOString(),
        userDataDir,
        isDouyinOptimized: true,
        loginStatus: navResult.loginStatus
      };

      // 第八步：保存到数据库
      db.run(
        'INSERT INTO browsers (id, userAgent, viewport, wsEndpoint, createdAt, userDataDir, url) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, browsers[id].fingerprint.userAgent, JSON.stringify(browsers[id].fingerprint.viewport), browser.wsEndpoint(), browsers[id].createdAt, userDataDir, url]
      );

      console.log(`🎉 抖音专用实例创建完成: ${id}`);

      res.json({
        id,
        message: '抖音专用实例创建成功',
        loginStatus: navResult.loginStatus,
        wsEndpoint: browser.wsEndpoint(),
        createdAt: browsers[id].createdAt,
        url: navResult.url
      });
    } catch (err) {
      console.error('创建抖音实例失败:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 超低内存模式统计 API
  router.get('/memory/ultra-stats', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      const stats = await memoryManager.getEnhancedMemoryStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 内存使用统计 API
  router.get('/memory/stats', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      
      // 优先使用增强统计，回退到基础统计
      let stats;
      if (typeof memoryManager.getEnhancedMemoryStats === 'function') {
        stats = await memoryManager.getEnhancedMemoryStats();
      } else {
        stats = await memoryManager.getMemoryStats();
      }
      
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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


  // 检查抖音登录状态 API
  router.get('/:id/douyin/login-status', async (req, res) => {
    const inst = browsers[req.params.id];
    if (!inst) return res.status(404).json({ error: 'not found' });
    
    try {
      const page = inst.pages[inst.activePageIdx || 0];
      
      if (!page) {
        return res.json({ error: 'no active page' });
      }
      
      const loginStatus = await douyinManager.checkDouyinLoginStatus(page);
      res.json({
        instanceId: req.params.id,
        loginStatus,
        timestamp: Date.now()
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });



  // 实例休眠 API
  router.post('/:id/hibernate', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      
      if (typeof memoryManager.hibernateInstance === 'function') {
        await memoryManager.hibernateInstance(req.params.id);
        res.json({ success: true, message: '实例已休眠' });
      } else {
        res.status(501).json({ error: '当前模式不支持休眠功能' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 实例唤醒 API
  router.post('/:id/wakeup', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      
      if (typeof memoryManager.wakeupInstance === 'function') {
        const result = await memoryManager.wakeupInstance(req.params.id);
        res.json({ success: true, result, message: '实例已唤醒' });
      } else {
        res.status(501).json({ error: '当前模式不支持唤醒功能' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 紧急内存释放 API
  router.post('/memory/emergency-release', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      
      if (typeof memoryManager.emergencyMemoryRelease === 'function') {
        await memoryManager.emergencyMemoryRelease();
        res.json({ success: true, message: '紧急内存释放完成' });
      } else {
        // 回退到标准清理
        await memoryManager.performMemoryCleanup();
        res.json({ success: true, message: '标准内存清理完成' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 全局内存优化 API
  router.post('/memory/optimize', async (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      
      // 使用更激进的清理方法
      if (typeof memoryManager.performAggressiveCleanup === 'function') {
        await memoryManager.performAggressiveCleanup();
      } else {
        await memoryManager.performMemoryCleanup();
      }
      
      // 强制垃圾回收
      if (global.gc) {
        global.gc();
      }

      res.json({ success: true, message: '全局内存优化完成' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 检查是否可以创建新实例
  router.get('/memory/can-create', (req, res) => {
    try {
      const { memoryManager } = require('../browserManager');
      const canCreate = memoryManager.canCreateNewInstance();
      res.json(canCreate);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 批量创建实例 API（内存优化版）
  router.post('/batch-create', async (req, res) => {
    try {
      const { count = 1, url = config.browser.defaultUrl } = req.body;
      const { memoryManager } = require('../browserManager');
      
      if (count > 10) {
        return res.status(400).json({ error: '单次最多创建10个实例' });
      }

      const results = [];
      const errors = [];

      for (let i = 0; i < count; i++) {
        try {
          const canCreate = memoryManager.canCreateNewInstance();
          if (!canCreate.allowed) {
            errors.push(`第${i+1}个实例: ${canCreate.reason}`);
            break;
          }

          const id = crypto.randomUUID();
          const fingerprint = randomFingerprint();
          const userDataDir = path.join(config.browser.userDataDir, id);
          let processedUrl = url;
          if (!/^https?:\/\//.test(processedUrl)) processedUrl = 'https://' + processedUrl;
          
          const { browser, page } = await launchBrowser({ userDataDir, fingerprint, url: processedUrl });
          const pages = [page];
          
          setupBrowserEvents(browser, pages, id, browsers);
          browsers[id] = { 
            browser, 
            pages, 
            activePageIdx: 0, 
            fingerprint, 
            wsEndpoint: browser.wsEndpoint(), 
            createdAt: new Date().toISOString(), 
            userDataDir 
          };
          
          db.run(
            `INSERT OR REPLACE INTO browsers (id, userAgent, viewport, wsEndpoint, createdAt, userDataDir, url) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, fingerprint.userAgent, JSON.stringify(fingerprint.viewport), browser.wsEndpoint(), new Date().toISOString(), userDataDir, processedUrl]
          );
          
          results.push({ id, wsEndpoint: browser.wsEndpoint(), fingerprint });
        } catch (error) {
          errors.push(`第${i+1}个实例: ${error.message}`);
        }
      }

      res.json({ 
        success: results.length > 0,
        created: results.length,
        instances: results,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
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

  return router;
};

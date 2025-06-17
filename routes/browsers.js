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

  // 实例数量限制管理
  const INSTANCE_LIMIT = 3; // 最大同时运行实例数

  async function enforceInstanceLimit() {
    // 获取当前在线实例
    const onlineInstances = [];
    for (const [id, inst] of Object.entries(browsers)) {
      // 更严格的在线判断：有浏览器实例且进程未被杀死且明确标记为在线
      const isOnline = inst.browser && 
                      !inst.browser.process()?.killed && 
                      inst.online === true;
      
      if (isOnline) {
        onlineInstances.push({
          id: id,
          instance: inst,
          createdAt: new Date(inst.createdAt).getTime()
        });
      }
      
      console.log(`🔍 实例 ${id.substr(0, 8)}: 浏览器=${!!inst.browser}, 进程存活=${inst.browser && !inst.browser.process()?.killed}, 状态=${inst.online === true ? '在线' : '离线'} -> ${isOnline ? '计入' : '跳过'}`);
    }

    console.log(`🔍 当前在线实例数: ${onlineInstances.length}, 限制: ${INSTANCE_LIMIT}`);

    // 如果超过限制，关闭最早创建的实例
    if (onlineInstances.length >= INSTANCE_LIMIT) {
      // 按创建时间排序，最早的在前面
      onlineInstances.sort((a, b) => a.createdAt - b.createdAt);
      
      const toClose = onlineInstances.slice(0, onlineInstances.length - INSTANCE_LIMIT + 1);
      
      for (const { id, instance } of toClose) {
        console.log(`🔐 实例数量达到限制 (${INSTANCE_LIMIT})，关闭最早的实例: ${id}`);
        
        try {
          // 关闭浏览器
          if (instance.browser && !instance.browser.process()?.killed) {
            await instance.browser.close();
          }
          
          // 关闭所有页面
          if (instance.pages) {
            for (const page of instance.pages) {
              try {
                await page.close();
              } catch (e) {
                // 忽略页面关闭错误
              }
            }
          }
          
          // 关闭WebSocket连接
          if (instance.wsList) {
            for (const ws of instance.wsList) {
              try {
                ws.close();
              } catch (e) {
                // 忽略WebSocket关闭错误
              }
            }
          }
          
          // 标记为离线状态但保留数据库记录
          instance.online = false;
          instance.lastClosed = new Date().toISOString();
          
          // 更新数据库中的 online 状态和最后活跃时间，但不删除记录
          db.run(
            'UPDATE browsers SET online = 0, lastActiveTime = ? WHERE id = ?',
            [Date.now(), id],
            (err) => {
              if (err) {
                console.error(`更新实例 ${id} 状态失败:`, err.message);
              } else {
                console.log(`📝 实例 ${id} 数据库状态已更新为离线`);
              }
            }
          );
          
          // 清理性能监控数据
          const performanceManager = require('../performanceManager');
          performanceManager.cleanupInstance(id);
          
          // 取消自动关闭计时器
          if (global.autoCloseManager) {
            global.autoCloseManager.cancelAutoClose(id);
          }
          
          console.log(`✅ 实例 ${id} 已被自动关闭（超过数量限制），数据库记录已保留`);
          
        } catch (error) {
          console.error(`❌ 关闭实例 ${id} 时出错:`, error.message);
        }
      }
    }
  }

  // ==================== 静态路径（优先级最高）====================
  
  // 获取实例列表（内存+数据库）
  router.get('/', (req, res) => {
    db.all('SELECT * FROM browsers', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      // 合并内存中的实时状态
      const memMap = new Map(Object.entries(browsers));
      const list = rows.map(row => {
        const mem = memMap.get(row.id);
        
        // 更准确的在线状态判断
        let online = false;
        if (mem) {
          // 检查浏览器进程是否存活且明确标记为在线
          online = mem.browser && 
                   !mem.browser.process()?.killed && 
                   mem.online === true;
        }
        
        return {
          id: row.id,
          wsEndpoint: mem?.wsEndpoint || row.wsEndpoint,
          userAgent: row.userAgent,
          createdAt: row.createdAt || '',
          lastActiveTime: row.lastActiveTime || null,
          online: online,
          // 添加更多状态信息用于调试
          memoryExists: !!mem,
          browserExists: !!(mem?.browser),
          processAlive: mem?.browser ? !mem.browser.process()?.killed : false,
          markedOnline: mem?.online !== false
        };
      });
      res.json(list);
    });
  });

  // 创建 Puppeteer 实例
  router.post('/create', async (req, res) => {
    try {
      // 检查并管理实例数量限制
      await enforceInstanceLimit();
      
      const id = crypto.randomUUID();
      const fingerprint = randomFingerprint();
      const userDataDir = path.join(config.browser.userDataDir, id);
      const url = 'https://www.douyin.com'; // 固定打开抖音
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
        userDataDir,
        online: true // 明确标记为在线状态
      };
      db.run(
        `INSERT OR REPLACE INTO browsers (id, userAgent, viewport, wsEndpoint, createdAt, userDataDir, url, online) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [id, fingerprint.userAgent, JSON.stringify(fingerprint.viewport), browser.wsEndpoint(), new Date().toISOString(), userDataDir, url]
      );
      
      // 注册到自动关闭管理器
      if (global.autoCloseManager) {
        global.autoCloseManager.registerNewInstance(id);
      }
      
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

  // ==================== 通用静态路径 ====================

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

  // 自动维护统计
  router.get('/maintenance/stats', (req, res) => {
    try {
      const stats = global.autoMaintenance ? global.autoMaintenance.getMaintenanceStats() : null;
      if (!stats) {
        return res.status(503).json({ error: '自动维护管理器未启动' });
      }
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 手动触发维护检查
  router.post('/maintenance/trigger', async (req, res) => {
    try {
      if (!global.autoMaintenance) {
        return res.status(503).json({ error: '自动维护管理器未启动' });
      }
      
      const stats = await global.autoMaintenance.triggerMaintenanceCheck();
      res.json({
        success: true,
        message: '维护检查已触发',
        stats
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  // 调整维护配置（仅用于测试）
  router.post('/maintenance/config', (req, res) => {
    try {
      if (!global.autoMaintenance) {
        return res.status(503).json({ error: '自动维护管理器未启动' });
      }
      
      const { checkInterval, inactiveThreshold, maintenanceDuration } = req.body;
      
      if (checkInterval) {
        global.autoMaintenance.config.checkInterval = checkInterval * 60000; // 分钟转换为毫秒
      }
      if (inactiveThreshold) {
        global.autoMaintenance.config.inactiveThreshold = inactiveThreshold * 60000;
      }
      if (maintenanceDuration) {
        global.autoMaintenance.config.maintenanceDuration = maintenanceDuration * 60000;
      }
      
      res.json({
        success: true,
        message: '维护配置已更新',
        config: {
          checkIntervalMinutes: global.autoMaintenance.config.checkInterval / 60000,
          inactiveThresholdMinutes: global.autoMaintenance.config.inactiveThreshold / 60000,
          maintenanceDurationMinutes: global.autoMaintenance.config.maintenanceDuration / 60000
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  // ==================== 实例数量限制管理 API ====================
  
  // 获取实例限制状态
  router.get('/limit/status', (req, res) => {
    try {
      // 获取当前在线实例
      const onlineInstances = [];
      for (const [id, inst] of Object.entries(browsers)) {
        if (inst.browser && !inst.browser.process()?.killed) {
          onlineInstances.push({
            id: id,
            createdAt: inst.createdAt,
            hasConnections: inst.wsList ? inst.wsList.length > 0 : false,
            connectionCount: inst.wsList ? inst.wsList.length : 0
          });
        }
      }

      // 按创建时间排序
      onlineInstances.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      res.json({
        limit: INSTANCE_LIMIT,
        currentCount: onlineInstances.length,
        instances: onlineInstances,
        canCreateNew: onlineInstances.length < INSTANCE_LIMIT,
        nextToClose: onlineInstances.length >= INSTANCE_LIMIT ? onlineInstances[0].id : null
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 手动触发实例限制检查
  router.post('/limit/enforce', async (req, res) => {
    try {
      console.log('🔧 手动触发实例限制检查...');
      await enforceInstanceLimit();
      res.json({ success: true, message: '实例限制检查已执行' });
    } catch (err) {
      console.error('实例限制检查失败:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== 自动关闭管理 API ====================
  
  // 获取自动关闭统计信息
  router.get('/autoclose/stats', (req, res) => {
    try {
      if (!global.autoCloseManager) {
        return res.status(503).json({ error: '自动关闭管理器未启动' });
      }
      
      const stats = global.autoCloseManager.getStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 更新自动关闭配置
  router.post('/autoclose/config', (req, res) => {
    try {
      if (!global.autoCloseManager) {
        return res.status(503).json({ error: '自动关闭管理器未启动' });
      }
      
      const { noConnectionTimeout, checkInterval } = req.body;
      
      const updateConfig = {};
      if (noConnectionTimeout) updateConfig.noConnectionTimeout = noConnectionTimeout;
      if (checkInterval) updateConfig.checkInterval = checkInterval;
      
      global.autoCloseManager.updateConfig(updateConfig);
      
      res.json({
        success: true,
        message: '自动关闭配置已更新',
        config: global.autoCloseManager.getStats().config
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 手动取消指定实例的自动关闭
  router.post('/autoclose/cancel/:id', (req, res) => {
    try {
      if (!global.autoCloseManager) {
        return res.status(503).json({ error: '自动关闭管理器未启动' });
      }
      
      const id = req.params.id;
      const cancelled = global.autoCloseManager.cancelAutoClose(id);
      
      res.json({
        success: true,
        cancelled,
        message: cancelled ? '已取消自动关闭' : '该实例没有待处理的自动关闭任务'
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== 登录监控路径（静态路径，优先级高）====================
  
  // 获取登录监控统计
  router.get('/login-monitor/stats', (req, res) => {
    if (!global.loginMonitor) {
      return res.status(500).json({ error: 'Login monitor not available' });
    }
    
    const stats = global.loginMonitor.getMonitorStats();
    res.json(stats);
  });

  // 手动触发登录状态检测
  router.post('/login-monitor/trigger', async (req, res) => {
    if (!global.loginMonitor) {
      return res.status(500).json({ error: 'Login monitor not available' });
    }
    
    try {
      const instanceId = req.body.instanceId || null;
      const result = await global.loginMonitor.triggerCheck(instanceId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 更新登录监控配置
  router.post('/login-monitor/config', (req, res) => {
    if (!global.loginMonitor) {
      return res.status(500).json({ error: 'Login monitor not available' });
    }
    
    try {
      global.loginMonitor.updateConfig(req.body);
      res.json({ success: true, message: '配置已更新' });
    } catch (error) {
      res.status(500).json({ error: error.message });
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

  // 智能启动实例
  router.post('/:id/smart-start', async (req, res) => {
    const id = req.params.id;
    const inst = browsers[id];
    if (!inst) {
      return res.status(404).json({ error: 'not found' });
    }
    try {
      // 唤醒前先执行实例数量限制
      if (global.enforceInstanceLimit) {
        await global.enforceInstanceLimit();
      }
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
        // 恢复前先执行实例数量限制
        if (global.enforceInstanceLimit) {
          await global.enforceInstanceLimit();
        }
        const { browser, pages } = await restoreBrowser(row);
        setupBrowserEvents(browser, pages, id, browsers);
        browsers[id] = {
          browser,
          pages,
          activePageIdx: 0,
          fingerprint: { userAgent: row.userAgent, viewport: JSON.parse(row.viewport) },
          wsEndpoint: browser.wsEndpoint(),
          createdAt: row.createdAt,
          userDataDir: row.userDataDir,
          online: true
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

  // 检测实例登录状态
  router.get('/:id/login-status', async (req, res) => {
    const id = req.params.id;
    const inst = browsers[id];
    
    if (!inst || !inst.browser || !inst.pages || inst.pages.length === 0) {
      return res.status(404).json({ error: 'Instance not found or not ready' });
    }
    
    try {
      const page = inst.pages[inst.activePageIdx || 0];
      
      // 检测是否存在 id="login-panel-new" 的元素
      const loginElement = await page.$('#login-panel-new');
      
      let userInfo = null;
      
      if (!loginElement) {
        // 没有登录面板，检测用户头像和昵称
        try {
          const avatarElement = await page.$('[data-e2e="live-avatar"]');
          let avatarUrl = null;
          
          if (avatarElement) {
            // 提取头像元素内的图片地址
            avatarUrl = await page.evaluate((element) => {
              const img = element.querySelector('img');
              return img ? img.src : null;
            }, avatarElement);
          }
          
          // 检测昵称（类名为 ChwkdccW 的元素）
          const nicknameElement = await page.$('.ChwkdccW');
          let nickname = null;
          
          if (nicknameElement) {
            nickname = await page.evaluate((element) => {
              return element.textContent ? element.textContent.trim() : null;
            }, nicknameElement);
          }
          
          userInfo = {
            avatarUrl: avatarUrl,
            nickname: nickname
          };
        } catch (avatarError) {
          console.log(`获取用户信息失败 (${id}):`, avatarError.message);
        }
      }
      
      const isLoggedIn = !loginElement; // 如果没有登录面板，说明已登录
      
      res.json({
        instanceId: id,
        isLoggedIn: isLoggedIn,
        hasLoginPanel: !!loginElement,
        userInfo: userInfo,
        url: page.url()
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to check login status',
        message: error.message 
      });
    }
  });

  return router;
};

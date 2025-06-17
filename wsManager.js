const WebSocket = require('ws');
const config = require('./config');
const crypto = require('crypto');
const performanceManager = require('./performanceManager');
const advancedOperationManager = require('./advancedOperationManager');
const resourceManager = require('./resourceManager');

// 操作批处理管理器
class OperationBatcher {
  constructor(page, ws, instanceId) {
    this.page = page;
    this.ws = ws;
    this.instanceId = instanceId;
    this.pendingOperations = [];
    this.batchTimeout = null;
    this.isProcessing = false;
  }

  addOperation(operation) {
    this.pendingOperations.push(operation);
    
    if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => {
        this.processBatch();
      }, config.websocket.batchTimeout || 50);
    }
  }

  async processBatch() {
    if (this.isProcessing || this.pendingOperations.length === 0) return;
    
    this.isProcessing = true;
    this.batchTimeout = null;
    
    const operations = [...this.pendingOperations];
    this.pendingOperations = [];
    
    try {
      // 批量执行操作
      for (const op of operations) {
        await this.executeOperation(op);
      }
    } catch (e) {
      console.error(`批量操作执行失败 (${this.instanceId}):`, e.message);
    }
    
    this.isProcessing = false;
    
    // 如果还有待处理操作，继续处理
    if (this.pendingOperations.length > 0) {
      this.processBatch();
    }
  }

  async executeOperation(operation) {
    const startTime = Date.now();
    const { type, payload } = operation;
    
    try {
      switch (type) {
        case 'click':
          await this.page.mouse.click(payload.x, payload.y);
          break;
        case 'mousemove':
          await this.page.mouse.move(payload.x, payload.y);
          break;
        case 'keydown':
          await this.page.keyboard.down(payload.key);
          break;
        case 'keyup':
          await this.page.keyboard.up(payload.key);
          break;
        case 'wheel':
          await this.page.mouse.wheel({ deltaX: payload.deltaX, deltaY: payload.deltaY });
          break;
      }
      
      // 记录操作性能
      const responseTime = Date.now() - startTime;
      performanceManager.recordInstanceMetric(this.instanceId, {
        type: 'operation',
        responseTime
      });
      
    } catch (error) {
      // 记录错误
      performanceManager.recordInstanceMetric(this.instanceId, {
        type: 'error'
      });
      throw error;
    }
  }
}

// 截图管理器
class ScreenshotManager {
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.lastScreenshotHash = null;
    this.currentInterval = config.websocket.screenshotInterval;
    this.lastActivityTime = Date.now();
    this.screenshotCount = 0;
  }

  updateActivity() {
    this.lastActivityTime = Date.now();
    // 有活动时使用较短间隔
    if (config.websocket.adaptiveInterval) {
      this.currentInterval = Math.max(
        config.websocket.minInterval || 200,
        this.currentInterval * 0.8
      );
    }
  }

  getNextInterval() {
    if (!config.websocket.adaptiveInterval) {
      return this.currentInterval;
    }

    const timeSinceActivity = Date.now() - this.lastActivityTime;
    
    // 根据活动时间调整截图间隔
    if (timeSinceActivity > 5000) { // 5秒无活动
      this.currentInterval = Math.min(
        config.websocket.maxInterval || 2000,
        this.currentInterval * 1.2
      );
    }
    
    return this.currentInterval;
  }

  async takeScreenshot(page, ws, optimizedConfig = null) {
    const startTime = Date.now();
    
    try {
      // 使用优化配置或默认配置
      const screenshotOptions = optimizedConfig?.screenshotOptions || config.browser.screenshotOptions;
      
      const screenshot = await page.screenshot(screenshotOptions);
      const screenshotSize = screenshot.length;
      
      if (config.websocket.deltaScreenshot) {
        // 计算截图哈希值
        const hash = crypto.createHash('md5').update(screenshot).digest('hex');
        
        // 如果截图没有变化，跳过发送
        if (hash === this.lastScreenshotHash) {
          return false; // 表示没有发送
        }
        
        this.lastScreenshotHash = hash;
      }
      
      // 发送截图
      if (ws.readyState === WebSocket.OPEN) {
        if (config.websocket.enableCompression) {
          // 可以在这里添加压缩逻辑
          ws.send(screenshot);
        } else {
          ws.send(screenshot);
        }
        this.screenshotCount++;
        
        // 记录截图性能指标
        performanceManager.recordInstanceMetric(this.instanceId, {
          type: 'screenshot',
          size: screenshotSize,
          responseTime: Date.now() - startTime
        });
        
        return true; // 表示已发送
      }
    } catch (e) {
      console.error(`截图失败 (${this.instanceId}):`, e.message);
      
      // 记录错误
      performanceManager.recordInstanceMetric(this.instanceId, {
        type: 'error'
      });
      
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ error: e.message }));
      }
    }
    
    return false;
  }
}

function setupWebSocket(server, browsers) {
  const wss = new WebSocket.Server({ server });

  // 启动资源监控
  resourceManager.startMonitoring();
  
  // 设置高级操作管理器的执行回调
  advancedOperationManager.setExecutionCallback(async (instanceId, operations) => {
    const inst = browsers[instanceId];
    if (!inst) return;
    
    const page = inst.pages[inst.activePageIdx || 0];
    if (!page) return;
    
    const startTime = Date.now();
    
    for (const operation of operations) {
      try {
        switch (operation.type) {
          case 'click':
            await page.mouse.click(operation.payload.x, operation.payload.y);
            break;
          case 'mousemove':
            await page.mouse.move(operation.payload.x, operation.payload.y);
            inst.lastCursor = operation.payload;
            break;
          case 'keydown':
            await page.keyboard.down(operation.payload.key);
            break;
          case 'keyup':
            await page.keyboard.up(operation.payload.key);
            break;
          case 'wheel':
            await page.mouse.wheel({ 
              deltaX: operation.payload.deltaX, 
              deltaY: operation.payload.deltaY 
            });
            break;
        }
      } catch (error) {
        console.error(`执行操作失败 (${instanceId}):`, error.message);
      }
    }
    
    // 记录性能指标
    const executionTime = Date.now() - startTime;
    performanceManager.recordInstanceMetric(instanceId, {
      type: 'batch_operation',
      responseTime: executionTime,
      operationCount: operations.length
    });
    
    // 记录资源使用
    resourceManager.recordInstanceUsage(instanceId, {
      operationCount: (resourceManager.getInstanceDetails(instanceId)?.operationCount || 0) + operations.length,
      averageResponseTime: executionTime / operations.length
    });
  });

  wss.on('connection', async (ws, req) => {
    const url = req.url;
    const match = url.match(/\/browsers\/ws\/operate\/(.+)$/);
    if (!match) {
      console.log('WebSocket连接URL格式错误:', url);
      return ws.close();
    }
    
    const id = match[1];
    const inst = browsers[id];
    if (!inst) {
      console.log('WebSocket连接的实例不存在:', id);
      return ws.close();
    }
    
    console.log(`WebSocket连接建立，实例ID: ${id}`);
    
    // 智能实例管理：检查实例是否需要启动
    if (inst.online === false || (inst.browser && inst.browser.process()?.killed)) {
      console.log(`实例 ${id} 处于离线状态，准备自动启动...`);
      try {
        // 先强制执行实例数量限制
        if (global.enforceInstanceLimit) {
          await global.enforceInstanceLimit();
        }
        const { smartStartInstance } = require('./browserManager');
        await smartStartInstance(id, inst, global.db || null);
        console.log(`实例 ${id} 自动启动成功`);
      } catch (error) {
        console.error(`尝试启动实例 ${id} 时出错:`, error.message);
      }
    } else {
      inst.online = true;
    }
    
    // 记录WebSocket连接建立时的活跃时间
    inst.lastActiveTime = Date.now();
    inst.online = true; // 确保在线状态正确
    console.log(`🔗 实例 ${id} WebSocket连接建立，活跃时间已更新: ${inst.lastActiveTime}`);
    
    // 更新数据库中的在线状态和最后活跃时间
    if (global.db) {
      global.db.run(
        `UPDATE browsers SET online = 1, lastActiveTime = ? WHERE id = ?`,
        [inst.lastActiveTime, id],
        (err) => {
          if (err) {
            console.error(`更新实例 ${id} 连接时状态失败:`, err.message);
          } else {
            console.log(`📝 实例 ${id} 数据库状态已更新为在线`);
          }
        }
      );
    }
    
    // 启动登录状态监控
    if (global.loginMonitor) {
      global.loginMonitor.addInstanceMonitor(id);
    }

    // 启动登录状态监控
    if (global.loginMonitor) {
      global.loginMonitor.addInstanceMonitor(id);
    }

    let activeIdx = inst.activePageIdx || 0;

    // 初始化高级管理器
    advancedOperationManager.initInstance(id);
    
    // 初始化性能优化组件
    const screenshotManager = new ScreenshotManager(id);
    let operationBatcher = null;

    // 获取资源优化配置
    const getOptimizedConfig = () => {
      return resourceManager.getInstanceOptimizedConfig(id) || config.websocket;
    };

    function getActivePage() {
      return inst.pages[activeIdx] || inst.pages[0];
    }

    // 初始化操作批处理器
    function initBatcher() {
      const page = getActivePage();
      if (page) {
        operationBatcher = new OperationBatcher(page, ws, id);
      }
    }

    initBatcher();

    let closed = false;
    let screenshotTimeout = null;

    async function sendScreenshot() {
      if (closed) return;
      
      const page = getActivePage();
      if (!page) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ error: '无可用页面' }));
        }
        return;
      }

      // 使用优化配置
      const optimizedConfig = getOptimizedConfig();
      const sent = await screenshotManager.takeScreenshot(page, ws, optimizedConfig);
      
      // 发送光标位置（如果有）
      if (sent && inst.lastCursor && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ cursor: inst.lastCursor }));
      }

      // 记录资源使用
      resourceManager.recordInstanceUsage(id, {
        screenshotCount: (resourceManager.getInstanceDetails(id)?.screenshotCount || 0) + (sent ? 1 : 0)
      });

      // 安排下一次截图
      if (!closed) {
        const nextInterval = screenshotManager.getNextInterval();
        screenshotTimeout = setTimeout(sendScreenshot, nextInterval);
      }
    }
    sendScreenshot();

    if (!inst.wsList) inst.wsList = [];
    inst.wsList.push(ws);
    
    // 通知自动关闭管理器：实例已连接
    if (global.autoCloseManager) {
      global.autoCloseManager.onInstanceConnected(id);
    }

    ws.on('close', () => {
      closed = true;
      if (screenshotTimeout) {
        clearTimeout(screenshotTimeout);
      }
      if (inst.wsList) inst.wsList = inst.wsList.filter(w => w !== ws);
      
      // 记录实例最后活跃时间
      inst.lastActiveTime = Date.now();
      console.log(`📝 实例 ${id} 最后活跃时间已记录: ${inst.lastActiveTime}`);
      
      // 更新数据库中的最后活跃时间
      if (global.db) {
        global.db.run(
          `UPDATE browsers SET lastActiveTime = ? WHERE id = ?`,
          [inst.lastActiveTime, id],
          (err) => {
            if (err) {
              console.error(`更新实例 ${id} 最后活跃时间失败:`, err.message);
            }
          }
        );
      }
      
      // 清理高级管理器
      advancedOperationManager.cleanupInstance(id);
      
      // 输出性能统计
      const stats = performanceManager.getInstanceStats(id);
      const resourceStats = resourceManager.getInstanceDetails(id);
      
      console.log(`WebSocket连接关闭 (${id})，性能统计:`, {
        screenshots: screenshotManager.screenshotCount,
        avgResponseTime: stats?.averageResponseTime || 0,
        wsConnections: inst.wsList ? inst.wsList.length : 0
      });
      
      // 智能实例管理：如果没有WebSocket连接，自动关闭浏览器实例
      if (inst.wsList && inst.wsList.length === 0) {
        console.log(`实例 ${id} 无WebSocket连接，准备自动关闭...`);
        
        // 通知自动关闭管理器：实例已断开连接
        if (global.autoCloseManager) {
          global.autoCloseManager.onInstanceDisconnected(id);
        }
        
        setTimeout(async () => {
          // 延迟5秒后检查，如果仍然没有连接则关闭
          if (inst.wsList && inst.wsList.length === 0) {
            console.log(`实例 ${id} 确认无连接，自动关闭浏览器实例`);
            try {
              if (inst.browser && !inst.browser.process()?.killed) {
                await inst.browser.close();
              }
              // 保持数据库记录，但标记为离线状态
              inst.online = false;
              inst.lastClosed = new Date().toISOString();
              
              // 更新数据库中的离线状态
              if (global.db) {
                global.db.run(
                  `UPDATE browsers SET online = 0, lastActiveTime = ? WHERE id = ?`,
                  [Date.now(), id],
                  (err) => {
                    if (err) {
                      console.error(`更新实例 ${id} 离线状态失败:`, err.message);
                    } else {
                      console.log(`📝 实例 ${id} 数据库状态已更新为离线`);
                    }
                  }
                );
              }
            } catch (error) {
              console.error(`关闭实例 ${id} 失败:`, error.message);
            }
          }
        }, 5000); // 5秒延迟关闭，防止频繁开关
      }
    });

    ws.on('message', async msg => {
      try {
        const data = JSON.parse(msg);
        const page = getActivePage();
        if (!page) {
          ws.send(JSON.stringify({ error: '无可用页面进行操作' }));
          return;
        }

        // 更新活动时间（用于自适应截图间隔）
        screenshotManager.updateActivity();
        
        // 更新实例最后活跃时间到数据库（WebSocket 收到消息时）
        if (global.db) {
          const now = Date.now();
          global.db.run(
            'UPDATE browsers SET lastActiveTime = ? WHERE id = ?',
            [now, id],
            (err) => {
              if (err) {
                console.error(`更新实例 ${id} 消息处理时活跃时间失败:`, err.message);
              }
            }
          );
        }

        if (data.type === 'switchTab') {
          if (typeof data.idx === 'number' && inst.pages[data.idx]) {
            activeIdx = data.idx;
            inst.activePageIdx = data.idx;
            // 切换标签页时重新初始化批处理器
            initBatcher();
            // 强制立即发送一次截图
            screenshotManager.lastScreenshotHash = null;
          }
          return;
        }
        
        if (data.type === 'refreshTab') {
          if (typeof data.idx === 'number' && inst.pages[data.idx]) {
            try { 
              await inst.pages[data.idx].reload({ waitUntil: 'networkidle2' }); 
            } catch (e) {
              console.error(`刷新标签页失败 (${id}):`, e.message);
            }
            for (const ws2 of inst.wsList || []) {
              try { ws2.send(JSON.stringify({ type: 'tabUpdate' })); } catch {}
            }
            // 刷新后强制更新截图
            screenshotManager.lastScreenshotHash = null;
          }
          return;
        }
        
        if (data.type === 'closeTab') {
          if (typeof data.idx === 'number' && inst.pages[data.idx]) {
            try { 
              await inst.pages[data.idx].close(); 
            } catch (e) {
              console.error(`关闭标签页失败 (${id}):`, e.message);
            }
            inst.pages.splice(data.idx, 1);
            if (activeIdx === data.idx) {
              activeIdx = 0;
              inst.activePageIdx = 0;
            } else if (activeIdx > data.idx) {
              activeIdx--;
              inst.activePageIdx = activeIdx;
            }
            // 重新初始化批处理器
            initBatcher();
            for (const ws2 of inst.wsList || []) {
              try { ws2.send(JSON.stringify({ type: 'tabUpdate' })); } catch {}
            }
          }
          return;
        }
        
        if (data.type === 'getTabs') {
          const infos = await Promise.all(inst.pages.map(async (p, idx) => {
            let title = '';
            try { title = await p.title(); } catch {}
            let url = '';
            try { url = p.url(); } catch {}
            return { idx, title, url };
          }));
          ws.send(JSON.stringify({ type: 'tabs', tabs: infos }));
          return;
        }
        
        // 处理鼠标和键盘操作
        const operationTypes = ['click', 'mousemove', 'keydown', 'keyup', 'wheel'];
        if (operationTypes.includes(data.type)) {
          // 使用高级操作管理器
          advancedOperationManager.addOperation(id, data);
          
          // 记录鼠标位置
          if (data.type === 'mousemove') {
            inst.lastCursor = data.payload;
          }
          
          // 获取预测的下一个操作（用于优化）
          const prediction = advancedOperationManager.predictNextOperation(id);
          if (prediction && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ 
              type: 'prediction', 
              nextOperation: prediction 
            }));
          }
        }
      } catch (e) {
        console.error(`WebSocket消息处理失败 (${id}):`, e.message);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ error: e.message }));
        }
      }
    }); // 关闭 ws.on('message') 监听器
  });
}

module.exports = setupWebSocket;

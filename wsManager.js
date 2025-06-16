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
      // 检查页面有效性
      if (!page || page.isClosed()) {
        throw new Error('页面已关闭或无效');
      }
      
      // 检查页面URL，避免空白页
      const url = await page.url();
      if (!url || url === 'about:blank' || url === 'chrome://newtab/') {
        throw new Error(`页面为空白页，无法截图: ${url}`);
      }
      
      // 检查页面是否真正加载完成
      try {
        // 等待body元素存在
        await page.waitForSelector('body', { timeout: 2000 });
        
        // 验证页面执行上下文是否有效
        const pageReady = await page.evaluate(() => {
          try {
            return document.readyState === 'complete' && document.body !== null;
          } catch (e) {
            return false;
          }
        }).catch(() => false);
        
        if (!pageReady) {
          throw new Error('页面执行上下文无效或页面未完全加载');
        }
        
        // 对于抖音页面，额外验证
        if (url.includes('douyin.com')) {
          const douyinReady = await page.evaluate(() => {
            try {
              // 检查基础元素是否存在
              const hasContent = document.querySelector('div, main, section, article');
              return hasContent !== null;
            } catch (e) {
              return false;
            }
          }).catch(() => false);
          
          if (!douyinReady) {
            throw new Error('抖音页面内容未完全加载');
          }
        }
        
      } catch (e) {
        // 如果页面检查失败，抛出详细错误
        if (e.message.includes('Execution context was destroyed')) {
          throw new Error('页面执行上下文已销毁，可能正在重新加载');
        }
        throw new Error(`页面状态检查失败: ${e.message}`);
      }
      
      console.log(`📸 开始截图: ${url.substring(0, 50)}...`);
      
      // 使用优化配置或默认配置
      const screenshotOptions = optimizedConfig?.screenshotOptions || config.browser.screenshotOptions;
      
      // 使用合理的截图超时时间
      const screenshotPromise = page.screenshot({
        ...screenshotOptions,
        timeout: 10000 // 10秒超时，平衡性能和稳定性
      });
      
      // 添加超时保护
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Screenshot timeout after 10 seconds')), 10000);
      });
      
      const screenshot = await Promise.race([screenshotPromise, timeoutPromise]);
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
        
        console.log(`✅ 截图发送成功 (${screenshotSize} bytes)`);
        return true; // 表示已发送
      }
    } catch (e) {
      console.error(`截图失败 (${this.instanceId}):`, e.message);
      
      // 记录错误
      performanceManager.recordInstanceMetric(this.instanceId, {
        type: 'error'
      });
      
      // 发送友好的错误信息，但不要关闭连接
      if (ws.readyState === WebSocket.OPEN) {
        let errorMsg = '截图暂时不可用';
        if (e.message.includes('timeout')) {
          errorMsg = '截图处理超时，请稍后再试';
        } else if (e.message.includes('context') || e.message.includes('detached')) {
          errorMsg = '页面正在加载中...';
        } else if (e.message.includes('Target closed')) {
          errorMsg = '页面已关闭，请刷新重试';
        }
        
        ws.send(JSON.stringify({ 
          error: errorMsg,
          type: 'screenshot_error',
          recoverable: true 
        }));
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

  wss.on('connection', (ws, req) => {
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
      // 检查实例是否有有效页面
      if (!inst.pages || inst.pages.length === 0) {
        return null;
      }
      
      // 获取活跃页面
      let page = inst.pages[activeIdx] || inst.pages[0];
      
      // 检查页面是否有效
      if (!page || page.isClosed()) {
        // 如果当前页面无效，尝试找一个有效的页面
        for (let i = 0; i < inst.pages.length; i++) {
          if (inst.pages[i] && !inst.pages[i].isClosed()) {
            activeIdx = i;
            inst.activePageIdx = i;
            page = inst.pages[i];
            break;
          }
        }
      }
      
      return page && !page.isClosed() ? page : null;
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
          ws.send(JSON.stringify({ error: '无可用页面进行截图' }));
        }
        // 如果没有有效页面，延长重试间隔
        const retryInterval = Math.min(getOptimizedConfig()?.screenshotInterval * 3 || 10000, 15000);
        console.warn(`❌ 无可用页面，${retryInterval}ms后重试...`);
        screenshotTimeout = setTimeout(sendScreenshot, retryInterval);
        return;
      }

      try {
        // 首先检查页面基本状态
        const pageUrl = await page.url();
        
        // 如果是空白页，尝试等待页面加载
        if (pageUrl === 'about:blank' || pageUrl === 'chrome://newtab/') {
          console.warn(`⚠️ 页面URL异常: ${pageUrl}，跳过此次截图`);
          const retryInterval = getOptimizedConfig()?.screenshotInterval || 2000;
          screenshotTimeout = setTimeout(sendScreenshot, retryInterval);
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
      } catch (error) {
        console.error(`截图发送失败 (${id}):`, error.message);
        
        // 检查是否是执行上下文错误
        if (error.message.includes('Execution context was destroyed') || 
            error.message.includes('detached frame') ||
            error.message.includes('Target closed') ||
            error.message.includes('timeout') ||
            error.message.includes('Screenshot timeout')) {
          console.warn(`🔄 检测到页面问题，延长重试间隔`);
          // 对于页面问题，使用更长的重试间隔，但不关闭WebSocket
          const extendedInterval = Math.min(getOptimizedConfig()?.screenshotInterval * 8 || 15000, 30000);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ error: `页面正在恢复，请稍后...` }));
          }
          screenshotTimeout = setTimeout(sendScreenshot, extendedInterval);
          return;
        }
        
        // 对于其他错误，发送错误信息但继续尝试
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ error: `截图错误: ${error.message}` }));
        }
        
        // 使用中等长度的重试间隔
        const normalInterval = getOptimizedConfig()?.screenshotInterval * 2 || 4000;
        screenshotTimeout = setTimeout(sendScreenshot, normalInterval);
        return;
      }

      // 安排下一次截图
      if (!closed) {
        const nextInterval = screenshotManager.getNextInterval();
        screenshotTimeout = setTimeout(sendScreenshot, nextInterval);
      }
    }
    sendScreenshot();

    if (!inst.wsList) inst.wsList = [];
    inst.wsList.push(ws);

    ws.on('close', () => {
      closed = true;
      if (screenshotTimeout) {
        clearTimeout(screenshotTimeout);
      }
      if (inst.wsList) inst.wsList = inst.wsList.filter(w => w !== ws);
      
      // 清理高级管理器
      advancedOperationManager.cleanupInstance(id);
      
      // 输出性能统计
      const stats = performanceManager.getInstanceStats(id);
      const resourceStats = resourceManager.getInstanceDetails(id);
      
      console.log(`WebSocket连接关闭 (${id})，性能统计:`, {
        screenshots: screenshotManager.screenshotCount,
        avgResponseTime: stats?.averageResponseTime || 0,
        bandwidth: stats?.bandwidth || 0,
        errors: stats?.errors || 0,
        memoryUsage: resourceStats?.memoryUsage || 0,
        operationCount: resourceStats?.operationCount || 0
      });
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
    });
  });
}

module.exports = setupWebSocket;

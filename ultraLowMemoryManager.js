// 超低内存浏览器管理器 - 极致内存优化
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// 检测 Chromium 路径
function detectChromiumPath() {
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome',
  ];
  
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log(`超低内存管理器检测到浏览器: ${p}`);
      return p;
    }
  }
  
  console.warn('超低内存管理器未检测到系统浏览器，将使用 Puppeteer 内置 Chrome');
  return null;
}

const chromiumPath = detectChromiumPath();

class UltraLowMemoryManager {
  constructor() {
    this.browserInstances = new Map();
    this.hibernatedInstances = new Map(); // 休眠实例存储
    this.memoryThreshold = 50 * 1024 * 1024; // 50MB 严格内存阈值
    this.maxActiveInstances = this.calculateMaxActiveInstances();
    this.maxTotalInstances = this.calculateMaxTotalInstances();
    
    // 内存压力监控
    this.memoryPressureLevel = 0; // 0-正常, 1-轻度, 2-中度, 3-重度
    this.lastMemoryCheck = 0;
    
    // 实例池和回收机制
    this.instancePool = [];
    this.reuseInstances = true;
    
    // 定时任务
    this.startMemoryMonitoring();
    this.startInstanceCleanup();
    this.startHibernationManager();
  }

  // 计算最大活跃实例数（基于内存压力）
  calculateMaxActiveInstances() {
    const totalMemoryGB = require('os').totalmem() / (1024 * 1024 * 1024);
    // 每个活跃实例预估占用 30MB 内存（更激进的预估）
    const estimatedMemoryPerInstance = 30;
    const maxBasedOnMemory = Math.floor((totalMemoryGB * 1024 * 0.5) / estimatedMemoryPerInstance);
    
    // 考虑 CPU 核心数，但更保守
    const cpuCores = require('os').cpus().length;
    const maxBasedOnCPU = Math.max(cpuCores * 2, 10);
    
    return Math.min(maxBasedOnMemory, maxBasedOnCPU, 30);
  }

  // 计算最大总实例数（包括休眠实例）
  calculateMaxTotalInstances() {
    return this.maxActiveInstances * 3; // 允许3倍的总实例数，通过休眠机制管理
  }

  // 开始内存监控
  startMemoryMonitoring() {
    setInterval(() => {
      this.updateMemoryPressure();
      this.adaptToMemoryPressure();
    }, 5000); // 每5秒检查一次内存压力
  }

  // 开始实例清理
  startInstanceCleanup() {
    setInterval(() => {
      this.performAggressiveCleanup();
    }, 15000); // 每15秒执行一次激进清理
  }

  // 开始休眠管理
  startHibernationManager() {
    setInterval(() => {
      this.manageHibernation();
    }, 10000); // 每10秒管理休眠状态
  }

  // 更新内存压力等级
  updateMemoryPressure() {
    const memInfo = this.getSystemMemoryInfo();
    const usagePercent = memInfo.usagePercent;
    
    if (usagePercent > 90) {
      this.memoryPressureLevel = 3; // 重度
    } else if (usagePercent > 80) {
      this.memoryPressureLevel = 2; // 中度
    } else if (usagePercent > 70) {
      this.memoryPressureLevel = 1; // 轻度
    } else {
      this.memoryPressureLevel = 0; // 正常
    }
  }

  // 根据内存压力调整策略
  async adaptToMemoryPressure() {
    switch (this.memoryPressureLevel) {
      case 3: // 重度压力
        await this.emergencyMemoryRelease();
        break;
      case 2: // 中度压力
        await this.hibernateIdleInstances(5 * 60 * 1000); // 5分钟未使用就休眠
        break;
      case 1: // 轻度压力
        await this.hibernateIdleInstances(15 * 60 * 1000); // 15分钟未使用就休眠
        break;
      default: // 正常
        await this.hibernateIdleInstances(30 * 60 * 1000); // 30分钟未使用就休眠
    }
  }

  // 紧急内存释放
  async emergencyMemoryRelease() {
    console.log('⚠️ 内存压力过大，执行紧急内存释放...');
    
    // 立即休眠所有非活跃实例
    const activeThreshold = 2 * 60 * 1000; // 2分钟内活跃的实例
    const currentTime = Date.now();
    
    for (const [instanceId, instance] of this.browserInstances.entries()) {
      if (currentTime - instance.lastUsed > activeThreshold) {
        try {
          await this.hibernateInstance(instanceId);
        } catch (error) {
          console.error(`紧急休眠实例 ${instanceId} 失败:`, error.message);
        }
      }
    }
    
    // 强制垃圾回收
    if (global.gc) {
      global.gc();
    }
  }

  // 创建超低内存实例
  async createUltraLowMemoryBrowser(options = {}) {
    // 检查是否达到限制
    const totalInstances = this.browserInstances.size + this.hibernatedInstances.size;
    if (totalInstances >= this.maxTotalInstances) {
      // 尝试唤醒休眠实例
      const reusedInstance = await this.reuseHibernatedInstance();
      if (reusedInstance) {
        return reusedInstance;
      }
      throw new Error(`已达到最大实例数限制: ${this.maxTotalInstances}`);
    }

    // 尝试从实例池获取
    if (this.reuseInstances && this.instancePool.length > 0) {
      const reusedBrowser = this.instancePool.pop();
      const instanceId = this.generateInstanceId();
      
      this.browserInstances.set(instanceId, {
        browser: reusedBrowser,
        created: Date.now(),
        lastUsed: Date.now(),
        isReused: true,
        memoryUsage: 0,
        pageCount: 0
      });
      
      return { browser: reusedBrowser, instanceId };
    }

    // 创建新实例
    const ultraOptimizedOptions = {
      ...config.browser.launchOptions,
      executablePath: chromiumPath, // 使用系统 Chromium
      ...options,
      args: [
        ...config.browser.launchOptions.args,
        `--window-size=400,300`, // 更小的窗口
        `--max-old-space-size=64`, // 更严格的内存限制
        '--memory-pressure-off',
        '--renderer-process-limit=1',
        '--disable-features=VizDisplayCompositor,VizHitTestSurfaceLayer,AudioServiceOutOfProcess',
        '--disable-gpu-compositing',
        '--disable-software-rasterizer',
        `--user-data-dir=${options.userDataDir}`,
        // 超低内存专用参数
        '--disable-partial-raster',
        '--disable-skia-runtime-opts',
        '--disable-image-animation-resync',
        '--disable-threaded-scrolling',
        '--disable-smooth-scrolling',
        '--disable-webgl',
        '--disable-webgl2'
      ]
    };

    const browser = await puppeteer.launch(ultraOptimizedOptions);
    const instanceId = options.instanceId || this.generateInstanceId();
    
    // 记录实例信息
    this.browserInstances.set(instanceId, {
      browser,
      created: Date.now(),
      lastUsed: Date.now(),
      memoryUsage: 0,
      pageCount: 0,
      isUltraOptimized: true
    });

    // 监听浏览器关闭事件
    browser.on('disconnected', () => {
      this.browserInstances.delete(instanceId);
    });

    return { browser, instanceId };
  }

  // 休眠实例
  async hibernateInstance(instanceId) {
    const instance = this.browserInstances.get(instanceId);
    if (!instance) return;

    try {
      // 保存实例状态
      const pages = await instance.browser.pages();
      const pageStates = [];
      
      for (const page of pages) {
        try {
          const url = page.url();
          if (url && url !== 'about:blank') {
            pageStates.push({ url });
          }
        } catch (e) {
          // 忽略获取URL失败的页面
        }
      }

      // 存储到休眠状态
      this.hibernatedInstances.set(instanceId, {
        ...instance,
        pageStates,
        hibernatedAt: Date.now()
      });

      // 关闭浏览器
      await instance.browser.close();
      this.browserInstances.delete(instanceId);
      
      console.log(`实例 ${instanceId} 已休眠`);
    } catch (error) {
      console.error(`休眠实例 ${instanceId} 失败:`, error.message);
      // 清理损坏的实例
      this.browserInstances.delete(instanceId);
    }
  }

  // 唤醒休眠实例
  async wakeupInstance(instanceId) {
    const hibernatedInstance = this.hibernatedInstances.get(instanceId);
    if (!hibernatedInstance) {
      throw new Error('休眠实例不存在');
    }

    try {
      // 创建新的浏览器实例
      const { browser } = await this.createUltraLowMemoryBrowser({
        instanceId,
        userDataDir: hibernatedInstance.userDataDir
      });

      // 恢复页面状态
      for (const pageState of hibernatedInstance.pageStates) {
        try {
          const page = await this.createUltraOptimizedPage(browser);
          await page.goto(pageState.url, { waitUntil: 'networkidle2', timeout: 10000 });
        } catch (e) {
          console.warn(`恢复页面 ${pageState.url} 失败:`, e.message);
        }
      }

      // 从休眠状态移除
      this.hibernatedInstances.delete(instanceId);
      
      console.log(`实例 ${instanceId} 已唤醒`);
      return { browser, instanceId };
    } catch (error) {
      console.error(`唤醒实例 ${instanceId} 失败:`, error.message);
      this.hibernatedInstances.delete(instanceId);
      throw error;
    }
  }

  // 重用休眠实例
  async reuseHibernatedInstance() {
    if (this.hibernatedInstances.size === 0) return null;

    // 找到最老的休眠实例
    let oldestInstanceId = null;
    let oldestTime = Date.now();

    for (const [instanceId, instance] of this.hibernatedInstances.entries()) {
      if (instance.hibernatedAt < oldestTime) {
        oldestTime = instance.hibernatedAt;
        oldestInstanceId = instanceId;
      }
    }

    if (oldestInstanceId) {
      try {
        return await this.wakeupInstance(oldestInstanceId);
      } catch (error) {
        console.error('重用休眠实例失败:', error.message);
        return null;
      }
    }

    return null;
  }

  // 管理休眠状态
  async manageHibernation() {
    const currentTime = Date.now();
    const hibernationThreshold = this.getHibernationThreshold();

    // 休眠空闲实例
    for (const [instanceId, instance] of this.browserInstances.entries()) {
      if (currentTime - instance.lastUsed > hibernationThreshold) {
        await this.hibernateInstance(instanceId);
      }
    }

    // 清理过期的休眠实例
    for (const [instanceId, instance] of this.hibernatedInstances.entries()) {
      if (currentTime - instance.hibernatedAt > 2 * 60 * 60 * 1000) { // 2小时后清理
        this.hibernatedInstances.delete(instanceId);
        console.log(`清理过期休眠实例: ${instanceId}`);
      }
    }
  }

  // 获取休眠阈值
  getHibernationThreshold() {
    switch (this.memoryPressureLevel) {
      case 3: return 2 * 60 * 1000;    // 2分钟
      case 2: return 5 * 60 * 1000;    // 5分钟
      case 1: return 15 * 60 * 1000;   // 15分钟
      default: return 30 * 60 * 1000;  // 30分钟
    }
  }

  // 创建超优化页面
  async createUltraOptimizedPage(browser, options = {}) {
    const page = await browser.newPage();
    
    // 极致内存优化设置
    await this.ultraOptimizePageMemory(page, options);
    
    return page;
  }

  // 超级优化页面内存
  async ultraOptimizePageMemory(page, options = {}) {
    try {
      // 阻断所有非必要资源
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        const url = req.url();
        
        // 只允许必要的请求
        if (resourceType === 'document' || 
            (resourceType === 'script' && options.enableJS) ||
            (resourceType === 'stylesheet' && options.enableCSS)) {
          req.continue();
        } else {
          req.abort();
        }
      });

      // 设置最小视口
      await page.setViewport({
        width: 400,
        height: 300,
        deviceScaleFactor: 1
      });

      // 注入极致优化脚本
      await page.evaluateOnNewDocument(() => {
        // 禁用所有控制台输出
        const noop = () => {};
        console.log = console.warn = console.error = console.info = console.debug = noop;
        
        // 禁用事件监听器
        const originalAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
          // 只允许关键事件
          if (['load', 'DOMContentLoaded'].includes(type)) {
            return originalAddEventListener.call(this, type, listener, options);
          }
        };
        
        // 清理定时器
        window.activeTimers = new Set();
        const originalSetTimeout = window.setTimeout;
        const originalSetInterval = window.setInterval;
        
        window.setTimeout = function(fn, ms) {
          const id = originalSetTimeout(fn, ms);
          window.activeTimers.add(id);
          return id;
        };
        
        window.setInterval = function(fn, ms) {
          const id = originalSetInterval(fn, ms);
          window.activeTimers.add(id);
          return id;
        };
        
        // 全局清理函数
        window.ultraCleanup = function() {
          window.activeTimers.forEach(id => {
            clearTimeout(id);
            clearInterval(id);
          });
          window.activeTimers.clear();
          
          // 清理 DOM 引用
          if (document.body) {
            document.body.innerHTML = '';
          }
          
          // 触发垃圾回收
          if (window.gc) {
            window.gc();
          }
        };
      });

      // 设置更短的超时时间
      page.setDefaultNavigationTimeout(5000);
      page.setDefaultTimeout(5000);

    } catch (error) {
      console.warn('超级页面内存优化失败:', error.message);
    }
  }

  // 执行激进清理
  async performAggressiveCleanup() {
    let cleanedCount = 0;

    for (const [instanceId, instance] of this.browserInstances.entries()) {
      try {
        // 清理实例内存
        await this.aggressiveInstanceCleanup(instance.browser);
        
        // 更新使用时间
        instance.lastUsed = Date.now();
        
      } catch (error) {
        console.error(`激进清理实例 ${instanceId} 失败:`, error.message);
        // 移除损坏的实例
        this.browserInstances.delete(instanceId);
        cleanedCount++;
      }
    }

    // 强制垃圾回收
    if (global.gc) {
      global.gc();
    }

    if (cleanedCount > 0) {
      console.log(`激进清理完成，清理了 ${cleanedCount} 个损坏实例`);
    }
  }

  // 激进实例清理
  async aggressiveInstanceCleanup(browser) {
    try {
      const pages = await browser.pages();
      
      for (const page of pages) {
        // 执行页面级清理
        await page.evaluate(() => {
          if (window.ultraCleanup) {
            window.ultraCleanup();
          }
        });

        // 清理页面资源
        try {
          const client = await page.target().createCDPSession();
          await client.send('Runtime.collectGarbage');
          await client.send('Memory.forciblyPurgeJavaScriptMemory');
          await client.detach();
        } catch (e) {
          // 忽略清理错误
        }
      }
    } catch (error) {
      console.warn('激进实例清理失败:', error.message);
    }
  }

  // 获取增强的内存统计
  async getEnhancedMemoryStats() {
    const systemMemory = this.getSystemMemoryInfo();
    
    const stats = {
      activeInstances: this.browserInstances.size,
      hibernatedInstances: this.hibernatedInstances.size,
      totalInstances: this.browserInstances.size + this.hibernatedInstances.size,
      maxActiveInstances: this.maxActiveInstances,
      maxTotalInstances: this.maxTotalInstances,
      memoryPressureLevel: this.memoryPressureLevel,
      memoryPressureText: ['正常', '轻度', '中度', '重度'][this.memoryPressureLevel],
      systemMemory,
      instances: [],
      hibernatedList: []
    };

    // 活跃实例统计
    for (const [instanceId, instance] of this.browserInstances.entries()) {
      try {
        const pages = await instance.browser.pages();
        stats.instances.push({
          id: instanceId,
          pageCount: pages.length,
          created: instance.created,
          lastUsed: instance.lastUsed,
          age: Date.now() - instance.created,
          idleTime: Date.now() - instance.lastUsed,
          isUltraOptimized: instance.isUltraOptimized || false
        });
      } catch (error) {
        stats.instances.push({
          id: instanceId,
          error: error.message,
          status: 'corrupted'
        });
      }
    }

    // 休眠实例统计
    for (const [instanceId, instance] of this.hibernatedInstances.entries()) {
      stats.hibernatedList.push({
        id: instanceId,
        hibernatedAt: instance.hibernatedAt,
        hibernationTime: Date.now() - instance.hibernatedAt,
        pageStates: instance.pageStates?.length || 0
      });
    }

    return stats;
  }

  // 获取系统内存信息
  getSystemMemoryInfo() {
    const os = require('os');
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    
    return {
      total: Math.round(totalMemory / 1024 / 1024 / 1024 * 100) / 100,
      free: Math.round(freeMemory / 1024 / 1024 / 1024 * 100) / 100,
      used: Math.round(usedMemory / 1024 / 1024 / 1024 * 100) / 100,
      usagePercent: Math.round((usedMemory / totalMemory) * 100)
    };
  }

  // 生成实例ID
  generateInstanceId() {
    return `ultra_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // 检查是否可以创建新实例
  canCreateNewInstance() {
    const memInfo = this.getSystemMemoryInfo();
    const totalInstances = this.browserInstances.size + this.hibernatedInstances.size;
    
    let allowed = false;
    let reason = '';
    
    // 开发模式：跳过内存检查
    if (config.development && config.development.skipMemoryCheck) {
      if (totalInstances >= this.maxTotalInstances) {
        reason = `已达到最大总实例数: ${this.maxTotalInstances}`;
      } else if (this.browserInstances.size >= this.maxActiveInstances) {
        if (this.hibernatedInstances.size > 0) {
          allowed = true;
          reason = '可通过唤醒休眠实例创建';
        } else {
          reason = `已达到最大活跃实例数: ${this.maxActiveInstances}`;
        }
      } else {
        allowed = true;
        reason = '开发模式：可以创建新实例';
      }
    } else {
      // 生产模式：严格内存检查
      if (totalInstances >= this.maxTotalInstances) {
        reason = `已达到最大总实例数: ${this.maxTotalInstances}`;
      } else if (this.browserInstances.size >= this.maxActiveInstances) {
        // 尝试使用休眠实例
        if (this.hibernatedInstances.size > 0) {
          allowed = true;
          reason = '可通过唤醒休眠实例创建';
        } else {
          reason = `已达到最大活跃实例数: ${this.maxActiveInstances}`;
        }
      } else if (memInfo.usagePercent > 99) {
        reason = `系统内存使用率过高: ${memInfo.usagePercent}%`;
      } else {
        allowed = true;
        reason = '可以创建新实例';
      }
    }
    
    return {
      allowed,
      reason,
      activeInstances: this.browserInstances.size,
      hibernatedInstances: this.hibernatedInstances.size,
      totalInstances,
      maxActiveInstances: this.maxActiveInstances,
      maxTotalInstances: this.maxTotalInstances,
      memoryUsage: memInfo.usagePercent,
      memoryPressure: this.memoryPressureLevel
    };
  }

  // 关闭所有实例
  async shutdown() {
    console.log('正在关闭超低内存管理器...');
    
    // 关闭所有活跃实例
    const activePromises = [];
    for (const [instanceId, instance] of this.browserInstances.entries()) {
      activePromises.push(
        instance.browser.close().catch(e => 
          console.error(`关闭活跃实例 ${instanceId} 失败:`, e.message)
        )
      );
    }
    
    await Promise.all(activePromises);
    this.browserInstances.clear();
    
    // 清理休眠实例
    this.hibernatedInstances.clear();
    
    console.log('超低内存管理器已关闭');
  }

  // 更新实例使用时间
  updateInstanceUsage(instanceId) {
    const instance = this.browserInstances.get(instanceId);
    if (instance) {
      instance.lastUsed = Date.now();
    }
  }

  // 休眠空闲实例
  async hibernateIdleInstances(idleThreshold) {
    const currentTime = Date.now();
    const hibernatePromises = [];

    for (const [instanceId, instance] of this.browserInstances.entries()) {
      if (currentTime - instance.lastUsed > idleThreshold && !instance.isHibernated) {
        hibernatePromises.push(this.hibernateInstance(instanceId));
      }
    }

    if (hibernatePromises.length > 0) {
      console.log(`正在休眠 ${hibernatePromises.length} 个空闲实例...`);
      await Promise.all(hibernatePromises);
    }
  }
}

module.exports = UltraLowMemoryManager;

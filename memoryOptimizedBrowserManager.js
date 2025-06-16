// 内存优化的浏览器管理器
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const config = require('./config');

class MemoryOptimizedBrowserManager {
  constructor() {
    this.browserInstances = new Map();
    this.memoryThreshold = 100 * 1024 * 1024; // 100MB 内存阈值
    this.maxInstances = this.calculateMaxInstances();
    this.cleanupInterval = setInterval(() => {
      this.performMemoryCleanup();
    }, 30000); // 每30秒清理一次
  }

  // 计算最大实例数
  calculateMaxInstances() {
    const totalMemoryGB = require('os').totalmem() / (1024 * 1024 * 1024);
    // 每个实例预估占用 50MB 内存
    const estimatedMemoryPerInstance = 50;
    const maxBasedOnMemory = Math.floor((totalMemoryGB * 1024 * 0.7) / estimatedMemoryPerInstance);
    
    // 考虑 CPU 核心数
    const cpuCores = require('os').cpus().length;
    const maxBasedOnCPU = cpuCores * 4;
    
    return Math.min(maxBasedOnMemory, maxBasedOnCPU, 50); // 最多50个实例
  }

  // 创建内存优化的浏览器实例
  async createOptimizedBrowser(options = {}) {
    if (this.browserInstances.size >= this.maxInstances) {
      throw new Error(`已达到最大实例数限制: ${this.maxInstances}`);
    }

    const optimizedOptions = {
      ...config.browser.launchOptions,
      ...options,
      args: [
        ...config.browser.launchOptions.args,
        `--window-size=800,600`, // 固定较小窗口大小
        `--max-old-space-size=64`, // 限制每个实例的内存
        '--memory-pressure-off',
        '--renderer-process-limit=1',
        '--disable-features=VizDisplayCompositor,VizHitTestSurfaceLayer',
        `--user-data-dir=${options.userDataDir}`
      ]
    };

    const browser = await puppeteer.launch(optimizedOptions);
    const instanceId = options.instanceId || this.generateInstanceId();
    
    // 记录实例信息
    this.browserInstances.set(instanceId, {
      browser,
      created: Date.now(),
      lastUsed: Date.now(),
      memoryUsage: 0,
      pageCount: 0
    });

    // 监听浏览器关闭事件
    browser.on('disconnected', () => {
      this.browserInstances.delete(instanceId);
    });

    return { browser, instanceId };
  }

  // 生成实例ID
  generateInstanceId() {
    return `browser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // 创建内存优化的页面
  async createOptimizedPage(browser, options = {}) {
    const page = await browser.newPage();
    
    // 内存优化设置
    await this.optimizePageMemory(page, options);
    
    return page;
  }

  // 优化页面内存使用
  async optimizePageMemory(page, options = {}) {
    try {
      // 禁用图片加载（除非明确需要）
      if (!options.enableImages) {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const resourceType = req.resourceType();
          if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
            req.abort();
          } else {
            req.continue();
          }
        });
      }

      // 设置视口为较小尺寸
      await page.setViewport({
        width: options.width || 800,
        height: options.height || 600,
        deviceScaleFactor: 1
      });

      // 禁用不必要的功能
      await page.evaluateOnNewDocument(() => {
        // 禁用控制台输出
        console.log = console.warn = console.error = () => {};
        
        // 清理定时器
        const originalSetInterval = window.setInterval;
        const originalSetTimeout = window.setTimeout;
        window.activeIntervals = new Set();
        window.activeTimeouts = new Set();

        window.setInterval = function(fn, ms) {
          const id = originalSetInterval(fn, ms);
          window.activeIntervals.add(id);
          return id;
        };

        window.setTimeout = function(fn, ms) {
          const id = originalSetTimeout(fn, ms);
          window.activeTimeouts.add(id);
          return id;
        };

        // 清理函数
        window.cleanupTimers = function() {
          window.activeIntervals.forEach(id => clearInterval(id));
          window.activeTimeouts.forEach(id => clearTimeout(id));
          window.activeIntervals.clear();
          window.activeTimeouts.clear();
        };
      });

      // 设置较短的导航超时
      page.setDefaultNavigationTimeout(10000);
      page.setDefaultTimeout(10000);

    } catch (error) {
      console.warn('页面内存优化失败:', error.message);
    }
  }

  // 执行内存清理
  async performMemoryCleanup() {
    console.log('开始内存清理...');
    let cleanedCount = 0;

    for (const [instanceId, instance] of this.browserInstances.entries()) {
      try {
        const timeSinceLastUsed = Date.now() - instance.lastUsed;
        
        // 清理30分钟未使用的实例
        if (timeSinceLastUsed > 30 * 60 * 1000) {
          await instance.browser.close();
          this.browserInstances.delete(instanceId);
          cleanedCount++;
          continue;
        }

        // 清理实例内存
        await this.cleanupInstanceMemory(instance.browser);
        
        // 强制垃圾回收
        if (global.gc) {
          global.gc();
        }

      } catch (error) {
        console.error(`清理实例 ${instanceId} 失败:`, error.message);
        // 如果清理失败，移除有问题的实例
        this.browserInstances.delete(instanceId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`内存清理完成，清理了 ${cleanedCount} 个实例`);
    }
  }

  // 清理实例内存
  async cleanupInstanceMemory(browser) {
    try {
      const pages = await browser.pages();
      
      for (const page of pages) {
        // 清理页面内存
        await page.evaluate(() => {
          // 清理定时器
          if (window.cleanupTimers) {
            window.cleanupTimers();
          }
          
          // 清理事件监听器
          if (window.removeEventListener) {
            ['scroll', 'resize', 'mousemove', 'click'].forEach(event => {
              window.removeEventListener(event, () => {});
            });
          }
          
          // 清理大对象
          if (window.gc) {
            window.gc();
          }
        });

        // 清理页面缓存
        try {
          await page._client.send('Runtime.runIfWaitingForDebugger');
          await page._client.send('Runtime.collectGarbage');
        } catch (e) {
          // 忽略清理错误
        }
      }
    } catch (error) {
      console.warn('清理实例内存失败:', error.message);
    }
  }

  // 获取内存使用统计
  async getMemoryStats() {
    const stats = {
      totalInstances: this.browserInstances.size,
      maxInstances: this.maxInstances,
      systemMemory: this.getSystemMemoryInfo(),
      instances: []
    };

    for (const [instanceId, instance] of this.browserInstances.entries()) {
      try {
        const pages = await instance.browser.pages();
        const pageCount = pages.length;
        
        stats.instances.push({
          id: instanceId,
          pageCount,
          created: instance.created,
          lastUsed: instance.lastUsed,
          age: Date.now() - instance.created
        });
      } catch (error) {
        // 如果无法获取页面信息，可能实例已损坏
        stats.instances.push({
          id: instanceId,
          error: error.message,
          status: 'corrupted'
        });
      }
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
      total: Math.round(totalMemory / 1024 / 1024 / 1024 * 100) / 100, // GB
      free: Math.round(freeMemory / 1024 / 1024 / 1024 * 100) / 100,   // GB
      used: Math.round(usedMemory / 1024 / 1024 / 1024 * 100) / 100,   // GB
      usagePercent: Math.round((usedMemory / totalMemory) * 100)
    };
  }

  // 优化现有实例
  async optimizeExistingInstance(instanceId) {
    const instance = this.browserInstances.get(instanceId);
    if (!instance) {
      throw new Error('实例不存在');
    }

    await this.cleanupInstanceMemory(instance.browser);
    instance.lastUsed = Date.now();
    
    return { success: true, message: '实例优化完成' };
  }

  // 关闭所有实例
  async closeAllInstances() {
    const promises = [];
    
    for (const [instanceId, instance] of this.browserInstances.entries()) {
      promises.push(
        instance.browser.close().catch(e => 
          console.error(`关闭实例 ${instanceId} 失败:`, e.message)
        )
      );
    }
    
    await Promise.all(promises);
    this.browserInstances.clear();
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  // 更新实例使用时间
  updateInstanceUsage(instanceId) {
    const instance = this.browserInstances.get(instanceId);
    if (instance) {
      instance.lastUsed = Date.now();
    }
  }

  // 检查是否可以创建新实例
  canCreateNewInstance() {
    const memInfo = this.getSystemMemoryInfo();
    
    return {
      allowed: this.browserInstances.size < this.maxInstances && memInfo.usagePercent < 85,
      reason: this.browserInstances.size >= this.maxInstances 
        ? `已达到最大实例数: ${this.maxInstances}`
        : memInfo.usagePercent >= 85 
        ? `系统内存使用率过高: ${memInfo.usagePercent}%`
        : '可以创建新实例',
      currentInstances: this.browserInstances.size,
      maxInstances: this.maxInstances,
      memoryUsage: memInfo.usagePercent
    };
  }
}

module.exports = MemoryOptimizedBrowserManager;

// 抖音专用优化浏览器管理器
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const config = require('./config');

class DouyinOptimizedBrowserManager {
  constructor() {
    this.browserInstances = new Map();
    this.maxInstances = this.calculateMaxInstancesForDouyin();
    this.douyinDomain = 'www.douyin.com';
    
    // 抖音专用优化配置
    this.douyinConfig = {
      enableJS: true,          // 抖音需要JS
      enableImages: true,      // 保留图片以维持正常体验
      disableVideo: true,      // 禁用视频节省带宽和内存
      keepCookies: true,       // 保持登录状态
      networkActive: true,     // 保持网络活跃
      blockAds: true,          // 阻断广告
      optimizeForMobile: true  // 使用移动版优化
    };

    // 开始定时维护
    this.startMaintenanceRoutine();
  }

  // 计算抖音专用的最大实例数
  calculateMaxInstancesForDouyin() {
    const totalMemoryGB = require('os').totalmem() / (1024 * 1024 * 1024);
    // 抖音实例预估占用 80MB 内存（因为需要JS和图片）
    const estimatedMemoryPerInstance = 80;
    const maxBasedOnMemory = Math.floor((totalMemoryGB * 1024 * 0.6) / estimatedMemoryPerInstance);
    
    const cpuCores = require('os').cpus().length;
    const maxBasedOnCPU = cpuCores * 3; // 抖音需要更多CPU资源
    
    return Math.min(maxBasedOnMemory, maxBasedOnCPU, 40); // 最多40个抖音实例
  }

  // 创建抖音优化实例
  async createDouyinOptimizedBrowser(options = {}) {
    if (this.browserInstances.size >= this.maxInstances) {
      throw new Error(`已达到抖音实例最大数限制: ${this.maxInstances}`);
    }

    const douyinOptimizedOptions = {
      headless: false, // 抖音可能需要非headless模式来避免检测
      ...options,
      args: [
        // 基础优化参数
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-site-isolation-trials',
        
        // 抖音专用优化
        '--window-size=375,812', // 模拟iPhone尺寸
        '--max-old-space-size=200', // 为JS运行分配足够内存
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        
        // 网络优化
        '--aggressive-cache-discard=false', // 保持缓存以维持登录
        '--enable-features=NetworkService',
        '--disable-features=VizDisplayCompositor',
        
        // 媒体优化 - 禁用视频但保留音频控制
        '--disable-background-media-suspend=false',
        '--autoplay-policy=user-gesture-required',
        '--disable-media-session-api',
        
        // 性能优化
        '--disable-extensions',
        '--disable-plugins',
        '--disable-print-preview',
        '--disable-default-apps',
        '--disable-sync',
        
        // 用户数据目录
        `--user-data-dir=${options.userDataDir}`
      ]
    };

    const browser = await puppeteer.launch(douyinOptimizedOptions);
    const instanceId = options.instanceId || this.generateInstanceId();
    
    // 记录实例信息
    this.browserInstances.set(instanceId, {
      browser,
      created: Date.now(),
      lastUsed: Date.now(),
      memoryUsage: 0,
      pageCount: 0,
      isDouyinOptimized: true,
      loginStatus: 'unknown'
    });

    // 监听浏览器关闭事件
    browser.on('disconnected', () => {
      this.browserInstances.delete(instanceId);
    });

    console.log(`✅ 抖音优化实例 ${instanceId} 创建成功`);
    return { browser, instanceId };
  }

  // 创建抖音专用页面
  async createDouyinOptimizedPage(browser, options = {}) {
    const page = await browser.newPage();
    
    // 设置抖音专用优化
    await this.optimizePageForDouyin(page, options);
    
    return page;
  }

  // 抖音页面优化
  async optimizePageForDouyin(page, options = {}) {
    try {
      // 设置移动设备User-Agent（抖音对移动端更友好）
      await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
      
      // 设置移动设备视口
      await page.setViewport({
        width: 375,
        height: 812,
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        isLandscape: false
      });

      // 设置请求拦截 - 抖音专用
      await page.setRequestInterception(true);
      
      page.on('request', (req) => {
        const url = req.url();
        const resourceType = req.resourceType();
        
        // 阻断视频和大文件
        if (resourceType === 'media' || 
            url.includes('.mp4') || 
            url.includes('.webm') || 
            url.includes('.mov') ||
            url.includes('video') ||
            url.includes('/aweme/v1/play/') || // 抖音视频接口
            url.includes('/aweme/v1/video/')) {
          console.log('🚫 阻断视频资源:', url.substring(0, 100));
          req.abort();
          return;
        }
        
        // 阻断广告
        if (url.includes('/commercial/') ||
            url.includes('/ad/') ||
            url.includes('analytics') ||
            url.includes('track') ||
            resourceType === 'beacon') {
          req.abort();
          return;
        }
        
        // 允许必要资源
        if (resourceType === 'document' ||
            resourceType === 'script' ||
            resourceType === 'stylesheet' ||
            resourceType === 'image' ||
            resourceType === 'xhr' ||
            resourceType === 'fetch') {
          req.continue();
        } else {
          req.abort();
        }
      });

      // 注入抖音专用优化脚本
      await page.evaluateOnNewDocument(() => {
        // 禁用视频自动播放
        Object.defineProperty(HTMLMediaElement.prototype, 'play', {
          writable: true,
          value: function() {
            console.log('🚫 视频播放被阻断');
            return Promise.resolve();
          }
        });
        
        // 禁用视频加载
        Object.defineProperty(HTMLVideoElement.prototype, 'load', {
          writable: true,
          value: function() {
            console.log('🚫 视频加载被阻断');
          }
        });
        
        // 保持网络活跃 - 定期发送心跳
        window.douyinKeepAlive = setInterval(() => {
          // 发送小型请求保持连接
          fetch('/api/v1/heartbeat', { 
            method: 'POST',
            body: JSON.stringify({timestamp: Date.now()}),
            headers: {'Content-Type': 'application/json'}
          }).catch(() => {}); // 忽略错误
        }, 30000); // 每30秒一次
        
        // 优化滚动性能
        let scrollTimeout;
        const originalAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
          if (type === 'scroll') {
            const throttledListener = function(e) {
              clearTimeout(scrollTimeout);
              scrollTimeout = setTimeout(() => listener(e), 16); // 60fps限制
            };
            return originalAddEventListener.call(this, type, throttledListener, options);
          }
          return originalAddEventListener.call(this, type, listener, options);
        };
        
        // 阻断视频相关API
        if (window.MediaSource) {
          window.MediaSource = class MockMediaSource {
            constructor() {
              console.log('🚫 MediaSource被模拟');
            }
          };
        }
        
        // 模拟触摸设备
        Object.defineProperty(navigator, 'maxTouchPoints', {
          get: () => 5
        });
        
        console.log('✅ 抖音页面优化完成');
      });

      // 设置更长的导航超时（抖音加载较慢）
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      console.log('✅ 抖音页面优化配置完成');

    } catch (error) {
      console.warn('⚠️ 抖音页面优化失败:', error.message);
    }
  }

  // 导航到抖音并保持登录状态
  async navigateToDouyinWithLogin(page, options = {}) {
    try {
      console.log('🚀 正在导航到抖音...');
      
      // 首先导航到抖音主页
      await page.goto('https://www.douyin.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      
      // 等待页面稳定
      await page.waitForTimeout(3000);
      
      // 检查登录状态
      const loginStatus = await this.checkDouyinLoginStatus(page);
      console.log('📱 抖音登录状态:', loginStatus);
      
      // 如果未登录，等待用户登录
      if (!loginStatus.isLoggedIn) {
        console.log('⏳ 等待用户登录抖音...');
        // 这里可以添加自动登录逻辑或等待手动登录
      }
      
      return {
        success: true,
        loginStatus,
        message: '抖音页面加载完成'
      };
      
    } catch (error) {
      console.error('❌ 抖音导航失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // 检查抖音登录状态
  async checkDouyinLoginStatus(page) {
    try {
      const loginInfo = await page.evaluate(() => {
        // 检查常见的登录标识
        const hasUserAvatar = document.querySelector('.user-avatar, .avatar, [class*="avatar"]');
        const hasLoginButton = document.querySelector('[class*="login"], .login-btn');
        const hasUserInfo = document.querySelector('.user-info, [class*="user-info"]');
        
        // 检查localStorage中的用户信息
        const hasStoredUserInfo = localStorage.getItem('user') || 
                                 localStorage.getItem('userInfo') ||
                                 localStorage.getItem('douyin_user');
        
        return {
          hasUserAvatar: !!hasUserAvatar,
          hasLoginButton: !!hasLoginButton,
          hasUserInfo: !!hasUserInfo,
          hasStoredUserInfo: !!hasStoredUserInfo,
          cookies: document.cookie.length > 0
        };
      });
      
      const isLoggedIn = (loginInfo.hasUserAvatar && !loginInfo.hasLoginButton) || 
                        loginInfo.hasUserInfo || 
                        loginInfo.hasStoredUserInfo;
      
      return {
        isLoggedIn,
        ...loginInfo,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.warn('⚠️ 检查登录状态失败:', error.message);
      return {
        isLoggedIn: false,
        error: error.message
      };
    }
  }

  // 保持登录活跃
  async keepLoginActive(page) {
    try {
      // 定期检查并保持登录状态
      const keepAliveInterval = setInterval(async () => {
        try {
          // 滚动页面模拟用户活动
          await page.evaluate(() => {
            window.scrollBy(0, 100);
            setTimeout(() => window.scrollBy(0, -100), 1000);
          });
          
          // 检查登录状态
          const loginStatus = await this.checkDouyinLoginStatus(page);
          if (!loginStatus.isLoggedIn) {
            console.warn('⚠️ 检测到登录状态丢失');
          }
          
        } catch (error) {
          console.warn('⚠️ 保持登录活跃失败:', error.message);
        }
      }, 60000); // 每分钟检查一次
      
      // 存储定时器ID以便清理
      page._douyinKeepAliveInterval = keepAliveInterval;
      
    } catch (error) {
      console.warn('⚠️ 启动登录保活失败:', error.message);
    }
  }

  // 开始维护例程
  startMaintenanceRoutine() {
    // 每5分钟执行一次维护
    setInterval(() => {
      this.performDouyinMaintenance();
    }, 5 * 60 * 1000);
  }

  // 执行抖音专用维护
  async performDouyinMaintenance() {
    console.log('🔧 开始抖音实例维护...');
    
    let maintainedCount = 0;
    
    for (const [instanceId, instance] of this.browserInstances.entries()) {
      try {
        const pages = await instance.browser.pages();
        
        for (const page of pages) {
          // 检查是否是抖音页面
          const url = page.url();
          if (url.includes('douyin.com')) {
            // 检查登录状态
            const loginStatus = await this.checkDouyinLoginStatus(page);
            instance.loginStatus = loginStatus.isLoggedIn ? 'logged_in' : 'logged_out';
            
            // 清理页面内存
            await page.evaluate(() => {
              // 清理视频元素
              const videos = document.querySelectorAll('video');
              videos.forEach(video => {
                video.pause();
                video.src = '';
                video.load();
              });
              
              // 强制垃圾回收
              if (window.gc) {
                window.gc();
              }
            });
            
            maintainedCount++;
          }
        }
        
        // 更新使用时间
        instance.lastUsed = Date.now();
        
      } catch (error) {
        console.error(`维护实例 ${instanceId} 失败:`, error.message);
      }
    }
    
    if (maintainedCount > 0) {
      console.log(`✅ 抖音维护完成，维护了 ${maintainedCount} 个页面`);
    }
  }

  // 获取抖音专用统计
  async getDouyinStats() {
    const stats = {
      totalInstances: this.browserInstances.size,
      maxInstances: this.maxInstances,
      systemMemory: this.getSystemMemoryInfo(),
      douyinInstances: [],
      loginStatusSummary: {
        loggedIn: 0,
        loggedOut: 0,
        unknown: 0
      }
    };

    for (const [instanceId, instance] of this.browserInstances.entries()) {
      try {
        const pages = await instance.browser.pages();
        const douyinPages = [];
        
        for (const page of pages) {
          const url = page.url();
          if (url.includes('douyin.com')) {
            douyinPages.push({
              url,
              title: await page.title().catch(() => 'Unknown')
            });
          }
        }
        
        if (douyinPages.length > 0) {
          stats.douyinInstances.push({
            id: instanceId,
            pageCount: pages.length,
            douyinPages: douyinPages.length,
            created: instance.created,
            lastUsed: instance.lastUsed,
            loginStatus: instance.loginStatus || 'unknown',
            age: Date.now() - instance.created
          });
          
          stats.loginStatusSummary[instance.loginStatus || 'unknown']++;
        }
      } catch (error) {
        stats.douyinInstances.push({
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
      total: Math.round(totalMemory / 1024 / 1024 / 1024 * 100) / 100,
      free: Math.round(freeMemory / 1024 / 1024 / 1024 * 100) / 100,
      used: Math.round(usedMemory / 1024 / 1024 / 1024 * 100) / 100,
      usagePercent: Math.round((usedMemory / totalMemory) * 100)
    };
  }

  // 生成实例ID
  generateInstanceId() {
    return `douyin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // 检查是否可以创建新实例
  canCreateNewInstance() {
    const memInfo = this.getSystemMemoryInfo();
    
    return {
      allowed: this.browserInstances.size < this.maxInstances && memInfo.usagePercent < 80,
      reason: this.browserInstances.size >= this.maxInstances 
        ? `已达到抖音实例最大数: ${this.maxInstances}`
        : memInfo.usagePercent >= 80 
        ? `系统内存使用率过高: ${memInfo.usagePercent}%`
        : '可以创建抖音实例',
      currentInstances: this.browserInstances.size,
      maxInstances: this.maxInstances,
      memoryUsage: memInfo.usagePercent
    };
  }

  // 关闭所有实例
  async closeAllInstances() {
    console.log('🔄 正在关闭所有抖音实例...');
    
    const promises = [];
    
    for (const [instanceId, instance] of this.browserInstances.entries()) {
      promises.push(
        instance.browser.close().catch(e => 
          console.error(`关闭抖音实例 ${instanceId} 失败:`, e.message)
        )
      );
    }
    
    await Promise.all(promises);
    this.browserInstances.clear();
    
    console.log('✅ 所有抖音实例已关闭');
  }

  // 更新实例使用时间
  updateInstanceUsage(instanceId) {
    const instance = this.browserInstances.get(instanceId);
    if (instance) {
      instance.lastUsed = Date.now();
    }
  }
}

module.exports = DouyinOptimizedBrowserManager;

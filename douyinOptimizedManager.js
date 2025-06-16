// 抖音专用优化浏览器管理器
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
      console.log(`抖音管理器检测到浏览器: ${p}`);
      return p;
    }
  }
  
  console.warn('抖音管理器未检测到系统浏览器，将使用 Puppeteer 内置 Chrome');
  return null;
}

const chromiumPath = detectChromiumPath();

class DouyinOptimizedBrowserManager {
  constructor() {
    this.browserInstances = new Map();
    this.maxInstances = this.calculateMaxInstancesForDouyin();
    this.douyinDomain = 'www.douyin.com';
    
    // 抖音专用优化配置 - 纯PC桌面模式
    this.douyinConfig = {
      enableJS: true,          // 抖音需要JS
      enableImages: true,      // 保留图片以维持正常体验
      disableVideo: true,      // 禁用视频节省带宽和内存
      keepCookies: true,       // 保持登录状态
      networkActive: true,     // 保持网络活跃
      blockAds: true           // 阻断广告
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
      ...options, // 先应用传入的选项
      headless: true, // 强制覆盖为 headless 模式
      executablePath: chromiumPath, // 使用系统 Chromium
      args: [
        // 基础优化参数
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-site-isolation-trials',
        
        // 抖音专用优化 - 使用桌面尺寸
        '--window-size=1366,768', // 标准桌面尺寸
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
        
        // 服务器环境必需参数
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--virtual-time-budget=100000',
        '--disable-logging',
        '--disable-domain-reliability',
        
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

  // 抖音页面优化 - 纯PC桌面模式（分阶段优化避免Frame分离）
  async optimizePageForDouyin(page, options = {}) {
    try {
      // 确保页面有效
      if (!page || page.isClosed()) {
        throw new Error('页面无效或已关闭');
      }

      console.log('🔧 开始抖音页面优化...');

      // 第一阶段：基础配置
      await page.setUserAgent(config.douyin.desktopUserAgent);
      page.setDefaultNavigationTimeout(60000); // 延长超时
      page.setDefaultTimeout(30000);

      // 第二阶段：轻量级脚本注入（避免复杂操作）
      await page.evaluateOnNewDocument(() => {
        // 简化的优化脚本，避免过度干预导致页面分离
        window.douyinOptimized = true;
        
        // 仅在页面加载完成后执行视频优化
        document.addEventListener('DOMContentLoaded', () => {
          // 轻量级视频处理
          const handleVideo = () => {
            const videos = document.querySelectorAll('video');
            videos.forEach(video => {
              video.muted = true;
              video.preload = 'none';
            });
          };
          
          handleVideo();
          // 延迟再次执行
          setTimeout(handleVideo, 3000);
        });
        
        console.log('✅ 抖音轻量级优化脚本注入完成');
      });

      console.log('✅ 抖音页面基础优化完成');

    } catch (error) {
      console.warn('⚠️ 抖音页面优化失败:', error.message);
      // 不抛出错误，允许页面继续使用
    }
  }

  // 延迟应用高级优化（在页面导航成功后）
  async applyAdvancedDouyinOptimization(page) {
    try {
      if (!page || page.isClosed()) {
        return;
      }

      console.log('🔧 应用抖音高级优化...');

      // 设置请求拦截（页面稳定后）
      try {
        await page.setRequestInterception(true);
        
        page.on('request', (req) => {
          const url = req.url();
          const resourceType = req.resourceType();
          
          // 简化的资源过滤
          if (resourceType === 'media' || 
              url.includes('.mp4') || 
              url.includes('video')) {
            req.abort();
            return;
          }
          
          // 允许其他资源
          req.continue();
        });
      } catch (interceptError) {
        console.warn('⚠️ 高级优化设置失败:', interceptError.message);
      }

      // 页面级优化
      await page.evaluate(() => {
        // 更激进的视频处理
        const blockVideos = () => {
          const videos = document.querySelectorAll('video');
          videos.forEach(video => {
            video.pause();
            video.src = '';
            video.style.display = 'none';
          });
        };
        
        blockVideos();
        
        // 定期清理
        setInterval(blockVideos, 5000);
      });

      console.log('✅ 抖音高级优化应用完成');

    } catch (error) {
      console.warn('⚠️ 应用高级优化失败:', error.message);
    }
  }

  // 导航到抖音并保持登录状态（改进版本）
  async navigateToDouyinWithLogin(page, options = {}) {
    try {
      console.log('🚀 正在导航到抖音...');
      
      // 确保页面有效且未关闭
      if (!page || page.isClosed()) {
        throw new Error('页面无效或已关闭');
      }
      
      // 简单等待，避免操作过于激进
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 导航到抖音主页，使用最简单的等待策略
      await page.goto('https://www.douyin.com', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      
      // 等待页面基本稳定
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // 验证页面URL
      const currentUrl = page.url();
      if (!currentUrl.includes('douyin.com')) {
        throw new Error(`页面导航失败，当前URL: ${currentUrl}`);
      }
      
      console.log('✅ 抖音页面导航成功:', currentUrl);
      
      // 页面稳定后应用高级优化
      setTimeout(() => {
        this.applyAdvancedDouyinOptimization(page).catch(err => 
          console.warn('高级优化失败:', err.message)
        );
      }, 5000);
      
      // 检查登录状态（简化版本）
      let loginStatus = { isLoggedIn: false };
      try {
        loginStatus = await page.evaluate(() => {
          const hasLoginButton = document.querySelector('[class*="login"]');
          const hasCookies = document.cookie.length > 10;
          return {
            isLoggedIn: !hasLoginButton && hasCookies,
            cookieCount: document.cookie.length
          };
        });
      } catch (e) {
        console.warn('登录状态检查失败:', e.message);
      }
      
      console.log('📱 抖音登录状态:', loginStatus);
      
      return {
        success: true,
        loginStatus,
        message: '抖音页面加载完成',
        url: currentUrl
      };
      
    } catch (error) {
      console.error('❌ 抖音导航失败:', error.message);
      throw error; // 重新抛出错误以便上层处理
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
    
    // 开发模式：跳过内存检查
    if (config.development && config.development.skipMemoryCheck) {
      return {
        allowed: this.browserInstances.size < this.maxInstances,
        reason: this.browserInstances.size >= this.maxInstances 
          ? `已达到抖音实例最大数: ${this.maxInstances}`
          : '开发模式：可以创建抖音实例',
        currentInstances: this.browserInstances.size,
        maxInstances: this.maxInstances,
        memoryUsage: memInfo.usagePercent
      };
    }
    
    // 生产模式：严格检查
    return {
      allowed: this.browserInstances.size < this.maxInstances && memInfo.usagePercent < 99,
      reason: this.browserInstances.size >= this.maxInstances 
        ? `已达到抖音实例最大数: ${this.maxInstances}`
        : memInfo.usagePercent >= 99 
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

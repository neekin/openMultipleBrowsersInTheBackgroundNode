/**
 * 登录状态监控管理器
 * 动态调整检测频率：未登录时10秒一次，已登录时30分钟一次
 */

class LoginStatusMonitor {
  constructor(browsers, db) {
    this.browsers = browsers;
    this.db = db;
    this.monitors = new Map(); // instanceId -> monitorInfo
    this.isRunning = false;
    
    // 检测间隔配置
    this.config = {
      notLoggedInInterval: 10 * 1000, // 未登录时10秒检测一次
      loggedInInterval: 30 * 60 * 1000, // 已登录时30分钟检测一次
      enableLog: true
    };
    
    console.log('🔍 登录状态监控管理器已启动');
  }

  // 启动监控
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // 立即启动一次检测
    this.checkAllInstances();
    
    // 定期清理已关闭的实例监控
    setInterval(() => {
      this.cleanupInactiveMonitors();
    }, 60000); // 每分钟清理一次
    
    console.log('🔍 登录状态监控已启动');
  }

  // 停止监控
  stop() {
    this.isRunning = false;
    // 清理所有定时器
    for (const [instanceId, monitor] of this.monitors) {
      if (monitor.timer) {
        clearTimeout(monitor.timer);
      }
    }
    this.monitors.clear();
    console.log('🔍 登录状态监控已停止');
  }

  // 为实例添加监控
  addInstanceMonitor(instanceId) {
    if (this.monitors.has(instanceId)) {
      return; // 已存在监控
    }

    const monitor = {
      instanceId,
      lastCheck: 0,
      lastStatus: null,
      timer: null,
      isLoggedIn: false,
      avatarUrl: null
    };

    this.monitors.set(instanceId, monitor);
    
    // 立即开始监控
    this.scheduleNextCheck(instanceId);
    
    if (this.config.enableLog) {
      console.log(`🔍 开始监控实例 ${instanceId.substr(0, 8)} 的登录状态`);
    }
  }

  // 移除实例监控
  removeInstanceMonitor(instanceId) {
    const monitor = this.monitors.get(instanceId);
    if (monitor && monitor.timer) {
      clearTimeout(monitor.timer);
    }
    this.monitors.delete(instanceId);
    
    if (this.config.enableLog) {
      console.log(`🔍 停止监控实例 ${instanceId.substr(0, 8)} 的登录状态`);
    }
  }

  // 检测单个实例的登录状态
  async checkInstanceLoginStatus(instanceId) {
    const inst = this.browsers[instanceId];
    if (!inst || !inst.browser || !inst.pages || inst.pages.length === 0) {
      return null;
    }

    try {
      const page = inst.pages[inst.activePageIdx || 0];
      
      // 检测登录面板
      const loginElement = await page.$('#login-panel-new');
      let userInfo = null;
      
      if (!loginElement) {
        // 没有登录面板，检测用户头像和昵称
        try {
          const avatarElement = await page.$('[data-e2e="live-avatar"]');
          let avatarUrl = null;
          let nickname = null;
          
          if (avatarElement) {
            avatarUrl = await page.evaluate((element) => {
              const img = element.querySelector('img');
              return img ? img.src : null;
            }, avatarElement);
          }
          
          // 检测昵称（类名为 ChwkdccW 的元素）
          const nicknameElement = await page.$('.ChwkdccW');
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
          if (this.config.enableLog) {
            console.log(`获取用户信息失败 (${instanceId.substr(0, 8)}):`, avatarError.message);
          }
        }
      }

      const isLoggedIn = !loginElement;
      
      return {
        instanceId,
        isLoggedIn,
        hasLoginPanel: !!loginElement,
        userInfo,
        url: page.url(),
        timestamp: Date.now()
      };
    } catch (error) {
      if (this.config.enableLog) {
        console.log(`检测登录状态失败 (${instanceId.substr(0, 8)}):`, error.message);
      }
      return null;
    }
  }

  // 安排下次检测
  scheduleNextCheck(instanceId) {
    const monitor = this.monitors.get(instanceId);
    if (!monitor) return;

    // 清除之前的定时器
    if (monitor.timer) {
      clearTimeout(monitor.timer);
    }

    // 根据登录状态决定检测间隔
    const interval = monitor.isLoggedIn ? 
      this.config.loggedInInterval : 
      this.config.notLoggedInInterval;

    monitor.timer = setTimeout(async () => {
      await this.performCheck(instanceId);
    }, interval);
  }

  // 执行检测
  async performCheck(instanceId) {
    const monitor = this.monitors.get(instanceId);
    if (!monitor) return;

    const status = await this.checkInstanceLoginStatus(instanceId);
    
    if (status) {
      const statusChanged = monitor.isLoggedIn !== status.isLoggedIn;
      
      // 更新监控信息
      monitor.lastCheck = Date.now();
      monitor.lastStatus = status;
      monitor.isLoggedIn = status.isLoggedIn;
      monitor.avatarUrl = status.userInfo?.avatarUrl || null;

      // 如果状态改变，记录日志
      if (statusChanged && this.config.enableLog) {
        const statusText = status.isLoggedIn ? '已登录' : '未登录';
        const intervalText = status.isLoggedIn ? '30分钟' : '10秒';
        console.log(`🔍 实例 ${instanceId.substr(0, 8)} 登录状态: ${statusText}，下次检测间隔: ${intervalText}`);
        
        if (status.isLoggedIn && status.userInfo?.avatarUrl) {
          console.log(`👤 实例 ${instanceId.substr(0, 8)} 用户头像: ${status.userInfo.avatarUrl}`);
        }
      }

      // 更新数据库中的登录状态信息
      if (this.db) {
        this.db.run(
          'UPDATE browsers SET lastActiveTime = ? WHERE id = ?',
          [Date.now(), instanceId],
          (err) => {
            if (err && this.config.enableLog) {
              console.error(`更新实例 ${instanceId.substr(0, 8)} 活跃时间失败:`, err.message);
            }
          }
        );
      }
    }

    // 安排下次检测
    this.scheduleNextCheck(instanceId);
  }

  // 检测所有实例
  async checkAllInstances() {
    const activeInstances = Object.keys(this.browsers).filter(id => {
      const inst = this.browsers[id];
      return inst && inst.browser && !inst.browser.process()?.killed && inst.online === true;
    });

    // 为活跃实例添加监控
    for (const instanceId of activeInstances) {
      if (!this.monitors.has(instanceId)) {
        this.addInstanceMonitor(instanceId);
      }
    }
  }

  // 清理不活跃的监控
  cleanupInactiveMonitors() {
    for (const [instanceId, monitor] of this.monitors) {
      const inst = this.browsers[instanceId];
      
      // 如果实例不存在或已关闭，移除监控
      if (!inst || !inst.browser || inst.browser.process()?.killed || inst.online !== true) {
        this.removeInstanceMonitor(instanceId);
      }
    }
  }

  // 获取监控统计信息
  getMonitorStats() {
    const stats = {
      totalMonitors: this.monitors.size,
      loggedInCount: 0,
      notLoggedInCount: 0,
      monitors: []
    };

    for (const [instanceId, monitor] of this.monitors) {
      if (monitor.isLoggedIn) {
        stats.loggedInCount++;
      } else {
        stats.notLoggedInCount++;
      }

      stats.monitors.push({
        instanceId: instanceId.substr(0, 8),
        isLoggedIn: monitor.isLoggedIn,
        lastCheck: monitor.lastCheck ? new Date(monitor.lastCheck).toISOString() : null,
        avatarUrl: monitor.avatarUrl,
        nextCheckInterval: monitor.isLoggedIn ? '30分钟' : '10秒'
      });
    }

    return stats;
  }

  // 手动触发检测
  async triggerCheck(instanceId = null) {
    if (instanceId) {
      // 检测指定实例
      await this.performCheck(instanceId);
      return { success: true, message: `实例 ${instanceId.substr(0, 8)} 检测完成` };
    } else {
      // 检测所有实例
      await this.checkAllInstances();
      return { success: true, message: '所有实例检测完成' };
    }
  }

  // 更新配置
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('🔍 登录状态监控配置已更新:', this.config);
  }
}

module.exports = LoginStatusMonitor;

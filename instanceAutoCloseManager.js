// 实例自动关闭管理器 - 管理创建后无连接的实例
class InstanceAutoCloseManager {
  constructor(browsers, db) {
    this.browsers = browsers;
    this.db = db;
    this.closeTimeouts = new Map(); // 存储每个实例的超时定时器
    this.config = {
      noConnectionTimeout: 2 * 60 * 1000, // 2分钟无连接自动关闭
      checkInterval: 30 * 1000 // 每30秒检查一次
    };
    
    console.log('🕒 实例自动关闭管理器已启动');
    console.log(`⏰ 配置: 无连接${this.config.noConnectionTimeout/60000}分钟后自动关闭`);
    
    // 启动定期检查
    this.startPeriodicCheck();
  }

  // 注册新创建的实例
  registerNewInstance(instanceId) {
    console.log(`📝 注册新实例: ${instanceId}, 将在 ${this.config.noConnectionTimeout/60000} 分钟后检查连接状态`);
    
    // 设置超时定时器
    const timeout = setTimeout(async () => {
      await this.checkAndCloseInstance(instanceId);
    }, this.config.noConnectionTimeout);
    
    this.closeTimeouts.set(instanceId, timeout);
  }

  // 当实例建立 WebSocket 连接时调用
  onInstanceConnected(instanceId) {
    console.log(`🔗 实例 ${instanceId} 已建立连接，取消自动关闭`);
    
    // 取消自动关闭定时器
    const timeout = this.closeTimeouts.get(instanceId);
    if (timeout) {
      clearTimeout(timeout);
      this.closeTimeouts.delete(instanceId);
    }
  }

  // 当实例所有连接断开时调用（可选，可以重新开始计时）
  onInstanceDisconnected(instanceId) {
    const inst = this.browsers[instanceId];
    if (!inst) return;
    
    // 检查是否真的没有连接了
    if (inst.wsList && inst.wsList.length === 0) {
      console.log(`📵 实例 ${instanceId} 所有连接已断开，开始计时等待新连接...`);
      
      // 重新开始计时（较短的时间）
      const timeout = setTimeout(async () => {
        await this.checkAndCloseInstance(instanceId);
      }, 30000); // 30秒后关闭
      
      this.closeTimeouts.set(instanceId, timeout);
    }
  }

  // 检查并关闭实例
  async checkAndCloseInstance(instanceId) {
    const inst = this.browsers[instanceId];
    if (!inst) {
      console.log(`⚠️ 实例 ${instanceId} 已不存在，跳过关闭检查`);
      this.closeTimeouts.delete(instanceId);
      return;
    }

    // 检查是否有活跃的 WebSocket 连接
    const hasConnections = inst.wsList && inst.wsList.length > 0;
    
    if (hasConnections) {
      console.log(`✅ 实例 ${instanceId} 有活跃连接 (${inst.wsList.length} 个)，跳过自动关闭`);
      this.closeTimeouts.delete(instanceId);
      return;
    }

    console.log(`🔐 自动关闭无连接实例: ${instanceId}`);
    
    try {
      // 关闭浏览器实例
      if (inst.browser && !inst.browser.process()?.killed) {
        await inst.browser.close();
      }
      
      // 清理页面
      if (inst.pages) {
        for (const page of inst.pages) {
          try {
            await page.close();
          } catch (e) {
            // 忽略页面关闭错误
          }
        }
      }
      
      // 标记为离线状态但保留数据库记录
      inst.online = false;
      inst.lastClosed = new Date().toISOString();
      
      // 更新数据库记录在线状态和最后关闭时间
      if (this.db) {
        this.db.run(
          'UPDATE browsers SET online = 0, lastActiveTime = ? WHERE id = ?',
          [Date.now(), instanceId],
          (err) => {
            if (err) {
              console.error(`更新实例 ${instanceId} 状态失败:`, err.message);
            } else {
              console.log(`📝 实例 ${instanceId} 数据库状态已更新为离线`);
            }
          }
        );
      }
      
      console.log(`✅ 实例 ${instanceId} 已自动关闭（无连接超时）`);
      
    } catch (error) {
      console.error(`❌ 关闭实例 ${instanceId} 时出错:`, error.message);
    } finally {
      // 清理定时器
      this.closeTimeouts.delete(instanceId);
    }
  }

  // 手动取消实例的自动关闭
  cancelAutoClose(instanceId) {
    const timeout = this.closeTimeouts.get(instanceId);
    if (timeout) {
      clearTimeout(timeout);
      this.closeTimeouts.delete(instanceId);
      console.log(`⏹️ 已取消实例 ${instanceId} 的自动关闭`);
      return true;
    }
    return false;
  }

  // 获取待关闭实例的状态
  getPendingCloseInstances() {
    const pending = [];
    for (const [instanceId, timeout] of this.closeTimeouts) {
      const inst = this.browsers[instanceId];
      if (inst) {
        pending.push({
          id: instanceId,
          hasTimeout: !!timeout,
          connections: inst.wsList ? inst.wsList.length : 0,
          createdAt: inst.createdAt
        });
      }
    }
    return pending;
  }

  // 定期检查（备用机制）
  startPeriodicCheck() {
    setInterval(() => {
      this.performPeriodicCheck();
    }, this.config.checkInterval);
  }

  // 执行定期检查
  performPeriodicCheck() {
    const now = Date.now();
    let checkedCount = 0;
    
    for (const [instanceId, inst] of Object.entries(this.browsers)) {
      // 只检查在线但无连接的实例
      if (inst.online !== false && (!inst.wsList || inst.wsList.length === 0)) {
        const createdTime = new Date(inst.createdAt).getTime();
        const timeSinceCreated = now - createdTime;
        
        // 如果创建超过配置的时间且无连接，开始关闭流程
        if (timeSinceCreated > this.config.noConnectionTimeout && !this.closeTimeouts.has(instanceId)) {
          console.log(`🔍 定期检查发现无连接实例: ${instanceId} (创建 ${Math.round(timeSinceCreated/60000)} 分钟前)`);
          this.checkAndCloseInstance(instanceId);
          checkedCount++;
        }
      }
    }
    
    if (checkedCount > 0) {
      console.log(`🔍 定期检查完成，处理了 ${checkedCount} 个无连接实例`);
    }
  }

  // 更新配置
  updateConfig(newConfig) {
    if (newConfig.noConnectionTimeout) {
      this.config.noConnectionTimeout = newConfig.noConnectionTimeout * 60000; // 分钟转毫秒
    }
    if (newConfig.checkInterval) {
      this.config.checkInterval = newConfig.checkInterval * 1000; // 秒转毫秒
    }
    
    console.log(`🔧 自动关闭配置已更新:`, {
      noConnectionTimeoutMinutes: this.config.noConnectionTimeout / 60000,
      checkIntervalSeconds: this.config.checkInterval / 1000
    });
  }

  // 获取统计信息
  getStats() {
    return {
      pendingCloseCount: this.closeTimeouts.size,
      pendingInstances: this.getPendingCloseInstances(),
      config: {
        noConnectionTimeoutMinutes: this.config.noConnectionTimeout / 60000,
        checkIntervalSeconds: this.config.checkInterval / 1000
      }
    };
  }
}

module.exports = InstanceAutoCloseManager;

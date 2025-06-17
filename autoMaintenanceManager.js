// 自动维护管理器 - 定期启动长时间未使用的实例
const { smartStartInstance, checkInstanceStatus } = require('./browserManager');

class AutoMaintenanceManager {
  constructor(browsers, db) {
    this.browsers = browsers;
    this.db = db;
    this.maintenanceQueue = [];
    this.isProcessing = false;
    this.config = {
      checkInterval: 10 * 60 * 1000, // 每10分钟检查一次
      inactiveThreshold: 30 * 60 * 1000, // 30分钟未启动则认为需要维护
      maintenanceDuration: 5 * 60 * 1000, // 维护运行5分钟
      maxConcurrentMaintenance: 1, // 最大同时维护实例数
      maintenanceDelay: 2 * 60 * 1000 // 维护间隔2分钟
    };
    
    this.runningMaintenance = new Set(); // 正在维护的实例
    this.lastMaintenanceCheck = Date.now();
    
    // 启动自动维护
    this.startAutoMaintenance();
  }

  // 启动自动维护检查
  startAutoMaintenance() {
    console.log('🔄 自动维护管理器已启动');
    console.log(`📋 配置: 检查间隔${this.config.checkInterval/60000}分钟, 非活跃阈值${this.config.inactiveThreshold/60000}分钟`);
    
    // 定期检查
    setInterval(() => {
      this.checkAndQueueMaintenance();
    }, this.config.checkInterval);
    
    // 处理维护队列
    setInterval(() => {
      this.processMaintenanceQueue();
    }, 30000); // 每30秒处理一次队列
    
    // 初始检查
    setTimeout(() => {
      this.checkAndQueueMaintenance();
    }, 5000); // 5秒后进行首次检查
  }

  // 检查并排队需要维护的实例
  async checkAndQueueMaintenance() {
    try {
      console.log('🔍 开始检查需要维护的实例...');
      
      // 从数据库获取所有实例
      this.db.all('SELECT * FROM browsers', (err, rows) => {
        if (err) {
          console.error('获取实例列表失败:', err.message);
          return;
        }
        
        const now = Date.now();
        const inactiveInstances = [];
        
        for (const row of rows) {
          const instanceId = row.id;
          const inst = this.browsers[instanceId];
          
          // 跳过正在维护的实例
          if (this.runningMaintenance.has(instanceId)) {
            continue;
          }
          
          // 检查实例状态
          const status = inst ? checkInstanceStatus(inst) : { online: false };
          
          // 计算最后活跃时间 - 使用数据库中的 lastActiveTime 字段
          let lastActiveTime = 0;
          let timeSource = 'unknown';
          if (row.lastActiveTime) {
            // 数据库中有记录的最后活跃时间
            lastActiveTime = typeof row.lastActiveTime === 'string' ? 
              parseFloat(row.lastActiveTime) : 
              row.lastActiveTime;
            timeSource = 'database.lastActiveTime';
          } else if (inst && inst.lastStarted) {
            // 备用：使用内存中的启动时间
            lastActiveTime = new Date(inst.lastStarted).getTime();
            timeSource = 'memory.lastStarted';
          } else if (row.createdAt) {
            // 最后备用：使用创建时间
            lastActiveTime = new Date(row.createdAt).getTime();
            timeSource = 'database.createdAt';
          }
          
          const timeSinceLastActive = now - lastActiveTime;
          
          // 调试日志
          console.log(`🔍 实例 ${instanceId}: 状态=${status.online ? '在线' : '离线'}, 时间源=${timeSource}, 未活跃=${Math.round(timeSinceLastActive/60000)}分钟`);
          
          // 如果实例离线且超过阈值时间未活跃
          if (!status.online && timeSinceLastActive > this.config.inactiveThreshold) {
            inactiveInstances.push({
              id: instanceId,
              lastActiveTime,
              timeSinceLastActive,
              priority: timeSinceLastActive // 越久未活跃优先级越高
            });
          }
        }
        
        // 按优先级排序（最久未活跃的排在前面）
        inactiveInstances.sort((a, b) => b.priority - a.priority);
        
        if (inactiveInstances.length > 0) {
          console.log(`📊 发现 ${inactiveInstances.length} 个需要维护的实例`);
          
          // 添加到维护队列（避免重复添加）
          for (const instance of inactiveInstances) {
            if (!this.maintenanceQueue.find(item => item.id === instance.id)) {
              this.maintenanceQueue.push({
                ...instance,
                queuedAt: now
              });
              console.log(`📋 实例 ${instance.id} 已添加到维护队列 (未活跃 ${Math.round(instance.timeSinceLastActive/60000)} 分钟)`);
            }
          }
        } else {
          console.log('✅ 所有实例状态正常，无需维护');
        }
      });
    } catch (error) {
      console.error('检查维护状态时出错:', error.message);
    }
  }

  // 处理维护队列
  async processMaintenanceQueue() {
    if (this.isProcessing || this.maintenanceQueue.length === 0) {
      return;
    }
    
    // 检查是否可以启动新的维护
    if (this.runningMaintenance.size >= this.config.maxConcurrentMaintenance) {
      return;
    }
    
    this.isProcessing = true;
    
    try {
      // 取出队列中的第一个实例
      const maintenanceItem = this.maintenanceQueue.shift();
      if (!maintenanceItem) {
        this.isProcessing = false;
        return;
      }
      
      console.log(`🔧 开始维护实例: ${maintenanceItem.id}`);
      await this.performInstanceMaintenance(maintenanceItem.id);
      
    } catch (error) {
      console.error('处理维护队列时出错:', error.message);
    } finally {
      this.isProcessing = false;
    }
  }

  // 执行单个实例的维护
  async performInstanceMaintenance(instanceId) {
    try {
      this.runningMaintenance.add(instanceId);
      
      const inst = this.browsers[instanceId];
      if (!inst) {
        console.error(`维护失败: 实例 ${instanceId} 不存在`);
        return;
      }
      
      console.log(`🚀 启动实例进行维护: ${instanceId}`);
      
      // 智能启动实例
      try {
        const result = await smartStartInstance(instanceId, inst, this.db);
        
        if (result) {
          // 更新实例状态
          inst.browser = result.browser;
          inst.pages = result.pages;
          inst.online = true;
          inst.lastStarted = new Date().toISOString();
          inst.maintenanceStarted = new Date().toISOString();
          
          console.log(`✅ 实例 ${instanceId} 维护启动成功，将运行 ${this.config.maintenanceDuration/60000} 分钟`);
          
          // 设置维护结束定时器
          setTimeout(async () => {
            await this.stopMaintenanceInstance(instanceId);
          }, this.config.maintenanceDuration);
          
        } else {
          console.error(`实例 ${instanceId} 启动失败`);
          this.runningMaintenance.delete(instanceId);
        }
        
      } catch (startError) {
        console.error(`启动实例 ${instanceId} 进行维护时失败:`, startError.message);
        this.runningMaintenance.delete(instanceId);
      }
      
    } catch (error) {
      console.error(`维护实例 ${instanceId} 时出错:`, error.message);
      this.runningMaintenance.delete(instanceId);
    }
  }

  // 停止维护实例
  async stopMaintenanceInstance(instanceId) {
    try {
      const inst = this.browsers[instanceId];
      if (!inst) {
        this.runningMaintenance.delete(instanceId);
        return;
      }
      
      console.log(`🛑 停止实例维护: ${instanceId}`);
      
      // 检查是否有WebSocket连接
      const hasActiveConnections = inst.wsList && inst.wsList.length > 0;
      
      if (!hasActiveConnections) {
        // 没有活跃连接，安全关闭
        if (inst.browser && !inst.browser.process()?.killed) {
          await inst.browser.close();
        }
        
        inst.online = false;
        inst.lastClosed = new Date().toISOString();
        inst.maintenanceCompleted = new Date().toISOString();
        
        // 更新数据库状态
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
        
        console.log(`✅ 实例 ${instanceId} 维护完成并已关闭`);
      } else {
        // 有活跃连接，保持运行
        console.log(`🔗 实例 ${instanceId} 有活跃连接，维护后保持运行`);
        inst.maintenanceCompleted = new Date().toISOString();
        
        // 更新最后活跃时间但保持在线状态
        this.db.run(
          'UPDATE browsers SET lastActiveTime = ? WHERE id = ?',
          [Date.now(), instanceId],
          (err) => {
            if (err) {
              console.error(`更新实例 ${instanceId} 活跃时间失败:`, err.message);
            }
          }
        );
      }
      
    } catch (error) {
      console.error(`停止维护实例 ${instanceId} 时出错:`, error.message);
    } finally {
      this.runningMaintenance.delete(instanceId);
    }
  }

  // 获取维护统计信息
  getMaintenanceStats() {
    return {
      queueLength: this.maintenanceQueue.length,
      runningMaintenance: Array.from(this.runningMaintenance),
      lastCheck: new Date(this.lastMaintenanceCheck).toISOString(),
      config: {
        checkIntervalMinutes: this.config.checkInterval / 60000,
        inactiveThresholdMinutes: this.config.inactiveThreshold / 60000,
        maintenanceDurationMinutes: this.config.maintenanceDuration / 60000,
        maxConcurrent: this.config.maxConcurrentMaintenance
      }
    };
  }

  // 手动触发维护检查
  async triggerMaintenanceCheck() {
    console.log('🔄 手动触发维护检查');
    await this.checkAndQueueMaintenance();
    return this.getMaintenanceStats();
  }

  // 停止自动维护
  stop() {
    console.log('🛑 停止自动维护管理器');
    // 清空队列
    this.maintenanceQueue = [];
    
    // 停止所有正在维护的实例
    for (const instanceId of this.runningMaintenance) {
      this.stopMaintenanceInstance(instanceId);
    }
  }
}

module.exports = AutoMaintenanceManager;

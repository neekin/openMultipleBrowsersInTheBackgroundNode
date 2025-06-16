// 智能资源管理器
const os = require('os');
const config = require('./config');

class ResourceManager {
  constructor() {
    this.systemInfo = this.getSystemInfo();
    this.instanceResources = new Map();
    this.resourceLimits = this.calculateResourceLimits();
    this.monitoring = false;
    this.monitoringInterval = null;
    this.alerts = [];
  }

  // 获取系统信息
  getSystemInfo() {
    return {
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpuCount: os.cpus().length,
      platform: os.platform(),
      arch: os.arch(),
      loadAverage: os.loadavg()
    };
  }

  // 计算资源限制
  calculateResourceLimits() {
    const totalMemoryGB = this.systemInfo.totalMemory / (1024 * 1024 * 1024);
    const cpuCount = this.systemInfo.cpuCount;

    return {
      maxInstances: Math.min(20, Math.floor(cpuCount * 2)), // 每核心最多2个实例
      memoryPerInstance: Math.floor((totalMemoryGB * 0.8 * 1024) / 10), // 每实例最大内存(MB)
      maxCpuUsage: 80, // 最大CPU使用率
      maxMemoryUsage: 85, // 最大内存使用率
      instanceTimeout: 30 * 60 * 1000, // 实例超时时间(30分钟)
      screenshotMemoryLimit: 50 * 1024 * 1024 // 截图内存限制(50MB)
    };
  }

  // 启动资源监控
  startMonitoring() {
    if (this.monitoring) return;

    this.monitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.checkSystemResources();
      this.optimizeInstances();
      this.cleanupMemory();
    }, 10000); // 每10秒检查一次

    console.log('资源监控已启动', this.resourceLimits);
  }

  // 停止资源监控
  stopMonitoring() {
    if (!this.monitoring) return;

    this.monitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    console.log('资源监控已停止');
  }

  // 检查系统资源
  checkSystemResources() {
    const currentInfo = this.getSystemInfo();
    const memoryUsage = ((currentInfo.totalMemory - currentInfo.freeMemory) / currentInfo.totalMemory) * 100;
    const cpuUsage = currentInfo.loadAverage[0] / currentInfo.cpuCount * 100;

    // 检查资源使用是否超限
    if (memoryUsage > this.resourceLimits.maxMemoryUsage) {
      this.addAlert('high_memory', `内存使用率过高: ${memoryUsage.toFixed(1)}%`);
      this.triggerMemoryOptimization();
    }

    if (cpuUsage > this.resourceLimits.maxCpuUsage) {
      this.addAlert('high_cpu', `CPU使用率过高: ${cpuUsage.toFixed(1)}%`);
      this.triggerCpuOptimization();
    }

    // 更新系统信息
    this.systemInfo = currentInfo;
  }

  // 添加警报
  addAlert(type, message) {
    const alert = {
      type,
      message,
      timestamp: Date.now(),
      level: this.getAlertLevel(type)
    };

    this.alerts.push(alert);

    // 保持警报数量在合理范围内
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-50);
    }

    console.warn(`[资源管理器警报] ${message}`);
  }

  // 获取警报级别
  getAlertLevel(type) {
    const levels = {
      high_memory: 'critical',
      high_cpu: 'critical',
      instance_timeout: 'warning',
      low_performance: 'info'
    };
    return levels[type] || 'info';
  }

  // 触发内存优化
  async triggerMemoryOptimization() {
    console.log('触发内存优化...');

    // 找出内存使用最高的实例
    const sortedInstances = Array.from(this.instanceResources.entries())
      .sort((a, b) => b[1].memoryUsage - a[1].memoryUsage);

    // 优化前3个高内存使用的实例
    for (let i = 0; i < Math.min(3, sortedInstances.length); i++) {
      const [instanceId, resources] = sortedInstances[i];
      await this.optimizeInstanceMemory(instanceId);
    }

    // 强制垃圾回收
    if (global.gc) {
      global.gc();
    }
  }

  // 触发CPU优化
  async triggerCpuOptimization() {
    console.log('触发CPU优化...');

    // 降低截图频率
    config.websocket.screenshotInterval = Math.min(
      config.websocket.screenshotInterval * 1.5,
      2000
    );

    // 增加批处理超时时间
    config.websocket.batchTimeout = Math.min(
      config.websocket.batchTimeout * 1.2,
      200
    );
  }

  // 优化实例内存
  async optimizeInstanceMemory(instanceId) {
    const resources = this.instanceResources.get(instanceId);
    if (!resources) return;

    console.log(`优化实例 ${instanceId} 的内存使用`);

    // 可以在这里实现具体的内存优化策略
    // 例如：清理缓存、减少截图质量等
    if (this.memoryOptimizationCallback) {
      await this.memoryOptimizationCallback(instanceId, resources);
    }
  }

  // 优化所有实例
  optimizeInstances() {
    const now = Date.now();

    for (const [instanceId, resources] of this.instanceResources.entries()) {
      // 检查超时实例
      if (now - resources.lastActivity > this.resourceLimits.instanceTimeout) {
        this.addAlert('instance_timeout', `实例 ${instanceId} 长时间无活动`);
        this.markInstanceForCleanup(instanceId);
      }

      // 检查性能问题
      if (resources.averageResponseTime > 1000) {
        this.addAlert('low_performance', `实例 ${instanceId} 响应时间过长`);
        this.optimizeInstancePerformance(instanceId);
      }
    }
  }

  // 标记实例需要清理
  markInstanceForCleanup(instanceId) {
    const resources = this.instanceResources.get(instanceId);
    if (resources) {
      resources.needsCleanup = true;
    }
  }

  // 优化实例性能
  async optimizeInstancePerformance(instanceId) {
    const resources = this.instanceResources.get(instanceId);
    if (!resources) return;

    // 动态调整配置
    resources.optimizedConfig = {
      screenshotInterval: Math.max(
        config.websocket.screenshotInterval * 1.5,
        500
      ),
      screenshotQuality: Math.max(
        config.browser.screenshotOptions.quality - 10,
        20
      )
    };

    console.log(`为实例 ${instanceId} 应用性能优化配置`);
  }

  // 清理内存
  cleanupMemory() {
    // 清理过期的警报
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.alerts = this.alerts.filter(alert => alert.timestamp > oneHourAgo);

    // 清理标记为需要清理的实例
    for (const [instanceId, resources] of this.instanceResources.entries()) {
      if (resources.needsCleanup) {
        this.cleanupInstance(instanceId);
      }
    }
  }

  // 记录实例资源使用
  recordInstanceUsage(instanceId, usage) {
    let resources = this.instanceResources.get(instanceId);
    
    if (!resources) {
      resources = {
        memoryUsage: 0,
        cpuUsage: 0,
        screenshotCount: 0,
        operationCount: 0,
        averageResponseTime: 0,
        lastActivity: Date.now(),
        createdAt: Date.now(),
        needsCleanup: false,
        optimizedConfig: null
      };
      this.instanceResources.set(instanceId, resources);
    }

    // 更新资源使用情况
    Object.assign(resources, usage);
    resources.lastActivity = Date.now();

    // 检查是否超过限制
    if (resources.memoryUsage > this.resourceLimits.memoryPerInstance) {
      this.addAlert('high_memory', `实例 ${instanceId} 内存使用过高: ${resources.memoryUsage}MB`);
    }
  }

  // 检查是否可以创建新实例
  canCreateInstance() {
    const currentInstances = this.instanceResources.size;
    const memoryUsage = ((this.systemInfo.totalMemory - this.systemInfo.freeMemory) / this.systemInfo.totalMemory) * 100;

    if (currentInstances >= this.resourceLimits.maxInstances) {
      return { allowed: false, reason: `实例数量已达上限 (${this.resourceLimits.maxInstances})` };
    }

    if (memoryUsage > this.resourceLimits.maxMemoryUsage) {
      return { allowed: false, reason: `系统内存使用率过高 (${memoryUsage.toFixed(1)}%)` };
    }

    return { allowed: true };
  }

  // 获取实例的优化配置
  getInstanceOptimizedConfig(instanceId) {
    const resources = this.instanceResources.get(instanceId);
    return resources?.optimizedConfig || null;
  }

  // 获取资源统计
  getResourceStats() {
    const currentInfo = this.getSystemInfo();
    const memoryUsage = ((currentInfo.totalMemory - currentInfo.freeMemory) / currentInfo.totalMemory) * 100;
    const cpuUsage = currentInfo.loadAverage[0] / currentInfo.cpuCount * 100;

    let totalMemoryByInstances = 0;
    let totalOperations = 0;
    let totalScreenshots = 0;

    for (const resources of this.instanceResources.values()) {
      totalMemoryByInstances += resources.memoryUsage || 0;
      totalOperations += resources.operationCount || 0;
      totalScreenshots += resources.screenshotCount || 0;
    }

    return {
      system: {
        memoryUsage: memoryUsage.toFixed(1),
        cpuUsage: cpuUsage.toFixed(1),
        freeMemoryGB: (currentInfo.freeMemory / (1024 * 1024 * 1024)).toFixed(2),
        totalMemoryGB: (currentInfo.totalMemory / (1024 * 1024 * 1024)).toFixed(2)
      },
      instances: {
        count: this.instanceResources.size,
        maxAllowed: this.resourceLimits.maxInstances,
        totalMemoryMB: totalMemoryByInstances,
        totalOperations,
        totalScreenshots
      },
      alerts: {
        total: this.alerts.length,
        critical: this.alerts.filter(a => a.level === 'critical').length,
        recent: this.alerts.filter(a => Date.now() - a.timestamp < 300000).length // 5分钟内
      }
    };
  }

  // 获取实例详细信息
  getInstanceDetails(instanceId) {
    return this.instanceResources.get(instanceId) || null;
  }

  // 清理实例
  cleanupInstance(instanceId) {
    this.instanceResources.delete(instanceId);
    console.log(`已清理实例 ${instanceId} 的资源记录`);
  }

  // 设置内存优化回调
  setMemoryOptimizationCallback(callback) {
    this.memoryOptimizationCallback = callback;
  }

  // 获取系统建议
  getSystemRecommendations() {
    const stats = this.getResourceStats();
    const recommendations = [];

    if (parseFloat(stats.system.memoryUsage) > 80) {
      recommendations.push({
        type: 'memory',
        level: 'high',
        message: '系统内存使用率过高，建议关闭一些实例或增加系统内存'
      });
    }

    if (parseFloat(stats.system.cpuUsage) > 70) {
      recommendations.push({
        type: 'cpu',
        level: 'high',
        message: 'CPU使用率过高，建议降低截图频率或减少并发操作'
      });
    }

    if (stats.instances.count > stats.instances.maxAllowed * 0.8) {
      recommendations.push({
        type: 'instances',
        level: 'medium',
        message: '实例数量接近上限，建议清理不活跃的实例'
      });
    }

    return recommendations;
  }
}

// 单例模式
const resourceManager = new ResourceManager();

module.exports = resourceManager;

// 高级操作缓存和预加载系统
const config = require('./config');

class AdvancedOperationManager {
  constructor() {
    this.operationCache = new Map(); // 操作缓存
    this.preloadCache = new Map();   // 预加载缓存
    this.operationHistory = new Map(); // 操作历史
    this.predictiveModel = new Map(); // 预测模型
  }

  // 初始化实例的操作管理器
  initInstance(instanceId) {
    this.operationCache.set(instanceId, {
      pending: [],
      executing: false,
      lastOperation: null,
      operationCount: 0,
      patterns: new Map()
    });
    
    this.operationHistory.set(instanceId, []);
    this.predictiveModel.set(instanceId, {
      commonSequences: new Map(),
      frequentUrls: new Map(),
      typingPatterns: new Map()
    });
  }

  // 添加操作到缓存
  addOperation(instanceId, operation) {
    const cache = this.operationCache.get(instanceId);
    if (!cache) {
      this.initInstance(instanceId);
      return this.addOperation(instanceId, operation);
    }

    // 添加时间戳和序列号
    operation.timestamp = Date.now();
    operation.sequence = cache.operationCount++;

    // 智能合并相似操作
    const merged = this.tryMergeOperation(cache.pending, operation);
    if (!merged) {
      cache.pending.push(operation);
    }

    // 学习操作模式
    this.learnOperationPattern(instanceId, operation);

    // 触发执行
    this.scheduleExecution(instanceId);
  }

  // 尝试合并相似操作
  tryMergeOperation(pending, newOp) {
    if (pending.length === 0) return false;

    const lastOp = pending[pending.length - 1];
    
    // 合并连续的鼠标移动
    if (newOp.type === 'mousemove' && lastOp.type === 'mousemove') {
      if (Date.now() - lastOp.timestamp < 50) { // 50ms内的鼠标移动合并
        lastOp.payload.x = newOp.payload.x;
        lastOp.payload.y = newOp.payload.y;
        lastOp.timestamp = newOp.timestamp;
        return true;
      }
    }

    // 合并连续的滚轮操作
    if (newOp.type === 'wheel' && lastOp.type === 'wheel') {
      if (Date.now() - lastOp.timestamp < 100) {
        lastOp.payload.deltaX += newOp.payload.deltaX;
        lastOp.payload.deltaY += newOp.payload.deltaY;
        lastOp.timestamp = newOp.timestamp;
        return true;
      }
    }

    return false;
  }

  // 学习操作模式
  learnOperationPattern(instanceId, operation) {
    const model = this.predictiveModel.get(instanceId);
    const history = this.operationHistory.get(instanceId);
    
    // 记录操作历史
    history.push({
      type: operation.type,
      timestamp: operation.timestamp,
      payload: operation.payload
    });

    // 保持历史记录在合理范围内
    if (history.length > 1000) {
      history.splice(0, 100); // 删除最老的100条记录
    }

    // 分析操作序列
    if (history.length >= 3) {
      const sequence = history.slice(-3).map(op => op.type).join('-');
      const count = model.commonSequences.get(sequence) || 0;
      model.commonSequences.set(sequence, count + 1);
    }

    // 学习输入模式
    if (operation.type === 'keydown') {
      const pattern = model.typingPatterns.get(operation.payload.key) || 0;
      model.typingPatterns.set(operation.payload.key, pattern + 1);
    }
  }

  // 预测下一个操作
  predictNextOperation(instanceId) {
    const model = this.predictiveModel.get(instanceId);
    const history = this.operationHistory.get(instanceId);
    
    if (!model || !history || history.length < 2) return null;

    const recentOps = history.slice(-2).map(op => op.type).join('-');
    
    // 查找最常见的下一步操作
    let bestPrediction = null;
    let maxCount = 0;
    
    for (const [sequence, count] of model.commonSequences.entries()) {
      if (sequence.startsWith(recentOps) && count > maxCount) {
        const nextOp = sequence.split('-').pop();
        if (nextOp !== recentOps.split('-').pop()) {
          bestPrediction = nextOp;
          maxCount = count;
        }
      }
    }

    return bestPrediction;
  }

  // 调度执行
  async scheduleExecution(instanceId) {
    const cache = this.operationCache.get(instanceId);
    if (!cache || cache.executing || cache.pending.length === 0) return;

    cache.executing = true;

    try {
      // 批量执行操作
      const opsToExecute = [...cache.pending];
      cache.pending = [];

      await this.executeBatch(instanceId, opsToExecute);
    } catch (error) {
      console.error(`批量执行操作失败 (${instanceId}):`, error);
    } finally {
      cache.executing = false;
      
      // 如果还有待处理操作，继续执行
      if (cache.pending.length > 0) {
        setTimeout(() => this.scheduleExecution(instanceId), 10);
      }
    }
  }

  // 执行批量操作
  async executeBatch(instanceId, operations) {
    // 这里应该由调用者实现具体的执行逻辑
    // 我们提供一个回调机制
    if (this.executionCallback) {
      await this.executionCallback(instanceId, operations);
    }
  }

  // 设置执行回调
  setExecutionCallback(callback) {
    this.executionCallback = callback;
  }

  // 预加载常用资源
  async preloadResources(instanceId, page) {
    const model = this.predictiveModel.get(instanceId);
    if (!model) return;

    // 预加载常访问的 URL
    const topUrls = Array.from(model.frequentUrls.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([url]) => url);

    for (const url of topUrls) {
      try {
        // 在隐藏的iframe中预加载
        await page.evaluate((preloadUrl) => {
          const iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          iframe.src = preloadUrl;
          document.body.appendChild(iframe);
          
          // 5秒后清理
          setTimeout(() => {
            if (iframe.parentNode) {
              iframe.parentNode.removeChild(iframe);
            }
          }, 5000);
        }, url);
      } catch (error) {
        // 预加载失败不影响主功能
        console.log(`预加载 ${url} 失败:`, error.message);
      }
    }
  }

  // 获取实例统计信息
  getInstanceStats(instanceId) {
    const cache = this.operationCache.get(instanceId);
    const model = this.predictiveModel.get(instanceId);
    const history = this.operationHistory.get(instanceId);

    if (!cache || !model || !history) return null;

    return {
      operationCount: cache.operationCount,
      pendingOperations: cache.pending.length,
      isExecuting: cache.executing,
      historyLength: history.length,
      commonSequences: model.commonSequences.size,
      predictiveAccuracy: this.calculatePredictiveAccuracy(instanceId)
    };
  }

  // 计算预测准确率
  calculatePredictiveAccuracy(instanceId) {
    const history = this.operationHistory.get(instanceId);
    if (!history || history.length < 10) return 0;

    let correctPredictions = 0;
    let totalPredictions = 0;

    // 简单的准确率计算
    for (let i = 3; i < history.length - 1; i++) {
      const context = history.slice(i-2, i).map(op => op.type).join('-');
      const actual = history[i].type;
      
      // 模拟预测
      const predicted = this.simulatePredict(instanceId, context);
      if (predicted) {
        totalPredictions++;
        if (predicted === actual) {
          correctPredictions++;
        }
      }
    }

    return totalPredictions > 0 ? (correctPredictions / totalPredictions) : 0;
  }

  // 模拟预测（用于计算准确率）
  simulatePredict(instanceId, context) {
    const model = this.predictiveModel.get(instanceId);
    if (!model) return null;

    let bestPrediction = null;
    let maxCount = 0;

    for (const [sequence, count] of model.commonSequences.entries()) {
      if (sequence.startsWith(context) && count > maxCount) {
        const nextOp = sequence.split('-').pop();
        if (nextOp !== context.split('-').pop()) {
          bestPrediction = nextOp;
          maxCount = count;
        }
      }
    }

    return bestPrediction;
  }

  // 清理实例数据
  cleanupInstance(instanceId) {
    this.operationCache.delete(instanceId);
    this.preloadCache.delete(instanceId);
    this.operationHistory.delete(instanceId);
    this.predictiveModel.delete(instanceId);
  }

  // 获取全局统计
  getGlobalStats() {
    let totalOperations = 0;
    let totalPending = 0;
    let executingInstances = 0;

    for (const cache of this.operationCache.values()) {
      totalOperations += cache.operationCount;
      totalPending += cache.pending.length;
      if (cache.executing) executingInstances++;
    }

    return {
      activeInstances: this.operationCache.size,
      totalOperations,
      totalPending,
      executingInstances,
      cacheHitRate: this.calculateGlobalCacheHitRate()
    };
  }

  // 计算全局缓存命中率
  calculateGlobalCacheHitRate() {
    // 这里可以添加更复杂的缓存命中率计算逻辑
    return 0.85; // 示例值
  }
}

// 单例模式
const advancedOperationManager = new AdvancedOperationManager();

module.exports = advancedOperationManager;

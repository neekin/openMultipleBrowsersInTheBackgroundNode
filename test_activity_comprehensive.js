const WebSocket = require('ws');

async function testActiveTimeTracking() {
  console.log('🧪 开始测试 WebSocket 活跃时间记录功能');
  
  // 获取实例列表
  const response = await fetch('http://localhost:3000/api/browsers/');
  const instances = await response.json();
  
  console.log(`📋 发现 ${instances.length} 个实例`);
  instances.forEach((inst, idx) => {
    console.log(`  ${idx + 1}. ${inst.id.substr(0, 8)}... (lastActiveTime: ${inst.lastActiveTime})`);
  });
  
  if (instances.length === 0) {
    console.log('❌ 没有可用的实例进行测试');
    return;
  }
  
  // 选择第一个实例进行测试
  const testInstance = instances[0];
  const wsUrl = `ws://localhost:3000/browsers/ws/operate/${testInstance.id}`;
  
  console.log(`\n🔌 连接到实例: ${testInstance.id.substr(0, 8)}...`);
  console.log(`📡 WebSocket URL: ${wsUrl}`);
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let messageCount = 0;
    
    ws.on('open', function open() {
      console.log('✅ WebSocket 连接已建立');
      
      // 发送多个操作来测试消息处理时的活跃时间更新
      const operations = [
        { type: 'mousemove', payload: { x: 100, y: 100 } },
        { type: 'click', payload: { x: 150, y: 150 } },
        { type: 'mousemove', payload: { x: 200, y: 200 } },
        { type: 'keydown', payload: { key: 'Enter' } },
        { type: 'keyup', payload: { key: 'Enter' } }
      ];
      
      operations.forEach((op, idx) => {
        setTimeout(() => {
          console.log(`📤 发送操作 ${idx + 1}/${operations.length}: ${op.type}`);
          ws.send(JSON.stringify(op));
        }, idx * 200);
      });
      
      // 延迟关闭连接
      setTimeout(() => {
        console.log('🔌 关闭 WebSocket 连接');
        ws.close();
      }, 2000);
    });
    
    ws.on('message', function message(data) {
      messageCount++;
      const preview = data.toString().substring(0, 50);
      console.log(`📥 收到消息 #${messageCount}: ${preview}${data.length > 50 ? '...' : ''}`);
    });
    
    ws.on('close', function close() {
      console.log('✅ WebSocket 连接已关闭');
      console.log(`📊 总共收到 ${messageCount} 条消息`);
      resolve();
    });
    
    ws.on('error', function error(err) {
      console.error('❌ WebSocket 错误:', err.message);
      reject(err);
    });
  });
}

async function checkActivityUpdate() {
  console.log('\n🔍 检查活跃时间更新...');
  
  const response = await fetch('http://localhost:3000/api/browsers/');
  const instances = await response.json();
  
  instances.forEach((inst, idx) => {
    const timeStr = inst.lastActiveTime ? 
      `${new Date(inst.lastActiveTime).toLocaleString()} (${Date.now() - inst.lastActiveTime}ms ago)` : 
      'null';
    console.log(`  ${idx + 1}. ${inst.id.substr(0, 8)}... - ${timeStr}`);
  });
}

async function main() {
  try {
    await testActiveTimeTracking();
    await new Promise(resolve => setTimeout(resolve, 1000)); // 等待数据库更新
    await checkActivityUpdate();
    console.log('\n✅ 测试完成！');
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

main();

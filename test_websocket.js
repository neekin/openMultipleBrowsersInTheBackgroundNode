const WebSocket = require('ws');

// 从实例列表中选择第三个实例进行测试  
const instanceId = 'c62a73da-7771-4ed1-9786-b7cc0db4358e';
const wsUrl = `ws://localhost:3000/browsers/ws/operate/${instanceId}`;

console.log(`连接到实例: ${instanceId}`);
console.log(`WebSocket URL: ${wsUrl}`);

const ws = new WebSocket(wsUrl);

ws.on('open', function open() {
  console.log('WebSocket 连接已建立');
  console.log('正在发送测试消息...');
  
  // 发送一个鼠标移动操作
  const mouseMove = { 
    type: 'mousemove', 
    payload: { x: 100, y: 100 } 
  };
  console.log('发送鼠标移动:', JSON.stringify(mouseMove));
  ws.send(JSON.stringify(mouseMove));
  
  // 延迟1秒后发送点击操作
  setTimeout(() => {
    const click = { 
      type: 'click', 
      payload: { x: 150, y: 150 } 
    };
    console.log('发送点击操作:', JSON.stringify(click));
    ws.send(JSON.stringify(click));
  }, 1000);
  
  // 延迟2秒后关闭连接
  setTimeout(() => {
    console.log('关闭 WebSocket 连接');
    ws.close();
  }, 2000);
});

ws.on('message', function message(data) {
  console.log('收到消息:', data.toString());
});

ws.on('close', function close() {
  console.log('WebSocket 连接已关闭');
});

ws.on('error', function error(err) {
  console.error('WebSocket 错误:', err.message);
});

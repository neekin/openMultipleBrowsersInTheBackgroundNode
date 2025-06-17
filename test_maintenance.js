// 测试脚本：关闭浏览器但保留数据库记录
const http = require('http');

// 获取实例状态
http.get('http://localhost:3000/api/browsers/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const instances = JSON.parse(data);
    const testInstance = instances.find(inst => inst.id === 'ed331586-e41a-4e83-b32e-47ec03c7ea3a');
    if (testInstance) {
      console.log('测试实例状态:', testInstance);
      console.log(`实例 ${testInstance.id} 当前状态: ${testInstance.online ? '在线' : '离线'}`);
      if (testInstance.lastActiveTime) {
        const timeDiff = Date.now() - testInstance.lastActiveTime;
        console.log(`最后活跃时间: ${Math.round(timeDiff/1000/60*10)/10} 分钟前`);
      }
    } else {
      console.log('未找到测试实例');
    }
  });
}).on('error', err => {
  console.error('Error:', err);
});

// 模拟关闭浏览器进程（通过进程信号）
setTimeout(() => {
  console.log('\n尝试触发维护检查...');
  
  const postData = JSON.stringify({});
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/browsers/maintenance/trigger',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('维护触发结果:', JSON.parse(data));
    });
  });
  
  req.on('error', err => {
    console.error('Request error:', err);
  });
  
  req.write(postData);
  req.end();
}, 2000);

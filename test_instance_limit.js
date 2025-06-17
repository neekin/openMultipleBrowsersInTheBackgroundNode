// 测试实例限制功能
const http = require('http');

async function createInstance() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({});
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/browsers/create',
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
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function getInstances() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000/api/browsers/', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  try {
    console.log('🧪 测试实例限制功能');
    
    // 获取当前实例
    let instances = await getInstances();
    console.log(`📊 当前实例数: ${instances.length}`);
    
    // 显示实例状态
    instances.forEach((inst, i) => {
      const status = inst.online ? '在线' : '离线';
      console.log(`  ${i+1}. ${inst.id.substr(0, 8)} - ${status}`);
    });
    
    console.log('\n🔧 创建新实例测试限制...');
    
    // 创建新实例
    const newInstance = await createInstance();
    console.log(`✅ 新实例创建成功: ${newInstance.id.substr(0, 8)}`);
    
    // 再次获取实例
    await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒
    instances = await getInstances();
    console.log(`📊 创建后实例数: ${instances.length}`);
    
    // 显示最新状态
    instances.forEach((inst, i) => {
      const status = inst.online ? '在线' : '离线';
      console.log(`  ${i+1}. ${inst.id.substr(0, 8)} - ${status} - ${inst.createdAt}`);
    });
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

main();

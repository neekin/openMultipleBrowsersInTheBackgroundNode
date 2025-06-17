#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 测试数据库online字段
const dbPath = path.join(__dirname, 'browsers.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 检查数据库表结构和online字段...');

// 查看表结构
db.all("PRAGMA table_info(browsers)", (err, rows) => {
  if (err) {
    console.error('❌ 查询表结构失败:', err.message);
    return;
  }
  
  console.log('📋 表结构:');
  rows.forEach(row => {
    console.log(`  - ${row.name}: ${row.type} (默认: ${row.dflt_value}, 非空: ${row.notnull})`);
  });
  
  const hasOnlineColumn = rows.some(row => row.name === 'online');
  console.log(`\n✅ online字段存在: ${hasOnlineColumn}`);
  
  if (hasOnlineColumn) {
    // 查询所有实例的在线状态
    db.all("SELECT id, online, lastActiveTime FROM browsers", (err, instances) => {
      if (err) {
        console.error('❌ 查询实例状态失败:', err.message);
        return;
      }
      
      console.log(`\n📊 当前实例状态 (共${instances.length}个):`);
      instances.forEach(inst => {
        const status = inst.online == 1 ? '🟢在线' : '🔴离线';
        const lastActive = inst.lastActiveTime ? 
          new Date(parseInt(inst.lastActiveTime)).toISOString() : '未知';
        console.log(`  ${inst.id.substr(0, 8)}: ${status}, 最后活跃: ${lastActive}`);
      });
    });
  }
  
  db.close();
});

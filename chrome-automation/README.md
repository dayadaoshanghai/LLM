# GLM Coding Plan Pro 年费抢购指南

## 抢购信息

- **抢购时间**: 2026年5月10日 上午10:00（北京时间）
- **目标套餐**: Pro 连续包年（8折优惠）
- **价格**: 约 ¥1430/年（原¥1788）
- **库存**: 暂时售罄，10:00 补货

## 抢购脚本

### 文件位置
`/Users/johnson/LLM/chrome-automation/auto-purchase.js`

### 运行命令
```bash
cd /Users/johnson/LLM/chrome-automation && node auto-purchase.js
```

### 脚本自动执行流程
1. 使用 Cookie 登录 bigmodel.cn
2. 10:00 整点刷新页面
3. 点击"即刻订阅"
4. 选择"继续订阅"（如有老用户弹窗）
5. 选择 **Pro 套餐** → **连续包年**
6. 进入付款页面后暂停，**手动完成付款**

## 抢购前检查清单

### 1. 检查 Cookie 是否有效
```bash
cd /Users/johnson/LLM/chrome-automation && node -e "
const fs = require('fs');
const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
console.log('Cookie数量:', cookies.length);
console.log('过期时间:', new Date(cookies[0].expirationDate * 1000));
"
```

### 2. 手动测试流程（非抢购时间）
建议9:50先运行一次，确认：
- Cookie 有效
- 页面能正常打开
- 套餐选项可见

### 3. 明天（5月10日）操作步骤

| 时间 | 操作 |
|------|------|
| 9:50 | 检查 Cookie 有效性，运行测试 |
| 9:55 | 关闭测试窗口，保持准备状态 |
| 9:59 | 运行 `node auto-purchase.js` |
| 10:00 | 脚本自动抢购，进入付款页面 |
| 10:00+ | 手动完成付款 |

## 注意事项

### Cookie 过期处理
Cookie 有效期约30天，如果明天发现 Cookie 失效：
1. 在 Chrome 中登录 https://bigmodel.cn
2. 使用 EditThisCookie 扩展导出 Cookie
3. 保存到 `/Users/johnson/LLM/chrome-automation/cookies.json`
4. 重新运行抢购脚本

### 抢购成功标志
- 页面跳转到付款页面
- 显示 Pro 连续包年套餐详情
- 浏览器保持打开状态

### 抢购失败处理
如果提示"暂时售罄"：
- 系统可能分批放货
- 可以尝试刷新重试
- 或者等待下一批补货通知

## 文件清单

| 文件 | 说明 |
|------|------|
| `auto-purchase.js` | 自动抢购脚本 |
| `cookies.json` | 登录凭证 |
| `README.md` | 本操作指南 |

## 联系方式

如有问题，检查：
1. Cookie 是否在有效期内
2. 网络连接是否正常
3. 页面是否有验证码/安全验证
# Time Focus

一个简洁的在线番茄钟，集成任务管理、专注统计、浏览器通知和网易云音乐播放功能。

## 功能

- 专注、短休息和长休息三种计时模式
- 自定义倒计时时长
- 标准番茄工作法自动循环
- 任务新增、选择、完成和删除
- 今日及本周专注次数统计
- 浏览器通知和提示音
- 网易云音乐扫码登录、歌单、搜索和播放
- 本地保存计时、任务和统计数据

## 技术栈

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Express
- NeteaseCloudMusicApi

## 本地开发

需要安装 Node.js 20.19 或更高版本（也支持 Node.js 22.12 及更高版本）。

```bash
git clone https://github.com/wdyjko/time-focus.git
cd time-focus
npm install
npm run dev:full
```

启动后访问 [http://localhost:5173](http://localhost:5173)。前端开发服务器会把 `/api` 请求代理到运行在 `http://localhost:3000` 的音乐服务。

也可以分别启动前后端：

```bash
npm run dev
npm run server
```

## 构建

```bash
npm run build
npm run preview
```

构建产物位于 `dist` 目录。

## 环境变量

复制 `.env.example` 为 `.env.local`，按需填写音乐服务地址：

```env
VITE_API_BASE_URL=https://your-music-api.example.com
```

音乐后端支持以下环境变量：

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `PORT` | 后端监听端口 | `3000` |
| `CORS_ALLOW_ORIGIN` | 允许访问音乐 API 的前端来源 | `http://localhost:5173` |

## 部署

### 前端部署到 Vercel

1. 在 Vercel 中导入本 GitHub 仓库。
2. Framework Preset 选择 `Vite`。
3. Build Command 使用 `npm run build`。
4. Output Directory 使用 `dist`。
5. 如果启用音乐功能，在 Vercel 添加 `VITE_API_BASE_URL` 环境变量并重新部署。

仓库中的 `vercel.json` 已包含所需的构建配置。

### 部署音乐后端

音乐功能依赖 `server/index.cjs` 中的常驻 Express 服务，建议部署到 Render、Railway 或其他支持 Node.js 常驻进程的平台：

```text
Build Command: npm install
Start Command: npm start
```

将后端环境变量 `CORS_ALLOW_ORIGIN` 设置为实际的 Vercel 站点地址，例如：

```env
CORS_ALLOW_ORIGIN=https://time-focus.vercel.app
```

然后将后端公开地址填写到 Vercel 的 `VITE_API_BASE_URL` 中。

> 当前音乐登录会话存储在服务进程内存中。服务重启后登录状态会失效；如果用于多人或长期运行，建议改用 Redis 等持久化存储。

## 数据说明

番茄钟状态、任务和完成记录保存在浏览器的 `localStorage` 中，不会自动同步到其他设备。清除浏览器站点数据后，这些记录也会被删除。

## 许可

本项目暂未指定开源许可证。

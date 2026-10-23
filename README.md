# 同频 · 私密共享观影（GitHub Pages）

> 仅支持 HTTPS MP4/WebM 等浏览器可直接播放的视频直链。GitHub Pages 只托管静态网页，Firebase 仅同步 AES-GCM 密文。无需自购服务器，但仍依赖 Google 的托管服务。

## 安全边界（务必阅读）

- 房间密钥为浏览器本地生成的 256 位随机 AES-GCM 密钥，保存在完整邀请网址的 `#` 片段中。视频 URL、聊天、播放状态先加密再发往 Firebase。常规 HTTP 请求不会携带 URL fragment。
- **视频源服务器可以看到视频请求、请求者 IP、资源路径等；它本就托管视频。** 不能保证对所有第三方隐藏“观看的视频内容”。设备、浏览器扩展、泄露的邀请链接、聊天截图也可能暴露内容。
- 视频 URL 只要被分享到其他聊天软件，就可能被该软件扫描或预览；完整邀请链接也可能被接收软件处理，因此请选择可信渠道分享，切勿发公开论坛。
- GitHub Pages 对静态代码是公开的，`firebase-config.js` 的 Firebase Web app 设置不是秘密；**不需要在该文件写任何管理员密钥、私密 token。**
- Firebase 可看见连接元信息、房间 ID、密文长度、写入时间，匿名身份，不保证隐藏两个人是否同在一个房间。
- 当前数据库规则允许任意完成匿名登录的人访问已知房间 ID 的密文，但不知道密钥时不能解密。请保护完整邀请链接。具有密钥的受邀者也能更换视频、同步播放。
- **聊天密文目前不会自动过期清除**；请在 Firebase 控制台删除 `rooms` 下旧记录。建议仅用于小范围可信朋友，不要宣传绝对安全。规则不支持客户端删除，避免任何获知房间 ID 的用户删除消息。
- 音视频不会转发/储存在 Firebase，不上传到 GitHub。播放器会直接向视频源发网络请求。
- 源站需允许访问，并支持手机浏览器播放；部分服务防盗链、限制 CORS/跨源访问、登录、DRM 等会导致失败。
- 网络浏览器会限制自动播放，需要两人各手动点击一次。播放进度基于客户端时间校准，不能保证逐帧同步。
- 项目未经独立安全审计，不适合绝对保密需求。

## 部署步骤

1. 访问 https://console.firebase.google.com/ 创建项目，选择 **Spark 免费**。
2. 在 **项目设置 -> 你的应用 -> Web** 添加网页应用，复制 `firebaseConfig`，替换 `firebase-config.js` 中的占位符，尤其核对 `databaseURL`。
3. 在 **构建 -> Authentication -> 登录方法** 启用 **匿名登录**。根据界面需要，将 `<GitHub用户名>.github.io` 加入 **Authentication -> Settings -> Authorized domains**。
4. 在 **构建 -> Realtime Database** 创建数据库（不要开放测试模式），进入 **规则**，复制 `database.rules.json` **里面的完整 JSON** 到规则编辑器并发布。注意不是把 JSON 文件上传数据库。
5. GitHub 新建 **Public** 仓库（如 `private-watch`）。把 `index.html`, `style.css`, `app.js`, `firebase-config.js`, `.nojekyll` 及 `README.md` 上传到仓库根目录。规则文件可一并上传，仅供参考。
6. 仓库 **Settings -> Pages -> Build and deployment -> Deploy from a branch -> main / (root) -> Save**。稍后访问 `https://<用户名>.github.io/private-watch/`。
7. 第一部手机输入 HTTPS 视频直链，点击 **创建加密房间**，然后复制浏览器里的 **完整邀请链接** 给第二部手机。第二部手机点 **加入私密房间**，若自动播放被阻止请手动点击播放。
8. 建议先使用你自己拥有权限的可公开播放的视频 URL 测试，并在两台手机上确认画面、快进、暂停、聊天。

## 若要更强隐私

需要把对原视频源的暴露也排除，必须改变视频分发架构：例如两人本地都有相同视频文件（各自本地加载），或自行控制可信的视频服务器。即使经过代理，也只会改变谁能看到请求，不能宣称没人知道。

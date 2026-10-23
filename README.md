同频 · 多来源兼容升级版
基于先前同频加密房间版本。支持 HTTPS MP4/WebM、允许跨域的 HLS M3U8、B站官方嵌入播放器与一般视频网页外部协同模式。
更新 GitHub（重要）
不要覆盖现有仓库里已正确配置的 `firebase-config.js`：此压缩包只包含 `index.html`、`app.js`、`style.css`、`README.md`。你的 Firebase 配置维持不变。
在 GitHub `private-watch` 仓库首页选择 `Add file → Upload files`，上传压缩包解压后的四个文件。
对于同名文件选择覆盖并 `Commit changes`。如网页不支持一次性覆盖，可分别在四个文件中点编辑、粘贴替换内容并提交，或通过 GitHub Desktop 推送。
GitHub Pages 发布后刷新浏览器；可用无痕窗口避免旧缓存。
各类链接支持情况
MP4/WebM：视频源允许 HTTPS 跨站访问、Range 请求及格式被浏览器支持时自动同步。
M3U8：Safari 原生播放；其他支持 MSE 的浏览器通过 hls.js 加载；受 CORS、鉴权、失效地址、DRM 等限制。
B站 BV 视频页面：尝试 B站官方 iframe；无法保证远程暂停/快进自动同步，使用共享时间点和聊天手动配合。
LiTV、腾讯视频、爱奇艺、其他网页：外部协同模式，双方在视频网站各自观看，使用加密聊天室、共享时间点和倒计时，无法强制嵌入或远程控制第三方网站。
`b23.tv` 短网址暂不自动解析，需要使用完整 BV 页面地址。
隐私说明
视频网址、聊天、状态经 WebCrypto AES-GCM 在浏览器加密后交给 Firebase，解密密钥仅存在邀请链接 `#` 部分。请勿公开完整邀请链接。Firebase 仍可能观察房间 ID、请求时间、用量以及连接元数据；视频源网站仍可知道你访问的视频。B站 iframe 加载后会访问 B站播放器；使用 CDN 加载 hls.js 会向 jsDelivr 请求脚本。无需启用 Analytics。未进行独立安全审计。
其他
为维持与旧房间协议兼容，存储状态格式保持 `{url,position,playing,at,by}`，不需要修改现有 `database.rules.json`。共享时间点没有单独历史记录。倒计时以聊天消息提示，双方各自点击同步按钮，并非精确同步计时器。建议两人以视频直链模式优先。

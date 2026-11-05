<div align="center">

# HGhub

**黄果短剧第三方客户端 · Rust + Tauri 2**

Windows / macOS / Android / iOS 四端 · Fluent 设计 · 沉浸式竖屏播放

</div>

> ⚠️ 本项目仅供 **学习与技术交流**，不提供、不存储、不分发任何音视频内容。
> 所有内容均来自第三方站点，版权归原作者与上游站点所有。

**使用须知**

- **以访客身份正常使用**：像普通访客一样浏览就好，请勿滥用本项目。
- **不要给上游增加压力**：本项目本身不提供下载功能，请勿改动代码去做批量下载 / 批量抓取，也不要高频轮询、并发轰炸接口或挂机刷播放量；内置的封面与播放列表缓存请不要改小或关掉。
- **尊重上游版权**：不要去除水印与站点标识，不要把剧集搬运、转码、修改后二次分发到别处（网盘、资源站、其他 App 等），更不能改完拿出去出售。
- **不要公开传播接口与直链**：接口地址、播放直链、解密方式请勿公开张贴或打包成「资源站」——上游一旦封禁，所有人都没法再用。
- **不要商业化**：禁止打包出售、接入广告 / 会员 / 付费点播，或作为收费服务的一部分分发（详见 [LICENSE](LICENSE)）。
- **合理使用**：仅供个人学习、研究与自用；请在 24 小时内删除相关资源，并支持正版。
- **遵守当地法律**：使用者应自行判断并承担合规责任。

> ⚖️ 许可证自 v1.1.0 版本起改为 **PolyForm Noncommercial 1.0.0**：**禁止任何商业用途**——
> 包括打包出售、接入付费/会员/广告变现、作为收费产品或服务的一部分分发。
> 个人学习、研究、自用与非营利使用不受限制，详见 [LICENSE](LICENSE)。


## 官方渠道与仿冒提醒

- **唯一官方仓库**：[github.com/Minireel/HGhub](https://github.com/Minireel/HGhub)
- **唯一下载渠道**：[GitHub Releases](https://github.com/Minireel/HGhub/releases)。仓库源码页不放任何可执行文件，
  其余网站、网盘、QQ 群、公众号、第三方下载站分发的「HGhub」安装包**一律非官方**，作者不保证其安全性与完整性。

> 🚫 **已发现的恶意修改版**：[`hichuv/HGhub`](https://github.com/hichuv/HGhub)
>
> 该仓库与本项目无关，是在旧版本源码基础上擅自加入**卡密验证、VIP 付费解锁**等变现功能的修改版，
> 代码改动不透明、安全性无法验证。**请勿下载、勿注册、勿付费**；如已安装，建议立即卸载，改用官方 Release 包安装。
>
> 本项目**从未、也不会**加入任何卡密 / VIP / 付费解锁 / 广告功能。如果你遇到的「HGhub」要求输入卡密或付费开通，那一定不是官方版本。


## 技术栈

| 层 | 选型 |
| --- | --- |
| 壳 | Tauri 2（Rust 1.9x） |
| 前端 | React 19 + TypeScript + Vite 7 + Tailwind CSS 4 |
| 播放 | hls.js（HLS / AES-128） |
| 网络 | reqwest + rustls |

## 目录

```
.
├─ src/                      前端
│  ├─ api.ts                 接口封装 + 本地媒体协议 URL
│  ├─ store.tsx              全局状态（导航栈 / 用户 / 本地收藏 / 主题）
│  ├─ html.ts                吃瓜正文清洗与图片代理
│  ├─ components/            Feed（播放页）/ VideoSurface / PlayerControls / Panels / UI
│  └─ pages/                 Home / Search / Category / Profile / Posts
├─ src-tauri/                Rust 后端
│  └─ src/
│     ├─ net.rs              请求层（边缘信封 + 重试）
│     ├─ api.rs              业务命令
│     ├─ media.rs            封面解密 + HLS 代理 + 缓存
│     └─ session.rs          token 持久化
└─ docs/API.md               接口文档
```

## 开发 / 构建

```bash
pnpm install          # 首次安装
pnpm app:dev          # 桌面端热重载
pnpm app:build        # 打包：Windows → NSIS 安装程序；macOS → .app + .dmg
```

macOS 先装 Xcode Command Line Tools（`xcode-select --install`），打包目标写在
`src-tauri/tauri.macos.conf.json`（`app` + `dmg`，窗口用系统标题栏 Overlay）。

Android（需 Android SDK + NDK，并配置 `ANDROID_HOME` / `NDK_HOME`）：

```bash
pnpm android:init     # 首次生成 android 工程
pnpm android:dev      # 真机 / 模拟器调试
pnpm android:build    # 产出 APK
```

iOS（需 macOS + Xcode、`brew install xcodegen`、`rustup target add aarch64-apple-ios`）：

```bash
pnpm ios:init         # 首次生成 Xcode 工程（src-tauri/gen/apple）
pnpm ios:build        # 有开发者证书时直接出签名 IPA
```

没有证书也能出包：打 tag 后 CI 会产出 **未签名 IPA**（`HGhub_<版本>_ios_unsigned.ipa`，随 Release 发布），
用 TrollStore 直接装，或用 Sideloadly / AltStore / 爱思助手等自签后安装。做法见 `.github/workflows/release.yml` 的 `ios` 任务：
工程里关掉签名 → `tauri ios build` 归档 → 从 xcarchive 取 `.app` 打成 `Payload/` 压缩包。

### 环境注意

- 工程若放在 **exFAT** 盘（不支持符号链接），需保留 `.npmrc` 中的 `node-linker=hoisted`。
- pnpm 10 靠 `package.json` 的 `pnpm.onlyBuiltDependencies` 放行 `esbuild`，否则 `vite build` 缺少二进制；
  pnpm 11 起该字段失效，白名单改在 `pnpm-workspace.yaml` 的 `allowBuilds`（两处都保留）。

## 实现要点

1. **统一边缘信封**：站点把 `/api/**` 收敛为 `POST /api/edge/request`（`method/path/body(base64)/content_type` + `Authorization: Bearer`），本项目只对接这一个入口，无需处理 Cookie。
2. **封面解密**：封面为 AES-128-CBC 密文，Rust 侧解密后经自定义协议输出，前端 `<img>` 直接使用。
3. **HLS 代理**：m3u8 与分片经自定义协议转发并改写 `#EXT-X-KEY` / 分片地址，绕开 WebView 的 CORS 与防盗链。
4. **自定义协议**：Windows / Android 为 `http://hg.localhost/*`，macOS / iOS（WKWebView）为 `hg://localhost/*`。
   Rust 侧 `media.rs` 的 `LOCAL_ORIGIN` 与前端 `api.ts` 的 `LOCAL` 按平台取值，必须一致，否则封面与视频全部加载失败。
5. **不做签名逆向**：只复用浏览器同源行为，接口字段均有文档与实测样本。


## 免责声明

- 本项目与内容提供方无任何关联，作者不参与内容的制作、上传与分发。
- 本项目仅在上述官方渠道发布；任何第三方修改版（尤其是加卡密、VIP 变现的版本）均与作者无关，请自行甄别。
- 使用者应自行遵守所在地法律法规；因使用本项目产生的任何后果由使用者自行承担。
- 若相关权利方认为本项目存在侵权，请通过 Issue 联系，我们会及时处理。

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) —— **仅限非商业用途**。

- **允许**：个人学习、研究、自用、爱好项目，以及在非营利组织内部使用；可以自由修改、二次开发。
- **禁止**：任何商业用途。包括但不限于打包出售、接入付费/会员/广告变现、作为收费服务或商业产品的一部分分发。
- **保留声明**：分发本项目或其修改版时，必须附带本许可证全文（或上面的链接）以及 `Required Notice` 声明行。
- 商业授权请通过 Issue 联系作者单独洽谈。

> 历史说明：v1.0.1 及更早版本以 MIT 发布，已发出的副本继续按 MIT 授权；自 **v1.1.0** 起的新版本一律适用 PolyForm Noncommercial 1.0.0。

## 常见问题

**1. `pnpm install` 报 `ERR_PNPM_EISDIR ... symlink`**

工程放在 exFAT / FAT32 盘时无法创建符号链接，保留 `.npmrc` 里的 `node-linker=hoisted` 即可。

**2. `tauri android build` 报 `Failed to create a symbolic link ... jniLibs`**

同样是 exFAT 不支持符号链接。可手动把 Rust 产物拷进 jniLibs，再直接跑 Gradle：

```bash
cp src-tauri/target/aarch64-linux-android/debug/libhuangguo_client_lib.so \
   src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/

cd src-tauri/gen/android
./gradlew assembleDebug        # Windows: gradlew.bat assembleDebug
```

产物在 `src-tauri/gen/android/app/build/outputs/apk/`。

**3. Android 构建提示找不到 SDK / NDK**

需要设置 `ANDROID_HOME`（Android SDK 根目录）、`NDK_HOME`（`$ANDROID_HOME/ndk/<版本>`）与 `JAVA_HOME`（JDK 17）。

## LinuxDO
https://linux.do/
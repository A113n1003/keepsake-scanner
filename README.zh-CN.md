# Keepsake Scanner（拾影扫描）

[English](README.md)

一款重视隐私的 macOS 照片扫描与归档工具。一次在扫描仪上放置多张照片，软件会通过 macOS ImageCaptureCore 扫描整板内容，再用 Vision 自动识别、透视校正、分离和保存。

所有图像处理均在本机完成，文件使用系统级 `SCAN_0000000.jpg` 顺序编号。

> 项目状态：早期公开版本。处理无法替代的老照片前，请先备份并用少量照片验证扫描仪兼容性。

## 功能

- 发现 macOS 已识别的 USB 或网络扫描仪。
- 提供快速（300 dpi）、标准（600 dpi）和档案（1200 dpi）三档模式。
- 一次扫描多张照片，自动检测、拉直、分离和预览。
- 使用持久化全局计数器，跨批次连续生成 `SCAN_0000000` 编号。
- 使用低分辨率人脸与文字分析判断方向，再无损应用到高清结果。
- 修改拍摄时间、地址和备注，并写入 EXIF/XMP 元数据。
- 左右旋转照片；删除时移到 macOS 废纸篓。
- 无扫描仪时使用完全合成、不含真实身份的演示图片。
- 界面和原生扫描进度支持英文、简体中文。

## 环境要求

- macOS 14 或更高版本
- macOS“图像捕捉”支持的扫描仪
- Node.js 20 或更高版本
- Xcode Command Line Tools

## 快速开始

```bash
git clone https://github.com/A113n1003/keepsake-scanner.git
cd keepsake-scanner
npm install
npm run dev
```

默认输出目录是当前 macOS“图片”目录下的 `Keepsake Scanner` 文件夹，也可以在软件中选择其他可写目录。

## 开发命令

```bash
npm run check      # 隐私检查、代码规范、原生自测和界面构建
npm run dev        # 构建 Swift 助手并启动 Electron
npm run dist       # 生成未签名的本地 macOS 安装包
```

详细说明见[开发指南](docs/development.md)和[架构文档](docs/architecture.md)。

## 隐私

项目不包含统计分析、云端上传、账号系统或远程图像处理服务。扫描内容、预览、元数据和设置均保留在本机。公开演示素材只包含生成的风景和静物，不包含真人或个人文件。

仓库内置隐私门禁，会拒绝本机用户目录、常见密钥格式和私钥。完整说明见[隐私模型](docs/privacy.md)。

## 扫描仪兼容性

如果设备能在 macOS 自带“图像捕捉”中正常出现并扫描，通常可以在本软件中使用。不同厂商驱动在会话、分辨率和预热行为上仍可能存在差异。提交设备问题前请阅读[扫描仪兼容性与故障排查](docs/scanner-compatibility.md)。

## 项目文档

- [架构](docs/architecture.md)
- [开发指南](docs/development.md)
- [隐私模型](docs/privacy.md)
- [扫描仪兼容性](docs/scanner-compatibility.md)
- [发布流程](docs/releasing.md)
- [素材来源](docs/assets.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [支持方式](SUPPORT.md)
- [项目治理](GOVERNANCE.md)
- [变更记录](CHANGELOG.md)
- [第三方许可说明](THIRD_PARTY_NOTICES.md)

## 参与贡献

欢迎提交 Issue 和 Pull Request。请先阅读[贡献指南](CONTRIBUTING.md)与[行为准则](CODE_OF_CONDUCT.md)。

## 许可证

项目使用 [MIT License](LICENSE)。

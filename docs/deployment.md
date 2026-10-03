# GitHub Pages 部署

本项目支持纯静态托管。GitHub Actions 负责测试与构建，GitHub Pages 提供页面；解析、素材下载和 ZIP 打包在访客浏览器中完成，无需把素材上传到 GitHub。

## 开启自动部署

1. 把本项目修改推送到 fork 的 `main` 分支。
2. 打开仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
3. 如果 fork 的 Actions 尚未启用，在 **Actions** 页面启用工作流。
4. 在 **Actions → Deploy GitHub Pages → Run workflow** 手动运行一次。以后每次推送 `main` 自动部署。
5. 等 `build` 和 `deploy` 成功，Pages 设置或工作流会显示网址。此 fork 的默认地址为：
   <https://hinanawitenshi104.github.io/webstatic-extractor/>

工作流位于 [pages.yml](../.github/workflows/pages.yml)。它只上传 `dist/` 中的页面、脚本和许可证，不上传 Node 服务、素材、源站资源包或 `node_modules`。原仓库 `CNAME` 保留在源码中，但不会带入部署；不需要原作者的域名，也不需要额外部署密钥。

本地构建：

```sh
npm ci --ignore-scripts
npm test
npm run build
```

`dist/` 可部署到其他静态托管服务。依赖 Acorn 会复制到 `lib/`，所有脚本路径均为相对路径，兼容 GitHub Pages 的仓库子目录。

## 跨域与免费额度

2026-10-03 已实测周年拾光册页面和资源包允许 `https://hinanawitenshi104.github.io` 跨域读取，因此可以直接部署到 Pages。未来活动、海外域名或某些 CDN 如果不允许 CORS，纯静态托管不能替服务器添加许可；此时可使用本地 `npm start` 或 CLI。不要关闭浏览器安全选项。

- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)：公开仓库可免费使用；[当前限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)包括站点不超过 1 GB、每月 100 GB 软带宽限制。本项目只托管几百 KB 的工具页面，素材流量来自米哈游 CDN。
- [GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)：公开仓库的标准 GitHub 托管 runner 可免费运行。Actions 是执行工作流的环境，不是常驻网站服务器；此处仅用于测试、构建、部署。
- 如确实需要公开跨域代理，可另行考虑 Cloudflare Workers。但[免费套餐](https://developers.cloudflare.com/workers/platform/limits/)当前限制 100,000 请求/天、10 ms CPU/请求，一次提取就可能有上千请求，需要限制可代理域名和滥用。当前活动无须这层服务，项目未配置或部署代理 Worker。

GitHub Pages 在不同地区的可达性和速度取决于访问网络。本文没有把提取出的活动素材托管到公共站点。

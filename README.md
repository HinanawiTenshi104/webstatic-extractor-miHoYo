# Webstatic Extractor

# 注：使用了GPT6 Astra进行修复

## 更新与使用

在线使用：https://hinanawitenshi104.github.io/webstatic-extractor

- 改用静态语法解析，支持压缩后的 Spine 清单、内嵌 atlas 和外置 JSON；每套骨骼与原名贴图配套保存。
- ZIP 下载默认 **8 路并发**，可选 4/8/16 路；预取窗口限制为并发数的两倍，按原顺序打包，支持进度、速度显示与取消。
- 加入 HTTP/文件格式校验，修正重复文件名与异步读取引起的 ZIP 损坏问题。
- 提供 CLI 和 GitHub Pages 自动部署。相关问题：[上游 #8](https://github.com/YuehaiTeam/webstatic-extractor/issues/8)、[#10](https://github.com/YuehaiTeam/webstatic-extractor/issues/10)、[#11](https://github.com/YuehaiTeam/webstatic-extractor/issues/11)、[#13](https://github.com/YuehaiTeam/webstatic-extractor/issues/13)。

需要 Node.js 18+：

```sh
npm ci --ignore-scripts
npm start
```

打开 <http://127.0.0.1:8765>，粘贴活动链接，解析后下载。命令行用法：

```sh
node cli.js "活动页面URL" --output ./output/event
```

测试：`npm test`。免费在线部署：[GitHub Pages 配置说明](docs/deployment.md)。浏览器版超过 ZIP32 限制时请改用 CLI。

已实测周年拾光册活动：264 套 Spine、1,609 个素材文件，图集、JSON、贴图和 ZIP 完整性校验通过。运行时计算的 URL、复杂懒加载或账号私有数据可能无法提取；公开站点还受源站 CORS 限制。

---

## 原项目说明

Extract spine atlas &amp; json &amp; images from genshin web activity pages in one click!  
一键从原神网页活动中提取spine模型及相关图片素材。使用streamsaver流式下载，用网页对付网页，魔法对抗魔法。

如有部分素材无法提取，说明素材是从服务器动态获取的，不在资源包里。

### 支持的域名：
 - webstatic.mihoyo.com
 - act.mihoyo.com

### 不支持的域名：
 - act.hoyoverse.com
 - webstatic-sea.mihoyo.com

对于Hoyoverse的海外网页活动，可以找到其在mihoyo.com域名下对应的页面之后使用。

### 其他参考：

[米哈游平台前端团队: WebGL 动画工业化探索与实践](https://www.infoq.cn/article/mszq5ecr5t5qqfatmf3j)

### 米厂更新webpack5之后的原理：
和之前相比，发生的变化有：
 - `chunkLoadingGlobal`跟随默认值，随package.json里的项目名变化
 - `_webpack_require_`函数内部结构改变
 - 模块分布发生变化

因此，不能再只加载vendor和entry了。由于entrance依然在html里，新的运行方式变为：
 - 从HTML里用正则匹配`chunkLoadingGlobal`。
 - 阻止webpack初始化
 - 做一个假的webpack运行环境
 - 在加载的所有chunk里暴力搜索3d组件的特征（spine、stage等）
 - 剩下的和原来一样。

### 之前的原理：
米厂似乎有两套不同的工具链。有的活动的webpack entrance不在html里。  
这时候得用Proxy和defineProperty强制禁止webpackJsonp被修改，来获得所有的chunks。

### 更早之前的原理：
原神网页活动的构建配置、工具链和引擎都特别固定，都是webpack entrance在html里，其他数据在两个js里：  
 - app.js是dom ui  
 - vendors.js是库和3d部分

那么只需要
 - 阻止webpack初始化，活动页面就不会正常运行
 - 做一个假的webpack运行环境，用来接收这些模块，得到所有模块的列表
 - 在vendor里搜索所有module，用tostring暴力搜索spine的特征
 - 找到那个3d的组件
 - 由于数据定义在组件内，根本不会暴露出来，所以得用点奇怪的方法去提取他
 - 可以看出这个组件本身也是被webpack编译过一遍的，里面有一个独立的webpack_require
 - 既然是被webpack编译的，考虑到webpack会对每个module做__esModule的处理，那么就把Object.defineProperty给劫持掉，就能拿到这个组件内部的每个子模块列表
 - 暴力遍历子模块，查找符合spine数据源定义特征的模块
 - 把找到的所有模块合并
 - 下载所有的图片
 - 打包压缩  
 
 就能实现自动提取素材了。
 
 本项目仅为对网页活动游戏的项目结构学习的副产品，不对提取后的数据的用途负责。

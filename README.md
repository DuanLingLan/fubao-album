# 福宝的相册

一只虎斑猫（福宝，2025-05-22 到家）的电子相册。做成一本可以翻的相册书，但导航、检索、分享交给数字端。

线上地址：<https://duanlinglan.github.io/fubao-album/>
仓库：`DuanLingLan/fubao-album`（GitHub Pages 直接服务 `main` 分支根目录）

纯静态站点，没有打包器：原生 ES 模块 + 一个 Node 构建脚本。

---

## 日常更新：三个双击就够

| 步骤 | 操作 | 说明 |
|---|---|---|
| 1 | 把手机照片放进 `D:\Pictures\Fubao` | 见下方「从手机取原图」 |
| 2 | 双击 **`选片.bat`** | 浏览器打开 <http://127.0.0.1:8124>，勾选要上相册的照片 → 点「保存选片」 |
| 3 | 双击 **`写描述.bat`**（可选） | 打开 <http://127.0.0.1:8124/captions>，写章节引言 / 单张描述 / 勾「整页大图」 |
| 4 | 双击 **`更新相册.bat`** | 压缩 → 生成数据 → commit → push，约 1–2 分钟后线上生效 |

没变化时 `更新相册.bat` 会自己跳过提交。构建是增量的：只处理新文件或变过的文件，几十张也很快。

### 从手机取原图（adb）

手机 USB 连电脑、开「传输文件」模式，然后：

```bash
D:/AI/platform-tools/adb.exe devices          # 确认能看到设备
D:/AI/platform-tools/adb.exe shell ls /sdcard/DCIM/Camera   # 看有哪些
D:/AI/platform-tools/adb.exe pull /sdcard/DCIM/Camera/IMG_xxx.jpg D:/Pictures/Fubao/IMG_xxx.jpg
```

Git Bash 里如果路径被改成 `C:/Program Files/Git/sdcard/...`，命令前加 `MSYS_NO_PATHCONV=1`。

---

## 照片是怎么进网站的

```
D:\Pictures\Fubao\*.jpg          原图（不进仓库）
        │  选片：scripts/selection.json（文件名数组）
        ▼
node scripts/build.mjs
        │  自动转正方向 → 剥离全部 EXIF/GPS → 长边 1600 → WebP ≈280KB
        │  另生成 16px 模糊占位色（LQIP）直接内嵌进 manifest.json
        ▼
photos/*.webp + data/manifest.json
        ▼
node scripts/deploy.mjs          git add/commit/push → GitHub Pages
```

**隐私**：`magick -strip` 去掉包括 GPS 在内的一切元数据，仓库里只有 `photos/*.webp`，定位信息不会上线。

**文字**：网站上的每一个字都来自你写的内容或固定模板（日期、标签、页数），构建脚本不会生成任何描述。默认状态下照片没有任何文字。

---

## 文案：`data/captions.json`

推荐用 `写描述.bat` 的页面编辑（保存即写入本文件）。手写也行，格式：

```json
{
  "months": {
    "2025-05": "小宝到家啦！"
  },
  "IMG_20250621_131205017~2": {
    "desc": "妨碍姐姐打游戏的屑猫猫",
    "layout": "hero"
  }
}
```

- 键是**不带扩展名**的照片名，值里 `desc` = 照片描述，`layout: "hero"` = 这张独占一整页大图。
- `months` 是保留键，`YYYY-MM` → 该章节扉页上的一段引言。
- 空字段不用写；删掉某条就是清除对应文案（页面上的「清除」按钮做同样的事）。
- 这些文字会进字体子集，所以新增汉字后重新构建即可，不需要动字体文件。
- 格式样例见 `data/captions.example.json`。

## 选片：`scripts/selection.json`

一个文件名数组（带 `.jpg`），是「入选清单」而不是快照：

- 想加照片 → 拷进原图目录，在选片页勾上；
- 想撤掉某张 → 选片页取消勾选，保存后重新构建，对应的 webp 会被清理；
- 清单里没列的照片不会上线，原图目录可以随便堆。

---

## 站点结构

| 路径 | 作用 |
|---|---|
| `index.html` | 唯一页面，hash 路由 |
| `assets/js/` | `main.js` 启动，`book.js` 翻页书，`lightbox.js` 大图，`ui.js` 工具栏/抽屉，`router.js` 路由，`gallery.js` 标签墙 |
| `assets/vendor/page-flip.esm.js` | vendored [StPageFlip](https://github.com/Nodws/StPageFlip) v2.0.7，带两处补丁：`disableFlipByClick` 可编程绕过、竖屏宽度二次钳制 |
| `assets/css/` | `main.css` 主题与布局，`book.css` 书页，`lightbox.css` 大图层 |
| `assets/fonts/` | 马善政楷书子集（构建时按实际用到的字生成，源 ttf 不入库） |
| `data/manifest.json` | 构建产物：页面序列 + 照片元数据 + LQIP |
| `scripts/` | 构建与本地工具 |

路由：`#/` 相册 · `#/p/页码` · `#/photo/照片ID`（单张分享链接）· `#/month/2025-06` · `#/tag/趴睡` · `#/slideshow`

## 本地开发

```bash
npm install                    # page-flip、subset-font（构建用）
node scripts/build.mjs         # 只重建
python -m http.server 8123     # 本地预览 → http://127.0.0.1:8123
npm run curate                 # 选片 + 文案工具（8124）
```

依赖：ImageMagick 7（`magick`）、Node 18+。

## 手机端注意

- 翻页两种方式：**左右拖/滑**（保留），以及**轻触画面最左/最右 10%**（约 36–80px 的贴边热区）翻上/下一页；点照片本身 = 进大图，两者不冲突。
- 翻页动画走「简化」配置：420ms、不画投影、关掉悬停卷角（鼠标扫过书角不再凭空折角）；`html, body` 锁死溢出，动画途中不会再闪出滚动条。长按书页角落也只会翻一页（`assets/vendor/page-flip.esm.js` 里有一处本地补丁，见文件内注释）。
- 大图页：双指捏合缩放、双击放大、单指拖动平移、左右滑动切换、**长按图片保存**（依赖系统菜单，图片未禁选）。
- 工具栏、进度条、弹层都按 `env(safe-area-inset-*)` 避让刘海和手势条。
- 添加到主屏幕：**目录抽屉最下面一行**（安卓/桌面 Chrome 若支持会直接变成「安装到主屏幕」一键弹系统安装框；iOS Safari 则提示走 分享 → 添加到主屏幕）。微信内浏览器装不了，这一行会自动隐藏。
- 微信内置浏览器：长按图片可保存；「分享」按钮优先走系统分享，不支持时退化为复制链接。
- 弱网下先出 16px 模糊色块再交叉淡入，不会看到白屏。
- GitHub Pages 的响应头是 `Cache-Control: max-age=600`，改完上线后手机上可能要等 10 分钟或强刷才看到新版式。

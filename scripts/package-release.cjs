// 发布打包脚本:把插件打包成解压即用的目录,供 CI 打成 zip 上传 Release。
// 用法:node scripts/package-release.cjs
// 产物:dist-release/dsh-status-rotator/ (含自动生成的 config.json,解压即用)
const fs = require("node:fs");
const path = require("node:path");

const root = path.dirname(__dirname);
const staging = path.join(root, "dist-release", "dsh-status-rotator");

// 清空重建 staging 目录
fs.rmSync(path.join(root, "dist-release"), { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

// 发布文件清单(相对项目根,顺序即文件存在顺序)
const files = [
  "lib/index.js",
  "lib/client.js",
  "config.example.json",
  "gen-config.cjs",
  "package.json",
  "cordis.patch.yml",
  "README.md",
  "CONTRIBUTORS.md",
  "LICENSE"
];

for (const file of files) {
  const src = path.join(root, file);
  if (!fs.existsSync(src)) {
    console.error("缺少发布文件:", file);
    process.exit(1);
  }
  const dst = path.join(staging, file);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// config.json:从 config.example.json 复制一份(解压即用,不用跑 gen-config.cjs)
fs.copyFileSync(path.join(root, "config.example.json"), path.join(staging, "config.json"));

const count = fs.readdirSync(staging).length;
console.log("打包完成:", staging, "(" + count + " 个顶层条目)");
console.log("下一步:cd dist-release && zip -r dsh-status-rotator-<tag>.zip dsh-status-rotator");

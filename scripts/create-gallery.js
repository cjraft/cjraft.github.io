#!/usr/bin/env node

/**
 * 七牛云上传图片并创建 Hugo 画廊作品
 *
 * 前置要求：
 *   1. 配置环境变量（推荐写到 .env 文件或 shell profile）：
 *      export QINIU_ACCESS_KEY="你的 AccessKey"
 *      export QINIU_SECRET_KEY="你的 SecretKey"
 *      export QINIU_BUCKET="你的存储空间名"
 *      export QINIU_DOMAIN="你的 CDN 域名，如 https://cdn.example.com/"
 *   2. Node.js >= 18
 *
 * 用法：
 *   node scripts/create-gallery.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createReadStream } = require('fs');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (q) => new Promise((resolve) => rl.question(q, resolve));

const ENV_VARS = ['QINIU_ACCESS_KEY', 'QINIU_SECRET_KEY', 'QINIU_BUCKET', 'QINIU_DOMAIN'];

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split('\n').forEach((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) return;
    const [, key, value] = match;
    if (process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, '');
    }
  });
}

loadEnv();

function checkEnv() {
  const missing = ENV_VARS.filter((k) => !process.env[k]);
  if (missing.length === 0) return true;

  console.error('\n❌ 缺少以下环境变量：');
  missing.forEach((k) => console.error(`   - ${k}`));
  console.error(`
请在项目根目录创建 .env 文件，或添加到 shell profile：

  export QINIU_ACCESS_KEY="你的 AccessKey"
  export QINIU_SECRET_KEY="你的 SecretKey"
  export QINIU_BUCKET="你的存储空间名"
  export QINIU_DOMAIN="https://你的CDN域名/"

获取方式：
  - AccessKey / SecretKey：七牛云控制台 → 密钥管理
  - Bucket：七牛云控制台 → 对象存储 → 空间名称
  - Domain：七牛云控制台 → 对象存储 → 空间 → 域名，默认是测试域名或绑定的自定义域名
`);
  return false;
}

function base64ToUrlSafe(base64) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_');
}

function hmacSha1(key, data) {
  return crypto.createHmac('sha1', key).update(data).digest();
}

function generateUploadToken(bucket, key) {
  const accessKey = process.env.QINIU_ACCESS_KEY;
  const secretKey = process.env.QINIU_SECRET_KEY;
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const scope = key ? `${bucket}:${key}` : bucket;
  const putPolicy = JSON.stringify({ scope, deadline });
  const encodedPolicy = base64ToUrlSafe(Buffer.from(putPolicy).toString('base64'));
  const sign = hmacSha1(secretKey, encodedPolicy);
  const encodedSign = base64ToUrlSafe(sign.toString('base64'));
  return `${accessKey}:${encodedSign}:${encodedPolicy}`;
}

function compressImage(filePath) {
  const tmpPath = filePath.replace(/\.[^.]+$/, '') + '_compressed.jpg';
  try {
    const result = require('child_process').execSync(
      `python3 -c "
import sys
from PIL import Image, ImageOps
img = Image.open('${filePath}')
img = ImageOps.exif_transpose(img)
max_size = 1400
if max(img.size) > max_size:
    img.thumbnail((max_size, max_size), Image.LANCZOS)
img = img.convert('RGB')
img.save('${tmpPath}', 'JPEG', quality=85, optimize=True)
print(img.size[0], img.size[1])
"`,
      { encoding: 'utf-8', timeout: 60000 }
    ).trim();
    const [width, height] = result.split(' ').map(Number);
    const origSize = require('fs').statSync(filePath).size;
    const newSize = require('fs').statSync(tmpPath).size;
    const ratio = ((1 - newSize / origSize) * 100).toFixed(0);
    console.log(`  🗜️  ${path.basename(filePath)} ${(origSize/1024/1024).toFixed(1)}MB → ${(newSize/1024/1024).toFixed(1)}MB (${ratio}%)`);
    return { path: tmpPath, width, height };
  } catch (e) {
    console.log(`  ⚠️  压缩失败，使用原文件: ${path.basename(filePath)}`);
    return { path: filePath, width: null, height: null };
  }
}

async function uploadFile(filePath, keyOverride) {
  const bucket = process.env.QINIU_BUCKET;
  const domain = process.env.QINIU_DOMAIN.replace(/\/$/, '');
  const { path: actualPath, width, height } = compressImage(filePath);
  const fileName = path.basename(filePath);
  const key = keyOverride || `gallery/${Date.now()}-${fileName}`;
  const token = generateUploadToken(bucket, key);

  const fileBuffer = fs.readFileSync(actualPath);
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

  const metadata = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="token"\r\n\r\n${token}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="key"\r\n\r\n${key}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`,
    'utf-8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  const body = Buffer.concat([metadata, fileBuffer, tail]);

  const res = await fetch('https://up.qiniup.com', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`上传失败: ${res.status} ${text}`);
  }

  const data = JSON.parse(text);
  const url = `${domain}/${data.key}`;
  console.log(`  ✅ ${fileName} -> ${url}`);

  if (actualPath !== filePath && fs.existsSync(actualPath)) {
    fs.unlinkSync(actualPath);
  }

  return { url, width, height };
}

function slugify(str) {
  return str
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

async function main() {
  console.log('🖼️  创建画廊作品\n');

  if (!checkEnv()) {
    process.exit(1);
  }

  const title = (await question('画廊标题: ')).trim();
  if (!title) {
    console.error('标题不能为空');
    process.exit(1);
  }

  const dir = (await question('CDN 目录名（如 bupt-walk-2026）: ')).trim();
  if (!dir) {
    console.error('目录名不能为空');
    process.exit(1);
  }

  const rawPaths = (await question('图片路径（多个用空格分隔）: ')).trim();
  const filePaths = rawPaths.split(/\s+/).filter(Boolean);

  const missing = filePaths.filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    console.error(`文件不存在: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log('\n📤 开始上传...');
  const photos = [];
  for (const fp of filePaths) {
    try {
      const key = `gallery/${dir}/${path.basename(fp)}`;
      const { url, width, height } = await uploadFile(fp, key);
      photos.push({ url, width, height });
    } catch (err) {
      console.error(`  ❌ ${path.basename(fp)} 上传失败: ${err.message}`);
    }
  }

  if (photos.length === 0) {
    console.error('所有图片上传失败，终止');
    process.exit(1);
  }

  const slug = slugify(title);
  const file = path.resolve(__dirname, `../content/life/${slug}.md`);

  const photoLines = photos.map(({ url, width, height }) => {
    const lines = [`  - preview: "${url}"`, `    original: "${url}"`];
    if (width) lines.push(`    width: ${width}`);
    if (height) lines.push(`    height: ${height}`);
    return lines.join('\n');
  }).join('\n');
  const frontmatter = `---\ntitle: "${title}"\ntype: "gallery"\nshowToc: false\nhideMeta: true\nphotos:\n${photoLines}\n---\n`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, frontmatter, 'utf-8');

  console.log(`\n📝 已创建: ${path.relative(process.cwd(), file)}`);
  console.log(`\n预览: hugo server -D`);
  console.log(`访问: http://localhost:1313/life/${slug}/`);

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

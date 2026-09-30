// 凭证图片存储：R2（S3 兼容 API）。凭证文件内容继续留在 R2，MySQL 只存附件元数据 + r2_key。
// 环境变量：R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
// 公开读通过 /api/public/receipts/:id 后端代取；内部附件支持签名直链（可选）。
let client = null, cfg = null;

function config() {
  if (cfg) return cfg;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET || "class-fund-receipts";
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  cfg = { accountId, accessKeyId, secretAccessKey, bucket };
  return cfg;
}

function getClient() {
  const c = config();
  if (!c) return null;
  if (!client) {
    const { S3Client } = require("@aws-sdk/client-s3");
    client = new S3Client({
      region: "auto",
      endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    });
  }
  return client;
}

async function putObject(key, body, contentType, meta = {}) {
  const c = config();
  const s3 = getClient();
  if (!s3) throw new Error("no_r2_config");
  const { PutObjectCommand } = require("@aws-sdk/client-s3");
  await s3.send(new PutObjectCommand({
    Bucket: c.bucket, Key: key, Body: body, ContentType: contentType,
    Metadata: { sha256: meta.sha256 || "", filename: (meta.filename || "").slice(0, 1024) },
  }));
  return key;
}

async function getObject(key) {
  const c = config();
  const s3 = getClient();
  if (!s3) throw new Error("no_r2_config");
  const { GetObjectCommand } = require("@aws-sdk/client-s3");
  const res = await s3.send(new GetObjectCommand({ Bucket: c.bucket, Key: key }));
  return { body: res.Body, contentType: res.ContentType, contentLength: res.ContentLength };
}

async function presignedGet(key, expiresIn = 3600) {
  const c = config();
  const s3 = getClient();
  if (!s3) throw new Error("no_r2_config");
  const { GetObjectCommand } = require("@aws-sdk/client-s3");
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: c.bucket, Key: key }), { expiresIn });
}

module.exports = { config, getClient, putObject, getObject, presignedGet };

